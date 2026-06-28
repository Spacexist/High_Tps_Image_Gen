// 统一错误类型保证 API、Core 和下游适配器返回稳定的错误语义。
export class AppError extends Error {
  constructor(message, { code = "APP_ERROR", statusCode = 500, details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message, details) {
    super(message, { code: "VALIDATION_ERROR", statusCode: 400, details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, { code: "NOT_FOUND", statusCode: 404 });
  }
}

export class ConflictError extends AppError {
  constructor(message) {
    super(message, { code: "CONFLICT", statusCode: 409 });
  }
}

export class QueueFullError extends AppError {
  constructor(message = "Task queue is full") {
    super(message, { code: "QUEUE_FULL", statusCode: 503 });
  }
}

export class DownstreamError extends AppError {
  constructor(message, {
    statusCode = 502,
    downstreamStatus,
    retryable = false,
    responseBody,
    retryAfterMs,
    cause,
  } = {}) {
    super(message, { code: "DOWNSTREAM_ERROR", statusCode });
    this.downstreamStatus = downstreamStatus;
    this.retryable = retryable;
    this.responseBody = responseBody;
    this.retryAfterMs = retryAfterMs;
    if (cause) this.cause = cause;
  }
}

export function serializeError(error) {
  return {
    code: error.code ?? "INTERNAL_ERROR",
    message: error.message ?? "Unknown error",
    downstreamStatus: error.downstreamStatus,
  };
}
