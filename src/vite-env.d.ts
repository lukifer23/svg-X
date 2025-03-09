/**
 * Last checked: 2025-03-02
 */

/// <reference types="vite/client" />

declare module 'potrace' {
  export class Potrace {
    constructor();
    setParameters(options: {
      turdSize?: number;
      alphaMax?: number;
      optCurve?: boolean;
    }): void;
    loadImage(data: {
      data: Uint8Array;
      width: number;
      height: number;
    }, callback: (err: Error | null) => void): void;
    process(callback: (err: Error | null) => void): void;
    getSVG(): string;
  }
}

declare module 'potrace' {
  interface PotraceOptions {
    turdSize?: number;
    alphaMax?: number;
    optCurve?: boolean;
  }

  interface ImageData {
    data: Buffer | Uint8Array;
    width: number;
    height: number;
  }

  class Potrace {
    constructor();
    setParameters(options: PotraceOptions): void;
    loadImage(data: ImageData, callback: (err: Error | null) => void): void;
    process(callback: (err: Error | null) => void): void;
    getSVG(): string;
  }

  export default Potrace;
}

declare global {
  interface Buffer extends Uint8Array {
    from(array: Uint8Array): Buffer;
  }
  var Buffer: {
    from(array: Uint8Array): Buffer;
  };
}
