/**
 * Main process for SVG-X Electron application.
 * Handles window creation, IPC communication, and file system operations.
 */

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const express = require('express');
const expressApp = express();
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');

let mainWindow = null;
let serverProcess = null;

const PORT = 3001;
const isDev = !app.isPackaged;

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses.length > 0 ? addresses : ['localhost'];
}

// CORS headers for all Express responses (enables LAN access from other devices)
expressApp.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Network info API — available in both dev and production
expressApp.get('/api/network-info', (_req, res) => {
  const ips = getLocalIpAddresses();
  res.json({
    localUrl: `http://localhost:${PORT}`,
    networkUrls: ips.map(ip => `http://${ip}:${PORT}`)
  });
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'SVG-X',
    icon: path.join(__dirname, 'icon.png')
  });

  if (isDev) {
    mainWindow.loadURL(`http://localhost:${PORT}`);
    mainWindow.webContents.openDevTools();
  } else {
    let distPath = process.resourcesPath
      ? path.join(process.resourcesPath, 'dist')
      : path.join(__dirname, 'dist');

    if (!fs.existsSync(distPath)) {
      const candidates = [
        path.join(__dirname, 'dist'),
        path.join(__dirname, '..', 'dist'),
        path.join(app.getAppPath(), 'dist')
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) { distPath = candidate; break; }
      }
    }

    expressApp.use(express.static(distPath));
    expressApp.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));

    const server = expressApp.listen(PORT, '0.0.0.0', () => {
      const ips = getLocalIpAddresses();
      console.log(`SVG-X server: http://localhost:${PORT}`);
      console.log(`Network: http://${ips[0]}:${PORT}`);
      mainWindow.loadURL(`http://localhost:${PORT}`);
    });
    serverProcess = server;
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

/**
 * Validate that a resolved absolute path does not escape outside an allowed
 * root via path traversal. Uses path.relative() which is immune to substring
 * tricks like "my..file" or double-encoded separators.
 */
function isPathSafe(filePath, allowedRoot) {
  const normalized = path.normalize(path.resolve(filePath));
  if (!path.isAbsolute(normalized)) return false;
  // If no allowed root is specified, just require an absolute path
  if (!allowedRoot) return true;
  const rel = path.relative(allowedRoot, normalized);
  // If relative path starts with '..', the file escapes the allowed root
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function setupIPCHandlers() {
  ipcMain.handle('select-directory', async (_event, title) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: title || 'Select Directory'
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('read-directory', async (_event, dirPath) => {
    try {
      const files = fs.readdirSync(dirPath);
      const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.avif', '.heic', '.heif', '.tif', '.tiff']);
      const imageFiles = files.filter(file => IMAGE_EXTS.has(path.extname(file).toLowerCase()));
      return imageFiles.map(file => path.join(dirPath, file));
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('save-svg', async (_event, { svgData, outputPath }) => {
    const resolvedPath = path.resolve(outputPath);
    // Allow saving anywhere the user has access to (they chose the directory themselves)
    if (!path.isAbsolute(resolvedPath)) return { error: 'Invalid output path' };
    try {
      await fs.promises.writeFile(resolvedPath, svgData, 'utf8');
      return { success: true, path: resolvedPath };
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('read-image-file', async (_event, filePath) => {
    const resolvedPath = path.resolve(filePath);
    if (!path.isAbsolute(resolvedPath)) return { error: 'Invalid file path' };
    try {
      const ext = path.extname(resolvedPath).toLowerCase().substring(1);
      // Formats natively supported in browsers — pass through as-is
      const NATIVE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']);
      // Formats requiring Sharp decode → PNG conversion for renderer compatibility
      const SHARP_EXTS  = new Set(['avif', 'heic', 'heif', 'tif', 'tiff']);

      if (NATIVE_EXTS.has(ext)) {
        const data = await fs.promises.readFile(resolvedPath);
        const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };
        const mime = mimeMap[ext] || 'image/png';
        return `data:${mime};base64,${data.toString('base64')}`;
      }

      if (SHARP_EXTS.has(ext)) {
        // Decode via Sharp and re-emit as PNG so the renderer can handle it uniformly
        const pngBuffer = await sharp(resolvedPath).png().toBuffer();
        return `data:image/png;base64,${pngBuffer.toString('base64')}`;
      }

      return { error: `Unsupported file format: .${ext}` };
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('resize-image', async (_event, { imageData, width, height, maintainAspectRatio = true }) => {
    try {
      const commaIdx = imageData.indexOf(',');
      if (commaIdx === -1) return { error: 'Invalid data URL' };
      const header = imageData.slice(0, commaIdx);
      const base64Data = imageData.slice(commaIdx + 1);
      const mimeMatch = header.match(/data:(.*?);/);
      if (!mimeMatch) return { error: 'Cannot parse MIME type from data URL' };
      const mimeType = mimeMatch[1];

      const buffer = Buffer.from(base64Data, 'base64');
      const resizedBuffer = await sharp(buffer)
        .resize({ width, height, fit: maintainAspectRatio ? 'inside' : 'fill' })
        .toBuffer();

      return `data:${mimeType};base64,${resizedBuffer.toString('base64')}`;
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('show-save-dialog', async (_event, { defaultName, format } = {}) => {
    const filterMap = {
      svg:  [{ name: 'SVG Files',        extensions: ['svg']  }],
      eps:  [{ name: 'EPS Files',        extensions: ['eps']  }],
      dxf:  [{ name: 'DXF Files',        extensions: ['dxf']  }],
      json: [{ name: 'JSON Path Files',  extensions: ['json'] }],
    };
    const ext = format || 'svg';
    const base = (defaultName || 'image').replace(/\.[^/.]+$/, '');
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${base}.${ext}`,
      filters: filterMap[ext] || filterMap.svg,
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('open-output-directory', async (_event, dirPath) => {
    const resolvedPath = path.resolve(dirPath);
    if (path.isAbsolute(resolvedPath)) await shell.openPath(resolvedPath);
  });

  ipcMain.handle('join-paths', (_event, segments) => {
    return path.join(...segments);
  });

  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.handle('toggle-console', () => {
    if (!mainWindow) return { visible: false };
    if (mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.webContents.closeDevTools();
      return { visible: false };
    } else {
      mainWindow.webContents.openDevTools();
      return { visible: true };
    }
  });
}

app.on('ready', () => {
  const ips = getLocalIpAddresses();
  console.log(`SVG-X starting — local: http://localhost:${PORT}, network: http://${ips[0]}:${PORT}`);

  // In dev mode, start a minimal Express server for the /api/network-info endpoint only.
  // Vite handles all other requests. This avoids the network-info 404 in dev.
  if (isDev) {
    expressApp.listen(PORT + 1, '0.0.0.0', () => {
      console.log(`SVG-X API server (dev): http://localhost:${PORT + 1}`);
    }).on('error', () => {
      // Port in use — silently skip; WebRTC fallback handles network info
    });
  }

  setupIPCHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (serverProcess) { try { serverProcess.close(); } catch (_) {} }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
