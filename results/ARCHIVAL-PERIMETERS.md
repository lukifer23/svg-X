# Relay terminal and Photophone receiver perimeter

The relay's lower corner was open in the ink mask before thinning.
A 16 × 16 tile in the corner estimated paper at 144 on an eight-bit scale.
Its bracketing tiles supported 234. The revised estimator corrects a deep
local dip when lighter tiles bracket it along a horizontal or vertical
axis. The wider scan-lighting pass still analyzes the original working grid.

The Photophone receiver circumference was present in the skeleton. Its
leader lines cross the ring, so graph traversal stopped each emitted SVG
subpath at a junction. The new pass recognizes circular perimeter edges
by following exterior faces in a copy of the graph. It emits the ring
as one closed subpath and keeps the original leader edges. The perimeter
test confirms exact edge preservation at zero geometric tolerance.

## Accuracy at the 2,000-pixel limit

| Reviewed region | Before IoU | After IoU |
| --- | ---: | ---: |
| Bell relay lower terminal | 0.050 | 0.859 |
| Photophone receiver, one closed subpath | 0.000 | 0.861 |
| Fresh Bell relay lower terminal | 0.077 | 0.755 |
| Fresh Edison meter chamber | 0.938 | 0.938 |

The Photophone source is 1,024 pixels wide and runs at its native size.
The ordinary full-trace enclosure score stays at 0.337 because the
original leader lines and perforations subdivide the ring. Scoring the
closed subpath separately compares its actual circumference with the
hand-marked reference. The complete drawing still includes the crossing
lines and its internal detail. All reviewed 2,000-limit gaps stayed open,
all previously detected ink checkpoints stayed detected, and no sampled
paper box gained traced pixels. The fresh drawings come from
the Library of Congress and the National Archives and were tested with
their existing ink, paper, and scan artifacts.
[Bell relay drawing](https://www.loc.gov/item/magbell.29500163/) ·
[Edison meter drawing](https://docsteach.org/document/patent-drawing-for-t-a-edisons-electric-meter/)

The paired reports use the same RGBA input hashes and annotations. Each
timed run uses 20 traces after five warm-ups on Windows and Node 24.19.0.
The timings exclude decode and scoring. Thinning now visits foreground
indices instead of rescanning blank portions of rows. Its synchronous
deletion rules stay the same.

| Scan at the 2,000-pixel limit | Median before → after | p95 before → after |
| --- | ---: | ---: |
| Photophone | 49.5 → 36.0 ms | 54.1 → 37.2 ms |
| Telephone | 336.8 → 252.2 ms | 345.5 → 254.4 ms |
| Multiple Telegraph | 380.6 → 281.1 ms | 394.7 → 291.0 ms |
| Bell optical sketch | 303.4 → 208.9 ms | 309.8 → 217.9 ms |
| Bell relay | 260.8 → 198.8 ms | 265.5 → 203.6 ms |
| Fresh Bell relay | 308.1 → 209.6 ms | 345.3 → 214.8 ms |
| Fresh Edison meter | 478.3 → 309.9 ms | 498.8 → 314.6 ms |

Run `npm run test:archival` to reproduce the quality gate.
[Baseline `f879e9d`](archival-perimeter-before.json) ·
[Updated raw results](archival-perimeter-after.json)
