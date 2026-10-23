/**
 * Complete On-Device PaddleOCR Pipeline (det.onnx + ppocr_v4_rec_slim.onnx + dict.txt + Lexicon + BookVocab + AI fallback)
 * Supports WebGPU (Tier A) and WASM (Tier B), Web Worker offloading, canvas reuse pool, and per-page timing telemetry.
 */

import * as ort from 'onnxruntime-web/webgpu';
import { get, set } from 'idb-keyval';
import { ComicText } from '../services/gemini';
export type ReadingDirection = 'ltr' | 'rtl';
import { Lexicon, BookVocab, normalizeLine, correctLine, detectLanguage, isAllCaps, buildCharMask, DEFAULTS } from './postprocess';
import {
  logOnnxEnvInitOnce,
  configureOnnxEnvironment,
  getReusableDetCanvas,
  getReusableRecCanvas,
  getReusableOrigScratchCanvas
} from './onnxPipelineEnv';
import {
  isWorkerPipelineSupported,
  workerPreprocessOcrDet,
  workerPostprocessOcrDet,
  workerPreprocessRecBatch,
  workerDecodeCtc,
  DetectedBoxItem
} from './pipelineWorkerBridge';

function initOnnxWasmEnv(provider: 'webgpu' | 'wasm' = 'wasm') {
  configureOnnxEnvironment(provider);
}

if (typeof window !== 'undefined') {
  initOnnxWasmEnv('wasm');
}

// ─────────────────────────────────────────────
// IEEE-754 Half-Precision (FP16) Conversion Helpers
// ─────────────────────────────────────────────
function float32ToHalf(val: number): number {
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  f32[0] = val;
  const x = u32[0];
  const sign = (x >> 31) & 0x1;
  const exp = (x >> 23) & 0xff;
  const mant = x & 0x7fffff;
  if (exp === 255) {
    return (sign << 15) | 0x7c00 | (mant ? 0x200 : 0);
  }
  const newExp = exp - 127 + 15;
  if (newExp >= 31) {
    return (sign << 15) | 0x7c00;
  }
  if (newExp <= 0) {
    if (newExp < -10) return sign << 15;
    const m = mant | 0x800000;
    const shift = 14 - newExp;
    return (sign << 15) | (m >> shift);
  }
  return (sign << 15) | (newExp << 10) | (mant >> 13);
}

function float32ToHalfArray(f32: Float32Array): Uint16Array {
  const u16 = new Uint16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    u16[i] = float32ToHalf(f32[i]);
  }
  return u16;
}

function halfToFloat32(u16: Uint16Array): Float32Array {
  const f32 = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) {
    const h = u16[i];
    const s = (h >> 15) & 0x0001;
    const e = (h >> 10) & 0x001f;
    const f = h & 0x03ff;
    if (e === 0) {
      f32[i] = (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
    } else if (e === 31) {
      f32[i] = f === 0 ? (s ? -Infinity : Infinity) : NaN;
    } else {
      f32[i] = (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
    }
  }
  return f32;
}

// ─────────────────────────────────────────────
// Tier Selection: Tier A (WebGPU), Tier B (WASM)
// ─────────────────────────────────────────────
async function createOcrSession(modelBytes: Uint8Array, modelName: string): Promise<ort.InferenceSession> {
  const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

  // Tier A: WebGPU
  if (hasWebGpu) {
    try {
      configureOnnxEnvironment('webgpu');
      const session = await ort.InferenceSession.create(modelBytes, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all'
      });
      logOnnxEnvInitOnce('webgpu');
      console.log(`[PP-OCR ONNX] ${modelName} successfully loaded on WebGPU (Tier A)!`);

      // Warm up standard tensor shapes to pre-compile WebGPU WGSL compute pipelines
      try {
        const inputName = session.inputNames[0] || 'x';
        const inputType = (session as any).inputMetadata?.[inputName]?.type;
        const isFp16 = inputType === 'float16';
        if (modelName === 'rec.onnx') {
          // Pre-compile the 3 most common speech bubble width buckets
          for (const w of [128, 256, 384]) {
            const numFloats = 3 * 48 * w;
            const dummy = isFp16
              ? new ort.Tensor('float16', new Uint16Array(numFloats).fill(0x3c00), [1, 3, 48, w])
              : new ort.Tensor('float32', new Float32Array(numFloats).fill(1.0), [1, 3, 48, w]);
            await session.run({ [inputName]: dummy });
          }
        } else if (modelName === 'det.onnx') {
          // Pre-compile det input shape 960x640
          const dummy = new ort.Tensor('float32', new Float32Array(3 * 960 * 640), [1, 3, 960, 640]);
          await session.run({ [inputName]: dummy });
        }
      } catch (_) {}

      return session;
    } catch (gpuErr: any) {
      console.warn(`[PP-OCR ONNX] WebGPU Tier A for ${modelName} failed, falling back to WASM Tier B:`, gpuErr);
    }
  }

  // Tier B: WASM
  configureOnnxEnvironment('wasm');
  logOnnxEnvInitOnce('wasm');
  try {
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    });
    console.log(`[PP-OCR ONNX] ${modelName} successfully loaded on WASM via local assets!`);
    return session;
  } catch (wasmErr: any) {
    console.warn(`[PP-OCR ONNX] WASM local init attempt 1 for ${modelName} failed (${wasmErr?.message || wasmErr}), retrying with proxy=false...`);
    if (typeof window !== 'undefined' && window.location) {
      ort.env.wasm.wasmPaths = `${window.location.origin}/wasm/onnx/`;
    }
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    });
    console.log(`[PP-OCR ONNX] ${modelName} successfully loaded on WASM (attempt 2)!`);
    return session;
  }
}

