/**
 * ONNX YOLO Comic Panel Detection Engine (dp.onnx)
 * High-performance on-device comic panel detection using ONNX Runtime Web.
 * Models are hosted on Cloudflare R2 at /Models/dp.onnx.
 * ONNX WASM runtime files are hosted on Cloudflare R2 at /wasm/onnx/.
 */

import * as ort from "onnxruntime-web/wasm";
import {
  BatchSize,
  getModelBytesFromCacheOrR2,
  detectDeviceCapability
} from "./yoloModelManager";

export interface PanelBox {
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] in 0..1000 scale
  score: number;
}

export interface YoloLayoutResult {
  panels: PanelBox[];
  texts: any[];
  batchSizeUsed: BatchSize;
  acceleratorUsed: "webgpu" | "wasm";
  inferenceTimeMs: number;
}

// Backward-compatibility alias
export type LiteRTLayoutResult = YoloLayoutResult;

export function initOnnxWasmEnv() {
  if (typeof window !== "undefined") {
    ort.env.wasm.wasmPaths = "/wasm/onnx/";
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
  }
}

if (typeof window !== "undefined") {
  initOnnxWasmEnv();
}

// ─────────────────────────────────────────────
// Cached ONNX Inference Session Singleton
// ─────────────────────────────────────────────

let yoloSession: ort.InferenceSession | null = null;
let sessionLoadingPromise: Promise<ort.InferenceSession> | null = null;

export async function getYoloSession(preferWebGpu: boolean = true): Promise<ort.InferenceSession> {
  if (yoloSession) return yoloSession;
  if (sessionLoadingPromise) return sessionLoadingPromise;

  sessionLoadingPromise = (async () => {
    initOnnxWasmEnv();
    console.log("[YOLO ONNX Engine] Loading dp.onnx from cache or R2...");
    const modelBytes = await getModelBytesFromCacheOrR2("dp.onnx");

    // Attempt 1: Load session with wasm
    try {
      const session = await ort.InferenceSession.create(modelBytes as any, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all"
      });
      console.log("[YOLO ONNX Engine] dp.onnx session initialized successfully!");
      yoloSession = session;
      return session;
    } catch (err: any) {
      console.warn("[YOLO ONNX Engine] Init attempt 1 failed, retrying with origin wasm path:", err);
      if (typeof window !== "undefined" && window.location) {
        ort.env.wasm.wasmPaths = `${window.location.origin}/wasm/onnx/`;
      }
      const session = await ort.InferenceSession.create(modelBytes as any, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all"
      });
      console.log("[YOLO ONNX Engine] dp.onnx session initialized successfully (attempt 2)!");
      yoloSession = session;
      return session;
    } finally {
      sessionLoadingPromise = null;
    }
  })();

  return sessionLoadingPromise;
}

// ─────────────────────────────────────────────
// Image Preprocessing & Helpers
// ─────────────────────────────────────────────

interface PreprocessedImage {
  canvas: HTMLCanvasElement;
  origWidth: number;
  origHeight: number;
  scale: number;
  padX: number;
  padY: number;
  rgbData: Float32Array; // 3 * 640 * 640 in NCHW [3, 640, 640]
}

