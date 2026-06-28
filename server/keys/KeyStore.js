// KeyStore 只持久化不重复的原始 Key；运行时副本绝不写进 JSON。
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ConflictError, NotFoundError } from "../shared/errors.js";
import { normalizeSourceKey } from "./KeyFactory.js";

export class KeyStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.keys = new Map();
    this.writeQueue = Promise.resolve();
  }

  async load() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    let rows;
    try {
      rows = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      rows = [];
      await this.persist();
    }
    if (!Array.isArray(rows)) throw new Error("Key store must contain a JSON array");

    this.keys.clear();
    for (const row of rows) {
      const key = normalizeSourceKey(row);
      if (this.keys.has(key.id)) throw new ConflictError(`Duplicate key id: ${key.id}`);
      this.keys.set(key.id, key);
    }
    return this.list();
  }

  list() {
    return [...this.keys.values()].map((key) => structuredClone(key));
  }

  get(id) {
    const key = this.keys.get(id);
    return key ? structuredClone(key) : null;
  }

  async add(input) {
    const key = normalizeSourceKey(input);
    if (this.keys.has(key.id)) throw new ConflictError(`Key "${key.id}" already exists`);
    this.keys.set(key.id, key);
    await this.persist();
    return structuredClone(key);
  }

  async update(id, patch) {
    const current = this.keys.get(id);
    if (!current) throw new NotFoundError(`Key "${id}" not found`);
    const key = normalizeSourceKey({ ...patch, id }, current);
    this.keys.set(id, key);
    await this.persist();
    return structuredClone(key);
  }

  async remove(id) {
    const key = this.keys.get(id);
    if (!key) throw new NotFoundError(`Key "${id}" not found`);
    this.keys.delete(id);
    await this.persist();
    return structuredClone(key);
  }

  // 临时文件写完后原子 rename，避免进程在半次写入时留下损坏 JSON。
  async persist() {
    const rows = [...this.keys.values()];
    this.writeQueue = this.writeQueue.then(async () => {
      const tempPath = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
      await rename(tempPath, this.filePath);
    });
    return this.writeQueue;
  }
}
