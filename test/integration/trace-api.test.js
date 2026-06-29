import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp } from "node:fs/promises";
import { buildApp } from "../../server/bootstrap.js";
import { RequestExecutor } from "../../server/core/RequestExecutor.js";

async function waitForTask(app, id, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = (await app.inject({ method: "GET", url: `/api/tasks/${id}` })).json();
    if (["completed", "failed"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Task ${id} did not finish in time`);
}

test("工作台不接收后端 trace，Core 历史接口返回脱敏的请求/响应 trace", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "trace-api-"));
  const executor = new RequestExecutor({
    requestFn: async () => ({
      statusCode: 200,
      headers: { "content-type": "application/json", "x-request-id": "req-demo" },
      body: {
        text: async () => JSON.stringify({
          data: [{ b64_json: "A".repeat(500) }],
          provider: "mock",
        }),
      },
    }),
  });
  const built = await buildApp({
    config: {
      server: { logger: false },
      health: { enabled: false },
      queue: { dispatchRatePerSecond: 1_000 },
    },
    keyStorePath: path.join(tempDir, "keys.json"),
    executor,
  });
  t.after(() => built.app.close());

  await built.app.inject({
    method: "POST",
    url: "/api/keys",
    payload: {
      id: "source-trace",
      baseUrl: "https://example.test",
      apiKey: "must-never-appear",
      models: ["image-a"],
      concurrency: 1,
    },
  });
  const created = (
    await built.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { model: "image-a", prompt: "trace me", size: "1024x1024" },
    })
  ).json();
  const workbenchTask = await waitForTask(built.app, created.id);

  // 单任务轮询接口供工作台使用，绝不能把后端上游 Trace 发给它。
  assert.equal(workbenchTask.trace, undefined);

  const history = (
    await built.app.inject({ method: "GET", url: "/api/tasks?page=1&limit=100" })
  ).json();
  const coreTask = history.items.find((task) => task.id === created.id);
  const serialized = JSON.stringify({ workbenchTask, coreTask });

  assert.equal(coreTask.trace.request.method, "POST");
  assert.equal(coreTask.trace.request.url, "https://example.test/v1/images/generations");
  assert.equal(coreTask.trace.request.headers.authorization, "[REDACTED]");
  assert.equal(coreTask.trace.response.statusCode, 200);
  assert.equal(coreTask.trace.response.headers["x-request-id"], "req-demo");
  assert.match(coreTask.trace.response.body.data[0].b64_json, /BINARY OMITTED/);
  assert.doesNotMatch(serialized, /must-never-appear/);
});
