import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  FolderInput, FolderOutput, Play, Square, X, RotateCw,
  Loader2, CheckCircle2, AlertCircle, ImageIcon, FolderOpen, Settings, Clock, SkipForward
} from 'lucide-react';
import { TracingParams, getOptimizedFilename } from '../utils/imageProcessor';

interface BatchConversionProps {
  potraceParams: TracingParams;
  onClose: () => void;
  processImage: (imageData: string, params: TracingParams) => Promise<string>;
}

interface BatchStats {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
}

interface ProcessingItem {
  filePath: string;
  fileName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
  error?: string;
  retryCount: number;
}

interface ResizeOptions {
  enabled: boolean;
  width: number;
  height: number;
  maintainAspectRatio: boolean;
}

async function readFileAsDataURL(filePath: string, resizeOptions: ResizeOptions): Promise<string> {
  if (!window.electronAPI) throw new Error('Electron API unavailable');
  const result = await window.electronAPI.readImageFile(filePath);
  if (typeof result !== 'string') throw new Error((result as { error: string }).error || 'Failed to read image');

  if (resizeOptions.enabled && typeof window.electronAPI.resizeImage === 'function') {
    try {
      const resized = await window.electronAPI.resizeImage!({
        imageData: result, width: resizeOptions.width,
        height: resizeOptions.height, maintainAspectRatio: resizeOptions.maintainAspectRatio,
      });
      if (typeof resized === 'string') return resized;
    } catch { /* fall through to original */ }
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
        <button onClick={onCancel} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded transition-colors">Cancel</button>
        <button onClick={onConfirm} className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors">Continue</button>
      </div>
    </div>
  </div>
);

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

const BatchConversion: React.FC<BatchConversionProps> = ({ potraceParams, onClose, processImage }) => {
  const [inputDirectory, setInputDirectory] = useState<string | null>(null);
  const [outputDirectory, setOutputDirectory] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingItems, setProcessingItems] = useState<ProcessingItem[]>([]);
  const [stats, setStats] = useState<BatchStats>({ total: 0, completed: 0, failed: 0, skipped: 0 });
  const [currentFileIndex, setCurrentFileIndex] = useState<number>(-1);
  const [isElectronEnvironment, setIsElectronEnvironment] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; resolve: (v: boolean) => void } | null>(null);
  const [resizeOptions, setResizeOptions] = useState<ResizeOptions>({ enabled: false, width: 512, height: 512, maintainAspectRatio: true });
  const [showResizeSettings, setShowResizeSettings] = useState(false);
  const [skipFailed, setSkipFailed] = useState(true);
  const [autoOpenOutput, setAutoOpenOutput] = useState(false);
  // ETA tracking
  const [avgMsPerFile, setAvgMsPerFile] = useState<number | null>(null);
  const [etaMs, setEtaMs] = useState<number | null>(null);

  const resizeOptionsRef = useRef<ResizeOptions>(resizeOptions);
  const skipFailedRef = useRef(skipFailed);
  const filenameCounts = useRef<Record<string, number>>({});
  const isCancelled = useRef(false);
  const processingItemsRef = useRef<ProcessingItem[]>([]);
  const fileStartTime = useRef<number>(0);
  const completedTimes = useRef<number[]>([]);

  useEffect(() => { processingItemsRef.current = processingItems; }, [processingItems]);
  useEffect(() => { resizeOptionsRef.current = resizeOptions; }, [resizeOptions]);
  useEffect(() => { skipFailedRef.current = skipFailed; }, [skipFailed]);
  useEffect(() => { filenameCounts.current = {}; }, [inputDirectory]);

  useEffect(() => {
    const hasElectron = !!window.electronAPI;
    setIsElectronEnvironment(hasElectron);
    if (!hasElectron) {
      setErrorMessage('Batch conversion requires the Electron app. Please run SVG-X as a desktop application.');
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
        .filter(fp => /\.(jpe?g|png|gif|bmp|webp|avif|heic|heif|tiff?)$/i.test(fp))
        .map(fp => ({
          filePath: fp,
          fileName: fp.split(/[/\\]/).pop() || fp,
          status: 'pending',
          retryCount: 0,
        }));

      if (items.length === 0) {
        setErrorMessage('No supported image files found (PNG, JPG, GIF, BMP, WEBP, AVIF, HEIC, TIFF).');
        return;
      }

      setProcessingItems(items);
      setStats({ total: items.length, completed: 0, failed: 0, skipped: 0 });
      completedTimes.current = [];
      setAvgMsPerFile(null);
      setEtaMs(null);
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

    const pendingCount = processingItems.filter(i => i.status === 'pending').length;
    const confirmed = await showConfirm(
      `Process ${pendingCount} image${pendingCount !== 1 ? 's' : ''} from:\n${inputDirectory}\n\nSVGs will be saved to:\n${outputDirectory}`
    );
    setConfirm(null);
    if (!confirmed) return;

    isCancelled.current = false;
    filenameCounts.current = {};
    completedTimes.current = [];
    setAvgMsPerFile(null);
    setEtaMs(null);
    setStats({ total: processingItems.length, completed: 0, failed: 0, skipped: 0 });
    setProcessingItems(items => items.map(item => ({ ...item, status: 'pending', error: undefined })));
    setIsProcessing(true);
    setCurrentFileIndex(0);
  };

  const cancelProcessing = useCallback(() => {
    isCancelled.current = true;
    setIsProcessing(false);
    setCurrentFileIndex(-1);
  }, []);

  const retryFailed = useCallback(() => {
    isCancelled.current = false;
    filenameCounts.current = {};
    completedTimes.current = [];
    setAvgMsPerFile(null);
    setEtaMs(null);
    const firstFailed = processingItemsRef.current.findIndex(i => i.status === 'failed');
    if (firstFailed < 0) return;
    setProcessingItems(items =>
      items.map(item => item.status === 'failed'
        ? { ...item, status: 'pending', error: undefined, retryCount: item.retryCount + 1 }
        : item
      )
    );
    setStats(prev => ({ ...prev, failed: 0, skipped: 0 }));
    setIsProcessing(true);
    setCurrentFileIndex(firstFailed);
  }, []);

  const openOutputDirectory = useCallback(async () => {
    if (!outputDirectory || !window.electronAPI?.openOutputDirectory) return;
    try { await window.electronAPI.openOutputDirectory(outputDirectory); } catch { /* silently skip */ }
  }, [outputDirectory]);

  // Main processing loop
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

      fileStartTime.current = performance.now();

      setProcessingItems(prev =>
        prev.map((item, idx) => idx === currentFileIndex ? { ...item, status: 'processing' } : item)
      );

      try {
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

        const elapsed = performance.now() - fileStartTime.current;
        completedTimes.current.push(elapsed);
        // Rolling average of last 5 files
        const recent = completedTimes.current.slice(-5);
        const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
        setAvgMsPerFile(avg);

        setProcessingItems(prev =>
          prev.map((item, idx) => idx === currentFileIndex ? { ...item, status: 'completed' } : item)
        );
        setStats(prev => {
          const remaining = prev.total - prev.completed - 1 - prev.failed - prev.skipped;
          setEtaMs(remaining > 0 ? remaining * avg : null);
          return { ...prev, completed: prev.completed + 1 };
        });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);

        if (skipFailedRef.current) {
          setProcessingItems(prev =>
            prev.map((item, idx) => idx === currentFileIndex
              ? { ...item, status: 'skipped', error: errMsg }
              : item)
          );
          setStats(prev => ({ ...prev, skipped: prev.skipped + 1 }));
        } else {
          setProcessingItems(prev =>
            prev.map((item, idx) => idx === currentFileIndex
              ? { ...item, status: 'failed', error: errMsg }
              : item)
          );
          setStats(prev => ({ ...prev, failed: prev.failed + 1 }));
        }
      }

      if (!isCancelled.current) {
        setCurrentFileIndex(idx => idx + 1);
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [isProcessing, currentFileIndex, outputDirectory, potraceParams, processImage]);

  // Auto-open output folder when batch completes
  const prevIsProcessing = useRef(isProcessing);
  useEffect(() => {
    if (prevIsProcessing.current && !isProcessing && autoOpenOutput && currentFileIndex === -1) {
      openOutputDirectory();
    }
    prevIsProcessing.current = isProcessing;
  }, [isProcessing, autoOpenOutput, currentFileIndex, openOutputDirectory]);

  const percentage = stats.total > 0
    ? Math.round(((stats.completed + stats.failed + stats.skipped) / stats.total) * 100)
    : 0;

  const batchDone = !isProcessing && currentFileIndex === -1 && stats.total > 0 &&
    (stats.completed + stats.failed + stats.skipped) === stats.total;
  const hasFailed = processingItems.some(i => i.status === 'failed');
  const currentlyProcessing = isProcessing ? processingItems.find(i => i.status === 'processing') : null;
  const remaining = Math.max(0, stats.total - stats.completed - stats.failed - stats.skipped);

  const settingsSummary = [
    potraceParams.colorMode
      ? `Color (${potraceParams.colorSteps} steps, ${potraceParams.fillStrategy})`
      : potraceParams.strokeMode ? 'Stroke' : 'B&W',
    `threshold ${potraceParams.threshold}`,
    `speckle ${potraceParams.turdSize}`,
    potraceParams.svgoOptimize ? 'SVGO on' : '',
  ].filter(Boolean).join(' · ');

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
                    <code className="block mt-2 px-2 py-1 bg-gray-100 text-gray-800 rounded text-xs font-mono">npm run electron:dev</code>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-5">
            {/* Batch options row */}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2 cursor-pointer" title="Continue processing remaining files when one fails">
                <input
                  type="checkbox"
                  checked={skipFailed}
                  onChange={e => setSkipFailed(e.target.checked)}
                  disabled={isProcessing}
                  className="h-4 w-4 text-blue-600 rounded border-gray-300"
                />
                <SkipForward className="w-3.5 h-3.5 text-gray-500" />
                <span className="text-gray-700">Skip failed files</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer" title="Automatically open output folder when batch completes">
                <input
                  type="checkbox"
                  checked={autoOpenOutput}
                  onChange={e => setAutoOpenOutput(e.target.checked)}
                  disabled={isProcessing}
                  className="h-4 w-4 text-blue-600 rounded border-gray-300"
                />
                <FolderOpen className="w-3.5 h-3.5 text-gray-500" />
                <span className="text-gray-700">Open output folder when done</span>
              </label>

              <button
                onClick={() => setShowResizeSettings(v => !v)}
                className="btn btn-secondary flex items-center gap-1.5 text-xs ml-auto"
                disabled={isProcessing}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                Resize Options
              </button>
            </div>

            {showResizeSettings && (
              <div className="border rounded-lg p-4 bg-gray-50 text-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-gray-800">Pre-resize Options</h3>
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
                    Resize images before vectorization
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Width (px)</label>
                      <input type="number" value={resizeOptions.width} min={1} max={8192}
                        onChange={e => setResizeOptions(p => ({ ...p, width: Math.max(1, parseInt(e.target.value) || 1) }))}
                        disabled={!resizeOptions.enabled}
                        className="w-full px-2 py-1.5 border rounded text-sm disabled:opacity-50" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Height (px)</label>
                      <input type="number" value={resizeOptions.height} min={1} max={8192}
                        onChange={e => setResizeOptions(p => ({ ...p, height: Math.max(1, parseInt(e.target.value) || 1) }))}
                        disabled={!resizeOptions.enabled}
                        className="w-full px-2 py-1.5 border rounded text-sm disabled:opacity-50" />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={resizeOptions.maintainAspectRatio}
                      onChange={e => setResizeOptions(p => ({ ...p, maintainAspectRatio: e.target.checked }))}
                      disabled={!resizeOptions.enabled}
                      className="h-4 w-4 text-blue-600 rounded border-gray-300 disabled:opacity-50" />
                    <span className={resizeOptions.enabled ? '' : 'opacity-50'}>Maintain aspect ratio</span>
                  </label>
                </div>
              </div>
            )}

            {/* Directory selection */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <button onClick={handleSelectInputDirectory} disabled={isProcessing} className="btn btn-primary flex items-center gap-2">
                  <FolderInput className="w-4 h-4" /> Select Input Directory
                </button>
                {inputDirectory && (
                  <span className="text-sm text-gray-600 truncate" title={inputDirectory}>
                    <span className="font-medium">Input:</span> {inputDirectory}
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <button onClick={handleSelectOutputDirectory} disabled={isProcessing} className="btn btn-primary flex items-center gap-2">
                  <FolderOutput className="w-4 h-4" /> Select Output Directory
                </button>
                {outputDirectory && (
                  <span className="text-sm text-gray-600 truncate" title={outputDirectory}>
                    <span className="font-medium">Output:</span> {outputDirectory}
                  </span>
                )}
              </div>
            </div>

            {/* File list + progress */}
            {processingItems.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <div className="p-3 bg-gray-50 border-b">
                  <div className="flex justify-between items-baseline mb-2">
                    <div className="font-medium text-sm">
                      {stats.total} file{stats.total !== 1 ? 's' : ''}
                      {currentlyProcessing && (
                        <span className="ml-2 text-xs text-blue-600 font-normal truncate max-w-[160px]" title={currentlyProcessing.filePath}>
                          — {currentlyProcessing.fileName}
                        </span>
                      )}
                    </div>
                    {isProcessing && etaMs !== null && etaMs > 0 && (
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        ETA {formatDuration(etaMs)}
                      </span>
                    )}
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                    <div className="bg-blue-600 h-2 rounded-full transition-all duration-300" style={{ width: `${percentage}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>Done: <span className="text-green-600 font-medium">{stats.completed}</span></span>
                    <span>Failed: <span className="text-red-600 font-medium">{stats.failed}</span></span>
                    {stats.skipped > 0 && <span>Skipped: <span className="text-amber-600 font-medium">{stats.skipped}</span></span>}
                    <span>Remaining: <span className="text-blue-600 font-medium">{remaining}</span></span>
                    {avgMsPerFile && <span className="hidden sm:inline text-gray-400">{formatDuration(avgMsPerFile)}/file</span>}
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
                        {item.retryCount > 0 && <span className="ml-1 text-xs text-gray-400">(retry {item.retryCount})</span>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        {item.status === 'pending'     && <span className="text-gray-400 text-xs">Pending</span>}
                        {item.status === 'processing'  && <span className="flex items-center text-blue-600 text-xs gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing</span>}
                        {item.status === 'completed'   && <span className="flex items-center text-green-600 text-xs gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Done</span>}
                        {item.status === 'skipped'     && (
                          <span className="flex items-center text-amber-600 text-xs gap-1 cursor-help" title={item.error}>
                            <SkipForward className="w-3.5 h-3.5" /> Skipped
                          </span>
                        )}
                        {item.status === 'failed'      && (
                          <span className="flex items-center text-red-600 text-xs gap-1 cursor-help" title={item.error}>
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Failed</span>
                            {item.error && <span className="hidden sm:inline text-red-400 truncate max-w-[120px]">: {item.error}</span>}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap justify-end gap-2">
              {batchDone && hasFailed && (
                <button onClick={retryFailed} className="btn btn-secondary flex items-center gap-2">
                  <RotateCw className="w-4 h-4" /> Retry Failed ({stats.failed})
                </button>
              )}

              {(batchDone || (!isProcessing && stats.completed > 0)) && outputDirectory &&
                typeof window.electronAPI?.openOutputDirectory === 'function' && (
                <button onClick={openOutputDirectory} className="btn btn-secondary flex items-center gap-2">
                  <FolderOpen className="w-4 h-4" /> Open Output Folder
                </button>
              )}

              {isProcessing ? (
                <button onClick={cancelProcessing} className="btn flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white">
                  <Square className="w-4 h-4" /> Cancel
                </button>
              ) : (
                <button
                  onClick={startBatchProcessing}
                  disabled={!inputDirectory || !outputDirectory || processingItems.length === 0}
                  className="btn btn-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Play className="w-4 h-4" /> Start Batch Processing
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
