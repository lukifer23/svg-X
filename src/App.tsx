import { useState, useCallback, useEffect, useRef } from "react";
import { Settings, FileText, Layers, AlertTriangle } from "lucide-react";
import FileUpload from "./components/FileUpload";
import ImagePreview from "./components/ImagePreview";
import SettingsPanel from "./components/SettingsPanel";
import DownloadButton from "./components/DownloadButton";
import NetworkInfo from "./components/NetworkInfo";
import ProcessingLogs from "./components/ProcessingLogs";
import BatchConversion from "./components/BatchConversion";
import {
  processImageDetailed,
  DEFAULT_PARAMS,
  PROGRESS_STEPS,
  getOptimizedFilename,
  TracingParams,
  simplifyForComplexImages,
} from "./utils/imageProcessor";
import type {
  ConversionDiagnostics,
  VectorDocument,
} from "./core/vectorDocument";
import { loadSettings, SETTINGS_STORAGE_KEY } from "./utils/settings";

type ConversionStatus =
  | "idle"
  | "loading"
  | "analyzing"
  | "tracing"
  | "colorProcessing"
  | "optimizing"
  | "done"
  | "cancelled"
  | "error";

const tracingModes = [
  { value: "bw", label: "B&W" },
  { value: "color", label: "Color" },
  { value: "centerline", label: "Centerline" },
] as const;

interface LogEntry {
  id: string;
  step: string;
  message: string;
  isError: boolean;
  timestamp: string;
}

