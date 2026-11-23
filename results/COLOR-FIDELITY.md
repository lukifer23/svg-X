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
