// Core 重试策略；Key 模块不参与业务重试。
export class RetryPolicy {
  constructor({ maxAttempts = 3, baseDelayMs = 1_000, maxDelayMs = 30_000 } = {}) {
    this.maxAttempts = maxAttempts;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
  }

  shouldRetry(task, error) {
    // attempts 包含刚刚失败的这一次，因此 maxAttempts 表示总尝试次数而非额外重试次数。
    return Boolean(error?.retryable) && task.attempts < this.maxAttempts;
  }

  delayFor(task, error) {
    if (Number.isFinite(error?.retryAfterMs) && error.retryAfterMs >= 0) {
      return Math.min(error.retryAfterMs, this.maxDelayMs);
    }
    const exponential = this.baseDelayMs * (2 ** Math.max(0, task.attempts - 1));
    return Math.min(exponential, this.maxDelayMs);
  }
}
