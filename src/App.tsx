import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Settings, FileText, Layers, AlertTriangle } from 'lucide-react';
import FileUpload from './components/FileUpload';
import ImagePreview from './components/ImagePreview';
import SettingsPanel from './components/SettingsPanel';
import DownloadButton from './components/DownloadButton';
import NetworkInfo from './components/NetworkInfo';
import ProcessingLogs from './components/ProcessingLogs';
import BatchConversion from './components/BatchConversion';
import {
  processImage as processImageWithPotrace,
  DEFAULT_PARAMS,
  PROGRESS_STEPS,
  getOptimizedFilename,
  TracingParams,
  simplifyForComplexImages,
  isNetworkClient,
} from './utils/imageProcessor';

type ConversionStatus = 'idle' | 'loading' | 'analyzing' | 'tracing' | 'colorProcessing' | 'optimizing' | 'done' | 'error';

interface LogEntry {
  id: string;
  step: string;
  message: string;
  isError: boolean;
  timestamp: string;
}

const SETTINGS_STORAGE_KEY = 'svgx-potrace-params';

const loadStoredParams = (): TracingParams => {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TracingParams>;
      return { ...DEFAULT_PARAMS, ...parsed };
    }
  } catch {
    // Corrupt storage — fall back to defaults
  }
  return { ...DEFAULT_PARAMS };
};

const handleNetworkError = (err: unknown, isNetwork: boolean): string => {
  const errorMsg = err instanceof Error ? err.message : String(err);
  if (isNetwork) {
    if (errorMsg.includes('timed out')) {
      return `Network processing timed out. For complex images over the network, try:\n• Using Complex Image Mode in settings\n• Using a smaller/simpler image\n• Running the app locally for better performance`;
    }
    return `Network error: ${errorMsg}. Try Complex Image Mode for better results over the network.`;
  }
  return errorMsg;
};

