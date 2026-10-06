/**
 * AI Context Packet Definition & Dynamic System Prompt Templates
 * 
 * Rules:
 * 1. Context packet format:
 * {
 *   "page": "READ" | "CREATE" | "CONVERT",
 *   "mode": "novel" | "comic" (READ), "comic" | "richtext" (CREATE),
 *   "title": string,
 *   "lang": string,
 *   "selectionType": "text" | "ocr_bubble" | "panel_image" | "canvas_state",
 *   "selectedContent": string,
 *   "userMessage": string
 * }
 * 
 * 2. System prompts are built dynamically from packet, under 80 tokens each.
 * 3. CONVERT is rule-based and skipped on worker ({ skip: true }).
 * 4. NEVER include: page numbers, total pages, availableActions, imageBase64 in the AI payload.
 */

export type AIPage = "READ" | "CREATE" | "CONVERT";
export type AIMode = "novel" | "comic" | "richtext";
export type AISelectionType = "text" | "ocr_bubble" | "panel_image" | "canvas_state";

export interface AIContextPacket {
  page: AIPage;
  mode: AIMode;
  title: string;
  lang: string;
  selectionType: AISelectionType;
  selectedContent: string;
  userMessage: string;
}

export const CONVERT_SKIP_GUIDANCE = "To process or convert this document, please tap the options in the Convert menu tree (such as Split Panels, OCR, Translate, or Export).";

/**
 * Builds the compressed system prompt (under 80 tokens) dynamically from a context packet.
 */
export function buildDynamicSystemPrompt(packet: {
  page: AIPage;
  mode?: AIMode;
  title?: string;
  lang?: string;
  selectedContent?: string;
}): string {
  const { page, mode, title = "", lang = "", selectedContent = "" } = packet;

  if (page === "READ") {
    if (mode === "comic") {
      return `AI. READ/comic. Book:${title}(${lang}). OCR:"${selectedContent}". Focus: translation, cultural context, summary. Concise. Match user language.`;
    }
    // READ / novel
    return `AI. READ/novel. Book:${title}(${lang}). Selected:"${selectedContent}". Focus: allusions, cultural context, translation. Concise. Match user language.`;
  }

  if (page === "CREATE") {
    if (mode === "comic") {
      return `AI. CREATE/comic. Script:"${selectedContent}". Focus: panel, dialogue, Flux image prompt. Concise.`;
    }
    // CREATE / richtext
    return `AI. CREATE/novel. Selected:"${selectedContent}". Focus: polish, grammar, Flux illustration prompt. Concise.`;
  }

  return `AI. ${page}. Selected:"${selectedContent}". Concise. Match user language.`;
}

/**
 * Checks whether an incoming payload is or contains an AIContextPacket.
 */
export function isAIContextPacket(body: any): boolean {
  if (!body || typeof body !== "object") return false;
  const page = body.page || body.contextPacket?.page;
  return typeof page === "string" && ["READ", "CREATE", "CONVERT"].includes(page.toUpperCase());
}

/**
 * Normalizes and extracts an AIContextPacket from the request payload.
 * Explicitly sanitizes and strips out page numbers, total pages, availableActions, and imageBase64.
 */
export function parseAIContextPacket(body: any): AIContextPacket | null {
  if (!isAIContextPacket(body)) return null;

  const raw = body.contextPacket && typeof body.contextPacket === "object" ? body.contextPacket : body;

  const page = String(raw.page || "").toUpperCase() as AIPage;
  let mode = String(raw.mode || "").toLowerCase() as AIMode;
  if (!mode) {
    mode = page === "CREATE" ? "comic" : "novel";
  }

  let selectionType = String(raw.selectionType || "text") as AISelectionType;
  if (!["text", "ocr_bubble", "panel_image", "canvas_state"].includes(selectionType)) {
    selectionType = "text";
  }

  return {
    page,
    mode,
    title: String(raw.title || "").trim(),
    lang: String(raw.lang || "").trim(),
    selectionType,
    selectedContent: String(raw.selectedContent || "").trim(),
    userMessage: String(raw.userMessage || raw.prompt || "").trim(),
  };
}
