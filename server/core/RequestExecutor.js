// 下游图片生成请求适配器。
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
  constructor({ timeoutMs = 120_000, imagePath = "/v1/images/generations", requestFn = request } = {}) {
    this.timeoutMs = timeoutMs;
    this.imagePath = imagePath;
    this.requestFn = requestFn;
  }

  async execute(task, key) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    try {
      // Core 只透传任务输入；真实密钥只来自已租出的物理 Key 副本，绝不接受客户端覆盖。
      const response = await this.requestFn(`${key.baseUrl}${this.imagePath}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(task.input),
        signal: controller.signal,
      });
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
        downstreamStatus: undefined,
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
