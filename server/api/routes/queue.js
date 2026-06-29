// Queue 管理接口只调整 waiting_queue；execution_pool 容量由 KeyPool 动态决定。
export async function queueRoutes(app, { queue }) {
  app.get("/api/queue", async () => queue.stats());

  // 管理端用独立实时快照展示活动任务，不混入 completed/failed 历史。
  app.get("/api/queue/tasks", async () => queue.live());

  // 追加式事件流保留同一 Task 的所有阶段，不能退化成最终状态快照。
  app.get("/api/queue/events", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 1_000, default: 300 },
        },
      },
    },
  }, async (request) => queue.eventsList(request.query));

  app.patch("/api/queue", {
    schema: {
      body: {
        type: "object",
        required: ["maxPending"],
        properties: {
          maxPending: { type: "integer", minimum: 1, maximum: 1_000_000 },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const resized = queue.setMaxPending(request.body.maxPending);
    request.log.info({
      event: "queue.resized",
      previousMaxPending: resized.previousMaxPending,
      maxPending: resized.maxPending,
      waitingLimit: resized.waitingLimit,
      executionPoolLimit: resized.executionPoolLimit,
    }, "Waiting queue capacity resized");
    return queue.stats();
  });
}
