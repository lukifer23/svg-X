/// <reference lib="webworker" />

import { traceBlackAndWhite } from "../core/bwTrace";
import { traceCenterlines } from "../core/centerline";
import {
  assembleColorDocument,
  traceColorDocument,
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

const complete = (
  request: VectorWorkerRequest | AssembleColorWorkerRequest,
  document: VectorDocument,
  started: number,
): void => {
  const vectorizeMs = performance.now() - started;
  const rawSvg = serializeVectorDocument(document);
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
    rawSvg,
    outputPaths,
    vectorizeMs,
    diagnostics,
  });
};

workerScope.onmessage = (
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
      complete(
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
    const document =
      request.options.mode === "color"
        ? traceColorDocument(
            pixels,
            request.width,
            request.height,
            request.options,
          )
        : request.options.mode === "centerline"
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
    complete(request, document, started);
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
