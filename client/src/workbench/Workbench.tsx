import { useEffect, useMemo, useRef, useState } from "react";
import type { CoreTask, RuntimeConfig, WorkbenchSnapshot } from "../models";
import type { BlockLogEntry, SystemStatus } from "../runtime";
import { loadJsonFile } from "../load/loadJson";
import { cacheInputs } from "../load/cacheInputs";
import { apiJson } from "../request/api";
import { buildTaskQueue, type QueueItem } from "../request/taskQueue";
import { submitTask, type SubmitTaskInput } from "../request/taskRequest";
import { pollTask } from "../request/taskPolling";
import { BlockCard } from "./BlockCard";
import { BlockRuntimeLog } from "./BlockRuntimeLog";

interface Props {
  config: RuntimeConfig;
  initial: WorkbenchSnapshot;
}

function now() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function levelForTask(task: CoreTask): BlockLogEntry["level"] {
  if (task.status === "completed") return "success";
  if (task.status === "failed" || task.status === "cancelled") return "error";
  return "info";
}

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);

export function Workbench({ config, initial }: Props) {
  const [snapshot, setSnapshot] = useState(initial);
  const [running, setRunning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>();
  const [logs, setLogs] = useState<string[]>(["工作台已连接，本地缓存已恢复。"]);
  const [blockLogs, setBlockLogs] = useState<Record<string, BlockLogEntry[]>>({});
  const stopRequested = useRef(false);
  const runLock = useRef(false);
  const lastTaskStatus = useRef(new Map<string, string>());
  const loggedTraceParts = useRef(new Set<string>());

  const images = snapshot.blocks.flatMap((block) => block.images);
  const completed = images.filter((image) => image.state.status === "completed").length;
  const progress = images.length ? Math.round((completed / images.length) * 100) : 0;
  const queue = useMemo(() => buildTaskQueue(snapshot.blocks), [snapshot.blocks]);
  const keysMissing = systemStatus?.keys.total === 0;

  function log(message: string) {
    setLogs((current) => [`${now()}  ${message}`, ...current].slice(0, 80));
  }

  function blockLog(blockId: string, entry: Omit<BlockLogEntry, "id" | "time">) {
    const item: BlockLogEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: now(),
    };
    setBlockLogs((current) => ({
      ...current,
      [blockId]: [item, ...(current[blockId] || [])].slice(0, 100),
    }));
  }

  async function refresh() {
    setSnapshot(await apiJson<WorkbenchSnapshot>("/api/workbench"));
  }

  async function refreshStatus() {
    try {
      setSystemStatus(await apiJson<SystemStatus>("/api/status"));
    } catch {
      setSystemStatus(undefined);
    }
  }

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => {
      void refreshStatus();
      void refresh();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, []);

  function appendTraceLogs(blockId: string, imageId: string, task: CoreTask) {
    const requestMarker = `${task.id}:request`;
    if (task.trace?.request && !loggedTraceParts.current.has(requestMarker)) {
      loggedTraceParts.current.add(requestMarker);
      blockLog(blockId, {
        imageId,
        event: "UPSTREAM_REQUEST",
        taskId: task.id,
        status: task.status,
        level: "info",
        message: `Core 已租用 ${task.keyID || "未知 keyID"} 并发出一次上游请求。`,
        details: [{ label: "实际发送的请求结构（认证信息已打码）", value: task.trace.request }],
      });
    }

    const responseMarker = `${task.id}:response`;
    if (task.trace?.response && !loggedTraceParts.current.has(responseMarker)) {
      loggedTraceParts.current.add(responseMarker);
      blockLog(blockId, {
        imageId,
        event: task.status === "failed" ? "UPSTREAM_ERROR" : "UPSTREAM_RESPONSE",
        taskId: task.id,
        status: task.status,
        level: task.status === "failed" ? "error" : "success",
        message: task.status === "failed"
          ? "上游请求失败；以下是状态码、错误结构及返回体。"
          : "上游请求成功；以下是状态码、响应头及返回体。",
        details: [{ label: "上游返回结构", value: task.trace.response }],
      });
    }
  }

  function patchTask(blockId: string, imageId: string, task: CoreTask) {
    appendTraceLogs(blockId, imageId, task);
    const previous = lastTaskStatus.current.get(task.id);

    // submitTask 返回的就是 POST /api/workbench/tasks 的 202 响应。
    if (!previous) {
      blockLog(blockId, {
        imageId,
        event: "CORE_ACCEPTED_RESPONSE",
        taskId: task.id,
        status: task.status,
        level: "info",
        message: `202 Accepted · Core 已创建任务 ${task.id}。`,
        details: [{
          label: "Core 202 响应结构",
          value: {
            statusCode: 202,
            endpoint: "/api/workbench/tasks",
            body: task,
          },
        }],
      });
    }

    if (previous !== task.status) {
      lastTaskStatus.current.set(task.id, task.status);
      blockLog(blockId, {
        imageId,
        event: task.status.toUpperCase(),
        taskId: task.id,
        status: task.status,
        level: levelForTask(task),
        message: task.error
          ? `${task.error.code || "ERROR"} · ${task.error.message}`
          : `Core 状态变化 ${previous || "SUBMITTED"} → ${task.status}`,
      });

      // 终态由 GET /api/tasks/:id 返回，记录与创建请求成对的最终响应。
      if (terminalStatuses.has(task.status)) {
        blockLog(blockId, {
          imageId,
          event: "CORE_FINAL_RESPONSE",
          taskId: task.id,
          status: task.status,
          level: levelForTask(task),
          message: `200 OK · Core 返回任务终态 ${task.status}。`,
          details: [{
            label: "Core 最终响应结构",
            value: {
              statusCode: 200,
              endpoint: `/api/tasks/${task.id}`,
              body: task,
            },
          }],
        });
      }
    }

    setSnapshot((current) => ({
      blocks: current.blocks.map((block) => block.blockId !== blockId ? block : ({
        ...block,
        images: block.images.map((image) => image.imageId !== imageId ? image : ({
          ...image,
          state: {
            ...image.state,
            status: task.status,
            taskId: task.id,
            error: task.error,
            updatedAt: task.updatedAt,
          },
        })),
      })),
    }));
  }

  async function runItems(items: QueueItem[]) {
    // 浏览器不再充当并发闸门：任务按 JSON 顺序全部提交到后端 waiting_queue。
    // 真正的并发量只由 execution_pool 中可租用的 Key 副本数量决定。
    if (!items.length || runLock.current) return;
    if (systemStatus?.keys.total === 0) {
      log("无法开始：KeyPool 中没有 Key。请先通过后端 /api/keys 注册 Key。");
      return;
    }

    runLock.current = true;
    setRunning(true);
    stopRequested.current = false;
    log(`开始按 FIFO 提交 ${items.length} 张图片；Core pool 容量 ${systemStatus?.queue.executionPoolLimit ?? systemStatus?.keys.total ?? 0}`);
    const observers: Promise<void>[] = [];
    let accepted = 0;

    try {
      for (const { block, image } of items) {
        if (stopRequested.current) break;
        const submitInput: SubmitTaskInput = {
          blockId: block.blockId,
          imageId: image.imageId,
          // 任务体显式携带原图 URL；后端校验后读取已落盘的同一张图。
          imageUrl: image.url,
          model: config.ui.default_model,
          prompt: image.promptOverride || block.prompt,
          size: config.ui.image_size,
        };
        blockLog(block.blockId, {
          imageId: image.imageId,
          event: "QUEUE_SUBMIT",
          level: "info",
          message: "POST /api/workbench/tasks · 提交到 Core waiting_queue。",
          details: [{
            label: "Core 请求结构",
            value: {
              method: "POST",
              endpoint: "/api/workbench/tasks",
              headers: { "content-type": "application/json" },
              body: submitInput,
            },
          }],
        });

        try {
          // 顺序等待每个 202，保证后端 waiting_queue 与 JSON 顺序一致；不等待任务执行完成。
          const created = await submitTask(submitInput);
          accepted += 1;
          patchTask(block.blockId, image.imageId, created);

          observers.push(
            pollTask(created.id, config.poll_interval_ms, (task) => (
              patchTask(block.blockId, image.imageId, task)
            )).then(async (terminalTask) => {
              log(`${block.blockId}/${image.imageId} → ${terminalTask.status}`);
              await refresh();
            }).catch((error: Error) => {
              blockLog(block.blockId, {
                imageId: image.imageId,
                event: "POLL_ERROR",
                level: "error",
                taskId: created.id,
                message: error.message,
              });
            }),
          );
        } catch (error) {
          const message = (error as Error).message;
          blockLog(block.blockId, {
            imageId: image.imageId,
            event: "QUEUE_REJECTED",
            level: "error",
            message,
            details: [{ label: "Core 拒绝响应", value: { message } }],
          });
          log(`${block.blockId}/${image.imageId} → ${message}`);
        }
      }

      log(`提交阶段结束：Core 已接收 ${accepted}/${items.length} 个任务。`);
      await Promise.all(observers);
      log(stopRequested.current ? "已停止提交；已进入 Core 的任务均已结束。" : "本轮任务处理结束。");
    } finally {
      await refresh();
      runLock.current = false;
      setRunning(false);
    }
  }

  async function handleImport(file?: File) {
    if (!file) return;
    setImporting(true);
    try {
      const blocks = await loadJsonFile(file);
      log(`正在缓存 ${blocks.length} 个 Block 的原图…`);
      setSnapshot(await cacheInputs(blocks));
      log("JSON 和原图已写入服务端本地缓存。");
    } catch (error) {
      log(`导入失败：${(error as Error).message}`);
    } finally {
      setImporting(false);
    }
  }

  async function updatePrompt(blockId: string, patch: object) {
    try {
      setSnapshot(await apiJson(`/api/workbench/blocks/${blockId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }));
      log(`${blockId} 的 Prompt 已保存`);
    } catch (error) {
      log(`保存失败：${(error as Error).message}`);
    }
  }

  async function clearCache() {
    if (!window.confirm("确定清空全部 Block、任务记录、原图和结果图吗？")) return;
    await apiJson("/api/workbench", { method: "DELETE" });
    setSnapshot({ blocks: [] });
    setBlockLogs({});
    lastTaskStatus.current.clear();
    loggedTraceParts.current.clear();
    log("本地工作台缓存已清空。");
  }

  return (
    <main>
      <header className="hero">
        <div>
          <span className="eyebrow">HIGH TPS IMAGE PIPELINE</span>
          <h1>{config.ui.title}</h1>
          <p>一个 Listing，一组图片；请求先进队列，KeyPool 有多少副本就并发多少。</p>
        </div>
        <div className="server-pill">
          <span className="pulse" />
          {config.server.host}:{config.server.port}
        </div>
      </header>

      <section className="control-panel">
        <div className="metrics">
          <div><span>BLOCKS</span><strong>{snapshot.blocks.length}</strong></div>
          <div><span>IMAGES</span><strong>{images.length}</strong></div>
          <div>
            <span>EXECUTION POOL</span>
            <strong>{systemStatus ? `${systemStatus.queue.executing}/${systemStatus.queue.executionPoolLimit}` : "—"}</strong>
          </div>
          <div>
            <span>SERVER QUEUE</span>
            <strong>{systemStatus ? `${systemStatus.queue.waiting}/${systemStatus.queue.maxPending}` : "—"}</strong>
          </div>
          <div><span>DONE</span><strong>{progress}%</strong></div>
        </div>
        <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
        {keysMissing && (
          <div className="system-alert">
            <strong>CORE BLOCKED · NO_KEYS_REGISTERED</strong>
            <span>
              前后端连接正常，但 KeyPool 为空。队列中的 {systemStatus.queue.waiting} 个任务无法派发；
              请先调用 <code>POST /api/keys</code> 注册 Key。
            </span>
          </div>
        )}
        <div className="toolbar">
          <label className={`button button--file ${importing || running ? "is-disabled" : ""}`}>
            {importing ? "正在缓存原图…" : "导入 JSON"}
            <input
              type="file"
              accept=".json,application/json"
              disabled={importing || running}
              onChange={(event) => void handleImport(event.target.files?.[0])}
            />
          </label>
          <button
            className="button button--primary"
            disabled={running || importing || !queue.length || keysMissing}
            title={keysMissing ? "请先注册 Key，避免继续向 Core 堆积无法执行的任务。" : ""}
            onClick={() => void runItems(queue)}
          >
            开始全部 ({queue.length})
          </button>
          <button className="button" disabled={!running} onClick={() => { stopRequested.current = true; }}>
            停止派发
          </button>
          <button
            className="button button--danger"
            disabled={running || importing || !images.length}
            onClick={() => void clearCache()}
          >
            清空缓存
          </button>
        </div>
      </section>

      {!snapshot.blocks.length ? (
        <section className="empty-state">
          <span>01</span>
          <h2>导入工作台 JSON</h2>
          <p>每个 Block 包含一个 listing 和 1–20 张图片。导入后原图会先落盘，刷新页面仍会保留。</p>
        </section>
      ) : (
        <div className="block-list">
          {snapshot.blocks.map((block) => (
            <div className="block-stack" key={block.blockId}>
              <BlockCard
                block={block}
                disabled={running || keysMissing}
                onRunBlock={() => void runItems(buildTaskQueue([block]))}
                onBlockPromptChange={(prompt) => void updatePrompt(block.blockId, { prompt })}
                onImagePromptChange={(imageId, promptOverride) => (
                  void updatePrompt(block.blockId, { imageId, promptOverride })
                )}
                onRetry={(imageId) => {
                  const image = block.images.find((item) => item.imageId === imageId);
                  if (image) void runItems([{ block, image }]);
                }}
              />
              <BlockRuntimeLog
                block={block}
                entries={blockLogs[block.blockId] || []}
                systemStatus={systemStatus}
                model={config.ui.default_model}
              />
            </div>
          ))}
        </div>
      )}

      <aside className="log-panel">
        <div className="log-panel__header">
          <span>WORKBENCH LOG</span>
          <button onClick={() => setLogs([])}>清空</button>
        </div>
        <div className="log-lines">
          {logs.map((item, index) => <code key={`${item}-${index}`}>{item}</code>)}
        </div>
      </aside>
    </main>
  );
}
