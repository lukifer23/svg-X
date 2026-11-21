import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const network = require("../../desktop/network.cjs") as {
  collectNetworkUrls: (
    interfaces: Record<
      string,
      Array<{ address: string; family: string | number; internal: boolean }>
    >,
    port: number,
    allowedFamilies?: Set<number>,
  ) => string[];
};

test("discovers deterministic IPv4 and bracketed IPv6 LAN URLs", () => {
  const urls = network.collectNetworkUrls(
    {
      ethernet: [
        { address: "192.168.1.20", family: "IPv4", internal: false },
        { address: "fd12::abcd", family: "IPv6", internal: false },
      ],
      vpn: [
        { address: "192.168.1.20", family: 4, internal: false },
        { address: "127.0.0.1", family: 4, internal: true },
      ],
    },
    3001,
  );
  expect(urls).toEqual([
    "http://192.168.1.20:3001",
    "http://[fd12::abcd]:3001",
  ]);
  expect(urls.map((url) => new URL(url).hostname)).toEqual([
    "192.168.1.20",
    "[fd12::abcd]",
  ]);
});

describe("network discovery filtering", () => {
  test("omits scoped and unscoped IPv6 link-local addresses from browser URLs", () => {
    expect(
      network.collectNetworkUrls(
        {
          wifi: [
            { address: "fe80::abcd%12", family: "IPv6", internal: false },
            { address: "FEBF::2", family: 6, internal: false },
            { address: "fd12::5", family: 6, internal: false },
          ],
        },
        3001,
      ),
    ).toEqual(["http://[fd12::5]:3001"]);
  });
  test("drops unsupported address families", () => {
    expect(
      network.collectNetworkUrls(
        {
          adapter: [{ address: "socket", family: "Unix", internal: false }],
        },
        3001,
      ),
    ).toEqual([]);
  });

  test("restricts fallback discovery to IPv4", () => {
    expect(
      network.collectNetworkUrls(
        {
          adapter: [
            { address: "10.0.0.2", family: "IPv4", internal: false },
            { address: "fd12::2", family: "IPv6", internal: false },
          ],
        },
        3001,
        new Set([4]),
      ),
    ).toEqual(["http://10.0.0.2:3001"]);
  });
});
