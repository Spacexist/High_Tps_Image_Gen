import type { WorkbenchBlock } from "../models";
import type { BlockLogEntry, SystemStatus } from "../runtime";

interface Props {
  block: WorkbenchBlock;
  entries: BlockLogEntry[];
  systemStatus?: SystemStatus;
  model: string;
}

const pendingStatuses = new Set(["pending", "retry_wait", "running"]);

function getDiagnosis(block: WorkbenchBlock, status: SystemStatus | undefined, model: string) {
  const pending = block.images.filter((image) => pendingStatuses.has(image.state.status)).length;
  if (!pending) {
    return { level: "ok", text: "IDLE / 当前 Block 没有进入 Core 队列的任务。" };
  }
  if (!status) {
    return { level: "warning", text: "CONNECTING / 正在读取 Core、Queue 与 KeyPool 状态…" };
  }
  if (status.keys.total === 0) {
    return {
      level: "error",
      text: `BLOCKED / NO_KEYS_REGISTERED：${pending} 个任务正在等待，但 KeyPool 为空；Core 无法为 model=${model} 派发请求。`,
    };
  }
  if (status.keys.available === 0) {
    return {
      level: "warning",
      text: `WAITING / NO_AVAILABLE_KEY：${pending} 个任务等待中；全部 Key 副本正在占用、冷却或健康检查未通过。`,
    };
  }
  return {
    level: "warning",
    text: `WAITING / MATCHING_KEY：${pending} 个任务等待 model=${model} 的可用 Key；全局空闲副本 ${status.keys.available}。`,
  };
}

function describeImage(block: WorkbenchBlock, imageId: string, status: SystemStatus | undefined) {
  const image = block.images.find((item) => item.imageId === imageId);
  if (!image) return "";
  const state = image.state;
  switch (state.status) {
    case "ready":
      return "已缓存原图，等待前端滑动窗口提交。";
    case "pending":
      return status?.keys.total === 0
        ? "已进入 Core 队列；KeyPool=0，暂时无法派发。"
        : "已进入 Core 队列，等待匹配 Key。";
    case "running":
      return "Core 已租用 Key，正在执行上游图片请求。";
    case "retry_wait":
      return `等待重试${state.error ? `：${state.error.message}` : "。"} `;
    case "completed":
      return `结果已落盘${state.output?.bytes ? `，${state.output.bytes} bytes` : ""}。`;
    case "failed":
      return `任务失败：${state.error?.message || "未返回错误详情"}`;
    case "cancelled":
      return "任务已取消，可重新提交。";
  }
}

export function BlockRuntimeLog({ block, entries, systemStatus, model }: Props) {
  const diagnosis = getDiagnosis(block, systemStatus, model);
  const pending = block.images.filter((image) => pendingStatuses.has(image.state.status)).length;
  const done = block.images.filter((image) => image.state.status === "completed").length;
  const failed = block.images.filter((image) => image.state.status === "failed").length;

  return (
    <aside className="block-runtime-log">
      <div className="block-runtime-log__header">
        <span>BLOCK RUNTIME LOG / {block.blockId}</span>
        <div>
          <b>WAIT {pending}</b>
          <b>DONE {done}</b>
          <b>FAIL {failed}</b>
        </div>
      </div>

      <div className={`runtime-diagnosis runtime-diagnosis--${diagnosis.level}`}>
        <span>{diagnosis.level === "error" ? "!" : "•"}</span>
        <code>{diagnosis.text}</code>
      </div>

      <div className="runtime-table" role="log" aria-live="polite">
        <div className="runtime-row runtime-row--head">
          <span>TIME</span><span>IMAGE</span><span>STATE / EVENT</span><span>TASK ID</span><span>DETAIL</span>
        </div>
        {entries.slice(0, 12).map((entry) => (
          <div className={`runtime-row runtime-row--${entry.level}`} key={entry.id}>
            <code>{entry.time}</code>
            <code>{entry.imageId}</code>
            <code>{entry.event}</code>
            <code title={entry.taskId}>{entry.taskId || "—"}</code>
            <code>{entry.message}</code>
          </div>
        ))}
        {block.images.map((image) => (
          <div className="runtime-row" key={`state-${image.imageId}`}>
            <code>{image.state.updatedAt ? new Date(image.state.updatedAt).toLocaleTimeString("zh-CN", { hour12: false }) : "—"}</code>
            <code>{image.imageId}</code>
            <code>{image.state.status.toUpperCase()} · TRY {image.state.attempts}</code>
            <code title={image.state.taskId ?? undefined}>{image.state.taskId || "—"}</code>
            <code>{describeImage(block, image.imageId, systemStatus)}</code>
          </div>
        ))}
      </div>
    </aside>
  );
}
