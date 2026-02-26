/**
 * Preload script for SVG-X Electron application.
 * Safely exposes main-process APIs to the renderer via contextBridge.
 * All method signatures must match the Window.electronAPI type in src/electron.d.ts.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Directory selection ---
  selectInputDirectory: () => ipcRenderer.invoke('select-directory', 'Select Input Directory Containing Images'),
  selectOutputDirectory: () => ipcRenderer.invoke('select-directory', 'Select Output Directory for SVG Files'),

  // --- File system operations ---
  readDirectory: (dirPath) => ipcRenderer.invoke('read-directory', dirPath),
  saveSvg: (data) => ipcRenderer.invoke('save-svg', data),
  readImageFile: (filePath) => ipcRenderer.invoke('read-image-file', filePath),

  // --- Image processing ---
  resizeImage: (data) => ipcRenderer.invoke('resize-image', data),

  // --- Native save dialog ---
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),

  // --- Shell utilities ---
  openOutputDirectory: (dirPath) => ipcRenderer.invoke('open-output-directory', dirPath),

  // --- Path utilities (server-side path.join, handles OS separators) ---
  joinPaths: (...segments) => ipcRenderer.invoke('join-paths', segments),

  // --- App info ---
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // --- Debug console ---
  toggleConsole: () => ipcRenderer.invoke('toggle-console'),
});
