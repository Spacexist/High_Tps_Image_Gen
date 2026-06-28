import { useMemo, useRef, useState } from "react";
import type { CoreTask, RuntimeConfig, WorkbenchSnapshot } from "../models";
import { loadJsonFile } from "../load/loadJson";
import { cacheInputs } from "../load/cacheInputs";
import { apiJson } from "../request/api";
import { buildTaskQueue, type QueueItem } from "../request/taskQueue";
import { runSlidingWindow } from "../request/slidingWindow";
import { submitAndWait } from "../request/taskRequest";
import { activeStatuses } from "../result/status";
import { BlockCard } from "./BlockCard";

interface Props {
  config: RuntimeConfig;
  initial: WorkbenchSnapshot;
}

export function Workbench({ config, initial }: Props) {
  const [snapshot, setSnapshot] = useState(initial);
  const [running, setRunning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [logs, setLogs] = useState<string[]>(["工作台已连接，本地缓存已恢复。"]);
  const stopRequested = useRef(false);

  const images = snapshot.blocks.flatMap((block) => block.images);
  const completed = images.filter((image) => image.state.status === "completed").length;
  const active = images.filter((image) => activeStatuses.has(image.state.status)).length;
  const progress = images.length ? Math.round((completed / images.length) * 100) : 0;
  const queue = useMemo(() => buildTaskQueue(snapshot.blocks), [snapshot.blocks]);

  function log(message: string) {
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    setLogs((current) => [`${time}  ${message}`, ...current].slice(0, 80));
  }

  async function refresh() {
    setSnapshot(await apiJson<WorkbenchSnapshot>("/api/workbench"));
  }

  function patchTask(blockId: string, imageId: string, task: CoreTask) {
    setSnapshot((current) => ({
      blocks: current.blocks.map((block) => block.blockId !== blockId ? block : ({
        ...block,
        images: block.images.map((image) => image.imageId !== imageId ? image : ({
          ...image,
          state: { ...image.state, status: task.status, taskId: task.id, attempts: task.attempts, error: task.error },
        })),
      })),
    }));
  }

  async function runItems(items: QueueItem[]) {
    if (!items.length) return;
    setRunning(true);
    stopRequested.current = false;
    log(`开始处理 ${items.length} 张图片，窗口上限 ${config.req_max_limit}`);
    await runSlidingWindow(
      items,
      config.req_max_limit,
      async ({ block, image }) => {
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
          log(`${block.blockId}/${image.imageId} → ${(error as Error).message}`);
          await refresh();
        }
      },
      () => stopRequested.current,
    );
    setRunning(false);
    log(stopRequested.current ? "已停止派发新任务；已提交任务会继续完成。" : "本轮任务处理结束。");
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
          <div><span>ACTIVE</span><strong>{active}/{config.req_max_limit}</strong></div>
          <div><span>DONE</span><strong>{progress}%</strong></div>
        </div>
        <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
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
          <button className="button button--primary" disabled={running || importing || !queue.length} onClick={() => void runItems(queue)}>
            开始全部 ({queue.length})
          </button>
          <button className="button" disabled={!running} onClick={() => { stopRequested.current = true; }}>
            停止派发
          </button>
          <button className="button button--danger" disabled={running || importing || !images.length} onClick={() => void clearCache()}>
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
            <BlockCard
              key={block.blockId}
              block={block}
              disabled={running}
              onBlockPromptChange={(prompt) => void updatePrompt(block.blockId, { prompt })}
              onImagePromptChange={(imageId, promptOverride) => void updatePrompt(block.blockId, { imageId, promptOverride })}
              onRetry={(imageId) => {
                const image = block.images.find((item) => item.imageId === imageId);
                if (image) void runItems([{ block, image }]);
              }}
            />
          ))}
        </div>
      )}

      <aside className="log-panel">
        <div className="log-panel__header">
          <span>LIVE LOG</span>
          <button onClick={() => setLogs([])}>清空</button>
        </div>
        <div className="log-lines">
          {logs.map((item, index) => <code key={`${item}-${index}`}>{item}</code>)}
        </div>
      </aside>
    </main>
  );
}
