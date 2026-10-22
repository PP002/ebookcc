/**
 * ONNX YOLO Comic Panel Detection Engine (dp.onnx / dpt.onnx)
 * High-performance on-device comic panel detection using ONNX Runtime Web.
 * Models are hosted on Cloudflare R2 at /Models/dp.onnx and /Models/dpt.onnx.
 * ONNX WASM & WebGPU runtime files are hosted on Cloudflare R2 at /wasm/onnx/.
 */

import * as ort from "onnxruntime-web/webgpu";
import {
  BatchSize,
  YoloModelId,
  SPLIT_MODELS,
  getConvertSplitModelPreference,
  getModelBytesFromCacheOrR2,
  detectDeviceCapability
} from "./yoloModelManager";
import {
  logOnnxEnvInitOnce,
  configureOnnxEnvironment,
  getReusableYoloCanvas
} from "./onnxPipelineEnv";
import {
  isWorkerPipelineSupported,
  workerPreprocessYolo,
  PreprocessedYoloData
} from "./pipelineWorkerBridge";

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

export function initOnnxWasmEnv(provider: "webgpu" | "wasm" = "wasm") {
  configureOnnxEnvironment(provider);
}

if (typeof window !== "undefined") {
  initOnnxWasmEnv("wasm");
}

// ─────────────────────────────────────────────
// Cached ONNX Inference Session Map & Tier Selection
// ─────────────────────────────────────────────

const yoloSessions = new Map<string, { session: ort.InferenceSession; accelerator: "webgpu" | "wasm" }>();
const sessionLoadingPromises = new Map<string, Promise<{ session: ort.InferenceSession; accelerator: "webgpu" | "wasm" }>>();

export async function getYoloSession(
  preferWebGpu: boolean = true,
  modelIdOrFilename?: YoloModelId | string
): Promise<{ session: ort.InferenceSession; accelerator: "webgpu" | "wasm" }> {
  const modelKey = modelIdOrFilename || getConvertSplitModelPreference() || "dp";
  const modelInfo = SPLIT_MODELS[modelKey as YoloModelId];
  const filename = modelInfo?.filename || (modelKey.endsWith(".onnx") ? modelKey : `${modelKey}.onnx`);
  const sessionCacheKey = `${filename}::${preferWebGpu ? "webgpu_pref" : "wasm_only"}`;

  if (yoloSessions.has(sessionCacheKey)) {
    return yoloSessions.get(sessionCacheKey)!;
  }
  if (sessionLoadingPromises.has(sessionCacheKey)) {
    return sessionLoadingPromises.get(sessionCacheKey)!;
  }

  const loadPromise = (async () => {
    console.log(`[YOLO ONNX Engine] Loading ${filename} from cache or R2...`);
    let modelBytes: Uint8Array;
    try {
      modelBytes = await getModelBytesFromCacheOrR2(filename);
    } catch (loadErr) {
      if (filename !== "dp.onnx") {
        console.warn(`[YOLO ONNX Engine] ${filename} not available yet, falling back to dp.onnx:`, loadErr);
        modelBytes = await getModelBytesFromCacheOrR2("dp.onnx");
      } else {
        throw loadErr;
      }
    }

    // ─────────────────────────────────────────────
    // Tier Selection: Tier A (WebGPU), Tier B (WASM)
    // ─────────────────────────────────────────────
    let session: ort.InferenceSession | null = null;
    let acceleratorUsed: "webgpu" | "wasm" = "wasm";

    const hasWebGpu = typeof navigator !== "undefined" && "gpu" in navigator;

    // Tier A: Try WebGPU first if preferred and supported
    if (preferWebGpu && hasWebGpu) {
      try {
        configureOnnxEnvironment("webgpu");
        session = await ort.InferenceSession.create(modelBytes as any, {
          executionProviders: ["webgpu"],
          graphOptimizationLevel: "all"
        });
        acceleratorUsed = "webgpu";
        logOnnxEnvInitOnce("webgpu");
        console.log(`[YOLO ONNX Engine] ${filename} successfully initialized with WebGPU (Tier A)!`);
      } catch (gpuErr) {
        console.warn(`[YOLO ONNX Engine] WebGPU Tier A failed for ${filename}, falling back to WASM Tier B:`, gpuErr);
        session = null;
      }
    }

    // Tier B: Fallback to WASM
    if (!session) {
      configureOnnxEnvironment("wasm");
      logOnnxEnvInitOnce("wasm");
      try {
        session = await ort.InferenceSession.create(modelBytes as any, {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all"
        });
        acceleratorUsed = "wasm";
        console.log(`[YOLO ONNX Engine] ${filename} session initialized with WASM (Tier B)!`);
      } catch (wasmErr: any) {
        console.warn(`[YOLO ONNX Engine] WASM init attempt 1 failed (${wasmErr?.message || wasmErr}), retrying with proxy=false:`, wasmErr);
        // Fallback: if proxy failed or path failed, try with proxy=false and origin wasm path
        if (typeof window !== "undefined" && window.location) {
          ort.env.wasm.wasmPaths = `${window.location.origin}/wasm/onnx/`;
        }
        ort.env.wasm.proxy = false;
        session = await ort.InferenceSession.create(modelBytes as any, {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all"
        });
        acceleratorUsed = "wasm";
        console.log(`[YOLO ONNX Engine] ${filename} session initialized with WASM (attempt 2)!`);
      }
    }

    const result = { session, accelerator: acceleratorUsed };
    yoloSessions.set(sessionCacheKey, result);
    return result;
  })().finally(() => {
    sessionLoadingPromises.delete(sessionCacheKey);
  });

  sessionLoadingPromises.set(sessionCacheKey, loadPromise);
  return loadPromise;
}

