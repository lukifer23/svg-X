import * as Potrace from 'potrace';
import slugify from 'slugify';
import { optimize as svgoOptimize } from 'svgo';

export const formatTimestamp = (): string =>
  new Date().toISOString().split('T')[1].split('.')[0];

export const isNetworkClient = (): boolean => {
  const hostname = window.location.hostname;
  return !(hostname === 'localhost' || hostname === '127.0.0.1');
};

export type TurnPolicy = 'black' | 'white' | 'left' | 'right' | 'minority' | 'majority';
export type FillStrategy = 'dominant' | 'mean' | 'median' | 'spread';

export interface TracingParams {
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
  colorMode: boolean;
  colorSteps: number;
  fillStrategy: FillStrategy;
  strokeMode: boolean;
  strokeWidth: number;
  maxPaths: number;
  svgoOptimize: boolean;
}

export const DEFAULT_PARAMS: TracingParams = {
  turdSize: 2,
  turnPolicy: 'minority',
  alphaMax: 1,
  optCurve: true,
  optTolerance: 0.2,
  threshold: 128,
  blackOnWhite: true,
  color: '#000000',
  background: 'transparent',
  invert: false,
  highestQuality: false,
  colorMode: false,
  colorSteps: 4,
  fillStrategy: 'dominant',
  strokeMode: false,
  strokeWidth: 2,
  maxPaths: 2000,
  svgoOptimize: true,
};

export const PROGRESS_STEPS: Record<string, string> = {
  idle: '',
  loading: 'Loading image...',
  analyzing: 'Analyzing image...',
  tracing: 'Tracing image contours...',
  colorProcessing: 'Processing color layers...',
  optimizing: 'Optimizing SVG output...',
  done: 'Done!',
  error: 'An error occurred'
};

type LogCallback = (step: string, message: string, isError: boolean, timestamp: string) => void;

const logProcessingStep = (
  step: string,
  message: string,
  isError = false,
  logCallback?: LogCallback,
  timestamp = formatTimestamp()
) => {
  console[isError ? 'error' : 'log'](`[${timestamp}] [${step}] ${message}`);
  if (logCallback) {
    logCallback(step, message, isError, timestamp);
  }
};

const createHeartbeat = (operation: string, intervalMs: number, logCallback?: LogCallback) => {
  const heartbeatId = setInterval(() => {
    logProcessingStep('HEARTBEAT', `${operation} still running...`, false, logCallback);
  }, intervalMs);
  return { stop: () => clearInterval(heartbeatId) };
};

const runSvgoOptimize = (svg: string): string => {
  try {
    const result = svgoOptimize(svg, {
      plugins: [
        {
          name: 'preset-default',
          params: {
            overrides: {
              removeViewBox: false,
              cleanupIds: false,
            },
          },
        },
      ],
    });
    return result.data;
  } catch {
    return svg;
  }
};

