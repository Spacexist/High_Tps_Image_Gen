// 任务提交、查询和取消接口。
import { terminalStatuses } from "../../core/TaskState.js";

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
    request.log.info({
      event: "task.accepted",
      taskId: task.id,
      model: task.input.model,
    }, "Task accepted");
    // finish 代表响应已经真正写完；不能在 send 前就伪称 RESPONSE_SENT。
    reply.raw.once("finish", () => queue.recordResponseSent(task.id, {
      kind: "accepted",
      endpoint: "/api/tasks",
      statusCode: 202,
      body: { id: task.id, status: task.status },
    }));
    return reply.code(202).send(task);
  });

  // Core 管理页仍可使用任务历史；真正的多阶段日志由 /api/queue/events 提供。
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

  app.get("/api/tasks/:id", async (request, reply) => {
    const task = queue.get(request.params.id);
    // 工作台只需状态、错误和结果；后端上游 Trace 不发送到工作台轮询接口。
    const { trace: _backendTrace, ...workbenchTask } = task;
    let response = workbenchTask;
    if (task.resultAvailable) {
      const result = resultStore.get(task.id);
      if (!resultStore.has(task.id)) queue.markResultConsumed(task.id);
      response = result === null
        ? { ...workbenchTask, resultAvailable: false }
        : { ...workbenchTask, result };
    }

    // 前端可能每秒轮询；同一任务只记一次真正的最终响应。
    if (terminalStatuses.has(task.status)) {
      reply.raw.once("finish", () => queue.recordResponseSent(task.id, {
        kind: "final",
        endpoint: `/api/tasks/${task.id}`,
        statusCode: 200,
        body: {
          id: task.id,
          status: task.status,
          resultAvailable: Boolean(response.result),
          error: task.error,
        },
      }));
    }
    return response;
  });

  app.delete("/api/tasks/:id", async (request) => {
    resultStore.delete(request.params.id);
    return queue.cancel(request.params.id);
  });
}