// ─────────────────────────────────────────────
// In-Memory Layout Detection Cache & In-Flight Map (2.1)
// ─────────────────────────────────────────────

const layoutResultCache = new Map<string, YoloLayoutResult>();
const inFlightLayoutRequests = new Map<string, Promise<YoloLayoutResult>>();

export function generateLayoutCacheKey(
  source: any,
  modelName: string,
  imgsz = 640,
  conf = 0.25,
  iou = 0.45
): string {
  let sourceId = "";
  if (typeof source === "string") {
    if (source.startsWith("data:")) {
      sourceId = `data_${source.length}_${source.slice(0, 32)}_${source.slice(-32)}`;
    } else {
      sourceId = source;
    }
  } else if (source && typeof source === "object") {
    if ("src" in source && typeof source.src === "string") {
      sourceId = source.src;
    } else if ("__layoutCacheId" in source) {
      sourceId = (source as any).__layoutCacheId;
    } else {
      const w = ("width" in source ? source.width : 0) || 0;
      const h = ("height" in source ? source.height : 0) || 0;
      const id = `img_${w}x${h}_${Math.random().toString(36).slice(2, 9)}`;
      try {
        (source as any).__layoutCacheId = id;
      } catch (_) {}
      sourceId = id;
    }
  } else {
    sourceId = `unknown_${Date.now()}`;
  }

  return `${sourceId}::${modelName}::${imgsz}::${conf.toFixed(3)}::${iou.toFixed(3)}`;
}

export function invalidateLayoutCache(sourcePattern?: string): void {
  if (!sourcePattern) {
    layoutResultCache.clear();
  } else {
    for (const key of layoutResultCache.keys()) {
      if (key.includes(sourcePattern)) {
        layoutResultCache.delete(key);
      }
    }
  }
}

// ─────────────────────────────────────────────
// Image Preprocessing & Helpers (with 1.2 Canvas Reuse & 2.2b Worker)
// ─────────────────────────────────────────────

interface PreprocessedImage {
  origWidth: number;
  origHeight: number;
  scale: number;
  padX: number;
  padY: number;
  rgbData: Float32Array; // 3 * 640 * 640 in NCHW [3, 640, 640]
}

