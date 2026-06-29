import type { QueueEvent } from "./types";
import "./queue-log.css";

interface Props {
  events: QueueEvent[];
  total: number;
  updatedAt?: string;
}

function time(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleTimeString("zh-CN", { hour12: false })
    : "—";
}

function blockImage(event: QueueEvent) {
  if (event.blockId && event.imageId) return `${event.blockId}/${event.imageId}`;
  if (event.blockId) return event.blockId;
  return "DIRECT";
}

function logPayload(event: QueueEvent) {
  return {
    eventId: event.id,
    timestamp: event.timestamp,
    event: event.event,
    task: {
      id: event.taskId,
      status: event.status,
      blockId: event.blockId,
      imageId: event.imageId,
      keyID: event.keyID,
    },
    backendDetail: event.payload,
    queueSnapshotAtEvent: event.queue,
  };
}

export function QueueLog({ events, total, updatedAt }: Props) {
  return (
    <section className="core-section core-event-log">
      <div className="section-heading">
        <div>
          <span>QUEUE EVENT LOG</span>
          <h2>后端队列日志</h2>
        </div>
        <small>{total} EVENTS · UPDATED {time(updatedAt)}</small>
      </div>

      {!events.length ? (
        <div className="core-empty core-empty--small">还没有 Queue 生命周期事件。</div>
      ) : (
        <div className="core-log-table">
          <div className="core-log-row core-log-head">
            <code>TIME</code>
            <code>EVENT</code>
            <code>TASK ID</code>
            <code>BLOCK / IMAGE</code>
            <code>DETAIL（点击行展开 Request / Response）</code>
          </div>
          {events.map((event) => (
            <details
              className={`core-queue-log-entry core-log-row--${event.level}`}
              key={event.id}
            >
              <summary className="core-log-row">
                <code>{time(event.timestamp)}</code>
                <code>{event.event}</code>
                <code title={event.taskId ?? event.id}>{event.taskId ?? "CORE"}</code>
                <code>{blockImage(event)}</code>
                <code title={event.detail}>{event.detail}</code>
              </summary>
              <div className="core-queue-log-entry__payload">
                <span>BACKEND EVENT / REQUEST / RESPONSE / QUEUE SNAPSHOT</span>
                <pre>{JSON.stringify(logPayload(event), null, 2)}</pre>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
