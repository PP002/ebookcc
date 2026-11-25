/**
 * broadcastExtractor.ts
 *
 * Stage 1 Extraction Module (Client-Side):
 * - Novel/EPUB: extracts current chapter text, detects empty/image-only pages.
 * - Comics: downscales images (max 1536px long edge, JPEG 0.85), segments panels,
 *   extracts text lines with reading order, bounding boxes, and OCR confidence.
 * - Computes deterministic content hashes for the shared R2 cache key.
 */

import { BROADCAST_CONFIG } from "./broadcastConfig";
import { ExtractedPageData, ExtractedTextLine, ExtractionResult } from "./broadcastTypes";
import { runInBrowserOCR } from "./ppOcrInference";
import { detectPanelsYolo } from "./yoloInference";
import { toPlainText } from "./cleanPlainText";
import { detectLanguage } from "./broadcastTtsRouting";

/**
 * Computes a simple fast SHA-256 hex string in the browser
 */
export async function computeContentHash(input: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  }
  // Fallback simple 32-char hash
  let h1 = 0xdeadbeef;
  let h2 = 0x41c64e6d;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/**
 * Generates the deterministic shared cache key:
 * hash(book content hash + chapter id or page range + language + pipeline version)
 */
export async function generateBroadcastCacheKey(
  bookHash: string,
  rangeIdentifier: string,
  language: string
): Promise<string> {
  const rawKey = `${bookHash}_${rangeIdentifier}_${language}_${BROADCAST_CONFIG.PIPELINE_VERSION}`;
  const hash = await computeContentHash(rawKey);
  return `broadcast_${hash}`;
}

/**
 * Downscales an HTMLImageElement or ImageBitmap to max 1536px long edge
 * and converts to a high-efficiency JPEG data URL (~0.85 quality).
 */
export async function downscaleImageToDataUrl(
  imageSource: HTMLImageElement | HTMLCanvasElement,
  maxLongEdge = BROADCAST_CONFIG.LIMITS.MAX_IMAGE_LONG_EDGE,
  quality = BROADCAST_CONFIG.LIMITS.JPEG_QUALITY
): Promise<{ dataUrl: string; width: number; height: number }> {
  const origW = imageSource.width;
  const origH = imageSource.height;

  let targetW = origW;
  let targetH = origH;

  const longEdge = Math.max(origW, origH);
  if (longEdge > maxLongEdge) {
    const scale = maxLongEdge / longEdge;
    targetW = Math.round(origW * scale);
    targetH = Math.round(origH * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire 2D canvas context for downscaling");

  ctx.drawImage(imageSource, 0, 0, targetW, targetH);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);

  return { dataUrl, width: targetW, height: targetH };
}

/**
 * Checks if a string represents an image URL or data URI
 */
export function isImageUrl(str: string): boolean {
  if (!str || typeof str !== "string") return false;
  const s = str.trim().toLowerCase();
  return (
    s.startsWith("http://") ||
    s.startsWith("https://") ||
    s.startsWith("data:image/") ||
    s.startsWith("blob:") ||
    /\.(jpe?g|png|webp|gif|avif|svg)(\?.*)?$/i.test(s)
  );
}

/**
 * Removes Table of Contents DOM elements (nav, TOC tables, link lists, toc divs)
 * directly from a cloned HTML element before text extraction.
 */
export function removeTocNodesFromElement(clone: HTMLElement): void {
  if (!clone || typeof clone.querySelectorAll !== "function") return;

  // 1. Remove scripts, styles, SVGs
  clone.querySelectorAll("script, style, noscript, svg").forEach((el) => el.remove());

  // 2. Remove explicit TOC containers (nav, [id*=toc], [class*=toc], table[summary*=content])
  const explicitTocSelectors = [
    'nav[epub\\:type*="toc" i]',
    'nav[role*="toc" i]',
    '[epub\\:type="toc" i]',
    '[role="doc-toc" i]',
    'table[summary*="content" i]',
    'table[summary*="toc" i]',
    '[id="toc" i]',
    '[id="contents" i]',
    '[class~="toc" i]',
    '[class~="contents" i]',
    '.pgepub-toc',
  ];
  try {
    clone.querySelectorAll(explicitTocSelectors.join(", ")).forEach((el) => {
      const txt = (el.textContent || "").trim();
      // Only keep if it's mistakenly wrapping the entire novel (> 6000 chars of non-link text)
      const linkTxtLen = Array.from(el.querySelectorAll("a")).reduce(
        (acc, a) => acc + (a.textContent || "").trim().length,
        0
      );
      if (txt.length - linkTxtLen < 2500) {
        el.remove();
      }
    });
  } catch (_) {}

  // 3. Remove any <table>, <ul>, <ol>, <dl> that acts as a Table of Contents (3+ links or chapter list rows)
  try {
    clone.querySelectorAll("table, ul, ol, dl").forEach((el) => {
      const totalText = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!totalText || totalText.length > 5000) return;
      const anchors = Array.from(el.querySelectorAll("a"));
      const anchorTextLen = anchors.reduce(
        (acc, a) => acc + (a.textContent || "").replace(/\s+/g, " ").trim().length,
        0
      );
      const hasSequentialChapters =
        /(?:chapter|part|book|stave)\s+(?:1\b|i\b|one\b)/i.test(totalText) &&
        /(?:chapter|part|book|stave)\s+(?:2\b|ii\b|two\b)/i.test(totalText);
      const hasSequentialRomans =
        /\bI[.)\s—–-]+[A-Z]/i.test(totalText) &&
        /\bII[.)\s—–-]+[A-Z]/i.test(totalText) &&
        /\bIII[.)\s—–-]+[A-Z]/i.test(totalText);

      if (
        (anchors.length >= 3 && anchorTextLen >= totalText.length * 0.3) ||
        hasSequentialChapters ||
        hasSequentialRomans
      ) {
        el.remove();
      }
    });
  } catch (_) {}

  // 4. Remove paragraphs/divs that are purely anchor links to chapters (common in Gutenberg HTML TOCs)
  try {
    const blocks = Array.from(clone.querySelectorAll("p, div, li"));
    const linkOnlyBlocks: Element[] = [];
    for (const b of blocks) {
      if (b.querySelector("p, div, table")) continue;
      const bText = (b.textContent || "").replace(/\s+/g, " ").trim();
      if (!bText || bText.length > 140) continue;
      const links = Array.from(b.querySelectorAll("a[href]"));
      if (links.length >= 1) {
        const lText = links.map((a) => (a.textContent || "").replace(/\s+/g, " ").trim()).join(" ");
        if (lText.length >= bText.length * 0.7) {
          linkOnlyBlocks.push(b);
        }
      }
    }
    if (linkOnlyBlocks.length >= 3) {
      linkOnlyBlocks.forEach((b) => b.remove());
    }
  } catch (_) {}
}