async function loadImageElement(
  source: string | HTMLImageElement | HTMLCanvasElement | Blob | ImageData
): Promise<HTMLImageElement | HTMLCanvasElement> {
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
      const { canvas, ctx } = getReusableYoloCanvas(source.width, source.height);
      ctx.putImageData(source, 0, 0);
      resolve(canvas);
    } else {
      reject(new Error("Unsupported image source type"));
    }
  });
}

function preprocessImageTo640MainThread(img: HTMLImageElement | HTMLCanvasElement): PreprocessedImage {
  const origWidth = ("naturalWidth" in img ? img.naturalWidth : img.width) || 640;
  const origHeight = ("naturalHeight" in img ? img.naturalHeight : img.height) || 640;

  const targetSize = 640;
  const scale = Math.min(targetSize / origWidth, targetSize / origHeight);
  const newW = Math.round(origWidth * scale);
  const newH = Math.round(origHeight * scale);
  const padX = Math.round((targetSize - newW) / 2);
  const padY = Math.round((targetSize - newH) / 2);

  // 1.2: Use reusable 640x640 canvas created with { willReadFrequently: true }
  const { ctx } = getReusableYoloCanvas(targetSize, targetSize);

  // Neutral background fill
  ctx.fillStyle = "#727272";
  ctx.fillRect(0, 0, targetSize, targetSize);
  ctx.drawImage(img, padX, padY, newW, newH);

  const imgData = ctx.getImageData(0, 0, targetSize, targetSize);
  const rgba = imgData.data;

  // Float32 array for NCHW format: [3, 640, 640]
  const rgbData = new Float32Array(3 * targetSize * targetSize);
  const channelSize = targetSize * targetSize;

  for (let i = 0; i < channelSize; i++) {
    const rgbaIdx = i * 4;
    rgbData[i] = rgba[rgbaIdx] / 255.0; // R
    rgbData[channelSize + i] = rgba[rgbaIdx + 1] / 255.0; // G
    rgbData[2 * channelSize + i] = rgba[rgbaIdx + 2] / 255.0; // B
  }

  return {
    origWidth,
    origHeight,
    scale,
    padX,
    padY,
    rgbData
  };
}

async function preprocessImageTo640(
  imgSource: HTMLImageElement | HTMLCanvasElement | Blob | ImageData | string
): Promise<PreprocessedImage> {
  // 2.2b: Offload to Web Worker with OffscreenCanvas if supported
  if (isWorkerPipelineSupported()) {
    try {
      let sourceToBitmap: any = imgSource;
      if (typeof imgSource === "string") {
        sourceToBitmap = await loadImageElement(imgSource);
      }
      const workerRes: PreprocessedYoloData = await workerPreprocessYolo(sourceToBitmap, 640);
      return {
        origWidth: workerRes.origWidth,
        origHeight: workerRes.origHeight,
        scale: workerRes.scale,
        padX: workerRes.padX,
        padY: workerRes.padY,
        rgbData: workerRes.rgbData
      };
    } catch (workerErr) {
      console.warn("[YOLO Preprocess] Web Worker offload failed, falling back to main-thread:", workerErr);
    }
  }

  // Fallback: main-thread canvas preprocessing with canvas reuse
  const loaded = await loadImageElement(imgSource);
  return preprocessImageTo640MainThread(loaded);
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

    if (cx <= 1.05 && cy <= 1.05 && w <= 1.05 && h <= 1.05) {
      cx *= 640;
      cy *= 640;
      w *= 640;
      h *= 640;
    }

    const canvasX1 = cx - w / 2;
    const canvasY1 = cy - h / 2;
    const canvasX2 = cx + w / 2;
    const canvasY2 = cy + h / 2;

    const unpaddedX1 = (canvasX1 - prep.padX) / prep.scale;
    const unpaddedY1 = (canvasY1 - prep.padY) / prep.scale;
    const unpaddedX2 = (canvasX2 - prep.padX) / prep.scale;
    const unpaddedY2 = (canvasY2 - prep.padY) / prep.scale;

    const origX1 = Math.max(0, Math.min(prep.origWidth, unpaddedX1));
    const origY1 = Math.max(0, Math.min(prep.origHeight, unpaddedY1));
    const origX2 = Math.max(0, Math.min(prep.origWidth, unpaddedX2));
    const origY2 = Math.max(0, Math.min(prep.origHeight, unpaddedY2));

    const ymin = Math.max(0, Math.min(1000, Math.round((origY1 / prep.origHeight) * 1000)));
    const xmin = Math.max(0, Math.min(1000, Math.round((origX1 / prep.origWidth) * 1000)));
    const ymax = Math.max(0, Math.min(1000, Math.round((origY2 / prep.origHeight) * 1000)));
    const xmax = Math.max(0, Math.min(1000, Math.round((origX2 / prep.origWidth) * 1000)));

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

  rawBoxes.sort((a, b) => b.score - a.score);

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
      if (nmsBoxes.length >= 40) break;
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
  model?: YoloModelId | string;
}

