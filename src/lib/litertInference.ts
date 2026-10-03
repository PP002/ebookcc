/**
 * LiteRT.js Panel Detection Inference Engine
 * High-performance on-device comic panel detection using LiteRT (.tflite) models.
 * Supports WebGPU and WebAssembly (XNNPACK CPU) execution with batching (1, 4, 8).
 */

import {
  loadLiteRt,
  loadAndCompile,
  Tensor,
  CompiledModel,
  isWebGPUSupported
} from "@litertjs/core";
import {
  BatchSize,
  LITE_RT_MODELS,
  getModelBytesFromCacheOrR2,
  detectDeviceCapability
} from "./litertModelManager";
import { detectComicPanels } from "@/services/gemini";

export interface PanelBox {
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] in 0..1000 scale
  score: number;
}

export interface LiteRTLayoutResult {
  panels: PanelBox[];
  texts: any[];
  batchSizeUsed: BatchSize;
  acceleratorUsed: "webgpu" | "wasm";
  inferenceTimeMs: number;
}

// ─────────────────────────────────────────────
// LiteRT Runtime Initialization
// ─────────────────────────────────────────────

let isLiteRtInitialized = false;
let initPromise: Promise<void> | null = null;

async function ensureLiteRtInitialized(): Promise<void> {
  if (isLiteRtInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Route Emscripten WASM standard output/error to console.debug to prevent benign C++ diagnostic logs from triggering error boundaries
    if (typeof window !== "undefined") {
      const w = window as any;
      w.Module = w.Module || {};
      const originalPrintErr = w.Module.printErr;
      w.Module.printErr = (...args: any[]) => {
        const msg = args.map(a => typeof a === 'string' ? a : String(a?.message || a)).join(' ');
        console.debug('[LiteRT WASM]', msg);
        if (originalPrintErr && !msg.includes('INFO:') && !msg.includes('WARNING:')) {
          originalPrintErr(...args);
        }
      };
    }

    // 1. Try local self-hosted WASM first
    try {
      await loadLiteRt("/wasm/litert/");
      isLiteRtInitialized = true;
      console.log("[LiteRT Engine] Initialized using local /wasm/litert/");
      return;
    } catch (localErr) {
      console.warn("[LiteRT Engine] Local wasm load failed, trying CDN fallback:", localErr);
    }

    // 2. Fallback to unpkg/jsdelivr CDN
    try {
      await loadLiteRt("https://cdn.jsdelivr.net/npm/@litertjs/core@2.5.3/wasm/");
      isLiteRtInitialized = true;
      console.log("[LiteRT Engine] Initialized using CDN wasm");
    } catch (cdnErr) {
      console.error("[LiteRT Engine] Failed to initialize LiteRT WASM runtime:", cdnErr);
      throw cdnErr;
    }
  })();

  return initPromise;
}

// ─────────────────────────────────────────────
// Compiled Model Cache
// ─────────────────────────────────────────────

interface CachedCompiledModel {
  model: CompiledModel;
  batch: BatchSize;
  accelerator: "webgpu" | "wasm";
  isChannelsFirst: boolean;
}

const compiledModels = new Map<string, CachedCompiledModel>();
const modelLoadingPromises = new Map<string, Promise<CachedCompiledModel>>();

async function getOrCompileModel(
  batch: BatchSize,
  preferWebGpu: boolean = true
): Promise<CachedCompiledModel> {
  const modelInfo = LITE_RT_MODELS[batch];
  const modelKey = `${batch}-${preferWebGpu ? "webgpu" : "wasm"}`;

  const cached = compiledModels.get(modelKey);
  if (cached) return cached;

  const inFlight = modelLoadingPromises.get(modelKey);
  if (inFlight) return inFlight;

  const promise = (async () => {
    await ensureLiteRtInitialized();

    // 1. Get model flatbuffer bytes from Cache Storage API or R2
    const modelBytes = await getModelBytesFromCacheOrR2(modelInfo.filename);

    let accelerator: "webgpu" | "wasm" = preferWebGpu ? "webgpu" : "wasm";
    let compiled: CompiledModel | null = null;

    if (preferWebGpu) {
      try {
        const webgpuSupported = await isWebGPUSupported();
        if (webgpuSupported) {
          console.log(`[LiteRT Engine] Compiling ${modelInfo.filename} on WebGPU...`);
          compiled = await loadAndCompile(modelBytes, { accelerator: "webgpu" });
          accelerator = "webgpu";
        }
      } catch (gpuErr) {
        console.warn(`[LiteRT Engine] WebGPU compile failed for ${modelInfo.filename}, falling back to WASM:`, gpuErr);
      }
    }

    if (!compiled) {
      console.log(`[LiteRT Engine] Compiling ${modelInfo.filename} on WASM CPU (XNNPACK)...`);
      compiled = await loadAndCompile(modelBytes, { accelerator: "wasm" });
      accelerator = "wasm";
    }

    // Determine output layout from model details
    let isChannelsFirst = true; // standard Ultralytics YOLO [batch, 5, 8400]
    try {
      const outputDetails = compiled.getOutputDetails();
      if (outputDetails && outputDetails.length > 0 && outputDetails[0].shape) {
        const shape = outputDetails[0].shape;
        if (shape.length >= 3 && shape[1] === 8400 && shape[2] === 5) {
          isChannelsFirst = false;
        }
      }
    } catch (_) {}

    const result: CachedCompiledModel = {
      model: compiled,
      batch,
      accelerator,
      isChannelsFirst
    };

    compiledModels.set(modelKey, result);
    modelLoadingPromises.delete(modelKey);
    return result;
  })();

  modelLoadingPromises.set(modelKey, promise);
  return promise;
}

