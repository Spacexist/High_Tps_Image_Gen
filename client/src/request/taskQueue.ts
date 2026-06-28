import type { WorkbenchBlock, WorkbenchImage } from "../models";

export interface QueueItem {
  block: WorkbenchBlock;
  image: WorkbenchImage;
}

// 已完成任务不会重复提交；失败任务保留在候选中，方便一次性重跑。
export function buildTaskQueue(blocks: WorkbenchBlock[]): QueueItem[] {
  return blocks.flatMap((block) => block.images
    .filter((image) => ["ready", "failed", "cancelled"].includes(image.state.status))
    .map((image) => ({ block, image })));
}
