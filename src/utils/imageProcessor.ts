import slugify from "slugify";
import { optimize as svgoOptimize } from "svgo";
import { getVectorWorkerPool } from "../core/workerPool";
import type {
  ConversionResult,
  WorkerConversionOptions,
} from "../core/vectorDocument";

export type TurnPolicy =
  "black" | "white" | "left" | "right" | "minority" | "majority";
export type FillStrategy = "dominant" | "mean" | "median" | "spread";

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
  strokeMode: boolean;
  strokeWidth: number;
  maxPaths: number;
  svgoOptimize: boolean;
}

export const DEFAULT_PARAMS: TracingParams = {
  turdSize: 2,
  turnPolicy: "minority",
  alphaMax: 1,
  optCurve: true,
  optTolerance: 0.2,
  threshold: 128,
  blackOnWhite: true,
  color: "#000000",
  background: "transparent",
  invert: false,
  highestQuality: false,
  colorMode: false,
  colorSteps: 4,
  fillStrategy: "dominant",
  strokeMode: false,
  strokeWidth: 2,
  maxPaths: 2000,
  svgoOptimize: true,
};

export const PROGRESS_STEPS: Record<string, string> = {
  idle: "",
  loading: "Loading image...",
  analyzing: "Decoding image...",
  tracing: "Tracing image contours...",
  colorProcessing: "Quantizing and tracing color regions...",
  optimizing: "Optimizing SVG output...",
  done: "Done!",
  error: "An error occurred",
};

type LogCallback = (
  step: string,
  message: string,
  isError: boolean,
  timestamp: string,
) => void;
type ProgressCallback = (status: string) => void;

export interface RawImageInput {
  pixels: ArrayBuffer;
  width: number;
  height: number;
}

export const formatTimestamp = (): string =>
  new Date().toISOString().split("T")[1].split(".")[0];

export const isNetworkClient = (): boolean => {
  if (typeof window === "undefined") return false;
  return !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
};

const now = (): number =>
  typeof performance === "undefined" ? Date.now() : performance.now();
const log = (
  step: string,
  message: string,
  callback?: LogCallback,
  isError = false,
): void => {
  callback?.(step, message, isError, formatTimestamp());
};

const decodeImage = async (
  input: string | RawImageInput,
  maxDimension: number,
  signal?: AbortSignal,
): Promise<{ pixels: Uint8ClampedArray; width: number; height: number }> => {
  if (signal?.aborted)
    throw new DOMException("Conversion cancelled", "AbortError");
  if (typeof input !== "string") {
    const width = Math.floor(input.width);
    const height = Math.floor(input.height);
    if (
      width < 1 ||
      height < 1 ||
      width > 8192 ||
      height > 8192 ||
      input.pixels.byteLength !== width * height * 4
    ) {
      throw new Error("Desktop decoder returned invalid RGBA dimensions");
    }
    return {
      pixels: new Uint8ClampedArray(input.pixels),
      width,
      height,
    };
  }
  const response = await fetch(input, { signal });
  if (!response.ok)
    throw new Error(`Unable to read image (${response.status})`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const scale = Math.min(
      1,
      maxDimension / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas =
      typeof OffscreenCanvas === "undefined"
        ? Object.assign(document.createElement("canvas"), { width, height })
        : new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context)
      throw new Error("This browser cannot create a 2D image surface");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return {
      pixels: context.getImageData(0, 0, width, height).data,
      width,
      height,
    };
  } finally {
    bitmap.close();
  }
};

const toWorkerOptions = (params: TracingParams): WorkerConversionOptions => ({
  mode: params.strokeMode ? "centerline" : params.colorMode ? "color" : "bw",
  threshold: Math.max(0, Math.min(255, params.threshold)),
  turdSize: Math.max(0, params.turdSize),
  turnPolicy: params.turnPolicy,
  alphaMax: params.alphaMax,
  optCurve: params.optCurve,
  optTolerance: Math.max(0, params.optTolerance),
  blackOnWhite: params.blackOnWhite,
  invert: params.invert,
  foregroundColor: params.color,
  backgroundColor: params.background,
  colorSteps: Math.max(2, Math.min(64, params.colorSteps)),
  fillStrategy: params.fillStrategy,
  strokeWidth: Math.max(0.1, params.strokeWidth),
  maxPaths: Math.max(1, params.maxPaths),
});

