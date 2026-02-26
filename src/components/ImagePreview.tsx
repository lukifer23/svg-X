import React, { useState, useEffect, useRef } from 'react';
import { Image as ImageIcon, Code, X } from 'lucide-react';

interface ImagePreviewProps {
  image: string;
  svg: string | null;
  status: string;
  progressSteps: Record<string, string>;
  isMobile?: boolean;
}

const STATUS_FLOOR: Record<string, number> = {
  idle: 0,
  loading: 10,
  analyzing: 35,
  tracing: 55,
  colorProcessing: 55,
  optimizing: 90,
  done: 100,
  error: 0
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

/** Parse width × height from an SVG's viewBox or width/height attributes. */
function parseSvgDimensions(svgStr: string): { w: number; h: number } | null {
  const vbMatch = svgStr.match(/viewBox="[^"]*?\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"/);
  if (vbMatch) return { w: Math.round(parseFloat(vbMatch[1])), h: Math.round(parseFloat(vbMatch[2])) };
  const wMatch = svgStr.match(/\bwidth="(\d+(?:\.\d+)?)"/);
  const hMatch = svgStr.match(/\bheight="(\d+(?:\.\d+)?)"/);
  if (wMatch && hMatch) return { w: Math.round(parseFloat(wMatch[1])), h: Math.round(parseFloat(hMatch[1])) };
  return null;
}

/**
 * Basic SVG sanitization: strips <script> elements and on* event attributes.
 * Not a full XSS sanitizer — just defense-in-depth for palette-derived content.
 */
function sanitizeSvg(svgStr: string): string {
  return svgStr
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\bon\w+\s*=/gi, 'data-removed=');
}

