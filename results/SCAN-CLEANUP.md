# Scan cleanup measurements

Centerline cleanup now considers raster evidence before dropping a mark.
Small connected components survive when they contain strong ink. The same
confidence check, combined with measured cross-stroke width in the original
raster, protects narrow tips during thinning and short-spur cleanup. Weak
marks still have to satisfy the configured size and length limits before
removal. A value of zero disables cleanup.

The comparison starts at `934e284`. Both runs used the same input hashes,
threshold of 128, and default suppression of two pixels, on a Windows
AMD Ryzen 5 7535HS with Node 24.19.0. Times are medians of 15 warmed traces and
exclude decoding, serialization, and UI. The raw reports also include cubic
output, which was faster on all three archived scans.

| Input                                         | Polygon trace before → after | Accuracy or detail before → after                                                                         |
| --------------------------------------------- | ---------------------------: | --------------------------------------------------------------------------------------------------------- |
| Known fine strokes with equal-size weak grain |               0.10 → 0.07 ms | Mean reference-to-trace distance 0.279 → 0.000 px. Both fine marks preserved and both weak marks omitted. |
| Mechanism artwork with injected grain         |             51.80 → 30.45 ms | 339 paths and 40 cycles in both runs. Noisy trace agreement with clean trace stayed at 95.8%.             |
| Wright aircraft scan                          |               1.93 → 1.72 ms | 87.68% → 87.68% nearby-ink coverage. Four cycles retained.                                                |
| Dayton Velocipede scan                        |               3.37 → 1.74 ms | 79.33% → 80.53% nearby-ink coverage. All 33 cycles retained.                                              |
| Marconi wireless telegraphy scan              |               2.10 → 1.41 ms | 92.38% → 92.51% nearby-ink coverage.                                                                      |

For the calibration artwork, reference lines and the noise marks are known.
For the archives, nearby-ink coverage asks how many thresholded ink pixels
are within a one-pixel neighborhood of a rasterized trace. It includes both
real ink and noise and does not identify the intended centerline. All
traced pixels on the three archives had nearby source ink in both runs.
Dark grain that is indistinguishable from detail can survive. A faint stroke
that never crosses the foreground threshold still requires a threshold
adjustment or a better scan.

The archived artwork fixtures come from public-domain National Archives
records published by DocsTeach. The Velocipede and Marconi assets are the
250 × 250 site previews converted from JPEG to PNG at their supplied size.
[Wright](https://docsteach.org/document/flying-machine-wright-brothers/),
[Velocipede](https://docsteach.org/document/drawing-of-velocipede/),
[Marconi](https://docsteach.org/document/patent-drawing-for-g-marconis-wireless-telegraphy/).

Reproduce with `npm run bench:centerline`. Raw samples and hashes are in
[before](centerline-934e284-scan-before.json) and
[after](centerline-scan-after.json).
