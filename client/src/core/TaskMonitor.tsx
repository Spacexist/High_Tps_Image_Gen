import type { CoreTaskItem, QueueSnapshot } from "./types";

interface Props {
  snapshot?: QueueSnapshot;
  busyTaskId: string;
  onCancel: (task: CoreTaskItem) => Promise<void>;
}

function time(value: string | null) {
  return value ? new Date(value).toLocaleTimeString("zh-CN", { hour12: false }) : "—";
}

function QueueTable({
  title,
  eyebrow,
  tasks,
  limit,
  cancellable,
  busyTaskId,
  onCancel,
}: {
  title: string;
  eyebrow: string;
  tasks: CoreTaskItem[];
  limit: number;
  cancellable: boolean;
  busyTaskId: string;
  onCancel: (task: CoreTaskItem) => Promise<void>;
}) {
  return (
    <section className="core-section task-monitor">
      <div className="section-heading">
        <div><span>{eyebrow}</span><h2>{title}</h2></div>
        <small>LIVE {tasks.length}/{limit}</small>
      </div>
      {!tasks.length ? (
        <div className="core-empty">{title}当前为空。</div>
      ) : (
        <div className="task-table">
          <div className="task-table__row task-table__head">
            <span>UPDATED</span><span>STATUS</span><span>TASK / IMAGE</span>
            <span>MODEL</span><span>KEY ID</span><span />
          </div>
          {tasks.map((task) => (
            <div className="task-table__row" key={task.id}>
              <code>{time(task.updatedAt)}</code>
              <span className={`status status--${task.status}`}>{task.status.toUpperCase()}</span>
              <div className="task-identity">
                <code title={task.id}>{task.id}</code>
                <small>
                  {task.input.blockId && task.input.imageId
                    ? `${task.input.blockId}/${task.input.imageId}`
                    : task.input.prompt}
                </small>
              </div>
              <code>{task.input.model}</code>
              <code title={task.keyID || ""}>{task.keyID || "WAITING"}</code>
              {cancellable ? (
                <button
                  className="button button--small"
                  disabled={busyTaskId === task.id}
                  onClick={() => void onCancel(task)}
                >
                  取消
                </button>
              ) : <span className="queue-live-dot">EXECUTING</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function TaskMonitor({ snapshot, busyTaskId, onCancel }: Props) {
  return (
    <div className="live-queue-panels">
      <QueueTable
        title="execution_pool"
        eyebrow="CORE EXECUTION POOL"
        tasks={snapshot?.executing ?? []}
        limit={snapshot?.capacity.executionPoolLimit ?? 0}
        cancellable={false}
        busyTaskId={busyTaskId}
        onCancel={onCancel}
      />
      <QueueTable
        title="排队队列"
        eyebrow="CORE WAITING QUEUE"
        tasks={snapshot?.waiting ?? []}
        limit={snapshot?.capacity.waitingLimit ?? 0}
        cancellable
        busyTaskId={busyTaskId}
        onCancel={onCancel}
      />
    </div>
  );
}
