import React, { useState, useCallback, useEffect } from 'react';
import { Settings } from 'lucide-react';
import FileUpload from './components/FileUpload';
import ImagePreview from './components/ImagePreview';
import SettingsPanel from './components/SettingsPanel';
import DownloadButton from './components/DownloadButton';
import NetworkInfo from './components/NetworkInfo';
import { processImage as processImageWithPotrace, DEFAULT_PARAMS, PROGRESS_STEPS, getOptimizedFilename, TracingParams, TurnPolicy, simplifyForComplexImages } from './utils/imageProcessor';

type ConversionStatus = 'idle' | 'loading' | 'processing' | 'tracing' | 'done' | 'error';

function App() {
  const [image, setImage] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [status, setStatus] = useState<ConversionStatus>('idle');
  const [error, setError] = useState<string>('');
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [potraceParams, setPotraceParams] = useState<TracingParams>({...DEFAULT_PARAMS});
  const [fileName, setFileName] = useState<string>('image');
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [isMobileView, setIsMobileView] = useState<boolean>(window.innerWidth < 768);
  const [isComplexMode, setIsComplexMode] = useState<boolean>(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobileView(window.innerWidth < 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle parameter changes
  const handleParamChange = (param: string, value: any) => {
    // Turn off complex mode when user manually adjusts settings
    if (isComplexMode) {
      setIsComplexMode(false);
    }
    
    setPotraceParams(prev => {
      if (param === 'turnPolicy') {
        return {
          ...prev,
          [param]: value as TurnPolicy
        };
      } else if (param === 'optCurve' || param === 'blackOnWhite' || param === 'invert' || param === 'highestQuality') {
        return {
          ...prev,
          [param]: value
        };
      } else {
        return {
          ...prev,
          [param]: Number(value)
        };
      }
    });
  };

  // Reset parameters to default
  const resetParams = () => {
    setPotraceParams({...DEFAULT_PARAMS});
    setIsComplexMode(false);
  };

  // Apply complex image optimization settings
  const applyComplexSettings = async () => {
    setPotraceParams(prev => simplifyForComplexImages(prev));
    setIsComplexMode(true);
    
    // Apply the changes immediately if an image is loaded
    if (image) {
      try {
        setStatus('processing');
        const svgData = await processImageWithPotrace(
          image,
          simplifyForComplexImages(potraceParams),
          (newStatus) => setStatus(newStatus as ConversionStatus)
        );
        setSvg(svgData);
        setStatus('done');
      } catch (err) {
        console.error('Error processing image with complex settings:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setStatus('error');
      }
    }
  };

  // Apply current parameters to the loaded image
  const applyParams = async () => {
    if (!image) return;
    
    try {
      setStatus('processing');
      const svgData = await processImageWithPotrace(
        image,
        potraceParams,
        (newStatus) => setStatus(newStatus as ConversionStatus)
      );
      setSvg(svgData);
      setStatus('done');
    } catch (err) {
      console.error('Error processing image:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  };

  const handleImageSelect = useCallback(async (imageData: string, file: File) => {
    setImage(imageData);
    setCurrentFile(file);
    setFileName(getOptimizedFilename(file.name));
    setSvg(null);
    setError('');
    
    try {
      setStatus('processing');
      const svgData = await processImageWithPotrace(
        imageData,
        potraceParams,
        (newStatus) => setStatus(newStatus as ConversionStatus)
      );
      setSvg(svgData);
      setStatus('done');
    } catch (err) {
      console.error('Error processing image:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }, [potraceParams]);

  return (
    <div className="min-h-screen p-2 sm:p-4 md:p-8">
      <header className="max-w-5xl mx-auto mb-4 sm:mb-8 animate-fade-in">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gradient">
              SVG Bolt
            </h1>
            <p className="text-sm sm:text-base text-gray-600 mt-1">
              Convert images to SVG with ease
            </p>
          </div>
          
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-glass border border-gray-200 shadow-soft hover:shadow-md transition-all duration-300 text-sm sm:text-base"
          >
            <Settings className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
            <span className="font-medium">Settings</span>
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto">
        {!image ? (
          <FileUpload onImageSelect={handleImageSelect} isMobile={isMobileView} />
        ) : (
          <ImagePreview 
            image={image} 
            svg={svg} 
            status={status} 
            progressSteps={PROGRESS_STEPS}
            isMobile={isMobileView}
          />
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 sm:px-4 py-2 sm:py-3 rounded-lg animate-fade-in shadow-soft mt-4">
            <h3 className="text-base sm:text-lg font-semibold mb-1">Error</h3>
            <p className="text-sm sm:text-base">{error}</p>
            <div className="mt-2 text-xs sm:text-sm">
              <p className="font-medium">Suggestions:</p>
              <ul className="list-disc list-inside mt-1">
                <li>Try a smaller or less complex image</li>
                <li>Adjust threshold settings to improve contrast</li>
                <li>Increase turdSize to remove small details</li>
                <li>Try a different turn policy</li>
              </ul>
            </div>
          </div>
        )}

        {image && (
          <div className="flex flex-wrap gap-2 sm:gap-4 justify-center mt-4 sm:mt-6 animate-fade-in">
            <button
              onClick={() => {
                setImage(null);
                setSvg(null);
                setStatus('idle');
                setError('');
              }}
              className="btn btn-secondary text-xs sm:text-sm"
            >
              Upload New Image
            </button>
            
            <button
              onClick={applyParams}
              className="btn btn-primary text-xs sm:text-sm"
            >
              Re-process
            </button>
          </div>
        )}
      </main>

      {/* Settings Panel */}
      {showSettings && (
        <SettingsPanel
          {...potraceParams}
          onParamChange={handleParamChange}
          onReset={resetParams}
          onClose={() => setShowSettings(false)}
          onApply={image ? applyParams : undefined}
          onApplyComplex={applyComplexSettings}
          isMobile={isMobileView}
          isComplexMode={isComplexMode}
        />
      )}

      {/* Download Button */}
      {svg && <DownloadButton svg={svg} filename={fileName} isMobile={isMobileView} />}

      {/* Network Info Component */}
      <NetworkInfo isMobile={isMobileView} />
    </div>
  );
}

export default App;