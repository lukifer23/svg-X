# Results

Machine-readable output: `results/cpu.json`, `results/phase3-profile.json` /
`.txt`, `fixtures/active/summary.json`. Human summary below. Every Bend number
records Bend **2.0.26** (2026-09-23), Ubuntu 24.04.5 in WSL2 `BendExp`, clang 18.

> Scope note (read first): the implemented Bend kernel is the **fixed-palette
> nearest-label map** — SVG-X's `precomputePixelLabs` + `labelPixels` with a
> palette supplied by the normal pipeline. The 4-iteration `refinePalette`
> reduction was **not** ported to Bend within this experiment. So this measures
> the core per-pixel map, not the entire quantization front-end. This is stated
> wherever a speedup is reported.

## Phase 3 — baseline stage profile (SVG-X, single-thread, Windows Node)

| case | MP | seeds | labs | refine | label | merge | bounds | total | quant share |
|---|---|---|---|---|---|---|---|---|---|
| synthetic-1MP | 1.00 | 4 | 54 | 162 | 35 | 31 | 67 | 367 | **68.4%** |
| bicycle-1000 | 1.00 | 3 | 44 | 108 | 26 | 70 | 244 | 483 | **36.8%** |
| stilllife-1254 | 1.57 | 7 | 120 | 291 | 72 | 143 | 664 | 1028 | **46.9%** |
| mechanism-1254 | 1.57 | 6 | 93 | 295 | 74 | 115 | 115 | 694 | **66.4%** |

Gate passed (quantization is a real fraction of color tracing). `traceBoundaries`
is the other large cost and is sequential/graph-shaped.

## Phase 4 — Birth of the kernel and correctness

The Bend kernel was written from scratch and compiled with `bend 2.0.26`. It
reads raw RGBA bytes with `File.read_bytes` and writes one label byte per pixel.
Both a sequential (`src/quantize_seq.bend`) and a parallel fork-tree
(`src/quantize_par.bend`) version were produced.

**Correctness vs SVG-X** (fixed palette, `labels_double.bin` and `labels_f32.bin`):

| case | Bend seq mismatch | Bend par mismatch | notes |
|---|---|---|---|
| synthetic-128 | 0 / 16384 | 0 / 16384 | exact |
| synthetic-1000 | 0 / 1000000 | 0 / 1000000 | exact |
| stilllife-1254 | 0 / 1572516 | 0 / 1572516 | exact |
| bicycle-1000 | 523724 / 1000000 | same | **F32 vs F64 divergence** |

- Bend's F32 pipeline reproduces SVG-X's **F32 oracle exactly** on every case.
- On the photo-like `bicycle-1000` image, SVG-X's **float64** distance math and
  Bend's **float32** math disagree on **52.4%** of pixels (many near-ties). Bend
  matched the F32 oracle, confirming this is the F32-vs-F64 gap, not a Bend bug.
  This is a first-class finding: exact output equivalence is not achievable
  against the current double-precision implementation on photo-like input.

## Phase 5 — CPU benchmark (kernel-only, `IO.now` around `quantize`)

Bend fork tree, chunk 8192 bytes, depth 6. `seqMs` is the sequential Bend kernel;
`par*` are the parallel kernel. All mismatch counts are 0 except bicycle's
known F32/F64 gap.

| case | JS kernel (1t, Win) | Bend seq | 1t | 2t | 4t | 8t | 16t | 24t | best vs JS |
|---|---|---|---|---|---|---|---|---|---|
| synthetic-1000 (1.0 MP) | 84.8 ms | 68 ms | 125 | 80 | 54 | 49 | 42 | **38** | **2.23×** |
| bicycle-1000 (1.0 MP) | 49.4 ms | 59 ms | 112 | 73 | 52 | 45 | 39 | **38** | **1.30×** |
| stilllife-1254 (1.57 MP) | 126.9 ms | 107 ms | 206 | 128 | 87 | 72 | 63 | **55** | **2.31×** |

- **Bend single-thread is at parity with JS** (0.85×–1.25×), so the win is
  **parallel hardware gain, not an algorithmic/systems win**.
