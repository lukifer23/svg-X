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

The [licensed starter corpus](../examples/training-data/corpus/manifest.json)
contains 32 source SVGs selected from pinned Maki and Lucide revisions.
Each design and its augmentations stay together as one group. The
collections contribute both filled symbols and stroked linework. They
share styles across the splits, so the resulting data measures
unseen designs within these icon styles.

```powershell
npm run dataset:build -- examples/training-data/corpus/manifest.json artifacts/licensed-corpus
npm run dataset:audit -- artifacts/licensed-corpus
```

The recorded build produced 128 pairs across 23 training, four
validation, and five test source groups. The audit compared all 227
cross-split pairs of unique targets and flagged zero. It checks group
and exact-hash separation, then flags normalized 32 × 32 silhouettes at
0.82 IoU or higher. It can miss transformed derivatives and can flag
independent designs with similar silhouettes. Review flagged pairs and
keep related artwork grouped. The [held-out archival scans](../results/ARCHIVAL-QUALIFICATION.md)
stay outside the generated corpus.

The manifest's optional `notices` field copies local license text into
the dataset's `notices/` directory. The starter corpus includes the
upstream notices and uses unmodified sources.
[Maki revision](https://github.com/mapbox/maki/tree/28e2a3602e4bde033a1dd388e86e9c117b425e34) ·
[Lucide revision](https://github.com/lucide-icons/lucide/tree/c1a02a04d4f3f7049d44567d62b8b06cff0b9103)

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
