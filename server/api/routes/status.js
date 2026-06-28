// 服务存活与运行指标接口。
export async function statusRoutes(app, { queue, keyManager, dispatcher }) {
  app.get("/health", async () => ({ status: "ok", time: new Date().toISOString() }));
  app.get("/api/status", async () => ({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    queue: queue.stats(),
    keys: keyManager.getStats(),
    dispatcher: dispatcher.stats(),
  }));
}
