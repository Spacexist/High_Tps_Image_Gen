// 下游图片请求适配器：普通 JSON 生成和工作台 multipart 编辑共用超时、错误与重试语义。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { request } from "undici";
import { DownstreamError } from "../shared/errors.js";

function parseRetryAfter(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export class RequestExecutor {
  constructor({
    timeoutMs = 120_000,
    imagePath = "/v1/images/generations",
    imageEditPath = "/v1/images/edits",
    requestFn = request,
  } = {}) {
    this.timeoutMs = timeoutMs;
    this.imagePath = imagePath;
    this.imageEditPath = imageEditPath;
    this.requestFn = requestFn;
  }

  async execute(task, key) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    try {
      const options = task.input._inputFile
        ? await this.#imageEditOptions(task, key, controller.signal)
        : this.#jsonOptions(task, key, controller.signal);
      const endpoint = task.input._inputFile ? this.imageEditPath : this.imagePath;
      const response = await this.requestFn(`${key.baseUrl}${endpoint}`, options);
      const text = await response.body.text();
      let body;
      try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        const retryable = [408, 409, 425, 429].includes(response.statusCode) || response.statusCode >= 500;
        throw new DownstreamError(`Downstream returned HTTP ${response.statusCode}`, {
          downstreamStatus: response.statusCode,
          retryable,
          responseBody: body,
          retryAfterMs: parseRetryAfter(response.headers?.["retry-after"]),
        });
      }
      return body;
    } catch (error) {
      if (error instanceof DownstreamError) throw error;
      const timedOut = error?.name === "AbortError";
      throw new DownstreamError(timedOut ? "Downstream request timed out" : "Downstream request failed", {
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  #jsonOptions(task, key, signal) {
    return {
      method: "POST",
      headers: {
        authorization: `Bearer ${key.apiKey}`,
        "content-type": "application/json",
        "x-relay-task-id": task.id,
        "x-relay-key-id": key.keyID,
      },
      body: JSON.stringify(task.input),
      signal,
    };
  }

  async #imageEditOptions(task, key, signal) {
    // Node 18 的 FormData 需要 Blob；文件上限已在导入阶段限制，避免无界内存增长。
    const bytes = await readFile(task.input._inputFile);
    const form = new FormData();
    form.set("model", task.input.model);
    form.set("prompt", task.input.prompt);
    form.set("size", task.input.size ?? "1024x1024");
    form.set("n", String(task.input.n ?? 1));
    form.set(
      "image",
      new Blob([bytes], { type: task.input._inputContentType ?? "image/png" }),
      path.basename(task.input._inputFile),
    );
    return {
      method: "POST",
      headers: {
        authorization: `Bearer ${key.apiKey}`,
        "x-relay-task-id": task.id,
        "x-relay-key-id": key.keyID,
      },
      body: form,
      signal,
    };
  }
}
