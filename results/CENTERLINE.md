# Centerline tracing measurements

The comparison uses the centerline and cubic-fit source at `2e58b7c` and the
updated production source. Both runs used the same input pixel hashes and
settings on Windows, Node 24.19.0, and an AMD Ryzen 5 7535HS. Each case and mode
had five warm-ups and 15 timed traces. Median times exclude image decoding,
SVG serialization, UI rendering, and IPC.

| Input                                    | Polygon before → after | Cubic before → after |
| ---------------------------------------- | ---------------------: | -------------------: |
| Close parallel strokes                   |         1.59 → 1.40 ms |       1.34 → 1.12 ms |
| Junction drawing                         |         1.27 → 1.32 ms |       1.62 → 1.51 ms |
| Isolated and attached loops              |         1.57 → 1.38 ms |       1.78 → 1.55 ms |
| Calibration drawing with simulated grain |         2.14 → 2.08 ms |       2.46 → 1.88 ms |
| Mechanism artwork, 1000 px               |       77.06 → 52.70 ms |     86.86 → 60.25 ms |
| Mechanism artwork with simulated grain   |       96.48 → 54.03 ms |    108.81 → 62.14 ms |
| Archived patent scan, 298 × 196 px       |         2.91 → 2.02 ms |       3.12 → 2.35 ms |

The calibration drawings have independently known vector geometry. Both
output modes preserve the clean parallel, junction, and loop topology. The
noisy calibration's trace-to-reference mean distance fell from 5.540 to
0.292 px for polygons and from 5.396 to 0.353 px for cubics. The reverse
mean distance stayed near 0.04 px. The default cleanup still left 17 tips
against five in the clean reference, down from 473. It preserves both loops.

The mechanism artwork has no labeled centerlines. Its clean trace provides a
reference for sensitivity to injected grain. Comparing one-pixel SVG stroke
masks with a one-pixel neighborhood, 56.7% of the noisy polygon trace and
55.3% of its cubic trace matched the clean trace before the change. These
rose to 95.8% and 96.1%. All clean trace pixels had a nearby noisy trace
pixel in both revisions. The noisy artwork produced 339 paths after cleanup,
down from 5,455, and retained all 40 detected cycles.

The archived scan is a public-domain National Archives raster preview
published by DocsTeach. The fixture converts the downloaded JPEG to PNG at
its native preview resolution. It contains aging marks and fine printed
detail. There is no authored centerline reference, so the report compares
one-pixel traces to thresholded source ink. With default cleanup, polygon ink
coverage within one pixel fell from 92.0% to 87.7%. All traced pixels still
had nearby ink, and all four detected cycles remained. Source ink includes
both real detail and scan debris. Use zero Speckle Suppression when preserving
tiny marks is more important than cleaning the image.
[Scan and rights record](https://docsteach.org/document/flying-machine-wright-brothers/)

Run `npm run bench:centerline` to repeat the benchmark. Raw samples, fixture
hashes, and accuracy measurements are stored in
[before](centerline-2e58b7c-before.json) and [after](centerline-after.json).
