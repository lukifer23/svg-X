# Wide faded strokes and matched loop enclosures

The baseline is `74d5482`. Both runs used matching input hashes and 15
timed traces per case after five warm-ups on Windows and Node 24.19.0.
Timings exclude decode, export, and UI. The known archival images were
run untouched and with the same seeded lighting, fade, and grain.

The narrower ridge detector missed the interior of broad faded strokes.
The wider check requires ink in the closer flanks and a run of four
aligned broad candidates. A single-pixel cavity can be filled only if
surrounded by foreground on all four sides and supported by scan contrast.
Endpoint bridges may span up to 20 pixels and require stronger contrast
when checking the wider flanks.

The previous graph count and a true visual enclosure measure different
things. The new comparison rasterizes a one-pixel centerline, flood-fills
enclosed background regions, and matches them against the clean trace.
Regions smaller than four pixels are ignored. A match requires at least
65% intersection over union. Clean traces are a proxy for archival
geometry and can miss fine ink.

| Test                         | Reference coverage | Trace agreement |      Median time |
| ---------------------------- | -----------------: | --------------: | ---------------: |
| Faded mechanism, 1000 px     |      76.8% → 92.2% |   99.2% → 98.4% | 72.46 → 86.66 ms |
| Wright with added fading     |      75.9% → 77.1% |   78.9% → 78.7% |   3.92 → 4.14 ms |
| Velocipede with added fading |      70.9% → 71.1% |   59.7% → 59.1% |   3.47 → 3.77 ms |
| Marconi with added fading    |      91.2% → 91.2% |   81.8% → 81.8% |   3.24 → 3.51 ms |

The faded mechanism's graph cycle count rose from four to six. The
number of matched visible enclosures rose from one to five out of 40,
with all five recovered enclosures matching clean ones. The archival
faded variants did not gain a matched enclosure. The parallel, junction,
nested-curve, erased-arc, and paper-grain controls passed. These controls
bound the tested cases. They do not establish that every stroke on every
archive is correctly connected.

Reproduce with `npm run bench:scan-lighting`. See the
[before report](scan-lighting-74d5482-real-before.json) and
[after report](scan-lighting-real-after.json). Archival provenance is in
the [scan cleanup report](SCAN-CLEANUP.md).

The [archival follow-up](ARCHIVAL-LOOPS.md) scores Wright, Velocipede, and
Marconi against source-image annotations drawn by hand.
