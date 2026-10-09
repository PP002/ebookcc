/**
 * LiteRT Model Manager
 * Handles caching of LiteRT (.tflite) panel detection models using the browser's Cache Storage API.
 * Models are stored in Cloudflare R2 at R2/models/
 */

export type BatchSize = 1 | 4 | 8 | 16 | 32;

export interface ModelInfo {
  batch: BatchSize;
  filename: string;
  sizeBytes: number;
  sizeFormatted: string;
  label: string;
  description: string;
}

export const LITE_RT_MODELS: Record<BatchSize, ModelInfo> = {
  1: {
    batch: 1,
    filename: "imagez=640-quantize=w8a32-batch=1.tflite",
    sizeBytes: 2834679,
    sizeFormatted: "~2.8 MB",
    label: "1 CPU",
    description: "1 CPU"
  },
  4: {
    batch: 4,
    filename: "imagez=640-quantize=w8a32-batch=4.tflite",
    sizeBytes: 2834806,
    sizeFormatted: "~2.8 MB",
    label: "4 GPU",
    description: "4 GPU"
  },
  8: {
    batch: 8,
    filename: "imagez=640-quantize=w8a32-batch=8.tflite",
    sizeBytes: 2834805,
    sizeFormatted: "~2.8 MB",
    label: "8 WebGPU",
    description: "8 WebGPU"
  },
  16: {
    batch: 16,
    filename: "imagez=640-quantize=w8a32-batch=16.tflite",
    sizeBytes: 10485760,
    sizeFormatted: "~10 MB",
    label: "16 UltraGPU",
    description: "16 UltraGPU"
  },
  32: {
    batch: 32,
    filename: "imagez=640-quantize=w8a32-batch=32.tflite",
    sizeBytes: 10485760,
    sizeFormatted: "~10 MB",
    label: "32 Max Throughput",
    description: "32 Max Throughput"
  }
};

export const CACHE_NAME = "litert-models-cache-v1";
const PREF_KEY = "ebookcc_litert_batch_pref";

export interface DeviceCapability {
  hasWebGpu: boolean;
  hasCapableGpu: boolean;
  gpuRenderer: string;
  recommendedBatch: BatchSize;
  reason: string;
}

/**
 * Detects device hardware capability to recommend optimal batch size:
 * - If WebGPU is available -> offer batch 8
 * - If WebGPU is unavailable but the device has a capable GPU (via WebGL renderer) -> offer batch 4
 * - Fallback -> batch 1
 */
export async function detectDeviceCapability(): Promise<DeviceCapability> {
  let hasWebGpu = false;
  if (typeof navigator !== "undefined" && "gpu" in navigator) {
    try {
      const adapter = await (navigator as any).gpu.requestAdapter();
      hasWebGpu = !!adapter;
    } catch (_) {
      hasWebGpu = false;
    }
  }

  let hasCapableGpu = false;
  let gpuRenderer = "Unknown";

  if (typeof document !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (gl) {
        const debugInfo = (gl as any).getExtension("WEBGL_debug_renderer_info");
        gpuRenderer = debugInfo
          ? (gl as any).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
          : (gl as any).getParameter((gl as any).RENDERER) || "";

        const lower = gpuRenderer.toLowerCase();
        const isSoftware =
          lower.includes("swiftshader") ||
          lower.includes("llvmpipe") ||
          lower.includes("softpipe") ||
          lower.includes("software") ||
          lower.includes("basic render driver") ||
          lower.includes("microsoft basic");

        hasCapableGpu =
          !isSoftware &&
          (lower.includes("nvidia") ||
            lower.includes("geforce") ||
            lower.includes("rtx") ||
            lower.includes("gtx") ||
            lower.includes("amd") ||
            lower.includes("radeon") ||
            lower.includes("apple") ||
            lower.includes("m1") ||
            lower.includes("m2") ||
            lower.includes("m3") ||
            lower.includes("m4") ||
            lower.includes("intel") ||
            lower.includes("adreno") ||
            lower.includes("mali") ||
            lower.includes("qualcomm") ||
            gpuRenderer.length > 5);
      }
    } catch (_) {}
  }

  let recommendedBatch: BatchSize = 1;
  let reason = "Fallback to single-page CPU/WASM processing";

  if (hasWebGpu) {
    recommendedBatch = 8;
    reason = "WebGPU hardware acceleration available (ultra-fast Batch 8)";
  } else if (hasCapableGpu) {
    recommendedBatch = 4;
    reason = `GPU detected (${gpuRenderer.slice(0, 32)}) via WebGL (fast Batch 4)`;
  }

  return {
    hasWebGpu,
    hasCapableGpu,
    gpuRenderer,
    recommendedBatch,
    reason
  };
}