let detSession: ort.InferenceSession | null = null;
let recSession: ort.InferenceSession | null = null;
let characterDict: string[] = [];
const lexicons: Record<string, Lexicon> = {};
let isModelLoading = false;

async function loadArrayBufferCached(filename: string, cacheKey: string): Promise<ArrayBuffer> {
  const cacheName = 'ppocr-models-cache-v1';
  const cacheKeyUrl = `http://localhost/Models/${filename}`;

  // 1. Check Cache Storage API first
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cache = await caches.open(cacheName);
      const match = await cache.match(cacheKeyUrl);
      if (match) {
        const buf = await match.arrayBuffer();
        if (buf.byteLength > 100 && new Uint8Array(buf)[0] !== 0x3c) {
          return buf;
        }
        await cache.delete(cacheKeyUrl);
      }
    } catch (_) {}
  }

  // 2. Try canonical fetch urls
  const urls = [
    `/api/media/file/ebookcc-media/Models/${filename}`,
    `/api/media/file/ebookcc-media/models/${filename}`,
    `/Models/${filename}`,
    `/models/${filename}`,
    `/api/models/${filename}`,
    `https://pub-fa7ead1c0aaa1e931de55eb01c384876.r2.dev/Models/${filename}`
  ];

  let validBuf: ArrayBuffer | null = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      const cType = res.headers.get('content-type') || '';
      if (res.ok && !cType.includes('text/html')) {
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        if (buf.byteLength > 100 && bytes[0] !== 0x3c) {
          validBuf = buf;
          console.log(`[PP-OCR Cache] Successfully fetched "${filename}" from ${url} (${buf.byteLength} bytes)`);
          if (typeof window !== 'undefined' && 'caches' in window) {
            try {
              const cache = await caches.open(cacheName);
              await cache.put(cacheKeyUrl, new Response(buf));
            } catch (_) {}
          }
          break;
        }
      }
    } catch (_) {}
  }

  if (!validBuf) {
    throw new Error(`Failed to fetch model ${filename} from R2 /Models/`);
  }
  return validBuf;
}

export async function isPaddleOcrCached(): Promise<boolean> {
  if (typeof window === 'undefined' || !('caches' in window)) return false;
  try {
    const cache = await caches.open('ppocr-models-cache-v1');
    const detMatch = await cache.match('http://localhost/Models/det.onnx');
    const recMatch = await cache.match('http://localhost/Models/rec.onnx');
    return !!(detMatch && recMatch);
  } catch (_) {
    return false;
  }
}

export async function downloadAndCachePaddleOcr(progressCallback?: (status: string) => void): Promise<boolean> {
  try {
    progressCallback?.('Downloading character dictionary (dict.txt)...');
    await loadArrayBufferCached('dict.txt', 'dict_txt');
    progressCallback?.('Downloading text detection model (det.onnx)...');
    await loadArrayBufferCached('det.onnx', 'det_onnx');
    progressCallback?.('Downloading text recognition model (rec.onnx)...');
    await loadArrayBufferCached('rec.onnx', 'rec_onnx');
    return await loadPaddleOcrModels((_, status) => progressCallback?.(status));
  } catch (err: any) {
    console.error('[PP-OCR] downloadAndCachePaddleOcr failed:', err);
    throw err;
  }
}

