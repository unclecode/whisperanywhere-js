// src/main/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  getRecordingStatus: () => ipcRenderer.invoke('get-recording-status'),
  onRecordingStatus: (callback) => ipcRenderer.on('recording-status', (_, status) => callback(status)),
  onTranscriptionResult: (callback) => ipcRenderer.on('transcription-result', (_, result) => callback(result)),
  onError: (callback) => ipcRenderer.on('error', (_, errorMessage) => callback(errorMessage)),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  initializeApp: () => ipcRenderer.invoke('initialize-app'),
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_, status) => callback(status)),
  toggleOverlay: () => ipcRenderer.invoke('toggle-overlay'),
  getOverlayVisibility: () => ipcRenderer.invoke('get-overlay-visibility'),
});