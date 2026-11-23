# Photo color tracing performance

## Inputs and measurement

The corpus pairs the existing generated still-life fixture with two
public-domain photographs. The USDA image contains crisp produce edges, fine
leaf detail, and mixed textures. The USFWS image has a small subject against
a soft background. The benchmark reads the stored images directly.

- `realistic-still-life.png` is the repository’s generated 1,254 × 1,254 review fixture.
- `usda-fresh-produce.jpg` is [Fresh Produce by Peggy Greb, USDA/ARS](https://www.ars.usda.gov/oc/images/photos/featuredphoto/mar19/freshproduce/), the public-domain desktop download.
- `usfws-rufous-hummingbird.jpg` is [Rufous Hummingbird by Peter Pearsall, USFWS](https://www.fws.gov/media/rufous-hummingbirdjpeg), the public-domain large download.

The harness measures quantization, component merging, contour extraction,
assembly, and total in-process color tracing separately. Image decode, SVG
serialization, and rasterization are outside the timed region. Each stage
reports the median of seven measurements after three warm-ups. Multiple
stages are timed independently, so their medians do not add up to the total.
Every run records the input RGBA, serialized SVG, and librsvg-rendered RGBA
hashes, plus output path count, for both polygon and fitted output.

## Changes

Contour extraction used to scan the whole label raster per palette entry
and allocate an edge object, endpoint objects, and entries in a vertex map.
The new walk stores up to four directed sides in a byte per pixel and seeds
rings in row-major order across all labels. It preserves ring order, turn
priority at diagonal contacts, and the closed-ring requirement. The
shared-boundary fitter still fits the same chains once and reverses them for
neighboring colors. A differential run matched every ordered ring from the
old tracer on all 19,683 three-by-three masks with two colors and transparency.

## Results

Paired measurements on Windows, Node 24.19.0, and an AMD Ryzen 5 7535HS.
These are absolute median times for the same images and settings.

| Input | Contour extraction before → after | Polygon color trace before → after | Fitted color trace before → after |
| --- | ---: | ---: | ---: |
| Generated still-life | 171.1 → 25.4 ms | 590.8 → 443.0 ms | 1,074.6 → 819.8 ms |
| USDA fresh produce | 231.1 → 13.4 ms | 601.1 → 372.1 ms | 904.3 → 617.6 ms |
| USFWS hummingbird | 120.5 → 9.6 ms | 351.4 → 235.2 ms | 460.9 → 366.5 ms |

The SVG bytes, rasterized RGBA bytes, and output path counts matched for all
six comparisons. These comparisons establish fidelity to the baseline
vectors. The still-life still spends considerably more time in fitted
assembly than in polygon assembly. A trial of simpler curve-distance checks
showed mixed timings and was dropped.

The production Chromium gate initially timed fixture generation alongside
conversion. Its hosted ratios were 1.21× and 1.19× against 1.25×. Preparing
the same inputs outside the timers isolates production conversion. With
that harness, a paired local run measured 247.4 → 225.1 ms sequential and
112.7 → 97.2 ms pooled after the contour change. The hosted gate was still
sensitive to worker coordination. The batch quantization worker now seeds,
refines, and labels in one request. This removes intermediate messages
through the renderer while preserving overlap between quantization and
contour assembly. The follow-up local run measured 218.0 ms sequential and
75.9 ms pooled (2.87× against the unchanged 1.50× floor).

## Reproduce

From the repository root, run this in PowerShell:

```powershell
$env:BENCH_LABEL = "local"
$env:SVGX_PHOTO_BASELINE = "photo-color-332c669-before.json"
npm exec --no -- vitest run --config benchmarks/vitest.config.ts benchmarks/photoColor.test.ts
```

The harness writes `results/photo-color-local.json` and checks the output
against the captured baseline. The [baseline](photo-color-332c669-before.json)
was recorded on commit `332c669` with the previous contour implementation. The
[updated run](photo-color-boundary-after.json) contains the shipped contour walk.

## Bézier fitting follow-up

An additional V8 CPU profile sampled three warmed fitted assemblies per
image. On the still-life, cubic evaluation and least-squares generation
accounted for about 23% of sampled time together. Chord parameterization,
polyline length recomputation, and recursive fitting accounted for another
10%. The fitted boundary code also fully simplified each chain before
discarding the simplified points whenever it fitted a curve.

The fitter now measures each chord once and solves contiguous index ranges
over the source points. It reuses one parameter buffer and emits commands in
source order without building and concatenating recursive result arrays.
Cubic evaluation shares the same weights across the two coordinates.
Fitted color chains check whether the original chord exceeds the tolerance
before choosing the existing fit. Straight chains and shared-boundary
reversal keep the same command sequence.

| Input | Fitted assembly before → after | Fitted color trace before → after |
| --- | ---: | ---: |
| Generated still-life | 557.0 → 455.8 ms | 775.4 → 675.4 ms |
| USDA fresh produce | 444.3 → 356.1 ms | 620.8 → 567.8 ms |
| USFWS hummingbird | 227.1 → 194.8 ms | 395.6 → 334.7 ms |

The three polygon outputs and three fitted outputs matched in unrounded
`VectorDocument` geometry, serialized SVG, rasterized RGBA, and path count.
The [before](photo-color-746f67b-bezier-before.json) and
[after](photo-color-bezier-after.json) reports use the same settings and
Windows host as this follow-up.

To reproduce this comparison, set `SVGX_PHOTO_BASELINE` to
`photo-color-746f67b-bezier-before.json` and run the command above.
`SVGX_PHOTO_HASH_ONLY=1` runs the fidelity checks without timing.
Set `SVGX_PHOTO_PROFILE_DIR` to an existing directory to record V8 profiles
outside the timed runs.

The separate Chromium batch gate uses polygon output. It warms both
production worker schedules before timing and compares six batches in each
schedule, alternating which one runs first. Heap sampling includes pooled
worker startup. CI logs the individual samples and retains its prior
throughput and heap limits.

## Cubic evaluation and validation

A fresh baseline at `d9e3250` attributed 11–12% of fitted assembly samples
to cubic evaluation and another 7–8% to the sampled curve-to-polyline check.
Residual evaluation recalculated powers already computed by the least-squares
solver. Validation recalculated the weights at the same 17 parameter values
for each accepted candidate and repeatedly called `Math.hypot` during the
segment search.

Residuals now reuse weights computed during the solve, with the original
arithmetic order preserved in both passes. The 17 validation samples reuse
precomputed weights. The segment search compares squared distances and uses
the original `Math.hypot` comparison near the tolerance boundary. The sample
positions, envelope, error limit, and splitting rules stay the same.

| Input | Fitted assembly before → after | Fitted color trace before → after | Trace time saved |
| --- | ---: | ---: | ---: |
| Generated still-life | 512.6 → 436.6 ms | 726.2 → 655.2 ms | 9.8% |
| USDA fresh produce | 399.7 → 336.2 ms | 579.5 → 523.7 ms | 9.6% |
| USFWS hummingbird | 211.1 → 190.1 ms | 349.7 → 318.0 ms | 9.1% |

The [before](photo-color-d9e3250-cubic-before.json) and
[after](photo-color-cubic-after.json) reports contain the paired Windows
measurements. All six comparisons matched in unrounded `VectorDocument`
geometry, SVG bytes, rendered RGBA bytes, and path count. A separate
differential run matched all 8,192 direct fitter comparisons with the
baseline, covering open and closed chains, repeated points, several
coordinate scales, and tolerances from 0.05 to 1.25 pixels.

To reproduce the comparison with the command above, set
`SVGX_PHOTO_BASELINE` to `photo-color-d9e3250-cubic-before.json`.

## Least-squares weights

V8 profiles of the same images at `a8dddf3` put 11.5–12.6% of
fitted assembly samples in the cubic solve. The solver rebuilt Bernstein
weights for every candidate, including split ranges with the same normalized
chord lengths. Color contours walk consecutive horizontal or vertical
one-pixel steps. For a range of that kind, cumulative chord lengths are exact
integers, so the normalized parameters are determined by the edge count.

The fitter caches weights lazily for spans of 2–64 unit chords. Longer
unit-chord spans calculate the same parameters in a scratch buffer.
Chains with nonuniform spacing retain cumulative chord-length
parameterization. Both passes preserve their multiplication and summation
order. The per-worker cache holds about 100 KiB of weight data when full.

| Input | Fitted assembly before → after | Fitted color trace before → after | Trace time saved |
| --- | ---: | ---: | ---: |
| Generated still-life | 428.1 → 338.5 ms | 683.5 → 580.2 ms | 15.1% |
| USDA fresh produce | 342.5 → 270.7 ms | 525.5 → 449.4 ms | 14.5% |
| USFWS hummingbird | 186.9 → 144.4 ms | 317.4 → 285.2 ms | 10.1% |

Across the three profiles, the solver and weight-building code went from
378 to 181 self samples over three warmed assemblies per image. All
six polygon and fitted outputs matched in unrounded vector geometry,
SVG bytes, rendered RGBA bytes, and path count. Another 8,192 direct
baseline comparisons matched exactly on open and closed chains with
unit, mixed, and nonuniform spacing, including spans beyond the cache limit.

The [before](photo-color-a8dddf3-solve-before.json) and
[after](photo-color-solve-after.json) reports contain the paired measurements.
To reproduce the comparison above, set `SVGX_PHOTO_BASELINE` to
`photo-color-a8dddf3-solve-before.json`.
