const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const express = require("express");
const {
  isAllowedNavigation,
  isSafeExternalUrl,
  validateText,
} = require("./desktop/security.cjs");
const { collectNetworkUrls } = require("./desktop/network.cjs");
const {
  createBatchRun,
  getExportFormat,
  IMAGE_EXTENSIONS,
  MAX_OUTPUT_BYTES,
  writeBatchFailureReport,
} = require("./desktop/batch.cjs");

const expressApp = express();
const grants = new Map();
let batchRun;
let quitPending = false;
const PORT = Number(process.env.SVGX_PORT || process.env.PORT || 3001);
const LAN_ENABLED = process.env.SVGX_LAN === "1";
const HOST = LAN_ENABLED ? "::" : "127.0.0.1";
// Keep the renderer URL on an explicit address family. On hosts where
// `localhost` resolves to ::1 first, loading it would fail while the local-only
// server is intentionally bound to 127.0.0.1.
const APP_ORIGIN = `http://127.0.0.1:${PORT}`;
const isDev = !app.isPackaged;
let mainWindow = null;
let serverProcess = null;
let activeHost = HOST;

expressApp.disable("x-powered-by");
expressApp.use((_request, response, next) => {
  response.set({
    "Content-Security-Policy":
      "default-src 'self'; base-uri 'self'; connect-src 'self' blob:; font-src 'self' data:; form-action 'none'; frame-ancestors 'none'; img-src 'self' blob: data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  next();
});
expressApp.get("/api/health", (_request, response) =>
  response.json({ ok: true, lanEnabled: LAN_ENABLED }),
);
expressApp.get("/api/network-info", (_request, response) =>
  response.json({
    localUrl: `http://localhost:${PORT}`,
    networkUrls: LAN_ENABLED
      ? collectNetworkUrls(
          os.networkInterfaces(),
          PORT,
          activeHost === "::" ? new Set([4, 6]) : new Set([4]),
        )
      : [],
    lanEnabled: LAN_ENABLED,
  }),
);

const issueGrant = (root, kind) => {
  const grantId = crypto.randomUUID();
  grants.set(grantId, { root: path.resolve(root), kind });
  return { grantId, displayPath: path.resolve(root) };
};

const resolveGrant = (grantId, kind) => {
  const grant = typeof grantId === "string" ? grants.get(grantId) : null;
  if (!grant || grant.kind !== kind)
    throw new Error("Directory permission is missing or expired");
  return grant;
};

const requireRenderer = (event) => {
  if (
    !mainWindow ||
    event.sender.id !== mainWindow.webContents.id ||
    !event.senderFrame ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  )
    throw new Error("Untrusted IPC sender");
};

const requireBatch = (runId) => {
  if (!batchRun || batchRun.id !== runId)
    throw new Error("Batch run is missing or expired");
  return batchRun;
};

const finishBatch = async (run) => {
  await run.finish();
  if (batchRun === run) batchRun = undefined;
};

const setupIpc = () => {
  ipcMain.handle("select-directory-grant", async (event, kind) => {
    requireRenderer(event);
    if (kind !== "input" && kind !== "output")
      throw new Error("Invalid directory kind");
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title:
        kind === "input"
          ? "Select Input Directory Containing Images"
          : "Select Output Directory",
    });
    return result.canceled
      ? null
      : issueGrant(await fs.promises.realpath(result.filePaths[0]), kind);
  });

  ipcMain.handle("list-batch-inputs", async (event, grantId) => {
    requireRenderer(event);
    const { root } = resolveGrant(grantId, "input");
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          entry.isFile() &&
          IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
      )
      .map((entry) => ({ id: entry.name, name: entry.name }));
  });

  ipcMain.handle(
    "begin-batch",
    (event, { inputGrantId, outputGrantId, format }) => {
      requireRenderer(event);
      if (quitPending) throw new Error("SVG-X is closing");
      if (batchRun) throw new Error("A batch is already running");
      const input = resolveGrant(inputGrantId, "input");
      const output = resolveGrant(outputGrantId, "output");
      batchRun = createBatchRun(input.root, output.root, format);
      return batchRun.id;
    },
  );

  ipcMain.handle("cancel-batch", (event, id) => {
    requireRenderer(event);
    requireBatch(id).cancel();
  });

  ipcMain.handle("finish-batch", (event, id) => {
    requireRenderer(event);
    return finishBatch(requireBatch(id));
  });

  ipcMain.handle(
    "read-batch-input",
    (event, { runId, fileId, resize, highestQuality }) => {
      requireRenderer(event);
      return requireBatch(runId).read({ fileId, resize, highestQuality });
    },
  );

  ipcMain.handle(
    "write-batch-output",
    (event, { runId, baseName, content }) => {
      requireRenderer(event);
      return requireBatch(runId).write({ baseName, content });
    },
  );

  ipcMain.handle(
    "save-batch-failure-report",
    (event, { outputGrantId, content }) => {
      requireRenderer(event);
      const { root } = resolveGrant(outputGrantId, "output");
      return writeBatchFailureReport(root, content);
    },
  );

  ipcMain.handle(
    "save-export",
    async (event, { defaultName, format, content }) => {
      requireRenderer(event);
      validateText(content, MAX_OUTPUT_BYTES);
      const info = getExportFormat(format);
      const base =
        path
          .basename(String(defaultName || "image"))
          .replace(/\.[^/.]+$/, "")
          .replace(/[^a-zA-Z0-9 _-]+/g, "") || "image";
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: `${base}.${info.extension}`,
        filters: [{ name: info.name, extensions: [info.extension] }],
      });
      if (result.canceled || !result.filePath) return null;
      await fs.promises.writeFile(result.filePath, content, {
        encoding: "utf8",
        flag: "w",
      });
      return { success: true };
    },
  );

  ipcMain.handle("open-granted-directory", async (event, grantId) => {
    requireRenderer(event);
    const { root } = resolveGrant(grantId, "output");
    const error = await shell.openPath(root);
    if (error) throw new Error(error);
  });
  ipcMain.handle("get-app-version", (event) => {
    requireRenderer(event);
    return app.getVersion();
  });
  ipcMain.handle("toggle-console", (event) => {
    requireRenderer(event);
    if (mainWindow.webContents.isDevToolsOpened())
      mainWindow.webContents.closeDevTools();
    else mainWindow.webContents.openDevTools();
    return { visible: mainWindow.webContents.isDevToolsOpened() };
  });
};

