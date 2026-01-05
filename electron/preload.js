// electron/preload.js
const { contextBridge, ipcRenderer } = require("electron");

// Expose safe APIs to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  /**
   * Open a folder picker dialog
   * @param {Object} options - Dialog options
   * @param {string} options.title - Dialog title
   * @returns {Promise<string|null>} Selected folder path or null if cancelled
   */
  pickFolder: async (options = {}) => {
    try {
      const result = await ipcRenderer.invoke("dialog:openDirectory", options);
      return result;
    } catch (error) {
      console.error("Error picking folder:", error);
      return null;
    }
  },

  /**
   * Get the base URL for the reconciliation API
   * @returns {Promise<string>} API base URL
   */
  getBaseUrl: async () => {
    try {
      return await ipcRenderer.invoke("recon:getBaseUrl");
    } catch (error) {
      console.error("Error getting base URL:", error);
      return "http://127.0.0.1:8000";
    }
  },
});