// ─────────────────────────────────────────────
// Image Preprocessing & Helper Functions
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
  outputSlice: Float32Array, // [5, 8400] or [8400, 5]
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

    // Ultralytics LiteRT export may output coordinates normalized to 0..1 OR in pixels 0..640.
    // If normalized (values <= 1.05), scale to canvas dimensions (640).
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

// ─────────────────────────────────────────────
// Main Inference Functions
// ─────────────────────────────────────────────

async function executeModel(
  cached: CachedCompiledModel,
  inputTensor: Tensor,
  batchSize: BatchSize
): Promise<{ outputs: Tensor[]; accelerator: "webgpu" | "wasm"; isChannelsFirst: boolean }> {
  try {
    const outputs = await cached.model.run([inputTensor]);
    if (!outputs || outputs.length === 0) {
      throw new Error("Model returned empty output tensors");
    }
    return { outputs, accelerator: cached.accelerator, isChannelsFirst: cached.isChannelsFirst };
  } catch (runErr: any) {
    if (cached.accelerator === "webgpu") {
      console.debug(
        `[Split Model] WebGPU run notice (${runErr?.message || runErr}), falling back to WASM CPU (XNNPACK)...`
      );
      compiledModels.delete(`${batchSize}-webgpu`);
      try {
        const wasmCached = await getOrCompileModel(batchSize, false);
        const outputs = await wasmCached.model.run([inputTensor]);
        if (!outputs || outputs.length === 0) {
          throw new Error("WASM fallback returned empty output tensors");
        }
        return { outputs, accelerator: "wasm", isChannelsFirst: wasmCached.isChannelsFirst };
      } catch (wasmErr: any) {
        // If high batch size fails on WASM, attempt batch 1 fallback
        if (batchSize > 1) {
          console.debug(`[Split Model] High-batch fallback to Batch 1 CPU...`);
          const singleCached = await getOrCompileModel(1, false);
          const singleTensor = new Tensor(inputTensor.data.subarray(0, 3 * 640 * 640), [1, 3, 640, 640]);
          const singleOutputs = await singleCached.model.run([singleTensor]);
          return { outputs: singleOutputs, accelerator: "wasm", isChannelsFirst: singleCached.isChannelsFirst };
        }
        throw wasmErr;
      }
    }
    throw runErr;
  }
}

export interface DetectPanelsOptions {
  batchSize?: BatchSize;
  preferWebGpu?: boolean;
  confThreshold?: number;
  iouThreshold?: number;
}

/**
 * Runs Split Model panel detection on a single image.
 * Uses batch1.tflite for single images for maximum speed and zero buffer overhead.
 */
