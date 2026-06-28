/**
 * 中转站全局配置
 * 所有可调参数集中管理
 */

const config = {
  // ============ 调度器配置 ============
  dispatcher: {
    // 调度循环间隔（ms） - 当队列为空时的检查间隔
    pollIntervalMs: 50,
    // 单个任务最大重试次数
    maxRetries: 3,
    // 重试基础延迟（ms），实际延迟 = base * 2^retryCount
    retryBaseDelayMs: 1000,
    // 重试最大延迟（ms）
    retryMaxDelayMs: 30000,
  },

  // ============ Worker 池配置 ============
  worker: {
    // 最大并发 Worker 数
    maxConcurrency: 50,
    // 单次请求超时（ms） - 图像生成通常较慢
    requestTimeoutMs: 120_000,
    // HTTP 连接池大小（per origin）
    connectionsPerOrigin: 20,
    // HTTP 管线化
    pipelining: 1,
  },

  // ============ 速率限制配置 ============
  rateLimiter: {
    // 滑动窗口大小（ms）
    windowSizeMs: 60_000,
    // 窗口默认 RPM 限制（可被 Key 级别覆盖）
    defaultRpmLimit: 60,
    // 过期窗口清理间隔（ms）
    cleanupIntervalMs: 30_000,
  },

  // ============ 健康监控配置 ============
  healthMonitor: {
    // 连续失败多少次标记为 unhealthy
    failureThreshold: 5,
    // 自动恢复探活间隔（ms）
    recoveryIntervalMs: 5 * 60_000,
    // 探活超时（ms）
    probeTimeoutMs: 30_000,
    // 统计窗口大小（保留最近 N 次记录计算成功率）
    statsWindowSize: 100,
  },

  // ============ 任务队列配置 ============
  taskQueue: {
    // 队列最大容量（防止内存溢出）
    maxQueueSize: 10_000,
    // 默认任务优先级（1=最高，10=最低）
    defaultPriority: 5,
  },

  // ============ 用户限制配置 ============
  userLimits: {
    // 默认每用户最大并发任务数
    defaultMaxConcurrent: 3,
    // 默认每日配额
    defaultDailyQuota: 100,
  },
};

export default config;
