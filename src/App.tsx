import React from 'react';
import { Upload, Image as ImageIcon, Download, Settings } from 'lucide-react';
import { useState, useCallback } from 'react';
import * as Potrace from 'potrace';
// Add debug logging for Potrace
console.log('Potrace version: initialized');

// Utility function to handle the TypeScript type issue
const trace = (
  image: { data: Uint8Array; width: number; height: number },
  options: any,
  callback: (err: Error | null, svg?: string) => void
) => {
  (Potrace as any).trace(image, options, callback);
};

type ConversionStatus = 'idle' | 'loading' | 'processing' | 'tracing' | 'done' | 'error';

const progressSteps: Record<ConversionStatus, string> = {
  idle: 'Ready to convert',
  loading: 'Loading image...',
  processing: 'Processing image...',
  tracing: 'Generating SVG...',
  done: 'Conversion complete!',
  error: 'Error occurred',
};

// Default Potrace parameters as a constant
const DEFAULT_POTRACE_PARAMS = {
  turdSize: 2,        // Suppress speckles of this size (smaller number = more details)
  alphaMax: 1,        // Corner threshold parameter
  optCurve: true,     // Curve optimization
  optTolerance: 0.2,  // Curve optimization tolerance
  threshold: 128,     // Threshold below which colors are converted to black
  blackOnWhite: true, // Fill black areas
  background: '#fff', // Background color
  color: '#000'       // Foreground color
};