function App() {
  const [image, setImage] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [status, setStatus] = useState<ConversionStatus>('idle');
  const [error, setError] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [potraceParams, setPotraceParams] = useState<TracingParams>(loadStoredParams);
  const [fileName, setFileName] = useState('image');
  const [isMobileView, setIsMobileView] = useState(window.innerWidth < 768);
  const [isComplexMode, setIsComplexMode] = useState(false);
  const [showBatchConversion, setShowBatchConversion] = useState(false);
  const [isElectronAvailable, setIsElectronAvailable] = useState(false);
  const [showElectronWarning, setShowElectronWarning] = useState(false);
  const [processingLogs, setProcessingLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  // Use ref for log ID counter to survive HMR remounts without collisions
  const logIdCounter = useRef(0);
  const electronWarningTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setIsElectronAvailable(!!window.electronAPI);

    const handleResize = () => setIsMobileView(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (electronWarningTimer.current) clearTimeout(electronWarningTimer.current);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(potraceParams));
    } catch {
      // Storage quota exceeded — silently skip
    }
  }, [potraceParams]);

  const handleLogEntry = useCallback((step: string, message: string, isError: boolean, timestamp: string) => {
    const id = `${timestamp}-${++logIdCounter.current}`;
    setProcessingLogs(prev => [...prev, { id, step, message, isError, timestamp }]);
  }, []);

  // Only reset complex mode when user explicitly resets to defaults, not on every param tweak
  const handleParamChange = useCallback(<K extends keyof TracingParams>(param: K, value: TracingParams[K]) => {
    setPotraceParams(prev => ({ ...prev, [param]: value }));
  }, []);

  const resetParams = useCallback(() => {
    setPotraceParams({ ...DEFAULT_PARAMS });
    setIsComplexMode(false);
  }, []);

  const applyParams = useCallback(async (params: TracingParams) => {
    if (!image) return;
    setProcessingLogs([]);
    const isNetwork = isNetworkClient();
    try {
      setStatus('analyzing');
      setError('');
      // Network simplification is now applied inside processImage automatically
      const svgData = await processImageWithPotrace(
        image, params,
        newStatus => setStatus(newStatus as ConversionStatus),
        handleLogEntry
      );
      setSvg(svgData);
      setStatus('done');
    } catch (err) {
      setError(handleNetworkError(err, isNetwork));
      setStatus('error');
    }
  }, [image, handleLogEntry]);

  const applyCurrentParams = useCallback(() => applyParams(potraceParams), [applyParams, potraceParams]);

  const applyComplexSettings = useCallback(async () => {
    const complexParams = simplifyForComplexImages({ ...potraceParams });
    setPotraceParams(complexParams);
    setIsComplexMode(true);
    await applyParams(complexParams);
  }, [potraceParams, applyParams]);

  const handleImageSelect = useCallback(async (imageData: string, file: File) => {
    setImage(imageData);
    setFileName(getOptimizedFilename(file.name));
    setSvg(null);
    setError('');
    setProcessingLogs([]);
    const isNetwork = isNetworkClient();
    try {
      setStatus('analyzing');
      const svgData = await processImageWithPotrace(
        imageData, potraceParams,
        newStatus => setStatus(newStatus as ConversionStatus),
        handleLogEntry
      );
      setSvg(svgData);
      setStatus('done');
    } catch (err) {
      setError(handleNetworkError(err, isNetwork));
      setStatus('error');
    }
  }, [potraceParams, handleLogEntry]);

  const processImageForBatch = useCallback(async (imageData: string, params: TracingParams) => {
    return processImageWithPotrace(imageData, params, () => {}, handleLogEntry);
  }, [handleLogEntry]);

  const handleBatchButtonClick = () => {
    if (isElectronAvailable) {
      setShowBatchConversion(true);
    } else {
      setShowElectronWarning(true);
      if (electronWarningTimer.current) clearTimeout(electronWarningTimer.current);
      electronWarningTimer.current = setTimeout(() => setShowElectronWarning(false), 8000);
    }
  };

  return (
    <div className="min-h-screen p-2 sm:p-4 md:p-8">
      {showElectronWarning && (
        <div className="fixed top-0 left-0 right-0 bg-amber-100 border-b border-amber-300 p-4 shadow-md z-50 animate-slide-down">
          <div className="max-w-5xl mx-auto flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-medium text-amber-800">Electron Required for Batch Processing</h3>
              <p className="text-amber-700 mt-1">
                Batch conversion requires filesystem access only available in the Electron app. Run{' '}
                <span className="font-mono bg-amber-50 px-1 py-0.5 rounded text-sm">npm run electron:dev</span> in your terminal.
              </p>
            </div>
            <button
              onClick={() => setShowElectronWarning(false)}
              className="text-amber-700 hover:text-amber-900 text-lg leading-none"
              aria-label="Dismiss warning"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      <header className="max-w-5xl mx-auto mb-4 sm:mb-8 animate-fade-in">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gradient">SVG-X</h1>
            <p className="text-sm sm:text-base text-gray-600 mt-1">Convert images to SVG with ease</p>
          </div>

          <div className="flex gap-2 items-center">
            <button
              onClick={handleBatchButtonClick}
              className="flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-glass border border-gray-200 shadow-soft hover:shadow-md transition-all duration-300 text-sm sm:text-base"
              aria-label="Open batch conversion"
            >
              <Layers className="w-4 h-4 sm:w-5 sm:h-5 text-orange-500" />
              <span className="font-medium">Batch Convert</span>
            </button>

            <button
              onClick={() => setShowSettings(v => !v)}
              className="flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-glass border border-gray-200 shadow-soft hover:shadow-md transition-all duration-300 text-sm sm:text-base"
              aria-label="Open settings panel"
              aria-expanded={showSettings}
            >
              <Settings className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
              <span className="font-medium">Settings</span>
            </button>
          </div>
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
            <p className="text-sm sm:text-base whitespace-pre-line">{error}</p>
            <div className="mt-3 flex justify-between items-center flex-wrap gap-2">
              <button
                onClick={() => setShowLogs(true)}
                className="flex items-center text-blue-600 hover:text-blue-800 gap-1 text-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                View Processing Logs
              </button>
              <button
                onClick={isComplexMode ? applyCurrentParams : applyComplexSettings}
                className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
              >
                {isComplexMode ? 'Try Standard Mode' : 'Try Complex Mode'}
              </button>
            </div>
          </div>
        )}

        {status !== 'idle' && !error && (
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
              onClick={applyCurrentParams}
              className="btn btn-primary text-xs sm:text-sm"
            >
              Re-process
            </button>
          </div>
        )}
      </main>

      {showSettings && (
        <SettingsPanel
          {...potraceParams}
          onParamChange={handleParamChange}
          onReset={resetParams}
          onClose={() => setShowSettings(false)}
          onApply={image ? applyCurrentParams : undefined}
          onApplyComplex={applyComplexSettings}
          isMobile={isMobileView}
          isComplexMode={isComplexMode}
        />
      )}

      {svg && <DownloadButton svg={svg} filename={fileName} isMobile={isMobileView} />}

      <NetworkInfo isMobile={isMobileView} />

      <ProcessingLogs
        logs={processingLogs}
        visible={showLogs}
        onClose={() => setShowLogs(false)}
        onClear={() => setProcessingLogs([])}
      />

      {showBatchConversion && (
        <BatchConversion
          potraceParams={potraceParams}
          onClose={() => setShowBatchConversion(false)}
          processImage={processImageForBatch}
        />
      )}
    </div>
  );
}

export default App;
