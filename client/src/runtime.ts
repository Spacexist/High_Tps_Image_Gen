import type { TaskStatus } from "./models";

// /api/status 的前端镜像，只保留工作台诊断与展示需要的字段。
export interface SystemStatus {
  status: "ok";
  uptimeSeconds: number;
  queue: {
    total: number;
    waiting: number;
    pending: number;
    retry_wait: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
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

// 每条记录描述一次前端窗口或 Core 任务状态变更。
export interface BlockLogEntry {
  id: string;
  time: string;
  imageId: string;
  event: string;
  message: string;
  status?: TaskStatus;
  taskId?: string;
  level: "info" | "warning" | "error" | "success";
}
