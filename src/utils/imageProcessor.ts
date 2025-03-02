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
  tracing: 'Tracing image contours...',
  done: 'Done!',
  error: 'An error occurred'
};

// Utility function to handle the TypeScript type issue with Potrace
const trace = (
  image: string,
  options: any,
  callback: (err: Error | null, svg?: string) => void
) => {
  (Potrace as any).trace(image, options, callback);
};

export const processImage = (
  imageData: string,
  params: TracingParams,
  progressCallback: (status: string) => void
): Promise<string> => {
  return new Promise((resolve, reject) => {
    progressCallback('loading');

    // Add timeout to simulate processing so progress indicators can be seen
    setTimeout(() => {
      progressCallback('processing');
      
      setTimeout(() => {
        progressCallback('tracing');
        
        try {
          // Use the wrapper function to handle TypeScript issues
          trace(imageData, params, (err: Error | null, svg?: string) => {
            if (err) {
              progressCallback('error');
              reject(err);
              return;
            }
            
            if (!svg) {
              progressCallback('error');
              reject(new Error('Potrace returned empty SVG'));
              return;
            }
            
            progressCallback('done');
            resolve(svg);
          });
        } catch (error) {
          progressCallback('error');
          reject(error);
        }
      }, 300);
    }, 300);
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