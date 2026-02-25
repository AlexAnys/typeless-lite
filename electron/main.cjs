const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const CONFIG_FILE = "typeless-lite-settings.json";
const isDev = Boolean(DEV_SERVER_URL);

let mainWindow = null;
let cachedData = null;

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

function buildModel(rows, dbPath, source) {
  const entries = rows.map((row, index) => {
    const text = String(row.text || "").trim();
    const created = toDateSafe(row.created_at || row.updated_at);
    return {
      id: row.id || `entry-${index}`,
      text,
      createdAt: created.toISOString(),
      dayKey: formatDateKey(created),
      timeLabel: formatTimeLabel(created),
      appName: row.focused_app_name || "Unknown App",
      language: row.detected_language || "unknown",
      duration: typeof row.duration === "number" ? row.duration : null,
      status: row.status || "unknown",
      mode: row.mode || "voice_transcript"
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
    lines.push(`[${entry.timeLabel}] ${entry.text}`);
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
        <div class="time">${escapeHtml(entry.timeLabel)}</div>
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
  detected_language,
  duration,
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

function registerIpcHandlers() {
  ipcMain.handle("typeless:load", handleLoad);
  ipcMain.handle("typeless:pick-db", handlePickDb);
  ipcMain.handle("typeless:copy-day", handleCopyDay);
  ipcMain.handle("typeless:export-markdown", handleExportMarkdown);
  ipcMain.handle("typeless:export-pdf", handleExportPdf);
  ipcMain.handle("typeless:export-raw", handleExportRaw);
  ipcMain.handle("typeless:open-path", handleOpenPath);
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

app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();

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
