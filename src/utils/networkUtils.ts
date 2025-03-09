/**
 * Last checked: 2025-03-02
 */

/**
 * Network utility functions for SVG-X
 */

/**
 * Get the local network URL where the application is accessible
 * @returns Promise that resolves to an object with local and network URLs
 */
export async function getNetworkUrls(): Promise<{ localUrl: string, networkUrls: string[] }> {
  // Get the current port from the window location
  const currentPort = window.location.port || '3000';
  
  try {
    // Try to fetch network info from the application server
    const response = await fetch('/api/network-info');
    if (response.ok) {
      const data = await response.json();
      return data;
    }
  } catch (error) {
    console.error('Error fetching network info:', error);
  }

  // If we're in development mode or the fetch fails, use values based on current port
  return {
    localUrl: `http://localhost:${currentPort}`,
    networkUrls: [
      `http://localhost:${currentPort}`,
      `http://172.18.240.1:${currentPort}`,
      `http://192.168.1.99:${currentPort}`,
      `http://192.168.1.130:${currentPort}`
    ]
  };
} 