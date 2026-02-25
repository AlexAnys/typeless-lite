import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Copy,
  Database,
  Download,
  File,
  FileArchive,
  FileText,
  FolderOpen,
  Globe,
  RefreshCcw,
  Shield,
  TriangleAlert
} from "lucide-react";
import type { IpcResult, TranscriptDay, TranscriptEntry, TranscriptModel } from "./types";

interface UiNotice {
  type: "success" | "error" | "info";
  text: string;
}

const SENSITIVE_PREVIEW_LIMIT = 520;

function formatCount(value: string | null) {
  if (!value) {
    return "0";
  }
  return `${value.length.toLocaleString()} 字符`;
}

function previewSensitive(value: string | null) {
  if (!value) {
    return {
      text: "",
      truncated: false
    };
  }
  if (value.length <= SENSITIVE_PREVIEW_LIMIT) {
    return {
      text: value,
      truncated: false
    };
  }
  return {
    text: `${value.slice(0, SENSITIVE_PREVIEW_LIMIT)}\n...（已截断，完整长度 ${value.length.toLocaleString()} 字符）`,
    truncated: true
  };
}

function ContextTextBlock({ label, value }: { label: string; value: string | null }) {
  if (!value) {
    return null;
  }

  const preview = previewSensitive(value);

  return (
    <section className="context-block">
      <div className="context-block-head">
        <span>{label}</span>
        <span>{formatCount(value)}</span>
      </div>
      <pre>{preview.text}</pre>
      {preview.truncated ? <div className="context-hint">此字段较长，当前仅展示前 520 字符。</div> : null}
    </section>
  );
}

