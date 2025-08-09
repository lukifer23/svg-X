/// <reference lib="webworker" />

import * as Potrace from 'potrace';
import type { TracingParams } from '../utils/imageProcessor';

// Handle messages from main thread
self.onmessage = async (event: MessageEvent) => {
  const { imageData, params } = event.data as { imageData: string; params: TracingParams };
  try {
    // Notify that tracing is starting
    (self as unknown as Worker).postMessage({ type: 'progress', status: 'tracing' });

    const potrace = Potrace as unknown as {
      trace: (
        img: string,
        opts: TracingParams,
        cb: (err: Error | null, svg?: string) => void
      ) => void;
    };

    const svg = await new Promise<string>((resolve, reject) => {
      potrace.trace(imageData, params, (err: Error | null, result?: string) => {
        if (err || !result) {
          reject(err || new Error('Potrace returned empty SVG'));
          return;
        }
        resolve(result);
      });
    });

    // Notify that optimization step is running (for UI progress)
    (self as unknown as Worker).postMessage({ type: 'progress', status: 'optimizing' });

    // Send final result
    (self as unknown as Worker).postMessage({ type: 'result', svg });
  } catch (error) {
  (self as unknown as Worker).postMessage({
    type: 'error',
    error: error instanceof Error ? error.message : String(error)
  });
  }
};

export default null as unknown as void;
