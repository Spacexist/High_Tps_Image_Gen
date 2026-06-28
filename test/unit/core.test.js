import test from "node:test";
import assert from "node:assert/strict";
import { TaskQueue } from "../../server/core/TaskQueue.js";
import { RetryPolicy } from "../../server/core/RetryPolicy.js";
import { ResultStore } from "../../server/core/ResultStore.js";

function makeQueue(options = {}) {
  return new TaskQueue({ maxPending: 10, terminalTtlMs: 60_000, ...options });
}

test("队首模型无 Key 时会跳过它并调度后面的可运行任务", (t) => {
  const queue = makeQueue();
  t.after(() => queue.stop());
  const blocked = queue.create({ model: "blocked", prompt: "a" });
  const runnable = queue.create({ model: "ready", prompt: "b" });
  const claimed = queue.claimFirst((task) => task.input.model === "ready" ? { keyID: "copy-1" } : null);
  assert.equal(claimed.task.id, runnable.id);
  assert.equal(queue.get(blocked.id).status, "pending");
});

test("RetryPolicy 只重试可重试错误并执行指数退避", () => {
  const policy = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 500 });
  assert.equal(policy.shouldRetry({ attempts: 1 }, { retryable: true }), true);
  assert.equal(policy.shouldRetry({ attempts: 3 }, { retryable: true }), false);
  assert.equal(policy.shouldRetry({ attempts: 1 }, { retryable: false }), false);
  assert.equal(policy.delayFor({ attempts: 3 }, {}), 400);
  assert.equal(policy.delayFor({ attempts: 1 }, { retryAfterMs: 900 }), 500);
});

test("ResultStore 默认首次读取后删除结果", (t) => {
  const store = new ResultStore({ resultTtlMs: 60_000, deleteAfterRead: true });
  t.after(() => store.stop());
  store.set("task-1", { data: [{ url: "memory-only" }] });
  assert.deepEqual(store.get("task-1"), { data: [{ url: "memory-only" }] });
  assert.equal(store.get("task-1"), null);
});
