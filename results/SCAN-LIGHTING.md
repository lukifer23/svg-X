# Faint linework and scan lighting

This records the original lighting-recovery comparison. The follow-up
[broken-loop benchmark](FADED-CURVES.md) measures the curve repair pass.

`Recover faded scan lines` is a Centerline option and defaults to off.
It estimates local paper tone from the lighter fifth of each tile and
interpolates the estimates between tile centers. Strong local contrast can
enter the mask directly. A weaker mark needs contrast on both sides and
three pixels of directional support. Short links only use pixels that
already carry ink and connect previously disconnected components.

## Measurements

Both runs used the same input hashes and centerline settings. The baseline
used the production source at `ab7c158`. Each median is from 15 timed
traces after five warm-ups on Windows with Node 24.19.0 and an AMD Ryzen 5
7535HS. Timings exclude file decoding, SVG serialization and UI.

| Faded/shadowed input       | Reference pixels recovered | Trace pixels near reference | Median trace time |
| -------------------------- | -------------------------: | --------------------------: | ----------------: |
| Close parallels            |             34.0% → 100.0% |               18.3% → 99.2% |    1.53 → 2.52 ms |
| Junction drawing           |              51.4% → 94.7% |               19.8% → 99.4% |    1.40 → 3.22 ms |
| Mechanism artwork, 1000 px |              56.4% → 76.3% |               35.1% → 99.2% | 117.00 → 73.31 ms |
| Wright scan                |              15.9% → 74.9% |               14.1% → 79.7% |    4.73 → 3.71 ms |
| Velocipede scan            |              34.5% → 70.8% |               21.1% → 60.1% |    4.12 → 3.10 ms |
| Marconi scan               |              30.6% → 91.2% |               22.1% → 81.8% |    3.14 → 2.97 ms |

Agreement uses a one-pixel neighborhood around rasterized centerlines from
the undistorted images with standard cleanup. The source scans are real.
The additional fading, lighting variation and grain are deterministic
test distortions. The original traces are an agreement reference for the
archival scans and can themselves omit faint detail.

The known-geometry fixtures verify the correct tip, junction and cycle
counts. Mean source-to-trace error fell from 40.05 px to below 0.001 px
for close parallels and from 29.64 px to 0.40 px for the junction drawing.
A paper-only image with the same simulated shadow and isolated grain
produces no paths. The mechanism's original trace has 40 cycles. Only three
close after its severe test distortion with recovery enabled, so heavily
faded curves and loops still fragment.

The after report also includes the three untouched archival scans with
recovery enabled. Trace agreement with standard cleanup ranged from 35.4%
to 75.4% on those, and the enabled mode cost extra time. Added paths may
include faint annotations and paper texture. Standard cleanup remains
the default for well-exposed inputs.

Run `npm run bench:scan-lighting` to reproduce. Raw results are in
[before](scan-lighting-ab7c158-before.json) and
[after](scan-lighting-after.json). Scan sources are recorded in the
[scan cleanup report](SCAN-CLEANUP.md).
