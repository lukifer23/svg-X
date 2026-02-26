/**
 * Last checked: 2025-03-02
 */

// Last updated: 2025-03-11 - Force update to repository

import * as Potrace from 'potrace';
import slugify from 'slugify';

export const formatTimestamp = (): string =>
  new Date().toISOString().split('T')[1].split('.')[0];

// Function to detect if app is being accessed over network
export const isNetworkClient = (): boolean => {
  const hostname = window.location.hostname;
  // If hostname is not localhost or 127.0.0.1, it's likely a network client
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

export const PROGRESS_STEPS = {
  idle: '',
  loading: 'Loading image...',
  processing: 'Processing image data...',
  analyzing: 'Analyzing image complexity...',
  tracing: 'Tracing image contours...',
  colorProcessing: 'Processing color layers...',
  optimizing: 'Optimizing SVG output...',
  done: 'Done!',
  error: 'An error occurred'
};

// Enhanced logging with optional callback for UI display
const logProcessingStep = (
  step: string,
  message: string,
  isError = false,
  logCallback?: (step: string, message: string, isError: boolean, timestamp: string) => void,
  timestamp = formatTimestamp()
) => {
  console[isError ? 'error' : 'log'](`[${timestamp}] [${step}] ${message}`);
  // If callback is provided, send the log info to it for UI display
  if (logCallback) {
    logCallback(step, message, isError, timestamp);
  }
};

// Add a heartbeat mechanism to monitor long-running operations
const createHeartbeat = (
  operation: string,
  intervalMs: number,
  logCallback?: (step: string, message: string, isError: boolean, timestamp: string) => void
) => {
  const heartbeatId = setInterval(() => {
    logProcessingStep('HEARTBEAT', `${operation} still running...`, false, logCallback);
  }, intervalMs);
  
  return {
    stop: () => clearInterval(heartbeatId),
    heartbeatId
  };
};

// Utility function to handle the TypeScript type issue with Potrace
const trace = (
  image: string,
  options: TracingParams,
  callback: (err: Error | null, svg?: string) => void,
  logCallback?: (step: string, message: string, isError: boolean, timestamp: string) => void
) => {
  try {
    // Verify image data was received
    const imageSize = image.length;
    const imageType = image.startsWith('data:image/png') ? 'PNG' : 
                    image.startsWith('data:image/jpeg') ? 'JPEG' : 
                    image.startsWith('data:image/') ? 'other' : 'unknown';
    
    if (logCallback) {
      logCallback('IMAGE_RECEIPT', `Image received: ${imageSize} bytes, type: ${imageType}`, false, formatTimestamp());
    }
    
    // Check if this is a network client to add additional logging and handling
    const isNetwork = isNetworkClient();
    if (isNetwork && logCallback) {
      logCallback('NETWORK_TRACE', 'Processing trace over network - this might take longer', false, formatTimestamp());
    }
    
    // Log memory usage before tracing
    if (typeof window !== 'undefined' && (window as any).performance && (window as any).performance.memory) {
      const memUsage = (window as any).performance.memory;
      if (logCallback) {
        logCallback('MEMORY', `Before tracing: ${Math.round(memUsage.usedJSHeapSize / 1048576)}MB / ${Math.round(memUsage.jsHeapSizeLimit / 1048576)}MB`, false, formatTimestamp());
      }
    }
    
    // Start heartbeat to monitor tracing
    // Use more frequent heartbeats for network clients to ensure UI responsiveness
    const heartbeatInterval = isNetwork ? 1000 : 2000;
    const heartbeat = createHeartbeat('Potrace image tracing', heartbeatInterval, logCallback);
    
    // Track start time
    const startTime = performance.now();
    if (logCallback) {
      logCallback('TRACE_START', `Starting Potrace at ${startTime}ms`, false, formatTimestamp());
    }
    
    // Use the Potrace.trace function directly instead of creating a Potrace instance
    // This is the correct way to use Potrace with a data URL
    if (logCallback) {
      logCallback('TRACE_METHOD', 'Using Potrace.trace with data URL', false, formatTimestamp());
    }
    
    // Call the trace function from the Potrace library directly
    // Wrap in a setTimeout to ensure the UI can update before intensive processing starts
    setTimeout(() => {
      try {
        (Potrace as any).trace(image, options, (err: Error | null, svg?: string) => {
          if (err) {
            heartbeat.stop();
            if (logCallback) {
              logCallback('TRACE_ERROR', `Error during Potrace tracing: ${err.message}`, true, formatTimestamp());
            }
            callback(err);
            return;
          }
          
          // Tracing completed
          const endTime = performance.now();
          heartbeat.stop();
          
          if (logCallback) {
            logCallback('TRACE_COMPLETE', `Completed in ${Math.round(endTime - startTime)}ms`, false, formatTimestamp());

            // Log memory usage after tracing
            if (typeof window !== 'undefined' && (window as any).performance && (window as any).performance.memory) {
              const memUsage = (window as any).performance.memory;
              logCallback('MEMORY', `After tracing: ${Math.round(memUsage.usedJSHeapSize / 1048576)}MB / ${Math.round(memUsage.jsHeapSizeLimit / 1048576)}MB`, false, formatTimestamp());
            }
          }
          
          callback(null, svg);
        });
      } catch (error) {
        heartbeat.stop();
        if (logCallback) {
          logCallback('TRACE_SETUP_ERROR', `Exception during Potrace execution: ${error}`, true, formatTimestamp());
        }
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    }, isNetwork ? 300 : 0); // Add a small delay for network clients to ensure UI responsiveness
  } catch (error) {
    if (logCallback) {
      logCallback('TRACE_SETUP_ERROR', `Failed to initialize tracing: ${error}`, true, formatTimestamp());
    }
    callback(error instanceof Error ? error : new Error(String(error)));
  }
};

// Helper function to create an inline worker for posterization
const createPosterizeWorker = (
  image: string,
  options: any,
  progressCallback: (progress: number, details?: string) => void,
  completeCallback: (svg: string | null, error: Error | null) => void,
  logCallback?: (step: string, message: string, isError: boolean, timestamp: string) => void
) => {
  // Create a blob URL for our worker script
  const workerScript = `
    // Log function to debug worker execution
    function workerLog(message) {
      self.postMessage({ type: 'log', message: message });
    }
    
    workerLog('Worker started, initializing color processor...');
    
    // Instead of importing Potrace from CDN, we'll implement the necessary functions here
    // This avoids potential network errors loading external scripts
    
    // Helper function to convert dataURL to ImageData
    function dataURLToImageData(dataURL) {
      return new Promise((resolve, reject) => {
        workerLog('Converting data URL to image data...');
        
        // Use fetch API which is available in workers
        fetch(dataURL)
          .then(response => response.blob())
          .then(blob => createImageBitmap(blob))
          .then(imageBitmap => {
            const width = imageBitmap.width;
            const height = imageBitmap.height;
            const canvas = new OffscreenCanvas(width, height);
            const ctx = canvas.getContext('2d');
            
            if (!ctx) {
              reject(new Error('Failed to get canvas context'));
              return;
            }
            
            // Draw the image on the canvas
            ctx.drawImage(imageBitmap, 0, 0);
            const imageData = ctx.getImageData(0, 0, width, height);
            
            workerLog('Image converted, dimensions: ' + width + 'x' + height);
            resolve({imageData, width, height});
          })
          .catch(error => {
            workerLog('Error in fetch/bitmap conversion: ' + error.message);
            reject(new Error('Failed to convert image data: ' + error.message));
          });
      });
    }
    
    // Simple contour tracing algorithm to find shape boundaries
    function traceContour(bitmap, width, height, startX, startY, visited) {
      const directions = [
        [1, 0], [1, 1], [0, 1], [-1, 1], 
        [-1, 0], [-1, -1], [0, -1], [1, -1]
      ];
      
      const points = [[startX, startY]];
      let x = startX, y = startY;
      visited.add(y * width + x);
      
      // Find next pixel in the contour
      let foundNext = true;
      while (foundNext) {
        foundNext = false;
        for (const [dx, dy] of directions) {
          const nx = x + dx;
          const ny = y + dy;
          
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const idx = ny * width + nx;
            if (bitmap[idx] === 1 && !visited.has(idx)) {
              points.push([nx, ny]);
              visited.add(idx);
              x = nx;
              y = ny;
              foundNext = true;
              break;
            }
          }
        }
      }
      
      return points;
    }
    
    // Improve traceSingleLayer for better detail preservation and edge definition
    function traceSingleLayer(imageData, threshold, color) {
      return new Promise((resolve) => {
        workerLog('Tracing layer with threshold ' + threshold);
        
        const width = imageData.width;
        const height = imageData.height;
        const data = imageData.data;
        
        // Create a bitmap where pixels below threshold are black, others white
        const bitmap = new Uint8Array(width * height);
        
        // First pass - calculate grayscale values with better color perception
        for (let i = 0; i < height; i++) {
          for (let j = 0; j < width; j++) {
            const idx = (i * width + j) * 4;
            // Enhanced grayscale conversion with better color perception
            // This formula better handles color variations especially in pinks and purples
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const a = data[idx + 3];
            
            // Skip transparent pixels
            if (a < 128) {
              bitmap[i * width + j] = 0;
              continue;
            }
            
            // Enhanced grayscale conversion better suited for color images
            // Preserves more luminance differences in similarly colored areas
            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            
            // Apply a local contrast enhancement
            // Enhanced brightness/contrast for better separation
            const brightnessAdjusted = Math.max(0, Math.min(255, luma * 1.1 - 5));
            
            // Apply threshold with consideration for alpha
            bitmap[i * width + j] = (brightnessAdjusted < threshold) ? 1 : 0;
          }
        }
        
        // Improved edge enhancement that preserves text and fine details
        const enhancedBitmap = new Uint8Array(width * height);
        
        // First apply edge detection to identify important features
        const edgeMap = new Uint8Array(width * height);
        for (let i = 1; i < height - 1; i++) {
          for (let j = 1; j < width - 1; j++) {
            const idx = i * width + j;
            
            // Sobel operator for edge detection
            const h1 = bitmap[(i-1) * width + j-1] * -1 + bitmap[(i-1) * width + j] * -2 + bitmap[(i-1) * width + j+1] * -1 +
                       bitmap[(i+1) * width + j-1] * 1 + bitmap[(i+1) * width + j] * 2 + bitmap[(i+1) * width + j+1] * 1;
                       
            const h2 = bitmap[(i-1) * width + j-1] * -1 + bitmap[(i-1) * width + j+1] * 1 +
                       bitmap[i * width + j-1] * -2 + bitmap[i * width + j+1] * 2 +
                       bitmap[(i+1) * width + j-1] * -1 + bitmap[(i+1) * width + j+1] * 1;
                       
            const edgeStrength = Math.sqrt(h1*h1 + h2*h2);
            edgeMap[idx] = edgeStrength > 0.5 ? 1 : 0;
          }
        }
        
        // Apply morphological operations to enhance details and remove noise
        // This is especially important for text and fine details
        for (let i = 1; i < height - 1; i++) {
          for (let j = 1; j < width - 1; j++) {
            const idx = i * width + j;
            
            // Get 3x3 neighborhood
            const neighbors = [
              bitmap[(i-1) * width + j-1], bitmap[(i-1) * width + j], bitmap[(i-1) * width + j+1],
              bitmap[i * width + j-1],     bitmap[i * width + j],     bitmap[i * width + j+1],
              bitmap[(i+1) * width + j-1], bitmap[(i+1) * width + j], bitmap[(i+1) * width + j+1]
            ];
            
            const edgeNeighbors = [
              edgeMap[(i-1) * width + j-1], edgeMap[(i-1) * width + j], edgeMap[(i-1) * width + j+1],
              edgeMap[i * width + j-1],     edgeMap[i * width + j],     edgeMap[i * width + j+1],
              edgeMap[(i+1) * width + j-1], edgeMap[(i+1) * width + j], edgeMap[(i+1) * width + j+1]
            ];
            
            // Count black and edge pixels in neighborhood
            const blackCount = neighbors.reduce((sum, val) => sum + val, 0);
            const edgeCount = edgeNeighbors.reduce((sum, val) => sum + val, 0);
            
            // Is this pixel on an edge?
            const isEdge = edgeMap[idx] === 1;
            
            // Decision logic: preserve edges and text
            if (isEdge) {
              // Keep edge pixels 
              enhancedBitmap[idx] = bitmap[idx];
            } else if (bitmap[idx] === 1) {
              // For non-edge black pixels, only keep if they have enough black neighbors
              // This helps preserve text while removing noise
              enhancedBitmap[idx] = (blackCount >= 3) ? 1 : 0;
            } else {
              // For white pixels, convert to black if surrounded by black and edges
              // This helps fill in areas like text where edges were detected
              enhancedBitmap[idx] = (blackCount >= 5 || (blackCount >= 3 && edgeCount >= 2)) ? 1 : 0;
            }
          }
        }
        
        // Clean up the edges of the image
        for (let i = 0; i < height; i++) {
          enhancedBitmap[i * width] = 0;
          enhancedBitmap[i * width + (width - 1)] = 0;
        }
        for (let j = 0; j < width; j++) {
          enhancedBitmap[j] = 0;
          enhancedBitmap[(height - 1) * width + j] = 0;
        }
        
        // Enhanced contour tracing for better path generation
        workerLog('Finding contours with enhanced detection...');
        
        const paths = [];
        const visited = new Set();
        const potentialStartPoints = [];
        
        // First pass - find all potential starting points with priority
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            if (enhancedBitmap[idx] === 1 && !visited.has(idx)) {
              // Determine if this is a good starting point (edge pixel)
              const isEdgePixel = edgeMap[idx] === 1;
              const isTopEdge = enhancedBitmap[(y-1) * width + x] === 0; // Pixel above is white
              
              // Add to potential starting points with priority
              potentialStartPoints.push({
                x,
                y,
                priority: isEdgePixel ? (isTopEdge ? 3 : 2) : 1 // Higher priority for edge pixels
              });
            }
          }
        }
        
        // Sort by priority (higher first)
        potentialStartPoints.sort((a, b) => b.priority - a.priority);
        
        // Process points in priority order
        for (const {x, y} of potentialStartPoints) {
          const idx = y * width + x;
          if (!visited.has(idx) && enhancedBitmap[idx] === 1) {
            const path = traceContour(enhancedBitmap, width, height, x, y, visited);
            if (path.length > 4) { // Skip very tiny contours
              paths.push(path);
            }
          }
        }
        
        // Sort paths by size (largest first)
        paths.sort((a, b) => b.length - a.length);
        
        // Keep a reasonable number of contours, prioritizing larger ones
        // For detailed images, we need more contours
        const maxPathsToKeep = Math.min(2000, paths.length);
        const significantPaths = paths.slice(0, maxPathsToKeep);
        
        workerLog('Found ' + paths.length + ' contours, keeping ' + significantPaths.length + ' significant ones');
        
        // Convert paths to SVG with adaptive simplification based on path size and complexity
        const svgPaths = significantPaths.map(points => {
          // Calculate path complexity (density of points)
          const pathComplexity = points.length / (Math.max(1, getPathArea(points)));
          
          // Adaptive epsilon based on path size and complexity
          // Smaller paths and more complex ones get more precision
          let epsilon = 0.3; // Start with high precision
          
          if (points.length > 100) {
            // Adjust based on path length - longer paths can be more simplified
            epsilon = Math.min(1.0, epsilon + (points.length / 5000));
          }
          
          // Adjust based on complexity - more complex paths need more detail
          if (pathComplexity > 0.1) {
            epsilon = Math.max(0.2, epsilon * 0.7);
          }
          
          const simplified = simplifyPath(points, epsilon);
          return pointsToSvgPath(simplified);
        });
        
        // Generate SVG with improved fill and optional stroke
        const layerSvg = svgPaths.map(d => 
          '<path d="' + d + '" fill="' + color + '" stroke="none" />'
        ).join('');
        
        workerLog('Layer traced with ' + svgPaths.length + ' paths using color ' + color);
        resolve(layerSvg);
      });
    }
    
    // Helper function to estimate the area of a path
    function getPathArea(points) {
      if (points.length < 3) return 0;
      
      // Find bounding box as a simple area approximation
      let minX = Infinity, minY = Infinity;
      let maxX = -Infinity, maxY = -Infinity;
      
      for (const [x, y] of points) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      
      return (maxX - minX) * (maxY - minY);
    }
    
    // Simplify a path using Douglas-Peucker algorithm
    function simplifyPath(points, epsilon) {
      if (points.length <= 2) return points;
      
      // Find the point with the maximum distance
      let maxDistance = 0;
      let index = 0;
      
      const firstPoint = points[0];
      const lastPoint = points[points.length - 1];
      
      for (let i = 1; i < points.length - 1; i++) {
        const distance = perpendicularDistance(points[i], firstPoint, lastPoint);
        if (distance > maxDistance) {
          maxDistance = distance;
          index = i;
        }
      }
      
      // If max distance is greater than epsilon, recursively simplify
      let result = [];
      if (maxDistance > epsilon) {
        const firstHalf = simplifyPath(points.slice(0, index + 1), epsilon);
        const secondHalf = simplifyPath(points.slice(index), epsilon);
        
        // Concatenate the two parts
        result = firstHalf.slice(0, -1).concat(secondHalf);
      } else {
        result = [firstPoint, lastPoint];
      }
      
      return result;
    }
    
    // Calculate perpendicular distance from a point to a line
    function perpendicularDistance(point, lineStart, lineEnd) {
      const [x, y] = point;
      const [x1, y1] = lineStart;
      const [x2, y2] = lineEnd;
      
      // Avoid division by zero
      if (x1 === x2 && y1 === y2) return Math.hypot(x - x1, y - y1);
      
      const numerator = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1);
      const denominator = Math.hypot(y2 - y1, x2 - x1);
      
      return numerator / denominator;
    }
    
    // Convert points to SVG path data
    function pointsToSvgPath(points) {
      if (points.length === 0) return '';
      
      let d = 'M' + points[0][0] + ',' + points[0][1];
      for (let i = 1; i < points.length; i++) {
        d += ' L' + points[i][0] + ',' + points[i][1];
      }
      d += ' Z';
      
      return d;
    }
    
    // Improve the color quantization for better color reproduction
    function quantizeColors(imageData, numColors, strategy = 'dominant') {
      workerLog('Performing color quantization with ' + numColors + ' colors using strategy: ' + strategy);
      
      // If we have proper ImageData
      if (imageData && imageData.data) {
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        const pixelCount = width * height;
        
        // Calculate sampling rate based on image size
        // Use more samples for better color detection
        const samplingRate = Math.max(1, Math.floor(pixelCount / 100000)); 
        
        // Better color extraction with improved precision
        const colorCounts = new Map();
        const colors = [];
        
        // First pass - collect all significant colors
        for (let i = 0; i < pixelCount; i += samplingRate) {
          const idx = i * 4;
          
          // Skip transparent pixels
          if (data[idx + 3] < 128) continue;
          
          // Get RGB values - use actual RGB values for better precision
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          
          // Create a color key that preserves more color information
          // Use a smaller bucket size (16 levels per channel instead of 256)
          // This helps group similar colors while preserving distinctions
          const rBucket = Math.floor(r / 16);
          const gBucket = Math.floor(g / 16);
          const bBucket = Math.floor(b / 16);
          
          const colorKey = (rBucket << 8) + (gBucket << 4) + bBucket;
          
          if (!colorCounts.has(colorKey)) {
            // Initial color - store the actual RGB values for better reproduction
            colorCounts.set(colorKey, { 
              count: 1, 
              r: r, 
              g: g, 
              b: b,
              sum: [r, g, b]  // For calculating average later
            });
          } else {
            // Update existing color count and sum for averaging
            const info = colorCounts.get(colorKey);
            info.count += 1;
            info.sum[0] += r;
            info.sum[1] += g;
            info.sum[2] += b;
            colorCounts.set(colorKey, info);
          }
        }
        
        // Convert to array for sorting and filtering
        for (const [key, info] of colorCounts.entries()) {
          // Calculate true average color
          const avgR = Math.round(info.sum[0] / info.count);
          const avgG = Math.round(info.sum[1] / info.count); 
          const avgB = Math.round(info.sum[2] / info.count);
          
          // Store with count for selection
          colors.push({
            color: [avgR, avgG, avgB],
            count: info.count,
            key: key
          });
        }
        
        workerLog('Sampled ' + colors.length + ' unique color groups from image');
        
        // Sort by frequency (most common first)
        colors.sort((a, b) => b.count - a.count);
        
        // Select colors based on strategy
        let selectedColors = [];
        
        if (strategy === 'dominant' || colors.length <= numColors) {
          // Use most common colors
          selectedColors = colors.slice(0, numColors);
        } else if (strategy === 'spread') {
          // Select colors spread across the frequency range for better representation
          const step = Math.max(1, Math.floor(colors.length / numColors));
          for (let i = 0; i < numColors && i * step < colors.length; i++) {
            selectedColors.push(colors[i * step]);
          }
        } else if (strategy === 'median') {
          // Select colors from the middle of the frequency range
          const startIdx = Math.floor((colors.length - numColors) / 2);
          selectedColors = colors.slice(startIdx, startIdx + numColors);
        } else {
          // Default to dominant
          selectedColors = colors.slice(0, numColors);
        }
        
        // Ensure we have enough colors
        while (selectedColors.length < numColors) {
          if (selectedColors.length === 0) {
            // If we somehow have no colors, add basic colors
            selectedColors.push({
              color: [0, 0, 0],  // Black
              count: 1,
              key: 0
            });
          } else {
            // Clone the most frequent color with a slight variation
            const baseColor = selectedColors[0];
            selectedColors.push({
              color: [
                Math.min(255, baseColor.color[0] + 30),
                Math.min(255, baseColor.color[1] + 30),
                Math.min(255, baseColor.color[2] + 30)
              ],
              count: 1,
              key: -selectedColors.length
            });
          }
        }
        
        // Convert to CSS RGB color values
        const colorPalette = selectedColors.map(item => {
          const [r, g, b] = item.color;
          return 'rgb(' + r + ',' + g + ',' + b + ')';
        });
        
        workerLog('Selected color palette: ' + JSON.stringify(colorPalette));
        return colorPalette;
      } else {
        // Fallback color palette if no valid image data
        workerLog('Warning: No valid image data, using fallback color palette');
        const colorPalette = [
          'rgb(0,0,0)',      // Black
          'rgb(255,255,255)', // White
          'rgb(255,0,0)',     // Red
          'rgb(0,255,0)',     // Green
          'rgb(0,0,255)',     // Blue
          'rgb(255,255,0)',   // Yellow
          'rgb(255,0,255)',   // Magenta
          'rgb(0,255,255)'    // Cyan
        ];
        
        // Return the requested number of colors
        return colorPalette.slice(0, numColors);
      }
    }
    
    // Update the manualPosterize function to use better threshold distribution
    function manualPosterize(imageData, options, callback) {
      workerLog('Starting advanced posterization process...');
      
      try {
        // Calculate steps for posterization with improved distribution
        let steps = [];
        if (Array.isArray(options.steps)) {
          steps = options.steps;
        } else if (typeof options.steps === 'number') {
          const numSteps = options.steps;
          workerLog('Using ' + numSteps + ' steps for posterization');
          
          if (numSteps <= 2) {
            // For binary (2 colors), use middle threshold
            steps = [128];
          } else {
            // For more steps, use non-linear distribution with focus on detail-rich areas
            // Improved distribution to capture more important color transitions
            for (let i = 0; i < numSteps - 1; i++) {
              // Use a curve that emphasizes both dark and midtone areas
              // Dark areas often contain important details and edges
              // Midtones often contain important text and visual features
              const t = i / (numSteps - 1);
              
              // This creates thresholds that are more clustered in mid-dark range
              // where most visible details occur in colored images
              // Especially good for signs and text with shadows/highlights
              let value;
              if (t < 0.5) {
                // More granularity in darker tones
                value = Math.round(255 * (0.15 + 0.85 * Math.pow(t * 2, 0.8)));
              } else {
                // Smoother transition in lighter tones
                value = Math.round(255 * (0.55 + 0.45 * Math.pow((t - 0.5) * 2, 0.6)));
              }
              
              steps.push(Math.min(254, Math.max(1, value))); // Clamp to valid range
            }
            
            // Ensure proper distribution and uniqueness
            steps.sort((a, b) => a - b);
            
            // Remove any duplicate values
            steps = steps.filter((v, i, a) => i === 0 || v !== a[i-1]);
          }
        }
        
        workerLog('Calculated improved thresholds: ' + JSON.stringify(steps));
        
        // Process the image
        dataURLToImageData(imageData).then(({imageData, width, height}) => {
          // Analyze color distribution to find optimal palette
          // This helps ensure we capture the actual colors in the image
          self.postMessage({ 
            type: 'progress', 
            progress: 5,
            details: 'Analyzing image colors...'
          });
          
          // Extract dominant colors with improved strategy
          const colorPalette = quantizeColors(imageData, steps.length + 1, options.fillStrategy);
          
          // Process each threshold to create layers with enhanced handling
          const processLayers = async () => {
            let layers = [];
            
            self.postMessage({ 
              type: 'progress', 
              progress: 10,
              details: 'Preparing image layers with improved detail detection...' 
            });
            
            // Process darkest layer first (base layer)
            const firstColor = colorPalette[0];
            self.postMessage({ 
              type: 'progress', 
              progress: 15,
              details: 'Processing base layer with color: ' + firstColor 
            });
            
            // Use first threshold for base layer
            const firstThreshold = steps[0];
            const baseLayerSvg = await traceSingleLayer(imageData, firstThreshold, firstColor);
            layers.push(baseLayerSvg);
            
            // Process middle layers with enhanced detail preservation
            for (let i = 1; i < steps.length; i++) {
              const threshold = steps[i];
              const color = colorPalette[i];
              
              self.postMessage({ 
                type: 'progress', 
                progress: 20 + Math.round((i / steps.length) * 70),
                details: 'Processing layer ' + (i + 1) + ' of ' + (steps.length + 1) + ' (color: ' + color + ')...'
              });
              
              workerLog('Processing detail-enhanced layer ' + (i + 1) + ' with threshold ' + threshold);
              
              // Process this layer with enhanced detail preservation
              const layerSvg = await traceSingleLayer(imageData, threshold, color);
              layers.push(layerSvg);
              
              self.postMessage({ 
                type: 'progress', 
                progress: 20 + Math.round(((i + 1) / steps.length) * 70),
                details: 'Completed layer ' + (i + 1) + ' of ' + (steps.length + 1)
              });
            }
            
            // Final highlight layer
            const finalColor = colorPalette[colorPalette.length - 1];
            self.postMessage({ 
              type: 'progress', 
              progress: 90,
              details: 'Processing final highlight layer with color: ' + finalColor
            });
            
            // Use a high threshold (but not 255) to ensure we capture highlights
            // This ensures lighter pink areas are well represented
            const finalLayerSvg = await traceSingleLayer(imageData, 230, finalColor);
            layers.push(finalLayerSvg);
            
            // Add an extra detail-enhancing outline layer if requested
            if (options.enhanceDetail) {
              self.postMessage({ 
                type: 'progress', 
                progress: 92,
                details: 'Adding detail-enhancing outline layer...'
              });
              
              // Create an outline layer that enhances the visibility of details
              // This can be implemented by using a more aggressive threshold
              // and using it as an outline rather than a filled shape
              const outlineLayerSvg = await createOutlineLayer(imageData, 100, '#000000');
              if (outlineLayerSvg) {
                layers.push(outlineLayerSvg);
              }
            }
            
            self.postMessage({ 
              type: 'progress', 
              progress: 95,
              details: 'Combining layers into final SVG...' 
            });
            
            workerLog('All layers processed, creating optimized SVG');
            
            // Create final SVG by combining all layers
            // Changing the stacking order for better visual results
            let combinedSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">';
            
            // Add a white background for better visibility (optional)
            // combinedSvg += '<rect width="100%" height="100%" fill="white"/>';
            
            // Stack layers from bottom (last) to top (first)
            // We reverse the array for proper stacking order
            for (let i = layers.length - 1; i >= 0; i--) {
              combinedSvg += layers[i];
            }
            
            combinedSvg += '</svg>';
            workerLog('SVG generation complete, size: ' + combinedSvg.length + ' characters');
            
            self.postMessage({ 
              type: 'progress', 
              progress: 98,
              details: 'Optimizing final SVG output...' 
            });
            
            setTimeout(() => {
              callback(null, combinedSvg);
            }, 300);
          };
          
          // Start processing with enhanced options
          processLayers().catch(err => {
            workerLog('Error in enhanced layer processing: ' + err.message);
            callback(err, null);
          });
        }).catch(err => {
          workerLog('Error converting image data: ' + err.message);
          callback(err, null);
        });
      } catch (err) {
        workerLog('Error in posterization: ' + err.message);
        callback(err, null);
      }
    }
    
    // Optional: Helper function to create an outline layer that enhances visibility of details
    function createOutlineLayer(imageData, threshold, color) {
      return new Promise((resolve) => {
        // This is a placeholder - in a full implementation, this would create thin
        // outline paths that enhance the visibility of details without filling them
        // Since this requires significant complexity, we'll return null for now
        resolve(null);
      });
    }
    
    self.addEventListener('message', function(e) {
      const { image, options } = e.data;
      
      // Ensure enhance detail option is set
      const enhancedOptions = {
        ...options,
        enhanceDetail: options.enhanceDetail !== undefined ? options.enhanceDetail : true
      };
      
      workerLog('Worker received message with enhanced options: ' + JSON.stringify(Object.keys(enhancedOptions)));
      
      try {
        // Start the posterize process with enhanced options
        workerLog('Starting enhanced posterization process with ' + enhancedOptions.colorSteps + ' steps');
        
        manualPosterize(image, enhancedOptions, (err, svg) => {
          if (err) {
            workerLog('Error in enhanced posterization: ' + err.message);
            self.postMessage({ type: 'error', error: err.message });
          } else {
            workerLog('Enhanced posterization complete');
            self.postMessage({ 
              type: 'progress', 
              progress: 98,
              details: 'Finalizing enhanced SVG output...'
            });
            setTimeout(() => {
              self.postMessage({ type: 'complete', svg });
            }, 300);
          }
        });
      } catch (err) {
        workerLog('Exception in worker: ' + err.message);
        self.postMessage({ type: 'error', error: err.message });
      }
    });
  `;
  
  const blob = new Blob([workerScript], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(blob);
  
  // Create the worker
  const worker = new Worker(workerUrl);
  
  // Set up message handling
  worker.addEventListener('message', (e) => {
    const { type, progress, details, svg, error, message } = e.data;
    
    switch (type) {
      case 'progress':
        progressCallback(progress, details);
        break;
      case 'log':
        console.log('[WORKER] ' + message);
        if (message && typeof message === 'string') {
          // Also forward worker logs to the callback
          if (typeof logCallback === 'function') {
            logCallback('WORKER', message, false, new Date().toISOString().split('T')[1].split('.')[0]);
          }
        }
        break;
      case 'complete':
        URL.revokeObjectURL(workerUrl); // Clean up
        completeCallback(svg, null);
        worker.terminate();
        break;
      case 'error':
        URL.revokeObjectURL(workerUrl); // Clean up
        completeCallback(null, new Error(error));
        worker.terminate();
        break;
    }
  });
  
  // Start the worker
  worker.postMessage({ image, options });
  
  // Return a function to terminate the worker if needed
  return {
    terminate: () => {
      URL.revokeObjectURL(workerUrl);
      worker.terminate();
    }
  };
};

// Updated posterize function that uses a Web Worker
const posterize = (
  image: string,
  options: any,
  callback: (err: Error | null, svg?: string) => void,
  logCallback?: (step: string, message: string, isError: boolean, timestamp: string) => void
) => {
  try {
    // Verify image data was received
    const imageSize = image.length;
    const imageType = image.startsWith('data:image/png') ? 'PNG' : 
                    image.startsWith('data:image/jpeg') ? 'JPEG' : 
                    image.startsWith('data:image/') ? 'other' : 'unknown';
    
    if (logCallback) {
      logCallback('IMAGE_RECEIPT', 'Image received for color processing: ' + imageSize + ' bytes, type: ' + imageType, false, new Date().toISOString().split('T')[1].split('.')[0]);
    }
    
    // Check if this is a network client to add additional logging and handling
    const isNetwork = isNetworkClient();
    if (isNetwork && logCallback) {
      logCallback('NETWORK_TRACE', 'Processing color trace over network - this might take longer', false, new Date().toISOString().split('T')[1].split('.')[0]);
    }
    
    // Log memory usage before posterization
    if (typeof window !== 'undefined' && (window as any).performance && (window as any).performance.memory) {
      const memUsage = (window as any).performance.memory;
      if (logCallback) {
        logCallback('MEMORY', 'Before color tracing: ' + Math.round(memUsage.usedJSHeapSize / 1048576) + 'MB / ' + Math.round(memUsage.jsHeapSizeLimit / 1048576) + 'MB', false, new Date().toISOString().split('T')[1].split('.')[0]);
      }
    }
    
    // Start heartbeat to monitor posterization
    const heartbeatInterval = isNetwork ? 1000 : 2000;
    const heartbeat = createHeartbeat('Potrace color image processing', heartbeatInterval, logCallback);
    
    // Track start time
    const startTime = performance.now();
    if (logCallback) {
      logCallback('COLOR_START', 'Starting color processing at ' + startTime + 'ms using Web Worker', false, new Date().toISOString().split('T')[1].split('.')[0]);
    }
    
    // Prepare posterize options
    const posterizeOptions = {
      ...options,
      steps: options.colorSteps || 4,
      fillStrategy: options.fillStrategy || 'dominant',
      // Use threshold from the regular options
      threshold: options.threshold
    };
    
    if (logCallback) {
      logCallback('COLOR_METHOD', 'Using Potrace.posterize with ' + posterizeOptions.steps + ' steps, strategy: ' + posterizeOptions.fillStrategy, false, new Date().toISOString().split('T')[1].split('.')[0]);
    }
    
    // Create a variable to store the latest progress details
    let currentProgressDetails = 'Initializing color processing...';
    
    // Use a web worker to keep the UI responsive
    const worker = createPosterizeWorker(
      image, 
      posterizeOptions,
      (progress, details) => {
        if (details) {
          currentProgressDetails = details;
        }
        if (logCallback) {
          logCallback('COLOR_PROGRESS', 'Progress: ' + progress + '% - ' + currentProgressDetails, false, new Date().toISOString().split('T')[1].split('.')[0]);
        }
        
        // We could emit an event here to update UI with detailed progress information
        if (typeof window !== 'undefined' && window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent('color-progress-update', {
            detail: {
              progress,
              details: currentProgressDetails
            }
          }));
        }
      },
      (svg, error) => {
        heartbeat.stop();
        
        if (error) {
          if (logCallback) {
            logCallback('COLOR_ERROR', 'Error during color processing: ' + error.message, true, new Date().toISOString().split('T')[1].split('.')[0]);
          }
          callback(error);
          return;
        }
        
        if (!svg) {
          const err = new Error('Failed to generate SVG in worker');
          if (logCallback) {
            logCallback('COLOR_ERROR', err.message, true, new Date().toISOString().split('T')[1].split('.')[0]);
          }
          callback(err);
          return;
        }
        
        // Processing completed
        const endTime = performance.now();
        
        if (logCallback) {
          logCallback('COLOR_COMPLETE', 'Color processing completed in ' + Math.round(endTime - startTime) + 'ms', false, new Date().toISOString().split('T')[1].split('.')[0]);
          
          // Log memory usage after processing
          if (typeof window !== 'undefined' && (window as any).performance && (window as any).performance.memory) {
            const memUsage = (window as any).performance.memory;
            logCallback('MEMORY', 'After color processing: ' + Math.round(memUsage.usedJSHeapSize / 1048576) + 'MB / ' + Math.round(memUsage.jsHeapSizeLimit / 1048576) + 'MB', false, new Date().toISOString().split('T')[1].split('.')[0]);
          }
        }
        
        callback(null, svg);
      },
      logCallback
    );
    
    // Return the worker handle so it can be terminated if needed
    return worker;
    
  } catch (error) {
    if (logCallback) {
      logCallback('COLOR_SETUP_ERROR', 'Failed to initialize color processing: ' + error, true, new Date().toISOString().split('T')[1].split('.')[0]);
    }
    callback(error instanceof Error ? error : new Error(String(error)));
    
    // Return a dummy object with terminate function for consistent API
    return {
      terminate: () => {}
    };
  }
};

// Check if image might be too complex
const analyzeImageComplexity = (imageData: string): { complex: boolean, reason?: string, size?: number } => {
  // This is a simple heuristic - we could develop more sophisticated analysis
  // based on image data size, number of distinct colors, etc.
  const complexity = imageData.length;
  
  logProcessingStep('ANALYZE', 'Image data length: ' + complexity);
  
  if (complexity > 5000000) {
    return { complex: true, reason: 'Image data size is very large', size: complexity };
  }
  
  if (complexity > 1000000) {
    return { complex: true, reason: 'Image data is moderately complex', size: complexity };
  }
  
  // Additional complexity checks could be added here
  
  return { complex: false, size: complexity };
};

// Try to simplify complex images
export const simplifyForComplexImages = (params: TracingParams): TracingParams => {
  logProcessingStep('SIMPLIFY', 'Applying optimizations for complex image');
  
  // Much more aggressive simplification for complex images
  return {
    ...params,
    // Aggressively remove small artifacts
    turdSize: Math.max(params.turdSize, 15),
    // Use an extremely tolerant optimization for complex images
    optTolerance: 3.0,
    // Use turn policy that works better for complex shapes
    turnPolicy: 'minority',
    // Higher threshold for better contrast in line detection
    threshold: 180,
    // Enhanced corner detection
    alphaMax: 1.0,
    // Disabling highest quality for better performance
    highestQuality: false,
    // Ensure opt curve is enabled for complex images
    optCurve: true
  };
};

// Scale image so that the largest dimension does not exceed a maximum value
export const scaleToMaxDimension = (imageData: string, maxDimension = 1000): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      logProcessingStep('SCALE', `Ensuring image fits within ${maxDimension}px`);

      const img = new Image();
      img.onload = () => {
        const originalWidth = img.width;
        const originalHeight = img.height;

        if (originalWidth <= maxDimension && originalHeight <= maxDimension) {
          resolve(imageData);
          return;
        }

        // Determine scaling factor
        const scale = originalWidth > originalHeight
          ? maxDimension / originalWidth
          : maxDimension / originalHeight;

        const canvas = document.createElement('canvas');
        const newWidth = Math.round(originalWidth * scale);
        const newHeight = Math.round(originalHeight * scale);

        canvas.width = newWidth;
        canvas.height = newHeight;

        logProcessingStep('SCALE', `Scaling image from ${originalWidth}x${originalHeight} to ${newWidth}x${newHeight}`);

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, newWidth, newHeight);
        ctx.drawImage(img, 0, 0, newWidth, newHeight);

        const scaledData = canvas.toDataURL('image/png');
        resolve(scaledData);
      };

      img.onerror = () => {
        reject(new Error('Failed to load image for scaling'));
      };

      img.src = imageData;
    } catch (error) {
      logProcessingStep('SCALE', `Error during scaling: ${error}`, true);
      reject(error);
    }
  });
};

