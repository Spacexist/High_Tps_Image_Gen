// 健康检查遍历原始 Key，一条原始 Key 无论 concurrency 多大都只请求一次。
import { request } from "undici";

function joinUrl(baseUrl, pathname) {
  return `${baseUrl.replace(/\/$/, "")}/${pathname.replace(/^\//, "")}`;
}

export class HealthTester {
  constructor({
    keyManager,
    config,
    requestFn = request,
    logger = console,
  }) {
    this.keyManager = keyManager;
    this.config = config;
    this.requestFn = requestFn;
    this.logger = logger;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (!this.config.enabled || this.timer) return;
    if (this.config.runOnStart) void this.runAll();
    this.timer = setInterval(() => void this.runAll(), this.config.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // getSources 返回原始 Key，因此这里天然按 sourceKeyId 去重，不会检查其并发副本。
  async runAll() {
    if (this.running) return [];
    this.running = true;
    try {
      const uniqueSources = this.keyManager
        .getSources()
        .filter((source) => source.enabled);
      return await Promise.all(uniqueSources.map((source) => this.testSource(source)));
    } finally {
      this.running = false;
    }
  }

  async runOne(id) {
    return this.testSource(this.keyManager.getSource(id));
  }

  async testSource(source) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.requestFn(joinUrl(source.baseUrl, this.config.path), {
        method: "GET",
        headers: { authorization: `Bearer ${source.apiKey}` },
        signal: controller.signal,
        headersTimeout: this.config.timeoutMs,
        bodyTimeout: this.config.timeoutMs,
      });
      await response.body?.dump?.();
      const healthy = response.statusCode >= 200 && response.statusCode < 300;
      this.keyManager.setHealth(
        source.id,
        healthy,
        healthy ? null : `Health check returned HTTP ${response.statusCode}`,
      );
      return { id: source.id, healthy, statusCode: response.statusCode };
    } catch (error) {
      this.keyManager.setHealth(source.id, false, error);
      this.logger.warn?.({ keyId: source.id, error: error.message }, "Key health check failed");
      return { id: source.id, healthy: false, error: error.message };
    } finally {
      clearTimeout(timer);
    }
  }
}
