# Benchmark plan

## Question

Does Bend 2 beat the existing SVG-X implementation of the color-quantization
front-end, net of all integration and transfer overhead — and by enough to
justify its cost versus conventional optimization?

## Locked decisions

1. All performance runs execute **inside WSL2** on the Linux filesystem. The
   Windows↔WSL bridge is measured separately as an integration-cost datapoint.
2. All installs are **admin-free** (see `ENVIRONMENT.md`).
3. The only SVG-X change is the optional, defaulted `quantize` seam plus additive
   exports. Default output must remain byte-identical.
4. Implemented baseline: **A = SVG-X single-thread** (as selected). The
   algorithmic-vs-hardware split is recovered with **Bend `--threads 1` vs A**
   and **Bend threads 24 vs Bend threads 1**.
5. Primary kernel: color-mode quantization front-end.

## Treatments

| ID | Implementation |
|---|---|
| A | SVG-X existing single-thread (isolated stage + full pipeline) |
| B | Bend CPU native (`--gpu off`, `--threads 1/2/4/8/16/24`) |
| C | Bend CUDA native (`!`) |

Optional (not implemented unless approved): D = `worker_threads`, E = Rust.

## Kernel boundary

`quantize(pixels, seeds) -> { palette, labels }` where the kernel computes:

`precomputePixelLabs` + `refinePalette` (4 iterations) + `labelPixels`.

Seed generation (`paletteSeeds`) is computed once in JS and passed to both sides,
so it is excluded from the kernel comparison. The Wu/histogram seed reduction is
the secondary experiment.

## Inputs

- Synthetic flat 4-color: 1 MP, 4 MP, 16 MP, 64 MP (square).
- Real: `color-bicycle.png`, `realistic-still-life.png` (1254²).
- Representativeness note: browser decode caps at 1000 px (2000 px HQ); desktop
  batch can reach 8192 px. Both regimes are measured.

## Measurements

- Cold and warm wall time; median and p95 over ≥5 warm runs; 3 sessions.
- Kernel-only vs transfer-inclusive, reported separately.
- Startup: WSL spawn, binary load, `file.gpu` load.
- Transfer/serialization: bytes and milliseconds in/out.
- CPU: peak RSS, per-thread scaling. GPU: SM util, VRAM, `nvidia-smi` samples.
- Correctness gate must pass before any timing counts.

## Correctness

- Fixed palette: exact `Uint8Array` equality.
- Refined palette: match the JS comparison to **F32** arithmetic (`Math.fround`);
  require ≥99.9% identical labels; analyze mismatches (ties); palette `deltaE00`
  within tolerance via `src/core/colorMetrics.ts`.
- Determinism: repeated Bend runs must be identical.

## Reporting rule

Microbenchmark results and end-to-end results are reported separately. WSL
startup, process spawn, and host↔accelerator transfer are never hidden.
