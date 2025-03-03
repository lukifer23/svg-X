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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    title: 'SVG-X',
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