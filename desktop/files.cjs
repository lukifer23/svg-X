const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { channel } = require("node:diagnostics_channel");

const outputStaged = channel("svg-x:batch:output-staged");
const publicationSubmitted = channel("svg-x:batch:publication-submitted");

const normalizeOutputBase = (baseName) => {
  const normalized =
    String(baseName || "image")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 240) || "image";
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(normalized)
    ? `image-${normalized}`
    : normalized;
};

const writeUniqueOutput = async (
  root,
  baseName,
  extension,
  content,
  signal,
) => {
  const safeBase = normalizeOutputBase(baseName);
  const safeExtension = String(extension).replace(/[^a-z0-9]/gi, "");
  if (!safeExtension) throw new Error("Invalid output extension");

  signal?.throwIfAborted();
  const staged = path.join(root, `.svg-x-${randomUUID()}.tmp`);
  const handle = await fs.promises.open(staged, "wx");
  try {
    try {
      await fs.promises.writeFile(handle, content, {
        encoding: "utf8",
        signal,
      });
    } finally {
      await handle.close();
    }
    if (outputStaged.hasSubscribers) outputStaged.publish({ staged });
    let useCopy = false;
    for (let suffix = 0; suffix < 100_000; suffix += 1) {
      const name = `${safeBase}${suffix === 0 ? "" : `-${suffix}`}.${safeExtension}`;
      const target = path.join(root, name);
      try {
        signal?.throwIfAborted();
        if (!useCopy) {
          try {
            const publishing = fs.promises.link(staged, target);
            if (publicationSubmitted.hasSubscribers)
              publicationSubmitted.publish({ target });
            await publishing;
          } catch (error) {
            if (
              !["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EPERM"].includes(error.code)
            )
              throw error;
            useCopy = true;
          }
        }
        if (useCopy) {
          signal?.throwIfAborted();
          const publishing = fs.promises.copyFile(
            staged,
            target,
            fs.constants.COPYFILE_EXCL,
          );
          if (publicationSubmitted.hasSubscribers)
            publicationSubmitted.publish({ target });
          await publishing;
        }
        return { success: true, name };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
    throw new Error("Unable to reserve a unique output name");
  } finally {
    await fs.promises.unlink(staged).catch((error) => {
      if (error.code !== "ENOENT")
        console.warn("Unable to remove staged SVG", error.code);
    });
  }
};

module.exports = { normalizeOutputBase, writeUniqueOutput };
