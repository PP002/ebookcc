import express from "express";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import fs from "fs";
import * as ort from "onnxruntime-node";
import sharp from "sharp";

let yoloSession: ort.InferenceSession | null = null;
async function initYolo() {
  try {
    const modelPath = path.join(process.cwd(), "server_models", "best.onnx");
    if (fs.existsSync(modelPath)) {
      yoloSession = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['cpu'],
        intraOpNumThreads: 1,
        interOpNumThreads: 1
      });
      console.log("[Server] Loaded internal YOLO onnx model from", modelPath);
    }
  } catch (e) {
    console.error("[Server] Failed to load internal YOLO model:", e);
  }
}

process.on('uncaughtException', (err) => {
  console.error("Uncaught Exception:", err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

async function startServer() {
  await initYolo();
  const app = express();
  const PORT = 3000;

  // Increase payload limit for large images
  app.use(express.json({ limit: '50mb' }));

  // Get AI Client dynamically
  function getAIClient(req: express.Request) {
    const apiKey = req.headers['x-api-key'] as string || process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    return new GoogleGenAI({ apiKey });
  }

  function parseJsonSafely(text: string | undefined, defaultValue: any) {
    if (!text) return defaultValue;
    try {
      let cleanText = text.trim();
      const match = cleanText.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (match) {
        cleanText = match[1].trim();
      } else {
        cleanText = cleanText.replace(/^```json/i, "").replace(/```$/i, "").trim();
      }
      return JSON.parse(cleanText);
    } catch (e) {
      return null;
    }
  }

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

function handleGeminiError(e: any, res: express.Response) {
    let statusCode = 500;
    let errorPayload: any = e.message || String(e);

    try {
      if (typeof errorPayload === 'string' && errorPayload.startsWith('{')) {
        const parsed = JSON.parse(errorPayload);
        if (parsed.error && parsed.error.code) {
          statusCode = parsed.error.code;
        } else if (e.status) {
          statusCode = e.status;
        } else if (errorPayload.includes("429") || errorPayload.includes("RESOURCE_EXHAUSTED")) {
          statusCode = 429;
        }
        errorPayload = parsed;
      } else if (errorPayload && (errorPayload.includes("429") || errorPayload.includes("RESOURCE_EXHAUSTED"))) {
        statusCode = 429;
      }
    } catch (_) {}

    res.status(statusCode).json({ error: errorPayload });
  }

  // API Routes
  app.post("/api/detectPanelsLocalYolo", async (req, res): Promise<any> => {
    console.log("[API] detectPanelsLocalYolo request received");
    
    try {
      const yoloUrl = req.headers["x-yolo-url"] as string;
      const yoloKey = req.headers["x-yolo-key"] as string;
      const yoloTextOnly = req.headers["x-yolo-text-only"] === "true";
      const yoloPanelClass = parseInt(req.headers["x-yolo-panel-class"] as string || "0", 10);
      const yoloTextClass = parseInt(req.headers["x-yolo-text-class"] as string || "1", 10);
      const { base64Image } = req.body;
      const rawBase64 = base64Image.split(",")[1] || base64Image;
      
      // Use External YOLO Model if provided
      if (yoloUrl) {
        console.log("[API] detectPanelsLocalYolo: Routing to External YOLO Endpoint:", yoloUrl);
        try {
          if (yoloUrl.includes("/predict")) {
            const imgBuf = Buffer.from(rawBase64, 'base64');
            const blob = new Blob([imgBuf], { type: 'image/jpeg' });
            
            const imageInfo = sharp(imgBuf);
            const metadata = await imageInfo.metadata();
            const origW = metadata.width || 1000;
            const origH = metadata.height || 1000;
            
            const form = new FormData();
            form.append("file", blob, "image.jpg");
            form.append("conf", "0.20"); // slightly lower for panels to ensure capture
            form.append("iou", "0.45"); 
            form.append("imgsz", "640");

            const yoloRes = await fetch(yoloUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${yoloKey || ''}` },
                body: form
            });
            if (yoloRes.ok) {
                const data = await yoloRes.json();
                if (data.images && data.images[0] && data.images[0].results) {
                    const results = data.images[0].results;
                    const panels: any[] = [];
                    const texts: any[] = [];
                    results.forEach((r: any) => {
                        const y1 = (r.box.y1 / origH) * 1000;
                        const x1 = (r.box.x1 / origW) * 1000;
                        const y2 = (r.box.y2 / origH) * 1000;
                        const x2 = (r.box.x2 / origW) * 1000;
                        const box_2d = [y1, x1, y2, x2];
                        
                        let segments;
                        if (r.segments && r.segments.x && r.segments.y) {
                           segments = {
                              x: r.segments.x.map((xVal: number) => (xVal / origW) * 1000),
                              y: r.segments.y.map((yVal: number) => (yVal / origH) * 1000)
                           };
                        }

                        const item = { box_2d, segments };
                        if (yoloTextOnly) {
                             texts.push(item);
                        } else {
                            if (r.class === yoloPanelClass) panels.push(item);
                            else if (r.class === yoloTextClass) texts.push(item);
                            else if (r.class > 0 && yoloPanelClass === 0 && yoloTextClass === 1) texts.push(item);
                        }
                    });
                    return res.json({ panels, texts });
                }
            } else {
                 console.error("[API] detectPanelsLocalYolo: /predict endpoint returned", yoloRes.status, await yoloRes.text());
            }
          } else {
            const fetchMethod = {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${yoloKey || ''}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ base64Image: rawBase64 })
            };
            const yoloRes = await fetch(yoloUrl, fetchMethod);
            if (yoloRes.ok) {
              const data = await yoloRes.json();
              if (data && data.panels && data.texts) {
                  return res.json({ panels: data.panels, texts: data.texts });
              } else if (data && data.boxes) {
                  if (yoloTextOnly) {
                    return res.json({ panels: [], texts: data.boxes });
                  } else {
                    return res.json({ panels: data.boxes, texts: [] });
                  }
              }
            }
          }
        } catch (err) {
            console.error("[API] detectPanelsLocalYolo: External YOLO API failed.", err);
        }
      }

      if (!yoloSession) {
        console.log("[API] detectPanelsLocalYolo: YOLO model not loaded");
        return res.status(503).json({ error: "YOLO model not loaded" });
      }

      const imgBuffer = Buffer.from(rawBase64, 'base64');
      
      const image = sharp(imgBuffer);
      const metadata = await image.metadata();
      const origW = metadata.width!;
      const origH = metadata.height!;

      const inputSize = 640;
      const scale = Math.min(inputSize / origW, inputSize / origH);
      const drawWidth = Math.round(origW * scale);
      const drawHeight = Math.round(origH * scale);
      
      const dx = Math.floor((inputSize - drawWidth) / 2);
      const dy = Math.floor((inputSize - drawHeight) / 2);

      // Resize and pad (letterboxing)
      const resized = await image
        .resize({ width: drawWidth, height: drawHeight, fit: 'fill' })
        .extend({
          top: dy,
          bottom: inputSize - drawHeight - dy,
          left: dx,
          right: inputSize - drawWidth - dx,
          background: { r: 114, g: 114, b: 114, alpha: 1 }
        })
        .removeAlpha()
        .raw()
        .toBuffer();

      // Convert to float32 [1, 3, 640, 640] normalized to 0-1
      const float32Data = new Float32Array(3 * inputSize * inputSize);
      for (let i = 0; i < inputSize * inputSize; i++) {
        float32Data[i] = resized[i * 3] / 255.0; // R
        float32Data[inputSize * inputSize + i] = resized[i * 3 + 1] / 255.0; // G
        float32Data[2 * inputSize * inputSize + i] = resized[i * 3 + 2] / 255.0; // B
      }

      const inputTensor = new ort.Tensor('float32', float32Data, [1, 3, inputSize, inputSize]);
      const feeds: Record<string, ort.Tensor> = {};
      feeds[yoloSession.inputNames[0]] = inputTensor;

      const output = await yoloSession.run(feeds);
      const outputTensor = output[yoloSession.outputNames[0]];

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

          if (yoloTextOnly) {
            textBoxes.push({ x1, y1, x2, y2, score: maxClassScore });
          } else {
            if (maxClassIndex === yoloPanelClass) {
              panelBoxes.push({ x1, y1, x2, y2, score: maxClassScore });
            } else if (maxClassIndex === yoloTextClass) {
              textBoxes.push({ x1, y1, x2, y2, score: maxClassScore });
            }
          }
        }
      }

      const finalPanelBoxes = nonMaxSuppression(panelBoxes, 0.45);
      const finalTextBoxes = nonMaxSuppression(textBoxes, 0.45);

      const mapToOriginal = (b: any) => {
        const origX1 = (b.x1 - dx) / scale;
        const origY1 = (b.y1 - dy) / scale;
        const origX2 = (b.x2 - dx) / scale;
        const origY2 = (b.y2 - dy) / scale;

        const yMin = Math.max(0, Math.min(1000, (origY1 / origH) * 1000));
        const xMin = Math.max(0, Math.min(1000, (origX1 / origW) * 1000));
        const yMax = Math.max(0, Math.min(1000, (origY2 / origH) * 1000));
        const xMax = Math.max(0, Math.min(1000, (origX2 / origW) * 1000));

        return [yMin, xMin, yMax, xMax];
      };

      return res.json({
         panels: finalPanelBoxes.map(mapToOriginal),
         texts: finalTextBoxes.map(mapToOriginal)
      });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/detectPanels", async (req, res) => {
    console.log("[API] detectPanels request received");
    try {
      const yoloUrl = req.headers["x-yolo-url"] as string;
      const yoloKey = req.headers["x-yolo-key"] as string;
      const { base64Image } = req.body;
      const rawBase64 = base64Image.split(",")[1] || base64Image;

      // Use External YOLO / HuggingFace Model (e.g. Nano Banana)
      if (yoloUrl) {
        console.log("[API] Routing request to External YOLO Custom Endpoint:", yoloUrl);
        
        const fetchMethod = {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${yoloKey || ''}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ base64Image: rawBase64 })
        };
        
        try {
          const yoloRes = await fetch(yoloUrl, fetchMethod);
          if (yoloRes.ok) {
            const data = await yoloRes.json();
            // If the custom endpoint returns `{ boxes: [ [ymin, xmin, ymax, xmax], ... ] }`
            if (data && data.boxes && Array.isArray(data.boxes)) {
                return res.json(data.boxes);
            }
          }
        } catch (err) {
            console.error("[API] YOLO API failed, falling back to Gemini.", err);
        }
      }

      const ai = getAIClient(req);
      if (!ai) return res.status(500).json({ error: "Gemini API Key missing. Please provide one in the settings." });
      console.log(`[API] Image size: ${Math.round(base64Image.length / 1024)} KB`);
      let retries = 3;
      let response;
      while (true) {
        try {
          response = await ai.models.generateContent({
            model: "gemini-2.0-flash-lite",
            contents: [
              {
                parts: [
                  {
                    text: "Analyze this complex comic page layout. Identify the strict rectangular boundaries for every major art panel/frame on the page. Only return the structural bounding boxes of the panels themselves, not individual characters or faces. A panel is a framed rectangular section containing art. Return a JSON list of bounding boxes: [[ymin, xmin, ymax, xmax], ...]. The coordinates should be between 0 and 1000. If no panels are found, output an empty JSON list: [].",
                  },
                  {
                    inlineData: {
                      mimeType: "image/jpeg",
                      data: rawBase64,
                    },
                  },
                ],
              },
            ],
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.ARRAY,
                  items: { type: Type.NUMBER },
                  description: "[ymin, xmin, ymax, xmax] for a comic panel"
                }
              },
            },
          });
          break;
        } catch (err: any) {
          if (retries > 0 && err.message && err.message.includes("429")) {
            let delayMs = 20000;
            const match = err.message.match(/Please retry in ([\d\.]+)s/);
            if (match && match[1]) {
                const delaySec = parseFloat(match[1]);
                delayMs = Math.ceil(delaySec) * 1000 + 1000; // add 1 extra sec to be safe
            }
            if (delayMs > 10000) {
               console.log(`[API] Rate limit delay is ${delayMs}ms. Returning 429 to client to handle retry.`);
               return res.status(429).json({ error: "Rate limited", retryAfterMs: delayMs });
            }
            console.log(`[API] Rate limited on detectPanels. Retries left: ${retries}. Retrying in ${~~(delayMs/1000)} seconds...`);
            await new Promise(r => setTimeout(r, delayMs));
            retries--;
          } else {
            throw err;
          }
        }
      }
      let parsed = parseJsonSafely(response.text, []);
      if (!parsed) {
        console.warn("[API] Failed to parse detectPanels response, returning empty array. Raw:", response.text);
        parsed = [];
      }
      res.json(parsed);
    } catch (e: any) {
      console.error(e);
      return handleGeminiError(e, res);
    }
  });

  app.post("/api/detectText", async (req, res) => {
    console.log("[API] detectText request received");
    try {
      const ai = getAIClient(req);
      if (!ai) return res.status(500).json({ error: "Gemini API Key missing. Please provide one in the settings." });
      const { base64Image, guidedBoxes } = req.body;
      console.log(`[API] Image size: ${Math.round(base64Image.length / 1024)} KB`);
      
      let promptText = "Analyze this page. For each speech bubble, caption, or entire paragraph of text, extract ALL the text precisely. Transcribe every single word exactly as written, paying close attention to words at the edges, small text, or floating words. Do NOT skip, summarize, or truncate any text. Preserve all punctuation and newlines (\\n). Find a single tight bounding box [ymin, xmin, ymax, xmax] that covers the ENTIRE paragraph or speech bubble text. Do NOT separate lines of the same paragraph into different boxes. Do NOT include borders or background. Return a JSON list: [{\"text\": \"...\", \"box_2d\": [ymin, xmin, ymax, xmax]}]. If no text is found, output: [].";
      
      if (guidedBoxes && guidedBoxes.length > 0) {
        promptText = `Analyze this page. I have already identified ${guidedBoxes.length} bounding boxes containing text bubbles or captions on this page. For EACH of these boxes, extract ALL the text precisely. Pay very close attention to words at the absolute edges of the bubbles, hyphenated words, or small text. Do NOT miss a single word. Transcribe everything exactly as written. Preserve newlines (\\n). Return a JSON list containing EXACTLY ${guidedBoxes.length} items in the same order as the boxes provided: [{"text": "...", "box_2d": [ymin, xmin, ymax, xmax]}]. The bounding boxes I identified are:\n${JSON.stringify(guidedBoxes, null, 2)}\nReturn ONLY the JSON. Do not miss any box, and do not add extra boxes. Make sure to refine the bounding boxes slightly if my boxes are not tight enough around the text.`;
      }

      let retries = 3;
      let response;
      while (true) {
        try {
          response = await ai.models.generateContent({
            model: "gemini-2.0-flash-lite",
            contents: [
              {
                parts: [
                  {
                    text: promptText,
                  },
                  {
                    inlineData: {
                      mimeType: "image/jpeg",
                      data: base64Image.split(",")[1] || base64Image,
                    },
                  },
                ],
              },
            ],
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING },
                    box_2d: {
                      type: Type.ARRAY,
                      items: { type: Type.NUMBER },
                    },
                  },
                  required: ["text", "box_2d"],
                },
              },
            },
          });
          break; // success
        } catch (err: any) {
          if (retries > 0 && err.message && err.message.includes("429")) {
            let delayMs = 20000;
            const match = err.message.match(/Please retry in ([\d\.]+)s/);
            if (match && match[1]) {
                const delaySec = parseFloat(match[1]);
                delayMs = Math.ceil(delaySec) * 1000 + 1000;
            }
            if (delayMs > 10000) {
               console.log(`[API] Rate limit delay is ${delayMs}ms. Returning 429 to client to handle retry.`);
               return res.status(429).json({ error: "Rate limited", retryAfterMs: delayMs });
            }
            console.log(`[API] Rate limited on detectText. Retries left: ${retries}. Retrying in ${~~(delayMs/1000)} seconds...`);
            await new Promise(r => setTimeout(r, delayMs));
            retries--;
          } else {
            throw err;
          }
        }
      }
      let parsed = parseJsonSafely(response.text, []);
      if (!parsed) {
        console.warn("[API] Failed to parse detectText response, returning empty array. Raw:", response.text);
        parsed = [];
      }
      res.json(parsed);
    } catch (e: any) {
      console.error(e);
      return handleGeminiError(e, res);
    }
  });

  app.post("/api/translate", async (req, res) => {
    console.log("[API] translate request received");
    try {
      const ai = getAIClient(req);
      if (!ai) return res.status(500).json({ error: "Gemini API Key missing. Please provide one in the settings." });
      const { texts, targetLanguage } = req.body;
      console.log(`[API] Translating ${texts?.length} items to ${targetLanguage}`);
      let retries = 3;
      let response;
      while (true) {
        try {
          response = await ai.models.generateContent({
            model: "gemini-2.0-flash-lite",
            contents: [
              {
                parts: [
                  {
                    text: `Translate the following comic texts to ${targetLanguage}. Return a JSON array of strings in the EXACT SAME ORDER. If any text is already ${targetLanguage}, leave it as is.`,
                  },
                  { text: JSON.stringify(texts) }
                ],
              },
            ],
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.STRING
                }
              },
            },
          });
          break;
        } catch (err: any) {
          if (retries > 0 && err.message && err.message.includes("429")) {
            let delayMs = 20000;
            const match = err.message.match(/Please retry in ([\d\.]+)s/);
            if (match && match[1]) {
                const delaySec = parseFloat(match[1]);
                delayMs = Math.ceil(delaySec) * 1000 + 1000;
            }
            if (delayMs > 10000) {
               console.log(`[API] Rate limit delay is ${delayMs}ms. Returning 429 to client to handle retry.`);
               return res.status(429).json({ error: "Rate limited", retryAfterMs: delayMs });
            }
            console.log(`[API] Rate limited on translate. Retries left: ${retries}. Retrying in ${~~(delayMs/1000)} seconds...`);
            await new Promise(r => setTimeout(r, delayMs));
            retries--;
          } else {
            throw err;
          }
        }
      }
      let parsed = parseJsonSafely(response.text, texts);
      if (!parsed || !Array.isArray(parsed)) {
        console.warn("[API] Failed to parse translate response, returning original texts. Raw:", response.text);
        parsed = texts;
      }
      res.json(parsed);
    } catch (e: any) {
      console.error(e);
      return handleGeminiError(e, res);
    }
  });

  app.use((err: any, req: any, res: any, next: any) => {
    console.error('Express Error:', err.message);
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Payload too large' });
    }
    res.status(500).json({ error: err.message });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
