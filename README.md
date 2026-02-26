# SVG-X — Image to SVG Converter

A desktop application (Electron + React) that converts raster images to scalable vector graphics using a dual-engine pipeline: **Potrace** for B&W tracing and a custom **color posterization engine** with perceptual color quantization, Sobel edge detection, Moore Neighbor contour tracing, and cubic Bezier fitting — all running in a Web Worker.

---

## Features

| Feature | Details |
|---|---|
| **B&W Tracing** | Potrace-powered, fully parameterized (threshold, turn policy, curve optimization, corner sharpness, speckle suppression) |
| **Color Mode** | Custom posterization engine: CIE L\* perceptual thresholds, 5-bit color quantization, 4 fill strategies, painter's-order SVG assembly |
| **Batch Conversion** | Electron-only; converts entire directories, collision-safe filenames, optional sharp pre-resize, retry-failed |
| **Formats Supported** | PNG, JPG, GIF, BMP, **WEBP** — input and batch |
| **Complex Image Mode** | One-click parameter preset for dense line work, technical drawings, geometric patterns |
| **Network Mode** | LAN access from any device; auto-downscales for remote clients; CORS-enabled API endpoint |
| **Processing Logs** | Timestamped per-run log with error-only filter, copy-to-clipboard |
| **SVG Preview** | Side-by-side original vs SVG, file size + viewport dimensions, sanitized inline render, source view |
| **Download** | Native Electron save dialog or browser blob download; clipboard copy |
| **Settings Persistence** | All parameters saved to `localStorage` and restored on next launch |
| **Responsive UI** | Mobile-optimized layout, touch-friendly controls |

---

## How It Works

### B&W Mode (Potrace)

```
Upload → Scale to ≤1000px → [Network: downscale 0.5×] → analyzeComplexity → Potrace.trace() → SVG
```

1. Image is scaled to a maximum of 1000px on the longest side (aspect-ratio preserved, white composite)
2. On LAN access, a further 0.5× downscale is applied; complex images get an additional 0.3× pass
3. Image complexity is measured via pixel sampling: distinct color count and edge density
4. Potrace traces contours, applies Bezier optimization, and emits SVG

### Color Mode (Web Worker)

```
Upload → Scale to ≤1000px → Web Worker:
  ├── Load image into OffscreenCanvas (composite over white)
  ├── Quantize colors (5-bit bucketing + strategy: dominant/spread/mean/median)
  ├── Compute perceptual CIE L* thresholds
  ├── For each layer (lightest → darkest):
  │     ├── Grayscale + Sobel edge detection
  │     ├── Morphological bitmap enhancement
  │     ├── Moore Neighbor contour tracing (Jacob's stopping criterion)
  │     ├── Douglas-Peucker simplification (closed-path wrap-around aware)
  │     └── Schneider cubic Bezier fitting (recursive split on max error)
  └── Assemble SVG (painter's order, cross-layer path deduplication)
```

### Color Fill Strategies

| Strategy | Behavior |
|---|---|
| **Dominant** | Most frequently occurring colors in the image |
| **Spread** | Colors evenly spaced by perceptual luminance (sRGB → linear → Y) |
| **Mean** | Colors distributed across perceptual luminance bands |
| **Median** | Median-cut in RGB space — best overall color representation |

### Perceptual Threshold Distribution

Thresholds are computed in **CIE L\* space** (L\* 5→95), converted to linear luminance, then to display-gamma 8-bit values. This gives perceptually uniform layer separation regardless of whether the image is dark or bright — no more all-thresholds-below-128 compression.

---

## Settings Reference

### B&W Mode Parameters

