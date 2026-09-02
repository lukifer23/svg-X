import type {
  ConversionProgress,
  VectorDocument,
  VectorWorkerRequest,
  VectorWorkerResponse,
  WorkerConversionOptions,
} from "./vectorDocument";

interface WorkItem {
  jobId: string;
  width: number;
  height: number;
  pixels: ArrayBuffer;
  options: WorkerConversionOptions;
  priority: "interactive" | "batch";
  signal?: AbortSignal;
  onProgress?: (progress: ConversionProgress) => void;
  resolve: (result: { document: VectorDocument; vectorizeMs: number }) => void;
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
    if (message.type === "complete")
      item.resolve({
        document: message.document,
        vectorizeMs: message.vectorizeMs,
      });
    else item.reject(new Error(message.error));
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
    args: Omit<WorkItem, "resolve" | "reject">,
  ): Promise<{ document: VectorDocument; vectorizeMs: number }> {
    return new Promise((resolve, reject) => {
      const item: WorkItem = { ...args, resolve, reject };
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
      const request: VectorWorkerRequest = {
        type: "convert",
        version: 1,
        jobId: item.jobId,
        width: item.width,
        height: item.height,
        pixels: item.pixels,
        options: item.options,
      };
      slot.worker.postMessage(request, [item.pixels]);
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
