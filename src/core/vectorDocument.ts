export type ConversionMode = "bw" | "color" | "centerline";

export type VectorCommand =
  | { type: "M" | "L"; x: number; y: number }
  | {
      type: "C";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      x: number;
      y: number;
    }
  | { type: "Z" };

export interface VectorSubpath {
  commands: VectorCommand[];
  closed: boolean;
}

export interface VectorShape {
  id: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  fillRule: "nonzero" | "evenodd";
  subpaths: VectorSubpath[];
}

export interface VectorDocument {
  version: 1;
  width: number;
  height: number;
  mode: ConversionMode;
  shapes: VectorShape[];
}

export interface ConversionMetrics {
  decodeMs: number;
  vectorizeMs: number;
  optimizeMs: number;
  totalMs: number;
  inputPixels: number;
  outputPaths: number;
}

export interface ConversionProgress {
  jobId: string;
  phase: "decode" | "quantize" | "trace" | "optimize" | "done";
  percent: number;
  message: string;
}

export interface ConversionResult {
  document: VectorDocument;
  svg: string;
  metrics: ConversionMetrics;
}

export interface WorkerConversionOptions {
  mode: ConversionMode;
  threshold: number;
  turdSize: number;
  turnPolicy: "black" | "white" | "left" | "right" | "minority" | "majority";
  alphaMax: number;
  optCurve: boolean;
  optTolerance: number;
  blackOnWhite: boolean;
  invert: boolean;
  foregroundColor: string;
  backgroundColor: string;
  colorSteps: number;
  fillStrategy: "dominant" | "mean" | "median" | "spread";
  strokeWidth: number;
  maxPaths: number;
}

export type VectorWorkerRequest = {
  type: "convert";
  version: 1;
  jobId: string;
  width: number;
  height: number;
  pixels: ArrayBuffer;
  options: WorkerConversionOptions;
  includeDocument: boolean;
};

export type VectorWorkerCancelRequest = {
  type: "cancel";
  version: 1;
  jobId: string;
};

export type VectorWorkerResponse =
  | {
      type: "progress";
      version: 1;
      jobId: string;
      progress: Omit<ConversionProgress, "jobId">;
    }
  | {
      type: "complete";
      version: 1;
      jobId: string;
      document?: VectorDocument;
      rawSvg: string;
      outputPaths: number;
      vectorizeMs: number;
    }
  | { type: "error"; version: 1; jobId: string; error: string };
