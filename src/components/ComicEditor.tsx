import React, { useState, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { detectComicText, detectComicPanels, translateTexts, ComicText } from '@/src/services/gemini';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Download, Upload, Trash2, Edit2, Check, X, Eye, Book, Sparkles, Layers, Play, ChevronLeft, ChevronRight, CheckSquare, Languages, Sun, Moon, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import JSZip from 'jszip';

const LANGUAGES = [
  "Afrikaans", "Albanian", "Amharic", "Arabic", "Armenian", "Azerbaijani", "Basque", "Belarusian", "Bengali", "Bosnian", "Bulgarian", "Catalan", "Cebuano", "Chinese (Simplified)", "Chinese (Traditional)", "Corsican", "Croatian", "Czech", "Danish", "Dutch", "English", "Esperanto", "Estonian", "Finnish", "French", "Frisian", "Galician", "Georgian", "German", "Greek", "Gujarati", "Haitian Creole", "Hausa", "Hawaiian", "Hebrew", "Hindi", "Hmong", "Hungarian", "Icelandic", "Igbo", "Indonesian", "Irish", "Italian", "Japanese", "Javanese", "Kannada", "Kazakh", "Khmer", "Kinyarwanda", "Korean", "Kurdish", "Kyrgyz", "Lao", "Latin", "Latvian", "Lithuanian", "Luxembourgish", "Macedonian", "Malagasy", "Malay", "Malayalam", "Maltese", "Maori", "Marathi", "Mongolian", "Myanmar (Burmese)", "Nepali", "Norwegian", "Nyanja (Chichewa)", "Odia (Oriya)", "Pashto", "Persian", "Polish", "Portuguese", "Punjabi", "Romanian", "Russian", "Samoan", "Scots Gaelic", "Serbian", "Sesotho", "Shona", "Sindhi", "Sinhala", "Slovak", "Slovenian", "Somali", "Spanish", "Sundanese", "Swahili", "Swedish", "Tagalog (Filipino)", "Tajik", "Tamil", "Tatar", "Telugu", "Thai", "Turkish", "Turkmen", "Ukrainian", "Urdu", "Uyghur", "Uzbek", "Vietnamese", "Welsh", "Xhosa", "Yiddish", "Yoruba", "Zulu"
];

interface PageData {
  id: string;
  filename: string;
  originalImage: string;
  cleanedImage: string | null;
  detectedTexts: ComicText[];
  detectedPanels?: [number, number, number, number][];
  status: 'pending' | 'processing' | 'done' | 'error';
  width: number;
  height: number;
  isIgnored?: boolean;
}

// Helper to sample background color from image
async function getAverageColor(imgSrc: string, box: [number, number, number, number]): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve('#ffffff');

      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      const [ymin, xmin, ymax, xmax] = box;
      const sx = Math.max(0, (xmin / 1000) * canvas.width);
      const sy = Math.max(0, (ymin / 1000) * canvas.height);
      const sw = Math.min(canvas.width - sx, ((xmax - xmin) / 1000) * canvas.width);
      const sh = Math.min(canvas.height - sy, ((ymax - ymin) / 1000) * canvas.height);

      if (sw <= 0 || sh <= 0) return resolve('#ffffff');

      const imageData = ctx.getImageData(sx, sy, sw, sh).data;
      const colorCounts: Record<string, number> = {};
      let maxCount = 0;
      let dominantColor = [255, 255, 255];

      for (let i = 0; i < imageData.length; i += 4) {
        const r = Math.floor(imageData[i] / 16) * 16;
        const g = Math.floor(imageData[i + 1] / 16) * 16;
        const b = Math.floor(imageData[i + 2] / 16) * 16;
        const key = `${r},${g},${b}`;

        colorCounts[key] = (colorCounts[key] || 0) + 1;
        if (colorCounts[key] > maxCount) {
          maxCount = colorCounts[key];
          dominantColor = [imageData[i], imageData[i + 1], imageData[i + 2]];
        }
      }

      resolve(`rgb(${dominantColor[0]}, ${dominantColor[1]}, ${dominantColor[2]})`);
    };
    img.onerror = () => resolve('#ffffff');
    img.src = imgSrc;
  });
}

async function generateCleanedImage(imgSrc: string, texts: ComicText[]): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(imgSrc);

      ctx.drawImage(img, 0, 0);

      texts.forEach(t => {
        const [ymin, xmin, ymax, xmax] = t.box_2d;
        const expansion = 8;
        const eyMin = Math.max(0, ymin - expansion);
        const exMin = Math.max(0, xmin - expansion);
        const eyMax = Math.min(1000, ymax + expansion);
        const exMax = Math.min(1000, xmax + expansion);

        const x = (exMin / 1000) * canvas.width;
        const y = (eyMin / 1000) * canvas.height;
        const w = ((exMax - exMin) / 1000) * canvas.width;
        const h = ((eyMax - eyMin) / 1000) * canvas.height;

        ctx.fillStyle = t.bgColor || 'white';
        ctx.fillRect(x, y, w, h);
      });

      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => resolve(imgSrc);
    img.src = imgSrc;
  });
}

const getImageDimensions = (url: string): Promise<{width: number, height: number}> => {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
};

