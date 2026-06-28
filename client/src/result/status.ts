import type { TaskStatus } from "../models";

export const statusLabel: Record<TaskStatus, string> = {
  ready: "待处理",
  pending: "排队中",
  running: "生成中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export const activeStatuses = new Set<TaskStatus>(["pending", "running"]);
