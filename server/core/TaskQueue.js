// Core 由 execution_pool 与 waiting_queue 组成，并保存追加式后端生命周期事件。
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
  // 本地绝对路径与内部工作台引用只供 Core 使用，永远不返回浏览器。
  if (safe.input) {
    const { _inputFile, _inputContentType, _workbench, ...publicInput } = safe.input;
    safe.input = publicInput;
  }
  return safe;
}

function publicEvent(event) {
  const { _onceKey, ...safe } = event;
  return structuredClone(safe);
}

function taskPosition(task) {
  return {
    taskId: task?.id ?? null,
    blockId: task?.input?.blockId ?? null,
    imageId: task?.input?.imageId ?? null,
    status: task?.status ?? null,
    keyID: task?.keyID ?? null,
  };
}

export class TaskQueue extends EventEmitter {
  constructor({
    maxPending = 10_000,
    terminalTtlMs = 30 * 60_000,
    eventLimit = 2_000,
    executionPoolCapacity = () => 0,
  } = {}) {
    super();
    this.tasks = new Map();
    this.pendingIds = [];
    this.events = [];
    this.eventSequence = 0;
    this.eventOnce = new Set();
    // execution_pool 的物理容量由 KeyPool 副本数决定，不再由 Queue 人为切半。
    this.executionPoolCapacity = executionPoolCapacity;
    this.eventLimit = Math.max(100, Math.min(20_000, Number(eventLimit) || 2_000));
    this.setMaxPending(maxPending);
    this.terminalTtlMs = terminalTtlMs;
    this.cleanupTimer = setInterval(() => this.cleanup(), Math.min(terminalTtlMs, 60_000));
    this.cleanupTimer.unref?.();
  }

  create(input) {
    const capacity = this.capacity();
    if (capacity.waiting >= capacity.waitingLimit) {
      // 即使任务没有被创建，管理页也应看见 Core 拒绝了哪个请求。
      this.recordEvent("SYSTEM_BUSY", {
        level: "error",
        detail: `排队队列已满（${capacity.waiting}/${capacity.waitingLimit}），请求被拒绝。`,
        payload: {
          request: {
            model: input?.model ?? null,
            blockId: input?.blockId ?? null,
            imageId: input?.imageId ?? null,
          },
          response: { statusCode: 503, code: "QUEUE_FULL" },
        },
      });
      throw new QueueFullError(
        `系统繁忙，请稍后再试（排队队列 ${capacity.waiting}/${capacity.waitingLimit}）`,
      );
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
      trace: { request: null, response: null },
    };
    this.tasks.set(task.id, task);
    this.pendingIds.push(task.id);
    this.recordEvent("REQUEST_ACCEPTED", {
      task,
      detail: "Core 已接收并校验客户端提交的任务请求。",
      payload: {
        request: {
          endpoint: task.input.blockId ? "/api/workbench/tasks" : "/api/tasks",
          method: "POST",
          body: publicTask(task).input,
        },
      },
    });
    this.recordEvent("QUEUED", {
      task,
      detail: "任务已进入 waiting_queue，等待执行槽位与可用 Key。",
    });
    this.emit("pending");
    return publicTask(task);
  }

  claimFirst(canRun) {
    // 严格 FIFO：永远只看 waiting_queue 的队首，不允许后来的任务插队。
    // 队首只有在成功租到 Key 副本后才进入 execution_pool。
    while (this.pendingIds.length > 0) {
      const id = this.pendingIds[0];
      const task = this.tasks.get(id);
      if (!task || task.status !== TaskStatus.PENDING) {
        this.pendingIds.shift();
        continue;
      }

      const resource = canRun(task);
      if (!resource) return null;

      this.pendingIds.shift();
      this.transition(task, TaskStatus.RUNNING);
      task.startedAt ??= task.updatedAt;
      task.keyID = resource.keyID ?? null;
      this.recordEvent("EXECUTING", {
        task,
        detail: `任务已从 waiting_queue 队首进入 execution_pool，使用 Key ${task.keyID ?? "未分配"}。`,
        payload: { assignment: { keyID: task.keyID } },
      });
      return { task: structuredClone(task), resource };
    }
    return null;
  }

  setTrace(id, patch) {
    const task = this.requireTask(id);
    task.trace = { ...(task.trace || {}), ...structuredClone(patch) };
    task.updatedAt = new Date().toISOString();

    // Request/Response 分别形成独立事件，不能被最终状态覆盖。
    if (Object.hasOwn(patch, "request")) {
      this.recordEvent("UPSTREAM_REQUEST_SENT", {
        task,
        detail: "Core 已向上游图片服务发送请求。",
        payload: { request: task.trace.request },
      });
    }
    if (Object.hasOwn(patch, "response")) {
      const ok = task.trace.response?.ok !== false
        && Number(task.trace.response?.statusCode ?? 200) < 400;
      this.recordEvent("UPSTREAM_RESPONSE_RECEIVED", {
        task,
        level: ok ? "success" : "error",
        detail: `Core 已收到上游响应，HTTP ${task.trace.response?.statusCode ?? "未知"}。`,
        payload: { response: task.trace.response },
      });
    }
    return publicTask(task);
  }

  complete(id) {
    const task = this.requireTask(id);
    this.transition(task, TaskStatus.COMPLETED);
    task.completedAt = task.updatedAt;
    task.resultAvailable = true;
    task.error = null;
    this.recordEvent("COMPLETED", {
      task,
      level: "success",
      detail: "任务执行完成，结果已写入 ResultStore。",
      payload: { resultAvailable: true },
    });
    return publicTask(task);
  }

