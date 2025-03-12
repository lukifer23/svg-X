// Last updated: 2025-03-11 - Force update to repository
// Last updated: 2025-03-08
/**
 * Main process file for SVG-X Electron application
 * This file handles all the Electron-specific functionality including:
 * - Window creation
 * - IPC communication
 * - File system operations
 */

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const { execSync, spawn } = require('child_process');
const express = require('express');
const expressApp = express();
const fs = require('fs');
const os = require('os');
const http = require('http');
const sharp = require('sharp');

// Add missing variable declarations
let mainWindow = null;
let serverProcess = null;
let consoleWindow = null;

// Define port for the express server
// Using 3001 since port 3000 appears to be in use
const PORT = 3001;

// Function to get local IP addresses
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  const ipAddresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        ipAddresses.push(iface.address);
      }
    }
  }
  return ipAddresses.length > 0 ? ipAddresses : ['localhost']; // Fallback
}

// Create a separate console window for logging
function createConsoleWindow() {
  consoleWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'SVG-X Console',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  
  // Load a simple HTML file to display logs
  const consoleHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>SVG-X Console</title>
      <style>
        body {
          background-color: #1e1e1e;
          color: #f0f0f0;
          font-family: monospace;
          padding: 10px;
          margin: 0;
          height: 100vh;
          overflow-y: auto;
          white-space: pre-wrap;
          word-break: break-all;
        }
        .info { color: #4cc9f0; }
        .success { color: #4ade80; }
        .error { color: #f87171; }
        .warning { color: #fbbf24; }
      </style>
    </head>
    <body>
      <div id="log"></div>
      <script>
        const logEl = document.getElementById('log');
        window.electronAPI = {
          receiveLog: (message, type) => {
            const entry = document.createElement('div');
            entry.className = type || '';
            entry.textContent = message;
            logEl.appendChild(entry);
            window.scrollTo(0, document.body.scrollHeight);
          }
        };
      </script>
    </body>
    </html>
  `;
  
  // Write the HTML to a temporary file
  const tempHtmlPath = path.join(app.getPath('temp'), 'svg-x-console.html');
  fs.writeFileSync(tempHtmlPath, consoleHtml);
  
  // Load the HTML file
  consoleWindow.loadFile(tempHtmlPath);
  
  // Don't show in taskbar
  consoleWindow.setSkipTaskbar(true);
  
  // Hide by default
  consoleWindow.hide();
  
  consoleWindow.on('closed', () => {
    consoleWindow = null;
  });
  
  return consoleWindow;
}

// Console logging function
function logToConsole(message, type = 'info') {
  console.log(message); // Still log to main console
  
  if (consoleWindow && !consoleWindow.isDestroyed()) {
    consoleWindow.webContents.executeJavaScript(`
      window.electronAPI.receiveLog(${JSON.stringify(message)}, ${JSON.stringify(type)});
    `).catch(err => console.error('Error sending log to console window:', err));
  }
}

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

  // Create console window
  createConsoleWindow();

  // Check if we're in development or production
  const isDev = !app.isPackaged;

  if (isDev) {
    // In development, connect to the Vite dev server
    // Wait for dev server to start
    console.log('Development mode - connecting to Vite server at port 3001');
    mainWindow.loadURL('http://localhost:3001');
    
    // Open DevTools
    mainWindow.webContents.openDevTools();
  } else {
    // In production, determine the correct path to the built files
    let distPath;
    
    // Check if running from packaged app (resources directory)
    if (process.resourcesPath) {
      distPath = path.join(process.resourcesPath, 'dist');
      console.log(`Looking for dist in resources: ${distPath}`);
    } else {
      // Fallback to the standard dist directory
      distPath = path.join(__dirname, 'dist');
      console.log(`Looking for dist in __dirname: ${distPath}`);
    }
    
    // Check if the dist directory exists
    if (!fs.existsSync(distPath)) {
      console.error(`Error: ${distPath} does not exist!`);
      // Try alternate locations
      const altPaths = [
        path.join(__dirname, 'dist'),
        path.join(__dirname, '..', 'dist'),
        path.join(app.getAppPath(), 'dist')
      ];
      
      for (const altPath of altPaths) {
        console.log(`Trying alternate path: ${altPath}`);
        if (fs.existsSync(altPath)) {
          distPath = altPath;
          console.log(`Using alternate path: ${distPath}`);
          break;
        }
      }
    }
    
    // Serve the static files
    expressApp.use(express.static(distPath));
    
    expressApp.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    
    const server = expressApp.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running at http://localhost:${PORT}`);
      const ipAddresses = getLocalIpAddress();
      console.log(`Available on your network at http://${ipAddresses[0]}:${PORT}`);
      
      // Load the app from the Express server
      mainWindow.loadURL(`http://localhost:${PORT}`);
    });

    serverProcess = server;
  }

  // Prevent external links from opening in the Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external URLs in the default browser instead
    if (url.startsWith('http:') || url.startsWith('https:')) {
      require('electron').shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Add API endpoint for network information
  expressApp.get('/api/network-info', (req, res) => {
    const ipAddresses = getLocalIpAddress();
    res.json({
      localUrl: `http://localhost:${PORT}`,
      networkUrls: ipAddresses.map(ip => `http://${ip}:${PORT}`)
    });
  });

  // Setup IPC handlers for batch processing
  setupIPCHandlers();
}

// Set up IPC handlers for communication between renderer and main process
function setupIPCHandlers() {
  // Handler for selecting input directory
  ipcMain.handle('select-input-directory', async () => {
    console.log('Handling select-input-directory request');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Input Directory Containing Images'
    });
    
    console.log('Dialog result:', result);
    return result.canceled ? null : result.filePaths[0];
  });

  // Handler for selecting output directory
  ipcMain.handle('select-output-directory', async () => {
    console.log('Handling select-output-directory request');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Output Directory for SVG Files'
    });
    
    console.log('Dialog result:', result);
    return result.canceled ? null : result.filePaths[0];
  });

  // Handler for reading directory contents
  ipcMain.handle('read-directory', async (event, dirPath) => {
    console.log(`Reading directory: ${dirPath}`);
    try {
      const files = fs.readdirSync(dirPath);
      
      // Filter for image files
      const imageFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.png', '.jpg', '.jpeg', '.gif', '.bmp'].includes(ext);
      });
      
      console.log(`Found ${imageFiles.length} image files`);
      // Return full paths
      return imageFiles.map(file => path.join(dirPath, file));
    } catch (error) {
      console.error('Error reading directory:', error);
      return { error: error.message };
    }
  });

  // Handler for saving SVG file
  ipcMain.handle('save-svg', async (event, { svgData, outputPath }) => {
    console.log(`Saving SVG to: ${outputPath}`);
    try {
      fs.writeFileSync(outputPath, svgData);
      return { success: true, path: outputPath };
    } catch (error) {
      console.error('Error saving SVG:', error);
      return { error: error.message };
    }
  });

  // Handler for reading image file as data URL
  ipcMain.handle('read-image-file', async (event, filePath) => {
    console.log(`Reading image file: ${filePath}`);
    try {
      const data = fs.readFileSync(filePath);
      const base64data = data.toString('base64');
      const extension = path.extname(filePath).toLowerCase().substring(1);
      const mimetype = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'bmp': 'image/bmp'
      }[extension] || 'application/octet-stream';
      
      return `data:${mimetype};base64,${base64data}`;
    } catch (error) {
      console.error('Error reading image file:', error);
      return { error: error.message };
    }
  });

  // Handler for resizing images
  ipcMain.handle('resize-image', async (event, { imageData, width, height, maintainAspectRatio = true }) => {
    logToConsole(`Resizing image to ${width}x${height}`, 'info');
    
    try {
      // Extract the base64 data from the data URL
      const [header, base64Data] = imageData.split(',');
      const mimeType = header.match(/data:(.*?);/)[1];
      
      // Convert base64 to buffer
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Create sharp instance
      let sharpInstance = sharp(buffer);
      
      // Get image metadata
      const metadata = await sharpInstance.metadata();
      logToConsole(`Original image: ${metadata.width}x${metadata.height}`, 'info');
      
      // Resize using sharp
      let resizeOptions = {
        width: width,
        height: height,
        fit: maintainAspectRatio ? 'inside' : 'fill'
      };
      
      // Apply resize
      sharpInstance = sharpInstance.resize(resizeOptions);
      
      // Convert back to buffer
      const resizedBuffer = await sharpInstance.toBuffer();
      
      // Convert buffer to base64
      const resizedBase64 = resizedBuffer.toString('base64');
      
      // Create data URL
      const dataUrl = `data:${mimeType};base64,${resizedBase64}`;
      
      logToConsole('Image resized successfully', 'success');
      return dataUrl;
    } catch (error) {
      logToConsole(`Error resizing image: ${error.message}`, 'error');
      return { error: error.message };
    }
  });
  
  // Handler for toggling console window
  ipcMain.handle('toggle-console', async (event) => {
    if (!consoleWindow || consoleWindow.isDestroyed()) {
      createConsoleWindow();
    }
    
    if (consoleWindow.isVisible()) {
      consoleWindow.hide();
      return { visible: false };
    } else {
      consoleWindow.show();
      return { visible: true };
    }
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }

  // Close Express server if it's running
  if (serverProcess) {
    serverProcess.close();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Display local network access info on app start
app.on('ready', () => {
  const ipAddresses = getLocalIpAddress();
  console.log(`SVG-X is running!`);
  console.log(`Local access: http://localhost:${PORT}`);
  console.log(`Network access: http://${ipAddresses[0]}:${PORT}`);
}); 