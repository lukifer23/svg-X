# Architecture

SVG-X has three execution boundaries: the React renderer, bundled conversion workers, and the Electron main process.

## Conversion dataflow

1. Browser uploads decode through `createImageBitmap`; Electron batch files decode in the main process through Sharp or the bounded BMP decoder.
2. Both paths produce deterministic white-composited RGBA pixels and the same `WorkerConversionOptions`.
3. `VectorWorkerPool` prioritizes interactive jobs ahead of batch jobs and transfers the pixel `ArrayBuffer` to a bundled module worker.
4. The worker produces the authoritative `VectorDocument`; it never returns SVG as the source of truth.
5. SVG, EPS, DXF, and JSON serialize directly from that document.

The versioned worker messages carry a job ID. A result is accepted only for the active ID. Aborting terminates and replaces the active worker, rejects queued work, and prevents stale completion from updating the UI. With SVG optimization enabled, the worker emits compact Color SVG directly from the document and lazily loads SVGO for B&W and Centerline. Both routes run in the same cancellable job. For compact Color results that need EPS, DXF, or JSON export, the worker encodes the authoritative document as JSON and the renderer reconstructs it on receipt. SVG-only batch jobs omit the geometry payload. The renderer logs elapsed times for decode, quantization, tracing, serialization, optional SVGO, and delivery of the complete worker response.

## Native batch lifecycle

`desktop/batch.cjs` owns one abort signal and tracks every accepted read or write. The main process retains the run until its pending operations settle, including during a normal window close or quit. BMP file reads honor the signal. A Sharp decode already submitted drains in the native library, and cancellation discards its result before copying the RGBA buffer for IPC.

The batch worker serializes the selected format directly from the vector document and returns output text. Batch results omit the geometry payload. The main process validates the run's format and stages each output in its granted directory. Cancellation is checked before each exclusive publication attempt. A submitted hard link or exclusive-copy fallback can finish after cancellation. The returned filename records that successful write, and run completion waits for staging cleanup. Existing names always take precedence, including those created by other processes. Failure reports use a fixed JSON filename and the same exclusive publication in the granted output directory.

## Mode ownership

- `bwTrace.ts`: Potrace adapter and compatibility preprocessing.
- `colorTrace.ts`: Wu cumulative-moment palette seeds, OKLab refinement, disjoint labels, lossless component-budget merging, shared-grid topology, compound even-odd regions, canonical deduplication.
- `sharedColorBoundaries.ts`: splits rings at junctions, canonicalizes each boundary chain, and reuses the same fitted segments in reverse on the other side.
- `centerline.ts`: foreground thresholding with separate ink confidence, contrast-aware component cleanup, table-driven Zhang–Suen thinning, width-aware spur pruning, and graph walks with cycle tracking. Thinning visits the initial foreground pixels. With scan lighting enabled, it protects weak diagonal tips whose original mask and bilateral contrast support a sustained run at the working scale. This check only retains pixels from the cleaned mask.
- `scanLighting.ts`: opt-in centerline preprocessing. Interpolated paper estimates compensate for uneven lighting. Weak candidates need bilateral contrast and directional continuation. The closer flank check requires a visible valley between parallel strokes and a near-paper flank on the opposite side. The wider check requires ink in the closer flanks. Short links can reconnect different components through existing raster ink. A separate one- or two-pixel closure pass checks endpoint contrast, directional or flank evidence, a shared ink component, and clearance from other components. It can use one visible flank at an evidence-backed, one-pixel diagonal corner. Both repair passes reuse the same original foreground anchors.
- `fadedCurveRepair.ts`: uses scan contrast after thinning to test short cubic continuations between facing skeleton tips. Spatial buckets limit the search to nearby tips. Reciprocal matches and clearance checks reject ambiguous links and contacts with nearby strokes. Accepted links can close loops within a connected component.
- `circularStrokeRecovery.ts`: fits circle candidates to tangents of existing curved fragments. A capped set of probes screens for ink around the perimeter. A cyclic search then follows a two-pixel radial corridor, weighs contrast against both flanks, and rejects prolonged weak runs. Accepted loops become separate closed subpaths and replace only exact tangential overlap with the skeleton.
- `insetFrameRepair.ts`: uses a closed rectangular outline to bound the search for an inner frame. It checks directional support on all four sides and original ink contrast at every recovered pixel. When no skeleton edge crosses a crop boundary, the tracer rebuilds just the isolated area. Full-resolution scans can also recover the inner rim of a centered ring by following observed ink within the frame.
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
- `curveFit.ts`: common cubic fitter bounded by point residual, source envelope, handle length, and sampled curve-to-polyline distance. It reuses the exact solver and residual weights for ranges of up to 64 unit chords. Nonuniform chords use cumulative lengths and per-chain scratch buffers. Validation reuses the same 17 sets of cubic weights and checks squared distances, falling back to the original distance calculation near the tolerance.

