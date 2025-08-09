/**
 * Last checked: 2025-03-02
 */

// Last updated: 2025-03-11 - Force update to repository

export type TurnPolicy = 'black' | 'white' | 'left' | 'right' | 'minority' | 'majority';

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
  highestQuality: false
};

export const PROGRESS_STEPS = {
  idle: '',
  loading: 'Loading image...',
  processing: 'Processing image data...',
  analyzing: 'Analyzing image complexity...',
  tracing: 'Tracing image contours...',
  optimizing: 'Optimizing SVG output...',
  done: 'Done!',
  error: 'An error occurred'
};

// Enhanced logging with optional callback for UI display
const logProcessingStep = (step: string, message: string, isError = false, logCallback?: (step: string, message: string, isError: boolean, timestamp: string) => void) => {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0]; // HH:MM:SS format
  console.log(`[${timestamp}] [${step}] ${message}`);
  if (isError) {
    console.error(`[${timestamp}] [${step}] ${message}`);
  }
  // If callback is provided, send the log info to it for UI display
  if (logCallback) {
    logCallback(step, message, isError, timestamp);
  }
};

// Previously we maintained a heartbeat and tracing helper for Potrace.
// With the introduction of a dedicated worker, the tracing logic has been
// moved out of the main thread and simplified to reduce UI blocking.

// Check if image might be too complex
const analyzeImageComplexity = (imageData: string): { complex: boolean, reason?: string, size?: number } => {
  // This is a simple heuristic - we could develop more sophisticated analysis
  // based on image data size, number of distinct colors, etc.
  const complexity = imageData.length;
  
  logProcessingStep('ANALYZE', `Image data length: ${complexity}`);
  
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

// Downscale image to reduce complexity
const downscaleImage = (imageData: string, scale: number = 0.5): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      logProcessingStep('DOWNSCALE', `Downscaling image by factor of ${scale}`);
      
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
        
        logProcessingStep('DOWNSCALE', `Original size: ${originalWidth}x${originalHeight}, New size: ${newWidth}x${newHeight}`);
        
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
        logProcessingStep('DOWNSCALE', `Downscaled image data length: ${downscaledData.length}`);
        
        resolve(downscaledData);
      };
      
      img.onerror = () => {
        reject(new Error('Failed to load image for downscaling'));
      };
      
      img.src = imageData;
    } catch (error) {
      logProcessingStep('DOWNSCALE', `Error during downscaling: ${error}`, true);
      reject(error);
    }
  });
};

// Run Potrace tracing inside a dedicated worker
const runTraceWorker = (
  imgData: string,
  processingParams: TracingParams,
  progressCallback: (status: string) => void,
  logCallback?: (step: string, message: string, isError: boolean, timestamp: string) => void
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/traceWorker.ts', import.meta.url), { type: 'module' });

    worker.onmessage = (event: MessageEvent) => {
      const { type, status, svg, error } = event.data as { type: string; status?: string; svg?: string; error?: string };
      if (type === 'progress' && status) {
        progressCallback(status);
        logProcessingStep('WORKER', `Progress: ${status}`, false, logCallback);
      } else if (type === 'result' && svg) {
        logProcessingStep('WORKER', 'Tracing complete', false, logCallback);
        resolve(svg);
        worker.terminate();
      } else if (type === 'error' && error) {
        logProcessingStep('WORKER', `Error: ${error}`, true, logCallback);
        reject(new Error(error));
        worker.terminate();
      }
    };

    worker.onerror = (err) => {
      logProcessingStep('WORKER', `Worker error: ${err.message}`, true, logCallback);
      worker.terminate();
      reject(err as Error);
    };

    worker.postMessage({ imageData: imgData, params: processingParams });
  });
};

