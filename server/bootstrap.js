// 应用装配入口，测试可注入假的下游执行器。
import Fastify from "fastify";
import { AppError } from "./shared/errors.js";
import { normalizeConfig } from "./shared/config.js";
import { KeyStore } from "./keys/KeyStore.js";
import { KeyManager } from "./keys/KeyManager.js";
import { HealthTester } from "./keys/HealthTester.js";
import { TaskQueue } from "./core/TaskQueue.js";
import { ResultStore } from "./core/ResultStore.js";
import { RetryPolicy } from "./core/RetryPolicy.js";
import { RequestExecutor } from "./core/RequestExecutor.js";
import { TaskRunner } from "./core/TaskRunner.js";
import { Dispatcher } from "./core/Dispatcher.js";
import { WorkbenchStore } from "./workbench/WorkbenchStore.js";
import { ImageCache } from "./workbench/ImageCache.js";
import { WorkbenchService } from "./workbench/WorkbenchService.js";
import { taskRoutes } from "./api/routes/tasks.js";
import { keyRoutes } from "./api/routes/keys.js";
import { statusRoutes } from "./api/routes/status.js";
import { workbenchRoutes } from "./api/routes/workbench.js";

export async function buildApp({
  config: inputConfig,
  configBaseDir,
  keyStorePath,
  executor,
  healthRequestFn,
  logger,
} = {}) {
  const config = normalizeConfig(inputConfig ?? {}, configBaseDir);
  if (keyStorePath) config.keys.storePath = keyStorePath;
  const app = Fastify({ logger: logger ?? config.server.logger });

  // 允许 Vite 开发端口或 config.json 指向的前端访问 API；本地工具不启用 Cookie 凭据。
  app.addHook("onRequest", async (request, reply) => {
    reply.header("access-control-allow-origin", request.headers.origin ?? "*");
    reply.header("access-control-allow-methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    reply.header("access-control-allow-headers", "content-type,authorization");
    if (request.method === "OPTIONS") return reply.code(204).send();
  });

  // 装配顺序明确分层：原始 Key -> 物理 KeyPool -> Core -> 工作台持久层 -> HTTP API。
  const keyStore = new KeyStore(config.keys.storePath);
  const keyManager = await new KeyManager({ store: keyStore, logger: app.log }).init();
  const healthTester = new HealthTester({
    keyManager,
    config: config.health,
    requestFn: healthRequestFn,
    logger: app.log,
  });
  const queue = new TaskQueue(config.queue);
  const resultStore = new ResultStore(config.result);
  const retryPolicy = new RetryPolicy(config.retry);
  const workbenchStore = await new WorkbenchStore(config.workbench.cachePath).init();
  const imageCache = await new ImageCache(config.workbench).init();
  const workbenchService = new WorkbenchService({
    store: workbenchStore,
    imageCache,
    queue,
    importConcurrency: config.workbench.importConcurrency,
    logger: app.log,
  });
  const requestExecutor = executor ?? new RequestExecutor(config.request);
  const runner = new TaskRunner({
    queue,
    keyManager,
    executor: requestExecutor,
    retryPolicy,
    resultStore,
    taskObserver: workbenchService,
    logger: app.log,
  });
  const dispatcher = new Dispatcher({
    queue,
    keyManager,
    runner,
    dispatchRatePerSecond: config.queue.dispatchRatePerSecond,
    logger: app.log,
  });
  const services = {
    keyStore,
    keyManager,
    healthTester,
    queue,
    resultStore,
    retryPolicy,
    requestExecutor,
    runner,
    dispatcher,
    workbenchStore,
    imageCache,
    workbenchService,
  };

  await app.register(taskRoutes, services);
  await app.register(keyRoutes, services);
  await app.register(statusRoutes, services);
  await app.register(workbenchRoutes, services);

  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof AppError;
    const statusCode = known ? error.statusCode : (error.statusCode && error.statusCode < 500 ? error.statusCode : 500);
    if (statusCode >= 500) request.log.error({ err: error }, "Request failed");
    reply.code(statusCode).send({
      error: {
        code: known ? error.code : (error.code ?? "INTERNAL_ERROR"),
        message: statusCode >= 500 && !known ? "Internal server error" : error.message,
        details: known ? error.details : undefined,
      },
    });
  });

  app.addHook("onClose", async () => {
    dispatcher.stop();
    healthTester.stop();
    queue.stop();
    resultStore.stop();
  });

  dispatcher.start();
  healthTester.start();
  return { app, services, config };
}
