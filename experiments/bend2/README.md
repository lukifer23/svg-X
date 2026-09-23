# Bend 2 × SVG-X — contained evaluation experiment

This directory is an **isolated experiment**. It answers one question:

> Can Bend 2 materially improve a computationally expensive part of SVG-X without
> unacceptable integration complexity?

It is **not** a migration. Nothing here ships, and no production code depends on
it. The only production touch point is one optional, defaulted dependency-injection
seam in `src/core/colorTrace.ts` (`quantize?: ColorQuantizer`), which preserves the
existing behavior byte-for-byte when omitted.

## Status

- [x] Phase 0 — repository + Bend 2 research
- [x] Phase 1 — environment assessment
- [x] Phase 2 — admin-free WSL2 / clang / Bend setup (CPU ready; CUDA not installed)
- [x] Phase 3 — baseline stage profiling (gate passed: quantization 37–68%)
- [x] Phase 4 — Bend correctness prototype (fixed palette, exact vs F32 oracle)
- [x] Phase 5 — Bend CPU benchmark (see `RESULTS.md`)
- [ ] Phase 6 — Bend CUDA benchmark (**descoped**, see `RESULTS.md`)
- [ ] Phase 7 — minimal shadow-pipeline integration
- [ ] Phase 8 — end-to-end benchmark
- [ ] Phase 9+ — optimization / proofs / alternatives / verdict

**Verdict: NET LOSS for production (outcome F).** Bend's CPU-parallel kernel beats
single-thread JS (~2.3×) but is **3.4×–4.8× slower than a `worker_threads`
baseline** running the unmodified SVG-X algorithm, which also gives exact
float64 output with none of the toolchain cost. See `RESULTS.md`.
No production code depends on Bend.

## Primary target

The **color-mode quantization front-end** in `src/core/colorTrace.ts`:

`precomputePixelLabs` + `paletteSeeds` + `refinePalette` + `labelPixels`

Given packed RGBA pixels plus a seed palette, it produces per-pixel palette labels
and a refined palette. It is pure, read-only, highly parallel, and deterministic
for a fixed palette.

## Ground rules

NO STUBS. NO MOCKS. NO PLACEHOLDERS. NO FAKE BENCHMARKS. NO REMOVALS. NO
REGRESSIONS. NO SILENT FAILURES. NO BENCHMARK CHEATING. NO BEND-1 ASSUMPTIONS.
NO MAJOR REWRITE. NO "OPTIMIZATION" THAT CHANGES THE RESULT.

If Bend loses, this directory will say so.

## Regenerating

The `fixtures/` directory and `.build/` output are regenerated, not committed
(they are ignored by Git):

```powershell
# Bend fixtures and JS oracles
npx vitest run --config experiments/bend2/benchmarks/vitest.config.ts generate-cases
# CPU/GPU comparison sweep (copies cases into fixtures/active; requires the WSL distro)
powershell -NoProfile -ExecutionPolicy Bypass -File experiments/bend2/benchmarks/run-cpu.ps1
```

## Layout

```
experiments/bend2/
  README.md            this file
  AGENTS.md            rules for coding agents working here
  ENVIRONMENT.md       exact machine + toolchain record
  BENCHMARK_PLAN.md    methodology and matrix
  RESULTS.md           measured results (machine-readable files in results/)
  reference/           pinned Bend 2 facts and source excerpts
  src/                 Bend 2 source (.bend) and custom effects (.c)
  benchmarks/          JS/TS harnesses, baselines, runner
  fixtures/            raw RGBA inputs, seed palettes, expected outputs
  results/             JSON/CSV benchmark output (not screenshots)
```
