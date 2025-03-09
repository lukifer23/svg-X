/**
 * Last checked: 2025-03-02
 */

import React from 'react';
import { Settings } from 'lucide-react';
import { TurnPolicy } from '../utils/imageProcessor';

// Define the props interface for the component
export interface SettingsPanelProps {
  turdSize: number;
  turnPolicy: TurnPolicy;
  alphaMax: number;
  optCurve: boolean;
  optTolerance: number;
  threshold: number;
  blackOnWhite: boolean;
  color: string;
  background: string;
  invert: boolean;
  highestQuality: boolean;
  onParamChange: (param: string, value: any) => void;
  onReset: () => void;
  onClose: () => void;
  onApply?: () => void;
  onApplyComplex?: () => void;
  isMobile?: boolean;
  isComplexMode?: boolean;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ 
  turdSize,
  turnPolicy,
  alphaMax,
  optCurve,
  optTolerance,
  threshold,
  blackOnWhite,
  color,
  background,
  invert,
  highestQuality,
  onParamChange,
  onReset,
  onClose,
  onApply,
  onApplyComplex,
  isMobile = false,
  isComplexMode = false
}) => {
  const turnPolicyOptions: TurnPolicy[] = ['black', 'white', 'left', 'right', 'minority', 'majority'];

  // CSS classes for slider styling
  const sliderTrackClass = "w-full h-3 bg-gray-200 rounded-full appearance-none cursor-pointer";
  const sliderThumbClass = "w-6 h-6 rounded-full bg-gradient-blue border-2 border-white shadow-md appearance-none";

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4 animate-fade-in overflow-y-auto">
      <div className="bg-white border border-gray-200 rounded-lg p-3 sm:p-6 shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold text-base sm:text-lg flex items-center text-gray-800">
            <Settings className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'} mr-2 text-blue-600`} />
            Tracing Options
            {isComplexMode && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
                Complex Mode
              </span>
            )}
          </h3>
          <div className="flex space-x-2">
            <button 
              onClick={onApplyComplex}
              className="text-xs px-2 sm:px-3 py-1 sm:py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors duration-200 flex items-center"
              title="Apply optimized settings for complex images with intricate details, geometric patterns, or dense line work"
            >
              <svg 
                xmlns="http://www.w3.org/2000/svg" 
                className="h-3 w-3 mr-1" 
                viewBox="0 0 20 20" 
                fill="currentColor"
              >
                <path fillRule="evenodd" d="M5 3a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2H5zm4.5 14C7.01 17 5 14.99 5 12.5S7.01 8 9.5 8 14 10.01 14 12.5 11.99 17 9.5 17z" clipRule="evenodd" />
              </svg>
              Complex Image
            </button>
            <button 
              onClick={onReset} 
              className="text-xs px-2 sm:px-3 py-1 sm:py-1.5 bg-gray-100 hover:bg-gray-200 rounded transition-colors duration-200"
            >
              Reset
            </button>
            <button 
              onClick={onClose}
              className="text-xs px-2 sm:px-3 py-1 sm:py-1.5 bg-gray-100 hover:bg-gray-200 rounded transition-colors duration-200"
            >
              Close
            </button>
          </div>
        </div>
        
        <div className={`grid ${isMobile ? 'grid-cols-1 gap-4' : 'sm:grid-cols-2 gap-6'}`}>
          <div>
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
              Detail Level (turdSize: {turdSize})
            </label>
            <div className="text-xs text-gray-500 mb-2">
              Lower values keep more details (1-10)
            </div>
            <div className="relative pt-1">
              <div className="overflow-hidden h-3 mb-1 text-xs flex rounded-full bg-gray-200">
                <div 
                  style={{ width: `${(turdSize-1)/9*100}%` }}
                  className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-gradient-blue"
                ></div>
              </div>
              <input 
                type="range" 
                min="1" 
                max="10" 
                step="1"
                value={turdSize} 
                onChange={(e) => onParamChange('turdSize', e.target.value)}
                className={`${sliderTrackClass} mt-2`}
                style={{ 
                  WebkitAppearance: 'none',
                  appearance: 'none'
                }}
              />
            </div>
          </div>
          
          <div>
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
              Threshold: {threshold}
            </label>
            <div className="text-xs text-gray-500 mb-2">
              Controls black/white cutoff (0-255)
            </div>
            <div className="relative pt-1">
              <div className="overflow-hidden h-3 mb-1 text-xs flex rounded-full bg-gray-200">
                <div 
                  style={{ width: `${threshold/255*100}%` }}
                  className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-gradient-blue"
                ></div>
              </div>
              <input 
                type="range" 
                min="0" 
                max="255" 
                step="1"
                value={threshold} 
                onChange={(e) => onParamChange('threshold', e.target.value)}
                className={`${sliderTrackClass} mt-2`}
                style={{ 
                  WebkitAppearance: 'none',
                  appearance: 'none'
                }}
              />
            </div>
          </div>
          
          <div>
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
              Corner Threshold (alphaMax: {alphaMax.toFixed(1)})
            </label>
            <div className="text-xs text-gray-500 mb-2">
              Higher values make smoother corners (0.1-1.5)
            </div>
            <div className="relative pt-1">
              <div className="overflow-hidden h-3 mb-1 text-xs flex rounded-full bg-gray-200">
                <div 
                  style={{ width: `${(alphaMax-0.1)/1.4*100}%` }}
                  className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-gradient-blue"
                ></div>
              </div>
              <input 
                type="range" 
                min="0.1" 
                max="1.5" 
                step="0.1"
                value={alphaMax} 
                onChange={(e) => onParamChange('alphaMax', e.target.value)}
                className={`${sliderTrackClass} mt-2`}
                style={{ 
                  WebkitAppearance: 'none',
                  appearance: 'none'
                }}
              />
            </div>
          </div>
          
          <div>
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
              Optimization Tolerance: {optTolerance.toFixed(1)}
            </label>
            <div className="text-xs text-gray-500 mb-2">
              Higher values allow more deviation (0.1-2.0)
            </div>
            <div className="relative pt-1">
              <div className="overflow-hidden h-3 mb-1 text-xs flex rounded-full bg-gray-200">
                <div 
                  style={{ width: `${(optTolerance-0.1)/1.9*100}%` }}
                  className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-gradient-blue"
                ></div>
              </div>
              <input 
                type="range" 
                min="0.1" 
                max="2.0" 
                step="0.1"
                value={optTolerance} 
                onChange={(e) => onParamChange('optTolerance', e.target.value)}
                className={`${sliderTrackClass} mt-2`}
                style={{ 
                  WebkitAppearance: 'none',
                  appearance: 'none'
                }}
              />
            </div>
          </div>

          <div className={isMobile ? "" : "sm:col-span-2"}>
            <div className="flex flex-col gap-2">
              <label className="block text-xs sm:text-sm font-medium text-gray-700">Options</label>
              
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="optCurve"
                  checked={optCurve} 
                  onChange={(e) => onParamChange('optCurve', e.target.checked)}
                  className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <label htmlFor="optCurve" className="ml-2 text-xs sm:text-sm text-gray-600">
                  Enable curve optimization
                </label>
              </div>
              
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="blackOnWhite"
                  checked={blackOnWhite} 
                  onChange={(e) => onParamChange('blackOnWhite', e.target.checked)}
                  className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <label htmlFor="blackOnWhite" className="ml-2 text-xs sm:text-sm text-gray-600">
                  Black on white (vs. white on black)
                </label>
              </div>
              
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="invert"
                  checked={invert} 
                  onChange={(e) => onParamChange('invert', e.target.checked)}
                  className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <label htmlFor="invert" className="ml-2 text-xs sm:text-sm text-gray-600">
                  Invert colors
                </label>
              </div>
              
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="highestQuality"
                  checked={highestQuality} 
                  onChange={(e) => onParamChange('highestQuality', e.target.checked)}
                  className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <label htmlFor="highestQuality" className="ml-2 text-xs sm:text-sm text-gray-600">
                  Highest quality (slower)
                </label>
              </div>
            </div>
          </div>

          <div className={isMobile ? "" : "sm:col-span-2"}>
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">Turn Policy:</label>
            <div className="text-xs text-gray-500 mb-2">
              Controls how to resolve ambiguities during tracing
            </div>
            <div className="grid grid-cols-2 gap-2">
              {turnPolicyOptions.map(option => (
                <div key={option} className="flex items-center">
                  <input
                    type="radio"
                    id={`turn-${option}`}
                    name="turnPolicy"
                    value={option}
                    checked={turnPolicy === option}
                    onChange={() => onParamChange('turnPolicy', option)}
                    className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <label htmlFor={`turn-${option}`} className="ml-2 text-xs sm:text-sm text-gray-600">
                    {option.charAt(0).toUpperCase() + option.slice(1)}
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className={isMobile ? "" : "sm:col-span-2"}>
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">SVG Colors:</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="color" className="block text-xs sm:text-sm text-gray-600 mb-1">
                  Foreground color:
                </label>
                <div className="flex">
                  <input 
                    type="color" 
                    id="color" 
                    value={color}
                    onChange={(e) => onParamChange('color', e.target.value)}
                    className="h-8 w-8 border border-gray-300 rounded mr-2"
                  />
                  <input 
                    type="text" 
                    value={color} 
                    onChange={(e) => onParamChange('color', e.target.value)}
                    className="flex-1 border border-gray-300 rounded px-2 text-xs sm:text-sm"
                    placeholder="#000000"
                  />
                </div>
              </div>
              
              <div>
                <label htmlFor="background" className="block text-xs sm:text-sm text-gray-600 mb-1">
                  Background color:
                </label>
                <div className="flex">
                  <input 
                    type="color" 
                    id="background"
                    value={background === 'transparent' ? '#ffffff' : background} 
                    onChange={(e) => onParamChange('background', e.target.value)}
                    className="h-8 w-8 border border-gray-300 rounded mr-2"
                  />
                  <input 
                    type="text" 
                    value={background} 
                    onChange={(e) => onParamChange('background', e.target.value)}
                    className="flex-1 border border-gray-300 rounded px-2 text-xs sm:text-sm"
                    placeholder="transparent or #hex"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {onApply && (
          <div className="mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-gray-200">
            <button
              onClick={onApply}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-md text-xs sm:text-sm transition-colors duration-200 font-medium flex items-center justify-center"
            >
              Apply Changes
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsPanel; 