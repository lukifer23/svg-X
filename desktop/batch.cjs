const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { decodeBmp } = require("./bmp.cjs");
const { batchResizeOptions, decodeToRgba } = require("./decode.cjs");
const { writeUniqueOutput } = require("./files.cjs");
const { resolveBatchFile, validateText } = require("./security.cjs");

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp",
  ".avif",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
]);
const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 25 * 1024 * 1024;

const decodeInput = async (inputPath, resizeOptions, signal) => {
  const extension = path.extname(inputPath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension))
    throw new Error(`Unsupported image format: ${extension}`);
  if (extension === ".bmp") {
    const bytes = await fs.readFile(inputPath, { signal });
    signal.throwIfAborted();
    return decodeToRgba({ raw: decodeBmp(bytes) }, resizeOptions, signal);
  }
  return decodeToRgba({ path: inputPath }, resizeOptions, signal);
};

const createBatchRun = (inputRoot, outputRoot) => {
  const controller = new AbortController();
  const { signal } = controller;
  const pending = new Set();
  let drain;

  const perform = (work) => {
    const operation = Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return work();
      })
      .finally(() => pending.delete(operation));
    // Once finish starts, newly submitted calls can only reject at the gate.
    if (!signal.aborted) pending.add(operation);
    return operation;
  };

  return {
    id: randomUUID(),
    read: ({ fileId, resize, highestQuality }) =>
      perform(async () => {
        const input = await resolveBatchFile(inputRoot, fileId);
        signal.throwIfAborted();
        if (input.size > MAX_INPUT_BYTES)
          throw new Error("Input exceeds the 50 MB limit");
        const result = await decodeInput(
          input.path,
          batchResizeOptions(resize, highestQuality),
          signal,
        );
        signal.throwIfAborted();
        return result;
      }),
    write: ({ baseName, content }) =>
      perform(() => {
        validateText(content, MAX_OUTPUT_BYTES);
        return writeUniqueOutput(outputRoot, baseName, "svg", content, signal);
      }),
    cancel: () => controller.abort(),
    finish: () => {
      controller.abort();
      drain ??= Promise.allSettled(pending).then(() => undefined);
      return drain;
    },
  };
};

module.exports = { createBatchRun, IMAGE_EXTENSIONS, MAX_OUTPUT_BYTES };
