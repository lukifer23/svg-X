const path = require("node:path");
const fs = require("node:fs/promises");

const isAllowedNavigation = (candidate, allowedOrigins) => {
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return allowedOrigins.has(parsed.origin);
};

const isSafeExternalUrl = (candidate) => {
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && !parsed.username && !parsed.password;
};

const safeChild = (root, fileName) => {
  if (
    typeof fileName !== "string" ||
    fileName !== path.basename(fileName) ||
    fileName.includes("\0")
  ) {
    throw new Error("Invalid file identifier");
  }
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, fileName);
  const relative = path.relative(resolvedRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Path escapes the selected directory");
  return target;
};

const validateText = (content, maximumBytes) => {
  if (
    typeof content !== "string" ||
    Buffer.byteLength(content, "utf8") > maximumBytes
  ) {
    throw new Error(
      `Export exceeds the ${Math.floor(maximumBytes / 1024 / 1024)} MB limit`,
    );
  }
};

const resolveBatchFile = async (root, name) => {
  const target = safeChild(root, name);
  const info = await fs.lstat(target);
  if (!info.isFile()) throw new Error("Batch input must be a regular file");
  const resolved = await fs.realpath(target);
  if (path.relative(root, path.dirname(resolved)) !== "")
    throw new Error("Batch input is outside the selected directory");
  return { path: resolved, size: info.size };
};

module.exports = {
  isAllowedNavigation,
  isSafeExternalUrl,
  safeChild,
  resolveBatchFile,
  validateText,
};
