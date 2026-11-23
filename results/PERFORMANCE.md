# SVG-X performance record

Machine-readable data: `results/pipeline-phaseA.json`, `results/pipeline-phaseB.json`.
Harness: `benchmarks/pipeline.test.ts` (`npm run bench:pipeline`, label via
`BENCH_LABEL`). Environment: Windows 11, Intel Core Ultra 9 285K, Node v24.18.0.

## What was measured

`traceColorDocument` (color mode, `colorSteps: 8`, `fillStrategy: dominant`,
`maxPaths: 2000`, `optCurve: false`) and its stages: seed generation, OKLab
precompute, palette refinement, pixel labeling, component merging, boundary
tracing. Also `traceBlackAndWhite` and `traceCenterlines` total time.

## Phase B — exact single-thread kernel optimizations

Implemented:

1. `findLabelComponents` no longer retains a per-component `pixels: number[]`;
   only the area count is kept. Removes an O(N) array build and large retention.
2. sRGB→linear is a 256-entry lookup table (channels are bytes), removing three
   `pow` calls per pixel in `precomputePixelLabs`.
3. `x ** 2` → `x * x` in the nearest-color distance loops.

Result vs the baseline captured immediately before Phase B (Phase A):

| case | total color | labs | refine | label | merge | bounds |
|---|---|---|---|---|---|---|
| synthetic-1000 | 198 → 162 ms (1.22×) | 59 → 16 (3.7×) | 51 → 51 | 10 → 10 | 37 → 29 | 28 → 39 |
| color-bicycle | 515 → 432 ms (1.19×) | 72 → 26 (2.8×) | 61 → 63 | 14 → 14 | 95 → 93 | 122 → 116 |
| realistic-still-life | 656 → 573 ms (1.14×) | 119 → 37 (3.2×) | 122 → 111 | 28 → 26 | 134 → 121 | 121 → 117 |
| centerline-mechanism | 484 → 350 ms (1.38×) | 123 → 36 (3.4×) | 104 → 102 | 24 → 22 | 114 → 90 | 52 → 57 |

`merge` and `bounds` are within run-to-run noise; `labs` is the clear, large win.

### Correctness

Every case's **serialized-SVG SHA-256 is identical** before and after Phase B,
and path counts are unchanged (`1945 / 1435 / 2219 / 1675`). All 56 unit and
algorithm tests pass; `format:check`, `lint`, and `typecheck` are clean.

## Considered and rejected

- **Single-pass boundary topology across all labels** (one grid scan instead of
  one per palette color): implemented, measured **neutral-to-worse** (the cost is
  the ring walk, not the scans), and reverted rather than left in without a gain.
- **Early palette-stabilization break** in `refinePalette`: kept as an exact
  short-circuit (later iterations are provably identical once the palette stops
  changing); it did not trigger on these fixtures but can only reduce work.
- **Fusing histogram and Wu moments scans**: not applicable — `paletteSeeds`
  runs one or the other, never both.

## Prior round (context)

An earlier pass replaced per-pixel `palette.forEach` closures with indexed loops
over flat typed arrays and replaced boundary string keys with integer keys,
measuring 1.5×–1.9× on color tracing. Phase B compounds with that.

## Phase C — algorithmic work on the remaining hotspots

Two allocation-driven wins in the component merge (`colorTrace.ts`), both exact:

1. The connected-component flood fill allocated a `visit` closure **once per
   popped pixel**; it is now four inlined neighbor checks.
2. `mergeComponentsToBudget` built an entries → map → filter → sort → `[0]`
   chain per merged component; it is now a single pass that selects the same
   winner under the identical comparator (smallest distance, then widest shared
   boundary, then largest area, stable on ties).

Effect: component merging **1.5×–1.7× faster** (e.g. still-life 128 → 72 ms,
bicycle 84 → 59 ms). The untouched `bounds` stage swings ±70% run to run because
it is GC-heavy, so the harness now reports the **minimum of five warm runs**.

### Robust pristine → final (total color trace, min of 5, hash-verified)

| case | pristine | final | speedup | output |
|---|---|---|---|---|
| synthetic-1000 | 369 ms | 133 ms | **2.78×** | identical |
| color-bicycle | 610 ms | 283 ms | **2.16×** | identical |
| realistic-still-life | 873 ms | 378 ms | **2.31×** | identical |
| centerline-mechanism | 768 ms | 221 ms | **3.47×** | identical |

## Intra-image parallelism prototype (measured, not predicted)

`benchmarks/parallel.test.ts` splits the image into row bands, runs the real
`precomputePixelLabs` + refinement rounds + `labelPixels` in Node workers, and
combines per-cluster partial sums in band order. Channel sums and counts are
exact integers, so the banded float64 reduction is **bit-identical** to
sequential — confirmed by zero label mismatches on every case.

Refine + label, minimum of three warm runs (Node worker_threads, 24 vCPU):

