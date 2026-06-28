export type TaskStatus =
  | "ready"
  | "pending"
  | "running"
  | "retry_wait"
  | "completed"
  | "failed"
  | "cancelled";

export interface RuntimeConfig {
  server: { protocol: string; host: string; port: number };
  req_max_limit: number;
  poll_interval_ms: number;
  ui: { title: string; default_model: string; image_size: string };
}

export interface ImageTaskState {
  taskId: string | null;
  status: TaskStatus;
  attempts: number;
  error: { code?: string; message: string } | null;
  output: { extension: string; contentType: string; bytes: number } | null;
  updatedAt: string;
}

export interface WorkbenchImage {
  imageId: string;
  url: string;
  promptOverride: string;
  inputUrl: string;
  outputUrl: string | null;
  state: ImageTaskState;
}

export interface WorkbenchBlock {
  blockId: string;
  listing: string;
  prompt: string;
  images: WorkbenchImage[];
}

export interface WorkbenchSnapshot {
  blocks: WorkbenchBlock[];
}

// Core API 的任务快照包含更新时间，前端用它记录精确的状态变更时间。
export interface CoreTask {
  id: string;
  status: TaskStatus;
  attempts: number;
  error: { code?: string; message: string } | null;
  updatedAt: string;
}
