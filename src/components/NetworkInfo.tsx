/**
 * Last checked: 2025-03-02
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Globe, Copy, Check, X } from "lucide-react";
import { getNetworkUrls } from "../utils/networkUtils";
import ModalFrame from "./ModalFrame";

interface NetworkInfoProps {
  isMobile?: boolean;
}

const NetworkInfo: React.FC<NetworkInfoProps> = ({ isMobile = false }) => {
  // Get the current port from window location
  const currentPort = window.location.port || "3000";

  const [networkInfo, setNetworkInfo] = useState<{
    localUrl: string;
    networkUrls: string[];
    lanEnabled: boolean;
  }>({
    localUrl: `http://localhost:${currentPort}`,
    networkUrls: [],
    lanEnabled: false,
  });
  // Start completely collapsed by default
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [serviceUnavailable, setServiceUnavailable] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeDialog = useCallback(() => {
    setExpanded(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!expanded) return;
    async function fetchNetworkInfo() {
      try {
        const info = await getNetworkUrls();
        setNetworkInfo(info);
        setServiceUnavailable(false);
      } catch {
        setNetworkInfo({
          localUrl: `http://localhost:${currentPort}`,
          networkUrls: [],
          lanEnabled: false,
        });
        setServiceUnavailable(true);
      }
    }

    fetchNetworkInfo();
  }, [currentPort, expanded]);

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
        ref={triggerRef}
        onClick={() => setExpanded(true)}
        className="fixed top-4 right-4 z-50 min-h-11 min-w-11 p-3 rounded-full bg-blue-500 text-white shadow-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-300"
        title="Network Access"
        aria-label="Open network access information"
      >
        <Globe className={`${isMobile ? "w-3.5 h-3.5" : "w-4 h-4"}`} />
      </button>
    );
  }

  return (
    <ModalFrame
      label="Network access"
      onClose={closeDialog}
      panelClassName={`relative bg-white rounded-lg shadow-xl ${isMobile ? "w-full max-w-sm" : "max-w-md w-full"} p-4`}
    >
      <div className="flex items-center justify-between mb-3">
        <h3
          className={`${isMobile ? "text-sm" : "text-base"} font-medium flex items-center`}
        >
          <Globe
            className={`${isMobile ? "w-4 h-4" : "w-5 h-5"} text-blue-500 mr-2`}
          />
          Network Access
        </h3>
        <button
          onClick={closeDialog}
          className="min-h-11 min-w-11 inline-flex items-center justify-center text-gray-500 hover:text-gray-700"
          aria-label="Close network access information"
        >
          <X className={`${isMobile ? "w-4 h-4" : "w-5 h-5"}`} />
        </button>
      </div>

      <div className="mt-2 space-y-2">
        <div
          className={`${isMobile ? "text-xs" : "text-xs"} text-gray-600 font-medium`}
        >
          {networkInfo.lanEnabled
            ? "Access this app from other devices on your network:"
            : serviceUnavailable
              ? "The desktop network service is unavailable in browser-only development mode."
              : "LAN access is off. Set SVGX_LAN=1 before launch to opt in."}
        </div>
        {[networkInfo.localUrl, ...networkInfo.networkUrls].map(
          (url, index) => (
            <div
              key={index}
              className="flex items-center bg-gray-50 p-1.5 rounded"
            >
              <span
                className={`${isMobile ? "text-xs" : "text-sm"} font-mono text-gray-800 flex-1 truncate`}
              >
                {url}
              </span>
              <button
                onClick={() => copyToClipboard(url)}
                className="ml-2 min-h-11 min-w-11 inline-flex items-center justify-center text-gray-500 hover:text-blue-500 focus:outline-none"
                title="Copy to clipboard"
                aria-label={`Copy ${url} to clipboard`}
              >
                {copied === url ? (
                  <Check
                    className={`${isMobile ? "w-3.5 h-3.5" : "w-4 h-4"} text-green-500`}
                  />
                ) : (
                  <Copy className={`${isMobile ? "w-3.5 h-3.5" : "w-4 h-4"}`} />
                )}
              </button>
            </div>
          ),
        )}
      </div>
    </ModalFrame>
  );
};

export default NetworkInfo;
