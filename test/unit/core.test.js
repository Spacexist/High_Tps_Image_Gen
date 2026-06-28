import test from "node:test";
import assert from "node:assert/strict";
import { TaskQueue } from "../../server/core/TaskQueue.js";
import { ResultStore } from "../../server/core/ResultStore.js";

function makeQueue(options = {}) {
  return new TaskQueue({ maxPending: 10, terminalTtlMs: 60_000, ...options });
}

test("队首模型无 Key 时会跳过它并调度后面的可运行任务", (t) => {
  const queue = makeQueue();
  t.after(() => queue.stop());
  const blocked = queue.create({ model: "blocked", prompt: "a" });
  const runnable = queue.create({ model: "ready", prompt: "b" });
  const claimed = queue.claimFirst((task) => (
    task.input.model === "ready" ? { keyID: "copy-1" } : null
  ));
  assert.equal(claimed.task.id, runnable.id);
  assert.equal(queue.get(blocked.id).status, "pending");
});

test("Queue 可以运行时扩缩容，缩容不会删除已经排队的任务", (t) => {
  const queue = makeQueue({ maxPending: 3 });
  t.after(() => queue.stop());
  const first = queue.create({ model: "image", prompt: "a" });
  const second = queue.create({ model: "image", prompt: "b" });

  const shrunk = queue.setMaxPending(1);
  assert.equal(shrunk.maxPending, 1);
  assert.equal(shrunk.waiting, 2);
  assert.equal(shrunk.overCapacity, 1);
  assert.equal(queue.get(first.id).status, "pending");
  assert.equal(queue.get(second.id).status, "pending");
  assert.throws(
    () => queue.create({ model: "image", prompt: "blocked" }),
    (error) => error.code === "QUEUE_FULL",
  );

  const expanded = queue.setMaxPending(4);
  assert.equal(expanded.remainingCapacity, 2);
  assert.equal(queue.create({ model: "image", prompt: "accepted" }).status, "pending");
  assert.throws(() => queue.setMaxPending(0), /1–1000000/);
  assert.throws(() => queue.setMaxPending(1.5), /1–1000000/);
});

test("ResultStore 默认首次读取后删除结果", (t) => {
  const store = new ResultStore({ resultTtlMs: 60_000, deleteAfterRead: true });
  t.after(() => store.stop());
  store.set("task-1", { data: [{ url: "memory-only" }] });
  assert.deepEqual(store.get("task-1"), { data: [{ url: "memory-only" }] });
  assert.equal(store.get("task-1"), null);
});