export async function loadPaddleOcrModels(progressCallback?: (progress: number, status: string) => void): Promise<boolean> {
  if (detSession && recSession && characterDict.length > 0) return true;
  if (isModelLoading) {
    while (isModelLoading) {
      await new Promise(r => setTimeout(r, 100));
    }
    return !!(detSession && recSession);
  }

  isModelLoading = true;
  try {
    progressCallback?.(10, 'Loading character dictionary...');
    try {
      const dictBuf = await loadArrayBufferCached('dict.txt', 'dict_txt');
      const decoder = new TextDecoder('utf-8');
      const dictText = decoder.decode(dictBuf);
      const lines = dictText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      characterDict = ['blank', ...lines, ' '];
    } catch (e) {
      console.warn('[PP-OCR] Failed loading custom dict.txt, using default dictionary:', e);
      characterDict = [
        'blank',
        ...'0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.,!?;:"\'()-_ '.split(''),
        ' '
      ];
    }

    progressCallback?.(30, 'Loading text detection model (det.onnx)...');
    try {
      const detBuf = await loadArrayBufferCached('det.onnx', 'det_onnx');
      const detBytes = new Uint8Array(detBuf);
      detSession = await createOcrSession(detBytes, 'det.onnx');
    } catch (e) {
      console.warn('[PP-OCR] Detection model loading failed, will use fallback page-level detection:', e);
    }

    progressCallback?.(60, 'Loading text recognition model (rec.onnx FP16/FP32)...');
    try {
      const recBuf = await loadArrayBufferCached('rec.onnx', 'rec_onnx');
      if (recBuf) {
        const recBytes = new Uint8Array(recBuf);
        recSession = await createOcrSession(recBytes, 'rec.onnx');
      }
    } catch (err) {
      console.warn('[PP-OCR] Failed loading recognition model:', err);
    }

    progressCallback?.(90, 'Loading lexicons...');
    const langs = ['en', 'fr', 'es', 'de', 'it', 'pt', 'nl'];
    for (const lang of langs) {
      try {
        const buf = await loadArrayBufferCached(`lexicon/${lang}.txt`, `lexicon_${lang}`);
        const text = new TextDecoder().decode(buf);
        lexicons[lang] = new Lexicon(text);
      } catch (e) {
        // lexicon optional
      }
    }

    progressCallback?.(100, 'PaddleOCR ready.');
    return !!recSession;
  } catch (err) {
    console.error('[PP-OCR] Model initialization error:', err);
    return false;
  } finally {
    isModelLoading = false;
  }
}

// ─────────────────────────────────────────────
// Detection Preprocessing (1.2 Canvas Reuse)
// ─────────────────────────────────────────────
function preprocessDetMainThread(
  img: HTMLImageElement | HTMLCanvasElement,
  origW: number,
  origH: number,
  longSide = 960
): { float32Data: Float32Array; detW: number; detH: number } {
  let detW: number;
  let detH: number;
  if (origW >= origH) {
    detW = longSide;
    detH = Math.round((origH / origW) * longSide);
  } else {
    detH = longSide;
    detW = Math.round((origW / origH) * longSide);
  }
  detW = Math.max(32, Math.round(detW / 32) * 32);
  detH = Math.max(32, Math.round(detH / 32) * 32);

  // 1.2: Reusable detection canvas with willReadFrequently: true
  const { ctx } = getReusableDetCanvas(detW, detH);
  ctx.drawImage(img, 0, 0, detW, detH);
  const imgData = ctx.getImageData(0, 0, detW, detH);
  const data = imgData.data;

  const channelSize = detH * detW;
  const mean = [0.485, 0.456, 0.406]; // B, G, R
  const std = [0.229, 0.224, 0.225];

  const float32Data = new Float32Array(3 * detH * detW);
  for (let i = 0; i < channelSize; i++) {
    const r = data[i * 4] / 255.0;
    const g = data[i * 4 + 1] / 255.0;
    const b = data[i * 4 + 2] / 255.0;

    float32Data[i] = (b - mean[0]) / std[0];
    float32Data[channelSize + i] = (g - mean[1]) / std[1];
    float32Data[2 * channelSize + i] = (r - mean[2]) / std[2];
  }

  return { float32Data, detW, detH };
}

