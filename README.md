# SVG-X — Image to SVG Converter

A desktop application (Electron + React) that converts raster images to scalable vector graphics using a triple-engine pipeline:

- **B&W Mode** — Potrace-powered, fully parameterized
- **Color Mode** — Custom posterization engine: Wu's color quantization, Canny edge detection, Marching Squares contour tracing, Schneider cubic Bezier fitting — all in a Web Worker
- **Stroke/Centerline Mode** — Zhang-Suen thinning produces skeletal open paths; ideal for line art, sketches, and technical drawings

---

## Features

| Feature | Details |
|---|---|
| **B&W Tracing** | Potrace-powered, fully parameterized (threshold, turn policy, curve optimization, corner sharpness, speckle suppression) |
| **Color Mode** | Wu's 3D histogram quantization, Canny edge detection, Marching Squares tracing, Schneider Bezier fitting, painter's-order SVG assembly, cross-layer path deduplication |
| **Stroke Mode** | Zhang-Suen centerline thinning → open `stroke` paths; ideal for line art, circuit diagrams, architectural drawings |
| **SVGO Optimization** | Automatic SVG post-processing via SVGO `preset-default` — 20–50% size reduction with no visual quality loss |
| **Batch Conversion** | Electron-only; converts entire directories, ETA display, skip-failed toggle, auto-open output folder, collision-safe filenames, optional Sharp pre-resize |
| **Input Formats** | PNG, JPG, GIF, BMP, WEBP, **AVIF**, **HEIC/HEIF**, **TIFF** — AVIF/HEIC/TIFF decoded via Sharp in the main process |
| **Export Formats** | SVG, **EPS** (PostScript Level 2), **DXF** (R12 ASCII — laser/CNC ready), **JSON Paths** (absolute-coordinate command sequences for ML pipelines) |
| **Complex Image Mode** | One-click parameter preset for dense line work, technical drawings, geometric patterns |
| **Network Mode** | LAN access from any device; auto-downscales for remote clients; CORS-enabled API endpoint |
| **Processing Logs** | Timestamped per-run log with error-only filter, copy-to-clipboard |
| **SVG Preview** | Side-by-side original vs SVG, file size + viewport dimensions, sanitized inline render, source view, color mode progress % |
| **Download** | Split button: SVG primary + EPS/DXF/JSON format selector; native Electron save dialog; clipboard copy; save error surfacing |
| **Settings Persistence** | All parameters saved to `localStorage` and restored on next launch |
| **Tooltips** | Every setting has an info tooltip explaining its effect |
| **Responsive UI** | Mobile-optimized layout, touch-friendly controls |
| **App Version** | Displayed in header when running as Electron desktop app |

---

## How It Works

### B&W Mode (Potrace)

```
Upload → Scale to ≤1000px → [Network: downscale 0.5×] → analyzeComplexity
       → Potrace.trace() → SVGO optimize → SVG
```

1. Image is scaled to a maximum of 1000px on the longest side (aspect-ratio preserved, white composite)
2. On LAN access, a further 0.5× downscale is applied; complex images get an additional 0.3× pass
3. Image complexity is measured via full 2D gradient magnitude (√(Gx²+Gy²)) and distinct color sampling
4. Potrace traces contours, applies Bezier optimization, and emits SVG
5. SVGO post-processes the output SVG (configurable, default on)

### Color Mode (Web Worker)

```
Upload → Scale to ≤1000px → Web Worker:
  ├── Load image into OffscreenCanvas (composite over white)
  ├── Wu's color quantization (3D histogram moment tables, minimum-variance partition)
  ├── Compute perceptual CIE L* thresholds (proper sRGB gamma)
  ├── For each layer (lightest → darkest):
  │     ├── Canny edge detection (Gaussian blur → NMS → hysteresis)
  │     ├── Bitmap construction with Canny-guided boundary snapping
  │     ├── Marching Squares contour tracing (16-case lookup, sub-pixel interpolation)
  │     ├── CCW winding enforcement (shoelace sign)
  │     ├── Douglas-Peucker simplification (closed-path wrap-around aware)
  │     └── Schneider cubic Bezier fitting (chord-length param, recursive split)
  └── Assemble SVG (painter's order, cross-layer path deduplication)
→ SVGO optimize → SVG
```

