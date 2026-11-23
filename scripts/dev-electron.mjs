import concurrently from "concurrently";

const port = Number(process.env.SVGX_PORT || process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port >= 65535) {
  throw new Error(
    "SVGX_PORT must be an integer from 1 to 65534 in desktop development",
  );
}

const { result } = concurrently(
  [
    {
      name: "vite",
      command: "vite --strictPort",
      env: { SVGX_PORT: String(port), VITE_SVGX_DESKTOP_DEV: "1" },
    },
    {
      name: "electron",
      command: `wait-on --timeout 30000 http-get://127.0.0.1:${port}/ && electron .`,
      env: { SVGX_PORT: String(port) },
    },
  ],
  { killOthersOn: ["failure", "success"], successCondition: "first" },
);
try {
  await result;
} catch {
  process.exitCode = 1;
}
