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
    
    // Log memory usage before tracing
    if (typeof window !== 'undefined' && (window as any).performance && (window as any).performance.memory) {
      const memUsage = (window as any).performance.memory;
      if (logCallback) {
        logCallback('MEMORY', `Before tracing: ${Math.round(memUsage.usedJSHeapSize / 1048576)}MB / ${Math.round(memUsage.jsHeapSizeLimit / 1048576)}MB`, false, new Date().toISOString().split('T')[1].split('.')[0]);
      }
    }
    
    // Start heartbeat to monitor tracing
    const heartbeat = createHeartbeat('Potrace image tracing', 2000, logCallback);
    
    // Track start time
    const startTime = performance.now();
    if (logCallback) {
      logCallback('TRACE_START', `Starting Potrace at ${startTime}ms`, false, new Date().toISOString().split('T')[1].split('.')[0]);
    }
    
    // Call Potrace with our options
    const traceInstance = new Potrace.Potrace();
    Object.keys(options).forEach(key => {
      (traceInstance as any)[key] = options[key];
    });
    
    // Use the proper API for Potrace
    // Note: For data URIs, we're using a workaround since the TypeScript types are incorrect
    (traceInstance as any).loadFromDataUrl(image, (err: Error | null) => {
      if (err) {
        heartbeat.stop();
        if (logCallback) {
          logCallback('LOAD_ERROR', `Failed to load image in Potrace: ${err.message}`, true, new Date().toISOString().split('T')[1].split('.')[0]);
        }
        callback(err);
        return;
      }
      
      if (logCallback) {
        logCallback('IMAGE_LOADED', 'Image successfully loaded into Potrace', false, new Date().toISOString().split('T')[1].split('.')[0]);
      }
      
      // Track when the actual tracing starts
      const traceStartTime = performance.now();
      if (logCallback) {
        logCallback('TRACING', `Beginning Potrace algorithm at ${traceStartTime}ms (${Math.round(traceStartTime - startTime)}ms since start)`, false, new Date().toISOString().split('T')[1].split('.')[0]);
      }
      
      // This is the blocking call where we lose visibility
      try {
        const svg = traceInstance.getSVG();
        
        // Tracing completed
        const endTime = performance.now();
        heartbeat.stop();
        
        if (logCallback) {
          logCallback('TRACE_COMPLETE', `Completed in ${Math.round(endTime - traceStartTime)}ms, total time: ${Math.round(endTime - startTime)}ms`, false, new Date().toISOString().split('T')[1].split('.')[0]);
          
          // Log memory usage after tracing
          if (typeof window !== 'undefined' && (window as any).performance && (window as any).performance.memory) {
            const memUsage = (window as any).performance.memory;
            logCallback('MEMORY', `After tracing: ${Math.round(memUsage.usedJSHeapSize / 1048576)}MB / ${Math.round(memUsage.jsHeapSizeLimit / 1048576)}MB`, false, new Date().toISOString().split('T')[1].split('.')[0]);
          }
        }
        
        callback(null, svg);
      } catch (error) {
        heartbeat.stop();
        if (logCallback) {
          logCallback('TRACE_ERROR', `Exception during Potrace algorithm: ${error}`, true, new Date().toISOString().split('T')[1].split('.')[0]);
        }
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    });
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

      // Longer timeout for network clients
      setTimeout(() => {
        progressCallback('processing');
        logProcessingStep('PROCESS', 'Processing image data', false, detailedLogCallback);
        
        // Longer timeout for network clients
        setTimeout(() => {
          progressCallback('analyzing');
          
          // Analyze image complexity
          const complexityResult = analyzeImageComplexity(imageData);
          logProcessingStep('ANALYZE', `Complexity analysis result: ${JSON.stringify(complexityResult)}`, false, detailedLogCallback);
          
          // Check if this is a network client
          const isNetwork = isNetworkClient();
          if (isNetwork) {
            logProcessingStep('NETWORK', 'Processing as network client - applying enhanced optimizations', false, detailedLogCallback);
          }
          
          // Handle complex images with different strategy
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
                }, 180000); // Increased from 60000 (1 minute) to 180000 (3 minutes)

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
            }, 500);
          };
          
          // Adjust parameters and potentially downscale for complex images
          if (complexityResult.complex) {
            logProcessingStep('COMPLEX', `Image appears to be complex: ${complexityResult.reason}`, false, detailedLogCallback);
            // Use even more aggressive settings for very complex images
            let enhancedParams = simplifyForComplexImages(params);
            
            // For network clients, use even more aggressive settings
            if (isNetwork) {
              enhancedParams = simplifyForNetworkClients(params);
              logProcessingStep('NETWORK', 'Applied network-specific optimizations to parameters', false, detailedLogCallback);
            }
            
            // If extremely complex, downscale the image first
            if (complexityResult.size && complexityResult.size > 4000000) {
              logProcessingStep('COMPLEX', 'Image is extremely large, downscaling before processing', false, detailedLogCallback);
              progressCallback('processing');
              
              // Downscale by different amounts based on complexity
              let scaleFactor = complexityResult.size > 8000000 ? 0.25 : 0.5;
              
              // For network clients, downscale even more aggressively
              if (isNetwork) {
                scaleFactor = complexityResult.size > 8000000 ? 0.15 : 0.25;
                logProcessingStep('NETWORK', `Using more aggressive downscaling for network client: ${scaleFactor}`, false, detailedLogCallback);
              }
              
              downscaleImage(imageData, scaleFactor)
                .then(downscaledData => {
                  logProcessingStep('DOWNSCALE', 'Successfully downscaled image', false, detailedLogCallback);
                  processWithParams(downscaledData, enhancedParams);
                })
                .catch(err => {
                  logProcessingStep('ERROR', `Failed to downscale image: ${err.message}`, true, detailedLogCallback);
                  // Fall back to original image with aggressive params
                  processWithParams(imageData, enhancedParams);
                });
            } else {
              // Moderately complex - use enhanced params without downscaling
              processWithParams(imageData, enhancedParams);
            }
          } else if (isNetwork) {
            // Even for simple images, apply some optimization for network clients
            let networkParams = params;
            
            // If it's not technically complex but being processed over network, 
            // apply moderate optimizations and light downscaling
            logProcessingStep('NETWORK', 'Simple image on network - applying moderate optimizations', false, detailedLogCallback);
            networkParams = { ...params, turdSize: params.turdSize + 2, optCurve: false };
            
            // Light downscaling for all network clients
            downscaleImage(imageData, 0.75)
              .then(downscaledData => {
                logProcessingStep('NETWORK', 'Applied light downscaling for network performance', false, detailedLogCallback);
                processWithParams(downscaledData, networkParams);
              })
              .catch(err => {
                // Fall back to original image with network params
                logProcessingStep('ERROR', `Failed to downscale simple image: ${err.message}`, true, detailedLogCallback);
                processWithParams(imageData, networkParams);
              });
          } else {
            // Normal processing for simple images
            processWithParams(imageData, params);
          }
          
        }, 500); // Increased from 300ms to 500ms
      }, 500); // Increased from 300ms to 500ms
    } catch (error) {
      logProcessingStep('ERROR', `Unexpected error in processImage: ${error}`, true, detailedLogCallback);
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
  complexParams.turdSize = Math.max(15, complexParams.turdSize * 2);
  complexParams.alphaMax = Math.min(0.5, complexParams.alphaMax - 0.1);
  complexParams.optCurve = false; // Disable curve optimization to speed up processing
  
  return complexParams;
}; 