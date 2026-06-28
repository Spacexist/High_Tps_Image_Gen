import test from "node:test";
import assert from "node:assert/strict";
import { KeyFactory, normalizeSourceKey } from "../../server/keys/KeyFactory.js";
import { KeyPool } from "../../server/keys/KeyPool.js";

const source = normalizeSourceKey({
  id: "source-a",
  baseUrl: "https://example.com",
  apiKey: "secret",
  models: ["image-a"],
  concurrency: 3,
});

test("KeyFactory 按 concurrency 创建真实重复 Key，并为每份分配唯一 keyID", () => {
  const copies = new KeyFactory().createCopies(source, 2);
  assert.equal(copies.length, 3);
  assert.equal(new Set(copies.map((item) => item.keyID)).size, 3);
  assert.deepEqual(new Set(copies.map((item) => item.sourceKeyId)), new Set([source.id]));
  assert.deepEqual(new Set(copies.map((item) => item.apiKey)), new Set([source.apiKey]));
  assert.equal(copies.every((item) => item.concurrency === source.concurrency), true);
});

test("KeyPool 租出并归还同一个 keyID，且严格匹配模型", () => {
  const factory = new KeyFactory();
  const pool = new KeyPool();
  pool.replaceSource(source, factory.createCopies(source, 1), { healthy: true, generation: 1 });
  assert.equal(pool.acquire({ model: "other" }), null);
  const key = pool.acquire({ model: "image-a" });
  assert.ok(key);
  assert.equal(pool.getStats().leased, 1);
  assert.equal(pool.release(key.keyID), true);
  assert.equal(pool.getStats().available, 3);
});

test("旧 generation 的在途 Key 归还时会被丢弃", () => {
  const factory = new KeyFactory();
  const pool = new KeyPool();
  pool.replaceSource(source, factory.createCopies(source, 1), { healthy: true, generation: 1 });
  const oldKey = pool.acquire({ model: "image-a" });
  pool.replaceSource(source, factory.createCopies(source, 2), { healthy: true, generation: 2 });
  assert.equal(pool.release(oldKey.keyID), false);
  assert.equal(pool.getStats().available, 3);
});

test("健康状态恢复时不会把仍在 leased 的相同 keyID 重复放入池", () => {
  const factory = new KeyFactory();
  const pool = new KeyPool();
  const copies = factory.createCopies(source, 1);
  pool.replaceSource(source, copies, { healthy: true, generation: 1 });
  const leased = pool.acquire({ model: "image-a" });
  pool.setSourceHealth(source.id, false);
  pool.setSourceHealth(source.id, true, copies);
  assert.equal(pool.getStats().available, 2);
  assert.equal(pool.getStats().leased, 1);
  pool.release(leased.keyID);
  assert.equal(pool.getStats().available, 3);
});
