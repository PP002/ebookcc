import { GoogleGenAI, Type } from "@google/genai";

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
      const res = await fetch(url, options);
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
  
  let modelName = modelNameOverride || "gemini-2.5-flash";
  if (modelName.includes("gemini-1.5") || modelName.includes("gemini-2.5-flash") || modelName === "gemini-flash-lite-latest" || modelName === "gemini-2.5-pro") {
    modelName = "gemini-2.5-flash";
  }
  
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

export async function detectLayoutLocalYolo(base64Image: string, customYoloUrl?: string, customYoloKey?: string, customYoloTextOnly?: boolean, yoloPanelClass: number = 0, yoloTextClass: number = 1): Promise<LayoutResult | null> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (customYoloUrl) headers["x-yolo-url"] = customYoloUrl;
    if (customYoloKey) headers["x-yolo-key"] = customYoloKey;
    if (customYoloTextOnly) headers["x-yolo-text-only"] = "true";
    headers["x-yolo-panel-class"] = yoloPanelClass.toString();
    headers["x-yolo-text-class"] = yoloTextClass.toString();
    
    try {
      const res = await fetchWithRetry("/api/detectPanelsLocalYolo", {
        method: "POST",
        headers,
        body: JSON.stringify({ base64Image })
      });
      
      const text = await res.text();
      if (text.trim().startsWith('<')) {
        throw new Error("Server returned HTML (likely restarting or erroring)");
      }
      
      if (!res.ok) {
        let parsedMessage = text;
        try {
          const json = JSON.parse(text);
          if (json.error) parsedMessage = json.error;
        } catch (e) {}
        throw new Error(parsedMessage);
      }

      return JSON.parse(text);
    } catch(err: any) {
      // Suppress redundant logs as the parent runPredictAPI handles the multi-url logic
      throw err;
    }
  } catch (error) {
    throw error;
  }
}

