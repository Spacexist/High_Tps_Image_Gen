import type { RuntimeConfig } from "../models";

export async function loadConfig(): Promise<RuntimeConfig> {
  const response = await fetch("/config.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`读取 config.json 失败：HTTP ${response.status}`);
  const config = await response.json() as RuntimeConfig;
  return config;
}
