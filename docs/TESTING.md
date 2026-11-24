# Testing and acceptance

`npm run ci:check` runs formatting, lint, strict typechecking, all Vitest suites, asset verification, production build, and `npm run audit:deps`. The audit wrapper clears inherited user-level npm script allowlists while retaining the repository's package-scoped allowlist, then fails on moderate-or-higher advisories. `npm run test:e2e:web` exercises real production conversion workers in Chromium, Firefox, and WebKit, then runs the performance project separately with one Chromium worker so unrelated browser tests cannot distort the throughput gate. `npm run package:dir && npm run test:e2e:package` launches the unpacked Electron application with an isolated temporary profile, checks its local health endpoint and security headers, performs a real conversion, and shuts it down cleanly.

The deterministic corpus covers topology, holes, saddle cases, transparency, color labels, centerline endpoints/junctions/cycles, cubic error bounds, export commands, settings migration, exact origin validation, IPv4/IPv6 discovery, atomic filename collisions, and guaranteed packaged input formats. It also covers EXIF orientation on the desktop decoder, degenerate inputs (1×1, all-transparent, single-color, two-color), and exact equivalence between the single-threaded and band-parallel quantizers.

Hosted browser functional tests use the official Playwright image pinned by
digest. Update its version and digest alongside `@playwright/test` so the
preinstalled Chromium, Firefox, and WebKit builds match the lockfile.

Native batch tests use the production run and real Sharp and filesystem operations. They cancel at three observed boundaries: after submitting an archival JPEG decode, after closing a fully written staging file, and after submitting an exclusive publication under a collision suffix. They check that the run drains, an unpublished file leaves no output, and a successful publication retains its exact bytes alongside the pre-existing file.

`npm run bench:pipeline` measures core stages on representative fixtures and records serialized-SVG SHA-256 values in `results/pipeline-<label>.json`. Its test checks that all fixtures produced a report. The historical measurements live in `results/PERFORMANCE.md`. `src/core/parallelQuantize.test.ts` proves the band-parallel quantizer produces bit-identical labels, palette, and SVG across two to eight bands.

The [photo color benchmark](../results/PHOTO-COLOR.md) (`npm run bench:photo`) measures the still-life
fixture and two public-domain photographs with polygon and fitted output.
It compares available palette, label, geometry, SVG, raster, and path-count evidence when `SVGX_PHOTO_BASELINE` is set. Set `SVGX_PHOTO_WORKING_SIZE=1` for the four-image working-size corpus. The [upload-to-preview benchmark](../results/PREVIEW-LATENCY.md) runs separately against the production bundle and measures SVG bytes, worker delivery, preview latency, and decoded pixel hashes in both Color path styles.

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

The benchmark prepares eight independent copies of the same RGBA fixture
before each timed run. Timings include production worker conversion and
SVG serialization. Generating the fixture in the timed region makes the
pooled run contend with unrelated JavaScript on the renderer.

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

`npm run test:archival` also checks the heating rail and ironwork crossing,
plus separate 1,000- and 2,000-pixel scans of two architectural sheets.
The [weak-stroke benchmark](../results/WEAK-STROKE-SPANS.md) documents the
reference corrections, trace timings, and source provenance.

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

The Linux distribution job runs the real folder-to-folder batch scenario on
the DEB-installed app under Xvfb. To run it on an unpacked build, install
`xdotool`, then run
`SVGX_NATIVE_BATCH=1 SVGX_GTK_PICKER=1 xvfb-run -a npm run test:e2e:package`
after packaging. The test selects real directories in GTK and covers
mixed formats, a truncated PNG, cancel and resume, collision handling,
report saves, and retry after fixing the bad file. It also opens a second
input folder and checks files written by the EPS, DXF, and JSON batch paths.
On an interactive desktop, set only
`SVGX_NATIVE_BATCH=1` and use the native pickers when prompted. The
smoke reports queue time, cancel-to-drain latency, retry time, and peak
sampled aggregate Electron working set. The samples can count shared
pages in more than one process.

On Linux, install Ghostscript and the Python `ezdxf` package, then run
`npm run test:export-consumers`. Ghostscript renders the EPS from real
Color and Centerline conversions at 72, 144, and 288 DPI. The tests compare
those renders to librsvg and verify that ezdxf can read the CAD polylines
against geometry decoded by Python's JSON parser.

