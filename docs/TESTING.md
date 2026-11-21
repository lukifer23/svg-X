# Testing and acceptance

`npm run ci:check` runs formatting, lint, strict typechecking, all Vitest suites, asset verification, production build, and `npm run audit:deps`. The audit wrapper clears inherited user-level npm script allowlists while retaining the repository's package-scoped allowlist, then fails on moderate-or-higher advisories. `npm run test:e2e:web` exercises real production conversion workers in Chromium, Firefox, and WebKit, then runs the performance project separately with one Chromium worker so unrelated browser tests cannot distort the throughput gate. `npm run package:dir && npm run test:e2e:package` launches the unpacked Electron application with an isolated temporary profile, checks its local health endpoint and security headers, performs a real conversion, and shuts it down cleanly.

The deterministic corpus covers topology, holes, saddle cases, transparency, color labels, centerline endpoints/junctions/cycles, cubic error bounds, export commands, settings migration, exact origin validation, IPv4/IPv6 discovery, atomic filename collisions, and guaranteed packaged input formats. It also covers EXIF orientation on the desktop decoder, degenerate inputs (1×1, all-transparent, single-color, two-color), and exact equivalence between the single-threaded and band-parallel quantizers.

Native batch tests use the production run and real Sharp and filesystem operations. They cancel at three observed boundaries: after submitting an archival JPEG decode, after closing a fully written staging file, and after submitting an exclusive publication under a collision suffix. They check that the run drains, an unpublished file leaves no output, and a successful publication retains its exact bytes alongside the pre-existing file.

`npm run bench:pipeline` profiles every color stage on representative fixtures, verifies that each fixture's serialized-SVG SHA-256 is unchanged, and writes `results/pipeline-<label>.json`. The human summary and its methodology live in `results/PERFORMANCE.md`. `src/core/parallelQuantize.test.ts` proves the band-parallel quantizer produces bit-identical labels, palette, and SVG across two to eight bands.

Current absolute acceptance gates include:

- flat-color SSIM at least 0.95 and mean Delta E 2000 at most 2;
- B&W synthetic raster difference at most 1%;
- centerline mean distance at most 1.5 pixels;
- eight-image pooled throughput at least 1.5 times sequential throughput when the runner exposes at least three logical CPUs;
- browser heap growth below 256 MiB for that workload;
- cancellation followed by a successful recovery conversion;
- no serious or critical Axe findings in idle and converted flows.

The 1.5x throughput criterion is a release acceptance measurement and must be
run on controlled, otherwise-idle hardware with the same browser, fixture, and
four-logical-CPU profile used by `npm run test:e2e:performance`. GitHub's shared
Windows runners enforce a separate 1.25x regression floor through
`SVGX_MIN_BATCH_SPEEDUP`; that noisier signal catches a lost worker-pool benefit
but is not evidence that the 1.5x release criterion passed. The default remains
1.5x whenever the environment variable is absent.

The historical pre-recovery checkout failed before tests because its dependency install did not complete. Do not invent a relative speed or quality claim against it. A future released baseline must store hardware, fixture hashes, settings, raw timings, SSIM, and Delta E values before percentage comparisons become release gates.

The centerline corpus rasterizes vector calibration artwork with known stroke
geometry, then checks proximity in both directions and exact clean tip,
junction, and cycle counts. It also traces the raster mechanism artwork with
and without repeatable grain. Run `npm run bench:centerline` to record warmed
trace times with both polygon and cubic output. See
[Centerline results](../results/CENTERLINE.md) and
[scan cleanup results](../results/SCAN-CLEANUP.md).

Use `npm run bench:scan-lighting` for the faded-line comparison. It runs
the three archival scans untouched and with identical seeded lighting,
fade and grain distortions, plus calibrated line art. See
[scan lighting measurements](../results/SCAN-LIGHTING.md). The loop fixture
checks three known curves, including two close nested loops, in both polygon
and Bézier output. The fully erased-arc control must stay open.
See [broken-loop results](../results/FADED-CURVES.md).
The [real-scan follow-up](../results/REAL-SCAN-LOOPS.md) also compares enclosed
regions against the clean trace to distinguish useful closed loops from
graph cycles that do not enclose a matching region.

The [archival loop benchmark](../results/ARCHIVAL-LOOPS.md) uses manually
marked source-image polygons, open gaps, and empty paper zones. The regular
test suite gates the recovered loops and checks these negative controls.

The [Velocipede rim benchmark](../results/VELOCIPEDE-RIM.md) measures the
best individual closed subpath as well as the complete SVG. Fork
checkpoints and nearby paper boxes are measured separately. The regular
suite tests both curve-fitting settings and requires the rim to stay open
if an arc is erased before fading.

`npm run test:archival` gates the [full-resolution repairs](../results/ARCHIVAL-PERIMETERS.md)
on Linux CI. It checks annotated loop interiors, local open gaps, blank
paper, and individual ink checkpoints on seven untouched archive drawings.
Recovered loops must match at the 2,000-pixel limit at both a one-pixel
stroke and the same relative stroke width as the smaller render. The
Photophone ring must match as its own closed subpath because the original
crossing strokes divide its interior in the full trace.
Set `SVGX_QUALIFICATION_TIMING=1` and `SVGX_QUALIFICATION_REPORT` to a
new file path to record raw timings and quality results on your machine.

The Linux package job runs the real folder-to-folder batch scenario
under Xvfb. To run it yourself, install `xdotool`, then run
`SVGX_NATIVE_BATCH=1 SVGX_GTK_PICKER=1 xvfb-run -a npm run test:e2e:package`
after packaging. The test selects real directories in GTK and covers
mixed formats, a truncated PNG, cancel and resume, collision handling,
and retry after fixing the bad file. On an interactive desktop, set only
`SVGX_NATIVE_BATCH=1` and use the native pickers when prompted. The
smoke reports queue time, cancel-to-drain latency, retry time, and peak
sampled aggregate Electron working set. The samples can count shared
pages in more than one process.

On Linux, install Ghostscript and the Python `ezdxf` package, then run
`npm run test:export-consumers`. Ghostscript renders the EPS from real
Color and Centerline conversions at 72, 144, and 288 DPI. The tests compare
those renders to librsvg and verify that ezdxf can read the CAD polylines
against geometry decoded by Python's JSON parser.

Set `SVGX_TEST_LAN=1` before `npm run test:e2e:package` to run the opt-in
LAN smoke. It selects a reachable advertised non-loopback interface, checks
discovery and bundled assets, and converts a real upload in Chromium
without the native bridge. The downloaded SVG must match the browser
download over loopback byte for byte. It probes the host interface from the same
machine. A second-device connection additionally depends on network routing
and firewall rules. The smoke closes its Electron and browser processes.

Set `SVGX_NATIVE_BATCH=1` before running `npm run test:e2e:package` on a
desktop to exercise the real directory pickers. Select each temporary path
printed by the harness. The smoke then cancels after some outputs complete,
resumes pending work, validates every generated SVG, and checks that the
pre-existing SVG and outputs completed before cancellation retain their
original bytes. The default unattended smoke still runs on all CI platforms.
