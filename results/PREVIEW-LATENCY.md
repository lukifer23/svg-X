# Production upload-to-preview benchmark

Run `npm run bench:preview` on an otherwise idle machine. The command
builds the production bundle and uses Chromium to upload the four checked-in
color fixtures through the real file input. Each fixture runs in polygon and
fitted modes at the 1,000- and 2,000-pixel working limits. A source shorter than the selected limit
keeps its original dimensions.

The timer starts at the file input's change event. It ends when the SVG
preview image has decoded and two animation-frame callbacks have passed.
The report stores the first upload per reloaded case and the median of three
warm uploads. Processing Logs supply decode and resize, quantization, trace,
serialization, optimization, and conversion wall time. Parallel quantization
is measured as elapsed time including worker coordination. The phase medians
can come from different samples. Worker delivery is measured from before
preparing the completion message to receipt and deserialization in the main
thread. It includes the authoritative vector document and browser scheduling.
It does not measure Internet or LAN throughput.

The harness records the longest main-thread task during each upload. A zero
means the browser reported no task of at least 50 ms. Sampled JavaScript heap
growth is a Chromium diagnostic. Full process memory, decoded bitmap storage,
and worker memory require a separate measurement.

## Moving SVG optimization off the main thread

The baseline uses the current tracer with added timing instrumentation and
renderer-side SVGO. The update keeps the same SVGO configuration and lazily
loads the optimizer inside the vector worker. It posts the final SVG after the
worker completes or returns the serialized SVG if optimization fails. Cancel
can terminate optimization before it delivers a preview.

| Case | Limit | Preview ready before → after | Longest main-thread task before → after |
| --- | ---: | ---: | ---: |
| Bicycle polygon | 1,000 | 449 → 427 ms | 104 → 0 ms |
| Bicycle polygon | 2,000 | 527 → 561 ms | 139 → 0 ms |
| Still-life polygon | 1,000 | 520 → 495 ms | 126 → 0 ms |
| Still-life polygon | 2,000 | 681 → 673 ms | 163 → 56 ms |
| USDA produce polygon | 1,000 | 511 → 516 ms | 133 → 0 ms |
| USDA produce fitted | 1,000 | 798 → 809 ms | 319 → 70 ms |
| USDA produce polygon | 2,000 | 722 → 718 ms | 204 → 67 ms |
| USDA produce fitted | 2,000 | 1,114 → 1,180 ms | 430 → 107 ms |
| Hummingbird polygon | 1,000 | 308 → 288 ms | 75 → 0 ms |
| Hummingbird polygon | 2,000 | 402 → 350 ms | 98 → 0 ms |

The main thread stayed more responsive in every case. Preview completion
was mixed. The largest measured latency increase was about 6% on the fitted
USDA photo and high-limit bicycle. For fitted USDA at the higher limit,
sampled Chromium heap growth fell from 146.4 to 9.2 MiB. The optimized SVG
remained 6,701,721 bytes.

The [baseline](preview-latency-renderer-svgo-baseline.json) and
[worker run](preview-latency-worker-svgo.json) contain the exact timings,
machine details, file hashes, working dimensions, SVG sizes, and decoded
preview pixel hashes. All ten optimized SVGs and raster previews matched.
The historical reports cover ten cases.

## Compact Color SVG

The Color worker encodes the paths directly. It keeps the original coordinate
precision, palette, path order, and winding. It emits shorter path commands
where possible and uses relative cubic commands only from integer anchors
when the rounded controls reconstruct exactly in both single- and
double-precision arithmetic. The **Optimize SVG** setting controls this pass.
With it turned off the worker emits the original expanded markup.

For interactive Color jobs with optimization enabled, the worker sends the
export document as JSON text. The renderer reconstructs the document before
resolving the conversion. This replaces recursive cloning of the geometry
objects and preserves the geometry used by EPS, DXF, and JSON exports.

Paired medians on Windows, AMD Ryzen 5 7535HS, Node 24.19.0 and Chromium
159.0.8154.6. The baseline was `87fb8fe` with delivery timing and the
expanded benchmark matrix. Sizes are uncompressed decimal MB.

| Fitted case | Limit | SVG MB before → after | Worker delivery before → after | Preview ready before → after |
| --- | ---: | ---: | ---: | ---: |
| Bicycle | 1,000 | 3.24 → 1.80 | 88 → 62 ms | 646 → 459 ms |
| Bicycle | 2,000 | 4.74 → 2.55 | 127 → 85 ms | 898 → 608 ms |
| Still life | 1,000 | 4.24 → 2.38 | 106 → 86 ms | 784 → 555 ms |
| Still life | 2,000 | 6.17 → 3.34 | 180 → 108 ms | 1,130 → 788 ms |
| USDA produce | 1,000 | 4.56 → 2.60 | 124 → 90 ms | 817 → 578 ms |
| USDA produce | 2,000 | 6.70 → 3.73 | 172 → 124 ms | 1,201 → 799 ms |
| Hummingbird | 1,000 | 2.16 → 1.19 | 60 → 46 ms | 452 → 332 ms |
| Hummingbird | 2,000 | 3.23 → 1.73 | 93 → 62 ms | 688 → 375 ms |

Fitted SVGs were 43–47% smaller. Polygon SVGs were 70–73% smaller.
All 16 cases had identical decoded RGBA hashes. For the largest fitted
case, SVGO previously took 366 ms, and the new path encodes in one
serialization pass. Chromium recorded no main-thread task of at least
50 ms in the median warm sample, down from 99 ms.
The [baseline](preview-latency-color-encoding-baseline.json) and
[compact run](preview-latency-color-encoding-compact.json) include every
polygon sample, precise byte counts, timing, and fidelity hashes.

Set `BENCH_LABEL` to name a report. Set `SVGX_PREVIEW_BASELINE` to a
current 16-case report filename for an exact comparison on the same browser.
Set `SVGX_PREVIEW_ALLOW_REENCODING=1` for encoding changes. This still
requires matching input hashes, dimensions, options, and decoded RGBA hashes.
