# Faded-line restoration pilot

This experiment trains a small grayscale convolutional model from random
weights. It estimates ink coverage and supplies a restored grayscale raster to
the existing centerline tracer. The desktop and browser converters keep using
the production scan cleanup.

## Reproduce

The measured Windows run used Python 3.12, NumPy 1.26.4, Pillow 11.2.1 and
PyTorch 2.5.1 with CUDA 12.1. Use a Python environment with PyTorch, NumPy and
Pillow installed. A PyTorch CPU build can train and run the same experiment
with `--device cpu`. The benchmark inference path uses the CPU in both cases.

```powershell
New-Item -ItemType Directory -Force artifacts | Out-Null
node scripts/build-restoration-corpus.mjs artifacts/restoration-sources artifacts/restoration-dataset
npm run dataset:audit -- artifacts/restoration-dataset
python scripts/scan-restoration.py train artifacts/restoration-dataset artifacts/restoration-run --device cuda
python scripts/scan-restoration.py evaluate-pairs artifacts/restoration-run/ink-model.npz artifacts/restoration-dataset artifacts/restoration-run/pairs.json
$env:SVGX_RESTORATION_CHECKPOINT = 'artifacts/restoration-run/ink-model.npz'
$env:SVGX_RESTORATION_REPORT = 'artifacts/restoration-run/archival.json'
npm run test:restoration
```

Source, dataset, and training run destinations are new directories. For a
different Python executable, set `SVGX_RESTORATION_PYTHON` before running
the archival benchmark. The weight file contains NumPy tensors loaded with
pickle disabled. To restore other PNGs, run
`python scripts/scan-restoration.py restore CHECKPOINT INPUT_DIR NEW_OUTPUT_DIR`.
This batch command saves grayscale PNGs at the input dimensions and logs
warmed CPU inference timings. The experiment does not add a Python
dependency to the packaged app.

## Corpus and qualification

The generator authored 108 vector diagrams from nine procedural families
with parallel strokes, apertures, intersections and closed loops. The
audited dataset produced 432 aligned pairs from 72 training, 24 validation,
and 12 test designs. Each family stays in one split. Only one procedural
family falls in the test split. The 32 × 32 grayscale silhouette grid from the
dataset audit can miss very thin ink after averaging. Empty masks now use
source-pixel projection, retaining thin drawings in the duplicate check.

Training mixes the saved pairs with seeded paper gradients, fading and
noise on sampled patches. The lowest validation loss picks the checkpoint.
The benchmark keeps seven separately annotated archival drawings outside
training and checkpoint selection. It compares raw tracing, production
lighting normalization and repair, and model restoration followed by plain
centerline tracing. All three routes use the same input dimensions,
threshold, speckle setting and stroke width. The production route uses
lighting evidence for its curve repair stages.

The promotion rule requires more verified loops, retention of every
production loop and ink checkpoint, no new closures in open-gap annotations,
and no added stroke pixels in paper zones. The allowable extra time is
250 ms at the 1,000-pixel limit and 750 ms at the 2,000-pixel limit,
using warmed CPU inference plus tracing for each scan. This is an
experimental qualification rule. A completed evaluation can report a
failed promotion.

## Results on the local machine

The host has a six-core, 12-thread Ryzen 5 7535HS, 31.2 GiB of usable RAM
and an RTX 2050 Laptop GPU with 4 GiB of VRAM. The 4,273-parameter model
trained in **17.1 seconds** for 600 steps at batch size 12 and 96-pixel
patches. PyTorch recorded **84.3 MiB allocated** and **106 MiB reserved**
at peak during training. These figures describe the PyTorch allocator.
The weights file is 20,228 bytes. [Training report](../results/scan-restoration-pilot-training.json)

| Working limit | Matched loops, raw / production / model | Open gaps, production / model | Paper-zone stroke pixels, production / model | Median added CPU time |
| ------------- | --------------------------------------: | ----------------------------: | -------------------------------------------: | --------------------: |
| 1,000 px      |                               6 / 9 / 6 |                         6 / 7 |                                      70 / 22 |                102 ms |
| 2,000 px      |                               6 / 9 / 7 |                         7 / 7 |                                     109 / 60 |                502 ms |

