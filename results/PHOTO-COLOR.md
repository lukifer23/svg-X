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

The production Chromium batch benchmark recorded 203.8–206.5 ms pooled and
303.7–325.2 ms sequential across two local runs. The first throughput ratio
was 1.47× and the second was 1.60× against the unchanged 1.50× floor. Pooled
time stayed nearly steady across the runs.

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
