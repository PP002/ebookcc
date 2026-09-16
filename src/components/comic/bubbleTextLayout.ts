import { Point } from '../ComicCanvas';

export interface TextLine {
  text: string;
  x: number;
  y: number;
  width: number;
}

export function computeShapeAwareTextLines(
  text: string,
  polygon: Point[],
  W: number,
  H: number,
  fontSize: number,
  lineHeightMultiplier: number = 1.2,
  fontFamily: string = "sans-serif",
  fontWeight: string = "normal",
  margin: number = 2 // Tight margin control
): TextLine[] {
  if (!text) return [];
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return [];

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;

  // Find bounding box of polygon
  let minX = W, maxX = 0, minY = H, maxY = 0;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  // If bubble is too small, fallback to a small box
  if (maxX - minX < 10 || maxY - minY < 10) {
    minX = 0; maxX = W; minY = 0; maxY = H;
  }

  const lineHeight = fontSize * lineHeightMultiplier;
  
  // Get available width at a specific y
  const getAvailableWidth = (y: number) => {
    let left = maxX;
    let right = minX;
    let intersections = 0;
    
    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i];
      const p2 = polygon[(i + 1) % polygon.length];
      
      if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
        const t = (y - p1.y) / (p2.y - p1.y);
        const ix = p1.x + t * (p2.x - p1.x);
        if (ix < left) left = ix;
        if (ix > right) right = ix;
        intersections++;
      }
    }
    
    if (intersections < 2 || left >= right) {
      return { left: minX + margin, right: maxX - margin, width: Math.max(0, maxX - minX - 2 * margin) };
    }
    
    return { 
      left: left + margin, 
      right: right - margin, 
      width: Math.max(0, right - left - 2 * margin) 
    };
  };

  const layoutWithStartY = (startY: number) => {
    let currentY = startY;
    let wordIdx = 0;
    const computedLines: TextLine[] = [];
    
    while (wordIdx < words.length && currentY + lineHeight <= maxY - margin) {
      const centerY = currentY + lineHeight / 2;
      const { left, right, width } = getAvailableWidth(centerY);
      
      if (width <= 0) {
        currentY += lineHeight;
        continue;
      }

      let lineText = "";
      let lineWidth = 0;
      let firstWord = true;

      while (wordIdx < words.length) {
        const word = words[wordIdx];
        const testLine = firstWord ? word : lineText + " " + word;
        const metrics = ctx.measureText(testLine);
        
        if (metrics.width > width && !firstWord) {
          break; 
        }
        
        lineText = testLine;
        lineWidth = metrics.width;
        firstWord = false;
        wordIdx++;
      }
      
      if (lineText) {
        // Distance Calculation: Recalculate distance between first/last chars and nearest point
        // Center visually based on the available shape width
        computedLines.push({
          text: lineText,
          x: left + (width - lineWidth) / 2, 
          y: currentY,
          width: lineWidth
        });
      }
      currentY += lineHeight;
    }
    
    return {
      lines: computedLines,
      fits: wordIdx === words.length,
      totalHeight: computedLines.length > 0 ? (computedLines[computedLines.length - 1].y - startY + lineHeight) : 0
    };
  };

  let bestLayout = null;
  let minDiff = Infinity;
  
  // Try different starting Ys to center vertically
  for (let startY = minY + margin; startY <= maxY - lineHeight; startY += 2) {
    const layout = layoutWithStartY(startY);
    if (layout.fits) {
      const blockCenterY = startY + layout.totalHeight / 2;
      const bubbleCenterY = (minY + maxY) / 2;
      const diff = Math.abs(blockCenterY - bubbleCenterY);
      
      if (diff < minDiff) {
        minDiff = diff;
        bestLayout = layout;
      }
    }
  }

  // Fallback: If it doesn't fit, start from the top and squeeze it in
  if (!bestLayout) {
    bestLayout = layoutWithStartY(minY + margin);
  }

  return bestLayout.lines;
}
