import JSZip from "jszip";
import { getApiUrl } from "@/lib/api";

export type ReadingDirection = 'rtl' | 'ltr';

export type DetectionStrategy = 'metadata' | 'ocr' | 'filename' | 'default';

export interface ReadingDirectionResult {
  direction: ReadingDirection;
  strategy: DetectionStrategy;
  detail: string;
  sourceFile?: string;
  language?: string;
  matchedKeyword?: string;
  sampleText?: string;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PRIORITY 1: METADATA PARSING (Highest Priority)
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Checks for and parses ComicInfo.xml (commonly in CBZ/CBR/ZIP archives).
 * If <Manga> tag exists and equals 'Yes' or 'YesAndRightToLeft', return 'rtl'.
 * If it equals 'No' or 'YesAndLeftToRight', return 'ltr'.
 */
export function parseComicInfoXml(xmlContent: string): { direction: ReadingDirection; detail: string } | null {
  if (!xmlContent || typeof xmlContent !== 'string') return null;

  // 1. DOMParser attempt for clean XML traversal
  try {
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlContent, 'application/xml');
      const parserError = doc.querySelector('parsererror');

      if (!parserError) {
        // Check <Manga> tag
        const mangaNode = doc.querySelector('Manga') || doc.querySelector('manga');
        if (mangaNode && mangaNode.textContent) {
          const rawVal = mangaNode.textContent.trim();
          const lower = rawVal.toLowerCase();
          if (lower === 'yes' || lower === 'yesandrighttoleft') {
            return {
              direction: 'rtl',
              detail: `ComicInfo.xml: <Manga>${rawVal}</Manga> (RTL)`
            };
          }
          if (lower === 'no' || lower === 'yesandlefttoright') {
            return {
              direction: 'ltr',
              detail: `ComicInfo.xml: <Manga>${rawVal}</Manga> (LTR)`
            };
          }
        }

        // Check Webtoon / Manhwa tags or Genre in ComicInfo.xml
        const webtoonNode = doc.querySelector('Webtoon') || doc.querySelector('webtoon');
        if (webtoonNode && webtoonNode.textContent) {
          const rawVal = webtoonNode.textContent.trim().toLowerCase();
          if (rawVal === 'yes' || rawVal === 'true') {
            return {
              direction: 'ltr',
              detail: `ComicInfo.xml: <Webtoon>${webtoonNode.textContent.trim()}</Webtoon> (Korean webtoon LTR)`
            };
          }
        }

        const genreNode = doc.querySelector('Genre') || doc.querySelector('genre') || doc.querySelector('Format') || doc.querySelector('format');
        if (genreNode && genreNode.textContent) {
          const textVal = genreNode.textContent.toLowerCase();
          if (textVal.includes('webtoon') || textVal.includes('manhwa') || textVal.includes('korean')) {
            return {
              direction: 'ltr',
              detail: `ComicInfo.xml genre: "${genreNode.textContent.trim()}" (Korean webtoon LTR)`
            };
          }
        }

        // Check <PageProgression> if available
        const progNode = doc.querySelector('PageProgression') || doc.querySelector('pageProgression');
        if (progNode && progNode.textContent) {
          const rawVal = progNode.textContent.trim();
          const lower = rawVal.toLowerCase();
          if (lower === 'righttoleft' || lower === 'rtl') {
            return {
              direction: 'rtl',
              detail: `ComicInfo.xml: <PageProgression>${rawVal}</PageProgression> (RTL)`
            };
          }
          if (lower === 'lefttoright' || lower === 'ltr') {
            return {
              direction: 'ltr',
              detail: `ComicInfo.xml: <PageProgression>${rawVal}</PageProgression> (LTR)`
            };
          }
        }
      }
    }
  } catch (err) {
    console.warn('[ReadingDirection] DOMParser error in ComicInfo.xml:', err);
  }

  // 2. Fallback Regex Parsing
  const webtoonMatch = xmlContent.match(/<(?:Webtoon|Format|Genre)[^>]*>\s*([^<]+)\s*<\/(?:Webtoon|Format|Genre)>/i);
  if (webtoonMatch) {
    const rawVal = webtoonMatch[1].trim().toLowerCase();
    if (rawVal === 'yes' || rawVal === 'true' || rawVal.includes('webtoon') || rawVal.includes('manhwa') || rawVal.includes('korean')) {
      return {
        direction: 'ltr',
        detail: `ComicInfo.xml: Webtoon / Manhwa tag "${webtoonMatch[1].trim()}" (LTR)`
      };
    }
  }

  const mangaMatch = xmlContent.match(/<Manga[^>]*>\s*([^<]+)\s*<\/Manga>/i);
  if (mangaMatch) {
    const rawVal = mangaMatch[1].trim();
    const lower = rawVal.toLowerCase();
    if (lower === 'yes' || lower === 'yesandrighttoleft') {
      return {
        direction: 'rtl',
        detail: `ComicInfo.xml: <Manga>${rawVal}</Manga> (RTL)`
      };
    }
    if (lower === 'no' || lower === 'yesandlefttoright') {
      return {
        direction: 'ltr',
        detail: `ComicInfo.xml: <Manga>${rawVal}</Manga> (LTR)`
      };
    }
  }

  const progMatch = xmlContent.match(/<PageProgression[^>]*>\s*([^<]+)\s*<\/PageProgression>/i);
  if (progMatch) {
    const rawVal = progMatch[1].trim();
    const lower = rawVal.toLowerCase();
    if (lower === 'righttoleft' || lower === 'rtl') {
      return {
        direction: 'rtl',
        detail: `ComicInfo.xml: <PageProgression>${rawVal}</PageProgression> (RTL)`
      };
    }
    if (lower === 'lefttoright' || lower === 'ltr') {
      return {
        direction: 'ltr',
        detail: `ComicInfo.xml: <PageProgression>${rawVal}</PageProgression> (LTR)`
      };
    }
  }

  return null;
}

