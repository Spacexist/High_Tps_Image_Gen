import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp } from "node:fs/promises";
import { buildApp } from "../../server/bootstrap.js";
import { RequestExecutor } from "../../server/core/RequestExecutor.js";

async function waitForTerminal(app, id, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: "GET", url: `/api/tasks/${id}` });
    const task = response.json();
    if (["completed", "failed"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Task ${id} did not finish in time`);
}

test("后端为同一 Task 保留完整 Request/Response 生命周期事件", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "queue-events-"));
  const executor = new RequestExecutor({
    requestFn: async () => ({
      statusCode: 200,
      headers: { "content-type": "application/json", "x-request-id": "upstream-1" },
      body: {
        text: async () => JSON.stringify({
          data: [{ b64_json: "QUJD" }],
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
      id: "event-source",
      baseUrl: "https://example.test",
      apiKey: "secret-value",
      models: ["image-a"],
      concurrency: 1,
    },
  });

  const acceptedResponse = await built.app.inject({
    method: "POST",
    url: "/api/tasks",
    payload: { model: "image-a", prompt: "event test" },
  });
  assert.equal(acceptedResponse.statusCode, 202);
  const created = acceptedResponse.json();
  await waitForTerminal(built.app, created.id);

  const eventResponse = await built.app.inject({
    method: "GET",
    url: "/api/queue/events?limit=100",
  });
  assert.equal(eventResponse.statusCode, 200);
  const allEvents = eventResponse.json().items;
  const taskEvents = allEvents
    .filter((event) => event.taskId === created.id)
    .reverse();
  const names = taskEvents.map((event) => event.event);

  assert.deepEqual(names, [
    "REQUEST_ACCEPTED",
    "QUEUED",
    "ACCEPTED_RESPONSE_SENT",
    "EXECUTING",
    "UPSTREAM_REQUEST_SENT",
    "UPSTREAM_RESPONSE_RECEIVED",
    "COMPLETED",
    "FINAL_RESPONSE_SENT",
  ]);

  const upstreamRequest = taskEvents.find((event) => event.event === "UPSTREAM_REQUEST_SENT");
  const upstreamResponse = taskEvents.find((event) => event.event === "UPSTREAM_RESPONSE_RECEIVED");
  const accepted = taskEvents.find((event) => event.event === "ACCEPTED_RESPONSE_SENT");
  const final = taskEvents.find((event) => event.event === "FINAL_RESPONSE_SENT");

  assert.equal(upstreamRequest.payload.request.method, "POST");
  assert.equal(upstreamRequest.payload.request.headers.authorization, "[REDACTED]");
  assert.equal(upstreamResponse.payload.response.statusCode, 200);
  assert.equal(accepted.payload.response.statusCode, 202);
  assert.equal(final.payload.response.statusCode, 200);
  assert.doesNotMatch(JSON.stringify(taskEvents), /secret-value/);

  // 再次轮询终态不会重复追加 FINAL_RESPONSE_SENT。
  await built.app.inject({ method: "GET", url: `/api/tasks/${created.id}` });
  const afterPoll = (
    await built.app.inject({ method: "GET", url: "/api/queue/events?limit=100" })
  ).json().items;
  assert.equal(
    afterPoll.filter(
      (event) => event.taskId === created.id && event.event === "FINAL_RESPONSE_SENT",
    ).length,
    1,
  );
});