| Parameter | Range | Default | Effect |
|---|---|---|---|
| **Speckle Suppression** (`turdSize`) | 1–100 | 2 | Removes shapes smaller than N pixels. Higher = cleaner but loses fine detail |
| **Threshold** | 0–255 | 128 | Pixels darker than this value are treated as foreground |
| **Corner Sharpness** (`alphaMax`) | 0.1–1.5 | 1.0 | Lower = sharper corners; higher = rounder curves |
| **Curve Tolerance** (`optTolerance`) | 0.1–2.0 | 0.2 | Higher = more deviation allowed in Bezier curves (smaller files) |
| **Curve Optimization** (`optCurve`) | on/off | on | Use Bezier curves instead of line segments |
| **Black on White** (`blackOnWhite`) | on/off | on | Assumes dark foreground on light background |
| **Invert** | on/off | off | Swap foreground/background before tracing |
| **Highest Quality** | on/off | off | Disables shortcuts for maximum precision (slower) |

### Turn Policy

Controls how Potrace handles ambiguous boundary pixels during tracing:

| Policy | Behavior |
|---|---|
| **Minority** *(recommended)* | Prefer the minority color at each ambiguity |
| **Majority** | Prefer the majority color |
| **Black** | Prefer to connect black areas |
| **White** | Prefer to connect white areas |
| **Left** | Always turn left |
| **Right** | Always turn right |

### Color Mode Parameters

| Parameter | Range | Default | Effect |
|---|---|---|---|
| **Color Steps** | 2–8 | 4 | Number of color layers. More = more detail, slower |
| **Fill Strategy** | dominant/spread/mean/median | dominant | How palette colors are selected |

### Complex Image Mode

One-click preset optimized for dense line work, technical drawings, and geometric patterns:

```
turdSize: 15  |  optTolerance: 3.0  |  threshold: 180
turnPolicy: minority  |  alphaMax: 1.0  |  highestQuality: false
```

On LAN connections, Complex Mode uses an even more aggressive preset (further threshold boost, doubled turdSize, curve optimization disabled).

---

## Batch Conversion

**Electron only** — requires filesystem access.

1. Click **Batch Convert** in the header
2. Select an **Input Directory** (PNG, JPG, GIF, BMP, WEBP files are detected automatically)
3. Select an **Output Directory**
4. Optionally enable **pre-resize** (via `sharp`) to set a max width/height before vectorization
5. Click **Start Batch Processing**

Features:
- Shows current filename prominently during processing
- Displays completed / failed / remaining counts with a progress bar
- **Retry Failed** button re-queues only failed files (collision counter reset)
- **Open Output Folder** after completion
- Filename collision deduplication: `image.svg`, `image-1.svg`, `image-2.svg`, ...

---

## Network Mode

When accessed from another device on the LAN, SVG-X automatically:
- Applies `simplifyForNetworkClients` parameters (higher turdSize, lower optTolerance, no curve optimization)
- Downscales images by 0.5× before processing; very complex images get 0.3×
- Times out at 90 seconds (vs 180s for local)
- The API endpoint `/api/network-info` returns local and network URLs

The **Globe icon** in the corner opens the Network Info panel with copyable URLs. URLs are probed for reachability before being shown.

---

## Installation

### Desktop Application (Electron)

#### Windows

- **Portable executable**: Run `SVG-X-1.1.0-x64.exe` directly — no installation
- **Unpacked**: Extract `SVG-X-win-unpacked.zip` and run `SVG-X.exe`

#### Development (all platforms)

```bash
npm install
npm run electron:dev
```

This starts Vite on port 3001 and launches Electron, loading from the dev server.

### Web-only (browser)

```bash
npm install
npm run dev
```

Opens at `http://localhost:3001`. Batch conversion and native save dialogs are unavailable without Electron.

---

## Build Commands

| Command | Output |
|---|---|
| `npm run dev` | Vite dev server only (port 3001) |
| `npm run electron:dev` | Vite + Electron (full desktop dev mode) |
| `npm run build` | Vite production build → `dist/` |
| `npm run electron:build:dir` | Vite build + unpacked Windows app → `release/win-unpacked/` |
| `npm run build:portable-exe` | Vite build + unsigned Windows portable `.exe` → `release/` |
| `npm run create-zip` | ZIP of `release/win-unpacked/` |
| `npm run test` | Vitest unit tests |
| `npm run lint` | ESLint |