const trace = (
  image: string,
  options: TracingParams,
  callback: (err: Error | null, svg?: string) => void,
  logCallback?: LogCallback
) => {
  let cancelled = false;

  try {
    const isNetwork = isNetworkClient();
    const heartbeat = createHeartbeat('Potrace image tracing', isNetwork ? 1000 : 2000, logCallback);
    const startTime = performance.now();

    logProcessingStep('TRACE_START', 'Starting Potrace', false, logCallback);

    setTimeout(() => {
      try {
        (Potrace as any).trace(image, options, (err: Error | null, svg?: string) => {
          heartbeat.stop();
          if (cancelled) return;
          if (err) {
            logProcessingStep('TRACE_ERROR', `Error during Potrace tracing: ${err.message}`, true, logCallback);
            callback(err);
            return;
          }
          const optimized = options.svgoOptimize && svg ? runSvgoOptimize(svg) : svg;
          logProcessingStep('TRACE_COMPLETE', `Completed in ${Math.round(performance.now() - startTime)}ms`, false, logCallback);
          callback(null, optimized);
        });
      } catch (error) {
        heartbeat.stop();
        if (cancelled) return;
        logProcessingStep('TRACE_SETUP_ERROR', `Exception during Potrace execution: ${error}`, true, logCallback);
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    }, isNetwork ? 300 : 0);
  } catch (error) {
    logProcessingStep('TRACE_SETUP_ERROR', `Failed to initialize tracing: ${error}`, true, logCallback);
    callback(error instanceof Error ? error : new Error(String(error)));
  }

  return { cancel: () => { cancelled = true; } };
};

// ---------------------------------------------------------------------------
// Web Worker: complete inline posterization engine
//
// Algorithms:
//   - Wu's color quantization (1992): 3D histogram with moment tables, minimum
//     variance partition — far superior spatial coherence vs. bucket hashing.
//   - Canny edge detection: Gaussian blur (σ≈1) → Sobel gradient + angle →
//     non-maximum suppression → hysteresis thresholding.
//   - Marching Squares contour tracing: 2×2 cell lookup (16 cases), linear
//     interpolation for sub-pixel accuracy, correct winding via shoelace sign.
//   - Zhang-Suen thinning (stroke mode): iterative 2-pass skeleton extraction.
//   - Schneider cubic Bezier fitting: least-squares chord-length param, with
//     recursive split at max-error point.
//   - Douglas-Peucker simplification: closed-path wrap-around aware.
//   - CIE L* perceptual threshold distribution.
//   - Painter's order assembly with cross-layer path deduplication.
//   - Proper sRGB gamma (pow(Y, 1/2.2)) throughout.
// ---------------------------------------------------------------------------
const createPosterizeWorker = (
  image: string,
  options: Record<string, unknown>,
  progressCallback: (progress: number, details?: string) => void,
  completeCallback: (svg: string | null, error: Error | null) => void,
  logCallback?: LogCallback
) => {
  const workerScript = `
    'use strict';

    function workerLog(message) {
      self.postMessage({ type: 'log', message: String(message) });
    }

    // --- Image loading ---
    function dataURLToImageData(dataURL) {
      return fetch(dataURL)
        .then(r => r.blob())
        .then(b => createImageBitmap(b))
        .then(bmp => {
          const canvas = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Failed to get canvas context');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, bmp.width, bmp.height);
          ctx.drawImage(bmp, 0, 0);
          return { imageData: ctx.getImageData(0, 0, bmp.width, bmp.height), width: bmp.width, height: bmp.height };
        });
    }

    // sRGB → linear luminance Y
    function srgbToLinear(c) {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }

    function srgbLuma(r, g, b) {
      return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
    }

    // L* → 8-bit display value using proper sRGB gamma
    function lStarToThreshold(L) {
      const Y = L <= 8 ? L / 903.3 : Math.pow((L + 16) / 116, 3);
      return Math.round(Math.pow(Math.max(0, Y), 1 / 2.2) * 255);
    }

    // ===========================================================================
    // WU'S COLOR QUANTIZATION (1992)
    // Xiaolin Wu, "Efficient Statistical Computations for Optimal Color Quantization"
    // Graphics Gems Vol II, pp. 126-133.
    //
    // Builds a 3D histogram in RGB space (33×33×33 = HISTSIZE bins),
    // computes prefix-sum moment tables, then recursively cuts the box with
    // maximum variance along its dominant axis.
    // ===========================================================================
    const WUSIZE = 33; // 0..32 inclusive; index = (channel >> 3) + 1

    function wuQuantize(imageData, numColors) {
      const data = imageData.data;
      const pixelCount = imageData.width * imageData.height;
      const S = WUSIZE;
      const S2 = S * S;
      const S3 = S * S * S;

      // Moment tables: wt=count, mr/mg/mb=sum of channels, m2=sum of squared luma
      const wt = new Int32Array(S3);
      const mr = new Int32Array(S3);
      const mg = new Int32Array(S3);
      const mb = new Int32Array(S3);
      const m2 = new Float64Array(S3);

      const idx = (ir, ig, ib) => ir * S2 + ig * S + ib;

      // Build histogram (subsample large images for speed)
      const step = Math.max(1, Math.floor(pixelCount / 200000));
      for (let i = 0; i < pixelCount; i += step) {
        const p = i * 4;
        if (data[p + 3] < 128) continue;
        const r = data[p], g = data[p + 1], b = data[p + 2];
        // Map 0-255 to 1-32 (skip bin 0, used as boundary)
        const ir = (r >> 3) + 1;
        const ig = (g >> 3) + 1;
        const ib = (b >> 3) + 1;
        const i3 = idx(ir, ig, ib);
        wt[i3]++;
        mr[i3] += r;
        mg[i3] += g;
        mb[i3] += b;
        const y = srgbLuma(r, g, b);
        m2[i3] += y * y;
      }

      // Compute prefix-sum moments (3D scan)
      for (let r = 1; r < S; r++) {
        for (let g = 1; g < S; g++) {
          let area_wt = 0, area_mr = 0, area_mg = 0, area_mb = 0, area_m2 = 0;
          for (let b = 1; b < S; b++) {
            const i3 = idx(r, g, b);
            area_wt += wt[i3]; area_mr += mr[i3]; area_mg += mg[i3]; area_mb += mb[i3]; area_m2 += m2[i3];
            // Prefix sum along b, then add r-1 and g-1 planes
            const i_rm1 = idx(r - 1, g, b);
            const i_gm1 = idx(r, g - 1, b);
            const i_rgm1 = idx(r - 1, g - 1, b);
            wt[i3] = area_wt + wt[i_rm1] + wt[i_gm1] - wt[i_rgm1];
            mr[i3] = area_mr + mr[i_rm1] + mr[i_gm1] - mr[i_rgm1];
            mg[i3] = area_mg + mg[i_rm1] + mg[i_gm1] - mg[i_rgm1];
            mb[i3] = area_mb + mb[i_rm1] + mb[i_gm1] - mb[i_rgm1];
            m2[i3] = area_m2 + m2[i_rm1] + m2[i_gm1] - m2[i_rgm1];
          }
        }
      }

      // Volume sum from (r0,g0,b0) exclusive to (r1,g1,b1) inclusive
      function vol(wt_arr, r0, g0, b0, r1, g1, b1) {
        return wt_arr[idx(r1,g1,b1)] - wt_arr[idx(r1,g1,b0)] - wt_arr[idx(r1,g0,b1)] + wt_arr[idx(r1,g0,b0)]
             - wt_arr[idx(r0,g1,b1)] + wt_arr[idx(r0,g1,b0)] + wt_arr[idx(r0,g0,b1)] - wt_arr[idx(r0,g0,b0)];
      }

      // Variance of a box
      function variance(r0, g0, b0, r1, g1, b1) {
        const vwt = vol(wt, r0, g0, b0, r1, g1, b1);
        if (vwt === 0) return 0;
        const vmr = vol(mr, r0, g0, b0, r1, g1, b1);
        const vmg = vol(mg, r0, g0, b0, r1, g1, b1);
        const vmb = vol(mb, r0, g0, b0, r1, g1, b1);
        const vm2 = vol(m2, r0, g0, b0, r1, g1, b1);
        return vm2 - (vmr * vmr + vmg * vmg + vmb * vmb) / vwt;
      }

      // Find optimal cut position along one axis, returns max variance gain
      function maximize(r0, g0, b0, r1, g1, b1, dir) {
        let base_wt, base_mr, base_mg, base_mb;
        const whole_wt = vol(wt, r0, g0, b0, r1, g1, b1);
        const whole_mr = vol(mr, r0, g0, b0, r1, g1, b1);
        const whole_mg = vol(mg, r0, g0, b0, r1, g1, b1);
        const whole_mb = vol(mb, r0, g0, b0, r1, g1, b1);

        let maxGain = 0, cutPos = -1;

        const lo = dir === 'r' ? r0 : dir === 'g' ? g0 : b0;
        const hi = dir === 'r' ? r1 : dir === 'g' ? g1 : b1;

        for (let i = lo + 1; i < hi; i++) {
          let halfwt, halfmr, halfmg, halfmb;
          if (dir === 'r') {
            halfwt = vol(wt, r0, g0, b0, i, g1, b1);
            halfmr = vol(mr, r0, g0, b0, i, g1, b1);
            halfmg = vol(mg, r0, g0, b0, i, g1, b1);
            halfmb = vol(mb, r0, g0, b0, i, g1, b1);
          } else if (dir === 'g') {
            halfwt = vol(wt, r0, g0, b0, r1, i, b1);
            halfmr = vol(mr, r0, g0, b0, r1, i, b1);
            halfmg = vol(mg, r0, g0, b0, r1, i, b1);
            halfmb = vol(mb, r0, g0, b0, r1, i, b1);
          } else {
            halfwt = vol(wt, r0, g0, b0, r1, g1, i);
            halfmr = vol(mr, r0, g0, b0, r1, g1, i);
            halfmg = vol(mg, r0, g0, b0, r1, g1, i);
            halfmb = vol(mb, r0, g0, b0, r1, g1, i);
          }
          if (halfwt === 0) continue;
          const remwt = whole_wt - halfwt;
          if (remwt === 0) continue;
          const gain = (halfmr*halfmr + halfmg*halfmg + halfmb*halfmb) / halfwt
                     + ((whole_mr-halfmr)*(whole_mr-halfmr) + (whole_mg-halfmg)*(whole_mg-halfmg) + (whole_mb-halfmb)*(whole_mb-halfmb)) / remwt;
          if (gain > maxGain) { maxGain = gain; cutPos = i; }
        }
        return { maxGain, cutPos };
      }

      // Boxes: [r0,g0,b0,r1,g1,b1]
      let boxes = [[0, 0, 0, S-1, S-1, S-1]];

      while (boxes.length < numColors) {
        // Pick box with maximum variance
        let maxVar = -1, splitIdx = 0;
        for (let i = 0; i < boxes.length; i++) {
          const [r0,g0,b0,r1,g1,b1] = boxes[i];
          const v = variance(r0,g0,b0,r1,g1,b1);
          if (v > maxVar) { maxVar = v; splitIdx = i; }
        }
        if (maxVar <= 0) break;

        const box = boxes[splitIdx];
        const [r0,g0,b0,r1,g1,b1] = box;

        const cr = maximize(r0,g0,b0,r1,g1,b1,'r');
        const cg = maximize(r0,g0,b0,r1,g1,b1,'g');
        const cb = maximize(r0,g0,b0,r1,g1,b1,'b');

        let dir, cutPos;
        if (cr.maxGain >= cg.maxGain && cr.maxGain >= cb.maxGain) { dir = 'r'; cutPos = cr.cutPos; }
        else if (cg.maxGain >= cb.maxGain) { dir = 'g'; cutPos = cg.cutPos; }
        else { dir = 'b'; cutPos = cb.cutPos; }

        if (cutPos < 0) break;

        boxes.splice(splitIdx, 1);
        if (dir === 'r') {
          boxes.push([r0,g0,b0,cutPos,g1,b1]);
          boxes.push([cutPos,g0,b0,r1,g1,b1]);
        } else if (dir === 'g') {
          boxes.push([r0,g0,b0,r1,cutPos,b1]);
          boxes.push([r0,cutPos,b0,r1,g1,b1]);
        } else {
          boxes.push([r0,g0,b0,r1,g1,cutPos]);
          boxes.push([r0,g0,cutPos,r1,g1,b1]);
        }
      }

      // Extract representative color (weighted centroid) for each box
      return boxes.map(([r0,g0,b0,r1,g1,b1]) => {
        const vwt = vol(wt, r0,g0,b0,r1,g1,b1);
        if (vwt === 0) return { r: 128, g: 128, b: 128, luma: srgbLuma(128,128,128) };
        const r = Math.round(vol(mr, r0,g0,b0,r1,g1,b1) / vwt);
        const g = Math.round(vol(mg, r0,g0,b0,r1,g1,b1) / vwt);
        const b = Math.round(vol(mb, r0,g0,b0,r1,g1,b1) / vwt);
        return { r, g, b, luma: srgbLuma(r, g, b) };
      });
    }

    function quantizeColors(imageData, numColors, strategy) {
      strategy = strategy || 'dominant';
      workerLog('Quantizing colors: ' + numColors + ' target, strategy=' + strategy);

      // Wu's algorithm gives us high-quality palette boxes
      let colors = wuQuantize(imageData, Math.max(numColors, 16));
      workerLog('Wu boxes: ' + colors.length);

      let selected;
      if (strategy === 'spread') {
        // Perceptually spread: sort by luminance, pick evenly spaced
        colors.sort((a, b) => a.luma - b.luma);
        selected = [];
        if (colors.length <= numColors) {
          selected = colors.slice();
        } else {
          const step = (colors.length - 1) / Math.max(1, numColors - 1);
          for (let i = 0; i < numColors; i++) {
            selected.push(colors[Math.min(colors.length - 1, Math.round(i * step))]);
          }
        }
      } else if (strategy === 'mean') {
        // Divide luminance range into numColors equal bands, pick nearest color per band
        colors.sort((a, b) => a.luma - b.luma);
        selected = [];
        const bandSize = 1.0 / numColors;
        for (let i = 0; i < numColors; i++) {
          const targetLuma = (i + 0.5) * bandSize;
          let best = colors[0], bestDist = Infinity;
          for (const c of colors) {
            const d = Math.abs(c.luma - targetLuma);
            if (d < bestDist) { bestDist = d; best = c; }
          }
          selected.push(best);
        }
        // Deduplicate
        const unique = [...new Map(selected.map(c => [c.r + ',' + c.g + ',' + c.b, c])).values()];
        if (unique.length < numColors) {
          colors.sort((a, b) => b.luma - a.luma);
          selected = colors.slice(0, numColors);
        } else {
          selected = unique;
        }
      } else {
        // dominant / median: take the Wu boxes directly (already variance-optimal)
        // For dominant, sort by box population would be ideal but Wu doesn't track that
        // after moment accumulation. Sort by luma for painter's order stability.
        selected = colors.slice(0, numColors);
      }

      // Pad by splitting the largest luminance gap
      while (selected.length < numColors) {
        if (selected.length === 0) {
          selected.push({ r: 0, g: 0, b: 0, luma: 0 });
        } else {
          selected.sort((a, b) => a.luma - b.luma);
          let maxGap = -1, gapIdx = 0;
          for (let i = 0; i < selected.length - 1; i++) {
            const gap = selected[i + 1].luma - selected[i].luma;
            if (gap > maxGap) { maxGap = gap; gapIdx = i; }
          }
          const a = selected[gapIdx], b = selected[gapIdx + 1];
          const nr = Math.round((a.r + b.r) / 2);
          const ng = Math.round((a.g + b.g) / 2);
          const nb = Math.round((a.b + b.b) / 2);
          selected.splice(gapIdx + 1, 0, { r: nr, g: ng, b: nb, luma: srgbLuma(nr, ng, nb) });
        }
      }

      return selected.map(c => 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')');
    }

    // --- Perceptual CIE L* threshold distribution (proper sRGB gamma) ---
    function computeThresholds(numSteps) {
      if (numSteps <= 1) return [128];
      const steps = [];
      for (let i = 1; i < numSteps; i++) {
        const L = 5 + (i / numSteps) * 90;
        const value = lStarToThreshold(L);
        steps.push(Math.min(254, Math.max(1, value)));
      }
      return steps.filter((v, i, a) => i === 0 || v !== a[i - 1]);
    }

    // ===========================================================================
    // CANNY EDGE DETECTION
    // Gaussian blur (5×5, σ≈1) → Sobel gradient magnitude + angle →
    // non-maximum suppression → hysteresis thresholding.
    // ===========================================================================

    // Precomputed 5×5 Gaussian kernel (σ≈1.0), sum=159
    const GAUSS5 = [
       2,  4,  5,  4,  2,
       4,  9, 12,  9,  4,
       5, 12, 15, 12,  5,
       4,  9, 12,  9,  4,
       2,  4,  5,  4,  2
    ];
    const GAUSS5_SUM = 159;

    function cannyEdgeDetect(imageData, lowRatio, highRatio) {
      lowRatio = lowRatio || 0.05;
      highRatio = highRatio || 0.15;
      const width = imageData.width, height = imageData.height;
      const data = imageData.data;
      const N = width * height;

      // Convert to grayscale luma float
      const gray = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const p = i * 4;
        if (data[p + 3] < 128) { gray[i] = 255; continue; }
        gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      }

      // Gaussian blur
      const blurred = new Float32Array(N);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let sum = 0, wsum = 0;
          for (let ky = -2; ky <= 2; ky++) {
            for (let kx = -2; kx <= 2; kx++) {
              const ny = y + ky, nx = x + kx;
              if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
              const w = GAUSS5[(ky + 2) * 5 + (kx + 2)];
              sum += gray[ny * width + nx] * w;
              wsum += w;
            }
          }
          blurred[y * width + x] = sum / wsum;
        }
      }

      // Sobel gradient magnitude and angle
      const mag = new Float32Array(N);
      const angle = new Uint8Array(N); // 0=0°, 1=45°, 2=90°, 3=135°
      let maxMag = 0;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const tl = blurred[(y-1)*width+x-1], tc = blurred[(y-1)*width+x], tr = blurred[(y-1)*width+x+1];
          const ml = blurred[y*width+x-1],                                   mr = blurred[y*width+x+1];
          const bl = blurred[(y+1)*width+x-1], bc = blurred[(y+1)*width+x], br = blurred[(y+1)*width+x+1];
          const Gx = (tr + 2*mr + br) - (tl + 2*ml + bl);
          const Gy = (bl + 2*bc + br) - (tl + 2*tc + tr);
          const m = Math.sqrt(Gx*Gx + Gy*Gy);
          mag[y*width+x] = m;
          if (m > maxMag) maxMag = m;
          // Quantize angle to 4 directions
          let theta = Math.atan2(Gy, Gx) * 180 / Math.PI;
          if (theta < 0) theta += 180;
          angle[y*width+x] = theta < 22.5 || theta >= 157.5 ? 0
                            : theta < 67.5 ? 1
                            : theta < 112.5 ? 2
                            : 3;
        }
      }

      if (maxMag === 0) return new Uint8Array(N);

      // Non-maximum suppression
      const suppressed = new Float32Array(N);
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const i = y * width + x;
          const m = mag[i];
          let n1, n2;
          switch (angle[i]) {
            case 0: n1 = mag[i - 1];            n2 = mag[i + 1];            break;
            case 1: n1 = mag[(y-1)*width+x+1];  n2 = mag[(y+1)*width+x-1]; break;
            case 2: n1 = mag[(y-1)*width+x];    n2 = mag[(y+1)*width+x];   break;
            case 3: n1 = mag[(y-1)*width+x-1];  n2 = mag[(y+1)*width+x+1]; break;
          }
          suppressed[i] = (m >= n1 && m >= n2) ? m : 0;
        }
      }

      // Hysteresis thresholding
      const highThresh = maxMag * highRatio;
      const lowThresh  = maxMag * lowRatio;
      const edgeMap = new Uint8Array(N);
      const strong = new Uint8Array(N);

      for (let i = 0; i < N; i++) {
        if (suppressed[i] >= highThresh) { edgeMap[i] = 2; strong[i] = 1; }
        else if (suppressed[i] >= lowThresh) edgeMap[i] = 1;
      }

      // BFS flood fill from strong edges to connect weak edges
      const queue = [];
      for (let i = 0; i < N; i++) if (strong[i]) queue.push(i);
      let head = 0;
      while (head < queue.length) {
        const cur = queue[head++];
        const y = Math.floor(cur / width), x = cur % width;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dy === 0 && dx === 0) continue;
            const ny = y + dy, nx = x + dx;
            if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
            const ni = ny * width + nx;
            if (edgeMap[ni] === 1 && !strong[ni]) {
              edgeMap[ni] = 2;
              strong[ni] = 1;
              queue.push(ni);
            }
          }
        }
      }

      const result = new Uint8Array(N);
      for (let i = 0; i < N; i++) result[i] = edgeMap[i] === 2 ? 1 : 0;
      return result;
    }

    // Build grayscale bitmap for a threshold level using Canny for edge guidance
    function buildBitmapWithCanny(imageData, threshold) {
      const width = imageData.width, height = imageData.height;
      const data = imageData.data;
      const N = width * height;
      const bitmap = new Uint8Array(N);

      for (let i = 0; i < N; i++) {
        const p = i * 4;
        const a = data[p + 3];
        if (a < 128) { bitmap[i] = 0; continue; }
        const l = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
        bitmap[i] = l < threshold ? 1 : 0;
      }

      // Use Canny edges to sharpen region boundaries (snap boundary pixels)
      const edges = cannyEdgeDetect(imageData, 0.05, 0.15);
      const enhanced = new Uint8Array(N);

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const i = y * width + x;
          if (edges[i]) {
            enhanced[i] = bitmap[i]; // preserve Canny-detected edges as-is
          } else if (bitmap[i] === 1) {
            // Erode weak isolated black pixels
            let blackN = 0;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++)
                if (dy !== 0 || dx !== 0) blackN += bitmap[(y+dy)*width+(x+dx)];
            enhanced[i] = blackN >= 3 ? 1 : 0;
          } else {
            // Dilate black pixels near edges
            let hasEdgeN = 0, blackN = 0;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue;
                blackN += bitmap[(y+dy)*width+(x+dx)];
                hasEdgeN += edges[(y+dy)*width+(x+dx)];
              }
            enhanced[i] = (blackN >= 5 || (blackN >= 3 && hasEdgeN >= 2)) ? 1 : 0;
          }
        }
      }
      // Clear border
      for (let y = 0; y < height; y++) { enhanced[y*width] = 0; enhanced[y*width+width-1] = 0; }
      for (let x = 0; x < width; x++) { enhanced[x] = 0; enhanced[(height-1)*width+x] = 0; }
      return enhanced;
    }

    // ===========================================================================
    // ZHANG-SUEN THINNING (stroke/centerline mode)
    // Two-pass iterative thinning until no changes remain.
    // Returns a 1-pixel-wide skeleton.
    // ===========================================================================
    function zhangSuenThin(bitmap, width, height) {
      const N = width * height;
      let changed = true;
      const skel = new Uint8Array(bitmap);

      function p(y, x) {
        if (y < 0 || y >= height || x < 0 || x >= width) return 0;
        return skel[y * width + x];
      }

      // Count 0→1 transitions in the 8-neighbor ring (P2..P9,P2)
      function transitions(y, x) {
        const ring = [p(y-1,x), p(y-1,x+1), p(y,x+1), p(y+1,x+1),
                      p(y+1,x), p(y+1,x-1), p(y,x-1), p(y-1,x-1), p(y-1,x)];
        let cnt = 0;
        for (let i = 0; i < 8; i++) if (ring[i] === 0 && ring[i+1] === 1) cnt++;
        return cnt;
      }

      function neighbors(y, x) {
        return p(y-1,x) + p(y-1,x+1) + p(y,x+1) + p(y+1,x+1) +
               p(y+1,x) + p(y+1,x-1) + p(y,x-1) + p(y-1,x-1);
      }

      while (changed) {
        changed = false;
        const toRemove = new Uint8Array(N);

        // Pass 1
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            if (!skel[y*width+x]) continue;
            const B = neighbors(y, x);
            if (B < 2 || B > 6) continue;
            if (transitions(y, x) !== 1) continue;
            if (p(y-1,x) * p(y,x+1) * p(y+1,x) !== 0) continue;
            if (p(y,x+1) * p(y+1,x) * p(y,x-1) !== 0) continue;
            toRemove[y*width+x] = 1;
          }
        }
        for (let i = 0; i < N; i++) { if (toRemove[i]) { skel[i] = 0; changed = true; } }

        const toRemove2 = new Uint8Array(N);
        // Pass 2
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            if (!skel[y*width+x]) continue;
            const B = neighbors(y, x);
            if (B < 2 || B > 6) continue;
            if (transitions(y, x) !== 1) continue;
            if (p(y-1,x) * p(y,x+1) * p(y,x-1) !== 0) continue;
            if (p(y-1,x) * p(y+1,x) * p(y,x-1) !== 0) continue;
            toRemove2[y*width+x] = 1;
          }
        }
        for (let i = 0; i < N; i++) { if (toRemove2[i]) { skel[i] = 0; changed = true; } }
      }

      return skel;
    }

    // ===========================================================================
    // MARCHING SQUARES CONTOUR TRACING
    // 2×2 cell lookup table (16 cases), linear interpolation for sub-pixel accuracy.
    // Returns array of contour point arrays with correct CCW/CW winding.
    // ===========================================================================

    // Edge midpoint interpolation for sub-pixel accuracy
    // edge: 0=top, 1=right, 2=bottom, 3=left
    // Given cell corner values (TL,TR,BR,BL) and iso-value 0.5
    function interpEdge(x, y, edge, tl, tr, br, bl) {
      const iso = 0.5;
      switch (edge) {
        case 0: { // top: between TL(x,y) and TR(x+1,y)
          const t = tl === tr ? 0.5 : (iso - tl) / (tr - tl);
          return [x + t, y];
        }
        case 1: { // right: between TR(x+1,y) and BR(x+1,y+1)
          const t = tr === br ? 0.5 : (iso - tr) / (br - tr);
          return [x + 1, y + t];
        }
        case 2: { // bottom: between BL(x,y+1) and BR(x+1,y+1)
          const t = bl === br ? 0.5 : (iso - bl) / (br - bl);
          return [x + t, y + 1];
        }
        case 3: { // left: between TL(x,y) and BL(x,y+1)
          const t = tl === bl ? 0.5 : (iso - tl) / (bl - tl);
          return [x, y + t];
        }
      }
    }

    // Marching squares segment table: [case] → [[edge_in, edge_out], ...]
    // Saddle cases (5, 10) use the first interpretation (no ambiguity correction needed for binary bitmaps)
    const MS_SEGMENTS = [
      [],                      // 0: all outside
      [[3, 2]],                // 1: BL
      [[2, 1]],                // 2: BR
      [[3, 1]],                // 3: BL+BR
      [[1, 0]],                // 4: TR
      [[3, 0], [1, 2]],        // 5: BL+TR (saddle)
      [[2, 0]],                // 6: BR+TR
      [[3, 0]],                // 7: BL+BR+TR
      [[0, 3]],                // 8: TL
      [[0, 2]],                // 9: TL+BL
      [[0, 1], [2, 3]],        // 10: TL+BR (saddle)
      [[0, 1]],                // 11: TL+BL+BR
      [[1, 3]],                // 12: TL+TR
      [[1, 2]],                // 13: TL+BL+TR — wait, should be TL+TR+BL
      [[2, 3]],                // 14: TL+TR+BR
      [],                      // 15: all inside
    ];

    function marchingSquares(bitmap, width, height) {
      const contours = [];
      // visited[y*(width-1)+x] tracks which cell edges have been followed
      const cellW = width - 1, cellH = height - 1;
      const visitedEdge = new Set();

      function cellCase(x, y) {
        const tl = bitmap[y * width + x];
        const tr = bitmap[y * width + x + 1];
        const bl = bitmap[(y+1)*width+x];
        const br = bitmap[(y+1)*width+x+1];
        return (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      }

      function edgeKey(x, y, edge) { return (y * cellW + x) * 4 + edge; }

      function getEdgePoint(x, y, edge) {
        const tl = bitmap[y * width + x];
        const tr = bitmap[y * width + x + 1];
        const bl = bitmap[(y+1)*width+x];
        const br = bitmap[(y+1)*width+x+1];
        return interpEdge(x, y, edge, tl, tr, br, bl);
      }

      // Follow a contour starting from cell (startX, startY), entering on edge startEdge
      function followContour(startX, startY, startEdge, outEdge) {
        const pts = [];
        let x = startX, y = startY, inEdge = startEdge, outE = outEdge;
        const startKey = edgeKey(x, y, inEdge);

        let iters = 0;
        const maxIters = (cellW * cellH * 4) + 4;

        while (iters++ < maxIters) {
          const key = edgeKey(x, y, inEdge);
          if (visitedEdge.has(key)) break;
          visitedEdge.add(key);

          pts.push(getEdgePoint(x, y, inEdge));

          // Move to neighbor cell across outEdge
          let nx = x, ny = y, nInEdge;
          switch (outE) {
            case 0: ny = y - 1; nInEdge = 2; break; // top → enter from bottom of cell above
            case 1: nx = x + 1; nInEdge = 3; break; // right → enter from left of right cell
            case 2: ny = y + 1; nInEdge = 0; break; // bottom → enter from top of cell below
            case 3: nx = x - 1; nInEdge = 1; break; // left → enter from right of left cell
          }

          if (nx < 0 || nx >= cellW || ny < 0 || ny >= cellH) break;

          const c = cellCase(nx, ny);
          const segs = MS_SEGMENTS[c];
          let foundSeg = null;
          for (const seg of segs) {
            if (seg[0] === nInEdge) { foundSeg = seg; break; }
          }
          if (!foundSeg) break;

          x = nx; y = ny; inEdge = nInEdge; outE = foundSeg[1];

          // Closed when we return to start
          if (edgeKey(x, y, inEdge) === startKey) break;
        }

        return pts;
      }

      // Scan all cells, start new contours from unvisited edges
      for (let y = 0; y < cellH; y++) {
        for (let x = 0; x < cellW; x++) {
          const c = cellCase(x, y);
          const segs = MS_SEGMENTS[c];
          for (const [inEdge, outEdge] of segs) {
            const key = edgeKey(x, y, inEdge);
            if (!visitedEdge.has(key)) {
              const pts = followContour(x, y, inEdge, outEdge);
              if (pts.length >= 4) contours.push(pts);
            }
          }
        }
      }

      return contours;
    }

    // Shoelace area (positive = CCW in screen coords where y increases downward)
    function shoelaceArea(pts) {
      let area = 0;
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += pts[i][0] * pts[j][1];
        area -= pts[j][0] * pts[i][1];
      }
      return area / 2; // signed
    }

    // Ensure CCW winding for outer contours (positive area in screen coords)
    function ensureCCW(pts) {
      if (shoelaceArea(pts) < 0) pts.reverse();
      return pts;
    }

    // --- Perpendicular distance from point to line segment ---
    function perpDist(px, py, ax, ay, bx, by) {
      if (ax === bx && ay === by) return Math.hypot(px - ax, py - ay);
      const num = Math.abs((by - ay)*px - (bx - ax)*py + bx*ay - by*ax);
      const den = Math.hypot(by - ay, bx - ax);
      return num / den;
    }

    // --- Douglas-Peucker (open polyline) ---
    function douglasPeucker(points, epsilon) {
      if (points.length <= 2) return points;
      let maxDist = 0, idx = 0;
      const first = points[0], last = points[points.length - 1];
      for (let i = 1; i < points.length - 1; i++) {
        const d = perpDist(points[i][0], points[i][1], first[0], first[1], last[0], last[1]);
        if (d > maxDist) { maxDist = d; idx = i; }
      }
      if (maxDist > epsilon) {
        const a = douglasPeucker(points.slice(0, idx + 1), epsilon);
        const b = douglasPeucker(points.slice(idx), epsilon);
        return a.slice(0, -1).concat(b);
      }
      return [first, last];
    }

    // --- Douglas-Peucker for closed paths (wrap-around aware) ---
    function simplifyClosedPath(originalPoints, epsilon) {
      if (originalPoints.length <= 3) return originalPoints;
      let simplified = douglasPeucker(originalPoints, epsilon);

      const n = simplified.length;
      const last = simplified[n - 1], first = simplified[0];
      let wrapMax = 0, wrapBestOrig = null;

      for (let i = 0; i < originalPoints.length; i++) {
        const op = originalPoints[i];
        const already = simplified.some(sp => sp[0] === op[0] && sp[1] === op[1]);
        if (already) continue;
        const d = perpDist(op[0], op[1], last[0], last[1], first[0], first[1]);
        if (d > wrapMax) { wrapMax = d; wrapBestOrig = op; }
      }

      if (wrapMax > epsilon && wrapBestOrig) {
        simplified = [...simplified, wrapBestOrig];
      }

      return simplified;
    }

    // --- Cubic Bezier fitting (Schneider's algorithm) ---
    function r2(v) { return Math.round(v * 100) / 100; }

    function fitCubicBezier(points, error) {
      if (points.length < 2) return '';
      if (points.length === 2) {
        return 'L' + r2(points[1][0]) + ',' + r2(points[1][1]);
      }

      const n = points.length;
      const u = new Float64Array(n);
      let totalLen = 0;
      for (let i = 1; i < n; i++) {
        totalLen += Math.hypot(points[i][0]-points[i-1][0], points[i][1]-points[i-1][1]);
        u[i] = totalLen;
      }
      if (totalLen < 1e-10) return 'L' + r2(points[n-1][0]) + ',' + r2(points[n-1][1]);
      for (let i = 1; i < n; i++) u[i] /= totalLen;

      const p0 = points[0], p3 = points[n-1];
      const t1x = points[1][0] - p0[0], t1y = points[1][1] - p0[1];
      const t2x = p3[0] - points[n-2][0], t2y = p3[1] - points[n-2][1];
      const t1len = Math.hypot(t1x, t1y) || 1, t2len = Math.hypot(t2x, t2y) || 1;
      const d1x = t1x/t1len, d1y = t1y/t1len;
      const d2x = -t2x/t2len, d2y = -t2y/t2len;

      let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
      for (let i = 1; i < n - 1; i++) {
        const t = u[i], mt = 1 - t;
        const b0 = mt*mt*mt, b1c = 3*t*mt*mt, b2c = 3*t*t*mt, b3 = t*t*t;
        const ax = b1c*d1x, ay = b1c*d1y;
        const bx = b2c*d2x, by = b2c*d2y;
        a11 += ax*ax + ay*ay;
        a12 += ax*bx + ay*by;
        a22 += bx*bx + by*by;
        const cx = points[i][0] - (b0*p0[0] + b3*p3[0]);
        const cy = points[i][1] - (b0*p0[1] + b3*p3[1]);
        b1 += ax*cx + ay*cy;
        b2 += bx*cx + by*cy;
      }
      const det = a11*a22 - a12*a12;
      let alpha1, alpha2;
      if (Math.abs(det) < 1e-10) {
        alpha1 = alpha2 = totalLen / 3;
      } else {
        alpha1 = (b1*a22 - b2*a12) / det;
        alpha2 = (a11*b2 - a12*b1) / det;
      }
      if (alpha1 < 0) alpha1 = totalLen / 3;
      if (alpha2 < 0) alpha2 = totalLen / 3;

      const cp1x = p0[0] + d1x * alpha1, cp1y = p0[1] + d1y * alpha1;
      const cp2x = p3[0] + d2x * alpha2, cp2y = p3[1] + d2y * alpha2;

      let maxErr = 0, splitIdx = 1;
      for (let i = 1; i < n - 1; i++) {
        const t = u[i], mt = 1 - t;
        const bx = mt*mt*mt*p0[0] + 3*t*mt*mt*cp1x + 3*t*t*mt*cp2x + t*t*t*p3[0];
        const by = mt*mt*mt*p0[1] + 3*t*mt*mt*cp1y + 3*t*t*mt*cp2y + t*t*t*p3[1];
        const e = Math.hypot(bx - points[i][0], by - points[i][1]);
        if (e > maxErr) { maxErr = e; splitIdx = i; }
      }

      if (maxErr <= error) {
        return 'C' + r2(cp1x)+','+r2(cp1y)+' '+r2(cp2x)+','+r2(cp2y)+' '+r2(p3[0])+','+r2(p3[1]);
      }

      const left = fitCubicBezier(points.slice(0, splitIdx + 1), error);
      const right = fitCubicBezier(points.slice(splitIdx), error);
      return left + ' ' + right;
    }

    function pointsToSvgPath(points, bezierError, closed) {
      if (points.length < 2) return '';
      let d = 'M' + r2(points[0][0]) + ',' + r2(points[0][1]);
      d += ' ' + fitCubicBezier(points, bezierError || 1.0);
      if (closed !== false) d += ' Z';
      return d;
    }

    // --- Single layer tracing (fill mode, uses Marching Squares) ---
    function traceSingleLayer(imageData, threshold, color, maxPaths) {
      return new Promise((resolve) => {
        workerLog('Tracing layer threshold=' + threshold);
        const width = imageData.width, height = imageData.height;

        const bitmap = buildBitmapWithCanny(imageData, threshold);
        const contours = marchingSquares(bitmap, width, height);

        // Sort by area descending (largest first = painter's background first)
        contours.sort((a, b) => Math.abs(shoelaceArea(b)) - Math.abs(shoelaceArea(a)));

        const limit = Math.min(maxPaths || 2000, contours.length);
        workerLog('Found ' + contours.length + ' contours, keeping ' + limit);

        const seenPaths = new Set();
        const svgPaths = [];

        for (let pi = 0; pi < limit; pi++) {
          const contour = ensureCCW(contours[pi]);
          const area = Math.abs(shoelaceArea(contour));
          if (area < 2) continue;

          const complexity = contour.length / Math.max(1, area);
          let epsilon = 0.4 + (contour.length > 200 ? contour.length / 10000 : 0);
          if (complexity > 0.2) epsilon = Math.max(0.25, epsilon * 0.8);
          epsilon = Math.min(2.0, epsilon);

          const simplified = simplifyClosedPath(contour, epsilon);
          if (simplified.length < 3) continue;

          const bezierError = epsilon * 1.5;
          const d = pointsToSvgPath(simplified, bezierError, true);
          if (d && !seenPaths.has(d)) {
            seenPaths.add(d);
            svgPaths.push('<path d="' + d + '" fill="' + color + '" stroke="none"/>');
          }
        }

        resolve({ paths: svgPaths, seenDs: seenPaths });
      });
    }

    // --- Stroke layer tracing (Zhang-Suen + Marching Squares on skeleton) ---
    function traceStrokeLayer(imageData, threshold, color, strokeWidth, maxPaths) {
      return new Promise((resolve) => {
        workerLog('Tracing stroke layer threshold=' + threshold);
        const width = imageData.width, height = imageData.height;

        const bitmap = buildBitmapWithCanny(imageData, threshold);
        const skeleton = zhangSuenThin(bitmap, width, height);
        const contours = marchingSquares(skeleton, width, height);

        const limit = Math.min(maxPaths || 2000, contours.length);
        const seenPaths = new Set();
        const svgPaths = [];

        for (let pi = 0; pi < limit; pi++) {
          const contour = contours[pi];
          if (contour.length < 2) continue;

          const area = Math.abs(shoelaceArea(contour));
          let epsilon = 0.4 + (contour.length > 200 ? contour.length / 10000 : 0);
          epsilon = Math.min(2.0, epsilon);

          const simplified = simplifyClosedPath(contour, epsilon);
          if (simplified.length < 2) continue;

          const bezierError = epsilon * 1.5;
          // Open paths for stroke mode (no Z close)
          const d = pointsToSvgPath(simplified, bezierError, area < 4);
          if (d && !seenPaths.has(d)) {
            seenPaths.add(d);
            svgPaths.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + (strokeWidth || 2) + '" stroke-linecap="round" stroke-linejoin="round"/>');
          }
        }

        resolve({ paths: svgPaths, seenDs: seenPaths });
      });
    }

    // --- Posterization pipeline ---
    async function manualPosterize(imageData, options, callback) {
      workerLog('Starting posterization: ' + options.colorSteps + ' steps, strategy=' + options.fillStrategy + ', strokeMode=' + !!options.strokeMode);
      try {
        const numSteps = typeof options.colorSteps === 'number' ? Math.max(2, options.colorSteps) : 4;
        const maxPaths = typeof options.maxPaths === 'number' ? options.maxPaths : 2000;
        const strokeMode = !!options.strokeMode;
        const strokeWidth = typeof options.strokeWidth === 'number' ? options.strokeWidth : 2;

        const thresholds = computeThresholds(numSteps);
        workerLog('Perceptual thresholds (L*-spaced): ' + JSON.stringify(thresholds));

        self.postMessage({ type: 'progress', progress: 5, details: 'Analyzing colors...' });

        const { imageData: imgData, width, height } = await dataURLToImageData(imageData);

        const rawPalette = quantizeColors(imgData, numSteps, options.fillStrategy);

        function parseLuma(rgbStr) {
          const m = rgbStr.match(/rgb\\((\\d+),(\\d+),(\\d+)\\)/);
          if (!m) return 0;
          return srgbLuma(+m[1], +m[2], +m[3]);
        }

        const sortedPalette = rawPalette
          .map(c => ({ css: c, luma: parseLuma(c) }))
          .sort((a, b) => a.luma - b.luma)
          .map(c => c.css);

        const sortedThresholds = [...thresholds].sort((a, b) => a - b);

        while (sortedThresholds.length < numSteps - 1) {
          let maxGap = -1, gapIdx = 0;
          for (let i = 0; i < sortedThresholds.length - 1; i++) {
            const gap = sortedThresholds[i+1] - sortedThresholds[i];
            if (gap > maxGap) { maxGap = gap; gapIdx = i; }
          }
          const mid = Math.round((sortedThresholds[gapIdx] + sortedThresholds[gapIdx + 1]) / 2);
          sortedThresholds.splice(gapIdx + 1, 0, mid);
        }

        const layerThresholds = [...sortedThresholds];
        while (layerThresholds.length < numSteps) {
          layerThresholds.push(Math.min(250, (layerThresholds[layerThresholds.length - 1] || 200) + 20));
        }

        workerLog('Palette (lightest→darkest): ' + JSON.stringify(sortedPalette));
        workerLog('Layer thresholds (ascending): ' + JSON.stringify(layerThresholds));

        const allSeenDs = new Set();
        const layers = [];

        for (let i = 0; i < numSteps; i++) {
          const threshold = layerThresholds[i];
          const color = sortedPalette[i];
          const pct = 15 + Math.round((i / numSteps) * 75);
          self.postMessage({
            type: 'progress',
            progress: pct,
            details: 'Layer ' + (i + 1) + '/' + numSteps + ' (' + color + ', threshold ' + threshold + ')...'
          });

          const { paths: layerPaths } = strokeMode
            ? await traceStrokeLayer(imgData, threshold, color, strokeWidth, maxPaths)
            : await traceSingleLayer(imgData, threshold, color, maxPaths);

          const dedupedPaths = layerPaths.filter(p => {
            const dMatch = p.match(/d="([^"]+)"/);
            if (!dMatch) return true;
            const d = dMatch[1];
            if (allSeenDs.has(d)) return false;
            allSeenDs.add(d);
            return true;
          });

          layers.push(dedupedPaths.join(''));
        }

        self.postMessage({ type: 'progress', progress: 95, details: 'Assembling SVG...' });

        const combinedSvg =
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
          '" viewBox="0 0 ' + width + ' ' + height + '">' +
          layers.join('') +
          '</svg>';

        workerLog('SVG complete: ' + combinedSvg.length + ' chars');
        self.postMessage({ type: 'progress', progress: 100, details: 'Done.' });
        callback(null, combinedSvg);
      } catch (err) {
        workerLog('Posterization error: ' + err.message);
        callback(err, null);
      }
    }

    self.addEventListener('message', function(e) {
      const { image, options } = e.data;
      workerLog('Worker started with options: ' + JSON.stringify(Object.keys(options)));
      manualPosterize(image, options, (err, svg) => {
        if (err) {
          self.postMessage({ type: 'error', error: err.message });
        } else {
          self.postMessage({ type: 'complete', svg });
        }
      });
    });
  `;

  const blob = new Blob([workerScript], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(blob);
  const worker = new Worker(workerUrl);
  let terminated = false;

  const cleanup = () => {
    if (!terminated) {
      terminated = true;
      URL.revokeObjectURL(workerUrl);
      worker.terminate();
    }
  };

  worker.onerror = (e) => {
    if (logCallback) logCallback('WORKER_ERROR', `Worker uncaught error: ${e.message}`, true, formatTimestamp());
    cleanup();
    completeCallback(null, new Error(e.message || 'Worker error'));
  };

  worker.addEventListener('message', (e) => {
    const { type, progress, details, svg, error, message } = e.data;
    switch (type) {
      case 'progress':
        progressCallback(progress, details);
        break;
      case 'log':
        if (logCallback) logCallback('WORKER', message, false, formatTimestamp());
        break;
      case 'complete':
        cleanup();
        completeCallback(svg, null);
        break;
      case 'error':
        cleanup();
        completeCallback(null, new Error(error));
        break;
    }
  });

  worker.postMessage({ image, options });

  return { terminate: cleanup };
};

const posterize = (
  image: string,
  options: Record<string, unknown>,
  callback: (err: Error | null, svg?: string) => void,
  logCallback?: LogCallback
) => {
  try {
    const isNetwork = isNetworkClient();
    const heartbeat = createHeartbeat('Color image processing', isNetwork ? 1000 : 2000, logCallback);
    const startTime = performance.now();

    logProcessingStep('COLOR_START', 'Starting color processing via Web Worker', false, logCallback);

    const workerHandle = createPosterizeWorker(
      image,
      options,
      (progress, details) => {
        logProcessingStep('COLOR_PROGRESS', `${progress}% - ${details ?? ''}`, false, logCallback);
        if (typeof window !== 'undefined' && window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent('color-progress-update', { detail: { progress, details } }));
        }
      },
      (svg, error) => {
        heartbeat.stop();
        if (error) {
          logProcessingStep('COLOR_ERROR', `Color processing error: ${error.message}`, true, logCallback);
          callback(error);
          return;
        }
        if (!svg) {
          const err = new Error('Worker returned empty SVG');
          logProcessingStep('COLOR_ERROR', err.message, true, logCallback);
          callback(err);
          return;
        }
        const optimized = (options.svgoOptimize !== false) ? runSvgoOptimize(svg) : svg;
        logProcessingStep('COLOR_COMPLETE', `Done in ${Math.round(performance.now() - startTime)}ms`, false, logCallback);
        callback(null, optimized);
      },
      logCallback
    );

    return workerHandle;
  } catch (error) {
    logProcessingStep('COLOR_SETUP_ERROR', `Failed to initialize color processing: ${error}`, true, logCallback);
    callback(error instanceof Error ? error : new Error(String(error)));
    return { terminate: () => {} };
  }
};

// Analyze actual pixel complexity (proper 2D gradient magnitude)
const analyzeImageComplexity = (
  imageData: string
): Promise<{ complex: boolean; reason?: string; distinctColors?: number }> => {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        const sampleW = Math.min(200, img.naturalWidth);
        const sampleH = Math.min(200, img.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = sampleW;
        canvas.height = sampleH;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve({ complex: false }); return; }
        ctx.drawImage(img, 0, 0, sampleW, sampleH);
        const { data } = ctx.getImageData(0, 0, sampleW, sampleH);

        const seen = new Set<number>();
        for (let i = 0; i < sampleW * sampleH; i++) {
          const idx = i * 4;
          if (data[idx + 3] < 128) continue;
          seen.add(((data[idx] >> 3) << 10) | ((data[idx+1] >> 3) << 5) | (data[idx+2] >> 3));
        }

        // Full 2D gradient magnitude for edge density
        let edgePixels = 0;
        for (let y = 1; y < sampleH - 1; y++) {
          for (let x = 1; x < sampleW - 1; x++) {
            const i = (y * sampleW + x) * 4;
            const lCur  = 0.299*data[i]   + 0.587*data[i+1]   + 0.114*data[i+2];
            const lRight= 0.299*data[i+4] + 0.587*data[i+5]   + 0.114*data[i+6];
            const lDown = 0.299*data[i + sampleW*4] + 0.587*data[i + sampleW*4 + 1] + 0.114*data[i + sampleW*4 + 2];
            const Gx = lRight - lCur;
            const Gy = lDown - lCur;
            if (Math.sqrt(Gx*Gx + Gy*Gy) > 20) edgePixels++;
          }
        }

        const distinctColors = seen.size;
        const edgeDensity = edgePixels / (sampleW * sampleH);
        const complex = distinctColors > 800 || edgeDensity > 0.15;
        const veryComplex = distinctColors > 2000 || edgeDensity > 0.3;

        logProcessingStep('ANALYZE', `Distinct colors: ${distinctColors}, edge density: ${edgeDensity.toFixed(3)}`);
        resolve({
          complex: complex || veryComplex,
          reason: veryComplex ? 'Very high color/edge complexity' : complex ? 'Moderate complexity' : undefined,
          distinctColors
        });
      };
      img.onerror = () => resolve({ complex: false });
      img.src = imageData;
    } catch {
      resolve({ complex: false });
    }
  });
};

