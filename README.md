<div align="center">

# High TPS Image Gen

### 高并发图像生成任务调度中转站

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)
![Tests](https://img.shields.io/badge/tests-10%20passing-22C55E)
![Architecture](https://img.shields.io/badge/architecture-Async%20Queue%20%2B%20KeyPool-4F46E5)
![Status](https://img.shields.io/badge/status-Working-16A34A)

**Queue the work · Lease the key · Return the result**

</div>

---

一个面向 OpenAI 兼容图片生成接口的高并发中转服务。客户端先提交任务，Core 按可配置 TPS 调度；Key 模块把每条原始 Key 按 `concurrency` **真实复制成多个对象**，每个副本拥有唯一 `keyID`，从而直接表达下游并发槽位。

> 当前结果只保存在内存中，不落磁盘。默认首次读取后删除。

## 核心语义

- **原始 Key**：持久化在 `data/apikey_pool.json`，每条只保存一次。
- **物理 Key 副本**：启动或更新时按 `concurrency` 创建。API Key 可以相同，但 `keyID` 必须不同。
- **KeyPool**：副本在 `available -> leased -> available` 间流转；Core 每次只租一个副本。
- **HealthTest**：只检查不重复的原始 Key，不会按副本数量重复检查。
- **Retry**：只属于 Core。Key 模块不承担业务重试，也没有 CircuitBreaker。
- **调度**：令牌桶限制全局 TPS；某模型暂时没有 Key 时，会跳过它继续调度其他可运行模型。

```mermaid
flowchart LR
  Client["客户端"] -->|POST /api/tasks| Queue["TaskQueue"]
  Queue --> Dispatcher["TPS Dispatcher"]
  Dispatcher -->|acquire(model)| Pool["Dynamic KeyPool"]
  Source["原始 Key + concurrency"] --> Factory["KeyFactory"]
  Factory -->|唯一 keyID 的重复副本| Pool
  Pool --> Runner["TaskRunner"]
  Runner --> Provider["图片供应商"]
  Runner -->|release(keyID)| Pool
  Runner --> Result["内存 ResultStore"]
  Client -->|GET /api/tasks/:id| Result
```

## 快速开始

要求 Node.js 18 或更高版本。

```bash
npm install
npm start
```

服务默认监听 `http://127.0.0.1:3000`（实际 host 为 `0.0.0.0`）。首次启动会自动创建 `data/apikey_pool.json`。

注册一条并发为 4 的原始 Key：

```bash
curl -X POST http://127.0.0.1:3000/api/keys \
  -H "content-type: application/json" \
  -d '{"id":"provider-a","baseUrl":"https://api.example.com","apiKey":"sk-xxx","models":["gpt-image-1"],"concurrency":4}'
```

此时 KeyPool 中会生成 4 个完整副本，例如：

```text
provider-a:1:1
provider-a:1:2
provider-a:1:3
provider-a:1:4
```

提交并读取任务：

```bash
curl -X POST http://127.0.0.1:3000/api/tasks \
  -H "content-type: application/json" \
  -d '{"model":"gpt-image-1","prompt":"a cat in space"}'

curl http://127.0.0.1:3000/api/tasks/<taskId>
```

## 配置

主配置位于 `config.json`：

| 配置 | 说明 | 默认值 |
|---|---|---:|
| `queue.dispatchRatePerSecond` | 全局任务分发 TPS | `300` |
| `queue.maxPending` | 最大等待任务数 | `10000` |
| `request.timeoutMs` | 单次下游请求超时 | `120000` |
| `retry.maxAttempts` | 总尝试次数（含首次） | `3` |
| `result.resultTtlMs` | 内存结果 TTL | `1800000` |
| `result.deleteAfterRead` | 首次读取后删除结果 | `true` |
| `health.intervalMs` | 原始 Key 健康检查周期 | `30000` |

每条 Key 的并发数不是全局配置，而是 Key JSON/API 中各自的 `concurrency`。参考 `data/apikey_pool.example.json`。

## API

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/api/tasks` | 提交图片任务 |
| `GET` | `/api/tasks/:id` | 查询状态并读取结果 |
| `GET` | `/api/tasks` | 分页列出任务 |
| `DELETE` | `/api/tasks/:id` | 取消等待/重试中的任务 |
| `GET` | `/api/keys` | 查看原始 Key 与池状态（密钥脱敏） |
| `POST` | `/api/keys` | 注册 Key 并动态加入 KeyPool |
| `PUT` | `/api/keys/:id` | 更新 Key 并重建该来源的副本 |
| `DELETE` | `/api/keys/:id` | 删除 Key 与空闲副本 |
| `POST` | `/api/keys/:id/toggle` | 启用或禁用 Key |
| `POST` | `/api/keys/:id/health-test` | 检查单条原始 Key |
| `POST` | `/api/keys/health-test` | 检查全部启用的原始 Key |
| `GET` | `/api/status` | 队列、KeyPool 和调度指标 |
| `GET` | `/health` | 存活探针 |

## 项目结构

```text
server/
├─ api/routes/          # HTTP 接口
├─ core/
│  ├─ TaskQueue.js      # 内存任务队列与状态机
│  ├─ Dispatcher.js     # TPS 令牌桶和事件调度
│  ├─ TaskRunner.js     # 执行、重试、结果与 Key 归还闭环
│  ├─ RequestExecutor.js# 下游 OpenAI 兼容请求
│  └─ ResultStore.js    # 内存结果和 TTL
├─ keys/
│  ├─ KeyStore.js       # 只持久化原始 Key
│  ├─ KeyFactory.js     # 按 concurrency 复制完整 Key 对象
│  ├─ KeyPool.js        # available/leased 副本池
│  ├─ KeyManager.js     # 注册、删除、建池、获取与归还
│  └─ HealthTester.js   # 按原始 Key 去重检查
├─ bootstrap.js         # 可测试的依赖装配
└─ index.js             # 服务入口
```

代码内已经为关键状态流转、Key 副本生命周期、generation 淘汰及并发安全点写了中文注释。

## 测试与压测

```bash
npm test
npm run benchmark
```

压测可通过环境变量调整：`BASE_URL`、`TOTAL`、`CONCURRENCY`、`MODEL`、`PROMPT`。

## 部署提醒

当前管理 API 没有内置鉴权，建议仅暴露在可信内网或由网关统一鉴权。任务和结果均为单进程内存状态；要扩展为多实例，需要外置队列/结果存储并增加分布式 Key 租约。
