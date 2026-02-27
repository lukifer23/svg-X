import React, { useRef, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { TurnPolicy, FillStrategy, TracingParams, DEFAULT_PARAMS } from '../utils/imageProcessor';
import Tooltip from './Tooltip';

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
  dominant: 'Most frequent colors (Wu variance-optimal boxes)',
  mean: 'Colors spread across perceptual luminance bands',
  median: 'Balanced tonal distribution across the palette',
  spread: 'Colors evenly spaced by perceptual lightness'
};

const isParamsDirty = (params: TracingParams): boolean => {
  const keys = Object.keys(DEFAULT_PARAMS) as (keyof TracingParams)[];
  return keys.some(k => (params as Record<string, unknown>)[k] !== (DEFAULT_PARAMS as Record<string, unknown>)[k]);
};

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  turdSize, turnPolicy, alphaMax, optCurve, optTolerance, threshold,
  blackOnWhite, color, background, invert, highestQuality,
  colorMode, colorSteps, fillStrategy,
  strokeMode, strokeWidth, maxPaths, svgoOptimize,
  onParamChange, onReset, onClose, onApply, onApplyComplex,
  isMobile = false, isComplexMode = false
}) => {
  const turnPolicyOptions: TurnPolicy[] = ['black', 'white', 'left', 'right', 'minority', 'majority'];
  const fillStrategyOptions: FillStrategy[] = ['dominant', 'mean', 'median', 'spread'];
  const panelRef = useRef<HTMLDivElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement>(null);

  const currentParams: TracingParams = {
    turdSize, turnPolicy, alphaMax, optCurve, optTolerance, threshold,
    blackOnWhite, color, background, invert, highestQuality,
    colorMode, colorSteps, fillStrategy,
    strokeMode, strokeWidth, maxPaths, svgoOptimize,
  };
  const dirty = isParamsDirty(currentParams);

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
    tooltip: string,
    value: number,
    min: number,
    max: number,
    step: number,
    format: (v: number) => string,
    normalizedValue: number,
    onChange: (v: number) => void
  ) => (
    <div>
      <div className="flex items-center gap-1.5 mb-0.5">
        <label htmlFor={id} className="text-xs sm:text-sm font-medium text-gray-700">
          {label}: <span className="font-mono text-blue-700">{format(value)}</span>
        </label>
        <Tooltip content={tooltip} />
      </div>
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
          aria-label={label}
        />
      </div>
    </div>
  );

  const renderCheckbox = (
    id: keyof TracingParams,
    label: string,
    tooltip: string,
    checked: boolean
  ) => (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        id={String(id)}
        checked={checked}
        onChange={e => onParamChange(id, e.target.checked as TracingParams[typeof id])}
        className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 flex-shrink-0"
      />
      <label htmlFor={String(id)} className="text-xs sm:text-sm text-gray-600 cursor-pointer flex items-center gap-1">
        {label}
        <Tooltip content={tooltip} />
      </label>
    </div>
  );

  const colSpan = isMobile ? '' : 'sm:col-span-2';

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
            >
              Reset
            </button>
            <button
              onClick={onClose}
              className="text-xs px-2 sm:px-3 py-1 sm:py-1.5 bg-gray-100 hover:bg-gray-200 rounded transition-colors duration-200"
              aria-label="Close settings panel"
            >
              Close
            </button>
          </div>
        </div>

        {/* === B&W POTRACE SETTINGS === */}
        {!colorMode && (
          <div className="mb-6">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">B&amp;W / Potrace Settings</h4>
            <div className={`grid ${isMobile ? 'grid-cols-1 gap-4' : 'sm:grid-cols-2 gap-6'}`}>
              {renderSlider(
                'turdSize', 'Speckle Suppression',
                'Removes shapes with fewer than this many pixels. Higher = cleaner output, fewer small artifacts. Range: 1–100.',
                turdSize, 1, 100, 1, v => String(v), (turdSize - 1) / 99,
                v => onParamChange('turdSize', v)
              )}
              {renderSlider(
                'threshold', 'Threshold',
                'Pixel brightness cutoff. Pixels darker than this value are treated as black. 128 = midpoint. Range: 0–255.',
                threshold, 0, 255, 1, v => String(v), threshold / 255,
                v => onParamChange('threshold', v)
              )}
              {renderSlider(
                'alphaMax', 'Corner Sharpness',
                'Controls when a vertex is treated as a corner vs. a smooth curve. 0 = always sharp corners, 1.33 = always smooth. Range: 0.1–1.5.',
                alphaMax, 0.1, 1.5, 0.1, v => v.toFixed(1), (alphaMax - 0.1) / 1.4,
                v => onParamChange('alphaMax', parseFloat(v.toFixed(1)))
              )}
              {renderSlider(
                'optTolerance', 'Curve Tolerance',
                'Aggressiveness of Bezier curve optimization. Higher = fewer nodes with more deviation allowed. Range: 0.1–2.0.',
                optTolerance, 0.1, 2.0, 0.1, v => v.toFixed(1), (optTolerance - 0.1) / 1.9,
                v => onParamChange('optTolerance', parseFloat(v.toFixed(1)))
              )}

              <div className={colSpan}>
                <div className="flex flex-col gap-2">
                  <label className="block text-xs sm:text-sm font-medium text-gray-700">B&amp;W Options</label>
                  {renderCheckbox('optCurve', 'Bezier curve optimization', 'Use Bezier curves instead of straight line segments for smoother, more compact output. Disable for polygon-only output.', optCurve)}
                  {renderCheckbox('blackOnWhite', 'Black on white', 'Assume foreground is dark on a light background. Disable to trace light shapes on a dark background.', blackOnWhite)}
                  {renderCheckbox('invert', 'Invert colors before tracing', 'Swap black and white before tracing. Useful for light-on-dark logos or inverted scans.', invert)}
                  {renderCheckbox('highestQuality', 'Highest quality (slower)', 'Disables path optimization shortcuts for maximum path accuracy. Significantly slower on large images.', highestQuality)}
                </div>
              </div>

              <div className={colSpan}>
                <div className="flex items-center gap-1.5 mb-2">
                  <label className="block text-xs sm:text-sm font-medium text-gray-700">Turn Policy</label>
                  <Tooltip content="Controls how ambiguous boundary pixels (where black and white meet diagonally) are resolved during path construction." />
                </div>
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
            </div>
          </div>
        )}

        {/* === COLOR MODE === */}
        <div className="mb-6">
          <div className="flex items-center gap-1.5 mb-3">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Color Mode</h4>
            <Tooltip content="Posterizes the image into multiple color layers, each traced separately with Marching Squares contour tracing and Schneider Bezier fitting. Uses Wu's color quantization for best palette quality." />
          </div>
          <div className="flex items-center mb-3">
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
            <div className={`grid ${isMobile ? 'grid-cols-1 gap-4' : 'sm:grid-cols-2 gap-6'}`}>
              {renderSlider(
                'colorSteps', 'Color Steps',
                'Number of color layers to generate. More steps = richer detail and more colors, but slower processing. Range: 2–8.',
                colorSteps, 2, 8, 1, v => String(v), (colorSteps - 2) / 6,
                v => onParamChange('colorSteps', v)
              )}

              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="block text-xs sm:text-sm font-medium text-gray-700">Fill Strategy</label>
                  <Tooltip content="How the color palette is derived from the image. All strategies use Wu's 3D histogram quantization as the foundation." />
                </div>
                <div className="grid grid-cols-1 gap-2 mt-1">
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
            </div>
          )}
        </div>

        {/* === STROKE MODE === */}
        <div className="mb-6">
          <div className="flex items-center gap-1.5 mb-3">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Stroke / Centerline Mode</h4>
            <Tooltip content="Extracts thin skeletal centerlines instead of filled regions. Uses Zhang-Suen thinning to reduce filled shapes to 1-pixel-wide skeletons, then traces and outputs stroked open paths. Best for line art, sketches, architectural drawings, and circuit diagrams." />
          </div>
          <div className="flex items-center mb-3">
            <input
              type="checkbox"
              id="strokeMode"
              checked={strokeMode}
              onChange={e => onParamChange('strokeMode', e.target.checked)}
              className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
            />
            <label htmlFor="strokeMode" className="ml-2 text-xs sm:text-sm text-gray-600 font-medium cursor-pointer">
              Enable stroke / centerline mode
            </label>
          </div>

          {strokeMode && renderSlider(
            'strokeWidth', 'Stroke Width',
            'Width in pixels of the output stroked paths. Applied uniformly to all centerline paths.',
            strokeWidth, 1, 20, 0.5, v => `${v}px`, (strokeWidth - 1) / 19,
            v => onParamChange('strokeWidth', parseFloat(v.toFixed(1)))
          )}
        </div>

        {/* === SVG COLORS === */}
        {!colorMode && (
          <div className="mb-6">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">SVG Colors</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label htmlFor="color-text" className="text-xs sm:text-sm text-gray-600">Foreground color</label>
                  <Tooltip content="The fill color applied to all traced paths in B&W mode." />
                </div>
                <div className="flex gap-2">
                  <input
                    type="color"
                    id="color-swatch"
                    value={color}
                    onChange={e => onParamChange('color', e.target.value)}
                    className="h-8 w-8 border border-gray-300 rounded cursor-pointer flex-shrink-0"
                    aria-label="Foreground color picker"
                  />
                  <input
                    type="text"
                    id="color-text"
                    value={color}
                    onChange={e => {
                      if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) onParamChange('color', e.target.value);
                    }}
                    className="flex-1 border border-gray-300 rounded px-2 text-xs sm:text-sm font-mono"
                    placeholder="#000000"
                    maxLength={7}
                    aria-label="Foreground color hex value"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label htmlFor="background-text" className="text-xs sm:text-sm text-gray-600">Background color</label>
                  <Tooltip content="The SVG background rectangle color. Use 'transparent' for no background fill (default). Set to a hex color like #ffffff for a solid white background." />
                </div>
                <div className="flex gap-2">
                  <input
                    type="color"
                    id="background-swatch"
                    value={background === 'transparent' ? '#ffffff' : background}
                    onChange={e => onParamChange('background', e.target.value)}
                    className="h-8 w-8 border border-gray-300 rounded cursor-pointer flex-shrink-0"
                    disabled={background === 'transparent'}
                    aria-label="Background color picker"
                  />
                  <input
                    type="text"
                    id="background-text"
                    value={background}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === 'transparent' || /^#[0-9A-Fa-f]{6}$/.test(v)) onParamChange('background', v);
                    }}
                    className="flex-1 border border-gray-300 rounded px-2 text-xs sm:text-sm font-mono"
                    placeholder="transparent or #rrggbb"
                    aria-label="Background color hex value or transparent"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">Type 'transparent' or a hex value</p>
              </div>
            </div>
          </div>
        )}

        {/* === ADVANCED === */}
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Advanced</h4>
          <div className={`grid ${isMobile ? 'grid-cols-1 gap-4' : 'sm:grid-cols-2 gap-6'}`}>
            {renderSlider(
              'maxPaths', 'Max Paths per Layer',
              'Maximum number of contour paths to keep per color layer. Higher = more detail, more complex SVG. Lower = faster processing, simpler output. Range: 100–10000.',
              maxPaths, 100, 10000, 100, v => v.toLocaleString(), (maxPaths - 100) / 9900,
              v => onParamChange('maxPaths', Math.round(v))
            )}

            <div className="flex flex-col gap-3">
              {renderCheckbox('svgoOptimize', 'SVGO post-processing', 'Runs SVGO (SVG optimizer) on the output SVG after tracing. Typically reduces file size 20–50% with no visual quality loss. Disable only if you need to preserve exact path strings.', svgoOptimize)}
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
