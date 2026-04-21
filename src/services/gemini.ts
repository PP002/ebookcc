import { GoogleGenAI, Type } from "@google/genai";

export interface ComicText {
  text: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
  bgColor?: string;
}

export async function detectComicPanels(base64Image: string, customApiKey?: string): Promise<[number, number, number, number][]> {
  try {
    if (customApiKey) {
      const client = new GoogleGenAI({ apiKey: customApiKey });
      const response = await client.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: "Analyze this complex comic page layout. Identify the strict rectangular boundaries for every major art panel/frame on the page. Only return the structural bounding boxes of the panels themselves, not individual characters or faces. A panel is a framed rectangular section containing art. Return a JSON list of bounding boxes: [[ymin, xmin, ymax, xmax], ...]. The coordinates should be between 0 and 1000." }, { inlineData: { mimeType: "image/jpeg", data: base64Image.split(",")[1] || base64Image } }] }],
        config: { responseMimeType: "application/json", responseSchema: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.NUMBER } } } },
      });
      return JSON.parse(response.text || "[]");
    } else {
      const res = await fetch("/api/detectPanels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64Image }),
      });
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    }
  } catch (error) {
    console.error("Error detecting comic panels:", error);
    return [];
  }
}

export async function detectComicText(base64Image: string, customApiKey?: string): Promise<ComicText[]> {
  try {
    if (customApiKey) {
      const client = new GoogleGenAI({ apiKey: customApiKey });
      const response = await client.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: "Analyze this comic page. For each speech bubble or text area, extract the text. Then, find a single tight bounding box [ymin, xmin, ymax, xmax] that covers ONLY the text itself. Do NOT include the bubble's borders, tails, or excess background. The box must tightly wrap all lines of text within that bubble as one single box. Return a JSON list: [{\"text\": \"...\", \"box_2d\": [ymin, xmin, ymax, xmax]}]." }, { inlineData: { mimeType: "image/jpeg", data: base64Image.split(",")[1] || base64Image } }] }],
        config: { responseMimeType: "application/json", responseSchema: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { text: { type: Type.STRING }, box_2d: { type: Type.ARRAY, items: { type: Type.NUMBER } } }, required: ["text", "box_2d"] } } },
      });
      return JSON.parse(response.text || "[]");
    } else {
      const res = await fetch("/api/detectText", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64Image }),
      });
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    }
  } catch (error) {
    console.error("Error detecting comic text:", error);
    throw error;
  }
}

export async function translateTexts(texts: string[], targetLanguage: string = "English", customApiKey?: string): Promise<string[]> {
  try {
    if (customApiKey) {
      const client = new GoogleGenAI({ apiKey: customApiKey });
      const response = await client.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: `Translate the following comic texts to ${targetLanguage}. Return a JSON array of strings in the EXACT SAME ORDER. If any text is already ${targetLanguage}, leave it as is.` }, { text: JSON.stringify(texts) }] }],
        config: { responseMimeType: "application/json", responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } } },
      });
      return JSON.parse(response.text || "[]") as string[];
    } else {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts, targetLanguage }),
      });
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    }
  } catch (error) {
    console.error("Error translating text:", error);
    throw error;
  }
}
