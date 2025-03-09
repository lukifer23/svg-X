// Last updated: 2025-03-08
/**
 * Preload script for SVG-X Electron application
 * This file safely exposes Electron APIs to the renderer process
 * through the contextBridge
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use the IPC
contextBridge.exposeInMainWorld('electronAPI', {
  // Directory selection methods
  selectInputDirectory: () => ipcRenderer.invoke('select-input-directory'),
  selectOutputDirectory: () => ipcRenderer.invoke('select-output-directory'),
  
  // Directory and file operations
  readDirectory: (dirPath) => ipcRenderer.invoke('read-directory', dirPath),
  saveSvg: (data) => ipcRenderer.invoke('save-svg', data),
  readImageFile: (filePath) => ipcRenderer.invoke('read-image-file', filePath),
  
  // Image processing
  resizeImage: (data) => ipcRenderer.invoke('resize-image', data),
  
  // Console window
  toggleConsole: () => ipcRenderer.invoke('toggle-console')
}); 