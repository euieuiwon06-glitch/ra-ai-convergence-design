const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  showAlert: (payload) => ipcRenderer.send("posture:show-alert", payload),
  closeAlert: () => ipcRenderer.send("posture:close-alert"),
  onAlertUpdate: (callback) => {
    ipcRenderer.on("alert:update", (_event, data) => callback(data));
  },
});
