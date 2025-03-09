/**
 * Last checked: 2025-03-02
 */

import React, { useState, useEffect } from 'react';
import { Globe, Copy, Check, ChevronDown, ChevronUp, X } from 'lucide-react';
import { getNetworkUrls } from '../utils/networkUtils';

interface NetworkInfoProps {
  isMobile?: boolean;
}

const NetworkInfo: React.FC<NetworkInfoProps> = ({ isMobile = false }) => {
  // Get the current port from window location
  const currentPort = window.location.port || '3000';
  
  const [networkInfo, setNetworkInfo] = useState<{ localUrl: string, networkUrls: string[] }>({
    localUrl: `http://localhost:${currentPort}`,
    networkUrls: []
  });
  // Start completely collapsed by default
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    async function fetchNetworkInfo() {
      try {
        const info = await getNetworkUrls();
        setNetworkInfo(info);
      } catch (error) {
        console.error('Failed to get network URLs:', error);
        // Fallback: Use values based on current port
        setNetworkInfo({
          localUrl: `http://localhost:${currentPort}`,
          networkUrls: [
            `http://localhost:${currentPort}`,
            `http://172.18.240.1:${currentPort}`,
            `http://192.168.1.99:${currentPort}`,
            `http://192.168.1.130:${currentPort}`
          ]
        });
      }
    }

    fetchNetworkInfo();
    // Refresh the network info every 30 seconds in case the network changes
    const interval = setInterval(fetchNetworkInfo, 30000);
    return () => clearInterval(interval);
  }, [currentPort]);

  const copyToClipboard = (url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(url);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  // If not expanded, just show a small button in the top right
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={`fixed top-4 right-4 z-50 ${isMobile ? 'p-2' : 'p-3'} rounded-full bg-blue-500 text-white shadow-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-300`}
        title="Network Access"
      >
        <Globe className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
      </button>
    );
  }

  // When expanded, show a modal-like popup
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className={`relative bg-white rounded-lg shadow-xl ${isMobile ? 'w-full max-w-sm' : 'max-w-md'} p-4`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className={`${isMobile ? 'text-sm' : 'text-base'} font-medium flex items-center`}>
            <Globe className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'} text-blue-500 mr-2`} />
            Network Access
          </h3>
          <button 
            onClick={() => setExpanded(false)}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'}`} />
          </button>
        </div>
        
        <div className="mt-2 space-y-2">
          <div className={`${isMobile ? 'text-xs' : 'text-xs'} text-gray-600 font-medium`}>
            Access this app from other devices on your network:
          </div>
          
          {/* Use dynamic port for fallback values */}
          {(networkInfo.networkUrls.length === 0 ? 
            [
              `http://localhost:${currentPort}`,
              `http://172.18.240.1:${currentPort}`,
              `http://192.168.1.99:${currentPort}`,
              `http://192.168.1.130:${currentPort}`
            ] : 
            networkInfo.networkUrls).map((url, index) => (
            <div key={index} className="flex items-center bg-gray-50 p-1.5 rounded">
              <span className={`${isMobile ? 'text-xs' : 'text-sm'} font-mono text-gray-800 flex-1 truncate`}>
                {url}
              </span>
              <button
                onClick={() => copyToClipboard(url)}
                className="ml-2 p-1 text-gray-500 hover:text-blue-500 focus:outline-none"
                title="Copy to clipboard"
              >
                {copied === url ? (
                  <Check className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-green-500`} />
                ) : (
                  <Copy className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
                )}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default NetworkInfo; 