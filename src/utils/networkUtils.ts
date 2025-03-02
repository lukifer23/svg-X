/**
 * Network utility functions for SVG Bolt
 */

/**
 * Get the local network URL where the application is accessible
 * @returns Promise that resolves to an object with local and network URLs
 */
export async function getNetworkUrls(): Promise<{ localUrl: string, networkUrls: string[] }> {
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

  // Fallback: Return only localhost if we can't get the network information
  return {
    localUrl: 'http://localhost:3000',
    networkUrls: []
  };
} 