/**
 * Runs YOLO ONNX panel detection (dp.onnx / dpt.onnx) on a single image.
 * Uses layout caching, in-flight deduplication, WebGPU / WASM tiering,
 * worker preprocessing, and logs per-page timings.
 */
export async function detectPanelsYolo(
  imageSource: string | HTMLImageElement | HTMLCanvasElement | Blob | ImageData,
  options: DetectPanelsOptions = {}
): Promise<YoloLayoutResult> {
  const confThreshold = options.confThreshold ?? 0.25;
  const iouThreshold = options.iouThreshold ?? 0.45;
  const modelKey = options.model || getConvertSplitModelPreference() || "dp";
  const modelName = SPLIT_MODELS[modelKey as YoloModelId]?.filename || `${modelKey}.onnx`;

  // 2.1: Cache lookup
  const cacheKey = generateLayoutCacheKey(imageSource, modelName, 640, confThreshold, iouThreshold);
  if (layoutResultCache.has(cacheKey)) {
    const cached = layoutResultCache.get(cacheKey)!;
    return {
      ...cached,
      panels: cached.panels.map((p) => ({ ...p, box_2d: [...p.box_2d] }))
    };
  }

  // 2.1: In-flight deduplication map
  if (inFlightLayoutRequests.has(cacheKey)) {
    return inFlightLayoutRequests.get(cacheKey)!;
  }

  const detectionPromise = (async (): Promise<YoloLayoutResult> => {
    const t0 = performance.now();

    try {
      const tPre0 = performance.now();
      const prep = await preprocessImageTo640(imageSource);
      const preMs = Math.round((performance.now() - tPre0) * 10) / 10;

      const { session, accelerator } = await getYoloSession(options.preferWebGpu ?? true, options.model);
      const inputName = session.inputNames[0] || "images";
      const outputName = session.outputNames[0] || "output0";

      const tInfer0 = performance.now();
      const inputTensor = new ort.Tensor("float32", prep.rgbData, [1, 3, 640, 640]);
      const feeds = { [inputName]: inputTensor };
      const results = await session.run(feeds);
      const output = results[outputName];
      const inferMs = Math.round((performance.now() - tInfer0) * 10) / 10;

      const tPost0 = performance.now();
      const outputTypedArray = output.data as Float32Array;
      const panels = postProcessOutput(outputTypedArray, prep, confThreshold, iouThreshold, true);
      const postMs = Math.round((performance.now() - tPost0) * 10) / 10;

      const totalMs = Math.round((performance.now() - t0) * 10) / 10;

      // 1.1: Log ONE object for layout detection per processed page
      console.log("[Layout Detection Timing]", {
        preMs,
        inferMs,
        postMs,
        totalMs,
        imgsz: 640,
        provider: accelerator
      });

      const layoutResult: YoloLayoutResult = {
        panels,
        texts: [],
        batchSizeUsed: 1,
        acceleratorUsed: accelerator,
        inferenceTimeMs: totalMs
      };

      layoutResultCache.set(cacheKey, layoutResult);
      return layoutResult;
    } catch (err: any) {
      console.debug("[YOLO ONNX Engine] Single image detection notice:", err?.message || err);
      const totalMs = Math.round((performance.now() - t0) * 10) / 10;
      return {
        panels: [],
        texts: [],
        batchSizeUsed: 1,
        acceleratorUsed: "wasm",
        inferenceTimeMs: totalMs
      };
    }
  })().finally(() => {
    inFlightLayoutRequests.delete(cacheKey);
  });

  inFlightLayoutRequests.set(cacheKey, detectionPromise);
  return detectionPromise;
}

