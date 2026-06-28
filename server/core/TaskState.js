// Core 任务状态定义。
export const TaskStatus = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  RETRY_WAIT: "retry_wait",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

// 状态转换表是任务生命周期的唯一真相源，避免不同模块随意修改状态。
const transitions = new Map([
  [TaskStatus.PENDING, new Set([TaskStatus.RUNNING, TaskStatus.CANCELLED])],
  [TaskStatus.RUNNING, new Set([TaskStatus.RETRY_WAIT, TaskStatus.COMPLETED, TaskStatus.FAILED])],
  [TaskStatus.RETRY_WAIT, new Set([TaskStatus.PENDING, TaskStatus.CANCELLED])],
]);

export const terminalStatuses = new Set([
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.CANCELLED,
]);

export function canTransition(from, to) {
  return transitions.get(from)?.has(to) ?? false;
}
