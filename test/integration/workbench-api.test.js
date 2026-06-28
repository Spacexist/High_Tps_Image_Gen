import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp } from "node:fs/promises";
import { buildApp } from "../../server/bootstrap.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function waitForWorkbench(app, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: "GET", url: "/api/workbench" });
    const snapshot = response.json();
    const status = snapshot.blocks[0]?.images[0]?.state?.status;
    if (["completed", "failed"].includes(status)) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Workbench task did not finish in time");
}

test("导入原图、提交 Core、缓存结果后刷新仍能恢复", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "workbench-api-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(PNG, { headers: { "content-type": "image/png" } });
  t.after(() => { globalThis.fetch = originalFetch; });

  const built = await buildApp({
    config: {
      server: { logger: false },
      health: { enabled: false },
      queue: { dispatchRatePerSecond: 1_000 },
      workbench: { cachePath: path.join(tempDir, "cache") },
    },
    keyStorePath: path.join(tempDir, "keys.json"),
    executor: { execute: async () => ({ data: [{ b64_json: PNG.toString("base64") }] }) },
  });
  t.after(() => built.app.close());

  await built.app.inject({
    method: "POST",
    url: "/api/keys",
    payload: {
      id: "source-a",
      baseUrl: "https://example.test",
      apiKey: "secret",
      models: ["image-a"],
      concurrency: 1,
    },
  });
  const imported = await built.app.inject({
    method: "POST",
    url: "/api/workbench/import",
    payload: [{
      blockId: "product-001",
      listing: "Product",
      prompt: "studio photo",
      images: [{ imageId: "front", url: "https://example.test/front.png" }],
    }],
  });
  assert.equal(imported.statusCode, 201, imported.body);

  const submitted = await built.app.inject({
    method: "POST",
    url: "/api/workbench/tasks",
    payload: { blockId: "product-001", imageId: "front", model: "image-a" },
  });
  assert.equal(submitted.statusCode, 202, submitted.body);

  const snapshot = await waitForWorkbench(built.app);
  assert.equal(snapshot.blocks[0].images[0].state.status, "completed");
  assert.match(snapshot.blocks[0].images[0].outputUrl, /assets\/output/);

  const output = await built.app.inject({
    method: "GET",
    url: "/api/workbench/assets/output/product-001/front",
  });
  assert.equal(output.statusCode, 200);
  assert.equal(output.headers["content-type"], "image/png");
});
