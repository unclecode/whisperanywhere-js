const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    getRecordingStatus: () => ipcRenderer.invoke('get-recording-status'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    initializeApp: () => ipcRenderer.invoke('initialize-app'),
    onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_, status) => callback(status)),
    closeSettings: () => ipcRenderer.invoke('close-settings'), // Add this line
  });