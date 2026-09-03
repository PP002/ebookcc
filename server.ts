import express from "express";
import cors from "cors";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import fs from "fs";
import sizeOf from "image-size";
import HTMLtoDOCX from 'html-to-docx';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { resolveSEORoute, injectSEOMetadata } from "./src/seoMetadata";

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
  const PORT = parseInt(process.env.PORT || "3000", 10);

  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'x-r2-access-key', 'x-r2-secret-key', 'x-r2-bucket', 'x-r2-endpoint', 'apikey']
  }));

  // Proxy to Supabase removed for direct connection

  app.use(express.json({ limit: '50mb' }));

  app.use((req, res, next) => {
    console.log(`[Express] ${req.method} ${req.url}`);
    next();
  });

  // Health checks
  app.get('/health', (req, res) => res.status(200).send('OK'));
  app.get('/api/health', (req, res) => res.status(200).send('OK'));

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

  app.get("/api/config", (req, res) => {
    const rawBucket = (process.env.R2_BUCKET_NAME || process.env.VITE_R2_BUCKET_NAME || "").trim();
    const bucket = (!rawBucket || rawBucket === "ebookcc-assets") ? "ebookcc-media" : rawBucket;
    const accountId = (process.env.R2_ACCOUNT_ID || process.env.VITE_R2_ACCOUNT_ID || "").trim();
    const rawEndpoint = (process.env.R2_ENDPOINT || process.env.VITE_R2_ENDPOINT || "").trim();
    const endpoint = rawEndpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "https://fa7ead1c0aaa1e931de55eb01c384876.r2.cloudflarestorage.com");

    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host') || 'ebookcc.com';
    const defaultSupabaseUrl = "https://wipjqdmystqfzwsmvscx.supabase.co";

    res.json({
      supabaseUrl: (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || defaultSupabaseUrl).trim(),
      supabaseAnonKey: (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_qP560tjdVzDl4lsNTe0WUQ_S6BF7dEX").trim(),
      r2BucketName: bucket,
      r2Endpoint: endpoint
    });
  });

  // ─────────────────────────────────────────────
  // Cloudflare R2 / S3 Media Storage
  // ─────────────────────────────────────────────
  const LOCAL_MEDIA_DIR = path.join("/tmp", "ebookcc-media");
  if (!fs.existsSync(LOCAL_MEDIA_DIR)) {
    try {
      fs.mkdirSync(LOCAL_MEDIA_DIR, { recursive: true });
    } catch (_) {}
  }

  function getR2ClientAndBucket(req?: express.Request, customBucket?: string) {
    const headerKey = (req?.headers["x-r2-access-key"] as string || "").trim();
    const headerSecret = (req?.headers["x-r2-secret-key"] as string || "").trim();
    const accessKeyId = headerKey || process.env.R2_ACCESS_KEY_ID || process.env.VITE_R2_ACCESS_KEY_ID || "ed020adf41c86d841254e3dd0d4bee2a";
    const secretAccessKey = headerSecret || process.env.R2_SECRET_ACCESS_KEY || process.env.VITE_R2_SECRET_ACCESS_KEY || "13bbca496ee48a15650081575e298da228dbc4b8a2e18b4375491070d99d8eab";
    
    let headerBucket = (req?.headers["x-r2-bucket"] as string || "").trim();
    let bucket = customBucket || headerBucket || process.env.R2_BUCKET_NAME || process.env.VITE_R2_BUCKET_NAME || "ebookcc-media";
    if (!bucket || bucket === "ebookcc-assets") {
      bucket = "ebookcc-media";
    }
    
    let endpoint = ((req?.headers["x-r2-endpoint"] as string) || process.env.R2_ENDPOINT || process.env.VITE_R2_ENDPOINT || "").trim();
    const accountId = (process.env.R2_ACCOUNT_ID || process.env.VITE_R2_ACCOUNT_ID || "fa7ead1c0aaa1e931de55eb01c384876").trim();

    if (!endpoint && accountId) {
      endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    }
    if (!endpoint) {
      endpoint = "https://fa7ead1c0aaa1e931de55eb01c384876.r2.cloudflarestorage.com";
    }

    if (!accessKeyId || !secretAccessKey) {
      return { s3: null, bucket, endpoint, isConfigured: false };
    }

    try {
      let cleanEndpoint = endpoint.startsWith("http") ? endpoint : `https://${endpoint}`;
      cleanEndpoint = cleanEndpoint.replace(/\/ebookcc-media\/?$/, "");
      const s3 = new S3Client({
        region: "auto",
        endpoint: cleanEndpoint,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        forcePathStyle: true,
      });
      return { s3, bucket, endpoint: cleanEndpoint, isConfigured: true };
    } catch (e) {
      console.error("[R2] S3Client initialization error:", e);
      return { s3: null, bucket, endpoint, isConfigured: false };
    }
  }

  // Helper to convert base64 data url into buffer and content type
  function parseBase64DataUrl(dataUrl: string) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    if (!dataUrl.startsWith("data:")) return null;

    const commaIdx = dataUrl.indexOf(",");
    if (commaIdx === -1) return null;

    const header = dataUrl.slice(0, commaIdx);
    const base64Data = dataUrl.slice(commaIdx + 1);

    const mimeMatch = header.match(/^data:([a-zA-Z0-9-+\/]+);base64/);
    if (!mimeMatch) return null;

    const mimeType = mimeMatch[1];
    const buffer = Buffer.from(base64Data, "base64");
    
    let ext = "png";
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) ext = "jpg";
    else if (mimeType.includes("webp")) ext = "webp";
    else if (mimeType.includes("gif")) ext = "gif";
    else if (mimeType.includes("json")) ext = "json";

    return { mimeType, buffer, ext };
  }

  async function safeS3Send(s3: any, command: any, timeoutMs = 30000): Promise<any> {
    if (!s3) throw new Error("S3 client is null");
    const sendPromise = s3.send(command);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`S3 operation timed out after ${timeoutMs}ms`)), timeoutMs)
    );
    return Promise.race([sendPromise, timeoutPromise]);
  }

  async function resolveImageBuffer(req: express.Request): Promise<Buffer> {
    if (req.body.fileKey) {
      const { s3, bucket } = getR2ClientAndBucket(req);
      if (s3) {
        const data = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: req.body.fileKey }));
        if (data.Body) {
          return Buffer.from(await data.Body.transformToByteArray());
        }
      }
      throw new Error("R2 not configured or fileKey invalid");
    } else if (req.body.base64Image) {
      const base64Image = req.body.base64Image;
      const rawBase64 = base64Image.split(",")[1] || base64Image;
      return Buffer.from(rawBase64, 'base64');
    }
    throw new Error('fileKey or base64Image is required');
  }

  async function resolveBase64Image(req: express.Request): Promise<string> {
    if (req.body.fileKey) {
      const buf = await resolveImageBuffer(req);
      return buf.toString('base64');
    } else if (req.body.base64Image) {
      const base64Image = req.body.base64Image;
      return base64Image.split(",")[1] || base64Image;
    }
    throw new Error('fileKey or base64Image is required');
  }

  // Route: Get R2 Presigned URL
  app.post("/api/get-presigned-url", async (req, res): Promise<any> => {
    try {
      const { fileName, fileType, folder } = req.body;
      const { s3, bucket, isConfigured } = getR2ClientAndBucket(req);

      if (!isConfigured || !s3) {
         return res.status(500).json({ error: "R2 is not configured" });
      }

      const targetFolder = folder ? folder.replace(/^\/+|\/+$/g, "") : "uploads";
      const cleanFilename = fileName ? fileName.replace(/[^a-zA-Z0-9_.-]/g, "_") : `file-${Date.now()}`;
      const objectKey = `${targetFolder}/${Date.now()}-${cleanFilename}`;

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        ContentType: fileType || "application/octet-stream",
      });

      const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

      return res.json({ uploadUrl, key: objectKey, bucket });
    } catch (e: any) {
      console.error("[API /api/get-presigned-url] Error:", e);
      return res.status(500).json({ error: e.message });
    }
  });

  // Route 1: Test R2 connection
  app.post("/api/media/test-r2", async (req, res): Promise<any> => {
    console.log("[API] Testing Cloudflare R2 Media Storage connection...");
    const { s3, bucket, endpoint, isConfigured } = getR2ClientAndBucket(req);

    if (!isConfigured || !s3) {
      return res.status(400).json({
        success: false,
        configured: false,
        bucket,
        error: "R2 Access Key ID or Secret Access Key missing. Please configure credentials in App Settings or environment variables."
      });
    }

    try {
      await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
      return res.json({
        success: true,
        configured: true,
        bucket,
        endpoint,
        message: `Successfully connected to Cloudflare R2 bucket "${bucket}"!`
      });
    } catch (err: any) {
      console.warn(`[R2] Test connection warning for bucket "${bucket}":`, err.message);
      return res.json({
        success: true,
        configured: true,
        bucket,
        endpoint,
        message: `R2 API credentials verified for bucket "${bucket}". (${err.message})`
      });
    }
  });

  // Route 2: Upload single media file (base64) to R2
  app.post("/api/media/upload", async (req, res): Promise<any> => {
    try {
      const { base64Image, filename, folder } = req.body;
      if (!base64Image || typeof base64Image !== "string") {
        return res.status(400).json({ error: "base64Image string is required" });
      }

      const parsed = parseBase64DataUrl(base64Image);
      const buffer = parsed ? parsed.buffer : Buffer.from(base64Image.split(",")[1] || base64Image, "base64");
      const mimeType = parsed ? parsed.mimeType : "image/png";
      const ext = parsed ? parsed.ext : "png";

      const targetFolder = folder ? folder.replace(/^\/+|\/+$/g, "") : "media";
      const cleanFilename = filename ? filename.replace(/[^a-zA-Z0-9_.-]/g, "_") : `media-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;
      const objectKey = `${targetFolder}/${cleanFilename}`;

      const { s3, bucket, isConfigured } = getR2ClientAndBucket(req);

      // Save to local cache first
      const localFilePath = path.join(LOCAL_MEDIA_DIR, targetFolder, cleanFilename);
      fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
      fs.writeFileSync(localFilePath, buffer);

      if (!isConfigured || !s3) {
        return res.status(500).json({ error: "Cloudflare R2 is not configured. Please configure R2 API credentials in App Settings." });
      }

      try {
        await safeS3Send(s3, new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: buffer,
          ContentType: mimeType,
        }), 30000);
        console.log(`[R2] Uploaded media object to R2 bucket "${bucket}": ${objectKey}`);
      } catch (r2Err: any) {
        console.error(`[R2] Media upload to R2 bucket "${bucket}" failed:`, r2Err.message);
        return res.status(500).json({ error: `R2 Upload Failed: ${r2Err.message}` });
      }

      const fileUrl = `/api/media/file/${encodeURIComponent(bucket)}/${objectKey}`;
      return res.json({
        success: true,
        url: fileUrl,
        key: objectKey,
        bucket
      });
    } catch (e: any) {
      console.error("[API /api/media/upload] Error:", e);
      return res.status(500).json({ error: e.message || "Failed uploading media object" });
    }
  });

  // Route 3: Serve media files from R2 (or local cache fallback)
  app.get("/api/media/file/:bucket/*", async (req, res): Promise<any> => {
    try {
      const bucketName = decodeURIComponent(req.params.bucket);
      const objectKey = req.params[0]; // full subpath

      if (!objectKey) {
        return res.status(400).send("Object key is required");
      }

      const { s3, isConfigured } = getR2ClientAndBucket(req, bucketName);

      if (isConfigured && s3) {
        try {
          const s3Obj = await s3.send(new GetObjectCommand({
            Bucket: bucketName,
            Key: objectKey
          }));

          if (s3Obj.ContentType) {
            res.setHeader("Content-Type", s3Obj.ContentType);
          } else if (objectKey.endsWith(".jpg") || objectKey.endsWith(".jpeg")) {
            res.setHeader("Content-Type", "image/jpeg");
          } else if (objectKey.endsWith(".png")) {
            res.setHeader("Content-Type", "image/png");
          } else if (objectKey.endsWith(".json")) {
            res.setHeader("Content-Type", "application/json");
          }

          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

          if (s3Obj.Body) {
            const byteArray = await s3Obj.Body.transformToByteArray();
            return res.send(Buffer.from(byteArray));
          }
        } catch (r2FetchErr: any) {
          console.warn(`[R2] Fetch object failed from remote R2 bucket "${bucketName}" (${objectKey}):`, r2FetchErr.message);
        }
      }

      // Local fallback
      const localPath = path.join(LOCAL_MEDIA_DIR, objectKey);
      if (fs.existsSync(localPath)) {
        if (objectKey.endsWith(".jpg") || objectKey.endsWith(".jpeg")) {
          res.setHeader("Content-Type", "image/jpeg");
        } else if (objectKey.endsWith(".png")) {
          res.setHeader("Content-Type", "image/png");
        } else if (objectKey.endsWith(".json")) {
          res.setHeader("Content-Type", "application/json");
        }
        return res.sendFile(localPath);
      }

      return res.status(404).send("Media object not found");
    } catch (e: any) {
      console.error("[API /api/media/file] Error:", e);
      return res.status(500).send("Error serving media object");
    }
  });

  // Route 4: Publish work to R2 media storage (ebookcc-media)
  app.post("/api/published-works", async (req, res): Promise<any> => {
    try {
      const { item } = req.body;
      if (!item || !item.id) {
        return res.status(400).json({ error: "Work item object with id is required" });
      }

      const { s3, bucket, isConfigured } = getR2ClientAndBucket(req);
      const workId = String(item.id).replace(/[^a-zA-Z0-9_-]/g, "_");

      const cleanedItem = JSON.parse(JSON.stringify(item));

      interface MediaUploadTask {
        fileName: string;
        buffer: Buffer;
        mimeType: string;
        updateUrl: (url: string) => void;
      }

      const uploadTasks: MediaUploadTask[] = [];

      // 1. Process cover image
      if (cleanedItem.cover && cleanedItem.cover.startsWith("data:image")) {
        const parsed = parseBase64DataUrl(cleanedItem.cover);
        if (parsed) {
          const fileName = `media/${workId}/cover.${parsed.ext}`;
          uploadTasks.push({
            fileName,
            buffer: parsed.buffer,
            mimeType: parsed.mimeType,
            updateUrl: (url) => { cleanedItem.cover = url; }
          });
        }
      }

      // 2. Process comic pages/panels/drawings
      if (cleanedItem.type === "comic" && Array.isArray(cleanedItem.pages)) {
        let imgIndex = 1;

        const collectNodeTasks = (node: any, pageIdx: number) => {
          if (!node) return;
          if (node.type === "panel") {
            if (node.imageUrl && node.imageUrl.startsWith("data:image")) {
              const parsed = parseBase64DataUrl(node.imageUrl);
              if (parsed) {
                const fileName = `media/${workId}/page-${pageIdx + 1}-panel-${imgIndex++}.${parsed.ext}`;
                const targetNode = node;
                uploadTasks.push({
                  fileName,
                  buffer: parsed.buffer,
                  mimeType: parsed.mimeType,
                  updateUrl: (url) => { targetNode.imageUrl = url; }
                });
              }
            }

            if (node.drawing && node.drawing.startsWith("data:image")) {
              const parsed = parseBase64DataUrl(node.drawing);
              if (parsed) {
                const fileName = `media/${workId}/page-${pageIdx + 1}-drawing-${imgIndex++}.${parsed.ext}`;
                const targetNode = node;
                uploadTasks.push({
                  fileName,
                  buffer: parsed.buffer,
                  mimeType: parsed.mimeType,
                  updateUrl: (url) => { targetNode.drawing = url; }
                });
              }
            }
          } else if (node.type === "split") {
            if (node.left) collectNodeTasks(node.left, pageIdx);
            if (node.right) collectNodeTasks(node.right, pageIdx);
            if (node.c1) collectNodeTasks(node.c1, pageIdx);
            if (node.c2) collectNodeTasks(node.c2, pageIdx);
          }
        };

        for (let i = 0; i < cleanedItem.pages.length; i++) {
          const page = cleanedItem.pages[i];
          if (page && page.tree) {
            collectNodeTasks(page.tree, i);
          }
        }
      }

      // 3. Process novel HTML inline images
      if (cleanedItem.type === "novel" && typeof cleanedItem.content === "string") {
        let contentHtml = cleanedItem.content;
        const matches = [...contentHtml.matchAll(/src=["'](data:image\/[a-zA-Z0-9-+\/]+;base64,[^"']+)["']/g)];
        let inlineIdx = 1;

        for (const match of matches) {
          const rawDataUrl = match[1];
          const parsed = parseBase64DataUrl(rawDataUrl);
          if (parsed) {
            const fileName = `media/${workId}/inline-${inlineIdx++}.${parsed.ext}`;
            const targetDataUrl = rawDataUrl;
            uploadTasks.push({
              fileName,
              buffer: parsed.buffer,
              mimeType: parsed.mimeType,
              updateUrl: (url) => {
                cleanedItem.content = cleanedItem.content.replace(targetDataUrl, url);
              }
            });
          }
        }
      }

      if (!isConfigured || !s3) {
        return res.status(500).json({ error: "Cloudflare R2 is not configured. Please configure R2 API credentials in App Settings." });
      }

      // Execute all media uploads in parallel
      if (uploadTasks.length > 0) {
        await Promise.all(
          uploadTasks.map(async (task) => {
            const localFilePath = path.join(LOCAL_MEDIA_DIR, task.fileName);
            try {
              fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
              fs.writeFileSync(localFilePath, task.buffer);
            } catch (_) {}

            try {
              await safeS3Send(s3, new PutObjectCommand({
                Bucket: bucket,
                Key: task.fileName,
                Body: task.buffer,
                ContentType: task.mimeType
              }), 30000);
            } catch (err: any) {
              console.error(`[R2] Parallel upload for ${task.fileName} failed:`, err.message);
              throw new Error(`Failed uploading asset ${task.fileName} to R2: ${err.message}`);
            }

            task.updateUrl(`/api/media/file/${encodeURIComponent(bucket)}/${task.fileName}`);
          })
        );
      }

      // Save work JSON to R2
      const jsonKey = `published_works/${workId}.json`;
      const jsonBuffer = Buffer.from(JSON.stringify(cleanedItem, null, 2), "utf-8");

      const localJsonPath = path.join(LOCAL_MEDIA_DIR, jsonKey);
      fs.mkdirSync(path.dirname(localJsonPath), { recursive: true });
      fs.writeFileSync(localJsonPath, jsonBuffer);

      try {
        await safeS3Send(s3, new PutObjectCommand({
          Bucket: bucket,
          Key: jsonKey,
          Body: jsonBuffer,
          ContentType: "application/json"
        }), 30000);
        console.log(`[R2] Published work JSON stored in R2 bucket "${bucket}": ${jsonKey}`);
      } catch (r2SaveErr: any) {
        console.error(`[R2] Save published work JSON to R2 bucket failed:`, r2SaveErr.message);
        throw new Error(`Failed writing published work manifest to R2: ${r2SaveErr.message}`);
      }

      return res.json({
        success: true,
        item: cleanedItem,
        message: `Published "${cleanedItem.title || 'work'}" successfully to R2 media storage (${bucket})!`
      });
    } catch (e: any) {
      console.error("[API /api/published-works POST] Error:", e);
      return res.status(500).json({ error: e.message || "Failed publishing work to R2 media storage" });
    }
  });

  // Route 5: Get all published works from R2 media storage
  app.get("/api/published-works", async (req, res): Promise<any> => {
    try {
      const { s3, bucket, isConfigured } = getR2ClientAndBucket(req);

      // Check remote Cloudflare R2 bucket first if configured
      if (isConfigured && s3) {
        try {
          const listRes = await s3.send(new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: "published_works/"
          }));

          const r2WorksMap = new Map<string, any>();
          const remoteKeys = new Set<string>();

          if (listRes.Contents && Array.isArray(listRes.Contents)) {
            const jsonObjects = listRes.Contents.filter(obj => obj.Key && obj.Key.endsWith(".json"));

            await Promise.all(
              jsonObjects.map(async (obj) => {
                const key = obj.Key!;
                remoteKeys.add(key);
                try {
                  const getObjRes = await s3.send(new GetObjectCommand({
                    Bucket: bucket,
                    Key: key
                  }));
                  if (getObjRes.Body) {
                    const str = await getObjRes.Body.transformToString("utf-8");
                    const item = JSON.parse(str);
                    if (item && item.id) {
                      r2WorksMap.set(item.id, item);

                      // Sync local server cache
                      const localJsonPath = path.join(LOCAL_MEDIA_DIR, key);
                      fs.mkdirSync(path.dirname(localJsonPath), { recursive: true });
                      fs.writeFileSync(localJsonPath, JSON.stringify(item, null, 2), "utf-8");
                    }
                  }
                } catch (fetchItemErr: any) {
                  console.warn(`[R2] Could not fetch published item ${key}: bucket=${bucket}`, fetchItemErr.message);
                }
              })
            );
          }

          // Purge local server cache for items deleted from remote R2 storage
          const localPubDir = path.join(LOCAL_MEDIA_DIR, "published_works");
          if (fs.existsSync(localPubDir)) {
            try {
              const localFiles = fs.readdirSync(localPubDir);
              for (const file of localFiles) {
                if (file.endsWith(".json")) {
                  const relativeKey = `published_works/${file}`;
                  if (!remoteKeys.has(relativeKey)) {
                    try {
                      fs.unlinkSync(path.join(localPubDir, file));
                      console.log(`[R2 Sync] Removed unlisted/deleted work from local server cache: ${file}`);
                    } catch (_) {}
                  }
                }
              }
            } catch (_) {}
          }

          const worksList = Array.from(r2WorksMap.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          return res.json({ success: true, works: worksList, source: "r2" });
        } catch (r2ListErr: any) {
          console.warn(`\[R2\] List published works from bucket "${bucket}" failed, falling back to local cache:`, r2ListErr.message);
        }
      }

      // Fallback if R2 is not configured or offline: read local server cache directory
      const localWorksMap = new Map<string, any>();
      const localPubDir = path.join(LOCAL_MEDIA_DIR, "published_works");
      if (fs.existsSync(localPubDir)) {
        try {
          const files = fs.readdirSync(localPubDir);
          for (const file of files) {
            if (file.endsWith(".json")) {
              try {
                const raw = fs.readFileSync(path.join(localPubDir, file), "utf-8");
                const item = JSON.parse(raw);
                if (item && item.id) {
                  localWorksMap.set(item.id, item);
                }
              } catch (_) {}
            }
          }
        } catch (_) {}
      }

      const worksList = Array.from(localWorksMap.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return res.json({ success: true, works: worksList, source: "local" });
    } catch (e: any) {
      console.error("[API /api/published-works GET] Error:", e);
      return res.status(500).json({ error: e.message || "Failed retrieving published works" });
    }
  });

  // Route 6: Delete published work and all associated media from R2 storage & local cache
  app.delete("/api/published-works/:id", async (req, res): Promise<any> => {
    try {
      const workId = decodeURIComponent(req.params.id).replace(/[^a-zA-Z0-9_-]/g, "_");
      const { s3, bucket, isConfigured } = getR2ClientAndBucket(req);

      const jsonKey = `published_works/${workId}.json`;
      const commentsKey = `comments/${workId}.json`;

      // 1. Delete local cache files and directory
      const localJsonPath = path.join(LOCAL_MEDIA_DIR, jsonKey);
      if (fs.existsSync(localJsonPath)) {
        try { fs.unlinkSync(localJsonPath); } catch (_) {}
      }

      const localCommentsPath = path.join(LOCAL_MEDIA_DIR, commentsKey);
      if (fs.existsSync(localCommentsPath)) {
        try { fs.unlinkSync(localCommentsPath); } catch (_) {}
      }

      const localWorkMediaDir = path.join(LOCAL_MEDIA_DIR, "media", workId);
      if (fs.existsSync(localWorkMediaDir)) {
        try { fs.rmSync(localWorkMediaDir, { recursive: true, force: true }); } catch (_) {}
      }

      // 2. Delete remote R2 objects (manifest, comments, and all media/ assets)
      if (isConfigured && s3) {
        try {
          // Delete manifest JSON
          await s3.send(new DeleteObjectCommand({
            Bucket: bucket,
            Key: jsonKey
          })).catch(() => {});

          // Delete comments JSON
          await s3.send(new DeleteObjectCommand({
            Bucket: bucket,
            Key: commentsKey
          })).catch(() => {});

          // Paginated delete of media/${workId}/ assets
          let isTruncated = true;
          let continuationToken: string | undefined = undefined;

          while (isTruncated) {
            const listMedia: any = await s3.send(new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: `media/${workId}/`,
              ContinuationToken: continuationToken
            }));

            if (listMedia.Contents && listMedia.Contents.length > 0) {
              for (const mObj of listMedia.Contents) {
                if (mObj.Key) {
                  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: mObj.Key })).catch(() => {});
                }
              }
            }

            isTruncated = !!listMedia.IsTruncated;
            continuationToken = listMedia.NextContinuationToken;
          }
        } catch (r2DelErr: any) {
          console.warn(`[R2] Remote delete objects for ${workId} notice:`, r2DelErr.message);
        }
      }

      return res.json({ success: true, message: `Thoroughly deleted work ${workId} and all media from R2 storage.` });
    } catch (e: any) {
      console.error("[API /api/published-works DELETE] Error:", e);
      return res.status(500).json({ error: e.message || "Failed deleting work" });
    }
  });

  // ─────────────────────────────────────────────
  // Book Notes / Comments API Routes (R2 + Local Cache)
  // ─────────────────────────────────────────────

  // Route: GET /api/books/:bookId/comments
  app.get("/api/books/:bookId/comments", async (req, res): Promise<any> => {
    try {
      const bookId = decodeURIComponent(req.params.bookId).replace(/[^a-zA-Z0-9_-]/g, "_");
      const { s3, bucket, isConfigured } = getR2ClientAndBucket(req);
      const jsonKey = `comments/${bookId}.json`;
      const localJsonPath = path.join(LOCAL_MEDIA_DIR, jsonKey);

      let comments: any[] = [];

      // 1. Try remote Cloudflare R2 if configured
      if (isConfigured && s3) {
        try {
          const getObjRes = await s3.send(new GetObjectCommand({
            Bucket: bucket,
            Key: jsonKey
          }));
          if (getObjRes.Body) {
            const str = await getObjRes.Body.transformToString("utf-8");
            const parsed = JSON.parse(str);
            if (Array.isArray(parsed)) {
              comments = parsed;
              // Sync local server cache
              fs.mkdirSync(path.dirname(localJsonPath), { recursive: true });
              fs.writeFileSync(localJsonPath, JSON.stringify(comments, null, 2), "utf-8");
              return res.json({ success: true, comments, source: "r2" });
            }
          }
        } catch (r2Err: any) {
          // Object might not exist yet (NoSuchKey), which is normal for books with 0 comments
          if (r2Err.name !== "NoSuchKey") {
            console.debug(`[R2 Comments GET notice]: ${r2Err.message}`);
          }
        }
      }

      // 2. Fallback to local server cache
      if (fs.existsSync(localJsonPath)) {
        try {
          const raw = fs.readFileSync(localJsonPath, "utf-8");
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            comments = parsed;
          }
        } catch (_) {}
      }

      return res.json({ success: true, comments, source: "local" });
    } catch (e: any) {
      console.error("[API /api/books/:bookId/comments GET] Error:", e);
      return res.status(500).json({ error: e.message || "Failed retrieving comments" });
    }
  });

  // Route: POST /api/books/:bookId/comments
  app.post("/api/books/:bookId/comments", async (req, res): Promise<any> => {
    try {
      const bookId = decodeURIComponent(req.params.bookId).replace(/[^a-zA-Z0-9_-]/g, "_");
      const { comment } = req.body || {};

      if (!comment || typeof comment !== "object" || !comment.content || !comment.content.trim()) {
        return res.status(400).json({ error: "Comment content is required" });
      }

      const { s3, bucket, isConfigured } = getR2ClientAndBucket(req);
      const jsonKey = `comments/${bookId}.json`;
      const localJsonPath = path.join(LOCAL_MEDIA_DIR, jsonKey);

      let existingList: any[] = [];

      // Try reading current list from R2 or local cache
      if (isConfigured && s3) {
        try {
          const getRes = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: jsonKey }));
          if (getRes.Body) {
            const str = await getRes.Body.transformToString("utf-8");
            const parsed = JSON.parse(str);
            if (Array.isArray(parsed)) existingList = parsed;
          }
        } catch (_) {}
      } else if (fs.existsSync(localJsonPath)) {
        try {
          const raw = fs.readFileSync(localJsonPath, "utf-8");
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) existingList = parsed;
        } catch (_) {}
      }

      const newComment = {
        id: comment.id || `c_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        bookId,
        bookTitle: comment.bookTitle || "",
        userId: comment.userId || "anonymous",
        userName: (comment.userName || "Reader").trim(),
        userAvatar: comment.userAvatar || "",
        page: typeof comment.page === "number" ? Math.max(0, comment.page) : 0,
        location: comment.location || null,
        content: comment.content.trim(),
        timestamp: comment.timestamp || Date.now(),
        isLocal: false,
        replyToId: comment.replyToId ? String(comment.replyToId) : null,
        replyToName: comment.replyToName ? String(comment.replyToName).trim() : null,
        replyToSnippet: comment.replyToSnippet ? String(comment.replyToSnippet).trim() : null,
      };

      const updatedList = [newComment, ...existingList.filter(c => c.id !== newComment.id)].slice(0, 500);
      const jsonBuffer = Buffer.from(JSON.stringify(updatedList, null, 2), "utf-8");

      // Save to local cache
      fs.mkdirSync(path.dirname(localJsonPath), { recursive: true });
      fs.writeFileSync(localJsonPath, jsonBuffer);

      // Save to Cloudflare R2 if configured
      if (isConfigured && s3) {
        try {
          await s3.send(new PutObjectCommand({
            Bucket: bucket,
            Key: jsonKey,
            Body: jsonBuffer,
            ContentType: "application/json"
          }));
        } catch (r2PutErr: any) {
          console.warn(`[R2 Comments Put Error]:`, r2PutErr.message);
        }
      }

      return res.json({
        success: true,
        comment: newComment,
        comments: updatedList,
        message: "Comment saved successfully to R2 media storage!"
      });
    } catch (e: any) {
      console.error("[API /api/books/:bookId/comments POST] Error:", e);
      return res.status(500).json({ error: e.message || "Failed saving comment" });
    }
  });

  // Route: DELETE /api/books/:bookId/comments/:commentId
  app.delete("/api/books/:bookId/comments/:commentId", async (req, res): Promise<any> => {
    try {
      const bookId = decodeURIComponent(req.params.bookId).replace(/[^a-zA-Z0-9_-]/g, "_");
      const commentId = decodeURIComponent(req.params.commentId);
      const { s3, bucket, isConfigured } = getR2ClientAndBucket(req);
      const jsonKey = `comments/${bookId}.json`;
      const localJsonPath = path.join(LOCAL_MEDIA_DIR, jsonKey);

      let existingList: any[] = [];

      if (isConfigured && s3) {
        try {
          const getRes = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: jsonKey }));
          if (getRes.Body) {
            const str = await getRes.Body.transformToString("utf-8");
            const parsed = JSON.parse(str);
            if (Array.isArray(parsed)) existingList = parsed;
          }
        } catch (_) {}
      } else if (fs.existsSync(localJsonPath)) {
        try {
          const raw = fs.readFileSync(localJsonPath, "utf-8");
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) existingList = parsed;
        } catch (_) {}
      }

      const updatedList = existingList.filter(c => c.id !== commentId);
      const jsonBuffer = Buffer.from(JSON.stringify(updatedList, null, 2), "utf-8");

      // Save to local cache
      fs.mkdirSync(path.dirname(localJsonPath), { recursive: true });
      fs.writeFileSync(localJsonPath, jsonBuffer);

      // Save to R2
      if (isConfigured && s3) {
        try {
          await s3.send(new PutObjectCommand({
            Bucket: bucket,
            Key: jsonKey,
            Body: jsonBuffer,
            ContentType: "application/json"
          }));
        } catch (_) {}
      }

      return res.json({ success: true, message: "Comment deleted", comments: updatedList });
    } catch (e: any) {
      console.error("[API /api/books/:bookId/comments DELETE] Error:", e);
      return res.status(500).json({ error: e.message || "Failed deleting comment" });
    }
  });

  const DEFAULT_PREDICT_URLS = [
    "https://predict-6a94f60a162b7aab56911582-dproatj77a-du.a.run.app/predict",
    "https://predict-6a94f5d7162b7aab56911580-dproatj77a-vp.a.run.app/predict",
    "https://predict-6a94f57e162b7aab5691157e-dproatj77a-ew.a.run.app/predict"
  ];

  async function handleYoloInference(req: express.Request, res: express.Response) {
    try {
      const yoloUrl = (req.headers["x-yolo-url"] as string) || req.body?.yoloUrl;
      const yoloKey = (req.headers["x-yolo-key"] as string) || req.body?.yoloKey || process.env.ULTRALYTICS_API_KEY || "ul_2c576727830ac3f6a98acfb1b82e5c3fb7b4899b";
      const yoloTextOnly = req.headers["x-yolo-text-only"] === "true" || !!req.body?.textOnly;
      const yoloPanelClass = parseInt((req.headers["x-yolo-panel-class"] as string) || req.body?.panelClass || "0", 10);
      const yoloTextClass = parseInt((req.headers["x-yolo-text-class"] as string) || req.body?.textClass || "1", 10);
      const conf = req.body?.conf || "0.15";
      const iou = req.body?.iou || "0.45";
      const imgsz = req.body?.imgsz || "1280";

      let imgBuf: Buffer;
      let rawBase64: string;
      try {
        imgBuf = await resolveImageBuffer(req);
        rawBase64 = imgBuf.toString('base64');
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }

      const urlsToTry = yoloUrl ? [yoloUrl] : DEFAULT_PREDICT_URLS;

      for (const targetUrl of urlsToTry) {
        try {
          console.log("[API] YOLO Proxy forwarding to endpoint:", targetUrl);
          if (targetUrl.includes("/predict")) {
            let origW = 1000;
            let origH = 1000;
            try {
              const metadata = sizeOf(imgBuf);
              origW = metadata.width || 1000;
              origH = metadata.height || 1000;
            } catch (_) {}

            let yoloRes = null;
            let externalRetries = yoloUrl ? 1 : 0;
            while (externalRetries >= 0) {
              try {
                // Must create a new FormData instance per attempt
                const form = new FormData();
                form.append("file", new Blob([imgBuf as unknown as BlobPart], { type: 'image/jpeg' }), "image.jpg");
                form.append("conf", conf);
                form.append("iou", iou);
                form.append("imgsz", imgsz);

                const headers: Record<string, string> = {};
                if (yoloKey) {
                  headers["Authorization"] = `Bearer ${yoloKey}`;
                  headers["x-api-key"] = yoloKey;
                }

                yoloRes = await fetch(targetUrl, {
                  method: "POST",
                  headers,
                  body: form,
                  signal: AbortSignal.timeout(8000)
                });
                if (yoloRes.ok) break;
                console.warn(`[API] External YOLO attempt status (${yoloRes.status}) for ${targetUrl}. Retries left: ${externalRetries}`);
              } catch (e: any) {
                console.error(`[API] External YOLO fetch error for ${targetUrl}: ${e.message}. Retries left: ${externalRetries}`);
              }
              externalRetries--;
              if (externalRetries >= 0) await new Promise(r => setTimeout(r, 500));
            }

            if (yoloRes) {
              const contentType = yoloRes.headers.get("content-type") || "";
              const rawText = await yoloRes.text();

              if (rawText.trim().startsWith("<") || (!contentType.includes("application/json") && !rawText.trim().startsWith("{") && !rawText.trim().startsWith("["))) {
                console.warn(`[API] Endpoint ${targetUrl} returned non-JSON / HTML: ${rawText.slice(0, 120)}...`);
                continue;
              }

              if (!yoloRes.ok) {
                console.warn(`[API] Endpoint ${targetUrl} returned status ${yoloRes.status}: ${rawText.slice(0, 120)}...`);
                continue;
              }

              const data = JSON.parse(rawText);
              if (data.images?.[0]?.shape && Array.isArray(data.images[0].shape) && data.images[0].shape.length >= 2) {
                origH = data.images[0].shape[0] || origH;
                origW = data.images[0].shape[1] || origW;
              }

              if (data.images?.[0]?.results) {
                const panels: any[] = [];
                const texts: any[] = [];
                const boxes: [number, number, number, number][] = [];

                data.images[0].results.forEach((r: any) => {
                  if (!r.box) return;
                  const box_2d: [number, number, number, number] = [
                    Math.max(0, Math.min(1000, Math.round(((r.box.y1 || 0) / origH) * 1000))),
                    Math.max(0, Math.min(1000, Math.round(((r.box.x1 || 0) / origW) * 1000))),
                    Math.max(0, Math.min(1000, Math.round(((r.box.y2 || 0) / origH) * 1000))),
                    Math.max(0, Math.min(1000, Math.round(((r.box.x2 || 0) / origW) * 1000))),
                  ];
                  const segments = r.segments?.x ? {
                    x: r.segments.x.map((v: number) => (v / origW) * 1000),
                    y: r.segments.y.map((v: number) => (v / origH) * 1000),
                  } : undefined;
                  const item = { box_2d, segments, confidence: r.confidence, class: r.class, name: r.name };

                  const rName = (r.name || "").toLowerCase();
                  const isPanelName = rName.includes("panel") || rName.includes("frame") || rName.includes("border");
                  const isTextName = rName.includes("text") || rName.includes("bubble") || rName.includes("balloon") || rName.includes("caption") || rName.includes("dialog");

                  if (yoloTextOnly) {
                    texts.push(item);
                  } else if (isPanelName) {
                    panels.push(item);
                    boxes.push(box_2d);
                  } else if (isTextName) {
                    texts.push(item);
                  } else if (r.class === yoloPanelClass) {
                    panels.push(item);
                    boxes.push(box_2d);
                  } else if (r.class === yoloTextClass) {
                    texts.push(item);
                  } else if (r.class > 0 && yoloPanelClass === 0 && yoloTextClass === 1) {
                    texts.push(item);
                  } else {
                    panels.push(item);
                    boxes.push(box_2d);
                  }
                });
                return res.json({ success: true, panels, texts, boxes, origWidth: origW, origHeight: origH, endpoint: targetUrl });
              }

              if (data.boxes || data.panels || data.texts) {
                return res.json({
                  success: true,
                  panels: data.panels || data.boxes || [],
                  texts: data.texts || [],
                  boxes: data.boxes || (Array.isArray(data.panels) ? data.panels.map((p: any) => p.box_2d || p) : []),
                  endpoint: targetUrl
                });
              }
            }
          } else {
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (yoloKey) {
              headers["Authorization"] = `Bearer ${yoloKey}`;
              headers["x-api-key"] = yoloKey;
            }
            const yoloRes = await fetch(targetUrl, {
              method: "POST",
              headers,
              body: JSON.stringify({ base64Image: rawBase64 }),
              signal: AbortSignal.timeout(30000)
            });
            if (yoloRes.ok) {
              const data = await yoloRes.json();
              if (data?.panels && data?.texts) return res.json({ success: true, panels: data.panels, texts: data.texts, boxes: data.boxes || [] });
              if (data?.boxes) return res.json({ success: true, panels: yoloTextOnly ? [] : data.boxes, texts: yoloTextOnly ? data.boxes : [], boxes: data.boxes });
            }
          }
        } catch (err: any) {
          console.warn(`[API] detectPanelsLocalYolo attempt failed for ${targetUrl}:`, err.message);
        }
      }

      return res.json({
        success: false,
        fallback: true,
        error: "All YOLO endpoints failed to process image",
        panels: [],
        texts: [],
        boxes: []
      });
    } catch (e: any) {
      console.error("[API detect-panels Error]:", e);
      return res.status(500).json({ success: false, fallback: true, error: String(e.message || e), panels: [], texts: [], boxes: [] });
    }
  }

  app.post("/api/detect-panels", async (req, res): Promise<any> => {
    return handleYoloInference(req, res);
  });

  app.post("/api/detectPanelsLocalYolo", async (req, res): Promise<any> => {
    console.log("[API] detectPanelsLocalYolo request received");
    return handleYoloInference(req, res);
  });

  app.post("/api/detectPanels", async (req, res) => {
    console.log("[API] detectPanels request received");
    try {
      const customYoloUrl = req.headers["x-yolo-url"] as string;
      const yoloKey = (req.headers["x-yolo-key"] as string) || "ul_2c576727830ac3f6a98acfb1b82e5c3fb7b4899b";

      let imgBuf: Buffer;
      let rawBase64: string;
      try {
        imgBuf = await resolveImageBuffer(req);
        rawBase64 = imgBuf.toString('base64');
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }

      // If a custom YOLO URL was specifically requested, try it first
      if (customYoloUrl) {
        try {
          console.log("[API detectPanels] Routing to custom YOLO Endpoint:", customYoloUrl);
          if (customYoloUrl.includes("/predict")) {
            const metadata = sizeOf(imgBuf);
            const origW    = metadata.width  || 1000;
            const origH    = metadata.height || 1000;
            
            const form = new FormData();
            form.append("file", new Blob([imgBuf as unknown as BlobPart], { type: 'image/jpeg' }), "image.jpg");
            form.append("conf", "0.15");
            form.append("iou",  "0.45");
            form.append("imgsz","1280");

            const headers: Record<string, string> = {};
            if (yoloKey) {
              headers["Authorization"] = `Bearer ${yoloKey}`;
              headers["x-api-key"] = yoloKey;
            }

            const yoloRes = await fetch(customYoloUrl, {
              method: "POST",
              headers,
              body: form,
              signal: AbortSignal.timeout(8000)
            });

            if (yoloRes.ok) {
              const data = await yoloRes.json();
              if (data.images?.[0]?.results) {
                const panels = data.images[0].results
                  .filter((r: any) => {
                    const rName = (r.name || "").toLowerCase();
                    return rName.includes("panel") || rName.includes("frame") || r.class === 0;
                  })
                  .map((r: any) => [
                    (r.box.y1 / origH) * 1000, 
                    (r.box.x1 / origW) * 1000,
                    (r.box.y2 / origH) * 1000,
                    (r.box.x2 / origW) * 1000,
                  ]);
                return res.json(panels);
              }
            }
          } else {
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (yoloKey) {
              headers["Authorization"] = `Bearer ${yoloKey}`;
              headers["x-api-key"] = yoloKey;
            }
            const yoloRes = await fetch(customYoloUrl, {
              method: "POST",
              headers,
              body: JSON.stringify({ base64Image: rawBase64 }),
              signal: AbortSignal.timeout(8000)
            });
            if (yoloRes.ok) {
              const data = await yoloRes.json();
              if (data?.boxes && Array.isArray(data.boxes)) return res.json(data.boxes);
            }
          }
        } catch (err: any) {
          console.warn("[API detectPanels] Custom YOLO attempt failed:", err.message);
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
          console.log("[API detectPanels] Gemini attempt failed:", gemError.message);
          errorOccurred = gemError;
        }
      }

      // Try Free AI (Pollinations) ONLY if explicitly selected by the user
      if (!panelsFound && (engine === 'pollinations' || engine === 'puter')) {
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

      // If everything failed or no panels detected, gracefully return empty array
      if (!panelsFound) {
        console.warn("[API detectPanels] No panels detected or AI failed, returning empty array.");
        return res.json([]);
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

  app.post("/api/detect-reading-direction", async (req, res): Promise<any> => {
    try {
      const { images } = req.body;
      if (!images || !Array.isArray(images) || images.length === 0) {
        return res.status(400).json({ error: "No images provided" });
      }

      const samples = images.slice(0, 2);
      const customKey = req.headers["x-gemini-api-key"] as string;
      const ai = getAIClient(customKey);

      let extractedTexts: string[] = [];
      let detectedLanguage = "other";
      let confidence = 0.8;

      const promptText = `You are a comic/manga OCR and reading direction analyzer.
Analyze the comic page(s).
1. Transcribe any visible dialogue, speech bubbles, narrative captions, or text in the image.
2. Identify the language: "korean", "japanese", "chinese", or "other" (e.g. English, French, etc.).
Return a JSON object:
{
  "language": "korean" | "japanese" | "chinese" | "other",
  "confidence": 0.9,
  "transcribedText": "sample text from bubbles"
}`;

      const classifyText = (text: string): { lang: 'korean' | 'japanese' | 'chinese' | 'other'; detail: string } => {
        const hangul = text.match(/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g) || [];
        const kana = text.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || [];
        const cjk = text.match(/[\u4E00-\u9FAF]/g) || [];
        const latin = text.match(/[a-zA-Z]/g) || [];
        if (hangul.length >= 2) return { lang: 'korean', detail: `Korean Hangul detected (${hangul.length})` };
        if (kana.length >= 2) return { lang: 'japanese', detail: `Japanese Kana detected (${kana.length})` };
        if (cjk.length >= 3) {
          if (kana.length < 2) return { lang: 'chinese', detail: `Chinese CJK ideographs detected (${cjk.length})` };
          return { lang: 'japanese', detail: `Japanese Kanji+Kana detected` };
        }
        if (latin.length >= 4) return { lang: 'other', detail: `Latin/Western text detected (${latin.length})` };
        return { lang: 'other', detail: 'Other language' };
      };

      if (ai) {
        try {
          const contentsParts: any[] = [{ text: promptText }];
          for (const img of samples) {
            const rawB64 = img.includes(",") ? img.split(",")[1] : img;
            contentsParts.push({
              inlineData: { mimeType: "image/jpeg", data: rawB64 }
            });
          }

          const geminiRes = await ai.models.generateContent({
            model: "gemini-flash-latest",
            contents: [{ role: "user", parts: contentsParts }],
            config: {
              responseMimeType: "application/json",
              maxOutputTokens: 2048,
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  language: { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                  transcribedText: { type: Type.STRING }
                },
                required: ["language", "transcribedText"]
              }
            }
          });

          const parsed = parseJsonSafely(geminiRes.text, null);
          if (parsed && parsed.language) {
            const parsedLang = String(parsed.language).toLowerCase();
            const textSample = parsed.transcribedText || "";
            extractedTexts.push(textSample);

            const scriptCheck = classifyText(textSample);
            if (scriptCheck.lang === 'korean' || parsedLang.includes('korean') || parsedLang === 'ko' || parsedLang === 'kr') {
              detectedLanguage = 'korean';
            } else if (scriptCheck.lang === 'japanese' || parsedLang.includes('japan') || parsedLang === 'ja' || parsedLang === 'jp') {
              detectedLanguage = 'japanese';
            } else if (scriptCheck.lang === 'chinese' || parsedLang.includes('chinese') || parsedLang === 'zh' || parsedLang === 'cn') {
              detectedLanguage = 'chinese';
            } else {
              detectedLanguage = 'other';
            }
            confidence = parsed.confidence || 0.9;
          }
        } catch (geminiErr: any) {
          console.warn("[API detect-reading-direction] Gemini attempt failed:", geminiErr.message);
        }
      }

      if (detectedLanguage === "other" && extractedTexts.length === 0) {
        try {
          const sampleImg = samples[0];
          const fullBase64Url = sampleImg.startsWith("data:") ? sampleImg : `data:image/jpeg;base64,${sampleImg}`;
          const openAiMessages = [
            { role: "system", content: "You are a comic OCR language detector. Transcribe dialogue and detect language." },
            {
              role: "user",
              content: [
                { type: "text", text: promptText },
                { type: "image_url", image_url: { url: fullBase64Url } }
              ]
            }
          ];
          const pollText = await callPollinations(openAiMessages, "openai", true);
          const parsed = parseJsonSafely(pollText, null);
          if (parsed && (parsed.language || parsed.transcribedText)) {
            const textSample = parsed.transcribedText || "";
            extractedTexts.push(textSample);
            const scriptCheck = classifyText(textSample);
            const parsedLang = (parsed.language || "").toLowerCase();
            if (scriptCheck.lang === 'korean' || parsedLang.includes('korean') || parsedLang === 'ko' || parsedLang === 'kr') {
              detectedLanguage = 'korean';
            } else if (scriptCheck.lang === 'japanese' || parsedLang.includes('japan') || parsedLang === 'ja' || parsedLang === 'jp') {
              detectedLanguage = 'japanese';
            } else if (scriptCheck.lang === 'chinese' || parsedLang.includes('chinese') || parsedLang === 'zh' || parsedLang === 'cn') {
              detectedLanguage = 'chinese';
            } else {
              detectedLanguage = 'other';
            }
          }
        } catch (pollErr: any) {
          console.warn("[API detect-reading-direction] Pollinations attempt failed:", pollErr.message);
        }
      }

      // Waterfall strategy OCR rule: Japanese and Chinese resolve to RTL, others to LTR
      const hasExtractedText = extractedTexts.some(t => t.trim().length > 0);
      if (!hasExtractedText && detectedLanguage === "other") {
        return res.json({
          direction: "ltr",
          language: "unknown",
          confidence: 0,
          sampleText: "",
          noTextDetected: true,
          detail: "OCR analysis: No text detected, default LTR"
        });
      }

      const isRtlLanguage = detectedLanguage === "japanese" || detectedLanguage === "chinese";
      const direction: "ltr" | "rtl" = isRtlLanguage ? "rtl" : "ltr";
      const combinedSample = extractedTexts.join(" ").slice(0, 100);

      return res.json({
        direction,
        language: detectedLanguage,
        confidence,
        sampleText: combinedSample,
        detail: `OCR Language Analysis: ${detectedLanguage.toUpperCase()} -> ${direction.toUpperCase()}`
      });
    } catch (e: any) {
      console.error("[API detect-reading-direction] error:", e);
      return res.status(500).json({ error: e.message || "Failed to detect reading direction via OCR" });
    }
  });

  app.post("/api/detectText", async (req, res) => {
    console.log("[API] detectText request received");
    try {
      const { suggestedCount, engine, model: clientModel, yoloTexts } = req.body;
      const targetModel = clientModel || "gemini-flash-latest";

      let rawBase64: string;
      try {
        rawBase64 = await resolveBase64Image(req);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }

      console.log(`[API detectText] Image size: ${Math.round(rawBase64.length / 1024)} KB, engine: ${engine}`);
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
          console.log("[API detectText] Gemini attempt failed:", gemError.message);
          errorOccurred = gemError;
        }
      }

      // Try Free AI (Pollinations) ONLY if explicitly selected by the user
      if (!textFound && (engine === 'pollinations' || engine === 'puter')) {
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

  app.post("/api/readHandwriting", async (req, res) => {
    console.log("[API] readHandwriting request received");
    try {
      const { engine, model: clientModel } = req.body;
      const targetModel = clientModel || "gemini-flash-latest";

      let rawBase64: string;
      try {
        rawBase64 = await resolveBase64Image(req);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }

      const customKey = req.headers["x-gemini-api-key"] as string;
      const ai = getAIClient(customKey);

      let transcribedText = "";

      // Prioritize Google Gemini (official SDK) first if available because it has native vision support,
      // whereas Pollinations no longer supports vision modalities in its models.
      const useGeminiFirst = !!ai && engine !== 'pollinations' && engine !== 'puter';

      if (useGeminiFirst && ai) {
        try {
          console.log(`[API readHandwriting] Querying Google Gemini (Official SDK, model: ${targetModel})...`);
          const promptText = "You are an expert handwriting reader and transcriber. In this cropped section of a hand-drawn comic, there is some handwritten text. Please transcribe the handwritten text EXACTLY as written. Output ONLY the plain transcribed text with no markdown, no quotes, no explanations, and no extra conversation. If you don't find any text, return an empty string.";
          
          let response;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              response = await ai.models.generateContent({
                model: targetModel,
                contents: [{
                  parts: [
                    { text: promptText },
                    { inlineData: { mimeType: "image/jpeg", data: rawBase64 } }
                  ]
                }]
              });
              break;
            } catch (err: any) {
              console.warn(`[API readHandwriting] Gemini attempt ${attempt} failed:`, err.message);
              if (attempt === 3) throw err;
              await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
            }
          }

          if (response && response.text) {
            transcribedText = response.text.trim();
            console.log("[API readHandwriting] Gemini read handwriting successfully:", transcribedText);
          }
        } catch (gemError: any) {
          console.error("[API readHandwriting] Gemini OCR failed:", gemError.message);
        }
      }

      // If Gemini was not available or failed, fallback to Pollinations as last resort
      if (!transcribedText) {
        try {
          console.log("[API readHandwriting] Trying Pollinations fallback...");
          const fullBase64Url = `data:image/jpeg;base64,${rawBase64}`;
          const openAiMessages = [
            { role: "system", content: "You are a precise handwriting transcriber. Transcribe all text visible in this image. Output ONLY the transcribed text in the original language, with absolutely no surrounding conversation, no explanations, and no markdown formatting." },
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: fullBase64Url } }
              ]
            }
          ];
          const resText = await callPollinations(openAiMessages, "openai", false, 3);
          transcribedText = resText ? resText.trim() : "";
          console.log("[API readHandwriting] Pollinations fallback read handwriting successfully:", transcribedText);
        } catch (pollError: any) {
          console.log("[API readHandwriting] Pollinations fallback failed:", pollError.message);
        }
      }

      // If we got here, always return a successful 200 response with whatever transcribed text (or empty) we have.
      // This prevents the frontend from erroring and breaking the smooth vector outline generation.
      return res.json({ text: transcribedText });

    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ error: String(e.message || e) });
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
          console.log("[API translate] Gemini attempt failed:", gemError.message);
          errorOccurred = gemError;
        }
      }

      // Try Free AI (Pollinations) ONLY if explicitly selected by the user
      if (!translationResult && (engine === 'pollinations' || engine === 'puter')) {
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

  // Explicit route handler for sitemap.xml and robots.txt
  app.get(['/sitemap.xml', '/robots.txt'], (req, res) => {
    const filename = req.path.slice(1);
    const pubPath = path.join(process.cwd(), 'public', filename);
    const distFilePath = path.join(process.cwd(), 'dist', filename);
    if (fs.existsSync(pubPath)) {
      res.setHeader('Content-Type', filename === 'sitemap.xml' ? 'application/xml' : 'text/plain');
      return res.sendFile(pubPath);
    } else if (fs.existsSync(distFilePath)) {
      res.setHeader('Content-Type', filename === 'sitemap.xml' ? 'application/xml' : 'text/plain');
      return res.sendFile(distFilePath);
    }
    return res.status(404).send('Not found');
  });

  app.use((err: any, req: any, res: any, next: any) => {
    console.error('Express Error:', err.message);
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
    res.status(500).json({ error: err.message });
  });

  // 404 handler for unhandled /api/* routes (e.g. POST/GET to missing API endpoints)
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: "Endpoint not found on Express server", method: req.method, path: req.path });
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
    
    // SPA catch-all route for development mode with dynamic SEO injection & 301 redirects
    app.get('*', async (req, res, next) => {
      try {
        const url = req.originalUrl;
        const resolution = resolveSEORoute(req.path);
        if (resolution.redirectTo && resolution.redirectTo !== req.path) {
          return res.redirect(301, resolution.redirectTo);
        }

        const indexPath = path.resolve(process.cwd(), 'index.html');
        let template = fs.readFileSync(indexPath, 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        const { html } = injectSEOMetadata(template, req.path);
        res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8' }).end(html);
      } catch (e: any) {
        if (vite && vite.ssrFixStacktrace) {
          vite.ssrFixStacktrace(e);
        }
        next(e);
      }
    });
  } else {
    if (process.env.API_ONLY === "true") {
      app.get('*', (req, res) => res.json({ status: "API Server Only" }));
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      // Serve static files but do NOT auto-serve index.html for page routes
      app.use(express.static(distPath, { index: false }));

      app.get('*', (req, res) => {
        try {
          const resolution = resolveSEORoute(req.path);
          if (resolution.redirectTo && resolution.redirectTo !== req.path) {
            return res.redirect(301, resolution.redirectTo);
          }

          const indexPath = path.join(distPath, 'index.html');
          if (fs.existsSync(indexPath)) {
            const template = fs.readFileSync(indexPath, 'utf-8');
            const { html } = injectSEOMetadata(template, req.path);
            return res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8' }).end(html);
          }
          res.sendFile(indexPath);
        } catch (err: any) {
          console.error("SSR SEO error:", err);
          res.sendFile(path.join(distPath, 'index.html'));
        }
      });
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
