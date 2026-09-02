const decodeBmp = (buffer, maximumPixels = 100_000_000) => {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length < 54 ||
    buffer.toString("ascii", 0, 2) !== "BM"
  )
    throw new Error("Invalid BMP header");
  const pixelOffset = buffer.readUInt32LE(10);
  const dibSize = buffer.readUInt32LE(14);
  const width = buffer.readInt32LE(18);
  const signedHeight = buffer.readInt32LE(22);
  const planes = buffer.readUInt16LE(26);
  const bitsPerPixel = buffer.readUInt16LE(28);
  const compression = buffer.readUInt32LE(30);
  if (
    dibSize < 40 ||
    width <= 0 ||
    signedHeight === 0 ||
    planes !== 1 ||
    ![24, 32].includes(bitsPerPixel) ||
    compression !== 0
  )
    throw new Error(
      "Only uncompressed 24-bit and 32-bit BMP images are supported",
    );
  const height = Math.abs(signedHeight);
  if (width * height > maximumPixels)
    throw new Error("BMP pixel limit exceeded");
  const bytesPerPixel = bitsPerPixel / 8;
  const rowBytes = Math.ceil((width * bytesPerPixel) / 4) * 4;
  if (pixelOffset + rowBytes * height > buffer.length)
    throw new Error("BMP pixel data is truncated");
  const pixels = Buffer.allocUnsafe(width * height * 4);
  const bottomUp = signedHeight > 0;
  for (let y = 0; y < height; y += 1) {
    const sourceY = bottomUp ? height - 1 - y : y;
    for (let x = 0; x < width; x += 1) {
      const source = pixelOffset + sourceY * rowBytes + x * bytesPerPixel;
      const target = (y * width + x) * 4;
      pixels[target] = buffer[source + 2];
      pixels[target + 1] = buffer[source + 1];
      pixels[target + 2] = buffer[source];
      pixels[target + 3] = bytesPerPixel === 4 ? buffer[source + 3] : 255;
    }
  }
  return { pixels, width, height };
};

module.exports = { decodeBmp };
