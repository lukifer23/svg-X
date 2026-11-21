const collectNetworkUrls = (
  interfaces,
  port,
  allowedFamilies = new Set([4, 6]),
) => {
  const urls = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      const supported =
        entry.family === "IPv4" ||
        entry.family === 4 ||
        entry.family === "IPv6" ||
        entry.family === 6;
      const familyNumber =
        entry.family === "IPv6" || entry.family === 6 ? 6 : 4;
      if (entry.internal || !supported || !allowedFamilies.has(familyNumber))
        continue;
      // Browser URLs reject zone IDs, and link-local scope is client-specific.
      const { address } = entry;
      if (
        familyNumber === 6 &&
        (address.includes("%") || /^fe[89ab][\da-f]:/i.test(address))
      )
        continue;
      const host = familyNumber === 6 ? `[${address}]` : address;
      urls.push(`http://${host}:${port}`);
    }
  }
  return [...new Set(urls)].sort((left, right) => {
    const leftV6 = left.includes("//[");
    const rightV6 = right.includes("//[");
    if (leftV6 !== rightV6) return leftV6 ? 1 : -1;
    return left.localeCompare(right);
  });
};

module.exports = { collectNetworkUrls };
