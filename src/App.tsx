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
  RefreshCcw
} from "lucide-react";
import type { IpcResult, TranscriptDay, TranscriptModel } from "./types";

interface UiNotice {
  type: "success" | "error" | "info";
  text: string;
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
    return (
      model.days.find((day) => day.dayKey === selectedDayKey) ?? model.days[0] ?? null
    );
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
              <p className="entry-text">{entry.text}</p>
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
          <div className="brand-sub">本地语音转录浏览与导出</div>
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
