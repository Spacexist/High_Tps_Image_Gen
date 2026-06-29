import type { TaskStatus } from "../models";

export interface QueueStats {
  total: number;
  waiting: number;
  waitingLimit: number;
  executing: number;
  executionPoolLimit: number;
  maxPending: number;
  remainingCapacity: number;
  overCapacity: number;
  byStatus: Record<Exclude<TaskStatus, "ready">, number>;
}

export interface CoreStatus {
  status: "ok";
  uptimeSeconds: number;
  queue: QueueStats;
  keys: KeyStats;
  dispatcher: { inFlight: number };
  diagnostics: {
    code: string;
    severity: "ok" | "warning" | "error";
    message: string;
  };
}

export interface KeyStats {
  sources: number;
  healthySources: number;
  available: number;
  leased: number;
  total: number;
  bySource: Record<string, {
    enabled: boolean;
    healthy: boolean;
    generation: number;
    configuredConcurrency: number;
    available: number;
    leased: number;
  }>;
}

export interface KeySource {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  concurrency: number;
  enabled: boolean;
  healthy: boolean;
  generation: number;
  lastCheckedAt: string | null;
  lastError: string | null;
  pool: { available: number; leased: number; total: number };
}

export interface KeysResponse {
  items: KeySource[];
  stats: KeyStats;
}

export interface PoolCopy {
  keyID: string;
  sourceKeyId: string;
  name: string;
  generation: number;
  models: string[];
  status: "available" | "leased";
}

export interface PoolSnapshot {
  items: PoolCopy[];
  total: number;
  truncated: boolean;
  limit: number;
}

export interface CoreTaskItem {
  id: string;
  status: Exclude<TaskStatus, "ready">;
  input: {
    model: string;
    prompt: string;
    blockId?: string;
    imageId?: string;
    imageUrl?: string;
    size?: string;
  };
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  keyID: string | null;
  error: { code?: string; message: string; downstreamStatus?: number } | null;
  // 仅由 Core 历史接口返回，内容已在后端完成认证信息脱敏。
  trace?: {
    request?: unknown;
    response?: unknown;
  };
}

export interface QueueSnapshot {
  executing: CoreTaskItem[];
  waiting: CoreTaskItem[];
  capacity: QueueStats;
  updatedAt: string;
}

export type QueueEventLevel = "info" | "success" | "warning" | "error";

// 每个对象只表示一个不可变生命周期事件，同一 Task 会对应多行。
export interface QueueEvent {
  id: string;
  timestamp: string;
  event: string;
  level: QueueEventLevel;
  taskId: string | null;
  blockId: string | null;
  imageId: string | null;
  status: Exclude<TaskStatus, "ready"> | null;
  keyID: string | null;
  detail: string;
  payload: unknown;
  queue: QueueStats;
}

export interface QueueEventsResponse {
  items: QueueEvent[];
  total: number;
  limit: number;
  updatedAt: string;
}

export interface CreateKeyInput {
  id?: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  concurrency: number;
  enabled: boolean;
}