function isValidTfliteBuffer(buffer: ArrayBuffer | Uint8Array): boolean {
  if (!buffer || buffer.byteLength < 500000) return false;
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  // Reject HTML error pages (starts with '<')
  if (bytes[0] === 0x3C || bytes[0] === 60) return false;
  return true;
}

/**
 * Returns canonical URLs to fetch model from R2 / server proxy / local fallback
 * Models are located under /Models as imagez=640-quantize=w8a32-batch={X}.tflite
 */
export function getModelFetchUrls(filename: string): string[] {
  let batchNum = "1";
  const match = filename.match(/batch[=-]?(\d+)/i);
  if (match) {
    batchNum = match[1];
  }

  const modelFilename = `imagez=640-quantize=w8a32-batch=${batchNum}.tflite`;
  const legacyFilename = `panel-batch${batchNum}.tflite`;

  const urls: string[] = [
    `/models/${legacyFilename}`,
    `/models/${modelFilename}`,
    `/Models/${legacyFilename}`,
    `/Models/${modelFilename}`,
    `/models/${filename}`,
    `/Models/${filename}`,
    `/api/models/${legacyFilename}`,
    `/api/models/${modelFilename}`,
    `/api/models/${filename}`,
    `/api/Models/${legacyFilename}`,
    `/api/Models/${modelFilename}`,
    `/api/media/file/ebookcc-media/Models/${modelFilename}`,
    `/api/media/file/ebookcc-media/models/${modelFilename}`,
  ];

  // If there is an external backend URL configured in environment, add it as fallback
  if (typeof window !== "undefined") {
    const apiEnv = (import.meta as any).env?.VITE_API_URL;
    if (apiEnv && typeof apiEnv === 'string' && apiEnv.startsWith('http')) {
      urls.push(`${apiEnv.replace(/\/+$/, '')}/Models/${modelFilename}`);
      urls.push(`${apiEnv.replace(/\/+$/, '')}/api/models/${modelFilename}`);
    }
  }

  return urls;
}

/**
 * Canonical Request URL used as key in the browser Cache Storage API
 */
export function getModelCacheKey(filename: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  return `${origin}/Models/${filename}`;
}

/**
 * Checks if a model file is currently in Cache Storage API
 */
export async function isModelCached(filename: string): Promise<boolean> {
  if (typeof window === "undefined" || !("caches" in window)) return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const cacheKey = getModelCacheKey(filename);
    const match = await cache.match(cacheKey);
    if (match) {
      const buffer = await match.clone().arrayBuffer();
      if (isValidTfliteBuffer(buffer)) {
        return true;
      }
      // Corrupted or HTML response cached previously -> purge it
      await cache.delete(cacheKey);
    }
    return false;
  } catch (err) {
    console.warn(`[LiteRT Cache] Error checking cache for ${filename}:`, err);
    return false;
  }
}

/**
 * Retrieves a model from the browser Cache Storage API.
 * Never re-downloads a model that is already cached.
 * If not in cache, fetches from Cloudflare R2 / server endpoint and stores into Cache Storage.
 */
export async function getModelBytesFromCacheOrR2(
  filename: string,
  onProgress?: (receivedBytes: number, totalBytes: number) => void
): Promise<Uint8Array> {
  const cacheKey = getModelCacheKey(filename);

  // 1. Check Cache Storage API first
  if (typeof window !== "undefined" && "caches" in window) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        const buffer = await cachedResponse.arrayBuffer();
        if (isValidTfliteBuffer(buffer)) {
          console.log(`[LiteRT Cache] Model "${filename}" loaded directly from Cache Storage API (${buffer.byteLength} bytes)`);
          return new Uint8Array(buffer);
        } else {
          console.warn(`[LiteRT Cache] Cached response for "${filename}" is invalid/HTML. Purging from cache...`);
          await cache.delete(cacheKey);
        }
      }
    } catch (cacheErr) {
      console.warn(`[LiteRT Cache] Cache match error for ${filename}:`, cacheErr);
    }
  }

  // 2. Not cached: Download from R2 / server proxy
  console.log(`[LiteRT Cache] Model "${filename}" downloading from R2 /Models/...`);
  const urlsToTry = getModelFetchUrls(filename);
  let lastError: Error | null = null;
  let validBytes: Uint8Array | null = null;

  for (const url of urlsToTry) {
    try {
      const res = await fetch(url);
      const cType = res.headers.get("content-type") || "";
      if (res.ok && !cType.includes("text/html")) {
        const arrayBuffer = await res.arrayBuffer();
        if (isValidTfliteBuffer(arrayBuffer)) {
          validBytes = new Uint8Array(arrayBuffer);
          console.log(`[LiteRT Cache] Successfully fetched model "${filename}" from ${url} (${validBytes.byteLength} bytes)`);
          break;
        }
      }
    } catch (fetchErr: any) {
      lastError = fetchErr;
    }
  }

  if (!validBytes) {
    const msg = lastError?.message || `Failed to fetch valid LiteRT model ${filename} from R2 /Models/`;
    console.error(`[LiteRT Cache Error]:`, msg);
    throw new Error(msg);
  }

  if (onProgress) {
    onProgress(validBytes.length, validBytes.length);
  }

  // Store in Cache Storage API
  if (typeof window !== "undefined" && "caches" in window) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const responseToCache = new Response(validBytes as any, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(validBytes.byteLength),
          "Cache-Control": "public, max-age=31536000, immutable"
        }
      });
      await cache.put(cacheKey, responseToCache);
      console.log(`[LiteRT Cache] Successfully cached "${filename}" (${validBytes.byteLength} bytes) in Cache Storage API`);
    } catch (putErr) {
      console.warn(`[LiteRT Cache] Failed to put ${filename} into Cache Storage API:`, putErr);
    }
  }

  return validBytes;
}

