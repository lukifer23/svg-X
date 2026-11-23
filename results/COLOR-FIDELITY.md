# Dominant palette fidelity

The Wu splitter chose the candidate with the largest combined within-box
variance. That left dissimilar colors together and caused small warm
accents on the bicycle illustration to blend into muted tones. The solver
now minimizes the variance left in the two child boxes. If the highest-error
box cannot split because its colors already occupy one histogram bin, the
solver tries the next eligible box.

Color assembly now skips full geometry hashing when every shape has distinct
paint and opacity. Shapes with matching paint still use canonical geometry and
verify equality after a hash match.

## Paired results

The baseline was `6233daf`. Each version traced the same white-composited
working raster with a 1,000-pixel longest side, eight dominant colors, speck
size 2, and a 2,000-path target. Sharp decoded the source and rasterized
each output at the working dimensions. The table reports mean CIEDE2000
over all working pixels and medians of six alternating, warmed trace runs
on Windows. Trace times exclude decode, SVG serialization, and rasterization.

| Input | Path style | Mean ΔE00 before → after | Median trace before → after |
| --- | --- | ---: | ---: |
| Bicycle illustration | Polygon | 6.725 → 3.796 | 284.8 → 202.8 ms |
| Bicycle illustration | Fitted Bézier | 6.724 → 3.796 | 398.5 → 288.1 ms |
| Generated still-life | Polygon | 12.740 → 9.743 | 352.2 → 320.1 ms |
| USDA fresh produce photo | Polygon | 13.151 → 9.430 | 281.1 → 357.6 ms |
| USFWS hummingbird photo | Polygon | 8.133 → 6.798 | 160.8 → 148.3 ms |

For warm bicycle accents, defined on source pixels as red ≥ 155,
red minus blue ≥ 65, and red ≥ green, polygon mean ΔE00 fell from
15.922 to 6.068. The corrected export recovers visibly distinct yellow,
orange and red in the flowers, grips, and reflectors.

The produce photo is the remaining performance outlier. Its more detailed
geometry took 27% longer to trace and produced 1.66 MB of SVG versus
1.12 MB at baseline, before optional SVGO. Palette and path controls still
trade detail for output complexity. Both bicycle variants were inspected
in the live Windows desktop app.

## Connected components follow-up

V8 profiles of the corrected palette showed work in flood-fill stack
operations, adjacency map updates, repeated palette-distance calculations,
and per-pixel relabeling. A straightforward horizontal-span flood fill gave
mixed results. The replacement scans the raster in order, joins provisional
IDs using the left and upper neighbors, and resolves aliases in order of first
occurrence. It retains right-before-down adjacency order, so equal-cost merges
keep the same tie break.

The merge pass precomputes distances between palette entries and reuses the
neighbor roots selected for each merge. It keeps individual boundary lengths
when different entries lead to the same root. Final pixel labels use a
component-to-color table.

| Input | Discovery before → after | Discovery + merge before → after | Polygon trace before → after | Fitted trace before → after |
| --- | ---: | ---: | ---: | ---: |
| Bicycle illustration | 27.7 → 24.8 ms | 65.3 → 57.3 ms | 202.2 → 186.2 ms | 236.9 → 235.4 ms |
| Generated still-life | 31.2 → 27.5 ms | 71.6 → 65.8 ms | 270.0 → 273.0 ms | 316.0 → 306.1 ms |
| USDA fresh produce | 29.6 → 28.3 ms | 80.4 → 75.5 ms | 285.7 → 286.5 ms | 331.4 → 326.0 ms |
| USFWS hummingbird | 13.7 → 11.0 ms | 19.1 → 15.1 ms | 110.2 → 106.5 ms | 138.5 → 138.1 ms |

These medians come from eight alternating pairs after three warm-ups for
each implementation. The baseline is `cb09ca6`, with the palette correction
already applied. Discovery includes adjacency construction. Full tracing
includes quantization and geometry assembly. It excludes decode, SVG
serialization, and rasterization. The smallest full-trace differences
were within run-to-run variation. [Paired timing samples](photo-color-components-paired.json)

The palette, original and merged labels, unrounded geometry, SVG bytes, and
rendered pixels matched for both variants of all four images. The raw
SVG sizes below precede optional SVGO.

| Input | Polygon SVG bytes | Fitted SVG bytes |
| --- | ---: | ---: |
| Bicycle illustration | 1,215,499 | 3,357,849 |
| Generated still-life | 1,527,879 | 4,256,241 |
| USDA fresh produce | 1,660,150 | 4,560,964 |
| USFWS hummingbird | 843,939 | 2,218,115 |

The implementation also matched the previous component IDs, areas, ordered
neighbor lists, and merge results on 19,683 exhaustive 3 × 3 maps plus
1,024 varied maps. For the photo harness, set `SVGX_PHOTO_WORKING_SIZE=1`
and `SVGX_PHOTO_BASELINE=photo-color-cb09ca6-components-before.json`.
The [baseline](photo-color-cb09ca6-components-before.json) and
[updated run](photo-color-components-final.json) contain sizes and hashes.
Setting `SVGX_PHOTO_PROFILE_DIR` also writes per-image merge profiles.

## Dense photo boundary assembly

On the USDA photo, quantization still accounted for roughly half of
the polygon trace. The assembly profile also showed repeated point-to-chord
distance work. The boundary code rebuilt point arrays before checking for
cached shared commands, recomputed junctions on both sides of shared edges,
and scanned every completed ring to compute its area.

Area is now accumulated during the pixel-edge walk. A compact junction cache
avoids repeated neighborhood checks. Shared chains are materialized only on
cache misses, and single lattice edges emit their existing endpoints directly.
Simplification computes the chord once per candidate span and uses a squared
bound to skip points safely below the current maximum. It uses the original
distance to resolve potential splits and near ties.

| Input | Polygon assembly before → after | Polygon trace before → after | Fitted trace before → after |
| --- | ---: | ---: | ---: |
| Bicycle illustration | 130.7 → 107.2 ms | 209.4 → 194.9 ms | 249.0 → 235.3 ms |
| Generated still-life | 154.0 → 125.4 ms | 281.9 → 255.2 ms | 317.4 → 300.7 ms |
| USDA fresh produce | 161.2 → 140.5 ms | 289.1 → 264.1 ms | 326.4 → 318.8 ms |
| USFWS hummingbird | 46.0 → 40.1 ms | 105.9 → 98.9 ms | 133.9 → 128.9 ms |

Baseline `d99a025` and the update ran in alternating order, with ten
paired samples per stage after three warm-ups per implementation on the same
working rasters and settings. The table reports these paired medians.
The standalone profile runs sample polygon assembly, fitted assembly,
quantization, and merging separately. [Paired timing samples](photo-color-produce-paired.json)

All eight outputs retain the exact palettes, initial and merged labels,
full-precision vector geometry, SVG bytes, rendered pixels, and file sizes
listed above. The USDA SVG remains 1,660,150 bytes for Polygon and
4,560,964 bytes for Fitted Bézier before optional SVGO. A differential test
matched both path styles and signed ring areas on all 19,683 three-by-three
label maps. Another test matched simplification and chord decisions on 4,096
varied chains at four tolerances.

For the photo harness set `SVGX_PHOTO_WORKING_SIZE=1` and
`SVGX_PHOTO_BASELINE=photo-color-d99a025-produce-before.json`. The
[baseline](photo-color-d99a025-produce-before.json) and
[updated run](photo-color-produce-final.json) contain the fidelity hashes
and standalone stage timings. Setting `SVGX_PHOTO_PROFILE_DIR` also
writes a separate `*.polygon.cpuprofile` for each image.
