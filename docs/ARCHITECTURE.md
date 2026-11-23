# Architecture

SVG-X has three execution boundaries: the React renderer, bundled conversion workers, and the Electron main process.

## Conversion dataflow

1. Browser uploads decode through `createImageBitmap`; Electron batch files decode in the main process through Sharp or the bounded BMP decoder.
2. Both paths produce deterministic white-composited RGBA pixels and the same `WorkerConversionOptions`.
3. `VectorWorkerPool` prioritizes interactive jobs ahead of batch jobs and transfers the pixel `ArrayBuffer` to a bundled module worker.
4. The worker produces the authoritative `VectorDocument`; it never returns SVG as the source of truth.
5. SVG, EPS, DXF, and JSON serialize directly from that document.

The versioned worker messages carry a job ID. A result is accepted only for the active ID. Aborting terminates and replaces the active worker, rejects queued work, and prevents stale completion from updating the UI.

## Native batch lifecycle

`desktop/batch.cjs` owns one abort signal and tracks every accepted read or write. The main process retains the run until its pending operations settle, including during a normal window close or quit. BMP file reads honor the signal. A Sharp decode already submitted drains in the native library, and cancellation discards its result before copying the RGBA buffer for IPC.

Each SVG is staged in its output directory. Cancellation is checked before each exclusive publication attempt. A submitted hard link or exclusive-copy fallback can finish after cancellation. The returned filename records that successful write, and run completion waits for staging cleanup. Existing names always take precedence, including those created by other processes.

## Mode ownership

- `bwTrace.ts`: Potrace adapter and compatibility preprocessing.
- `colorTrace.ts`: Wu cumulative-moment palette seeds, OKLab refinement, disjoint labels, lossless component-budget merging, shared-grid topology, compound even-odd regions, canonical deduplication.
- `sharedColorBoundaries.ts`: splits rings at junctions, canonicalizes each boundary chain, and reuses the same fitted segments in reverse on the other side.
- `centerline.ts`: foreground thresholding with separate ink confidence, contrast-aware component cleanup, table-driven Zhang–Suen thinning, width-aware spur pruning, and graph walks with cycle tracking. Thinning skips the blank area outside each raster row's initial foreground bounds.
- `scanLighting.ts`: opt-in centerline preprocessing. Interpolated paper estimates compensate for uneven lighting. Weak candidates need bilateral contrast and directional continuation. The wider ridge check also requires ink in the closer flanks. Short links can reconnect different components through existing raster ink. A separate one- or two-pixel closure pass checks endpoint contrast, directional or flank evidence, a shared ink component, and clearance from other components. Its anchors come from the mask before repair.
- `fadedCurveRepair.ts`: uses scan contrast after thinning to test short cubic continuations between facing skeleton tips. Spatial buckets limit the search to nearby tips. Reciprocal matches and clearance checks reject ambiguous links and contacts with nearby strokes. Accepted links can close loops within a connected component.
- `circularStrokeRecovery.ts`: fits circle candidates to tangents of existing curved fragments. A capped set of probes screens for ink around the perimeter. A cyclic search then follows a two-pixel radial corridor, weighs contrast against both flanks, and rejects prolonged weak runs. Accepted loops become separate closed subpaths and replace only exact tangential overlap with the skeleton.
- `circularPerimeters.ts`: finds already-traced circular outlines in the
  plane skeleton graph. Open tails are peeled from a discovery copy and
  exterior face walks reveal the outline across junctions. The graph
  walker emits the selected perimeter as one closed subpath and retains
  the remaining strokes. This pass adds no skeleton edge.
- Dense scan preprocessing chooses the 2,000-pixel calibration at a working
  longest side of 1,500 pixels or more. It uses a 3 × 3 binomial filter,
  wider flank offsets, and longer supported ridge runs on the native raster.
  Endpoint repair may use a tangent that ends early at a junction only for
  an eight-pixel or shorter span with ink in every sampled position. The
  reciprocal and stroke-clearance checks still apply.
- A dense ink mass can obscure the paper sampling tile. The estimator
  corrects a deep dip only where lighter neighbors bracket the tile.
  Thinning visits foreground indices and applies deletions synchronously
  in the same two subiterations.
- `curveFit.ts`: common recursive cubic fitting bounded by point residual, source envelope, handle length, and sampled curve-to-polyline distance.

Serialization and conversion types live in `vectorDocument.ts`, `serialize.ts`, and `vectorExport.ts`. UI code must not parse generated SVG to recover geometry.

## Performance model

The default pool size is `max(1, min(4, hardwareConcurrency - 1))`. Batch input crosses Electron IPC once as raw RGBA. Interactive work always leaves the batch queue behind it. CI measures an eight-image sequential-versus-pooled workload on Chromium when at least three logical CPUs are available and enforces bounded heap growth.

## Color pipeline hot paths

The color converter seeds a palette, precomputes OKLab, refines the palette four times, labels pixels, merges components, and traces each palette label. A shared-chain fit uses the same endpoints and reversed cubic controls in adjacent rings. Component cleanup happens before this step so holes and neighboring outlines agree. Color SVG optimization preserves path coordinates. Per-pixel color conversion uses a 256-entry sRGB-to-linear table and flat typed arrays. A bounded cache reuses the original Float32 results for exact RGB matches. A short sample selects the direct conversion loop when the image has little color reuse. Boundary tracing uses integer lattice keys and keeps no per-component pixel lists. See `results/PERFORMANCE.md` for benchmarks.

Decode applies EXIF orientation on both paths — the desktop decoder calls Sharp `rotate()` and the browser decoder passes `imageOrientation: "from-image"` to `createImageBitmap` — so the same file vectorizes the same way in every transport.

### Parallel quantization

For color mode above `MIN_PARALLEL_PIXELS` (`src/core/parallelQuantize.ts`), the renderer splits an interactive image into row bands and runs `precomputePixelLabs` + the four refinement rounds + `labelPixels` in a dedicated worker pool capped at four workers (`src/core/quantizePool.ts`, `src/workers/quantize.worker.ts`). Batch jobs deliberately use one band worker per image so the same bounded pool parallelizes across images instead of oversubscribing each image. A conversion reserves its complete band set atomically, so concurrent jobs cannot deadlock by each holding a partial set. Queued and active band work observes the same `AbortSignal`; aborting active work terminates and replaces the affected worker. Per-candidate channel sums and counts are exact integers, so combining band partials in band order is bit-identical to the single-threaded reduction (`src/core/parallelQuantize.test.ts` verifies this across band counts). The resulting labels and palette are handed back to the existing conversion pool as an `assemble-color` job that runs `assembleColorDocument`; `traceColorDocument` delegates to the same function. Any non-cancellation worker failure falls back to the single-threaded path, and images below the threshold never spawn band workers. Both workers are bundled by Vite (`dist/assets/{quantize,vectorize}.worker-*.js`).
