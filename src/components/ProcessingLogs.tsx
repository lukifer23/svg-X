/**
 * Last checked: 2025-03-02
 */

import React, { useRef, useEffect } from 'react';

interface LogEntry {
  step: string;
  message: string;
  isError: boolean;
  timestamp: string;
}

interface ProcessingLogsProps {
  logs: LogEntry[];
  visible: boolean;
  onClose: () => void;
}

const ProcessingLogs: React.FC<ProcessingLogsProps> = ({ logs, visible, onClose }) => {
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-3xl h-[70vh] flex flex-col">
        <div className="flex items-center justify-between p-3 border-b">
          <h3 className="text-lg font-medium">Processing Logs</h3>
          <button 
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 p-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-3 font-mono text-sm bg-gray-50">
          {logs.length === 0 ? (
            <div className="text-gray-500 text-center py-4">No logs to display yet</div>
          ) : (
            logs.map((log, index) => (
              <div 
                key={index} 
                className={`mb-1 ${log.isError ? 'text-red-600' : ''}`}
              >
                <span className="text-gray-400">[{log.timestamp}]</span>{' '}
                <span className={`font-bold ${log.isError ? 'text-red-600' : 'text-blue-600'}`}>[{log.step}]</span>{' '}
                <span>{log.message}</span>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
        
        <div className="p-3 border-t bg-gray-100 flex justify-between items-center">
          <div className="text-sm text-gray-600">
            {logs.length} log entries
          </div>
          <button 
            onClick={onClose}
            className="px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProcessingLogs; 