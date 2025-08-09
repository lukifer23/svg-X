/**
 * Last checked: 2025-03-02
 */

// Last updated: 2025-03-11 - Force update to repository

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

// Add a heartbeat mechanism to monitor long-running operations
const createHeartbeat = (
  operation: string, 
  intervalMs: number, 
  logCallback?: (step: string, message: string, isError: boolean, timestamp: string) => void
) => {
  const heartbeatId = setInterval(() => {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[${timestamp}] [HEARTBEAT] ${operation} still running...`);
    if (logCallback) {
      logCallback('HEARTBEAT', `${operation} still running...`, false, timestamp);
    }
  }, intervalMs);
  
  return {
    stop: () => clearInterval(heartbeatId),
    heartbeatId
  };
};

// Utility function to handle the TypeScript type issue with Potrace
const trace = (
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
      logCallback('IMAGE_RECEIPT', `Image received: ${imageSize} bytes, type: ${imageType}`, false, new Date().toISOString().split('T')[1].split('.')[0]);
    }
    
    // Check if this is a network client to add additional logging and handling
    const isNetwork = isNetworkClient();
    if (isNetwork && logCallback) {
      logCallback('NETWORK_TRACE', 'Processing trace over network - this might take longer', false, new Date().toISOString().split('T')[1].split('.')[0]);
    }
    
    // Log memory usage before tracing
    if (typeof window !== 'undefined' && (window as any).performance && (window as any).performance.memory) {
      const memUsage = (window as any).performance.memory;
      if (logCallback) {
        logCallback('MEMORY', `Before tracing: ${Math.round(memUsage.usedJSHeapSize / 1048576)}MB / ${Math.round(memUsage.jsHeapSizeLimit / 1048576)}MB`, false, new Date().toISOString().split('T')[1].split('.')[0]);
      }
    }
    
    // Start heartbeat to monitor tracing
    // Use more frequent heartbeats for network clients to ensure UI responsiveness
    const heartbeatInterval = isNetwork ? 1000 : 2000;
    const heartbeat = createHeartbeat('Potrace image tracing', heartbeatInterval, logCallback);
    
    // Track start time
    const startTime = performance.now();
    if (logCallback) {
      logCallback('TRACE_START', `Starting Potrace at ${startTime}ms`, false, new Date().toISOString().split('T')[1].split('.')[0]);
    }
    
    // Use the Potrace.trace function directly instead of creating a Potrace instance
    // This is the correct way to use Potrace with a data URL
    if (logCallback) {
      logCallback('TRACE_METHOD', 'Using Potrace.trace with data URL', false, new Date().toISOString().split('T')[1].split('.')[0]);
    }
    
    // Call the trace function from the Potrace library directly
    // Wrap in a setTimeout to ensure the UI can update before intensive processing starts
    setTimeout(() => {
      try {
        (Potrace as any).trace(image, options, (err: Error | null, svg?: string) => {
          if (err) {
            heartbeat.stop();
            if (logCallback) {
              logCallback('TRACE_ERROR', `Error during Potrace tracing: ${err.message}`, true, new Date().toISOString().split('T')[1].split('.')[0]);
            }
            callback(err);
            return;
          }
          
          // Tracing completed
          const endTime = performance.now();
          heartbeat.stop();
          
          if (logCallback) {
            logCallback('TRACE_COMPLETE', `Completed in ${Math.round(endTime - startTime)}ms`, false, new Date().toISOString().split('T')[1].split('.')[0]);
            
            // Log memory usage after tracing
            if (typeof window !== 'undefined' && (window as any).performance && (window as any).performance.memory) {
              const memUsage = (window as any).performance.memory;
              logCallback('MEMORY', `After tracing: ${Math.round(memUsage.usedJSHeapSize / 1048576)}MB / ${Math.round(memUsage.jsHeapSizeLimit / 1048576)}MB`, false, new Date().toISOString().split('T')[1].split('.')[0]);
            }
          }
          
          callback(null, svg);
        });
      } catch (error) {
        heartbeat.stop();
        if (logCallback) {
          logCallback('TRACE_SETUP_ERROR', `Exception during Potrace execution: ${error}`, true, new Date().toISOString().split('T')[1].split('.')[0]);
        }
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    }, isNetwork ? 300 : 0); // Add a small delay for network clients to ensure UI responsiveness
  } catch (error) {
    if (logCallback) {
      logCallback('TRACE_SETUP_ERROR', `Failed to initialize tracing: ${error}`, true, new Date().toISOString().split('T')[1].split('.')[0]);
    }
    callback(error instanceof Error ? error : new Error(String(error)));
  }
};

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

export const calculateGrayscale = (r: number, g: number, b: number): number => {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
};

// Convert image to grayscale using luminance formula
const convertToGrayscale = (imageData: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          const gray = calculateGrayscale(data[i], data[i + 1], data[i + 2]);
          data[i] = data[i + 1] = data[i + 2] = gray;
        }
        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => {
        reject(new Error('Failed to load image for grayscale conversion'));
      };
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
  detailedLogCallback?: (step: string, message: string, isError: boolean, timestamp: string) => void
): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      logProcessingStep('START', `Beginning image processing with data length: ${imageData.length}`, false, detailedLogCallback);
      progressCallback('loading');

      // Check if this is a network client
      const isNetwork = isNetworkClient();
      
      // For network clients, apply more aggressive downscaling
      let processedImageData = imageData;
      
      const processNextStep = () => {
        progressCallback('processing');
        logProcessingStep('PROCESS', 'Processing image data', false, detailedLogCallback);

        setTimeout(() => {
          const analyzeAndProcess = () => {
            progressCallback('analyzing');

            // Analyze image complexity
            const complexityResult = analyzeImageComplexity(processedImageData);
            logProcessingStep('ANALYZE', `Complexity analysis result: ${JSON.stringify(complexityResult)}`, false, detailedLogCallback);

            if (isNetwork) {
              logProcessingStep('NETWORK', 'Processing as network client - applying enhanced optimizations', false, detailedLogCallback);

              // If we're on a network client AND the image is complex,
              // downscale it even more for better performance
              if (complexityResult.complex && processedImageData === imageData) {
                logProcessingStep('NETWORK_SCALE', 'Further downscaling image for network processing', false, detailedLogCallback);

                // Apply more aggressive downscaling for network clients with complex images
                downscaleImage(processedImageData, 0.3).then((scaledData) => {
                  processedImageData = scaledData;
                  logProcessingStep('NETWORK_SCALED', `Downscaled image to ${scaledData.length} bytes for network processing`, false, detailedLogCallback);
                  processWithParams(processedImageData, params);
                }).catch(err => {
                  logProcessingStep('ERROR', `Failed to downscale image: ${err.message}`, true, detailedLogCallback);
                  processWithParams(processedImageData, params);
                });
              } else {
                processWithParams(processedImageData, params);
              }
            } else {
              processWithParams(processedImageData, params);
            }
          };

          convertToGrayscale(processedImageData).then((grayData) => {
            processedImageData = grayData;
            analyzeAndProcess();
          }).catch(err => {
            logProcessingStep('ERROR', `Failed to convert image to grayscale: ${err}`, true, detailedLogCallback);
            analyzeAndProcess();
          });
        }, isNetwork ? 300 : 100);
      };
      
      // If network client, downscale image first
      if (isNetwork) {
        logProcessingStep('NETWORK_SCALE', 'Downscaling image for network processing', false, detailedLogCallback);
        downscaleImage(imageData, 0.5).then((scaledData) => {
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

      // Handle complex images with different strategy - we'll reuse this function
      const processWithParams = async (imgData: string, processingParams: TracingParams) => {
        progressCallback('tracing');
        logProcessingStep('TRACE', `Starting image tracing with data length: ${imgData.length}`, false, detailedLogCallback);
        
        // Add a timeout to give the UI time to update before intensive processing
        setTimeout(() => {
          try {
            // Set a longer timeout for the tracing operation
            const traceTimeout = setTimeout(() => {
              logProcessingStep('ERROR', 'Image tracing is taking too long, possibly stuck', true, detailedLogCallback);
              progressCallback('error');
              reject(new Error('Image tracing timed out. The image may be too complex. Try using Complex Image Mode or simplifying the image.'));
            }, isNetwork ? 90000 : 180000); // Shorter timeout for network clients

            trace(imgData, processingParams, (err: Error | null, svg?: string) => {
              clearTimeout(traceTimeout); // Clear the timeout if tracing completes
              if (err) {
                logProcessingStep('ERROR', `Error during tracing: ${err.message}`, true, detailedLogCallback);
                progressCallback('error');
                reject(new Error(`Failed to trace image: ${err.message}`));
                return;
              }
              
              if (!svg) {
                logProcessingStep('ERROR', 'Potrace returned empty SVG', true, detailedLogCallback);
                progressCallback('error');
                reject(new Error('Potrace returned empty SVG'));
                return;
              }
              
              progressCallback('optimizing');
              logProcessingStep('OPTIMIZE', `SVG generated, size: ${svg.length} characters`, false, detailedLogCallback);
              
              // Add a short delay before showing the result for better UX
              setTimeout(() => {
                progressCallback('done');
                logProcessingStep('DONE', 'Image processing complete', false, detailedLogCallback);
                resolve(svg);
              }, 300);
            }, detailedLogCallback); // Pass the detailed log callback to the trace function
          } catch (error) {
            logProcessingStep('ERROR', `Exception during tracing: ${error}`, true, detailedLogCallback);
            progressCallback('error');
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        }, isNetwork ? 500 : 100); // More delay for network clients
      };
    } catch (error) {
      logProcessingStep('ERROR', `Exception during processing setup: ${error}`, true, detailedLogCallback);
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