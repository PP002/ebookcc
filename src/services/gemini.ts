import { GoogleGenAI, Type } from "@google/genai";
import { uploadMediaToR2 } from "../lib/r2Storage";
import { getApiUrl } from '@/lib/api';


export interface ComicText {
  text: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
  bgColor?: string;
  maskBase64?: string;
  panelIdx?: number;
}

export interface LayoutResult {
  panels: any[];
  texts: any[];
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

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 5): Promise<Response> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      if (!window.navigator.onLine) {
        throw new Error("Browser is offline");
      }
      const targetUrl = url.startsWith('/api/') ? `${getApiUrl()}${url}` : url;
      const res = await fetch(targetUrl, options);
      if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
        let retryAfterMs = res.status === 429 ? 20000 : 5000;
        try {
          const data = await res.clone().json();
          if (data.retryAfterMs) {
            retryAfterMs = data.retryAfterMs;
          }
        } catch (e) {
          // ignore
        }
        console.log(`[Frontend] Rate limited, waiting ${Math.round(retryAfterMs/1000)}s before retry...`);
        await new Promise(r => setTimeout(r, retryAfterMs));
        attempt++;
        continue;
      }
      return res;
    } catch (err: any) {
      console.warn(`[Frontend] Fetch attempt ${attempt + 1} failed:`, err.message || err);
      attempt++;
      if (attempt >= maxRetries) throw err;
      // Wait a bit before retrying after a network error
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  // Should not reach here due to throw in catch block
  return await fetch(url, options);
}

async function runGeminiDirect(apiKey: string, promptText: string, base64Data?: string, responseSchema?: any, modelNameOverride?: string) {
  if (!apiKey) throw new Error("An API Key must be set when running in a browser");
  
  let key = apiKey;
  if (key.startsWith("Bearer ")) {
    key = key.replace("Bearer ", "").trim();
  }
  
  const ai = new GoogleGenAI({ apiKey: key });
  
  let modelName = modelNameOverride || "gemini-flash-latest";
  
  let retries = 10;
  let baseDelay = 5000;

  while (true) {
    try {
      const parts: any[] = [{ text: promptText }];
      if (base64Data) {
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: base64Data
          }
        });
      }
      
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ role: 'user', parts }],
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
          responseSchema
        }
      });
      
      return response.text;
    } catch (err: any) {
      const errorStr = (err.message || "").toLowerCase();
      const isRateLimit = errorStr.includes("429") || errorStr.includes("too many requests") || errorStr.includes("quota");
      
      if (retries > 0 && isRateLimit) {
        let delayMs = baseDelay * (11 - retries); // Exponential-ish backoff
        
        // Try to parse recommended delay
        const match = errorStr.match(/retry in ([\d\.]+)s/);
        if (match && match[1]) {
          delayMs = Math.ceil(parseFloat(match[1]) * 1000) + 1000;
        }

        console.warn(`[Gemini Retry] Rate limited. Waiting ${delayMs/1000}s before retry ${11 - retries}...`);
        await new Promise(r => setTimeout(r, delayMs));
        retries--;
        continue;
      }
      
      // Detailed error logging for non-retryable or exhausted retries
      console.error("[Gemini Error]", err);
      throw err;
    }
  }
}

