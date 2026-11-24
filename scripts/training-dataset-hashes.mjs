import { createHash } from "node:crypto";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export const rasterSha256 = (pixels, width, height) =>
  createHash("sha256")
    .update(`${width}x${height}\0`)
    .update(pixels)
    .digest("hex");
