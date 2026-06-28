import type { CoreTask } from "../models";
import { apiJson } from "./api";
import { pollTask } from "./taskPolling";

export interface SubmitTaskInput {
  blockId: string;
  imageId: string;
  model: string;
  prompt: string;
  size: string;
}

export async function submitAndWait(
  input: SubmitTaskInput,
  pollIntervalMs: number,
  onUpdate: (task: CoreTask) => void,
) {
  const created = await apiJson<CoreTask>("/api/workbench/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
  onUpdate(created);
  return pollTask(created.id, pollIntervalMs, onUpdate);
}