### Stroke / Centerline Mode (Web Worker)

```
Upload → Scale to ≤1000px → Web Worker:
  ├── Canny edge detection + Marching Squares (same as color mode, per layer)
  ├── Zhang-Suen two-pass thinning → 1-pixel-wide skeleton
  └── Marching Squares on skeleton → open paths (no Z close)
→ SVG with <path stroke=... fill=none stroke-linecap=round/>
→ SVGO optimize → SVG
```

### Export Pipeline

After SVG is generated, additional formats are produced client-side:

| Format | Generator | Notes |
|---|---|---|
| **SVG** | Direct output | SVGO-optimized when enabled |
| **EPS** | `generateEPS()` | PostScript Level 2, coordinate-flipped, cubic Bezier `curveto` |
| **DXF** | `generateDXF()` | R12 ASCII LWPOLYLINE, Y-axis flipped, Bezier approximated at 12pts/segment |
| **JSON** | `generatePathJSON()` | `{width, height, paths: [{fill, stroke, commands: [{type, x, y, ...}]}]}` |

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
| **Fill Strategy** | dominant/spread/mean/median | dominant | How palette colors are selected from Wu's quantization boxes |

### Color Fill Strategies

All strategies are backed by **Wu's color quantization** (3D histogram variance reduction). The strategy controls how the resulting color boxes are ordered and selected:

| Strategy | Behavior |
|---|---|
| **Dominant** | Wu's variance-optimal boxes, ordered by box luminance |
| **Spread** | Colors evenly spaced by perceptual luminance (sRGB → linear → Y) |
| **Mean** | Colors distributed across N equal perceptual luminance bands |
| **Median** | Balanced tonal distribution — best for images with complex mixed tones |

### Stroke / Centerline Mode Parameters

| Parameter | Range | Default | Effect |
|---|---|---|---|
| **Stroke Mode** | on/off | off | Enable Zhang-Suen thinning + open-path output |
| **Stroke Width** | 1–20px | 2px | Output stroke width applied to all centerline paths |

### Advanced Parameters

| Parameter | Range | Default | Effect |
|---|---|---|---|
| **Max Paths per Layer** | 100–10,000 | 2,000 | Maximum contour paths kept per color layer. Higher = more detail, larger SVG |
| **SVGO Optimization** | on/off | on | Post-process SVG with SVGO preset-default (20–50% size reduction) |

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
2. Select an **Input Directory** (PNG, JPG, GIF, BMP, WEBP, AVIF, HEIC, TIFF files are detected automatically)
3. Select an **Output Directory**
4. Configure options:
   - **Skip failed files** — continue batch even when individual files fail (default on)
   - **Open output folder when done** — auto-open Explorer/Finder on completion
   - **Pre-resize** — set a max width/height via Sharp before vectorization
5. Click **Start Batch Processing**

Features:
- ETA display based on rolling 5-file average (`ms/file`)
- Shows current filename during processing
- Displays completed / failed / skipped / remaining counts with progress bar
- **Retry Failed** button re-queues only failed files
- **Open Output Folder** button always available once any file completes
- Filename collision deduplication: `image.svg`, `image-1.svg`, `image-2.svg`, ...
- Per-file retry count displayed

---

## Export Formats

SVG-X can export in four formats from the **Download** split button:

| Format | Use Case |
|---|---|
| **SVG** | Web, design tools, Inkscape, Illustrator |
| **EPS** | Print, legacy design tools, vector archives |
| **DXF** | Laser cutting, CNC routing, CAD software |
| **JSON Paths** | ML dataset generation, programmatic manipulation, StarVector/OmniSVG training pipelines |

EPS and DXF are generated client-side from the SVG path data — no server round-trip required.

