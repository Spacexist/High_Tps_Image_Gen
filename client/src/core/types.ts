import type { TaskStatus } from "../models";

export interface CoreStatus {
  status: "ok";
  uptimeSeconds: number;
  queue: QueueStats;
  keys: KeyStats;
  dispatcher: {
    inFlight: number;
    dispatchRatePerSecond: number;
    tokens: number;
  };
  diagnostics: {
    code: string;
    severity: "ok" | "warning" | "error";
    message: string;
  };
}

export interface QueueStats {
  total: number;
  waiting: number;
  maxPending: number;
  remainingCapacity: number;
  overCapacity: number;
  byStatus: Record<Exclude<TaskStatus, "ready">, number>;
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
  pool: {
    available: number;
    leased: number;
    total: number;
  };
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
    size?: string;
  };
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  keyID: string | null;
  error: { code?: string; message: string } | null;
}

export interface TasksResponse {
  items: CoreTaskItem[];
  page: number;
  limit: number;
  total: number;
}

export interface CoreEvent {
  id: string;
  time: string;
  type: "TASK" | "KEY" | "SYSTEM";
  subject: string;
  event: string;
  detail: string;
  level: "info" | "warning" | "error" | "success";
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