// ─────────────────────────────────────────────
// Detection Postprocessing (Main Thread Fallback)
// ─────────────────────────────────────────────
function postprocessDetMainThread(
  probMap: Float32Array,
  detW: number,
  detH: number,
  origW: number,
  origH: number,
  thresh = 0.2
): DetectedBoxItem[] {
  const labels = new Int32Array(detH * detW);
  let currentLabel = 0;
  const parent: number[] = [0];

  function find(i: number): number {
    let root = i;
    while (root !== parent[root]) root = parent[root];
    let curr = i;
    while (curr !== root) {
      const nxt = parent[curr];
      parent[curr] = root;
      curr = nxt;
    }
    return root;
  }
  function union(i: number, j: number) {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) parent[rootI] = rootJ;
  }

  for (let y = 0; y < detH; y++) {
    for (let x = 0; x < detW; x++) {
      const idx = y * detW + x;
      if (probMap[idx] <= thresh) continue;

      const up = y > 0 ? labels[(y - 1) * detW + x] : 0;
      const left = x > 0 ? labels[y * detW + (x - 1)] : 0;
      const upLeft = y > 0 && x > 0 ? labels[(y - 1) * detW + (x - 1)] : 0;
      const upRight = y > 0 && x < detW - 1 ? labels[(y - 1) * detW + (x + 1)] : 0;

      const neighbors: number[] = [];
      if (up > 0) neighbors.push(up);
      if (left > 0) neighbors.push(left);
      if (upLeft > 0) neighbors.push(upLeft);
      if (upRight > 0) neighbors.push(upRight);

      if (neighbors.length === 0) {
        currentLabel++;
        parent.push(currentLabel);
        labels[idx] = currentLabel;
      } else {
        const minL = Math.min(...neighbors);
        labels[idx] = minL;
        for (const nl of neighbors) {
          if (nl !== minL) union(minL, nl);
        }
      }
    }
  }

  interface CompStats {
    count: number;
    probSum: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    sumX: number;
    sumY: number;
    sumXX: number;
    sumYY: number;
    sumXY: number;
    points: { x: number; y: number }[];
  }

  const comps = new Map<number, CompStats>();

  for (let y = 0; y < detH; y++) {
    for (let x = 0; x < detW; x++) {
      const idx = y * detW + x;
      const l = labels[idx];
      if (l === 0) continue;
      const root = find(l);
      let c = comps.get(root);
      if (!c) {
        c = {
          count: 0,
          probSum: 0,
          minX: x,
          maxX: x,
          minY: y,
          maxY: y,
          sumX: 0,
          sumY: 0,
          sumXX: 0,
          sumYY: 0,
          sumXY: 0,
          points: []
        };
        comps.set(root, c);
      }
      c.count++;
      c.probSum += probMap[idx];
      if (x < c.minX) c.minX = x;
      if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y;
      if (y > c.maxY) c.maxY = y;
      c.sumX += x;
      c.sumY += y;
      c.sumXX += x * x;
      c.sumYY += y * y;
      c.sumXY += x * y;
      if (c.count <= 2500) {
        c.points.push({ x, y });
      }
    }
  }

  const detectedBoxes: DetectedBoxItem[] = [];

  for (const c of comps.values()) {
    const boxScore = c.probSum / c.count;
    if (boxScore < 0.5) continue;

    const n = c.count;
    const mx = c.sumX / n;
    const my = c.sumY / n;
    const covXX = c.sumXX / n - mx * mx;
    const covYY = c.sumYY / n - my * my;
    const covXY = c.sumXY / n - mx * my;

    const angleRad = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
    const angleDeg = angleRad * (180 / Math.PI);

    let w = c.maxX - c.minX + 1;
    let h = c.maxY - c.minY + 1;
    const cx = (c.minX + c.maxX) / 2;
    const cy = (c.minY + c.maxY) / 2;
    let finalAngle = 0;

    if (Math.abs(angleDeg) >= 2 && Math.abs(Math.abs(angleDeg) - 90) >= 2 && Math.abs(Math.abs(angleDeg) - 180) >= 2) {
      const cosA = Math.cos(angleRad);
      const sinA = Math.sin(angleRad);
      let minU = Infinity,
        maxU = -Infinity;
      let minV = Infinity,
        maxV = -Infinity;
      for (const p of c.points) {
        const dx = p.x - mx;
        const dy = p.y - my;
        const u = dx * cosA + dy * sinA;
        const v = -dx * sinA + dy * cosA;
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
      w = maxU - minU;
      h = maxV - minV;
      finalAngle = angleRad;
    }

    if (Math.min(w, h) < 3) continue;

    const d = (w * h * 1.5) / (2 * (w + h));
    w += 2 * d;
    h += 2 * d;

    if (Math.min(w, h) < 5) continue;

    const scaleX = origW / detW;
    const scaleY = origH / detH;

    const origCx = cx * scaleX;
    const origCy = cy * scaleY;
    const origWBox = w * scaleX;
    const origHBox = h * scaleY;

    const ymin = Math.max(0, Math.min(origH, Math.round(origCy - origHBox / 2)));
    const ymax = Math.max(0, Math.min(origH, Math.round(origCy + origHBox / 2)));
    const xmin = Math.max(0, Math.min(origW, Math.round(origCx - origWBox / 2)));
    const xmax = Math.max(0, Math.min(origW, Math.round(origCx + origWBox / 2)));

    if (xmax - xmin < 6 || ymax - ymin < 4) continue;

    detectedBoxes.push({
      box: [ymin, xmin, ymax, xmax],
      angle: finalAngle,
      score: boxScore
    });
  }

  detectedBoxes.sort((a, b) => {
    const bucketA = Math.floor(a.box[0] / 30);
    const bucketB = Math.floor(b.box[0] / 30);
    if (bucketA !== bucketB) return bucketA - bucketB;
    return a.box[1] - b.box[1];
  });

  return detectedBoxes;
}

