import type { CoreTask } from "../models";
import { apiJson } from "./api";

const terminal = new Set(["completed", "failed", "cancelled"]);

export async function pollTask(
  taskId: string,
  intervalMs: number,
  onUpdate: (task: CoreTask) => void,
): Promise<CoreTask> {
  for (;;) {
    const task = await apiJson<CoreTask>(`/api/tasks/${taskId}`);
    onUpdate(task);
    if (terminal.has(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
