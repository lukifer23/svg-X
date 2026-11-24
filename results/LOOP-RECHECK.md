# Archival loop recheck

This report preserves the earlier results. The
[medallion qualification](MEDALLION-RECOVERY.md) follows up on the three
remaining checks.

The original [weak-stroke qualification](WEAK-STROKE-SPANS.md) reported
nine misses. We compared the master-derived scans, extracted ink,
skeletons, repaired skeletons, and rasterized SVG. The timing and
geometry baseline is production at `294d537`.

| Original misses                                  | Diagnosis                                                                                                                                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upper west trench and first west tie, both sizes | The source outlines and production traces already close. The original polygons were offset from the line center. The revised polygons follow the visible ink and verify all four checks on production.           |
| North-trench diamond, 1,000 px                   | The detector missed a one-pixel diagonal next to an attached arm. The interior leaked into an adjacent face.                                                                                                     |
| Ornamental medallion center, both sizes          | Normal flank sampling reached the adjacent ring at several points and rejected the actual ink ridge.                                                                                                             |
| Ornamental medallion inner frame, both sizes     | The frame bounds several small faces, so the largest enclosed face is a poor proxy for the perimeter. A narrow corridor around the visible frame still shows that its own closed route is missing at both sizes. |

The foreground repair now accepts a one-pixel diagonal interruption
when both anchors support the same direction, the same component
already connects them, the gap stays clear of other components, and
one flank is paper with visible ink through the gap. The ridge detector
also checks closer flanks when the normal sample hits a nearby stroke.
It requires a visible valley between the two ridges, a near-paper point
on the opposite side, and the existing longitudinal support.
The closer-flank rule runs at working sizes of at least 1,000 pixels.
Applying it to the 250-pixel Velocipede crop closed the gap between the
frame and its annotation leader, where the valley spans only one
native pixel.
The repair passes reuse the foreground anchor list and skip blank pixels.

The corrected references use the same 0.55 enclosed-region IoU cutoff.
For the partitioned frame, the benchmark retains only actual SVG ink
near the reviewed outline before measuring closure. That test still
reports the frame open. The previous reports retain their original
scores.

With the corrected references, the original two sheets went from
15 to 17 matched loop checks out of 20. At 1,000 px the diamond
rose from 0.39 to 0.86 IoU and the medallion center from 0.29 to
0.63. The medallion center at 2,000 px improved from 0.26 to 0.48,
below the 0.55 cutoff. The separately scored inner frame remained
open at both widths.

## Additional scans

The same production and candidate tracers ran on two previously unused
sheets. The [holdout manifest](../tests/fixtures/qualification/loop-holdout-references.json)
records source TIFF and derivative hashes, loop contours, gap probes,
and paper controls. As in the prior benchmark, the fixtures are
2,000-pixel Sharp derivatives of the master TIFFs with quality-93
JPEG encoding and 4:4:4 chroma. [Boiler fronts](https://www.loc.gov/item/2022642685/) ·
[Cellar guards](https://www.loc.gov/item/2022636995/)

The preselected features on the new sheets kept their eight matches
across 16 checks. A separate inspection of changed regions found that
the 1,000-pixel boiler-front bevel closes where production leaves its
left corner open. Review against the original scan confirmed the
outline. That added inspection scored 0.00 to 0.79 IoU at 1,000 px.
It was selected after looking at the trace differences and is reported
separately from the preselected checks.

Across the four sheets and both sizes, all 12 assessable gap checks
stayed open. The other eight lacked at least one anchor. All 24
reviewed paper boxes remained blank.

| Scan                | Median trace at 1,000 px | Median trace at 2,000 px |
| ------------------- | -----------------------: | -----------------------: |
| North trench        |           63.3 → 64.5 ms |         229.2 → 229.9 ms |
| Ornamental ironwork |           60.7 → 60.0 ms |         225.4 → 228.4 ms |
| Boiler fronts       |           60.4 → 60.7 ms |         221.0 → 217.7 ms |
| Cellar guards       |           65.1 → 66.7 ms |         249.6 → 248.4 ms |

Every measured median on these sheets stayed within 3% of production on
the Ryzen 5 7535HS. Some individual medians increased.
[Before report](loop-recheck-before.json) ·
[After report](loop-recheck-after.json)

On the established seven-sheet suite, both versions recovered 18 loop
checks and kept 13 measured gaps open, with the same 179 stroke pixels
in the reviewed paper regions. Across those sheets, the median trace
increased from 53.4 to 54.9 ms at 1,000 px and from 198.9 to 208.4 ms
at 2,000 px on this run.
[Established suite before](loop-recheck-archive-before.json) ·
[Established suite after](loop-recheck-archive-after.json)

Run `npm run test:archival` to check the three recovered loops, preserve
the baseline matches, and check gap and paper controls. For warmed
timing, set `SVGX_WEAK_SPAN_RECORD` to an output prefix and run
`benchmarks/weakStrokeQualification.test.ts` with the benchmark Vitest
config. The report uses 15 trace-only samples after five warmups per
image and size.
