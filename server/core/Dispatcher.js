// TPS 令牌桶调度器。
import { EventEmitter } from "node:events";

export class Dispatcher extends EventEmitter {
  constructor({ queue, keyManager, runner, dispatchRatePerSecond = 300 } = {}) {
    super();
    this.queue = queue;
    this.keyManager = keyManager;
    this.runner = runner;
    this.rate = dispatchRatePerSecond;
    this.capacity = Math.max(1, dispatchRatePerSecond);
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
    this.inFlight = 0;
    this.running = false;
    this.scheduled = false;
    this.timer = null;
    this.wake = () => this.schedule();
  }

  start() {
    if (this.running) return;
    this.running = true;
    // 使用事件唤醒，避免固定 50ms 轮询在高 TPS 下制造无谓延迟与 CPU 消耗。
    this.queue.on("pending", this.wake);
    this.keyManager.on("available", this.wake);
    this.schedule();
  }

  schedule(delayMs = 0) {
    if (!this.running || this.scheduled) return;
    this.scheduled = true;
    this.timer = setTimeout(() => {
      this.scheduled = false;
      this.drain();
    }, delayMs);
    this.timer.unref?.();
  }

  refill() {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1_000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.rate);
    this.lastRefill = now;
  }

  drain() {
    if (!this.running) return;
    this.refill();
    let dispatched = 0;

    while (this.tokens >= 1) {
      const claimed = this.queue.claimFirst((task) => this.keyManager.acquire({ model: task.input.model }));
      if (!claimed) break;
      this.tokens -= 1;
      dispatched += 1;
      this.inFlight += 1;
      // 不等待单个下游请求，KeyPool 的物理副本数量自然形成并发上限。
      void this.runner.run(claimed.task, claimed.resource).finally(() => {
        this.inFlight -= 1;
        this.emit("settled");
        this.schedule();
      });
    }

    if (this.queue.waitingCount() > 0 && this.keyManager.getStats().available > 0 && this.tokens < 1) {
      const waitMs = Math.max(1, Math.ceil(((1 - this.tokens) / this.rate) * 1_000));
      this.schedule(waitMs);
    }
    if (dispatched > 0) this.emit("dispatched", dispatched);
  }

  stats() {
    return { inFlight: this.inFlight, dispatchRatePerSecond: this.rate, tokens: Math.floor(this.tokens) };
  }

  stop() {
    this.running = false;
    this.queue.off("pending", this.wake);
    this.keyManager.off("available", this.wake);
    if (this.timer) clearTimeout(this.timer);
  }
}
