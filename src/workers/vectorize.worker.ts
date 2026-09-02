/// <reference lib="webworker" />

import { traceBlackAndWhite } from "../core/bwTrace";
import { traceCenterlines } from "../core/centerline";
import { traceColorDocument } from "../core/colorTrace";
import { countSubpaths, serializeVectorDocument } from "../core/serialize";
import type {
  VectorWorkerRequest,
  VectorWorkerResponse,
} from "../core/vectorDocument";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
const cancelled = new Set<string>();

const post = (message: VectorWorkerResponse): void =>
  workerScope.postMessage(message);

workerScope.onmessage = (
  event: MessageEvent<
    VectorWorkerRequest | { type: "cancel"; version: 1; jobId: string }
  >,
) => {
  const request = event.data;
  if (request.type === "cancel") {
    cancelled.add(request.jobId);
    return;
  }

  const started = performance.now();
  try {
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
    const vectorizeMs = performance.now() - started;
    const rawSvg = serializeVectorDocument(document);
    const outputPaths = countSubpaths(document);
    if (cancelled.delete(request.jobId)) return;
    post({
      type: "complete",
      version: 1,
      jobId: request.jobId,
      document,
      rawSvg,
      outputPaths,
      vectorizeMs,
    });
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
