# Building SVG-X on Windows

## Requirements

- Windows 10 or 11
- Node.js 24.19.0
- npm 12.0.2
- Git

```powershell
git clone https://github.com/lukifer23/svg-X.git
Set-Location svg-X
npm ci
npm run ci:check
```

Use the frozen install. If `npm ci` fails, diagnose the lockfile or registry response; do not silently regenerate dependencies during a release build.

## Development

```powershell
npm run electron:dev
```

Vite serves the renderer on port 3001. Electron exposes the development API sidecar on port 3002. A port conflict is reported visibly.

## Unsigned packages

```powershell
# Unpacked application directory
npm run electron:build:dir

# Portable x64 executable
npm run build:portable-exe
```

Outputs are written under `release/` and are ignored by Git. They must be rebuilt from source.

These commands disable signing for local validation. A successful unsigned package is not evidence of code-signing, SmartScreen reputation, clean-machine launch, or hosted release acceptance.

## LAN opt-in

```powershell
$env:SVGX_LAN = "1"
npm run electron:dev
```

Without `SVGX_LAN=1`, the service binds only to loopback and does not advertise LAN URLs. Conversion output never changes based on the client address.

## Troubleshooting

- Port conflict: set `$env:SVGX_PORT = "3005"` before launch.
- Sharp load failure: remove `node_modules`, rerun `npm ci`, then rebuild; do not install an ad hoc Sharp version.
- Packaging failure: run `npm run ci:check` first and preserve the complete electron-builder output.
- Stale artifacts: delete only the verified repository-local `dist` and `release` directories, then rebuild.