- **Bend 24-thread is 1.30×–2.31× the JS single-thread kernel.**
- Formatting the same idea differently: parallel vs Bend sequential is only
  **1.5×–1.9×**, i.e. scaling is **strongly sub-linear** on the 24-core 285K
  (P/E topology, `List.append` concatenation, chunking, and memory pressure).
- Chunking + fork + append overhead is roughly **2× at one thread**
  (e.g. stilllife 107 ms seq → 206 ms at `--threads 1`).

## Integration cost — the Windows↔WSL boundary

`wsl.exe` trivial startup measured **89 ms** (three invocations). A per-conversion
child process therefore costs more than the whole 55 ms kernel. Any production
use would require a long-lived daemon, adding a process, a protocol, and a WSL2
dependency to a shipped Windows app. This is not solvable with the current Bend
output formats (Linux ELF + `file.gpu`; no library/ABI target).

## Phase 6 — GPU/CUDA

**Not executed.** Reasons recorded against the gate:

1. Bend's CUDA path needs **CUDA 12 at `CUDA_HOME`** and **clang 19+** — neither
   is installed (admin-free install is a ~4 GB toolkit plus a prebuilt LLVM).
2. The installed GPU is a **70 W RTX 2000 Ada (cc 8.9)**; Bend's CUDA backend uses
   **managed memory that page-faults across PCIe** (per `guide/SHADERS.md`), and
   the input is ~4 bytes/pixel of host data.
3. The CPU result is already **sub-linear and modest**; a device kernel would have
   to overcome kernel-launch (~0.4–0.5 ms) plus page-fault transfer of the input.

This is a scope decision, not a conclusion. The follow-up is cheap to state and
expensive to run; see "Recommended next action".

## Development friction (Bend 2 as an AI-agent target)

| Observation | Detail |
|---|---|
| Correct code on first `--check-only` | No. Many repair loops. |
| Forward references | **Not allowed** — defs must precede callers; mutual recursion impossible; forced a single self-recursive `step`. |
| Destructuring | Only on parameters; `(a,b) = f(x)` and `match (computed)` are rejected. Drove a `Jobs`/`Chunks` state-type design. |
| Affine types | Lists of `Type` cannot be shared; `List.take`+`List.drop` on one list is a type error; needed a single-pass splitter. |
| Literals | Negative F32 literals rejected (needed `F32.neg`); `Nat` literals > 256 need the `n` suffix. |
| Integer match | `match n` on `Nat` must include `case 0n` even when unreachable. |
| Binary I/O | Good: `File.read_bytes`/`write_bytes` operate on `List<U32>`; but `File.open` modes are `"r"/"w"/"a"` only (`"rb"` → EINVAL). |
| Iteration speed | Compile-per-change works; native (`-o`) with clang 18 is fast for CPU. |
| Bugs found | My chunk fill was off-by-one; found by differential testing (1-chunk vs multi-chunk), not by the type system. |

Good news: Bend's compiler caught every affine/forward-reference/destructuring
violation with actionable messages, and no silent miscompilation was observed.

## Phase 5b — `worker_threads` baseline (D), the decisive comparison

Implemented with the **real bundled `src/core/colorTrace.ts`** (`precomputePixelLabs`
+ `labelPixels`, float64, exact 0 mismatches vs the oracle), warm pool, compute-only
timing matching Bend's `IO.now` window. Raw data: `results/workers.json`.

| case | JS 1t kthread | kthread best | threads | Bend seq | Bend 24t | **kthread best vs Bend 24t** |
|---|---|---|---|---|---|---|
| synthetic-1000 | 86.5 ms | **11.3 ms** | 16 | 68 ms | 38 ms | **3.4× faster** |
| bicycle-1000 | 52.0 ms | **8.0 ms** | 24 | 59 ms | 38 ms | **4.8× faster** |
| stilllife-1254 | 140.2 ms | **14.9 ms** | 16 | 107 ms | 55 ms | **3.7× faster** |

- The conventional baseline scales **~7.6×–9.4×** (stilllife 140 → 14.9 ms),
  versus Bend's **~1.9×** over its own sequential kernel.
