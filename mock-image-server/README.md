# Fixed TEST Image Mock

这是一个零依赖的本地上游测试服务。无论 Core 向什么路径提交 JSON 或 multipart 请求，
服务都会返回同一张白底 `TEST` PNG，响应格式兼容 OpenAI 图片接口。

## 启动

在项目根目录运行：

```bash
npm run mock:start
```

或在当前目录运行：

```bash
npm start
```

默认地址为 `http://127.0.0.1:3100`，图片预览地址：

```text
http://127.0.0.1:3100/test.png
```

## 在 CORE CONTROL 注册

- Base URL：`http://127.0.0.1:3100`
- API Key：任意值，例如 `test`
- Models：`test-image`
- Concurrency：按测试需要设置

`/v1/models`、`/v1/images/generations`、`/v1/images/edits` 以及其他任意路径都会返回
HTTP 200。每次请求都会输出 method、path、请求大小、响应大小和耗时日志。
