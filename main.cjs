const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const express = require("express");
const sharp = require("sharp");
const {
  isAllowedNavigation,
  safeChild,
  validateText,
} = require("./desktop/security.cjs");
const { collectNetworkUrls } = require("./desktop/network.cjs");
const { writeUniqueOutput } = require("./desktop/files.cjs");
const { decodeBmp } = require("./desktop/bmp.cjs");

const expressApp = express();
const grants = new Map();
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
const isDev = !app.isPackaged;
let mainWindow = null;
let serverProcess = null;
let activeHost = HOST;

expressApp.disable("x-powered-by");
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
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id)
    throw new Error("Untrusted IPC sender");
};

const decodeInput = async (inputPath, resize) => {
  const stats = await fs.promises.stat(inputPath);
  if (!stats.isFile() || stats.size > MAX_INPUT_BYTES)
    throw new Error("Input exceeds the 50 MB limit");
  const extension = path.extname(inputPath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension))
    throw new Error(`Unsupported image format: ${extension}`);
  const resizeOptions = resize?.enabled
    ? {
        width: Math.max(1, Math.min(8192, Number(resize.width) || 1)),
        height: Math.max(1, Math.min(8192, Number(resize.height) || 1)),
        fit: resize.maintainAspectRatio === false ? "fill" : "inside",
      }
    : null;
  const bmp =
    extension === ".bmp"
      ? decodeBmp(await fs.promises.readFile(inputPath))
      : null;
  let pipeline = bmp
    ? sharp(bmp.pixels, {
        raw: { width: bmp.width, height: bmp.height, channels: 4 },
      })
    : sharp(inputPath, {
        limitInputPixels: 100_000_000,
        failOn: "error",
      });
  if (resizeOptions) pipeline = pipeline.resize(resizeOptions);
  const { data, info } = await pipeline
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  );
  return { pixels, width: info.width, height: info.height };
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
    return result.canceled ? null : issueGrant(result.filePaths[0], kind);
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
    "read-batch-input",
    async (event, { grantId, fileId, resize }) => {
      requireRenderer(event);
      const { root } = resolveGrant(grantId, "input");
      return decodeInput(safeChild(root, fileId), resize);
    },
  );

  ipcMain.handle(
    "write-batch-output",
    async (event, { grantId, baseName, content }) => {
      requireRenderer(event);
      validateText(content, MAX_OUTPUT_BYTES);
      const { root } = resolveGrant(grantId, "output");
      return writeUniqueOutput(root, baseName, "svg", content);
    },
  );

  ipcMain.handle(
    "save-export",
    async (event, { defaultName, format, content }) => {
      requireRenderer(event);
      validateText(content, MAX_OUTPUT_BYTES);
      const info = EXPORT_FORMATS.get(format) || EXPORT_FORMATS.get("svg");
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
  const allowedOrigin = `http://localhost:${PORT}`;
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigation(url, new Set([allowedOrigin])))
      event.preventDefault();
  });
  if (isDev) {
    await mainWindow.loadURL(allowedOrigin);
  } else {
    const distPath = path.join(app.getAppPath(), "dist");
    serverProcess = await startServer(distPath);
    await mainWindow.loadURL(allowedOrigin);
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
    grants.clear();
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