- It runs the unmodified SVG-X algorithm, produces **exact float64 output**, and
  adds **no new language, no WSL, no CUDA, no `@unsafe`, and no chunking layer**.
- Both baselines show the same P/E-core plateau (24 threads worse than 16 on two
  cases), confirming the sub-linearity is the CPU topology, not Bend alone.

This answers the central question: **SVG-X can get a much larger benefit from
`worker_threads` at a fraction of the integration cost.**

## Mature-alternative comparison (now measured)

Bend's gain was parallel cores; when a mature alternative uses the same cores,
it wins by **3.4×–4.8×**. There is no remaining argument for Bend on this
workload. (WASM/SIMD and Rust were not implemented; both would plausibly beat the
worker baseline on single-thread efficiency and are the more sensible next
optimization if the kernel ever becomes a priority.)

## Verdict

**NET LOSS (outcome F) for a production dependency; technically interesting
research result.**

- A real *exact* CPU-parallel speedup exists versus single-thread JS (~2.3×), but
  it is **purely parallel hardware gain** (single-thread Bend is at parity), and
  it is **dwarfed by the `worker_threads` alternative (3.4×–4.8× faster than Bend
  at 24 threads)** using unmodified SVG-X code.
- Scaling is strongly sub-linear, and F32-only semantics break exact equivalence
  with SVG-X's float64 math on photo input.
- Integration is hostile: no Windows target, no library ABI, an ~89 ms process
  boundary, and ~2× fork/chunking overhead.
- Implementation cost was high: affine/forward-reference/destructuring
  constraints forced `@unsafe` workarounds and a bespoke `Jobs` state machine.

Bend 2 is an impressive, fast-moving research language, but for this SVG-X
workload it does not clear the bar, and a conventional solution clears it by a
wide margin.

## Post-experiment — SVG-X optimization adopted (the actual win)

Acting on the worker-baseline result, the same hot paths were optimized **in
SVG-X itself** (no new runtime, no Bend, no WSL): closure-free indexed loops over
flat typed arrays in `refinePalette`/`labelPixels`, inlined OKLab in
`precomputePixelLabs`, and integer lattice keys plus a direct best-pick in
`traceBoundaries`.

Measured on the same fixtures (Windows Node, median of 3):

| case | before total | after total | speedup | refine | label | bounds |
|---|---|---|---|---|---|---|
| synthetic 1 MP | 367 ms | 194 ms | **1.89×** | 2.9× | 2.7× | 1.5× |
| bicycle 1 MP | 483 ms | 293 ms | **1.65×** | 3.6× | 4.3× | 3.1× |
| stilllife 1.57 MP | 1028 ms | 615 ms | **1.67×** | 2.6× | 2.9× | 2.7× |
| mechanism 1.57 MP | 694 ms | 452 ms | **1.54×** | 2.9× | 3.4× | 1.8× |

**Output is bit-identical.** SHA-256 of the serialized SVG for all three review
fixtures matched the pristine implementation exactly (verified by stashing the
change and re-hashing). All 50 unit/algorithm tests pass and the format, lint,
and type gates are clean.

Remaining headroom is in intra-image parallelism (the worker baseline showed
7.6×–9.4× on the pure kernel), but after optimization the graph-shaped
`traceBoundaries` and component merging dominate and do not parallelize cleanly.
A nested-worker quantization layer is possible but adds an architectural layer to
a shipped app, so it is a deliberate follow-up decision, not an automatic one.

## Recommended next action

1. **Adopted:** the single-thread optimization above (no new layers).
2. Optional next: intra-image worker parallelism for quantization only, with a
   sequential fallback, if the added runtime layer is judged worthwhile.
3. **Do not adopt Bend**; do not run the CUDA phase.
4. Keep `experiments/bend2/` as a reproducible reference; no Bend dependency ships.

## Reproduce

```powershell
# fixtures + JS kernel timings
npx vitest run --config experiments/bend2/benchmarks/vitest.config.ts generate-cases
# CPU sweep (copies cases into fixtures/active, compiles in WSL, writes results/cpu.json)
powershell -NoProfile -ExecutionPolicy Bypass -File experiments/bend2/benchmarks/run-cpu.ps1
```
