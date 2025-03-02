import React from 'react';
import { Image as ImageIcon } from 'lucide-react';

type ConversionStatus = 'idle' | 'loading' | 'processing' | 'tracing' | 'done' | 'error';

interface ImagePreviewProps {
  image: string;
  svg: string | null;
  status: ConversionStatus;
  progressSteps: Record<ConversionStatus, string>;
}

const ImagePreview: React.FC<ImagePreviewProps> = ({ 
  image, 
  svg, 
  status,
  progressSteps
}) => {
  return (
    <div className="panel p-6 animate-slide-in-bottom">
      <h2 className="text-lg font-semibold text-gradient mb-4 flex items-center">
        <ImageIcon className="w-5 h-5 mr-2 text-blue-600" />
        Preview
      </h2>
      <div className="grid sm:grid-cols-2 gap-6">
        {/* Progress Indicator */}
        {status !== 'idle' && status !== 'done' && (
          <div className="sm:col-span-2 bg-glass border border-gray-200 rounded-xl p-4 mb-2 animate-fade-in shadow-soft">
            <div className="flex items-center space-x-3">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent"></div>
              <span className="text-gray-700 font-medium">
                {progressSteps[status]}
              </span>
            </div>
            <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-blue transition-all duration-500 ease-out"
                style={{
                  width: `${
                    status === 'loading' ? 25 :
                    status === 'processing' ? 50 :
                    status === 'tracing' ? 75 : 0
                  }%`
                }}
              />
            </div>
          </div>
        )}
        <div className="animate-slide-in-left" style={{animationDelay: '0.1s'}}>
          <p className="text-sm text-gray-600 font-medium mb-2">Original Image:</p>
          <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-white shadow-soft group">
            <img
              src={image}
              alt="Original"
              className="w-full h-auto object-contain max-h-[300px] transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          </div>
        </div>
        <div className="animate-slide-in-right" style={{animationDelay: '0.2s'}}>
          <p className="text-sm text-gray-600 font-medium mb-2">SVG Output:</p>
          {svg ? (
            <div
              dangerouslySetInnerHTML={{ __html: svg }}
              className="bg-white border border-gray-200 rounded-lg p-4 w-full h-auto max-h-[300px] overflow-hidden shadow-soft hover:shadow-md transition-all duration-300"
            />
          ) : (
            <div className="h-[300px] border border-gray-200 rounded-lg bg-white/50 flex items-center justify-center p-4 text-center shadow-soft">
              <span className="text-gray-400">
                {status === 'idle' ? 'Upload an image to see the SVG output' : 'Processing...'}
              </span>
            </div>
          )}
        </div>
      </div>
      {status === 'done' && (
        <div className="mt-4 bg-green-50 border border-green-100 rounded-lg p-3 text-green-700 text-sm animate-fade-in">
          <p className="font-medium">Conversion complete!</p>
          <p className="text-xs mt-1 text-green-600">Your SVG is ready to download.</p>
        </div>
      )}
    </div>
  );
};

export default ImagePreview; 