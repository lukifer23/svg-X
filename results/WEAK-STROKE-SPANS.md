# Weak-stroke tracing on archival scans

This report records the original qualification. The
[loop recheck](LOOP-RECHECK.md) audits the nine misses using the source
scans and records the follow-up measurements separately.

The heating-trench upper rail was connected in the extracted and cleaned
ink masks. During thinning, its weak two-pixel diagonal staircase
repeatedly appeared to be a cardinal tip. The strong-ink-only guard let
successive passes peel it back until the west anchor disappeared. The
scan-lighting route now checks for continued bilateral contrast along
the original diagonal before deleting that tip. The check retains ink
already present in the cleaned mask and adds no bridge pixels. The
reviewed rail is connected, both nearby gaps have two detectable anchors
and stay open, and its reviewed paper box stays blank.

The ironwork middle crossing has a continuous route in the production
SVG. The original review corridor ran above the center of the line at
the bend near x=26 and excluded the connecting pixels. The regression
test follows the visible center through the bend and confirms the
original and new trace both connect. The prior model reports keep their
original reference and scores.

## Independent sheets

The two qualification sheets were outside the restoration training data
and were different from the heating and ironwork crops used to diagnose
the failures. The [reference manifest](../tests/fixtures/qualification/weak-span-references.json)
records the source and fixture hashes, reviewed loop polygons, gap
corridors and paper boxes. Sharp resampled both original TIFFs to
2,000 pixels along the longer side with its default kernel, then wrote
quality-93 JPEGs with 4:4:4 chroma. [North cellar trench plan](https://www.loc.gov/item/2022642694/) ·
[Ornamental ironwork sheet](https://www.loc.gov/pictures/item/2022639421/)

The benchmark scores the rasterized SVG, with a 0.55 intersection-over-union
threshold for loop interiors. It distinguishes an open gap with both
anchors present from a gap with a missing anchor. For speed, it takes the
median of 15 traces after five warmups on the Ryzen 5 7535HS. Decode and
rasterization are outside the timed section. Production is commit
`8fa2670`.

| Scan                | Working width | Matched loops before → after | Median trace before → after |
| ------------------- | ------------: | ---------------------------: | --------------------------: |
| North trench        |      1,000 px |                    1/4 → 1/4 |              69.5 → 62.6 ms |
| North trench        |      2,000 px |                    2/4 → 2/4 |            251.4 → 226.6 ms |
| Ornamental ironwork |      1,000 px |                    4/6 → 4/6 |              61.4 → 58.6 ms |
| Ornamental ironwork |      2,000 px |                    4/6 → 4/6 |            223.1 → 219.8 ms |

Both versions matched the same 11 of 20 loop checks. All 10 assessable gap
checks stayed open, and the other two each had a missing anchor. All 12
paper boxes across the four runs stayed blank. The heating-rail fix
improved an open stroke on the diagnostic crop. The independent sheets
showed no additional loop recovery.
[Fresh sheets before](weak-span-fresh-before.json) ·
[Fresh sheets after](weak-span-fresh-after.json)

On the established seven-sheet suite, both versions recovered 18 loop
checks, preserved the same 13 open gaps and 56 ink checkpoints, and
drew 179 pixels across the same paper zones. Median trace time across the
sheets went from 57.1 to 53.5 ms at 1,000 px and from 220.0 to 207.7 ms at
2,000 px. These measurements check for slowdown on the test machine.
[Existing suite before](archival-weak-spans-before.json) ·
[Existing suite after](archival-weak-spans-after.json)

```powershell
npm run test:archival
$env:SVGX_WEAK_SPAN_RECORD = 'artifacts/weak-spans'
npx vitest run --config benchmarks/vitest.config.ts benchmarks/weakStrokeQualification.test.ts
```

Use `SVGX_WEAK_SPAN_BASELINE=1` with a report destination when recording
the production checkout with the same fixtures and benchmark. Use a
separate destination for the candidate measurement.
