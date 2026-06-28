import { useCallback, useEffect, useRef, useState } from "react";
import type { RuntimeConfig } from "../models";
import { apiJson } from "../request/api";
import { KeyCard } from "./KeyCard";
import { KeyForm } from "./KeyForm";
import { PoolMap } from "./PoolMap";
import { QueueControl } from "./QueueControl";
import { TaskMonitor } from "./TaskMonitor";
import type {
  CoreEvent,
  CoreStatus,
  CoreTaskItem,
  CreateKeyInput,
  KeysResponse,
  KeySource,
  PoolSnapshot,
  TasksResponse,
} from "./types";

interface Props {
  config: RuntimeConfig;
}

const emptyPool: PoolSnapshot = { items: [], total: 0, truncated: false, limit: 500 };

function clock() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function taskLevel(status: string): CoreEvent["level"] {
  if (status === "completed") return "success";
  if (status === "failed" || status === "cancelled") return "error";
  return "info";
}

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
  const [tasks, setTasks] = useState<TasksResponse>({
    items: [],
    page: 1,
    limit: 100,
    total: 0,
  });
  const [events, setEvents] = useState<CoreEvent[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const knownTasks = useRef(new Map<string, string>());

  function addEvent(event: Omit<CoreEvent, "id" | "time">) {
    setEvents((current) => [{
      ...event,
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: clock(),
    }, ...current].slice(0, 120));
  }

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextKeys, nextPool, nextTasks] = await Promise.all([
        apiJson<CoreStatus>("/api/status"),
        apiJson<KeysResponse>("/api/keys"),
        apiJson<PoolSnapshot>("/api/keys/pool?limit=500"),
        apiJson<TasksResponse>("/api/tasks?page=1&limit=100"),
      ]);
      setStatus(nextStatus);
      setKeys(nextKeys);
      setPool(nextPool);
      setTasks(nextTasks);
      setError("");

      // 轮询只在任务状态变化时写事件，避免产生重复噪声。
      const changes: CoreEvent[] = [];
      for (const task of nextTasks.items) {
        const previous = knownTasks.current.get(task.id);
        if (previous !== task.status) {
          knownTasks.current.set(task.id, task.status);
          changes.push({
            id: `${task.id}-${task.status}-${task.updatedAt}`,
            time: new Date(task.updatedAt).toLocaleTimeString("zh-CN", { hour12: false }),
            type: "TASK",
            subject: task.input.imageId || task.id,
            event: task.status.toUpperCase(),
            detail: `${task.input.model} · ${task.keyID || "等待 Key"} · 单次执行`,
            level: taskLevel(task.status),
          });
        }
      }
      if (changes.length) setEvents((current) => [...changes, ...current].slice(0, 120));
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function action(
    name: string,
    work: () => Promise<unknown>,
    event: Omit<CoreEvent, "id" | "time">,
  ) {
    setBusy(name);
    try {
      await work();
      addEvent(event);
      await refresh();
    } catch (reason) {
      const message = (reason as Error).message;
      setError(message);
      addEvent({ ...event, event: `${event.event}_FAILED`, detail: message, level: "error" });
      throw reason;
    } finally {
      setBusy("");
    }
  }

  async function createKey(input: CreateKeyInput) {
    await action(
      "create",
      () => apiJson("/api/keys", { method: "POST", body: JSON.stringify(input) }),
      {
        type: "KEY",
        subject: input.id || input.name,
        event: "REGISTERED",
        detail: `concurrency=${input.concurrency} · ${input.models.join(", ")}`,
        level: "success",
      },
    );
  }

  async function updateConcurrency(source: KeySource, concurrency: number) {
    await action(
      `update:${source.id}`,
      () => apiJson(`/api/keys/${encodeURIComponent(source.id)}`, {
        method: "PUT",
        body: JSON.stringify({ concurrency }),
      }),
      {
        type: "KEY",
        subject: source.id,
        event: "POOL_REBUILT",
        detail: `${source.concurrency} → ${concurrency} copies`,
        level: "success",
      },
    );
  }

  async function toggleKey(source: KeySource) {
    await action(
      `toggle:${source.id}`,
      () => apiJson(`/api/keys/${encodeURIComponent(source.id)}/toggle`, { method: "POST" }),
      {
        type: "KEY",
        subject: source.id,
        event: source.enabled ? "DISABLED" : "ENABLED",
        detail: "KeyPool 已按新状态重建",
        level: "warning",
      },
    );
  }

  async function healthTest(source: KeySource) {
    await action(
      `health:${source.id}`,
      () => apiJson(`/api/keys/${encodeURIComponent(source.id)}/health-test`, { method: "POST" }),
      {
        type: "KEY",
        subject: source.id,
        event: "HEALTH_TEST",
        detail: `GET ${source.baseUrl}`,
        level: "info",
      },
    );
  }

  async function deleteKey(source: KeySource) {
    if (!window.confirm(`确定删除 Key「${source.name}」及其全部空闲副本吗？`)) return;
    await action(
      `delete:${source.id}`,
      () => apiJson(`/api/keys/${encodeURIComponent(source.id)}`, { method: "DELETE" }),
      {
        type: "KEY",
        subject: source.id,
        event: "DELETED",
        detail: "原始 Key 与 KeyPool 副本已删除",
        level: "error",
      },
    );
  }

  async function healthTestAll() {
    await action(
      "health:all",
      () => apiJson("/api/keys/health-test", { method: "POST" }),
      {
        type: "SYSTEM",
        subject: "KEYPOOL",
        event: "HEALTH_TEST_ALL",
        detail: `${keys.items.filter((item) => item.enabled).length} 个不重复原始 Key`,
        level: "info",
      },
    );
  }

  async function resizeQueue(maxPending: number) {
    const previous = status?.queue.maxPending ?? 0;
    await action(
      "queue:resize",
      () => apiJson("/api/queue", {
        method: "PATCH",
        body: JSON.stringify({ maxPending }),
      }),
      {
        type: "SYSTEM",
        subject: "QUEUE",
        event: "RESIZED",
        detail: `${previous} → ${maxPending} pending slots`,
        level: "success",
      },
    );
  }

  async function cancelTask(task: CoreTaskItem) {
    await action(
      `task:${task.id}`,
      () => apiJson(`/api/tasks/${task.id}`, { method: "DELETE" }),
      {
        type: "TASK",
        subject: task.input.imageId || task.id,
        event: "CANCELLED",
        detail: task.id,
        level: "warning",
      },
    );
  }

  const queue = status?.queue.byStatus;
  const diagnosis = status?.diagnostics;

  return (
    <main className="core-dashboard">
      <header className="hero core-hero">
        <div>
          <span className="eyebrow">CORE / QUEUE / PHYSICAL KEYPOOL</span>
          <h1>Core Control</h1>
          <p>Core 只负责排队和单次派发；任务租用唯一 keyID，终态后立即归还副本。</p>
        </div>
        <div className={`core-live ${error ? "core-live--error" : ""}`}>
          <span className="pulse" />
          {error ? "CONNECTION ERROR" : "LIVE · 1.5s"}
        </div>
      </header>

      {error && (
        <div className="system-alert"><strong>ADMIN UI ERROR</strong><span>{error}</span></div>
      )}

      <section className="core-overview">
        <div>
          <span>QUEUE</span>
          <strong>{status ? `${status.queue.waiting}/${status.queue.maxPending}` : "—"}</strong>
          <small>WAITING / LIMIT</small>
        </div>
        <div><span>IN FLIGHT</span><strong>{status?.dispatcher.inFlight ?? "—"}</strong><small>RUNNING</small></div>
        <div><span>TPS LIMIT</span><strong>{status?.dispatcher.dispatchRatePerSecond ?? "—"}</strong><small>TOKEN BUCKET</small></div>
        <div><span>KEY SOURCES</span><strong>{keys.stats.healthySources}/{keys.stats.sources}</strong><small>HEALTHY</small></div>
        <div><span>KEY COPIES</span><strong>{keys.stats.available}/{keys.stats.total}</strong><small>AVAILABLE</small></div>
      </section>

      <section className="core-flow">
        <div className="flow-node">
          <span>01</span><strong>QUEUE</strong>
          <small>{queue?.pending ?? 0} pending · {status?.queue.remainingCapacity ?? 0} slots free</small>
        </div>
        <i>→</i>
        <div className="flow-node"><span>02</span><strong>DISPATCHER</strong><small>{status?.dispatcher.tokens ?? 0} tokens · {status?.dispatcher.inFlight ?? 0} active</small></div>
        <i>→</i>
        <div className="flow-node"><span>03</span><strong>KEYPOOL</strong><small>{keys.stats.available} free · {keys.stats.leased} leased</small></div>
        <i>→</i>
        <div className="flow-node"><span>04</span><strong>UPSTREAM</strong><small>{config.ui.default_model} · one shot</small></div>
      </section>

      <div className={`core-diagnosis core-diagnosis--${diagnosis?.severity || "ok"}`}>
        <span>{diagnosis?.code || "CONNECTING"}</span>
        <p>{diagnosis?.message || "正在读取 Core 运行状态…"}</p>
      </div>

      <QueueControl
        queue={status?.queue}
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
        tasks={tasks.items}
        total={tasks.total}
        busyTaskId={busy.replace("task:", "")}
        onCancel={cancelTask}
      />

      <section className="core-section core-event-log">
        <div className="section-heading">
          <div><span>CORE EVENT LOG</span><h2>状态变化</h2></div>
          <button className="button button--ghost" onClick={() => setEvents([])}>清空</button>
        </div>
        <div className="core-log-table">
          <div className="core-log-row core-log-head">
            <span>TIME</span><span>TYPE</span><span>SUBJECT</span><span>EVENT</span><span>DETAIL</span>
          </div>
          {events.map((event) => (
            <div className={`core-log-row core-log-row--${event.level}`} key={event.id}>
              <code>{event.time}</code><code>{event.type}</code><code>{event.subject}</code><code>{event.event}</code><code>{event.detail}</code>
            </div>
          ))}
          {!events.length && (
            <div className="core-empty core-empty--small">等待 Key 或 Task 状态变化…</div>
          )}
        </div>
      </section>
    </main>
  );
}
