import type { TaskStatus } from "./models";

// /api/status 的前端镜像，只保留工作台诊断与展示需要的字段。
export interface SystemStatus {
  status: "ok";
  uptimeSeconds: number;
  queue: {
    total: number;
    waiting: number;
    executing: number;
    executionPoolLimit: number;
    maxPending: number;
    remainingCapacity: number;
    overCapacity: number;
    byStatus: Record<Exclude<TaskStatus, "ready">, number>;
  };
  keys: {
    sources: number;
    available: number;
    leased: number;
    total: number;
  };
  dispatcher: {
    inFlight: number;
  };
  diagnostics?: {
    code: "OK" | "NO_KEYS_REGISTERED" | "NO_AVAILABLE_KEY" | "WAITING_FOR_MATCHING_KEY";
    severity: "ok" | "warning" | "error";
    message: string;
  };
}

export interface LogDetail {
  label: string;
  value: unknown;
}

// 每条记录描述一次入队、Core 状态或真实上游请求/响应。
export interface BlockLogEntry {
  id: string;
  time: string;
  imageId: string;
  event: string;
  message: string;
  details?: LogDetail[];
  status?: TaskStatus;
  taskId?: string;
  level: "info" | "warning" | "error" | "success";
}