// Downscale image to reduce complexity
const downscaleImage = (imageData: string, scale: number = 0.5): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      logProcessingStep('DOWNSCALE', 'Downscaling image by factor of ' + scale);
      
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const originalWidth = img.width;
        const originalHeight = img.height;
        
        // Calculate new dimensions
        const newWidth = Math.round(originalWidth * scale);
        const newHeight = Math.round(originalHeight * scale);
        
        canvas.width = newWidth;
        canvas.height = newHeight;
        
        logProcessingStep('DOWNSCALE', 'Original size: ' + originalWidth + 'x' + originalHeight + ', New size: ' + newWidth + 'x' + newHeight);
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        
        // Use better interpolation method for downscaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // Draw image with white background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, newWidth, newHeight);
        ctx.drawImage(img, 0, 0, newWidth, newHeight);
        
        // Get downscaled image data
        const downscaledData = canvas.toDataURL('image/png');
        logProcessingStep('DOWNSCALE', 'Downscaled image data length: ' + downscaledData.length);
        
        resolve(downscaledData);
      };
      
      img.onerror = () => {
        reject(new Error('Failed to load image for downscaling'));
      };
      
      img.src = imageData;
    } catch (error) {
      logProcessingStep('DOWNSCALE', 'Error during downscaling: ' + error, true);
      reject(error);
    }
  });
};