The JSON format emits absolute-coordinate path commands:
```json
{
  "width": 500,
  "height": 400,
  "coordinateSpace": "pixels",
  "paths": [
    {
      "fill": "rgb(45,74,140)",
      "stroke": "none",
      "strokeWidth": 0,
      "commands": [
        { "type": "M", "x": 120, "y": 45 },
        { "type": "C", "x1": 130, "y1": 20, "x2": 160, "y2": 15, "x": 170, "y": 45 },
        { "type": "Z" }
      ]
    }
  ]
}
```

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

- **Portable executable**: Run `SVG-X-1.3.0-x64.exe` directly — no installation
- **Unpacked**: Extract and run `SVG-X.exe`

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

Opens at `http://localhost:3001`. Batch conversion, native save dialogs, and AVIF/HEIC/TIFF decoding are unavailable without Electron.

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
  ├── Express sidecar (dev: port 3002, /api/network-info only)
  ├── IPC handlers:
  │   ├── select-directory — native folder picker
  │   ├── read-directory — scans for PNG/JPG/GIF/BMP/WEBP/AVIF/HEIC/TIFF
  │   ├── save-svg — writes any text content (SVG, EPS, DXF, JSON)
  │   ├── read-image-file — native exts → base64; AVIF/HEIC/TIFF → Sharp → PNG
  │   ├── resize-image — Sharp resize with inside/fill fit
  │   ├── show-save-dialog — multi-format filter (svg/eps/dxf/json)
  │   ├── open-output-directory — shell.openPath
  │   ├── join-paths — OS-native path.join
  │   ├── get-app-version — app.getVersion()
  │   └── toggle-console — DevTools open/close
  └── isPathSafe() — path.resolve() + path.relative() traversal guard

preload.js
  └── contextBridge → window.electronAPI (typed in src/electron.d.ts)

src/ (React + Vite renderer)
  ├── App.tsx — central state, status machine, log management, version display
  ├── components/
  │   ├── FileUpload.tsx — drag-drop, validation (PNG/JPG/GIF/BMP/WEBP/AVIF/HEIC/TIFF, ≤50MB)
  │   ├── ImagePreview.tsx — side-by-side preview, progress % bar, viewBox parser (comma+space),
  │   │   SVG dimensions, sanitized render, source view
  │   ├── SettingsPanel.tsx — all params with Tooltip on each, B&W/Color/Stroke/Advanced sections,
  │   │   focus-trapped modal, strokeMode/strokeWidth/maxPaths/svgoOptimize
  │   ├── Tooltip.tsx — reusable info tooltip with smart vertical positioning
  │   ├── DownloadButton.tsx — SVG primary + EPS/DXF/JSON format dropdown, save error banner
  │   ├── BatchConversion.tsx — ETA, skip-failed toggle, auto-open, retry count per file
  │   ├── ProcessingLogs.tsx — timestamped logs, error filter, copy
  │   └── NetworkInfo.tsx — LAN URL display with reachability probing
  └── utils/
      ├── imageProcessor.ts — B&W trace (SVGO), color posterize worker (Wu+Canny+MarchSq+SVGO),
      │   stroke worker (Zhang-Suen), complexity analysis (2D gradient), SVGO post-processing
      ├── exportFormats.ts — EPS, DXF R12, JSON path generators; full SVG path parser
      └── networkUtils.ts — WebRTC IP fallback + /api/network-info fetch
```

### Processing Status Flow

```
idle → loading → analyzing → tracing | colorProcessing → optimizing → done
                                                                     → error
```

### Vectorization Pipeline Detail

```
Color/Stroke mode (per layer):

