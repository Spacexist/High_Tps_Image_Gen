import test from "node:test";
import assert from "node:assert/strict";
import { HealthTester } from "../../server/keys/HealthTester.js";

test("HealthTester 只遍历原始 Key，不遍历 concurrency 副本", async () => {
  const calls = [];
  const states = [];
  const manager = {
    getSources: () => [
      { id: "a", enabled: true, baseUrl: "https://a.test", apiKey: "same" },
      { id: "b", enabled: true, baseUrl: "https://b.test", apiKey: "other" },
    ],
    setHealth: (...args) => states.push(args),
  };
  const tester = new HealthTester({
    keyManager: manager,
    config: { enabled: true, runOnStart: false, intervalMs: 60_000, timeoutMs: 1_000, path: "/v1/models" },
    requestFn: async (url) => {
      calls.push(url);
      return { statusCode: 200, body: { dump: async () => {} } };
    },
    logger: { warn() {} },
  });
  const results = await tester.runAll();
  assert.equal(calls.length, 2);
  assert.equal(states.length, 2);
  assert.equal(results.every((item) => item.healthy), true);
});
