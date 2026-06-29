import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildApp } from "../server/bootstrap.js";

test("status explains when queued tasks cannot run because KeyPool is empty", async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), "image-workbench-status-"));
  const built = await buildApp({
    logger: false,
    keyStorePath: path.join(cacheDir, "keys.json"),
    config: {
      server: { host: "127.0.0.1", port: 3000 },
      queue: { maxPending: 100 },
      health: { enabled: false, intervalMs: 60_000, timeoutMs: 500 },
      workbench: { cachePath: cacheDir },
    },
  });
  const { app } = built;

  try {
    const taskResponse = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { model: "gpt-image-1", prompt: "diagnostic test", size: "1024x1024" },
    });
    assert.equal(taskResponse.statusCode, 202);

    const statusResponse = await app.inject({ method: "GET", url: "/api/status" });
    assert.equal(statusResponse.statusCode, 200);
    const status = statusResponse.json();
    assert.equal(status.queue.waiting, 1);
    assert.equal(status.queue.waitingLimit, 100);
    assert.equal(status.queue.executionPoolLimit, 0);
    assert.equal(status.queue.remainingCapacity, 99);
    assert.equal(status.keys.total, 0);
    assert.equal(status.diagnostics.code, "NO_KEYS_REGISTERED");
  } finally {
    await app.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});