ImageData
  │
  ├─ Wu quantization ──────────────────────────────── palette (N colors)
  │    3D RGB histogram, moment tables,
  │    minimum-variance box partition
  │
  ├─ CIE L* thresholds ───────────────────────────── N thresholds (proper sRGB gamma)
  │    L* [5,95] → linear Y → pow(Y, 1/2.2) * 255
  │
  └─ Per layer:
       │
       ├─ Canny edge detection
       │    Gaussian blur (5×5, σ≈1) → Sobel → NMS → hysteresis BFS
       │
       ├─ Bitmap construction
       │    threshold + Canny-guided boundary snapping + morphological fill
       │
       ├─ [Stroke mode] Zhang-Suen thinning
       │    Two-pass iterative skeleton extraction → 1px-wide centerline
       │
       ├─ Marching Squares contour tracing
       │    16-case 2×2 cell lookup, sub-pixel linear interpolation,
       │    CCW winding via shoelace sign
       │
       ├─ Douglas-Peucker simplification (closed-path wrap-around aware)
       │
       └─ Schneider cubic Bezier fitting
            chord-length parameterization, least-squares control point solve,
            recursive split at max-error point
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
- Lower **Max Paths per Layer** if the SVG is excessively complex (slow to render)

### Line art looks like thick blobs (Color Mode)
- Enable **Stroke / Centerline Mode** — this extracts the actual centerlines of strokes
- Adjust **Stroke Width** to match your source line weight

### EPS / DXF download not working
- EPS and DXF are generated client-side and work in both browser and Electron
- DXF Bezier curves are approximated as 12-point polylines — suitable for laser/CNC

### Batch conversion — resize not working
- Pre-resize requires the Electron desktop app with Sharp available
- A warning banner will appear in the batch modal if resize cannot be applied

### AVIF / HEIC / TIFF files not loading
- AVIF/HEIC/TIFF require the Electron app — Sharp decodes them in the main process
- In the browser-only mode, only PNG/JPG/GIF/BMP/WEBP are supported natively

### Windows security warning on first run
- The portable executable is not code-signed — this is expected
- Click "More info" → "Run anyway" in the Windows SmartScreen dialog

### Port 3001 already in use
- Another process is using port 3001 — stop it or change the `PORT` constant in `main.js`

---

## Known Limitations

- Batch conversion requires Electron (filesystem access)
- AVIF/HEIC/TIFF input requires Electron (Sharp in the main process)
- Color mode processes one layer at a time sequentially — 8 steps on a large image can take 30–60 seconds
- Very large or photo-realistic images work best in B&W mode; color mode is optimized for illustrations and graphics with distinct color areas
- macOS and Linux builds are not pre-packaged — build from source with `npm run electron:build`
- DXF export approximates Bezier curves as polylines (12pts/segment) — sufficient for laser/CNC, not mathematically exact

---

## Dependencies

| Package | Role |
|---|---|
| `electron` ^30 | Desktop shell |
| `react` ^18 | UI framework |
| `potrace` ^2.1.8 | B&W vector tracing |
| `sharp` ^0.33 | AVIF/HEIC/TIFF decode + batch pre-resize (main process) |
| `svgo` ^3.3 | SVG post-optimization (renderer process) |
| `express` ^4.18 | Production asset server + `/api/network-info` |
| `slugify` ^1.6 | Safe output filenames |
| `lucide-react` ^0.344 | Icons |
| `tailwindcss` ^3.4 | Styling |
| `vite` + `@vitejs/plugin-react` | Build and dev server |
| `vitest` | Unit tests |
| `electron-builder` ^24 | Packaging |

---

## ML / Dataset Generation

SVG-X's **JSON Paths** export format is designed for ML training pipelines:

- Absolute-coordinate path commands (`M`, `L`, `C`, `Q`, `A`, `Z`) with typed JSON structure
- Compatible with StarVector and OmniSVG training data formats
- Coordinate space is pixel-aligned to the SVG viewport (`"coordinateSpace": "pixels"`)
- Each path includes fill color, stroke color, and stroke width — full rendering metadata

Typical workflow for dataset generation:
1. Collect raster images (logos, icons, illustrations)
2. Batch convert with SVG-X to JSON Paths export
3. Use the JSON as `(raster, vector_tokens)` training pairs

Color mode with 4–6 steps + Median strategy produces the best token-count/quality tradeoff for illustration-class images.
