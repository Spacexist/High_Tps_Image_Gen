// 单次任务执行器：一次任务只调用一次下游，失败即终态，不在 Core 内自动重试。
import { serializeError } from "../shared/errors.js";

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

    try {
      const result = await this.executor.execute(task, key);
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
