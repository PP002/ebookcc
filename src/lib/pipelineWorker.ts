/**
 * Web Worker for OCR & YOLO layout preprocessing, postprocessing, and CTC decoding.
 * Uses OffscreenCanvas and createImageBitmap for high-performance off-main-thread processing.
 */

interface YoloPreprocessMessage {
  type: "YOLO_PREPROCESS";
  id: string;
  bitmap: ImageBitmap;
  targetSize: number;
}

interface OcrDetPreprocessMessage {
  type: "OCR_DET_PREPROCESS";
  id: string;
  bitmap: ImageBitmap;
  longSide: number;
}

interface OcrDetPostprocessMessage {
  type: "OCR_DET_POSTPROCESS";
  id: string;
  probMap: Float32Array;
  detW: number;
  detH: number;
  origW: number;
  origH: number;
  thresh?: number;
}

interface OcrRecPreprocessBatchMessage {
  type: "OCR_REC_PREPROCESS_BATCH";
  id: string;
  bitmap: ImageBitmap;
  boxes: {
    box: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
    angle: number;
  }[];
}

interface OcrCtcDecodeMessage {
  type: "OCR_CTC_DECODE";
  id: string;
  data: Float32Array;
  dims: number[];
  table: string[];
  charMask?: Float32Array;
}

type WorkerMessage =
  | YoloPreprocessMessage
  | OcrDetPreprocessMessage
  | OcrDetPostprocessMessage
  | OcrRecPreprocessBatchMessage
  | OcrCtcDecodeMessage;

// Reusable offscreen canvases for the worker
let yoloOffscreenCanvas: OffscreenCanvas | null = null;
let yoloOffscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

let detOffscreenCanvas: OffscreenCanvas | null = null;
let detOffscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

