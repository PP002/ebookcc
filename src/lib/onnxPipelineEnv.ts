/**
 * Shared ONNX Pipeline Environment, Diagnostics, and Canvas Reuse Pool
 */

import * as ort from "onnxruntime-web/webgpu";

let hasLoggedEnvInit = false;

/**
 * Log ONNX runtime and browser environment once at initialization
 */
export function logOnnxEnvInitOnce(provider: "webgpu" | "wasm"): void {
  if (hasLoggedEnvInit) return;
  hasLoggedEnvInit = true;

  const crossOriginIsolated =
    typeof self !== "undefined" ? Boolean(self.crossOriginIsolated) : false;
  const hardwareConcurrency =
    typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined;

  console.log("[ONNX Runtime Init]", {
    provider,
    numThreads: ort.env.wasm.numThreads,
    crossOriginIsolated,
    hardwareConcurrency
  });
}

/**
 * Configure ONNX runtime environment:
 * - Thread count: Math.min(4, navigator.hardwareConcurrency || 2) if self.crossOriginIsolated === true, else 1
 * - WASM paths: /wasm/onnx/ (hosted on Cloudflare R2)
 * - Proxy: true for WASM only, false for WebGPU
 */
export function configureOnnxEnvironment(provider: "webgpu" | "wasm" = "wasm"): void {
  if (typeof self === "undefined") return;

  const isIsolated = Boolean(self.crossOriginIsolated);
  const concurrency = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency || 2) : 2;
  const threads = isIsolated ? Math.min(4, concurrency) : 1;

  ort.env.wasm.numThreads = threads;

  // Resolve absolute origin so worker/pthread scripts are fetched from /wasm/onnx/ directly,
  // never falling back to current page route (e.g. /convert)
  const origin = typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : (typeof self !== "undefined" && self.location?.origin ? self.location.origin : "");
  const basePath = origin ? `${origin}/wasm/onnx/` : "/wasm/onnx/";

  ort.env.wasm.wasmPaths = basePath;

  // NEVER set proxy = true. In bundled ESM web apps and Web Workers, proxy = true triggers
  // self.location.href fetch (SPA HTML /convert) causing COEP frame blocks and crashes.
  ort.env.wasm.proxy = false;
}

// ─────────────────────────────────────────────
// Canvas Reuse Pool (1.2)
// For repeated getImageData reads with { willReadFrequently: true }
// ─────────────────────────────────────────────

interface PooledCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

let yoloReusableCanvas: PooledCanvas | null = null;
let detReusableCanvas: PooledCanvas | null = null;
let recReusableCanvas: PooledCanvas | null = null;
let origScratchCanvas: PooledCanvas | null = null;

export function getReusableYoloCanvas(width = 640, height = 640): PooledCanvas {
  if (!yoloReusableCanvas) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    yoloReusableCanvas = { canvas, ctx };
  }
  return yoloReusableCanvas;
}

export function getReusableDetCanvas(width: number, height: number): PooledCanvas {
  if (!detReusableCanvas) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    detReusableCanvas = { canvas, ctx };
  } else {
    if (detReusableCanvas.canvas.width !== width || detReusableCanvas.canvas.height !== height) {
      detReusableCanvas.canvas.width = width;
      detReusableCanvas.canvas.height = height;
    }
  }
  return detReusableCanvas;
}

export function getReusableRecCanvas(width: number, height: number): PooledCanvas {
  if (!recReusableCanvas) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(width, 512);
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    recReusableCanvas = { canvas, ctx };
  } else {
    if (recReusableCanvas.canvas.width < width || recReusableCanvas.canvas.height !== height) {
      recReusableCanvas.canvas.width = Math.max(width, recReusableCanvas.canvas.width);
      recReusableCanvas.canvas.height = height;
    }
  }
  return recReusableCanvas;
}

export function getReusableOrigScratchCanvas(width: number, height: number): PooledCanvas {
  if (!origScratchCanvas) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    origScratchCanvas = { canvas, ctx };
  } else {
    if (origScratchCanvas.canvas.width !== width || origScratchCanvas.canvas.height !== height) {
      origScratchCanvas.canvas.width = width;
      origScratchCanvas.canvas.height = height;
    }
  }
  return origScratchCanvas;
}

// ─────────────────────────────────────────────
// Background Runtime Prefetch & Cache Storage
// ─────────────────────────────────────────────

export const ONNX_RUNTIME_CACHE_NAME = "onnx-runtime-wasm-v1";

export const ONNX_RUNTIME_FILES = [
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm"
];

let preloadPromise: Promise<void> | null = null;

/**
 * Checks whether WebGPU & WASM runtime files are already cached in browser Cache Storage.
 */
export async function isOnnxRuntimeCached(): Promise<boolean> {
  if (typeof window === "undefined" || !("caches" in window)) return false;
  try {
    const cache = await caches.open(ONNX_RUNTIME_CACHE_NAME);
    const origin = window.location.origin;
    const match = await cache.match(`${origin}/wasm/onnx/ort-wasm-simd-threaded.asyncify.mjs`);
    return !!match;
  } catch (_) {
    return false;
  }
}

/**
 * Fetches WebGPU & WASM runtime files in background when the web app loads
 * and stores them in browser Cache Storage for instant offline/low-latency startup.
 */
export function preloadOnnxRuntimesInBackground(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (preloadPromise) return preloadPromise;

  preloadPromise = (async () => {
    // Wait until browser main thread is idle so app initial render completes first
    await new Promise<void>((resolve) => {
      if ("requestIdleCallback" in window) {
        (window as any).requestIdleCallback(() => resolve(), { timeout: 2500 });
      } else {
        setTimeout(resolve, 1200);
      }
    });

    const origin = window.location.origin;
    let cache: Cache | null = null;
    if ("caches" in window) {
      try {
        cache = await caches.open(ONNX_RUNTIME_CACHE_NAME);
      } catch (e) {
        console.debug("[ONNX Preload] Cache Storage unavailable:", e);
      }
    }

    console.log("[ONNX Preload] Background fetching WebGPU & WASM runtime files...");

    const hasWebGpu = typeof navigator !== "undefined" && "gpu" in navigator;
    const prioritizedFiles = hasWebGpu
      ? [
          "ort-wasm-simd-threaded.asyncify.mjs",
          "ort-wasm-simd-threaded.asyncify.wasm",
          "ort-wasm-simd-threaded.jsep.mjs",
          "ort-wasm-simd-threaded.jsep.wasm",
          "ort-wasm-simd-threaded.mjs",
          "ort-wasm-simd-threaded.wasm"
        ]
      : [
          "ort-wasm-simd-threaded.mjs",
          "ort-wasm-simd-threaded.wasm",
          "ort-wasm-simd-threaded.asyncify.mjs",
          "ort-wasm-simd-threaded.asyncify.wasm"
        ];

    for (const filename of prioritizedFiles) {
      const url = `/wasm/onnx/${filename}`;
      const cacheUrl = `${origin}${url}`;

      try {
        if (cache) {
          const match = await cache.match(cacheUrl);
          if (match && match.ok) {
            continue;
          }
        }

        const res = await fetch(url, {
          cache: "force-cache",
          headers: { Accept: "*/*" }
        });

        if (res.ok && res.status === 200) {
          if (cache) {
            try {
              await cache.put(cacheUrl, res.clone());
            } catch (_) {}
          }
        }
      } catch (err: any) {
        console.debug(`[ONNX Preload] Background fetch notice for ${filename}:`, err?.message || err);
      }
    }

    console.log("[ONNX Preload] WebGPU & WASM runtime background cache ready.");
  })();

  return preloadPromise;
}

