# Agent API (for OpenClaw / other local agents)

Typeless Lite now starts a local HTTP API in the Electron main process.

## Default

- Host: `127.0.0.1`
- Port: `18423`
- Auth: `Authorization: Bearer <token>`

## Token location

Token and port are stored in app config.

macOS：路径会因“开发模式 vs 打包版”不同而不同：

- 打包版（常见）：`~/Library/Application Support/Typeless Lite/typeless-lite-settings.json`
- 开发模式（`npm start` / `electron .`）：`~/Library/Application Support/typeless-lite/typeless-lite-settings.json`

Fields:

- `agentApiEnabled`
- `agentApiPort`
- `agentApiToken`

## Endpoints

All endpoints require Bearer token.

1. `GET /v1/health`
2. `GET /v1/days`
3. `GET /v1/markdown?date=today|yesterday|YYYY-MM-DD`
4. `GET /v1/markdown/download?date=today|yesterday|YYYY-MM-DD`

## cURL examples

```bash
TOKEN="<your-agent-api-token>"
BASE="http://127.0.0.1:18423"

curl -sS "$BASE/v1/health" \
  -H "Authorization: Bearer $TOKEN"

curl -sS "$BASE/v1/markdown?date=today" \
  -H "Authorization: Bearer $TOKEN"

curl -sS "$BASE/v1/markdown/download?date=2026-02-26" \
  -H "Authorization: Bearer $TOKEN" \
  -o typeless-2026-02-26.md
```

## OpenClaw tool mapping suggestion

- Tool name: `typeless_export_markdown`
- Input:
  - `date` (`today | yesterday | YYYY-MM-DD`)
- Action:
  - call `GET /v1/markdown?date=<date>`
- Output:
  - return `markdown` text to agent