export async function detectLayoutLocalYolo(
  base64Image: string,
  customYoloUrl?: string,
  customYoloKey?: string,
  customYoloTextOnly?: boolean,
  yoloPanelClass: number = 0,
  yoloTextClass: number = 1
): Promise<LayoutResult | null> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (customYoloUrl) headers["x-yolo-url"] = customYoloUrl;
    if (customYoloKey) headers["x-yolo-key"] = customYoloKey;
    if (customYoloTextOnly) headers["x-yolo-text-only"] = "true";
    headers["x-yolo-panel-class"] = yoloPanelClass.toString();
    headers["x-yolo-text-class"] = yoloTextClass.toString();
    
    try {
      const uploadRes = await uploadMediaToR2(base64Image).catch(() => ({ success: false, key: undefined }));
      const payload: any = {
        base64Image,
        yoloUrl: customYoloUrl,
        yoloKey: customYoloKey,
        textOnly: customYoloTextOnly,
        panelClass: yoloPanelClass,
        textClass: yoloTextClass
      };
      if (uploadRes.success && uploadRes.key) {
        payload.fileKey = uploadRes.key;
      }

      let res = await fetchWithRetry(`${getApiUrl()}/api/detect-panels`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      }).catch(() => null);

      if (!res || !res.ok) {
        res = await fetchWithRetry(`${getApiUrl()}/api/detectPanelsLocalYolo`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload)
        }).catch(() => null);
      }
      
      if (!res) {
        if (customYoloUrl) {
          try {
            const directForm = new FormData();
            const cleanB64 = base64Image.split(",")[1] || base64Image;
            const byteChars = atob(cleanB64);
            const byteNumbers = new Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
            directForm.append("file", new Blob([new Uint8Array(byteNumbers)], { type: "image/jpeg" }), "image.jpg");
            directForm.append("conf", "0.15");
            directForm.append("iou", "0.45");
            directForm.append("imgsz", "1280");

            const directRes = await fetch(customYoloUrl, {
              method: "POST",
              headers: customYoloKey ? { "Authorization": `Bearer ${customYoloKey}` } : undefined,
              body: directForm
            });
            if (directRes.ok) {
              const data = await directRes.json();
              if (data?.images?.[0]?.results) {
                const panels: any[] = [];
                const texts: any[] = [];
                const origH = data.images[0].shape?.[0] || 1000;
                const origW = data.images[0].shape?.[1] || 1000;
                data.images[0].results.forEach((r: any) => {
                  if (!r.box) return;
                  const box_2d: [number, number, number, number] = [
                    Math.max(0, Math.min(1000, Math.round(((r.box.y1 || 0) / origH) * 1000))),
                    Math.max(0, Math.min(1000, Math.round(((r.box.x1 || 0) / origW) * 1000))),
                    Math.max(0, Math.min(1000, Math.round(((r.box.y2 || 0) / origH) * 1000))),
                    Math.max(0, Math.min(1000, Math.round(((r.box.x2 || 0) / origW) * 1000))),
                  ];
                  const item = { box_2d, confidence: r.confidence, class: r.class, name: r.name };
                  if (r.class === yoloPanelClass) panels.push(item);
                  else texts.push(item);
                });
                return { panels, texts };
              }
            }
          } catch (directErr) {
            console.warn("[YOLO Direct] Direct call to custom YOLO failed:", directErr);
          }
        }
        return null;
      }

      const text = await res.text();
      if (text.trim().startsWith('<')) {
        console.warn("[YOLO Proxy] Response was HTML, falling back gracefully");
        return null;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        console.warn("[YOLO Proxy] Failed parsing JSON response:", err);
        return null;
      }

      if (parsed && (parsed.panels || parsed.texts || parsed.boxes)) {
        const panels = Array.isArray(parsed.panels)
          ? parsed.panels
          : (Array.isArray(parsed.boxes) ? parsed.boxes.map((b: any) => (b.box_2d ? b : { box_2d: b })) : []);
        const texts = Array.isArray(parsed.texts) ? parsed.texts : [];
        return { panels, texts };
      }

      return null;
    } catch(err: any) {
      console.warn("[YOLO Proxy] detectLayoutLocalYolo call error:", err.message || err);
      return null;
    }
  } catch (error) {
    console.warn("[YOLO Proxy] detectLayoutLocalYolo unexpected error:", error);
    return null;
  }
}