  fail(id, error) {
    const task = this.requireTask(id);
    this.transition(task, TaskStatus.FAILED);
    task.completedAt = task.updatedAt;
    task.error = structuredClone(error);
    this.recordEvent("FAILED", {
      task,
      level: "error",
      detail: task.error?.message ?? "任务执行失败。",
      payload: { error: task.error },
    });
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
    this.recordEvent("CANCELLED", {
      task,
      level: "warning",
      detail: "任务在 waiting_queue 中被客户端取消。",
    });
    return publicTask(task);
  }

  // 路由在实际 send 前调用；onceKey 防止前端轮询重复制造 FINAL_RESPONSE_SENT。
  recordResponseSent(id, {
    statusCode,
    endpoint,
    kind = "accepted",
    body,
  }) {
    const task = this.requireTask(id);
    const event = kind === "final" ? "FINAL_RESPONSE_SENT" : "ACCEPTED_RESPONSE_SENT";
    return this.recordEvent(event, {
      task,
      level: statusCode >= 400 ? "error" : "success",
      detail: kind === "final"
        ? `Core 已向客户端发送最终响应，HTTP ${statusCode}。`
        : `Core 已向客户端发送任务接收响应，HTTP ${statusCode}。`,
      payload: {
        response: {
          endpoint,
          statusCode,
          body: body ?? {
            id: task.id,
            status: task.status,
            keyID: task.keyID,
            resultAvailable: task.resultAvailable,
            error: task.error,
          },
        },
      },
      onceKey: `${task.id}:${event}`,
    });
  }

  recordEvent(event, {
    task = null,
    level = "info",
    detail = "",
    payload = null,
    onceKey = null,
  } = {}) {
    if (onceKey && this.eventOnce.has(onceKey)) return null;
    if (onceKey) this.eventOnce.add(onceKey);

    const item = {
      id: `event_${String(++this.eventSequence).padStart(8, "0")}`,
      timestamp: new Date().toISOString(),
      event,
      level,
      ...taskPosition(task),
      detail,
      payload: payload === null ? null : structuredClone(payload),
      queue: this.capacity(),
      _onceKey: onceKey,
    };
    this.events.push(item);
    if (this.events.length > this.eventLimit) {
      const removed = this.events.splice(0, this.events.length - this.eventLimit);
      for (const oldEvent of removed) {
        if (oldEvent._onceKey) this.eventOnce.delete(oldEvent._onceKey);
      }
    }
    return publicEvent(item);
  }

  eventsList({ limit = 300 } = {}) {
    const normalizedLimit = Math.max(1, Math.min(1_000, Number(limit) || 300));
    return {
      items: this.events.slice(-normalizedLimit).reverse().map(publicEvent),
      total: this.events.length,
      limit: normalizedLimit,
      updatedAt: new Date().toISOString(),
    };
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

  live() {
    const executing = [...this.tasks.values()]
      .filter((task) => task.status === TaskStatus.RUNNING)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map(publicTask);
    const waiting = this.pendingIds
      .map((id) => this.tasks.get(id))
      .filter((task) => task?.status === TaskStatus.PENDING)
      .map(publicTask);
    return { executing, waiting, capacity: this.capacity(), updatedAt: new Date().toISOString() };
  }

  markResultConsumed(id) {
    const task = this.tasks.get(id);
    if (task) task.resultAvailable = false;
  }

  waitingCount() {
    return this.pendingIds.length;
  }

  runningCount() {
    let total = 0;
    for (const task of this.tasks.values()) {
      if (task.status === TaskStatus.RUNNING) total += 1;
    }
    return total;
  }

  executionPoolLimit() {
    const physicalCapacity = Number(this.executionPoolCapacity?.()) || 0;
    // 缩容期间已租出的副本会自然执行完，因此展示容量不能低于当前执行数。
    return Math.max(this.runningCount(), Math.max(0, Math.floor(physicalCapacity)));
  }

  waitingLimit() {
    return this.maxPending;
  }

  setMaxPending(maxPending) {
    if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 1_000_000) {
      throw new ValidationError("maxPending 必须是 1–1000000 之间的整数");
    }
    const previousMaxPending = this.maxPending;
    this.maxPending = maxPending;
    // 只记录运行时调整，构造阶段没有 previous 值。
    if (previousMaxPending !== undefined && previousMaxPending !== maxPending) {
      this.recordEvent("QUEUE_RESIZED", {
        level: "warning",
        detail: `waiting_queue 容量由 ${previousMaxPending} 调整为 ${maxPending}。`,
        payload: {
          previousMaxPending,
          maxPending,
          waitingLimit: this.waitingLimit(),
          executionPoolLimit: this.executionPoolLimit(),
        },
      });
    }
    // waiting_queue 扩容后立即唤醒 Dispatcher 检查可用 Key。
    if (this.pendingIds?.length) this.emit("pending");
    return { previousMaxPending, ...this.capacity() };
  }

  capacity() {
    const waiting = this.waitingCount();
    const executing = this.runningCount();
    const waitingLimit = this.waitingLimit();
    const executionPoolLimit = this.executionPoolLimit();
    return {
      maxPending: this.maxPending,
      waiting,
      waitingLimit,
      executing,
      executionPoolLimit,
      remainingCapacity: Math.max(0, waitingLimit - waiting),
      overCapacity: Math.max(0, waiting - waitingLimit),
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
