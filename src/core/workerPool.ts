import type {
  AssembleColorWorkerRequest,
  ConversionDiagnostics,
  ConversionProgress,
  VectorDocument,
  VectorWorkerRequest,
  VectorWorkerResponse,
  WorkerConversionOptions,
  WorkerPaletteColor,
} from "./vectorDocument";

export interface ConvertPayload {
  kind: "convert";
  width: number;
  height: number;
  pixels: ArrayBuffer;
  options: WorkerConversionOptions;
  includeDocument: boolean;
  optimizeSvg: boolean;
}

export interface AssembleColorPayload {
  kind: "assemble-color";
  width: number;
  height: number;
  labels: Uint8Array;
  palette: WorkerPaletteColor[];
  options: WorkerConversionOptions;
  includeDocument: boolean;
  optimizeSvg: boolean;
}

export type WorkPayload = ConvertPayload | AssembleColorPayload;

export interface WorkResult {
  document?: VectorDocument;
  svg: string;
  outputPaths: number;
  vectorizeMs: number;
  quantizeMs: number;
  serializeMs: number;
  optimizeMs: number;
  deliveryMs: number;
  diagnostics: ConversionDiagnostics;
}

interface WorkItem {
  jobId: string;
  payload: WorkPayload;
  priority: "interactive" | "batch";
  signal?: AbortSignal;
  onProgress?: (progress: ConversionProgress) => void;
  resolve: (result: WorkResult) => void;
  reject: (error: Error) => void;
}

interface WorkerSlot {
  worker: Worker;
  item: WorkItem | null;
}

const abortError = (): DOMException =>
  new DOMException("Conversion cancelled", "AbortError");

export class VectorWorkerPool {
  private readonly slots: WorkerSlot[] = [];
  private readonly interactiveQueue: WorkItem[] = [];
  private readonly batchQueue: WorkItem[] = [];

  constructor(
    size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)),
  ) {
    for (let index = 0; index < size; index += 1)
      this.slots.push(this.createSlot());
  }

  private createSlot(): WorkerSlot {
    const slot: WorkerSlot = {
      worker: new Worker(
        new URL("../workers/vectorize.worker.ts", import.meta.url),
        { type: "module" },
      ),
      item: null,
    };
    slot.worker.onmessage = (event: MessageEvent<VectorWorkerResponse>) =>
      this.handleMessage(slot, event.data);
    slot.worker.onerror = (event) =>
      this.failSlot(slot, new Error(event.message || "Vector worker failed"));
    return slot;
  }

  private handleMessage(slot: WorkerSlot, message: VectorWorkerResponse): void {
    const item = slot.item;
    if (!item || item.jobId !== message.jobId) return;
    if (message.type === "progress") {
      item.onProgress?.({ jobId: item.jobId, ...message.progress });
      return;
    }
    this.detachAbort(item);
    slot.item = null;
    if (message.type === "complete") {
      try {
        const document =
          typeof message.document === "string"
            ? (JSON.parse(message.document) as VectorDocument)
            : message.document;
        item.resolve({
          document,
          svg: message.svg,
          outputPaths: message.outputPaths,
          vectorizeMs: message.vectorizeMs,
          quantizeMs: message.quantizeMs,
          serializeMs: message.serializeMs,
          optimizeMs: message.optimizeMs,
          deliveryMs: Math.max(
            0,
            performance.timeOrigin + performance.now() - message.publishedAt,
          ),
          diagnostics: message.diagnostics,
        });
      } catch {
        item.reject(new Error("Vector worker returned unreadable geometry"));
      }
    } else item.reject(new Error(message.error));
    this.dispatch();
  }

  private failSlot(slot: WorkerSlot, error: Error): void {
    const index = this.slots.indexOf(slot);
    if (slot.item) {
      this.detachAbort(slot.item);
      slot.item.reject(error);
    }
    slot.worker.terminate();
    this.slots[index] = this.createSlot();
    this.dispatch();
  }

  private detachAbort(item: WorkItem): void {
    item.signal?.removeEventListener(
      "abort",
      this.abortHandlers.get(item.jobId) ?? (() => undefined),
    );
    this.abortHandlers.delete(item.jobId);
  }

  private readonly abortHandlers = new Map<string, () => void>();

  private cancel(item: WorkItem): void {
    const queue =
      item.priority === "interactive" ? this.interactiveQueue : this.batchQueue;
    const queuedIndex = queue.indexOf(item);
    if (queuedIndex >= 0) {
      queue.splice(queuedIndex, 1);
      this.detachAbort(item);
      item.reject(abortError());
      return;
    }
    const slot = this.slots.find((candidate) => candidate.item === item);
    if (!slot) return;
    const slotIndex = this.slots.indexOf(slot);
    slot.worker.postMessage({ type: "cancel", version: 1, jobId: item.jobId });
    slot.worker.terminate();
    slot.item = null;
    this.detachAbort(item);
    item.reject(abortError());
    this.slots[slotIndex] = this.createSlot();
    this.dispatch();
  }

  run(
    payload: WorkPayload,
    meta: {
      jobId: string;
      priority: "interactive" | "batch";
      signal?: AbortSignal;
      onProgress?: (progress: ConversionProgress) => void;
    },
  ): Promise<WorkResult> {
    return new Promise((resolve, reject) => {
      const item: WorkItem = {
        jobId: meta.jobId,
        payload,
        priority: meta.priority,
        signal: meta.signal,
        onProgress: meta.onProgress,
        resolve,
        reject,
      };
      if (item.signal?.aborted) {
        reject(abortError());
        return;
      }
      const abortHandler = () => this.cancel(item);
      this.abortHandlers.set(item.jobId, abortHandler);
      item.signal?.addEventListener("abort", abortHandler, { once: true });
      (item.priority === "interactive"
        ? this.interactiveQueue
        : this.batchQueue
      ).push(item);
      this.dispatch();
    });
  }

  private dispatch(): void {
    for (const slot of this.slots) {
      if (slot.item) continue;
      const item = this.interactiveQueue.shift() ?? this.batchQueue.shift();
      if (!item) break;
      slot.item = item;
      const { payload } = item;
      if (payload.kind === "convert") {
        const request: VectorWorkerRequest = {
          type: "convert",
          version: 1,
          jobId: item.jobId,
          width: payload.width,
          height: payload.height,
          pixels: payload.pixels,
          options: payload.options,
          includeDocument: payload.includeDocument,
          optimizeSvg: payload.optimizeSvg,
        };
        slot.worker.postMessage(request, [payload.pixels]);
      } else {
        const request: AssembleColorWorkerRequest = {
          type: "assemble-color",
          version: 1,
          jobId: item.jobId,
          width: payload.width,
          height: payload.height,
          labels: payload.labels.buffer as ArrayBuffer,
          palette: payload.palette,
          options: payload.options,
          includeDocument: payload.includeDocument,
          optimizeSvg: payload.optimizeSvg,
        };
        slot.worker.postMessage(request, [
          payload.labels.buffer as ArrayBuffer,
        ]);
      }
    }
  }

  dispose(): void {
    for (const slot of this.slots) slot.worker.terminate();
    const pending = [...this.interactiveQueue, ...this.batchQueue];
    this.interactiveQueue.length = 0;
    this.batchQueue.length = 0;
    for (const item of pending) item.reject(abortError());
  }
}

let sharedPool: VectorWorkerPool | null = null;
export const getVectorWorkerPool = (): VectorWorkerPool => {
  sharedPool ??= new VectorWorkerPool();
  return sharedPool;
};
