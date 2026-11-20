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
- `sharedColorBoundaries.ts`: splits rings at junctions, canonicalizes each boundary chain, and reuses the same fitted segments in reverse on the other side.
- `centerline.ts`: thresholding and component-area cleanup, table-driven Zhang–Suen thinning, packed adjacency and edge visitation, short-spur pruning, and degree-two walks with cycle tracking.
- `curveFit.ts`: common recursive cubic fitting bounded by point residual, source envelope, handle length, and sampled curve-to-polyline distance.

Serialization and conversion types live in `vectorDocument.ts`, `serialize.ts`, and `vectorExport.ts`. UI code must not parse generated SVG to recover geometry.

## Performance model

The default pool size is `max(1, min(4, hardwareConcurrency - 1))`. Batch input crosses Electron IPC once as raw RGBA. Interactive work always leaves the batch queue behind it. CI measures an eight-image sequential-versus-pooled workload on Chromium when at least three logical CPUs are available and enforces bounded heap growth.

## Color pipeline hot paths

The color converter seeds a palette, precomputes OKLab, refines the palette four times, labels pixels, merges components, and traces each palette label. A shared-chain fit uses the same endpoints and reversed cubic controls in adjacent rings. Component cleanup happens before this step so holes and neighboring outlines agree. Color SVG optimization preserves path coordinates. The per-pixel color math uses a 256-entry sRGB-to-linear lookup table and flat typed arrays. Boundary tracing uses integer lattice keys and keeps no per-component pixel lists. See `results/PERFORMANCE.md` for historical benchmarks.

Decode applies EXIF orientation on both paths — the desktop decoder calls Sharp `rotate()` and the browser decoder passes `imageOrientation: "from-image"` to `createImageBitmap` — so the same file vectorizes the same way in every transport.

### Parallel quantization

For color mode above `MIN_PARALLEL_PIXELS` (`src/core/parallelQuantize.ts`), the renderer splits an interactive image into row bands and runs `precomputePixelLabs` + the four refinement rounds + `labelPixels` in a dedicated worker pool capped at four workers (`src/core/quantizePool.ts`, `src/workers/quantize.worker.ts`). Batch jobs deliberately use one band worker per image so the same bounded pool parallelizes across images instead of oversubscribing each image. A conversion reserves its complete band set atomically, so concurrent jobs cannot deadlock by each holding a partial set. Queued and active band work observes the same `AbortSignal`; aborting active work terminates and replaces the affected worker. Per-candidate channel sums and counts are exact integers, so combining band partials in band order is bit-identical to the single-threaded reduction (`src/core/parallelQuantize.test.ts` verifies this across band counts). The resulting labels and palette are handed back to the existing conversion pool as an `assemble-color` job that runs `assembleColorDocument`; `traceColorDocument` delegates to the same function. Any non-cancellation worker failure falls back to the single-threaded path, and images below the threshold never spawn band workers. Both workers are bundled by Vite (`dist/assets/{quantize,vectorize}.worker-*.js`).
