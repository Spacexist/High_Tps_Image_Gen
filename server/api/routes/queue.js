// Queue 管理接口只调整运行时容量；重启后仍以 config.json 为初始值。
export async function queueRoutes(app, { queue }) {
  app.get("/api/queue", async () => queue.stats());

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
      waiting: resized.waiting,
      overCapacity: resized.overCapacity,
    }, "Queue capacity resized");
    return queue.stats();
  });
}
