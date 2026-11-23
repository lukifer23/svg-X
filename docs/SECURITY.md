# Security and network behavior

## Filesystem boundary

The preload exposes narrow operations. The main process stores a canonical directory path behind each opaque grant. Batch enumeration, reads, writes, and folder opening require a matching grant type. Batch reads require a regular file whose resolved path is directly within the granted root.

Inputs are extension allowlisted, limited to 50 MB and 100 million decoded pixels, and decoded with fail-on-error behavior. Text exports are limited to 25 MB. Each native batch binds its input and output grants to one cancellable run. Batch SVG output is staged in the output directory and published with a no-clobber hard link. Filesystems without usable hard links use an exclusive copy. The copy preserves collision safety but can expose a file while it is being written.

## Renderer boundary

Electron uses context isolation, renderer sandboxing, no Node integration, top-frame sender validation for IPC, exact parsed-origin navigation checks, and denied in-app popup creation. Browser permission checks and requests are denied by default. Only credential-free HTTPS links may be handed to the operating system; HTTP, file, custom-scheme, and credential-bearing URLs are rejected.

The browser entry point carries a restrictive Content Security Policy. The packaged same-origin server also sends CSP, opener/resource isolation, no-referrer, no-sniff, and permission-policy headers. Module workers and local blob/data image previews are explicitly allowed; objects, forms, framing, and third-party scripts are not.

The conversion preview displays the generated SVG through an image element
with a local blob URL. Source view displays the same markup as text.

Native export formats are allowlisted (`svg`, `eps`, `dxf`, and `json`). Unknown values are rejected rather than silently treated as SVG.

## LAN mode

LAN hosting requires `SVGX_LAN=1`. The server exposes same-origin static application files, `/api/health`, and `/api/network-info`. The server attempts dual-stack binding first and falls back to IPv4 when the host lacks IPv6 socket support. Discovery omits scoped and link-local IPv6 addresses because the host's interface scope does not identify the corresponding interface on a browser client. On a trusted LAN, allow incoming connections only on the intended private network profile. Conversion inputs stay in the client browser.

Report vulnerabilities privately through GitHub security reporting. Do not include private images, filesystem paths, or exploit payloads in public issues.