function App() {
  const [image, setImage] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [status, setStatus] = useState<ConversionStatus>('idle');
  const [error, setError] = useState<string>('');
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [potraceParams, setPotraceParams] = useState({...DEFAULT_POTRACE_PARAMS});

  // Handle parameter changes
  const handleParamChange = (param: string, value: any) => {
    setPotraceParams(prev => ({
      ...prev,
      [param]: param === 'optCurve' || param === 'blackOnWhite' ? value : Number(value)
    }));
  };

  // Reset parameters to default
  const resetParams = () => {
    setPotraceParams({...DEFAULT_POTRACE_PARAMS});
  };

  const processImage = useCallback(async (imageData: ImageData): Promise<string> => {
    try {
      console.log('Starting image processing...', { width: imageData.width, height: imageData.height });
      const { data, width, height } = imageData;
      
      // Convert to grayscale
      console.log('Converting to grayscale...');
      
      // Instead of just converting to grayscale data array, let's draw this to a canvas
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      
      // Fill with white background first
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, width, height);
      
      // Draw image data with grayscale
      const imgData = ctx.createImageData(width, height);
      let blackPixelCount = 0;
      
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const grayscale = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        
        // Set value in the new image data
        imgData.data[i] = grayscale;     // R
        imgData.data[i + 1] = grayscale; // G
        imgData.data[i + 2] = grayscale; // B
        imgData.data[i + 3] = 255;       // Alpha
        
        if (grayscale < potraceParams.threshold) blackPixelCount++;
      }
      
      // Put the image data onto the canvas
      ctx.putImageData(imgData, 0, 0);
      
      console.log(`Found ${blackPixelCount} black pixels out of ${width * height} total pixels`);
      
      if (blackPixelCount === 0) {
        throw new Error('No black pixels found in the image. Please ensure your image has dark lines or content.');
      }

      return new Promise((resolve, reject) => {
        // Instead of passing raw pixel data, use the canvas data URL
        // which Potrace can process correctly through Jimp
        try {
          console.log('Starting Potrace trace...');
          const dataUrl = canvas.toDataURL('image/png');
          
          // Use the Potrace.trace function with the data URL
          (Potrace as any).trace(dataUrl, potraceParams, (err: Error | null, svg?: string) => {
            if (err) {
              console.error('Potrace trace error:', err);
              reject(new Error(`Potrace failed: ${err.message}`));
              return;
            }
            
            if (!svg) {
              reject(new Error('Potrace returned empty SVG'));
              return;
            }
            
            console.log('SVG generation complete! SVG length:', svg.length);
            resolve(svg);
          });
        } catch (traceError) {
          console.error('Failed to trace image:', traceError);
          reject(new Error('Failed to trace image with Potrace'));
        }
      });
    } catch (error) {
      console.error('Error in image processing:', error);
      throw error;
    }
  }, [potraceParams]);

  // Reprocess the current image with new settings
  const reprocessImage = useCallback(() => {
    if (!image || status === 'processing' || status === 'tracing') return;
    
    // Reset SVG and start processing again
    setSvg(null);
    setStatus('processing');
    
    const img = new Image();
    img.onload = async () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        
        let width = img.width;
        let height = img.height;
        const maxDimension = 1000;
        
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        
        const imageData = ctx.getImageData(0, 0, width, height);
        
        setStatus('tracing');
        const svgData = await processImage(imageData);
        
        setSvg(svgData);
        setStatus('done');
      } catch (error) {
        console.error('Reprocessing error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        setError(`Error processing image: ${errorMessage}`);
        setStatus('error');
      }
    };
    
    img.onerror = () => {
      setError('Failed to load image for reprocessing.');
      setStatus('error');
    };
    
    img.src = image;
  }, [image, processImage, status]);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    console.log('File selected:', { name: file.name, size: file.size, type: file.type });

    if (file.size > 10 * 1024 * 1024) {
      setError('File size exceeds 10MB limit');
      setStatus('error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      
      setError('');
      setStatus('loading');
      setImage(dataUrl);
      setSvg(null);

      try {
        console.log('Loading image...');
        const img = new Image();
        
        img.onerror = (e) => {
          console.error('Image load error:', e);
          setError('Failed to load image. Please try a different file.');
          setStatus('error');
        };
        
        img.onload = async () => {
          try {
            console.log('Image loaded:', { width: img.width, height: img.height });
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d')!;
            
            let width = img.width;
            let height = img.height;
            const maxDimension = 1000;
            
            if (width > maxDimension || height > maxDimension) {
              if (width > height) {
                height = Math.round((height * maxDimension) / width);
                width = maxDimension;
              } else {
                width = Math.round((width * maxDimension) / height);
                height = maxDimension;
              }
              console.log('Image scaled to:', { width, height });
            }
            
            canvas.width = width;
            canvas.height = height;
            
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            
            setStatus('processing');
            const imageData = ctx.getImageData(0, 0, width, height);
            
            setStatus('tracing');
            const svgData = await processImage(imageData);
            
            if (!svgData || svgData.trim() === '') {
              throw new Error('Generated SVG is empty');
            }
            
            setSvg(svgData);
            setStatus('done');
            console.log('Conversion complete!');
          } catch (error) {
            console.error('Processing error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            setError(`Error processing image: ${errorMessage}`);
            setStatus('error');
          }
        };
        
        img.src = dataUrl;
      } catch (error) {
        console.error('File reading error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        setError(`Error converting image: ${errorMessage}`);
        setStatus('error');
      }
    };
    
    reader.onerror = (error) => {
      console.error('FileReader error:', error);
      setError('Failed to read file. Please try again.');
      setStatus('error');
    };
    
    reader.readAsDataURL(file);
  }, [processImage]);

  const handleDownload = useCallback(() => {
    if (status !== 'done' || !svg) return;
    
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'converted.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [svg, status]);

  // Settings panel component
  const SettingsPanel = () => (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6 animate-fade-in">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-lg flex items-center">
          <Settings className="w-4 h-4 mr-2" />
          Tracing Options
        </h3>
        <div className="flex space-x-2">
          <button 
            onClick={resetParams} 
            className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
          >
            Reset Defaults
          </button>
          <button 
            onClick={() => setShowSettings(false)}
            className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
          >
            Close
          </button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Detail Level (turdSize: {potraceParams.turdSize})
          </label>
          <div className="text-xs text-gray-500 mb-1">
            Lower values keep more details (1-10)
          </div>
          <input 
            type="range" 
            min="1" 
            max="10" 
            step="1"
            value={potraceParams.turdSize} 
            onChange={(e) => handleParamChange('turdSize', e.target.value)}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Threshold: {potraceParams.threshold}
          </label>
          <div className="text-xs text-gray-500 mb-1">
            Controls black/white cutoff (0-255)
          </div>
          <input 
            type="range" 
            min="0" 
            max="255" 
            step="1"
            value={potraceParams.threshold} 
            onChange={(e) => handleParamChange('threshold', e.target.value)}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Corner Threshold (alphaMax: {potraceParams.alphaMax.toFixed(1)})
          </label>
          <div className="text-xs text-gray-500 mb-1">
            Higher values make smoother corners (0.1-1.5)
          </div>
          <input 
            type="range" 
            min="0.1" 
            max="1.5" 
            step="0.1"
            value={potraceParams.alphaMax} 
            onChange={(e) => handleParamChange('alphaMax', e.target.value)}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Curve Optimization
          </label>
          <div className="flex items-center mt-2">
            <input 
              type="checkbox" 
              checked={potraceParams.optCurve} 
              onChange={(e) => handleParamChange('optCurve', e.target.checked)}
              className="h-4 w-4 text-blue-600 rounded border-gray-300"
            />
            <span className="ml-2 text-sm text-gray-600">Enable curve optimization</span>
          </div>
        </div>
      </div>
      
      <div className="mt-4 text-xs text-gray-500 border-t pt-2">
        Changes will apply to the next conversion. If you've already uploaded an image, you'll need to convert it again to see the effect of new settings.
        
        {image && status !== 'processing' && status !== 'tracing' && (
          <button
            onClick={reprocessImage}
            className="mt-2 w-full bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded-md text-sm transition-colors"
          >
            Apply Changes to Current Image
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-4">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h1 className="text-2xl font-bold text-center mb-4">
            Image to SVG Converter
          </h1>
          
          <div className="flex justify-end mb-4">
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className="flex items-center text-sm text-gray-600 hover:text-gray-900 px-2 py-1 rounded-md hover:bg-gray-100"
            >
              <Settings className="w-4 h-4 mr-1" />
              {showSettings ? 'Hide Settings' : 'Show Settings'}
            </button>
          </div>
          
          {showSettings && <SettingsPanel />}
          
          <div className="space-y-6">
            <div className="relative">
              <input
                type="file"
                onChange={handleFileUpload}
                accept="image/*"
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50"
              >
                <Upload className="w-8 h-8 text-gray-500 mb-2" />
                <span className="text-sm text-gray-600">
                  Click to upload or drag and drop
                </span>
                <span className="text-xs text-gray-400 mt-1">
                  PNG, JPG, GIF up to 10MB
                </span>
              </label>
            </div>

            {/* Preview Section */}
            {image && (
              <div className="border border-gray-200 rounded-lg p-6 bg-gray-50/50 backdrop-blur-sm animate-fade-in">
                <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
                  <ImageIcon className="w-5 h-5 mr-2 text-gray-600" />
                  Preview
                </h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  {/* Progress Indicator */}
                  {status !== 'idle' && status !== 'done' && (
                    <div className="sm:col-span-2 bg-gray-50/80 border border-gray-200 rounded-xl p-4 mb-4 animate-fade-in">
                      <div className="flex items-center space-x-3">
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-600 border-t-transparent"></div>
                        <span className="text-gray-700 font-medium">
                          {progressSteps[status]}
                        </span>
                      </div>
                      <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-gray-600 to-blue-600 transition-all duration-500 ease-out"
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
                  <div>
                    <p className="text-sm text-gray-600 font-medium mb-2">Original Image:</p>
                    <img
                      src={image}
                      alt="Original"
                      className="w-full h-auto rounded-lg border border-gray-200 bg-white object-contain max-h-[300px] shadow-sm"
                    />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 font-medium mb-2">SVG Output:</p>
                    {svg ? (
                      <div
                        dangerouslySetInnerHTML={{ __html: svg }}
                        className="bg-white border border-gray-200 rounded-xl p-4 w-full h-auto max-h-[300px] overflow-hidden shadow-sm"
                      />
                    ) : (
                      <div className="h-[300px] border border-gray-200 rounded-xl bg-white/50 flex items-center justify-center p-4 text-center">
                        <span className="text-gray-400">
                          {status === 'idle' ? 'Upload an image to see the SVG output' : 'Processing...'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Download Button */}
            {status === 'done' && (
              <button
                onClick={handleDownload}
                className="w-full bg-gradient-to-r from-gray-600 to-blue-600 hover:from-gray-700 hover:to-blue-700 text-white font-semibold py-4 px-6 rounded-xl flex items-center justify-center transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] shadow-lg"
              >
                <Download className="w-5 h-5 mr-2" />
                Download SVG
              </button>
            )}

            {/* Error Message */}
            {status === 'error' && (
              <div className="bg-red-50/80 backdrop-blur-sm border border-red-200 text-red-700 px-6 py-4 rounded-xl animate-fade-in">
                {error || 'An error occurred during conversion. Please try again with a different image.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;