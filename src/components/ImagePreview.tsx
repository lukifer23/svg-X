import React from 'react';
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
            <div className="mt-2 sm:mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-blue transition-all duration-500 ease-out"
                style={{
                  width: `${
                    status === 'loading' ? 20 :
                    status === 'processing' ? 40 :
                    status === 'analyzing' ? 60 :
                    status === 'tracing' ? 80 :
                    status === 'optimizing' ? 90 : 0
                  }%`
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
            <div
              dangerouslySetInnerHTML={{ __html: svg }}
              className="bg-white border border-gray-200 rounded-lg p-2 sm:p-4 w-full h-auto max-h-[200px] sm:max-h-[300px] overflow-hidden shadow-soft hover:shadow-md transition-all duration-300"
            />
          ) : (
            <div className="h-[200px] sm:h-[300px] border border-gray-200 rounded-lg bg-white/50 flex items-center justify-center p-2 sm:p-4 text-center shadow-soft">
              <span className="text-xs sm:text-sm text-gray-400">
                {status === 'idle' ? 'Upload an image to see the SVG output' : 'Processing...'}
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