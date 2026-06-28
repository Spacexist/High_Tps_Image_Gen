import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildApp } from "../server/bootstrap.js";

test("KeyPool snapshot exposes unique copy IDs and lease state without secrets", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "core-ui-api-"));
  const built = await buildApp({
    logger: false,
    keyStorePath: path.join(tempDir, "keys.json"),
    config: {
      server: { logger: false },
      health: { enabled: false },
      workbench: { cachePath: path.join(tempDir, "workbench") },
    },
    executor: { execute: async () => ({ ok: true }) },
  });

  try {
    const created = await built.app.inject({
      method: "POST",
      url: "/api/keys",
      payload: {
        id: "visual-source",
        name: "Visual Source",
        baseUrl: "https://example.test",
        apiKey: "secret-that-must-never-leak",
        models: ["gpt-image-1"],
        concurrency: 3,
      },
    });
    assert.equal(created.statusCode, 201, created.body);

    const leased = built.services.keyManager.acquire({ model: "gpt-image-1" });
    assert.ok(leased);

    const response = await built.app.inject({ method: "GET", url: "/api/keys/pool?limit=20" });
    assert.equal(response.statusCode, 200, response.body);
    const snapshot = response.json();
    assert.equal(snapshot.total, 3);
    assert.equal(new Set(snapshot.items.map((item) => item.keyID)).size, 3);
    assert.equal(snapshot.items.filter((item) => item.status === "leased").length, 1);
    assert.equal(snapshot.items.filter((item) => item.status === "available").length, 2);
    assert.equal(JSON.stringify(snapshot).includes("secret-that-must-never-leak"), false);
    assert.equal(snapshot.items.every((item) => !("apiKey" in item)), true);
  } finally {
    await built.app.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
