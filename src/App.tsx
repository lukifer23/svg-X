import React, { useState, useCallback, useEffect } from 'react';
import { Settings, FileText } from 'lucide-react';
import FileUpload from './components/FileUpload';
import ImagePreview from './components/ImagePreview';
import SettingsPanel from './components/SettingsPanel';
import DownloadButton from './components/DownloadButton';
import NetworkInfo from './components/NetworkInfo';
import ProcessingLogs from './components/ProcessingLogs';
import { processImage as processImageWithPotrace, DEFAULT_PARAMS, PROGRESS_STEPS, getOptimizedFilename, TracingParams, TurnPolicy, simplifyForComplexImages, isNetworkClient, simplifyForNetworkClients } from './utils/imageProcessor';

type ConversionStatus = 'idle' | 'loading' | 'processing' | 'tracing' | 'done' | 'error';

// Define the LogEntry interface
interface LogEntry {
  step: string;
  message: string;
  isError: boolean;
  timestamp: string;
}

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
  
  // Add state for processing logs
  const [processingLogs, setProcessingLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);

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

  // Add a function to handle log entries
  const handleLogEntry = useCallback((step: string, message: string, isError: boolean, timestamp: string) => {
    setProcessingLogs(prevLogs => [...prevLogs, { step, message, isError, timestamp }]);
  }, []);

  // Apply complex image optimization settings
  const applyComplexSettings = async () => {
    // Clear previous logs when starting a new process
    setProcessingLogs([]);
    
    // Check if this is a network client
    const isNetwork = isNetworkClient();
    
    // Apply different settings based on whether it's a network client
    let complexParams;
    if (isNetwork) {
      complexParams = simplifyForNetworkClients({...potraceParams});
      console.log('Applying network-optimized complex settings:', complexParams);
    } else {
      complexParams = simplifyForComplexImages({...potraceParams});
      console.log('Applying complex image settings:', complexParams);
    }
    
    setPotraceParams(complexParams);
    setIsComplexMode(true);
    
    // Apply the changes immediately if an image is loaded
    if (image) {
      try {
        setStatus('processing');
        setError(''); // Clear any previous errors
        
        // Add a UI delay to update the status
        setTimeout(async () => {
          try {
            const svgData = await processImageWithPotrace(
              image,
              complexParams,
              (newStatus) => {
                setStatus(newStatus as ConversionStatus);
                console.log(`Status update: ${newStatus}`);
              },
              handleLogEntry // Pass the log handler
            );
            setSvg(svgData);
            setStatus('done');
          } catch (err) {
            console.error('Error processing image with complex settings:', err);
            
            // Provide more specific error messages for network users
            if (isNetwork) {
              const errorMsg = err instanceof Error ? err.message : 'Unknown error';
              if (errorMsg.includes('timed out')) {
                setError(`Network processing timed out. This image may be too complex to process over the network. 
                  Try downloading the app and running it locally for better performance.`);
              } else {
                setError(`Network error: ${errorMsg}. Network processing is more limited than local processing.`);
              }
            } else {
              setError(err instanceof Error ? err.message : 'Unknown error');
            }
            
            setStatus('error');
          }
        }, 300);
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
    
    // Clear previous logs when starting a new process
    setProcessingLogs([]);
    
    // Check if this is a network client
    const isNetwork = isNetworkClient();
    
    try {
      setStatus('processing');
      setError(''); // Clear any previous errors
      
      const svgData = await processImageWithPotrace(
        image,
        potraceParams,
        (newStatus) => setStatus(newStatus as ConversionStatus),
        handleLogEntry // Pass the log handler
      );
      setSvg(svgData);
      setStatus('done');
    } catch (err) {
      console.error('Error processing image:', err);
      
      // Provide more specific error messages for network users
      if (isNetwork) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        if (errorMsg.includes('timed out')) {
          setError(`Network processing timed out. For complex images over the network, try:
            1. Using the "Complex Image Mode" button in settings
            2. Using a smaller/simpler image
            3. Running the app locally instead of over the network`);
        } else {
          setError(`Network error: ${errorMsg}. Try using Complex Image Mode for better results over the network.`);
        }
      } else {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
      
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
              SVG-X
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

        {/* Error Messages */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 sm:px-4 py-2 sm:py-3 rounded-lg animate-fade-in shadow-soft mt-4">
            <h3 className="text-base sm:text-lg font-semibold mb-1">Error</h3>
            <p className="text-sm sm:text-base">{error}</p>
            <div className="mt-2 text-xs sm:text-sm">
              <p className="font-medium">Suggestions:</p>
              <ul className="list-disc pl-4 mt-1">
                <li>Try using Complex Image Mode in settings</li>
                <li>Use a simpler image with fewer details</li>
                <li>Try a different image format (PNG often works best)</li>
              </ul>
              
              <div className="mt-3 flex justify-between items-center">
                <button 
                  onClick={() => setShowLogs(true)}
                  className="flex items-center text-blue-600 hover:text-blue-800 gap-1 text-xs"
                >
                  <FileText className="w-3.5 h-3.5" />
                  View Processing Logs
                </button>
                
                <button
                  onClick={isComplexMode ? applyParams : applyComplexSettings}
                  className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                >
                  {isComplexMode ? 'Try Standard Mode' : 'Try Complex Mode'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Processing Logs Button - show only during/after processing */}
        {(status !== 'idle' && !error) && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={() => setShowLogs(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-200 transition-colors"
            >
              <FileText className="w-4 h-4" />
              View Processing Logs
            </button>
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

      {/* Processing Logs Component */}
      <ProcessingLogs
        logs={processingLogs}
        visible={showLogs}
        onClose={() => setShowLogs(false)}
      />
    </div>
  );
}

export default App;