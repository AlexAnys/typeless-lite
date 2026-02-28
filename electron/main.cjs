const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { createDecipheriv, randomBytes, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const CONFIG_FILE = "typeless-lite-settings.json";
const isDev = Boolean(DEV_SERVER_URL);
const AGENT_API_DEFAULT_HOST = "127.0.0.1";
const AGENT_API_DEFAULT_PORT = 18423;
const AGENT_API_CACHE_TTL_MS = 30_000;
const AUDIO_CONTEXT_KEY = Buffer.from(
  "7d4a8f2e6b9c3a1f5e8d2c7b4a9f6e3d1b5a2f9e6d3c0b7a4f1e8d5c2b9f6a3d",
  "hex"
);

const PRIVACY_CAPTURE_MATRIX = [
  {
    key: "visible_screen_content",
    description: "屏幕上所有可见文字（最多 10,000 字符）",
    localStorage: "加密存储",
    uploaded: "是"
  },
  {
    key: "selected_text",
    description: "当前选中的文字",
    localStorage: "加密存储",
    uploaded: "是"
  },
  {
    key: "text_before_cursor",
    description: "光标前的文字",
    localStorage: "加密存储",
    uploaded: "是"
  },
  {
    key: "text_after_cursor",
    description: "光标后的文字",
    localStorage: "加密存储",
    uploaded: "是"
  },
  {
    key: "full_field_content",
    description: "输入框完整内容",
    localStorage: "加密存储",
    uploaded: "是"
  },
  {
    key: "surrounding_context",
    description: "输入框前后的 UI 内容（各 1,000 字符）",
    localStorage: "加密存储",
    uploaded: "是"
  },
  {
    key: "app_name / bundle_id",
    description: "当前应用名称和标识",
    localStorage: "明文存储",
    uploaded: "是"
  },
  {
    key: "window_title",
    description: "窗口标题",
    localStorage: "明文存储",
    uploaded: "是"
  },
  {
    key: "page_url / domain",
    description: "浏览器 URL 和域名",
    localStorage: "明文存储",
    uploaded: "是"
  },
  {
    key: "device_environment",
    description: "OS、CPU、内存、语言、地区",
    localStorage: "加密存储",
    uploaded: "是"
  },
  {
    key: "app_path / process_id",
    description: "应用路径和进程 ID",
    localStorage: "加密存储",
    uploaded: "是"
  }
];

let mainWindow = null;
let cachedData = null;
let agentApiServer = null;
let agentApiSettings = null;

function getConfigPath() {
  return path.join(app.getPath("userData"), CONFIG_FILE);
}

async function readConfig() {
  const configPath = getConfigPath();
  try {
    const raw = await fsp.readFile(configPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeConfig(patch) {
  const configPath = getConfigPath();
  const current = await readConfig();
  const next = { ...current, ...patch };
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(configPath, JSON.stringify(next, null, 2), "utf8");
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean))];
}

function knownDbPaths() {
  const home = os.homedir();

  if (process.platform === "darwin") {
    return [
      path.join(home, "Library/Application Support/Typeless/typeless.db"),
      path.join(home, "Library/Application Support/now.typeless.desktop/typeless.db")
    ];
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData/Roaming");
    const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData/Local");
    return [
      path.join(appData, "Typeless", "typeless.db"),
      path.join(localAppData, "Typeless", "typeless.db")
    ];
  }

  return [
    path.join(home, ".config/Typeless/typeless.db"),
    path.join(home, ".local/share/Typeless/typeless.db")
  ];
}

async function scanForTypelessDb(rootDir, maxDepth = 3) {
  const matches = [];
  const queue = [{ dir: rootDir, depth: 0 }];
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    if (visited.has(current.dir)) {
      continue;
    }
    visited.add(current.dir);

    let entries = [];
    try {
      entries = await fsp.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      const nameLower = entry.name.toLowerCase();

      if (entry.isFile() && nameLower === "typeless.db") {
        matches.push(fullPath);
        continue;
      }

      if (!entry.isDirectory() || current.depth >= maxDepth) {
        continue;
      }

      const shouldDescend =
        current.depth === 0 ||
        nameLower.includes("typeless") ||
        nameLower.includes("now.typeless.desktop");

      if (shouldDescend) {
        queue.push({ dir: fullPath, depth: current.depth + 1 });
      }
    }
  }

  return matches;
}

