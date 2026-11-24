# SVG-X competitive review

SVG-X covers the core conversion workflow for local B&W, flat-color artwork,
and stroked centerlines. It has native folder batching with resume and retry,
four output formats, and browser conversion without an upload service.
Advanced color controls, editing, print and CAD fidelity, and automation
remain the main gaps.

| Reference                     | Where SVG-X overlaps                                   | Main capability gaps                                                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vectorizer.AI                 | Color vectorization, SVG, EPS, DXF                     | Palette remapping with tolerances, PDF, native arc and ellipse primitives, stacking and compatibility controls, programmatic conversion. [API](https://vectorizer.ai/api/documentation) · [Output options](https://vectorizer.ai/api/outputOptions)                  |
| Adobe Illustrator Image Trace | Abutting color regions, path fitting, speckle controls | Background transparency in the trace, gradient fitting in eligible presets, automatic grouping, and editing after expansion. [Image Trace options](https://helpx.adobe.com/illustrator/desktop/manage-objects/traces-mockups-symbols/image-trace-panel-options.html) |
| Inkscape                      | B&W, multicolor and centerline tracing                 | Integrated node editing, live tracing controls in the editor, and user-assisted tracing. [Inkscape tracing guide](https://inkscape-manuals.readthedocs.io/en/latest/tracing-an-image.html)                                                                           |
| Vector Magic Desktop          | Offline conversion and folder batching                 | AI and PDF export and native editing-tool handoff. Its online and desktop engines differ. [Desktop feature comparison](https://vectormagic.com/desktop)                                                                                                              |
| VTracer Classic               | Local spline tracing and SVG export                    | Stacked color output and a standalone converter. SVG-X supplies a folder workflow plus dedicated true-centerline and archival scan controls. [VTracer Classic source](https://github.com/visioncortex/vtracer)                                                       |

Only VTracer Classic was run for this pass. The commercial rows describe
published features. They supply no comparative quality or latency result.
The Classic result applies to the Python binding at version 0.6.15.

## Measured color comparison

Both engines decoded the same four white-composited PNGs, resized to a
1,000-pixel long side. We measured five warmed runs through SVG
serialization on a Windows Ryzen 5 7535HS. SVG-X used its production
Color tracer and compact encoder in-process with one thread and either
8 or 16 colors. VTracer used color, stacked shapes and spline fitting
with its default remaining options. SVGs were rendered back to the
working size with the same Sharp renderer. Lower mean ΔE00 is better.
The timings exclude upload, preview and Python process startup.

| Input        | Mean ΔE00, SVG-X 8 / 16 / VTracer | Median ms, SVG-X 16 / VTracer | SVG MB, SVG-X 16 / VTracer |
| ------------ | --------------------------------: | ----------------------------: | -------------------------: |
| Bicycle      |                3.80 / 3.38 / 3.43 |                   402 / 1,171 |                2.02 / 3.78 |
| Still life   |                9.74 / 6.64 / 3.92 |                   533 / 2,557 |               2.70 / 10.90 |
| USDA produce |                9.43 / 7.47 / 4.29 |                   571 / 3,052 |               2.84 / 11.69 |
| Hummingbird  |                6.80 / 4.49 / 4.16 |                     260 / 704 |                1.54 / 4.40 |

At 16 colors SVG-X was about 2.7–5.3× faster and wrote about 47–76% fewer
bytes in these runs. Mean color error was close on the bicycle and
hummingbird. The still life and USDA photo show a substantial fidelity
gap. The higher color limit improved every SVG-X result and left the
same two photos furthest behind. Both the palette budget and the
stacking strategy differ, so this pass establishes the observed output
trade-off and leaves the cause to a matched-file-size experiment.
Mean color error does not measure editability, topology, or centerline
quality. See the [raw report](../results/competitive-color-vtracer-0.6.15.json).

For reproduction, install `vtracer==0.6.15` in an isolated Python
environment. Set `SVGX_VTRACER_PYTHON` to that interpreter and run
`npm run bench:competitive`. Set `SVGX_COMPETITIVE_REPORT` to change the
output file. Python and VTracer are used only for this optional benchmark.

## Build order

1. **Color controls and accuracy.** Add palette locking and remapping for
   logos, then compare a higher-color or gradient-aware photo mode at
   matched SVG sizes. Track color error alongside region and edge retention.
2. **Inspect and correct results.** Add linked zoom and pan, then show
   detected colors and their regions. Start edits with recolor, remove
   background, and mask a local retrace. A palette and region inspector has
   a smaller validation surface than a general-purpose vector editor.
3. **Improve production exports.** Add vector PDF and test it in independent
   consumers. Evaluate editable object grouping and native CAD arcs on
   diagrams with known radii. Current DXF emits flattened polylines.
4. **Make repeat runs reproducible.** Add a headless converter using the same
   pipeline, exportable named presets, then restartable jobs with per-file
   manifests. Native batch currently remembers progress within its open
   dialog. Keep declared output format, actual filename, settings and source
   hash together for reproducible runs.
5. **Run the model pilot separately.** Use the local dataset tooling and
   independent archival annotations. Keep the deterministic tracer as the
   reference and run the [training decision gates](TRAINING-DATA.md#decide-whether-to-train)
   before considering a shipping model.
