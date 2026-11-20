# Hand-reviewed archival loops

The baseline is `41c2fcb`. Both runs use identical RGBA input hashes and
measure 15 traces after five warm-ups on Windows with Node 24.19.0. Times
exclude decoding, export, and UI. The added-fade cases apply the existing
seeded shading, fading, and grain to the same source pixels.

I marked selected visible loop interiors on zoomed views of each archival
crop, with separate points at intentional openings and rectangles on blank
paper. The [annotation coordinates](../tests/fixtures/review/archival-loop-references.json)
are in source pixels, measured from the top left. These are sampled
features, including four Wright truss regions, four Velocipede regions,
and the enclosed part of Marconi's handwritten “g”. The Marconi
capacitor plates are intentional open gaps.

The benchmark renders the vector trace with a one-pixel stroke and
finds enclosed background components using four-neighbor flood fill.
A loop matches if its overlap with one enclosed region has at least
55% intersection over union. Open probes must reach the image boundary
through untraced background. Paper counts include trace pixels with
alpha of at least 64 out of 255.

| Crop                         | Reviewed loops matched | Median trace time |
| ---------------------------- | ---------------------: | ----------------: |
| Wright                       |            0/4 → 1/4 |   6.16 → 6.62 ms |
| Wright with added fade       |            0/4 → 1/4 |   3.96 → 3.97 ms |
| Velocipede                   |            2/4 → 2/4 |   6.35 → 6.98 ms |
| Velocipede with added fade   |            0/4 → 0/4 |   3.78 → 3.85 ms |
| Marconi                      |            0/1 → 1/1 |   3.83 → 4.00 ms |
| Marconi with added fade      |            0/1 → 0/1 |   3.29 → 3.60 ms |

The new matches are Wright's upper truss (0.79 IoU), its right-lower
brace on the added-fade input (0.69), and the Marconi letter loop (0.59).
Velocipede retained the front rim and rear-wheel seat sector in the
untouched crop. The added-fade rim remains fragmented.

All sampled open gaps and paper counts held steady. The second Marconi
capacitor already has a false closure in the untouched baseline. The
close-parallel, junction, nested-loop, erased-arc, and grain controls
passed. The faded mechanism retained all five matched enclosures.
Additional trace enclosures outside the reviewed polygons are unscored.

The short closure pass addresses ink at bends and intersections that
failed directional ridge screening. It checks similar endpoint
contrast, intervening ink, and either aligned faint ridges or a clear
drop on both sides of the gap. Both anchors and all contacted ink
must belong to the same component. This bounds the repair to one or
two pixels and leaves long, weak arcs unresolved.

Run `npm run bench:scan-lighting` to reproduce the analysis. See the
[baseline samples](scan-lighting-41c2fcb-archival-before.json) and
[updated samples](scan-lighting-archival-after.json). Source scans are
from DocsTeach and the National Archives.
[Wright](https://docsteach.org/document/flying-machine-wright-brothers/)
[Velocipede](https://docsteach.org/document/drawing-of-velocipede/)
[Marconi](https://docsteach.org/document/patent-drawing-for-g-marconis-wireless-telegraphy/)

The [Velocipede rim follow-up](VELOCIPEDE-RIM.md) evaluates the subsequent
near-circular stroke recovery against the same rim reference.
