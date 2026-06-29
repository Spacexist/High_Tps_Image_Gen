// 下游图片请求适配器：普通 JSON 生成和工作台 multipart 编辑都只调用一次下游。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { request } from "undici";
import { DownstreamError } from "../shared/errors.js";

function publicInput(input) {
  const { _inputFile, _inputContentType, ...safe } = input;
  return safe;
}

function responseHeaders(headers = {}) {
  // 只显示排错真正需要的响应头，避免把供应商 Cookie 等无关数据带到 UI。
  return {
    "content-type": headers["content-type"] ?? null,
    "content-length": headers["content-length"] ?? null,
    "x-request-id": headers["x-request-id"] ?? headers["request-id"] ?? null,
  };
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

  describeRequest(task, key) {
    const isEdit = Boolean(task.input._inputFile);
    const endpoint = isEdit ? this.imageEditPath : this.imagePath;
    return {
      method: "POST",
      url: `${key.baseUrl}${endpoint}`,
      keyID: key.keyID,
      headers: {
        authorization: "Bearer [REDACTED]",
        "content-type": isEdit ? "multipart/form-data; boundary=<auto>" : "application/json",
        "x-relay-task-id": task.id,
        "x-relay-key-id": key.keyID,
      },
      body: isEdit
        ? {
          encoding: "multipart/form-data",
          fields: {
            model: task.input.model,
            prompt: task.input.prompt,
            size: task.input.size ?? "1024x1024",
            n: String(task.input.n ?? 1),
            image: {
              filename: path.basename(task.input._inputFile),
              contentType: task.input._inputContentType ?? "image/png",
            },
          },
        }
        : { encoding: "application/json", value: publicInput(task.input) },
    };
  }

  async execute(task, key) {
    return (await this.executeDetailed(task, key)).result;
  }

  async executeDetailed(task, key) {
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
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { raw: text };
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new DownstreamError(`Downstream returned HTTP ${response.statusCode}`, {
          downstreamStatus: response.statusCode,
          responseBody: body,
        });
      }
      return {
        result: body,
        responseTrace: {
          ok: true,
          statusCode: response.statusCode,
          headers: responseHeaders(response.headers),
          body,
        },
      };
    } catch (error) {
      if (error instanceof DownstreamError) throw error;
      const timedOut = error?.name === "AbortError";
      throw new DownstreamError(
        timedOut ? "Downstream request timed out" : "Downstream request failed",
        { cause: error },
      );
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