Serialization and conversion types live in `vectorDocument.ts`, `serialize.ts`, and `vectorExport.ts`. UI code must not parse generated SVG to recover geometry.

## Performance model

The default pool size is `max(1, min(4, hardwareConcurrency - 1))`. Batch input crosses Electron IPC once as raw RGBA. Interactive work always leaves the batch queue behind it. CI measures an eight-image sequential-versus-pooled workload on Chromium when at least three logical CPUs are available and enforces bounded heap growth.

## Color pipeline hot paths

The color converter seeds a palette, precomputes OKLab, refines the palette up to four times, labels pixels, merges components, and traces their boundaries. Contour extraction seeds rings for all labels in one pass over a byte-per-pixel edge mask. A shared-chain fit uses the same endpoints and reversed cubic controls in adjacent rings. Component cleanup happens before this step so holes and neighboring outlines agree. Color SVG optimization preserves path coordinates. Per-pixel color conversion uses a 256-entry sRGB-to-linear table and flat typed arrays. When sampled colors show reuse, a bounded cache groups exact opaque RGB matches during OKLab conversion. Each refinement round weights the representative by its count, and final labels propagate from representatives to matching pixels. A direct per-pixel loop handles inputs with little color reuse. See [photo benchmarks](../results/PHOTO-COLOR.md) and [performance history](../results/PERFORMANCE.md).

Component discovery joins provisional IDs in raster order using four-way
connectivity. The adjacency pass preserves the original contact order for
equal merge scores. Merging reuses palette distances and resolved neighbor
roots, then applies one final label per component. See the
[connected-component measurements](../results/COLOR-FIDELITY.md#connected-components-follow-up).

The contour walk accumulates signed ring area as it steps across unit
edges. Shared-boundary assembly caches junctions and reuses the fitted
commands in both directions. The simplifier rejects clearly closer points
with squared distances and uses the original distance for split decisions
near the cutoff. See the
[dense photo measurements](../results/COLOR-FIDELITY.md#dense-photo-boundary-assembly).

Both decoders apply EXIF orientation. Native batch uses Sharp `rotate()`;
single-image upload uses `createImageBitmap` with `imageOrientation: "from-image"`.
The paths use separate resamplers, so working pixels can differ across decoders.

### Parallel quantization

For color mode above `MIN_PARALLEL_PIXELS` (`src/core/parallelQuantize.ts`), the renderer splits an interactive image into row bands and runs `precomputePixelLabs` + the four refinement rounds + `labelPixels` in a dedicated worker pool capped at four workers (`src/core/quantizePool.ts`, `src/workers/quantize.worker.ts`). Batch jobs use one quantization worker per image. That worker seeds, refines, and labels in one request before handing off the labels for assembly. A multi-band conversion reserves its complete band set atomically, so concurrent jobs cannot deadlock by each holding a partial set. Queued and active work observes the same `AbortSignal`; aborting active work terminates and replaces the affected worker. Per-candidate channel sums and counts are exact integers, so combining band partials in band order is bit-identical to the single-threaded reduction (`src/core/parallelQuantize.test.ts` verifies this across band counts). The resulting labels and palette are handed back to the existing conversion pool as an `assemble-color` job that runs `assembleColorDocument`; `traceColorDocument` delegates to the same function. Any non-cancellation worker failure falls back to the single-threaded path, and images below the threshold never spawn band workers. Both workers are bundled by Vite (`dist/assets/{quantize,vectorize}.worker-*.js`).
