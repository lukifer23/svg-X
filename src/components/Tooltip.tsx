import React, { useState, useRef, useEffect } from 'react';
import { Info } from 'lucide-react';

interface TooltipProps {
  content: string;
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, className = '' }) => {
  const [visible, setVisible] = useState(false);
  const [above, setAbove] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setAbove(rect.bottom + 120 > window.innerHeight);
  }, [visible]);

  return (
    <div
      ref={ref}
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      tabIndex={0}
      role="button"
      aria-label="More information"
    >
      <Info className="w-3.5 h-3.5 text-gray-400 hover:text-blue-500 cursor-help transition-colors" />
      {visible && (
        <div
          className={`absolute z-50 w-56 px-3 py-2 text-xs text-white bg-gray-800 rounded-lg shadow-lg pointer-events-none
            ${above ? 'bottom-6' : 'top-6'} left-1/2 -translate-x-1/2`}
          role="tooltip"
        >
          {content}
          <div
            className={`absolute left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-800 rotate-45
              ${above ? '-bottom-1' : '-top-1'}`}
          />
        </div>
      )}
    </div>
  );
};

export default Tooltip;
