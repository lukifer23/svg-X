# SVG-X

SVG-X is a local-first raster-to-vector converter for the browser and Electron. It supports filled B&W tracing, disjoint color-region tracing, true centerline output, batch conversion, and SVG/EPS/DXF/JSON exports.

The current `main` branch is an unreleased recovery build. Historical tags and releases remain the source of truth for previously published binaries.

## Requirements

- Node.js 24.19.0 (the repository includes `.nvmrc` and `.node-version`)
- npm 12.0.2
- Windows, macOS, or Linux

Install from the frozen lockfile:

```bash
npm ci
npm run ci:check
```

`npm ci` is intentional. Do not replace it with a floating install in CI or release work.

## Run

```bash
# Browser development server
npm run dev

# Vite plus the Electron desktop shell
npm run electron:dev

# Production web bundle
npm run build
```

The default local URL is `http://localhost:3001`. Batch input, Sharp-backed AVIF/TIFF decode, the validated BMP decoder, native save dialogs, and directory access require Electron. HEIC/HEIF works only on package targets whose Sharp/libvips build exposes that codec.

## Conversion modes

### B&W

The renderer decodes the source once, composites transparency over white, applies deterministic scaling, and transfers RGBA pixels to a module worker. Potrace produces compound filled paths with an even-odd fill rule. Threshold, turn policy, speckle suppression, corner behavior, and curve optimization remain configurable.

### Color

Color mode does not trace nested luminance masks. It:

1. Builds variance-based palette seeds and refines them in OKLab.
2. Assigns each raster pixel to exactly one palette label.
3. Extracts oriented boundaries from the shared pixel grid.
4. Groups all rings for a paint into an even-odd compound shape.
5. Simplifies geometry and fits cubic Béziers within the configured point-error tolerance.

Geometry is deduplicated only when canonical commands, paint, stroke, and opacity are all equal. A hash is only an index; canonical equality is still checked.

### Centerline

Centerline mode thresholds and Zhang-Suen-thins the raster, classifies endpoints and junctions, follows degree-two chains, and preserves isolated cycles. It emits open stroked paths instead of filled outlines around the skeleton, with optional error-bounded cubic fitting.

## Authoritative vector model

All converters produce a typed `VectorDocument` containing dimensions, mode, ordered shapes, paint, opacity, fill rule, and path commands. SVG, EPS, DXF, and JSON serialize directly from this document. EPS/DXF/JSON do not parse generated SVG text.

Key modules:

- `src/core/vectorDocument.ts` — conversion contract and worker protocol
- `src/core/colorTrace.ts` — palette refinement, labels, shared-grid topology, deduplication
- `src/core/centerline.ts` — thinning and graph traversal
- `src/core/bwTrace.ts` — Potrace adapter
- `src/core/vectorExport.ts` — authoritative export serializers
- `src/core/curveFit.ts` — recursive error-bounded cubic fitting
- `src/core/colorMetrics.ts` — D65 Lab and CIEDE2000 acceptance metrics
- `src/core/workerPool.ts` — prioritized reusable module-worker pool
- `src/utils/imageProcessor.ts` — decode, orchestration, metrics, and compatibility API

## Batch and desktop security

The renderer never supplies arbitrary filesystem paths. Electron grants opaque IDs for user-selected input and output directories. Main-process operations validate the grant, filename, extension, size, and final resolved child path.

Batch decoding returns bounded raw RGBA buffers rather than base64 data. Output uses atomic exclusive creation. Existing files and names already produced by the current or earlier runs are never overwritten; collisions become `name-1.svg`, `name-2.svg`, and so on. Cancellation terminates the active worker before any pending write. Completed files remain intact.

Native exports are written only after the user chooses a destination in the main-process save dialog. Renderer navigation is restricted, context isolation and sandboxing are enabled, and external links are denied in-app and opened by the operating system.

## Network mode

LAN hosting is off by default. Local, packaged, browser, and LAN clients use identical conversion settings and pixels.

To opt in:

```powershell
$env:SVGX_LAN = "1"
npm run electron:dev
```

The same-origin endpoints are:

- `/api/health`
- `/api/network-info`