export async function detectPanelsLiteRT(
  imageSource: string | HTMLImageElement | HTMLCanvasElement | Blob | ImageData,
  options: DetectPanelsOptions = {}
): Promise<LiteRTLayoutResult> {
  const startTime = performance.now();
  const batchSize: BatchSize = options.batchSize || 1;
  const confThreshold = options.confThreshold ?? 0.25;
  const iouThreshold = options.iouThreshold ?? 0.45;

  try {
    const loadedImg = await loadImageElement(imageSource);
    const prep = preprocessImageTo640(loadedImg);

    const capability = await detectDeviceCapability();
    const preferWebGpu = options.preferWebGpu ?? capability.hasWebGpu;

    // For single page inference, use batch 1 model for optimal speed and buffer alignment
    const actualBatch: BatchSize = batchSize === 1 ? 1 : batchSize;
    const cachedModel = await getOrCompileModel(actualBatch, preferWebGpu);

    // Build input tensor: shape [actualBatch, 3, 640, 640]
    const fullBatchData = new Float32Array(actualBatch * 3 * 640 * 640);
    fullBatchData.set(prep.rgbData, 0);

    const inputTensor = new Tensor(fullBatchData, [actualBatch, 3, 640, 640]);
    const { outputs, accelerator, isChannelsFirst } = await executeModel(cachedModel, inputTensor, actualBatch);

    const outputTypedArray = (await outputs[0].data()) as Float32Array;

    // Slice first item: [5, 8400]
    const itemSlice = outputTypedArray.subarray(0, 5 * 8400);
    const panels = postProcessOutput(itemSlice, prep, confThreshold, iouThreshold, isChannelsFirst);

    const inferenceTimeMs = Math.round(performance.now() - startTime);

    return {
      panels,
      texts: [],
      batchSizeUsed: actualBatch,
      acceleratorUsed: accelerator,
      inferenceTimeMs
    };
  } catch (err: any) {
    console.debug("[Split Model] In-browser detection notice:", err?.message || err);

    return {
      panels: [],
      texts: [],
      batchSizeUsed: batchSize,
      acceleratorUsed: "wasm",
      inferenceTimeMs: Math.round(performance.now() - startTime)
    };
  }
}

/**
 * Runs Split Model panel detection on multiple images in batches (e.g. batch size 4, 8, 16, 32).
 * Optimized for CONVERT page multi-page processing.
 */
export async function detectPanelsBatchLiteRT(
  images: Array<string | HTMLImageElement | HTMLCanvasElement | Blob | ImageData>,
  options: DetectPanelsOptions = {}
): Promise<LiteRTLayoutResult[]> {
  if (images.length === 0) return [];

  const capability = await detectDeviceCapability();
  const batchSize: BatchSize = options.batchSize || capability.recommendedBatch || 8;
  const preferWebGpu = options.preferWebGpu ?? capability.hasWebGpu;
  const confThreshold = options.confThreshold ?? 0.25;
  const iouThreshold = options.iouThreshold ?? 0.45;

  const results: LiteRTLayoutResult[] = [];

  // If batch size is 1, process sequentially
  if (batchSize === 1) {
    for (const img of images) {
      const res = await detectPanelsLiteRT(img, { ...options, batchSize: 1 });
      results.push(res);
    }
    return results;
  }

  // Multi-image batch execution
  let cachedModel: CachedCompiledModel;
  try {
    cachedModel = await getOrCompileModel(batchSize, preferWebGpu);
  } catch (loadErr) {
    console.warn(`[Split Model] Batch ${batchSize} load failed, falling back to sequential batch 1:`, loadErr);
    for (const img of images) {
      const res = await detectPanelsLiteRT(img, { ...options, batchSize: 1 });
      results.push(res);
    }
    return results;
  }

  for (let chunkStart = 0; chunkStart < images.length; chunkStart += batchSize) {
    const chunk = images.slice(chunkStart, chunkStart + batchSize);
    const chunkStartTime = performance.now();

    try {
      const preps: PreprocessedImage[] = [];
      for (const imgSource of chunk) {
        const loaded = await loadImageElement(imgSource);
        preps.push(preprocessImageTo640(loaded));
      }

      // Construct batched input tensor [batchSize, 3, 640, 640]
      const batchInput = new Float32Array(batchSize * 3 * 640 * 640);
      const itemSize = 3 * 640 * 640;

      for (let i = 0; i < preps.length; i++) {
        batchInput.set(preps[i].rgbData, i * itemSize);
      }

      const inputTensor = new Tensor(batchInput, [batchSize, 3, 640, 640]);
      const { outputs, accelerator, isChannelsFirst } = await executeModel(cachedModel, inputTensor, batchSize);

      const outputData = (await outputs[0].data()) as Float32Array;
      const sliceLen = 5 * 8400;
      const chunkTime = Math.round((performance.now() - chunkStartTime) / chunk.length);

      for (let i = 0; i < preps.length; i++) {
        const slice = outputData.subarray(i * sliceLen, (i + 1) * sliceLen);
        const panels = postProcessOutput(slice, preps[i], confThreshold, iouThreshold, isChannelsFirst);

        results.push({
          panels,
          texts: [],
          batchSizeUsed: batchSize,
          acceleratorUsed: accelerator,
          inferenceTimeMs: chunkTime
        });
      }
    } catch (chunkErr) {
      console.warn(`[Split Model] Chunk error for batch ${batchSize}, falling back chunk to batch 1:`, chunkErr);
      for (const imgSource of chunk) {
        const res = await detectPanelsLiteRT(imgSource, { ...options, batchSize: 1 });
        results.push(res);
      }
    }
  }

  return results;
}
