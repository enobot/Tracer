import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tracer", {
  onHotkeyPressed: (callback) => {
    ipcRenderer.on("hotkey-pressed", () => {
      callback();
    });
  },

  ping: () => ipcRenderer.invoke("tracer:ping"),

  inspectScreenshot: (screenshot, prompt) =>
    ipcRenderer.invoke("tracer:inspect-screenshot", {
      screenshot,
      prompt,
    }),
});
