// 内存任务队列保存任务元数据，并维持每个模型的 FIFO 相对顺序。
import { EventEmitter } from "node:events";
import { createId } from "../shared/id.js";
import { ConflictError, NotFoundError, QueueFullError } from "../shared/errors.js";
import { canTransition, TaskStatus, terminalStatuses } from "./TaskState.js";

function publicTask(task) {
  const { retryTimer: _retryTimer, ...safe } = task;
  return structuredClone(safe);
}

export class TaskQueue extends EventEmitter {
  constructor({ maxPending = 10_000, terminalTtlMs = 30 * 60_000 } = {}) {
    super();
    this.maxPending = maxPending;
    this.terminalTtlMs = terminalTtlMs;
    this.tasks = new Map();
    this.pendingIds = [];
    this.cleanupTimer = setInterval(() => this.cleanup(), Math.min(terminalTtlMs, 60_000));
    this.cleanupTimer.unref?.();
  }

  create(input) {
    if (this.waitingCount() >= this.maxPending) throw new QueueFullError();
    const now = new Date().toISOString();
    const task = {
      id: createId("task"),
      status: TaskStatus.PENDING,
      input: structuredClone(input),
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      nextAttemptAt: null,
      keyID: null,
      error: null,
      resultAvailable: false,
    };
    this.tasks.set(task.id, task);
    this.pendingIds.push(task.id);
    this.emit("pending");
    return publicTask(task);
  }

  // 从队首向后寻找“当前有匹配 Key”的首个任务；被某模型卡住时不会阻塞其他模型。
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
      task.attempts += 1;
      task.startedAt ??= task.updatedAt;
      task.keyID = resource.keyID ?? null;
      return { task: publicTask(task), resource };
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

  retry(id, delayMs, error) {
    const task = this.requireTask(id);
    this.transition(task, TaskStatus.RETRY_WAIT);
    task.error = structuredClone(error);
    task.nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
    // 重试计时器只负责重新入队；重试策略本身属于 Core，不属于 Key 模块。
    task.retryTimer = setTimeout(() => {
      if (task.status !== TaskStatus.RETRY_WAIT) return;
      this.transition(task, TaskStatus.PENDING);
      task.nextAttemptAt = null;
      task.keyID = null;
      this.pendingIds.push(task.id);
      this.emit("pending");
    }, delayMs);
    task.retryTimer.unref?.();
    return publicTask(task);
  }

  cancel(id) {
    const task = this.requireTask(id);
    if (![TaskStatus.PENDING, TaskStatus.RETRY_WAIT].includes(task.status)) {
      throw new ConflictError(`Task "${id}" cannot be cancelled while ${task.status}`);
    }
    if (task.retryTimer) clearTimeout(task.retryTimer);
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
    return { items: all.slice(start, start + limit).map(publicTask), page, limit, total: all.length };
  }

  markResultConsumed(id) {
    const task = this.tasks.get(id);
    if (task) task.resultAvailable = false;
  }

  waitingCount() {
    let count = this.pendingIds.length;
    for (const task of this.tasks.values()) if (task.status === TaskStatus.RETRY_WAIT) count += 1;
    return count;
  }

  stats() {
    const byStatus = {};
    for (const status of Object.values(TaskStatus)) byStatus[status] = 0;
    for (const task of this.tasks.values()) byStatus[task.status] += 1;
    return { total: this.tasks.size, waiting: this.waitingCount(), byStatus };
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
    for (const task of this.tasks.values()) if (task.retryTimer) clearTimeout(task.retryTimer);
  }
}
