/// <reference lib="webworker" />

import { traceBlackAndWhite } from "../core/bwTrace";
import { traceCenterlines } from "../core/centerline";
import {
  assembleColorDocument,
  colorSeeds,
  quantizeColor,
  type PaletteColor,
} from "../core/colorTrace";
import { countSubpaths, serializeVectorDocument } from "../core/serialize";
import type {
  AssembleColorWorkerRequest,
  VectorDocument,
  VectorWorkerRequest,
  VectorWorkerResponse,
} from "../core/vectorDocument";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
const cancelled = new Set<string>();

const post = (message: VectorWorkerResponse): void =>
  workerScope.postMessage(message);

const complete = async (
  request: VectorWorkerRequest | AssembleColorWorkerRequest,
  document: VectorDocument,
  started: number,
  quantizeMs = 0,
): Promise<void> => {
  const serializationStart = performance.now();
  const vectorizeMs = serializationStart - started;
  const rawSvg = serializeVectorDocument(document);
  const serializeMs = performance.now() - serializationStart;
  let svg = rawSvg;
  let optimizeMs = 0;
  if (request.optimizeSvg) {
    post({
      type: "progress",
      version: 1,
      jobId: request.jobId,
      progress: {
        phase: "optimize",
        percent: 90,
        message: "Optimizing SVG output",
      },
    });
    const optimizeStart = performance.now();
    try {
      const { optimize } = await import("svgo");
      if (cancelled.delete(request.jobId)) return;
      svg = optimize(rawSvg, {
        plugins: [
          {
            name: "preset-default",
            params: {
              overrides: {
                cleanupIds: false,
                // Independent relative rounding can split a shared color edge.
                ...(request.options.mode === "color"
                  ? { convertPathData: false }
                  : {}),
              },
            },
          },
        ],
      }).data;
    } catch {
      // Serialization already produced a usable SVG.
    }
    optimizeMs = performance.now() - optimizeStart;
  }
  const outputPaths = countSubpaths(document);
  const diagnostics = document.diagnostics ?? {
    outputPaths,
    pathBudgetExceeded: false,
    warnings: [],
  };
  if (cancelled.delete(request.jobId)) return;
  post({
    type: "complete",
    version: 1,
    jobId: request.jobId,
    document: request.includeDocument ? document : undefined,
    svg,
    outputPaths,
    vectorizeMs,
    quantizeMs,
    serializeMs,
    optimizeMs,
    diagnostics,
  });
};

workerScope.onmessage = async (
  event: MessageEvent<
    | VectorWorkerRequest
    | AssembleColorWorkerRequest
    | { type: "cancel"; version: 1; jobId: string }
  >,
) => {
  const request = event.data;
  if (request.type === "cancel") {
    cancelled.add(request.jobId);
    return;
  }

  const started = performance.now();
  try {
    if (request.type === "assemble-color") {
      post({
        type: "progress",
        version: 1,
        jobId: request.jobId,
        progress: {
          phase: "trace",
          percent: 65,
          message: "Assembling color regions",
        },
      });
      const labels = new Uint8Array(request.labels);
      await complete(
        request,
        assembleColorDocument(
          labels,
          request.palette as PaletteColor[],
          request.width,
          request.height,
          request.options,
        ),
        started,
      );
      return;
    }

    post({
      type: "progress",
      version: 1,
      jobId: request.jobId,
      progress: {
        phase: request.options.mode === "color" ? "quantize" : "trace",
        percent: 35,
        message: "Vectorizing image",
      },
    });
    const pixels = new Uint8ClampedArray(request.pixels);
    if (request.options.mode === "color") {
      const quantizeStart = performance.now();
      const { labels, palette } = quantizeColor(
        pixels,
        colorSeeds(pixels, request.options),
      );
      const traceStart = performance.now();
      await complete(
        request,
        assembleColorDocument(
          labels,
          palette,
          request.width,
          request.height,
          request.options,
        ),
        traceStart,
        traceStart - quantizeStart,
      );
      return;
    }
    const document =
      request.options.mode === "centerline"
        ? traceCenterlines(
            pixels,
            request.width,
            request.height,
            request.options,
          )
        : traceBlackAndWhite(
            pixels,
            request.width,
            request.height,
            request.options,
          );
    await complete(request, document, started);
  } catch (error) {
    if (cancelled.delete(request.jobId)) return;
    post({
      type: "error",
      version: 1,
      jobId: request.jobId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
