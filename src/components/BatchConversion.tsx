import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  FolderInput, FolderOutput, Play, Square, X, RotateCw,
  Loader2, CheckCircle2, AlertCircle, ImageIcon, FolderOpen, Settings
} from 'lucide-react';
import { TracingParams, getOptimizedFilename } from '../utils/imageProcessor';

interface BatchConversionProps {
  potraceParams: TracingParams;
  onClose: () => void;
  processImage: (imageData: string, params: TracingParams) => Promise<string>;
}

interface BatchProcessingStats {
  total: number;
  completed: number;
  failed: number;
}

interface ProcessingItem {
  filePath: string;
  fileName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

interface ResizeOptions {
  enabled: boolean;
  width: number;
  height: number;
  maintainAspectRatio: boolean;
}

// Reads a file as a data URL and optionally resizes it via Electron IPC.
// Defined outside the component to avoid stale closure issues.
async function readFileAsDataURL(
  filePath: string,
  resizeOptions: ResizeOptions
): Promise<string> {
  if (!window.electronAPI) throw new Error('Electron API unavailable');

  const result = await window.electronAPI.readImageFile(filePath);
  if (typeof result !== 'string') throw new Error(result.error || 'Failed to read image file');

  if (resizeOptions.enabled && typeof window.electronAPI.resizeImage === 'function') {
    try {
      const resized = await window.electronAPI.resizeImage!({
        imageData: result,
        width: resizeOptions.width,
        height: resizeOptions.height,
        maintainAspectRatio: resizeOptions.maintainAspectRatio
      });
      if (typeof resized === 'string') return resized;
      console.warn('Resize failed, using original:', (resized as { error: string }).error);
    } catch (e) {
      console.warn('Resize error, using original:', e);
    }
  } else if (resizeOptions.enabled) {
    console.warn('resizeImage not available in this build — resize skipped');
  }

  return result;
}

const ConfirmDialog: React.FC<{
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ message, onConfirm, onCancel }) => (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
    <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-5">
      <p className="text-sm text-gray-700 mb-4 whitespace-pre-wrap">{message}</p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  </div>
);

