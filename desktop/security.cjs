const path = require("node:path");

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

module.exports = { isAllowedNavigation, safeChild, validateText };