const ImagePreview: React.FC<ImagePreviewProps> = ({
  image,
  svg,
  status,
  progressSteps,
  isMobile = false
}) => {
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressDetails, setProgressDetails] = useState('');
  const [imgDimensions, setImgDimensions] = useState<{ w: number; h: number } | null>(null);
  const [showSource, setShowSource] = useState(false);
  const highWaterMark = useRef(0);

  useEffect(() => {
    if (status === 'loading' || status === 'analyzing') {
      highWaterMark.current = 0;
      setProgressPercent(0);
      setProgressDetails('');
    }
  }, [status]);

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { progress, details } = e.detail;
      const floor = STATUS_FLOOR['colorProcessing'] ?? 0;
      const mapped = floor + Math.round((progress / 100) * (90 - floor));
      const clamped = Math.max(highWaterMark.current, mapped);
      highWaterMark.current = clamped;
      setProgressPercent(clamped);
      if (details) setProgressDetails(details);
    };
    window.addEventListener('color-progress-update', handler as EventListener);
    return () => window.removeEventListener('color-progress-update', handler as EventListener);
  }, []);

  useEffect(() => {
    if (status !== 'colorProcessing') {
      setProgressDetails('');
      const floor = STATUS_FLOOR[status] ?? 0;
      const next = Math.max(highWaterMark.current, floor);
      highWaterMark.current = next;
      setProgressPercent(next);
    }
  }, [status]);

  useEffect(() => {
    if (!image) { setImgDimensions(null); return; }
    const img = new Image();
    img.onload = () => setImgDimensions({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = image;
  }, [image]);

  const isProcessing = status !== 'idle' && status !== 'done' && status !== 'error';
  const statusLabel = progressSteps[status] ?? status;

  const svgForDisplay = svg
    ? sanitizeSvg(svg).replace(/^(<svg\b)/, '$1 preserveAspectRatio="xMidYMid meet"')
    : null;

  const svgSize = svg ? formatBytes(new Blob([svg]).size) : null;
  const svgDimensions = svg ? parseSvgDimensions(svg) : null;

  return (
    <>
      {showSource && svg && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="SVG Source"
        >
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-3 border-b">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <Code className="w-4 h-4 text-blue-600" />
                SVG Source
                {svgSize && <span className="text-xs text-gray-400 font-normal font-mono">{svgSize}</span>}
              </h3>
              <button
                onClick={() => setShowSource(false)}
                className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-800 transition-colors"
                aria-label="Close SVG source view"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-xs font-mono text-gray-700 bg-gray-50 rounded-b-lg whitespace-pre-wrap break-all">
              {svg}
            </pre>
          </div>
        </div>
      )}

      <div className="panel p-3 sm:p-6 animate-slide-in-bottom">
        <h2 className="text-base sm:text-lg font-semibold text-gradient mb-2 sm:mb-4 flex items-center">
          <ImageIcon className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-blue-600" />
          Preview
        </h2>

        <div className={`grid ${isMobile ? 'grid-cols-1' : 'sm:grid-cols-2'} gap-4 sm:gap-6`}>
          {isProcessing && (
            <div className={`${isMobile ? 'col-span-1' : 'sm:col-span-2'} bg-glass border border-gray-200 rounded-xl p-3 sm:p-4 mb-2 animate-fade-in shadow-soft`}>
              <div className="flex items-center space-x-3">
                <div className="animate-spin rounded-full h-4 w-4 sm:h-5 sm:w-5 border-2 border-blue-600 border-t-transparent flex-shrink-0" />
                <span className="text-sm sm:text-base text-gray-700 font-medium">{statusLabel}</span>
              </div>
              {progressDetails && (
                <div className="mt-1 text-xs text-gray-500">
                  {progressDetails}
                  {progressPercent > 0 && <span className="ml-1 font-medium">{progressPercent}%</span>}
                </div>
              )}
              <div className="mt-2 sm:mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-blue transition-all duration-300 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          <div>
            <div className="flex items-baseline justify-between mb-1 sm:mb-2">
              <p className="text-xs sm:text-sm text-gray-600 font-medium">Original Image</p>
              {imgDimensions && (
                <span className="text-xs text-gray-400 font-mono">{imgDimensions.w} × {imgDimensions.h}</span>
              )}
            </div>
            <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-white shadow-soft group">
              <img
                src={image}
                alt="Original"
                className="w-full h-auto object-contain max-h-[200px] sm:max-h-[300px] transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </div>
          </div>

          <div className="animate-slide-in-right" style={{ animationDelay: '0.2s' }}>
            <div className="flex items-baseline justify-between mb-1 sm:mb-2">
              <p className="text-xs sm:text-sm text-gray-600 font-medium">SVG Output</p>
              <div className="flex items-center gap-2">
                {svgDimensions && status === 'done' && (
                  <span className="text-xs text-gray-400 font-mono">{svgDimensions.w} × {svgDimensions.h}</span>
                )}
                {svgSize && status === 'done' && (
                  <span className="text-xs text-gray-400 font-mono">{svgSize}</span>
                )}
                {svg && status === 'done' && (
                  <button
                    onClick={() => setShowSource(true)}
                    className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 transition-colors"
                    title="View SVG source code"
                    aria-label="View SVG source"
                  >
                    <Code className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Source</span>
                  </button>
                )}
              </div>
            </div>
            {svgForDisplay ? (
              <div className="bg-white border border-gray-200 rounded-lg p-2 sm:p-4 w-full h-[200px] sm:h-[300px] flex items-center justify-center shadow-soft hover:shadow-md transition-all duration-300 overflow-hidden">
                <div
                  dangerouslySetInnerHTML={{ __html: svgForDisplay }}
                  className="max-w-full max-h-full w-full h-full flex items-center justify-center"
                />
              </div>
            ) : (
              <div className="h-[200px] sm:h-[300px] border border-gray-200 rounded-lg bg-white/50 flex items-center justify-center p-2 sm:p-4 text-center shadow-soft">
                <span className="text-xs sm:text-sm text-gray-400">
                  {status === 'idle'
                    ? 'Upload an image to see the SVG output'
                    : status === 'error'
                    ? 'Conversion failed — see error above'
                    : 'Processing...'}
                </span>
              </div>
            )}
          </div>
        </div>

        {status === 'done' && svg && (
          <div className="mt-3 sm:mt-4 bg-green-50 border border-green-100 rounded-lg p-2 sm:p-3 text-green-700 text-xs sm:text-sm animate-fade-in">
            <p className="font-medium">Conversion complete!</p>
            <p className="text-xs mt-1 text-green-600">
              Your SVG is ready to download{svgSize ? ` (${svgSize})` : ''}.
            </p>
          </div>
        )}
      </div>
    </>
  );
};

export default ImagePreview;