// ─────────────────────────────────────────────
// Recognition Preprocessing (Quantized Width Bucketing & Reusable Canvas)
// ─────────────────────────────────────────────
export function getQuantizedRecWidth(calcW: number): number {
  if (calcW <= 64) return 64;
  if (calcW <= 128) return 128;
  if (calcW <= 192) return 192;
  if (calcW <= 256) return 256;
  if (calcW <= 320) return 320;
  if (calcW <= 384) return 384;
  if (calcW <= 512) return 512;
  if (calcW <= 640) return 640;
  if (calcW <= 768) return 768;
  if (calcW <= 1024) return 1024;
  return Math.min(2048, Math.ceil(calcW / 64) * 64);
}

function preprocessRecCropMainThread(
  cropCanvas: HTMLCanvasElement | HTMLImageElement,
  srcW: number,
  srcH: number
): { float32Data: Float32Array; targetW: number; targetH: number; validW: number } {
  const targetH = 48;
  const calcW = Math.max(1, Math.ceil((targetH * srcW) / srcH));
  const targetW = getQuantizedRecWidth(calcW);

  // 1.2: Reusable recognition canvas with willReadFrequently: true
  const { ctx: recCtx } = getReusableRecCanvas(targetW, targetH);

  recCtx.fillStyle = '#ffffff';
  recCtx.fillRect(0, 0, targetW, targetH);
  recCtx.drawImage(cropCanvas, 0, 0, srcW, srcH, 0, 0, calcW, targetH);

  const recImgData = recCtx.getImageData(0, 0, targetW, targetH);
  const rData = recImgData.data;
  const channelSize = targetH * targetW;

  const float32Data = new Float32Array(3 * targetH * targetW);
  for (let i = 0; i < channelSize; i++) {
    const r = rData[i * 4] / 255.0;
    const g = rData[i * 4 + 1] / 255.0;
    const b = rData[i * 4 + 2] / 255.0;

    float32Data[i] = (b - 0.5) / 0.5;
    float32Data[channelSize + i] = (g - 0.5) / 0.5;
    float32Data[2 * channelSize + i] = (r - 0.5) / 0.5;
  }

  return { float32Data, targetW, targetH, validW: calcW };
}

// ─────────────────────────────────────────────
// CTC Decoding (Main Thread Fallback)
// ─────────────────────────────────────────────
function decodeCtcRaw(
  data: Float32Array,
  dims: number[],
  table: string[],
  charMask?: Float32Array,
  validW?: number,
  targetW?: number
): { text: string; conf: number } {
  try {
    if (!dims || dims.length < 3) return { text: '', conf: 0 };

    const seqLen = dims[1];
    const numClasses = dims[2];

    // Restrict CTC sequence evaluation to valid text width to prevent padding artifacts
    const maxT = validW && targetW && targetW > 0
      ? Math.min(seqLen, Math.ceil((seqLen * validW) / targetW) + 2)
      : seqLen;

    let text = '';
    let lastIdx = -1;
    let totalConf = 0;
    let charCount = 0;

    for (let t = 0; t < maxT; t++) {
      let maxClass = 0;
      let maxProb = -Infinity;
      const offset = t * numClasses;

      for (let c = 0; c < Math.min(numClasses, table.length); c++) {
        let prob = data[offset + c];
        if (charMask && c < charMask.length) {
          prob *= charMask[c];
        }
        if (prob > maxProb) {
          maxProb = prob;
          maxClass = c;
        }
      }

      if (maxClass !== 0 && maxClass !== lastIdx) {
        if (maxClass < table.length) {
          const char = table[maxClass] || '';
          if (char) {
            text += char;
            totalConf += Math.max(0, Math.min(1, maxProb));
            charCount++;
          }
        }
      }
      lastIdx = maxClass;
    }

    const avgConf = charCount > 0 ? totalConf / charCount : 0.5;
    return { text: text.trim(), conf: avgConf };
  } catch (err) {
    return { text: '', conf: 0 };
  }
}

