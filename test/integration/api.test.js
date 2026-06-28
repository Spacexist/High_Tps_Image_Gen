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

async function setup(executor, retry = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "high-tps-image-gen-"));
  return buildApp({
    config: {
      server: { logger: false },
      health: { enabled: false },
      queue: { dispatchRatePerSecond: 1_000 },
      retry: { maxAttempts: 3, baseDelayMs: 5, maxDelayMs: 10, ...retry },
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
  const built = await setup({ execute: async (task, key) => ({ data: [{ prompt: task.input.prompt, keyID: key.keyID }] }) });
  t.after(() => built.app.close());
  await registerKey(built.app, 2);
  const updatedResponse = await built.app.inject({ method: "PUT", url: "/api/keys/source-a", payload: { concurrency: 3 } });
  assert.equal(updatedResponse.statusCode, 200, updatedResponse.body);

  const createdResponse = await built.app.inject({ method: "POST", url: "/api/tasks", payload: { model: "image-a", prompt: "cat" } });
  assert.equal(createdResponse.statusCode, 202, createdResponse.body);
  const created = createdResponse.json();
  const completed = await waitForTask(built.app, created.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.result.data[0].prompt, "cat");

  const secondRead = (await built.app.inject({ method: "GET", url: `/api/tasks/${created.id}` })).json();
  assert.equal(secondRead.resultAvailable, false);
  assert.equal("result" in secondRead, false);
  assert.equal(built.services.keyManager.getStats().available, 3);
});

test("Core 负责可重试失败，Key 模块只归还并重新分配副本", async (t) => {
  let calls = 0;
  const built = await setup({
    async execute() {
      calls += 1;
      if (calls === 1) throw new DownstreamError("busy", { retryable: true, downstreamStatus: 429 });
      return { ok: true };
    },
  });
  t.after(() => built.app.close());
  await registerKey(built.app, 1);
  const created = (await built.app.inject({ method: "POST", url: "/api/tasks", payload: { model: "image-a", prompt: "retry" } })).json();
  const completed = await waitForTask(built.app, created.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.attempts, 2);
  assert.equal(calls, 2);
});
