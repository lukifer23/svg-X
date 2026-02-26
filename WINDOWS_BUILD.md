# Building SVG-X for Windows

## Prerequisites

- **Node.js** v18 or newer (LTS recommended)
- **Git**
- Windows 10 or 11

## Getting Started

```bash
git clone https://github.com/YOUR_USERNAME/svg-x.git
cd svg-x
npm install
```

Test that everything works before building:

```bash
npm run electron:dev
```

This starts Vite on port 3001 and launches the Electron window. You should see the SVG-X interface load.

---

## Build Options

### Option 1: Portable Executable (Recommended for distribution)

```bash
npm run build:portable-exe
```

Output: `release/SVG-X-1.2.0-x64.exe`

A single self-contained `.exe`. No installation required. Code signing is disabled — users will see a Windows SmartScreen warning on first run ("More info" → "Run anyway").

### Option 2: Unpacked Directory (Good for testing)

```bash
npm run electron:build:dir
```

Output: `release/win-unpacked/SVG-X.exe`

The full application directory. Run `SVG-X.exe` from inside `win-unpacked/`. Faster to produce than the portable exe and easier to inspect.

### Option 3: ZIP of the Unpacked Directory

```bash
npm run electron:build:dir && npm run create-zip
```

Output: `release/SVG-X-win-unpacked.zip`

Useful for sharing when a single-file `.exe` is not required.

### Web-only Build (no Electron)

```bash
npm run build
```

Output: `dist/` — static files that can be served from any web server. Batch conversion and native save dialogs are unavailable without Electron.

---

## Running Locally (Development)

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server only, port 3001 (browser, no Electron) |
| `npm run electron:dev` | Vite + Electron — full desktop dev mode with hot reload |
| `npm run electron:direct` | Electron only — requires a pre-built `dist/` directory |

---

## What Gets Packaged

The `electron-builder` config in `package.json` includes:

```
dist/**/*      — built React app (served by Express in production)
main.js        — Electron main process
preload.js     — contextBridge preload
icon.png       — application icon
package.json   — required for electron-builder metadata
```

`sharp` (used for batch pre-resize) is a native module and must be available at runtime. It is declared as a `devDependency` in `package.json` — electron-builder includes native modules automatically via `extraFiles` or the `asar` bundle.

---

## Troubleshooting

### "Cannot find module 'sharp'" at runtime
`sharp` is a native module that must match the Electron ABI. If you see this error after building, run:
```bash
npm install --save-dev sharp
npm run build:portable-exe
```
electron-builder will rebuild native modules against the correct Electron version.

### Port 3001 already in use
The application uses port 3001 for the built-in Express server. If another process is using it, stop that process or change `PORT` at the top of `main.js`.

### electron-builder errors
- Use Node.js LTS (v18 or v20)
- Clear build artifacts: `rmdir /s /q release dist`
- Reinstall dependencies: `rmdir /s /q node_modules && npm install`

### Icon errors
Ensure `icon.png` exists in the project root (512×512 PNG). electron-builder uses it for the `.exe` icon.

### Windows SmartScreen warning
Expected — the builds are not code-signed. Click "More info" → "Run anyway". If deploying internally, consider purchasing an EV code signing certificate to suppress the warning.

### "Build process hangs"
- Ensure enough disk space (builds can be 150–200 MB)
- Close other memory-intensive applications
- Try the directory build first (`npm run electron:build:dir`) — it's faster

---

## Network Access

When running as the packaged app, an Express server starts on `0.0.0.0:3001`. Other devices on your LAN can reach it at `http://[your-ip]:3001`. The **Globe icon** in the app shows the available addresses.

SVG-X automatically applies lighter processing settings for LAN clients to keep response times acceptable.

---

## Distribution

| Artifact | Use case |
|---|---|
| `SVG-X-1.2.0-x64.exe` | Simplest: single file, no extraction |
| `SVG-X-win-unpacked.zip` | When `.exe` download is blocked by corporate policy |
| `release/win-unpacked/` | Direct deployment to a known machine |
