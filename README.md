# SVG-X

SVG-X is a local-first raster-to-vector converter for the browser and Electron. It supports filled B&W tracing, disjoint color-region tracing, true centerline output, batch conversion, and SVG/EPS/DXF/JSON exports.

The current `main` branch is an unreleased recovery build. The latest public binary is [v1.1.2](https://github.com/lukifer23/svg-X/releases/tag/v1.1.2).

The [testing guide](docs/TESTING.md) links the current validation evidence, including [held-out scan results](results/ARCHIVAL-QUALIFICATION.md) and [independent export checks](results/EXPORT-CONSUMERS.md). The [November recovery audit](docs/AUDIT-2026-11-20.md) records earlier engineering findings.

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

The default local URL is `http://127.0.0.1:3001`. Native batch conversion and save dialogs require Electron. See the input matrix below for decoder details.

## Conversion modes

Choose **B&W**, **Color**, or **Centerline** from the main screen. For Color,
switch between **Polygon** and **Fitted Bézier** there. Both styles use the
same palette. Settings offers the palette size, fill strategy, and path budget.

### B&W

The renderer decodes the source once, composites transparency over white, applies deterministic scaling, and transfers RGBA pixels to a module worker. Potrace produces compound filled paths with an even-odd fill rule. Threshold, turn policy, speckle suppression, corner behavior, and curve optimization remain configurable.

### Color

Color mode traces regions of an ordered palette.

1. Builds Wu cumulative-moment palette seeds by minimizing variance within each split, then refines them in OKLab.
2. Assigns each raster pixel to exactly one palette label.
3. Reassigns small connected components before extracting oriented boundaries from the pixel grid.
4. Groups all rings for a paint into an even-odd compound shape.
5. Simplifies and optionally fits each shared boundary once. Adjacent regions use the same coordinates in opposite directions, with fixed junctions and image corners.

Geometry is deduplicated only when canonical commands, paint, stroke, and opacity are all equal. Hash matches are checked for canonical equality.

Color defaults to eight colors and polygon paths. Fitted Bézier is opt-in because it can increase file size on detailed artwork. The path setting is a complexity target. Adjacent islands merge by perceptual proximity, and disconnected artwork is retained. See the [color fidelity measurements](results/COLOR-FIDELITY.md).

### Centerline

Centerline mode thresholds the raster, cleans small weak marks, thins with Zhang–Suen rules, and walks the skeleton as a graph. Speckle Suppression keeps small high-contrast strokes and uses raster width to protect narrow, strong tips while trimming short spurs. Set it to zero to disable cleanup when keeping faint details matters most. Optional Bézier fitting shares a subpixel error budget with simplification.

Turn on **Recover faded scan lines** for shaded or washed-out line drawings. It estimates local paper tone, looks for directional stroke support, and can reconnect short breaks when ink remains across the gap. At 1,500 working pixels or more on the longest side, it lightly smooths grain and checks wider stroke flanks on the full-resolution grid. It can also close a faded round stroke or keep an existing circular outline together where other strokes cross it. Thinning retains faint diagonal tips when the original scan supports a continuous ridge. Leave it off for ordinary artwork and compare both modes on textured paper. See the [relay and receiver benchmark](results/ARCHIVAL-PERIMETERS.md), [full-resolution benchmark](results/ARCHIVAL-SCALE.md), [Velocipede rim benchmark](results/VELOCIPEDE-RIM.md), and [weak-stroke span benchmark](results/WEAK-STROKE-SPANS.md).

## Authoritative vector model

All converters produce a typed `VectorDocument` containing dimensions, mode, ordered shapes, paint, opacity, fill rule, and path commands. SVG, EPS, DXF, and JSON serialize directly from this document. EPS/DXF/JSON do not parse generated SVG text.

Key modules:

- `src/core/vectorDocument.ts` — conversion contract and worker protocol
- `src/core/colorTrace.ts` — palette refinement, labels, shared-grid topology, deduplication
- `src/core/centerline.ts` — thinning and graph traversal
- `src/core/bwTrace.ts` — Potrace adapter
- `src/core/vectorExport.ts` — authoritative export serializers
- `src/core/curveFit.ts` — error-bounded cubic fitting with an explicit stack of source ranges
- `src/core/colorMetrics.ts` — D65 Lab and CIEDE2000 acceptance metrics
- `src/core/workerPool.ts` — prioritized reusable module-worker pool
- `src/core/parallelQuantize.ts`, `src/core/quantizePool.ts`, `src/workers/quantize.worker.ts` — band-parallel color quantization
- `src/utils/imageProcessor.ts` — decode, orchestration, metrics, and compatibility API
- `desktop/decode.cjs` — EXIF-aware desktop decode pipeline

## Performance

The [dense photo benchmark](results/COLOR-FIDELITY.md#dense-photo-boundary-assembly) measured the USDA photo at 264.1 ms for polygon tracing and 318.8 ms for fitted tracing on the recorded Windows host at a 1,000-pixel limit. Those timings cover the trace kernel and exclude image decoding, SVG serialization, and preview. The [upload-to-preview benchmark](results/PREVIEW-LATENCY.md) measures those stages in the production browser bundle.

Above a size threshold, color quantization runs across a renderer-side pool capped at four workers. Interactive images use multiple row bands; batch jobs use one worker per image so concurrency is spent across files rather than oversubscribing every file. Each conversion reserves its complete band set atomically, preventing cross-job deadlocks; queued and active work is cancellable. Each band reports exact integer channel sums that are combined in band order, so the parallel result is bit-identical to the single-threaded one; any non-cancellation worker failure falls back to the single-threaded path.

Use `npm run bench:pipeline` for core stage timings, `npm run bench:photo` for photo tracing and optional exact-output comparison, and `npm run bench:preview` for real browser uploads. See the [testing guide](docs/TESTING.md).

The [fitted photo batch benchmark](results/FITTED-PHOTO-BATCH.md) records pooled and sequential timings, SVG sizes, and exact output hashes for the bicycle illustration, still-life, USDA produce photo, and USFWS hummingbird photo.

See the [competitive review](docs/COMPETITIVE-REVIEW.md) for the measured VTracer comparison and product gaps, and the [training-data guide](docs/TRAINING-DATA.md) for building and auditing supervised pairs.

## Batch and desktop security

The renderer never supplies arbitrary filesystem paths. Electron grants opaque IDs for user-selected input and output directories. Main-process operations validate the grant, filename, extension, size, and final resolved child path.

In **Batch Conversion**, select the input and output folders and choose SVG, EPS, DXF, or JSON under **Output format**. The format applies to the whole queue, including **Resume Pending Files** and **Retry Failed**. The results list shows the actual filename written for each completed item. Existing files keep their names and collisions get a numeric suffix such as `name-1.dxf`.

Batch decoding sends raw RGBA at the selected quality limit (1000 or 2000 pixels on the longest side), unless an explicit batch resize is set. Cancelling stops active tracing, discards pixels from native decodes already submitted, and prevents staged files from starting publication. An exclusive filesystem operation already submitted can finish, and its output counts as completed. Resume becomes available once native work and temporary-file cleanup finish. When failures remain, **Save Failure Report** writes a JSON report containing the failed filenames, errors, and retry counts to the selected output folder. Successful retries disappear from the on-screen report. Saved reports remain available for reference.

For model development, `npm run dataset:build` generates paired raster inputs and labels from source SVGs. The starter corpus includes 32 licensed source designs, and `npm run dataset:audit` flags near-duplicate silhouettes across splits. See the [training dataset guide](docs/TRAINING-DATA.md).

Native exports are written only after the user chooses a destination in the main-process save dialog. Renderer navigation is restricted, context isolation and sandboxing are enabled, browser permissions are denied by default, and only credential-free HTTPS links may open through the operating system. The browser entry point and packaged server enforce a restrictive Content Security Policy; the packaged server also sends isolation, no-referrer, no-sniff, and permission-policy headers.

## Network mode

LAN hosting is off by default. Browser clients use the same conversion code and settings on loopback and LAN. The packaged smoke compares all four exports byte-for-byte on the same host. Native batch uses Sharp for decoding and resizing, which can produce different working pixels from browser canvas.

To opt in:

```powershell
$env:SVGX_LAN = "1"
npm run electron:dev
```

The same-origin endpoints are:

- `/api/health`
- `/api/network-info`

Without `SVGX_LAN=1`, network URLs are not advertised. Opt-in LAN mode binds dual-stack IPv6 where the platform permits it and advertises IPv4 and bracketed IPv6 browser URLs. Discovery skips scoped and link-local IPv6 addresses. The packaged server falls back to IPv4 on hosts without IPv6 socket support. Set `SVGX_HOST=0.0.0.0` for the Vite development server on an IPv4-only host. Override the port with `SVGX_PORT`. The app surfaces port conflicts at startup.

Desktop development uses the selected port for the renderer and the next port
for the local network service. The browser-only `npm run dev` command does
not start that service.

For a packaged build, set the same variable before launching the app and open an advertised network URL on the intended LAN device. The [LAN verification guide](docs/TESTING.md#packaged-lan-verification) covers same-host export parity and the second-device check. Browser clients use local downloads. Native batch and filesystem operations require the desktop window.

## Inputs and transparency

| Entry point                             | Decoder and supported inputs                                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser or Electron single-image upload | Chromium, Firefox, or WebKit image decoding. PNG, JPEG, GIF, BMP, and WebP are supported by the browser test targets. AVIF, TIFF, and HEIC/HEIF availability depends on the client decoder. |
| Electron native batch                   | Sharp handles PNG, JPEG, GIF, WebP, AVIF, and TIFF. BMP uses the native batch BMP decoder. HEIC/HEIF depends on the packaged Sharp build.                                                   |

- EXIF orientation is applied on both decode paths, so camera and phone photos vectorize upright
- Maximum desktop batch input: 50 MB
- Maximum native text export: 25 MB

Transparency is composited over white before tracing for compatibility. This behavior is deterministic across modes and transports.

## Exports

- SVG: geometry serialized from `VectorDocument`. **Optimize SVG** compacts Color output at the same coordinate precision and uses SVGO for B&W and Centerline. See the [photo preview measurements](results/PREVIEW-LATENCY.md).
- EPS: cubic commands are preserved as PostScript `curveto`; opacity is deterministically composited over white because EPS has no alpha channel
- DXF R12: curves are flattened adaptively to a geometric tolerance, with Y flipped into CAD coordinates
- JSON: the complete versioned `VectorDocument`

## Settings

Settings are stored under the versioned `svgx-settings-v3` key. Supported values from `svgx-settings-v2` and the older `svgx-potrace-params` key are migrated once. Invalid types, unsafe paint strings, stale enum values, and out-of-range numbers fall back or clamp safely.

## Test corpus

`tests/fixtures/review` contains generated review assets for:

- flat color artwork with holes, touching regions, thin details, and antialiasing;
- black-and-white line work with endpoints, junctions, loops, rings, and speckles;
- a realistic still life with gradients, transparency, reflections, texture, and noise.

Deterministic in-memory fixtures test exact color topology, canonical deduplication, centerline endpoints/junctions/cycles, settings migration, and vector exports. Generated art is for visual and regression review, not exact pixel-count assertions.

`tests/fixtures/formats` contains the same real color artwork encoded as AVIF, BMP, GIF, JPEG, TIFF, and WebP. Every guaranteed Electron format is decoded and vectorized in CI. CIEDE2000 is checked against published reference pairs; flat-color rasterization is gated by both SSIM and mean Delta E 2000.

## Validation commands

| Command                    | Purpose                                          |
| -------------------------- | ------------------------------------------------ |
| `npm run format:check`     | Formatting gate                                  |
| `npm run lint`             | ESLint gate                                      |
| `npm run typecheck`        | Strict TypeScript project check                  |
| `npm test`                 | Unit and algorithm tests                         |
| `npm run test:bench`       | Bounded performance checks                       |
| `npm run bench:pipeline`   | Per-stage pipeline profile and exactness hashes  |
| `npm run bench:photo`      | Photo trace timing and baseline hash comparison  |
| `npm run bench:preview`    | Production browser upload-to-preview benchmark   |
| `npm run test:e2e:web`     | Chromium, Firefox, and WebKit user flows         |
| `npm run package:dir`      | Unsigned unpacked package for the current OS     |
| `npm run test:e2e:package` | Launch and convert with a packaged executable    |
| `npm run build`            | Production web bundle                            |
| `npm run ci:check`         | Frozen local release gate plus dependency audit  |
| `npm run audit:deps`       | Moderate-or-higher dependency vulnerability gate |
| `npm run electron:build`   | Unsigned platform package build                  |

Generated `dist`, `release`, builder diagnostics, TypeScript build metadata, installers, and logs are ignored and must not be committed.

## Packaging

```bash
# Current platform, unsigned, no publish
npm run electron:build

# Windows unpacked directory
npm run package:dir

# Windows portable executable
npm run package:portable
```

The [distribution smoke tests](docs/TESTING.md#unsigned-distribution-files)
exercise the Windows portable EXE, Linux AppImage and DEB, and macOS DMG and
ZIP. Use GitHub Issues for support with Linux packages. The Debian maintainer
field uses the project account's GitHub no-reply address as package metadata.
The [signing rehearsal guide](docs/SIGNING.md) covers credentials and signed
artifact verification. Clean-device trust checks are a separate release gate.

## Known limitations

- DXF exports curves as sampled polylines. Sampling keeps significant turns that extend beyond the chord endpoints.
- Color geometry follows the shared pixel grid. Neighboring shapes have coincident boundaries. SVG renderers that antialias each fill separately can still show faint coverage artifacts at some scales.
- Color count is bounded to protect output complexity; photographic input is an approximation, not lossless vectorization.
- White alpha compositing is currently fixed for compatibility.
- HEIC availability depends on the Sharp build for the target platform.
- The compromised pre-recovery checkout never completed `npm ci`, so an honest unmodified historical quality/performance number does not exist. Recovery gates record current absolute metrics and do not claim a fabricated percentage improvement over that non-running baseline.
- Historical releases may not contain the unreleased recovery changes described here.

## License

MIT. See `LICENSE`.
