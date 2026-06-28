<div align="center">

# High TPS Image Workbench

### 一个 Listing · 1–20 张图片 · 动态请求窗口 · 动态 KeyPool

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111)
![Tests](https://img.shields.io/badge/tests-13%20passing-C8FF55)
![Architecture](https://img.shields.io/badge/Core-Queue%20%2B%20KeyPool-FF713C)

**Import → Cache → Dispatch → Generate → Persist**

</div>

---

这是一个面向 OpenAI 兼容图片编辑接口的本地高并发工作台。前端导入 JSON 后，服务端先把原图和元数据写入磁盘；随后前端使用 `req_max_limit` 动态滑动窗口提交图片任务。只有一个任务完整返回 `completed / failed / cancelled`，该窗口槽位才会释放给下一张图。

刷新浏览器不会丢失 Block、原图、任务记录和结果图。

## 快速启动

要求 Node.js 18 或更高版本。首次使用先安装两端依赖：

```bash
npm install
cd client
npm install
```

启动两个终端：

```bash
# 终端 1：Core / KeyPool / 本地缓存 API
npm start

# 终端 2：React 工作台
npm run dev:client
```

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)。

> `0.0.0.0` 是服务端的监听地址，不是浏览器访问地址。本机访问请使用 `127.0.0.1` 或 `localhost`。

## 工作台 JSON

完整示例见 `client/example.workbench.json`：

```json
[
  {
    "blockId": "product-001",
    "listing": "Minimal Ceramic Vase",
    "prompt": "Create a clean ecommerce product photo.",
    "images": [
      {
        "imageId": "front",
        "url": "https://example.com/front.png"
      },
      {
        "imageId": "detail",
        "url": "https://example.com/detail.png",
        "prompt": "Emphasize texture."
      }
    ]
  }
]
```

- 一个 Block 固定对应一个 `listing`。
- 每个 Block 必须有 1–20 张图片。
- Block 的 `prompt` 是默认值。
- 图片 `prompt` 是单图覆盖值；留空时继承 Block Prompt。
- `blockId` 和同一 Block 内的 `imageId` 必须唯一。

## 两层并发

| 层级 | 配置位置 | 语义 |
|---|---|---|
| 前端窗口 | `client/config.json → req_max_limit` | 当前用户最多同时等待多少个完整图片任务 |
| Key 并发 | Key 注册数据中的 `concurrency` | 同一真实 API Key 被复制为多少个可租用副本 |
| 全局 TPS | `config.json → queue.dispatchRatePerSecond` | Core 每秒最多派发多少个任务 |

每个 Key 副本包含相同的 API Key，但拥有不同的 `keyID`。健康检查只轮询不重复的原始 Key；失败重试只属于 Core，不属于 Key 模块。

## 配置

前端运行时配置位于 `client/config.json`，不需要 `public/`：

```json
{
  "server": { "protocol": "http", "host": "127.0.0.1", "port": 3000 },
  "req_max_limit": 4,
  "poll_interval_ms": 1000,
  "ui": {
    "title": "Workbench",
    "default_model": "gpt-image-1",
    "image_size": "1024x1024"
  }
}
```

后端配置位于根目录 `config.json`。工作台磁盘缓存默认写入：

```text
data/workbench-cache/
├─ blocks.json
├─ tasks.json
├─ inputs/<blockId>/<imageId>.<ext>
└─ outputs/<blockId>/<imageId>.<ext>
```

## 项目结构

```text
client/
├─ config.json               # 前端运行时配置
├─ example.workbench.json    # 导入示例
├─ src/
│  ├─ load/                  # 1. 载入 config / JSON / 服务端原图缓存
│  ├─ workbench/             # 2. Block、图片卡片和页面状态
│  ├─ request/               # 3. 请求队列、轮询和动态滑动窗口
│  ├─ result/                # 4. 结果状态和下载
│  ├─ models.ts
│  └─ styles.css
└─ vite.config.ts            # 直接提供 config.json，无 public/

server/
├─ api/routes/               # tasks / keys / status / workbench
├─ core/                     # 队列、TPS 调度、重试、请求执行
├─ keys/                     # Key 注册、复制、KeyPool、HealthTest
├─ workbench/                # JSON 导入、磁盘图片缓存、元数据持久化
├─ bootstrap.js
└─ index.js
```

## 常用命令

```bash
npm test                 # 后端单元 + 集成测试
npm run build:client     # TypeScript 检查 + 前端生产构建
npm run benchmark        # Core 压测
```

当前测试覆盖 Key 复制/租用/归还、健康检查去重、Core 重试、Block 1–20 图片校验，以及“导入原图 → Core 执行 → 结果落盘 → 刷新恢复”完整链路。

## 部署提醒

Key 管理接口尚未内置登录鉴权，只应部署在可信内网或置于带鉴权的网关后。Core 队列仍是单进程内存状态；工作台元数据和图片可跨重启恢复，但未完成的在途任务在重启后会回到 `ready`，由用户重新提交。
