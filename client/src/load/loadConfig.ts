import type { RuntimeConfig } from "../models";

export async function loadConfig(): Promise<RuntimeConfig> {
  const response = await fetch("/config.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`读取 config.json 失败：HTTP ${response.status}`);
  const config = await response.json() as RuntimeConfig;
  if (!Number.isInteger(config.req_max_limit) || config.req_max_limit < 1) {
    throw new Error("config.json 的 req_max_limit 必须是正整数");
  }
  return config;
}