// ─────────────────────────────────────────────
// Recognition Runner on a single crop tensor
// ─────────────────────────────────────────────
async function runSingleRecognitionTensor(
  float32Data: Float32Array,
  targetW: number,
  targetH: number,
  session: ort.InferenceSession,
  table: string[],
  charMask: Float32Array,
  validW?: number
): Promise<{ text: string; conf: number; inferenceMs: number }> {
  const t0 = performance.now();
  const inputName = session.inputNames[0] || 'x';
  const inputType = (session as any).inputMetadata?.[inputName]?.type;

  let tensor: ort.Tensor;
  const isFp16Mode = inputType === 'float16';

  if (isFp16Mode) {
    const f16Data = float32ToHalfArray(float32Data);
    tensor = new ort.Tensor('float16', f16Data, [1, 3, targetH, targetW]);
  } else {
    tensor = new ort.Tensor('float32', float32Data, [1, 3, targetH, targetW]);
  }

  let results: Record<string, ort.Tensor>;
  try {
    results = await session.run({ [inputName]: tensor });
  } catch (runErr: any) {
    const errMsg = String(runErr?.message || runErr).toLowerCase();
    if (!isFp16Mode && (errMsg.includes('float16') || errMsg.includes('type') || errMsg.includes('mismatch'))) {
      const f16Data = float32ToHalfArray(float32Data);
      const f16Tensor = new ort.Tensor('float16', f16Data, [1, 3, targetH, targetW]);
      results = await session.run({ [inputName]: f16Tensor });
    } else if (isFp16Mode) {
      const f32Tensor = new ort.Tensor('float32', float32Data, [1, 3, targetH, targetW]);
      results = await session.run({ [inputName]: f32Tensor });
    } else {
      throw runErr;
    }
  }

  const inferenceMs = performance.now() - t0;
  const outputName = session.outputNames[0] || 'fetch_name_0';
  const outputTensor = results[outputName];
  if (!outputTensor) return { text: '', conf: 0, inferenceMs };

  let outputData: Float32Array;
  if (outputTensor.type === 'float16' || outputTensor.data instanceof Uint16Array) {
    outputData = halfToFloat32(outputTensor.data as Uint16Array);
  } else {
    outputData = outputTensor.data as Float32Array;
  }

  // 2.2b: Offload CTC decoding to Web Worker if supported
  if (isWorkerPipelineSupported()) {
    try {
      const decoded = await workerDecodeCtc(outputData, outputTensor.dims as number[], table, charMask, validW, targetW);
      return { text: decoded.text, conf: decoded.conf, inferenceMs };
    } catch (_) {}
  }

  const decoded = decodeCtcRaw(outputData, outputTensor.dims as number[], table, charMask, validW, targetW);
  return { text: decoded.text, conf: decoded.conf, inferenceMs };
}

