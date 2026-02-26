# SVG-X Release Notes

## Version 1.2.0 (Current)

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
- Removed the synthetic "last threshold + 255/(N+1)" hack that produced an arbitrary final threshold

**Moore Neighbor contour tracing** (direction bug fixed):
- Direction array is now confirmed CW from East; entry direction lookup uses correct inverse-direction search before CW scan
- Previously missed concavities due to CW/CCW mismatch

**`simplifyClosedPath` wrap-around** (was: duplicated point):
- Now finds the original (unsimplified) contour point at maximum deviation on the wrap segment and inserts it — previously duplicated the already-simplified end-point

**SVG path deduplication** (new):
- `Set<string>` deduplication of `d` attribute strings within each layer and across all layers
- Adjacent threshold layers frequently produce identical boundary paths — now deduplicated, reducing file size

**Image complexity analysis** (rewritten):
- Now samples actual pixel data via canvas: counts distinct 5-bit color groups and computes horizontal edge density
- Previously used raw data URL string length (33% inflated, calibrated wrong)

**Coordinate rounding** (was: 1dp):
- All Bezier control points now rounded to consistent 2dp (`r2()`) throughout fitting and path assembly

**Potrace cancellation** (new):
- `trace()` now returns a `{ cancel }` handle; stale callbacks after timeout are discarded via a `cancelled` flag
- Previously a timed-out Potrace callback could resolve and overwrite the error state

**`scaleToMaxDimension` white fill**:
- Color mode's Web Worker now composites over white inside OffscreenCanvas; main-thread scaling applies white fill only for B&W compatibility

**Status flow simplified**:
- Removed redundant double emission of `processing` + `analyzing`; pipeline is now `loading → analyzing → tracing/colorProcessing → optimizing → done`

---

### Settings Panel

- **`turdSize` slider expanded to 1–100** — Complex Mode sets it to 15, which was above the previous cap of 10 (rendering incorrectly); slider now accommodates full Potrace range
- **Color/background text inputs converted to controlled** — `defaultValue` → `value + onChange`; Reset, Complex Mode, and programmatic updates now correctly update the hex text display (not just the color swatch)
- **Turn Policy descriptions visible** — each option now shows a sub-label with its description; previously descriptions were in `title` only (invisible on mobile/touch)
- **Fill Strategy descriptions corrected** — now accurately describe actual algorithm behavior
- **Focus trap added** — Tab/Shift+Tab stays inside the modal; Escape closes it

---

### App State & Data Flow

- **Network simplification unified** — `simplifyForNetworkClients` is now applied inside `processImage` automatically; call sites no longer handle it separately (was: `handleImageSelect` got full params over LAN, only the Complex button applied network simplification)
- **`isComplexMode` reset behavior fixed** — no longer resets on every slider tweak; only resets when Reset is explicitly clicked
- **`logIdCounter` moved to `useRef`** — survives HMR remounts; eliminates module-level mutable state and ID collisions
- **`electronWarningTimer` cleaned up on unmount**

---

### Batch Conversion

- **Stale closure fixed** — `readFileAsDataURL` moved outside the component as a pure function; processing effect reads resize options via a ref, eliminating the masked stale-closure bug
- **`filenameCounts` reset on retry** — retried files no longer get spurious `-1` suffixes
- **Resize-skipped warning** — amber banner when resize is enabled but `resizeImage` is unavailable
- **`(as any)` casts removed** — all `electronAPI` calls use the typed interface
- **Active settings summary** in modal header (mode, color steps, threshold, speckle)
- **Current filename displayed** prominently in the progress header during processing
- **WEBP** added to file filter

---

### `main.js`

- **CORS headers** — `Access-Control-Allow-Origin: *` on all Express responses for LAN access
- **`isPathSafe` hardened** — uses `path.resolve()` + `path.isAbsolute()` (replaced broken `includes('..')` substring check)
- **Dev-mode API server** — starts a minimal Express listener on port 3002 in dev so `/api/network-info` is reachable (with silent fallback on port collision); previously the endpoint was registered but never listening in dev
- **WEBP** added to `read-directory` filter and `read-image-file` MIME map

---

### WEBP Support (new)

- `FileUpload`: WEBP in accepted types, file input, copy text
- `main.js`: WEBP in MIME map and directory scan filter
- `BatchConversion`: WEBP in file filter regex

---

### UI/UX Polish

- **SVG viewport dimensions** — parsed from `viewBox` and displayed alongside file size in the preview header
- **SVG sanitization** — `<script>` elements and `on*` event attributes stripped before `dangerouslySetInnerHTML`
- **SVG Source view** — "Source" button opens a full-screen `<pre>` overlay with raw SVG markup; keyboard-accessible modal
- **Download tooltip** — now only appears when `svg` transitions from null to non-null (was: fired on every render with immediate auto-hide on first load)
- **`electron.d.ts`** — type comments clarified; `resizeImage` marked optional with note

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

### Features
- Upload and convert images to SVG with Potrace
- Customizable tracing parameters
- Automatic preprocessing
- Download SVG output
- Local network access

---

## Version 1.0.0

### Initial Release
- Potrace-based B&W image to SVG conversion
- Customizable parameters
- Automatic grayscale preprocessing
- Download SVG output
- Local network access
- Windows builds (portable exe + unpacked zip)
