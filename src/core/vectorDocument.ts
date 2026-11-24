export type ConversionMode = "bw" | "color" | "centerline";
export type ExportFormat = "svg" | "eps" | "dxf" | "json";

export type VectorCommand =
  | { type: "M"; x: number; y: number }
  | { type: "L"; x: number; y: number }
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

export interface ConversionDiagnostics {
  requestedMaxPaths?: number;
  outputPaths: number;
  pathBudgetExceeded: boolean;
  initialColorComponents?: number;
  mergedColorComponents?: number;
  mergedComponents?: number;
  warnings: string[];
}

export interface VectorDocument {
  version: 1;
  width: number;
  height: number;
  mode: ConversionMode;
  shapes: VectorShape[];
  diagnostics?: ConversionDiagnostics;
}

export interface ConversionMetrics {
  decodeMs: number;
  quantizeMs: number;
  vectorizeMs: number;
  serializeMs: number;
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
  diagnostics: ConversionDiagnostics;
}

export interface WorkerConversionOptions {
  normalizeScanLighting?: boolean;
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
  optimizeSvg: boolean;
  outputFormat: ExportFormat;
};

/** Palette entry as it crosses the worker boundary (structurally PaletteColor). */
export interface WorkerPaletteColor {
  l: number;
  a: number;
  b: number;
  r: number;
  g: number;
  blue: number;
  count: number;
}

/**
 * Runs the post-quantization color stages (merging, boundaries, geometry,
 * serialization) from labels + palette produced elsewhere, e.g. by the parallel
 * quantizer.
 */
export type AssembleColorWorkerRequest = {
  type: "assemble-color";
  version: 1;
  jobId: string;
  width: number;
  height: number;
  labels: ArrayBuffer;
  palette: WorkerPaletteColor[];
  options: WorkerConversionOptions;
  includeDocument: boolean;
  optimizeSvg: boolean;
  outputFormat: ExportFormat;
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
      document?: VectorDocument | string;
      content: string;
      publishedAt: number;
      outputPaths: number;
      vectorizeMs: number;
      quantizeMs: number;
      serializeMs: number;
      optimizeMs: number;
      diagnostics: ConversionDiagnostics;
    }
  | { type: "error"; version: 1; jobId: string; error: string };
export const MAX_PALETTE_COLORS = 16;
