// 配置在启动时完成默认值合并、数值校验和相对路径解析。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ValidationError } from "./errors.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, "../..");

const defaults = {
  server: { host: "0.0.0.0", port: 3000, logger: true },
  queue: { maxPending: 10_000, terminalTtlMs: 30 * 60_000 },
  request: {
    timeoutMs: 120_000,
    imagePath: "/v1/images/generations",
    imageEditPath: "/v1/images/edits",
  },
  result: { resultTtlMs: 30 * 60_000, deleteAfterRead: true },
  health: {
    enabled: true,
    runOnStart: false,
    intervalMs: 30_000,
    timeoutMs: 10_000,
    path: "/v1/models",
  },
  keys: { storePath: "data/apikey_pool.json" },
  workbench: {
    cachePath: "data/workbench-cache",
    maxImageBytes: 25 * 1024 * 1024,
    downloadTimeoutMs: 60_000,
    importConcurrency: 5,
  },
};

function merge(base, override) {
  const output = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    output[key] =
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && typeof base?.[key] === "object"
        ? merge(base[key], value)
        : value;
  }
  return output;
}

function requirePositive(config, pathName) {
  const value = pathName.split(".").reduce((current, key) => current?.[key], config);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ValidationError(`Configuration "${pathName}" must be a positive number`);
  }
}

export async function loadConfig(configPath = path.join(projectRoot, "config.json")) {
  const raw = JSON.parse(await readFile(configPath, "utf8"));
  return normalizeConfig(merge(defaults, raw), path.dirname(configPath));
}

export function normalizeConfig(input, baseDir = projectRoot) {
  const config = merge(defaults, input);
  for (const key of [
    "server.port",
    "queue.maxPending",
    "queue.terminalTtlMs",
    "request.timeoutMs",
    "result.resultTtlMs",
    "health.intervalMs",
    "health.timeoutMs",
    "workbench.maxImageBytes",
    "workbench.downloadTimeoutMs",
    "workbench.importConcurrency",
  ]) requirePositive(config, key);

  config.keys.storePath = path.resolve(baseDir, config.keys.storePath);
  config.workbench.cachePath = path.resolve(baseDir, config.workbench.cachePath);
  return config;
}
