# OpenClaw Agent Quickstart

目标：让 OpenClaw 直接调用 Typeless Lite 本地 API，获取某一天的语音输入 Markdown 记录（template）。

## 最小步骤

1. 打开 `Typeless Lite.app`（本地 API 会启动在 `127.0.0.1:18423`）。
2. 读取 token：`~/Library/Application Support/typeless-lite/typeless-lite-settings.json` 的 `agentApiToken`。
3. 让 OpenClaw 调用：
   - `GET /v1/markdown?date=today|yesterday|YYYY-MM-DD`
   - Header: `Authorization: Bearer <token>`

## 可直接粘贴给 OpenClaw 的 Prompt

```text
你可以调用 Typeless Lite 本地 API 获取语音输入历史。请使用：
GET http://127.0.0.1:18423/v1/markdown?date=<today|yesterday|YYYY-MM-DD>
Header: Authorization: Bearer <token>
请返回响应中的 markdown 字段内容；如果接口报错，请原样返回错误码和错误信息。
```

## Repository

`https://github.com/AlexAnys/typeless-lite`
