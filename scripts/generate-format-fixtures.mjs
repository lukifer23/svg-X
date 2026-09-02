import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve("tests/fixtures/formats");
const source = path.resolve("tests/fixtures/review/color-bicycle.png");
await mkdir(root, { recursive: true });
const pipeline = () => sharp(source).resize(192, 192, { fit: "inside" });
await Promise.all([
  pipeline().jpeg({ quality: 88 }).toFile(path.join(root, "artwork.jpg")),
  pipeline().webp({ quality: 88 }).toFile(path.join(root, "artwork.webp")),
  pipeline()
    .tiff({ compression: "lzw" })
    .toFile(path.join(root, "artwork.tiff")),
  pipeline().avif({ quality: 60 }).toFile(path.join(root, "artwork.avif")),
  pipeline().gif({ colours: 128 }).toFile(path.join(root, "artwork.gif")),
]);

const { data, info } = await pipeline()
  .flatten({ background: "#ffffff" })
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const rowBytes = Math.ceil((info.width * 3) / 4) * 4;
const pixelBytes = rowBytes * info.height;
const bmp = Buffer.alloc(54 + pixelBytes);
bmp.write("BM", 0, "ascii");
bmp.writeUInt32LE(bmp.length, 2);
bmp.writeUInt32LE(54, 10);
bmp.writeUInt32LE(40, 14);
bmp.writeInt32LE(info.width, 18);
bmp.writeInt32LE(info.height, 22);
bmp.writeUInt16LE(1, 26);
bmp.writeUInt16LE(24, 28);
bmp.writeUInt32LE(pixelBytes, 34);
for (let y = 0; y < info.height; y += 1) {
  const sourceY = info.height - 1 - y;
  for (let x = 0; x < info.width; x += 1) {
    const sourceOffset = (sourceY * info.width + x) * 3;
    const targetOffset = 54 + y * rowBytes + x * 3;
    bmp[targetOffset] = data[sourceOffset + 2];
    bmp[targetOffset + 1] = data[sourceOffset + 1];
    bmp[targetOffset + 2] = data[sourceOffset];
  }
}
await writeFile(path.join(root, "artwork.bmp"), bmp);

console.log(`Generated real decode fixtures in ${root}`);
