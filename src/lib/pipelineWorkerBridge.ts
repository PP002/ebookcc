/**
 * Bridge client for pipeline Web Worker.
 * Detects OffscreenCanvas + Worker + createImageBitmap support.
 * Manages request-response lifecycle with timeouts and automatic fallback to main-thread execution.
 */

export interface PreprocessedYoloData {
  rgbData: Float32Array;
  origWidth: number;
  origHeight: number;
  scale: number;
  padX: number;
  padY: number;
}

export interface PreprocessedDetData {
  float32Data: Float32Array;
  detW: number;
  detH: number;
  origW: number;
  origH: number;
}

export interface DetectedBoxItem {
  box: [number, number, number, number];
  angle: number;
  score: number;
}

export interface PreprocessedRecItem {
  float32Data: Float32Array;
  targetW: number;
  targetH: number;
  box: [number, number, number, number];
}

let workerInstance: Worker | null = null;
let workerInitializationFailed = false;
const pendingCallbacks = new Map<
  string,
  { resolve: (data: any) => void; reject: (err: any) => void; timer: any }
>();

/**
 * Feature detection check for Worker + OffscreenCanvas + createImageBitmap
 */
export function isWorkerPipelineSupported(): boolean {
  if (workerInitializationFailed) return false;
  return (
    typeof window !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap !== "undefined"
  );
}

function getWorker(): Worker | null {
  if (!isWorkerPipelineSupported()) return null;
  if (workerInstance) return workerInstance;

  try {
    workerInstance = new Worker(
      new URL("./pipelineWorker.ts", import.meta.url),
      { type: "module" }
    );

    workerInstance.onmessage = (e: MessageEvent) => {
      const { type, id, error, ...payload } = e.data || {};
      const pending = pendingCallbacks.get(id);
      if (!pending) return;

      clearTimeout(pending.timer);
      pendingCallbacks.delete(id);

      if (type === "ERROR") {
        pending.reject(new Error(error || "Worker processing error"));
      } else {
        pending.resolve(payload);
      }
    };

    workerInstance.onerror = (err) => {
      console.warn("[Pipeline Worker] Worker runtime error, disabling worker pipeline:", err);
      workerInitializationFailed = true;
      // Reject any pending requests
      for (const [id, cb] of pendingCallbacks.entries()) {
        clearTimeout(cb.timer);
        cb.reject(new Error("Worker terminated with error"));
      }
      pendingCallbacks.clear();
      workerInstance?.terminate();
      workerInstance = null;
    };

    return workerInstance;
  } catch (err) {
    console.warn("[Pipeline Worker] Could not spawn pipeline worker, using main-thread fallback:", err);
    workerInitializationFailed = true;
    return null;
  }
}

function postToWorker<T>(message: any, transfer: Transferable[] = [], timeoutMs = 20000): Promise<T> {
  const worker = getWorker();
  if (!worker) {
    return Promise.reject(new Error("Worker pipeline not available"));
  }

  const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  message.id = id;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCallbacks.delete(id);
      reject(new Error(`Worker request timeout (${timeoutMs}ms)`));
    }, timeoutMs);

    pendingCallbacks.set(id, { resolve, reject, timer });
    try {
      worker.postMessage(message, transfer);
    } catch (postErr) {
      clearTimeout(timer);
      pendingCallbacks.delete(id);
      reject(postErr);
    }
  });
}

/**
 * Offloads YOLO 640x640 letterbox resizing & normalization to the Web Worker.
 */
export async function workerPreprocessYolo(
  source: CanvasImageSource | Blob | ImageData,
  targetSize = 640
): Promise<PreprocessedYoloData> {
  const bitmap = await createImageBitmap(source as any);
  const resp = await postToWorker<any>(
    {
      type: "YOLO_PREPROCESS",
      bitmap,
      targetSize
    },
    [bitmap]
  );

  return {
    rgbData: resp.rgbData,
    origWidth: resp.origWidth,
    origHeight: resp.origHeight,
    scale: resp.scale,
    padX: resp.padX,
    padY: resp.padY
  };
}

/**
 * Offloads OCR detection image resizing & normalization to the Web Worker.
 */
export async function workerPreprocessOcrDet(
  source: CanvasImageSource | Blob | ImageData,
  longSide = 1536
): Promise<PreprocessedDetData> {
  const bitmap = await createImageBitmap(source as any);
  const resp = await postToWorker<any>(
    {
      type: "OCR_DET_PREPROCESS",
      bitmap,
      longSide
    },
    [bitmap]
  );

  return {
    float32Data: resp.float32Data,
    detW: resp.detW,
    detH: resp.detH,
    origW: resp.origW,
    origH: resp.origH
  };
}

/**
 * Offloads OCR connected-components & unclip postprocessing to Web Worker.
 */
export async function workerPostprocessOcrDet(
  probMap: Float32Array,
  detW: number,
  detH: number,
  origW: number,
  origH: number,
  thresh = 0.2
): Promise<DetectedBoxItem[]> {
  const resp = await postToWorker<any>({
    type: "OCR_DET_POSTPROCESS",
    probMap,
    detW,
    detH,
    origW,
    origH,
    thresh
  });
  return resp.boxes;
}

/**
 * Offloads cropping and normalization of all detected text boxes to the Web Worker.
 */
export async function workerPreprocessRecBatch(
  source: CanvasImageSource | Blob | ImageData,
  boxes: { box: [number, number, number, number]; angle: number }[]
): Promise<PreprocessedRecItem[]> {
  const bitmap = await createImageBitmap(source as any);
  const resp = await postToWorker<any>(
    {
      type: "OCR_REC_PREPROCESS_BATCH",
      bitmap,
      boxes
    },
    [bitmap]
  );
  return resp.results;
}

/**
 * Offloads CTC greedy decoding to Web Worker.
 */
export async function workerDecodeCtc(
  data: Float32Array,
  dims: number[],
  table: string[],
  charMask?: Float32Array
): Promise<{ text: string; conf: number }> {
  const resp = await postToWorker<any>({
    type: "OCR_CTC_DECODE",
    data,
    dims,
    table,
    charMask
  });
  return { text: resp.text, conf: resp.conf };
}