function App() {
  const [image, setImage] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [vectorDocument, setVectorDocument] = useState<VectorDocument | null>(
    null,
  );
  const [diagnostics, setDiagnostics] = useState<ConversionDiagnostics | null>(
    null,
  );
  const [status, setStatus] = useState<ConversionStatus>("idle");
  const [error, setError] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const [potraceParams, setPotraceParams] = useState<TracingParams>(() =>
    loadSettings(localStorage),
  );
  const [fileName, setFileName] = useState("image");
  const [isMobileView, setIsMobileView] = useState(window.innerWidth < 768);
  const [isComplexMode, setIsComplexMode] = useState(false);
  const [showBatchConversion, setShowBatchConversion] = useState(false);
  const isElectronAvailable = !!window.electronAPI;
  const [showElectronWarning, setShowElectronWarning] = useState(false);
  const [processingLogs, setProcessingLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  // Use ref for log ID counter to survive HMR remounts without collisions
  const logIdCounter = useRef(0);
  const electronWarningTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const activeAbortController = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const processingLogsTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (window.electronAPI?.getAppVersion) {
      window.electronAPI
        .getAppVersion()
        .then((v) => setAppVersion(v))
        .catch(() => {});
    }

    const handleResize = () => setIsMobileView(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (electronWarningTimer.current)
        clearTimeout(electronWarningTimer.current);
    };
  }, []);

  useEffect(
    () => () => {
      const pending = activeAbortController.current;
      activeAbortController.current = null;
      pending?.abort();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    // Persist after the user stops dragging, not on every slider tick.
    const handle = setTimeout(() => {
      try {
        localStorage.setItem(
          SETTINGS_STORAGE_KEY,
          JSON.stringify(potraceParams),
        );
      } catch {
        // Storage quota exceeded — silently skip
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [potraceParams]);

  const handleLogEntry = useCallback(
    (step: string, message: string, isError: boolean, timestamp: string) => {
      const id = `${timestamp}-${++logIdCounter.current}`;
      setProcessingLogs((prev) => [
        ...prev,
        { id, step, message, isError, timestamp },
      ]);
    },
    [],
  );

  // Only reset complex mode when user explicitly resets to defaults, not on every param tweak
  const handleParamChange = useCallback(
    <K extends keyof TracingParams>(param: K, value: TracingParams[K]) => {
      setPotraceParams((prev) => ({ ...prev, [param]: value }));
    },
    [],
  );

  const resetParams = useCallback(() => {
    setPotraceParams({ ...DEFAULT_PARAMS });
    setIsComplexMode(false);
  }, []);

  const runConversion = useCallback(
    async (source: string, params: TracingParams) => {
      const previous = activeAbortController.current;
      const controller = new AbortController();
      activeAbortController.current = controller;
      previous?.abort();
      const isCurrent = () => activeAbortController.current === controller;
      setProcessingLogs([]);
      setError("");
      setStatus("analyzing");
      try {
        const result = await processImageDetailed(
          source,
          params,
          (phase) => {
            if (isCurrent() && !controller.signal.aborted)
              setStatus(phase as ConversionStatus);
          },
          (...entry) => {
            if (isCurrent() && !controller.signal.aborted)
              handleLogEntry(...entry);
          },
          controller.signal,
        );
        if (!isCurrent()) return;
        controller.signal.throwIfAborted();
        setSvg(result.svg);
        setVectorDocument(result.document);
        setDiagnostics(result.diagnostics);
        setStatus("done");
      } catch (err) {
        if (!isCurrent()) return;
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          setStatus("cancelled");
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      } finally {
        if (isCurrent()) activeAbortController.current = null;
      }
    },
    [handleLogEntry],
  );

  const applyParams = useCallback(
    (params: TracingParams) => {
      if (image) return runConversion(image, params);
    },
    [image, runConversion],
  );

  const applyCurrentParams = useCallback(
    () => applyParams(potraceParams),
    [applyParams, potraceParams],
  );
  const selectMode = (mode: TracingParams["mode"]) => {
    const params = { ...potraceParams, mode };
    setPotraceParams(params);
    void applyParams(params);
  };
  const selectColorPathStyle = (colorCurveFit: boolean) => {
    const params = { ...potraceParams, colorCurveFit };
    setPotraceParams(params);
    void applyParams(params);
  };
  const closeSettings = useCallback(() => setShowSettings(false), []);
  const closeProcessingLogs = useCallback(() => {
    setShowLogs(false);
    requestAnimationFrame(() => processingLogsTriggerRef.current?.focus());
  }, []);

  const applyComplexSettings = useCallback(async () => {
    const complexParams = simplifyForComplexImages({ ...potraceParams });
    setPotraceParams(complexParams);
    setIsComplexMode(true);
    await applyParams(complexParams);
  }, [potraceParams, applyParams]);

  const handleImageSelect = useCallback(
    (imageData: string, file: File) => {
      const previousUrl = objectUrlRef.current;
      objectUrlRef.current = imageData.startsWith("blob:") ? imageData : null;
      if (previousUrl && previousUrl !== imageData)
        URL.revokeObjectURL(previousUrl);
      setImage(imageData);
      setFileName(getOptimizedFilename(file.name));
      setSvg(null);
      setVectorDocument(null);
      setDiagnostics(null);
      return runConversion(imageData, potraceParams);
    },
    [potraceParams, runConversion],
  );

  const clearImage = () => {
    const pending = activeAbortController.current;
    activeAbortController.current = null;
    pending?.abort();
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setImage(null);
    setSvg(null);
    setVectorDocument(null);
    setDiagnostics(null);
    setProcessingLogs([]);
    setStatus("idle");
    setError("");
  };

  const handleBatchButtonClick = () => {
    if (isElectronAvailable) {
      setShowBatchConversion(true);
    } else {
      setShowElectronWarning(true);
      if (electronWarningTimer.current)
        clearTimeout(electronWarningTimer.current);
      electronWarningTimer.current = setTimeout(
        () => setShowElectronWarning(false),
        8000,
      );
    }
  };

  return (
    <div className="min-h-screen p-2 sm:p-4 md:p-8">
      {showElectronWarning && (
        <div className="fixed top-0 left-0 right-0 bg-amber-100 border-b border-amber-300 p-4 shadow-md z-50 animate-slide-down">
          <div className="max-w-5xl mx-auto flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-medium text-amber-800">
                Electron Required for Batch Processing
              </h3>
              <p className="text-amber-700 mt-1">
                Batch conversion requires filesystem access only available in
                the Electron app. Run{" "}
                <span className="font-mono bg-amber-50 px-1 py-0.5 rounded text-sm">
                  npm run electron:dev
                </span>{" "}
                in your terminal.
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

      <header className="max-w-5xl mx-auto mb-4 sm:mb-8">
        <div className="flex flex-wrap justify-between items-center gap-2 sm:gap-4">
          <div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-2xl sm:text-3xl font-bold text-gradient">
                SVG-X
              </h1>
              {appVersion && (
                <span className="text-xs text-gray-400 font-mono">
                  v{appVersion}
                </span>
              )}
            </div>
            <p className="text-sm sm:text-base text-gray-600 mt-1">
              Convert images to SVG with ease
            </p>
          </div>

          <div className="flex max-w-full flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Conversion mode"
              className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-gray-200 bg-white p-1"
            >
              {tracingModes.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={potraceParams.mode === value}
                  onClick={() => selectMode(value)}
                  className="min-h-11 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-indigo-50 aria-pressed:bg-indigo-100 aria-pressed:text-indigo-900"
                >
                  {label}
                </button>
              ))}
            </div>
            {potraceParams.mode === "color" && (
              <select
                aria-label="Color path style"
                className="min-h-11 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-800"
                value={potraceParams.colorCurveFit ? "bezier" : "polygon"}
                onChange={(event) =>
                  selectColorPathStyle(event.target.value === "bezier")
                }
              >
                <option value="polygon">Polygon</option>
                <option value="bezier">Fitted Bézier</option>
              </select>
            )}
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
              onClick={() => setShowSettings((v) => !v)}
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
          <FileUpload
            onImageSelect={handleImageSelect}
            isMobile={isMobileView}
          />
        ) : (
          <ImagePreview
            image={image}
            svg={svg}
            status={status}
            progressSteps={PROGRESS_STEPS}
            diagnostics={diagnostics}
            dimensions={vectorDocument}
            isMobile={isMobileView}
          />
        )}

        {(status === "done" || status === "cancelled" || status === "error") &&
          svg &&
          vectorDocument && (
            <DownloadButton
              svg={svg}
              document={vectorDocument}
              filename={fileName}
              isMobile={isMobileView}
            />
          )}

        {status === "cancelled" && (
          <p role="status" className="mt-4 text-center text-sm text-gray-700">
            Conversion cancelled.
          </p>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 sm:px-4 py-2 sm:py-3 rounded-lg animate-fade-in shadow-soft mt-4">
            <h3 className="text-base sm:text-lg font-semibold mb-1">Error</h3>
            <p className="text-sm sm:text-base whitespace-pre-line">{error}</p>
            <div className="mt-3 flex justify-between items-center flex-wrap gap-2">
              <button
                ref={processingLogsTriggerRef}
                onClick={() => setShowLogs(true)}
                className="flex items-center text-blue-600 hover:text-blue-800 gap-1 text-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                View Processing Logs
              </button>
              <button
                onClick={
                  isComplexMode ? applyCurrentParams : applyComplexSettings
                }
                className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
              >
                {isComplexMode ? "Try Standard Mode" : "Try Complex Mode"}
              </button>
            </div>
          </div>
        )}

        {status !== "idle" && !error && (
          <div className="mt-4 flex justify-center">
            <button
              ref={processingLogsTriggerRef}
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
            {(status === "loading" ||
              status === "analyzing" ||
              status === "tracing" ||
              status === "colorProcessing" ||
              status === "optimizing") && (
              <button
                onClick={() => activeAbortController.current?.abort()}
                className="btn bg-red-600 hover:bg-red-700 text-white text-xs sm:text-sm"
              >
                Cancel Processing
              </button>
            )}
            <button
              onClick={clearImage}
              className="btn btn-secondary text-xs sm:text-sm"
            >
              Upload New Image
            </button>
            <button
              onClick={applyCurrentParams}
              disabled={
                status === "loading" ||
                status === "analyzing" ||
                status === "tracing" ||
                status === "colorProcessing" ||
                status === "optimizing"
              }
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
          onClose={closeSettings}
          onApply={
            image
              ? () => {
                  closeSettings();
                  void applyCurrentParams();
                }
              : undefined
          }
          onApplyComplex={applyComplexSettings}
          isMobile={isMobileView}
          isComplexMode={isComplexMode}
        />
      )}

      <NetworkInfo isMobile={isMobileView} />

      <ProcessingLogs
        logs={processingLogs}
        visible={showLogs}
        onClose={closeProcessingLogs}
        onClear={() => setProcessingLogs([])}
      />

      {showBatchConversion && (
        <BatchConversion
          potraceParams={potraceParams}
          onClose={() => setShowBatchConversion(false)}
        />
      )}
    </div>
  );
}

export default App;