export const simplifyForComplexImages = (params: TracingParams): TracingParams => ({
  ...params,
  turdSize: Math.max(params.turdSize, 15),
  optTolerance: 3.0,
  turnPolicy: 'minority',
  threshold: 180,
  alphaMax: 1.0,
  highestQuality: false,
  optCurve: true
});

export const scaleToMaxDimension = (imageData: string, maxDimension = 1000): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
      img.onload = () => {
        const { width: ow, height: oh } = img;
        if (ow <= maxDimension && oh <= maxDimension) { resolve(imageData); return; }
        const scale = ow > oh ? maxDimension / ow : maxDimension / oh;
        const nw = Math.round(ow * scale), nh = Math.round(oh * scale);
        const canvas = document.createElement('canvas');
        canvas.width = nw; canvas.height = nh;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Failed to get canvas context')); return; }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, nw, nh);
        ctx.drawImage(img, 0, 0, nw, nh);
        logProcessingStep('SCALE', `Scaled ${ow}x${oh} → ${nw}x${nh}`);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Failed to load image for scaling'));
      img.src = imageData;
    } catch (error) {
      reject(error);
    }
  });
};

const downscaleImage = (imageData: string, scale: number = 0.5): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
      img.onload = () => {
        const nw = Math.max(1, Math.round(img.width * scale));
        const nh = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = nw; canvas.height = nh;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Failed to get canvas context')); return; }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, nw, nh);
        ctx.drawImage(img, 0, 0, nw, nh);
        logProcessingStep('DOWNSCALE', `Downscaled by ${scale}: ${img.width}x${img.height} → ${nw}x${nh}`);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Failed to load image for downscaling'));
      img.src = imageData;
    } catch (error) {
      reject(error);
    }
  });
};