export const processImage = async (
  imageData: string,
  params: TracingParams,
  progressCallback: (status: string) => void,
  detailedLogCallback?: (step: string, message: string, isError: boolean, timestamp: string) => void
): Promise<string> => {
  try {
    logProcessingStep('START', `Beginning image processing with data length: ${imageData.length}`, false, detailedLogCallback);
    progressCallback('loading');

    const isNetwork = isNetworkClient();
    let processedImageData = imageData;

    // Initial downscale for network clients
    if (isNetwork) {
      logProcessingStep('NETWORK_SCALE', 'Downscaling image for network processing', false, detailedLogCallback);
      try {
        processedImageData = await downscaleImage(imageData, 0.5);
        logProcessingStep('NETWORK_SCALED', `Downscaled image to ${processedImageData.length} bytes for network processing`, false, detailedLogCallback);
      } catch (err) {
        logProcessingStep('ERROR', `Failed to downscale image: ${err instanceof Error ? err.message : String(err)}`, true, detailedLogCallback);
      }
    }

    progressCallback('processing');
    logProcessingStep('PROCESS', 'Processing image data', false, detailedLogCallback);

    progressCallback('analyzing');
    const complexityResult = analyzeImageComplexity(processedImageData);
    logProcessingStep('ANALYZE', `Complexity analysis result: ${JSON.stringify(complexityResult)}`, false, detailedLogCallback);

    // Additional downscale for complex images on network clients
    if (isNetwork) {
      logProcessingStep('NETWORK', 'Processing as network client - applying enhanced optimizations', false, detailedLogCallback);
      if (complexityResult.complex && processedImageData === imageData) {
        logProcessingStep('NETWORK_SCALE', 'Further downscaling image for network processing', false, detailedLogCallback);
        try {
          processedImageData = await downscaleImage(processedImageData, 0.3);
          logProcessingStep('NETWORK_SCALED', `Downscaled image to ${processedImageData.length} bytes for network processing`, false, detailedLogCallback);
        } catch (err) {
          logProcessingStep('ERROR', `Failed to downscale image: ${err instanceof Error ? err.message : String(err)}`, true, detailedLogCallback);
        }
      }
    }

    logProcessingStep('TRACE', `Starting image tracing with data length: ${processedImageData.length}`, false, detailedLogCallback);
    const svg = await runTraceWorker(processedImageData, params, progressCallback, detailedLogCallback);

    progressCallback('done');
    logProcessingStep('DONE', 'Image processing complete', false, detailedLogCallback);
    return svg;
  } catch (error) {
    progressCallback('error');
    logProcessingStep('ERROR', `Exception during processing: ${error}`, true, detailedLogCallback);
    throw error instanceof Error ? error : new Error(String(error));
  }
};

export const getOptimizedFilename = (originalName: string): string => {
  // Remove file extension
  const nameWithoutExtension = originalName.replace(/\.[^/.]+$/, "");
  
  // Remove non-alphanumeric characters and replace spaces with hyphens
  const cleanedName = nameWithoutExtension
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
    
  return cleanedName || "image";
};

// Function to detect if app is being accessed over network
export const isNetworkClient = (): boolean => {
  const hostname = window.location.hostname;
  // If hostname is not localhost or 127.0.0.1, it's likely a network client
  return !(hostname === 'localhost' || hostname === '127.0.0.1');
};

// Even more aggressive parameters for network clients
export const simplifyForNetworkClients = (params: TracingParams): TracingParams => {
  const networkParams = { ...params };
  
  // Start with complex image optimizations
  const complexParams = simplifyForComplexImages(networkParams);
  
  // Then apply even more aggressive settings
  complexParams.threshold = Math.min(160, complexParams.threshold + 30);
  complexParams.turdSize = Math.max(15, complexParams.turdSize * 2);  // More aggressive noise filtering
  complexParams.alphaMax = Math.min(0.5, complexParams.alphaMax - 0.1);
  complexParams.optCurve = false; // Disable curve optimization to speed up processing
  complexParams.optTolerance = 1.0; // Maximum tolerance for faster processing
  
  // Add a console log for debugging
  console.log('Network optimized params:', complexParams);
  
  return complexParams;
}; 