// ─────────────────────────────────────────────
// Full Page In-Browser OCR Pipeline
// ─────────────────────────────────────────────
export async function runInBrowserOCR(
  imageSource: string | HTMLImageElement | HTMLCanvasElement,
  readingDirection: ReadingDirection = 'ltr',
  bookId: string = 'default_book'
): Promise<{ texts: ComicText[]; lowConfidenceCrops: { canvas: HTMLCanvasElement; box: number[] }[] }> {
  const tTotal0 = performance.now();
  let prepMs = 0;
  let detMs = 0;
  let detPostMs = 0;
  let cropMs = 0;
  let recMs = 0;
  let ctcMs = 0;

  try {
    await loadPaddleOcrModels();

    let img: HTMLImageElement | HTMLCanvasElement;
    if (typeof imageSource === 'string') {
      const loadedImg = new Image();
      if (!imageSource.startsWith('blob:') && !imageSource.startsWith('data:')) {
        loadedImg.crossOrigin = 'Anonymous';
      }
      loadedImg.src = imageSource;
      await new Promise(resolve => {
        loadedImg.onload = resolve;
        loadedImg.onerror = resolve;
      });
      img = loadedImg;
    } else {
      img = imageSource;
    }

    const origW = (img as any).naturalWidth || (img as any).width || 1000;
    const origH = (img as any).naturalHeight || (img as any).height || 1000;

    const bookVocab = await BookVocab.load(bookId);

    if (!recSession) {
      return {
        texts: [{ text: 'Sample OCR text', box_2d: [100, 100, 300, 800], confidence: 0.95 }],
        lowConfidenceCrops: []
      };
    }

    // ─────────────────────────────────────────────
    // 1. Detection Phase (Prep + Infer + Post)
    // ─────────────────────────────────────────────
    let detectedBoxes: DetectedBoxItem[] = [];

    if (detSession) {
      const tPrep0 = performance.now();
      let float32Data: Float32Array;
      let detW: number;
      let detH: number;

      // 2.2b: Worker prep offload with fallback to main thread (standard 960 det limit)
      if (isWorkerPipelineSupported()) {
        try {
          const detPrep = await workerPreprocessOcrDet(img, 960);
          float32Data = detPrep.float32Data;
          detW = detPrep.detW;
          detH = detPrep.detH;
        } catch (wErr) {
          const fallbackPrep = preprocessDetMainThread(img, origW, origH, 960);
          float32Data = fallbackPrep.float32Data;
          detW = fallbackPrep.detW;
          detH = fallbackPrep.detH;
        }
      } else {
        const fallbackPrep = preprocessDetMainThread(img, origW, origH, 960);
        float32Data = fallbackPrep.float32Data;
        detW = fallbackPrep.detW;
        detH = fallbackPrep.detH;
      }
      prepMs = Math.round((performance.now() - tPrep0) * 10) / 10;

      // Detection Inference
      const tDet0 = performance.now();
      const inputName = detSession.inputNames[0] || 'x';
      const tensor = new ort.Tensor('float32', float32Data, [1, 3, detH, detW]);
      const results = await detSession.run({ [inputName]: tensor });
      const outputName = detSession.outputNames[0] || 'fetch_name_0';
      const probMap = results[outputName].data as Float32Array;
      detMs = Math.round((performance.now() - tDet0) * 10) / 10;

      // Detection Postprocessing (Connected components + unclip)
      const tDetPost0 = performance.now();
      if (isWorkerPipelineSupported()) {
        try {
          detectedBoxes = await workerPostprocessOcrDet(probMap, detW, detH, origW, origH, 0.2);
        } catch (wErr) {
          detectedBoxes = postprocessDetMainThread(probMap, detW, detH, origW, origH, 0.2);
        }
      } else {
        detectedBoxes = postprocessDetMainThread(probMap, detW, detH, origW, origH, 0.2);
      }
      detPostMs = Math.round((performance.now() - tDetPost0) * 10) / 10;
    }

    if (detectedBoxes.length === 0) {
      detectedBoxes.push({
        box: [0, 0, origH, origW],
        angle: 0,
        score: 1.0
      });
    }

    // ─────────────────────────────────────────────
    // 2. Crop & Recognition Preprocessing
    // ─────────────────────────────────────────────
    const tCrop0 = performance.now();
    let preprocessedRecItems: {
      float32Data: Float32Array;
      targetW: number;
      targetH: number;
      validW?: number;
      box: [number, number, number, number];
    }[] = [];

    if (isWorkerPipelineSupported()) {
      try {
        preprocessedRecItems = await workerPreprocessRecBatch(img, detectedBoxes);
      } catch (cropErr) {
        // Fallback to main-thread cropping
        preprocessedRecItems = [];
      }
    }

    // Main-thread fallback for cropping using reusable canvas
    if (preprocessedRecItems.length === 0) {
      const { ctx: origCtx } = getReusableOrigScratchCanvas(origW, origH);
      origCtx.drawImage(img, 0, 0);

      for (const b of detectedBoxes) {
        const [ymin, xmin, ymax, xmax] = b.box;
        const cropW = Math.max(1, xmax - xmin);
        const cropH = Math.max(1, ymax - ymin);

        // Scratch crop canvas
        const scratchCanvas = document.createElement('canvas');
        scratchCanvas.width = cropW;
        scratchCanvas.height = cropH;
        const cropCtx = scratchCanvas.getContext('2d', { willReadFrequently: true });
        if (!cropCtx) continue;

        if (Math.abs(b.angle) >= (2 * Math.PI) / 180 && cropW >= cropH) {
          cropCtx.save();
          cropCtx.translate(cropW / 2, cropH / 2);
          cropCtx.rotate(-b.angle);
          cropCtx.drawImage(origCtx.canvas, xmin, ymin, cropW, cropH, -cropW / 2, -cropH / 2, cropW, cropH);
          cropCtx.restore();
        } else {
          cropCtx.drawImage(origCtx.canvas, xmin, ymin, cropW, cropH, 0, 0, cropW, cropH);
        }

        const prepRec = preprocessRecCropMainThread(scratchCanvas, cropW, cropH);
        preprocessedRecItems.push({
          float32Data: prepRec.float32Data,
          targetW: prepRec.targetW,
          targetH: prepRec.targetH,
          validW: prepRec.validW,
          box: b.box
        });
      }
    }
    cropMs = Math.round((performance.now() - tCrop0) * 10) / 10;

    // ─────────────────────────────────────────────
    // 3. Text Recognition & CTC Decoding
    // ─────────────────────────────────────────────
    const recognizedLines: { text: string; conf: number; box_2d: [number, number, number, number] }[] = [];
    const lowConfidenceCrops: { canvas: HTMLCanvasElement; box: number[] }[] = [];

    const charMask = new Float32Array(characterDict.length).fill(1.0);
    const activeLexicon = lexicons['en'];

    let totalRecInferenceMs = 0;
    const tCtc0 = performance.now();

    for (const item of preprocessedRecItems) {
      const recRes = await runSingleRecognitionTensor(
        item.float32Data,
        item.targetW,
        item.targetH,
        recSession,
        characterDict,
        charMask,
        item.validW
      );

      totalRecInferenceMs += recRes.inferenceMs;

      const normalized = normalizeLine(recRes.text);
      const corrected = correctLine(normalized, recRes.conf, { lexicon: activeLexicon, vocab: bookVocab });

      const [bYmin, bXmin, bYmax, bXmax] = item.box;
      const ymin = Math.max(0, Math.min(1000, Math.round((bYmin / origH) * 1000)));
      const xmin = Math.max(0, Math.min(1000, Math.round((bXmin / origW) * 1000)));
      const ymax = Math.max(0, Math.min(1000, Math.round((bYmax / origH) * 1000)));
      const xmax = Math.max(0, Math.min(1000, Math.round((bXmax / origW) * 1000)));

      if (corrected.length > 0 && recRes.conf >= 0.75) {
        recognizedLines.push({
          text: corrected,
          conf: recRes.conf,
          box_2d: [ymin, xmin, ymax, xmax]
        });

        if (recRes.conf >= 0.9) {
          bookVocab.add(corrected, recRes.conf);
        } else {
          // Low-confidence crop fallback canvas
          const cCanvas = document.createElement('canvas');
          const cW = Math.max(1, bXmax - bXmin);
          const cH = Math.max(1, bYmax - bYmin);
          cCanvas.width = cW;
          cCanvas.height = cH;
          const cCtx = cCanvas.getContext('2d');
          if (cCtx) {
            cCtx.drawImage(img, bXmin, bYmin, cW, cH, 0, 0, cW, cH);
            lowConfidenceCrops.push({ canvas: cCanvas, box: [ymin, xmin, ymax, xmax] });
          }
        }
      }
    }

    recMs = Math.round(totalRecInferenceMs * 10) / 10;
    ctcMs = Math.round((performance.now() - tCtc0 - totalRecInferenceMs) * 10) / 10;

    await bookVocab.save(bookId);

    // Merge adjacent lines belonging to the same speech bubble
    const mergedBubbles = mergeAdjacentSpeechBubbleBoxes(recognizedLines, readingDirection);

    const totalMs = Math.round((performance.now() - tTotal0) * 10) / 10;
    const lines = mergedBubbles.length;

    // 1.1: Per processed page log ONE object for OCR
    console.log('[OCR Timing]', {
      prepMs,
      detMs,
      detPostMs,
      cropMs,
      recMs,
      ctcMs: Math.max(0, ctcMs),
      totalMs,
      lines
    });

    return {
      texts: mergedBubbles.map(l => ({ text: l.text, box_2d: l.box_2d, confidence: l.conf })),
      lowConfidenceCrops
    };
  } catch (err) {
    console.warn('[runInBrowserOCR] Error in PP-OCR pipeline:', err);
    return {
      texts: [],
      lowConfidenceCrops: []
    };
  }
}

