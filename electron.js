const { app, BrowserWindow } = require('electron');
const path = require('path');
const { execSync } = require('child_process');
const express = require('express');
const expressApp = express();
const fs = require('fs');
const os = require('os');

// Define port for the express server
const PORT = 3000;

let mainWindow;
let serverProcess;

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost'; // Fallback
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    title: 'SVG Bolt',
    icon: path.join(__dirname, 'icon.png')
  });

  // Check if we're in development or production
  const isDev = !app.isPackaged;

  if (isDev) {
    // In development, connect to the Vite dev server
    mainWindow.loadURL('http://localhost:3000');
    // Open DevTools
    mainWindow.webContents.openDevTools();
  } else {
    // In production, serve the built files using Express
    expressApp.use(express.static(path.join(__dirname, 'dist')));
    
    expressApp.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
    
    const server = expressApp.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running at http://localhost:${PORT}`);
      const ipAddress = getLocalIpAddress();
      console.log(`Available on your network at http://${ipAddress}:${PORT}`);
      
      // Load the app from the Express server
      mainWindow.loadURL(`http://localhost:${PORT}`);
    });

    serverProcess = server;
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
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
  const ipAddress = getLocalIpAddress();
  console.log(`SVG Bolt is running!`);
  console.log(`Local access: http://localhost:${PORT}`);
  console.log(`Network access: http://${ipAddress}:${PORT}`);
}); 