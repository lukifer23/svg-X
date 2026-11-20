# Faded curve and loop repair

Lighting recovery already rejoined some straight fragments, but only
between separate connected components. Severe fading also erodes bends
into short gaps that no longer satisfy the straight-ridge detector. After
thinning, the curve repair pass inspects facing endpoints on nearby
strokes and tests short cubic continuations, including links that close
an existing component into a cycle.

Each proposed bridge spans at most 12 working pixels. Every inserted
pixel needs scan contrast and most must be darker than both flanks.
Endpoints must choose one another with a clear lead over alternatives.
Bridges must also clear other skeleton strokes. A missing arc with
insufficient remaining ink stays open. The pass runs only when
**Recover faded scan lines** is enabled.

## Before and after

The baseline is production revision `447d9eb`. Both runs used the same
pixel hashes, enabled lighting recovery, and measured 15 traces after
five warm-ups per case on Windows, Node 24.19.0, and an AMD Ryzen 5
7535HS. The medians exclude decode, SVG serialization, and UI.

| Input                                      | Cycles before → after | Open tips before → after | Median trace time |
| ------------------------------------------ | --------------------: | -----------------------: | ----------------: |
| Three calibrated faded curves, two nested  |                 0 → 3 |                    8 → 0 |    2.34 → 2.41 ms |
| Close parallel strokes                     |                 0 → 0 |                    4 → 4 |    2.44 → 2.45 ms |
| Faded mechanism artwork, 1000 px           |                 3 → 4 |                306 → 256 |  69.86 → 72.12 ms |
| Wright archival scan with added fading     |                 2 → 2 |                196 → 164 |    3.56 → 3.88 ms |
| Velocipede archival scan with added fading |                 1 → 1 |                307 → 295 |    3.15 → 3.38 ms |
| Marconi archival scan with added fading    |                 1 → 1 |                183 → 183 |    3.09 → 3.21 ms |

The calibrated curves retained three distinct paths, including both
nested loops. Mean source-to-trace distance improved from 0.442 to
0.332 px and one-pixel reference coverage increased from 96.4% to
100%. Both the erased-arc control and the blank shadowed paper control
reject evidence-free connections. The junction case retained its
expected topology.

The scans are real archival drawings, tested untouched and with seeded
fading, shadow, and grain added. On the faded Wright and Velocipede
inputs, reference coverage increased from 74.9% to 75.9% and from
70.8% to 70.9%. The share of traced pixels near the clean reference fell
from 79.7% to 78.9% and from 60.1% to 59.7%. Marconi was unchanged on both
measures. These are proxy metrics using the original scan traces,
which may omit real detail. The raw Wright and Velocipede runs each
gained one detected cycle, but the scans have no topology labels.
The faded mechanism recovered only four of the 40 cycles seen in
its clean trace.

Reproduce with `npm run bench:scan-lighting`. The report records
[baseline and input hashes](scan-lighting-447d9eb-loops-before.json) and
[after measurements](scan-lighting-loops-after.json). Scan provenance is
in the [scan cleanup report](SCAN-CLEANUP.md).
