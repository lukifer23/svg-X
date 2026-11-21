# SVG-X Release Notes

## Unreleased — recovery build

This work is intentionally unreleased. No tag or downloadable binary is implied.

- Replaced nested-threshold color painting with a disjoint OKLab-refined label map and shared-grid region topology.
- Replaced skeleton contouring with endpoint/junction/cycle graph traversal and open centerline paths.
- Added the typed `VectorDocument` contract and direct SVG/EPS/DXF/JSON serialization.
- Replaced hash-only cross-paint removal with hash-indexed canonical equality.
- Moved conversion into bundled TypeScript module workers and added a prioritized reusable worker pool with abort-by-termination.
- Removed all network-specific conversion degradation.
- Added opaque Electron directory grants, validated IPC payloads, exclusive batch output creation, sandboxing, and navigation restrictions.
- Versioned and validated stored settings, with one-time migration from the legacy key.
- Updated the supported runtime and application stack to Node 24, npm 12, Electron 44, React 19, Vite 8, Vitest 4, Tailwind 4, Sharp 0.35, Express 5, SVGO 4, and electron-builder 26.
- Removed the compromised `axios@1.14.1` dependency chain captured by the previous lockfile and replaced the vulnerable legacy Potrace/Jimp stack. `npm audit` currently reports zero known vulnerabilities.
- Removed tracked build output, installer logs, and machine-specific builder diagnostics.
- Added deterministic topology, graph, export, migration, and deduplication tests plus generated realistic review fixtures.
- Added recursive error-bounded cubic fitting for color regions and centerlines, adaptive DXF curve flattening, and deterministic EPS alpha compositing.
- Replaced Electron batch base64 transport with bounded transferable RGBA buffers and added a validated BMP decoder for packaged builds where Sharp lacks BMP support.
- Added exact-origin navigation tests, concurrent atomic filename reservation tests, IPv4/IPv6 discovery with fallback behavior, published-reference CIEDE2000 checks, and real AVIF/BMP/GIF/JPEG/TIFF/WebP fixtures.
- Added Chromium, Firefox, and WebKit upload/conversion/export/cancellation/accessibility flows plus packaged-app launch and conversion smoke tests.
- Removed the overlapping fixed mobile export bar, increased touch targets, and made network, processing-log, batch, and confirmation dialogs keyboard-safe with focus restoration.
- Added the MIT license.
- Optimized the color pipeline with behavior-preserving changes: a 256-entry sRGB→linear lookup table, indexed typed-array loops instead of per-pixel closures, no per-component pixel arrays in connected-component labeling, an allocation-free component-merge selection, and integer lattice keys in boundary tracing. Color tracing measures roughly 2.2×–3.5× faster on representative fixtures with byte-identical output.
- Parallelized color quantization above a size threshold across the existing renderer worker pool, combining per-band channel sums in order so the reduction stays bit-identical; failures fall back to the single-threaded path.
- Applied EXIF orientation on both decode paths so camera and phone photos vectorize upright in the browser and the desktop app.
- Switched interactive uploads from a base64 data URL to an object URL, memoized the SVG preview derivations, and debounced settings persistence.
- Added a stage benchmark harness (`npm run bench:pipeline`) with serialized-output hashes, plus tests for EXIF orientation, degenerate inputs, and band-parallel exactness.
- Kept native batch sessions alive until pending decode and output cleanup settles, including on application quit. Added regression tests for cancellation at actual Sharp submission, SVG staging, and exclusive publication.
- Omitted scoped and link-local IPv6 browser URLs from LAN discovery. The same-host packaged LAN smoke now compares SVG, EPS, DXF, and JSON in all three conversion modes and prints hashes for second-device verification.

## Historical releases

Historical tags and GitHub releases are preserved. Their bundled implementation and documentation describe those releases, not the unreleased recovery branch. Issue #37 should remain open until users can download a released color-capable binary.
