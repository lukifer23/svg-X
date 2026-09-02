const fs = require("node:fs");
const path = require("node:path");

const normalizeOutputBase = (baseName) =>
  String(baseName || "image")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "image";

const writeUniqueOutput = async (root, baseName, extension, content) => {
  const safeBase = normalizeOutputBase(baseName);
  const safeExtension = String(extension).replace(/[^a-z0-9]/gi, "");
  if (!safeExtension) throw new Error("Invalid output extension");

  for (let suffix = 0; suffix < 100_000; suffix += 1) {
    const name = `${safeBase}${suffix === 0 ? "" : `-${suffix}`}.${safeExtension}`;
    const target = path.join(root, name);
    try {
      await fs.promises.writeFile(target, content, {
        encoding: "utf8",
        flag: "wx",
      });
      return { success: true, name };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Unable to reserve a unique output name");
};

module.exports = { normalizeOutputBase, writeUniqueOutput };
