# Centerline recovery at the 2,000-pixel limit

The thin-ridge screen used the same pixel geometry at both working
sizes. At 2,000 pixels, a flank could still be inside a wider stroke.
Grain also passed the same short run test. The Multiple Telegraph
receiver already had open corners in the native ink mask. Rendering
both SVGs at equivalent relative stroke widths left the regression
visible. The Telephone box also had an ink-backed break beside a
junction. Its endpoint had three usable tangent steps, one fewer
than the previous repair required.

The dense scan pass filters grain with a 3 × 3 binomial kernel and
scales ridge flanks and minimum run lengths on the full working grid.
A truncated tangent can qualify for a bridge only within eight
working pixels. Each sample needs local ink, with reciprocal
endpoint agreement and clearance from other strokes.

## Recovered geometry

| Reviewed region | Before IoU | After IoU | After IoU at matched stroke scale |
| --- | ---: | ---: | ---: |
| Telephone lower box face | 0.001 | 0.940 | 0.925 |
| Multiple Telegraph lower transmitter terminal | 0.005 | 0.915 | 0.899 |
| Multiple Telegraph receiver block | 0.019 | 0.967 | 0.975 |
| Fresh optical sketch aperture | 0.849 | 0.850 | 0.841 |
| Fresh telephone relay upper terminal | 0.685 | 0.753 | 0.736 |
| Fresh telephone relay lower terminal | 0.002 | 0.050 | 0.044 |

The original Telephone polygon is still scored. It spans two
source faces and scores 0.073 → 0.416 at 2,000 pixels. The separate
lower-face polygon follows the visible inner dividing line. The old
Multiple Telegraph checkpoints along y=338 fell below the bowed wire
on paper. The corrected points follow the wire itself. Two tentative
checkpoints on the fresh scans also landed on paper on zoomed review
and are counted as paper controls. Both recorded revisions use the
same revised annotations. The prior report remains available.

All five 2,000-limit gap probes stayed open, and all reviewed ink
checkpoints detected by the baseline stayed detected. Every paper
box held steady or lost traced pixels. The existing 1,000-pixel
geometry scores held steady, including the known horn-mouth gap
failure on that Telephone run. The fresh relay's lower terminal
and the Photophone receiver ring remain unmatched.

## Trace time

On the same Windows host with Node 24.19.0, each result uses 20 timed
traces after five warm-ups on identical RGBA inputs. Decode and
rasterized scoring are outside the timings. Photophone's source is
1,024 pixels wide. The two fresh scans were sourced from the
Alexander Graham Bell papers, resized to a 2,000-pixel longest
side, and tested with their existing paper and ink.
[Optical sketch](https://www.loc.gov/item/magbell.20500101/) ·
[Telephone relay](https://www.loc.gov/item/magbell.29500162/)

| Scan at the 2,000-pixel limit | Median before → after | p95 before → after |
| --- | ---: | ---: |
| Photophone | 48.4 → 47.3 ms | 53.3 → 48.3 ms |
| Telephone | 358.4 → 337.2 ms | 370.2 → 346.5 ms |
| Multiple Telegraph | 406.6 → 372.2 ms | 452.7 → 378.8 ms |
| Fresh optical sketch | 278.6 → 298.3 ms | 285.6 → 301.2 ms |
| Fresh telephone relay | 286.5 → 254.1 ms | 304.9 → 262.4 ms |

Run `npm run test:archival` for the Linux CI quality gate.
[Baseline `3e8b158`](archival-scale-before.json) ·
[Updated raw results](archival-scale-after.json)

The [relay and receiver follow-up](ARCHIVAL-PERIMETERS.md) measures the
subsequent lower-terminal repair and Photophone perimeter extraction.
