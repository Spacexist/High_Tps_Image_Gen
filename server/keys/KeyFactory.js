// 原始 Key 只保存一次；运行时依据 concurrency 复制成多个具有唯一 keyID 的完整对象。
import { ValidationError } from "../shared/errors.js";

// 注册和更新共用同一套校验，防止持久化数据与内存池规则漂移。
export function normalizeSourceKey(input, existing = {}) {
  const value = { ...existing, ...input };

  if (!value.id || typeof value.id !== "string") {
    throw new ValidationError("Key id is required");
  }
  if (!value.baseUrl || typeof value.baseUrl !== "string") {
    throw new ValidationError("baseUrl is required");
  }
  if (!value.apiKey || typeof value.apiKey !== "string") {
    throw new ValidationError("apiKey is required");
  }

  const models = Array.isArray(value.models)
    ? value.models
    : value.model
      ? [value.model]
      : [];
  if (models.length === 0 || models.some((model) => typeof model !== "string" || !model)) {
    throw new ValidationError("models must contain at least one model name");
  }

  const concurrency = Number(value.concurrency ?? 1);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10_000) {
    throw new ValidationError("concurrency must be an integer between 1 and 10000");
  }

  let baseUrl;
  try {
    const url = new URL(value.baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported protocol");
    baseUrl = url.toString().replace(/\/$/, "");
  } catch {
    throw new ValidationError("baseUrl must be a valid HTTP(S) URL");
  }

  return {
    id: value.id,
    name: value.name || value.id,
    baseUrl,
    apiKey: value.apiKey,
    models: [...new Set(models)],
    concurrency,
    enabled: value.enabled !== false,
  };
}

export class KeyFactory {
  // 这里是“物理复制”：API Key 可重复，但每个副本的 keyID 必须唯一。
  createCopies(source, generation = 1) {
    return Array.from({ length: source.concurrency }, (_, index) => ({
      // 展开原始对象保证每份都是可独立交给 Core 的完整 Key，而不是只保存引用或计数器。
      ...structuredClone(source),
      keyID: `${source.id}:${generation}:${index + 1}`,
      sourceKeyId: source.id,
      generation,
    }));
  }
}
