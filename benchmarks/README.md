# Benchmarks

Isolated harnesses for measuring the conversion pipeline and proving that
optimizations preserve output. They import SVG-X sources directly and are kept
out of the application's lint, format, and type gates (see `.prettierignore` and
`eslint.config.js`). Results are written to `results/`; the human summary is
`results/PERFORMANCE.md`.

## Run

```powershell
# Stage profile + output hashes (writes results/pipeline-<label>.json)
$env:BENCH_LABEL = "local"
npm run bench:pipeline

# Total color trace only (also runs against pristine code, so it can be used
# with `git stash` for a before/after comparison)
$env:BENCH_LABEL = "final"
npx vitest run --config benchmarks/vitest.config.ts total

# Intra-image parallelism prototype (Node worker_threads)
node benchmarks/bundle.mjs
$env:BENCH_LABEL = "parallel"
npx vitest run --config benchmarks/vitest.config.ts parallel
```

`BENCH_LABEL` names the output file; use a distinct label per run so results do
not overwrite each other.

## Files

- `support.ts` — shared fixtures (synthetic and the review PNGs), options, and
  the min-of-five timing helper.
- `pipeline.test.ts` — per-stage timings, memory delta, and the serialized-SVG
  SHA-256 used as the exactness guard.
- `photoColor.test.ts` — photo-specific stage medians for polygon and fitted
  output, with input and output hashes. See the [photo results](../results/PHOTO-COLOR.md).
- `total.test.ts` — total color-trace time and hash only; deliberately imports
  just `traceColorDocument` so it runs on a pristine checkout.
- `parallel.test.ts` + `parallel-worker.mjs` + `bundle.mjs` — the Node
  `worker_threads` prototype for band-parallel quantization, including a
  zero-mismatch check against the single-threaded labels.
- `vitest.config.ts` — isolated config (root = repository root).

## Notes

- Timings are the **minimum of five warm runs**; the median is dominated by GC
  and scheduler noise on this workload.
- Every result records an `outputHash`. Two runs may only be compared when the
  hashes match; a hash change means the output changed, not that it got faster.
- The `parallel.test.ts` prototype is Node-only and is a measurement tool, not
  the shipped path. Production parallelism lives in `src/core/parallelQuantize.ts`
  and is exercised by `src/core/parallelQuantize.test.ts`.
