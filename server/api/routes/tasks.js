// 任务提交、查询和取消接口。
export async function taskRoutes(app, { queue, resultStore }) {
  app.post("/api/tasks", {
    schema: {
      body: {
        type: "object",
        required: ["model", "prompt"],
        properties: {
          model: { type: "string", minLength: 1 },
          prompt: { type: "string", minLength: 1 },
        },
        additionalProperties: true,
      },
    },
  }, async (request, reply) => {
    const task = queue.create(request.body);
    return reply.code(202).send(task);
  });

  app.get("/api/tasks", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1, default: 1 },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        },
      },
    },
  }, async (request) => queue.list(request.query));

  app.get("/api/tasks/:id", async (request) => {
    const task = queue.get(request.params.id);
    if (!task.resultAvailable) return task;
    const result = resultStore.get(task.id);
    if (!resultStore.has(task.id)) queue.markResultConsumed(task.id);
    return result === null ? { ...task, resultAvailable: false } : { ...task, result };
  });

  app.delete("/api/tasks/:id", async (request) => {
    resultStore.delete(request.params.id);
    return queue.cancel(request.params.id);
  });
}
