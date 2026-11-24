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
alone. This run qualified only the plain centerline route after restoration.
