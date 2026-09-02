# Testing and acceptance

`npm run ci:check` runs formatting, lint, strict typechecking, all Vitest suites, asset verification, production build, and `npm audit`. `npm run test:e2e:web` exercises real production conversion workers in Chromium, Firefox, and WebKit. `npm run package:dir && npm run test:e2e:package` launches the unpacked Electron application, checks its local health endpoint, performs a real conversion, and shuts it down cleanly.

The deterministic corpus covers topology, holes, saddle cases, transparency, color labels, centerline endpoints/junctions/cycles, cubic error bounds, export commands, settings migration, exact origin validation, IPv4/IPv6 discovery, atomic filename collisions, and guaranteed packaged input formats.

Current absolute acceptance gates include:

- flat-color SSIM at least 0.95 and mean Delta E 2000 at most 2;
- B&W synthetic raster difference at most 1%;
- centerline mean distance at most 1.5 pixels;
- eight-image pooled throughput at least 1.5 times sequential throughput when the runner exposes at least three logical CPUs;
- browser heap growth below 256 MiB for that workload;
- cancellation followed by a successful recovery conversion;
- no serious or critical Axe findings in idle and converted flows.

The historical pre-recovery checkout failed before tests because its dependency install did not complete. Do not invent a relative speed or quality claim against it. A future released baseline must store hardware, fixture hashes, settings, raw timings, SSIM, and Delta E values before percentage comparisons become release gates.
