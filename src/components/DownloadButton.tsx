import React, { useState, useEffect, useRef } from 'react';
import { Download, Copy, Check, ChevronDown } from 'lucide-react';
import { generateEPS, generateDXF, generatePathJSON } from '../utils/exportFormats';

type ExportFormat = 'svg' | 'eps' | 'dxf' | 'json';

interface FormatInfo {
  label: string;
  mime: string;
  ext: string;
  generate: (svg: string) => string;
}

const FORMAT_INFO: Record<ExportFormat, FormatInfo> = {
  svg:  { label: 'SVG',      mime: 'image/svg+xml',        ext: 'svg',  generate: s => s },
  eps:  { label: 'EPS',      mime: 'application/postscript', ext: 'eps', generate: generateEPS },
  dxf:  { label: 'DXF',      mime: 'application/dxf',       ext: 'dxf', generate: generateDXF },
  json: { label: 'JSON Paths', mime: 'application/json',    ext: 'json', generate: generatePathJSON },
};

interface DownloadButtonProps {
  svg: string;
  filename: string;
  isMobile?: boolean;
}

const DownloadButton: React.FC<DownloadButtonProps> = ({ svg, filename, isMobile = false }) => {
  const [copied, setCopied] = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSvgRef = useRef<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (svg && !prevSvgRef.current) {
      setTooltipVisible(true);
      if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
      tooltipTimer.current = setTimeout(() => setTooltipVisible(false), 4000);
    }
    prevSvgRef.current = svg;
    return () => {
      if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
      if (saveErrorTimer.current) clearTimeout(saveErrorTimer.current);
    };
  }, [svg]);

  // Close format menu on outside click
  useEffect(() => {
    if (!formatMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setFormatMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [formatMenuOpen]);

  const showSaveError = (msg: string) => {
    setSaveError(msg);
    if (saveErrorTimer.current) clearTimeout(saveErrorTimer.current);
    saveErrorTimer.current = setTimeout(() => setSaveError(null), 5000);
  };

  const browserDownload = (format: ExportFormat) => {
    const info = FORMAT_INFO[format];
    const content = info.generate(svg);
    const blob = new Blob([content], { type: info.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.${info.ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownload = async (format: ExportFormat = 'svg') => {
    if (!svg) return;
    setFormatMenuOpen(false);

    if (window.electronAPI?.showSaveDialog) {
      try {
        const savePath = await window.electronAPI.showSaveDialog({
          defaultName: `${filename}.${FORMAT_INFO[format].ext}`,
          format,
        });
        if (!savePath) return;

        const content = FORMAT_INFO[format].generate(svg);

        // SVG uses the existing saveSvg IPC; other formats write via the same channel
        const result = await window.electronAPI.saveSvg({ svgData: content, outputPath: savePath });
        if (result && 'error' in result) {
          showSaveError(`Native save failed: ${result.error}. Falling back to browser download.`);
          browserDownload(format);
        }
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showSaveError(`Native save failed: ${msg}. Falling back to browser download.`);
        browserDownload(format);
        return;
      }
    }

    browserDownload(format);
  };

  const handleCopy = async () => {
    if (!svg) return;
    try {
      await navigator.clipboard.writeText(svg);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  };

  const positionClasses = isMobile
    ? 'fixed bottom-16 left-0 right-0 p-2 flex flex-col items-center gap-2 z-20 animate-slide-in-bottom'
    : 'fixed bottom-0 left-0 right-0 p-4 flex justify-center items-end gap-2 z-20 animate-slide-in-bottom';

  return (
    <div className={positionClasses}>
      {saveError && (
        <div className="mb-2 px-4 py-2 bg-amber-100 border border-amber-300 text-amber-800 text-xs rounded-lg shadow-md max-w-md text-center" aria-live="polite">
          {saveError}
        </div>
      )}

      {!isMobile && tooltipVisible && (
        <div
          className="absolute bottom-full mb-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-2 rounded-lg text-sm animate-bounce-in pointer-events-none"
          style={{ left: '50%', transform: 'translateX(-50%)' }}
          aria-live="polite"
        >
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 rotate-45 bg-indigo-600" />
          <p className="text-center font-medium whitespace-nowrap">Your SVG is ready for download!</p>
        </div>
      )}

      {/* Primary download button + format dropdown */}
      <div className="flex items-stretch" ref={menuRef}>
        <button
          onClick={() => handleDownload('svg')}
          disabled={!svg}
          className={`flex items-center justify-center px-4 sm:px-5 py-2 sm:py-3 rounded-l-full shadow-soft transition-all duration-300 ${
            svg
              ? 'bg-gradient-blue text-white hover:shadow-lg hover:scale-105 active:scale-95'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
          aria-label="Download SVG"
        >
          <Download className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'} mr-2`} />
          <span className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium`}>Download SVG</span>
        </button>

        <button
          onClick={() => setFormatMenuOpen(v => !v)}
          disabled={!svg}
          className={`flex items-center justify-center px-2 sm:px-3 py-2 sm:py-3 rounded-r-full shadow-soft border-l border-white/30 transition-all duration-300 ${
            svg
              ? 'bg-gradient-blue text-white hover:brightness-110 active:scale-95'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
          aria-label="More export formats"
          aria-haspopup="true"
          aria-expanded={formatMenuOpen}
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${formatMenuOpen ? 'rotate-180' : ''}`} />
        </button>

        {formatMenuOpen && (
          <div className="absolute bottom-full mb-2 right-0 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden min-w-[160px] z-30">
            {(Object.entries(FORMAT_INFO) as [ExportFormat, FormatInfo][]).map(([fmt, info]) => (
              <button
                key={fmt}
                onClick={() => handleDownload(fmt)}
                className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors flex items-center gap-2"
              >
                <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-500 w-10 text-center">{info.ext.toUpperCase()}</span>
                {info.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={handleCopy}
        disabled={!svg}
        className={`flex items-center justify-center px-4 sm:px-5 py-2 sm:py-3 rounded-full shadow-soft transition-all duration-300 ${
          svg
            ? 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:shadow-md active:scale-95'
            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
        }`}
        aria-label={copied ? 'Copied to clipboard' : 'Copy SVG to clipboard'}
      >
        {copied
          ? <Check className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'} mr-2 text-green-500`} />
          : <Copy className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'} mr-2`} />
        }
        <span className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium`}>
          {copied ? 'Copied!' : 'Copy SVG'}
        </span>
      </button>
    </div>
  );
};

export default DownloadButton;
