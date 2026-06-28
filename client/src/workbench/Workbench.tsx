import { useEffect, useMemo, useRef, useState } from "react";
import type { CoreTask, RuntimeConfig, WorkbenchSnapshot } from "../models";
import type { BlockLogEntry, SystemStatus } from "../runtime";
import { loadJsonFile } from "../load/loadJson";
import { cacheInputs } from "../load/cacheInputs";
import { apiJson } from "../request/api";
import { buildTaskQueue, type QueueItem } from "../request/taskQueue";
import { runSlidingWindow } from "../request/slidingWindow";
import { submitAndWait } from "../request/taskRequest";
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

export function Workbench({ config, initial }: Props) {
  const [snapshot, setSnapshot] = useState(initial);
  const [running, setRunning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [windowActive, setWindowActive] = useState(0);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>();
  const [logs, setLogs] = useState<string[]>(["工作台已连接，本地缓存已恢复。"]);
  const [blockLogs, setBlockLogs] = useState<Record<string, BlockLogEntry[]>>({});
  const stopRequested = useRef(false);
  const runLock = useRef(false);
  const lastTaskStatus = useRef(new Map<string, string>());

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
      [blockId]: [item, ...(current[blockId] || [])].slice(0, 60),
    }));
  }

  async function refresh() {
    setSnapshot(await apiJson<WorkbenchSnapshot>("/api/workbench"));
  }

  async function refreshStatus() {
    try {
      setSystemStatus(await apiJson<SystemStatus>("/api/status"));
    } catch {
      // 顶部服务器指示灯会继续保留，详细连接错误由全局日志记录。
      setSystemStatus(undefined);
    }
  }

  // 即使刷新页面后前端不再持有原轮询，也继续观察后端队列和落盘结果。
  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => {
      void refreshStatus();
      void refresh();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, []);

  function patchTask(blockId: string, imageId: string, task: CoreTask) {
    const previous = lastTaskStatus.current.get(task.id);
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
    // 防止双击在 React 状态提交前开启两个滑动窗口。
    if (!items.length || runLock.current) return;
    if (systemStatus?.keys.total === 0) {
      log("无法开始：KeyPool 中没有 Key。请先通过后端 /api/keys 注册 Key。");
      return;
    }

    runLock.current = true;
    setRunning(true);
    stopRequested.current = false;
    log(`开始处理 ${items.length} 张图片，窗口上限 ${config.req_max_limit}`);
    try {
      await runSlidingWindow(
        items,
        config.req_max_limit,
        async ({ block, image }) => {
          setWindowActive((current) => current + 1);
          blockLog(block.blockId, {
            imageId: image.imageId,
            event: "WINDOW_ACQUIRED",
            level: "info",
            message: `获得前端窗口槽位，准备提交 model=${config.ui.default_model}。`,
          });
          try {
            const prompt = image.promptOverride || block.prompt;
            const terminalTask = await submitAndWait({
              blockId: block.blockId,
              imageId: image.imageId,
              model: config.ui.default_model,
              prompt,
              size: config.ui.image_size,
            }, config.poll_interval_ms, (task) => patchTask(block.blockId, image.imageId, task));
            log(`${block.blockId}/${image.imageId} → ${terminalTask.status}`);
            // 输出缓存写完后工作台状态才会变为 completed；刷新拿到稳定的磁盘 URL。
            await refresh();
          } catch (error) {
            const message = (error as Error).message;
            blockLog(block.blockId, {
              imageId: image.imageId,
              event: "REQUEST_ERROR",
              level: "error",
              message,
            });
            log(`${block.blockId}/${image.imageId} → ${message}`);
            await refresh();
          } finally {
            setWindowActive((current) => Math.max(0, current - 1));
            blockLog(block.blockId, {
              imageId: image.imageId,
              event: "WINDOW_RELEASED",
              level: "info",
              message: "任务已到达终态，释放前端窗口槽位。",
            });
          }
        },
        () => stopRequested.current,
      );
      log(stopRequested.current ? "已停止派发新任务；已提交任务会继续完成。" : "本轮任务处理结束。");
    } finally {
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
    log("本地工作台缓存已清空。");
  }

  return (
    <main>
      <header className="hero">
        <div>
          <span className="eyebrow">HIGH TPS IMAGE PIPELINE</span>
          <h1>{config.ui.title}</h1>
          <p>一个 Listing，一组图片，一个可控的动态请求窗口。</p>
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
          <div><span>WINDOW</span><strong>{windowActive}/{config.req_max_limit}</strong></div>
          <div>
            <span>SERVER QUEUE</span>
            <strong>
              {systemStatus
                ? `${systemStatus.queue.waiting}/${systemStatus.queue.maxPending}`
                : "—"}
            </strong>
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
          <button
            className="button"
            disabled={!running}
            onClick={() => { stopRequested.current = true; }}
          >
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
                onBlockPromptChange={(prompt) => void updatePrompt(block.blockId, { prompt })}
                onImagePromptChange={(imageId, promptOverride) => (
                  void updatePrompt(block.blockId, { imageId, promptOverride })
                )}
                onRetry={(imageId) => {
                  // 这是用户显式发起的新任务，不是 Core 自动重试。
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
