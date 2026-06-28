// 生产启动入口。
import { buildApp } from "./bootstrap.js";
import { loadConfig } from "./shared/config.js";

const config = await loadConfig();
const { app } = await buildApp({ config });

// 收到退出信号时先停止接收请求，再清理调度器和健康检查定时器。
async function shutdown(signal) {
  app.log.info({ signal }, "Shutting down");
  await app.close();
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.server.host, port: config.server.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