export async function detectComicPanels(
  base64Image: string,
  customApiKey?: string,
  customYoloUrl?: string,
  customYoloKey?: string,
  localLlmConfig?: LocalLlmConfig
): Promise<[number, number, number, number][]> {
  try {
    if (localLlmConfig && localLlmConfig.engine !== 'gemini' && localLlmConfig.engine !== 'pollinations') {
      let baseUrl = localLlmConfig.url || "http://localhost:11434/v1";
      let model = localLlmConfig.model || "llama3";
      
      const localApiKey = localLlmConfig.apiKey || "";

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (localApiKey) {
        headers["Authorization"] = `Bearer ${localApiKey}`;
      }

      const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      const url = `${cleanBaseUrl}/chat/completions`;

      const promptText = `Find all comic panels in this image.
Return ONLY a JSON array of bounding boxes for each panel.
Format: [[ymin, xmin, ymax, xmax], ...]
Ensure coordinates are 0-1000.`;

      const messages = [{
        role: "user",
        content: [
          { type: "text", text: promptText },
          { type: "image_url", image_url: { url: base64Image.startsWith("data:") ? base64Image : `data:image/jpeg;base64,${base64Image}` } }
        ]
      }];

      try {
        const isHttpsPage = typeof window !== 'undefined' && window.location?.protocol === 'https:';
        const isHttpUrl = url.toLowerCase().startsWith('http://');
        const isLoopback = url.toLowerCase().includes('//localhost') || url.toLowerCase().includes('//127.0.0.1') || url.toLowerCase().includes('//[::1]');

        let response;
        if (isHttpsPage && isHttpUrl && !isLoopback) {
          response = await fetch("/api/local-llm-proxy", {
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

        if (!response.ok) throw new Error(`Local LLM failed: ${response.statusText}`);
        const data = await response.json();
        const text = data.choices[0]?.message?.content;
        return parseJsonSafely(text?.replace(/```json/g, '').replace(/```/g, '').trim(), []) || [];
      } catch (err) {
        console.error("Local LLM panel detection failed, returning empty", err);
        return [];
      }
    }

    const activeEngine = localLlmConfig?.engine || (customApiKey ? 'gemini' : 'pollinations');

    if (customApiKey && activeEngine === 'gemini') {
      console.log("[Frontend Direct] Running detectPanels locally to bypass server limits");
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
      const text = await runGeminiDirect(customApiKey, promptText, rawBase64, schema);
      return parseJsonSafely(text, []) || [];
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (customYoloUrl) headers["x-yolo-url"] = customYoloUrl;
    if (customYoloKey) headers["x-yolo-key"] = customYoloKey;

    let jsonResult;
    let backendFailed = false;

    try {
      const res = await fetch("/api/detectPanels", {
        method: "POST",
        headers,
        body: JSON.stringify({
          base64Image,
          engine: localLlmConfig?.engine || 'pollinations'
        }),
      });
      const text = await res.text();
      if (text.trim().startsWith('<') || !res.ok) {
        throw new Error(text || "Backend failed");
      }
      jsonResult = JSON.parse(text);
    } catch (e) {
      backendFailed = true;
      console.warn("Backend detectPanels failed, falling back to Pollinations Vision...");
    }

    if (backendFailed) {
      const promptText = `Find all comic panels in this image.
Return ONLY a JSON array of bounding boxes for each panel.
Format: [[ymin, xmin, ymax, xmax], ...]
Ensure coordinates are 0-1000.`;

      const messages = [{
        role: "user",
        content: [
          { type: "text", text: promptText },
          { type: "image_url", image_url: { url: base64Image.startsWith("data:") ? base64Image : `data:image/jpeg;base64,${base64Image}` } }
        ]
      }];

      let textResult = "";
      for (let i = 0; i < 4; i++) {
        try {
          const pollRes = await fetch("https://text.pollinations.ai/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages, model: "openai", jsonMode: true })
          });
          if (pollRes.ok) { 
            textResult = await pollRes.text(); 
            break; 
          }
          await new Promise(resolve => setTimeout(resolve, 1500 * (i + 1)));
        } catch(e) {
          await new Promise(resolve => setTimeout(resolve, 1500 * (i + 1)));
        }
      }
      if (!textResult) throw new Error("Failed to detect panels with fallback engines.");
      textResult = textResult.replace(/```json/g, '').replace(/```/g, '').trim();
      jsonResult = parseJsonSafely(textResult, []) || [];
    }

    return jsonResult;
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
    if (localLlmConfig && localLlmConfig.engine !== 'gemini' && localLlmConfig.engine !== 'pollinations') {
      let baseUrl = localLlmConfig.url || "http://localhost:11434/v1";
      let model = localLlmConfig.model || "llama3";
      
      const localApiKey = localLlmConfig.apiKey || "";

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (localApiKey) {
        headers["Authorization"] = `Bearer ${localApiKey}`;
      }

      const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      const url = `${cleanBaseUrl}/chat/completions`;

      const promptText = `You are an expert OCR and layout intelligence engine. Your single task is to transcribe EVERY piece of text/speech bubble in this comic image with precise [ymin, xmin, ymax, xmax] bounding boxes.

RULES:
1. Locate every word, phrase, caption, or bubble. For each independent paragraph or Speech bubble, detect it as one object.
2. Coordinates MUST be formatted as a bounding box [ymin, xmin, ymax, xmax], with values scaled between 0 and 1000 representing relative coordinates on the image.
3. Output the result in JSON format as a list of objects, each representing one detected text with: "text" (transcribed/clean text string) and "box_2d" (number list).
4. Do not include markdown code block characters like \`\`\`json. Output ONLY a valid JSON list.

Format: [{"text": "Hello There", "box_2d": [ymin, xmin, ymax, xmax]}, ...]`;

      const rawBase64 = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;
      const fullBase64Url = `data:image/jpeg;base64,${rawBase64}`;

      const messages = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: promptText
            },
            {
              type: "image_url",
              image_url: {
                url: fullBase64Url
              }
            }
          ]
        }
      ];

      let response;
      try {
        const isHttpsPage = typeof window !== 'undefined' && window.location?.protocol === 'https:';
        const isHttpUrl = url.toLowerCase().startsWith('http://');
        // Loopback URLs (localhost/127.0.0.1) should NEVER go through the server-side proxy
        // because the browser allows direct HTTP fetch from HTTPS contexts to localhost (secure contexts),
        // whereas the cloud server proxy can never reach the user's local PC loopback.
        const isLoopback = url.toLowerCase().includes('//localhost') || url.toLowerCase().includes('//127.0.0.1') || url.toLowerCase().includes('//[::1]');

        if (isHttpsPage && isHttpUrl && !isLoopback) {
          console.log("[Local LLM OCR] Proxying HTTPS mixed-content request via server-side proxy.");
          response = await fetch("/api/local-llm-proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url,
              method: "POST",
              headers,
              body: {
                model,
                messages,
                temperature: 0.1
              }
            })
          });
        } else {
          response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model,
              messages,
              temperature: 0.1
            })
          });
        }
      } catch (fetchErr: any) {
        console.error("Local LLM OCR Fetch Network Error:", fetchErr);
        
        const isPrivateIp = url.includes("localhost") || url.includes("127.0.0.1") || /192\.168\./.test(url) || /10\./.test(url) || /172\.(1[6-9]|2[0-9]|3[0-1])\./.test(url);
        const isHttpsHost = typeof window !== 'undefined' && window.location?.protocol === 'https:';
        const isCloudHost = typeof window !== 'undefined' && !window.location?.hostname.includes("localhost") && !window.location?.hostname.includes("127.0.0.1");

        let customErrMessage = `Local LLM OCR Connection Error!\n\nFailed to connect to your local LLM server at "${cleanBaseUrl}".\n\n`;

        if (isPrivateIp && isHttpsHost && isCloudHost) {
          customErrMessage += 
            `💡 CLOUD TO LOCAL NETWORK BOUNDARY DETECTED:\n\n` +
            `You are currently running EbookCC on a secure cloud website (${window.location.host}), but your LLM server was configured with a private home LAN IP (${cleanBaseUrl}).\n\n` +
            `Because cloud servers cannot connect to your private local home network, please change your Base URL configuration to:\n` +
            `👉 "http://127.0.0.1:1234/v1" or "http://localhost:1234/v1" (for LM Studio)\n` +
            `👉 "http://127.0.0.1:11434/v1" or "http://localhost:11434/v1" (for Ollama)\n\n` +
            `Loopback URLs are treated as secure contexts by the web browser, allowing direct, zero-delay communication right on your local PC!`;
        } else {
          customErrMessage +=
            `Please check that:\n` +
            `1. Your local AI engine has a VISION-capable model loaded (e.g., llama3.2-vision, llama3.2-vision:11b, qwen2.5-vision, or llava).\n` +
            `2. CORS is enabled in Ollama (OLLAMA_ORIGINS="*" ollama serve) or LM Studio settings.`;
        }

        throw new Error(customErrMessage);
      }

      if (!response.ok) {
        const errorText = await response.text();
        let message = `Local LLM OCR API error (${response.status}): ${errorText || response.statusText}`;
        const isPrivateIp = url.includes("localhost") || url.includes("127.0.0.1") || /192\.168\./.test(url) || /10\./.test(url) || /172\.(1[6-9]|2[0-9]|3[0-1])\./.test(url);
        const isCloudHost = typeof window !== 'undefined' && !window.location?.hostname.includes("localhost") && !window.location?.hostname.includes("127.0.0.1");

        if (isPrivateIp && isCloudHost && (response.status === 405 || response.status === 403 || response.status === 500)) {
          message += 
            `\n\n💡 CLOUD TO LOCAL BOUNDARY CONSTRAINT DETECTED:\n` +
            `Because EbookCC is hosted on a secure cloud environment, the server-side proxy is blocked from routing to your LAN IP (192.168.0.198).\n\n` +
            `👉 RESOLUTION:\n` +
            `Change your local LLM Base URL configuration to "http://127.0.0.1:1234/v1" or "http://localhost:1234/v1". Your web browser will then connect directly to LM Studio on your computer, bypassing any cloud restrictions!`;
        }
        throw new Error(message);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content || "";
      let parsed = parseJsonSafely(content, null);
      if (!parsed) {
        // Fallback: try to see if there is still JSON tucked inside the content
        const match = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (match) {
          try {
            parsed = JSON.parse(match[0]);
          } catch(e) {}
        }
      }

      if (parsed) {
        if (Array.isArray(parsed)) {
          return parsed as ComicText[];
        } else if (parsed.texts && Array.isArray(parsed.texts)) {
          return parsed.texts as ComicText[];
        } else if (parsed.results && Array.isArray(parsed.results)) {
          return parsed.results as ComicText[];
        }
      }
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
      
      // No longer filtering by guided boxes to ensure full page scan as per user request
      return texts;
    }

    const activeEngine = localLlmConfig?.engine || (customApiKey ? 'gemini' : 'pollinations');

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
    let jsonResult;
    let backendFailed = false;

    try {
      const res = await fetch("/api/detectText", {
        method: "POST",
        headers,
        body: JSON.stringify({
          base64Image,
          suggestedCount,
          engine: localLlmConfig?.engine || 'pollinations',
          yoloTexts
        }),
      });
      const text = await res.text();
      if (text.trim().startsWith('<') || !res.ok) {
        throw new Error(text || "Backend failed");
      }
      jsonResult = JSON.parse(text);
    } catch (e) {
      backendFailed = true;
      console.warn("Backend detectText failed, falling back to Pollinations Vision...");
    }

    if (backendFailed) {
      const promptText = `You are a precise OCR engine. Your ONLY job is text detection and extraction.

STRICT RULES:
1. Extract EVERY visible piece of text in this image.
2. Provide bounding box [ymin, xmin, ymax, xmax] scaled to 0-1000.
Return ONLY a JSON array. Return [] if no text. Example: [{"text": "hello", "box_2d": [0,0,100,100]}]`;

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

      const messages = [{
        role: "user",
        content: [
          { type: "text", text: finalPrompt },
          { type: "image_url", image_url: { url: base64Image.startsWith("data:") ? base64Image : `data:image/jpeg;base64,${base64Image}` } }
        ]
      }];

      let textResult = "";
      for (let i = 0; i < 4; i++) {
        try {
          const pollRes = await fetch("https://text.pollinations.ai/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages, model: "openai", jsonMode: true })
          });
          if (pollRes.ok) { 
            textResult = await pollRes.text(); 
            break; 
          }
          await new Promise(resolve => setTimeout(resolve, 1500 * (i + 1)));
        } catch(e) {
          await new Promise(resolve => setTimeout(resolve, 1500 * (i + 1)));
        }
      }
      if (!textResult) throw new Error("Failed to detect text with fallback engines.");
      textResult = textResult.replace(/```json/g, '').replace(/```/g, '').trim();
      jsonResult = parseJsonSafely(textResult, []) || [];
    }

    return jsonResult;
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
    if (localLlmConfig && localLlmConfig.engine !== 'gemini' && localLlmConfig.engine !== 'pollinations') {
      let baseUrl = localLlmConfig.url || "http://localhost:11434/v1";
      let model = localLlmConfig.model || "llama3";
      
      const localApiKey = localLlmConfig.apiKey || "";

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (localApiKey) {
        headers["Authorization"] = `Bearer ${localApiKey}`;
      }

      const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      const url = `${cleanBaseUrl}/chat/completions`;

      const promptText = `Translate the following comic texts to ${targetLanguage}. Return a JSON array of strings in the EXACT SAME ORDER. If any text is already in ${targetLanguage}, leave it as is.\n\n${JSON.stringify(texts)}`;

      let response;
      try {
        const isHttpsPage = typeof window !== 'undefined' && window.location?.protocol === 'https:';
        const isHttpUrl = url.toLowerCase().startsWith('http://');
        // Loopback URLs (localhost/127.0.0.1) should NEVER go through the server-side proxy
        // because the browser allows direct HTTP fetch from HTTPS contexts to localhost (secure contexts),
        // whereas the cloud server proxy can never reach the user's local PC loopback.
        const isLoopback = url.toLowerCase().includes('//localhost') || url.toLowerCase().includes('//127.0.0.1') || url.toLowerCase().includes('//[::1]');

        if (isHttpsPage && isHttpUrl && !isLoopback) {
          console.log("[Local LLM] HTTPS context and HTTP URL. Routing request via server proxy to prevent Mixed Content block.");
          response = await fetch("/api/local-llm-proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url,
              method: "POST",
              headers,
              body: {
                model,
                messages: [
                  {
                    role: "system",
                    content: `You are a professional comic and manga translation engine. Your sole task is to translate JSON arrays of texts to ${targetLanguage} while preserving exactly the same array size and index order. You must output a JSON array of strings, with no additional commentary, no markdown formatting, just the raw JSON text.`
                  },
                  {
                    role: "user",
                    content: promptText
                  }
                ],
                temperature: 0.2
              }
            })
          });
        } else {
          response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model,
              messages: [
                {
                  role: "system",
                  content: `You are a professional comic and manga translation engine. Your sole task is to translate JSON arrays of texts to ${targetLanguage} while preserving exactly the same array size and index order. You must output a JSON array of strings, with no additional commentary, no markdown formatting, just the raw JSON text.`
                },
                {
                  role: "user",
                  content: promptText
                }
              ],
              temperature: 0.2
            })
          });
        }
      } catch (fetchErr: any) {
        console.error("Local LLM Fetch Network Error:", fetchErr);
        
        const isPrivateIp = url.includes("localhost") || url.includes("127.0.0.1") || /192\.168\./.test(url) || /10\./.test(url) || /172\.(1[6-9]|2[0-9]|3[0-1])\./.test(url);
        const isHttpsHost = typeof window !== 'undefined' && window.location?.protocol === 'https:';
        const isCloudHost = typeof window !== 'undefined' && !window.location?.hostname.includes("localhost") && !window.location?.hostname.includes("127.0.0.1");

        let customErrMessage = `Local LLM Network Error!\n\nFailed to connect to your local LLM server at "${cleanBaseUrl}".\n\n`;

        if (isPrivateIp && isHttpsHost && isCloudHost) {
          customErrMessage += 
            `💡 CLOUD TO LOCAL NETWORK BOUNDARY DETECTED:\n\n` +
            `You are currently running EbookCC on a secure cloud website (${window.location.host}), but trying to connect directly to a private local server (${cleanBaseUrl}).\n\n` +
            `Because cloud servers cannot connect to your private local home network, please change your Base URL configuration to:\n` +
            `👉 "http://127.0.0.1:1234/v1" or "http://localhost:1234/v1" (for LM Studio)\n` +
            `👉 "http://127.0.0.1:11434/v1" or "http://localhost:11434/v1" (for Ollama)\n\n` +
            `Loopback URLs are treated as secure contexts by the web browser, allowing direct, zero-delay communication right on your local PC!`;
        } else {
          customErrMessage +=
            `Please check that:\n` +
            `1. Your local AI service (Ollama / LM Studio / Llama.cpp) is running.\n` +
            `2. Your model "${model}" is fully downloaded & available.\n` +
            `3. CORS (Cross-Origin Resource Sharing) is enabled.\n` +
            `   - Ollama: Run 'OLLAMA_ORIGINS="*" ollama serve' in your terminal.\n` +
            `   - LM Studio: Enable 'CORS' in Local Server Settings.\n` +
            `4. No browser extension is blocking loopback requests.`;
        }

        throw new Error(customErrMessage);
      }

      if (!response.ok) {
        const errorText = await response.text();
        let message = `Local LLM API error (${response.status}): ${errorText || response.statusText}`;
        const isPrivateIp = url.includes("localhost") || url.includes("127.0.0.1") || /192\.168\./.test(url) || /10\./.test(url) || /172\.(1[6-9]|2[0-9]|3[0-1])\./.test(url);
        const isCloudHost = typeof window !== 'undefined' && !window.location?.hostname.includes("localhost") && !window.location?.hostname.includes("127.0.0.1");

        if (isPrivateIp && isCloudHost && (response.status === 405 || response.status === 403 || response.status === 500)) {
          message += 
            `\n\n💡 CLOUD TO LOCAL BOUNDARY CONSTRAINT DETECTED:\n` +
            `Because EbookCC is hosted on a secure cloud environment, the server-side proxy is blocked from routing to your LAN IP (192.168.0.198).\n\n` +
            `👉 RESOLUTION:\n` +
            `Change your local LLM Base URL configuration to "http://127.0.0.1:1234/v1" or "http://localhost:1234/v1". Your web browser will then connect directly to LM Studio on your computer, bypassing any cloud restrictions!`;
        }
        throw new Error(message);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content || "";
      const parsed = parseJsonSafely(content, null);
      if (parsed && Array.isArray(parsed)) {
        return parsed;
      }
      return texts;
    }

    const activeEngine = localLlmConfig?.engine || (customApiKey ? 'gemini' : 'pollinations');

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
    let jsonResult;
    let backendFailed = false;

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers,
        body: JSON.stringify({
          texts,
          targetLanguage,
          engine: localLlmConfig?.engine || 'pollinations'
        }),
      });
      const text = await res.text();
      if (text.trim().startsWith('<') || !res.ok) {
        throw new Error(text || "Backend failed");
      }
      jsonResult = JSON.parse(text);
    } catch (e) {
      backendFailed = true;
      console.warn("Backend translate failed, falling back to Pollinations...");
    }

    if (backendFailed) {
      let textResult = "";
      const models = ["openai", "qwen-coder", "llama", "mistral"];
      const messages = [
        { role: "system", content: "You are a professional comic translator. Translate the array of strings and return ONLY a JSON array of strings in the exact same order." },
        { role: "user", content: `Translate this array of strings to ${targetLanguage}: ${JSON.stringify(texts)}` }
      ];
      
      for (let i = 0; i < 4; i++) {
        try {
          const pollRes = await fetch("https://text.pollinations.ai/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages, model: models[i % models.length], jsonMode: true })
          });
          if (pollRes.ok) { textResult = await pollRes.text(); break; }
        } catch(e) {}
      }
      if (!textResult) throw new Error("Failed to translate with fallback engines.");
      textResult = textResult.replace(/```json/g, '').replace(/```/g, '').trim();
      jsonResult = parseJsonSafely(textResult, texts) || texts;
    }

    return jsonResult;
  } catch (error) {
    console.error("Error translating text:", error);
    throw error;
  }
}
