export interface TranscriptEntry {
  id: string;
  text: string;
  createdAt: string;
  dayKey: string;
  timeLabel: string;
  appName: string;
  language: string;
  duration: number | null;
  status: string;
  mode: string;
}

export interface TranscriptDay {
  dayKey: string;
  dayLabel: string;
  count: number;
  entries: TranscriptEntry[];
}

export interface TranscriptModel {
  dbPath: string;
  source: "manual" | "known" | "scan";
  recordingsDir: string;
  loadedAt: string;
  totalEntries: number;
  dayCount: number;
  range: {
    newest: string | null;
    oldest: string | null;
  };
  days: TranscriptDay[];
}

export interface IpcResult<T = undefined> {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  filePath?: string;
  folderPath?: string;
  copiedChars?: number;
  data?: T;
}

export interface TypelessApi {
  loadData(payload?: { overridePath?: string }): Promise<IpcResult<TranscriptModel>>;
  pickDatabase(): Promise<IpcResult<TranscriptModel>>;
  copyDay(payload: { dayKey: string }): Promise<IpcResult>;
  exportMarkdown(payload: { dayKey: string }): Promise<IpcResult>;
  exportPdf(payload: { dayKey: string }): Promise<IpcResult>;
  exportRaw(payload: { dayKey?: string }): Promise<IpcResult>;
  openPath(payload: { path: string }): Promise<IpcResult>;
}
