import express from "express";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import fs from "fs";
import sharp from "sharp";
import HTMLtoDOCX from 'html-to-docx';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type TextBlock = { text: string; box_2d: [number, number, number, number] };

// ─────────────────────────────────────────────
// Deterministic reading-order sort (no AI)
// Handles: single-column, multi-column, titles
// ─────────────────────────────────────────────
function sortTextsReadingOrder(blocks: TextBlock[]): TextBlock[] {
  if (blocks.length === 0) return blocks;

  const PAGE = 1000;
  const COLUMN_BREAK = PAGE / 2;

  // A block is "spanning" (not part of a column) if:
  // - It's very wide (>55%)
  // - Or it's centered (midX within 400-600) AND relatively wide or likely a header (>20% width)
  const isSpanning = (b: TextBlock) => {
    const width = b.box_2d[3] - b.box_2d[1];
    const centerX = (b.box_2d[1] + b.box_2d[3]) / 2;
    return width > PAGE * 0.55 || (width > PAGE * 0.2 && Math.abs(centerX - COLUMN_BREAK) < PAGE * 0.08);
  };

  const spanningBlocks = blocks.filter(isSpanning);
  const narrowBlocks   = blocks.filter(b => !isSpanning(b));

  // Detect multi-column: significant blocks on both sides of center
  const leftCount  = narrowBlocks.filter(b => (b.box_2d[1] + b.box_2d[3]) / 2 < COLUMN_BREAK).length;
  const rightCount = narrowBlocks.filter(b => (b.box_2d[1] + b.box_2d[3]) / 2 >= COLUMN_BREAK).length;
  const isMultiColumn = leftCount >= 2 && rightCount >= 2;

  if (!isMultiColumn) {
    // Single column: pure top-to-bottom
    return [...blocks].sort((a, b) => a.box_2d[0] - b.box_2d[0]);
  }

  // Multi-column logic
  // Find column vertical bounds to decide if a spanning block is top, middle (interjected), or bottom
  const nonSpanningY = narrowBlocks.map(b => b.box_2d[0]);
  const minY = Math.min(...nonSpanningY);
  const maxY = Math.max(...narrowBlocks.map(b => b.box_2d[2]));

  const topSpanning = spanningBlocks.filter(b => b.box_2d[0] < minY + 50).sort((a, b) => a.box_2d[0] - b.box_2d[0]);
  const bottomSpanning = spanningBlocks.filter(b => b.box_2d[0] >= maxY - 50 && !topSpanning.includes(b)).sort((a, b) => a.box_2d[0] - b.box_2d[0]);
  const middleSpanning = spanningBlocks.filter(b => !topSpanning.includes(b) && !bottomSpanning.includes(b)).sort((a, b) => a.box_2d[0] - b.box_2d[0]);

  const leftCol = narrowBlocks
    .filter(b => (b.box_2d[1] + b.box_2d[3]) / 2 < COLUMN_BREAK)
    .sort((a, b) => a.box_2d[0] - b.box_2d[0]);
  const rightCol = narrowBlocks
    .filter(b => (b.box_2d[1] + b.box_2d[3]) / 2 >= COLUMN_BREAK)
    .sort((a, b) => a.box_2d[0] - b.box_2d[0]);

  // Interleave middle spanning blocks if possible, or just place them between cols?
  // Usually middle spanning blocks mean the layout is complex (e.g. Header-Cols-MiddleSpanning-MoreCols)
  // For now: Top -> LeftCol -> MiddleSpanning -> RightCol -> Bottom
  // Actually, usually headers for the whole page are Top.
  // If "Foreword" is at the top of the columns but centered, it'll be in topSpanning.
  return [...topSpanning, ...leftCol, ...middleSpanning, ...rightCol, ...bottomSpanning];
}

