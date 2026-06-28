// 工作台 API：JSON 导入、磁盘缓存读取、prompt 更新和单图任务提交。
import { createReadStream } from "node:fs";

export async function workbenchRoutes(app, { workbenchService }) {
  app.get("/api/workbench", async () => workbenchService.snapshot());

  app.post("/api/workbench/import", async (request, reply) => {
    const snapshot = await workbenchService.import(request.body);
    return reply.code(201).send(snapshot);
  });

  app.patch("/api/workbench/blocks/:blockId", async (request) => (
    workbenchService.updateBlock(request.params.blockId, request.body ?? {})
  ));

  app.post("/api/workbench/tasks", {
    schema: {
      body: {
        type: "object",
        required: ["blockId", "imageId", "model"],
        properties: {
          blockId: { type: "string", minLength: 1 },
          imageId: { type: "string", minLength: 1 },
          model: { type: "string", minLength: 1 },
          prompt: { type: "string" },
          size: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const task = await workbenchService.submit(request.body);
    return reply.code(202).send(task);
  });

  app.get("/api/workbench/assets/:kind/:blockId/:imageId", async (request, reply) => {
    const asset = workbenchService.asset(request.params.kind, request.params.blockId, request.params.imageId);
    reply.type(asset.contentType);
    // createReadStream 避免把大图整体复制到 Node 堆内存。
    return reply.send(createReadStream(asset.path));
  });

  app.delete("/api/workbench", async (_request, reply) => {
    await workbenchService.clear();
    return reply.code(204).send();
  });
}
