const { contextBridge, ipcRenderer } = require("electron");

// Expose a function to get the API base URL from the main process
contextBridge.exposeInMainWorld("electronAPI", {
  getApiBaseUrl: () => ipcRenderer.invoke("get-api-base-url"),
});

// For backwards compatibility, also expose a promise-based getter
// The frontend will need to await this before making API calls
let apiBaseUrlPromise = null;

contextBridge.exposeInMainWorld("__API_BASE_URL_PROMISE__", {
  get: () => {
    if (!apiBaseUrlPromise) {
      apiBaseUrlPromise = ipcRenderer.invoke("get-api-base-url");
    }
    return apiBaseUrlPromise;
  },
});
