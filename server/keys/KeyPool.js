// KeyPool 管理真实重复副本的 available/leased 状态，是下游并发上限的唯一执行者。
import { EventEmitter } from "node:events";
import { KeySelector } from "./KeySelector.js";

export class KeyPool extends EventEmitter {
  constructor({ selector = new KeySelector() } = {}) {
    super();
    this.selector = selector;
    this.available = new Map();
    this.leased = new Map();
    this.sources = new Map();
  }

  // 更新原始 Key 时只替换空闲副本；旧 generation 的在途副本归还后会被丢弃。
  replaceSource(source, copies, { healthy = true, generation = 1 } = {}) {
    this.removeAvailableBySource(source.id);
    this.sources.set(source.id, {
      enabled: source.enabled,
      healthy,
      generation,
      configuredConcurrency: source.concurrency,
    });

    if (source.enabled && healthy) {
      // 同 generation 的副本可能仍在执行，不能同时放回 available 造成重复租出。
      for (const copy of copies) {
        if (!this.leased.has(copy.keyID)) this.available.set(copy.keyID, copy);
      }
      if (copies.length > 0) this.emit("available");
    }
  }

  removeSource(sourceKeyId) {
    this.removeAvailableBySource(sourceKeyId);
    this.sources.delete(sourceKeyId);
  }

  setSourceHealth(sourceKeyId, healthy, copies = []) {
    const state = this.sources.get(sourceKeyId);
    if (!state || state.healthy === healthy) return false;

    state.healthy = healthy;
    this.removeAvailableBySource(sourceKeyId);

    if (healthy && state.enabled) {
      // 同 generation 的副本可能仍在执行，不能同时放回 available 造成重复租出。
      for (const copy of copies) {
        if (!this.leased.has(copy.keyID)) this.available.set(copy.keyID, copy);
      }
      if (copies.length > 0) this.emit("available");
    }
    return true;
  }

  // acquire 会把副本从 available 原子移动到 leased，同一个 keyID 不会被并发租出两次。
  acquire(criteria = {}) {
    const selected = this.selector.select(this.available.values(), criteria);
    if (!selected) return null;
    this.available.delete(selected.keyID);
    this.leased.set(selected.keyID, selected);
    return selected;
  }

  // 只允许归还当前 generation 且来源仍启用、健康的副本。
  release(keyID) {
    const key = this.leased.get(keyID);
    if (!key) return false;
    this.leased.delete(keyID);

    const state = this.sources.get(key.sourceKeyId);
    if (
      state &&
      state.enabled &&
      state.healthy &&
      state.generation === key.generation
    ) {
      this.available.set(key.keyID, key);
      this.emit("available");
      return true;
    }
    return false;
  }

  removeAvailableBySource(sourceKeyId) {
    for (const [keyID, key] of this.available) {
      if (key.sourceKeyId === sourceKeyId) this.available.delete(keyID);
    }
  }

  getStats() {
    const bySource = {};
    for (const [sourceKeyId, state] of this.sources) {
      bySource[sourceKeyId] = {
        ...state,
        available: 0,
        leased: 0,
      };
    }
    for (const key of this.available.values()) {
      if (bySource[key.sourceKeyId]) bySource[key.sourceKeyId].available += 1;
    }
    for (const key of this.leased.values()) {
      if (bySource[key.sourceKeyId]) bySource[key.sourceKeyId].leased += 1;
    }
    return {
      available: this.available.size,
      leased: this.leased.size,
      total: this.available.size + this.leased.size,
      bySource,
    };
  }
}
