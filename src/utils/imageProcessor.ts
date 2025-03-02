import * as Potrace from 'potrace';

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

// Enhanced logging function
const logProcessingStep = (step: string, message: string, isError = false) => {
  const timestamp = new Date().toISOString();
  const prefix = isError ? '❌ ERROR' : '✅ INFO';
  console.log(`[${timestamp}] ${prefix} [${step}]: ${message}`);
};

// Utility function to handle the TypeScript type issue with Potrace
const trace = (
  image: string,
  options: any,
  callback: (err: Error | null, svg?: string) => void
) => {
  try {
    logProcessingStep('TRACE', `Starting trace with options: ${JSON.stringify(options)}`);
    (Potrace as any).trace(image, options, callback);
  } catch (error) {
    logProcessingStep('TRACE', `Exception during trace: ${error}`, true);
    callback(error instanceof Error ? error : new Error(String(error)));
  }
};

// Check if image might be too complex
const analyzeImageComplexity = (imageData: string): { complex: boolean, reason?: string } => {
  // This is a simple heuristic - we could develop more sophisticated analysis
  // based on image data size, number of distinct colors, etc.
  const complexity = imageData.length;
  
  logProcessingStep('ANALYZE', `Image data length: ${complexity}`);
  
  if (complexity > 5000000) {
    return { complex: true, reason: 'Image data size is very large' };
  }
  
  // Additional complexity checks could be added here
  
  return { complex: false };
};

// Try to simplify complex images
export const simplifyForComplexImages = (params: TracingParams): TracingParams => {
  logProcessingStep('SIMPLIFY', 'Applying optimizations for complex image');
  
  return {
    ...params,
    // Increase turdSize to remove small artifacts
    turdSize: Math.max(params.turdSize, 5),
    // Use a more tolerant optimization
    optTolerance: Math.min(params.optTolerance * 1.5, 2.0),
    // Use turn policy that works better for complex shapes
    turnPolicy: 'minority',
    // Threshold in mid-range for better line detection
    threshold: 128,
    // Enhanced corner detection
    alphaMax: 1.0,
    // Turn off highest quality for better performance
    highestQuality: false
  };
};

export const processImage = (
  imageData: string,
  params: TracingParams,
  progressCallback: (status: string) => void
): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      logProcessingStep('START', `Beginning image processing with ${imageData.substring(0, 50)}...`);
      progressCallback('loading');

      setTimeout(() => {
        progressCallback('processing');
        logProcessingStep('PROCESS', 'Processing image data');
        
        setTimeout(() => {
          progressCallback('analyzing');
          
          // Analyze image complexity
          const complexityResult = analyzeImageComplexity(imageData);
          logProcessingStep('ANALYZE', `Complexity analysis result: ${JSON.stringify(complexityResult)}`);
          
          // Adjust parameters for complex images
          let processingParams = params;
          if (complexityResult.complex) {
            logProcessingStep('COMPLEX', `Image appears to be complex: ${complexityResult.reason}`);
            processingParams = simplifyForComplexImages(params);
          }
          
          progressCallback('tracing');
          logProcessingStep('TRACE', 'Starting image tracing');
          
          try {
            // Use the wrapper function to handle TypeScript issues
            trace(imageData, processingParams, (err: Error | null, svg?: string) => {
              if (err) {
                logProcessingStep('ERROR', `Error during tracing: ${err.message}`, true);
                progressCallback('error');
                reject(new Error(`Failed to trace image: ${err.message}`));
                return;
              }
              
              if (!svg) {
                logProcessingStep('ERROR', 'Potrace returned empty SVG', true);
                progressCallback('error');
                reject(new Error('Potrace returned empty SVG'));
                return;
              }
              
              progressCallback('optimizing');
              logProcessingStep('OPTIMIZE', `SVG generated, size: ${svg.length} characters`);
              
              // Add a short delay before showing the result for better UX
              setTimeout(() => {
                progressCallback('done');
                logProcessingStep('DONE', 'Image processing complete');
                resolve(svg);
              }, 300);
            });
          } catch (error) {
            logProcessingStep('ERROR', `Exception during tracing: ${error}`, true);
            progressCallback('error');
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        }, 300);
      }, 300);
    } catch (error) {
      logProcessingStep('ERROR', `Unexpected error in processImage: ${error}`, true);
      progressCallback('error');
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
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