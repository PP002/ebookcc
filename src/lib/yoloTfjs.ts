import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';

let model: tf.GraphModel | null = null;
let modelUrlLoaded: string | null = null;

export async function loadTfjsModel(modelUrl: string) {
  if (model && modelUrlLoaded === modelUrl) return model;
  
  if (modelUrlLoaded !== modelUrl) {
    model = null; // Reset if loading a new model
  }

  await tf.ready();
  
  try {
    await tf.setBackend('wasm');
    tf.tidy(() => tf.tensor([1]).add(tf.tensor([1])).dataSync());
  } catch(e) {
    console.warn("WASM initialization failed, falling back to cpu backend", e);
    await tf.setBackend('cpu');
  }
  
  try {
    model = await tf.loadGraphModel(modelUrl, {
      onProgress: (fraction) => {
        console.log(`TFJS Loading progress: ${Math.round(fraction * 100)}%`);
      },
      fetchFunc: async (url: string, init?: RequestInit) => {
         // Add cache buster to URL to force fresh download
         const cacheBustedUrl = new URL(url, window.location.href);
         cacheBustedUrl.searchParams.set('v', Date.now().toString());
         const resp = await fetch(cacheBustedUrl.toString(), init);
         if (resp.url.includes('.bin')) {
             const cl = resp.headers.get('content-length');
             console.log(`TFJS Fetching BIN: ${url} Content-Length: ${cl}`);
         }
         return resp;
      }
    });
    modelUrlLoaded = modelUrl;
    console.log("TF.js YOLO model loaded:", modelUrl);
    return model;
  } catch (e) {
    console.error("Error loading TF.js model:", e);
    throw e;
  }
}

function iou(box1: any, box2: any, useIoM: boolean = false) {
  const x1 = Math.max(box1.x1, box2.x1);
  const y1 = Math.max(box1.y1, box2.y1);
  const x2 = Math.min(box1.x2, box2.x2);
  const y2 = Math.min(box1.y2, box2.y2);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const area1 = (box1.x2 - box1.x1) * (box1.y2 - box1.y1);
  const area2 = (box2.x2 - box2.x1) * (box2.y2 - box2.y1);
  if (useIoM) {
     return intersection / Math.min(area1, area2);
  }
  const union = area1 + area2 - intersection;
  return intersection / union;
}

function nonMaxSuppression(boxes: any[], iouThreshold: number, useIoM: boolean = false) {
  boxes.sort((a, b) => b.score - a.score);
  let result = [];
  while (boxes.length > 0) {
    const currentBox = boxes.shift();
    result.push(currentBox);
    boxes = boxes.filter(box => iou(currentBox, box, useIoM) < iouThreshold);
  }
  return result;
}

