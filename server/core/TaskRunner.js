// 单次任务执行器：一次任务只调用一次下游，失败即终态，不在 Core 内自动重试。
import { serializeError } from "../shared/errors.js";
import { sanitizeTrace } from "./TraceSanitizer.js";

function publicInput(input) {
  const { _inputFile, _inputContentType, ...safe } = input;
  return safe;
}

export class TaskRunner {
  constructor({ queue, keyManager, executor, resultStore, taskObserver, logger = console }) {
    this.queue = queue;
    this.keyManager = keyManager;
    this.executor = executor;
    this.resultStore = resultStore;
    this.taskObserver = taskObserver;
    this.logger = logger;
  }

  async run(task, key) {
    const startedAt = Date.now();
    await this.taskObserver?.started?.(task);
    this.logger.info?.({
      event: "task.started",
      taskId: task.id,
      model: task.input.model,
      keyID: key.keyID,
      sourceKeyId: key.sourceKeyId,
    }, "Task started");

    // 在真正发出请求前保存结构；即使下游超时或报错，用户也能看到 Core 发了什么。
    let requestTrace = {
      method: "POST",
      target: "injected executor",
      keyID: key.keyID,
      body: publicInput(task.input),
    };
    try {
      if (this.executor.describeRequest) requestTrace = this.executor.describeRequest(task, key);
    } catch (error) {
      requestTrace.descriptionError = error.message;
    }
    this.queue.setTrace(task.id, { request: sanitizeTrace(requestTrace) });

    try {
      const execution = this.executor.executeDetailed
        ? await this.executor.executeDetailed(task, key)
        : { result: await this.executor.execute(task, key), responseTrace: null };
      const result = execution.result;
      this.queue.setTrace(task.id, {
        response: sanitizeTrace(execution.responseTrace ?? {
          ok: true,
          statusCode: null,
          body: result,
        }),
      });
      // 先等待输出真正落盘，再把 Core 标成 completed。
      // 这样前端看到终态时，滑动窗口释放槽位且 outputUrl 已经稳定可读。
      await this.taskObserver?.completed?.(task, result);
      this.resultStore.set(task.id, result);
      this.queue.complete(task.id);
      this.keyManager.reportOutcome(key, { success: true });
      this.logger.info?.({
        event: "task.completed",
        taskId: task.id,
        keyID: key.keyID,
        durationMs: Date.now() - startedAt,
      }, "Task completed");
    } catch (error) {
      this.keyManager.reportOutcome(key, {
        success: false,
        statusCode: error.downstreamStatus,
        error,
      });
      const serialized = serializeError(error);
      this.queue.setTrace(task.id, {
        response: sanitizeTrace({
          ok: false,
          statusCode: error.downstreamStatus ?? null,
          error: serialized,
          body: error.responseBody ?? null,
        }),
      });
      this.queue.fail(task.id, serialized);
      await this.taskObserver?.failed?.(task, serialized);
      this.logger.error?.({
        event: "task.failed",
        err: error,
        taskId: task.id,
        keyID: key.keyID,
        durationMs: Date.now() - startedAt,
      }, "Task failed");
    } finally {
      // 无论成功、失败还是超时，都必须归还同一个 keyID；遗漏会永久吞掉一个并发槽位。
      const returned = this.keyManager.release(key.keyID);
      this.logger.debug?.({
        event: "key.released",
        taskId: task.id,
        keyID: key.keyID,
        returned,
      }, "Key released");
    }
  }
}
