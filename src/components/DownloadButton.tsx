import React, { useState, useEffect, useRef } from 'react';
import { Download, Copy, Check } from 'lucide-react';

interface DownloadButtonProps {
  svg: string;
  filename: string;
  isMobile?: boolean;
}

const DownloadButton: React.FC<DownloadButtonProps> = ({ svg, filename, isMobile = false }) => {
  const [copied, setCopied] = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSvgRef = useRef<string | null>(null);

  // Only show the "ready" tooltip when svg transitions from absent to present
  useEffect(() => {
    if (svg && !prevSvgRef.current) {
      setTooltipVisible(true);
      if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
      tooltipTimer.current = setTimeout(() => setTooltipVisible(false), 4000);
    }
    prevSvgRef.current = svg;
    return () => { if (tooltipTimer.current) clearTimeout(tooltipTimer.current); };
  }, [svg]);

  const handleDownload = () => {
    if (!svg) return;
    try {
      if (window.electronAPI?.showSaveDialog) {
        window.electronAPI.showSaveDialog({ defaultName: `${filename}.svg` })
          .then((savePath: string | null) => {
            if (!savePath) return;
            window.electronAPI!.saveSvg({ svgData: svg, outputPath: savePath });
          })
          .catch(() => browserDownload());
        return;
      }
      browserDownload();
    } catch {
      browserDownload();
    }
  };

  const browserDownload = () => {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!svg) return;
    try {
      await navigator.clipboard.writeText(svg);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silently skip
    }
  };

  const positionClasses = isMobile
    ? 'fixed bottom-16 left-0 right-0 p-2 flex justify-center gap-2 z-20 animate-slide-in-bottom'
    : 'fixed bottom-0 left-0 right-0 p-4 flex justify-center gap-2 z-20 animate-slide-in-bottom';

  return (
    <div className={positionClasses}>
      {!isMobile && tooltipVisible && (
        <div
          className="absolute bottom-full mb-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-2 rounded-lg text-sm animate-bounce-in pointer-events-none"
          style={{ left: '50%', transform: 'translateX(-50%)' }}
          aria-live="polite"
        >
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 rotate-45 bg-indigo-600" />
          <p className="text-center font-medium whitespace-nowrap">Your SVG is ready for download!</p>
        </div>
      )}

      <button
        onClick={handleDownload}
        disabled={!svg}
        className={`flex items-center justify-center px-4 sm:px-6 py-2 sm:py-3 rounded-full shadow-soft transition-all duration-300 ${
          svg
            ? 'bg-gradient-blue text-white hover:shadow-lg hover:scale-105 active:scale-95'
            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
        }`}
        title="Download SVG file"
        aria-label="Download SVG"
      >
        <Download className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'} mr-2`} />
        <span className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium`}>Download SVG</span>
      </button>

      <button
        onClick={handleCopy}
        disabled={!svg}
        className={`flex items-center justify-center px-4 sm:px-5 py-2 sm:py-3 rounded-full shadow-soft transition-all duration-300 ${
          svg
            ? 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:shadow-md active:scale-95'
            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
        }`}
        title={copied ? 'Copied!' : 'Copy SVG source to clipboard'}
        aria-label={copied ? 'Copied to clipboard' : 'Copy SVG to clipboard'}
      >
        {copied
          ? <Check className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'} mr-2 text-green-500`} />
          : <Copy className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'} mr-2`} />
        }
        <span className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium`}>
          {copied ? 'Copied!' : 'Copy SVG'}
        </span>
      </button>
    </div>
  );
};

export default DownloadButton;
