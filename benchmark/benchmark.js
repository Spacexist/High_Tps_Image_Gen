// 简单压测只测任务接收吞吐；真实图片生成速度仍由 Key 数量、concurrency 和供应商延迟决定。
import { performance } from "node:perf_hooks";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const total = Number(process.env.TOTAL ?? 1_000);
const concurrency = Number(process.env.CONCURRENCY ?? 50);
const model = process.env.MODEL ?? "gpt-image-1";
const prompt = process.env.PROMPT ?? "benchmark image";

let next = 0;
let accepted = 0;
let failed = 0;
const latencies = [];

async function worker() {
  while (true) {
    const index = next;
    next += 1;
    if (index >= total) return;
    const started = performance.now();
    try {
      const response = await fetch(`${baseUrl}/api/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: `${prompt} #${index}` }),
      });
      if (response.status === 202) accepted += 1;
      else failed += 1;
      await response.body?.cancel();
    } catch {
      failed += 1;
    } finally {
      latencies.push(performance.now() - started);
    }
  }
}

const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, () => worker()));
const elapsedSeconds = (performance.now() - started) / 1_000;
latencies.sort((a, b) => a - b);
const percentile = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? 0;

console.log(JSON.stringify({
  total,
  accepted,
  failed,
  concurrency,
  elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
  requestsPerSecond: Number((total / elapsedSeconds).toFixed(2)),
  latencyMs: { p50: Number(percentile(0.50).toFixed(2)), p95: Number(percentile(0.95).toFixed(2)) },
}, null, 2));
