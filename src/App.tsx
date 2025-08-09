/**
 * Last checked: 2025-03-08
 */

// Last updated: 2025-03-11 - Force update to repository

import React, { useState, useCallback, useEffect } from 'react';
import { Settings, FileText, Layers, AlertTriangle, Terminal } from 'lucide-react';
import FileUpload from './components/FileUpload';
import ImagePreview from './components/ImagePreview';
import SettingsPanel from './components/SettingsPanel';
import DownloadButton from './components/DownloadButton';
import NetworkInfo from './components/NetworkInfo';
import ProcessingLogs from './components/ProcessingLogs';
import BatchConversion from './components/BatchConversion';
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
  const [showBatchConversion, setShowBatchConversion] = useState<boolean>(false);
  const [isElectronAvailable, setIsElectronAvailable] = useState<boolean>(false);
  const [showElectronWarning, setShowElectronWarning] = useState<boolean>(false);
  const [isConsoleVisible, setIsConsoleVisible] = useState<boolean>(false);
  
  // Add state for processing logs
  const [processingLogs, setProcessingLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobileView(window.innerWidth < 768);
    };

    window.addEventListener('resize', handleResize);
    
    // Check if we're running in Electron
    const checkElectron = () => {
      // More robust check for Electron environment
      const isElectron = window.electronAPI !== undefined;
      console.log('Electron environment detected:', isElectron);
      setIsElectronAvailable(isElectron);
      
      // Show warning if batch conversion is attempted in browser
      if (showBatchConversion && !isElectron) {
        setShowElectronWarning(true);
      }
    };
    
    checkElectron();
    
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBatchConversion]);

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
      } else if (param === 'color' || param === 'background') {
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

  // Expose the processImage function for batch processing
  const processImage = useCallback(async (imageData: string, params: TracingParams) => {
    try {
      return await processImageWithPotrace(
        imageData,
        params,
        () => {}, // We don't need the status callback for batch processing
        handleLogEntry
      );
    } catch (err) {
      console.error('Error in batch processing:', err);
      throw err;
    }
  }, [handleLogEntry]);

  // Handler for batch button click when not in Electron
  const handleBatchButtonClick = () => {
    if (isElectronAvailable) {
      setShowBatchConversion(true);
    } else {
      setShowElectronWarning(true);
      // Auto-hide the warning after 8 seconds
      setTimeout(() => setShowElectronWarning(false), 8000);
    }
  };

  // Handler for toggling console window
  const toggleConsole = async () => {
    if (!isElectronAvailable || !window.electronAPI) return;
    
    try {
      // Use a safe type casting approach
      const api = window.electronAPI as Record<string, any>;
      if (typeof api.toggleConsole === 'function') {
        const result = await api.toggleConsole();
        if (result && typeof result === 'object' && 'visible' in result) {
          setIsConsoleVisible(result.visible);
        }
      }
    } catch (error) {
      console.error('Error toggling console:', error);
    }
  };

  return (
    <div className="min-h-screen p-2 sm:p-4 md:p-8">
      {/* Electron Warning Banner */}
      {showElectronWarning && (
        <div className="fixed top-0 left-0 right-0 bg-amber-100 border-b border-amber-300 p-4 shadow-md z-50 animate-slide-down">
          <div className="max-w-5xl mx-auto flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-medium text-amber-800">Electron Required for Batch Processing</h3>
              <p className="text-amber-700 mt-1">
                Batch conversion requires filesystem access that's only available in the Electron app.
                Please close this browser window and run <span className="font-mono bg-amber-50 px-1 py-0.5 rounded">npm run electron:dev</span> in your terminal.
              </p>
            </div>
            <button 
              onClick={() => setShowElectronWarning(false)}
              className="text-amber-700 hover:text-amber-900"
            >
              &times;
            </button>
          </div>
        </div>
      )}
      
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
          
          <div className="flex gap-2">
            <button
              onClick={handleBatchButtonClick}
              className="flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-glass border border-gray-200 shadow-soft hover:shadow-md transition-all duration-300 text-sm sm:text-base"
            >
              <Layers className="w-4 h-4 sm:w-5 sm:h-5 text-orange-500" />
              <span className="font-medium">Batch Convert</span>
            </button>
            
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-glass border border-gray-200 shadow-soft hover:shadow-md transition-all duration-300 text-sm sm:text-base"
            >
              <Settings className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
              <span className="font-medium">Settings</span>
            </button>
          </div>
          
          {/* Add console toggle button if in Electron */}
          {isElectronAvailable && (
            <button
              onClick={toggleConsole}
              className="p-2 rounded-full hover:bg-blue-700 transition-colors"
              title="Toggle Debug Console"
            >
              <Terminal className="w-5 h-5" />
            </button>
          )}
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

      {/* Batch Conversion Modal */}
      {showBatchConversion && (
        <BatchConversion
          potraceParams={potraceParams}
          onClose={() => setShowBatchConversion(false)}
          processImage={processImage}
        />
      )}
    </div>
  );
}

export default App;