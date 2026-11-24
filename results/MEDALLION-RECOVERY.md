# Medallion recovery

The medallion has a straight inner frame, a nearly touching ring, and
spokes. The previous skeleton diverted into the adjoining linework at
several frame contacts. The outer rectangular contour stayed closed and
provided a bounded search area for the inner one. The repair locates
each inner side in the scan and requires existing stroke support,
continuous ink contrast, and visible flank evidence. It uses the
original pixels through the corners. Where no skeleton edge crosses a
crop boundary, the tracer rebuilds just the isolated area. Separate
insets can be retraced in separate crops.

At 2,000 px the source resolves two lines around the center. The inner
one has a bright inward flank, while the outward flank partly coincides
with the neighboring ring. The bounded circular search follows the
inner line using that inward flank and already traced arcs in all four
quadrants. It verifies original contrast along the entire recovered rim.
The full-resolution test uses a separately reviewed corridor for that
inner line. The original polygon stays in the benchmark and its score is
still available for comparison.

Production is commit `fce0fda`. The benchmark rasterizes the actual SVG.
It uses the same 0.55 enclosed-region IoU cutoff for the original checks
and the separately reviewed inner rim.

| Recovered outline       | Production IoU | Candidate IoU |
| ----------------------- | -------------: | ------------: |
| Inner frame at 1,000 px |           0.00 |          0.92 |
| Inner frame at 2,000 px |           0.00 |          0.95 |
| Inner rim at 2,000 px   |           0.00 |          0.88 |

The earlier full-resolution center polygon includes part of the outer
ring. Its score rose from 0.48 to 0.52. Both scores remain in the raw
reports alongside the new inner-rim check.

## Independent scans

The [new holdout manifest](../tests/fixtures/qualification/medallion-holdout-references.json)
records source TIFF hashes, derived JPEG hashes, manually reviewed loop
outlines, gap corridors, and paper boxes. The fixtures use the same
2,000-pixel Sharp resize, quality 93, and 4:4:4 chroma as the prior scans.
The new sheets stay reserved from restoration training.
[Boiler-room skylight](https://www.loc.gov/item/2012646482/) ·
[Roof ironwork](https://www.loc.gov/item/2022642742/)

The fresh sheets retained their 12 matched loops out of 16 checks at
1,000 and 2,000 px. All five assessable gaps stayed open, and all 12
reviewed paper boxes were blank. Three fresh gap checks lacked an
anchor. Across the six sheets, all 17 assessable gaps stayed open.
The regression test also checks the separation between the two
medallion frames at two locations and both widths.
[Before report](medallion-recovery-before.json) ·
[After report](medallion-recovery-after.json)

## Trace time

The scan preparer now interpolates paper tone with integer tile
fractions and walks only the relevant ridge offsets during
continuation searches. Separate checks against the previous
implementation found byte-identical contrast and ink masks on ten
archival inputs and nine boundary dimensions.

| Scan                 | Median trace at 1,000 px | Median trace at 2,000 px |
| -------------------- | -----------------------: | -----------------------: |
| Ornamental ironwork  |           58.5 → 58.1 ms |         234.7 → 220.1 ms |
| Boiler-room skylight |         116.6 → 116.0 ms |         397.4 → 387.2 ms |
| Roof ironwork        |           87.5 → 85.4 ms |         302.5 → 290.7 ms |

All 12 per-scan medians in the six-sheet run were below the preceding
production measurements on the same Ryzen 5 7535HS.

On the established seven-sheet suite, the median across drawings fell
from 55.0 to 49.6 ms at 1,000 px and from 205.9 to 187.3 ms at 2,000 px.
The suite retained all 18 loop matches and all 13 measured openings,
with the same 179 stroke pixels in its paper regions.
[Established suite before](medallion-archive-before.json) ·
[Established suite after](medallion-archive-after.json)

## Reproduction

`npm run test:archival` runs the geometry, gap, and paper checks. To
record timings, set `SVGX_WEAK_SPAN_RECORD` to a report prefix and
run `benchmarks/weakStrokeQualification.test.ts` with
`benchmarks/vitest.config.ts`. The report warms each input five times
and records 15 trace-only samples at each working width.