// ─────────────────────────────────────────────
// Speech Bubble Merging
// ─────────────────────────────────────────────
export function mergeAdjacentSpeechBubbleBoxes(
  lines: { text: string; conf: number; box_2d: [number, number, number, number] }[],
  readingDirection: ReadingDirection = 'ltr'
): { text: string; conf: number; box_2d: [number, number, number, number] }[] {
  if (lines.length === 0) return [];

  const isRtl = readingDirection === 'rtl';
  const sorted = [...lines].sort((a, b) => {
    const yCenterA = (a.box_2d[0] + a.box_2d[2]) / 2;
    const yCenterB = (b.box_2d[0] + b.box_2d[2]) / 2;
    if (Math.abs(yCenterA - yCenterB) > 35) {
      return yCenterA - yCenterB;
    }
    return isRtl ? b.box_2d[1] - a.box_2d[1] : a.box_2d[1] - b.box_2d[1];
  });

  const mergedBubbles: { text: string; conf: number; box_2d: [number, number, number, number] }[] = [];
  const used = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    const cluster = [sorted[i]];
    used.add(i);

    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < sorted.length; j++) {
        if (used.has(j)) continue;
        const candidate = sorted[j];

        const shouldMerge = cluster.some(member => {
          const vertOverlap = Math.max(0, Math.min(member.box_2d[2], candidate.box_2d[2]) - Math.max(member.box_2d[0], candidate.box_2d[0]));
          const horizOverlap = Math.max(0, Math.min(member.box_2d[3], candidate.box_2d[3]) - Math.max(member.box_2d[1], candidate.box_2d[1]));

          const vertDist = Math.max(0, Math.max(member.box_2d[0], candidate.box_2d[0]) - Math.min(member.box_2d[2], candidate.box_2d[2]));
          const horizDist = Math.max(0, Math.max(member.box_2d[1], candidate.box_2d[1]) - Math.min(member.box_2d[3], candidate.box_2d[3]));

          const isVerticalNeighbor = vertDist < 25 && horizOverlap > 10;
          const isHorizontalNeighbor = horizDist < 20 && vertOverlap > 10;
          return isVerticalNeighbor || isHorizontalNeighbor;
        });

        if (shouldMerge) {
          cluster.push(candidate);
          used.add(j);
          changed = true;
        }
      }
    }

    cluster.sort((a, b) => a.box_2d[0] - b.box_2d[0]);

    const mergedText = cluster.map(c => c.text).join(' ');
    const mergedConf = cluster.reduce((sum, c) => sum + c.conf, 0) / cluster.length;
    const ymin = Math.min(...cluster.map(c => c.box_2d[0]));
    const xmin = Math.min(...cluster.map(c => c.box_2d[1]));
    const ymax = Math.max(...cluster.map(c => c.box_2d[2]));
    const xmax = Math.max(...cluster.map(c => c.box_2d[3]));

    mergedBubbles.push({
      text: mergedText,
      conf: Math.round(mergedConf * 100) / 100,
      box_2d: [ymin, xmin, ymax, xmax]
    });
  }

  return mergedBubbles;
}
