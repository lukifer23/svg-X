/**
 * Last checked: 2025-03-02
 */

import React from 'react';
import { Download } from 'lucide-react';

interface DownloadButtonProps {
  svg: string;
  filename: string;
  isMobile?: boolean;
}

const DownloadButton: React.FC<DownloadButtonProps> = ({ svg, filename, isMobile = false }) => {
  const handleDownload = () => {
    if (!svg) return;
    
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

  const getPositionClasses = () => {
    if (isMobile) {
      return "fixed bottom-16 left-0 right-0 p-2 flex justify-center z-20 animate-slide-in-bottom";
    }
    return "fixed bottom-0 left-0 right-0 p-4 flex justify-center z-20 animate-slide-in-bottom";
  };

  return (
    <div className={getPositionClasses()} style={{ animationDelay: '0.5s' }}>
      <button
        onClick={handleDownload}
        disabled={!svg}
        className={`flex items-center justify-center px-4 sm:px-6 py-2 sm:py-3 rounded-full shadow-soft transition-all duration-300 ${
          svg 
            ? 'bg-gradient-blue text-white hover:shadow-lg hover:scale-105 active:scale-95'
            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
        }`}
        title="Download SVG"
      >
        <Download className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'} mr-2`} />
        <span className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium`}>Download SVG</span>
      </button>

      {isMobile ? null : (
        <div className="absolute bottom-full w-full max-w-xs mb-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-2 rounded-lg text-sm animate-bounce-in" style={{ left: '50%', transform: 'translateX(-50%)' }}>
          <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-4 h-4 rotate-45 bg-indigo-600"></div>
          <p className="text-center font-medium">Your SVG is ready for download!</p>
        </div>
      )}
    </div>
  );
};

export default DownloadButton; 