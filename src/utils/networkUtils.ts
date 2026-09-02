export interface NetworkInfoResult {
  localUrl: string;
  networkUrls: string[];
  lanEnabled: boolean;
}

export async function getNetworkUrls(): Promise<NetworkInfoResult> {
  const response = await fetch("/api/network-info", { cache: "no-store" });
  if (!response.ok)
    throw new Error(`Network service returned ${response.status}`);
  const data = (await response.json()) as Partial<NetworkInfoResult>;
  return {
    localUrl:
      typeof data.localUrl === "string"
        ? data.localUrl
        : window.location.origin,
    networkUrls: Array.isArray(data.networkUrls)
      ? data.networkUrls.filter((url): url is string => typeof url === "string")
      : [],
    lanEnabled: data.lanEnabled === true,
  };
}
