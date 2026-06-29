// 固定图片 Mock：用于在没有真实上游 API 的情况下验证 Core、KeyPool 与工作台完整链路。
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createTestPng } from "./test-image.js";

const directory = path.dirname(fileURLToPath(import.meta.url));

export async function loadConfig() {
  const raw = await readFile(path.join(directory, "config.json"), "utf8");
  return JSON.parse(raw);
}

function writeLog(enabled, level, details, message) {
  if (!enabled) return;
  console.log(JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...details,
  }));
}

async function countRequestBytes(request) {
  let bytes = 0;
  for await (const chunk of request) bytes += chunk.length;
  return bytes;
}

export function createMockServer(config) {
  const png = createTestPng(config.imageSize);
  const base64 = png.toString("base64");
  let sequence = 0;

  const server = http.createServer(async (request, response) => {
    const requestId = `mock-${String(++sequence).padStart(6, "0")}`;
    const startedAt = performance.now();

    try {
      // 完整消费 multipart/JSON 请求体，使大图编辑请求也能稳定复用连接。
      const requestBytes = await countRequestBytes(request);
      const parsedUrl = new URL(request.url ?? "/", "http://mock.local");
      const commonHeaders = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "*",
        "cache-control": "no-store",
        "x-mock-request-id": requestId,
        "x-mock-fixed-image": "true",
      };

      // /test.png 是工作台导入阶段读取的“原图”，不能套用生成耗时。
      // delayMs 只模拟真正的上游图片生成/编辑请求，否则 300 张导入会被平白拖慢数分钟。
      const isSourceAsset = parsedUrl.pathname === "/test.png";
      if (!isSourceAsset && config.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.delayMs));
      }

      // 浏览器访问该地址时直接显示固定图片；Core 的所有其他地址返回兼容 JSON。
      if (isSourceAsset) {
        response.writeHead(200, {
          ...commonHeaders,
          "content-type": "image/png",
          "content-length": png.length,
        });
        response.end(png);
      } else {
        const body = JSON.stringify({
          created: 0,
          data: [{
            b64_json: base64,
            revised_prompt: "Fixed white TEST image returned by local mock server.",
          }],
          mock: {
            fixed: true,
            requestId,
            method: request.method,
            path: parsedUrl.pathname,
          },
        });
        response.writeHead(200, {
          ...commonHeaders,
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(body),
        });
        response.end(body);
      }

      writeLog(config.logging, "info", {
        requestId,
        method: request.method,
        path: parsedUrl.pathname,
        requestBytes,
        responseBytes: isSourceAsset ? png.length : base64.length,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      }, "Fixed TEST image returned");
    } catch (error) {
      const body = JSON.stringify({ error: "mock_server_error", message: error.message });
      response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      response.end(body);
      writeLog(config.logging, "error", { requestId, error: error.message }, "Mock request failed");
    }
  });

  return { server, png, base64 };
}

export async function start() {
  const config = await loadConfig();
  const { server, png } = createMockServer(config);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });

  writeLog(config.logging, "info", {
    host: config.host,
    port: config.port,
    imageBytes: png.length,
    preview: `http://127.0.0.1:${config.port}/test.png`,
  }, "Fixed image mock server listening");

  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return server;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
