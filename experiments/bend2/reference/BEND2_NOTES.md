# Pinned Bend 2 facts (verified against current sources 2026-09-23)

Sources: `github.com/bendlang/bend` (README, `guide/GUIDE.md`, `guide/SHADERS.md`,
`guide/EFFECTS.md`, `CHANGELOG.md`, `AGENTS.md`, `install.sh`,
`bench/runtime/kmeans/main.bend`). **Bend 2.0.0 shipped 2026-09-17; 2.0.26 on
2026-09-23.** Bend 1 / HVM do not carry over.

## Installation and platforms

- Installer aborts on Windows: *"Bend needs Linux, macOS or WSL."*
- Only `darwin|linux × arm64|x64` archives. **No native Windows support.**
- `bend file.bend` checks and runs; `bend file.bend -o file` builds a native
  binary (clang 14+, 19+ with `!`); `-o file.c` emits C; `-o file.js` emits a
  **sequential single-core** JS program.
- Runtime flags: `./file --threads N`, `./file --gpu off`, `./file --gpu 4GB`.
- A binary using `!` also builds `file.gpu`, which must sit beside it.
- On Linux, `!` needs CUDA 12 at `/usr/local/cuda` (or `CUDA_HOME`), clang 19+.
- `bend guide`, `bend guide shaders`, `bend guide effects`, `bend base`,
  `bend version`; no debugger, profiler, or REPL; no test framework.

## Language core

- Affine by default; `+` permits reuse and requires `Data`.
- Closures and `Array`s cannot be shared. `Array<T>` is a `Type`: one owner,
  in-place `a[i] <- v`, cannot go down a fork tree. `Array.map` walks the block.
- `Array.fork`/`Array.join` + `Array.atomic.*` are experimental and `@unsafe`.
- Numbers: `Nat`, `U32`, `F32`. **No `U64`/`I64`/`F64`.** F32 is axiomatic.
- Strings are linked lists of characters (slow).
- Recursion must terminate; mutual recursion disallowed; `@unsafe` bypasses.
- No `if` syntax (match on `Bool`); no computed-value matches.
- Custom effects: a `def ... -> IO(R)` body is `import "./x.c"` + `import "./x.js"`.
  The C side uses runtime internals; **no ABI promise — rebuild each release.**

## Parallelism / GPU (from `guide/SHADERS.md`)

- `!` ships one call to the GPU over a **16384-lane (128×128) cube**; a kernel
  iteration costs ~0.4–0.5 ms plus the slowest lane. Aim for ~4⁷ leaves.
- CPU pool is a contention-free binary fork-join; balanced work required.
- **CUDA memory is managed: each page faults across PCIe on first access by the
  other side.** Unified memory is Apple-only.
- A `+` boxed value read by every lane costs an atomic per read; scalar records
  ride in registers.
- Divergent per-lane work is faster on the CPU than the GPU.

## Bend 2 bundled benchmark, `bench/runtime/kmeans` (Apple M4 pins)

| bench | COMPILER | SEQ-CPU | PAR-CPU | PAR-GPU |
|---|---|---|---|---|
| kmeans | 1.094 s | 3.969 s | 0.835 s | 0.700 s |

K-means with 64 restarts, 20 Lloyd rounds, K=8, 2¹⁹ regenerated points. The Bend
source uses per-point nearest-centroid plus a tree (`szip`) reduction — the same
shape as SVG-X color quantization. It regenerates points from an index hash
rather than materializing them, which SVG-X cannot do for real image pixels.

## Integration surface

- Native output is a standalone Linux ELF (+ `file.gpu`), not a library/DLL. No
  C-ABI in-process integration.
- JS loader (`import X from "./x.bend"` with `bend2/main.ts` preloaded) calls
  non-IO defs but is **single-core** — correctness oracle, not a perf path.
