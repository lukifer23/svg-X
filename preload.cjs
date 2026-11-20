const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectInputDirectory: () =>
    ipcRenderer.invoke("select-directory-grant", "input"),
  selectOutputDirectory: () =>
    ipcRenderer.invoke("select-directory-grant", "output"),
  listBatchInputs: (grantId) =>
    ipcRenderer.invoke("list-batch-inputs", grantId),
  beginBatch: (request) => ipcRenderer.invoke("begin-batch", request),
  cancelBatch: (id) => ipcRenderer.invoke("cancel-batch", id),
  finishBatch: (id) => ipcRenderer.invoke("finish-batch", id),
  readBatchInput: (request) => ipcRenderer.invoke("read-batch-input", request),
  writeBatchOutput: (request) =>
    ipcRenderer.invoke("write-batch-output", request),
  saveExport: (request) => ipcRenderer.invoke("save-export", request),
  openGrantedDirectory: (grantId) =>
    ipcRenderer.invoke("open-granted-directory", grantId),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  toggleConsole: () => ipcRenderer.invoke("toggle-console"),
});