// ─────────────────────────────────────────────
// Normalize text: collapse soft line-breaks
// within a block but keep the block as one string
// ─────────────────────────────────────────────
function normalizeBlockText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, ' ')     // all newlines → single space
    .replace(/\s{2,}/g, ' ')  // collapse multiple spaces
    .trim();
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  function getAIClient(customKey?: string) {
    let key = customKey || process.env.GEMINI_API_KEY;
    if (key && key.startsWith("Bearer ")) {
      key = key.replace("Bearer ", "").trim();
    }
    if (!key || key === "MY_GEMINI_API_KEY" || key.includes("YOUR_API_KEY") || key.length < 10) return null;
    return new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }

  // ─────────────────────────────────────────────
  // Gemini Context Caching Manager (Glossary-Based)
  // ─────────────────────────────────────────────
  let glossaryCacheName: string | null = null;
  let glossaryExpiry = 0;

  function generateBaseGlossary(): string {
    let content = `# COMIC TRANSLATION AND OCR RULES REFERENCE GLOSSARY\n\n`;
    content += `## SECTION 1: GLOBAL COMIC TRANSLATION RULES\n`;
    content += `- Maintain original tone, style, and character voice.\n`;
    content += `- Translate SFX/onomatopoeia using standard equivalents (e.g. rumble, thump, gasp).\n`;
    content += `- Avoid overly literal translations of local idioms.\n\n`;
    
    content += `## SECTION 2: JAPANESE COMIC ONOMATOPOEIA (SFX) ENTRIES\n`;
    const sfxList = [
      { jp: "ドキドキ (dokidoki)", en: "thump thump", type: "heartbeat", desc: "Expresses excitement, nervousness, or fear." },
      { jp: "ゴゴゴ (gogogo)", en: "rumble... rumble...", type: "atmosphere", desc: "Used for menacing, ominous situations or energy gathering." },
      { jp: "ニコニコ (nikoniko)", en: "smile", type: "expression", desc: "A warm, silent, friendly smile." },
      { jp: "ガーン (gaan)", en: "shock / doom", type: "reaction", desc: "Expresses realization of devastation or great shock." },
      { jp: "バキッ (baki)", en: "crack / snap", type: "impact", desc: "A hard cracking of bones or snapping of wood/objects." },
      { jp: "ハッ (ha)", en: "gasp!", type: "reaction", desc: "A sudden intake of breath from surprise or sudden awareness." },
      { jp: "フワッ (fuwa)", en: "softly floating / gentle breeze", type: "movement", desc: "A light, floating motion or wind." },
      { jp: "ワクワク (wakuwaku)", en: "trembling with anticipation", type: "emotion", desc: "Excitement and happy expectation." },
      { jp: "シボシボ (shiboshibo)", en: "rain drizzling", type: "weather", desc: "Continuous light rainfall." },
      { jp: "グチャ (gucha)", en: "splat / squish", type: "impact", desc: "Splatting wet or soft materials together." }
    ];
    for (let i = 0; i < 60; i++) {
      const sfx = sfxList[i % sfxList.length];
      content += `- Entry ${i}: ${sfx.jp} translates to "${sfx.en}" (${sfx.type}). Description: ${sfx.desc}\n`;
    }
    return content;
  }

  function padGlossaryToTokens(base: string, currentTokens: number, targetTokens: number): string {
    let padded = base + `\n\n## SECTION 3: EXPANDED TRANSLATION REFERENCE SCRIPTS\n`;
    let idx = 1;
    while (currentTokens < targetTokens) {
      padded += `\n### Reference Script Pair #${idx}\n`;
      padded += `Source text: "そんな...！何でここにいるの...？うそでしょ、あの日死んだはずじゃ..."\n`;
      padded += `Translation: "No way...! Why are you here...? It can't be, you were supposed to have died that day..."\n`;
      padded += `Explanation: Translates a typical modern manga shock scenario. The ellipses are preserved to maintain the speech lettering spacing.\n`;
      padded += `Bounding box hints: Usually located near the top-center to convey dramatic shock. [200, 450, 400, 850]\n`;
      padded += `Source text: "お前なんて大嫌いだ！もう二度と私の前に現れるな！"\n`;
      padded += `Translation: "I despise you! Never show your face in front of me again!"\n`;
      padded += `Explanation: Highly emotive dramatic prose. Bolding can be used to emphasize "despise".\n`;
      
      currentTokens += 150;
      idx++;
    }
    return padded;
  }

  async function getOrCreateGlossaryCache(ai: any, isCustomKey: boolean = false, modelName: string = "gemini-flash-latest"): Promise<string | null> {
    if (isCustomKey) return null; // Bypass caching for custom keys to prevent 403 Permission Denied errors

    const now = Date.now();
    if (glossaryCacheName && now < glossaryExpiry) {
      console.log(`[Gemini Cache] Reusing existing glossary cache: ${glossaryCacheName}`);
      return glossaryCacheName;
    }

    try {
      console.log("[Gemini Cache] Reviewing glossary context cache state...");
      let glossaryContent = generateBaseGlossary();
      
      let tokenRes = await ai.models.countTokens({
        model: modelName,
        contents: glossaryContent
      });
      let totalTokens = tokenRes.totalTokens || 0;
      console.log(`[Gemini Cache] Initial base glossary: ${totalTokens} tokens`);

      if (totalTokens < 32768) {
        glossaryContent = padGlossaryToTokens(glossaryContent, totalTokens, 33200);
        tokenRes = await ai.models.countTokens({
          model: modelName,
          contents: glossaryContent
        });
        totalTokens = tokenRes.totalTokens || 0;
        console.log(`[Gemini Cache] Padded glossary: ${totalTokens} tokens`);
      }

      const cache = await ai.caches.create({
        model: modelName,
        config: {
          contents: [
            {
              role: "user",
              parts: [{ text: glossaryContent }]
            }
          ],
          displayName: "comic_translation_glossary",
          ttl: "1800s" // 30 minutes
        }
      });

      glossaryCacheName = cache.name;
      glossaryExpiry = Date.now() + 25 * 60 * 1000;
      console.log(`[Gemini Cache] Successfully created context cache: ${cache.name} with ${totalTokens} tokens`);
      return glossaryCacheName;
    } catch (err: any) {
      console.error("[Gemini Cache] Context Caching is disabled or temporarily offline:", err.message);
      return null;
    }
  }

  function parseJsonSafely(text: string | undefined, defaultValue: any) {
    if (!text) return defaultValue;
    try {
      let clean = text.trim();
      
      // 1. Remove markdown backticks if they exist
      const match = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (match) {
        clean = match[1].trim();
      } else {
        clean = clean.replace(/^```json/i, "").replace(/```$/i, "").trim();
      }

      // 2. Locate outermost JSON boundaries to strip leading/trailing conversational fluff
      const firstBracket = clean.indexOf('[');
      const lastBracket = clean.lastIndexOf(']');
      const firstBrace = clean.indexOf('{');
      const lastBrace = clean.lastIndexOf('}');

      let startIdx = -1;
      let endIdx = -1;

      if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
        startIdx = firstBracket;
        endIdx = lastBracket;
      } else if (firstBrace !== -1) {
        startIdx = firstBrace;
        endIdx = lastBrace;
      }

      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        clean = clean.substring(startIdx, endIdx + 1);
      }

      // 3. Try parsing directly first
      try {
        const parsed = JSON.parse(clean);
        if (Array.isArray(defaultValue) && !Array.isArray(parsed)) {
          return defaultValue;
        }
        return parsed ?? defaultValue;
      } catch {}

      // 4. Clean trailing commas inside arrays or objects (e.g., [1, 2, ] or {"a": 1, })
      clean = clean
        .replace(/,\s*\]/g, ']')
        .replace(/,\s*\}/g, '}');

      // 5. Fix raw unescaped newlines in JSON strings (convert raw newlines inside quotes to literal \n)
      let s = "";
      let inString = false;
      let escape = false;
      for (let i = 0; i < clean.length; i++) {
        const char = clean[i];
        if (char === '"' && !escape) {
          inString = !inString;
          s += char;
        } else if (char === '\\' && inString) {
          escape = !escape;
          s += char;
        } else {
          escape = false;
          if (inString && (char === '\n' || char === '\r')) {
            s += "\\n";
          } else {
            s += char;
          }
        }
      }
      clean = s;

      // 6. Final parsing attempt
      try {
        const parsed = JSON.parse(clean);
        if (Array.isArray(defaultValue) && !Array.isArray(parsed)) {
          return defaultValue;
        }
        return parsed ?? defaultValue;
      } catch (err: any) {
        console.warn("[parseJsonSafely] Final JSON parsing failed:", err.message);
        return defaultValue;
      }
    } catch {
      return defaultValue;
    }
  }

  async function callPollinations(messages: any[], initialModel = "openai", jsonMode = true, retries = 5): Promise<string> {
    let lastError = null;
    let currentJsonMode = jsonMode;
    const fallbackModels = [initialModel, "gemini", "claude", "openai", "searchgpt"];
    
    for (let i = 0; i < retries; i++) {
      const model = fallbackModels[i % fallbackModels.length];
      try {
        console.log(`[Pollinations] Attempt ${i + 1} with model "${model}" (jsonMode: ${currentJsonMode})`);
        
        const bodyObj: any = { messages, model };
        if (currentJsonMode) {
          bodyObj.jsonMode = true;
        }

        const polRes = await fetch("https://text.pollinations.ai/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyObj),
          signal: AbortSignal.timeout(35000)
        });

        if (polRes.ok) {
          const text = await polRes.text();
          if (text && text.trim()) {
            return text;
          }
        }
        throw new Error(`Status ${polRes.status}`);
      } catch (e: any) {
        lastError = e;
        console.warn(`[Pollinations] Attempt ${i + 1} failed:`, e.message);
        // Switch jsonMode to false for subsequent retries to maximize compatibility/success!
        if (currentJsonMode) {
          currentJsonMode = false;
        }
        if (i < retries - 1) {
          // Exponential-ish backoff
          await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        }
      }
    }
    throw lastError || new Error("Pollinations fetch failed");
  }

  // Shared retry wrapper — eliminates the copy-pasted retry blocks
  async function callWithRetry<T>(
    fn: () => Promise<T>,
    res: express.Response,
    label: string,
    retries = 3
  ): Promise<T | null> {
    while (true) {
      try {
        return await fn();
      } catch (err: any) {
        const is429 = err.message?.includes("429") || err.message?.includes("RESOURCE_EXHAUSTED");
        if (retries > 0 && is429) {
          const match = err.message.match(/Please retry in ([\d\.]+)s/);
          const delayMs = match
            ? Math.ceil(parseFloat(match[1])) * 1000 + 1000
            : 20000;
          if (delayMs > 10000) {
            console.log(`[API][${label}] Rate limit delay ${delayMs}ms — returning 429 to client`);
            res.status(429).json({ error: "Rate limited", retryAfterMs: delayMs });
            return null;
          }
          console.log(`[API][${label}] Rate limited. Retrying in ${~~(delayMs / 1000)}s (${retries} left)`);
          await new Promise(r => setTimeout(r, delayMs));
          retries--;
        } else {
          throw err;
        }
      }
    }
  }

  function handleGeminiError(e: any, res: express.Response) {
    let statusCode = 500;
    let errorPayload: any = e.message || String(e);
    try {
      if (typeof errorPayload === 'string' && errorPayload.startsWith('{')) {
        const parsed = JSON.parse(errorPayload);
        statusCode = parsed.error?.code || e.status || 500;
        if (errorPayload.includes("429") || errorPayload.includes("RESOURCE_EXHAUSTED")) statusCode = 429;
        errorPayload = parsed;
      } else if (errorPayload?.includes("429") || errorPayload?.includes("RESOURCE_EXHAUSTED")) {
        statusCode = 429;
      }
    } catch (_) {}
    res.status(statusCode).json({ error: errorPayload });
  }

  function iou(box1: any, box2: any) {
    const x1 = Math.max(box1.x1, box2.x1);
    const y1 = Math.max(box1.y1, box2.y1);
    const x2 = Math.min(box1.x2, box2.x2);
    const y2 = Math.min(box1.y2, box2.y2);
    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const area1 = (box1.x2 - box1.x1) * (box1.y2 - box1.y1);
    const area2 = (box2.x2 - box2.x1) * (box2.y2 - box2.y1);
    return intersection / (area1 + area2 - intersection);
  }

  function nonMaxSuppression(boxes: any[], iouThreshold: number) {
    boxes.sort((a, b) => b.score - a.score);
    const result = [];
    while (boxes.length > 0) {
      const current = boxes.shift();
      result.push(current);
      boxes = boxes.filter(box => iou(current, box) < iouThreshold);
    }
    return result;
  }

  // ─────────────────────────────────────────────
  // Routes
  // ─────────────────────────────────────────────

  app.post("/api/detectPanelsLocalYolo", async (req, res): Promise<any> => {
    console.log("[API] detectPanelsLocalYolo request received");
    try {
      const yoloUrl    = req.headers["x-yolo-url"] as string;
      const yoloKey    = req.headers["x-yolo-key"] as string;
      const yoloTextOnly   = req.headers["x-yolo-text-only"] === "true";
      const yoloPanelClass = parseInt(req.headers["x-yolo-panel-class"] as string || "0", 10);
      const yoloTextClass  = parseInt(req.headers["x-yolo-text-class"]  as string || "1", 10);

      const { base64Image } = req.body;
      if (!base64Image || typeof base64Image !== 'string') {
        return res.status(400).json({ error: 'base64Image is required' });
      }
      const rawBase64 = base64Image.split(",")[1] || base64Image;

      if (yoloUrl) {
        console.log("[API] detectPanelsLocalYolo: Routing to External YOLO Endpoint:", yoloUrl);
        try {
          if (yoloUrl.includes("/predict")) {
            const imgBuf   = Buffer.from(rawBase64, 'base64');
            const metadata = await sharp(imgBuf).metadata();
            const origW    = metadata.width  || 1000;
            const origH    = metadata.height || 1000;

            const form = new FormData();
            form.append("file", new Blob([imgBuf], { type: 'image/jpeg' }), "image.jpg");
            form.append("conf", "0.15");
            form.append("iou",  "0.45");
            form.append("imgsz","1280");

            let yoloRes = null;
            let externalRetries = 2;
            while (externalRetries >= 0) {
              try {
                yoloRes = await fetch(yoloUrl, {
                  method: "POST",
                  headers: { "Authorization": `Bearer ${yoloKey || ''}` },
                  body: form,
                  signal: AbortSignal.timeout(60000) // 1 minute timeout
                });
                if (yoloRes.ok) break;
                console.warn(`[API] External YOLO attempt failed (${yoloRes.status}). Retries left: ${externalRetries}`);
              } catch (e: any) {
                console.error(`[API] External YOLO fetch error: ${e.message}. Retries left: ${externalRetries}`);
              }
              externalRetries--;
              if (externalRetries >= 0) await new Promise(r => setTimeout(r, 2000));
            }

            if (yoloRes && yoloRes.ok) {
              const data = await yoloRes.json();
              if (data.images?.[0]?.results) {
                const panels: any[] = [];
                const texts:  any[] = [];
                data.images[0].results.forEach((r: any) => {
                  const box_2d = [
                    (r.box.y1 / origH) * 1000,
                    (r.box.x1 / origW) * 1000,
                    (r.box.y2 / origH) * 1000,
                    (r.box.x2 / origW) * 1000,
                  ];
                  const segments = r.segments?.x ? {
                    x: r.segments.x.map((v: number) => (v / origW) * 1000),
                    y: r.segments.y.map((v: number) => (v / origH) * 1000),
                  } : undefined;
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
              const errBody = yoloRes ? await yoloRes.text() : "Request failed or timed out";
              console.error(`[API] /predict failed for ${yoloUrl} after retries. Status: ${yoloRes?.status}. Body: ${errBody}`);
              throw new Error(`External Predict failed for ${yoloUrl}: ${yoloRes?.status || 'Timeout'}`);
            }
          } else {
            const yoloRes = await fetch(yoloUrl, {
              method: "POST",
              headers: { "Authorization": `Bearer ${yoloKey || ''}`, "Content-Type": "application/json" },
              body: JSON.stringify({ base64Image: rawBase64 }),
              signal: AbortSignal.timeout(60000)
            });
            if (yoloRes.ok) {
              const data = await yoloRes.json();
              if (data?.panels && data?.texts) return res.json({ panels: data.panels, texts: data.texts });
              if (data?.boxes) return res.json({ panels: yoloTextOnly ? [] : data.boxes, texts: yoloTextOnly ? data.boxes : [] });
            } else {
              throw new Error(`External YOLO JSON API failed: ${yoloRes.status}`);
            }
          }
        } catch (err: any) {
          console.log("[API] detectPanelsLocalYolo: External YOLO failed.", err.message);
          // Don't just swallow the error if we had a yoloUrl. Fall through will return 400 with this error.
          return res.status(502).json({ error: `External YOLO connectivity error: ${err.message}` });
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
      if (!base64Image || typeof base64Image !== 'string') {
        return res.status(400).json({ error: 'base64Image is required' });
      }
      const rawBase64 = base64Image.split(",")[1] || base64Image;

      if (yoloUrl) {
        console.log("[API] Routing to External YOLO:", yoloUrl);
        try {
          if (yoloUrl.includes("/predict")) {
             const imgBuf   = Buffer.from(rawBase64, 'base64');
             const metadata = await sharp(imgBuf).metadata();
             const origW    = metadata.width  || 1000;
             const origH    = metadata.height || 1000;
             const form = new FormData();
             form.append("file", new Blob([imgBuf], { type: 'image/jpeg' }), "image.jpg");
             form.append("conf", "0.15");
             form.append("iou",  "0.45");
             form.append("imgsz","1280");
             
             let yoloRes = null;
             for (let i = 0; i < 3; i++) {
               try {
                 yoloRes = await fetch(yoloUrl, {
                   method: "POST",
                   headers: { "Authorization": `Bearer ${yoloKey || ''}` },
                   body: form,
                   signal: AbortSignal.timeout(60000)
                 });
                 if (yoloRes.ok) break;
                 await new Promise(r => setTimeout(r, 2000));
               } catch (e) {
                 if (i === 2) throw e;
                 await new Promise(r => setTimeout(r, 2000));
               }
             }

             if (yoloRes && yoloRes.ok) {
               const data = await yoloRes.json();
               if (data.images?.[0]?.results) {
                 const panels = data.images[0].results
                   .filter((r: any) => r.class === 0)
                   .map((r: any) => [
                     (r.box.y1 / origH) * 1000, 
                     (r.box.x1 / origW) * 1000,
                     (r.box.y2 / origH) * 1000,
                     (r.box.x2 / origW) * 1000,
                   ]);
                 return res.json(panels);
               }
             }
          }
          
          if (!yoloUrl.includes("/predict")) {
            const yoloRes = await fetch(yoloUrl, {
              method: "POST",
              headers: { "Authorization": `Bearer ${yoloKey || ''}`, "Content-Type": "application/json" },
              body: JSON.stringify({ base64Image: rawBase64 })
            });
            if (yoloRes.ok) {
              const data = await yoloRes.json();
              if (data?.boxes && Array.isArray(data.boxes)) return res.json(data.boxes);
            }
          }
        } catch (err) {
          console.log("[API] YOLO failed.", err);
        }
      }

      const { engine, model: clientModel } = req.body;
      const targetModel = clientModel || "gemini-flash-latest";
      const customKey = req.headers["x-gemini-api-key"] as string;
      const ai = getAIClient(customKey);
      const promptText = "Analyze this comic page. Identify every major art panel/frame. Return ONLY the structural bounding boxes of panels (framed rectangular sections containing art). Do NOT include characters or faces. Return a JSON list: [[ymin, xmin, ymax, xmax], ...] with coordinates 0–1000. Empty list if no panels found.";
      
      // If ai is available, we prioritize Google Gemini (the official SDK) unless pollinations or puter is explicitly requested
      const useGeminiFirst = !!ai && engine !== 'pollinations' && engine !== 'puter';
      let panelsFound: any[] | null = null;
      let errorOccurred: any = null;

      if (useGeminiFirst) {
        try {
          console.log(`[API detectPanels] Querying Google Gemini first (Official SDK, model: ${targetModel})...`);
          const cacheName = await getOrCreateGlossaryCache(ai, !!customKey, targetModel);
          let isCacheHit = false;
          const result = await callWithRetry(() => {
            const payload: any = {
              model: targetModel,
              contents: [{
                parts: [
                  { text: promptText },
                  { inlineData: { mimeType: "image/jpeg", data: rawBase64 } }
                ]
              }],
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.ARRAY,
                  items: { type: Type.ARRAY, items: { type: Type.NUMBER } }
                }
              }
            };
            if (cacheName) { payload.config.cachedContent = cacheName; isCacheHit = true; }
            return ai.models.generateContent(payload);
          }, res, "detectPanels");

          if (result) {
            let parsed = parseJsonSafely(result.text, []);
            if (parsed && Array.isArray(parsed)) {
              panelsFound = parsed;
              console.log("[API detectPanels] Gemini successfully found panels first!");
              if (isCacheHit) res.setHeader("x-gemini-cache-hit", "true");
            }
          }
        } catch (gemError: any) {
          console.log("[API detectPanels] Gemini first-attempt failed, falling back to Pollinations if available...", gemError.message);
          errorOccurred = gemError;
        }
      }

      // Try Free AI (Pollinations) if Gemini was not tried, or if Gemini failed, or if Pollinations is explicitly selected
      if (!panelsFound && (engine === 'pollinations' || engine === 'puter' || !useGeminiFirst || !ai)) {
        try {
          console.log("[API detectPanels] Trying Free AI (Pollinations)...");
          const fullBase64Url = `data:image/jpeg;base64,${rawBase64}`;
          const openAiMessages = [
            { role: "system", content: "You are an expert layout intelligence engine. Your single task is to find all comic panels in this image and return their bounding boxes." },
            {
              role: "user",
              content: [
                { type: "text", text: promptText },
                { type: "image_url", image_url: { url: fullBase64Url } }
              ]
            }
          ];

          const resText = await callPollinations(openAiMessages, "openai", true);
          const parsed = parseJsonSafely(resText, []);
          if (parsed && Array.isArray(parsed)) {
            panelsFound = parsed;
            console.log("[API detectPanels] Free AI successfully found panels!");
          } else {
            throw new Error("Unable to parse JSON panels from Pollinations");
          }
        } catch (pollError: any) {
          errorOccurred = pollError;
          console.log("[API detectPanels] Free AI failed...", pollError.message);
        }
      }

      // Secondary fallback to Gemini ONLY if Gemini was NOT tried first, and we still have no panels
      if (!panelsFound && ai && !useGeminiFirst) {
        try {
          console.log(`[API detectPanels] Querying Google Gemini (Secondary Fallback, model: ${targetModel})...`);
          const cacheName = await getOrCreateGlossaryCache(ai, !!customKey, targetModel);
          let isCacheHit = false;
          const result = await callWithRetry(() => {
            const payload: any = {
              model: targetModel,
              contents: [{
                parts: [
                  { text: promptText },
                  { inlineData: { mimeType: "image/jpeg", data: rawBase64 } }
                ]
              }],
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.ARRAY,
                  items: { type: Type.ARRAY, items: { type: Type.NUMBER } }
                }
              }
            };
            if (cacheName) { payload.config.cachedContent = cacheName; isCacheHit = true; }
            return ai.models.generateContent(payload);
          }, res, "detectPanels");

          if (result) {
            let parsed = parseJsonSafely(result.text, []);
            if (parsed && Array.isArray(parsed)) {
              panelsFound = parsed;
              console.log("[API detectPanels] Gemini successfully found panels on secondary fallback!");
              if (isCacheHit) res.setHeader("x-gemini-cache-hit", "true");
            }
          }
        } catch (gemError: any) {
          console.log("[API detectPanels] Gemini secondary fallback failed:", gemError.message);
          errorOccurred = gemError;
        }
      }

      // If everything failed
      if (!panelsFound) {
        throw errorOccurred || new Error("All AI panel detection systems failed.");
      }

      return res.json(panelsFound);

    } catch (e: any) {
      console.error(e);
      return handleGeminiError(e, res);
    }
  });

  app.post("/api/transcribePieces", async (req, res) => {
    console.log("[API] transcribePieces request received");
    try {
      const { pieces } = req.body;
      if (!pieces || !Array.isArray(pieces)) {
        return res.status(400).json({ error: "pieces array is required" });
      }

      console.log(`[API transcribePieces] Transcribing ${pieces.length} text pieces via Pollinations/Free AI...`);

      const results = [];
      for (let index = 0; index < pieces.length; index++) {
        const pieceBase64 = pieces[index];
        if (!pieceBase64 || typeof pieceBase64 !== 'string') {
          results.push({ text: "", index });
          continue;
        }
        try {
          const rawBase64 = pieceBase64.includes(',') ? pieceBase64.split(',')[1] : pieceBase64;
          const fullBase64Url = `data:image/jpeg;base64,${rawBase64}`;
          const messages = [
            {
              role: "system",
              content: "You are a precise comic book text OCR transcriber. Transcribe all text visible in this single speech bubble or text box image. Output ONLY the transcribed text in the original language, with absolutely no surrounding conversation, no explanations, and no markdown formatting. If the image is blank, contains no legible text, or contains only noise/lines/art, respond with an empty string."
            },
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: fullBase64Url } }
              ]
            }
          ];

          // Use up to 3 retries and process sequentially with a small delay
          const text = await callPollinations(messages, "openai", false, 3);
          results.push({ text: text ? text.trim() : "", index });

          if (index < pieces.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5s delay to avoid 429 rate limits
          }
        } catch (err: any) {
          console.warn(`[API transcribePieces] Piece ${index} transcription failed:`, err.message);
          results.push({ text: "", index });
        }
      }

      return res.json(results);
    } catch (e: any) {
      console.log("[API transcribePieces] unexpected error:", e);
      return res.status(500).json({ error: e.message || "An unexpected error occurred during transcription." });
    }
  });

  app.post("/api/detectText", async (req, res) => {
    console.log("[API] detectText request received");
    try {
      const { base64Image, suggestedCount, engine, model: clientModel, yoloTexts } = req.body;
      const targetModel = clientModel || "gemini-flash-latest";
      if (!base64Image || typeof base64Image !== 'string') {
        return res.status(400).json({ error: 'base64Image is required' });
      }

      console.log(`[API detectText] Image size: ${Math.round(base64Image.length / 1024)} KB, engine: ${engine}`);

      const rawBase64 = base64Image.split(",")[1] || base64Image;
      const customKey = req.headers["x-gemini-api-key"] as string;
      const ai = getAIClient(customKey);

      const promptText = `You are a precise OCR engine. Your ONLY job is text detection and extraction.

STRICT RULES — follow every one exactly:
1. Extract EVERY visible piece of text in this image. Do not skip anything.
2. PARAGRAPH SEPARATION: A new paragraph begins when there is a visible vertical gap between lines. Each visually separate paragraph MUST be its own JSON object. NEVER merge two paragraphs into one string.
3. WITHIN a paragraph: lines are joined with a single space. Remove soft line-breaks inside a paragraph.
4. Bounding box [ymin, xmin, ymax, xmax] (0–1000) must hug the text pixels tightly. No padding.
5. Do NOT think about reading order. Just detect and extract each block independently.
6. For comic speech bubbles: each bubble = one object. Do not merge bubbles.
7. For captions: each caption box = one object.

${suggestedCount === -1 ? "This image is a SINGLE PANEL CROP from a comic page. Focus exclusively on the text within this art frame." : ""}
${suggestedCount !== undefined && suggestedCount > 0 ? `Hint: approximately ${suggestedCount} text regions expected.` : suggestedCount === 0 ? "Scan carefully — extract ALL text." : ""}

Return ONLY a JSON array. If NO text is found, return an empty array [].
Example format: [{"text": "transcribed text here", "box_2d": [ymin, xmin, ymax, xmax]}, ...]`;

      let finalPrompt = promptText;
      if (yoloTexts && Array.isArray(yoloTexts) && yoloTexts.length > 0) {
        const boxesStr = yoloTexts.map((item: any, i: number) => {
          const box = item.box_2d || item;
          if (Array.isArray(box) && box.length === 4) {
            return `Box #${i}: [${box.map(v => Math.round(Number(v))).join(', ')}]`;
          }
          return null;
        }).filter(Boolean).join('\n');

        if (boxesStr) {
          finalPrompt = `You are a precise OCR and comic translation assistant.
A local high-precision layout detector (YOLO) has already pre-detected exactly ${yoloTexts.length} text blocks/speech bubbles/caption boxes in this image.
Your ONLY job is to transcribe the EXACT text inside each of those bounding boxes. Do NOT detect any new boxes, and do NOT alter the coordinates.

Here are the pre-detected bounding boxes (scaled from 0 to 1000, formatted as [ymin, xmin, ymax, xmax]):
${boxesStr}

STRICT INSTRUCTIONS:
1. For each bounding box listed above, examine the image in that specific region and transcribe the exact text inside it.
2. If there are multiple lines of text in that region, join them with a space.
3. Preserve the box coordinates EXACTLY. Return the transcribed text paired with the exact coordinate array from the list above.
4. Output MUST be a JSON array of objects with "text" and "box_2d" (the original coordinates).`;
        }
      }

      // If ai is available, we prioritize Google Gemini (the official SDK) unless pollinations or puter is explicitly requested
      const useGeminiFirst = !!ai && engine !== 'pollinations' && engine !== 'puter';
      let textResultText = "";
      let textFound: TextBlock[] | null = null;
      let errorOccurred: any = null;

      if (useGeminiFirst) {
        try {
          console.log(`[API detectText] Querying Google Gemini first (Official SDK, model: ${targetModel})...`);
          const cacheName = await getOrCreateGlossaryCache(ai, !!customKey, targetModel);
          let isCacheHit = false;

          const result = await callWithRetry(() => {
            const payload: any = {
              model: targetModel,
              contents: [{
                parts: [
                  { text: finalPrompt },
                  { inlineData: { mimeType: "image/jpeg", data: rawBase64 } }
                ]
              }],
              config: {
                responseMimeType: "application/json",
                maxOutputTokens: 8192,
                responseSchema: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      text:   { type: Type.STRING },
                      box_2d: { type: Type.ARRAY, items: { type: Type.NUMBER } }
                    },
                    required: ["text", "box_2d"]
                  }
                }
              }
            };

            if (cacheName) {
              payload.config.cachedContent = cacheName;
              isCacheHit = true;
            }

            return ai.models.generateContent(payload);
          }, res, "detectText");

          if (result) {
            textResultText = result.text;
            let parsed = parseJsonSafely(textResultText, []);
            if (parsed && Array.isArray(parsed)) {
              textFound = parsed;
              console.log("[API detectText] Gemini successfully detected text first!");
              if (isCacheHit) {
                res.setHeader("x-gemini-cache-hit", "true");
              }
            }
          }
        } catch (gemError: any) {
          console.log("[API detectText] Gemini first-attempt failed, falling back to Pollinations if available...", gemError.message);
          errorOccurred = gemError;
        }
      }

      // Try Free AI (Pollinations) if Gemini was not tried, or if Gemini failed, or if Pollinations is explicitly selected
      if (!textFound && (engine === 'pollinations' || engine === 'puter' || !useGeminiFirst || !ai)) {
        try {
          console.log("[API detectText] Trying Free AI (Pollinations)...");
          const fullBase64Url = `data:image/jpeg;base64,${rawBase64}`;
          const openAiMessages = [
            { role: "system", content: "You are a precise OCR and text extraction engine. Your sole task is to extract all text blocks and return them in JSON format with their bounding boxes." },
            {
              role: "user",
              content: [
                { type: "text", text: finalPrompt },
                { type: "image_url", image_url: { url: fullBase64Url } }
              ]
            }
          ];

          const resText = await callPollinations(openAiMessages, "openai", true);
          const parsed = parseJsonSafely(resText, []);
          if (parsed && Array.isArray(parsed)) {
            textFound = parsed;
            console.log("[API detectText] Free AI successfully found text!");
          } else {
            throw new Error("Unable to parse JSON text blocks from Pollinations");
          }
        } catch (pollError: any) {
          errorOccurred = pollError;
          console.log("[API detectText] Free AI failed...", pollError.message);
        }
      }

      // Secondary fallback to Gemini ONLY if Gemini was NOT tried first, and we still have no text
      if (!textFound && ai && !useGeminiFirst) {
        try {
          console.log(`[API detectText] Querying Google Gemini (Secondary Fallback, model: ${targetModel})...`);
          const cacheName = await getOrCreateGlossaryCache(ai, !!customKey, targetModel);
          let isCacheHit = false;

          const result = await callWithRetry(() => {
            const payload: any = {
              model: targetModel,
              contents: [{
                parts: [
                  { text: finalPrompt },
                  { inlineData: { mimeType: "image/jpeg", data: rawBase64 } }
                ]
              }],
              config: {
                responseMimeType: "application/json",
                maxOutputTokens: 8192,
                responseSchema: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      text:   { type: Type.STRING },
                      box_2d: { type: Type.ARRAY, items: { type: Type.NUMBER } }
                    },
                    required: ["text", "box_2d"]
                  }
                }
              }
            };

            if (cacheName) {
              payload.config.cachedContent = cacheName;
              isCacheHit = true;
            }

            return ai.models.generateContent(payload);
          }, res, "detectText");

          if (result) {
            textResultText = result.text;
            let parsed = parseJsonSafely(textResultText, []);
            if (parsed && Array.isArray(parsed)) {
              textFound = parsed;
              console.log("[API detectText] Gemini successfully detected text on secondary fallback!");
              if (isCacheHit) {
                res.setHeader("x-gemini-cache-hit", "true");
              }
            }
          }
        } catch (gemError: any) {
          console.log("[API detectText] Gemini secondary fallback failed:", gemError.message);
          errorOccurred = gemError;
        }
      }

      // If everything failed
      if (!textFound) {
        throw errorOccurred || new Error("All AI text detection systems failed.");
      }

      let parsed: TextBlock[] = textFound.map(block => ({
        ...block,
        text: normalizeBlockText(block.text || "")
      }));

      parsed = parsed.filter(block => block.text && block.text.length > 0);
      parsed = sortTextsReadingOrder(parsed);

      res.json(parsed);

    } catch (e: any) {
      console.error(e);
      return handleGeminiError(e, res);
    }
  });

  app.post("/api/translate", async (req, res) => {
    console.log("[API] translate request received");
    try {
      const { texts, targetLanguage, engine, model: clientModel } = req.body;
      const targetModel = clientModel || "gemini-flash-latest";
      if (!texts || !Array.isArray(texts)) {
        return res.status(400).json({ error: 'texts array is required' });
      }
      if (!targetLanguage || typeof targetLanguage !== 'string') {
        return res.status(400).json({ error: 'targetLanguage is required' });
      }

      console.log(`[API translate] Translating ${texts.length} items to ${targetLanguage}, engine: ${engine}`);
      
      const customKey = req.headers["x-gemini-api-key"] as string;
      const ai = getAIClient(customKey);

      // If ai is available, we prioritize Google Gemini (the official SDK) unless pollinations or puter is explicitly requested
      const useGeminiFirst = !!ai && engine !== 'pollinations' && engine !== 'puter';
      let rawResultText = "";
      let translationResult: string[] | null = null;
      let errorOccurred: any = null;

      if (useGeminiFirst) {
        try {
          console.log(`[API translate] Querying Google Gemini first (Official SDK, model: ${targetModel})...`);
          const cacheName = await getOrCreateGlossaryCache(ai, !!customKey, targetModel);
          let isCacheHit = false;

          const result = await callWithRetry(() => {
            const payload: any = {
              model: targetModel,
              contents: [{
                parts: [
                  { text: `Translate the following texts to ${targetLanguage}. Return a JSON array of strings in the EXACT SAME ORDER. If a text is already in ${targetLanguage}, leave it unchanged.` },
                  { text: JSON.stringify(texts) }
                ]
              }],
              config: {
                responseMimeType: "application/json",
                responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
              }
            };

            if (cacheName) {
              payload.config.cachedContent = cacheName;
              isCacheHit = true;
            }

            return ai.models.generateContent(payload);
          }, res, "translate");

          if (result) {
            rawResultText = result.text;
            let parsed = parseJsonSafely(rawResultText, []);
            if (parsed && Array.isArray(parsed)) {
              translationResult = parsed;
              console.log("[API translate] Gemini successfully translated text first!");
              if (isCacheHit) {
                res.setHeader("x-gemini-cache-hit", "true");
              }
            }
          }
        } catch (gemError: any) {
          console.log("[API translate] Gemini first-attempt failed, falling back to Pollinations if available...", gemError.message);
          errorOccurred = gemError;
        }
      }

      // Try Free AI (Pollinations) if Gemini was not tried, or if Gemini failed, or if Pollinations is explicitly selected
      if (!translationResult && (engine === 'pollinations' || engine === 'puter' || !useGeminiFirst || !ai)) {
        try {
          console.log("[API translate] Trying Free AI (Pollinations)...");
          const openAiMessages = [
            { role: "system", content: generateBaseGlossary() },
            { role: "user", content: `Translate the following texts to ${targetLanguage}. Return a JSON array of strings in the EXACT SAME ORDER. If a text is already in ${targetLanguage}, leave it unchanged.\n\n${JSON.stringify(texts)}` }
          ];

          const models = ["llama", "openai", "mistral"];
          for (let i = 0; i < models.length; i++) {
            try {
              const model = models[i];
              const textResult = await callPollinations(openAiMessages, model, true, 1);
              const parsed = parseJsonSafely(textResult, null);
              if (parsed && Array.isArray(parsed)) {
                translationResult = parsed;
                console.log(`[API translate] Free AI successfully translated via "${model}"!`);
                break;
              }
            } catch (err: any) {
              console.warn(`[API translate] Free AI attempt via model "${models[i]}" failed:`, err.message);
            }
          }
          if (!translationResult) {
            throw new Error("Unable to parse translated array from Pollinations fallback models");
          }
        } catch (pollError: any) {
          errorOccurred = pollError;
          console.log("[API translate] Free AI failed...", pollError.message);
        }
      }

      // Secondary fallback to Gemini ONLY if Gemini was NOT tried first, and we still have no translation
      if (!translationResult && ai && !useGeminiFirst) {
        try {
          console.log(`[API translate] Querying Google Gemini (Secondary Fallback, model: ${targetModel})...`);
          const cacheName = await getOrCreateGlossaryCache(ai, !!customKey, targetModel);
          let isCacheHit = false;

          const result = await callWithRetry(() => {
            const payload: any = {
              model: targetModel,
              contents: [{
                parts: [
                  { text: `Translate the following texts to ${targetLanguage}. Return a JSON array of strings in the EXACT SAME ORDER. If a text is already in ${targetLanguage}, leave it unchanged.` },
                  { text: JSON.stringify(texts) }
                ]
              }],
              config: {
                responseMimeType: "application/json",
                responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
              }
            };

            if (cacheName) {
              payload.config.cachedContent = cacheName;
              isCacheHit = true;
            }

            return ai.models.generateContent(payload);
          }, res, "translate");

          if (result) {
            rawResultText = result.text;
            let parsed = parseJsonSafely(rawResultText, []);
            if (parsed && Array.isArray(parsed)) {
              translationResult = parsed;
              console.log("[API translate] Gemini successfully translated text on secondary fallback!");
              if (isCacheHit) {
                res.setHeader("x-gemini-cache-hit-true", "true");
              }
            }
          }
        } catch (gemError: any) {
          console.log("[API translate] Gemini secondary fallback failed:", gemError.message);
          errorOccurred = gemError;
        }
      }

      // If everything failed
      if (!translationResult) {
        throw errorOccurred || new Error("All AI translation systems failed.");
      }

      return res.json(translationResult);

    } catch (e: any) {
      console.error(e);
      return handleGeminiError(e, res);
    }
  });

  app.post("/api/export/docx", async (req, res): Promise<any> => {
    try {
      const { html } = req.body;
      if (!html) return res.status(400).send("HTML is required");
      
      const fileBuffer = await HTMLtoDOCX(html, null, {
        table: { row: { cantSplit: true } },
        footer: true,
        pageNumber: true,
      });

      let buf = fileBuffer;
      if (!Buffer.isBuffer(fileBuffer)) {
          if (fileBuffer && typeof fileBuffer.arrayBuffer === 'function') {
              buf = Buffer.from(await fileBuffer.arrayBuffer());
          } else {
              buf = Buffer.from(fileBuffer as any);
          }
      }

      const base64Data = buf.toString('base64');
      res.json({ data: base64Data, format: 'docx' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  const tempImageMap = new Map<string, string>();

  app.get('/api/temp-image/:id', (req, res) => {
    const dataUrl = tempImageMap.get(req.params.id);
    if (!dataUrl) return res.status(404).end();
    const parts = dataUrl.split(',');
    const mime = parts[0].split(':')[1].split(';')[0];
    const buffer = Buffer.from(parts[1], 'base64');
    res.setHeader('Content-Type', mime);
    res.end(buffer);
  });

  app.post("/api/export/epub", async (req, res): Promise<any> => {
    try {
      let { html, title } = req.body;
      if (!html) return res.status(400).send("HTML is required");
      
      const imgRegex = /src="(data:image\/[^;]+;base64,[^"]+)"/g;
      html = html.replace(imgRegex, (match: string, p1: string) => {
          const id = Math.random().toString(36).substring(7);
          tempImageMap.set(id, p1);
          return `src="http://127.0.0.1:3000/api/temp-image/${id}"`;
      });

      if (typeof global.File === 'undefined') {
        const { File: BufferFile } = await import("buffer");
        (global as any).File = BufferFile || class File extends Blob {
          name: string;
          lastModified: number;
          constructor(fileBits: any[], fileName: string, options?: any) {
            super(fileBits, options);
            this.name = fileName;
            this.lastModified = options?.lastModified || Date.now();
          }
        } as any;
      }

      const epubModule = await import('epub-gen-memory');
      const Epub = epubModule.default || epubModule;
      const epubFunc = typeof Epub === 'function' ? Epub : (Epub as any).default || Epub;
      console.log('epub export requested', { title, htmlLength: html?.length, epubFuncType: typeof epubFunc });
      const fileBuffer = await epubFunc({
          title: title || "Document",
          author: "Author",
      }, [
          { title: "Content", content: html }
      ]);
      
      let buf = fileBuffer;
      if (!Buffer.isBuffer(fileBuffer)) {
          if (fileBuffer && typeof fileBuffer.arrayBuffer === 'function') {
              buf = Buffer.from(await fileBuffer.arrayBuffer());
          } else {
              buf = Buffer.from(fileBuffer as any);
          }
      }

      const base64Data = buf.toString('base64');
      
      // Cleanup temp images after epub generation
      setTimeout(() => {
          tempImageMap.clear();
      }, 30000);

      res.json({ data: base64Data, format: 'epub' });
    } catch (e: any) {
      console.log('EPUB Error', e);
      res.status(500).json({ error: e.message, stack: e.stack });
    }
  });

  // Proxy endpoint to prevent mixed-content & CORS errors for secure browser connections
  app.post("/api/local-llm-proxy", async (req, res): Promise<any> => {
    try {
      const { url, method, headers, body } = req.body;
      if (!url) {
        return res.status(400).json({ error: "url is required" });
      }

      console.log(`[Proxy] Routing request to URL: ${method || 'POST'} ${url}`);

      const response = await fetch(url, {
        method: method || "POST",
        headers: headers || { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000)
      });

      const responseText = await response.text();
      let json;
      try {
        json = JSON.parse(responseText);
      } catch {
        json = null;
      }

      res.status(response.status);
      if (json) {
        res.json(json);
      } else {
        res.send(responseText);
      }
    } catch (err: any) {
      console.error("[Proxy Error] Connection failure:", err.message);
      res.status(500).json({
        error: `Proxy failed to connect to local LLM server. Details: ${err.message}`,
        isProxyError: true
      });
    }
  });

  app.post("/api/generate-image", async (req, res): Promise<any> => {
    try {
      const { prompt, aspectRatio, seed: clientSeed } = req.body;
      if (!prompt) return res.status(400).json({ error: "prompt is required" });

      let width = 1024;
      let height = 1024;
      
      if (aspectRatio === "3:4" || aspectRatio === "4:5") {
        width = 768; height = 1024;
      } else if (aspectRatio === "16:9") {
        width = 1024; height = 576;
      } else if (aspectRatio === "9:16") {
        width = 576; height = 1024;
      } else if (aspectRatio === "3:2" || aspectRatio === "4:3") {
        width = 1024; height = 768;
      }

      const seed = clientSeed || Math.floor(Math.random() * 100000000);
      const encodedPrompt = encodeURIComponent(prompt);
      const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&seed=${seed}&model=flux`;
      
      res.json({ imageUrl });
    } catch (err: any) {
      console.log("[API generate-image] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/generate-text", async (req, res): Promise<any> => {
    try {
      const { prompt, engine } = req.body;
      if (!prompt) return res.status(400).json({ error: "prompt is required" });

      const customKey = req.headers["x-gemini-api-key"] as string;
      const ai = getAIClient(customKey);
      const sysPrompt = "You are a comic book script writer. Given a scenario, generate a short, punchy single speech bubble line of dialogue (or sound effect). Maximum 10-15 words. ONLY return the text that goes in the bubble, nothing else.";
      let geminiFailed = false;

      const useGeminiFirst = !!ai && engine !== 'pollinations' && engine !== 'puter';

      if (useGeminiFirst) {
        try {
          const response = await ai.models.generateContent({
            model: "gemini-flash-latest",
            contents: prompt,
            config: { systemInstruction: sysPrompt }
          });
          const text = response.text || "";
          return res.json({ text });
        } catch (e: any) {
          console.log("[API generate-text] Gemini failed, falling back to Pollinations...", e.message);
          geminiFailed = true;
        }
      }

      if (!ai || geminiFailed) {
        console.log("[API generate-text] Using Pollinations AI fallback");
        const openAiMessages = [
          { role: "system", content: sysPrompt },
          { role: "user", content: prompt }
        ];
        
        let lastError = null;
        const models = ["mistral", "llama", "openai"];
        for (let i = 0; i < models.length; i++) {
          try {
            const polRes = await fetch("https://text.pollinations.ai/", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ messages: openAiMessages, model: models[i] })
            });
            if (polRes.ok) {
              const text = await polRes.text();
              return res.json({ text });
            } else if (polRes.status === 429) {
              lastError = new Error("Too Many Requests");
              await new Promise(r => setTimeout(r, 2000 * (i + 1))); // Backoff
            } else {
              lastError = new Error(`Pollinations API Error: ${polRes.status}`);
            }
          } catch (e: any) {
            lastError = e;
          }
        }
        throw lastError || new Error("Failed to generate response from Pollinations");
      }
    } catch (err: any) {
      console.log("[API generate-text] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/generate-comic-script", async (req, res): Promise<any> => {
    try {
      const { prompt, imageBase64, pagesCount = 1, engine } = req.body;
      if (!prompt) return res.status(400).json({ error: "prompt is required" });

      const customKey = req.headers["x-gemini-api-key"] as string;
      const ai = getAIClient(customKey);
      let geminiFailed = false;

      const userText = `Create a comic book script based on this prompt: "${prompt}". Generate exactly ${pagesCount} page(s). Each page should be structured with 4 to 6 panels for a rich comic flow. Keep panel descriptions visual and concise. Keep dialogue short.`;

      const useGeminiFirst = !!ai && engine !== 'pollinations' && engine !== 'puter';

      if (useGeminiFirst) {
        const parts: any[] = [];
        if (imageBase64) {
          let cleanBase64 = imageBase64;
          let mimeType = "image/jpeg";
          const mimeTypeMatch = imageBase64.match(/^data:(image\/[a-zA-Z]+);base64,/);
          if (mimeTypeMatch) {
            mimeType = mimeTypeMatch[1];
            cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, "");
          }
          parts.push({
            inlineData: { data: cleanBase64, mimeType }
          });
        }
        parts.push({ text: userText });

        try {
          const response = await ai.models.generateContent({
            model: "gemini-flash-latest",
            contents: parts,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                   pages: {
                     type: "ARRAY",
                     items: {
                       type: "OBJECT",
                       properties: {
                         panels: {
                           type: "ARRAY",
                           items: {
                             type: "OBJECT",
                             properties: {
                               imagePrompt: { type: "STRING" },
                               dialogue: { type: "STRING" }
                             }
                           }
                         }
                       }
                     }
                   }
                }
              }
            }
          });
          
          const scriptText = response.text;
          if (scriptText) {
            const scriptData = JSON.parse(scriptText);
            return res.json(scriptData);
          }
        } catch (geminiError: any) {
          console.log("[API generate-comic-script] Gemini failed, falling back to Pollinations...", geminiError.message);
          geminiFailed = true;
        }
      }

      if (!ai || geminiFailed) {
        console.log("[API generate-comic-script] Using Pollinations AI fallback");
        const openAiMessages = [
          { role: "system", content: "You are an expert comic book script writer. Output only valid JSON with the format: {\"pages\": [{\"panels\": [{\"imagePrompt\": \"...\", \"dialogue\": \"...\"}]}]}." }
        ];
        
        let content: any = userText;
        if (imageBase64) {
          let cleanBase64 = imageBase64;
          let mimeType = "image/jpeg";
          const mimeTypeMatch = imageBase64.match(/^data:(image\/[a-zA-Z]+);base64,/);
          if (mimeTypeMatch) {
            mimeType = mimeTypeMatch[1];
            cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, "");
          }
          content = [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${cleanBase64}` } }
          ];
        }
        openAiMessages.push({ role: "user", content });

        let lastError = null;
        const models = ["qwen-coder", "openai", "llama"];
        for (let i = 0; i < models.length; i++) {
          try {
            const polRes = await fetch("https://text.pollinations.ai/", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ messages: openAiMessages, model: models[i], jsonMode: true })
            });
            if (polRes.ok) {
              const text = await polRes.text();
              const parsed = parseJsonSafely(text, { pages: [] });
              return res.json(parsed);
            } else if (polRes.status === 429) {
              lastError = new Error("Too Many Requests");
              await new Promise(r => setTimeout(r, 2000 * (i + 1))); // Backoff
            } else {
              lastError = new Error(`Pollinations API Error: ${polRes.status}`);
            }
          } catch (e: any) {
            lastError = e;
          }
        }
        throw lastError || new Error("Failed to generate response from Pollinations");
      }
    } catch (err: any) {
      console.log("[API generate-comic-script] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/agent-chat", async (req, res): Promise<any> => {
    try {
      const { messages, systemInstruction, engine } = req.body;
      if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages array is required" });

      const customKey = req.headers["x-gemini-api-key"] as string;
      const ai = getAIClient(customKey);
      
      let agentChatResponse: string | null = null;
      let lastError = null;

      const useGeminiFirst = !!ai && engine !== 'pollinations' && engine !== 'puter';

      // If ai is available, we prioritize Google Gemini (the official SDK) unless pollinations or puter is requested
      if (useGeminiFirst) {
        try {
          console.log("[API agent-chat] Querying Google Gemini first (Official SDK)...");
          const payload: any = {
            model: "gemini-flash-latest",
            contents: messages,
          };
          
          if (systemInstruction) {
            payload.config = { systemInstruction };
          }

          const response = await ai.models.generateContent(payload);
          const text = response.text || "";
          if (text) {
            agentChatResponse = text;
            console.log("[API agent-chat] Gemini successfully answered agent chat first!");
          }
        } catch (geminiError: any) {
          console.log("[API agent-chat] Google Gemini first-attempt failed, falling back to Pollinations...", geminiError.message);
          lastError = geminiError;
        }
      }

      // Fallback or if ai is not available
      if (!agentChatResponse) {
        console.log("[API agent-chat] Trying Pollinations AI...");
        const openAiMessages: any[] = [];
        if (systemInstruction) {
          openAiMessages.push({ role: "system", content: systemInstruction });
        }
        
        messages.forEach((m: any) => {
          const role = m.role === 'model' ? 'assistant' : 'user';
          const parts = m.parts || [];
          const content = parts.map((p: any) => {
            if (p.text) return { type: 'text', text: p.text };
            if (p.inlineData) {
              return { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } };
            }
            return { type: 'text', text: '' };
          });
          openAiMessages.push({
            role,
            content: content.length === 1 && content[0].type === 'text' ? content[0].text : content
          });
        });

        const models = ["qwen-coder", "openai", "llama", "mistral"];
        for (let i = 0; i < 4; i++) {
          try {
            const model = models[i % models.length];
            let polRes = await fetch("https://text.pollinations.ai/", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ messages: openAiMessages, model })
            });

            if (!polRes.ok && (polRes.status === 502 || polRes.status === 413 || polRes.status === 400)) {
              console.log(`[API agent-chat] Pollinations failed with ${polRes.status}, retrying without images...`);
              const textOnlyMessages = openAiMessages.map(m => {
                if (Array.isArray(m.content)) {
                   return { ...m, content: m.content.map((c: any) => c.text || '').filter(Boolean).join(" ") };
                }
                return m;
              });
              polRes = await fetch("https://text.pollinations.ai/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: textOnlyMessages, model })
              });
            }

            if (polRes.ok) {
              const text = await polRes.text();
              agentChatResponse = text;
              break;
            } else if (polRes.status === 429) {
              lastError = new Error("Too Many Requests");
              await new Promise(r => setTimeout(r, 2000 * (i + 1))); 
            } else {
              lastError = new Error(`Pollinations API Error: ${polRes.status}`);
            }
          } catch (e: any) {
            lastError = e;
          }
        }
      }

      // Secondary fallback to Gemini ONLY if Gemini was NOT tried first, and we still have no answer
      if (!agentChatResponse && ai && !lastError) {
        try {
          console.log("[API agent-chat] Querying Google Gemini (Secondary Fallback)...");
          const payload: any = {
            model: "gemini-flash-latest",
            contents: messages,
          };
          
          if (systemInstruction) {
            payload.config = { systemInstruction };
          }

          const response = await ai.models.generateContent(payload);
          const text = response.text || "";
          if (text) {
            agentChatResponse = text;
          }
        } catch (geminiError: any) {
          console.log("[API agent-chat] Gemini secondary fallback failed:", geminiError.message);
          throw geminiError;
        }
      }

      if (!agentChatResponse) {
        throw lastError || new Error("Failed to generate response from any AI engine");
      }

      return res.json({ text: agentChatResponse });
    } catch (err: any) {
      console.log("[API agent-chat] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.use((err: any, req: any, res: any, next: any) => {
    console.error('Express Error:', err.message);
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
    res.status(500).json({ error: err.message });
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
