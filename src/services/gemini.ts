import { GoogleGenAI, Type } from "@google/genai";

export interface ComicText {
  text: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
  bgColor?: string;
}

export async function detectComicPanels(base64Image: string, customApiKey?: string): Promise<[number, number, number, number][]> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (customApiKey) headers["x-api-key"] = customApiKey;

    const res = await fetch("/api/detectPanels", {
      method: "POST",
      headers,
      body: JSON.stringify({ base64Image }),
    });
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  } catch (error) {
    console.error("Error detecting comic panels:", error);
    return [];
  }
}

export async function detectComicText(base64Image: string, customApiKey?: string): Promise<ComicText[]> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (customApiKey) headers["x-api-key"] = customApiKey;

    const res = await fetch("/api/detectText", {
      method: "POST",
      headers,
      body: JSON.stringify({ base64Image }),
    });
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  } catch (error) {
    console.error("Error detecting comic text:", error);
    throw error;
  }
}

export async function translateTexts(texts: string[], targetLanguage: string = "English", customApiKey?: string): Promise<string[]> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (customApiKey) headers["x-api-key"] = customApiKey;

    const res = await fetch("/api/translate", {
      method: "POST",
      headers,
      body: JSON.stringify({ texts, targetLanguage }),
    });
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  } catch (error) {
    console.error("Error translating text:", error);
    throw error;
  }
}