const blobUrlToBase64 = async (url: string): Promise<string> => {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const checkIfTextOnlyPage = async (page: PageData, base64Data: string): Promise<boolean> => {
  if (page.detectedTexts.length <= 3) return false;
  
  const img = new Image();
  img.src = base64Data;
  await new Promise((resolve) => { 
    img.onload = resolve;
    img.onerror = resolve; 
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  const getBrightness = (x: number, y: number) => {
    const idx = (y * canvas.width + x) * 4;
    return (data[idx] + data[idx+1] + data[idx+2]) / 3;
  };

  let totalInk = 0;
  let inkOutsideText = 0;
  const textMask = new Uint8Array(canvas.width * canvas.height);
  for (let t of page.detectedTexts) {
    let xMin = Math.max(0, Math.floor((t.box_2d[1] / 1000) * canvas.width) - 15);
    let xMax = Math.min(canvas.width, Math.floor((t.box_2d[3] / 1000) * canvas.width) + 15);
    let yMin = Math.max(0, Math.floor((t.box_2d[0] / 1000) * canvas.height) - 15);
    let yMax = Math.min(canvas.height, Math.floor((t.box_2d[2] / 1000) * canvas.height) + 15);
    for (let y = yMin; y < yMax; y++) {
      for (let x = xMin; x < xMax; x++) {
        textMask[y * canvas.width + x] = 1;
      }
    }
  }
  for (let y = 0; y < canvas.height; y += 4) {
    for (let x = 0; x < canvas.width; x += 4) {
      let b = getBrightness(x, y);
      if (b < 200) {
        totalInk++;
        if (textMask[y * canvas.width + x] === 0) {
          inkOutsideText++;
        }
      }
    }
  }
  return totalInk > 0 && (inkOutsideText / totalInk) < 0.15;
};

// Helper interfaces and function for panel splitting
interface ExportPanel {
  top: number;
  bottom: number;
  left: number;
  right: number;
  texts: ComicText[];
  isTextOnly: boolean;
  base64Image?: string;
}

const getPanelsForPage = async (page: PageData, base64Data: string, customApiKey?: string): Promise<ExportPanel[]> => {
  const toSentenceCase = (str: string) => {
    let text = str.toLowerCase();
    text = text.replace(/(^\s*[a-z]|[\.\!\?]\s*[a-z])/g, match => match.toUpperCase());
    text = text.replace(/\b(i)(['’]m|['’]ll|['’]ve|['’]d|\b)/g, (match, p1, p2) => 'I' + p2);
    return text;
  };

  const img = new Image();
  img.src = base64Data;
  await new Promise((resolve) => { 
    img.onload = resolve;
    img.onerror = resolve; 
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(img, 0, 0);
  }
  const imageData = ctx ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
  const data = imageData ? imageData.data : null;

  const getBrightness = (x: number, y: number) => {
    if (!data) return 255;
    const idx = (y * canvas.width + x) * 4;
    return (data[idx] + data[idx+1] + data[idx+2]) / 3;
  };

  let edgeWhite = 0;
  let edgeBlack = 0;
  for (let x = 0; x < canvas.width; x++) {
    let b1 = getBrightness(x, 2);
    let b2 = getBrightness(x, canvas.height - 3);
    if (b1 > 200) edgeWhite++; else if (b1 < 50) edgeBlack++;
    if (b2 > 200) edgeWhite++; else if (b2 < 50) edgeBlack++;
  }
  for (let y = 0; y < canvas.height; y++) {
    let b1 = getBrightness(2, y);
    let b2 = getBrightness(canvas.width - 3, y);
    if (b1 > 200) edgeWhite++; else if (b1 < 50) edgeBlack++;
    if (b2 > 200) edgeWhite++; else if (b2 < 50) edgeBlack++;
  }
  const isBlackGutter = edgeBlack > edgeWhite;

  interface Region { xMin: number; xMax: number; yMin: number; yMax: number; }

  let mergedTextBoxes: Region[] = page.detectedTexts.map(t => ({
    xMin: (t.box_2d[1] / 1000) * img.width,
    xMax: (t.box_2d[3] / 1000) * img.width,
    yMin: (t.box_2d[0] / 1000) * img.height,
    yMax: (t.box_2d[2] / 1000) * img.height,
  }));

  const mergeDistX = img.width * 0.08;
  const mergeDistY = img.height * 0.15; // Increased to aggressively merge floating text blocks

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < mergedTextBoxes.length; i++) {
      for (let j = i + 1; j < mergedTextBoxes.length; j++) {
        let b1 = mergedTextBoxes[i];
        let b2 = mergedTextBoxes[j];
        const xOverlap = b1.xMin <= b2.xMax + mergeDistX && b1.xMax >= b2.xMin - mergeDistX;
        const yOverlap = b1.yMin <= b2.yMax + mergeDistY && b1.yMax >= b2.yMin - mergeDistY;
        
        if (xOverlap && yOverlap) {
          b1.xMin = Math.min(b1.xMin, b2.xMin);
          b1.xMax = Math.max(b1.xMax, b2.xMax);
          b1.yMin = Math.min(b1.yMin, b2.yMin);
          b1.yMax = Math.max(b1.yMax, b2.yMax);
          mergedTextBoxes.splice(j, 1);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }

  const isGutterCol = (x: number, yMin: number, yMax: number) => {
    for (let tb of mergedTextBoxes) {
      if (x >= tb.xMin && x <= tb.xMax && yMin <= tb.yMax && yMax >= tb.yMin) {
        return false;
      }
    }
    let matchCount = 0;
    const height = yMax - yMin;
    for (let y = Math.floor(yMin); y < Math.floor(yMax); y++) {
      let b = getBrightness(x, y);
      if (isBlackGutter ? b < 50 : b > 200) matchCount++;
    }
    return matchCount >= height - Math.max(15, height * 0.015);
  };

  const isGutterRow = (y: number, xMin: number, xMax: number) => {
    for (let tb of mergedTextBoxes) {
      if (y >= tb.yMin && y <= tb.yMax && xMin <= tb.xMax && xMax >= tb.xMin) {
        return false;
      }
    }
    let matchCount = 0;
    const width = xMax - xMin;
    for (let x = Math.floor(xMin); x < Math.floor(xMax); x++) {
      let b = getBrightness(x, y);
      if (isBlackGutter ? b < 50 : b > 200) matchCount++;
    }
    return matchCount >= width - Math.max(15, width * 0.015);
  };

  const minGutterColWidth = Math.max(10, Math.floor(img.width * 0.012));
  const minGutterRowHeight = Math.max(10, Math.floor(img.height * 0.012));

  const checkHorizontalBorder = (y: number, xMin: number, xMax: number, searchHeight: number = 6) => {
    let width = xMax - xMin;
    let maxDarkCount = 0;
    for (let cy = Math.floor(y) - searchHeight; cy <= Math.floor(y) + searchHeight; cy++) {
      if (cy < 0 || cy >= img.height) continue;
      let darkCount = 0;
      for (let x = Math.floor(xMin); x < Math.floor(xMax); x++) {
        let b = getBrightness(x, cy);
        if (isBlackGutter ? b > 150 : b < 100) darkCount++;
      }
      if (darkCount > maxDarkCount) maxDarkCount = darkCount;
    }
    return maxDarkCount > width * 0.45;
  };

  const checkVerticalBorder = (x: number, yMin: number, yMax: number, searchWidth: number = 6) => {
    let height = yMax - yMin;
    let maxDarkCount = 0;
    for (let cx = Math.floor(x) - searchWidth; cx <= Math.floor(x) + searchWidth; cx++) {
      if (cx < 0 || cx >= img.width) continue;
      let darkCount = 0;
      for (let y = Math.floor(yMin); y < Math.floor(yMax); y++) {
        let b = getBrightness(cx, y);
        if (isBlackGutter ? b > 150 : b < 100) darkCount++;
      }
      if (darkCount > maxDarkCount) maxDarkCount = darkCount;
    }
    return maxDarkCount > height * 0.45;
  };

  const splitRegion = (region: Region): Region[] => {
    // If this region contains NO text boxes, do not split it further.
    let hasText = false;
    for (let tb of mergedTextBoxes) {
      if (tb.xMin < region.xMax && tb.xMax > region.xMin && tb.yMin < region.yMax && tb.yMax > region.yMin) {
        hasText = true;
        break;
      }
    }
    if (!hasText) {
      return [region];
    }
    
    // 1. Try horizontal splits first
    let gutterRows: number[] = [];
    for (let y = Math.floor(region.yMin); y < Math.floor(region.yMax); y++) {
      if (isGutterRow(y, region.xMin, region.xMax)) {
        gutterRows.push(y);
      }
    }

    let horizontalSplits: {start: number, end: number}[] = [];
    if (gutterRows.length > 0) {
      let start = gutterRows[0];
      let prev = gutterRows[0];
      for (let i = 1; i < gutterRows.length; i++) {
        if (gutterRows[i] <= prev + 4) {
          prev = gutterRows[i];
        } else {
          if (prev - start >= minGutterRowHeight) {
            let isValid = checkHorizontalBorder(start, region.xMin, region.xMax) || checkHorizontalBorder(prev, region.xMin, region.xMax);
            if ((prev - start) > img.height * 0.04) isValid = true; // wide gutters are inherently valid
            if (region.xMax - region.xMin >= img.width * 0.95 && (prev - start) > img.height * 0.015) isValid = true;
            if (isValid) horizontalSplits.push({start, end: prev});
          }
          start = gutterRows[i];
          prev = gutterRows[i];
        }
      }
      if (prev - start >= minGutterRowHeight) {
        let isValid = checkHorizontalBorder(start, region.xMin, region.xMax) || checkHorizontalBorder(prev, region.xMin, region.xMax);
        if ((prev - start) > img.height * 0.04) isValid = true;
        if (region.xMax - region.xMin >= img.width * 0.95 && (prev - start) > img.height * 0.015) isValid = true;
        if (isValid) horizontalSplits.push({start, end: prev});
      }
    }

    if (horizontalSplits.length > 0) {
      let subRegions: Region[] = [];
      let currentY = region.yMin;
      for (let split of horizontalSplits) {
        let splitCenter = Math.floor((split.start + split.end) / 2);
        subRegions.push({ xMin: region.xMin, xMax: region.xMax, yMin: currentY, yMax: splitCenter });
        currentY = splitCenter;
      }
      subRegions.push({ xMin: region.xMin, xMax: region.xMax, yMin: currentY, yMax: region.yMax });

      let finalRegions: Region[] = [];
      for (let sub of subRegions) {
        finalRegions.push(...splitRegion(sub));
      }
      return finalRegions;
    }

    // 2. Vertical splits
    let gutterCols: number[] = [];
    for (let x = Math.floor(region.xMin); x < Math.floor(region.xMax); x++) {
      if (isGutterCol(x, region.yMin, region.yMax)) {
        gutterCols.push(x);
      }
    }

    let verticalSplits: {start: number, end: number}[] = [];
    if (gutterCols.length > 0) {
      let start = gutterCols[0];
      let prev = gutterCols[0];
      for (let i = 1; i < gutterCols.length; i++) {
        if (gutterCols[i] <= prev + 4) {
          prev = gutterCols[i];
        } else {
          if (prev - start >= minGutterColWidth) {
            let isValid = checkVerticalBorder(start, region.yMin, region.yMax) || checkVerticalBorder(prev, region.yMin, region.yMax);
            if ((prev - start) > img.width * 0.05) isValid = true;
            if (isValid) verticalSplits.push({start, end: prev});
          }
          start = gutterCols[i];
          prev = gutterCols[i];
        }
      }
      if (prev - start >= minGutterColWidth) {
        let isValid = checkVerticalBorder(start, region.yMin, region.yMax) || checkVerticalBorder(prev, region.yMin, region.yMax);
        if ((prev - start) > img.width * 0.05) isValid = true;
        if (isValid) verticalSplits.push({start, end: prev});
      }
    }

    if (verticalSplits.length > 0) {
      let subRegions: Region[] = [];
      let currentX = region.xMin;
      for (let split of verticalSplits) {
        let splitCenter = Math.floor((split.start + split.end) / 2);
        subRegions.push({ xMin: currentX, xMax: splitCenter, yMin: region.yMin, yMax: region.yMax });
        currentX = splitCenter;
      }
      subRegions.push({ xMin: currentX, xMax: region.xMax, yMin: region.yMin, yMax: region.yMax });

      let finalRegions: Region[] = [];
      for (let sub of subRegions) {
        finalRegions.push(...splitRegion(sub));
      }
      return finalRegions;
    }

    return [region];
  };

  const textMask = new Uint8Array(canvas.width * canvas.height);
  for (let t of page.detectedTexts) {
    let xMin = Math.max(0, Math.floor((t.box_2d[1] / 1000) * canvas.width) - 15);
    let xMax = Math.min(canvas.width, Math.floor((t.box_2d[3] / 1000) * canvas.width) + 15);
    let yMin = Math.max(0, Math.floor((t.box_2d[0] / 1000) * canvas.height) - 15);
    let yMax = Math.min(canvas.height, Math.floor((t.box_2d[2] / 1000) * canvas.height) + 15);
    for (let y = yMin; y < yMax; y++) {
      for (let x = xMin; x < xMax; x++) {
        if (y >= 0 && y < canvas.height && x >= 0 && x < canvas.width) {
          textMask[y * canvas.width + x] = 1;
        }
      }
    }
  }

  let initialRegion: Region = { xMin: 0, xMax: img.width, yMin: 0, yMax: img.height };
  let rawPanels = page.detectedTexts.length === 0 ? [initialRegion] : splitRegion(initialRegion);
  
  // Complexity Check: If the pixel scanner only found 1 big panel but there are strings of text
  // indicating multiple panels, use AI as a fallback to detect the complex layout.
  if (rawPanels.length === 1 && page.detectedTexts.length > 2) {
    try {
      const aiPanels = await detectComicPanels(base64Data, customApiKey);
      if (aiPanels && aiPanels.length > 1) {
        rawPanels = aiPanels.map(p => ({
          yMin: Math.max(0, (p[0] / 1000) * img.height),
          xMin: Math.max(0, (p[1] / 1000) * img.width),
          yMax: Math.min(img.height, (p[2] / 1000) * img.height),
          xMax: Math.min(img.width, (p[3] / 1000) * img.width),
        }));
      }
    } catch (e) {
      console.error("AI panel fallback failed", e);
    }
  }

  let panels = rawPanels.filter(r => {
    return (r.xMax - r.xMin >= 20 && r.yMax - r.yMin >= 20);
  }).map(r => {
    let panelTexts = page.detectedTexts.filter(t => {
      let tXCenter = ((t.box_2d[1] + t.box_2d[3]) / 2 / 1000) * img.width;
      let tYCenter = ((t.box_2d[0] + t.box_2d[2]) / 2 / 1000) * img.height;
      return tXCenter >= r.xMin && tXCenter <= r.xMax && tYCenter >= r.yMin && tYCenter <= r.yMax;
    });

    return {
      top: r.yMin,
      bottom: r.yMax,
      left: r.xMin,
      right: r.xMax,
      texts: panelTexts.sort((a, b) => {
        const aTop = a.box_2d[0], aBottom = a.box_2d[2], aLeft = a.box_2d[1], aRight = a.box_2d[3];
        const bTop = b.box_2d[0], bBottom = b.box_2d[2], bLeft = b.box_2d[1], bRight = b.box_2d[3];
        
        // Horizontal overlap check for columns
        const horizontalOverlap = Math.min(aRight, bRight) - Math.max(aLeft, bLeft);
        
        // If they are in the same general column (significant horizontal overlap)
        if (horizontalOverlap > 10) {
            return aTop - bTop;
        }
        
        // Vertical overlap check
        const verticalOverlap = Math.min(aBottom, bBottom) - Math.max(aTop, bTop);
        if (verticalOverlap > -10) return aLeft - bLeft;

        // If they are in different columns, right-most column goes LAST if right side is longer.
        // But more generally, standard comic reading is left-to-right, then top-to-bottom.
        // However, if there are two distinct columns, we read the left column completely, then the right column.
        
        // If a is clearly to the left of b, a comes first.
        if (aRight < bLeft) return -1;
        // If a is clearly to the right of b, b comes first.
        if (bRight < aLeft) return 1;

        return aTop - bTop;
      }).map(t => ({...t, text: toSentenceCase(t.text)}))
    };
  });

  panels = panels.filter(p => {
    if (p.texts.length > 0) return true;
    let matchCount = 0, total = 0;
    for (let y = Math.floor(p.top); y < Math.floor(p.bottom); y += 2) {
      for (let x = Math.floor(p.left); x < Math.floor(p.right); x += 2) {
        let b = getBrightness(x, y);
        if (isBlackGutter ? b < 50 : b > 200) matchCount++;
        total++;
      }
    }
    return !(matchCount > total * 0.98);
  });

  let exportPanels: ExportPanel[] = [];
  for (let p of panels) {
    let panelTotalInk = 0;
    let panelInkOutsideText = 0;
    for (let y = Math.floor(p.top); y < Math.floor(p.bottom); y += 4) {
      for (let x = Math.floor(p.left); x < Math.floor(p.right); x += 4) {
        let b = getBrightness(x, y);
        if (b < 200) {
          panelTotalInk++;
          if (textMask[y * canvas.width + x] === 0) {
            panelInkOutsideText++;
          }
        }
      }
    }
    
    const isPanelTextOnly = panelTotalInk > 0 && (panelInkOutsideText / panelTotalInk) < 0.15;
    let base64Image: string | undefined;

    if (!isPanelTextOnly || p.texts.length === 0) {
      const cropCanvas = document.createElement('canvas');
      const cropCtx = cropCanvas.getContext('2d');
      const sWidth = p.right - p.left;
      const sHeight = p.bottom - p.top;
      
      if (sWidth > 0 && sHeight > 0) {
        cropCanvas.width = sWidth;
        cropCanvas.height = sHeight;
        if (cropCtx) {
          cropCtx.drawImage(img, p.left, p.top, sWidth, sHeight, 0, 0, sWidth, sHeight);
        }
        base64Image = cropCanvas.toDataURL('image/jpeg', 0.9);
      }
    }

    exportPanels.push({
      top: p.top, bottom: p.bottom, left: p.left, right: p.right,
      texts: p.texts,
      isTextOnly: isPanelTextOnly,
      base64Image
    });
  }

  return exportPanels;
};

export default function ComicEditor() {
  const [pages, setPages] = useState<PageData[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [tempText, setTempText] = useState("");
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
  const [pageInputValue, setPageInputValue] = useState("");
  const [isGridView, setIsGridView] = useState(false);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [customApiKey, setCustomApiKey] = useState(() => localStorage.getItem('gemini_api_key') || "");
  const [translateDuringBatch, setTranslateDuringBatch] = useState(false);
  const [batchTargetLanguage, setBatchTargetLanguage] = useState("English");
  const [processedCount, setProcessedCount] = useState(() => parseInt(localStorage.getItem('gemini_processed_count') || '0', 10));
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    return false;
  });
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const activePage = pages[currentPageIndex];

  useEffect(() => {
    setPageInputValue((currentPageIndex + 1).toString());
  }, [currentPageIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      if (e.key === 'ArrowLeft') {
        setCurrentPageIndex(p => Math.max(0, p - 1));
      } else if (e.key === 'ArrowRight') {
        setCurrentPageIndex(p => Math.min(pages.length - 1, p + 1));
      } else if (e.key === 'Escape') {
        setIsGridView(false);
        setSelectedPages(new Set());
        setLastSelectedIndex(null);
        setEditingIndex(null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isGridView && selectedPages.size > 0) {
          setPages(prev => prev.filter((_, idx) => !selectedPages.has(idx)));
          setSelectedPages(new Set());
          setLastSelectedIndex(null);
          setCurrentPageIndex(0);
          setIsGridView(false);
        } else if (!isGridView && pages.length > 0) {
          setPages(prev => prev.filter((_, idx) => idx !== currentPageIndex));
          setCurrentPageIndex(p => Math.max(0, p - 1));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pages.length, isGridView, selectedPages, currentPageIndex]);

  const onDrop = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    
    let newPages: PageData[] = [];
    const file = acceptedFiles[0];
    
    if (file.name.toLowerCase().endsWith('.zip') || file.name.toLowerCase().endsWith('.cbz')) {
      toast.info("Extracting archive...");
      try {
        const zip = await JSZip.loadAsync(file);
        const imageFiles = Object.keys(zip.files)
          .filter(name => name.match(/\.(jpe?g|png|webp)$/i))
          .sort((a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}));
          
        for (const name of imageFiles) {
          const blob = await zip.files[name].async("blob");
          const url = URL.createObjectURL(blob);
          const dims = await getImageDimensions(url);
          newPages.push({ id: name + Date.now(), filename: name, originalImage: url, cleanedImage: null, detectedTexts: [], status: 'pending', width: dims.width, height: dims.height });
        }
        toast.success(`Extracted ${newPages.length} pages`);
      } catch (e) {
        toast.error("Failed to read archive");
        return;
      }
    } else {
      const sortedFiles = [...acceptedFiles].sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'}));
      for (const f of sortedFiles) {
        const url = URL.createObjectURL(f);
        const dims = await getImageDimensions(url);
        newPages.push({ id: f.name + Date.now(), filename: f.name, originalImage: url, cleanedImage: null, detectedTexts: [], status: 'pending', width: dims.width, height: dims.height });
      }
    }
    
    setPages(prev => [...prev, ...newPages]);
    if (pages.length === 0) {
      setCurrentPageIndex(0);
      setViewMode('edit');
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 
      'image/*': [],
      'application/zip': ['.zip', '.cbz'],
      'application/x-zip-compressed': ['.zip', '.cbz']
    },
    multiple: true,
  } as any);

  const processPage = async (pageIndex: number) => {
    const page = pages[pageIndex];
    if (!page || page.status === 'processing') return;

    if (processedCount >= 10 && !customApiKey) {
      setIsBatchProcessing(false);
      setShowApiKeyModal(true);
      toast.error("You've reached the free limit of 10 pages. Please enter your own Gemini API key to continue.");
      return;
    }

    setPages(prev => prev.map((p, idx) => idx === pageIndex ? { ...p, status: 'processing' } : p));
    
    try {
      const base64Image = await blobUrlToBase64(page.originalImage);
      const result = await detectComicText(base64Image, customApiKey);
      
      const processedResults = await Promise.all(result.map(async (item) => {
        const bgColor = await getAverageColor(page.originalImage, item.box_2d);
        return { ...item, bgColor };
      }));

      const cleanedImage = await generateCleanedImage(page.originalImage, processedResults);
      
      let finalResults = processedResults;

      if (translateDuringBatch && batchTargetLanguage && finalResults.length > 0) {
        try {
          const textsToTranslate = finalResults.map(t => t.text);
          const translatedTexts = await translateTexts(textsToTranslate, batchTargetLanguage, customApiKey);
          finalResults = finalResults.map((t, i) => ({
            ...t,
            text: translatedTexts[i] || t.text
          }));
        } catch (translateError: any) {
          console.error("Translation during batch failed:", translateError);
           if (translateError?.message?.toLowerCase().includes("quota") || translateError?.status === 429) {
             setShowApiKeyModal(true);
             if (!isBatchProcessing) {
                toast.error("Gemini API Quota Exceeded during translation. Please provide your own API key.");
             }
             throw translateError;
           }
        }
      }

      setPages(prev => prev.map((p, idx) => idx === pageIndex ? { 
        ...p, 
        detectedTexts: finalResults, 
        cleanedImage, 
        status: 'done' 
      } : p));

      setProcessedCount(prev => {
        const newCount = prev + 1;
        localStorage.setItem('gemini_processed_count', newCount.toString());
        return newCount;
      });
      
      if (!isBatchProcessing) {
        toast.success(`Processed page ${pageIndex + 1}`);
      }
    } catch (error: any) {
      console.error(error);
      setPages(prev => prev.map((p, idx) => idx === pageIndex ? { ...p, status: 'error' } : p));
      
      let errorMsg = error?.message || String(error);
      try {
        if (errorMsg.startsWith('{')) {
          const parsed = JSON.parse(errorMsg);
          if (parsed.error && typeof parsed.error === 'string') {
             const internalParsed = JSON.parse(parsed.error);
             errorMsg = internalParsed?.error?.message || errorMsg;
          } else if (parsed.error && parsed.error.message) {
             errorMsg = parsed.error.message;
          }
        }
      } catch(e) {}

      if (errorMsg.toLowerCase().includes("quota") || error?.status === 429) {
        setIsBatchProcessing(false);
        setShowApiKeyModal(true);
        if (!isBatchProcessing) {
          toast.error("Gemini API Quota Exceeded. Please provide your own API key.");
        }
        throw error;
      } else if (errorMsg.toLowerCase().includes("api key not valid") || errorMsg.includes("API_KEY_INVALID")) {
        setIsBatchProcessing(false);
        toast.error("Invalid API Key. Please provide a valid Gemini API key.");
        if (customApiKey) {
           setCustomApiKey("");
           localStorage.removeItem('gemini_api_key');
        }
        setShowApiKeyModal(true);
        throw error;
      } else {
        if (!isBatchProcessing) {
          toast.error(`Failed to process page ${pageIndex + 1}: ${errorMsg}`);
        }
      }
    }
  };

  const handleBatchProcess = async () => {
    setIsBatchProcessing(true);
    toast.info(`Starting batch process for ${pages.length} pages...`);
    
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].status === 'done' || pages[i].isIgnored) continue;
      setCurrentPageIndex(i); // Follow along
      try {
        await processPage(i);
      } catch (e: any) {
        if (e?.message?.toLowerCase().includes("quota") || e?.status === 429) {
          break; // Stop batch processing on quota error
        }
      }
    }
    
    setIsBatchProcessing(false);
    if (!showApiKeyModal) {
      toast.success("Batch processing complete!");
    }
  };

  const getBoxStyle = (box: [number, number, number, number], imgWidth: number, imgHeight: number) => {
    const [ymin, xmin, ymax, xmax] = box;
    const paddingPx = 4;
    
    if (imgWidth === 0) {
      return {
        top: `${(ymin / 1000) * 100}%`,
        left: `${(xmin / 1000) * 100}%`,
        width: `${((xmax - xmin) / 1000) * 100}%`,
        height: `${((ymax - ymin) / 1000) * 100}%`,
      };
    }

    const leftPx = (xmin / 1000.0) * imgWidth - paddingPx;
    const topPx = (ymin / 1000.0) * imgHeight - paddingPx;
    const widthPx = ((xmax - xmin) / 1000.0) * imgWidth + (paddingPx * 2);
    const heightPx = ((ymax - ymin) / 1000.0) * imgHeight + (paddingPx * 2);

    return {
      top: `${(topPx / imgHeight) * 100}%`,
      left: `${(leftPx / imgWidth) * 100}%`,
      width: `${(widthPx / imgWidth) * 100}%`,
      height: `${(heightPx / imgHeight) * 100}%`,
    };
  };

  const handleSaveEdit = (index: number) => {
    setPages(prev => prev.map((p, idx) => {
      if (idx === currentPageIndex) {
        const newTexts = [...p.detectedTexts];
        newTexts[index].text = tempText;
        return { ...p, detectedTexts: newTexts };
      }
      return p;
    }));
    setEditingIndex(null);
  };

  const downloadHtml = async () => {
    if (pages.length === 0) return;
    toast.info("Generating HTML...");

    let pagesHtml = '';

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const imgSrc = page.originalImage;
      let base64Data = imgSrc;
      
      if (!imgSrc.startsWith('data:')) {
        base64Data = await blobUrlToBase64(imgSrc);
      }

      const panels = await getPanelsForPage(page, base64Data, customApiKey);

      let panelsHtml = '';
      for (let p of panels) {
        let imageHtml = '';
        if (p.base64Image) {
          imageHtml = `
        <div class="panel-image-container">
          <img src="${p.base64Image}" class="panel-img" alt="Panel" />
        </div>`;
        }

        const textContent = p.texts.length > 0 
          ? p.texts.map(t => `<p class="panel-text-line">${t.text.replace(/\n/g, ' ')}</p>`).join('')
          : '';
        
        panelsHtml += `
      <div class="panel-card">
        ${imageHtml}
        ${textContent ? `<div class="panel-text-container">${textContent}</div>` : ''}
      </div>`;
      }

      pagesHtml += `
    <div class="page-wrapper">
${panelsHtml}
    </div>\n`;
    }

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Comic Export</title>
<style>
    body { margin: 0; padding: 20px; background: #fff; font-family: 'Arial', sans-serif; display: flex; flex-direction: column; align-items: center; }
    .page-wrapper { width: 100%; max-width: 800px; margin-bottom: 60px; display: flex; flex-direction: column; gap: 40px; }
    .panel-card { display: flex; flex-direction: column; align-items: center; width: 100%; }
    .panel-image-container { width: 100%; display: flex; justify-content: center; margin-bottom: 16px; }
    .panel-img { max-width: 100%; height: auto; display: block; }
    .panel-text-container { width: 100%; max-width: 600px; text-align: left; }
    .panel-text-line { margin: 0 0 12px 0; font-size: 1rem; line-height: 1.6; color: #222; }
    .panel-text-line:last-child { margin-bottom: 0; }
</style>
</head>
<body>
${pagesHtml}</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'comic_export.html';
    a.click();
    toast.success("HTML generated successfully!", { icon: "!" });
    setTimeout(() => {
      toast("Easily Send to Kindle", { icon: "!", duration: 4000 });
    }, 500);
  };

  const downloadPdf = async () => {
    if (pages.length === 0) return;
    toast.info("Generating PDF...");

    try {
      const { jsPDF } = await import('jspdf');
      
      const firstPage = pages[0];
      const pdf = new jsPDF({
        orientation: firstPage.width > firstPage.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [firstPage.width, firstPage.height],
        hotfixes: ["px_scaling"]
      });

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        
        if (i > 0) {
          pdf.addPage([page.width, page.height], page.width > page.height ? 'landscape' : 'portrait');
        }

        const imgSrc = page.cleanedImage || page.originalImage;
        let base64Data = imgSrc;
        
        if (!imgSrc.startsWith('data:')) {
          base64Data = await blobUrlToBase64(imgSrc);
        }

        const imgType = base64Data.substring("data:image/".length, base64Data.indexOf(";base64"));
        const format = imgType.toUpperCase() === 'PNG' ? 'PNG' : 'JPEG';
        
        const isTextOnly = await checkIfTextOnlyPage(page, base64Data);

        if (isTextOnly) {
          const margin = 40;
          const maxWidth = page.width - (margin * 2);
          const fontSizePx = Math.max(16, page.width * 0.015);
          pdf.setFontSize(fontSizePx * 0.75);
          pdf.setTextColor(0, 0, 0);
          
          let currentY = margin;
          
          const sortedTexts = [...page.detectedTexts].sort((a, b) => a.box_2d[0] - b.box_2d[0]);
          
          sortedTexts.forEach(t => {
            const cleanText = t.text.trim().replace(/\n/g, ' ');
            const textLines = pdf.splitTextToSize(cleanText, maxWidth);
            const lineHeightPx = fontSizePx * 1.5;
            
            textLines.forEach((line: string) => {
              if (currentY + lineHeightPx > page.height - margin) {
                pdf.addPage([page.width, page.height], page.width > page.height ? 'landscape' : 'portrait');
                currentY = margin;
              }
              pdf.text(line, margin, currentY, { baseline: 'top' });
              currentY += lineHeightPx;
            });
            currentY += lineHeightPx; // paragraph spacing
          });
        } else {
          pdf.addImage(base64Data, format, 0, 0, page.width, page.height);

          page.detectedTexts.forEach(t => {
            const [ymin, xmin, ymax, xmax] = t.box_2d;
            const paddingPx = 4;
            const leftPx = (xmin / 1000.0) * page.width - paddingPx;
            const topPx = (ymin / 1000.0) * page.height - paddingPx;
            const widthPx = ((xmax - xmin) / 1000.0) * page.width + (paddingPx * 2);
            const heightPx = ((ymax - ymin) / 1000.0) * page.height + (paddingPx * 2);
            
            const fontSizePx = Math.max(14, page.width * 0.012);
            
            // jsPDF setFontSize uses points (pt). To render at exact pixels, multiply by 0.75 (since 1px = 0.75pt)
            pdf.setFontSize(fontSizePx * 0.75);
            pdf.setTextColor(0, 0, 0);
            
            const centerX = leftPx + (widthPx / 2);
            const centerY = topPx + (heightPx / 2);
            
            const cleanText = t.text.trim();
            const textLines = pdf.splitTextToSize(cleanText, widthPx);
            
            // Calculate exact pixel dimensions for perfect vertical centering
            const lineHeightPx = fontSizePx * 1.2; // Match CSS line-height: 1.2
            const totalTextHeightPx = textLines.length * lineHeightPx;
            const startY = centerY - (totalTextHeightPx / 2);
            
            textLines.forEach((line, index) => {
              const leadingPx = lineHeightPx - fontSizePx;
              const lineY = startY + (index * lineHeightPx) + (leadingPx / 2);
              
              pdf.text(line, centerX, lineY, {
                align: 'center',
                baseline: 'top'
              });
            });
          });
        }
      }

      pdf.save('comic_export.pdf');
      toast.success("PDF generated successfully!");
    } catch (error) {
      console.error("PDF generation failed:", error);
      toast.error("Failed to generate PDF");
    }
  };

  const downloadEpub = async () => {
    if (pages.length === 0) return;
    toast.info("Generating EPUB...");
    const zip = new JSZip();

    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

    let manifestItems = '';
    let spineItems = '';
    let navItems = '';

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageId = `page${i + 1}`;
      const imgId = `img${i + 1}`;
      const imgFilename = `image${i + 1}.jpg`;

      const imgSrc = page.cleanedImage || page.originalImage;
      let base64Data = imgSrc;
      if (!imgSrc.startsWith('data:')) {
        base64Data = await blobUrlToBase64(imgSrc);
      }
      
      const isTextOnly = await checkIfTextOnlyPage(page, base64Data);

      manifestItems += `    <item id="${pageId}" href="${pageId}.xhtml" media-type="application/xhtml+xml"/>\n`;
      if (!isTextOnly) {
        manifestItems += `    <item id="${imgId}" href="images/${imgFilename}" media-type="image/jpeg"/>\n`;
      }
      spineItems += `    <itemref idref="${pageId}"/>\n`;
      navItems += `      <li><a href="${pageId}.xhtml">Page ${i + 1}</a></li>\n`;

      if (isTextOnly) {
        const sortedTexts = [...page.detectedTexts].sort((a, b) => a.box_2d[0] - b.box_2d[0]);
        const textContent = sortedTexts.map(t => `<p>${t.text.replace(/\n/g, ' ')}</p>`).join('\n');
        
        zip.file(`OEBPS/${pageId}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Page ${i + 1}</title>
  <meta name="viewport" content="width=${page.width}, height=${page.height}"/>
  <style>
    body { margin: 0; padding: 2em; width: 100%; height: 100%; background: #fff; color: #000; font-family: 'Arial', sans-serif; box-sizing: border-box; }
    p { margin-bottom: 1em; line-height: 1.5; font-size: 1.2em; text-align: justify; }
  </style>
</head>
<body>
${textContent}
</body>
</html>`);
      } else {
        const overlays = page.detectedTexts.map(t => {
          const [ymin, xmin, ymax, xmax] = t.box_2d;
          const paddingPx = 4;
          const leftPx = (xmin / 1000.0) * page.width - paddingPx;
          const topPx = (ymin / 1000.0) * page.height - paddingPx;
          const widthPx = ((xmax - xmin) / 1000.0) * page.width + (paddingPx * 2);
          const heightPx = ((ymax - ymin) / 1000.0) * page.height + (paddingPx * 2);

          const leftPct = (leftPx / page.width) * 100;
          const topPct = (topPx / page.height) * 100;
          const widthPct = (widthPx / page.width) * 100;
          const heightPct = (heightPx / page.height) * 100;

          const fontSizePx = Math.max(14, page.width * 0.012);
          const fontSizeVw = (fontSizePx / page.width) * 100;
          const display_text = t.text.replace(/\n/g, '<br/>');
          
          return `    <div class="text-box" style="left: ${leftPct}%; top: ${topPct}%; width: ${widthPct}%; height: ${heightPct}%; font-size: ${fontSizePx}px; font-size: ${fontSizeVw}vw;"><p>${display_text}</p></div>\n`;
        }).join('');

        zip.file(`OEBPS/${pageId}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Page ${i + 1}</title>
  <meta name="viewport" content="width=${page.width}, height=${page.height}"/>
  <style>
    body { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
    .container { position: relative; width: 100%; height: 100%; }
    .comic-img { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; display: block; pointer-events: none; -webkit-user-select: none; user-select: none; }
    .text-box { position: absolute; background: transparent; color: black; font-family: 'Arial', sans-serif; display: flex; align-items: center; justify-content: center; text-align: center; box-sizing: border-box; z-index: 2; overflow: hidden; word-break: break-word; line-height: 1.2; pointer-events: auto; -webkit-user-select: text; user-select: text; }
    .text-box p { margin: 0; padding: 0; width: 100%; }
  </style>
</head>
<body>
  <div class="container">
    <img src="images/${imgFilename}" alt="Page ${i + 1}" class="comic-img" />
${overlays}  </div>
</body>
</html>`);

        if (imgSrc.startsWith('data:')) {
          const base64DataRaw = imgSrc.split(',')[1];
          zip.file(`OEBPS/images/${imgFilename}`, base64DataRaw, { base64: true });
        } else {
          const response = await fetch(imgSrc);
          const blob = await response.blob();
          zip.file(`OEBPS/images/${imgFilename}`, blob);
        }
      }
    }

    zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:comic-${Date.now()}</dc:identifier>
    <dc:title>Comic Book Export</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().split('.')[0]}Z</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">none</meta>
  </metadata>
  <manifest>
