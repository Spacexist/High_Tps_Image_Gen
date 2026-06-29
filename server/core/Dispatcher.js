// 事件驱动调度器：execution_pool 的并发上限完全由 KeyPool 物理副本决定。
import { EventEmitter } from "node:events";

export class Dispatcher extends EventEmitter {
  constructor({ queue, keyManager, runner, logger = console } = {}) {
    super();
    this.queue = queue;
    this.keyManager = keyManager;
    this.runner = runner;
    this.logger = logger;
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
    this.logger.info?.({ event: "dispatcher.started" }, "Dispatcher started");
    this.schedule();
  }

  schedule() {
    if (!this.running || this.scheduled) return;
    this.scheduled = true;
    this.timer = setTimeout(() => {
      this.scheduled = false;
      this.drain();
    }, 0);
    this.timer.unref?.();
  }

  drain() {
    if (!this.running) return;
    let dispatched = 0;

    // 一次 drain 会持续租用副本，直到 waiting_queue 为空或 KeyPool 没有匹配副本。
    while (true) {
      const claimed = this.queue.claimFirst((task) => this.keyManager.acquire({ model: task.input.model }));
      if (!claimed) break;
      dispatched += 1;
      this.inFlight += 1;
      this.logger.debug?.({
        event: "task.dispatched",
        taskId: claimed.task.id,
        model: claimed.task.input.model,
        keyID: claimed.resource.keyID,
        inFlight: this.inFlight,
      }, "Task dispatched");
      // 不等待单个下游请求，KeyPool 的物理副本数量自然形成并发上限。
      void this.runner.run(claimed.task, claimed.resource).finally(() => {
        this.inFlight -= 1;
        this.emit("settled");
        this.schedule();
      });
    }

    if (dispatched > 0) this.emit("dispatched", dispatched);
  }

  stats() {
    return { inFlight: this.inFlight };
  }

  stop() {
    this.running = false;
    this.queue.off("pending", this.wake);
    this.keyManager.off("available", this.wake);
    if (this.timer) clearTimeout(this.timer);
    this.logger.info?.({ event: "dispatcher.stopped", inFlight: this.inFlight }, "Dispatcher stopped");
  }
}