---

## Architecture

```
main.js (Electron main process)
  ├── BrowserWindow (1200×800, contextIsolation)
  ├── Express server (production: port 3001, serves dist/ + /api/network-info)
  ├── IPC handlers: select-directory, read-directory, save-svg,
  │   read-image-file, resize-image, show-save-dialog,
  │   open-output-directory, join-paths, get-app-version, toggle-console
  └── isPathSafe() — path.resolve() + path.relative() traversal guard

preload.js
  └── contextBridge → window.electronAPI (typed in src/electron.d.ts)

src/ (React + Vite renderer)
  ├── App.tsx — central state, status machine, log management
  ├── components/
  │   ├── FileUpload.tsx — drag-drop, validation (PNG/JPG/GIF/BMP/WEBP, ≤50MB)
  │   ├── ImagePreview.tsx — side-by-side preview, monotone progress bar,
  │   │   SVG dimensions, sanitized render, source view
  │   ├── SettingsPanel.tsx — all Potrace params, focus-trapped modal,
  │   │   controlled color inputs, visible turn policy descriptions
  │   ├── DownloadButton.tsx — Electron save dialog or blob download, clipboard copy
  │   ├── BatchConversion.tsx — directory batch, resize options, retry, progress
  │   ├── ProcessingLogs.tsx — timestamped logs, error filter, copy
  │   └── NetworkInfo.tsx — LAN URL display with reachability probing
  └── utils/
      ├── imageProcessor.ts — B&W trace, color posterize worker, complexity analysis
      └── networkUtils.ts — WebRTC IP fallback + /api/network-info fetch
```

### Processing Status Flow

```
idle → loading → analyzing → tracing | colorProcessing → optimizing → done
                                                                     → error
```

---

## Troubleshooting

### Conversion hangs or times out
- Try **Complex Image Mode** (Settings → Complex Image)
- For very large images, the app auto-scales to 1000px — if still slow, reduce the image yourself first
- Check **Processing Logs** (button below the preview) for specific error messages

### Poor SVG quality (B&W)
- Lower `turdSize` (1–5) to preserve fine detail
- Adjust `threshold` — if the image looks washed out, lower it; if too much noise, raise it
- Try `optCurve: on` with lower `optTolerance` (0.1–0.3) for smoother curves
- Toggle `Invert` for light-on-dark source images

### Poor SVG quality (Color Mode)
- Try **Median** fill strategy for best overall color accuracy
- Increase Color Steps (6–8) for more tonal range
- **Spread** strategy works well for images with distinct light/dark zones

### Batch conversion — resize not working
- Pre-resize requires the Electron desktop app with `sharp` available
- A warning banner will appear in the batch modal if resize cannot be applied

### Windows security warning on first run
- The portable executable is not code-signed — this is expected
- Click "More info" → "Run anyway" in the Windows SmartScreen dialog

### Port 3001 already in use
- Another process is using port 3001 — stop it or change the `PORT` constant in `main.js`

---

## Known Limitations

- Batch conversion requires Electron (filesystem access)
- Color mode processes one layer at a time sequentially — 8 steps on a large image can take 30–60 seconds
- Very large or photo-realistic images work best in B&W mode; color mode is optimized for illustrations and graphics with distinct color areas
- macOS and Linux builds are not pre-packaged — build from source with `npm run electron:build`

---

## Dependencies

| Package | Role |
|---|---|
| `electron` ^30 | Desktop shell |
| `react` ^18 | UI framework |
| `potrace` ^2.1.8 | B&W vector tracing |
| `sharp` ^0.33 | Server-side image resizing (batch pre-resize) |
| `express` ^4.18 | Production asset server + `/api/network-info` |
| `slugify` ^1.6 | Safe output filenames |
| `lucide-react` ^0.344 | Icons |
| `tailwindcss` ^3.4 | Styling |
| `vite` + `@vitejs/plugin-react` | Build and dev server |
| `vitest` | Unit tests |
| `electron-builder` ^24 | Packaging |