${manifestItems}    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
${spineItems}  </spine>
</package>`);

    zip.file("OEBPS/nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Navigation</title></head>
<body>
  <nav epub:type="toc">
    <ol>
${navItems}    </ol>
  </nav>
</body>
</html>`);

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'comic_book.epub';
    a.click();
    toast.success("EPUB generated successfully!");
  };

  const downloadText = () => {
    let textContent = "";
    for (let i = 0; i < pages.length; i++) {
       const page = pages[i];
       if (page.status === 'done' && page.detectedTexts.length > 0) {
         textContent += `--- Page ${i + 1} ---\n`;
         for (let textObj of page.detectedTexts) {
           textContent += `${textObj.text.replace(/\n/g, ' ')}\n`;
         }
         textContent += `\n`;
       }
    }
    
    if (!textContent) {
      toast.error("No text available to export.");
      return;
    }

    const blob = new Blob([textContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'comic_text.txt';
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Text exported successfully!");
  };

  return (
    <div className="relative max-w-6xl mx-auto p-6 space-y-8">
      <Button 
        variant="ghost" 
        size="icon" 
        onClick={() => setIsDarkMode(!isDarkMode)} 
        className="fixed top-4 right-4 w-10 h-10 rounded-full hover:bg-muted text-primary z-50 bg-background/50 backdrop-blur-sm"
        title="Toggle Dark Mode"
      >
        {isDarkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
      </Button>

      <header className="text-center space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-foreground flex items-center justify-center gap-3">
          Ebook Studio
        </h1>
        {pages.length === 0 && (
          <p className="text-muted-foreground text-lg">
            Batch processing and export of your ebooks using AI-powered OCR tools.
          </p>
        )}
      </header>

      {pages.length === 0 ? (
        <div
          {...getRootProps()}
          className={cn(
            "border-2 border-dashed rounded-2xl p-20 text-center cursor-pointer transition-all duration-300",
            isDragActive ? "border-primary bg-primary/5 scale-[1.02]" : "border-muted-foreground/20 hover:border-primary/50"
          )}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 rounded-full bg-primary/10 text-primary">
              <Layers className="w-10 h-10" />
            </div>
            <div>
              <p className="text-xl font-medium">Drop comic pages, ZIP, or CBZ here</p>
              <p className="text-muted-foreground">or click to browse files</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3 space-y-2">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center bg-muted/30 p-1 rounded-lg border gap-y-2">
              <div className="flex flex-wrap items-center gap-2 w-full">
                {!isGridView && (
                  <>
                    <Button 
                      variant={viewMode === 'edit' ? "secondary" : "ghost"} 
                      size="sm" 
                      onClick={() => setViewMode('edit')}
                      className="gap-2 h-8"
                    >
                      <Edit2 className="w-4 h-4" /> Editor
                    </Button>
                    <Button 
                      variant={viewMode === 'preview' ? "secondary" : "ghost"} 
                      size="sm" 
                      onClick={() => setViewMode('preview')}
                      className="gap-2 h-8"
                    >
                      <Eye className="w-4 h-4" /> Preview
                    </Button>
                    <div className="w-px h-5 bg-border mx-1 self-center" />
                  </>
                )}
                <Button
                  variant={isGridView ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => {
                    setIsGridView(!isGridView);
                    if (isGridView) {
                      setSelectedPages(new Set());
                      setLastSelectedIndex(null);
                    }
                  }}
                  className="gap-2 h-8"
                >
                  <CheckSquare className="w-4 h-4" /> {isGridView ? "Done" : "Select"}
                </Button>
                {isGridView && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.multiple = true;
                        input.accept = 'image/*,application/zip,application/x-zip-compressed';
                        input.onchange = (e) => {
                          const target = e.target as HTMLInputElement;
                          if (target.files) {
                            onDrop(Array.from(target.files));
                          }
                        };
                        input.click();
                      }}
                      className="gap-2 h-8"
                    >
                      <Upload className="w-4 h-4" /> Add Page
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (selectedPages.size === pages.length) {
                          setSelectedPages(new Set());
                        } else {
                          setSelectedPages(new Set(pages.map((_, i) => i)));
                        }
                      }}
                      className="gap-2 h-8"
                    >
                      <CheckSquare className="w-4 h-4" /> {selectedPages.size === pages.length ? "Deselect All" : "Select All"}
                    </Button>
                  </>
                )}
                {isGridView && selectedPages.size > 0 && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const sortedSelected = Array.from(selectedPages).sort((a: number, b: number) => a - b);
                        if (sortedSelected[0] === 0) return;
                        const newPages = [...pages];
                        const newSelected = new Set<number>();
                        for (const idx of sortedSelected) {
                          const numIdx = idx as number;
                          const temp = newPages[numIdx - 1];
                          newPages[numIdx - 1] = newPages[numIdx];
                          newPages[numIdx] = temp;
                          newSelected.add(numIdx - 1);
                        }
                        setPages(newPages);
                        setSelectedPages(newSelected);
                      }}
                      className="gap-2 h-8"
                      disabled={Array.from(selectedPages).some((idx: unknown) => (idx as number) === 0)}
                    >
                      <ChevronLeft className="w-4 h-4" /> Move Left
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const sortedSelected = Array.from(selectedPages).sort((a: number, b: number) => b - a);
                        if (sortedSelected[0] === pages.length - 1) return;
                        const newPages = [...pages];
                        const newSelected = new Set<number>();
                        for (const idx of sortedSelected) {
                          const numIdx = idx as number;
                          const temp = newPages[numIdx + 1];
                          newPages[numIdx + 1] = newPages[numIdx];
                          newPages[numIdx] = temp;
                          newSelected.add(numIdx + 1);
                        }
                        setPages(newPages);
                        setSelectedPages(newSelected);
                      }}
                      className="gap-2 h-8"
                      disabled={Array.from(selectedPages).some((idx: unknown) => (idx as number) === pages.length - 1)}
                    >
                      Move Right <ChevronRight className="w-4 h-4" />
                    </Button>
                    <div className="w-px h-5 bg-border mx-1 self-center" />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const newPages = [...pages];
                        selectedPages.forEach(idx => {
                          newPages[idx].isIgnored = !newPages[idx].isIgnored;
                        });
                        setPages(newPages);
                        setSelectedPages(new Set());
                      }}
                      className="gap-2 h-8"
                    >
                      <X className="w-4 h-4" /> Toggle Ignore
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        const newPages = pages.filter((_, idx) => !selectedPages.has(idx));
                        setPages(newPages);
                        setSelectedPages(new Set());
                        setLastSelectedIndex(null);
                        setCurrentPageIndex(0);
                        setIsGridView(false);
                      }}
                      className="gap-2 h-8"
                    >
                      <Trash2 className="w-4 h-4" /> Delete
                    </Button>
                  </>
                )}
              </div>
            </div>
            
            {!isGridView && (
              <div className="flex justify-between items-center py-0">
                <div className="flex items-center gap-1 text-sm font-medium">
                  <span>Page</span>
                  <input
                    type="number"
                    min={1}
                    max={pages.length}
                    value={pageInputValue}
                    onChange={(e) => {
                      setPageInputValue(e.target.value);
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val >= 1 && val <= pages.length) {
                        setCurrentPageIndex(val - 1);
                      }
                    }}
                    onBlur={() => {
                      setPageInputValue((currentPageIndex + 1).toString());
                    }}
                    className="w-10 h-5 px-1 text-center bg-transparent border-b border-t-0 border-x-0 border-foreground/30 focus-visible:outline-none focus:border-primary focus:ring-0 rounded-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span>of {pages.length}</span>
                </div>
                <div className="flex gap-1">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="w-6 h-6"
                    disabled={currentPageIndex === 0}
                    onClick={() => setCurrentPageIndex(p => p - 1)}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="w-6 h-6"
                    disabled={currentPageIndex === pages.length - 1}
                    onClick={() => setCurrentPageIndex(p => p + 1)}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Main Content Area */}
            {isGridView ? (
              <Card className="p-6 bg-black/5 rounded-xl border-2 border-muted min-h-[500px]">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {pages.map((page, idx) => (
                    <div
                      key={page.id}
                      onClick={(e) => {
                        const newSelected = new Set(selectedPages);
                        if (e.shiftKey && lastSelectedIndex !== null) {
                          const start = Math.min(lastSelectedIndex, idx);
                          const end = Math.max(lastSelectedIndex, idx);
                          for (let i = start; i <= end; i++) {
                            newSelected.add(i);
                          }
                        } else {
                          if (newSelected.has(idx)) {
                            newSelected.delete(idx);
                          } else {
                            newSelected.add(idx);
                          }
                          setLastSelectedIndex(idx);
                        }
                        setSelectedPages(newSelected);
                      }}
                      className={cn(
                        "relative aspect-[2/3] rounded-lg overflow-hidden cursor-pointer border-4 transition-all",
                        selectedPages.has(idx) ? "border-primary shadow-lg scale-95" : "border-transparent hover:border-primary/50 hover:scale-[1.02]",
                        page.isIgnored && !selectedPages.has(idx) && "opacity-50"
                      )}
                    >
                      <img src={page.originalImage} className="w-full h-full object-cover" alt={`Page ${idx + 1}`} />
                      
                      <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full backdrop-blur-sm">
                        {idx + 1}
                      </div>

                      {page.isIgnored && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-[2px]">
                          <div className="bg-destructive text-destructive-foreground px-2 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                            <X className="w-3 h-3" /> Ignored
                          </div>
                        </div>
                      )}

                      {selectedPages.has(idx) && (
                        <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                          <div className="bg-primary text-primary-foreground rounded-full p-2 shadow-lg">
                            <CheckSquare className="w-6 h-6" />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ) : (
              <div className="relative w-full flex items-center justify-center">
                {activePage ? (
                  <div 
                    className={cn("relative inline-block w-full transition-opacity duration-300", activePage.isIgnored ? "opacity-50" : "opacity-100")} 
                    style={{ containerType: 'inline-size' }}
                    onClick={() => {
                      if (viewMode === 'preview') {
                        setIsGridView(true);
                      } else if (viewMode === 'edit' && editingIndex !== null) {
                        setEditingIndex(null);
                      }
                    }}
                  >
                    {activePage.isIgnored && (
                      <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm pointer-events-none">
                        <div className="bg-destructive/90 text-destructive-foreground px-6 py-3 rounded-full font-bold shadow-lg flex items-center gap-2">
                          <X className="w-5 h-5" /> This page is ignored and will be skipped during processing
                        </div>
                      </div>
                    )}
                    <img
                      ref={imageRef}
                      src={viewMode === 'edit' ? activePage.originalImage : (activePage.cleanedImage || activePage.originalImage)}
                      alt={`Page ${currentPageIndex + 1}`}
                      className="w-full h-auto block bg-white"
                    />
                    <AnimatePresence>
                      {activePage.detectedTexts.map((item, idx) => {
                        const boxStyle = getBoxStyle(item.box_2d, activePage.width, activePage.height);

                        return (
                          <motion.div
                            key={`${activePage.id}-${idx}`}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className={cn(
                              "absolute group transition-all flex items-center justify-center overflow-hidden",
                              viewMode === 'edit' && "cursor-pointer border border-transparent hover:border-primary hover:bg-primary/10",
                              editingIndex === idx && "border-primary bg-white z-10 shadow-xl",
                              viewMode === 'preview' && "select-text"
                            )}
                            style={{
                              ...boxStyle,
                              backgroundColor: 'transparent',
                            }}
                            onClick={(e) => {
                              if (viewMode === 'edit') {
                                e.stopPropagation();
                                setEditingIndex(idx);
                                setTempText(item.text);
                              }
                            }}
                          >
                            {editingIndex === idx ? (
                              <div className="w-full h-full flex flex-col p-1 bg-white">
                                <textarea
                                  autoFocus
                                  className="w-full h-full resize-none focus:outline-none border-none bg-transparent text-black text-center"
                                  style={{
                                    fontFamily: "Helvetica, Arial, sans-serif",
                                    fontSize: `${(Math.max(14, activePage.width * 0.012) / activePage.width) * 100}cqi`,
                                    lineHeight: 1.2
                                  }}
                                  value={tempText}
                                  onChange={(e) => setTempText(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault();
                                      handleSaveEdit(idx);
                                    }
                                  }}
                                />
                                <div className="absolute -bottom-8 right-0 flex gap-1 bg-white p-1 rounded shadow-lg border">
                                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleSaveEdit(idx)}>
                                    <Check className="h-3 w-3 text-green-600" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingIndex(null)}>
                                    <X className="h-3 w-3 text-red-600" />
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div 
                                className={cn(
                                  "w-full h-full flex items-center justify-center overflow-hidden transition-all duration-300",
                                  "opacity-100"
                                )}
                              >
                                <div 
                                  className={cn(
                                    "font-medium text-black whitespace-pre-wrap text-center",
                                    viewMode === 'preview' ? "" : "bg-white/90 px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                  )}
                                  style={{ 
                                    fontFamily: "Helvetica, Arial, sans-serif", 
                                    wordBreak: 'break-word',
                                    fontSize: `${(Math.max(14, activePage.width * 0.012) / activePage.width) * 100}cqi`,
                                    lineHeight: 1.2
                                  }}
                                >
                                  {item.text}
                                </div>
                              </div>
                            )}
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                ) : null}
              </div>
            )}

            {/* Thumbnails */}
            {!isGridView && (
              <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                {pages.map((page, idx) => (
                  <div 
                    key={page.id}
                    onClick={() => setCurrentPageIndex(idx)}
                    className={cn(
                      "relative w-20 h-28 shrink-0 rounded overflow-hidden cursor-pointer border-2 transition-all",
                      currentPageIndex === idx ? "border-primary shadow-md" : "border-transparent opacity-70 hover:opacity-100"
                    )}
                  >
                    <img src={page.originalImage} className="w-full h-full object-cover" alt={`Thumb ${idx}`} />
                    {page.status === 'done' && (
                      <div className="absolute top-1 right-1 bg-green-500 rounded-full p-0.5">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                    {page.status === 'processing' && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-6">
            <Card className="p-6 flex flex-col sticky top-6">
              
              {activePage?.detectedTexts && activePage.detectedTexts.length > 0 && (
                <div className="space-y-3 max-h-[320px] flex flex-col mb-4">
                  <div className="flex justify-between items-center shrink-0">
                    <span className="text-sm font-medium">Page {currentPageIndex + 1} Texts</span>
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      {activePage.detectedTexts.length}
                    </span>
                  </div>
                  <div className="overflow-y-auto space-y-2 pr-2 custom-scrollbar pb-2 max-h-[282px]">
                    {activePage.detectedTexts.map((t, i) => (
                      <div 
                        key={i}
                        className={cn(
                          "p-2 rounded border text-xs cursor-pointer transition-colors hover:bg-muted flex items-start gap-2",
                          editingIndex === i ? "border-primary bg-primary/5" : "border-border"
                        )}
                        onClick={() => {
                          setEditingIndex(i);
                          setTempText(t.text);
                          setViewMode('edit');
                        }}
                      >
                        <span className="shrink-0 w-4 font-semibold text-muted-foreground mt-0.5">{i + 1}.</span>
                        <p className="line-clamp-2 font-mono flex-1">{t.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className={cn("shrink-0", activePage?.detectedTexts && activePage.detectedTexts.length > 0 && "pt-4 border-t")}>
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 items-center w-full pb-2">
                    <div className="flex items-center justify-center gap-2">
                      <Checkbox 
                        id="translate-batch" 
                        checked={translateDuringBatch} 
                        onCheckedChange={(c) => setTranslateDuringBatch(!!c)} 
                        className="w-5 h-5 border-2 border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background"
                      />
                      <label htmlFor="translate-batch" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
                        Translate Text
                      </label>
                    </div>
                    {translateDuringBatch && (
                      <div className="w-full max-w-[200px]">
                        <Select value={batchTargetLanguage} onValueChange={setBatchTargetLanguage}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select Language" />
                          </SelectTrigger>
                          <SelectContent>
                            {LANGUAGES.map(lang => (
                              <SelectItem key={lang} value={lang}>{lang}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  <Button 
                    variant="ghost"
                    className="w-full gap-2" 
                    onClick={() => processPage(currentPageIndex)} 
                    disabled={activePage?.status === 'processing' || isBatchProcessing}
                  >
                    {activePage?.status === 'processing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Process Current Page
                  </Button>

                  <Button 
                    variant="ghost"
                    className="w-full gap-2" 
                    onClick={handleBatchProcess} 
                    disabled={isBatchProcessing || pages.every(p => p.status === 'done')}
                  >
                    {isBatchProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Batch Process All
                  </Button>
                  
                  <div className="pt-4 border-t mt-4 space-y-2 flex flex-col items-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger 
                        render={
                          <Button 
                            variant="ghost" 
                            className="w-full gap-2"
                            disabled={pages.filter(p => p.status === 'done').length === 0} 
                          />
                        }
                      >
                        <Download className="w-4 h-4" /> Export
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-48" align="center">
                        <DropdownMenuItem onClick={downloadText} className="cursor-pointer">
                          <Download className="w-4 h-4 mr-2" /> Export TXT
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={downloadHtml} className="cursor-pointer">
                          <Download className="w-4 h-4 mr-2" /> Export HTML
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={downloadPdf} className="cursor-pointer">
                          <Download className="w-4 h-4 mr-2" /> Export PDF
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={downloadEpub} className="cursor-pointer">
                          <Book className="w-4 h-4 mr-2" /> Export EPUB
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <a 
                      href="https://www.amazon.com/sendtokindle/" 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="block w-full text-xs text-muted-foreground text-center mt-3 pt-3 border-t hover:underline hover:text-primary transition-colors flex items-center justify-center gap-1"
                    >
                      <span>Send to Kindle</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <Button 
                    variant="ghost" 
                    className="w-full gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 mt-4" 
                    onClick={() => {
                      setPages([]);
                      setCurrentPageIndex(0);
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                    Clear All Pages
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* API Key Modal */}
      <AnimatePresence>
        {showApiKeyModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-background border rounded-xl shadow-2xl p-6 max-w-md w-full space-y-4"
            >
              <h2 className="text-xl font-bold">API Key Required</h2>
              <p className="text-muted-foreground text-sm">
                You've reached the limit of the free tier (10 pages) or the default API has exceeded its quota. To continue processing, please provide your own Gemini API key.
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium">Gemini API Key</label>
                <input
                  type="password"
                  value={customApiKey}
                  onChange={(e) => setCustomApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="text-xs text-muted-foreground">
                  Your key is stored locally in your browser and is never sent to our servers.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setShowApiKeyModal(false)}>
                  Cancel
                </Button>
                <Button onClick={() => {
                  localStorage.setItem('gemini_api_key', customApiKey);
                  setShowApiKeyModal(false);
                  toast.success("API Key saved. You can resume processing.");
                }}>
                  Save & Continue
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
