import type { BandQuantizer } from "./bandQuantize";
import type { ColorQuantization, PaletteColor } from "./colorTrace";
import type { WorkerConversionOptions } from "./vectorDocument";

interface Pending {
  resolve: (message: QuantizeResponse) => void;
  reject: (error: Error) => void;
  detachAbort: () => void;
}

interface Slot {
  worker: Worker;
  busy: boolean;
  pending: Pending | null;
}

interface Waiter {
  count: number;
  resolve: (slots: Slot[]) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  detachAbort: () => void;
}

interface QuantizeResponse {
  type: "ready" | "sums" | "labels" | "quantized" | "error";
  id: number;
  sums?: Float64Array;
  labels?: Uint8Array;
  palette?: PaletteColor[];
  error?: string;
}

export interface PooledBand {
  quantizer: BandQuantizer;
  release: () => void;
}

/**
 * Persistent pool of band workers. Each conversion acquires one band per
 * worker, drives the refinement rounds, and releases the slots. Failures
 * recycle the worker so the next acquisition starts clean.
 */
export class QuantizeWorkerPool {
  private readonly slots: Slot[] = [];
  private readonly waiters: Waiter[] = [];
  private sequence = 0;
  private disposed = false;

  constructor(size: number) {
    for (let index = 0; index < size; index += 1)
      this.slots.push(this.createSlot());
  }

  private createSlot(): Slot {
    const worker = new Worker(
      new URL("../workers/quantize.worker.ts", import.meta.url),
      { type: "module" },
    );
    const slot: Slot = { worker, busy: false, pending: null };
    worker.onmessage = (event: MessageEvent<QuantizeResponse>) => {
      const pending = slot.pending;
      slot.pending = null;
      if (!pending) return;
      pending.detachAbort();
      if (event.data.type === "error") {
        pending.reject(new Error(event.data.error || "Quantize worker failed"));
        this.recycle(slot);
      } else pending.resolve(event.data);
    };
    worker.onerror = (event) => {
      const pending = slot.pending;
      slot.pending = null;
      pending?.detachAbort();
      pending?.reject(new Error(event.message || "Quantize worker failed"));
      this.recycle(slot);
    };
    return slot;
  }

