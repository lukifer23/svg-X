import React, { useState, useEffect } from 'react';
import { Globe, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { getNetworkUrls } from '../utils/networkUtils';

const NetworkInfo: React.FC = () => {
  const [networkInfo, setNetworkInfo] = useState<{ localUrl: string, networkUrls: string[] }>({
    localUrl: 'http://localhost:3000',
    networkUrls: []
  });
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    async function fetchNetworkInfo() {
      try {
        const info = await getNetworkUrls();
        setNetworkInfo(info);
      } catch (error) {
        console.error('Failed to get network URLs:', error);
      }
    }

    fetchNetworkInfo();
    // Refresh the network info every 30 seconds in case the network changes
    const interval = setInterval(fetchNetworkInfo, 30000);
    return () => clearInterval(interval);
  }, []);

  const copyToClipboard = (url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(url);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  if (networkInfo.networkUrls.length === 0) {
    return null; // Don't show anything if we don't have network URLs
  }

  return (
    <div className="fixed bottom-4 right-4 bg-white shadow-lg rounded-md p-2 border border-gray-200 max-w-md animate-fade-in z-10">
      <div 
        className="flex items-center cursor-pointer" 
        onClick={() => setExpanded(!expanded)}
      >
        <Globe className="w-5 h-5 text-blue-500 mr-2" />
        <span className="text-sm font-medium flex-1">Network Access</span>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-gray-500" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-500" />
        )}
      </div>

      {expanded && (
        <div className="mt-2 space-y-2">
          <div className="text-xs text-gray-600 font-medium">
            Access this app from other devices on your network:
          </div>
          
          {networkInfo.networkUrls.map((url, index) => (
            <div key={index} className="flex items-center bg-gray-50 p-2 rounded">
              <span className="text-sm font-mono text-gray-800 flex-1 truncate">
                {url}
              </span>
              <button
                onClick={() => copyToClipboard(url)}
                className="ml-2 p-1 text-gray-500 hover:text-blue-500 focus:outline-none"
                title="Copy to clipboard"
              >
                {copied === url ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default NetworkInfo; 