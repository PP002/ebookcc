import express from "express";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import fs from "fs";

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

  // API Routes
  app.post("/api/detectPanels", async (req, res) => {
    console.log("[API] detectPanels request received");
    try {
      const ai = getAIClient(req);
      if (!ai) return res.status(500).json({ error: "Gemini API Key missing. Please provide one in the settings." });
      const { base64Image } = req.body;
      console.log(`[API] Image size: ${Math.round(base64Image.length / 1024)} KB`);
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: [
          {
            parts: [
              {
                text: "Analyze this complex comic page layout. Identify the strict rectangular boundaries for every major art panel/frame on the page. Only return the structural bounding boxes of the panels themselves, not individual characters or faces. A panel is a framed rectangular section containing art. Return a JSON list of bounding boxes: [[ymin, xmin, ymax, xmax], ...]. The coordinates should be between 0 and 1000. If no panels are found, output an empty JSON list: [].",
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
        generationConfig: {
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
      const responseText = response.text?.replace(/```json\n?|```\n?/gi, "").trim() || "[]";
      let parsed = [];
      try {
        parsed = JSON.parse(responseText);
      } catch (parseError) {
        console.warn("[API] Failed to parse detectPanels response, returning empty array. Raw:", response.text);
      }
      res.json(parsed);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/detectText", async (req, res) => {
    console.log("[API] detectText request received");
    try {
      const ai = getAIClient(req);
      if (!ai) return res.status(500).json({ error: "Gemini API Key missing. Please provide one in the settings." });
      const { base64Image } = req.body;
      console.log(`[API] Image size: ${Math.round(base64Image.length / 1024)} KB`);
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: [
          {
            parts: [
              {
                text: "Analyze this comic page. For each speech bubble or text area, extract the text. Then, find a single tight bounding box [ymin, xmin, ymax, xmax] that covers ONLY the text itself. Do NOT include the bubble's borders, tails, or excess background. The box must tightly wrap all lines of text within that bubble as one single box. Return a JSON list: [{\"text\": \"...\", \"box_2d\": [ymin, xmin, ymax, xmax]}]. If no text is found, output: [].",
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
        generationConfig: {
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
      const responseText = response.text?.replace(/```json\n?|```\n?/gi, "").trim() || "[]";
      let parsed = [];
      try {
        parsed = JSON.parse(responseText);
      } catch (parseError) {
        console.warn("[API] Failed to parse detectText response, returning empty array. Raw:", response.text);
      }
      res.json(parsed);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/translate", async (req, res) => {
    console.log("[API] translate request received");
    try {
      const ai = getAIClient(req);
      if (!ai) return res.status(500).json({ error: "Gemini API Key missing. Please provide one in the settings." });
      const { texts, targetLanguage } = req.body;
      console.log(`[API] Translating ${texts?.length} items to ${targetLanguage}`);
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
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
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING
            }
          },
        },
      });
      const responseText = response.text?.replace(/```json\n?|```\n?/gi, "").trim() || "[]";
      let parsed = texts;
      try {
        parsed = JSON.parse(responseText);
        if (!Array.isArray(parsed)) parsed = texts;
      } catch (parseError) {
        console.warn("[API] Failed to parse translate response, returning original texts. Raw:", response.text);
      }
      res.json(parsed);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
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
