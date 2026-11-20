# Build paired training data

The local batch command renders reviewed, self-contained source SVGs and
creates paired raster inputs with seeded fading, uneven lighting, and grain.
Each pair has a clean RGB PNG for raster supervision and the original SVG
for vector supervision. The production tracer does not generate these labels.
Use assets whose license permits the training and distribution you intend.

```powershell
npm run dataset:build -- examples/training-data/manifest.json artifacts/training-example
```

The output directory must be new and its parent must exist. The example
is a single authored artwork family. For a training corpus, use enough
independent source families that train, validation, and test all have
meaningful coverage.

The input JSON contains `seed`, `variants` (1–32), `maxDimension`
(16–2048), and `items`. Each item needs a relative `svg` path, a deliberate
`group` for related artwork, and an explicit `license`. Put derivatives and
near-duplicates in the same group. The stable group hash assigns about
80% of groups to train, 10% to validation, and 10% to test. The augmentation
seed changes pixels without reassigning the splits. Exact duplicate sources
and identical rendered targets submitted across different groups are rejected.

`manifest.jsonl` version 1 contains one row per variant with relative input,
clean target, and source SVG paths, raster dimensions, source and target
hashes, license, split, and augmentation parameters. The RGB rasters share
the same dimensions and geometry. The vector label keeps the original SVG
coordinates and viewBox. Format model outputs explicitly when training an SVG
decoder. The command processes one artwork at a time and publishes the
manifest when all examples are complete. If generation fails, the output
folder can contain a partial manifest and images.

Inputs are reviewed local artwork. Use presentation attributes for paint.
The loader rejects external references, embedded images, script and style
elements, inline styles, and XML entities. Fonts should be converted to paths
to keep labels reproducible across machines. This pipeline has no training
runtime, tensor normalization, augmentation for perspective or compression,
or curated real-scan labels. Keep archival scans with independent labels as a
separate evaluation set. Hand-traced and tracer-generated labels would need
explicit provenance if added later.
