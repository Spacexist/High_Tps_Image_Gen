// ID 前缀便于日志中快速区分任务、原始 Key 等不同实体。
import { randomUUID } from "node:crypto";

export function createId(prefix) {
  return `${prefix}_${randomUUID()}`;
}
