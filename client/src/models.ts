export type TaskStatus =
  | "ready"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface RuntimeConfig {
  server: { protocol: string; host: string; port: number };
  poll_interval_ms: number;
  ui: { title: string; default_model: string; image_size: string };
}

export interface ImageTaskState {
  taskId: string | null;
  status: TaskStatus;
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

// Core 返回的 trace 已在服务端脱敏，前端仅负责结构化展示。
export interface CoreTask {
  id: string;
  status: TaskStatus;
  keyID?: string | null;
  error: { code?: string; message: string; downstreamStatus?: number } | null;
  updatedAt: string;
  trace?: {
    request?: unknown;
    response?: unknown;
  };
}
