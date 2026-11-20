# Security and network behavior

## Filesystem boundary

The preload exposes narrow operations. The main process stores a canonical directory path behind each opaque grant. Batch enumeration, reads, writes, and folder opening require a matching grant type. Batch reads require a regular file whose resolved path is directly within the granted root.

Inputs are extension allowlisted, limited to 50 MB and 100 million decoded pixels, and decoded with fail-on-error behavior. Text exports are limited to 25 MB. Batch SVG output uses exclusive `wx` creation, so simultaneous jobs and pre-existing files cannot be overwritten.

## Renderer boundary

Electron uses context isolation, renderer sandboxing, no Node integration, top-frame sender validation for IPC, exact parsed-origin navigation checks, and denied in-app popup creation. Browser permission checks and requests are denied by default. Only credential-free HTTPS links may be handed to the operating system; HTTP, file, custom-scheme, and credential-bearing URLs are rejected.

The browser entry point carries a restrictive Content Security Policy. The packaged same-origin server also sends CSP, opener/resource isolation, no-referrer, no-sniff, and permission-policy headers. Module workers and local blob/data image previews are explicitly allowed; objects, forms, framing, and third-party scripts are not.

Native export formats are allowlisted (`svg`, `eps`, `dxf`, and `json`). Unknown values are rejected rather than silently treated as SVG.

## LAN mode

LAN hosting requires `SVGX_LAN=1`. The server exposes only same-origin static application files, `/api/health`, and `/api/network-info`; permissive CORS is not enabled. Dual-stack binding is attempted first and falls back to IPv4 only when the host lacks IPv6 socket support. Conversion inputs and settings are unchanged for LAN clients.

Report vulnerabilities privately through GitHub security reporting. Do not include private images, filesystem paths, or exploit payloads in public issues.
