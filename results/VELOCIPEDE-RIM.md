# Faded Velocipede front rim

The reference is the front rim on the unmodified Dayton Velocipede crop.
The hand-marked region follows the visible rim, including where it meets
the fork near the top. I checked that contact, marked eight positions on
the fork below it, and marked two blank paper boxes on zoomed views of the
source. Coordinates are in the [archival annotations](../tests/fixtures/review/archival-loop-references.json).
The faded input uses the existing seeded lighting, fade, and grain.

Timings compare `19c1f24` with the new tracer on identical RGBA inputs.
Each median uses 15 traces after five warm-ups on Windows and Node
24.19.0. Decode, export, and UI are outside the measurement.

| Measure | Before | After |
| --- | ---: | ---: |
| Faded rim enclosure IoU with all traced strokes | 0.000 | 0.948 |
| Faded rim enclosure IoU of one closed SVG subpath | 0.000 | 0.964 |
| Fork checkpoints present | 8/8 | 8/8 |
| Rim pixels inside the fork body below its contact | 0 | 0 |
| Traced pixels in the two nearby paper boxes | 0 | 0 |
| Median trace time, faded crop | 3.78 ms | 5.92 ms |
| Median trace time, original crop | 6.89 ms | 7.64 ms |

The isolated ring touches the existing fork trace inside the reviewed
contact box. Its geometry stays out of the fork body below that contact.
The untouched crop's rim enclosure IoU held at 0.927. Erasing the
rightmost arc before fading leaves the rim open. The close-parallel,
grain, junction, and nested-loop controls still pass.

The per-pixel directional detector missed a long part of the rim because
its ink was too faint to seed individual line segments. The new pass fits
possible circles from existing curved fragments and follows the best
continuous ink in a narrow corridor. It limits the search to partially
traced, nearly circular strokes of radius 16 to 128 working pixels. The
pass adds tracing time even on some scans where it accepts no new loop.

Run `npm run bench:scan-lighting` to reproduce the analysis.
[Baseline samples](scan-lighting-19c1f24-rim-before.json)
[Updated samples](scan-lighting-rim-after.json)
