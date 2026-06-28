// 图片缓存负责受控下载和原子写入；业务层不直接拼接磁盘路径。
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ValidationError } from "../shared/errors.js";

const CONTENT_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

export class ImageCache {
  constructor({ cachePath, maxImageBytes, downloadTimeoutMs }) {
    this.root = cachePath;
    this.maxImageBytes = maxImageBytes;
    this.downloadTimeoutMs = downloadTimeoutMs;
  }

  async init() {
    await Promise.all([
      mkdir(path.join(this.root, "inputs"), { recursive: true }),
      mkdir(path.join(this.root, "outputs"), { recursive: true }),
    ]);
    return this;
  }

  inputPath(blockId, imageId, extension) {
    return path.join(this.root, "inputs", blockId, `${imageId}${extension}`);
  }

  outputPath(blockId, imageId, extension) {
    return path.join(this.root, "outputs", blockId, `${imageId}${extension}`);
  }

  async downloadInput(blockId, imageId, url) {
    const response = await this.#fetch(url);
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
    const extension = CONTENT_EXTENSIONS.get(contentType);
    if (!extension) throw new ValidationError(`图片 "${blockId}/${imageId}" 格式必须是 JPEG、PNG 或 WebP`);
    const bytes = Buffer.from(await response.arrayBuffer());
    this.#requireAllowedSize(bytes, blockId, imageId);
    await this.#atomicWrite(this.inputPath(blockId, imageId, extension), bytes);
    return { extension, contentType, bytes: bytes.length };
  }

  async cacheOutput(blockId, imageId, result) {
    const item = result?.data?.[0] ?? result;
    let bytes;
    let contentType;
    if (typeof item?.b64_json === "string") {
      bytes = Buffer.from(item.b64_json, "base64");
      contentType = "image/png";
    } else if (typeof item?.url === "string") {
      const response = await this.#fetch(item.url);
      contentType = (response.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
      bytes = Buffer.from(await response.arrayBuffer());
    } else {
      throw new ValidationError("下游结果不包含可缓存的图片");
    }
    const extension = CONTENT_EXTENSIONS.get(contentType) ?? ".png";
    this.#requireAllowedSize(bytes, blockId, imageId);
    await this.#atomicWrite(this.outputPath(blockId, imageId, extension), bytes);
    return { extension, contentType, bytes: bytes.length };
  }

  async exists(filePath) {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async clear() {
    // root 由配置启动时解析为绝对路径，此处只清理 root 下受控的两个子目录。
    await Promise.all([
      rm(path.join(this.root, "inputs"), { recursive: true, force: true }),
      rm(path.join(this.root, "outputs"), { recursive: true, force: true }),
    ]);
    await this.init();
  }

  async #fetch(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.downloadTimeoutMs);
    timer.unref?.();
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new ValidationError(`下载图片失败：HTTP ${response.status}`);
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > this.maxImageBytes) {
        throw new ValidationError(`图片超过 ${this.maxImageBytes} 字节限制`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  #requireAllowedSize(bytes, blockId, imageId) {
    if (!bytes.length || bytes.length > this.maxImageBytes) {
      throw new ValidationError(`图片 "${blockId}/${imageId}" 大小无效或超过限制`);
    }
  }

  async #atomicWrite(target, bytes) {
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, bytes);
    await rename(temp, target);
  }
}