function App() {
  const [model, setModel] = useState<TranscriptModel | null>(null);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState<UiNotice | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const selectedDay = useMemo(() => {
    if (!model) {
      return null;
    }
    return model.days.find((day) => day.dayKey === selectedDayKey) ?? model.days[0] ?? null;
  }, [model, selectedDayKey]);

  const refreshData = useCallback(async (overridePath?: string) => {
    if (!window.typelessApi) {
      setFatalError("当前页面未运行在 Electron 环境。请使用 `npm run dev` 启动桌面应用。");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setFatalError(null);

    const result = await window.typelessApi.loadData(overridePath ? { overridePath } : undefined);

    if (!result.ok || !result.data) {
      setModel(null);
      setFatalError(result.error ?? "读取 Typeless 数据失败。");
      setIsLoading(false);
      return;
    }

    setModel(result.data);
    setSelectedDayKey(result.data.days[0]?.dayKey ?? null);
    setIsLoading(false);
  }, []);

  const pickDatabaseManually = useCallback(async () => {
    if (!window.typelessApi) {
      return;
    }

    setIsLoading(true);
    const result = await window.typelessApi.pickDatabase();

    if (result.canceled) {
      setIsLoading(false);
      return;
    }

    if (!result.ok || !result.data) {
      setFatalError(result.error ?? "无法读取所选数据库。");
      setIsLoading(false);
      return;
    }

    setModel(result.data);
    setSelectedDayKey(result.data.days[0]?.dayKey ?? null);
    setFatalError(null);
    setNotice({ type: "success", text: "已切换数据源。" });
    setIsLoading(false);
  }, []);

  const runAction = useCallback(
    async <T,>(
      task: () => Promise<IpcResult<T>>,
      successMessage: string,
      openPath?: (result: IpcResult<T>) => string | undefined
    ) => {
      const result = await task();
      if (result.canceled) {
        return;
      }

      if (!result.ok) {
        setNotice({ type: "error", text: result.error ?? "操作失败，请重试。" });
        return;
      }

      if (openPath) {
        const target = openPath(result);
        if (target) {
          void window.typelessApi.openPath({ path: target });
        }
      }

      setNotice({ type: "success", text: successMessage });
    },
    []
  );

  const copySelectedDay = useCallback(async () => {
    if (!selectedDay) {
      return;
    }

    await runAction(
      () => window.typelessApi.copyDay({ dayKey: selectedDay.dayKey }),
      `已复制 ${selectedDay.dayKey} 的全部对话。`
    );
  }, [runAction, selectedDay]);

  const exportMarkdown = useCallback(async () => {
    if (!selectedDay) {
      return;
    }

    await runAction(
      () => window.typelessApi.exportMarkdown({ dayKey: selectedDay.dayKey }),
      "Markdown 导出完成。",
      (result) => result.filePath
    );
  }, [runAction, selectedDay]);

  const exportPdf = useCallback(async () => {
    if (!selectedDay) {
      return;
    }

    await runAction(
      () => window.typelessApi.exportPdf({ dayKey: selectedDay.dayKey }),
      "PDF 导出完成。",
      (result) => result.filePath
    );
  }, [runAction, selectedDay]);

  const exportRaw = useCallback(async () => {
    if (!selectedDay) {
      return;
    }

    await runAction(
      () => window.typelessApi.exportRaw({ dayKey: selectedDay.dayKey }),
      "Raw 导出完成（JSON + DB 备份）。",
      (result) => result.folderPath
    );
  }, [runAction, selectedDay]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (!model?.days.length) {
      return;
    }
    if (!selectedDayKey || !model.days.some((day) => day.dayKey === selectedDayKey)) {
      setSelectedDayKey(model.days[0].dayKey);
    }
  }, [model, selectedDayKey]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = window.setTimeout(() => {
      setNotice(null);
    }, 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void copySelectedDay();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copySelectedDay]);

  function renderEmptyState() {
    return (
      <section className="empty-state">
        <div className="empty-icon">
          <Database size={22} />
        </div>
        <h2>未能自动读取 Typeless 数据</h2>
        <p>{fatalError ?? "请手动选择 typeless.db 文件。"}</p>
        <div className="empty-actions">
          <button className="btn primary" onClick={() => void pickDatabaseManually()}>
            <FolderOpen size={16} />
            选择数据库文件
          </button>
          <button className="btn" onClick={() => void refreshData()}>
            <RefreshCcw size={16} />
            重新扫描
          </button>
        </div>
      </section>
    );
  }

  function renderPrivacyLens(data: TranscriptModel) {
    return (
      <details className="privacy-lens" open>
        <summary>
          <Shield size={15} />
          隐私上下文视图（本机提取）
        </summary>

        <div className="privacy-note">
          以下字段来自本机数据库明文字段与 `audio_context` 解密结果。上传列基于你的本机逆向研究结论，用于帮助用户理解每次输入关联了哪些上下文信息。
        </div>

        <div className="privacy-metrics">
          <div className="metric-item">有 `audio_context`：{data.contextSummary.withAudioContext}</div>
          <div className="metric-item">解密成功：{data.contextSummary.decryptedEntries}</div>
          <div className="metric-item">解密失败：{data.contextSummary.decryptFailedEntries}</div>
          <div className="metric-item">含可见屏幕文本：{data.contextSummary.withVisibleScreenContent}</div>
          <div className="metric-item">含完整输入框内容：{data.contextSummary.withFullFieldContent}</div>
          <div className="metric-item">含 URL/域名：{data.contextSummary.withBrowserUrl}</div>
        </div>

        <div className="matrix-scroll">
          <table className="matrix-table">
            <thead>
              <tr>
                <th>数据</th>
                <th>说明</th>
                <th>本地存储</th>
                <th>上传服务端</th>
              </tr>
            </thead>
            <tbody>
              {data.captureMatrix.map((item) => (
                <tr key={item.key}>
                  <td>{item.key}</td>
                  <td>{item.description}</td>
                  <td>{item.localStorage}</td>
                  <td>{item.uploaded}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    );
  }

  function renderEntryAssociation(entry: TranscriptEntry) {
    return (
      <div className="entry-association">
        {entry.appBundleId ? <span>Bundle: {entry.appBundleId}</span> : null}
        {entry.windowTitle ? <span>窗口: {entry.windowTitle}</span> : null}
        {entry.webDomain ? <span>域名: {entry.webDomain}</span> : null}
        {entry.webUrl ? (
          <span className="entry-url" title={entry.webUrl}>
            <Globe size={12} />
            {entry.webUrl}
          </span>
        ) : null}
      </div>
    );
  }

  function renderContext(entry: TranscriptEntry) {
    const context = entry.context;
    const decryptionLabel =
      context.decryptionStatus === "ok"
        ? "已解密"
        : context.decryptionStatus === "failed"
          ? "解密失败"
          : "无 audio_context";

    return (
      <details className="context-details">
        <summary>
          <TriangleAlert size={14} />
          上下文采集详情（{decryptionLabel}）
        </summary>

        {context.decryptionStatus === "failed" ? (
          <div className="context-error">{context.decryptError ?? "无法解密该条记录。"}</div>
        ) : null}

        <div className="context-meta-grid">
          <div>
            <span>应用名</span>
            <strong>{entry.appName}</strong>
          </div>
          <div>
            <span>窗口标题</span>
            <strong>{entry.windowTitle ?? "-"}</strong>
          </div>
          <div>
            <span>URL / 域名</span>
            <strong>{entry.webUrl ?? entry.webDomain ?? "-"}</strong>
          </div>
          <div>
            <span>进程 / 路径</span>
            <strong>
              {context.processId ?? "-"}
              {context.appPath ? ` | ${context.appPath}` : ""}
            </strong>
          </div>
        </div>

        <div className="context-text-grid">
          <ContextTextBlock label="visible_screen_content" value={context.visibleScreenContent} />
          <ContextTextBlock label="selected_text" value={context.selectedText} />
          <ContextTextBlock label="text_before_cursor" value={context.textBeforeCursor} />
          <ContextTextBlock label="text_after_cursor" value={context.textAfterCursor} />
          <ContextTextBlock label="full_field_content" value={context.fullFieldContent} />
          <ContextTextBlock label="surrounding_context.before" value={context.surroundingBefore} />
          <ContextTextBlock label="surrounding_context.after" value={context.surroundingAfter} />
        </div>

        {context.deviceEnvironment ? (
          <div className="device-meta">
            设备环境：
            {[
              context.deviceEnvironment.operatingSystem,
              context.deviceEnvironment.osVersion,
              context.deviceEnvironment.architecture,
              context.deviceEnvironment.locale,
              context.deviceEnvironment.region
            ]
              .filter(Boolean)
              .join(" | ") || "-"}
          </div>
        ) : null}
      </details>
    );
  }

  function renderTimeline(day: TranscriptDay) {
    return (
      <section className="timeline-panel">
        <header className="timeline-head">
          <div>
            <div className="timeline-title">{day.dayLabel}</div>
            <div className="timeline-subtitle">
              {day.dayKey} · {day.count} 条记录
            </div>
          </div>
          <div className="timeline-actions">
            <button className="btn" onClick={() => void copySelectedDay()}>
              <Copy size={15} />
              复制当天
            </button>
            <button className="btn" onClick={() => void exportMarkdown()}>
              <FileText size={15} />
              Markdown
            </button>
            <button className="btn" onClick={() => void exportPdf()}>
              <File size={15} />
              PDF
            </button>
            <button className="btn" onClick={() => void exportRaw()}>
              <FileArchive size={15} />
              Raw
            </button>
          </div>
        </header>

        <div className="timeline-list">
          {day.entries.map((entry) => (
            <article key={entry.id} className="entry-card">
              <div className="entry-meta">
                <span className="entry-time">{entry.timeLabel}</span>
                <span className="entry-app">{entry.appName}</span>
              </div>
              {renderEntryAssociation(entry)}
              <p className="entry-text">{entry.text}</p>
              {renderContext(entry)}
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand">Typeless Lite</div>
          <div className="brand-sub">本地语音转录浏览、导出与上下文审计</div>
        </div>

        <div className="source-path" title={model?.dbPath ?? "未连接 Typeless 数据库"}>
          <Database size={14} />
          <span>{model?.dbPath ?? "等待自动识别 Typeless 数据库"}</span>
        </div>

        <div className="topbar-actions">
          <button className="btn" onClick={() => void pickDatabaseManually()}>
            <FolderOpen size={15} />
            选择数据库
          </button>
          <button className="btn" onClick={() => void refreshData()}>
            <RefreshCcw size={15} />
            刷新
          </button>
        </div>
      </header>

      {notice && <div className={`notice ${notice.type}`}>{notice.text}</div>}

      <section className="stats-row">
        <div className="stat-item">
          <CalendarDays size={15} />
          <span>日期数：{model?.dayCount ?? "-"}</span>
        </div>
        <div className="stat-item">
          <FileText size={15} />
          <span>文本条数：{model?.totalEntries ?? "-"}</span>
        </div>
        <div className="stat-item">
          <Download size={15} />
          <span>快捷键：⌘/Ctrl + Shift + C 复制当天</span>
        </div>
      </section>

      {model ? renderPrivacyLens(model) : null}

      <main className="workspace">
        {isLoading ? (
          <section className="loading-panel">正在读取 Typeless 数据...</section>
        ) : !model || model.days.length === 0 || fatalError ? (
          renderEmptyState()
        ) : (
          <>
            <aside className="day-panel">
              <div className="day-panel-title">日期</div>
              <div className="day-list">
                {model.days.map((day) => (
                  <button
                    key={day.dayKey}
                    className={`day-item ${selectedDay?.dayKey === day.dayKey ? "active" : ""}`}
                    onClick={() => setSelectedDayKey(day.dayKey)}
                  >
                    <div className="day-item-top">
                      <span>{day.dayLabel}</span>
                      <span className="day-count">{day.count}</span>
                    </div>
                    <div className="day-item-bottom">{day.dayKey}</div>
                  </button>
                ))}
              </div>
            </aside>

            {selectedDay ? renderTimeline(selectedDay) : null}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
