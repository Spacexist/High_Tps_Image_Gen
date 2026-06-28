import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const clientRoot = path.dirname(fileURLToPath(import.meta.url));

// 不使用 public/：开发时中间件直接返回根 config.json，构建时再把同一份配置写入 dist。
function runtimeConfig(): Plugin {
  const configFile = path.resolve(clientRoot, "config.json");
  return {
    name: "runtime-config",
    configureServer(server) {
      server.middlewares.use("/config.json", (_request, response) => {
        response.setHeader("content-type", "application/json; charset=utf-8");
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
