const sharp = require("sharp");

// Inputs are capped at 100 million decoded pixels by the decoder itself.
const MAX_INPUT_PIXELS = 100_000_000;

const batchResizeOptions = (resize, highestQuality) => {
  if (resize?.enabled !== true) {
    const size = highestQuality === true ? 2000 : 1000;
    return {
      width: size,
      height: size,
      fit: "inside",
      withoutEnlargement: true,
    };
  }
  const dimension = (value) => {
    if (!Number.isInteger(value) || value < 1 || value > 8192)
      throw new Error(
        "Batch resize dimensions must be integers from 1 to 8192",
      );
    return value;
  };
  return {
    width: dimension(resize.width),
    height: dimension(resize.height),
    fit: resize.maintainAspectRatio === false ? "fill" : "inside",
  };
};

/**
 * Decode an image source to RGBA with alpha, applying EXIF orientation.
 *
 * The browser decoder (createImageBitmap) honors EXIF orientation, and so must
 * this path or the same file would vectorize sideways in the desktop app.
 * `source` is `{ path }` for a file or `{ raw: { pixels, width, height } }` for
 * already-decoded buffers (BMP). RAW sources carry no EXIF, so rotate() is a
 * no-op for them.
 */
const decodeToRgba = async (source, resizeOptions) => {
  const pipeline = source.raw
    ? sharp(source.raw.pixels, {
        raw: {
          width: source.raw.width,
          height: source.raw.height,
          channels: 4,
        },
      })
    : sharp(source.path, {
        limitInputPixels: MAX_INPUT_PIXELS,
        failOn: "error",
      });
  let oriented = pipeline.rotate();
  if (resizeOptions) oriented = oriented.resize(resizeOptions);
  const { data, info } = await oriented
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  );
  return { pixels, width: info.width, height: info.height };
};

module.exports = { batchResizeOptions, decodeToRgba, MAX_INPUT_PIXELS };
