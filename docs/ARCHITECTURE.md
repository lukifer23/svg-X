# Architecture

SVG-X has three execution boundaries: the React renderer, bundled conversion workers, and the Electron main process.

## Conversion dataflow

1. Browser uploads decode through `createImageBitmap`; Electron batch files decode in the main process through Sharp or the bounded BMP decoder.
2. Both paths produce deterministic white-composited RGBA pixels and the same `WorkerConversionOptions`.
3. `VectorWorkerPool` prioritizes interactive jobs ahead of batch jobs and transfers the pixel `ArrayBuffer` to a bundled module worker.
4. The worker produces the authoritative `VectorDocument`; it never returns SVG as the source of truth.
5. SVG, EPS, DXF, and JSON serialize directly from that document.

The versioned worker messages carry a job ID. A result is accepted only for the active ID. Aborting terminates and replaces the active worker, rejects queued work, and prevents stale completion from updating the UI.

## Mode ownership

- `bwTrace.ts`: Potrace adapter and compatibility preprocessing.
- `colorTrace.ts`: Wu cumulative-moment palette seeds, OKLab refinement, disjoint labels, lossless component-budget merging, shared-grid topology, compound even-odd regions, canonical deduplication.
- `centerline.ts`: thresholding, thinning, endpoint/junction classification, degree-two walks, and cycle preservation.
- `curveFit.ts`: common recursive cubic fitting bounded by point residual, source envelope, handle length, and sampled curve-to-polyline distance.

Serialization and conversion types live in `vectorDocument.ts`, `serialize.ts`, and `vectorExport.ts`. UI code must not parse generated SVG to recover geometry.

## Performance model

The default pool size is `max(1, min(4, hardwareConcurrency - 1))`. Batch input crosses Electron IPC once as raw RGBA. Interactive work always leaves the batch queue behind it. CI measures an eight-image sequential-versus-pooled workload on Chromium when at least three logical CPUs are available and enforces bounded heap growth.

## Color pipeline hot paths

The color converter runs, in order: Wu/tonal palette seeds, OKLab precompute, four palette-refinement iterations, pixel labeling, component-budget merging, one boundary trace per palette label, ring simplification, and curve fitting. The per-pixel color math uses a 256-entry sRGB→linear lookup table and indexed loops over flat typed arrays; boundary tracing uses integer lattice keys and keeps no per-component pixel lists. These are behavior-preserving: `npm run bench:pipeline` verifies that each fixture's serialized-SVG SHA-256 is unchanged and reports every stage's time in `results/pipeline-<label>.json` (see `results/PERFORMANCE.md`).

Decode applies EXIF orientation on both paths — the desktop decoder calls Sharp `rotate()` and the browser decoder passes `imageOrientation: "from-image"` to `createImageBitmap` — so the same file vectorizes the same way in every transport.

### Parallel quantization

For color mode above `MIN_PARALLEL_PIXELS` (`src/core/parallelQuantize.ts`), the renderer splits the image into row bands and runs `precomputePixelLabs` + the four refinement rounds + `labelPixels` in a dedicated worker pool capped at four workers (`src/core/quantizePool.ts`, `src/workers/quantize.worker.ts`). A conversion reserves its complete band set atomically, so concurrent jobs cannot deadlock by each holding a partial set. Queued and active band work observes the same `AbortSignal`; aborting active work terminates and replaces the affected worker. Per-candidate channel sums and counts are exact integers, so combining band partials in band order is bit-identical to the single-threaded reduction (`src/core/parallelQuantize.test.ts` verifies this across band counts). The resulting labels and palette are handed back to the existing conversion pool as an `assemble-color` job that runs `assembleColorDocument`; `traceColorDocument` delegates to the same function. Any non-cancellation worker failure falls back to the single-threaded path, and images below the threshold never spawn band workers. Both workers are bundled by Vite (`dist/assets/{quantize,vectorize}.worker-*.js`).
