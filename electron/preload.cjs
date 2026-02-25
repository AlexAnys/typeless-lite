const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("typelessApi", {
  loadData: (payload) => ipcRenderer.invoke("typeless:load", payload),
  pickDatabase: () => ipcRenderer.invoke("typeless:pick-db"),
  copyDay: (payload) => ipcRenderer.invoke("typeless:copy-day", payload),
  exportMarkdown: (payload) => ipcRenderer.invoke("typeless:export-markdown", payload),
  exportPdf: (payload) => ipcRenderer.invoke("typeless:export-pdf", payload),
  exportRaw: (payload) => ipcRenderer.invoke("typeless:export-raw", payload),
  openPath: (payload) => ipcRenderer.invoke("typeless:open-path", payload)
});