async function loadImageElement(source: string | HTMLImageElement | HTMLCanvasElement | Blob | ImageData): Promise<HTMLImageElement | HTMLCanvasElement> {
  if (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) {
    return source;
  }
  if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
    if (source.complete && source.naturalWidth > 0) return source;
    await new Promise((resolve, reject) => {
      source.onload = () => resolve(source);
      source.onerror = reject;
    });
    return source;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Failed to load image element: ${e}`));

    if (typeof Blob !== "undefined" && source instanceof Blob) {
      img.src = URL.createObjectURL(source);
    } else if (typeof source === "string") {
      img.src = source;
    } else if (typeof ImageData !== "undefined" && source instanceof ImageData) {
      const c = document.createElement("canvas");
      c.width = source.width;
      c.height = source.height;
      const ctx = c.getContext("2d");
      if (ctx) ctx.putImageData(source, 0, 0);
      resolve(c);
      return;
    } else {
      reject(new Error("Unsupported image source type"));
    }
  });
}

function preprocessImageTo640(img: HTMLImageElement | HTMLCanvasElement): PreprocessedImage {
  const origWidth = ("naturalWidth" in img ? img.naturalWidth : img.width) || 640;
  const origHeight = ("naturalHeight" in img ? img.naturalHeight : img.height) || 640;

  const targetSize = 640;
  const scale = Math.min(targetSize / origWidth, targetSize / origHeight);
  const newW = Math.round(origWidth * scale);
  const newH = Math.round(origHeight * scale);
  const padX = Math.round((targetSize - newW) / 2);
  const padY = Math.round((targetSize - newH) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) {
    throw new Error("Could not get 2D canvas context for image preprocessing");
  }

  // Neutral background fill
  ctx.fillStyle = "#727272";
  ctx.fillRect(0, 0, targetSize, targetSize);
  ctx.drawImage(img, padX, padY, newW, newH);

  const imgData = ctx.getImageData(0, 0, targetSize, targetSize);
  const rgba = imgData.data;

  // Float32 array for NCHW format: [3, 640, 640]
  // Channel 0: R, Channel 1: G, Channel 2: B
  const rgbData = new Float32Array(3 * targetSize * targetSize);
  const channelSize = targetSize * targetSize;

  for (let i = 0; i < channelSize; i++) {
    const rgbaIdx = i * 4;
    rgbData[i] = rgba[rgbaIdx] / 255.0; // R
    rgbData[channelSize + i] = rgba[rgbaIdx + 1] / 255.0; // G
    rgbData[2 * channelSize + i] = rgba[rgbaIdx + 2] / 255.0; // B
  }

  return {
    canvas,
    origWidth,
    origHeight,
    scale,
    padX,
    padY,
    rgbData
  };
}

// ─────────────────────────────────────────────
// Post-Processing & Non-Maximum Suppression (NMS)
// ─────────────────────────────────────────────

interface RawBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
}

function calculateIoU(b1: RawBox, b2: RawBox): number {
  const x1 = Math.max(b1.x1, b2.x1);
  const y1 = Math.max(b1.y1, b2.y1);
  const x2 = Math.min(b1.x2, b2.x2);
  const y2 = Math.min(b1.y2, b2.y2);

  const interArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const area1 = (b1.x2 - b1.x1) * (b1.y2 - b1.y1);
  const area2 = (b2.x2 - b2.x1) * (b2.y2 - b2.y1);
  const unionArea = area1 + area2 - interArea;

  return unionArea > 0 ? interArea / unionArea : 0;
}

function postProcessOutput(
  outputSlice: Float32Array, // [5, 8400]
  prep: PreprocessedImage,
  confThreshold: number = 0.25,
  iouThreshold: number = 0.45,
  isChannelsFirst: boolean = true
): PanelBox[] {
  const numAnchors = 8400;
  const rawBoxes: RawBox[] = [];

  for (let a = 0; a < numAnchors; a++) {
    const score = isChannelsFirst
      ? outputSlice[4 * numAnchors + a]
      : outputSlice[a * 5 + 4];

    if (score < confThreshold || isNaN(score)) continue;

    let cx = isChannelsFirst
      ? outputSlice[0 * numAnchors + a]
      : outputSlice[a * 5 + 0];
    let cy = isChannelsFirst
      ? outputSlice[1 * numAnchors + a]
      : outputSlice[a * 5 + 1];
    let w = isChannelsFirst
      ? outputSlice[2 * numAnchors + a]
      : outputSlice[a * 5 + 2];
    let h = isChannelsFirst
      ? outputSlice[3 * numAnchors + a]
      : outputSlice[a * 5 + 3];

    if (isNaN(cx) || isNaN(cy) || isNaN(w) || isNaN(h) || w <= 0 || h <= 0) continue;

    // YOLO ONNX export may output coordinates normalized to 0..1 OR in pixels 0..640.
    if (cx <= 1.05 && cy <= 1.05 && w <= 1.05 && h <= 1.05) {
      cx *= 640;
      cy *= 640;
      w *= 640;
      h *= 640;
    }

    // Coordinates on 640x640 preprocessed canvas
    const canvasX1 = cx - w / 2;
    const canvasY1 = cy - h / 2;
    const canvasX2 = cx + w / 2;
    const canvasY2 = cy + h / 2;

    // Remove letterboxing padding & scale to map back to original image coordinates
    const unpaddedX1 = (canvasX1 - prep.padX) / prep.scale;
    const unpaddedY1 = (canvasY1 - prep.padY) / prep.scale;
    const unpaddedX2 = (canvasX2 - prep.padX) / prep.scale;
    const unpaddedY2 = (canvasY2 - prep.padY) / prep.scale;

    // Clamp to original image bounds
    const origX1 = Math.max(0, Math.min(prep.origWidth, unpaddedX1));
    const origY1 = Math.max(0, Math.min(prep.origHeight, unpaddedY1));
    const origX2 = Math.max(0, Math.min(prep.origWidth, unpaddedX2));
    const origY2 = Math.max(0, Math.min(prep.origHeight, unpaddedY2));

    // Convert to 0..1000 scale [ymin, xmin, ymax, xmax]
    const ymin = Math.max(0, Math.min(1000, Math.round((origY1 / prep.origHeight) * 1000)));
    const xmin = Math.max(0, Math.min(1000, Math.round((origX1 / prep.origWidth) * 1000)));
    const ymax = Math.max(0, Math.min(1000, Math.round((origY2 / prep.origHeight) * 1000)));
    const xmax = Math.max(0, Math.min(1000, Math.round((origX2 / prep.origWidth) * 1000)));

    // Discard boxes that are too small (< 1.5% of page width or height)
    if (xmax - xmin >= 15 && ymax - ymin >= 15) {
      rawBoxes.push({
        x1: xmin,
        y1: ymin,
        x2: xmax,
        y2: ymax,
        score
      });
    }
  }

  // Sort descending by confidence score
  rawBoxes.sort((a, b) => b.score - a.score);

  // Apply Non-Maximum Suppression (NMS)
  const nmsBoxes: RawBox[] = [];
  for (const candidate of rawBoxes) {
    let shouldKeep = true;
    for (const chosen of nmsBoxes) {
      if (calculateIoU(candidate, chosen) > iouThreshold) {
        shouldKeep = false;
        break;
      }
    }
    if (shouldKeep) {
      nmsBoxes.push(candidate);
      if (nmsBoxes.length >= 40) break; // Maximum 40 comic panels per page
    }
  }

  return nmsBoxes.map((b) => ({
    box_2d: [b.y1, b.x1, b.y2, b.x2] as [number, number, number, number],
    score: Math.round(b.score * 1000) / 1000
  }));
}

export interface DetectPanelsOptions {
  batchSize?: BatchSize;
  preferWebGpu?: boolean;
  confThreshold?: number;
  iouThreshold?: number;
}

/**
 * Runs YOLO ONNX panel detection (dp.onnx) on a single image.
 */
export async function detectPanelsYolo(
  imageSource: string | HTMLImageElement | HTMLCanvasElement | Blob | ImageData,
  options: DetectPanelsOptions = {}
): Promise<YoloLayoutResult> {
  const startTime = performance.now();
  const confThreshold = options.confThreshold ?? 0.25;
  const iouThreshold = options.iouThreshold ?? 0.45;

  try {
    const loadedImg = await loadImageElement(imageSource);
    const prep = preprocessImageTo640(loadedImg);

    const session = await getYoloSession(options.preferWebGpu);
    const inputName = session.inputNames[0] || "images";
    const outputName = session.outputNames[0] || "output0";

    const inputTensor = new ort.Tensor("float32", prep.rgbData, [1, 3, 640, 640]);
    const feeds = { [inputName]: inputTensor };
    const results = await session.run(feeds);
    const output = results[outputName];

    const outputTypedArray = output.data as Float32Array;
    const panels = postProcessOutput(outputTypedArray, prep, confThreshold, iouThreshold, true);

    const inferenceTimeMs = Math.round(performance.now() - startTime);

    return {
      panels,
      texts: [],
      batchSizeUsed: 1,
      acceleratorUsed: "wasm",
      inferenceTimeMs
    };
  } catch (err: any) {
    console.debug("[YOLO ONNX Engine] Single image detection notice:", err?.message || err);

    return {
      panels: [],
      texts: [],
      batchSizeUsed: 1,
      acceleratorUsed: "wasm",
      inferenceTimeMs: Math.round(performance.now() - startTime)
    };
  }
}

// Backward-compatibility alias
export const detectPanelsLiteRT = detectPanelsYolo;

/**
 * Runs YOLO ONNX panel detection on multiple images in batches.
 * Fully supports dynamic batch sizes (1, 2, 4, 8, etc.) via dp.onnx.
 */
export async function detectPanelsBatchYolo(
  images: Array<string | HTMLImageElement | HTMLCanvasElement | Blob | ImageData>,
  options: DetectPanelsOptions = {}
): Promise<YoloLayoutResult[]> {
  if (images.length === 0) return [];

  const capability = await detectDeviceCapability();
  const batchSize: BatchSize = options.batchSize || capability.recommendedBatch || 4;
  const confThreshold = options.confThreshold ?? 0.25;
  const iouThreshold = options.iouThreshold ?? 0.45;

  const results: YoloLayoutResult[] = [];

  // Sequential if batch size is 1
  if (batchSize === 1) {
    for (const img of images) {
      const res = await detectPanelsYolo(img, { ...options, batchSize: 1 });
      results.push(res);
    }
    return results;
  }

  let session: ort.InferenceSession;
  try {
    session = await getYoloSession(options.preferWebGpu);
  } catch (loadErr) {
    console.warn("[YOLO ONNX Engine] Batch load failed, falling back to sequential:", loadErr);
    for (const img of images) {
      const res = await detectPanelsYolo(img, { ...options, batchSize: 1 });
      results.push(res);
    }
    return results;
  }

  const inputName = session.inputNames[0] || "images";
  const outputName = session.outputNames[0] || "output0";

  for (let chunkStart = 0; chunkStart < images.length; chunkStart += batchSize) {
    const chunk = images.slice(chunkStart, chunkStart + batchSize);
    const currentBatch = chunk.length;
    const chunkStartTime = performance.now();

    try {
      const preps: PreprocessedImage[] = [];
      for (const imgSource of chunk) {
        const loaded = await loadImageElement(imgSource);
        preps.push(preprocessImageTo640(loaded));
      }

      // Construct dynamic batch tensor: [currentBatch, 3, 640, 640]
      const batchInput = new Float32Array(currentBatch * 3 * 640 * 640);
      const itemSize = 3 * 640 * 640;

      for (let i = 0; i < preps.length; i++) {
        batchInput.set(preps[i].rgbData, i * itemSize);
      }

      const inputTensor = new ort.Tensor("float32", batchInput, [currentBatch, 3, 640, 640]);
      const feeds = { [inputName]: inputTensor };
      const outputMap = await session.run(feeds);
      const output = outputMap[outputName];

      const outputData = output.data as Float32Array;
      const sliceLen = 5 * 8400;
      const chunkTime = Math.round((performance.now() - chunkStartTime) / currentBatch);

      for (let i = 0; i < preps.length; i++) {
        const slice = outputData.subarray(i * sliceLen, (i + 1) * sliceLen);
        const panels = postProcessOutput(slice, preps[i], confThreshold, iouThreshold, true);

        results.push({
          panels,
          texts: [],
          batchSizeUsed: batchSize,
          acceleratorUsed: "wasm",
          inferenceTimeMs: chunkTime
        });
      }
    } catch (chunkErr) {
      console.warn(`[YOLO ONNX Engine] Chunk error for batch ${currentBatch}, falling back to sequential:`, chunkErr);
      for (const imgSource of chunk) {
        const res = await detectPanelsYolo(imgSource, { ...options, batchSize: 1 });
        results.push(res);
      }
    }
  }

  return results;
}

// Backward-compatibility alias
export const detectPanelsBatchLiteRT = detectPanelsBatchYolo;
