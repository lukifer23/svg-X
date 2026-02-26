import React, { useRef, useEffect, useState } from 'react';
import { X, AlertCircle, Copy, Check, Trash2 } from 'lucide-react';

interface LogEntry {
  id: string;
  step: string;
  message: string;
  isError: boolean;
  timestamp: string;
}

interface ProcessingLogsProps {
  logs: LogEntry[];
  visible: boolean;
  onClose: () => void;
  onClear: () => void;
}

const ProcessingLogs: React.FC<ProcessingLogsProps> = ({ logs, visible, onClose, onClear }) => {
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (visible && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, visible]);

  const displayedLogs = errorsOnly ? logs.filter(l => l.isError) : logs;
  const errorCount = logs.filter(l => l.isError).length;

  const handleCopy = async () => {
    const text = logs
      .map(l => `[${l.timestamp}] [${l.step}] ${l.message}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — silently skip
    }
  };

  return (
    <div
      className={`fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in ${visible ? '' : 'hidden'}`}
      role="dialog"
      aria-label="Processing Logs"
      aria-modal="true"
    >
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-3xl h-[70vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b gap-2 flex-wrap">
          <h3 className="text-base font-semibold text-gray-800">Processing Logs</h3>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => setErrorsOnly(v => !v)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                errorsOnly
                  ? 'bg-red-100 text-red-700 hover:bg-red-200'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title={errorsOnly ? 'Show all logs' : 'Show errors only'}
              aria-pressed={errorsOnly}
            >
              <AlertCircle className="w-3.5 h-3.5" />
              Errors only
              {errorCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-red-500 text-white rounded-full text-xs leading-none">{errorCount}</span>
              )}
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
              title="Copy all logs to clipboard"
              aria-label="Copy logs to clipboard"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={onClear}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-600 transition-colors"
              title="Clear all logs"
              aria-label="Clear all logs"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-800 transition-colors"
              title="Close logs panel"
              aria-label="Close processing logs"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Log entries */}
        <div className="flex-1 overflow-y-auto p-3 font-mono text-xs bg-gray-50">
          {displayedLogs.length === 0 ? (
            <div className="text-gray-400 text-center py-8">
              {errorsOnly ? 'No errors logged' : 'No logs to display yet'}
            </div>
          ) : (
            displayedLogs.map(log => (
              <div
                key={log.id}
                className={`mb-0.5 leading-relaxed ${log.isError ? 'text-red-600' : 'text-gray-700'}`}
              >
                <span className="text-gray-400">[{log.timestamp}]</span>{' '}
                <span className={`font-bold ${log.isError ? 'text-red-600' : 'text-blue-600'}`}>[{log.step}]</span>{' '}
                <span>{log.message}</span>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>

        {/* Footer */}
        <div className="p-3 border-t bg-gray-50 flex justify-between items-center rounded-b-lg">
          <span className="text-xs text-gray-500">
            {displayedLogs.length} {errorsOnly ? 'error' : 'log'} entr{displayedLogs.length === 1 ? 'y' : 'ies'}
            {errorsOnly && logs.length !== displayedLogs.length && ` of ${logs.length} total`}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs font-medium transition-colors"
            aria-label="Close processing logs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProcessingLogs;
