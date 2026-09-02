# Security and network behavior

## Filesystem boundary

The preload exposes narrow operations, not Node.js or arbitrary paths. A user-selected directory becomes an opaque grant stored in the main process. Batch enumeration, reads, writes, and folder opening require a matching grant type. Child names must be basenames that resolve inside the granted root.

Inputs are extension allowlisted, limited to 50 MB and 100 million decoded pixels, and decoded with fail-on-error behavior. Text exports are limited to 25 MB. Batch SVG output uses exclusive `wx` creation, so simultaneous jobs and pre-existing files cannot be overwritten.

## Renderer boundary

Electron uses context isolation, renderer sandboxing, no Node integration, sender validation for every IPC handler, exact parsed-origin navigation checks, and denied in-app popup creation. External HTTP(S) links are handed to the operating system.

## LAN mode

LAN hosting requires `SVGX_LAN=1`. The server exposes only same-origin static application files, `/api/health`, and `/api/network-info`; permissive CORS is not enabled. Dual-stack binding is attempted first and falls back to IPv4 only when the host lacks IPv6 socket support. Conversion inputs and settings are unchanged for LAN clients.

Report vulnerabilities privately through GitHub security reporting. Do not include private images, filesystem paths, or exploit payloads in public issues.
