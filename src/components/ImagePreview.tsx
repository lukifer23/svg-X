/**
 * Last checked: 2025-03-02
 */

import React, { useState, useEffect } from 'react';
import { Image as ImageIcon } from 'lucide-react';

interface ImagePreviewProps {
  image: string;
  svg: string | null;
  status: string;
  progressSteps: Record<string, string>;
  isMobile?: boolean;
}

const ImagePreview: React.FC<ImagePreviewProps> = ({ 
  image, 
  svg, 
  status,
  progressSteps,
  isMobile = false
}) => {
  // Add state for detailed progress information
  const [progressDetails, setProgressDetails] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  
  // Listen for color progress updates
  useEffect(() => {
    const handleProgressUpdate = (event: CustomEvent) => {
      const { progress, details } = event.detail;
      setProgressPercent(progress);
      if (details) {
        setProgressDetails(details);
      }
    };
    
    window.addEventListener('color-progress-update', handleProgressUpdate as EventListener);
    
    return () => {
      window.removeEventListener('color-progress-update', handleProgressUpdate as EventListener);
    };
  }, []);
  
  // Reset progress details when status changes to something other than colorProcessing
  useEffect(() => {
    if (status !== 'colorProcessing') {
      setProgressDetails('');
    }
  }, [status]);
  
  // Calculate progress width based on status or detailed progress
  const getProgressWidth = () => {
    if (status === 'colorProcessing' && progressPercent > 0) {
      return `${progressPercent}%`;
    }
    
    return `${
      status === 'loading' ? 20 :
      status === 'processing' ? 40 :
      status === 'analyzing' ? 60 :
      status === 'tracing' ? 80 :
      status === 'colorProcessing' ? 70 :
      status === 'optimizing' ? 90 : 0
    }%`;
  };
  
  return (
    <div className="panel p-3 sm:p-6 animate-slide-in-bottom">
      <h2 className="text-base sm:text-lg font-semibold text-gradient mb-2 sm:mb-4 flex items-center">
        <ImageIcon className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-blue-600" />
        Preview
      </h2>
      <div className={`grid ${isMobile ? 'grid-cols-1' : 'sm:grid-cols-2'} gap-4 sm:gap-6`}>
        {/* Progress Indicator */}
        {status !== 'idle' && status !== 'done' && (
          <div className={`${isMobile ? 'col-span-1' : 'sm:col-span-2'} bg-glass border border-gray-200 rounded-xl p-3 sm:p-4 mb-2 animate-fade-in shadow-soft`}>
            <div className="flex items-center space-x-3">
              <div className="animate-spin rounded-full h-4 w-4 sm:h-5 sm:w-5 border-2 border-blue-600 border-t-transparent"></div>
              <span className="text-sm sm:text-base text-gray-700 font-medium">
                {progressSteps[status]}
              </span>
            </div>
            
            {/* Show detailed progress for color processing */}
            {status === 'colorProcessing' && progressDetails && (
              <div className="mt-1 text-xs text-gray-600">
                {progressDetails}
                {progressPercent > 0 && (
                  <span className="ml-1 font-medium">{progressPercent}%</span>
                )}
              </div>
            )}
            
            <div className="mt-2 sm:mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-blue transition-all duration-500 ease-out"
                style={{
                  width: getProgressWidth()
                }}
              />
            </div>
          </div>
        )}
        
        <div>
          <p className="text-xs sm:text-sm text-gray-600 font-medium mb-1 sm:mb-2">Original Image:</p>
          <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-white shadow-soft group">
            <img
              src={image}
              alt="Original"
              className="w-full h-auto object-contain max-h-[200px] sm:max-h-[300px] transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          </div>
        </div>
        <div className="animate-slide-in-right" style={{animationDelay: '0.2s'}}>
          <p className="text-xs sm:text-sm text-gray-600 font-medium mb-1 sm:mb-2">SVG Output:</p>
          {svg ? (
            <div className="bg-white border border-gray-200 rounded-lg p-2 sm:p-4 w-full h-[200px] sm:h-[300px] flex items-center justify-center shadow-soft hover:shadow-md transition-all duration-300 overflow-hidden">
              <div
                dangerouslySetInnerHTML={{ __html: svg.replace('<svg', '<svg preserveAspectRatio="xMidYMid meet"') }}
                className="max-w-full max-h-full w-auto h-auto"
                style={{ 
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transform: 'scale(0.9)',
                  transformOrigin: 'center'
                }}
              />
            </div>
          ) : (
            <div className="h-[200px] sm:h-[300px] border border-gray-200 rounded-lg bg-white/50 flex items-center justify-center p-2 sm:p-4 text-center shadow-soft">
              <span className="text-xs sm:text-sm text-gray-400">
                {status === 'idle' ? 'Upload an image to see the SVG output' : 
                 status === 'colorProcessing' ? 'Processing color layers...' :
                 'Processing...'}
              </span>
            </div>
          )}
        </div>
      </div>
      {status === 'done' && (
        <div className="mt-3 sm:mt-4 bg-green-50 border border-green-100 rounded-lg p-2 sm:p-3 text-green-700 text-xs sm:text-sm animate-fade-in">
          <p className="font-medium">Conversion complete!</p>
          <p className="text-xs mt-1 text-green-600">Your SVG is ready to download.</p>
        </div>
      )}
    </div>
  );
};

export default ImagePreview; 