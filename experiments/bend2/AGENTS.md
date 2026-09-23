# AGENTS — rules for working in experiments/bend2

This experiment evaluates **Bend 2** only. Bend 2 has no Windows support and is
~days old. Do not trust prior knowledge of "Bend" — treat everything as suspect
until verified against the current sources.

## Source of truth order (never guess syntax)

1. Current repository: https://github.com/bendlang/bend
2. `guide/GUIDE.md`
3. `bend guide` and `bend guide shaders` and `bend guide effects`
4. `bend base` (the Base library)
5. Compiler output (`bend file.bend -o file.c`)
6. Current source (`bend2/bend.ts`, `bend2/comp.ts`, `bend2/base.bend`)
7. Only then external commentary

Never use Bend 1 / HVM syntax as reference. Bend 1 programs do not carry over.

## Hard rules

- Use Bend 2 only. Read the current guide before writing code.
- Compile frequently (`bend file.bend --check-only`). Never silence errors.
- Never remove behavior or substitute placeholders to make compilation succeed.
- Never weaken a benchmark to make Bend look good.
- Preserve the existing SVG-X default behavior. The `quantize` seam in
  `src/core/colorTrace.ts` must be byte-identical when no quantizer is passed.
- Record `bend version` (or the exact commit) in every result file.
- Record the full environment for every benchmark.
- Distinguish Windows, WSL2, CPU, and CUDA measurements explicitly.
- Never present a microbenchmark speedup as an application speedup.
- Keep all fixtures and hot I/O on the Linux filesystem, never `/mnt/c`.

## Bend 2 constraints to respect (verify before relying on them)

- Affine by default; closures and arrays cannot be shared; `Array` is `Type` (one
  owner) and cannot go down a fork tree.
- Numbers are `Nat`, `U32`, `F32` only. No `U64`/`I64`/`F64`. F32 is axiomatic.
- Recursion must be terminating; mutual recursion is disallowed; `@unsafe` bypasses.
- No `if`; no computed-value matches; match on `Bool` instead.
- Parallelism is a balanced binary fork-join; `!` dispatches to the GPU.
- CUDA uses managed memory and page-faults across PCIe.
- GPU/JS targets: `bend x.bend -o x` (native, needs clang 14+, 19+ with `!`) and
  `bend x.bend -o x.js` (sequential, one core).

## Friction tracking

For each Bend task, record: repair loops, Bend-1 contamination incidents, docs
lookups, time lost to the toolchain, LOC, debugging difficulty, and whether the
compiler or the language was the obstacle.
