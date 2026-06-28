// 服务存活、运行指标与当前阻塞原因接口。
export async function statusRoutes(app, { queue, keyManager, dispatcher }) {
  app.get("/health", async () => ({ status: "ok", time: new Date().toISOString() }));

  app.get("/api/status", async () => {
    const queueStats = queue.stats();
    const keyStats = keyManager.getStats();
    const dispatcherStats = dispatcher.stats();

    // 诊断字段让前端能明确解释“为什么排队”，而不是只显示 pending。
    let diagnostics = {
      code: "OK",
      severity: "ok",
      message: "Core、Queue 与 KeyPool 运行正常。",
    };
    if (queueStats.waiting > 0 && keyStats.total === 0) {
      diagnostics = {
        code: "NO_KEYS_REGISTERED",
        severity: "error",
        message: "队列中存在等待任务，但 KeyPool 为空；请先注册 Key。",
      };
    } else if (queueStats.waiting > 0 && keyStats.available === 0) {
      diagnostics = {
        code: "NO_AVAILABLE_KEY",
        severity: "warning",
        message: "队列中存在等待任务，但当前没有可租用的 Key 副本。",
      };
    } else if (queueStats.waiting > 0 && dispatcherStats.inFlight === 0) {
      diagnostics = {
        code: "WAITING_FOR_MATCHING_KEY",
        severity: "warning",
        message: "任务正在等待支持目标模型的可用 Key。",
      };
    }

    return {
      status: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
      queue: queueStats,
      keys: keyStats,
      dispatcher: dispatcherStats,
      diagnostics,
    };
  });
}
