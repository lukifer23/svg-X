# Color batch worker throughput

The [original hosted job](https://github.com/lukifer23/svg-X/actions/runs/45330995043/attempts/1)
measured 1.17× throughput on the eight-image Color fixture, below its
1.25× floor. The unchanged commit measured 1.53× on the
[rerun](https://github.com/lukifer23/svg-X/actions/runs/45330995043/attempts/2).
The pooled samples in the failed job ranged from 57 to 104 ms. The
hosted logs record elapsed time and heap, so they cannot identify an
individual scheduling event.

The old batch path used two independent queues. A quantization worker
took a private RGBA copy and returned labels to the renderer. The
renderer then dispatched those labels to the vector pool for tracing
and export. The browser created four quantization workers and three
vector workers under the benchmark's four-logical-CPU profile. That
handoff allowed both pools to compete for CPU on short batches. The
renderer also blended every raw pixel over white, including opaque pixels.

Each batch image now runs in one vector worker from quantization through
serialization. The existing pool caps parallelism across files. Raw RGBA
normalization retains an owned buffer for transfer and blends only pixels
whose alpha requires it. Interactive Color still uses band workers for
large images. The benchmark verifies the worker count and exact serialized
SVG equality for the warmed serial and pooled batches.

## Measurements

These Windows Chromium measurements used a Ryzen 5 7535HS with the
test process constrained to four logical processors. The paired runs
alternated the old and new implementations on identical inputs.
They timed conversions after preparing the input copies.

| Eight-image workload                                   |    Sequential median |    Pooled median |
| ------------------------------------------------------ | -------------------: | ---------------: |
| Four-color grid, nine trials per route                 |     137.2 → 121.8 ms |   86.4 → 71.4 ms |
| Four artwork and photo fixtures, five trials per route | 1,347.3 → 1,383.5 ms | 778.5 → 801.4 ms |

The grid batch took 17% less time in the paired run. The mixed workload
used fitted paths and SVG optimization, and its pooled median was 3%
higher in this run. All paired SVGs were byte-identical, including the
RGBA bicycle and the three photo fixtures. The browser export test
also checks exact SVG, EPS, DXF, and JSON parity on the produce photo.

The independent regression test passed all ten runs at the unchanged
1.50× local floor. Across-run pooled medians dropped from 92.5 ms on
production to 70.4 ms. The observed ratios were 1.50–1.66× before and
1.56–1.92× after. Peak measured heap growth was at most 61.5 MiB in
the ten new runs, below the 256 MiB ceiling. The hosted floor stays at
1.25×. [Raw timings and SVG hashes](color-batch-workers.json)

## Reproduction

Run the same checkout and browser on the same hardware. The report
uses `f745e54` as the production baseline.

```powershell
npm run test:e2e:performance -- --repeat-each=10
npm run test:e2e:web:functional -- --grep "batch and interactive color"
```
