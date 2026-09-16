import React, { useMemo } from 'react';
import { ContourPoint } from './bubbleContour';

interface ShapeAwareTextLayoutProps {
  text: string;
  polygon: ContourPoint[]; // Points in [0..W, 0..H] coordinate space
  width: number;
  height: number;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  lineHeight?: number;
  margin?: number;
  color?: string;
  className?: string;
}

interface TypesetLine {
  text: string;
  x: number; // left position for rendering
  y: number; // baseline or center y
  width: number;
  distLeft: number;
  distRight: number;
  fontSize: number;
}

/**
 * Standard ray-casting point-in-polygon test.
 */
function isPointInPolygon(x: number, y: number, polygon: ContourPoint[]): boolean {
  let inside = false;
  const N = polygon.length;
  for (let i = 0, j = N - 1; i < N; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Computes shortest Euclidean distance from point (x, y) to any segment of the polygon outline.
 */
function getMinDistanceToOutline(x: number, y: number, polygon: ContourPoint[]): number {
  let minDist = Infinity;
  const N = polygon.length;
  for (let i = 0; i < N; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % N];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lenSq = dx * dx + dy * dy;
    let dist: number;
    if (lenSq < 0.0001) {
      dist = Math.hypot(x - p1.x, y - p1.y);
    } else {
      let t = ((x - p1.x) * dx + (y - p1.y) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const projX = p1.x + t * dx;
      const projY = p1.y + t * dy;
      dist = Math.hypot(x - projX, y - projY);
    }
    if (dist < minDist) {
      minDist = dist;
    }
  }
  return minDist;
}

/**
 * Calculates genuine interior horizontal spans of a polygon at y = scanY.
 * Uses half-open interval rule [minY, maxY) to avoid double counting at vertices.
 * Returns paired interior intervals [left, right] where the interior lies.
 */
function getPolygonInteriorSpans(polygon: ContourPoint[], scanY: number): { left: number; right: number }[] {
  const N = polygon.length;
  if (N < 3) return [];

  const xs: number[] = [];
  for (let i = 0; i < N; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % N];

    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);

    if (scanY >= minY && scanY < maxY && maxY - minY > 0.0001) {
      const t = (scanY - p1.y) / (p2.y - p1.y);
      xs.push(p1.x + t * (p2.x - p1.x));
    }
  }

  xs.sort((a, b) => a - b);

  const spans: { left: number; right: number }[] = [];
  for (let j = 0; j + 1 < xs.length; j += 2) {
    const left = xs[j];
    const right = xs[j + 1];
    if (right - left > 0.5) {
      spans.push({ left, right });
    }
  }
  return spans;
}

/**
 * Finds the primary interior span at scanY that aligns with the shape center.
 */
function getPrimaryInteriorSpan(
  polygon: ContourPoint[],
  scanY: number,
  centerX: number
): { left: number; right: number } | null {
  const spans = getPolygonInteriorSpans(polygon, scanY);
  if (spans.length === 0) return null;

  // 1. Check if any span contains centerX
  for (const s of spans) {
    if (s.left <= centerX && s.right >= centerX) {
      return s;
    }
  }

  // 2. Otherwise, select the widest span
  let bestSpan = spans[0];
  let maxW = spans[0].right - spans[0].left;
  for (let i = 1; i < spans.length; i++) {
    const w = spans[i].right - spans[i].left;
    if (w > maxW) {
      maxW = w;
      bestSpan = spans[i];
    }
  }
  return bestSpan;
}

/**
 * Computes safe horizontal boundaries for a line of text of font size F and line height lineH at yMid.
 * Evaluates the safe interior across the entire vertical extent of the text line
 * (top edge, middle, bottom edge, and any concave vertices in between)
 * to guarantee that letters (ascenders & descenders) NEVER cross any polygon boundaries or valleys.
 */
function getSafeLineHorizontalSpan(
  polygon: ContourPoint[],
  yMid: number,
  fontF: number,
  lineH: number,
  margin: number,
  centerX: number
): { left: number; right: number; width: number } | null {
  // Glyph bounding box vertical bounds
  const yTop = yMid - fontF * 0.65;
  const yBot = yMid + fontF * 0.45;

  // Sample across the vertical height of the line
  const sampleYs = [
    yTop,
    yTop + (yBot - yTop) * 0.25,
    yMid,
    yTop + (yBot - yTop) * 0.75,
    yBot,
  ];

  // Include any polygon vertices between yTop and yBot to avoid inward spikes/teeth
  for (const p of polygon) {
    if (p.y > yTop && p.y < yBot) {
      sampleYs.push(p.y);
    }
  }

  let maxLeft = -Infinity;
  let minRight = Infinity;

  for (const y of sampleYs) {
    const span = getPrimaryInteriorSpan(polygon, y, centerX);
    if (!span) return null; // Outside polygon vertically
    if (span.left > maxLeft) maxLeft = span.left;
    if (span.right < minRight) minRight = span.right;
  }

  const safeLeft = maxLeft + margin;
  const safeRight = minRight - margin;
  const safeWidth = safeRight - safeLeft;

  if (safeWidth < Math.max(16, fontF * 1.5)) {
    return null; // Too narrow to safely fit words
  }

  return { left: safeLeft, right: safeRight, width: safeWidth };
}

