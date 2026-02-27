# SVG-X Release Notes

## Version 1.3.0 (Current)

### Vectorization Engine — Algorithm Overhaul

**Wu's color quantization** replaces the 5-bit bucket hash:
- Wu's algorithm (Xiaolin Wu, 1992) builds a 3D RGB histogram with prefix-sum moment tables, then recursively partitions it by minimum variance axis
- Produces dramatically better spatial coherence vs. bucket hashing — palette colors represent large, contiguous image regions rather than globally frequent point samples
- All four fill strategies (`dominant`, `spread`, `mean`, `median`) are now backed by Wu's boxes as the quantization foundation

**Marching Squares contour tracing** replaces Moore Neighbor tracing:
- 16-case 2×2 cell lookup table with linear interpolation for sub-pixel-accurate edge positions
- Correctly handles shapes with holes and nested contours — Moore Neighbor produced sequential errors and failed on holed shapes
- CCW winding enforced via shoelace sign test (`orientContour`)
- Contours sorted by area descending before path assembly (painter's order within layer)

**Full Canny edge detection** replaces single-threshold Sobel:
- Pipeline: Gaussian blur (5×5, σ≈1) → Sobel gradient magnitude + quantized angle → non-maximum suppression → hysteresis thresholding via BFS flood fill from strong edges
- Produces thin, connected edges; dramatically improves contour quality on gradients and photo-source images
- Low threshold ratio: 5% of max; high threshold ratio: 15% of max
- The Canny edge map is used to guide bitmap boundary snapping (edges preserved exactly; non-edge pixels eroded/dilated by neighborhood majority)

**Stroke / Centerline mode** (new):
- New `TracingParams.strokeMode: boolean` and `strokeWidth: number` (1–20px)
- Zhang-Suen two-pass thinning reduces filled binary regions to a 1-pixel-wide skeleton
- Marching Squares traces the skeleton → open paths (no `Z` close) → `<path stroke=... fill=none stroke-linecap=round/>`
- Best for line art, sketches, architectural drawings, circuit diagrams

**SVGO post-processing** (new):
- Every tracing pipeline (B&W Potrace and color/stroke worker) runs SVGO `preset-default` after generation
- Configurable via `TracingParams.svgoOptimize: boolean` (default `true`)
- Uses the browser-safe SVGO bundle (`svgo/dist/svgo.browser.js`) via Vite alias — no Node.js `fs`/`os` dependency warnings
- Typical file size reduction: 20–50%

**Proper sRGB gamma** throughout:
- All threshold conversions now use `Math.pow(Y, 1/2.2) * 255` (proper sRGB display gamma)
- Previously `computeThresholds` used `Math.sqrt(Y)` (gamma ≈ 2 approximation) inconsistently with `lStarToThreshold`

**Full 2D edge density** in `analyzeImageComplexity`:
- Edge density now computed as `√(Gx² + Gy²) > threshold` (proper 2D gradient magnitude)
- Previously only horizontal gradient was measured, underestimating edge density for vertical-dominant images

**`maxPaths` exposed as user parameter**:
- Was: hardcoded `const maxPaths = Math.min(2000, paths.length)` with no user control
- Now: `TracingParams.maxPaths: number` (default 2000, range 100–10,000), surfaced in SettingsPanel Advanced section

**Processing timeout fix**:
- The 90s/180s timeout now starts inside `processWithParams()` — immediately before the trace/posterize call
- Previously the timer started before downscaling, so preprocessing ate into the tracing budget

---

### New Export Formats (`src/utils/exportFormats.ts`)

Complete SVG path parser (`parseSVG`, `parsePathData`) handles all SVG path command types (`M`, `L`, `H`, `V`, `C`, `S`, `Q`, `T`, `A`, `Z`) with relative/absolute and implicit repeat semantics.

**EPS export** (`generateEPS`):
- PostScript Level 2 EPS with `%%BoundingBox` and `%%HiResBoundingBox`
- Coordinate system flipped (SVG y-down → PostScript y-up) via `translate/scale`
- Cubic Bezier → `curveto`, Quadratic → elevated to cubic → `curveto`
- Fill + stroke rendered via `gsave fill grestore` + `setlinewidth stroke` pattern

**DXF export** (`generateDXF`):
- DXF R12 ASCII for maximum laser cutter / CNC router compatibility
- `HEADER` section with `$EXTMIN`/`$EXTMAX` bounding box
- Each SVG path produces one or more `POLYLINE`/`VERTEX`/`SEQEND` entity groups
- Bezier curves approximated at 12 sample points per segment (adequate for laser/CNC)
- Y-axis flipped (SVG y-down → DXF y-up)
- ACI color cycling (colors 2–8) for layer separation

**JSON Paths export** (`generatePathJSON`):
- `{ width, height, coordinateSpace: "pixels", paths: [{fill, stroke, strokeWidth, commands}] }`
- Commands as absolute-coordinate typed objects: `{type: "M"|"L"|"C"|"Q"|"A"|"Z", x?, y?, x1?, y1?, x2?, y2?, rx?, ry?, ...}`
- Compatible with StarVector / OmniSVG training data formats

---

### New Input Formats

**AVIF, HEIC/HEIF, TIFF** (Electron only):
- Main process `read-image-file` IPC handler decodes via Sharp and re-emits as PNG data URL
- `read-directory` scan extended to include `.avif`, `.heic`, `.heif`, `.tif`, `.tiff`
- `FileUpload` component accept types and validation regex updated
- Browser-only mode still limited to PNG/JPG/GIF/BMP/WEBP (no Sharp in renderer)

---

### Settings Panel

- **Tooltip on every parameter** — reusable `Tooltip.tsx` component (smart vertical positioning, keyboard accessible, ARIA role)
- **B&W section** — hidden when color mode is active (no irrelevant controls shown)
- **Stroke / Centerline Mode section** — new collapsible section with `strokeMode` toggle and `strokeWidth` slider
- **Advanced section** — `maxPaths` slider (100–10,000) and `svgoOptimize` toggle
- **Color mode** — Fill Strategy description updated to reflect Wu's quantization foundation
- All new params (`strokeMode`, `strokeWidth`, `maxPaths`, `svgoOptimize`) persisted to `localStorage` via the existing `SETTINGS_STORAGE_KEY` mechanism and merged with `DEFAULT_PARAMS` on load

---

### Download Button

- **Format selector** — split button: primary action = SVG download; chevron opens format dropdown (SVG / EPS / DXF / JSON Paths)
- **Save error surfacing** — Electron native save failures are now shown as an amber dismissable banner instead of silently falling back to browser download
- Format dropdown closes on outside click

---

### Batch Conversion

- **Skip failed files toggle** — when on (default), failed files are marked `skipped` (amber) and processing continues; when off, failures halt the batch
- **ETA display** — rolling 5-file average `ms/file` displayed as `ETA Xm Ys` during processing
- **Auto-open output folder** — toggle to automatically open Explorer/Finder when batch completes
- **Per-file retry count** — shown as `(retry N)` suffix next to filename
- **AVIF/HEIC/TIFF in directory scan** — batch now detects and processes these formats via Sharp decode in main process
- **Settings summary** in modal header now includes stroke mode and SVGO state

---

### UI/UX

- **App version** displayed next to "SVG-X" title when running as Electron desktop app (`getAppVersion()` IPC)
- **Color mode progress** — progress percentage shown inline with detail text during color layer processing
- **ViewBox parser fix** — handles both space-separated (`"0 0 500 500"`) and comma-separated (`"0,0,500,500"`) viewBox attribute values

---

### Bug Fixes & Hardening

- **Dev-mode `/api/network-info` 404** — Vite dev server now proxies `/api` to the Express sidecar on port 3002 via `vite.config.ts` `server.proxy`
- **Dead dependency removed** — `stackblur-canvas` removed from `dependencies` (was never imported)
- **`sharp` moved to `dependencies`** — it's used at runtime in the Electron main process; was incorrectly in `devDependencies`
- **`electron-builder` files glob** — removed `"src/**/*"` (shipped raw TypeScript source into packaged app unnecessarily)
- **SVGO browser alias** — `vite.config.ts` aliases `svgo` to `svgo/dist/svgo.browser.js` eliminating Node `os`/`fs`/`path` externalization warnings during build
- **Bundle size warning suppressed** — `build.chunkSizeWarningLimit: 2000` (Electron app, bundle size is not a CDN concern)

---

## Version 1.2.0

### Vectorization Engine — Major Overhaul

**Color quantization** (`spread`, `mean` strategies were broken — now fixed):
- `spread` now picks colors evenly spaced by **perceptual luminance** (sRGB → linear → Y), not by frequency index
- `mean` now distributes selections across perceptual luminance bands (evenly spaced 0–1 Y range), not clustered around the centroid
- Palette padding now synthesizes midpoints by bisecting the largest luminance gap, eliminating spurious grayscale artifacts in color images
- Median-cut (`median` strategy) improved: box selection now uses proper channel-range scoring

**Perceptual threshold distribution** (was: `t^0.75` curve):
- Replaced with **CIE L\* spacing** — thresholds are evenly distributed across L\* [5, 95] and converted to 8-bit values via linearization + display gamma
- Previously all thresholds compressed toward the dark end; images with bright palettes had all thresholds below 128
- Now perceptually uniform regardless of image brightness

**Painter's order** (was: inconsistent):
- Palette colors sorted by perceptual luminance ascending (lightest first)
- Thresholds sorted ascending, paired 1:1 with palette colors
- Lightest color + lowest threshold renders first; darkest color + highest threshold renders last (on top)

**Moore Neighbor contour tracing** (direction bug fixed):
- Direction array confirmed CW from East; entry direction lookup uses correct inverse-direction search before CW scan

**`simplifyClosedPath` wrap-around** (was: duplicated point):
- Now finds the original unsimplified contour point at maximum deviation and inserts it

**SVG path deduplication** (new):
- `Set<string>` deduplication within each layer and across all layers

**Image complexity analysis** (rewritten):
- Now samples actual pixel data via canvas: distinct 5-bit color groups and edge density

**Coordinate rounding** (was: 1dp):
- All Bezier control points rounded to consistent 2dp throughout

**Potrace cancellation** (new):
- `trace()` returns a `{ cancel }` handle; stale callbacks after timeout are discarded

### Settings Panel
- `turdSize` slider expanded to 1–100
- Color/background inputs converted to controlled
- Turn Policy descriptions visible inline
- Focus trap added

### Batch Conversion
- Stale closure fixed
- `filenameCounts` reset on retry
- Resize-skipped warning added
- WEBP added to file filter

### `main.js`
- CORS headers on all Express responses
- `isPathSafe` hardened with `path.resolve()` + `path.isAbsolute()`
- Dev-mode API server on port 3002
- WEBP in `read-directory` and MIME map

---

## Version 1.1.0

### New Features
- Complex Image Mode: specialized preset for geometric patterns and technical drawings
- Enhanced mobile responsiveness
- Improved error handling and feedback
- Network URL display in UI
- Optimized processing pipeline

### Fixes
- Fixed dense line work conversions
- Resolved mobile UI scaling
- Fixed network URL display
- Better memory management for large images

### Windows Build
- Available as portable executable (`SVG-X-1.1.0-x64.exe`)
- Available as unpacked application (`SVG-X-win-unpacked.zip`)

---

## Version 1.0.1

### Updates
- Fixed Windows build process
- Improved build configuration (no code signing required)
- Updated dependencies
- Enhanced build scripts

---

## Version 1.0.0

### Initial Release
- Potrace-based B&W image to SVG conversion
- Customizable parameters
- Automatic grayscale preprocessing
- Download SVG output
- Local network access
- Windows builds (portable exe + unpacked zip)
