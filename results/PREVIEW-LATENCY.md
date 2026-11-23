# Production upload-to-preview benchmark

Run `npm run bench:preview` on an otherwise idle machine. The command
builds the production bundle and uses Chromium to upload the four checked-in
color fixtures through the real file input. Each fixture runs in polygon mode
at the 1,000- and 2,000-pixel working limits. The USDA photograph also runs
with fitted curves at both limits. A source shorter than the selected limit
keeps its original dimensions.

The timer starts at the file input's change event. It ends when the SVG
preview image has decoded and two animation-frame callbacks have passed.
The report stores the first upload per reloaded case and the median of three
warm uploads. Processing Logs supply decode and resize, quantization, trace,
serialization, optimization, and conversion wall time. Parallel quantization
is measured as elapsed time including worker coordination. The phase medians
can come from different samples.

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
Set `BENCH_LABEL` to name a new report. Set `SVGX_PREVIEW_BASELINE` to an
existing report filename to require exact fidelity on the same Chromium
and fixture settings.

## Next measurements

Measure browser process and worker memory with large compressed uploads.
Then isolate the remaining fitted-photo latency across geometry transfer
and image presentation. The dense SVG remains the baseline for a separate
lossless file-size pass. Native batch export formats and failure-report
export continue as separate product changes after this browser pass.