// Canvas context cache for high performance text metrics measurement
let measureCanvas: HTMLCanvasElement | null = null;
let measureCtx: CanvasRenderingContext2D | null = null;

function getTextWidth(text: string, fontSpec: string): number {
  if (typeof document === 'undefined') return text.length * 7;
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas');
    measureCtx = measureCanvas.getContext('2d');
  }
  if (!measureCtx) return text.length * 7;
  measureCtx.font = fontSpec;
  return measureCtx.measureText(text).width;
}

/**
 * Breaks an excessively long word or continuous string into chunks that each fit within maxW.
 */
function splitWordToFit(word: string, maxW: number, fontSpec: string): string[] {
  if (getTextWidth(word, fontSpec) <= maxW) return [word];
  const chunks: string[] = [];
  let current = '';
  for (const char of word) {
    const test = current + char;
    if (getTextWidth(test, fontSpec) > maxW && current.length > 0) {
      chunks.push(current);
      current = char;
    } else {
      current = test;
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks.length > 0 ? chunks : [word];
}

/**
 * ShapeAwareTextLayout:
 * Dynamically breaks text into lines according to the custom shape boundary width at each vertical line position,
 * balances distance between first/last character and the nearest interior outline,
 * auto-scales font sizes down when needed to prevent text from overflowing irregular shapes and action bubbles,
 * and guarantees text stays 100% strictly within the interior boundaries of irregular freehand bubbles.
 */
export const ShapeAwareTextLayout: React.FC<ShapeAwareTextLayoutProps> = ({
  text,
  polygon,
  width,
  height,
  fontSize = 12,
  fontFamily = 'sans-serif',
  fontWeight = '600',
  fontStyle = 'normal',
  lineHeight: initialLineHeight,
  margin = 8,
  color = '#000000',
  className = '',
}) => {
  const layout = useMemo(() => {
    if (!text || !text.trim() || width <= 10 || height <= 10 || !polygon || polygon.length < 3) {
      return { lines: [], activeFontSize: fontSize };
    }

    // Centroid of the polygon
    let sumX = 0, sumY = 0;
    let polyMinY = Infinity, polyMaxY = -Infinity;
    let polyMinX = Infinity, polyMaxX = -Infinity;
    for (const p of polygon) {
      sumX += p.x;
      sumY += p.y;
      if (p.x < polyMinX) polyMinX = p.x;
      if (p.x > polyMaxX) polyMaxX = p.x;
      if (p.y < polyMinY) polyMinY = p.y;
      if (p.y > polyMaxY) polyMaxY = p.y;
    }
    const centerX = sumX / polygon.length;
    const centerY = sumY / polygon.length;

    // Extract words preserving explicit line breaks if user entered them
    const rawParagraphs = text.trim().split(/\r?\n/);
    const rawWords: string[] = [];
    for (const p of rawParagraphs) {
      const words = p.trim().split(/\s+/).filter(Boolean);
      rawWords.push(...words);
    }
    if (rawWords.length === 0) return { lines: [], activeFontSize: fontSize };

    // Search from target fontSize down to 7px to find best fit without overflow
    const minFontSize = 7;
    const maxFontSize = Math.max(minFontSize, fontSize);

    for (let currentFont = maxFontSize; currentFont >= minFontSize; currentFont -= 1) {
      const currentLineHeight = initialLineHeight
        ? Math.max(9, Math.round(initialLineHeight * (currentFont / fontSize)))
        : Math.max(9, Math.round(currentFont * 1.25));
      const fontSpec = `${fontStyle} ${fontWeight} ${currentFont}px ${fontFamily}`;
      const spaceWidth = getTextWidth(' ', fontSpec);

      const safeMinY = polyMinY + margin;
      const safeMaxY = polyMaxY - margin;
      const availableH = Math.max(0, safeMaxY - safeMinY);
      const maxLinesPossible = Math.max(1, Math.floor(availableH / currentLineHeight));

      let bestResultForFont: TypesetLine[] = [];
      let bestScoreForFont = Infinity;

      // Try different line counts from 1 up to maxLinesPossible
      for (let targetK = 1; targetK <= maxLinesPossible; targetK++) {
        const blockH = targetK * currentLineHeight;
        // Vertically center inside polygon
        const startY = safeMinY + (availableH - blockH) / 2 + currentLineHeight / 2;

        // Compute safe horizontal span for each line across its full height
        const lineSpecs: { midY: number; left: number; right: number; width: number }[] = [];
        let allLinesValid = true;

        for (let i = 0; i < targetK; i++) {
          const midY = startY + i * currentLineHeight;
          const span = getSafeLineHorizontalSpan(
            polygon,
            midY,
            currentFont,
            currentLineHeight,
            margin,
            centerX
          );
          if (!span) {
            allLinesValid = false;
            break;
          }
          lineSpecs.push({ midY, left: span.left, right: span.right, width: span.width });
        }

        if (!allLinesValid) continue;

        // Flatten words into tokens that each fit the tightest line
        const minLineMaxW = Math.min(...lineSpecs.map((s) => s.width));
        const tokens: string[] = [];
        for (const w of rawWords) {
          const subChunks = splitWordToFit(w, minLineMaxW, fontSpec);
          tokens.push(...subChunks);
        }

        const tokenWidths = tokens.map((tk) => getTextWidth(tk, fontSpec));
        let tokenIdx = 0;
        const currentLines: TypesetLine[] = [];
        let allTokensFit = true;

        for (let lineIdx = 0; lineIdx < targetK; lineIdx++) {
          const { midY, left, right, width: maxW } = lineSpecs[lineIdx];
          if (tokenIdx >= tokens.length) break;

          let lineText = '';
          let currentW = 0;

          while (tokenIdx < tokens.length) {
            const nextToken = tokens[tokenIdx];
            const nextW = tokenWidths[tokenIdx];
            const testW = lineText.length === 0 ? nextW : currentW + spaceWidth + nextW;

            // If adding the next token exceeds available maxW, wrap to next line
            if (testW > maxW && lineText.length > 0) {
              break;
            }

            // If line is empty and single token exceeds maxW, force split word chunk
            if (lineText.length === 0 && nextW > maxW) {
              const miniChunks = splitWordToFit(nextToken, maxW, fontSpec);
              lineText = miniChunks[0];
              currentW = getTextWidth(lineText, fontSpec);
              tokenIdx++;
              if (miniChunks.length > 1) {
                tokens.splice(tokenIdx, 0, ...miniChunks.slice(1));
                tokenWidths.splice(
                  tokenIdx,
                  0,
                  ...miniChunks.slice(1).map((c) => getTextWidth(c, fontSpec))
                );
              }
              break;
            }

            if (lineText.length === 0) {
              lineText = nextToken;
              currentW = nextW;
            } else {
              lineText += ' ' + nextToken;
              currentW = testW;
            }
            tokenIdx++;
          }

          if (lineText.length === 0) {
            allTokensFit = false;
            break;
          }

          // Center line in safe span
          const initialX = left + (maxW - currentW) / 2;
          const lineStartX = initialX;
          const lineEndX = initialX + currentW;

          // Distance to nearest polygon outline for symmetry
          const distLeft = getMinDistanceToOutline(lineStartX, midY, polygon);
          const distRight = getMinDistanceToOutline(lineEndX, midY, polygon);

          // Subtle balance offset (clamped strictly inside [left, right - currentW])
          const balanceOffset = (distLeft - distRight) * 0.25;
          const clampedX = Math.max(left, Math.min(right - currentW, initialX + balanceOffset));

          // Strict boundary verification: confirm corners are inside polygon
          const yTop = midY - currentFont * 0.65;
          const yBot = midY + currentFont * 0.45;
          const cornersValid =
            isPointInPolygon(clampedX, yTop, polygon) &&
            isPointInPolygon(clampedX + currentW, yTop, polygon) &&
            isPointInPolygon(clampedX, yBot, polygon) &&
            isPointInPolygon(clampedX + currentW, yBot, polygon);

          if (!cornersValid) {
            allTokensFit = false;
            break;
          }

          currentLines.push({
            text: lineText,
            x: clampedX,
            y: midY,
            width: currentW,
            distLeft,
            distRight,
            fontSize: currentFont,
          });
        }

        // Did all tokens get placed safely?
        if (allTokensFit && tokenIdx >= tokens.length && currentLines.length > 0) {
          let symmetryScore = 0;
          for (const cl of currentLines) {
            symmetryScore += Math.abs(cl.distLeft - cl.distRight);
          }

          let lengthVariance = 0;
          if (currentLines.length > 1) {
            const avgW = currentLines.reduce((acc, l) => acc + l.width, 0) / currentLines.length;
            for (const cl of currentLines) {
              lengthVariance += Math.abs(cl.width - avgW) * 0.1;
            }
          }

          const totalScore = symmetryScore + lengthVariance;
          if (totalScore < bestScoreForFont) {
            bestScoreForFont = totalScore;
            bestResultForFont = currentLines;
          }
        }
      }

      if (bestResultForFont.length > 0) {
        return { lines: bestResultForFont, activeFontSize: currentFont };
      }
    }

    // Safety Fallback at minimum font size (strictly within safe interior spans with ellipsis)
    const fallbackFont = minFontSize;
    const fallbackFontSpec = `${fontStyle} ${fontWeight} ${fallbackFont}px ${fontFamily}`;
    const fallbackLineH = Math.max(9, Math.round(fallbackFont * 1.25));
    const safeMinY = polyMinY + margin;
    const safeMaxY = polyMaxY - margin;
    const availableH = Math.max(0, safeMaxY - safeMinY);
    const maxK = Math.max(1, Math.floor(availableH / fallbackLineH));
    const startY = safeMinY + (availableH - maxK * fallbackLineH) / 2 + fallbackLineH / 2;

    const fallbackLines: TypesetLine[] = [];
    const allWords = rawWords;
    let wordIdx = 0;

    for (let k = 0; k < maxK && wordIdx < allWords.length; k++) {
      const midY = startY + k * fallbackLineH;
      const span = getSafeLineHorizontalSpan(
        polygon,
        midY,
        fallbackFont,
        fallbackLineH,
        margin,
        centerX
      );
      if (!span) continue;

      const leftX = span.left;
      const rightX = span.right;
      const maxW = span.width;

      let lineText = '';
      let currentW = 0;
      const isLastLine = k === maxK - 1;

      while (wordIdx < allWords.length) {
        const nextWord = allWords[wordIdx];
        const nextW = getTextWidth(nextWord, fallbackFontSpec);
        const testW =
          lineText.length === 0
            ? nextW
            : currentW + getTextWidth(' ', fallbackFontSpec) + nextW;

        if (testW > maxW && lineText.length > 0) {
          if (isLastLine && wordIdx < allWords.length) {
            // Append ellipsis strictly without exceeding maxW
            while (lineText.length > 0 && getTextWidth(lineText + '…', fallbackFontSpec) > maxW) {
              lineText = lineText.slice(0, -1);
            }
            lineText = lineText + '…';
            currentW = getTextWidth(lineText, fallbackFontSpec);
          }
          break;
        }

        if (lineText.length === 0 && nextW > maxW) {
          const miniChunks = splitWordToFit(nextWord, maxW, fallbackFontSpec);
          lineText = miniChunks[0];
          currentW = getTextWidth(lineText, fallbackFontSpec);
          wordIdx++;
          break;
        }

        lineText = lineText.length === 0 ? nextWord : lineText + ' ' + nextWord;
        currentW = getTextWidth(lineText, fallbackFontSpec);
        wordIdx++;
      }

      if (lineText.length > 0) {
        const clampedW = Math.min(maxW, currentW);
        const x = leftX + (maxW - clampedW) / 2;
        fallbackLines.push({
          text: lineText,
          x: Math.max(leftX, Math.min(rightX - clampedW, x)),
          y: midY,
          width: clampedW,
          distLeft: margin,
          distRight: margin,
          fontSize: fallbackFont,
        });
      }
    }

    return { lines: fallbackLines, activeFontSize: fallbackFont };
  }, [
    text,
    polygon,
    width,
    height,
    fontSize,
    fontFamily,
    fontWeight,
    fontStyle,
    initialLineHeight,
    margin,
  ]);

  if (layout.lines.length === 0) return null;

  return (
    <div
      className={`pointer-events-none select-none absolute inset-0 overflow-hidden ${className}`}
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      {layout.lines.map((line, idx) => (
        <div
          key={idx}
          className="absolute whitespace-nowrap leading-none truncate"
          style={{
            left: `${Math.round(line.x)}px`,
            top: `${Math.round(line.y - line.fontSize / 2)}px`,
            maxWidth: `${Math.round(line.width + 1)}px`,
            fontFamily,
            fontSize: `${line.fontSize}px`,
            fontWeight,
            fontStyle,
            color,
          }}
        >
          {line.text}
        </div>
      ))}
    </div>
  );
};