export const processImage = (
  imageData: string,
  params: TracingParams,
  progressCallback: (status: string) => void,
  detailedLogCallback?: (step: string, message: string, isError: boolean, timestamp: string) => void
): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      logProcessingStep('START', 'Beginning image processing with data length: ' + imageData.length, false, detailedLogCallback);
      progressCallback('loading');

      // Check if this is a network client
      const isNetwork = isNetworkClient();

      // For network clients, apply more aggressive downscaling
      let processedImageData = imageData;

      const processNextStep = () => {
        progressCallback('processing');
        logProcessingStep('PROCESS', 'Processing image data', false, detailedLogCallback);
        
        setTimeout(() => {
          progressCallback('analyzing');
          
          // Analyze image complexity
          const complexityResult = analyzeImageComplexity(processedImageData);
          logProcessingStep('ANALYZE', 'Complexity analysis result: ' + JSON.stringify(complexityResult), false, detailedLogCallback);
          
          if (isNetwork) {
            logProcessingStep('NETWORK', 'Processing as network client - applying enhanced optimizations', false, detailedLogCallback);
            
            // If we're on a network client AND the image is complex, 
            // downscale it even more for better performance
            if (complexityResult.complex && processedImageData === imageData) {
              logProcessingStep('NETWORK_SCALE', 'Further downscaling image for network processing', false, detailedLogCallback);
              
              // Apply more aggressive downscaling for network clients with complex images
              downscaleImage(processedImageData, 0.3).then((scaledData) => {
                processedImageData = scaledData;
                logProcessingStep('NETWORK_SCALED', 'Downscaled image to ' + scaledData.length + ' bytes for network processing', false, detailedLogCallback);
                processWithParams(processedImageData, params);
              }).catch(err => {
                logProcessingStep('ERROR', 'Failed to downscale image: ' + err.message, true, detailedLogCallback);
                processWithParams(processedImageData, params);
              });
            } else {
              processWithParams(processedImageData, params);
            }
          } else {
            processWithParams(processedImageData, params);
          }
        }, isNetwork ? 300 : 100);
      };
      
      const beginProcessing = () => {
        if (isNetwork) {
          logProcessingStep('NETWORK_SCALE', 'Downscaling image for network processing', false, detailedLogCallback);
          downscaleImage(processedImageData, 0.5).then((scaledData) => {
            processedImageData = scaledData;
            logProcessingStep('NETWORK_SCALED', `Downscaled image to ${scaledData.length} bytes for network processing`, false, detailedLogCallback);
            processNextStep();
          }).catch(err => {
            logProcessingStep('ERROR', `Failed to downscale image: ${err.message}`, true, detailedLogCallback);
            processNextStep();
          });
        } else {
          setTimeout(processNextStep, 100);
        }
      };

      // Ensure image doesn't exceed max dimension before further processing
      scaleToMaxDimension(imageData, 1000).then((scaledData) => {
        processedImageData = scaledData;
        beginProcessing();
      }).catch(err => {
        logProcessingStep('ERROR', `Failed to scale image: ${err.message}`, true, detailedLogCallback);
        beginProcessing();
      });

      // Handle complex images with different strategy - we'll reuse this function
      const processWithParams = async (imgData: string, processingParams: TracingParams) => {
        progressCallback('tracing');
        logProcessingStep('TRACE', 'Starting image tracing with data length: ' + imgData.length, false, detailedLogCallback);
        
        // Add a timeout to give the UI time to update before intensive processing
        setTimeout(() => {
          try {
            // Set a longer timeout for the tracing operation
            let traceTimeout = setTimeout(() => {
              logProcessingStep('ERROR', 'Image tracing is taking too long, possibly stuck', true, detailedLogCallback);
              progressCallback('error');
              reject(new Error('Image tracing timed out. The image may be too complex. Try using Complex Image Mode or simplifying the image.'));
            }, isNetwork ? 90000 : 180000); // Shorter timeout for network clients

            // Choose between regular trace and posterize based on colorMode setting
            if (processingParams.colorMode) {
              logProcessingStep('MODE', 'Using color mode (posterize) with Web Worker', false, detailedLogCallback);
              progressCallback('colorProcessing');
              
              const workerHandle = posterize(
                imgData, 
                processingParams,
                (err: Error | null, svg?: string) => {
                  clearTimeout(traceTimeout); // Clear the timeout if processing completes
                  if (err) {
                    logProcessingStep('ERROR', 'Error during color processing: ' + err.message, true, detailedLogCallback);
                    progressCallback('error');
                    reject(new Error('Failed to process color image: ' + err.message));
                    return;
                  }
                  
                  if (!svg) {
                    logProcessingStep('ERROR', 'Potrace returned empty SVG from color processing', true, detailedLogCallback);
                    progressCallback('error');
                    reject(new Error('Potrace returned empty SVG from color processing'));
                    return;
                  }
                  
                  progressCallback('optimizing');
                  logProcessingStep('OPTIMIZE', 'Color SVG generated, size: ' + svg.length + ' characters', false, detailedLogCallback);
                  
                  // Add a short delay before showing the result for better UX
                  setTimeout(() => {
                    progressCallback('done');
                    logProcessingStep('DONE', 'Color image processing complete', false, detailedLogCallback);
                    resolve(svg);
                  }, 300);
                },
                detailedLogCallback
              );
              
              // Update the timeout handler to terminate the worker if needed
              const originalTraceTimeout = traceTimeout;
              clearTimeout(originalTraceTimeout);
              
              traceTimeout = setTimeout(() => {
                logProcessingStep('ERROR', 'Image tracing is taking too long, possibly stuck', true, detailedLogCallback);
                
                // Terminate the worker if it exists
                if (workerHandle && typeof workerHandle.terminate === 'function') {
                  logProcessingStep('WORKER_TERMINATE', 'Terminating stuck worker', true, detailedLogCallback);
                  try {
                    workerHandle.terminate();
                  } catch (e) {
                    logProcessingStep('WORKER_ERROR', 'Error terminating worker: ' + e, true, detailedLogCallback);
                  }
                }
                
                progressCallback('error');
                reject(new Error('Image tracing timed out. The image may be too complex. Try using Complex Image Mode or simplifying the image.'));
              }, isNetwork ? 90000 : 180000); // Shorter timeout for network clients
              
              // If process is aborted, we can use this to clean up
              const originalReject = reject;
              reject = (error) => {
                clearTimeout(traceTimeout);
                if (workerHandle && typeof workerHandle.terminate === 'function') {
                  logProcessingStep('WORKER_CLEANUP', 'Cleaning up worker on error', false, detailedLogCallback);
                  try {
                    workerHandle.terminate();
                  } catch (e) {
                    logProcessingStep('WORKER_ERROR', 'Error terminating worker during cleanup: ' + e, false, detailedLogCallback);
                  }
                }
                originalReject(error);
              };
            } else {
              // Regular grayscale trace
              trace(imgData, processingParams, (err: Error | null, svg?: string) => {
                clearTimeout(traceTimeout); // Clear the timeout if tracing completes
                if (err) {
                  logProcessingStep('ERROR', 'Error during tracing: ' + err.message, true, detailedLogCallback);
                  progressCallback('error');
                  reject(new Error('Failed to trace image: ' + err.message));
                  return;
                }
                
                if (!svg) {
                  logProcessingStep('ERROR', 'Potrace returned empty SVG', true, detailedLogCallback);
                  progressCallback('error');
                  reject(new Error('Potrace returned empty SVG'));
                  return;
                }
                
                progressCallback('optimizing');
                logProcessingStep('OPTIMIZE', 'SVG generated, size: ' + svg.length + ' characters', false, detailedLogCallback);
                
                // Add a short delay before showing the result for better UX
                setTimeout(() => {
                  progressCallback('done');
                  logProcessingStep('DONE', 'Image processing complete', false, detailedLogCallback);
                  resolve(svg);
                }, 300);
              }, detailedLogCallback); // Pass the detailed log callback to the trace function
            }
          } catch (error) {
            logProcessingStep('ERROR', 'Exception during tracing: ' + error, true, detailedLogCallback);
            progressCallback('error');
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        }, isNetwork ? 500 : 100); // More delay for network clients
      };
    } catch (error) {
      logProcessingStep('ERROR', 'Exception during processing setup: ' + error, true, detailedLogCallback);
      progressCallback('error');
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
};

export const getOptimizedFilename = (originalName: string): string => {
  // Remove file extension
  const nameWithoutExtension = originalName.replace(/\.[^/.]+$/, "");

  // Use slugify to handle international characters and spacing
  const slug = slugify(nameWithoutExtension, { lower: true, strict: true });

  return slug || 'image';
};

// Even more aggressive parameters for network clients
export const simplifyForNetworkClients = (params: TracingParams): TracingParams => {
  const networkParams = { ...params };
  
  // Start with complex image optimizations
  const complexParams = simplifyForComplexImages(networkParams);

  // Then apply even more aggressive settings
  // Increase threshold while capping at an upper bound to maintain contrast
  complexParams.threshold = Math.min(255, complexParams.threshold + 30);
  complexParams.turdSize = Math.max(15, complexParams.turdSize * 2);  // More aggressive noise filtering
  complexParams.alphaMax = Math.min(0.5, complexParams.alphaMax - 0.1);
  complexParams.optCurve = false; // Disable curve optimization to speed up processing
  complexParams.optTolerance = 1.0; // Maximum tolerance for faster processing
  
  // Add a console log for debugging
  console.log('Network optimized params:', complexParams);
  
  return complexParams;
}; 