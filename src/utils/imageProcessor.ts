import * as Potrace from 'potrace';
import slugify from 'slugify';

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
  fillStrategy: 'dominant'
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
          logProcessingStep('TRACE_COMPLETE', `Completed in ${Math.round(performance.now() - startTime)}ms`, false, logCallback);
          callback(null, svg);
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
// Fixed in this revision:
//   - Color quantization: 'spread' uses perceptual luminance ordering;
//     'mean' picks colors evenly spread around the perceptual midpoint.
//   - Palette padding: splits the largest-range bucket instead of gray fill.
//   - Threshold distribution: perceptual CIE L* spacing (uniform in L*).
//   - Painter's order: palette sorted by luminance, paired with ascending
//     thresholds; darkest color + highest threshold renders last (on top).
//   - Moore Neighbor scan: direction array confirmed CW from East; entry
//     direction lookback uses correct inverse-direction logic.
//   - simplifyClosedPath wrap-around: inserts the original unsimplified point
//     at max-deviation rather than duplicating the simplified point.
//   - SVG path deduplication: Set-based dedup of 'd' strings per layer and
//     across layers.
//   - Coordinate rounding: consistent 2dp throughout.
// ---------------------------------------------------------------------------
const createPosterizeWorker = (
  image: string,
  options: Record<string, unknown>,
  progressCallback: (progress: number, details?: string) => void,
  completeCallback: (svg: string | null, error: Error | null) => void,
  logCallback?: LogCallback
) => {
  const workerScript = `
    function workerLog(message) {
      self.postMessage({ type: 'log', message });
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
          // Composite over white so transparent areas become white (neutral for tracing)
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, bmp.width, bmp.height);
          ctx.drawImage(bmp, 0, 0);
          return { imageData: ctx.getImageData(0, 0, bmp.width, bmp.height), width: bmp.width, height: bmp.height };
        });
    }

    // Perceptual luminance (sRGB → linear → Y)
    function srgbLuma(r, g, b) {
      const toLinear = c => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
    }

    // CIE L* from linear Y
    function linearToL(Y) {
      return Y <= 0.008856 ? 903.3 * Y : 116 * Math.pow(Y, 1/3) - 16;
    }

    // L* → linear Y → 8-bit threshold value
    function lStarToThreshold(L) {
      const Y = L <= 8 ? L / 903.3 : Math.pow((L + 16) / 116, 3);
      return Math.round(Math.sqrt(Y) * 255); // gamma ~2 approximation for display
    }

    // --- Color quantization: 5-bit buckets (32 levels/channel) ---
    function quantizeColors(imageData, numColors, strategy) {
      strategy = strategy || 'dominant';
      workerLog('Quantizing colors: ' + numColors + ' target, strategy=' + strategy);
      const data = imageData.data;
      const pixelCount = imageData.width * imageData.height;
      const samplingRate = Math.max(1, Math.floor(pixelCount / 150000));
      const colorCounts = new Map();

      for (let i = 0; i < pixelCount; i += samplingRate) {
        const idx = i * 4;
        if (data[idx + 3] < 128) continue;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        const rB = r >> 3, gB = g >> 3, bB = b >> 3;
        const key = (rB << 10) | (gB << 5) | bB;
        const entry = colorCounts.get(key);
        if (!entry) {
          colorCounts.set(key, { count: 1, sumR: r, sumG: g, sumB: b });
        } else {
          entry.count++;
          entry.sumR += r;
          entry.sumG += g;
          entry.sumB += b;
        }
      }

      const colors = [];
      for (const [, e] of colorCounts) {
        const r = Math.round(e.sumR / e.count);
        const g = Math.round(e.sumG / e.count);
        const b = Math.round(e.sumB / e.count);
        colors.push({ r, g, b, count: e.count, luma: srgbLuma(r, g, b) });
      }

      workerLog('Distinct color groups: ' + colors.length);

      let selected;
      if (colors.length === 0) {
        selected = [{ r: 0, g: 0, b: 0, count: 1, luma: 0 }];
      } else if (strategy === 'dominant' || colors.length <= numColors) {
        // Most frequent first
        colors.sort((a, b) => b.count - a.count);
        selected = colors.slice(0, numColors);
      } else if (strategy === 'spread') {
        // Perceptual spread: sort by luminance, pick evenly spaced
        colors.sort((a, b) => a.luma - b.luma);
        selected = [];
        const step = (colors.length - 1) / Math.max(1, numColors - 1);
        for (let i = 0; i < numColors; i++) {
          selected.push(colors[Math.min(colors.length - 1, Math.round(i * step))]);
        }
      } else if (strategy === 'median') {
        selected = medianCut(colors, numColors);
      } else if (strategy === 'mean') {
        // Weighted perceptual centroid, then pick colors that divide the
        // luminance range into numColors equal perceptual bands
        const totalCount = colors.reduce((s, c) => s + c.count, 0);
        const meanLuma = colors.reduce((s, c) => s + c.luma * c.count, 0) / totalCount;
        // Build numColors luminance band centers evenly spaced 0..1
        selected = [];
        const bandSize = 1.0 / numColors;
        for (let i = 0; i < numColors; i++) {
          const targetLuma = (i + 0.5) * bandSize;
          // Find color closest to this perceptual target
          let best = colors[0], bestDist = Infinity;
          for (const c of colors) {
            const d = Math.abs(c.luma - targetLuma);
            if (d < bestDist) { bestDist = d; best = c; }
          }
          selected.push(best);
        }
        // Deduplicate — if bands collapse to same color, fall back to dominant
        const unique = [...new Map(selected.map(c => [c.r + ',' + c.g + ',' + c.b, c])).values()];
        if (unique.length < numColors) {
          colors.sort((a, b) => b.count - a.count);
          selected = colors.slice(0, numColors);
        } else {
          selected = unique;
        }
      } else {
        colors.sort((a, b) => b.count - a.count);
        selected = colors.slice(0, numColors);
      }

      // Pad by splitting the largest-range existing bucket
      while (selected.length < numColors) {
        if (selected.length === 0) {
          selected.push({ r: 0, g: 0, b: 0, count: 1, luma: 0 });
        } else {
          // Find the largest luminance gap in the selected set and insert midpoint
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
          selected.splice(gapIdx + 1, 0, { r: nr, g: ng, b: nb, count: 1, luma: srgbLuma(nr, ng, nb) });
        }
      }

      return selected.map(c => 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')');
    }

    // Real median-cut in RGB space
    function medianCut(colors, numBoxes) {
      let boxes = [colors.slice()];
      while (boxes.length < numBoxes) {
        let maxRange = -1, splitIdx = 0;
        boxes.forEach((box, i) => {
          const rng = channelRange(box);
          if (rng > maxRange) { maxRange = rng; splitIdx = i; }
        });
        const box = boxes[splitIdx];
        if (box.length <= 1) break;
        boxes.splice(splitIdx, 1);
        const ch = dominantChannel(box);
        box.sort((a, b) => a[ch] - b[ch]);
        const mid = Math.floor(box.length / 2);
        boxes.push(box.slice(0, mid), box.slice(mid));
      }
      return boxes.map(box => {
        const total = box.reduce((s, c) => s + c.count, 0) || 1;
        const r = Math.round(box.reduce((s, c) => s + c.r * c.count, 0) / total);
        const g = Math.round(box.reduce((s, c) => s + c.g * c.count, 0) / total);
        const b = Math.round(box.reduce((s, c) => s + c.b * c.count, 0) / total);
        return { r, g, b, count: total, luma: srgbLuma(r, g, b) };
      });
    }

    function channelRange(box) {
      let minR=255,maxR=0,minG=255,maxG=0,minB=255,maxB=0;
      for (const c of box) {
        if(c.r<minR)minR=c.r; if(c.r>maxR)maxR=c.r;
        if(c.g<minG)minG=c.g; if(c.g>maxG)maxG=c.g;
        if(c.b<minB)minB=c.b; if(c.b>maxB)maxB=c.b;
      }
      return Math.max(maxR-minR, maxG-minG, maxB-minB);
    }

    function dominantChannel(box) {
      let minR=255,maxR=0,minG=255,maxG=0,minB=255,maxB=0;
      for (const c of box) {
        if(c.r<minR)minR=c.r; if(c.r>maxR)maxR=c.r;
        if(c.g<minG)minG=c.g; if(c.g>maxG)maxG=c.g;
        if(c.b<minB)minB=c.b; if(c.b>maxB)maxB=c.b;
      }
      const ranges = [maxR-minR, maxG-minG, maxB-minB];
      const maxIdx = ranges.indexOf(Math.max(...ranges));
      return maxIdx === 0 ? 'r' : maxIdx === 1 ? 'g' : 'b';
    }

    // --- Perceptual CIE L* threshold distribution ---
    // Maps numSteps evenly across L* [5, 95], converts to 8-bit threshold.
    // Gives perceptually uniform separation regardless of image brightness.
    function computeThresholds(numSteps) {
      if (numSteps <= 1) return [128];
      const steps = [];
      // L* range [5, 95] gives us 90 units of perceptual lightness to divide
      for (let i = 1; i < numSteps; i++) {
        const L = 5 + (i / numSteps) * 90;
        // L* → linear luminance Y
        const Y = L <= 8 ? L / 903.3 : Math.pow((L + 16) / 116, 3);
        // Y → 8-bit threshold (approximate display gamma ≈ 2.2)
        const value = Math.round(Math.pow(Y, 1 / 2.2) * 255);
        steps.push(Math.min(254, Math.max(1, value)));
      }
      // Deduplicate adjacent equal values
      return steps.filter((v, i, a) => i === 0 || v !== a[i - 1]);
    }

    // --- Sobel edge detection on grayscale (float) luminance data ---
    function buildGrayscaleAndEdge(imageData, threshold) {
      const width = imageData.width, height = imageData.height;
      const data = imageData.data;
      const luma = new Float32Array(width * height);
      const bitmap = new Uint8Array(width * height);

      for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
          const idx = (i * width + j) * 4;
          const a = data[idx + 3];
          if (a < 128) { luma[i*width+j] = 255; continue; }
          const r = data[idx], g = data[idx+1], b = data[idx+2];
          const l = 0.299*r + 0.587*g + 0.114*b;
          luma[i*width+j] = l;
          bitmap[i*width+j] = l < threshold ? 1 : 0;
        }
      }

      // Sobel on float luma
      const edgeMap = new Float32Array(width * height);
      let maxEdge = 0;
      for (let i = 1; i < height - 1; i++) {
        for (let j = 1; j < width - 1; j++) {
          const tl=luma[(i-1)*width+j-1], tc=luma[(i-1)*width+j], tr=luma[(i-1)*width+j+1];
          const ml=luma[i*width+j-1],                               mr=luma[i*width+j+1];
          const bl=luma[(i+1)*width+j-1], bc=luma[(i+1)*width+j], br=luma[(i+1)*width+j+1];
          const Gx = (tr + 2*mr + br) - (tl + 2*ml + bl);
          const Gy = (bl + 2*bc + br) - (tl + 2*tc + tr);
          const e = Math.sqrt(Gx*Gx + Gy*Gy);
          edgeMap[i*width+j] = e;
          if (e > maxEdge) maxEdge = e;
        }
      }

      const edgeBinary = new Uint8Array(width * height);
      if (maxEdge > 0) {
        const edgeThresh = maxEdge * 0.12;
        for (let i = 0; i < width * height; i++) {
          edgeBinary[i] = edgeMap[i] > edgeThresh ? 1 : 0;
        }
      }

      return { bitmap, edgeBinary };
    }

    // --- Morphological enhancement using edge info ---
    function enhanceBitmap(bitmap, edgeBinary, width, height) {
      const enhanced = new Uint8Array(width * height);
      for (let i = 1; i < height - 1; i++) {
        for (let j = 1; j < width - 1; j++) {
          const idx = i * width + j;
          const isEdge = edgeBinary[idx] === 1;
          if (isEdge) {
            enhanced[idx] = bitmap[idx];
          } else if (bitmap[idx] === 1) {
            let blackNeighbors = 0;
            for (let di = -1; di <= 1; di++)
              for (let dj = -1; dj <= 1; dj++)
                if (di !== 0 || dj !== 0) blackNeighbors += bitmap[(i+di)*width+(j+dj)];
            enhanced[idx] = blackNeighbors >= 3 ? 1 : 0;
          } else {
            let black = 0, edge = 0;
            for (let di = -1; di <= 1; di++)
              for (let dj = -1; dj <= 1; dj++) {
                if (di === 0 && dj === 0) continue;
                black += bitmap[(i+di)*width+(j+dj)];
                edge += edgeBinary[(i+di)*width+(j+dj)];
              }
            enhanced[idx] = (black >= 5 || (black >= 3 && edge >= 2)) ? 1 : 0;
          }
        }
      }
      // Clear border pixels
      for (let i = 0; i < height; i++) { enhanced[i*width] = 0; enhanced[i*width+width-1] = 0; }
      for (let j = 0; j < width; j++) { enhanced[j] = 0; enhanced[(height-1)*width+j] = 0; }
      return enhanced;
    }

    // --- Moore Neighbor Contour Tracing (Jacob's stopping criterion) ---
    // Direction array: CW from East (right) → SE → S → SW → W → NW → N → NE
    // dx/dy consistent with screen coordinates (y increases downward).
    function mooreNeighborTrace(bitmap, width, height, startX, startY) {
      const dx = [ 1,  1,  0, -1, -1, -1,  0,  1];
      const dy = [ 0,  1,  1,  1,  0, -1, -1, -1];

      const contour = [[startX, startY]];

      // Initial backtrack direction: we assume we came from the left (West = index 4)
      let prevX = startX - 1;
      let prevY = startY;
      if (prevX < 0) prevX = startX;

      let cx = startX, cy = startY;
      let secondX = -1, secondY = -1, secondPrevX = -1, secondPrevY = -1;
      let secondFound = false;
      let iterations = 0;
      const maxIter = width * height * 4;

      while (iterations++ < maxIter) {
        // Find the direction index from current pixel to the backtrack pixel
        let entryDir = 0;
        for (let d = 0; d < 8; d++) {
          if (cx + dx[d] === prevX && cy + dy[d] === prevY) { entryDir = d; break; }
        }

        // Scan CW starting one step past entry direction
        let found = false;
        for (let i = 1; i <= 8; i++) {
          const dir = (entryDir + i) % 8;
          const nx = cx + dx[dir];
          const ny = cy + dy[dir];
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (bitmap[ny * width + nx] === 1) {
            prevX = cx; prevY = cy;
            cx = nx; cy = ny;
            found = true;
            break;
          }
        }

        if (!found) break; // Isolated pixel

        if (!secondFound) {
          secondX = cx; secondY = cy;
          secondPrevX = prevX; secondPrevY = prevY;
          secondFound = true;
        } else if (cx === startX && cy === startY && prevX === secondX && prevY === secondY) {
          break; // Jacob's stopping criterion
        }

        contour.push([cx, cy]);
        if (contour.length > width * height) break;
      }

      return contour;
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

    // --- Douglas-Peucker for closed paths ---
    // Inserts the original (unsimplified) point of maximum wrap deviation,
    // rather than duplicating the already-simplified point.
    function simplifyClosedPath(originalPoints, epsilon) {
      if (originalPoints.length <= 3) return originalPoints;
      let simplified = douglasPeucker(originalPoints, epsilon);

      // Check the wrap-around segment (last → first) for missed deviation
      const n = simplified.length;
      const last = simplified[n - 1], first = simplified[0];
      let wrapMax = 0, wrapBestOrig = null;

      for (let i = 0; i < originalPoints.length; i++) {
        const op = originalPoints[i];
        // Skip if this point is already in simplified
        const already = simplified.some(sp => sp[0] === op[0] && sp[1] === op[1]);
        if (already) continue;
        const d = perpDist(op[0], op[1], last[0], last[1], first[0], first[1]);
        if (d > wrapMax) { wrapMax = d; wrapBestOrig = op; }
      }

      if (wrapMax > epsilon && wrapBestOrig) {
        // Insert the original point right before the closing — between last and first
        simplified = [...simplified, wrapBestOrig];
      }

      return simplified;
    }

    // --- Shoelace polygon area ---
    function shoelaceArea(points) {
      let area = 0;
      const n = points.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += points[i][0] * points[j][1];
        area -= points[j][0] * points[i][1];
      }
      return Math.abs(area) / 2;
    }

    // --- Cubic Bezier fitting (Schneider's algorithm) ---
    // Consistent 2dp rounding throughout.
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

    function pointsToSvgPath(points, bezierError) {
      if (points.length < 2) return '';
      let d = 'M' + r2(points[0][0]) + ',' + r2(points[0][1]);
      d += ' ' + fitCubicBezier(points, bezierError || 1.0);
      d += ' Z';
      return d;
    }

    // --- Single layer tracing ---
    function traceSingleLayer(imageData, threshold, color) {
      return new Promise((resolve) => {
        workerLog('Tracing layer threshold=' + threshold);
        const width = imageData.width, height = imageData.height;

        const { bitmap, edgeBinary } = buildGrayscaleAndEdge(imageData, threshold);
        const enhanced = enhanceBitmap(bitmap, edgeBinary, width, height);

        const paths = [];
        const visitedContour = new Uint8Array(width * height);

        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            if (enhanced[idx] === 1 && !visitedContour[idx]) {
              const isBoundary =
                enhanced[(y-1)*width+x]===0 || enhanced[(y+1)*width+x]===0 ||
                enhanced[y*width+x-1]===0   || enhanced[y*width+x+1]===0;
              if (!isBoundary) continue;

              const contour = mooreNeighborTrace(enhanced, width, height, x, y);
              if (contour.length >= 8) {
                for (const [cx, cy] of contour) visitedContour[cy * width + cx] = 1;
                paths.push(contour);
              }
            }
          }
        }

        paths.sort((a, b) => shoelaceArea(b) - shoelaceArea(a));

        const maxPaths = Math.min(2000, paths.length);
        workerLog('Found ' + paths.length + ' contours, keeping ' + maxPaths);

        const seenPaths = new Set();
        const svgPaths = [];

        for (let pi = 0; pi < maxPaths; pi++) {
          const contour = paths[pi];
          const area = shoelaceArea(contour);
          if (area < 4) continue;

          const complexity = contour.length / Math.max(1, area);
          let epsilon = 0.5 + (contour.length > 200 ? contour.length / 8000 : 0);
          if (complexity > 0.2) epsilon = Math.max(0.3, epsilon * 0.8);
          epsilon = Math.min(2.0, epsilon);

          const simplified = simplifyClosedPath(contour, epsilon);
          if (simplified.length < 3) continue;

          const bezierError = epsilon * 1.5;
          const d = pointsToSvgPath(simplified, bezierError);
          if (d && !seenPaths.has(d)) {
            seenPaths.add(d);
            svgPaths.push('<path d="' + d + '" fill="' + color + '" stroke="none"/>');
          }
        }

        resolve({ paths: svgPaths, seenDs: seenPaths });
      });
    }

    // --- Posterization pipeline ---
    async function manualPosterize(imageData, options, callback) {
      workerLog('Starting posterization: ' + options.colorSteps + ' steps, strategy=' + options.fillStrategy);
      try {
        const numSteps = typeof options.colorSteps === 'number' ? Math.max(2, options.colorSteps) : 4;
        const thresholds = computeThresholds(numSteps);
        workerLog('Perceptual thresholds (L*-spaced): ' + JSON.stringify(thresholds));

        self.postMessage({ type: 'progress', progress: 5, details: 'Analyzing colors...' });

        const { imageData: imgData, width, height } = await dataURLToImageData(imageData);

        // Quantize exactly numSteps colors
        const rawPalette = quantizeColors(imgData, numSteps, options.fillStrategy);

        // Parse rgb(...) strings to get perceptual luminance for sorting
        function parseLuma(rgbStr) {
          const m = rgbStr.match(/rgb\\((\\d+),(\\d+),(\\d+)\\)/);
          if (!m) return 0;
          return srgbLuma(+m[1], +m[2], +m[3]);
        }

        // Sort palette by perceptual luminance ascending (lightest first)
        const sortedPalette = rawPalette
          .map(c => ({ css: c, luma: parseLuma(c) }))
          .sort((a, b) => a.luma - b.luma)
          .map(c => c.css);

        // Sort thresholds ascending; pair lightest color with lowest threshold.
        // Painter's order: lightest layer rendered first, darkest layer last (on top).
        const sortedThresholds = [...thresholds].sort((a, b) => a - b);

        // Ensure we have one threshold per color step.
        // If thresholds < numSteps (due to dedup), pad by halving remaining gaps.
        while (sortedThresholds.length < numSteps - 1) {
          let maxGap = -1, gapIdx = 0;
          for (let i = 0; i < sortedThresholds.length - 1; i++) {
            const gap = sortedThresholds[i+1] - sortedThresholds[i];
            if (gap > maxGap) { maxGap = gap; gapIdx = i; }
          }
          const mid = Math.round((sortedThresholds[gapIdx] + sortedThresholds[gapIdx + 1]) / 2);
          sortedThresholds.splice(gapIdx + 1, 0, mid);
        }

        // The darkest layer needs no threshold — it covers everything below the first threshold
        // Assign: color[0] (lightest) → threshold[0] (lowest), ..., color[N-1] (darkest) → rendered last
        // We trace N layers, each using a different threshold to define its bitmap.
        // Layer i uses threshold = sortedThresholds[i] (or 250 for the final/darkest layer).
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

          const { paths: layerPaths, seenDs } = await traceSingleLayer(imgData, threshold, color);

          // Cross-layer deduplication: skip paths already rendered in earlier layers
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

        // layers[0] = lightest (bottom), layers[N-1] = darkest (top) — correct painter's order
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
        logProcessingStep('COLOR_COMPLETE', `Done in ${Math.round(performance.now() - startTime)}ms`, false, logCallback);
        callback(null, svg);
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

// Analyze actual pixel complexity rather than using data URL length
const analyzeImageComplexity = (
  imageData: string
): Promise<{ complex: boolean; reason?: string; distinctColors?: number }> => {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        // Sample at most 200×200 pixels for speed
        const sampleW = Math.min(200, img.naturalWidth);
        const sampleH = Math.min(200, img.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = sampleW;
        canvas.height = sampleH;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve({ complex: false }); return; }
        ctx.drawImage(img, 0, 0, sampleW, sampleH);
        const { data } = ctx.getImageData(0, 0, sampleW, sampleH);

        // Count distinct 5-bit colors
        const seen = new Set<number>();
        let edgePixels = 0;
        for (let i = 0; i < sampleW * sampleH; i++) {
          const idx = i * 4;
          if (data[idx + 3] < 128) continue;
          seen.add(((data[idx] >> 3) << 10) | ((data[idx+1] >> 3) << 5) | (data[idx+2] >> 3));
        }

        // Estimate edge density via horizontal gradient
        for (let y = 0; y < sampleH; y++) {
          for (let x = 1; x < sampleW - 1; x++) {
            const i = (y * sampleW + x) * 4;
            const lCur = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
            const lNext = 0.299*data[i+4] + 0.587*data[i+5] + 0.114*data[i+6];
            if (Math.abs(lCur - lNext) > 20) edgePixels++;
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
        // White fill for B&W compatibility; color mode worker composites over white separately
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

      // Apply network simplification automatically when accessed over LAN
      const effectiveParams = isNetwork ? simplifyForNetworkClients({ ...params }) : params;

      const processWithParams = (imgData: string, processingParams: TracingParams) => {
        progressCallback('tracing');
        logProcessingStep('TRACE', `Starting tracing, data length: ${imgData.length}`, false, detailedLogCallback);

        const timeoutMs = isNetwork ? 90000 : 180000;
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