const BatchConversion: React.FC<BatchConversionProps> = ({ potraceParams, onClose, processImage }) => {
  const [inputDirectory, setInputDirectory] = useState<string | null>(null);
  const [outputDirectory, setOutputDirectory] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingItems, setProcessingItems] = useState<ProcessingItem[]>([]);
  const [stats, setStats] = useState<BatchProcessingStats>({ total: 0, completed: 0, failed: 0 });
  const [currentFileIndex, setCurrentFileIndex] = useState<number>(-1);
  const [isElectronEnvironment, setIsElectronEnvironment] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; resolve: (v: boolean) => void } | null>(null);
  const [resizeOptions, setResizeOptions] = useState<ResizeOptions>({
    enabled: false, width: 512, height: 512, maintainAspectRatio: true
  });
  const [showResizeSettings, setShowResizeSettings] = useState(false);
  const [resizeSkippedWarning, setResizeSkippedWarning] = useState(false);

  // Refs to avoid stale closures in the processing effect
  const resizeOptionsRef = useRef<ResizeOptions>(resizeOptions);
  const filenameCounts = useRef<Record<string, number>>({});
  const isCancelled = useRef(false);
  const processingItemsRef = useRef<ProcessingItem[]>([]);

  // Keep refs in sync
  useEffect(() => { processingItemsRef.current = processingItems; }, [processingItems]);
  useEffect(() => { resizeOptionsRef.current = resizeOptions; }, [resizeOptions]);

  // Reset collision counter on new input directory
  useEffect(() => { filenameCounts.current = {}; }, [inputDirectory]);

  useEffect(() => {
    const hasElectron = !!window.electronAPI;
    setIsElectronEnvironment(hasElectron);
    if (!hasElectron) {
      setErrorMessage('Batch conversion requires the Electron app. Please run SVG-X as a desktop application to use this feature.');
    }
    // Warn if resize is enabled but resizeImage isn't available
    if (hasElectron && !window.electronAPI!.resizeImage) {
      setResizeSkippedWarning(true);
    }
  }, []);

  const showConfirm = (message: string): Promise<boolean> =>
    new Promise(resolve => setConfirm({ message, resolve }));

  const handleSelectInputDirectory = async () => {
    if (!window.electronAPI) return;
    try {
      const selectedDir = await window.electronAPI.selectInputDirectory();
      if (!selectedDir) return;
      setInputDirectory(selectedDir);
      setErrorMessage(null);

      const files = await window.electronAPI.readDirectory(selectedDir);
      if (!Array.isArray(files)) {
        setErrorMessage(`Error reading directory: ${'error' in files ? files.error : 'Unknown error'}`);
        return;
      }

      const items: ProcessingItem[] = files
        .filter(fp => /\.(jpe?g|png|gif|bmp|webp)$/i.test(fp))
        .map(fp => ({
          filePath: fp,
          fileName: fp.split(/[/\\]/).pop() || fp,
          status: 'pending'
        }));

      if (items.length === 0) {
        setErrorMessage('No supported image files found in the selected directory (PNG, JPG, GIF, BMP, WEBP).');
        return;
      }

      setProcessingItems(items);
      setStats({ total: items.length, completed: 0, failed: 0 });
    } catch (error) {
      setErrorMessage(`Error selecting directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleSelectOutputDirectory = async () => {
    if (!window.electronAPI) return;
    try {
      const selectedDir = await window.electronAPI.selectOutputDirectory();
      if (selectedDir) setOutputDirectory(selectedDir);
    } catch (error) {
      setErrorMessage(`Error selecting directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const startBatchProcessing = async () => {
    if (!inputDirectory || !outputDirectory || processingItems.length === 0) return;

    const confirmed = await showConfirm(
      `Process ${processingItems.length} image file${processingItems.length !== 1 ? 's' : ''} from:\n${inputDirectory}\n\nSVGs will be saved to:\n${outputDirectory}`
    );
    setConfirm(null);
    if (!confirmed) return;

    isCancelled.current = false;
    filenameCounts.current = {};
    setStats({ total: processingItems.length, completed: 0, failed: 0 });
    setProcessingItems(items => items.map(item => ({ ...item, status: 'pending', error: undefined })));
    setIsProcessing(true);
    setCurrentFileIndex(0);
  };

  const cancelProcessing = () => {
    isCancelled.current = true;
    setIsProcessing(false);
    setCurrentFileIndex(-1);
  };

  const retryFailed = () => {
    isCancelled.current = false;
    const hasFailures = processingItems.some(i => i.status === 'failed');
    if (!hasFailures) return;
    // Reset filename collision counter so retried files don't get spurious suffixes
    filenameCounts.current = {};
    setProcessingItems(items =>
      items.map(item => item.status === 'failed' ? { ...item, status: 'pending', error: undefined } : item)
    );
    const firstFailed = processingItems.findIndex(i => i.status === 'failed');
    setIsProcessing(true);
    setCurrentFileIndex(firstFailed);
  };

  const openOutputDirectory = async () => {
    if (!outputDirectory || !window.electronAPI?.openOutputDirectory) return;
    try {
      await window.electronAPI.openOutputDirectory(outputDirectory);
    } catch {
      // Silently skip if shell.openPath fails
    }
  };

  // Processing loop — reads resizeOptions from ref to avoid stale closure
  useEffect(() => {
    if (!isProcessing || currentFileIndex < 0 || !window.electronAPI) return;

    const items = processingItemsRef.current;
    if (currentFileIndex >= items.length) {
      setIsProcessing(false);
      setCurrentFileIndex(-1);
      return;
    }

    const timeoutId = setTimeout(async () => {
      if (isCancelled.current) {
        setIsProcessing(false);
        setCurrentFileIndex(-1);
        return;
      }

      const currentItem = items[currentFileIndex];
      if (currentItem.status !== 'pending') {
        setCurrentFileIndex(idx => idx + 1);
        return;
      }

      setProcessingItems(prev =>
        prev.map((item, idx) => idx === currentFileIndex ? { ...item, status: 'processing' } : item)
      );

      try {
        // Use the ref so we always have current resize options without re-running the effect
        const fileData = await readFileAsDataURL(currentItem.filePath, resizeOptionsRef.current);
        const svgData = await processImage(fileData, potraceParams);

        const baseSlug = getOptimizedFilename(currentItem.fileName);
        const count = filenameCounts.current[baseSlug] || 0;
        filenameCounts.current[baseSlug] = count + 1;
        const finalFileName = count === 0 ? baseSlug : `${baseSlug}-${count}`;

        const outputPath = window.electronAPI!.joinPaths
          ? await window.electronAPI!.joinPaths!(outputDirectory!, `${finalFileName}.svg`)
          : `${outputDirectory!.replace(/[/\\]$/, '')}/${finalFileName}.svg`;

        const saveResult = await window.electronAPI!.saveSvg({ svgData, outputPath });
        if (!('success' in saveResult && saveResult.success)) {
          throw new Error('error' in saveResult ? saveResult.error : 'Failed to save SVG');
        }

        setProcessingItems(prev =>
          prev.map((item, idx) => idx === currentFileIndex ? { ...item, status: 'completed' } : item)
        );
        setStats(prev => ({ ...prev, completed: prev.completed + 1 }));
      } catch (error) {
        setProcessingItems(prev =>
          prev.map((item, idx) =>
            idx === currentFileIndex
              ? { ...item, status: 'failed', error: error instanceof Error ? error.message : String(error) }
              : item
          )
        );
        setStats(prev => ({ ...prev, failed: prev.failed + 1 }));
      }

      if (!isCancelled.current) {
        setCurrentFileIndex(idx => idx + 1);
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [isProcessing, currentFileIndex, outputDirectory, potraceParams, processImage]);

  const percentage = stats.total > 0
    ? Math.round(((stats.completed + stats.failed) / stats.total) * 100)
    : 0;

  const batchDone = !isProcessing && currentFileIndex === -1 && stats.total > 0 &&
    (stats.completed + stats.failed) === stats.total;
  const hasFailed = processingItems.some(i => i.status === 'failed');
  const currentlyProcessing = isProcessing ? processingItems.find(i => i.status === 'processing') : null;

  const settingsSummary = [
    potraceParams.colorMode
      ? `Color (${potraceParams.colorSteps} steps, ${potraceParams.fillStrategy})`
      : `B&W`,
    `threshold ${potraceParams.threshold}`,
    `speckle ${potraceParams.turdSize}`
  ].join(' · ');

  return (
    <>
      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          onConfirm={() => { setConfirm(null); confirm.resolve(true); }}
          onCancel={() => { setConfirm(null); confirm.resolve(false); }}
        />
      )}

      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg w-full max-w-3xl max-h-[85vh] overflow-y-auto p-4 sm:p-6 shadow-xl">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-xl font-bold">Batch Conversion</h2>
              <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                <Settings className="w-3 h-3" />
                <span>{settingsSummary}</span>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={isProcessing}
              className="p-1.5 rounded-full hover:bg-gray-200 transition-colors disabled:opacity-40"
              aria-label="Close batch conversion"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {errorMessage && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium mb-1">{isElectronEnvironment ? 'Error' : 'Electron Required'}</p>
                  <p>{errorMessage}</p>
                  {!isElectronEnvironment && (
                    <code className="block mt-2 px-2 py-1 bg-gray-100 text-gray-800 rounded text-xs font-mono">
                      npm run electron:dev
                    </code>
                  )}
                </div>
              </div>
            </div>
          )}

          {resizeSkippedWarning && resizeOptions.enabled && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>Pre-resize is not available in this build — images will be processed at original size.</span>
            </div>
          )}

          <div className="space-y-5">
            <div className="flex justify-end">
              <button
                onClick={() => setShowResizeSettings(v => !v)}
                className="btn btn-secondary flex items-center gap-2 text-sm"
                disabled={isProcessing}
              >
                <ImageIcon className="w-4 h-4" />
                Image Resize Options
              </button>
            </div>

            {showResizeSettings && (
              <div className="border rounded-lg p-4 bg-gray-50 text-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-gray-800">Resize Options</h3>
                  <button onClick={() => setShowResizeSettings(false)} className="p-1 hover:bg-gray-200 rounded" aria-label="Close resize options">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={resizeOptions.enabled}
                      onChange={e => setResizeOptions(p => ({ ...p, enabled: e.target.checked }))}
                      className="h-4 w-4 text-blue-600 rounded border-gray-300"
                    />
                    Enable pre-resize before vectorization
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Width (px)</label>
                      <input
                        type="number"
                        value={resizeOptions.width}
                        onChange={e => setResizeOptions(p => ({ ...p, width: Math.max(1, parseInt(e.target.value) || 1) }))}
                        disabled={!resizeOptions.enabled}
                        className="w-full px-2 py-1.5 border rounded text-sm disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Height (px)</label>
                      <input
                        type="number"
                        value={resizeOptions.height}
                        onChange={e => setResizeOptions(p => ({ ...p, height: Math.max(1, parseInt(e.target.value) || 1) }))}
                        disabled={!resizeOptions.enabled}
                        className="w-full px-2 py-1.5 border rounded text-sm disabled:opacity-50"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={resizeOptions.maintainAspectRatio}
                      onChange={e => setResizeOptions(p => ({ ...p, maintainAspectRatio: e.target.checked }))}
                      disabled={!resizeOptions.enabled}
                      className="h-4 w-4 text-blue-600 rounded border-gray-300 disabled:opacity-50"
                    />
                    <span className={resizeOptions.enabled ? '' : 'opacity-50'}>Maintain aspect ratio</span>
                  </label>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <button
                  onClick={handleSelectInputDirectory}
                  disabled={isProcessing}
                  className="btn btn-primary flex items-center gap-2"
                >
                  <FolderInput className="w-4 h-4" />
                  Select Input Directory
                </button>
                {inputDirectory && (
                  <span className="text-sm text-gray-600 truncate" title={inputDirectory}>
                    <span className="font-medium">Input:</span> {inputDirectory}
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <button
                  onClick={handleSelectOutputDirectory}
                  disabled={isProcessing}
                  className="btn btn-primary flex items-center gap-2"
                >
                  <FolderOutput className="w-4 h-4" />
                  Select Output Directory
                </button>
                {outputDirectory && (
                  <span className="text-sm text-gray-600 truncate" title={outputDirectory}>
                    <span className="font-medium">Output:</span> {outputDirectory}
                  </span>
                )}
              </div>
            </div>

            {processingItems.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <div className="p-3 bg-gray-50 border-b">
                  <div className="flex justify-between items-baseline mb-2">
                    <div className="font-medium text-sm">Files: {stats.total}</div>
                    {currentlyProcessing && (
                      <span className="text-xs text-blue-600 font-medium truncate max-w-[200px]" title={currentlyProcessing.filePath}>
                        {currentlyProcessing.fileName}
                      </span>
                    )}
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>Done: <span className="text-green-600 font-medium">{stats.completed}</span></span>
                    <span>Failed: <span className="text-red-600 font-medium">{stats.failed}</span></span>
                    <span>Remaining: <span className="text-blue-600 font-medium">{Math.max(0, stats.total - stats.completed - stats.failed)}</span></span>
                  </div>
                </div>

                <div className="max-h-60 overflow-y-auto divide-y divide-gray-100">
                  {processingItems.map(item => (
                    <div
                      key={item.filePath}
                      className={`flex justify-between items-center px-3 py-2 text-sm ${
                        item.status === 'processing' ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'
                      }`}
                    >
                      <div className="truncate max-w-xs text-gray-700" title={item.filePath}>
                        {item.fileName}
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        {item.status === 'pending' && <span className="text-gray-400 text-xs">Pending</span>}
                        {item.status === 'processing' && (
                          <span className="flex items-center text-blue-600 text-xs gap-1">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing
                          </span>
                        )}
                        {item.status === 'completed' && (
                          <span className="flex items-center text-green-600 text-xs gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Done
                          </span>
                        )}
                        {item.status === 'failed' && (
                          <span
                            className="flex items-center text-red-600 text-xs gap-1 cursor-help"
                            title={item.error || 'Unknown error'}
                          >
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Failed</span>
                            {item.error && (
                              <span className="hidden sm:inline text-red-400 truncate max-w-[120px]">: {item.error}</span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              {batchDone && hasFailed && (
                <button
                  onClick={retryFailed}
                  className="btn btn-secondary flex items-center gap-2"
                >
                  <RotateCw className="w-4 h-4" />
                  Retry Failed ({stats.failed})
                </button>
              )}

              {batchDone && outputDirectory && typeof window.electronAPI?.openOutputDirectory === 'function' && (
                <button
                  onClick={openOutputDirectory}
                  className="btn btn-secondary flex items-center gap-2"
                >
                  <FolderOpen className="w-4 h-4" />
                  Open Output Folder
                </button>
              )}

              {isProcessing ? (
                <button
                  onClick={cancelProcessing}
                  className="btn flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white"
                >
                  <Square className="w-4 h-4" />
                  Cancel
                </button>
              ) : (
                <button
                  onClick={startBatchProcessing}
                  disabled={!inputDirectory || !outputDirectory || processingItems.length === 0}
                  className="btn btn-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Play className="w-4 h-4" />
                  Start Batch Processing
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default BatchConversion;
