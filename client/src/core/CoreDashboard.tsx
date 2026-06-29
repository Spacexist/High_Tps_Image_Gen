import { useCallback, useEffect, useState } from "react";
import type { RuntimeConfig } from "../models";
import { apiJson } from "../request/api";
import { KeyCard } from "./KeyCard";
import { KeyForm } from "./KeyForm";
import { PoolMap } from "./PoolMap";
import { QueueControl } from "./QueueControl";
import { QueueLog } from "./QueueLog";
import { TaskMonitor } from "./TaskMonitor";
import type {
  CoreStatus,
  CoreTaskItem,
  CreateKeyInput,
  KeysResponse,
  KeySource,
  PoolSnapshot,
  QueueEventsResponse,
  QueueSnapshot,
} from "./types";

interface Props {
  config: RuntimeConfig;
}

const emptyPool: PoolSnapshot = { items: [], total: 0, truncated: false, limit: 500 };
const emptyEvents: QueueEventsResponse = {
  items: [],
  total: 0,
  limit: 300,
  updatedAt: "",
};

export function CoreDashboard({ config }: Props) {
  const [status, setStatus] = useState<CoreStatus>();
  const [keys, setKeys] = useState<KeysResponse>({
    items: [],
    stats: {
      sources: 0,
      healthySources: 0,
      available: 0,
      leased: 0,
      total: 0,
      bySource: {},
    },
  });
  const [pool, setPool] = useState<PoolSnapshot>(emptyPool);
  const [queueSnapshot, setQueueSnapshot] = useState<QueueSnapshot>();
  const [queueEvents, setQueueEvents] = useState<QueueEventsResponse>(emptyEvents);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      // 活动 Queue 与追加式事件流分别读取；事件不会被 Task 的最终状态覆盖。
      const [nextStatus, nextKeys, nextPool, nextQueue, nextEvents] = await Promise.all([
        apiJson<CoreStatus>("/api/status"),
        apiJson<KeysResponse>("/api/keys"),
        apiJson<PoolSnapshot>("/api/keys/pool?limit=500"),
        apiJson<QueueSnapshot>("/api/queue/tasks"),
        apiJson<QueueEventsResponse>("/api/queue/events?limit=300"),
      ]);
      setStatus(nextStatus);
      setKeys(nextKeys);
      setPool(nextPool);
      setQueueSnapshot(nextQueue);
      setQueueEvents(nextEvents);
      setError("");
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Core 管理界面每秒同步 execution_pool、waiting_queue 和后端事件流。
    const timer = window.setInterval(() => void refresh(), 1_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function action(name: string, work: () => Promise<unknown>) {
    setBusy(name);
    try {
      await work();
      await refresh();
    } catch (reason) {
      setError((reason as Error).message);
      throw reason;
    } finally {
      setBusy("");
    }
  }

  async function createKey(input: CreateKeyInput) {
    await action("create", () => apiJson("/api/keys", {
      method: "POST",
      body: JSON.stringify(input),
    }));
  }

  async function updateConcurrency(source: KeySource, concurrency: number) {
    await action(`update:${source.id}`, () => apiJson(`/api/keys/${encodeURIComponent(source.id)}`, {
      method: "PUT",
      body: JSON.stringify({ concurrency }),
    }));
  }

  async function toggleKey(source: KeySource) {
    await action(
      `toggle:${source.id}`,
      () => apiJson(`/api/keys/${encodeURIComponent(source.id)}/toggle`, { method: "POST" }),
    );
  }

  async function healthTest(source: KeySource) {
    await action(
      `health:${source.id}`,
      () => apiJson(`/api/keys/${encodeURIComponent(source.id)}/health-test`, { method: "POST" }),
    );
  }

  async function deleteKey(source: KeySource) {
    if (!window.confirm(`确定删除 Key「${source.name}」及其全部空闲副本吗？`)) return;
    await action(
      `delete:${source.id}`,
      () => apiJson(`/api/keys/${encodeURIComponent(source.id)}`, { method: "DELETE" }),
    );
  }

  async function healthTestAll() {
    await action("health:all", () => apiJson("/api/keys/health-test", { method: "POST" }));
  }

  async function resizeQueue(maxPending: number) {
    await action("queue:resize", () => apiJson("/api/queue", {
      method: "PATCH",
      body: JSON.stringify({ maxPending }),
    }));
  }

  async function cancelTask(task: CoreTaskItem) {
    await action(
      `task:${task.id}`,
      () => apiJson(`/api/tasks/${task.id}`, { method: "DELETE" }),
    );
  }

  const queue = status?.queue;
  const diagnosis = status?.diagnostics;

  return (
    <main className="core-dashboard">
      <header className="hero core-hero">
        <div>
          <span className="eyebrow">CORE / EXECUTION POOL / WAITING QUEUE</span>
          <h1>Core Control</h1>
          <p>Core 只负责等待与单次派发；execution_pool 直接使用全部可用 Key 副本。</p>
        </div>
        <div className={`core-live ${error ? "core-live--error" : ""}`}>
          <span className="pulse" />
          {error ? "CONNECTION ERROR" : "LIVE · 1s"}
        </div>
      </header>

      {error && (
        <div className="system-alert"><strong>ADMIN UI ERROR</strong><span>{error}</span></div>
      )}

      <section className="core-overview">
        <div>
          <span>EXECUTING</span>
          <strong>{queue ? `${queue.executing}/${queue.executionPoolLimit}` : "—"}</strong>
          <small>ACTIVE / KEY COPIES</small>
        </div>
        <div>
          <span>WAITING</span>
          <strong>{queue ? `${queue.waiting}/${queue.waitingLimit}` : "—"}</strong>
          <small>QUEUED / LIMIT</small>
        </div>
        <div><span>QUEUE SPACE</span><strong>{queue ? `${queue.remainingCapacity}/${queue.waitingLimit}` : "—"}</strong><small>AVAILABLE / LIMIT</small></div>
        <div><span>KEY SOURCES</span><strong>{keys.stats.healthySources}/{keys.stats.sources}</strong><small>HEALTHY</small></div>
        <div><span>KEY COPIES</span><strong>{keys.stats.available}/{keys.stats.total}</strong><small>AVAILABLE</small></div>
      </section>

      <section className="core-flow">
        <div className="flow-node">
          <span>01</span><strong>WAITING_QUEUE</strong>
          <small>{queue?.waiting ?? 0}/{queue?.waitingLimit ?? 0} queued</small>
        </div>
        <i>→</i>
        <div className="flow-node">
          <span>02</span><strong>EXECUTION_POOL</strong>
          <small>{queue?.executing ?? 0}/{queue?.executionPoolLimit ?? 0} active</small>
        </div>
        <i>→</i>
        <div className="flow-node"><span>03</span><strong>UPSTREAM</strong><small>{config.ui.default_model} · one shot</small></div>
      </section>

      <div className={`core-diagnosis core-diagnosis--${diagnosis?.severity || "ok"}`}>
        <span>{diagnosis?.code || "CONNECTING"}</span>
        <p>{diagnosis?.message || "正在读取 Core 运行状态…"}</p>
      </div>

      <QueueControl
        queue={queue}
        busy={busy === "queue:resize"}
        onResize={resizeQueue}
      />

      <div className="core-columns">
        <KeyForm defaultModel={config.ui.default_model} busy={busy === "create"} onSubmit={createKey} />
        <section className="core-section key-sources">
          <div className="section-heading">
            <div><span>SOURCE KEYS</span><h2>原始 Key</h2></div>
            <button
              className="button button--ghost"
              disabled={!!busy || !keys.items.length}
              onClick={() => void healthTestAll()}
            >
              轮询健康检查
            </button>
          </div>
          {!keys.items.length ? (
            <div className="core-empty">当前没有注册 Key，Core 无法派发图片任务。</div>
          ) : (
            <div className="key-source-list">
              {keys.items.map((source) => (
                <KeyCard
                  key={source.id}
                  source={source}
                  busy={busy.includes(source.id)}
                  onConcurrency={updateConcurrency}
                  onToggle={toggleKey}
                  onHealthTest={healthTest}
                  onDelete={deleteKey}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <PoolMap sources={keys.items} snapshot={pool} />
      <TaskMonitor
        snapshot={queueSnapshot}
        busyTaskId={busy.replace("task:", "")}
        onCancel={cancelTask}
      />
      <QueueLog
        events={queueEvents.items}
        total={queueEvents.total}
        updatedAt={queueEvents.updatedAt}
      />
    </main>
  );
}
