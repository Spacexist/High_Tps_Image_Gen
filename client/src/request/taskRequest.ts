import type { CoreTask } from "../models";
import { apiJson } from "./api";
import { pollTask } from "./taskPolling";

export interface SubmitTaskInput {
  blockId: string;
  imageId: string;
  imageUrl: string;
  model: string;
  prompt: string;
  size: string;
}

// POST 只负责把任务放进后端 waiting_queue；收到 202 后立即返回，不等待图片生成。
export function submitTask(input: SubmitTaskInput): Promise<CoreTask> {
  return apiJson<CoreTask>("/api/workbench/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// 提交和等待拆开后，前端可以先把全部任务按顺序交给 Core，再独立观察终态。
export async function submitAndWait(
  input: SubmitTaskInput,
  pollIntervalMs: number,
  onUpdate: (task: CoreTask) => void,
) {
  const created = await submitTask(input);
  onUpdate(created);
  return pollTask(created.id, pollIntervalMs, onUpdate);
}