export const processImage = (
  imageData: string,
  params: TracingParams,
  progressCallback: (status: string) => void,
  detailedLogCallback?: LogCallback
): Promise<string> => {
  return new Promise((resolve, reject) => {
    let workerHandle: { terminate: () => void } | null = null;
    let traceHandle: { cancel: () => void } | null = null;
    let finished = false;

    const cleanupAndReject = (error: Error) => {
      if (finished) return;
      finished = true;
      if (workerHandle) { try { workerHandle.terminate(); } catch (_) {} workerHandle = null; }
      if (traceHandle) { try { traceHandle.cancel(); } catch (_) {} traceHandle = null; }
      reject(error);
    };

    try {
      logProcessingStep('START', `Beginning image processing, data length: ${imageData.length}`, false, detailedLogCallback);
      progressCallback('loading');

      const isNetwork = isNetworkClient();
      const effectiveParams = isNetwork ? simplifyForNetworkClients({ ...params }) : params;

      const processWithParams = (imgData: string, processingParams: TracingParams) => {
        progressCallback('tracing');
        logProcessingStep('TRACE', `Starting tracing, data length: ${imgData.length}`, false, detailedLogCallback);

        // Timeout starts here — only covers actual tracing, not preprocessing
        const isNet = isNetworkClient();
        const timeoutMs = isNet ? 90000 : 180000;
        const traceTimeout = setTimeout(() => {
          logProcessingStep('ERROR', 'Image tracing timed out', true, detailedLogCallback);
          progressCallback('error');
          cleanupAndReject(new Error('Image tracing timed out. The image may be too complex. Try Complex Image Mode.'));
        }, timeoutMs);

        const onComplete = (err: Error | null, svg?: string) => {
          if (finished) return;
          clearTimeout(traceTimeout);
          if (err) {
            logProcessingStep('ERROR', `Tracing error: ${err.message}`, true, detailedLogCallback);
            progressCallback('error');
            cleanupAndReject(new Error(err.message));
            return;
          }
          if (!svg) {
            logProcessingStep('ERROR', 'Tracer returned empty SVG', true, detailedLogCallback);
            progressCallback('error');
            cleanupAndReject(new Error('Tracer returned empty SVG'));
            return;
          }
          finished = true;
          progressCallback('optimizing');
          logProcessingStep('OPTIMIZE', `SVG generated: ${svg.length} chars`, false, detailedLogCallback);
          progressCallback('done');
          logProcessingStep('DONE', 'Processing complete', false, detailedLogCallback);
          resolve(svg);
        };

        try {
          if (processingParams.colorMode) {
            logProcessingStep('MODE', 'Color mode (posterize) via Web Worker', false, detailedLogCallback);
            progressCallback('colorProcessing');
            workerHandle = posterize(imgData, processingParams as unknown as Record<string, unknown>, onComplete, detailedLogCallback);
          } else {
            traceHandle = trace(imgData, processingParams, onComplete, detailedLogCallback);
          }
        } catch (error) {
          clearTimeout(traceTimeout);
          logProcessingStep('ERROR', `Exception during tracing: ${error}`, true, detailedLogCallback);
          progressCallback('error');
          cleanupAndReject(error instanceof Error ? error : new Error(String(error)));
        }
      };

      const processNextStep = async (imgData: string) => {
        progressCallback('analyzing');
        const complexityResult = await analyzeImageComplexity(imgData);
        logProcessingStep('ANALYZE', `Complexity: ${JSON.stringify(complexityResult)}`, false, detailedLogCallback);

        if (isNetwork && complexityResult.complex) {
          logProcessingStep('NETWORK_SCALE', 'Further downscaling for network + complex image', false, detailedLogCallback);
          downscaleImage(imgData, 0.3)
            .then(scaled => processWithParams(scaled, effectiveParams))
            .catch(() => processWithParams(imgData, effectiveParams));
        } else {
          processWithParams(imgData, effectiveParams);
        }
      };

      const beginProcessing = (imgData: string) => {
        if (isNetwork) {
          downscaleImage(imgData, 0.5)
            .then(scaled => processNextStep(scaled))
            .catch(() => processNextStep(imgData));
        } else {
          processNextStep(imgData);
        }
      };

      scaleToMaxDimension(imageData, 1000)
        .then(scaled => beginProcessing(scaled))
        .catch(() => beginProcessing(imageData));

    } catch (error) {
      logProcessingStep('ERROR', `Exception during processing setup: ${error}`, true, detailedLogCallback);
      progressCallback('error');
      cleanupAndReject(error instanceof Error ? error : new Error(String(error)));
    }
  });
};

export const getOptimizedFilename = (originalName: string): string => {
  const nameWithoutExtension = originalName.replace(/\.[^/.]+$/, '');
  const slug = slugify(nameWithoutExtension, { lower: true, strict: true });
  return slug || 'image';
};

export const simplifyForNetworkClients = (params: TracingParams): TracingParams => {
  const complexParams = simplifyForComplexImages({ ...params });
  return {
    ...complexParams,
    threshold: Math.min(255, complexParams.threshold + 30),
    turdSize: Math.max(15, complexParams.turdSize * 2),
    alphaMax: Math.max(0.1, complexParams.alphaMax - 0.1),
    optCurve: false,
    optTolerance: 1.0
  };
};
