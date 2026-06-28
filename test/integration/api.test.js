import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp } from "node:fs/promises";
import { buildApp } from "../../server/bootstrap.js";
import { DownstreamError } from "../../server/shared/errors.js";

async function waitForTask(app, id, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: "GET", url: `/api/tasks/${id}` });
    const task = response.json();
    if (["completed", "failed"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Task ${id} did not finish in time`);
}

async function setup(executor, queue = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "high-tps-image-gen-"));
  return buildApp({
    config: {
      server: { logger: false },
      health: { enabled: false },
      queue: { dispatchRatePerSecond: 1_000, ...queue },
      result: { deleteAfterRead: true },
    },
    keyStorePath: path.join(tempDir, "keys.json"),
    executor,
  });
}

async function registerKey(app, concurrency = 2) {
  const response = await app.inject({
    method: "POST",
    url: "/api/keys",
    payload: {
      id: "source-a",
      baseUrl: "https://example.test",
      apiKey: "secret-key",
      models: ["image-a"],
      concurrency,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
}

test("API 注册 Key、创建任务、执行并在首次读取后释放内存结果", async (t) => {
  const built = await setup({
    execute: async (task, key) => ({
      data: [{ prompt: task.input.prompt, keyID: key.keyID }],
    }),
  });
  t.after(() => built.app.close());
  await registerKey(built.app, 2);
  const updatedResponse = await built.app.inject({
    method: "PUT",
    url: "/api/keys/source-a",
    payload: { concurrency: 3 },
  });
  assert.equal(updatedResponse.statusCode, 200, updatedResponse.body);

  const createdResponse = await built.app.inject({
    method: "POST",
    url: "/api/tasks",
    payload: { model: "image-a", prompt: "cat" },
  });
  assert.equal(createdResponse.statusCode, 202, createdResponse.body);
  const created = createdResponse.json();
  const completed = await waitForTask(built.app, created.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.result.data[0].prompt, "cat");

  const secondRead = (
    await built.app.inject({ method: "GET", url: `/api/tasks/${created.id}` })
  ).json();
  assert.equal(secondRead.resultAvailable, false);
  assert.equal("result" in secondRead, false);
  assert.equal(built.services.keyManager.getStats().available, 3);
});

test("下游失败后任务立即终止，Core 不执行自动重试", async (t) => {
  let calls = 0;
  const built = await setup({
    async execute() {
      calls += 1;
      throw new DownstreamError("busy", { downstreamStatus: 429 });
    },
  });
  t.after(() => built.app.close());
  await registerKey(built.app, 1);
  const created = (
    await built.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { model: "image-a", prompt: "one shot" },
    })
  ).json();
  const failed = await waitForTask(built.app, created.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error.downstreamStatus, 429);
  assert.equal("attempts" in failed, false);
  assert.equal(calls, 1);
});

test("Queue API 可动态扩缩容，缩容不丢任务并阻止超量提交", async (t) => {
  const built = await setup({ execute: async () => ({ ok: true }) }, { maxPending: 3 });
  t.after(() => built.app.close());

  for (const prompt of ["a", "b"]) {
    const response = await built.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { model: "image-a", prompt },
    });
    assert.equal(response.statusCode, 202, response.body);
  }

  const shrunk = await built.app.inject({
    method: "PATCH",
    url: "/api/queue",
    payload: { maxPending: 1 },
  });
  assert.equal(shrunk.statusCode, 200, shrunk.body);
  assert.deepEqual(
    {
      maxPending: shrunk.json().maxPending,
      waiting: shrunk.json().waiting,
      overCapacity: shrunk.json().overCapacity,
    },
    { maxPending: 1, waiting: 2, overCapacity: 1 },
  );

  const blocked = await built.app.inject({
    method: "POST",
    url: "/api/tasks",
    payload: { model: "image-a", prompt: "blocked" },
  });
  assert.equal(blocked.statusCode, 503, blocked.body);
  assert.match(blocked.body, /Task queue is full/);

  const expanded = await built.app.inject({
    method: "PATCH",
    url: "/api/queue",
    payload: { maxPending: 4 },
  });
  assert.equal(expanded.statusCode, 200, expanded.body);
  assert.equal(expanded.json().remainingCapacity, 2);

  const accepted = await built.app.inject({
    method: "POST",
    url: "/api/tasks",
    payload: { model: "image-a", prompt: "accepted" },
  });
  assert.equal(accepted.statusCode, 202, accepted.body);
});
