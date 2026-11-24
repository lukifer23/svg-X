# Fitted Color batch throughput

The earlier five-trial comparison measured an eight-image pooled batch at
778.5 ms before the worker consolidation and 801.4 ms after it. In a fresh
12-trial comparison, the unmodified consolidated worker finished ahead of the
split worker, 838.2 ms versus 844.0 ms. The earlier timings overlap and do not
isolate a scheduling change. Both comparisons and their raw samples are
recorded. [Earlier measurements](COLOR-BATCH-WORKERS.md)
[New samples and output hashes](fitted-photo-batch.json)

## Where the time went

CPU sampling on the four working-size fixtures attributed 27–30% of compact
SVG serialization time to coordinate formatting, excluding inspector overhead.
Fitted paths repeatedly converted rounded decimal coordinates to strings.
The serializer also inspected the leading character of assembled candidate
segments, which forced the engine to flatten concatenated strings before it
chose between absolute and relative commands.

The serializer now reuses the 1,000 possible fractional suffixes at the
existing three-decimal precision and determines separators from coordinate
signs. Both candidate encodings still compete by byte length under the same
float32 and float64 reconstruction checks. The curve validation experiment
tried the corresponding unit edge before searching the full polyline. Its
pooled timings failed to show a consistent gain, so the shipped change
keeps the original fitter.

At a 1,000 px working limit, paired Node runs against the same documents
took 39–41% less time to serialize compact SVG. Each fixture used 16 warm
trials per version with alternating order and exact SVG comparison.

## Eight-image browser batch

Each trial converted the bicycle illustration, still-life, USDA fresh produce,
and USFWS rufous hummingbird twice. Chromium decoded and resized the images
to 640 px wide with a minimum height of 400 px. Settings used eight colors,
Fitted Bézier, and Optimize SVG. The test used the actual content-only batch
route with three conversion workers on Windows and a Ryzen 5 7535HS. The
browser and benchmark inherited a four-logical-CPU process affinity. It warmed
all routes and rotated route order and serial/pooled order across 12 trials
per route. Timing started after preparing the independent RGBA buffers.

| Worker route                   | Sequential median | Pooled median |
| ------------------------------ | ----------------: | ------------: |
| Split worker, `f745e54`         |        1,372.9 ms |      844.0 ms |
| Consolidated worker, `7676976`  |        1,395.4 ms |      838.2 ms |
| Revised SVG serialization      |        1,323.4 ms |      761.4 ms |

The pooled batch took 9.2% less time than `7676976` and 9.8% less time
than the split route. The new serializer won 11 of 12 paired pooled rounds
against `7676976` and 10 of 12 against the split route. All SVG strings
matched byte for byte on every route and trial. The four SHA-256 digests
also matched those from the earlier five-trial run.
[Timing samples and output hashes](fitted-photo-batch.json)

## Profiling and regression checks

Run the photo benchmark with an existing profile directory to sample
quantization, merging, assembly, and compact serialization on the same four
fixtures at a 1,000 px working limit.

```powershell
$env:SVGX_PHOTO_WORKING_SIZE = "1"
$env:SVGX_PHOTO_PROFILE_DIR = (New-Item -ItemType Directory -Force artifacts/photo-profile).FullName
npm run bench:photo
```

Run `npm run test:e2e:performance` for the separate four-color throughput and
heap gate. The gate uses the production worker scheduler and its own fixed
grid workload.
