import React, { useState, useEffect } from 'react';
import { Globe, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
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
  // Start expanded by default
  const [expanded, setExpanded] = useState(true);
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

  const getPositionClasses = () => {
    if (isMobile) {
      return "fixed left-2 right-2 bottom-2 bg-white shadow-lg rounded-md p-2 border border-gray-200 animate-fade-in z-50";
    }
    return "fixed bottom-4 right-4 bg-white shadow-lg rounded-md p-3 border border-gray-200 max-w-md animate-fade-in z-50";
  };

  // Always show the component, even if we don't have network URLs
  return (
    <div className={getPositionClasses()}>
      <div 
        className="flex items-center cursor-pointer" 
        onClick={() => setExpanded(!expanded)}
      >
        <Globe className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'} text-blue-500 mr-2`} />
        <span className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium flex-1`}>Network Access</span>
        {expanded ? (
          <ChevronUp className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'} text-gray-500`} />
        ) : (
          <ChevronDown className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'} text-gray-500`} />
        )}
      </div>

      {expanded && (
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
      )}
    </div>
  );
};

export default NetworkInfo; 