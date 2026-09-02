import sharp from "sharp";
import { fileURLToPath } from "node:url";

const icon = await sharp(
  fileURLToPath(new URL("../assets/icon.png", import.meta.url)),
).metadata();
if ((icon.width ?? 0) < 512 || (icon.height ?? 0) < 512) {
  throw new Error(
    `Packaging icon must be at least 512x512; received ${icon.width}x${icon.height}`,
  );
}

console.log(`Packaging icon: ${icon.width}x${icon.height} ${icon.format}`);
