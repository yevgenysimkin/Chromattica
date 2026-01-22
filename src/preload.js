const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Profile management
  getProfiles: () => ipcRenderer.invoke('get-profiles'),
  saveProfiles: (profiles) => ipcRenderer.invoke('save-profiles', profiles),
  getSessionPartition: (profileId) => ipcRenderer.invoke('get-session-partition', profileId),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),
  getTabs: () => ipcRenderer.invoke('get-tabs'),
  saveTabs: (tabState) => ipcRenderer.invoke('save-tabs', tabState),

  // Extension management
  getExtensions: (profileId) => ipcRenderer.invoke('get-extensions', profileId),
  installExtension: (profileId, sourcePath) => ipcRenderer.invoke('install-extension', profileId, sourcePath),
  installExtensionFromWebstore: (profileId, extensionIdOrUrl) => ipcRenderer.invoke('install-extension-from-webstore', profileId, extensionIdOrUrl),
  removeExtension: (profileId, extensionId) => ipcRenderer.invoke('remove-extension', profileId, extensionId),
  selectExtensionFolder: () => ipcRenderer.invoke('select-extension-folder'),
  getExtensionIcon: (iconPath) => ipcRenderer.invoke('get-extension-icon', iconPath),
  openExtensionPopup: (profileId, extensionId) => ipcRenderer.invoke('open-extension-popup', profileId, extensionId),
  importBookmarks: () => ipcRenderer.invoke('import-bookmarks'),

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getUserAgent: () => ipcRenderer.invoke('get-user-agent'),
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (event, data) => callback(data));
  }
});
