import * as ort from 'onnxruntime-web';

// Set wasm paths to jsdelivr to avoid Vite bundling issues with .wasm files
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";

// YOLOv8 Post-processing
function iou(box1: any, box2: any) {
  const x1 = Math.max(box1.x1, box2.x1);
  const y1 = Math.max(box1.y1, box2.y1);
  const x2 = Math.min(box1.x2, box2.x2);
  const y2 = Math.min(box1.y2, box2.y2);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const area1 = (box1.x2 - box1.x1) * (box1.y2 - box1.y1);
  const area2 = (box2.x2 - box2.x1) * (box2.y2 - box2.y1);
  const union = area1 + area2 - intersection;

  return intersection / union;
}

function nonMaxSuppression(boxes: any[], iouThreshold: number) {
  boxes.sort((a, b) => b.score - a.score);
  const result = [];
  while (boxes.length > 0) {
    const currentBox = boxes.shift();
    result.push(currentBox);
    boxes = boxes.filter(box => iou(currentBox, box) < iouThreshold);
  }
  return result;
}

export interface LayoutResult {
  panels: [number, number, number, number][];
  texts: [number, number, number, number][];
}

export async function detectPanelsWithONNX(
  imageElement: HTMLImageElement,
  onnxModelBuffer: ArrayBuffer,
  inputSize: number = 640
): Promise<LayoutResult> {
  
  let session: ort.InferenceSession;
  try {
    session = await ort.InferenceSession.create(onnxModelBuffer, {
      executionProviders: ['wasm']
    });
  } catch (e) {
    console.warn("WASM execution provider failed for ONNX, falling back to cpu:", e);
    session = await ort.InferenceSession.create(onnxModelBuffer, {
      executionProviders: ['cpu']
    });
  }

  // 2. Prepare canvas and scale image
  const canvas = document.createElement('canvas');
  canvas.width = inputSize;
  canvas.height = inputSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Could not get canvas context");

  // Keep aspect ratio / padding typically used in YOLO (letterboxing)
  const scale = Math.min(inputSize / imageElement.width, inputSize / imageElement.height);
  const drawWidth = imageElement.width * scale;
  const drawHeight = imageElement.height * scale;
  const dx = (inputSize - drawWidth) / 2;
  const dy = (inputSize - drawHeight) / 2;

  ctx.drawImage(imageElement, dx, dy, drawWidth, drawHeight);
  const imageData = ctx.getImageData(0, 0, inputSize, inputSize);
  const data = imageData.data;

  // 3. Convert to float32 tensor [1, 3, 640, 640] normalized to 0-1
  const float32Data = new Float32Array(3 * inputSize * inputSize);
  for (let i = 0; i < inputSize * inputSize; i++) {
    float32Data[i] = data[i * 4] / 255.0; // R
    float32Data[inputSize * inputSize + i] = data[i * 4 + 1] / 255.0; // G
    float32Data[2 * inputSize * inputSize + i] = data[i * 4 + 2] / 255.0; // B
  }

  const inputTensor = new ort.Tensor('float32', float32Data, [1, 3, inputSize, inputSize]);
  const feeds: Record<string, ort.Tensor> = {};
  feeds[session.inputNames[0]] = inputTensor;

  // 4. Run Inference
  const output = await session.run(feeds);
  const outputTensor = output[session.outputNames[0]];

  // 5. Post-process (YOLOv8 output is [1, 4 + classes, 8400])
  const dims = outputTensor.dims;
  const tensorData = outputTensor.data as Float32Array;
  
  const numClasses = dims[1] - 4;
  const numBoxes = dims[2];

  let panelBoxes = [];
  let textBoxes = [];

  for (let i = 0; i < numBoxes; i++) {
    let maxClassScore = 0;
    let maxClassIndex = -1;
    for (let c = 0; c < numClasses; c++) {
      const score = tensorData[(4 + c) * numBoxes + i];
      if (score > maxClassScore) {
        maxClassScore = score;
        maxClassIndex = c;
      }
    }

    if (maxClassScore > 0.25) {
      const cx = tensorData[0 * numBoxes + i];
      const cy = tensorData[1 * numBoxes + i];
      const w = tensorData[2 * numBoxes + i];
      const h = tensorData[3 * numBoxes + i];

      let x1 = cx - w / 2;
      let y1 = cy - h / 2;
      let x2 = cx + w / 2;
      let y2 = cy + h / 2;

      if (maxClassIndex === 0) {
        panelBoxes.push({ x1, y1, x2, y2, score: maxClassScore });
      } else if (maxClassIndex === 1) {
        textBoxes.push({ x1, y1, x2, y2, score: maxClassScore });
      }
    }
  }

  // 6. NMS
  const finalPanelBoxes = nonMaxSuppression(panelBoxes, 0.45);
  const finalTextBoxes = nonMaxSuppression(textBoxes, 0.45);

  const mapToOriginal = (b: any): [number, number, number, number] => {
    const origX1 = (b.x1 - dx) / scale;
    const origY1 = (b.y1 - dy) / scale;
    const origX2 = (b.x2 - dx) / scale;
    const origY2 = (b.y2 - dy) / scale;

    const yMin = Math.max(0, Math.min(1000, (origY1 / imageElement.height) * 1000));
    const xMin = Math.max(0, Math.min(1000, (origX1 / imageElement.width) * 1000));
    const yMax = Math.max(0, Math.min(1000, (origY2 / imageElement.height) * 1000));
    const xMax = Math.max(0, Math.min(1000, (origX2 / imageElement.width) * 1000));

    return [yMin, xMin, yMax, xMax];
  };

  // 7. Map back to original image space and convert to 0-1000 format
  return {
    panels: finalPanelBoxes.map(mapToOriginal),
    texts: finalTextBoxes.map(mapToOriginal)
  };
}