| case | sequential | 4 threads | 8 | 16 | 24 |
|---|---|---|---|---|---|
| synthetic-1000 | 60 ms | 3.3× | 5.5× | **10.0×** | 7.5× |
| color-bicycle | 55 ms | 3.1× | 5.0× | **6.9×** | 6.9× |
| realistic-still-life | 100 ms | 2.1× | 3.8× | **7.1×** | 7.7× |
| centerline-mechanism | 130 ms | 4.4× | 7.7× | **14.5×** | 11.9× |

Projected end-to-end (Amdahl on the measured totals): refining/labeling is 26–55%
of color trace, so parallelizing it lifts total color trace by roughly
**1.3×–2.0×** beyond the current numbers, still bit-identical. `labs` is also a
pure map and parallelizes too, adding more.

## Productionized intra-image parallelism (shipped path)

The prototype was productionized using a dedicated renderer-side band-worker
pool capped at four workers, plus the existing vector-worker pool — no nested
workers:

- `src/core/bandQuantize.ts` — one row band's labs + round/finish logic, shared
  by the in-process quantizer and the worker.
- `src/core/parallelQuantize.ts` — orchestration, band planning, and the
  `MIN_PARALLEL_PIXELS` / `chooseBandCount` crossover policy.
- `src/core/quantizePool.ts` + `src/workers/quantize.worker.ts` — a persistent
  band-worker pool with failure recycling.
- `src/core/colorParallel.ts` — decides eligibility and runs the bands.
- `src/core/colorTrace.ts` — `refinePalette` and the bands now share one
  reduction (`accumulatePaletteSums` / `paletteFromSums`); `traceColorDocument`
  was split so `assembleColorDocument` runs from labels + palette.
- `src/core/workerPool.ts` / `src/workers/vectorize.worker.ts` — new
  `assemble-color` job runs the post-quantization stages in the existing pool.
- `src/utils/imageProcessor.ts` — color conversions above the threshold use the
  parallel path and fall back to single-threaded on any failure.

`src/core/parallelQuantize.test.ts` proves bit-identical labels, palette, and
serialized-SVG hash versus single-threaded across 2/3/5/8 bands, including odd
dimensions and transparent pixels. Vite bundles both workers.

## Browser production-path validation

The production Web Worker path now runs in Playwright, not only in the
in-process harness. The Chromium gate performs one warm conversion, then three
actual eight-image sequential and pooled batches above
`MIN_PARALLEL_PIXELS`. On the 2026-11-16 local four-logical-CPU test after the
batch scheduling split, the medians were 471.8 ms sequential versus 222.2 ms
pooled (**2.12x throughput**) with 90.4 MiB peak and settled JS heap growth. The
test enforces 1.50x on controlled local hardware, 1.25x on variable hosted CI,
and a 256 MiB heap-growth ceiling.

That validation also exposed and fixed a real scheduler deadlock: concurrent
conversions could each reserve one quantization slot and then wait forever for
their second. Band sets are now reserved atomically, queued cancellation aborts
immediately, in-flight cancellation terminates the affected worker, and the
pool is capped at four workers to prevent unbounded CPU and memory pressure.
Interactive conversions may use multiple bands; batch conversions use one band
worker per image so the bounded pool scales across files on virtual and physical
CPUs instead of oversubscribing each image.

## Exact RGB reuse in OKLab conversion

The color pipeline previously ran three cube roots for every pixel, including
repeated RGB values in flat fills and along ink strokes. A direct-mapped
cache holds at most 4,096 keys and pixel indices per conversion or worker band
(32 KiB). Hits require an exact RGB match and reuse the Float32 result already
written to the output. The sampler checks four 512-pixel windows across larger
inputs and chooses the direct conversion loop when fewer than one in eight
sampled colors hits the cache. Alpha still participates in the later labeling
and quantization rules.

Windows measurements used Node 24.19.0 and the existing minimum of five warm
samples per stage. Every serialized SVG matched byte for byte.

| Input | OKLab before → after | Total color trace before → after |
| --- | ---: | ---: |
| Synthetic color bands | 30.65 → 7.32 ms | 241.19 → 227.14 ms |
| Color bicycle | 36.10 → 25.17 ms | 503.29 → 462.49 ms |
| Still-life photo | 48.06 → 44.60 ms | 621.97 → 611.62 ms |
| Mechanism illustration | 47.68 → 12.70 ms | 376.35 → 357.89 ms |

In a separate 1.5-million-pixel low-reuse stress input, the median OKLab
time was 47.19 ms before and 46.36 ms after. The Float32 output hash matched.
[Before](pipeline-rgb-cache-before.json) · [After](pipeline-rgb-cache-after.json)

The same Windows machine ran the Chromium eight-image benchmark in separate
sessions. Sequential and pooled medians went from 494.6 and 238.0 ms before
to 339.9 and 202.5 ms after. The faster sequential baseline brings the pool
speedup to 1.68×, above the 1.50× floor. Sampled peak heap growth was 61.7 MiB.

## Remaining performance work

- Tune `MIN_PARALLEL_PIXELS` and the band-size constant against a broader range
  of physical CPUs before changing the current conservative crossover.
- Rust: still not pursued. The bar is now the **parallel** JS baseline
  (2.2×–3.5× single-thread wins plus 7×–14× on the quantizable portion), which a
  WASM/N-API migration would have to beat end-to-end.