Without `SVGX_LAN=1`, network URLs are not advertised. Opt-in LAN mode binds dual-stack IPv6 where the platform permits it, advertises bracketed IPv6 and IPv4 interface URLs, and the packaged server falls back to IPv4 on hosts without IPv6 socket support. Set `SVGX_HOST=0.0.0.0` for the Vite development server on an IPv4-only host. Port conflicts are surfaced instead of being silently ignored. Override the port with `SVGX_PORT`.

## Inputs and transparency

- Browser: PNG, JPEG, GIF, BMP, WebP, and formats supported by the current browser decoder
- Electron: PNG, JPEG, GIF, BMP, WebP, AVIF, TIFF, and HEIC/HEIF when the packaged Sharp build exposes HEIC
- Maximum desktop batch input: 50 MB
- Maximum native text export: 25 MB

Transparency is composited over white before tracing for compatibility. This behavior is deterministic across modes and transports.

## Exports

- SVG: exact `VectorDocument` geometry, optionally optimized by SVGO
- EPS: cubic commands are preserved as PostScript `curveto`; opacity is deterministically composited over white because EPS has no alpha channel
- DXF R12: curves are flattened adaptively to a geometric tolerance, with Y flipped into CAD coordinates
- JSON: the complete versioned `VectorDocument`

## Settings

Settings are stored under the versioned `svgx-settings-v2` key. Supported values from the old `svgx-potrace-params` key are migrated once. Invalid types, unsafe paint strings, stale enum values, and out-of-range numbers fall back or clamp safely.

## Test corpus

`tests/fixtures/review` contains generated review assets for:

- flat color artwork with holes, touching regions, thin details, and antialiasing;
- black-and-white line work with endpoints, junctions, loops, rings, and speckles;
- a realistic still life with gradients, transparency, reflections, texture, and noise.

Deterministic in-memory fixtures test exact color topology, canonical deduplication, centerline endpoints/junctions/cycles, settings migration, and vector exports. Generated art is for visual and regression review, not exact pixel-count assertions.

`tests/fixtures/formats` contains the same real color artwork encoded as AVIF, BMP, GIF, JPEG, TIFF, and WebP. Every guaranteed Electron format is decoded and vectorized in CI. CIEDE2000 is checked against published reference pairs; flat-color rasterization is gated by both SSIM and mean Delta E 2000.

## Validation commands

| Command                    | Purpose                                         |
| -------------------------- | ----------------------------------------------- |
| `npm run format:check`     | Formatting gate                                 |
| `npm run lint`             | ESLint gate                                     |
| `npm run typecheck`        | Strict TypeScript project check                 |
| `npm test`                 | Unit and algorithm tests                        |
| `npm run test:bench`       | Bounded performance checks                      |
| `npm run test:e2e:web`     | Chromium, Firefox, and WebKit user flows        |
| `npm run package:dir`      | Unsigned unpacked package for the current OS    |
| `npm run test:e2e:package` | Launch and convert in the packaged app          |
| `npm run build`            | Production web bundle                           |
| `npm run ci:check`         | Frozen local release gate plus dependency audit |
| `npm run electron:build`   | Unsigned platform package build                 |

Generated `dist`, `release`, builder diagnostics, TypeScript build metadata, installers, and logs are ignored and must not be committed.

## Packaging

```bash
# Current platform, unsigned, no publish
npm run electron:build

# Windows unpacked directory
npm run electron:build:dir

# Windows portable executable
npm run build:portable-exe
```

No recovery release has been published. Local and hosted unsigned package smoke tests are not claims that code signing, notarization, clean-machine installation, or a downloadable release has passed.

## Known limitations

- DXF uses sampled polylines rather than native splines.
- Color boundaries currently follow the shared pixel grid; antialiased edges are simplified and curve-fit but are not reconstructed as continuous subpixel coverage isolines.
- Color count is bounded to protect output complexity; photographic input is an approximation, not lossless vectorization.
- White alpha compositing is currently fixed for compatibility.
- HEIC availability depends on the Sharp build for the target platform.
- The compromised pre-recovery checkout never completed `npm ci`, so an honest unmodified historical quality/performance number does not exist. Recovery gates record current absolute metrics and do not claim a fabricated percentage improvement over that non-running baseline.
- Historical releases may not contain the unreleased recovery changes described here.

## License

MIT. See `LICENSE`.