/**
 * Strips HTML-level Table of Contents blocks (<nav>, TOC <table>, link lists) from raw HTML strings.
 */
export function stripHtmlTableOfContents(rawHtml: string): string {
  if (!rawHtml || !/<[a-z][\s\S]*>/i.test(rawHtml)) return rawHtml || "";

  if (typeof DOMParser !== "undefined") {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(rawHtml, "text/html");
      if (doc?.body) {
        removeTocNodesFromElement(doc.body);
        return doc.body.innerHTML;
      }
    } catch (_) {}
  }

  // Regex fallback for non-DOM environments
  let cleaned = rawHtml.replace(
    /<nav\b[^>]*(?:toc|contents)[^>]*>[\s\S]*?<\/nav>/gi,
    ""
  );
  cleaned = cleaned.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (full, inner) => {
    const linkMatches = inner.match(/<a\b[^>]*>/gi) || [];
    if (linkMatches.length >= 3 && inner.length < 15000) {
      return "\n";
    }
    return full;
  });
  return cleaned;
}

/**
 * Extracts plain text from currently mounted reader containers (EPUB iframe or prose containers)
 */
export function extractCurrentReaderText(): string {
  if (typeof document === "undefined") return "";

  // 1. Check EPUB iframes
  const iframes = document.querySelectorAll<HTMLIFrameElement>(".reader-epub-container iframe, iframe");
  for (const iframe of Array.from(iframes)) {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc?.body) {
        const clone = doc.body.cloneNode(true) as HTMLElement;
        removeTocNodesFromElement(clone);
        const text = stripTableOfContentsAndFrontMatter(clone.innerHTML || clone.innerText || clone.textContent || "");
        if (text.length >= 120 && !isTableOfContentsOrFrontMatter(text)) {
          return text;
        }
      }
    } catch (_) {}
  }

  // 2. Check reader text containers
  const textContainers = document.querySelectorAll(".reader-text-container, .prose, [data-reader-content]");
  for (const container of Array.from(textContainers)) {
    const clone = container.cloneNode(true) as HTMLElement;
    removeTocNodesFromElement(clone);
    const text = stripTableOfContentsAndFrontMatter(clone.innerHTML || clone.innerText || clone.textContent || "");
    if (text.length >= 120 && !isTableOfContentsOrFrontMatter(text)) {
      return text;
    }
  }

  return "";
}