The model passed the annotated gap, paper and CPU limits. It missed five
more loop checks and three more ink checkpoints than production across
the two sizes. The synthetic holdout's ink F1 rose from 0.684 to 0.883 on
48 pairs from one procedural source family. That gain came with more
false-positive ink pixels on the generated targets. [Archival report](../results/scan-restoration-pilot.json) ·
[Procedural holdout](../results/scan-restoration-pilot-pairs.json)

**Decision: keep this checkpoint experimental.** The laptop can train this
model within its VRAM budget. Improving transfer to real scans is the
next bottleneck. Collect independently annotated real scan crops for
training and validation, retain the seven archival scans as a test set,
and compare a model feeding the existing repair stages with production
alone. The first run evaluated only the plain centerline route after
restoration.

## Real-scan adaptation and complete run

```powershell
New-Item -ItemType Directory -Force artifacts | Out-Null
npm run restoration:pilot -- artifacts/restoration-run-2 cuda
```

The command generates and audits the procedural pairs, trains the synthetic
checkpoint, adapts it using the reviewed crops, scores the procedural
holdout, then runs the CPU archival test against production. Results include
both NumPy checkpoints, model logs, the archival gate report, source and
restored PNGs, and actual SVGs for the production and three learned routes.
Pass `cpu` for training on a machine that lacks CUDA.

The [reviewed crop manifest](../examples/training-data/real-scans/manifest.json)
pins six crops from three historical patent sheets by document, PDF page,
source and crop hashes, and bounds. The sewing machine and circuit controller
are training documents. The hydraulic governor is a separate validation
document. All seven archival qualification scans stay outside both sets.
Ink bands and blank-paper rectangles were marked by inspecting the original
sheets. Only dark source pixels inside the marked ink bands receive a
positive label. Paper rectangles provide negative labels, and every other
pixel is excluded from the real-crop loss. This is sparse supervision from
reviewed regions. It leaves faint ink outside the marked bands unlabelled.
[Tesla circuit controller](https://patents.google.com/patent/US609251A/en) ·
[Cornely sewing machine](https://patents.google.com/patent/US219225A/en) ·
[Gray hydraulic governor](https://patents.google.com/patent/US402015A/en)

At batch size 12, adaptation uses three reviewed patches alongside twelve
procedural patches per step, weighting the real-crop loss at 25%.
The 300-step run reduced validation loss on the reviewed document from
0.2073 to 0.1686 and increased ink recall from 98.25% to 99.56%, with zero
predicted ink pixels in the reviewed paper rectangles in either checkpoint.
The adapted model scored 0.867 F1 on the single-family procedural holdout,
down from 0.883. [Adaptation report](../results/scan-restoration-adapted-training.json) ·
[Procedural holdout report](../results/scan-restoration-adapted-pairs.json)

| Route                                                  | Matched archival loop checks | Outcome                                                                        |
| ------------------------------------------------------ | ---------------------------: | ------------------------------------------------------------------------------ |
| Production scan cleanup and repair                     |                           18 | Reference                                                                      |
| Original model followed by existing cleanup and repair |                           16 | Recovered fewer loops and added ink in a paper zone                            |
| Adapted model followed by plain centerline             |                           14 | Recovered fewer loops and added ink in a paper zone                            |
| Adapted model followed by existing cleanup and repair  |                           17 | Recovered fewer loops and closed an annotated gap                              |
| Adapted model as a guide for supplemental repair       |                           18 | Preserved all measured production geometry checks and recovered no extra loops |

Guided repair starts with the production skeleton and runs its normal repairs
first. For a supplemental bridge it requires a weak ridge in the original
scan, a confident and narrow ridge in the model output, aligned endpoints,
and a collision-free route. The learned hint can support a faint stroke
without replacing the input raster. A regression test covers both a real
signal in an otherwise weak gap and an erased gap. On the archival test
the guide preserved the production loop, gap, paper and ink checkpoints.
It added latency without recovering an additional verified loop, so the
production setting continues to use the established pipeline. Five of
the 14 guided SVGs differ byte-for-byte from production, with identical
scores on the measured checkpoints. Median
added CPU time was 146 ms at 1,000 px and 587 ms at 2,000 px.
[Original hybrid report](../results/scan-restoration-hybrid-control.json) ·
[Adapted archival report](../results/scan-restoration-adapted-guidance.json)