const listen = (listenPort, host) =>
  new Promise((resolve, reject) => {
    const server = expressApp.listen(listenPort, host, () => resolve(server));
    server.once("error", reject);
  });

const startServer = async (distPath, listenPort = PORT) => {
  if (distPath) {
    expressApp.use(express.static(distPath));
    expressApp.get("/{*splat}", (_request, response) =>
      response.sendFile(path.join(distPath, "index.html")),
    );
  }
  try {
    activeHost = HOST;
    return await listen(listenPort, HOST);
  } catch (error) {
    if (!LAN_ENABLED || !["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code))
      throw error;
    activeHost = "0.0.0.0";
    return listen(listenPort, activeHost);
  }
};

const createWindow = async () => {
  const iconPath = [
    path.join(__dirname, "assets", "icon.png"),
    path.join(__dirname, "icon.svg"),
  ].find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).size > 0,
  );
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "SVG-X",
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  const electronSession = mainWindow.webContents.session;
  electronSession.setPermissionCheckHandler(() => false);
  electronSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigation(url, new Set([APP_ORIGIN])))
      event.preventDefault();
  });
  if (isDev) {
    await mainWindow.loadURL(APP_ORIGIN);
  } else {
    const distPath = path.join(app.getAppPath(), "dist");
    serverProcess = await startServer(distPath);
    await mainWindow.loadURL(APP_ORIGIN);
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
    grants.clear();
    if (batchRun) void finishBatch(batchRun);
  });
};

app.whenReady().then(async () => {
  setupIpc();
  if (isDev) {
    startServer(null, PORT + 1)
      .then((server) => {
        serverProcess = server;
      })
      .catch((error) =>
        dialog.showErrorBox(
          "SVG-X network service failed",
          `Port ${PORT + 1} is unavailable: ${error.message}`,
        ),
      );
  }
  try {
    await createWindow();
  } catch (error) {
    console.error("SVG-X failed to start", error);
    dialog.showErrorBox("SVG-X failed to start", error.message);
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (!batchRun) return;
  event.preventDefault();
  if (quitPending) return;
  quitPending = true;
  void finishBatch(batchRun).then(() => app.quit());
});

app.on("window-all-closed", () => {
  if (serverProcess) serverProcess.close();
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (!mainWindow) void createWindow();
});
