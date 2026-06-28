import type { CoreTaskItem } from "./types";

interface Props {
  tasks: CoreTaskItem[];
  total: number;
  busyTaskId: string;
  onCancel: (task: CoreTaskItem) => Promise<void>;
}

function time(value: string | null) {
  return value ? new Date(value).toLocaleTimeString("zh-CN", { hour12: false }) : "—";
}

export function TaskMonitor({ tasks, total, busyTaskId, onCancel }: Props) {
  return (
    <section className="core-section task-monitor">
      <div className="section-heading">
        <div><span>CORE TASK QUEUE</span><h2>任务流</h2></div>
        <small>{total} TASKS · LATEST {tasks.length}</small>
      </div>
      {!tasks.length ? (
        <div className="core-empty">Core 队列为空。工作台提交任务后会实时出现在这里。</div>
      ) : (
        <div className="task-table">
          <div className="task-table__row task-table__head">
            <span>UPDATED</span><span>STATUS</span><span>TASK / IMAGE</span><span>MODEL</span><span>KEY ID</span><span>ATTEMPT</span><span />
          </div>
          {tasks.map((task) => (
            <div className="task-table__row" key={task.id}>
              <code>{time(task.updatedAt)}</code>
              <span className={`status status--${task.status}`}>{task.status.toUpperCase()}</span>
              <div className="task-identity">
                <code title={task.id}>{task.id}</code>
                <small>{task.input.blockId && task.input.imageId ? `${task.input.blockId}/${task.input.imageId}` : task.input.prompt}</small>
              </div>
              <code>{task.input.model}</code>
              <code title={task.keyID || ""}>{task.keyID || "WAITING"}</code>
              <code>{task.attempts}{task.nextAttemptAt ? ` · ${time(task.nextAttemptAt)}` : ""}</code>
              <button className="button button--small" disabled={busyTaskId === task.id || !["pending", "retry_wait"].includes(task.status)} onClick={() => void onCancel(task)}>取消</button>
              {task.error && <small className="task-error">{task.error.code || "ERROR"} · {task.error.message}</small>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
