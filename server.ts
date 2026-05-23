import express from "express";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import fs from "fs";
import sharp from "sharp";

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

  function getAIClient() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    return new GoogleGenAI({
      apiKey,
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

  async function getOrCreateGlossaryCache(ai: any): Promise<string | null> {
    const now = Date.now();
    if (glossaryCacheName && now < glossaryExpiry) {
      console.log(`[Gemini Cache] Reusing existing glossary cache: ${glossaryCacheName}`);
      return glossaryCacheName;
    }

    try {
      console.log("[Gemini Cache] Reviewing glossary context cache state...");
      let glossaryContent = generateBaseGlossary();
      
      let tokenRes = await ai.models.countTokens({
        model: "gemini-flash-lite-latest",
        contents: glossaryContent
      });
      let totalTokens = tokenRes.totalTokens || 0;
      console.log(`[Gemini Cache] Initial base glossary: ${totalTokens} tokens`);

      if (totalTokens < 32768) {
        glossaryContent = padGlossaryToTokens(glossaryContent, totalTokens, 33200);
        tokenRes = await ai.models.countTokens({
          model: "gemini-flash-lite-latest",
          contents: glossaryContent
        });
        totalTokens = tokenRes.totalTokens || 0;
        console.log(`[Gemini Cache] Padded glossary: ${totalTokens} tokens`);
      }

      const cache = await ai.caches.create({
        model: "gemini-flash-lite-latest",
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
      const match = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (match) {
        clean = match[1].trim();
      } else {
        clean = clean.replace(/^```json/i, "").replace(/```$/i, "").trim();
      }
      return JSON.parse(clean);
    } catch {
      return null;
    }
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
          console.error("[API] detectPanelsLocalYolo: External YOLO failed.", err.message);
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
          const yoloRes = await fetch(yoloUrl, {
            method: "POST",
            headers: { "Authorization": `Bearer ${yoloKey || ''}`, "Content-Type": "application/json" },
            body: JSON.stringify({ base64Image: rawBase64 })
          });
          if (yoloRes.ok) {
            const data = await yoloRes.json();
            if (data?.boxes && Array.isArray(data.boxes)) return res.json(data.boxes);
          }
        } catch (err) {
          console.error("[API] YOLO failed, falling back to Gemini.", err);
        }
      }

      const ai = getAIClient();
      if (!ai) return res.status(500).json({ error: "GEMINI_API_KEY not set on server." });

      const cacheName = await getOrCreateGlossaryCache(ai);
      let isCacheHit = false;

      const result = await callWithRetry(() => {
        const payload: any = {
          model: "gemini-flash-lite-latest",
          contents: [{
            parts: [
              {
                text: "Analyze this comic page. Identify every major art panel/frame. Return ONLY the structural bounding boxes of panels (framed rectangular sections containing art). Do NOT include characters or faces. Return a JSON list: [[ymin, xmin, ymax, xmax], ...] with coordinates 0–1000. Empty list if no panels found."
              },
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

        if (cacheName) {
          payload.config.cachedContent = cacheName;
          isCacheHit = true;
        }

        return ai.models.generateContent(payload);
      },
        res, "detectPanels"
      );
      if (!result) return; // 429 already sent

      let parsed = parseJsonSafely(result.text, []);
      if (!parsed) { console.warn("[API] detectPanels parse failed. Raw:", result.text); parsed = []; }

      if (isCacheHit) {
        res.setHeader("x-gemini-cache-hit", "true");
        console.log("[Gemini Cache] Used context cache for detectPanels call!");
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
      const ai = getAIClient();
      if (!ai) return res.status(500).json({ error: "GEMINI_API_KEY not set on server." });

      const { base64Image, suggestedCount } = req.body;
      if (!base64Image || typeof base64Image !== 'string') {
        return res.status(400).json({ error: 'base64Image is required' });
      }

      console.log(`[API] Image size: ${Math.round(base64Image.length / 1024)} KB`);

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

      const rawBase64 = base64Image.split(",")[1] || base64Image;

      const cacheName = await getOrCreateGlossaryCache(ai);
      let isCacheHit = false;

      const result = await callWithRetry(() => {
        const payload: any = {
          model: "gemini-flash-lite-latest",
          contents: [{
            parts: [
              { text: promptText },
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
      },
        res, "detectText"
      );
      if (!result) return;

      let parsed: TextBlock[] = parseJsonSafely(result.text, []);
      if (!parsed) {
        console.warn("[API] detectText parse failed. Raw:", result.text);
        parsed = [];
      }

      parsed = parsed.map(block => ({
        ...block,
        text: normalizeBlockText(block.text)
      }));

      parsed = parsed.filter(block => block.text.length > 0);
      parsed = sortTextsReadingOrder(parsed);

      if (isCacheHit) {
        res.setHeader("x-gemini-cache-hit", "true");
        console.log("[Gemini Cache] Used context cache for detectText call!");
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
      const ai = getAIClient();
      if (!ai) return res.status(500).json({ error: "GEMINI_API_KEY not set on server." });

      const { texts, targetLanguage } = req.body;
      if (!texts || !Array.isArray(texts)) {
        return res.status(400).json({ error: 'texts array is required' });
      }
      if (!targetLanguage || typeof targetLanguage !== 'string') {
        return res.status(400).json({ error: 'targetLanguage is required' });
      }

      console.log(`[API] Translating ${texts.length} items to ${targetLanguage}`);

      const cacheName = await getOrCreateGlossaryCache(ai);
      let isCacheHit = false;

      const result = await callWithRetry(() => {
        const payload: any = {
          model: "gemini-flash-lite-latest",
          contents: [{
            parts: [
              {
                text: `Translate the following texts to ${targetLanguage}. Return a JSON array of strings in the EXACT SAME ORDER. If a text is already in ${targetLanguage}, leave it unchanged.`
              },
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
      },
        res, "translate"
      );
      if (!result) return;

      let parsed = parseJsonSafely(result.text, texts);
      if (!parsed || !Array.isArray(parsed)) {
        console.warn("[API] translate parse failed, returning originals. Raw:", result.text);
        parsed = texts;
      }

      if (isCacheHit) {
        res.setHeader("x-gemini-cache-hit", "true");
        console.log("[Gemini Cache] Used context cache for translate call!");
      }
      res.json(parsed);

    } catch (e: any) {
      console.error(e);
      return handleGeminiError(e, res);
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

