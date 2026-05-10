import express from "express";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import fs from "fs";
import sharp from "sharp";

async function startServer() {
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
            form.append("conf", "0.15"); // lower for better recall
            form.append("iou", "0.45"); 
            form.append("imgsz", "1280");

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

      return res.status(400).json({ error: "No YOLO URL provided and internal model is disabled" });
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
      const { base64Image, suggestedCount } = req.body;
      console.log(`[API] Image size: ${Math.round(base64Image.length / 1024)} KB`);
      
      let promptText = "Analyze this page image for text extraction. This page might contain dense text paragraphs, comic bubbles, or captions.\n\n" +
                        "YOUR GOALS:\n" +
                        "1. Detect and transcribe EVERY piece of text precisely. No skipping, no summarizing.\n" +
                        "2. Each visually distinct paragraph or block MUST be its own separate entry. Do NOT merge multiple paragraphs into one string.\n" +
                        "3. Output VERY TIGHT bounding boxes [ymin, xmin, ymax, xmax] (0-1000) for each logical block (bubble, caption, or individual paragraph). The box should only encompass the text pixels.\n" +
                        "4. For each block, return the text as a single cohesive string (remove internal line breaks within that paragraph).\n\n" +
                        "READING ORDER RULES:\n" +
                        "- For BOOKS/PROSE: Sort by natural flow (Title -> Paragraph 1 -> Paragraph 2 -> etc.). Handle columns properly (left column then right column).\n" +
                        "- For COMICS: Sort by panel order, then bubbles/captions in reading flow.\n\n" +
                        "Return a JSON list: [{\"text\": \"...\", \"box_2d\": [ymin, xmin, ymax, xmax]}]. Return ONLY the JSON.";
      
      if (suggestedCount !== undefined) {
        const hintText = suggestedCount > 0 
          ? `Approx ${suggestedCount} regions detected.`
          : `Scan carefully; extract ALL text.`;

        promptText = `Complete extraction. ${hintText}\n\n` +
          `MISSION:\n` +
          `1. Extract ALL text in strict reading order.\n` +
          `2. PRECISE SEPARATION: Every logical paragraph must be a separate JSON object.\n` +
          `3. Bounding boxes MUST be extremely tight to text edges.\n\n` +
          `Return JSON list: [{"text": "...", "box_2d": [ymin, xmin, ymax, xmax]}]. Return ONLY JSON.`;
      }

      let retries = 3;
      let response;
      while (true) {
        try {
          response = await ai.models.generateContent({
            model: "gemini-2.0-flash",
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
              maxOutputTokens: 8192,
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