// Backward-compatibility alias
export const detectPanelsLiteRT = detectPanelsYolo;

/**
 * Runs YOLO ONNX panel detection on multiple images in batches.
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
  const modelKey = options.model || getConvertSplitModelPreference() || "dp";
  const modelName = SPLIT_MODELS[modelKey as YoloModelId]?.filename || `${modelKey}.onnx`;

  const results: YoloLayoutResult[] = [];

  // Sequential if batch size is 1
  if (batchSize === 1) {
    for (const img of images) {
      const res = await detectPanelsYolo(img, { ...options, batchSize: 1 });
      results.push(res);
    }
    return results;
  }

  let sessionInfo: { session: ort.InferenceSession; accelerator: "webgpu" | "wasm" };
  try {
    sessionInfo = await getYoloSession(options.preferWebGpu ?? true, options.model);
  } catch (loadErr) {
    console.warn("[YOLO ONNX Engine] Batch load failed, falling back to sequential:", loadErr);
    for (const img of images) {
      const res = await detectPanelsYolo(img, { ...options, batchSize: 1 });
      results.push(res);
    }
    return results;
  }

  const { session, accelerator } = sessionInfo;
  const inputName = session.inputNames[0] || "images";
  const outputName = session.outputNames[0] || "output0";

  for (let chunkStart = 0; chunkStart < images.length; chunkStart += batchSize) {
    const chunk = images.slice(chunkStart, chunkStart + batchSize);
    const currentBatch = chunk.length;
    const chunkStartTime = performance.now();

    try {
      const preps: PreprocessedImage[] = [];
      const tPre0 = performance.now();
      for (const imgSource of chunk) {
        preps.push(await preprocessImageTo640(imgSource));
      }
      const preMs = Math.round(((performance.now() - tPre0) / currentBatch) * 10) / 10;

      // Construct dynamic batch tensor: [currentBatch, 3, 640, 640]
      const batchInput = new Float32Array(currentBatch * 3 * 640 * 640);
      const itemSize = 3 * 640 * 640;

      for (let i = 0; i < preps.length; i++) {
        batchInput.set(preps[i].rgbData, i * itemSize);
      }

      const tInfer0 = performance.now();
      const inputTensor = new ort.Tensor("float32", batchInput, [currentBatch, 3, 640, 640]);
      const feeds = { [inputName]: inputTensor };
      const outputMap = await session.run(feeds);
      const output = outputMap[outputName];
      const inferMs = Math.round(((performance.now() - tInfer0) / currentBatch) * 10) / 10;

      const outputData = output.data as Float32Array;
      const sliceLen = 5 * 8400;

      const tPost0 = performance.now();
      for (let i = 0; i < preps.length; i++) {
        const slice = outputData.subarray(i * sliceLen, (i + 1) * sliceLen);
        const panels = postProcessOutput(slice, preps[i], confThreshold, iouThreshold, true);
        const postMs = Math.round(((performance.now() - tPost0) / currentBatch) * 10) / 10;
        const totalMs = Math.round(((performance.now() - chunkStartTime) / currentBatch) * 10) / 10;

        // 1.1: Log ONE object per page for layout detection
        console.log("[Layout Detection Timing]", {
          preMs,
          inferMs,
          postMs,
          totalMs,
          imgsz: 640,
          provider: accelerator
        });

        const singleResult: YoloLayoutResult = {
          panels,
          texts: [],
          batchSizeUsed: batchSize,
          acceleratorUsed: accelerator,
          inferenceTimeMs: totalMs
        };

        const imgKey = generateLayoutCacheKey(chunk[i], modelName, 640, confThreshold, iouThreshold);
        layoutResultCache.set(imgKey, singleResult);
        results.push(singleResult);
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
