import assert from "node:assert/strict";
import test from "node:test";
import { createMockServer } from "../server.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

test("任意 Core 请求都返回同一张固定 TEST 图片", async (context) => {
  const { server, base64 } = createMockServer({
    imageSize: 128,
    delayMs: 0,
    logging: false,
  });
  context.after(() => server.close());
  const port = await listen(server);

  const requests = [
    fetch(`http://127.0.0.1:${port}/v1/images/generations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "anything" }),
    }),
    fetch(`http://127.0.0.1:${port}/v1/images/edits`, {
      method: "PUT",
      body: "anything",
    }),
    fetch(`http://127.0.0.1:${port}/v1/models`),
    fetch(`http://127.0.0.1:${port}/totally/random/path`),
  ];

  const responses = await Promise.all(requests);
  const bodies = await Promise.all(responses.map((response) => response.json()));

  assert.ok(responses.every((response) => response.status === 200));
  assert.ok(bodies.every((body) => body.data[0].b64_json === base64));
  assert.ok(bodies.every((body) => body.data[0].b64_json.startsWith("iVBOR")));
});

test("/test.png 可直接预览同一张 PNG", async (context) => {
  const { server, png } = createMockServer({
    imageSize: 128,
    delayMs: 0,
    logging: false,
  });
  context.after(() => server.close());
  const port = await listen(server);

  const response = await fetch(`http://127.0.0.1:${port}/test.png`);
  const bytes = Buffer.from(await response.arrayBuffer());

  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(bytes, png);
});
