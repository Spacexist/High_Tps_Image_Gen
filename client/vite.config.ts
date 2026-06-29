import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const clientRoot = path.dirname(fileURLToPath(import.meta.url));

// 不使用 public/：开发时中间件直接返回根 config.json，构建时再写入 dist。
function runtimeConfig(): Plugin {
  const configFile = path.resolve(clientRoot, "config.json");
  return {
    name: "runtime-config",
    configureServer(server) {
      // config.json 不在模块图里，监听后整页刷新才能立即应用窗口参数。
      server.watcher.add(configFile);
      server.watcher.on("change", (changedFile) => {
        if (path.resolve(changedFile) === configFile) server.ws.send({ type: "full-reload" });
      });
      server.middlewares.use("/config.json", (_request, response) => {
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.setHeader("cache-control", "no-store");
        response.end(readFileSync(configFile));
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "config.json",
        source: readFileSync(configFile, "utf8"),
      });
    },
  };
}

export default defineConfig({
  publicDir: false,
  plugins: [react(), runtimeConfig()],
  server: { port: 5173 },
});