let recOffscreenCanvas: OffscreenCanvas | null = null;
let recOffscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;
  if (!msg || !msg.type) return;

  try {
    switch (msg.type) {
      case "YOLO_PREPROCESS": {
        const { id, bitmap, targetSize } = msg;
        const origWidth = bitmap.width;
        const origHeight = bitmap.height;

        const scale = Math.min(targetSize / origWidth, targetSize / origHeight);
        const newW = Math.round(origWidth * scale);
        const newH = Math.round(origHeight * scale);
        const padX = Math.round((targetSize - newW) / 2);
        const padY = Math.round((targetSize - newH) / 2);

        if (!yoloOffscreenCanvas || yoloOffscreenCanvas.width !== targetSize || yoloOffscreenCanvas.height !== targetSize) {
          yoloOffscreenCanvas = new OffscreenCanvas(targetSize, targetSize);
          yoloOffscreenCtx = yoloOffscreenCanvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
        }

        if (!yoloOffscreenCtx) {
          bitmap.close();
          throw new Error("Could not acquire 2D context in OffscreenCanvas for YOLO");
        }

        yoloOffscreenCtx.fillStyle = "#727272";
        yoloOffscreenCtx.fillRect(0, 0, targetSize, targetSize);
        yoloOffscreenCtx.drawImage(bitmap, padX, padY, newW, newH);
        bitmap.close();

        const imgData = yoloOffscreenCtx.getImageData(0, 0, targetSize, targetSize);
        const rgba = imgData.data;

        const channelSize = targetSize * targetSize;
        const rgbData = new Float32Array(3 * channelSize);

        for (let i = 0; i < channelSize; i++) {
          const rgbaIdx = i * 4;
          rgbData[i] = rgba[rgbaIdx] / 255.0; // R
          rgbData[channelSize + i] = rgba[rgbaIdx + 1] / 255.0; // G
          rgbData[2 * channelSize + i] = rgba[rgbaIdx + 2] / 255.0; // B
        }

        (self as any).postMessage(
          {
            type: "YOLO_PREPROCESS_SUCCESS",
            id,
            rgbData,
            origWidth,
            origHeight,
            scale,
            padX,
            padY
          },
          [rgbData.buffer]
        );
        break;
      }

      case "OCR_DET_PREPROCESS": {
        const { id, bitmap, longSide } = msg;
        const origW = bitmap.width;
        const origH = bitmap.height;

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

        if (!detOffscreenCanvas || detOffscreenCanvas.width !== detW || detOffscreenCanvas.height !== detH) {
          detOffscreenCanvas = new OffscreenCanvas(detW, detH);
          detOffscreenCtx = detOffscreenCanvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
        }

        if (!detOffscreenCtx) {
          bitmap.close();
          throw new Error("Could not acquire 2D context in OffscreenCanvas for Det");
        }

        detOffscreenCtx.drawImage(bitmap, 0, 0, detW, detH);
        bitmap.close();

        const imgData = detOffscreenCtx.getImageData(0, 0, detW, detH);
        const data = imgData.data;

        const channelSize = detH * detW;
        const mean = [0.485, 0.456, 0.406]; // B, G, R
        const std = [0.229, 0.224, 0.225];

        const float32Data = new Float32Array(3 * channelSize);
        for (let i = 0; i < channelSize; i++) {
          const r = data[i * 4] / 255.0;
          const g = data[i * 4 + 1] / 255.0;
          const b = data[i * 4 + 2] / 255.0;

          float32Data[i] = (b - mean[0]) / std[0];
          float32Data[channelSize + i] = (g - mean[1]) / std[1];
          float32Data[2 * channelSize + i] = (r - mean[2]) / std[2];
        }

        (self as any).postMessage(
          {
            type: "OCR_DET_PREPROCESS_SUCCESS",
            id,
            float32Data,
            detW,
            detH,
            origW,
            origH
          },
          [float32Data.buffer]
        );
        break;
      }

      case "OCR_DET_POSTPROCESS": {
        const { id, probMap, detW, detH, origW, origH, thresh = 0.2 } = msg;

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

        (self as any).postMessage({
          type: "OCR_DET_POSTPROCESS_SUCCESS",
          id,
          boxes: detectedBoxes
        });
        break;
      }

      case "OCR_REC_PREPROCESS_BATCH": {
        const { id, bitmap, boxes } = msg;
        const origW = bitmap.width;
        const origH = bitmap.height;

        const results: {
          float32Data: Float32Array;
          targetW: number;
          targetH: number;
          box: [number, number, number, number];
        }[] = [];

        const transferBuffers: ArrayBuffer[] = [];

        // Scratch canvas for crops
        let cropCanvas: OffscreenCanvas | null = null;
        let cropCtx: OffscreenCanvasRenderingContext2D | null = null;

        for (const item of boxes) {
          const [ymin, xmin, ymax, xmax] = item.box;
          const cropW = Math.max(1, xmax - xmin);
          const cropH = Math.max(1, ymax - ymin);

          if (!cropCanvas || cropCanvas.width < cropW || cropCanvas.height < cropH) {
            cropCanvas = new OffscreenCanvas(Math.max(cropW, 256), Math.max(cropH, 256));
            cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
          }

          if (!cropCtx) continue;

          cropCtx.clearRect(0, 0, cropW, cropH);

          if (Math.abs(item.angle) >= (2 * Math.PI) / 180 && cropW >= cropH) {
            cropCtx.save();
            cropCtx.translate(cropW / 2, cropH / 2);
            cropCtx.rotate(-item.angle);
            cropCtx.drawImage(bitmap, xmin, ymin, cropW, cropH, -cropW / 2, -cropH / 2, cropW, cropH);
            cropCtx.restore();
          } else {
            cropCtx.drawImage(bitmap, xmin, ymin, cropW, cropH, 0, 0, cropW, cropH);
          }

          // Target height 48, aspect-ratio width
          const targetH = 48;
          const calcW = Math.max(1, Math.ceil((targetH * cropW) / cropH));
          const targetW = Math.min(3200, Math.max(48, calcW));

          if (!recOffscreenCanvas || recOffscreenCanvas.width < targetW || recOffscreenCanvas.height < targetH) {
            recOffscreenCanvas = new OffscreenCanvas(Math.max(targetW, 512), targetH);
            recOffscreenCtx = recOffscreenCanvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
          }

          if (!recOffscreenCtx) continue;

          recOffscreenCtx.fillStyle = "#ffffff";
          recOffscreenCtx.fillRect(0, 0, targetW, targetH);
          recOffscreenCtx.drawImage(cropCanvas, 0, 0, cropW, cropH, 0, 0, calcW, targetH);

          const recImgData = recOffscreenCtx.getImageData(0, 0, targetW, targetH);
          const rData = recImgData.data;
          const channelSize = targetH * targetW;

          const float32Data = new Float32Array(3 * channelSize);
          for (let i = 0; i < channelSize; i++) {
            const r = rData[i * 4] / 255.0;
            const g = rData[i * 4 + 1] / 255.0;
            const b = rData[i * 4 + 2] / 255.0;

            float32Data[i] = (b - 0.5) / 0.5;
            float32Data[channelSize + i] = (g - 0.5) / 0.5;
            float32Data[2 * channelSize + i] = (r - 0.5) / 0.5;
          }

          transferBuffers.push(float32Data.buffer);
          results.push({
            float32Data,
            targetW,
            targetH,
            box: item.box
          });
        }

        bitmap.close();

        (self as any).postMessage(
          {
            type: "OCR_REC_PREPROCESS_BATCH_SUCCESS",
            id,
            results
          },
          transferBuffers
        );
        break;
      }

      case "OCR_CTC_DECODE": {
        const { id, data, dims, table, charMask } = msg;
        if (!dims || dims.length < 3) {
          (self as any).postMessage({ type: "OCR_CTC_DECODE_SUCCESS", id, text: "", conf: 0 });
          break;
        }

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
              const char = table[maxClass] || "";
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
        (self as any).postMessage({
          type: "OCR_CTC_DECODE_SUCCESS",
          id,
          text: text.trim(),
          conf: avgConf
        });
        break;
      }
    }
  } catch (err: any) {
    (self as any).postMessage({
      type: "ERROR",
      id: (msg as any)?.id,
      error: err?.message || String(err)
    });
  }
};
