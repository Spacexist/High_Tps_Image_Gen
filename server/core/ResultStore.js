// 内存结果仓库。
export class ResultStore {
  constructor({ resultTtlMs = 30 * 60_000, deleteAfterRead = true } = {}) {
    this.resultTtlMs = resultTtlMs;
    this.deleteAfterRead = deleteAfterRead;
    this.results = new Map();
    this.cleanupTimer = setInterval(() => this.cleanup(), Math.min(resultTtlMs, 60_000));
    this.cleanupTimer.unref?.();
  }

  // 图片结果只驻留内存；进程重启或 TTL 到期后自然消失，不写入磁盘。
  set(taskId, value) {
    this.results.set(taskId, { value: structuredClone(value), expiresAt: Date.now() + this.resultTtlMs });
  }

  get(taskId) {
    const entry = this.results.get(taskId);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.results.delete(taskId);
      return null;
    }
    const value = structuredClone(entry.value);
    if (this.deleteAfterRead) this.results.delete(taskId);
    return value;
  }

  has(taskId) {
    const entry = this.results.get(taskId);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.results.delete(taskId);
      return false;
    }
    return true;
  }

  delete(taskId) {
    return this.results.delete(taskId);
  }

  cleanup(now = Date.now()) {
    for (const [id, entry] of this.results) if (entry.expiresAt <= now) this.results.delete(id);
  }

  stop() {
    clearInterval(this.cleanupTimer);
    this.results.clear();
  }
}
