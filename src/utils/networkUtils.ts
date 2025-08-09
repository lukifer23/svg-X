/**
 * Last checked: 2025-03-02
 */

/**
 * Network utility functions for SVG-X
 */

interface ExtendedWindow extends Window {
  mozRTCPeerConnection?: typeof RTCPeerConnection;
  webkitRTCPeerConnection?: typeof RTCPeerConnection;
}

/**
 * Attempt to gather local IP addresses using WebRTC APIs
 * @returns Promise resolving to an array of unique IP addresses
 */
async function getLocalIPs(): Promise<string[]> {
  return new Promise((resolve) => {
    const ips = new Set<string>();

    const win = window as ExtendedWindow;
    const RTCPeer = win.RTCPeerConnection || win.mozRTCPeerConnection || win.webkitRTCPeerConnection;
    if (!RTCPeer) {
      resolve([]);
      return;
    }

    const pc = new RTCPeer({ iceServers: [] });
    pc.createDataChannel('');

    pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate && event.candidate.candidate) {
        const match = event.candidate.candidate.match(/([0-9]{1,3}(?:\.[0-9]{1,3}){3})/);
        const ip = match && match[1];
        if (ip && !ip.startsWith('127.')) {
          ips.add(ip);
        }
      } else {
        pc.close();
        resolve(Array.from(ips));
      }
    };

    pc.createOffer().then((offer) => pc.setLocalDescription(offer)).catch(() => {
      pc.close();
      resolve([]);
    });
  });
}

/**
 * Check whether a URL is reachable by performing a fetch with a short timeout
 * @param url The URL to test
 */
async function isReachable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    await fetch(url, { mode: 'no-cors', signal: controller.signal });
    clearTimeout(timeout);
    return true;
  } catch {
    return false;
  }
}

/**
 * Filter a list of URLs to only those that are reachable
 * @param urls Candidate URLs
 */
async function filterReachableUrls(urls: string[]): Promise<string[]> {
  const checks = await Promise.all(urls.map(async (url) => (await isReachable(url)) ? url : null));
  return checks.filter((u): u is string => Boolean(u));
}

/**
 * Get the local network URL where the application is accessible
 * @returns Promise that resolves to an object with local and network URLs
 */
export async function getNetworkUrls(): Promise<{ localUrl: string, networkUrls: string[] }> {
  // Get the current port from the window location
  const currentPort = window.location.port || '3000';
  const localUrl = `http://localhost:${currentPort}`;

  try {
    // Try to fetch network info from the application server
    const response = await fetch('/api/network-info');
    if (response.ok) {
      const data = await response.json();
      const urls = Array.isArray(data.networkUrls) ? data.networkUrls : [];
      const reachable = await filterReachableUrls(urls);
      return {
        localUrl: data.localUrl || localUrl,
        networkUrls: reachable
      };
    }
  } catch (error) {
    console.error('Error fetching network info:', error);
  }

  // Fallback: compute local interfaces using WebRTC APIs
  const ips = await getLocalIPs();
  const candidateUrls = ips.map((ip) => `http://${ip}:${currentPort}`);
  const networkUrls = await filterReachableUrls(candidateUrls);

  return {
    localUrl,
    networkUrls
  };
}