function scanRoots() {
  const home = os.homedir();

  if (process.platform === "darwin") {
    return [
      path.join(home, "Library/Application Support"),
      path.join(home, "Library/Containers"),
      path.join(home, "Library/Group Containers")
    ];
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData/Roaming");
    const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData/Local");
    return [appData, localAppData];
  }

  return [path.join(home, ".config"), path.join(home, ".local/share")];
}

async function discoverDbPath(overridePath) {
  if (overridePath && (await fileExists(overridePath))) {
    return { dbPath: overridePath, source: "manual" };
  }

  const config = await readConfig();
  const preferred = config.lastDbPath;

  const candidates = uniquePaths([
    preferred,
    ...knownDbPaths()
  ]);

  for (const candidate of candidates) {
    if (candidate && (await fileExists(candidate))) {
      return { dbPath: candidate, source: "known" };
    }
  }

  for (const root of scanRoots()) {
    if (!(await fileExists(root))) {
      continue;
    }
    const found = await scanForTypelessDb(root);
    if (found.length > 0) {
      return { dbPath: found[0], source: "scan" };
    }
  }

  throw new Error("未找到 Typeless 数据库。请点击“选择数据库文件”手动指定 typeless.db。");
}

async function runSqliteJson(dbPath, sql) {
  const args = ["-json", dbPath, sql];
  try {
    const { stdout } = await execFileAsync("sqlite3", args, {
      maxBuffer: 64 * 1024 * 1024
    });
    if (!stdout || !stdout.trim()) {
      return [];
    }
    return JSON.parse(stdout);
  } catch (error) {
    const message = error && typeof error === "object" && "stderr" in error
      ? `${error.message}\n${error.stderr || ""}`
      : String(error);
    throw new Error(`读取 Typeless 数据失败：${message}`);
  }
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayLabel(date) {
  return date.toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short"
  });
}

