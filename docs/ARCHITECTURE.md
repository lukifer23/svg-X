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
