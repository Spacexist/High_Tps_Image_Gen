import type { RuntimeConfig } from "../models";

let apiOrigin = "";

export function configureApi(config: RuntimeConfig) {
  apiOrigin = `${config.server.protocol}://${config.server.host}:${config.server.port}`;
}

export function absoluteApiUrl(path: string) {
  return path.startsWith("http") ? path : `${apiOrigin}${path}`;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(absoluteApiUrl(path), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? `请求失败：HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
