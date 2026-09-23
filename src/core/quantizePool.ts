import type { BandQuantizer } from "./bandQuantize";
import type { PaletteColor } from "./colorTrace";

interface Pending {
  resolve: (message: QuantizeResponse) => void;
  reject: (error: Error) => void;
}

interface Slot {
  worker: Worker;
  busy: boolean;
  pending: Pending | null;
}

interface QuantizeResponse {
  type: "ready" | "sums" | "labels" | "error";
  id: number;
  sums?: Float64Array;
  labels?: Uint8Array;
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
      if (event.data.type === "error") {
        pending.reject(new Error(event.data.error || "Quantize worker failed"));
        this.recycle(slot);
      } else pending.resolve(event.data);
    };
    worker.onerror = (event) => {
      const pending = slot.pending;
      slot.pending = null;
      pending?.reject(new Error(event.message || "Quantize worker failed"));
      this.recycle(slot);
    };
    return slot;
  }

  private request(
    slot: Slot,
    message: unknown,
    transfer?: Transferable[],
  ): Promise<QuantizeResponse> {
    return new Promise((resolve, reject) => {
      slot.pending = { resolve, reject };
      try {
        slot.worker.postMessage(message, transfer ?? []);
      } catch (error) {
        slot.pending = null;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private acquire(): Promise<Slot> {
    return new Promise((resolve) => {
      const attempt = () => {
        if (this.disposed) return;
        const slot = this.slots.find((candidate) => !candidate.busy);
        if (slot) {
          slot.busy = true;
          resolve(slot);
          return;
        }
        setTimeout(attempt, 4);
      };
      attempt();
    });
  }

  private recycle(slot: Slot): void {
    slot.worker.terminate();
    const index = this.slots.indexOf(slot);
    if (index >= 0 && !this.disposed) this.slots[index] = this.createSlot();
  }

  async createBand(pixels: Uint8ClampedArray): Promise<PooledBand> {
    const slot = await this.acquire();
    const copy = new Uint8Array(pixels);
    const id = ++this.sequence;
    try {
      await this.request(slot, { type: "init", id, pixels: copy.buffer }, [
        copy.buffer,
      ]);
    } catch (error) {
      slot.busy = false;
      this.recycle(slot);
      throw error;
    }
    const quantizer: BandQuantizer = {
      round: (palette: PaletteColor[]) =>
        this.request(slot, { type: "round", id, palette }).then(
          (message) => message.sums as Float64Array,
        ),
      finish: (palette: PaletteColor[]) =>
        this.request(slot, { type: "finish", id, palette }).then(
          (message) => message.labels as Uint8Array,
        ),
    };
    return { quantizer, release: () => (slot.busy = false) };
  }

  dispose(): void {
    this.disposed = true;
    for (const slot of this.slots) slot.worker.terminate();
  }
}

let sharedPool: QuantizeWorkerPool | null = null;
export const getQuantizeWorkerPool = (): QuantizeWorkerPool => {
  sharedPool ??= new QuantizeWorkerPool(
    Math.max(1, Math.min(16, (navigator.hardwareConcurrency || 4) - 1)),
  );
  return sharedPool;
};
