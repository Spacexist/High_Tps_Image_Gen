// 单次任务执行器，负责结果、重试与 Key 归还闭环。
import { serializeError } from "../shared/errors.js";

export class TaskRunner {
  constructor({ queue, keyManager, executor, retryPolicy, resultStore, logger = console }) {
    this.queue = queue;
    this.keyManager = keyManager;
    this.executor = executor;
    this.retryPolicy = retryPolicy;
    this.resultStore = resultStore;
    this.logger = logger;
  }

  async run(task, key) {
    try {
      const result = await this.executor.execute(task, key);
      this.resultStore.set(task.id, result);
      this.queue.complete(task.id);
      this.keyManager.reportOutcome(key, { success: true });
    } catch (error) {
      this.keyManager.reportOutcome(key, {
        success: false,
        statusCode: error.downstreamStatus,
        error,
      });
      const serialized = serializeError(error);
      if (this.retryPolicy.shouldRetry(task, error)) {
        this.queue.retry(task.id, this.retryPolicy.delayFor(task, error), serialized);
      } else {
        this.queue.fail(task.id, serialized);
      }
      this.logger.error?.({ err: error, taskId: task.id, keyID: key.keyID }, "Task execution failed");
    } finally {
      // 无论成功、失败还是超时，都必须归还同一个 keyID；遗漏会永久吞掉一个并发槽位。
      this.keyManager.release(key.keyID);
    }
  }
}
