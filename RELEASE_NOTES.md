# SVG-X Release Notes

## Unreleased — recovery build

This work is intentionally unreleased. No tag or downloadable binary is implied.

- Replaced nested-threshold color painting with a disjoint OKLab-refined label map and shared-grid region topology.
- Replaced skeleton contouring with endpoint/junction/cycle graph traversal and open centerline paths.
- Added the typed `VectorDocument` contract and direct SVG/EPS/DXF/JSON serialization.
- Replaced hash-only cross-paint removal with hash-indexed canonical equality.
- Moved conversion into bundled TypeScript module workers and added a prioritized reusable worker pool with abort-by-termination.
- Removed all network-specific conversion degradation.
- Added opaque Electron directory grants, validated IPC payloads, exclusive batch output creation, sandboxing, and navigation restrictions.
- Versioned and validated stored settings, with one-time migration from the legacy key.
- Updated the supported runtime and application stack to Node 24, npm 12, Electron 44, React 19, Vite 8, Vitest 4, Tailwind 4, Sharp 0.35, Express 5, SVGO 4, and electron-builder 26.
- Removed the compromised `axios@1.14.1` dependency chain captured by the previous lockfile and replaced the vulnerable legacy Potrace/Jimp stack. `npm audit` currently reports zero known vulnerabilities.
- Removed tracked build output, installer logs, and machine-specific builder diagnostics.
- Added deterministic topology, graph, export, migration, and deduplication tests plus generated realistic review fixtures.
- Added the MIT license.

## Historical releases

Historical tags and GitHub releases are preserved. Their bundled implementation and documentation describe those releases, not the unreleased recovery branch. Issue #37 should remain open until users can download a released color-capable binary.
