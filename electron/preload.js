const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  openFiles: (opts) => ipcRenderer.invoke("dialog:openFiles", opts),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
});
