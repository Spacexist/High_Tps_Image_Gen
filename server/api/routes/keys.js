// 原始 Key 管理、物理 KeyPool 快照与人工健康检查接口。
const keyBodySchema = {
  type: "object",
  required: ["baseUrl", "apiKey", "models", "concurrency"],
  properties: {
    id: { type: "string", minLength: 1 },
    name: { type: "string" },
    baseUrl: { type: "string", minLength: 1 },
    apiKey: { type: "string", minLength: 1 },
    models: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    concurrency: { type: "integer", minimum: 1, maximum: 10000 },
    enabled: { type: "boolean" },
  },
  additionalProperties: false,
};

export async function keyRoutes(app, { keyManager, healthTester }) {
  app.get("/api/keys", async () => ({ items: keyManager.list(), stats: keyManager.getStats() }));

  // 快照只包含 keyID、模型、generation 与租约状态，不返回明文 apiKey。
  app.get("/api/keys/pool", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 2000, default: 500 },
        },
      },
    },
  }, async (request) => keyManager.getPoolSnapshot({ limit: request.query.limit }));

  app.post("/api/keys", { schema: { body: keyBodySchema } }, async (request, reply) => {
    const key = await keyManager.create(request.body);
    return reply.code(201).send(key);
  });

  app.put("/api/keys/:id", {
    schema: { body: { ...keyBodySchema, required: [], properties: { ...keyBodySchema.properties, id: false } } },
  }, async (request) => keyManager.update(request.params.id, request.body));

  app.delete("/api/keys/:id", async (request) => keyManager.remove(request.params.id));
  app.post("/api/keys/:id/toggle", async (request) => keyManager.toggle(request.params.id));
  app.post("/api/keys/:id/health-test", async (request) => healthTester.runOne(request.params.id));
  app.post("/api/keys/health-test", async () => ({ items: await healthTester.runAll() }));
}