const optimizeSvg = (svg: string): string => {
  try {
    return svgoOptimize(svg, {
      plugins: [
        {
          name: "preset-default",
          params: { overrides: { cleanupIds: false } },
        },
      ],
    }).data;
  } catch {
    return svg;
  }
};

let sequence = 0;
const nextJobId = (): string => `conversion-${Date.now()}-${++sequence}`;

export const processImageDetailed = async (
  imageData: string | RawImageInput,
  params: TracingParams,
  progressCallback: ProgressCallback,
  detailedLogCallback?: LogCallback,
  signal?: AbortSignal,
  priority: "interactive" | "batch" = "interactive",
): Promise<ConversionResult> => {
  const totalStart = now();
  progressCallback("loading");
  log("START", "Decoding source image", detailedLogCallback);
  const decodeStart = now();
  const decoded = await decodeImage(
    imageData,
    params.highestQuality ? 2000 : 1000,
    signal,
  );
  const decodeMs = now() - decodeStart;
  log("METRIC", `decode=${Math.round(decodeMs)}ms`, detailedLogCallback);
  const options = toWorkerOptions(params);
  progressCallback(options.mode === "color" ? "colorProcessing" : "tracing");
  const pixelBuffer =
    decoded.pixels.byteOffset === 0 &&
    decoded.pixels.byteLength === decoded.pixels.buffer.byteLength
      ? (decoded.pixels.buffer as ArrayBuffer)
      : new Uint8ClampedArray(decoded.pixels).buffer;
  const result = await getVectorWorkerPool().run({
    jobId: nextJobId(),
    width: decoded.width,
    height: decoded.height,
    pixels: pixelBuffer,
    options,
    priority,
    signal,
    onProgress: (progress) =>
      log(
        "PROGRESS",
        `${progress.percent}% ${progress.message}`,
        detailedLogCallback,
      ),
  });
  progressCallback("optimizing");
  const optimizeStart = now();
  const svg = params.svgoOptimize ? optimizeSvg(result.rawSvg) : result.rawSvg;
  const optimizeMs = now() - optimizeStart;
  const totalMs = now() - totalStart;
  progressCallback("done");
  log(
    "METRIC",
    `vectorize=${Math.round(result.vectorizeMs)}ms`,
    detailedLogCallback,
  );
  log("METRIC", `optimize=${Math.round(optimizeMs)}ms`, detailedLogCallback);
  log("DONE", `Completed in ${Math.round(totalMs)}ms`, detailedLogCallback);
  return {
    document: result.document,
    svg,
    metrics: {
      decodeMs,
      vectorizeMs: result.vectorizeMs,
      optimizeMs,
      totalMs,
      inputPixels: decoded.width * decoded.height,
      outputPaths: result.outputPaths,
    },
  };
};

export const processImage = async (
  imageData: string,
  params: TracingParams,
  progressCallback: ProgressCallback,
  detailedLogCallback?: LogCallback,
  signal?: AbortSignal,
): Promise<string> =>
  (
    await processImageDetailed(
      imageData,
      params,
      progressCallback,
      detailedLogCallback,
      signal,
    )
  ).svg;

export const getOptimizedFilename = (originalName: string): string => {
  const base = originalName.replace(/\.[^/.]+$/, "");
  return slugify(base, { lower: true, strict: true }) || "image";
};

export const simplifyForComplexImages = (
  params: TracingParams,
): TracingParams => ({
  ...params,
  turdSize: Math.max(params.turdSize, 8),
  optTolerance: Math.max(params.optTolerance, 1.2),
  highestQuality: false,
});

// Transport location must never change conversion output.
export const simplifyForNetworkClients = (
  params: TracingParams,
): TracingParams => ({ ...params });
