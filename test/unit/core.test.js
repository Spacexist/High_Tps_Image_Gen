import test from "node:test";
import assert from "node:assert/strict";
import { TaskQueue } from "../../server/core/TaskQueue.js";
import { ResultStore } from "../../server/core/ResultStore.js";

function makeQueue(options = {}) {
  return new TaskQueue({ maxPending: 10, terminalTtlMs: 60_000, ...options });
}

test("waiting_queue 严格 FIFO，队首拿不到 Key 时后续任务不得插队", (t) => {
  const queue = makeQueue();
  t.after(() => queue.stop());
  const blocked = queue.create({ model: "blocked", prompt: "a" });
  const runnable = queue.create({ model: "ready", prompt: "b" });

  const claimedWhileBlocked = queue.claimFirst((task) => (
    task.input.model === "ready" ? { keyID: "copy-1" } : null
  ));
  assert.equal(claimedWhileBlocked, null);
  assert.equal(queue.get(blocked.id).status, "pending");
  assert.equal(queue.get(runnable.id).status, "pending");

  const claimedHead = queue.claimFirst(() => ({ keyID: "copy-2" }));
  assert.equal(claimedHead.task.id, blocked.id);
  const claimedNext = queue.claimFirst(() => ({ keyID: "copy-3" }));
  assert.equal(claimedNext.task.id, runnable.id);
});

test("execution_pool 不设软件窗口，waiting_queue 独立限制等待容量", (t) => {
  const queue = makeQueue({ maxPending: 2, executionPoolCapacity: () => 4 });
  t.after(() => queue.stop());

  // 每批任务一旦租到 Key 就离开 waiting_queue；执行中的任务不占等待容量。
  for (const prompt of ["a", "b", "c", "d"]) {
    queue.create({ model: "image", prompt });
    const claimed = queue.claimFirst(() => ({ keyID: `copy-${prompt}` }));
    assert.equal(claimed.task.input.prompt, prompt);
  }
  assert.equal(queue.live().executing.length, 4);
  assert.equal(queue.capacity().executionPoolLimit, 4);

  queue.create({ model: "image", prompt: "waiting-a" });
  queue.create({ model: "image", prompt: "waiting-b" });
  assert.equal(queue.live().waiting.length, 2);
  assert.throws(
    () => queue.create({ model: "image", prompt: "busy" }),
    (error) => error.code === "QUEUE_FULL" && /系统繁忙/.test(error.message),
  );
});

test("waiting_queue 可以动态扩缩容且不删除现有活动任务", (t) => {
  const queue = makeQueue({ maxPending: 6 });
  t.after(() => queue.stop());
  const first = queue.create({ model: "image", prompt: "a" });
  const second = queue.create({ model: "image", prompt: "b" });

  const shrunk = queue.setMaxPending(1);
  assert.equal(shrunk.waitingLimit, 1);
  assert.equal(shrunk.waiting, 2);
  assert.equal(shrunk.overCapacity, 1);
  assert.equal(queue.get(first.id).status, "pending");
  assert.equal(queue.get(second.id).status, "pending");
  assert.throws(() => queue.create({ model: "image", prompt: "blocked" }), /系统繁忙/);

  const expanded = queue.setMaxPending(4);
  assert.equal(expanded.waitingLimit, 4);
  assert.equal(expanded.remainingCapacity, 2);
  assert.equal(queue.create({ model: "image", prompt: "accepted" }).status, "pending");
  assert.throws(() => queue.setMaxPending(0), /1–1000000/);
  assert.throws(() => queue.setMaxPending(2.5), /1–1000000/);
});

test("ResultStore 默认首次读取后删除结果", (t) => {
  const store = new ResultStore({ resultTtlMs: 60_000, deleteAfterRead: true });
  t.after(() => store.stop());
  store.set("task-1", { data: [{ url: "memory-only" }] });
  assert.deepEqual(store.get("task-1"), { data: [{ url: "memory-only" }] });
  assert.equal(store.get("task-1"), null);
});
