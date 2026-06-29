// 工作台服务把“磁盘缓存”和“Core 内存队列”连接起来，但不参与 Key 分配。
import { NotFoundError, ValidationError } from "../shared/errors.js";
import { parseWorkbenchJson } from "./JsonImporter.js";

const taskKey = (blockId, imageId) => `${blockId}/${imageId}`;

async function mapLimited(items, limit, worker) {
  const pending = [...items];
  const workers = Array.from({ length: Math.min(limit, pending.length) }, async () => {
    while (pending.length) await worker(pending.shift());
  });
  await Promise.all(workers);
}

export class WorkbenchService {
  constructor({ store, imageCache, queue, importConcurrency = 5, logger = console }) {
    this.store = store;
    this.imageCache = imageCache;
    this.queue = queue;
    this.importConcurrency = importConcurrency;
    this.logger = logger;
  }

  snapshot() {
    const snapshot = this.store.snapshot();
    return {
      blocks: snapshot.blocks.map((block) => ({
        ...block,
        images: block.images.map((image) => {
          const state = snapshot.tasks[taskKey(block.blockId, image.imageId)];
          return {
            ...image,
            state,
            inputUrl: `/api/workbench/assets/input/${block.blockId}/${image.imageId}`,
            outputUrl: state?.output
              ? `/api/workbench/assets/output/${block.blockId}/${image.imageId}?v=${encodeURIComponent(state.updatedAt)}`
              : null,
          };
        }),
      })),
    };
  }

  async import(input) {
    const blocks = parseWorkbenchJson(input);
    const jobs = blocks.flatMap((block) => block.images.map((image) => ({ block, image })));

    await mapLimited(jobs, this.importConcurrency, async ({ block, image }) => {
      image.input = await this.imageCache.downloadInput(block.blockId, image.imageId, image.url);
    });

    const now = new Date().toISOString();
    const tasks = Object.fromEntries(jobs.map(({ block, image }) => [
      taskKey(block.blockId, image.imageId),
      {
        blockId: block.blockId,
        imageId: image.imageId,
        taskId: null,
        status: "ready",
        error: null,
        output: null,
        updatedAt: now,
      },
    ]));
    await this.store.replace(blocks, tasks);
    this.logger.info?.({
      event: "workbench.imported",
      blocks: blocks.length,
      images: jobs.length,
    }, "Workbench imported");
    return this.snapshot();
  }

  async updateBlock(blockId, patch) {
    const block = this.#requireBlock(blockId);
    if (typeof patch.prompt === "string") block.prompt = patch.prompt;
    if (typeof patch.listing === "string" && patch.listing.trim()) {
      block.listing = patch.listing.trim();
    }
    if (patch.imageId) {
      const image = block.images.find((item) => item.imageId === patch.imageId);
      if (!image) throw new NotFoundError(`Image "${blockId}/${patch.imageId}" not found`);
      if (typeof patch.promptOverride === "string") image.promptOverride = patch.promptOverride;
    }
    await this.store.save();
    return this.snapshot();
  }

  async submit({ blockId, imageId, imageUrl, model, prompt, size = "1024x1024" }) {
    if (!model?.trim()) throw new ValidationError("model 不能为空");
    const block = this.#requireBlock(blockId);
    const image = block.images.find((item) => item.imageId === imageId);
    if (!image) throw new NotFoundError(`Image "${blockId}/${imageId}" not found`);
    if (typeof imageUrl !== "string" || imageUrl !== image.url) {
      throw new ValidationError(`图片 "${blockId}/${imageId}" 的 imageUrl 与已缓存原图不一致`);
    }
    const finalPrompt = typeof prompt === "string" && prompt.trim()
      ? prompt.trim()
      : (image.promptOverride || block.prompt).trim();
    if (!finalPrompt) {
      throw new ValidationError(`图片 "${blockId}/${imageId}" 没有可提交的 prompt`);
    }

    const created = this.queue.create({
      blockId,
      imageId,
      imageUrl,
      model: model.trim(),
      prompt: finalPrompt,
      size,
      n: 1,
      // URL 留在公开任务结构中用于审计；Core 从缓存文件读取真实二进制。
      _inputFile: this.imageCache.inputPath(blockId, imageId, image.input.extension),
      _inputContentType: image.input.contentType,
      _workbench: { blockId, imageId },
    });
    this.store.tasks[taskKey(blockId, imageId)] = {
      blockId,
      imageId,
      taskId: created.id,
      status: created.status,
      error: null,
      output: null,
      updatedAt: created.updatedAt,
    };
    await this.store.save();
    return created;
  }

  async clear() {
    await this.imageCache.clear();
    await this.store.replace([], {});
  }

  asset(kind, blockId, imageId) {
    const block = this.#requireBlock(blockId);
    const image = block.images.find((item) => item.imageId === imageId);
    if (!image) throw new NotFoundError(`Image "${blockId}/${imageId}" not found`);
    if (kind === "input") {
      return {
        path: this.imageCache.inputPath(blockId, imageId, image.input.extension),
        contentType: image.input.contentType,
      };
    }
    const task = this.store.tasks[taskKey(blockId, imageId)];
    if (!task?.output) throw new NotFoundError(`Output "${blockId}/${imageId}" not found`);
    return {
      path: this.imageCache.outputPath(blockId, imageId, task.output.extension),
      contentType: task.output.contentType,
    };
  }

  async started(task) {
    await this.#setTaskState(task, { status: "running" });
  }

  async failed(task, error) {
    await this.#setTaskState(task, { status: "failed", error });
  }

  async completed(task, result) {
    const ref = task.input?._workbench;
    if (!ref) return;
    try {
      const output = await this.imageCache.cacheOutput(ref.blockId, ref.imageId, result);
      await this.#setTaskState(task, { status: "completed", error: null, output });
    } catch (error) {
      this.logger.error?.({ err: error, taskId: task.id, ...ref }, "Workbench output cache failed");
      await this.#setTaskState(task, {
        status: "failed",
        error: { code: "CACHE_ERROR", message: error.message },
      });
    }
  }

  async #setTaskState(task, patch) {
    const ref = task.input?._workbench;
    if (!ref) return;
    const key = taskKey(ref.blockId, ref.imageId);
    const current = this.store.tasks[key];
    if (!current || current.taskId !== task.id) return;
    Object.assign(current, patch, { updatedAt: new Date().toISOString() });
    await this.store.save();
  }

  #requireBlock(blockId) {
    const block = this.store.blocks.find((item) => item.blockId === blockId);
    if (!block) throw new NotFoundError(`Block "${blockId}" not found`);
    return block;
  }
}