/**
 * Checks for and parses EPUB content.opf files.
 * Checks <spine page-progression-direction="rtl"> or "ltr".
 * Also checks <meta property="page-progression-direction">rtl|ltr</meta>.
 */
export function parseEpubContentOpf(opfContent: string): { direction: ReadingDirection; detail: string } | null {
  if (!opfContent || typeof opfContent !== 'string') return null;

  try {
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(opfContent, 'application/xml');
      const parserError = doc.querySelector('parsererror');

      if (!parserError) {
        // Check spine attribute
        const spine = doc.querySelector('spine');
        if (spine) {
          const dirAttr = spine.getAttribute('page-progression-direction');
          if (dirAttr) {
            const lower = dirAttr.trim().toLowerCase();
            if (lower === 'rtl') {
              return {
                direction: 'rtl',
                detail: `EPUB content.opf: <spine page-progression-direction="rtl">`
              };
            }
            if (lower === 'ltr') {
              return {
                direction: 'ltr',
                detail: `EPUB content.opf: <spine page-progression-direction="ltr">`
              };
            }
          }
        }

        // Check meta tag
        const metas = doc.querySelectorAll('meta');
        for (let i = 0; i < metas.length; i++) {
          const meta = metas[i];
          if (meta.getAttribute('property') === 'page-progression-direction') {
            const val = (meta.textContent || '').trim().toLowerCase();
            if (val === 'rtl') {
              return {
                direction: 'rtl',
                detail: `EPUB content.opf: <meta property="page-progression-direction">rtl`
              };
            }
            if (val === 'ltr') {
              return {
                direction: 'ltr',
                detail: `EPUB content.opf: <meta property="page-progression-direction">ltr`
              };
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[ReadingDirection] DOMParser error in content.opf:', err);
  }

  // Regex fallback
  const spineMatch = opfContent.match(/<spine[^>]*\bpage-progression-direction=["'](rtl|ltr)["'][^>]*>/i);
  if (spineMatch) {
    const val = spineMatch[1].toLowerCase() as ReadingDirection;
    return {
      direction: val,
      detail: `EPUB content.opf: <spine page-progression-direction="${val}">`
    };
  }

  const metaMatch = opfContent.match(/<meta[^>]*property=["']page-progression-direction["'][^>]*>\s*(rtl|ltr)\s*<\/meta>/i);
  if (metaMatch) {
    const val = metaMatch[1].toLowerCase() as ReadingDirection;
    return {
      direction: val,
      detail: `EPUB content.opf: <meta property="page-progression-direction">${val}`
    };
  }

  return null;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PRIORITY 2: OCR (Free AI OCR on sample pages)
 * ─────────────────────────────────────────────────────────────────────────────
 * Waterfall strategy OCR rule:
 * Japanese, and Chinese resolve to RTL, others to LTR
 */
export function analyzeLanguageFromText(text: string): { language: 'korean' | 'japanese' | 'chinese' | 'other'; detail: string; hasText: boolean } {
  if (!text || text.trim().length === 0) {
    return { language: 'other', detail: 'No text extracted', hasText: false };
  }

  // Korean check: Hangul syllables (U+AC00-U+D7AF), Hangul Jamo (U+1100-U+11FF), Compatibility Jamo (U+3130-U+318F)
  const hangulMatches = text.match(/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g);
  if (hangulMatches && hangulMatches.length >= 2) {
    return {
      language: 'korean',
      detail: `Korean Hangul text detected (${hangulMatches.length} characters)`,
      hasText: true
    };
  }

  // Japanese check: Hiragana (U+3040-U+309F) or Katakana (U+30A0-U+30FF)
  const kanaMatches = text.match(/[\u3040-\u309F\u30A0-\u30FF]/g);
  if (kanaMatches && kanaMatches.length >= 2) {
    return {
      language: 'japanese',
      detail: `Japanese text detected (${kanaMatches.length} kana characters)`,
      hasText: true
    };
  }

  // CJK ideographs (U+4E00-U+9FAF)
  const cjkMatches = text.match(/[\u4E00-\u9FAF]/g);
  const latinMatches = text.match(/[a-zA-Z]/g);

  if (cjkMatches && cjkMatches.length >= 3) {
    if (!kanaMatches || kanaMatches.length < 2) {
      return {
        language: 'chinese',
        detail: `Chinese text detected (${cjkMatches.length} CJK ideographs)`,
        hasText: true
      };
    } else {
      return {
        language: 'japanese',
        detail: `Japanese text detected (Kanji + Kana)`,
        hasText: true
      };
    }
  }

  if (latinMatches && latinMatches.length >= 4) {
    return {
      language: 'other',
      detail: `Latin / Western text detected (${latinMatches.length} characters)`,
      hasText: true
    };
  }

  return {
    language: 'other',
    detail: `Other / unidentified language`,
    hasText: text.trim().length > 0
  };
}

/**
 * Perform free AI OCR on two sample pages to analyze language and determine reading direction.
 * Japanese, and Chinese resolve to RTL, others to LTR
 * Returns null if no text is detected or pages are empty, allowing the waterfall to proceed to Filename.
 */
export async function runOcrFallback(
  pages: string[],
  customApiKey?: string
): Promise<{ direction: ReadingDirection; detail: string; language: string; sampleText: string } | null> {
  if (!pages || pages.length === 0) {
    return null;
  }

  // Pick two sample pages (prefer interior pages like [1, 2] if >= 3 pages, else [0, 1] or [0])
  let sampleIndices: number[] = [];
  if (pages.length >= 3) {
    sampleIndices = [1, 2];
  } else if (pages.length === 2) {
    sampleIndices = [0, 1];
  } else {
    sampleIndices = [0];
  }

  const samplePages = sampleIndices.map(i => pages[i]).filter(Boolean);
  if (samplePages.length === 0) return null;

  try {
    // 1. Call the backend /api/detect-reading-direction endpoint
    const response = await fetch(`${getApiUrl()}/api/detect-reading-direction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(customApiKey ? { 'x-gemini-api-key': customApiKey } : {})
      },
      body: JSON.stringify({ images: samplePages })
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data.direction && !data.noTextDetected && data.sampleText) {
        return {
          direction: data.direction,
          detail: data.detail || `OCR analysis: detected ${data.language} -> ${data.direction.toUpperCase()}`,
          language: data.language || 'other',
          sampleText: data.sampleText || ''
        };
      }
    }
  } catch (err) {
    console.warn('[ReadingDirection] Backend OCR language call failed, trying client text extraction:', err);
  }

  // Fallback to calling /api/detectText if detect-reading-direction failed
  try {
    let combinedText = '';
    for (const pageSrc of samplePages) {
      if (pageSrc.startsWith('blob:') || pageSrc.startsWith('http')) {
        continue;
      }
      try {
        const textRes = await fetch(`${getApiUrl()}/api/detectText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64Image: pageSrc, suggestedCount: 5, engine: 'pollinations' })
        });
        if (textRes.ok) {
          const items = await textRes.json();
          if (Array.isArray(items)) {
            combinedText += ' ' + items.map((it: any) => it.text || '').join(' ');
          }
        }
      } catch (_) {}
    }

    if (combinedText.trim()) {
      const langAnalysis = analyzeLanguageFromText(combinedText);
      if (langAnalysis.hasText) {
        const isRtl = langAnalysis.language === 'japanese' || langAnalysis.language === 'chinese';
        const direction: ReadingDirection = isRtl ? 'rtl' : 'ltr';
        return {
          direction,
          detail: `OCR Analysis: ${langAnalysis.detail} -> ${direction.toUpperCase()}`,
          language: langAnalysis.language,
          sampleText: combinedText.slice(0, 80)
        };
      }
    }
  } catch (_) {}

  // If OCR produced no definitive text, return null so Priority 3: Filename can evaluate
  return null;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PRIORITY 3: FILENAME (by the language of filename)
 * ─────────────────────────────────────────────────────────────────────────────
 * If metadata and OCR are missing/inconclusive, check the file or folder name
 * by language:
 * - Korean (Hangul / Webtoon / Manhwa keywords) -> LTR
 * - Japanese (Hiragana / Katakana / Manga / Raw keywords) -> RTL
 * - Chinese (Hanzi / Manhua keywords) -> LTR (or RTL if scanlation 漢化/汉化)
 * - Arabic / Hebrew script -> RTL
 * - Western / Latin script -> LTR
 */
export const KOREAN_WEBTOON_FILENAME_REGEX = /(?:^|[\s_.\-[\]()（）【】/\\+])(?:webtoon|webtoons|manhwa|manwha|korean|naver|daum|kakao|lezhin|toomics|tapas|條漫|条漫|韓漫|韩漫|한국|웹툰|만화)(?:$|[\s_.\-[\]()（）【】/\\+])|[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]|[\u4e00-\u9fa5]*(?:韓漫|韩漫|条漫|條漫)[\u4e00-\u9fa5]*/i;

export const MANGA_FILENAME_REGEX = /(?:^|[\s_.\-[\]()（）【】/\\+])(?:manga|raw|jp|japan|japanese|cbr|漢化|汉化|日漫|漫画|コミック|単行本|連載)(?:$|[\s_.\-[\]()（）【】/\\+])|[\u4e00-\u9fa5]*(?:漢化|汉化|日漫|漫画)[\u4e00-\u9fa5]*/i;

export function checkFilenameLanguage(filenameOrPath: string): {
  direction: ReadingDirection;
  detail: string;
  matchedKeyword?: string;
  language: string;
} | null {
  if (!filenameOrPath || typeof filenameOrPath !== 'string') return null;

  const baseName = filenameOrPath.split(/[/\\]/).pop() || filenameOrPath;

  // 1. Korean (Hangul characters or Webtoon/Manhwa keywords) -> LTR
  const hasHangul = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(baseName);
  const webtoonMatch = baseName.match(KOREAN_WEBTOON_FILENAME_REGEX);
  if (hasHangul || webtoonMatch) {
    const matched = webtoonMatch ? webtoonMatch[0].trim() : 'Hangul';
    return {
      direction: 'ltr',
      detail: `Filename language: Korean (Hangul / Webtoon keyword "${matched}") -> LTR`,
      matchedKeyword: matched,
      language: 'korean'
    };
  }

  // 2. Japanese (Kana characters, Manga / Raw / JP keywords) -> RTL
  const hasKana = /[\u3040-\u309F\u30A0-\u30FF]/.test(baseName);
  const mangaMatch = baseName.match(MANGA_FILENAME_REGEX);
  if (hasKana || mangaMatch) {
    const matched = mangaMatch ? mangaMatch[0].trim() : 'Kana';
    return {
      direction: 'rtl',
      detail: `Filename language: Japanese / Manga (keyword "${matched}") -> RTL`,
      matchedKeyword: matched,
      language: 'japanese'
    };
  }

  // 3. Arabic or Hebrew script -> RTL
  const rtlScriptMatch = baseName.match(/[\u0600-\u06FF\u0750-\u077F\u0590-\u05FF]/);
  if (rtlScriptMatch) {
    return {
      direction: 'rtl',
      detail: `Filename language: Arabic/Hebrew script -> RTL`,
      matchedKeyword: rtlScriptMatch[0],
      language: 'arabic_hebrew'
    };
  }

  // 4. Chinese (Hanzi / Manhua keywords) -> LTR (or RTL if scanlation 漢化/汉化)
  const hasHanzi = /[\u4E00-\u9FAF]/.test(baseName);
  if (hasHanzi) {
    if (/(?:漢化|汉化)/i.test(baseName)) {
      return {
        direction: 'rtl',
        detail: `Filename language: Chinese scanlation of manga ("漢化/汉化") -> RTL`,
        matchedKeyword: '漢化',
        language: 'chinese'
      };
    }
    return {
      direction: 'ltr',
      detail: `Filename language: Chinese (Hanzi / Manhua) -> LTR`,
      matchedKeyword: 'Chinese',
      language: 'chinese'
    };
  }

  // 5. Western / Latin script (English, Spanish, French, etc.) -> LTR
  const latinLetters = baseName.match(/[a-zA-Z]/g);
  if (latinLetters && latinLetters.length >= 3) {
    return {
      direction: 'ltr',
      detail: `Filename language: Western / Latin text -> LTR`,
      language: 'western'
    };
  }

  return null;
}

// Backwards compatibility alias
export function checkFilenameHeuristics(filenameOrPath: string): { direction: ReadingDirection; detail: string; matchedKeyword: string } | null {
  const res = checkFilenameLanguage(filenameOrPath);
  if (!res) return null;
  return {
    direction: res.direction,
    detail: res.detail,
    matchedKeyword: res.matchedKeyword || ''
  };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COMPLETE WATERFALL STRATEGY
 * ─────────────────────────────────────────────────────────────────────────────
 * Priority 1: Metadata Parsing (ComicInfo.xml <Manga> & EPUB content.opf)
 * Priority 2: OCR (AI OCR on sample pages; LTR: Korean webtoon, jp, Chinese; RTL: others)
 * Priority 3: Filename (by the language of filename: Korean/Chinese/Western -> LTR, JP/Manga/Arabic -> RTL)
 * Fallback: Default LTR
 */
export async function detectReadingDirectionWaterfall(options: {
  file?: File | Blob;
  filename?: string;
  pages?: string[];
  xmlContent?: string;
  opfContent?: string;
  skipOcr?: boolean;
  customApiKey?: string;
}): Promise<ReadingDirectionResult> {
  const { file, filename, pages, xmlContent, opfContent, skipOcr, customApiKey } = options;
  const targetName = filename || (file instanceof File ? file.name : '');

  // ───────────────────────────────────────────────────────────────────────────
  // Priority 1: Metadata Parsing (Highest Priority)
  // ───────────────────────────────────────────────────────────────────────────

  // 1a. If direct xmlContent provided
  if (xmlContent) {
    const metaRes = parseComicInfoXml(xmlContent);
    if (metaRes) {
      return {
        direction: metaRes.direction,
        strategy: 'metadata',
        detail: metaRes.detail
      };
    }
  }

  // 1b. If direct opfContent provided
  if (opfContent) {
    const opfRes = parseEpubContentOpf(opfContent);
    if (opfRes) {
      return {
        direction: opfRes.direction,
        strategy: 'metadata',
        detail: opfRes.detail
      };
    }
  }

  // 1c. If archive file provided (CBZ / ZIP / EPUB), inspect zip entries
  if (file && (file instanceof File || file instanceof Blob)) {
    try {
      const lowerName = targetName.toLowerCase();
      if (lowerName.endsWith('.cbz') || lowerName.endsWith('.zip') || lowerName.endsWith('.epub')) {
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(file);

        // Check for ComicInfo.xml
        const comicInfoFile = Object.keys(loadedZip.files).find(name => /(?:^|\/)comicinfo\.xml$/i.test(name));
        if (comicInfoFile) {
          const rawXml = await loadedZip.files[comicInfoFile].async('string');
          const metaRes = parseComicInfoXml(rawXml);
          if (metaRes) {
            return {
              direction: metaRes.direction,
              strategy: 'metadata',
              detail: `${metaRes.detail} from "${comicInfoFile}"`,
              sourceFile: comicInfoFile
            };
          }
        }

        // Check for content.opf (or any .opf)
        const opfFile = Object.keys(loadedZip.files).find(name => /(?:^|\/)[^/]+\.opf$/i.test(name));
        if (opfFile) {
          const rawOpf = await loadedZip.files[opfFile].async('string');
          const opfRes = parseEpubContentOpf(rawOpf);
          if (opfRes) {
            return {
              direction: opfRes.direction,
              strategy: 'metadata',
              detail: `${opfRes.detail} from "${opfFile}"`,
              sourceFile: opfFile
            };
          }
        }
      }
    } catch (zipErr) {
      console.warn('[ReadingDirection] Failed to inspect archive for metadata:', zipErr);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Priority 2: OCR (Analyze sample pages via AI OCR)
  // ───────────────────────────────────────────────────────────────────────────
  if (!skipOcr && pages && pages.length > 0) {
    try {
      const ocrRes = await runOcrFallback(pages, customApiKey);
      if (ocrRes) {
        return {
          direction: ocrRes.direction,
          strategy: 'ocr',
          detail: ocrRes.detail,
          language: ocrRes.language,
          sampleText: ocrRes.sampleText
        };
      }
    } catch (ocrErr) {
      console.warn('[ReadingDirection] OCR fallback execution error:', ocrErr);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Priority 3: Filename (by the language of filename)
  // ───────────────────────────────────────────────────────────────────────────
  if (targetName) {
    const filenameRes = checkFilenameLanguage(targetName);
    if (filenameRes) {
      return {
        direction: filenameRes.direction,
        strategy: 'filename',
        detail: filenameRes.detail,
        matchedKeyword: filenameRes.matchedKeyword,
        language: filenameRes.language
      };
    }
  }

  // Also check entries if file was a zip/cbz with folder paths
  if (file && (file instanceof File || file instanceof Blob)) {
    try {
      const lowerName = targetName.toLowerCase();
      if (lowerName.endsWith('.cbz') || lowerName.endsWith('.zip')) {
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(file);
        for (const entryName of Object.keys(loadedZip.files)) {
          const fileMatch = checkFilenameLanguage(entryName);
          if (fileMatch) {
            return {
              direction: fileMatch.direction,
              strategy: 'filename',
              detail: `${fileMatch.detail} (from archive entry "${entryName}")`,
              matchedKeyword: fileMatch.matchedKeyword,
              language: fileMatch.language
            };
          }
        }
      }
    } catch (_) {}
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Fallback: Default LTR
  // ───────────────────────────────────────────────────────────────────────────
  return {
    direction: 'ltr',
    strategy: 'default',
    detail: 'No metadata, OCR text, or filename language match found; default LTR'
  };
}
