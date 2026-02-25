# OpenClaw Integration Plan (Typeless Lite)

## 1. 目标

让 OpenClaw 可以直接调用 Typeless Lite 的导出能力，在本机按日期获取 Markdown（例如 `today` / `yesterday`）。

## 2. 研究结论

基于 OpenClaw 官方文档，当前可行路径有两条：

1. OpenClaw 插件可注册 Agent Tools（`api.registerTool`），让 Agent 直接调用自定义功能。  
   参考：`Agent Tools` 文档（openclaw.ai）
2. OpenClaw 支持插件与 Gateway 的能力扩展，可用于把本地服务接成工具能力。  
   参考：`Writing Plugins` 文档（openclaw.ai）

补充：
- OpenClaw 的 Webhooks 用于“外部系统触发 OpenClaw 事件”，而不是直接暴露你自己的业务 API。  
  参考：`Hooks & Webhooks` 文档（openclaw.ai）

## 3. 推荐架构

### 3.1 Typeless Lite 侧（提供本地 API）

在 Electron 主进程新增本地 HTTP 服务：

- 监听地址：`127.0.0.1`（仅本机）
- 默认端口：`18423`（可配置）
- 鉴权：`Authorization: Bearer <token>`

### 3.2 OpenClaw 侧（作为调用方）

创建 `typeless-lite` 插件工具，例如：

- `typeless_export_markdown`
- 入参：`date`（`today | yesterday | YYYY-MM-DD`）
- 行为：调用 Typeless Lite 本地 API，返回 Markdown 文本和文件路径

这样 OpenClaw Agent 就能在任务里直接调用：
- “导出今天 Markdown”
- “导出昨天 Markdown 并做总结”

## 4. API 设计（Typeless Lite）

### 4.1 健康检查

`GET /v1/health`

返回：
```json
{ "ok": true, "service": "typeless-lite", "version": "0.1.1" }
```

### 4.2 获取某天 Markdown（文本）

`GET /v1/markdown?date=today`
`GET /v1/markdown?date=yesterday`
`GET /v1/markdown?date=2026-02-25`

返回：
```json
{
  "ok": true,
  "date": "2026-02-25",
  "markdown": "# Typeless Transcript ..."
}
```

### 4.3 下载某天 Markdown（文件）

`GET /v1/markdown/download?date=today`

返回头：
- `Content-Type: text/markdown; charset=utf-8`
- `Content-Disposition: attachment; filename="typeless-2026-02-25.md"`

## 5. 安全策略

1. 仅监听 `127.0.0.1`，不对局域网开放。
2. 必须携带 Bearer Token。
3. Token 首次启动生成并存储在本地配置目录，可在 UI 中一键重置。
4. 对 `date` 参数做白名单校验（仅 `today`/`yesterday`/`YYYY-MM-DD`）。
5. 请求日志默认脱敏（不落完整文本）。

## 6. 交互设计（面向非技术用户）

在应用新增 `Agent API` 设置页：

- 开关：`启用 Agent API`
- 文案：`仅本机可访问`
- 显示：`地址 + 端口 + Token`
- 操作：`复制 API 地址`、`复制 Token`、`重置 Token`
- 测试按钮：`测试今天导出`

## 7. 实施里程碑

### Phase A（1 天）
- 在 Typeless Lite 新增本地 API 服务
- 实现 `/v1/health`、`/v1/markdown`、`/v1/markdown/download`
- 增加 Token 鉴权

### Phase B（0.5-1 天）
- 在 UI 中增加 `Agent API` 设置页
- 提供“复制地址/Token”与“连通性测试”

### Phase C（0.5-1 天）
- 编写 OpenClaw 插件（工具名：`typeless_export_markdown`）
- 让 Agent 可直接调用 `today/yesterday` 导出

### Phase D（0.5 天）
- 验证端到端流程
- 补文档：给非技术用户的配置步骤

## 8. 最终体验（目标）

用户只需要做一次配置：
1. 打开 Typeless Lite -> 启用 Agent API -> 复制 Token
2. 在 OpenClaw 插件里填入 `http://127.0.0.1:18423` + Token

之后可以直接在 OpenClaw 里说：
- “导出今天的语音转录 Markdown，并总结成 5 条工作复盘。”
