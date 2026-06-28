import type { ImportBlock } from "./loadJson";
import type { WorkbenchSnapshot } from "../models";
import { apiJson } from "../request/api";

// 导入不是只存 URL：服务端会在返回前把所有原图写入本地 cache。
export function cacheInputs(blocks: ImportBlock[]): Promise<WorkbenchSnapshot> {
  return apiJson("/api/workbench/import", { method: "POST", body: JSON.stringify(blocks) });
}