export async function detectPanelsTfjs(
  imageElement: HTMLImageElement,
  modelUrl: string, 
  textOnly: boolean,
  yoloPanelClass: number = 0,
  yoloTextClass: number = 1,
  actualNumClasses: number = 0,
  resolutionOverride: number = 640
): Promise<{ panels: any[], texts: any[] } | null> {
  const currentModel = await loadTfjsModel(modelUrl);
  if (!currentModel) return null;

  const tensorInfo = tf.tidy(() => {
    let img = tf.browser.fromPixels(imageElement);
    
    // Determine input shape dynamically if model specifies it
    let inputSizeH = 640;
    let inputSizeW = 640;
    let transposeNeeded = true;
    
    if (currentModel.inputs && currentModel.inputs.length > 0) {
      const shape = currentModel.inputs[0].shape;
      if (shape && shape.length === 4) {
        // Find dimension sizes. Can be [1, 3, H, W] or [1, H, W, 3]
        if (shape[1] === 3) {
            inputSizeH = shape[2] === -1 ? 640 : shape[2]!;
            inputSizeW = shape[3] === -1 ? 640 : shape[3]!;
            transposeNeeded = true;
        } else if (shape[3] === 3) {
            inputSizeH = shape[1] === -1 ? 640 : shape[1]!;
            inputSizeW = shape[2] === -1 ? 640 : shape[2]!;
            transposeNeeded = false;
        }
      }
    }
    
    if (resolutionOverride && resolutionOverride > 0) {
        inputSizeH = resolutionOverride;
        inputSizeW = resolutionOverride;
    }

    // Resize with letterboxing
    const origW = img.shape[1]!;
    const origH = img.shape[0]!;
    const scale = Math.min(inputSizeW / origW, inputSizeH / origH);
    const drawWidth = Math.round(origW * scale);
    const drawHeight = Math.round(origH * scale);
    const dx = Math.floor((inputSizeW - drawWidth) / 2);
    const dy = Math.floor((inputSizeH - drawHeight) / 2);

    img = tf.image.resizeBilinear(img, [drawHeight, drawWidth]);
    
    // Pad to target size
    let padY = inputSizeH - drawHeight - dy;
    let padX = inputSizeW - drawWidth - dx;
    img = tf.pad(img, [[dy, padY], [dx, padX], [0, 0]], 114);
    
    // Normalize 0-1
    img = tf.div(img, 255.0);
    
    // Transpose from [H, W, 3] to [3, H, W] ONLY if model expects it
    if (transposeNeeded) {
        img = tf.transpose(img, [2, 0, 1]);
    }
    
    // Expand dims to [1, 3, H, W] or [1, H, W, 3]
    return {
        tensor: img.expandDims(0),
        inputSizeW,
        inputSizeH,
        dx,
        dy,
        scale
    };
  });

  let predictions: any;
  try {
    predictions = currentModel.predict(tensorInfo.tensor);
  } catch (e: any) {
    console.warn("TF.js prediction failed. Trying CPU fallback...", e);
    await tf.setBackend('cpu');
    predictions = currentModel.predict(tensorInfo.tensor);
  }
  
  try {
    let outputTensor: tf.Tensor;
    let protoTensor: tf.Tensor | null = null;
    
    if (Array.isArray(predictions)) {
      for (const t of predictions) {
          if (t.shape.length === 3 || (t.shape.length === 2 && t.shape[0] > 100)) {
              outputTensor = t;
          } else if (t.shape.length === 4) {
              protoTensor = t;
          }
      }
      if (!outputTensor) outputTensor = predictions[0];
    } else if (predictions instanceof tf.Tensor) {
      outputTensor = predictions;
    } else {
      // It's a dictionary of tensors (common in tfjs converter outputs)
      const keys = Object.keys(predictions);
      outputTensor = (predictions as Record<string, tf.Tensor>)[keys[0]];
      
      for (const key of keys) {
         const t = (predictions as Record<string, tf.Tensor>)[key];
         if (t.shape.length === 3 || (t.shape.length === 2 && t.shape[0] > 100)) {
             outputTensor = t;
         } else if (t.shape.length === 4) {
             protoTensor = t;
         }
      }
    }
    
    const data = await outputTensor.data();
    const dims = outputTensor.shape; 
    
    // Dispose the non-proto tensors
    if (Array.isArray(predictions)) {
      predictions.forEach(p => { if (p !== protoTensor) p.dispose() });
    } else if (predictions instanceof tf.Tensor) {
      if (predictions !== protoTensor) predictions.dispose();
    } else {
      Object.keys(predictions).forEach(k => {
          const p = predictions[k];
          if (p !== protoTensor) p.dispose();
      });
    }
    tensorInfo.tensor.dispose();

    let numBoxes: number;
    let features: number;
    let isTransposed = false;

    if (dims.length === 3) {
      if (dims[1] > dims[2]) {
        numBoxes = dims[1];
        features = dims[2];
        isTransposed = true; // [1, numBoxes, features]
      } else {
        features = dims[1];
        numBoxes = dims[2];
        isTransposed = false; // [1, features, numBoxes]
      }
    } else if (dims.length === 2) {
      // Sometimes it's [numBoxes, features]
      if (dims[0] > dims[1]) {
         numBoxes = dims[0];
         features = dims[1];
         isTransposed = true;
      } else {
         features = dims[0];
         numBoxes = dims[1];
         isTransposed = false;
      }
    } else {
      console.warn(`Unexpected output tensor shape: ${dims}, falling back to default parsing`);
      features = dims[1];
      numBoxes = dims[2];
    }

    let maskNum = 0;
    if (protoTensor) {
        if (protoTensor.shape.length === 4) {
           maskNum = protoTensor.shape[3] === 32 ? 32 : protoTensor.shape[1];
        }
    }

    const numClasses = actualNumClasses > 0 ? actualNumClasses : (maskNum > 0 ? features - 4 - maskNum : features - 4);

    let panelBoxes = [];
    let textBoxes = [];

    // Use dimensions calculated during preprocessing
    const { inputSizeW, inputSizeH, dx, dy, scale } = tensorInfo;

    const isNmsFormat = isTransposed && numBoxes < 1000 && features >= 6;
    
    for (let i = 0; i < numBoxes; i++) {
        let maxClassScore = 0;
        let maxClassIndex = -1;
        let x1, y1, x2, y2, w, h;
        let maskCoeffs: Float32Array | null = null;
        
        if (isNmsFormat) {
            x1 = data[i * features + 0];
            y1 = data[i * features + 1];
            x2 = data[i * features + 2];
            y2 = data[i * features + 3];
            maxClassScore = data[i * features + 4];
            maxClassIndex = Math.round(data[i * features + 5]);
            w = Math.abs(x2 - x1);
            h = Math.abs(y2 - y1);
            
            if (protoTensor && features >= 6 + maskNum) {
               maskCoeffs = new Float32Array(maskNum);
               for (let m = 0; m < maskNum; m++) {
                   maskCoeffs[m] = data[i * features + 6 + m];
               }
            }
        } else {
            for (let c = 0; c < numClasses; c++) {
              const score = isTransposed 
                  ? data[i * features + (4 + c)] 
                  : data[(4 + c) * numBoxes + i];
              if (score > maxClassScore) {
                maxClassScore = score;
                maxClassIndex = c;
              }
            }
    
            if (maxClassScore <= 0.25) continue;
            
            const cx = isTransposed ? data[i * features + 0] : data[0 * numBoxes + i];
            const cy = isTransposed ? data[i * features + 1] : data[1 * numBoxes + i];
            w = isTransposed ? data[i * features + 2] : data[2 * numBoxes + i];
            h = isTransposed ? data[i * features + 3] : data[3 * numBoxes + i];
    
            x1 = cx - w / 2;
            y1 = cy - h / 2;
            x2 = cx + w / 2;
            y2 = cy + h / 2;
            
            if (protoTensor && features >= 4 + numClasses + maskNum) {
                maskCoeffs = new Float32Array(maskNum);
                for (let m = 0; m < maskNum; m++) {
                    maskCoeffs[m] = isTransposed 
                        ? data[i * features + (4 + numClasses + m)] 
                        : data[(4 + numClasses + m) * numBoxes + i];
                }
            }
        }

        if (maxClassScore > 0.25) { // Confidence threshold
          const boxItem = { x1, y1, x2, y2, score: maxClassScore, maskCoeffs };

          const boxArea = w * h;
          const maxArea = inputSizeW * inputSizeH * 0.90;

          if (boxArea < maxArea) {
              if (textOnly) {
                 textBoxes.push(boxItem);
              } else {
                if (maxClassIndex === yoloPanelClass) {
                  panelBoxes.push(boxItem);
                } else if (maxClassIndex === yoloTextClass) { 
                  textBoxes.push(boxItem);
                } else {
                   if (maxClassIndex > 0 && yoloPanelClass === 0 && yoloTextClass === 1) {
                     textBoxes.push(boxItem);
                   }
                }
              }
          }
        }
    }

    // Use standard NMS for texts to avoid smaller boxes being overwritten by overlapping huge ones
    const finalPanelBoxes = nonMaxSuppression(panelBoxes, 0.45, false); // NMS first
    const finalTextBoxes = nonMaxSuppression(textBoxes, 0.45, false);

    // Process segmentation masks if protoTensor is available
    if (protoTensor) {
      try {
        const protoShape = protoTensor.shape; 
        console.log("Proto tensor shape:", protoShape, "size:", protoTensor.size);
        let maskNum = 32;
        let maskH = 160;
        let maskW = 160;
        let isChannelsLast = false;
        
        if (protoShape.length === 4) {
           if (protoShape[3] === 32) {
              isChannelsLast = true;
              maskH = protoShape[1];
              maskW = protoShape[2];
              maskNum = protoShape[3];
           } else {
              maskNum = protoShape[1]; 
              maskH = protoShape[2];
              maskW = protoShape[3];
           }
        }

        const flatProto = tf.tidy(() => {
            if (isChannelsLast) {
               return protoTensor.reshape([maskH * maskW, maskNum]) as tf.Tensor2D;
            } else {
               const shaped = protoTensor.reshape([maskNum, maskH, maskW]) as tf.Tensor3D;
               const transposed = shaped.transpose([1, 2, 0]);
               return transposed.reshape([maskH * maskW, maskNum]) as tf.Tensor2D;
            }
        });
        
        const processMasks = async (boxes: any[], color: [number, number, number]) => {
          if (boxes.length === 0) return;
          const maskCoeffsArray = boxes.map(b => Array.from(b.maskCoeffs as Float32Array)) as number[][];
          const coeffsTensor = tf.tensor2d(maskCoeffsArray, [boxes.length, maskNum]);

          const masksFlatRes = tf.tidy(() => {
              const res = tf.matMul(coeffsTensor, flatProto, false, true); 
              return tf.sigmoid(res);
          });
          const masksData = await masksFlatRes.data(); 
          coeffsTensor.dispose();
          masksFlatRes.dispose();

          for (let idx = 0; idx < boxes.length; idx++) {
            const b = boxes[idx];
            if (b.maskCoeffs) {
              const maskOutput = masksData.subarray(idx * maskH * maskW, (idx + 1) * maskH * maskW);

              const boxW = Math.max(1, Math.round(b.x2 - b.x1));
              const boxH_px = Math.max(1, Math.round(b.y2 - b.y1));
              
              if (typeof document !== 'undefined') {
                const canvas = document.createElement('canvas');
                canvas.width = boxW;
                canvas.height = boxH_px;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  const imgData = ctx.createImageData(boxW, boxH_px);
                  const scaleX = maskW / inputSizeW;
                  const scaleY = maskH / inputSizeH;
                  for (let y = 0; y < boxH_px; y++) {
                      for (let x = 0; x < boxW; x++) {
                          const origX = b.x1 + x;
                          const origY = b.y1 + y;
                          const mx = Math.floor(origX * scaleX);
                          const my = Math.floor(origY * scaleY);
                          if (mx >= 0 && mx < maskW && my >= 0 && my < maskH) {
                              const val = maskOutput[my * maskW + mx];
                              if (val > 0.5) {
                                  let i = (y * boxW + x) * 4;
                                  imgData.data[i] = 255; 
                                  imgData.data[i+1] = 255;
                                  imgData.data[i+2] = 255;
                                  imgData.data[i+3] = 255; // Fully opaque white
                              }
                          }
                      }
                  }
                  ctx.putImageData(imgData, 0, 0);
                  b.maskBase64 = canvas.toDataURL('image/png');
                }
              }
            }
          }
        };
        await processMasks(finalPanelBoxes, [239, 68, 68]);  // Red
        await processMasks(finalTextBoxes, [59, 130, 246]);  // Blue
        flatProto.dispose();
      } catch (err) {
        console.warn("Failed to process masks", err);
      } finally {
        protoTensor.dispose();
      }
    }

    const origW = imageElement.naturalWidth;
    const origH = imageElement.naturalHeight;

    const mapToOriginal = (b: any) => {
        const origX1 = (b.x1 - dx) / scale;
        const origY1 = (b.y1 - dy) / scale;
        const origX2 = (b.x2 - dx) / scale;
        const origY2 = (b.y2 - dy) / scale;

        const yMin = Math.max(0, Math.min(1000, (origY1 / origH) * 1000));
        const xMin = Math.max(0, Math.min(1000, (origX1 / origW) * 1000));
        const yMax = Math.max(0, Math.min(1000, (origY2 / origH) * 1000));
        const xMax = Math.max(0, Math.min(1000, (origX2 / origW) * 1000));

        return {
           box_2d: [yMin, xMin, yMax, xMax],
           maskBase64: b.maskBase64
        };
    };

    return {
        panels: finalPanelBoxes.map(mapToOriginal),
        texts: finalTextBoxes.map(mapToOriginal)
    };

  } catch (e) {
    if (tensorInfo && tensorInfo.tensor) tensorInfo.tensor.dispose();
    console.error("TF.js prediction error:", e);
    throw e;
  }
}
