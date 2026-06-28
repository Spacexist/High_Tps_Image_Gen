// 内存任务队列保存任务元数据，并维持每个模型的 FIFO 相对顺序。
import { EventEmitter } from "node:events";
import { createId } from "../shared/id.js";
import {
  ConflictError,
  NotFoundError,
  QueueFullError,
  ValidationError,
} from "../shared/errors.js";
import { canTransition, TaskStatus, terminalStatuses } from "./TaskState.js";

function publicTask(task) {
  const safe = structuredClone(task);
  // 本地绝对路径仅供 Core 读取，永远不返回给浏览器。
  if (safe.input) {
    const { _inputFile, _inputContentType, ...publicInput } = safe.input;
    safe.input = publicInput;
  }
  return safe;
}

export class TaskQueue extends EventEmitter {
  constructor({ maxPending = 10_000, terminalTtlMs = 30 * 60_000 } = {}) {
    super();
    this.tasks = new Map();
    this.pendingIds = [];
    this.setMaxPending(maxPending);
    this.terminalTtlMs = terminalTtlMs;
    this.cleanupTimer = setInterval(() => this.cleanup(), Math.min(terminalTtlMs, 60_000));
    this.cleanupTimer.unref?.();
  }

  create(input) {
    if (this.waitingCount() >= this.maxPending) {
      throw new QueueFullError(`Task queue is full (${this.waitingCount()}/${this.maxPending})`);
    }
    const now = new Date().toISOString();
    const task = {
      id: createId("task"),
      status: TaskStatus.PENDING,
      input: structuredClone(input),
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      keyID: null,
      error: null,
      resultAvailable: false,
    };
    this.tasks.set(task.id, task);
    this.pendingIds.push(task.id);
    this.emit("pending");
    return publicTask(task);
  }

  claimFirst(canRun) {
    for (let index = 0; index < this.pendingIds.length; index += 1) {
      const id = this.pendingIds[index];
      const task = this.tasks.get(id);
      if (!task || task.status !== TaskStatus.PENDING) {
        this.pendingIds.splice(index, 1);
        index -= 1;
        continue;
      }
      const resource = canRun(task);
      if (!resource) continue;
      this.pendingIds.splice(index, 1);
      this.transition(task, TaskStatus.RUNNING);
      task.startedAt ??= task.updatedAt;
      task.keyID = resource.keyID ?? null;
      // Runner 需要内部输入，因此这里返回包含本地输入路径的完整副本。
      return { task: structuredClone(task), resource };
    }
    return null;
  }

  complete(id) {
    const task = this.requireTask(id);
    this.transition(task, TaskStatus.COMPLETED);
    task.completedAt = task.updatedAt;
    task.resultAvailable = true;
    task.error = null;
    return publicTask(task);
  }

  fail(id, error) {
    const task = this.requireTask(id);
    this.transition(task, TaskStatus.FAILED);
    task.completedAt = task.updatedAt;
    task.error = structuredClone(error);
    return publicTask(task);
  }

  cancel(id) {
    const task = this.requireTask(id);
    if (task.status !== TaskStatus.PENDING) {
      throw new ConflictError(`Task "${id}" cannot be cancelled while ${task.status}`);
    }
    this.pendingIds = this.pendingIds.filter((taskId) => taskId !== id);
    this.transition(task, TaskStatus.CANCELLED);
    task.completedAt = task.updatedAt;
    return publicTask(task);
  }

  get(id) {
    return publicTask(this.requireTask(id));
  }

  list({ page = 1, limit = 50 } = {}) {
    const all = [...this.tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const start = (page - 1) * limit;
    return {
      items: all.slice(start, start + limit).map(publicTask),
      page,
      limit,
      total: all.length,
    };
  }

  markResultConsumed(id) {
    const task = this.tasks.get(id);
    if (task) task.resultAvailable = false;
  }

  waitingCount() {
    return this.pendingIds.length;
  }

  setMaxPending(maxPending) {
    // 缩容只改变后续接收门槛，绝不删除已经进入 FIFO 的任务。
    if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 1_000_000) {
      throw new ValidationError("maxPending 必须是 1–1000000 之间的整数");
    }
    const previousMaxPending = this.maxPending;
    this.maxPending = maxPending;
    return { previousMaxPending, ...this.capacity() };
  }

  capacity() {
    const waiting = this.waitingCount();
    return {
      maxPending: this.maxPending,
      waiting,
      remainingCapacity: Math.max(0, this.maxPending - waiting),
      overCapacity: Math.max(0, waiting - this.maxPending),
    };
  }

  stats() {
    const byStatus = {};
    for (const status of Object.values(TaskStatus)) byStatus[status] = 0;
    for (const task of this.tasks.values()) byStatus[task.status] += 1;
    return { total: this.tasks.size, ...this.capacity(), byStatus };
  }

  cleanup(now = Date.now()) {
    for (const [id, task] of this.tasks) {
      if (!terminalStatuses.has(task.status) || !task.completedAt) continue;
      if (now - Date.parse(task.completedAt) >= this.terminalTtlMs) this.tasks.delete(id);
    }
  }

  transition(task, nextStatus) {
    if (!canTransition(task.status, nextStatus)) {
      throw new ConflictError(`Invalid task transition: ${task.status} -> ${nextStatus}`);
    }
    task.status = nextStatus;
    task.updatedAt = new Date().toISOString();
  }

  requireTask(id) {
    const task = this.tasks.get(id);
    if (!task) throw new NotFoundError(`Task "${id}" not found`);
    return task;
  }

  stop() {
    clearInterval(this.cleanupTimer);
  }
}