async function runVisionModelDirect(
  config: LocalLlmConfig,
  promptText: string,
  base64Image: string
): Promise<string> {
  const engine = config.engine || 'local';
  let baseUrl = config.url || (engine === 'openai' ? 'https://api.openai.com/v1' : engine === 'claude' ? 'https://api.anthropic.com/v1' : engine === 'qwen' ? 'https://dashscope.aliyuncs.com/compatible-mode/v1' : 'http://localhost:11434/v1');
  let model = config.model || (engine === 'openai' ? 'gpt-4o' : engine === 'claude' ? 'claude-3-5-sonnet-latest' : engine === 'qwen' ? 'qwen-vl-max-latest' : 'llama3');
  const apiKey = config.apiKey || "";

  const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const rawBase64 = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;
  const fullBase64Url = `data:image/jpeg;base64,${rawBase64}`;

  // Claude / Anthropic Direct API
  if (engine === 'claude' && cleanBaseUrl.includes('anthropic.com')) {
    const res = await fetch(`${cleanBaseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: rawBase64
                }
              },
              {
                type: "text",
                text: promptText
              }
            ]
          }
        ]
      })
    });
    if (!res.ok) throw new Error(`Claude Vision API error (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return data?.content?.[0]?.text || "";
  }

  // Puter.js
  if (engine === 'puter') {
    if (typeof (window as any).puter?.ai?.chat === 'function') {
      const resp = await (window as any).puter.ai.chat(promptText, {
        model: model || "gpt-4o",
        image: fullBase64Url
      });
      return typeof resp === 'string' ? resp : resp?.message?.content || "";
    }
  }

  // OpenAI / Qwen / Local LLM (OpenAI-compatible)
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: promptText },
        { type: "image_url", image_url: { url: fullBase64Url } }
      ]
    }
  ];

  const url = `${cleanBaseUrl}/chat/completions`;
  const isHttpsPage = typeof window !== 'undefined' && window.location?.protocol === 'https:';
  const isHttpUrl = url.toLowerCase().startsWith('http://');
  const isLoopback = url.toLowerCase().includes('//localhost') || url.toLowerCase().includes('//127.0.0.1') || url.toLowerCase().includes('//[::1]');

  let response: Response;
  if (isHttpsPage && isHttpUrl && !isLoopback) {
    response = await fetch(`${getApiUrl()}/api/local-llm-proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        method: "POST",
        headers,
        body: { model, messages, temperature: 0.1 }
      })
    });
  } else {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages, temperature: 0.1 })
    });
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`${engine.toUpperCase()} Vision API error (${response.status}): ${errText || response.statusText}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || "";
}

async function runTextModelDirect(
  config: LocalLlmConfig,
  promptText: string
): Promise<string> {
  const engine = config.engine || 'local';
  let baseUrl = config.url || (engine === 'openai' ? 'https://api.openai.com/v1' : engine === 'claude' ? 'https://api.anthropic.com/v1' : engine === 'qwen' ? 'https://dashscope.aliyuncs.com/compatible-mode/v1' : 'http://localhost:11434/v1');
  let model = config.model || (engine === 'openai' ? 'gpt-4o' : engine === 'claude' ? 'claude-3-5-sonnet-latest' : engine === 'qwen' ? 'qwen-turbo' : 'llama3');
  const apiKey = config.apiKey || "";

  const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  // Claude / Anthropic Direct API
  if (engine === 'claude' && cleanBaseUrl.includes('anthropic.com')) {
    const res = await fetch(`${cleanBaseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: promptText }]
      })
    });
    if (!res.ok) throw new Error(`Claude API error (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return data?.content?.[0]?.text || "";
  }

  // Puter.js
  if (engine === 'puter') {
    if (typeof (window as any).puter?.ai?.chat === 'function') {
      const resp = await (window as any).puter.ai.chat(promptText, { model: model || "gpt-4o" });
      return typeof resp === 'string' ? resp : resp?.message?.content || "";
    }
  }

  // OpenAI / Qwen / Local LLM
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const messages = [{ role: "user", content: promptText }];
  const url = `${cleanBaseUrl}/chat/completions`;
  const isHttpsPage = typeof window !== 'undefined' && window.location?.protocol === 'https:';
  const isHttpUrl = url.toLowerCase().startsWith('http://');
  const isLoopback = url.toLowerCase().includes('//localhost') || url.toLowerCase().includes('//127.0.0.1') || url.toLowerCase().includes('//[::1]');

  let response: Response;
  if (isHttpsPage && isHttpUrl && !isLoopback) {
    response = await fetch(`${getApiUrl()}/api/local-llm-proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        method: "POST",
        headers,
        body: { model, messages, temperature: 0.1 }
      })
    });
  } else {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages, temperature: 0.1 })
    });
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`${engine.toUpperCase()} API error (${response.status}): ${errText || response.statusText}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || "";
}

export async function detectComicPanels(
  base64Image: string,
  customApiKey?: string,
  customYoloUrl?: string,
  customYoloKey?: string,
  localLlmConfig?: LocalLlmConfig
): Promise<[number, number, number, number][]> {
  try {
    if (localLlmConfig && localLlmConfig.engine && localLlmConfig.engine !== 'gemini') {
      const promptText = `Find all comic panels in this image.
Return ONLY a JSON array of bounding boxes for each panel.
Format: [[ymin, xmin, ymax, xmax], ...]
Ensure coordinates are scaled between 0 and 1000. If no panels are found, return [].`;

      try {
        const rawContent = await runVisionModelDirect(localLlmConfig, promptText, base64Image);
        return parseJsonSafely(rawContent, []) || [];
      } catch (err) {
        console.error(`[${localLlmConfig.engine}] panel detection error:`, err);
        throw err;
      }
    }

    const activeEngine = localLlmConfig?.engine || 'gemini';

    if (customApiKey && activeEngine === 'gemini') {
      console.log("[Frontend Direct] Running detectPanels locally via Gemini SDK");
      const rawBase64 = base64Image.split(",")[1] || base64Image;
      const promptText = "Analyze this complex comic page layout. Identify the strict rectangular boundaries for every major art panel/frame on the page. Only return the structural bounding boxes of the panels themselves, not individual characters or faces. A panel is a framed rectangular section containing art. Return a JSON list of bounding boxes: [[ymin, xmin, ymax, xmax], ...]. The coordinates should be between 0 and 1000. If no panels are found, output an empty JSON list: [].";
      const schema = {
        type: Type.ARRAY,
        items: {
          type: Type.ARRAY,
          items: { type: Type.NUMBER },
          description: "[ymin, xmin, ymax, xmax] for a comic panel"
        }
      };
      const modelOverride = localLlmConfig && localLlmConfig.engine === 'gemini' && localLlmConfig.model ? localLlmConfig.model : undefined;
      const text = await runGeminiDirect(customApiKey, promptText, rawBase64, schema, modelOverride);
      return parseJsonSafely(text, []) || [];
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (customYoloUrl) headers["x-yolo-url"] = customYoloUrl;
    if (customYoloKey) headers["x-yolo-key"] = customYoloKey;

    const uploadRes = await uploadMediaToR2(base64Image).catch(() => ({ success: false, key: undefined }));
    const payload = {
      ...(uploadRes.success && uploadRes.key ? { fileKey: uploadRes.key } : { base64Image }),
      engine: 'gemini',
      model: localLlmConfig?.model
    };

    const res = await fetch(`${getApiUrl()}/api/detectPanels`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (text.trim().startsWith('<') || !res.ok) {
      throw new Error(text || "Backend panel detection failed");
    }
    const jsonResult = JSON.parse(text);
    return jsonResult || [];
  } catch (error) {
    console.error("Error detecting comic panels:", error);
    return [];
  }
}

export async function detectComicText(
  base64Image: string,
  customApiKey?: string,
  suggestedCount?: number,
  ocrProvider: 'gemini' | 'vision' = 'gemini',
  visionApiKey?: string,
  localLlmConfig?: LocalLlmConfig,
  yoloTexts?: any[]
): Promise<ComicText[]> {
  try {
    if (localLlmConfig && localLlmConfig.engine && localLlmConfig.engine !== 'gemini') {
      let promptText = `You are an expert OCR and layout intelligence engine. Your single task is to transcribe EVERY piece of text/speech bubble in this comic image with precise [ymin, xmin, ymax, xmax] bounding boxes (scaled 0-1000).

Output ONLY a JSON array of objects: [{"text": "transcribed text", "box_2d": [ymin, xmin, ymax, xmax]}]`;

      if (yoloTexts && Array.isArray(yoloTexts) && yoloTexts.length > 0) {
        const boxesStr = yoloTexts.map((item: any, i: number) => {
          const box = item.box_2d || item;
          if (Array.isArray(box) && box.length === 4) {
            return `Box #${i}: [${box.map((v: any) => Math.round(Number(v))).join(', ')}]`;
          }
          return null;
        }).filter(Boolean).join('\n');

        if (boxesStr) {
          promptText = `You are a precise OCR assistant. A local layout detector has detected exactly ${yoloTexts.length} text regions in this image:\n${boxesStr}\n\nFor each bounding box, transcribe the text inside it and return a JSON array: [{"text": "...", "box_2d": [ymin, xmin, ymax, xmax]}]`;
        }
      }

      const rawContent = await runVisionModelDirect(localLlmConfig, promptText, base64Image);
      const parsed = parseJsonSafely(rawContent, []);
      if (Array.isArray(parsed)) return parsed as ComicText[];
      if (parsed?.texts && Array.isArray(parsed.texts)) return parsed.texts as ComicText[];
      return [];
    }

    if (ocrProvider === 'vision') {
      if (!visionApiKey) throw new Error("Vision API key is required when using Vision Provider");
      const base64Data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;
      const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${visionApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64Data },
              features: [{ type: "DOCUMENT_TEXT_DETECTION" }]
            }
          ]
        })
      });
      if (!res.ok) {
        throw new Error(`Vision API error: ${await res.text()}`);
      }
      const data = await res.json();
      const texts: ComicText[] = [];
      const annotations = data.responses?.[0]?.fullTextAnnotation;
      
      if (annotations && annotations.pages && annotations.pages.length > 0) {
        const page = annotations.pages[0];
        const width = page.width || 1;
        const height = page.height || 1;

        if (page.blocks) {
          page.blocks.forEach((block: any) => {
            if (block.paragraphs) {
              block.paragraphs.forEach((para: any) => {
                let paragraphText = '';
                para.words.forEach((word: any) => {
                  let wordText = '';
                  word.symbols.forEach((sym: any) => {
                    wordText += sym.text;
                    if (sym.property?.detectedBreak) {
                       const breakType = sym.property.detectedBreak.type;
                       if (breakType === 'SPACE' || breakType === 'SURE_SPACE') {
                         wordText += ' ';
                       } else if (breakType === 'EOL_SURE_SPACE' || breakType === 'LINE_BREAK') {
                         wordText += '\n';
                       }
                    }
                  });
                  paragraphText += wordText;
                });
                
                paragraphText = paragraphText.trim();
                if (paragraphText) {
                  const vertices = para.boundingBox?.vertices;
                  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                  if (vertices) {
                    vertices.forEach((v: any) => {
                      const vx = v.x || 0;
                      const vy = v.y || 0;
                      if (vx < minX) minX = vx;
                      if (vx > maxX) maxX = vx;
                      if (vy < minY) minY = vy;
                      if (vy > maxY) maxY = vy;
                    });
                  }
                  
                  const box_2d: [number, number, number, number] = [
                    (minY / height) * 1000,
                    (minX / width) * 1000,
                    (maxY / height) * 1000,
                    (maxX / width) * 1000
                  ];
                  
                  texts.push({ text: paragraphText, box_2d });
                }
              });
            }
          });
        }
      }
      
      return texts;
    }

    const activeEngine = localLlmConfig?.engine || 'gemini';

    if (customApiKey && activeEngine === 'gemini') {
      console.log("[Frontend Direct] Running detectText locally to bypass server limits");
      const rawBase64 = base64Image.split(",")[1] || base64Image;
      
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
      
      const schema = {
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
      };
      
      const modelOverride = localLlmConfig && localLlmConfig.engine === 'gemini' && localLlmConfig.model ? localLlmConfig.model : undefined;
      const text = await runGeminiDirect(customApiKey, finalPrompt, rawBase64, schema, modelOverride);
      return parseJsonSafely(text, []) || [];
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const uploadRes = await uploadMediaToR2(base64Image).catch(() => ({ success: false, key: undefined }));
    const payload = {
      ...(uploadRes.success && uploadRes.key ? { fileKey: uploadRes.key } : { base64Image }),
      suggestedCount,
      engine: 'gemini',
      model: localLlmConfig?.model,
      yoloTexts
    };

    const res = await fetch(`${getApiUrl()}/api/detectText`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (text.trim().startsWith('<') || !res.ok) {
      throw new Error(text || "Backend text detection failed");
    }
    return JSON.parse(text);
  } catch (error) {
    console.error("Error detecting comic text:", error);
    throw error;
  }
}

export interface LocalLlmConfig {
  engine: 'gemini' | 'local' | 'pollinations' | 'openai' | 'claude' | 'qwen' | 'puter';
  url?: string;
  model?: string;
  apiKey?: string;
}

export async function translateTexts(
  texts: string[],
  targetLanguage: string = "English",
  customApiKey?: string,
  localLlmConfig?: LocalLlmConfig
): Promise<string[]> {
  if (!texts || !Array.isArray(texts) || texts.length === 0) return [];
  try {
    if (localLlmConfig && localLlmConfig.engine && localLlmConfig.engine !== 'gemini') {
      const promptText = `Translate the following comic texts to ${targetLanguage}. Return a JSON array of strings in the EXACT SAME ORDER. If any text is already in ${targetLanguage}, leave it as is.\n\n${JSON.stringify(texts)}`;
      const rawContent = await runTextModelDirect(localLlmConfig, promptText);
      const parsed = parseJsonSafely(rawContent, null);
      if (parsed && Array.isArray(parsed)) {
        return parsed;
      }
      return texts;
    }

    const activeEngine = localLlmConfig?.engine || 'gemini';

    if (customApiKey && activeEngine === 'gemini') {
      console.log("[Frontend Direct] Running translate locally to bypass server limits");
      const promptText = `Translate the following comic texts to ${targetLanguage}. Return a JSON array of strings in the EXACT SAME ORDER. If any text is already ${targetLanguage}, leave it as is.\n\n${JSON.stringify(texts)}`;
      const schema = {
        type: Type.ARRAY,
        items: {
          type: Type.STRING
        }
      };
      
      const modelOverride = localLlmConfig && localLlmConfig.engine === 'gemini' && localLlmConfig.model ? localLlmConfig.model : undefined;
      const text = await runGeminiDirect(customApiKey, promptText, undefined, schema, modelOverride);
      return parseJsonSafely(text, texts) || texts;
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const res = await fetch(`${getApiUrl()}/api/translate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        texts,
        targetLanguage,
        engine: 'gemini',
        model: localLlmConfig?.model
      }),
    });
    const text = await res.text();
    if (text.trim().startsWith('<') || !res.ok) {
      throw new Error(text || "Backend translation failed");
    }
    return JSON.parse(text);
  } catch (error) {
    console.error("Error translating text:", error);
    throw error;
  }
}
