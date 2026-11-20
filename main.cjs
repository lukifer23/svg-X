const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const express = require("express");
const {
  isAllowedNavigation,
  isSafeExternalUrl,
  resolveBatchFile,
  validateText,
} = require("./desktop/security.cjs");
const { collectNetworkUrls } = require("./desktop/network.cjs");
const { writeUniqueOutput } = require("./desktop/files.cjs");
const { decodeBmp } = require("./desktop/bmp.cjs");
const { batchResizeOptions, decodeToRgba } = require("./desktop/decode.cjs");

const expressApp = express();
const grants = new Map();
let batchRun;
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp",
  ".avif",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
]);
const EXPORT_FORMATS = new Map([
  ["svg", { extension: "svg", name: "SVG Files" }],
  ["eps", { extension: "eps", name: "EPS Files" }],
  ["dxf", { extension: "dxf", name: "DXF Files" }],
  ["json", { extension: "json", name: "JSON Path Files" }],
]);
const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 25 * 1024 * 1024;
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

const decodeInput = async (inputPath, resizeOptions) => {
  const extension = path.extname(inputPath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension))
    throw new Error(`Unsupported image format: ${extension}`);
  if (extension === ".bmp") {
    const bmp = decodeBmp(await fs.promises.readFile(inputPath));
    return decodeToRgba(
      { raw: { pixels: bmp.pixels, width: bmp.width, height: bmp.height } },
      resizeOptions,
    );
  }
  return decodeToRgba({ path: inputPath }, resizeOptions);
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

  ipcMain.handle("begin-batch", (event, { inputGrantId, outputGrantId }) => {
    requireRenderer(event);
    if (batchRun) throw new Error("A batch is already running");
    const input = resolveGrant(inputGrantId, "input");
    const output = resolveGrant(outputGrantId, "output");
    const id = crypto.randomUUID();
    batchRun = { id, input, output, controller: new AbortController() };
    return id;
  });

  ipcMain.handle("cancel-batch", (event, id) => {
    requireRenderer(event);
    requireBatch(id).controller.abort();
  });

  ipcMain.handle("finish-batch", (event, id) => {
    requireRenderer(event);
    requireBatch(id).controller.abort();
    batchRun = undefined;
  });

  ipcMain.handle(
    "read-batch-input",
    async (event, { runId, fileId, resize, highestQuality }) => {
      requireRenderer(event);
      const {
        input: { root },
        controller: { signal },
      } = requireBatch(runId);
      signal.throwIfAborted();
      const input = await resolveBatchFile(root, fileId);
      if (input.size > MAX_INPUT_BYTES)
        throw new Error("Input exceeds the 50 MB limit");
      signal.throwIfAborted();
      const result = await decodeInput(
        input.path,
        batchResizeOptions(resize, highestQuality),
      );
      signal.throwIfAborted();
      return result;
    },
  );

  ipcMain.handle(
    "write-batch-output",
    async (event, { runId, baseName, content }) => {
      requireRenderer(event);
      const {
        output: { root },
        controller: { signal },
      } = requireBatch(runId);
      signal.throwIfAborted();
      validateText(content, MAX_OUTPUT_BYTES);
      return writeUniqueOutput(root, baseName, "svg", content, signal);
    },
  );

  ipcMain.handle(
    "save-export",
    async (event, { defaultName, format, content }) => {
      requireRenderer(event);
      validateText(content, MAX_OUTPUT_BYTES);
      const info = typeof format === "string" && EXPORT_FORMATS.get(format);
      if (!info) throw new Error("Unsupported export format");
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
    batchRun?.controller.abort();
    batchRun = undefined;
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

app.on("window-all-closed", () => {
  if (serverProcess) serverProcess.close();
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (!mainWindow) void createWindow();
});