  private request(
    slot: Slot,
    message: unknown,
    transfer?: Transferable[],
    signal?: AbortSignal,
  ): Promise<QuantizeResponse> {
    return new Promise((resolve, reject) => {
      if (this.disposed) {
        reject(new Error("Quantize worker pool is disposed"));
        return;
      }
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = () => {
        const pending = slot.pending;
        if (!pending) return;
        slot.pending = null;
        pending.detachAbort();
        pending.reject(abortError());
        this.recycle(slot);
      };
      const detachAbort = () => signal?.removeEventListener("abort", onAbort);
      slot.pending = { resolve, reject, detachAbort };
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        slot.worker.postMessage(message, transfer ?? []);
      } catch (error) {
        slot.pending = null;
        detachAbort();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private acquire(count: number, signal?: AbortSignal): Promise<Slot[]> {
    return new Promise((resolve, reject) => {
      if (!Number.isInteger(count) || count < 1 || count > this.slots.length) {
        reject(new Error(`Invalid quantize worker reservation: ${count}`));
        return;
      }
      if (this.disposed) {
        reject(new Error("Quantize worker pool is disposed"));
        return;
      }
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const available = this.slots
        .filter((candidate) => !candidate.busy)
        .slice(0, count);
      if (available.length === count) {
        for (const slot of available) slot.busy = true;
        resolve(available);
        return;
      }
      const waiter: Waiter = {
        count,
        resolve,
        reject,
        signal,
        detachAbort: () => undefined,
      };
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        waiter.detachAbort();
        reject(abortError());
      };
      waiter.detachAbort = () => signal?.removeEventListener("abort", onAbort);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private release(slot: Slot): void {
    const index = this.slots.indexOf(slot);
    if (index < 0 || this.disposed) return;
    slot.busy = false;
    this.dispatchWaiters();
  }

  private dispatchWaiters(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters[0];
      if (waiter.signal?.aborted) {
        this.waiters.shift();
        waiter.detachAbort();
        waiter.reject(abortError());
        continue;
      }
      const available = this.slots
        .filter((candidate) => !candidate.busy)
        .slice(0, waiter.count);
      if (available.length < waiter.count) return;
      this.waiters.shift();
      waiter.detachAbort();
      for (const slot of available) slot.busy = true;
      waiter.resolve(available);
    }
  }

  private recycle(slot: Slot, reason?: Error): void {
    const pending = slot.pending;
    slot.pending = null;
    if (pending) {
      pending.detachAbort();
      pending.reject(reason ?? new Error("Quantize worker was recycled"));
    }
    slot.worker.terminate();
    const index = this.slots.indexOf(slot);
    if (index >= 0 && !this.disposed) {
      const replacement = this.createSlot();
      this.slots[index] = replacement;
      this.dispatchWaiters();
    }
  }

  private async initializeBand(
    slot: Slot,
    pixels: Uint8ClampedArray,
    signal?: AbortSignal,
  ): Promise<PooledBand> {
    const copy = new Uint8Array(pixels);
    const id = ++this.sequence;
    try {
      await this.request(
        slot,
        { type: "init", id, pixels: copy.buffer },
        [copy.buffer],
        signal,
      );
    } catch (error) {
      if (this.slots.includes(slot))
        this.recycle(
          slot,
          error instanceof Error ? error : new Error(String(error)),
        );
      throw error;
    }
    const quantizer: BandQuantizer = {
      round: (palette: PaletteColor[]) =>
        this.request(
          slot,
          { type: "round", id, palette },
          undefined,
          signal,
        ).then((message) => message.sums as Float64Array),
      finish: (palette: PaletteColor[]) =>
        this.request(
          slot,
          { type: "finish", id, palette },
          undefined,
          signal,
        ).then((message) => message.labels as Uint8Array),
    };
    return { quantizer, release: () => this.release(slot) };
  }

  async createBand(
    pixels: Uint8ClampedArray,
    signal?: AbortSignal,
  ): Promise<PooledBand> {
    const [slot] = await this.acquire(1, signal);
    return this.initializeBand(slot, pixels, signal);
  }

  async quantizeImage(
    pixels: Uint8ClampedArray,
    options: WorkerConversionOptions,
    signal?: AbortSignal,
  ): Promise<ColorQuantization> {
    const [slot] = await this.acquire(1, signal);
    try {
      // Retain the caller's buffer for the single-vector-worker fallback.
      const input = new Uint8Array(pixels).buffer;
      const result = await this.request(
        slot,
        { type: "quantize", id: ++this.sequence, pixels: input, options },
        [input],
        signal,
      );
      if (result.type !== "quantized" || !result.labels || !result.palette)
        throw new Error("Quantize worker did not return image labels");
      return { labels: result.labels, palette: result.palette };
    } finally {
      this.release(slot);
    }
  }

  /**
   * Reserves every band for one conversion atomically. Without this, several
   * concurrent conversions can each hold one slot while waiting forever for a
   * second slot.
   */
  async createBands(
    pixels: Uint8ClampedArray[],
    signal?: AbortSignal,
  ): Promise<PooledBand[]> {
    const slots = await this.acquire(pixels.length, signal);
    try {
      return await Promise.all(
        slots.map((slot, index) =>
          this.initializeBand(slot, pixels[index], signal),
        ),
      );
    } catch (error) {
      for (const slot of slots)
        if (this.slots.includes(slot))
          this.recycle(
            slot,
            error instanceof Error ? error : new Error(String(error)),
          );
      throw error;
    }
  }

  dispose(): void {
    this.disposed = true;
    const error = new Error("Quantize worker pool is disposed");
    for (const waiter of this.waiters.splice(0)) {
      waiter.detachAbort();
      waiter.reject(error);
    }
    for (const slot of this.slots) {
      const pending = slot.pending;
      slot.pending = null;
      pending?.detachAbort();
      pending?.reject(error);
      slot.worker.terminate();
    }
  }
}

const abortError = (): DOMException =>
  new DOMException("Conversion cancelled", "AbortError");

let sharedPool: QuantizeWorkerPool | null = null;
export const getQuantizeWorkerPool = (): QuantizeWorkerPool => {
  sharedPool ??= new QuantizeWorkerPool(
    Math.max(1, Math.min(4, navigator.hardwareConcurrency || 4)),
  );
  return sharedPool;
};