function formatTimeLabel(date) {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function toDateSafe(rawValue) {
  const parsed = new Date(rawValue || "");
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  return new Date();
}

function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeWebUrl(value) {
  const text = normalizeString(value);
  if (!text) {
    return null;
  }
  if (text === "null/" || text === "null" || text === "about:blank") {
    return null;
  }
  return text;
}

function decryptAudioContext(audioContext) {
  const payload = normalizeString(audioContext);
  if (!payload) {
    return {
      status: "none",
      context: null,
      error: null
    };
  }

  const parts = payload.split(":");
  if (parts.length !== 2) {
    return {
      status: "failed",
      context: null,
      error: "audio_context 格式不是 iv:ciphertext"
    };
  }

  try {
    const iv = Buffer.from(parts[0], "base64");
    const ciphertext = Buffer.from(parts[1], "base64");

    const decipher = createDecipheriv("aes-256-cbc", AUDIO_CONTEXT_KEY, iv);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const context = JSON.parse(plaintext);
    return {
      status: "ok",
      context,
      error: null
    };
  } catch (error) {
    return {
      status: "failed",
      context: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function extractContextData(contextResult) {
  if (!contextResult || contextResult.status !== "ok" || !contextResult.context) {
    return {
      decryptionStatus: contextResult?.status ?? "none",
      decryptError: contextResult?.error ?? null,
      visibleScreenContent: null,
      selectedText: null,
      textBeforeCursor: null,
      textAfterCursor: null,
      fullFieldContent: null,
      surroundingBefore: null,
      surroundingAfter: null,
      appNameFromContext: null,
      appIdentifier: null,
      windowTitleFromContext: null,
      pageTitle: null,
      pageUrl: null,
      domain: null,
      processId: null,
      appPath: null,
      deviceEnvironment: null
    };
  }

  const payload = contextResult.context;
  const active = payload.active_application || {};
  const browser = active.browser_context || {};
  const appMetadata = active.app_metadata || {};
  const insertion = payload.text_insertion_point || {};
  const cursor = insertion.cursor_state || {};
  const surrounding = insertion.surrounding_context || {};
  const device = payload.device_environment || {};

  return {
    decryptionStatus: "ok",
    decryptError: null,
    visibleScreenContent: normalizeString(active.visible_screen_content),
    selectedText: normalizeString(cursor.selected_text),
    textBeforeCursor: normalizeString(cursor.text_before_cursor),
    textAfterCursor: normalizeString(cursor.text_after_cursor),
    fullFieldContent: normalizeString(cursor.full_field_content),
    surroundingBefore: normalizeString(surrounding.text_before_input_area),
    surroundingAfter: normalizeString(surrounding.text_after_input_area),
    appNameFromContext: normalizeString(active.app_name),
    appIdentifier: normalizeString(active.app_identifier),
    windowTitleFromContext: normalizeString(active.window_title),
    pageTitle: normalizeString(browser.page_title),
    pageUrl: normalizeWebUrl(browser.page_url),
    domain: normalizeString(browser.domain),
    processId: typeof appMetadata.process_id === "number" ? appMetadata.process_id : null,
    appPath: normalizeString(appMetadata.app_path),
    deviceEnvironment: {
      operatingSystem: normalizeString(device.operating_system),
      osVersion: normalizeString(device.os_version),
      architecture: normalizeString(device.architecture),
      locale: normalizeString(device.locale),
      region: normalizeString(device.region)
    }
  };
}

function buildContextSummary(entries) {
  const summary = {
    totalEntries: entries.length,
    withAudioContext: 0,
    decryptedEntries: 0,
    decryptFailedEntries: 0,
    withVisibleScreenContent: 0,
    withSelectedText: 0,
    withTextBeforeCursor: 0,
    withTextAfterCursor: 0,
    withFullFieldContent: 0,
    withSurroundingContext: 0,
    withBrowserUrl: 0,
    withAppPath: 0
  };

  for (const entry of entries) {
    if (entry.hasAudioContext) {
      summary.withAudioContext += 1;
    }
    if (entry.context.decryptionStatus === "ok") {
      summary.decryptedEntries += 1;
    }
    if (entry.context.decryptionStatus === "failed") {
      summary.decryptFailedEntries += 1;
    }
    if (entry.context.visibleScreenContent) {
      summary.withVisibleScreenContent += 1;
    }
    if (entry.context.selectedText) {
      summary.withSelectedText += 1;
    }
    if (entry.context.textBeforeCursor) {
      summary.withTextBeforeCursor += 1;
    }
    if (entry.context.textAfterCursor) {
      summary.withTextAfterCursor += 1;
    }
    if (entry.context.fullFieldContent) {
      summary.withFullFieldContent += 1;
    }
    if (entry.context.surroundingBefore || entry.context.surroundingAfter) {
      summary.withSurroundingContext += 1;
    }
    if (entry.webUrl) {
      summary.withBrowserUrl += 1;
    }
    if (entry.context.appPath) {
      summary.withAppPath += 1;
    }
  }

  return summary;
}

function buildModel(rows, dbPath, source) {
  const entries = rows.map((row, index) => {
    const text = String(row.text || "").trim();
    const created = toDateSafe(row.created_at || row.updated_at);
    const contextResult = decryptAudioContext(row.audio_context);
    const context = extractContextData(contextResult);
    const rowWebUrl = normalizeWebUrl(row.focused_app_window_web_url);
    const rowWebDomain = normalizeString(row.focused_app_window_web_domain);
    const rowWebTitle = normalizeString(row.focused_app_window_web_title);
    const rowWindowTitle = normalizeString(row.focused_app_window_title);

    return {
      id: row.id || `entry-${index}`,
      text,
      createdAt: created.toISOString(),
      dayKey: formatDateKey(created),
      timeLabel: formatTimeLabel(created),
      appName: normalizeString(row.focused_app_name) || context.appNameFromContext || "Unknown App",
      appBundleId: normalizeString(row.focused_app_bundle_id) || context.appIdentifier,
      windowTitle: rowWindowTitle || context.windowTitleFromContext,
      webTitle: rowWebTitle || context.pageTitle,
      webDomain: rowWebDomain || context.domain,
      webUrl: rowWebUrl || context.pageUrl,
      language: row.detected_language || "unknown",
      duration: typeof row.duration === "number" ? row.duration : null,
      status: row.status || "unknown",
      mode: row.mode || "voice_transcript",
      hasAudioContext: Boolean(normalizeString(row.audio_context)),
      context
    };
  });

  const grouped = new Map();

  for (const entry of entries) {
    if (!grouped.has(entry.dayKey)) {
      const date = toDateSafe(entry.createdAt);
      grouped.set(entry.dayKey, {
        dayKey: entry.dayKey,
        dayLabel: formatDayLabel(date),
        entries: []
      });
    }
    grouped.get(entry.dayKey).entries.push(entry);
  }

  const days = [...grouped.values()]
    .sort((a, b) => b.dayKey.localeCompare(a.dayKey))
    .map((day) => {
      day.entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        ...day,
        count: day.entries.length
      };
    });

  const newest = entries[0]?.createdAt ?? null;
  const oldest = entries[entries.length - 1]?.createdAt ?? null;

  return {
    dbPath,
    source,
    recordingsDir: path.join(path.dirname(dbPath), "Recordings"),
    loadedAt: new Date().toISOString(),
    totalEntries: entries.length,
    dayCount: days.length,
    range: {
      newest,
      oldest
    },
    contextSummary: buildContextSummary(entries),
    captureMatrix: PRIVACY_CAPTURE_MATRIX,
    days
  };
}

function findDayByKey(dayKey) {
  if (!cachedData) {
    throw new Error("当前没有可用数据，请先读取 Typeless 记录。");
  }
  const day = cachedData.days.find((item) => item.dayKey === dayKey);
  if (!day) {
    throw new Error("未找到该日期的数据，请刷新后重试。");
  }
  return day;
}

function getChronologicalEntries(day) {
  return [...day.entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function buildDayPlainText(day) {
  const lines = [`${day.dayKey} ${day.dayLabel}`, ""];
  for (const entry of getChronologicalEntries(day)) {
    const contextParts = [entry.appName];
    if (entry.windowTitle) {
      contextParts.push(entry.windowTitle);
    }
    if (entry.webDomain) {
      contextParts.push(entry.webDomain);
    }
    lines.push(`[${entry.timeLabel}] ${contextParts.join(" | ")}`);
    lines.push(entry.text);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function buildDayMarkdown(day, dbPath) {
  const lines = [
    `# Typeless Transcript - ${day.dayKey}`,
    "",
    `- 日期：${day.dayLabel} (${day.dayKey})`,
    `- 条数：${day.count}`,
    `- 数据源：${dbPath}`,
    `- 导出时间：${new Date().toLocaleString("zh-CN")}`,
    ""
  ];

  for (const entry of getChronologicalEntries(day)) {
    lines.push(`## ${entry.timeLabel}`);
    lines.push("");
    lines.push(`- 应用：${entry.appName}`);
    if (entry.appBundleId) {
      lines.push(`- Bundle ID：${entry.appBundleId}`);
    }
    if (entry.windowTitle) {
      lines.push(`- 窗口：${entry.windowTitle}`);
    }
    if (entry.webUrl) {
      lines.push(`- URL：${entry.webUrl}`);
    } else if (entry.webDomain) {
      lines.push(`- 域名：${entry.webDomain}`);
    }
    lines.push("");
    lines.push(entry.text);
    lines.push("");
  }

  return lines.join("\n").trim();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPdfHtml(day, dbPath) {
  const items = getChronologicalEntries(day)
    .map(
      (entry) => `
      <article class="entry">
        <div class="time">${escapeHtml(entry.timeLabel)} · ${escapeHtml(entry.appName)}</div>
        ${
          entry.windowTitle || entry.webUrl
            ? `<div class="meta-line">${escapeHtml(
                [entry.windowTitle, entry.webUrl].filter(Boolean).join(" | ")
              )}</div>`
            : ""
        }
        <pre>${escapeHtml(entry.text)}</pre>
      </article>
    `
    )
    .join("\n");

  return `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Typeless Transcript ${escapeHtml(day.dayKey)}</title>
    <style>
      @page {
        size: A4;
        margin: 24mm 18mm;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", sans-serif;
        color: #1f2937;
        background: #ffffff;
      }
      h1 {
        font-size: 20px;
        margin: 0 0 8px;
      }
      .meta {
        color: #6b7280;
        font-size: 12px;
        margin-bottom: 20px;
      }
      .entry {
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 12px 14px;
        margin: 0 0 10px;
        break-inside: avoid;
      }
      .meta-line {
        color: #6b7280;
        font-size: 12px;
        margin-bottom: 8px;
      }
      .time {
        color: #10a37f;
        font-weight: 700;
        margin-bottom: 8px;
        font-size: 13px;
      }
      pre {
        margin: 0;
        font: inherit;
        white-space: pre-wrap;
        word-break: break-word;
        line-height: 1.55;
      }
    </style>
  </head>
  <body>
    <h1>Typeless Transcript - ${escapeHtml(day.dayKey)}</h1>
    <div class="meta">${escapeHtml(day.dayLabel)} | ${day.count} 条 | ${escapeHtml(dbPath)}</div>
    ${items}
  </body>
</html>
`;
}

function sanitizeFileName(raw, fallback) {
  const cleaned = String(raw || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

class AgentApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isValidPort(value) {
  return Number.isInteger(value) && value > 0 && value <= 65535;
}

function parsePort(value) {
  const numeric = Number(value);
  if (!isValidPort(numeric)) {
    return AGENT_API_DEFAULT_PORT;
  }
  return numeric;
}

function generateAgentApiToken() {
  return randomBytes(24).toString("hex");
}

function toAgentApiInfo(settings) {
  return {
    enabled: settings.enabled,
    host: settings.host,
    port: settings.port,
    baseUrl: settings.baseUrl,
    token: settings.token
  };
}

async function ensureAgentApiSettings() {
  const config = await readConfig();
  const host = AGENT_API_DEFAULT_HOST;
  const enabled =
    typeof config.agentApiEnabled === "boolean" ? config.agentApiEnabled : true;
  const port = parsePort(config.agentApiPort);
  const token = normalizeString(config.agentApiToken) || generateAgentApiToken();
  const baseUrl = `http://${host}:${port}`;

  const patch = {};
  if (config.agentApiEnabled !== enabled) {
    patch.agentApiEnabled = enabled;
  }
  if (config.agentApiPort !== port) {
    patch.agentApiPort = port;
  }
  if (config.agentApiToken !== token) {
    patch.agentApiToken = token;
  }

  if (Object.keys(patch).length > 0) {
    await writeConfig(patch);
  }

  agentApiSettings = { enabled, host, port, token, baseUrl };
  return agentApiSettings;
}

function parseBearerToken(header) {
  if (typeof header !== "string") {
    return null;
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function safeEqualToken(expected, actual) {
  const expectedBuffer = Buffer.from(expected || "", "utf8");
  const actualBuffer = Buffer.from(actual || "", "utf8");
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function validateAgentApiAuth(req) {
  if (!agentApiSettings || !agentApiSettings.token) {
    throw new AgentApiError(503, "API_NOT_READY", "Agent API 尚未初始化。");
  }

  const provided = parseBearerToken(req.headers.authorization);
  if (!provided || !safeEqualToken(agentApiSettings.token, provided)) {
    throw new AgentApiError(401, "UNAUTHORIZED", "未授权请求。");
  }
}

function parseFixedDateKey(raw) {
  const text = normalizeString(raw);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new AgentApiError(400, "INVALID_DATE", "date 仅支持 today / yesterday / YYYY-MM-DD。");
  }

  const [yearRaw, monthRaw, dayRaw] = text.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const parsed = new Date(year, month - 1, day);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() + 1 !== month ||
    parsed.getDate() !== day
  ) {
    throw new AgentApiError(400, "INVALID_DATE", "日期格式无效，请使用 YYYY-MM-DD。");
  }

  return formatDateKey(parsed);
}

function resolveDateInput(rawDate) {
  const normalized = normalizeString(rawDate) || "today";
  const lower = normalized.toLowerCase();
  const now = new Date();

  if (lower === "today") {
    return formatDateKey(now);
  }
  if (lower === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return formatDateKey(yesterday);
  }
  return parseFixedDateKey(normalized);
}

async function ensureFreshDataForApi() {
  const loadedAtMs = cachedData?.loadedAt ? Date.parse(cachedData.loadedAt) : 0;
  const expired =
    !loadedAtMs ||
    Number.isNaN(loadedAtMs) ||
    Date.now() - loadedAtMs > AGENT_API_CACHE_TTL_MS;

  if (!cachedData || expired) {
    await loadData(null);
  }

  return cachedData;
}

async function getDayForApi(rawDate) {
  const dayKey = resolveDateInput(rawDate);
  const data = await ensureFreshDataForApi();
  const day = data.days.find((item) => item.dayKey === dayKey);
  if (!day) {
    throw new AgentApiError(404, "DAY_NOT_FOUND", `未找到 ${dayKey} 的数据。`);
  }
  return { day, dayKey, data };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendMarkdown(res, status, fileName, markdown) {
  res.writeHead(status, {
    "Content-Type": "text/markdown; charset=utf-8",
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Cache-Control": "no-store"
  });
  res.end(markdown);
}

function sendAgentApiError(res, error) {
  if (error instanceof AgentApiError) {
    if (error.status === 401) {
      res.setHeader("WWW-Authenticate", "Bearer");
    }
    sendJson(res, error.status, {
      ok: false,
      code: error.code,
      error: error.message
    });
    return;
  }

  sendJson(res, 500, {
    ok: false,
    code: "INTERNAL_ERROR",
    error: makeError(error)
  });
}

async function handleAgentApiRequest(req, res) {
  if (!agentApiSettings?.enabled) {
    throw new AgentApiError(503, "API_DISABLED", "Agent API 未启用。");
  }

  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET") {
    res.setHeader("Allow", "GET");
    throw new AgentApiError(405, "METHOD_NOT_ALLOWED", "仅支持 GET 请求。");
  }

  validateAgentApiAuth(req);

  const url = new URL(req.url || "/", "http://localhost");
  const pathname = url.pathname;

  if (pathname === "/v1/health") {
    sendJson(res, 200, {
      ok: true,
      service: "typeless-lite",
      version: app.getVersion(),
      host: agentApiSettings.host,
      port: agentApiSettings.port
    });
    return;
  }

  if (pathname === "/v1/days") {
    const data = await ensureFreshDataForApi();
    sendJson(res, 200, {
      ok: true,
      days: data.days.map((day) => ({
        dayKey: day.dayKey,
        dayLabel: day.dayLabel,
        count: day.count
      })),
      totalDays: data.dayCount
    });
    return;
  }

  if (pathname === "/v1/markdown") {
    const { day, dayKey, data } = await getDayForApi(url.searchParams.get("date"));
    const markdown = buildDayMarkdown(day, data.dbPath);
    sendJson(res, 200, {
      ok: true,
      date: dayKey,
      dayLabel: day.dayLabel,
      count: day.count,
      markdown
    });
    return;
  }

  if (pathname === "/v1/markdown/download") {
    const { day, dayKey, data } = await getDayForApi(url.searchParams.get("date"));
    const markdown = buildDayMarkdown(day, data.dbPath);
    const fileName = sanitizeFileName(`typeless-${dayKey}.md`, "typeless-export.md");
    sendMarkdown(res, 200, fileName, markdown);
    return;
  }

  throw new AgentApiError(404, "NOT_FOUND", "路由不存在。");
}

async function stopAgentApiServer() {
  if (!agentApiServer) {
    return;
  }

  const server = agentApiServer;
  agentApiServer = null;
  await new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

async function startAgentApiServer() {
  const settings = await ensureAgentApiSettings();
  if (!settings.enabled) {
    await stopAgentApiServer();
    return settings;
  }

  await stopAgentApiServer();

  const server = http.createServer((req, res) => {
    handleAgentApiRequest(req, res).catch((error) => {
      sendAgentApiError(res, error);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(settings.port, settings.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  agentApiServer = server;
  console.log(`[Agent API] Listening on ${settings.baseUrl}`);
  return settings;
}

async function loadData(overridePath) {
  const { dbPath, source } = await discoverDbPath(overridePath);

  const rows = await runSqliteJson(
    dbPath,
    `
SELECT
  id,
  created_at,
  updated_at,
  status,
  mode,
  focused_app_name,
  focused_app_bundle_id,
  focused_app_window_title,
  focused_app_window_web_title,
  focused_app_window_web_domain,
  focused_app_window_web_url,
  detected_language,
  duration,
  audio_context,
  COALESCE(NULLIF(TRIM(edited_text), ''), NULLIF(TRIM(refined_text), '')) AS text
FROM history
WHERE COALESCE(NULLIF(TRIM(edited_text), ''), NULLIF(TRIM(refined_text), '')) IS NOT NULL
ORDER BY datetime(created_at) DESC;
`.trim()
  );

  const data = buildModel(rows, dbPath, source);
  cachedData = data;
  await writeConfig({ lastDbPath: dbPath });
  return data;
}

function makeError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function handleLoad(_event, payload) {
  try {
    const data = await loadData(payload?.overridePath || null);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: makeError(error) };
  }
}

async function handlePickDb() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择 Typeless 数据库文件",
    properties: ["openFile"],
    defaultPath: os.homedir(),
    filters: [
      { name: "Database", extensions: ["db", "sqlite", "sqlite3"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }

  return handleLoad(null, { overridePath: result.filePaths[0] });
}

async function handleCopyDay(_event, payload) {
  try {
    const day = findDayByKey(payload?.dayKey);
    const text = buildDayPlainText(day);
    clipboard.writeText(text);
    return {
      ok: true,
      copiedChars: text.length
    };
  } catch (error) {
    return { ok: false, error: makeError(error) };
  }
}

async function handleExportMarkdown(_event, payload) {
  try {
    const day = findDayByKey(payload?.dayKey);
    const markdown = buildDayMarkdown(day, cachedData.dbPath);

    const defaultName = sanitizeFileName(`typeless-${day.dayKey}.md`, "typeless-export.md");
    const save = await dialog.showSaveDialog(mainWindow, {
      title: "导出 Markdown",
      defaultPath: path.join(app.getPath("downloads"), defaultName),
      filters: [{ name: "Markdown", extensions: ["md"] }]
    });

    if (save.canceled || !save.filePath) {
      return { ok: false, canceled: true };
    }

    await fsp.writeFile(save.filePath, markdown, "utf8");
    return { ok: true, filePath: save.filePath };
  } catch (error) {
    return { ok: false, error: makeError(error) };
  }
}

async function handleExportPdf(_event, payload) {
  let pdfWindow = null;
  try {
    const day = findDayByKey(payload?.dayKey);
    const defaultName = sanitizeFileName(`typeless-${day.dayKey}.pdf`, "typeless-export.pdf");

    const save = await dialog.showSaveDialog(mainWindow, {
      title: "导出 PDF",
      defaultPath: path.join(app.getPath("downloads"), defaultName),
      filters: [{ name: "PDF", extensions: ["pdf"] }]
    });

    if (save.canceled || !save.filePath) {
      return { ok: false, canceled: true };
    }

    pdfWindow = new BrowserWindow({
      show: false,
      width: 1200,
      height: 1700,
      webPreferences: {
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    const html = renderPdfHtml(day, cachedData.dbPath);
    await pdfWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true
    });

    await fsp.writeFile(save.filePath, pdfBuffer);
    return { ok: true, filePath: save.filePath };
  } catch (error) {
    return { ok: false, error: makeError(error) };
  } finally {
    if (pdfWindow && !pdfWindow.isDestroyed()) {
      pdfWindow.destroy();
    }
  }
}

async function handleExportRaw(_event, payload) {
  try {
    if (!cachedData) {
      throw new Error("当前没有可导出的数据，请先读取 Typeless 记录。");
    }

    const dayKey = payload?.dayKey || null;
    const selectedDay = dayKey ? findDayByKey(dayKey) : null;

    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择导出目录",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: app.getPath("downloads")
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const folderName = sanitizeFileName(
      dayKey ? `typeless-raw-${dayKey}` : `typeless-raw-all-${timestamp}`,
      `typeless-raw-${timestamp}`
    );
    const exportDir = path.join(result.filePaths[0], folderName);

    await fsp.mkdir(exportDir, { recursive: true });

    const payloadJson = {
      exportedAt: new Date().toISOString(),
      scope: dayKey ? "single-day" : "all-days",
      dayKey,
      dbPath: cachedData.dbPath,
      data: selectedDay ? selectedDay : cachedData.days
    };

    await fsp.writeFile(
      path.join(exportDir, "transcripts.raw.json"),
      JSON.stringify(payloadJson, null, 2),
      "utf8"
    );

    await fsp.copyFile(cachedData.dbPath, path.join(exportDir, "typeless.db.backup"));

    const readme = [
      "Typeless Raw Export",
      "",
      `Exported At: ${new Date().toLocaleString("zh-CN")}`,
      `Scope: ${payloadJson.scope}`,
      `Source DB: ${cachedData.dbPath}`,
      "",
      "Files:",
      "- transcripts.raw.json  (structured transcript data)",
      "- typeless.db.backup    (original SQLite database backup)"
    ].join("\n");

    await fsp.writeFile(path.join(exportDir, "README.txt"), readme, "utf8");

    return { ok: true, folderPath: exportDir };
  } catch (error) {
    return { ok: false, error: makeError(error) };
  }
}

async function handleOpenPath(_event, payload) {
  try {
    if (!payload?.path) {
      throw new Error("路径为空。");
    }
    const targetPath = payload.path;
    if (!(await fileExists(targetPath))) {
      throw new Error("路径不存在。");
    }
    await shell.showItemInFolder(targetPath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: makeError(error) };
  }
}

async function handleGetAgentApiInfo() {
  try {
    const settings = agentApiSettings || (await ensureAgentApiSettings());
    return {
      ok: true,
      data: toAgentApiInfo(settings)
    };
  } catch (error) {
    return { ok: false, error: makeError(error) };
  }
}

async function handleRegenerateAgentApiToken() {
  try {
    const token = generateAgentApiToken();
    await writeConfig({ agentApiToken: token });
    agentApiSettings = null;
    const settings = await startAgentApiServer();
    return {
      ok: true,
      data: toAgentApiInfo(settings)
    };
  } catch (error) {
    return { ok: false, error: makeError(error) };
  }
}

function registerIpcHandlers() {
  ipcMain.handle("typeless:load", handleLoad);
  ipcMain.handle("typeless:pick-db", handlePickDb);
  ipcMain.handle("typeless:copy-day", handleCopyDay);
  ipcMain.handle("typeless:export-markdown", handleExportMarkdown);
  ipcMain.handle("typeless:export-pdf", handleExportPdf);
  ipcMain.handle("typeless:export-raw", handleExportRaw);
  ipcMain.handle("typeless:open-path", handleOpenPath);
  ipcMain.handle("typeless:get-agent-api-info", handleGetAgentApiInfo);
  ipcMain.handle("typeless:regenerate-agent-api-token", handleRegenerateAgentApiToken);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    title: "Typeless Lite",
    backgroundColor: "#f4f5f2",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  createMainWindow();
  try {
    await startAgentApiServer();
  } catch (error) {
    console.error(`[Agent API] Failed to start: ${makeError(error)}`);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void stopAgentApiServer();
});
