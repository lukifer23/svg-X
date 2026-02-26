import React, { useRef, useCallback, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { TurnPolicy, FillStrategy, TracingParams, DEFAULT_PARAMS } from '../utils/imageProcessor';

export interface SettingsPanelProps extends TracingParams {
  onParamChange: <K extends keyof TracingParams>(param: K, value: TracingParams[K]) => void;
  onReset: () => void;
  onClose: () => void;
  onApply?: () => void;
  onApplyComplex?: () => void;
  isMobile?: boolean;
  isComplexMode?: boolean;
}

const TURN_POLICY_DESCRIPTIONS: Record<TurnPolicy, string> = {
  black: 'Prefer to connect black areas',
  white: 'Prefer to connect white areas',
  left: 'Always turn left at ambiguities',
  right: 'Always turn right at ambiguities',
  minority: 'Prefer the minority color (recommended)',
  majority: 'Prefer the majority color'
};

const FILL_STRATEGY_DESCRIPTIONS: Record<FillStrategy, string> = {
  dominant: 'Most frequent colors in the image',
  mean: 'Colors spread across perceptual luminance bands',
  median: 'Median cut — best overall color representation',
  spread: 'Colors evenly spaced by perceptual lightness'
};

const isParamsDirty = (params: TracingParams): boolean => {
  const keys = Object.keys(DEFAULT_PARAMS) as (keyof TracingParams)[];
  return keys.some(k => (params as Record<string, unknown>)[k] !== (DEFAULT_PARAMS as Record<string, unknown>)[k]);
};

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
  colorMode,
  colorSteps,
  fillStrategy,
  onParamChange,
  onReset,
  onClose,
  onApply,
  onApplyComplex,
  isMobile = false,
  isComplexMode = false
}) => {
  const turnPolicyOptions: TurnPolicy[] = ['black', 'white', 'left', 'right', 'minority', 'majority'];
  const fillStrategyOptions: FillStrategy[] = ['dominant', 'mean', 'median', 'spread'];
  const panelRef = useRef<HTMLDivElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement>(null);

  const currentParams: TracingParams = {
    turdSize, turnPolicy, alphaMax, optCurve, optTolerance, threshold,
    blackOnWhite, color, background, invert, highestQuality, colorMode, colorSteps, fillStrategy
  };
  const dirty = isParamsDirty(currentParams);

  // Focus trap: keep keyboard focus inside the modal
  useEffect(() => {
    firstFocusableRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => !el.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const sliderTrackClass = 'w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-blue-600 mt-2';

  const renderSlider = (
    id: string,
    label: string,
    description: string,
    value: number,
    min: number,
    max: number,
    step: number,
    format: (v: number) => string,
    normalizedValue: number,
    onChange: (v: number) => void,
    titleHint?: string
  ) => (
    <div>
      <label htmlFor={id} className="block text-xs sm:text-sm font-medium text-gray-700 mb-0.5">
        {label}: <span className="font-mono text-blue-700">{format(value)}</span>
      </label>
      <div className="text-xs text-gray-500 mb-1">{description}</div>
      <div className="relative">
        <div className="overflow-hidden h-2 rounded-full bg-gray-200 mb-1">
          <div
            style={{ width: `${Math.max(0, Math.min(100, normalizedValue * 100))}%` }}
            className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all"
          />
        </div>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          className={sliderTrackClass}
          title={titleHint}
          aria-label={label}
        />
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4 animate-fade-in overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Tracing Options"
    >
      <div
        ref={panelRef}
        className="bg-white border border-gray-200 rounded-lg p-3 sm:p-6 shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold text-base sm:text-lg flex items-center text-gray-800 gap-2">
            <Settings className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'} text-blue-600`} />
            Tracing Options
            {isComplexMode && (
              <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">Complex Mode</span>
            )}
            {dirty && (
              <span
                className="w-2 h-2 rounded-full bg-orange-400 inline-block"
                title="Settings differ from defaults"
                aria-label="Settings modified"
              />
            )}
          </h3>
          <div className="flex space-x-2">
            {onApplyComplex && (
              <button
                onClick={onApplyComplex}
                className="text-xs px-2 sm:px-3 py-1 sm:py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors duration-200"
                title="Apply optimized settings for complex images with intricate details, geometric patterns, or dense line work"
                aria-label="Apply complex image settings"
              >
                Complex Image
              </button>
            )}
            <button
              ref={firstFocusableRef}
              onClick={onReset}
              className="text-xs px-2 sm:px-3 py-1 sm:py-1.5 bg-gray-100 hover:bg-gray-200 rounded transition-colors duration-200"
              aria-label="Reset all settings to defaults"
              title="Reset all settings to defaults"
            >
              Reset
            </button>
            <button
              onClick={onClose}
              className="text-xs px-2 sm:px-3 py-1 sm:py-1.5 bg-gray-100 hover:bg-gray-200 rounded transition-colors duration-200"
              aria-label="Close settings panel"
              title="Close settings"
            >
              Close
            </button>
          </div>
        </div>

        <div className={`grid ${isMobile ? 'grid-cols-1 gap-4' : 'sm:grid-cols-2 gap-6'}`}>
          {renderSlider(
            'turdSize',
            'Speckle Suppression',
            'Higher = remove more small artifacts. Lower = preserve fine details.',
            turdSize, 1, 100, 1,
            v => String(v),
            (turdSize - 1) / 99,
            v => onParamChange('turdSize', v),
            `Removes shapes with fewer than ${turdSize} pixels. Range: 1–100.`
          )}

          {renderSlider(
            'threshold',
            'Threshold',
            'Controls the black/white cutoff. Lower = more black; higher = more white.',
            threshold, 0, 255, 1,
            v => String(v),
            threshold / 255,
            v => onParamChange('threshold', v),
            `Pixels darker than ${threshold} are treated as black.`
          )}

          {renderSlider(
            'alphaMax',
            'Corner Sharpness',
            'Lower = sharper corners; higher = smoother, more rounded corners.',
            alphaMax, 0.1, 1.5, 0.1,
            v => v.toFixed(1),
            (alphaMax - 0.1) / 1.4,
            v => onParamChange('alphaMax', parseFloat(v.toFixed(1))),
            `alphaMax: ${alphaMax.toFixed(1)}. Values near 0 produce sharp corners; near 1.5 forces smooth curves.`
          )}

          {renderSlider(
            'optTolerance',
            'Curve Tolerance',
            'Higher = more simplification/deviation allowed in Bezier curves.',
            optTolerance, 0.1, 2.0, 0.1,
            v => v.toFixed(1),
            (optTolerance - 0.1) / 1.9,
            v => onParamChange('optTolerance', parseFloat(v.toFixed(1))),
            `optTolerance: ${optTolerance.toFixed(1)}. Range: 0.1–2.0.`
          )}

          <div className={isMobile ? '' : 'sm:col-span-2'}>
            <div className="flex flex-col gap-2">
              <label className="block text-xs sm:text-sm font-medium text-gray-700">Options</label>

              {([
                ['optCurve', 'Enable curve optimization (Bezier fit)', 'Uses Bezier curves instead of straight line segments for smoother output'],
                ['blackOnWhite', 'Black on white (vs. white on black)', 'Assumes the foreground is dark on a light background'],
                ['invert', 'Invert colors before tracing', 'Swaps black and white before tracing — useful for light-on-dark images'],
                ['highestQuality', 'Highest quality (slower)', 'Disables path optimization shortcuts for maximum precision']
              ] as [keyof TracingParams, string, string][]).map(([key, label, desc]) => (
                <div key={key} className="flex items-center gap-2" title={desc}>
                  <input
                    type="checkbox"
                    id={key}
                    checked={currentParams[key] as boolean}
                    onChange={e => onParamChange(key, e.target.checked as TracingParams[typeof key])}
                    className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 flex-shrink-0"
                  />
                  <label htmlFor={key} className="text-xs sm:text-sm text-gray-600 cursor-pointer">
                    {label}
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className={isMobile ? '' : 'sm:col-span-2'}>
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">Turn Policy</label>
            <div className="text-xs text-gray-500 mb-2">Controls how ambiguous boundary pixels are handled during tracing</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {turnPolicyOptions.map(option => (
                <div key={option} className="flex items-start gap-2">
                  <input
                    type="radio"
                    id={`turn-${option}`}
                    name="turnPolicy"
                    value={option}
                    checked={turnPolicy === option}
                    onChange={() => onParamChange('turnPolicy', option)}
                    className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500 mt-0.5 flex-shrink-0"
                  />
                  <div>
                    <label htmlFor={`turn-${option}`} className="text-xs sm:text-sm text-gray-700 font-medium cursor-pointer">
                      {option.charAt(0).toUpperCase() + option.slice(1)}
                    </label>
                    <p className="text-xs text-gray-400 leading-tight">{TURN_POLICY_DESCRIPTIONS[option]}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={isMobile ? '' : 'sm:col-span-2'}>
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">Color Mode</label>
            <div className="flex items-center mb-3" title="Posterizes the image into multiple color layers, each traced separately">
              <input
                type="checkbox"
                id="colorMode"
                checked={colorMode}
                onChange={e => onParamChange('colorMode', e.target.checked)}
                className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
              />
              <label htmlFor="colorMode" className="ml-2 text-xs sm:text-sm text-gray-600 font-medium cursor-pointer">
                Enable color mode (posterization)
              </label>
            </div>

            {colorMode && (
              <>
                {renderSlider(
                  'colorSteps',
                  'Color Steps',
                  'Number of color layers to generate (2–8). More steps = more detail, slower.',
                  colorSteps, 2, 8, 1,
                  v => String(v),
                  (colorSteps - 2) / 6,
                  v => onParamChange('colorSteps', v),
                  `${colorSteps} color layers will be generated`
                )}

                <div className="mt-3">
                  <label className="block text-xs sm:text-sm text-gray-600 mb-1">Fill Strategy</label>
                  <div className="text-xs text-gray-500 mb-2">How colors are selected for each layer</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {fillStrategyOptions.map(option => (
                      <div key={option} className="flex items-start gap-2">
                        <input
                          type="radio"
                          id={`fill-${option}`}
                          name="fillStrategy"
                          value={option}
                          checked={fillStrategy === option}
                          onChange={() => onParamChange('fillStrategy', option)}
                          className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500 mt-0.5 flex-shrink-0"
                        />
                        <div>
                          <label htmlFor={`fill-${option}`} className="text-xs sm:text-sm text-gray-700 font-medium cursor-pointer">
                            {option.charAt(0).toUpperCase() + option.slice(1)}
                          </label>
                          <p className="text-xs text-gray-400 leading-tight">{FILL_STRATEGY_DESCRIPTIONS[option]}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className={isMobile ? '' : 'sm:col-span-2'}>
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">SVG Colors</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="color-text" className="block text-xs sm:text-sm text-gray-600 mb-1">Foreground color</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    id="color-swatch"
                    value={color}
                    onChange={e => onParamChange('color', e.target.value)}
                    className="h-8 w-8 border border-gray-300 rounded cursor-pointer flex-shrink-0"
                    title="Pick foreground color"
                    aria-label="Foreground color picker"
                  />
                  <input
                    type="text"
                    id="color-text"
                    value={color}
                    onChange={e => {
                      if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
                        onParamChange('color', e.target.value);
                      }
                    }}
                    className="flex-1 border border-gray-300 rounded px-2 text-xs sm:text-sm font-mono"
                    placeholder="#000000"
                    maxLength={7}
                    title="Hex color value (e.g. #000000)"
                    aria-label="Foreground color hex value"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="background-text" className="block text-xs sm:text-sm text-gray-600 mb-1">Background color</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    id="background-swatch"
                    value={background === 'transparent' ? '#ffffff' : background}
                    onChange={e => onParamChange('background', e.target.value)}
                    className="h-8 w-8 border border-gray-300 rounded cursor-pointer flex-shrink-0"
                    title="Pick background color (sets a solid color; type 'transparent' to remove)"
                    disabled={background === 'transparent'}
                    aria-label="Background color picker"
                  />
                  <input
                    type="text"
                    id="background-text"
                    value={background}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === 'transparent' || /^#[0-9A-Fa-f]{6}$/.test(v)) {
                        onParamChange('background', v);
                      }
                    }}
                    className="flex-1 border border-gray-300 rounded px-2 text-xs sm:text-sm font-mono"
                    placeholder="transparent or #rrggbb"
                    title="'transparent' for no background, or a hex color like #ffffff"
                    aria-label="Background color hex value or transparent"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">Type 'transparent' or a hex value</p>
              </div>
            </div>
          </div>
        </div>

        {onApply && (
          <div className="mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-gray-200">
            <button
              onClick={onApply}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-md text-xs sm:text-sm transition-colors duration-200 font-medium"
              aria-label="Apply current settings and re-process image"
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