/**
 * Loads an image from a URL or Blob URL into an HTMLImageElement
 * Includes CORS proxy fallback if anonymous crossOrigin load fails on external domains.
 */
export async function loadImageElement(url: string): Promise<HTMLImageElement> {
  const tryLoad = (src: string, useCors: boolean): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (useCors) {
        img.crossOrigin = "anonymous";
      }
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image from URL: ${src}`));
      img.src = src;
    });
  };

  try {
    return await tryLoad(url, true);
  } catch (err) {
    // If external HTTP/HTTPS URL failed with CORS, try via library proxy or blob fetch
    if (url.startsWith("http://") || url.startsWith("https://")) {
      try {
        const proxyUrl = `/api/library/proxy?fileUrl=${encodeURIComponent(url)}`;
        const res = await fetch(proxyUrl);
        if (res.ok) {
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          return await tryLoad(blobUrl, false);
        }
      } catch (_) {}
    }
    // Final fallback attempt without crossOrigin attribute
    return await tryLoad(url, false);
  }
}

/**
 * Helper to check if a single line looks like a Table of Contents entry or front-matter header.
 */
function isTocOrFrontMatterLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.length > 125) return false;

  // Explicit TOC headers
  if (
    /^(?:table\s+of\s+contents|contents|illustrations|list\s+of\s+illustrations|목차|目次|目录|sommaire|índice|inhalt)\b[:.]?$/i.test(
      t
    )
  ) {
    return true;
  }

  // Chapter / Part / Book / Stave / Act / Scene / Prologue / Epilogue listing lines
  if (
    /^(?:chapter|chap\.?|part|book|section|act|scene|prologue|epilogue|stave|canto|volume|vol\.?|letter|story|tale)\s*(?:[0-9]+|[ivxlcdm]+\b|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|first|second|third)/i.test(
      t
    )
  ) {
    // If it's a short line without multiple full narrative sentences, it's a heading/TOC line
    const sentenceCount = (t.match(/[.!?]["'”’)]?\s+[a-z]/g) || []).length;
    if (sentenceCount === 0) return true;
  }

  // Roman numeral or numbered list entry: "I. Down the Rabbit-Hole", "II. The Pool of Tears", "1. The Studio"
  if (/^(?:[ivxlcdm]{1,7}|[0-9]{1,3})(?:[.)\s—–-]+|\s{2,})\s*[\p{L}0-9"“']/iu.test(t)) {
    const sentenceCount = (t.match(/[.!?]["'”’)]?\s+[a-z]/g) || []).length;
    if (sentenceCount === 0 && t.length < 100) return true;
  }

  // Bare Roman numeral line ("I", "II", "III", "IV"...)
  if (/^[IVXLCDM]{1,6}\.?$/.test(t)) {
    return true;
  }

  // Dot leaders or trailing page numbers ("The Studio ...... 12" or "Chapter I   5")
  if (/(?:\.{2,}|\s{3,})\s*[0-9ivxlcdm]+\s*$/i.test(t)) {
    return true;
  }

  return false;
}

/**
 * Checks if a line is a real narrative prose paragraph (not a TOC list or title metadata).
 */
function isRealNarrativeParagraph(line: string): boolean {
  const t = line.trim();
  if (t.length < 140) return false;
  // Must not be a collapsed list of chapters
  const chapterMentions = (
    t.match(/\b(?:chapter|chap\.?|part|book|stave)\s+(?:[0-9]+|[ivxlcdm]+\b|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi) || []
  ).length;
  if (chapterMentions >= 2) return false;

  // Must contain normal prose punctuation and lowercase words
  return /[.!?]["'”’)]?(?:\s+|$)/.test(t) && /[a-z]{3,}\s+[a-z]{3,}/.test(t);
}

/**
 * Detects if a given text block is primarily a Table of Contents, cover, title page, or front-matter index.
 * Handles long Table of Contents pages (> 600 chars) that list multiple chapters without real narrative prose.
 */
export function isTableOfContentsOrFrontMatter(rawText: string): boolean {
  if (!rawText) return true;
  const htmlStripped = stripHtmlTableOfContents(rawText);
  const cleaned = toPlainText(htmlStripped).trim();
  if (!cleaned || cleaned.length < 140) return true;

  const lower = cleaned.toLowerCase();
  if (lower.includes("project gutenberg license") && !/chapter\s+(?:1|i\b|one)/i.test(cleaned)) {
    return true;
  }
  if (lower.includes("title:") && lower.includes("author:") && cleaned.length < 450) {
    return true;
  }

  // Check if stripping TOC and front matter leaves almost no real narrative prose
  const afterTocStripped = stripTableOfContentsAndFrontMatter(rawText);
  if (!afterTocStripped || afterTocStripped.length < 150) {
    return true;
  }

  const lines = afterTocStripped
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return true;

  let tocEntryLines = 0;
  let narrativeParagraphs = 0;
  let narrativeCharCount = 0;

  for (const line of lines) {
    if (isTocOrFrontMatterLine(line)) {
      tocEntryLines++;
    } else if (isRealNarrativeParagraph(line)) {
      narrativeParagraphs++;
      narrativeCharCount += line.length;
    }
  }

  // If there are multiple TOC entry lines and very little real narrative prose, it's a TOC page
  if (tocEntryLines >= 2 && narrativeParagraphs === 0 && narrativeCharCount < 300) {
    return true;
  }
  if (tocEntryLines >= 3 && tocEntryLines >= lines.length * 0.3 && narrativeCharCount < 500) {
    return true;
  }

  // Check if sequential chapter markers (Chapter 1 .. Chapter 2 .. Chapter 3) appear close together without prose between them
  const c1Idx = afterTocStripped.search(/\b(?:chapter|chap\.?|part|book|stave)\s+(?:1\b|i\b|one\b)/i);
  const c2Idx = afterTocStripped.search(/\b(?:chapter|chap\.?|part|book|stave)\s+(?:2\b|ii\b|two\b)/i);
  const c3Idx = afterTocStripped.search(/\b(?:chapter|chap\.?|part|book|stave)\s+(?:3\b|iii\b|three\b)/i);
  if (c1Idx !== -1 && c2Idx !== -1 && c2Idx > c1Idx && c2Idx - c1Idx < 600) {
    if (narrativeCharCount < 500 || (c3Idx !== -1 && c3Idx > c2Idx && c3Idx - c2Idx < 600 && afterTocStripped.length - c3Idx < 1200)) {
      return true;
    }
  }

  return false;
}

/**
 * Strips Gutenberg boilerplate, front-matter metadata, and inline Table of Contents blocks,
 * ensuring the returned text begins directly at Chapter 1 (or Prologue).
 * If the input contains ONLY a Table of Contents / front matter and no real chapter body, returns "".
 */
export function stripTableOfContentsAndFrontMatter(inputText: string): string {
  if (!inputText) return "";
  const htmlCleaned = stripHtmlTableOfContents(inputText);
  let cleanText = toPlainText(htmlCleaned).trim();
  if (!cleanText) return "";

  // 1. Strip Gutenberg header if present
  const gutenbergHeaderIdx = cleanText.indexOf("*** START OF");
  if (gutenbergHeaderIdx !== -1) {
    const endHeader = cleanText.indexOf("***", gutenbergHeaderIdx + 12);
    if (endHeader !== -1) {
      cleanText = cleanText.slice(endHeader + 3).trim();
    }
  }

  // 2. Find all Chapter 1 / Chapter I / Prologue headings
  // Many books have an inline Table of Contents near the top where "Chapter I" is followed closely by "Chapter II",
  // and then the REAL "Chapter I" appears after the TOC followed by actual story paragraphs.
  const chap1Regex =
    /(?:^|\n)[ \t]*(?:(?:CHAPTER|Chapter|CHAP\.?|BOOK|Book|PART|Part|STAVE|Stave)\s+(?:1\b|I\b|01\b|One\b|ONE\b|First\b|FIRST\b)|PROLOGUE\b|Prologue\b)[^\n]*/g;
  const chap2Regex =
    /(?:^|\n|\s)[ \t]*(?:CHAPTER|Chapter|CHAP\.?|BOOK|Book|PART|Part|STAVE|Stave)\s+(?:2\b|II\b|02\b|Two\b|TWO\b|Second\b|SECOND\b)/i;

  const matches: Array<{ index: number; heading: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = chap1Regex.exec(cleanText)) !== null) {
    if (m.index > 35000) break;
    matches.push({ index: m.index, heading: m[0].trim() });
  }

  let foundRealChapter1 = false;
  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const candidateIdx = matches[i].index;
      const afterCandidate = cleanText.slice(candidateIdx);
      // Check the next 650 chars after this "Chapter 1" match to see if "Chapter 2" appears right after it (which means this is a TOC entry!)
      const nextWindow = afterCandidate.slice(0, 650);
      const chap2MatchInWindow = chap2Regex.exec(nextWindow);
      const isTocEntry = chap2MatchInWindow !== null && chap2MatchInWindow.index > 0;

      // NEVER pick a TOC entry! Only pick a Chapter 1 heading that is NOT followed closely by Chapter 2
      if (!isTocEntry) {
        const sliced = afterCandidate.trim();
        if (sliced.length >= 140) {
          cleanText = sliced;
          foundRealChapter1 = true;
          break;
        }
      }
    }
  }

  // 3. If no non-TOC "Chapter 1" heading was found (e.g., either the text only had a TOC "Chapter 1..2..3",
  // or chapters are numbered "I.", "II." or untitled after a Contents block):
  // Strip any leading front-matter / Table of Contents lines from the top of cleanText!
  if (!foundRealChapter1) {
    const lines = cleanText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    let tocClusterDetected = false;
    let firstNarrativeIdx = -1;

    // Check if the opening lines contain a Contents header or multiple TOC lines
    let tocLinesInOpening = 0;
    const scanLimit = Math.min(lines.length, 180);
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
      if (isTocOrFrontMatterLine(lines[i])) {
        tocLinesInOpening++;
      }
    }
    if (
      tocLinesInOpening >= 2 ||
      /(?:^|\n)\s*(?:table\s+of\s+contents|contents)\b/i.test(lines.slice(0, 15).join("\n"))
    ) {
      tocClusterDetected = true;
    }

    if (tocClusterDetected) {
      for (let i = 0; i < scanLimit; i++) {
        const line = lines[i];
        if (isTocOrFrontMatterLine(line)) {
          continue;
        }
        // Check if we've reached real narrative prose after the TOC lines
        if (isRealNarrativeParagraph(line)) {
          // Verify the next few lines aren't more TOC entries
          const nextFew = lines.slice(i + 1, i + 5);
          const moreTocAhead = nextFew.filter((nl) => isTocOrFrontMatterLine(nl)).length >= 2;
          if (!moreTocAhead) {
            // Include the chapter title line right above this paragraph if present and not accompanied by another TOC entry
            if (i > 0 && lines[i - 1].length < 90 && !/^(?:contents|table of contents)/i.test(lines[i - 1])) {
              firstNarrativeIdx = i - 1;
            } else {
              firstNarrativeIdx = i;
            }
            break;
          }
        }
      }

      if (firstNarrativeIdx !== -1) {
        cleanText = lines.slice(firstNarrativeIdx).join("\n\n").trim();
      } else {
        // The entire text block was a Table of Contents with no real narrative chapter following it!
        return "";
      }
    }
  }

  return toPlainText(cleanText);
}

/**
 * Stage 1 - Novels / Text / EPUB extraction
 * Novels do NOT require the use of visual models to analyze images (such as book covers and illustrations).
 * Ensures broadcast skips the Table of Contents and begins directly from Chapter 1.
 */
export async function extractNovelChapter(params: {
  bookTitle: string;
  bookAuthor?: string;
  chapterText: string;
  chapterId?: string;
  chapterIndex?: number;
  language?: string;
}): Promise<ExtractionResult> {
  // Strip HTML tags, Gutenberg headers, and any Table of Contents so extraction starts at Chapter 1
  const cleanText = stripTableOfContentsAndFrontMatter(params.chapterText || "");

  const lang = detectLanguage(cleanText, params.language);
  const chapterId = params.chapterId || `chap_${params.chapterIndex || 0}`;
  const sourceHash = await computeContentHash(cleanText);

  return {
    bookType: "novel",
    title: params.bookTitle,
    author: params.bookAuthor,
    language: lang,
    chapterId,
    pageRange: [params.chapterIndex || 0, params.chapterIndex || 0],
    chapterText: cleanText,
    sourceHash,
  };
}

/**
 * Stage 1 - Comics / Manga / Image books extraction
 * Rules:
 * 1. Skip the cover of comic book (page 0 or cover URL).
 * 2. Skip non-text pages, and identify non-text books (zero OCR results) to skip generation.
 */
export async function extractComicBatch(params: {
  bookTitle: string;
  bookAuthor?: string;
  pageUrls: string[];
  currentPageIndex: number;
  batchSize?: number;
  readingDirection?: "ltr" | "rtl";
  language?: string;
  onProgress?: (progressPercent: number, statusText: string) => void;
}): Promise<ExtractionResult> {
  const count = Math.min(
    params.batchSize || BROADCAST_CONFIG.LIMITS.DEFAULT_PAGES_PER_BATCH,
    BROADCAST_CONFIG.LIMITS.MAX_PAGES_PER_BATCH
  );

  // Skip the cover of comic book: if on page 0 and book has multiple pages, start from page 1
  let startIdx = Math.max(0, params.currentPageIndex);
  if (startIdx === 0 && params.pageUrls.length > 1) {
    console.log("[Broadcast] Skipping comic cover (page 0), starting from page 1");
    startIdx = 1;
  }

  // Also skip if the current page URL clearly indicates a cover image
  const firstUrl = (params.pageUrls[startIdx] || "").toLowerCase();
  if ((firstUrl.includes("cover") || firstUrl.includes("front")) && startIdx + 1 < params.pageUrls.length) {
    console.log(`[Broadcast] Skipping identified cover URL (${params.pageUrls[startIdx]}), advancing to page ${startIdx + 2}`);
    startIdx++;
  }

  const endIdx = Math.min(params.pageUrls.length - 1, startIdx + count - 1);
  const targetUrls = params.pageUrls.slice(startIdx, endIdx + 1);

  const extractedPages: ExtractedPageData[] = [];
  let combinedHashInput = `${params.bookTitle}_${startIdx}-${endIdx}_`;
  let totalTextCount = 0;

  params.onProgress?.(10, `Preparing ${targetUrls.length} pages for vision & OCR extraction...`);

  for (let i = 0; i < targetUrls.length; i++) {
    const pageIndex = startIdx + i;
    const url = targetUrls[i];
    params.onProgress?.(
      15 + Math.round((i / targetUrls.length) * 45),
      `Processing page ${pageIndex + 1} of ${targetUrls.length}...`
    );

    try {
      const img = await loadImageElement(url);
      const { dataUrl, width, height } = await downscaleImageToDataUrl(img);

      // 1. Run In-Browser Paddle OCR first
      let lines: ExtractedTextLine[] = [];
      try {
        const ocrResult = await runInBrowserOCR(
          img,
          params.readingDirection || "ltr",
          params.bookTitle
        );

        let rawTexts = ocrResult?.texts ? [...ocrResult.texts] : [];
        const lowConfCrops = ocrResult?.lowConfidenceCrops || [];

        // 2. If low-confidence crops (< 0.9) exist, use Cloudflare Workers AI to fix:
        // Primary: @cf/google/gemma-4-26b-a4b-it, Fallback: @cf/meta/llama-3.2-11b-vision-instruct
        if (lowConfCrops.length > 0) {
          try {
            const totalH = lowConfCrops.reduce((sum, c) => sum + c.canvas.height + 10, 0);
            const maxWidth = Math.max(...lowConfCrops.map((c) => c.canvas.width), 100);
            const stitchedCanvas = document.createElement("canvas");
            stitchedCanvas.width = maxWidth;
            stitchedCanvas.height = totalH;
            const sCtx = stitchedCanvas.getContext("2d");
            if (sCtx) {
              sCtx.fillStyle = "#ffffff";
              sCtx.fillRect(0, 0, maxWidth, totalH);
              let currentY = 0;
              for (const crop of lowConfCrops) {
                sCtx.drawImage(crop.canvas, 0, currentY);
                currentY += crop.canvas.height + 10;
              }
              const stitchedBase64 = stitchedCanvas.toDataURL("image/png");
              const fixRes = await fetch("/api/ai/ocr", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  image: stitchedBase64,
                  prompt: `Read each of the ${lowConfCrops.length} stacked text crops from top to bottom. Output one corrected line per crop in exact top-to-bottom order. Output ONLY the text lines.`,
                  models: [
                    BROADCAST_CONFIG.FREE_MODELS.ocr,
                    BROADCAST_CONFIG.FREE_MODELS.ocr_fallback,
                  ],
                }),
              });
              if (fixRes.ok) {
                const fixData = await fixRes.json();
                const fixedTextStr: string =
                  fixData.text ||
                  fixData.response ||
                  fixData.candidates?.[0]?.content?.parts?.[0]?.text ||
                  "";
                const fixedLines = fixedTextStr
                  .split(/\r?\n/)
                  .map((l: string) => l.trim())
                  .filter((l: string) => l.length > 0 && l !== "[NO TEXT FOUND]");

                if (fixedLines.length > 0) {
                  lowConfCrops.forEach((crop, cropIdx) => {
                    const replacement = fixedLines[cropIdx];
                    if (!replacement) return;
                    const [cYmin, cXmin, cYmax, cXmax] = crop.box;
                    // Find matching line by bbox overlap and update with Workers AI fixed text
                    const targetIdx = rawTexts.findIndex((t) => {
                      const [ymin, xmin, ymax, xmax] = t.box_2d || [0, 0, 0, 0];
                      return (
                        Math.abs(ymin - cYmin) <= 45 &&
                        Math.abs(xmin - cXmin) <= 45 &&
                        Math.abs(ymax - cYmax) <= 45 &&
                        Math.abs(xmax - cXmax) <= 45
                      );
                    });
                    if (targetIdx !== -1) {
                      rawTexts[targetIdx] = {
                        ...rawTexts[targetIdx],
                        text: replacement,
                        confidence: 0.94,
                      };
                    } else {
                      rawTexts.push({
                        text: replacement,
                        box_2d: [cYmin, cXmin, cYmax, cXmax],
                        confidence: 0.92,
                      });
                    }
                  });
                }
              }
            }
          } catch (lowConfErr) {
            console.warn(`[Broadcast OCR] Workers AI low-confidence fix skipped on page ${pageIndex}:`, lowConfErr);
          }
        }

        if (rawTexts.length > 0) {
          lines = rawTexts
            .filter((item) => item.text && item.text.trim().length > 0)
            .map((item, idx) => {
              // box_2d is [ymin, xmin, ymax, xmax] in 0-1000 scale
              const [ymin, xmin, ymax, xmax] = item.box_2d || [0, 0, 0, 0];
              const x = xmin / 1000;
              const y = ymin / 1000;
              const w = (xmax - xmin) / 1000;
              const h = (ymax - ymin) / 1000;

              return {
                pageIndex,
                panelIndex: 0,
                readingOrder: idx,
                ocrConfidence: item.confidence || 0.85,
                text: item.text.trim(),
                bbox: [x, y, w, h],
              };
            });
        }
      } catch (ocrErr) {
        console.warn(`[Broadcast] OCR detection on page ${pageIndex} skipped/fallback:`, ocrErr);
      }

      // If page has text, include it; if it has 0 lines, skip this non-text page
      if (lines.length > 0) {
        totalTextCount += lines.length;
        combinedHashInput += `${pageIndex}:${dataUrl.slice(0, 100)};`;
        extractedPages.push({
          pageIndex,
          imageDataUrl: dataUrl,
          lines,
          width,
          height,
        });
      } else {
        console.log(`[Broadcast] Page ${pageIndex + 1} has no text lines, skipping non-text page`);
      }
    } catch (pageErr) {
      console.error(`[Broadcast] Error extracting page ${pageIndex}:`, pageErr);
    }
  }

  const hasNoText = totalTextCount === 0 || extractedPages.length === 0;
  const sourceHash = await computeContentHash(combinedHashInput + `_lines_${totalTextCount}`);

  params.onProgress?.(65, hasNoText ? "No dialogue text detected in selection" : `Extraction complete for ${extractedPages.length} dialogue pages`);

  return {
    bookType: "comic",
    title: params.bookTitle,
    author: params.bookAuthor,
    language: params.language || "en",
    pageRange: [startIdx, endIdx],
    pages: extractedPages,
    sourceHash,
    hasNoText,
  };
}
