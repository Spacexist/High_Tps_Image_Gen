// KeyManager 对外提供注册、删除、动态建池、健康状态和 acquire/release 五类能力。
import { EventEmitter } from "node:events";
import { createId } from "../shared/id.js";
import { NotFoundError } from "../shared/errors.js";
import { KeyFactory } from "./KeyFactory.js";
import { KeyPool } from "./KeyPool.js";

function maskSecret(value) {
  if (!value) return "";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export class KeyManager extends EventEmitter {
  constructor({
    store,
    factory = new KeyFactory(),
    pool = new KeyPool(),
  }) {
    super();
    this.store = store;
    this.factory = factory;
    this.pool = pool;
    this.sources = new Map();
    this.runtime = new Map();
    this.pool.on("available", () => this.emit("available"));
  }

  async init() {
    const keys = await this.store.load();
    for (const source of keys) this.installSource(source);
    return this;
  }

  // 每次注册或配置更新都会创建新 generation，并按 concurrency 重建完整副本。
  installSource(source, previousRuntime) {
    const runtime = previousRuntime ?? this.runtime.get(source.id) ?? {
      generation: 0,
      healthy: true,
      lastCheckedAt: null,
      lastError: null,
    };
    runtime.generation += 1;
    this.sources.set(source.id, source);
    this.runtime.set(source.id, runtime);
    const copies = this.factory.createCopies(source, runtime.generation);
    this.pool.replaceSource(source, copies, runtime);
    return source;
  }

  async create(input) {
    const id = input.id || createId("key");
    const source = await this.store.add({ ...input, id });
    this.installSource(source);
    return this.describe(source);
  }

  async update(id, patch) {
    const source = await this.store.update(id, patch);
    this.installSource(source);
    return this.describe(source);
  }

  async remove(id) {
    const removed = await this.store.remove(id);
    this.sources.delete(id);
    this.runtime.delete(id);
    this.pool.removeSource(id);
    return { id: removed.id, deleted: true };
  }

  async toggle(id) {
    const source = this.sources.get(id);
    if (!source) throw new NotFoundError(`Key "${id}" not found`);
    return this.update(id, { enabled: !source.enabled });
  }

  // Core 每次请求只拿一个物理副本，用完必须按同一个 keyID 归还。
  acquire(criteria) {
    return this.pool.acquire(criteria);
  }

  release(keyID) {
    return this.pool.release(keyID);
  }

  setHealth(id, healthy, error = null) {
    const source = this.sources.get(id);
    const runtime = this.runtime.get(id);
    if (!source || !runtime) return false;
    runtime.lastCheckedAt = new Date().toISOString();
    runtime.lastError = error ? String(error.message ?? error) : null;
    const changed = runtime.healthy !== healthy;
    runtime.healthy = healthy;

    if (changed && healthy) {
      // 恢复时沿用 generation；KeyPool 会跳过仍在 leased 的相同 keyID，避免重复租出。
      const copies = this.factory.createCopies(source, runtime.generation);
      this.pool.replaceSource(source, copies, runtime);
    } else if (changed) {
      // 仅移除空闲副本；正在执行的副本仍保留租约，恢复健康后可以正常归还。
      this.pool.setSourceHealth(id, false);
    }
    return changed;
  }

  reportOutcome(key, { success, statusCode, error } = {}) {
    if (!success && [401, 403].includes(statusCode)) {
      this.setHealth(key.sourceKeyId, false, error ?? `HTTP ${statusCode}`);
    }
  }

  getSource(id) {
    const source = this.sources.get(id);
    if (!source) throw new NotFoundError(`Key "${id}" not found`);
    return structuredClone(source);
  }

  getSources() {
    return [...this.sources.values()].map((source) => structuredClone(source));
  }

  list() {
    return [...this.sources.values()].map((source) => this.describe(source));
  }

  describe(source) {
    const runtime = this.runtime.get(source.id);
    const stats = this.pool.getStats().bySource[source.id] ?? {};
    return {
      ...structuredClone(source),
      apiKey: maskSecret(source.apiKey),
      healthy: runtime?.healthy ?? false,
      lastCheckedAt: runtime?.lastCheckedAt ?? null,
      lastError: runtime?.lastError ?? null,
      pool: {
        available: stats.available ?? 0,
        leased: stats.leased ?? 0,
        total: (stats.available ?? 0) + (stats.leased ?? 0),
      },
    };
  }

  getStats() {
    return {
      sources: this.sources.size,
      healthySources: [...this.runtime.values()].filter((item) => item.healthy).length,
      ...this.pool.getStats(),
    };
  }
}
