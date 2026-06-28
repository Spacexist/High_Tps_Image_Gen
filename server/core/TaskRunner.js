// 单次任务执行器，负责结果、重试、工作台状态通知与 Key 归还闭环。
import { serializeError } from "../shared/errors.js";

export class TaskRunner {
  constructor({ queue, keyManager, executor, retryPolicy, resultStore, taskObserver, logger = console }) {
    this.queue = queue;
    this.keyManager = keyManager;
    this.executor = executor;
    this.retryPolicy = retryPolicy;
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
      attempt: task.attempts,
      model: task.input.model,
      keyID: key.keyID,
      sourceKeyId: key.sourceKeyId,
    }, "Task started");

    try {
      const result = await this.executor.execute(task, key);
      this.resultStore.set(task.id, result);
      this.queue.complete(task.id);
      this.keyManager.reportOutcome(key, { success: true });
      // Core 成功后再缓存输出；缓存异常只影响工作台结果，不应误伤健康 Key。
      await this.taskObserver?.completed?.(task, result);
      this.logger.info?.({
        event: "task.completed",
        taskId: task.id,
        attempt: task.attempts,
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
      if (this.retryPolicy.shouldRetry(task, error)) {
        const delayMs = this.retryPolicy.delayFor(task, error);
        this.queue.retry(task.id, delayMs, serialized);
        await this.taskObserver?.retrying?.(task, serialized);
        this.logger.warn?.({
          event: "task.retry_scheduled",
          taskId: task.id,
          attempt: task.attempts,
          keyID: key.keyID,
          delayMs,
          downstreamStatus: error.downstreamStatus,
          errorCode: serialized.code,
        }, "Task retry scheduled");
      } else {
        this.queue.fail(task.id, serialized);
        await this.taskObserver?.failed?.(task, serialized);
        this.logger.error?.({
          event: "task.failed",
          err: error,
          taskId: task.id,
          attempt: task.attempts,
          keyID: key.keyID,
          durationMs: Date.now() - startedAt,
        }, "Task failed");
      }
    } finally {
      // 无论成功、失败还是超时，都必须归还同一个 keyID；遗漏会永久吞掉一个并发槽位。
      const returned = this.keyManager.release(key.keyID);
      this.logger.debug?.({ event: "key.released", taskId: task.id, keyID: key.keyID, returned }, "Key released");
    }
  }
}
