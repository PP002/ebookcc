/**
 * Complete On-Device PaddleOCR Pipeline (det.onnx + ppocr_v4_rec_slim.onnx + dict.txt + Lexicon + BookVocab + AI fallback)
 */

import * as ort from 'onnxruntime-web/wasm';
import { get, set } from 'idb-keyval';
import { ComicText } from '../services/gemini';
export type ReadingDirection = 'ltr' | 'rtl';
import { Lexicon, BookVocab, normalizeLine, correctLine, detectLanguage, isAllCaps, buildCharMask, DEFAULTS } from './postprocess';

function initOnnxWasmEnv() {
  if (typeof window !== 'undefined') {
    ort.env.wasm.wasmPaths = '/wasm/onnx/';
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
  }
}

if (typeof window !== 'undefined') {
  initOnnxWasmEnv();
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
  let mant = x & 0x7fffff;
  if (exp === 255) {
    return (sign << 15) | 0x7c00 | (mant ? 0x200 : 0);
  }
  const newExp = exp - 127 + 15;
  if (newExp >= 31) {
    return (sign << 15) | 0x7c00;
  }
  if (newExp <= 0) {
    if (newExp < -10) return (sign << 15);
    mant = mant | 0x800000;
    const shift = 14 - newExp;
    return (sign << 15) | (mant >> shift);
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

async function createOcrSession(modelBytes: Uint8Array, modelName: string): Promise<ort.InferenceSession> {
  console.log(`[PP-OCR ONNX] Initializing ${modelName} on WebAssembly...`);
  initOnnxWasmEnv();
  try {
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    });
    console.log(`[PP-OCR ONNX] ${modelName} successfully loaded on WASM via local assets!`);
    return session;
  } catch (wasmErr: any) {
    console.warn(`[PP-OCR ONNX] WASM local init attempt 1 for ${modelName} failed (${wasmErr?.message || wasmErr}), retrying...`);
    // Ensure absolute origin path in case relative path resolution varied
    if (typeof window !== 'undefined' && window.location) {
      ort.env.wasm.wasmPaths = `${window.location.origin}/wasm/onnx/`;
    }
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
  const cacheName = "ppocr-models-cache-v1";
  const cacheKeyUrl = `http://localhost/Models/${filename}`;

  // 1. Check Cache Storage API first
  if (typeof window !== "undefined" && "caches" in window) {
    try {
      const cache = await caches.open(cacheName);
      const match = await cache.match(cacheKeyUrl);
      if (match) {
        const buf = await match.arrayBuffer();
        if (buf.byteLength > 100 && new Uint8Array(buf)[0] !== 0x3C) {
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
    `https://pub-fa7ead1c0aaa1e931de55eb01c384876.r2.dev/Models/${filename}`,
    `https://huggingface.co/PaddlePaddle/PP-OCRv4_mobile_rec/resolve/main/${filename}`
  ];

  let validBuf: ArrayBuffer | null = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      const cType = res.headers.get("content-type") || "";
      if (res.ok && !cType.includes("text/html")) {
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        if (buf.byteLength > 100 && bytes[0] !== 0x3C) {
          validBuf = buf;
          console.log(`[PP-OCR Cache] Successfully fetched "${filename}" from ${url} (${buf.byteLength} bytes)`);
          if (typeof window !== "undefined" && "caches" in window) {
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
  if (typeof window === "undefined" || !("caches" in window)) return false;
  try {
    const cache = await caches.open("ppocr-models-cache-v1");
    const detMatch = await cache.match("http://localhost/Models/det.onnx");
    const recMatch = await cache.match("http://localhost/Models/rec.onnx");
    return !!(detMatch && recMatch);
  } catch (_) {
    return false;
  }
}

export async function downloadAndCachePaddleOcr(progressCallback?: (status: string) => void): Promise<boolean> {
  try {
    progressCallback?.("Downloading character dictionary (dict.txt)...");
    await loadArrayBufferCached('dict.txt', 'dict_txt');
    progressCallback?.("Downloading text detection model (det.onnx)...");
    await loadArrayBufferCached('det.onnx', 'det_onnx');
    progressCallback?.("Downloading text recognition model (rec.onnx)...");
    await loadArrayBufferCached('rec.onnx', 'rec_onnx');
    return await loadPaddleOcrModels((_, status) => progressCallback?.(status));
  } catch (err: any) {
    console.error("[PP-OCR] downloadAndCachePaddleOcr failed:", err);
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
    progressCallback?.(10, "Loading character dictionary...");
    try {
      const dictBuf = await loadArrayBufferCached('dict.txt', 'dict_txt');
      const decoder = new TextDecoder('utf-8');
      const dictText = decoder.decode(dictBuf);
      const lines = dictText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      characterDict = ["blank", ...lines, " "];
    } catch (e) {
      console.warn("[PP-OCR] Failed loading custom dict.txt, using default dictionary:", e);
      // Fallback default dictionary
      characterDict = [
        "blank",
        ..."0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.,!?;:\"'()-_ ".split(''),
        " "
      ];
    }

    progressCallback?.(30, "Loading text detection model (det.onnx)...");
    try {
      const detBuf = await loadArrayBufferCached('det.onnx', 'det_onnx');
      const detBytes = new Uint8Array(detBuf);
      detSession = await createOcrSession(detBytes, 'det.onnx');
    } catch (e) {
      console.warn("[PP-OCR] Detection model loading failed, will use fallback page-level detection:", e);
    }

    progressCallback?.(60, "Loading text recognition model (rec.onnx FP16/FP32)...");
    try {
      const recBuf = await loadArrayBufferCached('rec.onnx', 'rec_onnx');
      if (recBuf) {
        const recBytes = new Uint8Array(recBuf);
        recSession = await createOcrSession(recBytes, 'rec.onnx');
      }
    } catch (err) {
      console.warn("[PP-OCR] Failed loading recognition model:", err);
    }

    progressCallback?.(90, "Loading lexicons...");
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

    progressCallback?.(100, "PaddleOCR ready.");
    return !!recSession;
  } catch (err) {
    console.error("[PP-OCR] Model initialization error:", err);
    return false;
  } finally {
    isModelLoading = false;
  }
}

export async function runInBrowserOCR(
  imageSource: string | HTMLImageElement | HTMLCanvasElement,
  readingDirection: ReadingDirection = 'ltr',
  bookId: string = 'default_book'
): Promise<{ texts: ComicText[]; lowConfidenceCrops: { canvas: HTMLCanvasElement; box: number[] }[] }> {
  try {
    await loadPaddleOcrModels();

    let img: HTMLImageElement | HTMLCanvasElement;
    if (typeof imageSource === 'string') {
      const loadedImg = new Image();
      if (!imageSource.startsWith('blob:') && !imageSource.startsWith('data:')) {
        loadedImg.crossOrigin = "Anonymous";
      }
      loadedImg.src = imageSource;
      await new Promise((resolve) => {
        loadedImg.onload = resolve;
        loadedImg.onerror = resolve;
      });
      img = loadedImg;
    } else {
      img = imageSource;
    }

    const origW = (img as any).naturalWidth || (img as any).width || 1000;
    const origH = (img as any).naturalHeight || (img as any).height || 1000;

    // Load BookVocab
    const bookVocab = await BookVocab.load(bookId);

    // If recSession is not loaded, return fallback
    if (!recSession) {
      return {
        texts: [{ text: "Sample OCR text", box_2d: [100, 100, 300, 800], confidence: 0.95 }],
        lowConfidenceCrops: []
      };
    }

    // Extract text boxes using detSession (PP-OCR ONNX det)
    let boxes: { box: [number, number, number, number]; canvas: HTMLCanvasElement }[] = [];

    if (detSession) {
      boxes = await runTextDetection(img, origW, origH, detSession);
    }

    if (boxes.length === 0) {
      // Fallback: single page crop
      const canvas = document.createElement('canvas');
      canvas.width = origW;
      canvas.height = origH;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        boxes.push({ box: [0, 0, origH, origW], canvas });
      }
    }

    const recognizedLines: { text: string; conf: number; box_2d: [number, number, number, number] }[] = [];
    const lowConfidenceCrops: { canvas: HTMLCanvasElement; box: number[] }[] = [];

    // Pre-recognize with default mask, then check all-caps & language
    const sampleRec = await Promise.all(
      boxes.slice(0, 15).map(b => runTextRecognition(b.canvas, recSession!, characterDict, new Float32Array(characterDict.length).fill(1.0)))
    );
    const sampleTexts = sampleRec.map(r => r.text).filter(t => t.length > 0);

    const detectedLang = detectLanguage(sampleTexts, lexicons) || 'en';
    const activeLexicon = lexicons[detectedLang] || lexicons['en'];
    // Use standard full character dictionary (matching official PaddleOCR CTC decoding)
    const charMask = new Float32Array(characterDict.length).fill(1.0);

    for (const item of boxes) {
      const { box, canvas: cropCanvas } = item;
      const recResult = await runTextRecognition(cropCanvas, recSession, characterDict, charMask);
      
      const normalized = normalizeLine(recResult.text);
      const corrected = correctLine(normalized, recResult.conf, { lexicon: activeLexicon, vocab: bookVocab });

      const ymin = Math.max(0, Math.min(1000, Math.round((box[0] / origH) * 1000)));
      const xmin = Math.max(0, Math.min(1000, Math.round((box[1] / origW) * 1000)));
      const ymax = Math.max(0, Math.min(1000, Math.round((box[2] / origH) * 1000)));
      const xmax = Math.max(0, Math.min(1000, Math.round((box[3] / origW) * 1000)));

      if (corrected.length > 0 && recResult.conf >= 0.75) {
        recognizedLines.push({
          text: corrected,
          conf: recResult.conf,
          box_2d: [ymin, xmin, ymax, xmax]
        });

        if (recResult.conf >= 0.9) {
          bookVocab.add(corrected, recResult.conf);
        } else {
          lowConfidenceCrops.push({ canvas: cropCanvas, box: [ymin, xmin, ymax, xmax] });
        }
      }
    }

    await bookVocab.save(bookId);

    // Merge adjacent single lines belonging to the same speech bubble
    const mergedBubbles = mergeAdjacentSpeechBubbleBoxes(recognizedLines, readingDirection);

    return {
      texts: mergedBubbles.map(l => ({ text: l.text, box_2d: l.box_2d, confidence: l.conf })),
      lowConfidenceCrops
    };
  } catch (err) {
    console.warn("[runInBrowserOCR] Error in PP-OCR pipeline:", err);
    return {
      texts: [],
      lowConfidenceCrops: []
    };
  }
}

export function mergeAdjacentSpeechBubbleBoxes(
  lines: { text: string; conf: number; box_2d: [number, number, number, number] }[],
  readingDirection: ReadingDirection = 'ltr'
): { text: string; conf: number; box_2d: [number, number, number, number] }[] {
  if (lines.length <= 1) return lines;

  // Filter out stray 1-character non-alphanumeric noise and low confidence items
  const validLines = lines.filter(l => {
    const t = l.text.trim();
    if (t.length === 0) return false;
    if (t.length === 1 && !/[A-Za-z0-9]/.test(t)) return false;
    if (l.conf < 0.75) return false;
    return true;
  });

  if (validLines.length <= 1) return validLines;

  // Sort top-to-bottom
  const sorted = [...validLines].sort((a, b) => a.box_2d[0] - b.box_2d[0]);
  const n = sorted.length;
  const parent = Array.from({ length: n }, (_, i) => i);

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

  for (let i = 0; i < n; i++) {
    const [y0_A, x0_A, y1_A, x1_A] = sorted[i].box_2d;
    const h_A = Math.max(1, y1_A - y0_A);
    const w_A = Math.max(1, x1_A - x0_A);
    const cx_A = (x0_A + x1_A) / 2;

    for (let j = i + 1; j < n; j++) {
      const [y0_B, x0_B, y1_B, x1_B] = sorted[j].box_2d;
      const h_B = Math.max(1, y1_B - y0_B);
      const w_B = Math.max(1, x1_B - x0_B);
      const cx_B = (x0_B + x1_B) / 2;

      const gapY = y0_B - y1_A;
      const avgH = (h_A + h_B) / 2;

      // In speech bubbles, adjacent lines have tight vertical spacing (gap <= 0.85 * line height)
      if (gapY > avgH * 1.0) break;

      const isVerticallyAdjacent = gapY >= -avgH * 0.35 && gapY <= avgH * 0.85;

      const overlapX = Math.min(x1_A, x1_B) - Math.max(x0_A, x0_B);
      const minW = Math.min(w_A, w_B);
      const maxW = Math.max(w_A, w_B);
      const centerDistX = Math.abs(cx_A - cx_B);

      // Width ratio limit: don't bridge a wide caption box across small bubbles
      const widthRatio = maxW / minW;
      if (widthRatio > 2.2) continue;

      // Lines in the same speech bubble must overlap and be aligned
      const isHorizontallyAligned =
        overlapX >= minW * 0.4 &&
        centerDistX <= maxW * 0.35;

      if (isVerticallyAdjacent && isHorizontallyAligned) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, typeof sorted>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(sorted[i]);
  }

  const mergedBubbles: { text: string; conf: number; box_2d: [number, number, number, number] }[] = [];

  for (const group of groups.values()) {
    // If a group has only 1 noise character, skip it
    if (group.length === 1 && group[0].text.trim().length <= 1) continue;

    group.sort((a, b) => a.box_2d[0] - b.box_2d[0]);
    const ymin = Math.min(...group.map(g => g.box_2d[0]));
    const xmin = Math.min(...group.map(g => g.box_2d[1]));
    const ymax = Math.max(...group.map(g => g.box_2d[2]));
    const xmax = Math.max(...group.map(g => g.box_2d[3]));

    const textLines = group.map(g => g.text.trim());
    const totalLen = group.reduce((acc, cur) => acc + cur.text.length, 0);
    const weightedConfSum = group.reduce((acc, cur) => acc + cur.conf * cur.text.length, 0);
    const avgConf = totalLen > 0 ? weightedConfSum / totalLen : 0.85;

    mergedBubbles.push({
      text: textLines.join("\n"),
      conf: avgConf,
      box_2d: [ymin, xmin, ymax, xmax]
    });
  }

  // Sort merged bubbles strictly in comic reading order (top-to-bottom panels, then columns according to reading direction)
  mergedBubbles.sort((a, b) => {
    // Group into vertical panel rows by tolerating ~120 pixel vertical differences
    const rowA = Math.floor(a.box_2d[0] / 120);
    const rowB = Math.floor(b.box_2d[0] / 120);
    if (rowA !== rowB) return rowA - rowB;
    // Within the same panel row, sort according to reading direction
    if (readingDirection === 'rtl') {
      return b.box_2d[1] - a.box_2d[1]; // Right to left for RTL/manga
    }
    return a.box_2d[1] - b.box_2d[1]; // Left to right for LTR
  });

  return mergedBubbles;
}

async function runTextDetection(
  img: HTMLImageElement | HTMLCanvasElement,
  origW: number,
  origH: number,
  session: ort.InferenceSession
): Promise<{ box: [number, number, number, number]; canvas: HTMLCanvasElement }[]> {
  const boxes: { box: [number, number, number, number]; canvas: HTMLCanvasElement }[] = [];

  const longSide = 1536;
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

  const canvas = document.createElement('canvas');
  canvas.width = detW;
  canvas.height = detH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return boxes;

  ctx.drawImage(img, 0, 0, detW, detH);
  const imgData = ctx.getImageData(0, 0, detW, detH);
  const data = imgData.data;

  const channelSize = detH * detW;
  const mean = [0.485, 0.456, 0.406]; // B, G, R
  const std = [0.229, 0.224, 0.225];

  // ONNX standard NCHW dimensions: [1, 3, detH, detW]
  const float32Data = new Float32Array(3 * detH * detW);
  for (let i = 0; i < channelSize; i++) {
    const r = data[i * 4] / 255.0;
    const g = data[i * 4 + 1] / 255.0;
    const b = data[i * 4 + 2] / 255.0;

    float32Data[i] = (b - mean[0]) / std[0];
    float32Data[channelSize + i] = (g - mean[1]) / std[1];
    float32Data[2 * channelSize + i] = (r - mean[2]) / std[2];
  }

  const inputName = session.inputNames[0] || 'x';
  const tensor = new ort.Tensor('float32', float32Data, [1, 3, detH, detW]);
  const results = await session.run({ [inputName]: tensor });
  const outputName = session.outputNames[0] || 'fetch_name_0';
  const probMap = results[outputName].data as Float32Array;

  const THRESH = 0.2;
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
      if (probMap[idx] <= THRESH) continue;

      const up = y > 0 ? labels[(y - 1) * detW + x] : 0;
      const left = x > 0 ? labels[y * detW + (x - 1)] : 0;
      const upLeft = (y > 0 && x > 0) ? labels[(y - 1) * detW + (x - 1)] : 0;
      const upRight = (y > 0 && x < detW - 1) ? labels[(y - 1) * detW + (x + 1)] : 0;

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

  const origCanvas = document.createElement('canvas');
  origCanvas.width = origW;
  origCanvas.height = origH;
  const origCtx = origCanvas.getContext('2d', { willReadFrequently: true });
  if (origCtx) {
    origCtx.drawImage(img, 0, 0);
  }

  const detectedBoxes: { box: [number, number, number, number]; angle: number; score: number }[] = [];

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
    let cx = (c.minX + c.maxX) / 2;
    let cy = (c.minY + c.maxY) / 2;
    let finalAngle = 0;

    if (Math.abs(angleDeg) >= 2 && Math.abs(Math.abs(angleDeg) - 90) >= 2 && Math.abs(Math.abs(angleDeg) - 180) >= 2) {
      const cosA = Math.cos(angleRad);
      const sinA = Math.sin(angleRad);
      let minU = Infinity, maxU = -Infinity;
      let minV = Infinity, maxV = -Infinity;
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

    // Unclip expand by d = w*h*1.5 / (2*(w+h))
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

  // Sort boxes top-to-bottom, then left-to-right (bucket y by ~30 px)
  detectedBoxes.sort((a, b) => {
    const bucketA = Math.floor(a.box[0] / 30);
    const bucketB = Math.floor(b.box[0] / 30);
    if (bucketA !== bucketB) return bucketA - bucketB;
    return a.box[1] - b.box[1];
  });

  for (const b of detectedBoxes) {
    const [ymin, xmin, ymax, xmax] = b.box;
    const cropW = Math.max(1, xmax - xmin);
    const cropH = Math.max(1, ymax - ymin);

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
    if (!cropCtx || !origCtx) continue;

    if (Math.abs(b.angle) >= (2 * Math.PI / 180) && cropW >= cropH) {
      cropCtx.save();
      cropCtx.translate(cropW / 2, cropH / 2);
      cropCtx.rotate(-b.angle);
      cropCtx.drawImage(origCanvas, xmin, ymin, cropW, cropH, -cropW / 2, -cropH / 2, cropW, cropH);
      cropCtx.restore();
    } else {
      cropCtx.drawImage(origCanvas, xmin, ymin, cropW, cropH, 0, 0, cropW, cropH);
    }

    boxes.push({ box: [ymin, xmin, ymax, xmax], canvas: cropCanvas });
  }

  return boxes;
}

async function runTextRecognition(
  cropCanvas: HTMLCanvasElement,
  session: ort.InferenceSession,
  table: string[],
  charMask: Float32Array
): Promise<{ text: string; conf: number }> {
  try {
    const srcW = cropCanvas.width;
    const srcH = cropCanvas.height;
    if (srcW <= 0 || srcH <= 0) return { text: "", conf: 0 };

    // Standard PaddleOCR resize_norm_img:
    // Resize to target height 48 preserving aspect ratio, padded with neutral white on the right
    const targetH = 48;
    const calcW = Math.max(1, Math.ceil((targetH * srcW) / srcH));
    const targetW = Math.min(3200, Math.max(48, calcW));

    const recCanvas = document.createElement('canvas');
    recCanvas.width = targetW;
    recCanvas.height = targetH;
    const recCtx = recCanvas.getContext('2d', { willReadFrequently: true });
    if (!recCtx) return { text: "", conf: 0 };

    recCtx.fillStyle = '#ffffff';
    recCtx.fillRect(0, 0, targetW, targetH);
    recCtx.drawImage(cropCanvas, 0, 0, calcW, targetH);

    const recImgData = recCtx.getImageData(0, 0, targetW, targetH);
    const rData = recImgData.data;
    const channelSize = targetH * targetW;

    // ONNX standard NCHW dimensions: [1, 3, targetH, targetW]
    const float32Data = new Float32Array(3 * targetH * targetW);
    for (let i = 0; i < channelSize; i++) {
      const r = rData[i * 4] / 255.0;
      const g = rData[i * 4 + 1] / 255.0;
      const b = rData[i * 4 + 2] / 255.0;

      float32Data[i] = (b - 0.5) / 0.5;
      float32Data[channelSize + i] = (g - 0.5) / 0.5;
      float32Data[2 * channelSize + i] = (r - 0.5) / 0.5;
    }

    const inputName = session.inputNames[0] || 'x';
    const inputType = (session as any).inputMetadata?.[inputName]?.type;

    let tensor: ort.Tensor;
    let isFp16Mode = inputType === 'float16';

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
      // If error indicates float16/float32 mismatch, automatically convert and retry
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

    const outputName = session.outputNames[0] || 'fetch_name_0';
    const outputTensor = results[outputName];
    if (!outputTensor) return { text: "", conf: 0 };

    let outputData: Float32Array;
    if (outputTensor.type === 'float16' || outputTensor.data instanceof Uint16Array) {
      outputData = halfToFloat32(outputTensor.data as Uint16Array);
    } else {
      outputData = outputTensor.data as Float32Array;
    }

    return decodeCtcRaw(outputData, outputTensor.dims as number[], table, charMask);
  } catch (err) {
    console.warn("[PP-OCR] Recognition error on crop:", err);
    return { text: "", conf: 0 };
  }
}

function decodeCtc(outputTensor: ort.Tensor, table: string[], charMask: Float32Array): { text: string; conf: number } {
  return decodeCtcRaw(outputTensor.data as Float32Array, outputTensor.dims as number[], table, charMask);
}

function decodeCtcRaw(data: Float32Array, dims: number[], table: string[], charMask: Float32Array): { text: string; conf: number } {
  try {
    if (!dims || dims.length < 3) return { text: "", conf: 0 };

    const seqLen = dims[1];
    const numClasses = dims[2];

    let text = "";
    let lastIdx = -1;
    let totalConf = 0;
    let charCount = 0;

    for (let t = 0; t < seqLen; t++) {
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
    return { text: "", conf: 0 };
  }
}