Set `SVGX_NATIVE_BATCH=1` before running `npm run test:e2e:package` on a
desktop to exercise the real directory pickers. Select each temporary path
printed by the harness. The smoke then cancels after some outputs complete,
resumes pending work, validates every generated SVG, and checks that the
pre-existing SVG and outputs completed before cancellation retain their
original bytes.

## Unsigned distribution files

Build with `npm run electron:build` on the target OS. It writes distribution
files to `release/` with publishing disabled. Start with an empty output
directory and close any running SVG-X instance before testing.

- **Windows x64** launches the actual portable EXE. On PowerShell set
  `$env:SVGX_PACKAGE_EXE = (Resolve-Path .\release\SVG-X-1.4.0-x64.exe).Path`,
  set `$env:SVGX_TEST_PORTABLE = '1'`, then run `npm run test:e2e:package`.
  Use the filename from your build. The smoke connects to the packaged window
  through a loopback DevTools port and waits for the launcher to exit.
- **macOS** runs `bash scripts/test-distribution.sh`. It mounts the DMG
  read-only, copies the app out, detaches the disk image, and launches the
  copy. It then extracts the ZIP and launches that copy separately. CI covers
  the architecture of its macOS runner.
- **Ubuntu x64** runs `xvfb-run -a bash scripts/test-distribution.sh`.
  Install the appropriate FUSE 2 compatibility library for your Ubuntu
  version (`libfuse2` on 22.04, `libfuse2t64` on 24.04). The test runs the
  AppImage through its FUSE runtime, installs the DEB with APT, verifies the
  installed desktop launcher and conversion, purges the package, and checks
  that the executable and launcher were removed. Use a disposable Linux
  machine without an existing SVG-X installation. CI also runs the native
  batch and same-host LAN checks from the installed DEB.

CI logs SHA-256 hashes for all five files. Its GUI smoke verifies app startup,
preload version, and real Color mode conversion. Use the
[signing rehearsal](SIGNING.md) for Windows Authenticode and macOS
notarization. User-facing trust prompts and upgrade from a historical
installer still require release qualification.

## Packaged LAN verification

Build with `npm run package:dir` and install the Playwright Chromium browser
with `npx playwright install chromium`. Close any running SVG-X desktop
instance before starting the smoke. On PowerShell, run
`$env:SVGX_TEST_LAN = "1"; npm run test:e2e:package`. On macOS or Linux, run
`SVGX_TEST_LAN=1 npm run test:e2e:package`.

The Linux package job runs the same-host check in CI. The smoke launches one
packaged app. Chromium probes an advertised non-loopback
address on the same machine and compares SVG, EPS, DXF, and JSON downloads
against loopback. Every pair must match byte for byte. The smoke prints
SHA-256 references for all three modes and closes its processes.

For a second **physical** device, use the same package build as the smoke:

1. With the smoke finished, launch one packaged app with `SVGX_LAN=1`. For
   example, on Windows set `$env:SVGX_LAN = "1"` and run
   `& .\release\win-unpacked\SVG-X.exe`.
2. Connect the device to the same trusted LAN. From that device, open the
   advertised Wi-Fi or Ethernet address in the app's Network Access dialog.
   Open `/api/health` at the same origin and check that `ok` and `lanEnabled`
   are both true. If it cannot connect, check the host's inbound firewall
   permission for the app on the private network, the selected interface,
   and guest Wi-Fi client isolation.
3. In a fresh browser session, select B&W and upload the original
   `tests/fixtures/review/wright-patent-scan.png`. Repeat for Centerline with
   that same scan and for Color with `tests/fixtures/review/color-bicycle.png`.
   Keep the other settings at their defaults. For each mode, check the
   preview and download SVG, EPS, DXF, and JSON. Move or rename the B&W
   downloads before repeating with Centerline because both use the same
   input filename.
4. Transfer the original downloads to the host. Compare their SHA-256 values
   with the smoke's reference for each mode and format using
   `Get-FileHash -Algorithm SHA256` or `shasum -a 256`. Record the packaged
   commit, host platform, client device and browser version, address family,
   and any mismatches. The same-host smoke leaves second-device reachability
   and browser behavior unverified.
