import React, { useState, useCallback } from 'react';
import { Settings } from 'lucide-react';
import FileUpload from './components/FileUpload';
import ImagePreview from './components/ImagePreview';
import SettingsPanel from './components/SettingsPanel';
import DownloadButton from './components/DownloadButton';
import { processImage as processImageWithPotrace, DEFAULT_PARAMS, PROGRESS_STEPS, getOptimizedFilename, TracingParams, TurnPolicy } from './utils/imageProcessor';

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

  // Handle parameter changes
  const handleParamChange = (param: string, value: any) => {
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
    <div className="min-h-screen p-4 md:p-8">
      <header className="max-w-5xl mx-auto mb-8 animate-fade-in">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gradient">
              SVG Bolt
            </h1>
            <p className="text-gray-600 mt-1">
              Convert images to SVG with ease
            </p>
          </div>
          
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-glass border border-gray-200 shadow-soft hover:shadow-md transition-all duration-300"
          >
            <Settings className="w-5 h-5 text-blue-600" />
            <span className="font-medium">Settings</span>
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto space-y-8">
        {!image ? (
          <FileUpload onImageSelect={handleImageSelect} />
        ) : (
          <ImagePreview 
            image={image} 
            svg={svg} 
            status={status} 
            progressSteps={PROGRESS_STEPS}
          />
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg animate-fade-in shadow-soft">
            <h3 className="text-lg font-semibold mb-1">Error</h3>
            <p>{error}</p>
          </div>
        )}

        {image && (
          <div className="flex gap-4 justify-center mt-6 animate-fade-in">
            <button
              onClick={() => {
                setImage(null);
                setSvg(null);
                setStatus('idle');
                setError('');
              }}
              className="btn btn-secondary"
            >
              Upload New Image
            </button>
            
            <button
              onClick={applyParams}
              className="btn btn-primary"
            >
              Re-process with Current Settings
            </button>
          </div>
        )}
      </main>

      {/* Settings Panel */}
      {showSettings && (
        <SettingsPanel
          turdSize={potraceParams.turdSize}
          alphaMax={potraceParams.alphaMax}
          optCurve={potraceParams.optCurve}
          optTolerance={potraceParams.optTolerance}
          threshold={potraceParams.threshold}
          blackOnWhite={potraceParams.blackOnWhite}
          color={potraceParams.color}
          background={potraceParams.background}
          turnPolicy={potraceParams.turnPolicy}
          invert={potraceParams.invert}
          highestQuality={potraceParams.highestQuality}
          onParamChange={handleParamChange}
          onReset={resetParams}
          onClose={() => setShowSettings(false)}
          onApply={image ? applyParams : undefined}
        />
      )}

      {/* Download Button */}
      {svg && <DownloadButton svg={svg} filename={fileName} />}

      <footer className="max-w-5xl mx-auto mt-12 pt-6 border-t border-gray-200 text-center text-gray-500 text-sm animate-fade-in">
        <p>SVG Bolt &copy; {new Date().getFullYear()}</p>
        <p className="mt-1">
          Built with Electron and Potrace for fast, efficient image-to-SVG conversion.
        </p>
      </footer>
    </div>
  );
}

export default App;