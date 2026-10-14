# Environment record

Every benchmark result in `results/` records the values below. Update this file
whenever a component changes, and copy the relevant values into the result JSON.

## Primary workstation (measured 2026-09-23)

| Component | Value |
|---|---|
| OS | Windows 11 Business, build 26200 (`10.0.26200.9448`) |
| CPU | Intel Core Ultra 9 285K, 24 cores / 24 logical (8 P + 16 E, no SMT), 3.7 GHz base |
| RAM | 63.5 GB |
| GPU | NVIDIA RTX 2000 Ada Generation, 16 380 MiB, compute capability 8.9 |
| GPU driver (Windows) | 596.71 (CUDA 13.2 capable) |
| Power scheme | High performance (`8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c`) |
| Storage | C: ~1.55 TB free |

## Windows toolchain

| Tool | Version |
|---|---|
| Node | v24.18.0 |
| npm | 12.0.2 |
| clang (Windows/MSVC, BidLens tooling) | 22.1.8 |
| cargo / rustc | present |
| bend | **not installed on Windows** (unsupported) |

## WSL2 (Phase 2, installed admin-free 2026-09-23)

| Component | Value |
|---|---|
| WSL version | 2.5.10.0 |
| Kernel | 6.6.87.2-1 |
| Distribution | `BendExp` — Ubuntu 24.04.5 LTS, imported from linuxcontainers `20260923_07:42` rootfs at `%USERPROFILE%\WSL\bendexp` |
| Default user | `root` |
| CPUs visible | 24 (`nproc`) |
| GPU passthrough | **working** — `/dev/dxg` present; `nvidia-smi -L` sees `NVIDIA RTX 2000 Ada Generation` |
| bend | **2.0.26** (2026-09-23) at `/root/.bend/bin/bend` |
| clang | 18.1.3 (apt) — sufficient for CPU binaries |
| CUDA toolkit | **not installed** (GPU phase descoped; see `RESULTS.md`) |
| clang 19+ | **not installed** (GPU phase descoped) |
| wsl.exe trivial startup | **89 ms** (measured; dominates a ~55 ms kernel) |

Verified commands:
- `bend hello.bend` → `42`; `--check-only` → `All terms check.`
- `bend hello.bend -o hello && ./hello` → `42`
- `apt-get`, `curl`, `tar`, `git`, `build-essential`, `xz-utils` installed in-distro.

Admin-free notes: distro installed via `wsl --import` (no elevation); all
packages installed as in-distro root; nothing installed system-wide on Windows.

## Install constraints

**No administrator privileges.** All installs must be per-user:

- WSL distro: `wsl --import` from a rootfs tarball (or `wsl --install -d` only if
  it does not prompt for elevation).
- Node (Linux): prebuilt tarball into `$HOME`.
- clang 19+: official LLVM prebuilt release into `$HOME`.
- CUDA 12: NVIDIA runfile with `--toolkit --toolkitpath=$HOME/...` (no driver;
  WSL uses the Windows driver).
- Bend: `curl -fsSL https://bend-lang.com/install.sh | sh` (installs to `~/.bend`).

## Pinned versions

- Bend 2: _to be filled after install_ (target 2.0.26, 2026-09-23)
- SVG-X: see `git log -1` at experiment time