// ─────────────────────────────────────────────
// Startup Preload State Management
// ─────────────────────────────────────────────

export interface StartupPreloadState {
  isDownloading: boolean;
  isCached: boolean;
  hasError: boolean;
  errorMessage: string | null;
}

let startupPreloadState: StartupPreloadState = {
  isDownloading: false,
  isCached: false,
  hasError: false,
  errorMessage: null
};

const startupListeners = new Set<(state: StartupPreloadState) => void>();

export function getStartupPreloadState(): StartupPreloadState {
  return { ...startupPreloadState };
}

export function subscribeStartupPreload(listener: (state: StartupPreloadState) => void): () => void {
  startupListeners.add(listener);
  listener(getStartupPreloadState());
  return () => startupListeners.delete(listener);
}

function updateStartupState(partial: Partial<StartupPreloadState>) {
  startupPreloadState = { ...startupPreloadState, ...partial };
  startupListeners.forEach((l) => l(getStartupPreloadState()));
}

/**
 * App startup — always, unconditionally:
 * On app load, immediately start downloading batch 1 model from /Models in the background using Cache Storage API.
 */
export function preloadStartupModel(): void {
  if (typeof window === "undefined") return;

  const modelFilename = LITE_RT_MODELS[1].filename;

  // Check if already cached
  isModelCached(modelFilename).then((cached) => {
    if (cached) {
      updateStartupState({ isCached: true, isDownloading: false, hasError: false, errorMessage: null });
      return;
    }

    updateStartupState({ isDownloading: true, hasError: false, errorMessage: null });

    getModelBytesFromCacheOrR2(modelFilename)
      .then(() => {
        updateStartupState({ isDownloading: false, isCached: true, hasError: false, errorMessage: null });
      })
      .catch((err) => {
        console.warn(`[Startup Preload] ${modelFilename} download failed:`, err);
        updateStartupState({
          isDownloading: false,
          isCached: false,
          hasError: true,
          errorMessage: "Detection unavailable — please check your connection and reload."
        });
      });
  });
}

/**
 * Manually retry startup model download
 */
export async function retryStartupModelDownload(): Promise<void> {
  const modelFilename = LITE_RT_MODELS[1].filename;
  updateStartupState({ isDownloading: true, hasError: false, errorMessage: null });
  try {
    await getModelBytesFromCacheOrR2(modelFilename);
    updateStartupState({ isDownloading: false, isCached: true, hasError: false, errorMessage: null });
  } catch (err: any) {
    updateStartupState({
      isDownloading: false,
      isCached: false,
      hasError: true,
      errorMessage: "Detection unavailable — please check your connection and reload."
    });
  }
}

// ─────────────────────────────────────────────
// User Batch Preference (CONVERT page)
// ─────────────────────────────────────────────

export function getConvertBatchPreference(): BatchSize | null {
  if (typeof localStorage === "undefined") return null;
  const val = localStorage.getItem(PREF_KEY);
  if (val === "1" || val === "4" || val === "8" || val === "16" || val === "32") {
    return parseInt(val, 10) as BatchSize;
  }
  return null;
}

export function setConvertBatchPreference(batch: BatchSize): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(PREF_KEY, String(batch));
  }
}
