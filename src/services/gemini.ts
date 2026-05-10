import { GoogleGenAI, Type } from "@google/genai";

export interface ComicText {
  text: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
  bgColor?: string;
  maskBase64?: string;
}

export interface LayoutResult {
  panels: any[];
  texts: any[];
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

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 5): Promise<Response> {
  let attempt = 0;
  while (attempt < maxRetries) {
    const res = await fetch(url, options);
    if (res.status === 429) {
      let retryAfterMs = 20000;
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
  }
  return await fetch(url, options);
}

async function runGeminiDirect(apiKey: string, promptText: string, base64Data?: string, responseSchema?: any) {
  const ai = new GoogleGenAI({ apiKey });
  
  let retries = 5;
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
        model: "gemini-2.0-flash",
        contents: [{ parts }],
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
          responseSchema
        }
      });
      return response.text;
    } catch (err: any) {
      if (retries > 0 && err.message && err.message.includes("429")) {
        let delayMs = 20000;
        const match = err.message.match(/Please retry in ([\d\.]+)s/);
        if (match && match[1]) {
            const delaySec = parseFloat(match[1]);
            delayMs = Math.ceil(delaySec) * 1000 + 1000;
        }
        console.log(`[Frontend Direct] Rate limited. Retrying in ${~~(delayMs/1000)}s...`);
        await new Promise(r => setTimeout(r, delayMs));
        retries--;
      } else {
        throw err;
      }
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
    
    const res = await fetchWithRetry("/api/detectPanelsLocalYolo", {
      method: "POST",
      headers,
      body: JSON.stringify({ base64Image }),
    });
    const text = await res.text();
    if (text.trim().startsWith('<')) {
      throw new Error("Server is restarting or returning HTML");
    }
    if (!res.ok) {
      let parsedMessage = text;
      try {
        const json = JSON.parse(text);
        if (json.error) parsedMessage = json.error;
      } catch (e) {}
      throw new Error(`Local YOLO failed: ${parsedMessage}`);
    }

    try {
      return JSON.parse(text);
    } catch(e) {
      console.error("Failed to parse JSON. Raw response:", text.substring(0, 200));
      throw e;
    }
  } catch (error) {
    console.error("Error detecting layout locally:", error);
    throw error;
  }
}

export async function detectComicPanels(base64Image: string, customApiKey?: string, customYoloUrl?: string, customYoloKey?: string): Promise<[number, number, number, number][]> {
  try {
    if (customApiKey) {
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
    if (customApiKey) headers["x-api-key"] = customApiKey;
    if (customYoloUrl) headers["x-yolo-url"] = customYoloUrl;
    if (customYoloKey) headers["x-yolo-key"] = customYoloKey;

    const res = await fetchWithRetry("/api/detectPanels", {
      method: "POST",
      headers,
      body: JSON.stringify({ base64Image }),
    });
    const text = await res.text();
    if (text.trim().startsWith('<')) {
      throw new Error("Server is restarting or returning HTML");
    }
    if (!res.ok) {
      const err: any = new Error(text);
      err.status = res.status;
      throw err;
    }
    return JSON.parse(text);
  } catch (error) {
    console.error("Error detecting comic panels:", error);
    return [];
  }
}

export async function detectComicText(base64Image: string, customApiKey?: string, suggestedCount?: number, ocrProvider: 'gemini' | 'vision' = 'gemini', visionApiKey?: string): Promise<ComicText[]> {
  try {
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

    if (customApiKey) {
      console.log("[Frontend Direct] Running detectText locally to bypass server limits");
      const rawBase64 = base64Image.split(",")[1] || base64Image;
      
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

      const text = await runGeminiDirect(customApiKey, promptText, rawBase64, schema);
      return parseJsonSafely(text, []) || [];
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (customApiKey) headers["x-api-key"] = customApiKey;

    const res = await fetchWithRetry("/api/detectText", {
      method: "POST",
      headers,
      body: JSON.stringify({ base64Image, suggestedCount }),
    });
    const text = await res.text();
    if (text.trim().startsWith('<')) {
      throw new Error("Server is restarting or returning HTML");
    }
    if (!res.ok) {
      const err: any = new Error(text);
      err.status = res.status;
      throw err;
    }
    return JSON.parse(text);
  } catch (error) {
    console.error("Error detecting comic text:", error);
    throw error;
  }
}

export async function translateTexts(texts: string[], targetLanguage: string = "English", customApiKey?: string): Promise<string[]> {
  try {
    if (customApiKey) {
      console.log("[Frontend Direct] Running translate locally to bypass server limits");
      const promptText = `Translate the following comic texts to ${targetLanguage}. Return a JSON array of strings in the EXACT SAME ORDER. If any text is already ${targetLanguage}, leave it as is.\n\n${JSON.stringify(texts)}`;
      const schema = {
        type: Type.ARRAY,
        items: {
          type: Type.STRING
        }
      };
      const text = await runGeminiDirect(customApiKey, promptText, undefined, schema);
      return parseJsonSafely(text, texts) || texts;
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (customApiKey) headers["x-api-key"] = customApiKey;

    const res = await fetchWithRetry("/api/translate", {
      method: "POST",
      headers,
      body: JSON.stringify({ texts, targetLanguage }),
    });
    const text = await res.text();
    if (text.trim().startsWith('<')) {
      throw new Error("Server is restarting or returning HTML");
    }
    if (!res.ok) {
      const err: any = new Error(text);
      err.status = res.status;
      throw err;
    }
    return JSON.parse(text);
  } catch (error) {
    console.error("Error translating text:", error);
    throw error;
  }
}
