import { useEffect, useState } from "react";
import type { QueueStats } from "./types";
import "./queue-control.css";

interface Props {
  queue?: QueueStats;
  busy: boolean;
  onResize: (maxPending: number) => Promise<void>;
}

export function QueueControl({ queue, busy, onResize }: Props) {
  const [value, setValue] = useState(queue?.maxPending ?? 1);

  useEffect(() => {
    if (queue) setValue(queue.maxPending);
  }, [queue?.maxPending]);

  const valid = Number.isInteger(value) && value >= 1 && value <= 1_000_000;
  return (
    <section className="core-section queue-control">
      <div className="section-heading">
        <div><span>WAITING QUEUE CAPACITY</span><h2>动态扩缩容</h2></div>
        <small>POOL BY KEY COPIES · QUEUE BY CONFIG</small>
      </div>
      <div className="queue-capacity-grid">
        <div><span>EXECUTING</span><strong>{queue ? `${queue.executing}/${queue.executionPoolLimit}` : "—"}</strong></div>
        <div><span>WAITING</span><strong>{queue ? `${queue.waiting}/${queue.waitingLimit}` : "—"}</strong></div>
        <div><span>POOL CAPACITY</span><strong>{queue?.executionPoolLimit ?? "—"}</strong></div>
        <div className={queue?.overCapacity ? "is-over" : ""}>
          <span>OVER CAPACITY</span><strong>{queue?.overCapacity ?? "—"}</strong>
        </div>
      </div>
      <form
        className="queue-resize-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) void onResize(value);
        }}
      >
        <label>
          <span>waiting_queue 容量</span>
          <input
            type="number"
            min={1}
            max={1_000_000}
            step={1}
            value={value}
            onChange={(event) => setValue(Number(event.target.value))}
          />
        </label>
        <button className="button button--primary" disabled={busy || !valid || value === queue?.maxPending}>
          {busy ? "调整中…" : "应用容量"}
        </button>
      </form>
      <p className="queue-resize-note">
        execution_pool 由健康 Key 副本数动态决定并直接吃满；这里只调整 waiting_queue，队列满后新请求返回 503 系统繁忙。
      </p>
    </section>
  );
}
