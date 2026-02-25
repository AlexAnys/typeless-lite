export interface TranscriptEntry {
  id: string;
  text: string;
  createdAt: string;
  dayKey: string;
  timeLabel: string;
  appName: string;
  appBundleId: string | null;
  windowTitle: string | null;
  webTitle: string | null;
  webDomain: string | null;
  webUrl: string | null;
  language: string;
  duration: number | null;
  status: string;
  mode: string;
  hasAudioContext: boolean;
  context: {
    decryptionStatus: "ok" | "failed" | "none";
    decryptError: string | null;
    visibleScreenContent: string | null;
    selectedText: string | null;
    textBeforeCursor: string | null;
    textAfterCursor: string | null;
    fullFieldContent: string | null;
    surroundingBefore: string | null;
    surroundingAfter: string | null;
    appNameFromContext: string | null;
    appIdentifier: string | null;
    windowTitleFromContext: string | null;
    pageTitle: string | null;
    pageUrl: string | null;
    domain: string | null;
    processId: number | null;
    appPath: string | null;
    deviceEnvironment: {
      operatingSystem: string | null;
      osVersion: string | null;
      architecture: string | null;
      locale: string | null;
      region: string | null;
    } | null;
  };
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
  contextSummary: {
    totalEntries: number;
    withAudioContext: number;
    decryptedEntries: number;
    decryptFailedEntries: number;
    withVisibleScreenContent: number;
    withSelectedText: number;
    withTextBeforeCursor: number;
    withTextAfterCursor: number;
    withFullFieldContent: number;
    withSurroundingContext: number;
    withBrowserUrl: number;
    withAppPath: number;
  };
  captureMatrix: Array<{
    key: string;
    description: string;
    localStorage: string;
    uploaded: string;
  }>;
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
