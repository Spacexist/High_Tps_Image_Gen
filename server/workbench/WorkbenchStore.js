// 工作台元数据使用两个易读 JSON 文件持久化，写入采用临时文件替换，避免进程中断留下半截 JSON。
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function renameIfPresent(source, target) {
  if (source === target) return;
  try {
    await rename(source, target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export class WorkbenchStore {
  constructor(cachePath) {
    this.root = cachePath;
    this.blocksFile = path.join(cachePath, "blocks.json");
    this.tasksFile = path.join(cachePath, "tasks.json");
    this.blocks = [];
    this.tasks = {};
    this.writeChain = Promise.resolve();
  }

  async init() {
    await mkdir(this.root, { recursive: true });
    [this.blocks, this.tasks] = await Promise.all([
      readJson(this.blocksFile, []),
      readJson(this.tasksFile, {}),
    ]);
    await this.#migrateNumericImageIds();
    // 内存队列无法跨进程恢复；retry_wait 仅用于兼容旧版缓存，不再是当前 Core 状态。
    for (const task of Object.values(this.tasks)) {
      if (["pending", "running", "retry_wait"].includes(task.status)) {
        Object.assign(task, { status: "ready", taskId: null, error: null });
      }
      delete task.attempts;
    }
    await this.save();
    return this;
  }

  snapshot() {
    return structuredClone({ blocks: this.blocks, tasks: this.tasks });
  }

  async replace(blocks, tasks) {
    this.blocks = structuredClone(blocks);
    this.tasks = structuredClone(tasks);
    await this.save();
  }

  async save() {
    this.writeChain = this.writeChain.then(async () => {
      await Promise.all([
        this.#atomicJson(this.blocksFile, this.blocks),
        this.#atomicJson(this.tasksFile, this.tasks),
      ]);
    });
    return this.writeChain;
  }

  async #atomicJson(file, value) {
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temp, file);
  }

  async #migrateNumericImageIds() {
    // 已落盘的 front/detail/lifestyle 在启动时一次性迁移，保留原图、结果图和状态。
    const migratedTasks = {};
    for (const block of this.blocks) {
      for (const [index, image] of block.images.entries()) {
        const oldImageId = image.imageId;
        const imageId = String(index + 1).padStart(2, "0");
        const task = this.tasks[`${block.blockId}/${oldImageId}`];

        if (image.input?.extension) {
          await renameIfPresent(
            path.join(this.root, "inputs", block.blockId, `${oldImageId}${image.input.extension}`),
            path.join(this.root, "inputs", block.blockId, `${imageId}${image.input.extension}`),
          );
        }
        if (task?.output?.extension) {
          await renameIfPresent(
            path.join(this.root, "outputs", block.blockId, `${oldImageId}${task.output.extension}`),
            path.join(this.root, "outputs", block.blockId, `${imageId}${task.output.extension}`),
          );
        }

        image.imageId = imageId;
        if (task) {
          task.imageId = imageId;
          migratedTasks[`${block.blockId}/${imageId}`] = task;
        }
      }
    }
    this.tasks = migratedTasks;
  }
}
