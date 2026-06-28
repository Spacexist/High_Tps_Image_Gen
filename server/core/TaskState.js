// Core 任务状态定义：一次执行成功或失败后立即进入终态。
export const TaskStatus = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

// 状态转换表是任务生命周期的唯一真相源，Core 不包含任何自动重试分支。
const transitions = new Map([
  [TaskStatus.PENDING, new Set([TaskStatus.RUNNING, TaskStatus.CANCELLED])],
  [TaskStatus.RUNNING, new Set([TaskStatus.COMPLETED, TaskStatus.FAILED])],
]);

export const terminalStatuses = new Set([
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.CANCELLED,
]);

export function canTransition(from, to) {
  return transitions.get(from)?.has(to) ?? false;
}
