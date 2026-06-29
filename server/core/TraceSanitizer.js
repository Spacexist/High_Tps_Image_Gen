// 运行日志会返回给浏览器：这里统一裁剪体积并屏蔽认证信息，避免日志本身成为泄密点。
const SECRET_KEY = /authorization|api[-_]?key|token|secret|password/i;
const BINARY_KEY = /b64_json|base64|binary|bytes/i;

export function sanitizeTrace(value, depth = 0, key = "") {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (value === null || value === undefined) return value ?? null;
  if (depth > 8) return "[MAX_DEPTH]";

  if (typeof value === "string") {
    if (BINARY_KEY.test(key)) return `[BINARY OMITTED · ${value.length} chars]`;
    return value.length > 4_000
      ? `${value.slice(0, 4_000)}… [TRUNCATED · ${value.length} chars]`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeTrace(item, depth + 1, key));
  }
  if (typeof value === "object") {
    const safe = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 100)) {
      safe[childKey] = sanitizeTrace(childValue, depth + 1, childKey);
    }
    return safe;
  }
  return String(value);
}
