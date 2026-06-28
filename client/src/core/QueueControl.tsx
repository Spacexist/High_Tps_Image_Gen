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
        <div><span>RUNTIME QUEUE CAPACITY</span><h2>动态扩缩容</h2></div>
        <small>RESTART → CONFIG.JSON</small>
      </div>
      <div className="queue-capacity-grid">
        <div><span>WAITING</span><strong>{queue?.waiting ?? "—"}</strong></div>
        <div><span>MAX PENDING</span><strong>{queue?.maxPending ?? "—"}</strong></div>
        <div><span>REMAINING</span><strong>{queue?.remainingCapacity ?? "—"}</strong></div>
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
          <span>新的 maxPending</span>
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
        缩容不会删除现有任务；若等待数高于新上限，Core 会暂停接收新任务，直到队列回落。
      </p>
    </section>
  );
}
