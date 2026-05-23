import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { detectComicText, detectComicPanels, detectLayoutLocalYolo, translateTexts, ComicText, LayoutResult } from '@/services/gemini';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Download, Upload, Trash2, Edit2, Check, X, Eye, Book, Sparkles, Layers, Play, ChevronLeft, ChevronRight, CheckSquare, Languages, Sun, Moon, ExternalLink, Settings, Shuffle, Type, Move, Crop, Contrast, ArrowUp, ArrowDown, Palette, PanelLeftOpen, PanelLeftClose, Square, Coffee, Heart, Github, Info, AlertTriangle, BookOpen, Lightbulb } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence, useDragControls, useMotionValue } from 'motion/react';
import { cn } from '@/lib/utils';
import { Slideshow } from './Slideshow';
import JSZip from 'jszip';
import { useTheme } from 'next-themes';

const LANGUAGES = [
  "Afrikaans", "Albanian", "Amharic", "Arabic", "Armenian", "Azerbaijani", "Basque", "Belarusian", "Bengali", "Bosnian", "Bulgarian", "Catalan", "Cebuano", "Chinese (Simplified)", "Chinese (Traditional)", "Corsican", "Croatian", "Czech", "Danish", "Dutch", "English", "Esperanto", "Estonian", "Finnish", "French", "Frisian", "Galician", "Georgian", "German", "Greek", "Gujarati", "Haitian Creole", "Hausa", "Hawaiian", "Hebrew", "Hindi", "Hmong", "Hungarian", "Icelandic", "Igbo", "Indonesian", "Irish", "Italian", "Japanese", "Javanese", "Kannada", "Kazakh", "Khmer", "Kinyarwanda", "Korean", "Kurdish", "Kyrgyz", "Lao", "Latin", "Latvian", "Lithuanian", "Luxembourgish", "Macedonian", "Malagasy", "Malay", "Malayalam", "Maltese", "Maori", "Marathi", "Mongolian", "Myanmar (Burmese)", "Nepali", "Norwegian", "Nyanja (Chichewa)", "Odia (Oriya)", "Pashto", "Persian", "Polish", "Portuguese", "Punjabi", "Romanian", "Russian", "Samoan", "Scots Gaelic", "Serbian", "Sesotho", "Shona", "Sindhi", "Sinhala", "Slovak", "Slovenian", "Somali", "Spanish", "Sundanese", "Swahili", "Swedish", "Tagalog (Filipino)", "Tajik", "Tamil", "Tatar", "Telugu", "Thai", "Turkish", "Turkmen", "Ukrainian", "Urdu", "Uyghur", "Uzbek", "Vietnamese", "Welsh", "Xhosa", "Yiddish", "Yoruba", "Zulu"
];

interface ManualText {
  id: string;
  text: string;
  box_2d: [number, number, number, number];
  color: string;
  fontSize: number;
}

interface ManualImage {
  id: string;
  url: string;
  aspectRatio: number;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] in 0-1000 space
  isHighContrast: boolean;
  hasOutline?: boolean;
  color?: string;
  crop?: {
    ymin: number;
    xmin: number;
    ymax: number;
    xmax: number;
  };
}

interface PageData {
  id: string;
  filename: string;
  originalImage: string;
  cleanedImage: string | null;
  detectedTexts: ComicText[];
  manualTexts?: ManualText[];
  manualImages?: ManualImage[];
  yoloTexts?: any[];
  detectedPanels?: any[];
  status: 'pending' | 'processing' | 'done' | 'error';
  width: number;
  height: number;
  isIgnored?: boolean;
  isTextOnly?: boolean;
  hasOcrRun?: boolean;
  hasLayoutRun?: boolean;
  translatedLanguage?: string;
}

// Helper to resize image for AI processing (reduces bandwidth and speed up detection)
async function resizeImageForAI(imgSrc: string, maxDim: number = 1024): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > height) {
        if (width > maxDim) {
          height = (height * maxDim) / width;
          width = maxDim;
        }
      } else {
        if (height > maxDim) {
          width = (width * maxDim) / height;
          height = maxDim;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(imgSrc);
      
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => resolve(imgSrc);
    img.src = imgSrc;
  });
}

// Helper to scan outward to find accurate text bubble rectangle
function refineTextBubbleBounds(ctx: CanvasRenderingContext2D, box2d: [number, number, number, number]): [number, number, number, number] {
  const [ymin, xmin, ymax, xmax] = box2d;
  const canvas = ctx.canvas;
  const startX = (xmin / 1000) * canvas.width;
  const startY = (ymin / 1000) * canvas.height;
  const startWidth = ((xmax - xmin) / 1000) * canvas.width;
  const startHeight = ((ymax - ymin) / 1000) * canvas.height;

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;

  let top = Math.max(0, Math.floor(startY));
  let bottom = Math.min(canvas.height - 1, Math.floor(startY + startHeight));
  let left = Math.max(0, Math.floor(startX));
  let right = Math.min(canvas.width - 1, Math.floor(startX + startWidth));

  const getBrightness = (px: number, py: number) => {
    if (px < 0 || px >= canvas.width || py < 0 || py >= canvas.height) return 0; // Black out of bounds
    const idx = (Math.floor(py) * canvas.width + Math.floor(px)) * 4;
    return (data[idx] + data[idx+1] + data[idx+2]) / 3;
  };

  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const maxD = Math.min(canvas.width, canvas.height) * 0.3; // Max 30% screen expansion

  const castRay = (x: number, y: number, dx: number, dy: number) => {
      let darkRun = 0;
      let whiteRun = 0;
      let mode = 0; // 0: clear text, 1: find border
      let hitD = 0;
      
      for (let d = 0; d < maxD; d++) {
          let px = Math.floor(x + dx * d);
          let py = Math.floor(y + dy * d);
          
          if (px < 0 || px >= canvas.width || py < 0 || py >= canvas.height) {
              if (mode === 1) hitD = d;
              break;
          }
          
          let br = getBrightness(px, py);
          let isDark = br < 160;
          
          if (mode === 0) {
              if (!isDark) {
                  whiteRun++;
                  if (whiteRun >= 2) { 
                      mode = 1; 
                      hitD = maxD;
                  }
              } else {
                  whiteRun = 0;
              }
          } else {
              if (isDark) {
                  darkRun++;
                  if (darkRun >= 2) { 
                      hitD = Math.max(0, d - 1);
                      break; 
                  } 
              } else {
                  darkRun = 0;
              }
          }
      }
      return hitD;
  };

  const getMaxValidD = (d_array: number[]) => {
      if (d_array.length === 0) return 0;
      d_array.sort((a, b) => a - b);
      let n = d_array.length;
      let medIndex = Math.floor(n * 0.5);
      
      if (d_array[medIndex] >= maxD - 1) {
          if (d_array[Math.floor(n * 0.25)] < maxD - 1) {
              return d_array[Math.floor(n * 0.25)];
          }
          return Math.min(50, maxD); // Safe fallback
      }

      let max_valid = d_array[medIndex];
      let jumpThresh = Math.max(10, Math.min(canvas.width, canvas.height) * 0.025); 
      
      for (let i = medIndex + 1; i < n; i++) {
          if (d_array[i] - d_array[i-1] > jumpThresh) {
              break;
          }
          if (d_array[i] >= maxD - 1) {
              break;
          }
          max_valid = d_array[i];
      }
      return max_valid;
  };

  let topRays = [];
  for(let x = left; x <= right; x++) topRays.push(castRay(x, top, 0, -1));
  
  let bottomRays = [];
  for(let x = left; x <= right; x++) bottomRays.push(castRay(x, bottom, 0, 1));

  let leftRays = [];
  for(let y = top; y <= bottom; y++) leftRays.push(castRay(left, y, -1, 0));

  let rightRays = [];
  for(let y = top; y <= bottom; y++) rightRays.push(castRay(right, y, 1, 0));

  let expTop = getMaxValidD(topRays);
  let expBottom = getMaxValidD(bottomRays);
  let expLeft = getMaxValidD(leftRays);
  let expRight = getMaxValidD(rightRays);

  const PADDING = 4;
  let finalTop = Math.max(0, top - expTop - PADDING);
  let finalBottom = Math.min(canvas.height - 1, bottom + expBottom + PADDING);
  let finalLeft = Math.max(0, left - expLeft - PADDING);
  let finalRight = Math.min(canvas.width - 1, right + expRight + PADDING);

  return [
    (finalTop / canvas.height) * 1000,
    (finalLeft / canvas.width) * 1000,
    (finalBottom / canvas.height) * 1000,
    (finalRight / canvas.width) * 1000,
  ];
}

// Helper to sample background color from image
function calculateOptimalFontSize(
  text: string, 
  boxWidth: number, 
  boxHeight: number, 
  fontFamily: string = "Helvetica, Arial, sans-serif"
): number {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return 14;

  let minSize = 4;
  let maxSize = Math.max(minSize, boxHeight * 0.95);
  let optimalSize = minSize;

  const paragraphs = text.split(/\n|\\n/);
  
  for (let iter = 0; iter < 15; iter++) {
    const midSize = (minSize + maxSize) / 2;
    context.font = `bold ${midSize}px ${fontFamily}`;
    const lineHeight = midSize * 1.25;
    
    let isFitting = true;
    let actualLines = 0;
    
    for (const paragraph of paragraphs) {
      if (paragraph.trim() === '') {
        actualLines++;
        continue;
      }
      const words = paragraph.split(/[ \t]+/);
      let currentLine = '';
      
      for (const word of words) {
        if (!word) continue;
        
        if (context.measureText(word).width > boxWidth * 0.95) {
             isFitting = false;
             break;
        }

        const testLine = currentLine + (currentLine ? ' ' : '') + word;
        const metrics = context.measureText(testLine);
        
        if (metrics.width > boxWidth * 0.95 && currentLine !== '') {
          actualLines++;
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (!isFitting) break;
      if (currentLine !== '') {
        actualLines++;
      }
    }
    
    if (!isFitting || (actualLines * lineHeight) > boxHeight * 0.95) {
        maxSize = midSize;
    } else {
        optimalSize = midSize;
        minSize = midSize;
    }
  }
  
  return optimalSize;
}

function getAverageColorFromCanvas(ctx: CanvasRenderingContext2D, box: [number, number, number, number]): string {
  const [ymin, xmin, ymax, xmax] = box;
  const canvas = ctx.canvas;
  const sx = Math.max(0, (xmin / 1000) * canvas.width);
  const sy = Math.max(0, (ymin / 1000) * canvas.height);
  const sw = Math.min(canvas.width - sx, ((xmax - xmin) / 1000) * canvas.width);
  const sh = Math.min(canvas.height - sy, ((ymax - ymin) / 1000) * canvas.height);

  if (sw <= 0 || sh <= 0) return '#ffffff';

  try {
    const imageData = ctx.getImageData(sx, sy, sw, sh).data;
    const colorCounts: Record<string, number> = {};
    let maxCount = 0;
    let dominantColor = [255, 255, 255];

    // Sampling step to keep it fast
    const step = imageData.length > 5000 ? 8 : 4;
    for (let i = 0; i < imageData.length; i += step) {
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
    return `rgb(${dominantColor[0]}, ${dominantColor[1]}, ${dominantColor[2]})`;
  } catch (e) {
    return '#ffffff';
  }
}

async function generateCleanedImageFromElement(img: HTMLImageElement, texts: ComicText[]): Promise<string> {
  // Do not erase original in-painting text. Simply return the original image source to keep artwork pristine!
  return img.src;
}

// Helper to check if a page is likely blank (solid color)
async function isPageLikelyBlank(imgSrc: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 32;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(false);
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      
      let rSum = 0, gSum = 0, bSum = 0;
      for (let i = 0; i < data.length; i += 4) {
        rSum += data[i];
        gSum += data[i+1];
        bSum += data[i+2];
      }
      const rAvg = rSum / (size * size);
      const gAvg = gSum / (size * size);
      const bAvg = bSum / (size * size);
      
      let varianceSum = 0;
      for (let i = 0; i < data.length; i += 4) {
        varianceSum += Math.pow(data[i] - rAvg, 2) + Math.pow(data[i+1] - gAvg, 2) + Math.pow(data[i+2] - bAvg, 2);
      }
      const variance = varianceSum / (size * size * 3); // Heuristic divisor (changed from 1.5 to 3)
      resolve(variance < 30); // Higher threshold for "blankness" (changed from 20 to 30)
    };
    img.onerror = () => resolve(false);
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

const rotateImageIfNeeded = async (url: string, width: number, height: number): Promise<{url: string, width: number, height: number}> => {
  if (width > height) {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = height; 
    canvas.height = width;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return { url, width, height };

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Rotate 270 degrees clockwise
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((270 * Math.PI) / 180);
    ctx.drawImage(img, -width / 2, -height / 2);

    await new Promise(r => setTimeout(r, 10));

    return { 
      url: canvas.toDataURL('image/jpeg', 0.95), 
      width: canvas.width, 
      height: canvas.height 
    };
  }
  return { url, width, height };
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
  return false;
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
  maskBase64?: string;
}

const panelsCache = new Map<string, ExportPanel[]>();

  const getPanelsForPage = async (page: PageData, base64Data: string, splitEnabled: boolean = true, customApiKey?: string): Promise<ExportPanel[]> => {
  const imgHash = base64Data ? `${base64Data.substring(0, 50)}_${base64Data.length}` : '';
  const cacheKey = `${page.id}_split_${splitEnabled}_im_${imgHash}_${JSON.stringify(page.detectedTexts || [])}_${JSON.stringify(page.manualTexts || [])}_${JSON.stringify(page.manualImages || [])}`;
  if (panelsCache.has(cacheKey)) {
    return panelsCache.get(cacheKey)!;
  }

  if (!splitEnabled) {
    // If splitting is disabled, return the whole page as one panel
    const defaultPanels = [{
      top: 0,
      bottom: page.height,
      left: 0,
      right: page.width,
      texts: [...(page.detectedTexts || []), ...(page.manualTexts || [])],
      isTextOnly: page.isTextOnly || false,
      base64Image: base64Data
    }];
    panelsCache.set(cacheKey, defaultPanels);
    return defaultPanels;
  }

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

  let mergedTextBoxes: Region[] = [...(page.detectedTexts || []), ...(page.manualTexts || [])].map(t => ({
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
    let whiteCount = 0;
    let blackCount = 0;
    const height = yMax - yMin;
    for (let y = Math.floor(yMin); y < Math.floor(yMax); y++) {
      let b = getBrightness(x, y);
      if (b > 220) whiteCount++;
      else if (b < 40) blackCount++;
    }
    const threshold = height - Math.max(15, height * 0.015);
    return whiteCount >= threshold || blackCount >= threshold;
  };

  const isGutterRow = (y: number, xMin: number, xMax: number) => {
    for (let tb of mergedTextBoxes) {
      if (y >= tb.yMin && y <= tb.yMax && xMin <= tb.xMax && xMax >= tb.xMin) {
        return false;
      }
    }
    let whiteCount = 0;
    let blackCount = 0;
    const width = xMax - xMin;
    for (let x = Math.floor(xMin); x < Math.floor(xMax); x++) {
      let b = getBrightness(x, y);
      if (b > 220) whiteCount++;
      else if (b < 40) blackCount++;
    }
    const threshold = width - Math.max(15, width * 0.015);
    return whiteCount >= threshold || blackCount >= threshold;
  };

  const minGutterColWidth = Math.max(10, Math.floor(img.width * 0.012));
  const minGutterRowHeight = Math.max(10, Math.floor(img.height * 0.012));

  const checkHorizontalBorder = (y: number, xMin: number, xMax: number, searchHeight: number = 6) => {
    let width = xMax - xMin;
    let maxContrastCount = 0;
    let gutterBrightness = getBrightness(Math.floor((xMin + xMax) / 2), Math.floor(y));
    let isWhiteGutter = gutterBrightness > 128;
    
    for (let cy = Math.floor(y) - searchHeight; cy <= Math.floor(y) + searchHeight; cy++) {
      if (cy < 0 || cy >= img.height) continue;
      let count = 0;
      for (let x = Math.floor(xMin); x < Math.floor(xMax); x++) {
        let b = getBrightness(x, cy);
        if (isWhiteGutter ? b < 100 : b > 150) count++;
      }
      if (count > maxContrastCount) maxContrastCount = count;
    }
    return maxContrastCount > width * 0.35;
  };

  const checkVerticalBorder = (x: number, yMin: number, yMax: number, searchWidth: number = 6) => {
    let height = yMax - yMin;
    let maxContrastCount = 0;
    let gutterBrightness = getBrightness(Math.floor(x), Math.floor((yMin + yMax) / 2));
    let isWhiteGutter = gutterBrightness > 128;

    for (let cx = Math.floor(x) - searchWidth; cx <= Math.floor(x) + searchWidth; cx++) {
      if (cx < 0 || cx >= img.width) continue;
      let count = 0;
      for (let y = Math.floor(yMin); y < Math.floor(yMax); y++) {
        let b = getBrightness(cx, y);
        if (isWhiteGutter ? b < 100 : b > 150) count++;
      }
      if (count > maxContrastCount) maxContrastCount = count;
    }
    return maxContrastCount > height * 0.35;
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

  let rawPanels: Region[] = [];
  let yoloTexts: any[] | null = page.yoloTexts || null;
  try {
    let aiPanels: any[] | null = page.detectedPanels || null;
    
    if (!aiPanels) {
      // 1. Attempt Server-Side ONNX inference or TFJS inference
      try {
        let layoutResult = null;
        console.log("Running Cloud Predict API first...");
        try {
          layoutResult = await runPredictAPI(base64Data);
        } catch (apiErr) {
          console.warn("Predict API failed:", apiErr);
        }
        
        if (layoutResult) {
          aiPanels = layoutResult.panels;
          yoloTexts = layoutResult.texts;
        }
      } catch (err) {
        console.error("Server ONNX detection failed", err);
      }
    }

    if (!aiPanels) {
      aiPanels = await detectComicPanels(base64Data, customApiKey);
    }

    if (aiPanels && aiPanels.length > 0) {
      rawPanels = aiPanels.map((p: any, originalIdx: number) => {
        const box = Array.isArray(p) ? p : p.box_2d;
        const mask = Array.isArray(p) ? undefined : p.maskBase64;
        return {
          yMin: Math.max(0, (box[0] / 1000) * img.height),
          xMin: Math.max(0, (box[1] / 1000) * img.width),
          yMax: Math.min(img.height, (box[2] / 1000) * img.height),
          xMax: Math.min(img.width, (box[3] / 1000) * img.width),
          maskBase64: mask,
          originalIdx
        };
      });
    }
  } catch (e) {
    console.error("AI panel detection failed, falling back to pixel scan", e);
  }

  if (rawPanels.length === 0) {
    let initialRegion: Region = { xMin: 0, xMax: img.width, yMin: 0, yMax: img.height };
    rawPanels = splitRegion(initialRegion);
    console.log(`[Split] No AI panels found, local scan found ${rawPanels.length} regions`);
  } else {
    // Even if we have AI panels, if it's just one giant panel that covers >95% of the page, 
    // it might be a failure to split a multi-panel page. Let's try splitting it.
    let finalRawPanels: Region[] = [];
    for (const p of rawPanels) {
      const pWidth = p.xMax - p.xMin;
      const pHeight = p.yMax - p.yMin;
      // If panel is huge (e.g. > 80% screen area), try local subdivision
      if ((pWidth * pHeight) > (img.width * img.height * 0.8)) {
        const subPanels = splitRegion(p);
        if (subPanels.length > 1) {
          console.log(`[Split] Subdivided large AI panel into ${subPanels.length} regions`);
          finalRawPanels.push(...subPanels);
          continue;
        }
      }
      finalRawPanels.push(p);
    }
    rawPanels = finalRawPanels;
  }

  const determineMangaMode = () => {
     const textsToCheck = yoloTexts && yoloTexts.length > 0 ? yoloTexts : page.detectedTexts;
     if (!textsToCheck || textsToCheck.length === 0) return false;
     let verticalCount = 0;
     for (const t of textsToCheck) {
         const box = Array.isArray(t) ? t : (t.box_2d || [0,0,0,0]);
         const height = box[2] - box[0];
         const width = box[3] - box[1];
         if (height > width * 1.5) verticalCount++;
     }
     return (verticalCount / textsToCheck.length) >= 0.3;
  };
  const isMangaMode = determineMangaMode();

  let validPanels = rawPanels.filter(r => (r.xMax - r.xMin >= 20 && r.yMax - r.yMin >= 20));

  // Assign each text to exactly one panel
  const textsByPanel: Map<number, ComicText[]> = new Map();
  const allAvailableTexts = [...(page.detectedTexts || []), ...(page.manualTexts || [])];
  
  allAvailableTexts.forEach(t => {
    // If text already has a panel assignment from OCR step, use it
    if ((t as any).panelIdx !== undefined) {
      const foundIdx = validPanels.findIndex(vp => (vp as any).originalIdx === (t as any).panelIdx);
      if (foundIdx !== -1) {
        if (!textsByPanel.has(foundIdx)) textsByPanel.set(foundIdx, []);
        textsByPanel.get(foundIdx)!.push(t);
        return;
      }
    }

    let tXCenter = ((t.box_2d[1] + t.box_2d[3]) / 2 / 1000) * img.width;
    let tYCenter = ((t.box_2d[0] + t.box_2d[2]) / 2 / 1000) * img.height;
    
    let bestPanelIdx = -1;
    let minDistance = Infinity;

    validPanels.forEach((r, idx) => {
      // Check if center is inside
      const isInside = tXCenter >= r.xMin && tXCenter <= r.xMax && tYCenter >= r.yMin && tYCenter <= r.yMax;
      
      const pXCenter = (r.xMin + r.xMax) / 2;
      const pYCenter = (r.yMin + r.yMax) / 2;
      const dist = Math.sqrt(Math.pow(tXCenter - pXCenter, 2) + Math.pow(tYCenter - pYCenter, 2));

      if (isInside) {
         // If it's strictly inside multiple, pick the one where text center is closest to panel center
         // We subtract a large amount from distance if it's inside to prioritize "inside" matches
         const adjustedDist = dist - 10000;
         if (adjustedDist < minDistance) {
            minDistance = adjustedDist;
            bestPanelIdx = idx;
         }
      } else {
         // If we haven't found an inside match yet, keep track of the closest panel anyway
         if (bestPanelIdx === -1 || minDistance >= 0) { // meaning no "inside" matches found yet
            if (dist < minDistance) {
               minDistance = dist;
               bestPanelIdx = idx;
            }
         }
      }
    });

    if (bestPanelIdx !== -1) {
      if (!textsByPanel.has(bestPanelIdx)) textsByPanel.set(bestPanelIdx, []);
      textsByPanel.get(bestPanelIdx)!.push(t);
    }
  });

  let panels = validPanels.map((r, idx) => {
    let panelTexts = textsByPanel.get(idx) || [];

    return {
      top: r.yMin,
      bottom: r.yMax,
      left: r.xMin,
      right: r.xMax,
      maskBase64: (r as any).maskBase64,
      texts: sortTextsReadingOrder(panelTexts, isMangaMode).map(t => ({...t, text: toSentenceCase(t.text)}))
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

  // Sort strictly by Top first
  panels.sort((a, b) => a.top - b.top);
  
  const tiers: typeof panels[] = [];
  let currentTier: typeof panels = [];
  
  for (const p of panels) {
    if (currentTier.length === 0) {
      currentTier.push(p);
    } else {
      const firstInTier = currentTier[0];
      const aTop = firstInTier.top;
      const aBottom = firstInTier.bottom;
      const aHeight = aBottom - aTop;
      
      const bTop = p.top;
      const bBottom = p.bottom;
      const bHeight = bBottom - bTop;
      
      const verticalOverlap = Math.max(0, Math.min(aBottom, bBottom) - Math.max(aTop, bTop));
      if (verticalOverlap > 0.2 * Math.min(aHeight, bHeight) || Math.abs(aTop - bTop) < 0.08 * img.height) {
        currentTier.push(p);
      } else {
        tiers.push(currentTier);
        currentTier = [p];
      }
    }
  }
  if (currentTier.length > 0) tiers.push(currentTier);
  
  const finalPanels: typeof panels = [];
  for (const tier of tiers) {
    tier.sort((a, b) => {
      if (Math.abs(a.left - b.left) < 0.05 * img.width) {
        return a.top - b.top;
      }
      return isMangaMode ? b.left - a.left : a.left - b.left;
    });
    finalPanels.push(...tier);
  }
  panels = finalPanels;

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

    const cropCanvas = document.createElement('canvas');
    const cropCtx = cropCanvas.getContext('2d');
    const sWidth = p.right - p.left;
    const sHeight = p.bottom - p.top;
    
    if (sWidth > 0 && sHeight > 0) {
      cropCanvas.width = sWidth;
      cropCanvas.height = sHeight;
      if (cropCtx) {
        cropCtx.fillStyle = '#ffffff';
        cropCtx.fillRect(0, 0, sWidth, sHeight);
        cropCtx.drawImage(img, p.left, p.top, sWidth, sHeight, 0, 0, sWidth, sHeight);
      }
      base64Image = cropCanvas.toDataURL('image/jpeg', 0.9);
    }

    exportPanels.push({
      top: p.top, bottom: p.bottom, left: p.left, right: p.right,
      texts: p.texts,
      isTextOnly: isPanelTextOnly,
      base64Image
    });
  }

  panelsCache.set(cacheKey, exportPanels);
  return exportPanels;
};

const PREDICT_URLS = [
  "https://predict-69ffb8299f770dcc9b69-dproatj77a-uw.a.run.app/predict",
  "https://predict-69ffba709f770dcc9b69-dproatj77a-nw.a.run.app/predict",
  "https://predict-69ffb9909f770dcc9b69-dproatj77a-de.a.run.app/predict"
];

async function runPredictAPI(base64Data: string): Promise<LayoutResult> {
  const shuffledUrls = [...PREDICT_URLS].sort(() => Math.random() - 0.5);
  let lastErr: any = null;
  
  for (const url of shuffledUrls) {
    try {
      const result = await detectLayoutLocalYolo(base64Data, url, "ul_2c576727830ac3f6a98acfb1b82e5c3fb7b4899b", false, 1, 0);
      if (result && (result.panels.length > 0 || result.texts.length > 0)) {
        return result;
      }
    } catch (err: any) {
      console.warn(`Predict API failed for ${url}:`, err);
      lastErr = err;
    }
  }
  
  throw lastErr || new Error("All predict API endpoints failed or returned empty results.");
}

const sortTextsReadingOrder = (texts: ComicText[], forceMangaMode?: boolean) => {
  if (!texts || texts.length === 0) return [];
  if (texts.length === 1) return texts;

  // Auto-detect Manga mode if >= 15% of text boxes are vertical OR if CJK characters are present
  let verticalCount = 0;
  let cjkCount = 0;
  for (const t of texts) {
    const height = t.box_2d[2] - t.box_2d[0];
    const width = t.box_2d[3] - t.box_2d[1];
    if (height > width * 1.5) verticalCount++;
    if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\uFaff\uFF66-\uFF9F]/.test(t.text)) cjkCount++;
  }
  const isMangaModeLayout = forceMangaMode !== undefined 
    ? forceMangaMode 
    : (texts.length > 0 && ((verticalCount / texts.length) >= 0.15 || (cjkCount / texts.length) >= 0.2));

  if (isMangaModeLayout) {
    // Manga text grouping: Primarily Top-to-Bottom tiers, then Right-to-Left within tiers.
    const sortedByTop = [...texts].sort((a, b) => a.box_2d[0] - b.box_2d[0]);
    
    const tiers: ComicText[][] = [];
    let currentTier: ComicText[] = [];
    
    for (const t of sortedByTop) {
      if (currentTier.length === 0) {
        currentTier.push(t);
      } else {
        const firstInTier = currentTier[0];
        const aTop = firstInTier.box_2d[0];
        const aBottom = firstInTier.box_2d[2];
        const bTop = t.box_2d[0];
        const bBottom = t.box_2d[2];
        
        const verticalOverlap = Math.max(0, Math.min(aBottom, bBottom) - Math.max(aTop, bTop));
        const minHeight = Math.min(aBottom - aTop, bBottom - bTop);
        
        if (verticalOverlap > 0.4 * minHeight || Math.abs(aTop - bTop) < 60) {
          currentTier.push(t);
        } else {
          tiers.push(currentTier);
          currentTier = [t];
        }
      }
    }
    if (currentTier.length > 0) tiers.push(currentTier);
    
    const finalSorted: ComicText[] = [];
    for (const tier of tiers) {
      tier.sort((a, b) => (b.box_2d[1] + b.box_2d[3]) - (a.box_2d[1] + a.box_2d[3]));
      finalSorted.push(...tier);
    }
    return finalSorted;
  }

  // Western grouping: Handle potential multi-column books
  const sortedByY = [...texts].sort((a, b) => a.box_2d[0] - b.box_2d[0]);
  
  // 1. Detect Column Layout
  const COLUMN_BREAK = 500;
  const PAGE_WIDTH = 1000;
  
  const xCenters = texts.map(t => (t.box_2d[1] + t.box_2d[3]) / 2);
  const leftCount = xCenters.filter(x => x < 450).length;
  const rightCount = xCenters.filter(x => x > 550).length;
  
  // Spanning elements (like titles/headers) have wide boxes or are centered
  const spanningHeuristic = (t: ComicText) => {
    const width = t.box_2d[3] - t.box_2d[1];
    const centerX = (t.box_2d[1] + t.box_2d[3]) / 2;
    // Spanning if: Very wide (>55%) OR centered and reasonably wide (>20%)
    return width > 550 || (width > 200 && Math.abs(centerX - COLUMN_BREAK) < 80);
  };
  
  const spanningCount = texts.filter(spanningHeuristic).length;
  const isMultiColumn = texts.length > 3 && leftCount >= 2 && rightCount >= 2 && (spanningCount / texts.length) < 0.6;

  if (isMultiColumn) {
    const elements = [...texts];
    const spanning = elements.filter(spanningHeuristic);
    const nonSpanning = elements.filter(e => !spanning.includes(e));
    
    const minY = Math.min(...nonSpanning.map(b => b.box_2d[0]));
    const maxY = Math.max(...nonSpanning.map(b => b.box_2d[2]));
    
    const topSpanning = spanning.filter(t => t.box_2d[0] < minY + 50).sort((a, b) => a.box_2d[0] - b.box_2d[0]);
    const bottomSpanning = spanning.filter(t => t.box_2d[0] >= maxY - 50 && !topSpanning.includes(t)).sort((a, b) => a.box_2d[0] - b.box_2d[0]);
    const middleSpanning = spanning.filter(t => !topSpanning.includes(t) && !bottomSpanning.includes(t)).sort((a, b) => a.box_2d[0] - b.box_2d[0]);
    
    const leftCol = nonSpanning.filter(t => (t.box_2d[1] + t.box_2d[3]) / 2 < COLUMN_BREAK).sort((a, b) => a.box_2d[0] - b.box_2d[0]);
    const rightCol = nonSpanning.filter(t => (t.box_2d[1] + t.box_2d[3]) / 2 >= COLUMN_BREAK).sort((a, b) => a.box_2d[0] - b.box_2d[0]);
    
    return [...topSpanning, ...leftCol, ...middleSpanning, ...rightCol, ...bottomSpanning];
  }

  // 2. Standard Row-First Layout for non-column pages
  const tiers: ComicText[][] = [];
  let currentTier: ComicText[] = [];
  
  for (const t of sortedByY) {
    if (currentTier.length === 0) {
      currentTier.push(t);
    } else {
      const first = currentTier[0];
      const yOverlap = Math.max(0, Math.min(first.box_2d[2], t.box_2d[2]) - Math.max(first.box_2d[0], t.box_2d[0]));
      const minH = Math.min(first.box_2d[2] - first.box_2d[0], t.box_2d[2] - t.box_2d[0]);
      if (yOverlap > 0.4 * minH || Math.abs(first.box_2d[0] - t.box_2d[0]) < 25) {
        currentTier.push(t);
      } else {
        tiers.push(currentTier);
        currentTier = [t];
      }
    }
  }
  if (currentTier.length > 0) tiers.push(currentTier);
  
  const finalSorted: ComicText[] = [];
  for (const tier of tiers) {
    tier.sort((a, b) => a.box_2d[1] - b.box_2d[1]);
    finalSorted.push(...tier);
  }
  return finalSorted;
};


import layoutsData from '../ebookcc_layouts.json';

interface LayoutSlot {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutTemplate {
  image_slots: LayoutSlot[];
  black_fills: LayoutSlot[];
}

interface LayoutsData {
  templates: Record<string, LayoutTemplate>;
}

const LAYOUTS = (layoutsData as LayoutsData).templates;

interface ImageItemProps {
  key?: React.Key;
  img: ManualImage;
  activePage: PageData;
  currentPageIndex: number;
  isSelected: boolean;
  setSelectedManualImageId: (id: string | null) => void;
  pages: PageData[];
  setPages: (pages: PageData[]) => void;
  viewMode: 'edit' | 'preview';
  pageRatio: number;
  setIsAddingTextMode: (val: boolean) => void;
}

const ImageItem = ({
  img,
  activePage,
  currentPageIndex,
  isSelected,
  setSelectedManualImageId,
  pages,
  setPages,
  viewMode,
  pageRatio,
  setIsAddingTextMode
}: ImageItemProps) => {
  const dragControls = useDragControls();
  const itemRef = React.useRef<HTMLDivElement>(null);
  const dragStartPos = React.useRef<{ y1: number; x1: number } | null>(null);
  const [isScaling, setIsScaling] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [scaleDir, setScaleDir] = useState<string | null>(null);
  const [isColorFolded, setIsColorFolded] = useState(true);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  React.useEffect(() => {
    if (!isSelected) {
      setIsCropping(false);
    }
  }, [isSelected]);

  const getBoxStyleLocal = (boxInput: any) => {
    const [y1, x1, y2, x2] = boxInput;
    return {
      top: `${(y1 / 1000) * 100}%`,
      left: `${(x1 / 1000) * 100}%`,
      width: `${((x2 - x1) / 1000) * 100}%`,
      height: `${((y2 - y1) / 1000) * 100}%`,
    };
  };

  const style = getBoxStyleLocal(img.box_2d);

  const updateImage = (updates: Partial<ManualImage>) => {
    const updatedPages = [...pages];
    const page = { ...updatedPages[currentPageIndex] };
    if (page.manualImages) {
      const idx = page.manualImages.findIndex(i => i.id === img.id);
      if (idx !== -1) {
        page.manualImages = [...page.manualImages];
        page.manualImages[idx] = { ...page.manualImages[idx], ...updates };
        updatedPages[currentPageIndex] = page;
        setPages(updatedPages);
      }
    }
  };

  const deleteItem = () => {
    const updatedPages = [...pages];
    const page = { ...updatedPages[currentPageIndex] };
    if (page.manualImages) {
      page.manualImages = page.manualImages.filter(i => i.id !== img.id);
      updatedPages[currentPageIndex] = page;
      setPages(updatedPages);
      setSelectedManualImageId(null);
    }
  };

  const moveLayer = (direction: 'up' | 'down') => {
    const updatedPages = [...pages];
    const page = { ...updatedPages[currentPageIndex] };
    if (page.manualImages) {
      const idx = page.manualImages.findIndex(i => i.id === img.id);
      if (idx !== -1) {
        const newManualImages = [...page.manualImages];
        if (direction === 'up' && idx < newManualImages.length - 1) {
          [newManualImages[idx], newManualImages[idx+1]] = [newManualImages[idx+1], newManualImages[idx]];
        } else if (direction === 'down' && idx > 0) {
          [newManualImages[idx], newManualImages[idx-1]] = [newManualImages[idx-1], newManualImages[idx]];
        }
        page.manualImages = newManualImages;
        updatedPages[currentPageIndex] = page;
        setPages(updatedPages);
      }
    }
  };

  useEffect(() => {
    if (!isSelected) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === 'Delete') {
        e.stopPropagation();
        deleteItem();
        return;
      }

      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'Escape' || e.key === 'Enter') {
        e.stopPropagation();
        setSelectedManualImageId(null);
      } else if (e.key.toLowerCase() === 'u') {
        e.stopPropagation();
        moveLayer('up');
      } else if (e.key.toLowerCase() === 'd') {
        e.stopPropagation();
        moveLayer('down');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSelected, img.id, currentPageIndex, pages]);

  const handleScaleStart = (e: React.MouseEvent | React.TouchEvent, dir: string) => {
    e.stopPropagation();
    setIsScaling(true);
    setScaleDir(dir);
  };

  useEffect(() => {
    if (!isScaling) return;

    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      
      const parent = itemRef.current?.parentElement;
      if (!parent) return;
      const parentRect = parent.getBoundingClientRect();
      
      const relativeX = ((clientX - parentRect.left) / parentRect.width) * 1000;
      const relativeY = ((clientY - parentRect.top) / parentRect.height) * 1000;
      
      if (isCropping) {
        // Cropping logic: modify box_2d AND crop proportionally
        const ratio = img.aspectRatio || 1;
        const [ymin, xmin, ymax, xmax] = img.box_2d;
        const currentCrop = img.crop || { ymin: 0, xmin: 0, ymax: 100, xmax: 100 };
        let newBox: [number, number, number, number] = [...img.box_2d];
        let newCrop = { ...currentCrop };

        const boxW = Math.max(0.1, xmax - xmin);
        const boxH = Math.max(0.1, ymax - ymin);
        const cropW = Math.max(0.1, currentCrop.xmax - currentCrop.xmin);
        const cropH = Math.max(0.1, currentCrop.ymax - currentCrop.ymin);
        
        if (scaleDir === 'se') {
          newBox[2] = Math.max(ymin + 5, Math.min(1000, relativeY));
          newBox[3] = Math.max(xmin + 5, Math.min(1000, relativeX));
          newCrop.ymax = currentCrop.ymin + cropH * ((newBox[2] - ymin) / boxH);
          newCrop.xmax = currentCrop.xmin + cropW * ((newBox[3] - xmin) / boxW);
        } else if (scaleDir === 'sw') {
          newBox[2] = Math.max(ymin + 5, Math.min(1000, relativeY));
          newBox[1] = Math.min(xmax - 5, Math.max(0, relativeX));
          newCrop.ymax = currentCrop.ymin + cropH * ((newBox[2] - ymin) / boxH);
          newCrop.xmin = currentCrop.xmax - cropW * ((xmax - newBox[1]) / boxW);
        } else if (scaleDir === 'ne') {
          newBox[0] = Math.min(ymax - 5, Math.max(0, relativeY));
          newBox[3] = Math.max(xmin + 5, Math.min(1000, relativeX));
          newCrop.ymin = currentCrop.ymax - cropH * ((ymax - newBox[0]) / boxH);
          newCrop.xmax = currentCrop.xmin + cropW * ((newBox[3] - xmin) / boxW);
        } else if (scaleDir === 'nw') {
          newBox[0] = Math.min(ymax - 5, Math.max(0, relativeY));
          newBox[1] = Math.min(xmax - 5, Math.max(0, relativeX));
          newCrop.ymin = currentCrop.ymax - cropH * ((ymax - newBox[0]) / boxH);
          newCrop.xmin = currentCrop.xmax - cropW * ((xmax - newBox[1]) / boxW);
        }
        
        // Clamp crop [0, 100] logic if they drag outside the original image
        if (newCrop.xmin < 0) {
          newCrop.xmin = 0;
          newBox[1] = xmax - currentCrop.xmax * (boxW / cropW);
        }
        if (newCrop.xmax > 100) {
          newCrop.xmax = 100;
          newBox[3] = xmin + (100 - currentCrop.xmin) * (boxW / cropW);
        }
        if (newCrop.ymin < 0) {
          newCrop.ymin = 0;
          newBox[0] = ymax - currentCrop.ymax * (boxH / cropH);
        }
        if (newCrop.ymax > 100) {
          newCrop.ymax = 100;
          newBox[2] = ymin + (100 - currentCrop.ymin) * (boxH / cropH);
        }

        updateImage({ box_2d: newBox, crop: newCrop });
      } else {
        // Scaling logic: update img.box_2d (maintain aspect ratio)
        const [ymin, xmin, ymax, xmax] = img.box_2d;
        let newBox: [number, number, number, number] = [...img.box_2d];
        
        let currentAR = img.aspectRatio || 1;
        if (img.crop) {
          const cropW = img.crop.xmax - img.crop.xmin;
          const cropH = img.crop.ymax - img.crop.ymin;
          if (cropH > 0) {
            currentAR = (cropW / cropH) * currentAR;
          }
        }
        const ratio = currentAR * pageRatio;
        
        if (scaleDir === 'se') {
          const newH = Math.max(20, relativeY - ymin);
          const newW = newH * ratio;
          newBox[2] = ymin + newH;
          newBox[3] = xmin + newW;
          if (newBox[3] > 1000) { newBox[3] = 1000; newBox[2] = ymin + (1000 - xmin) / ratio; }
          if (newBox[2] > 1000) { newBox[2] = 1000; newBox[3] = xmin + (1000 - ymin) * ratio; }
        } else if (scaleDir === 'sw') {
          const newH = Math.max(20, relativeY - ymin);
          const newW = newH * ratio;
          newBox[2] = ymin + newH;
          newBox[1] = xmax - newW;
          if (newBox[1] < 0) { newBox[1] = 0; newBox[2] = ymin + xmax / ratio; }
          if (newBox[2] > 1000) { newBox[2] = 1000; newBox[1] = xmax - (1000 - ymin) * ratio; }
        } else if (scaleDir === 'ne') {
          const newH = Math.max(20, ymax - relativeY);
          const newW = newH * ratio;
          newBox[0] = ymax - newH;
          newBox[3] = xmin + newW;
          if (newBox[3] > 1000) { newBox[3] = 1000; newBox[0] = ymax - (1000 - xmin) / ratio; }
          if (newBox[0] < 0) { newBox[0] = 0; newBox[3] = xmin + ymax * ratio; }
        } else if (scaleDir === 'nw') {
          const newH = Math.max(20, ymax - relativeY);
          const newW = newH * ratio;
          newBox[0] = ymax - newH;
          newBox[1] = xmax - newW;
          if (newBox[1] < 0) { newBox[1] = 0; newBox[0] = ymax - xmax / ratio; }
          if (newBox[0] < 0) { newBox[0] = 0; newBox[1] = xmax - ymax * ratio; }
        }
        updateImage({ box_2d: newBox });
      }
    };

    const handleMouseUp = () => {
      setIsScaling(false);
      setScaleDir(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleMouseMove);
    window.addEventListener('touchend', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isScaling, scaleDir, img.box_2d, currentPageIndex, isCropping, pageRatio, img.aspectRatio]);

  return (
    <motion.div
      ref={itemRef}
      style={{
        ...style,
        x,
        y,
        zIndex: isSelected ? 40 : 25,
      }}
      drag={isSelected && !isScaling}
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0}
      onDragStart={() => {
        dragStartPos.current = { y1: img.box_2d[0], x1: img.box_2d[1] };
      }}
      onDragEnd={(event, info) => {
        if (!dragStartPos.current) return;
        const parent = itemRef.current?.parentElement;
        if (!parent) return;
        const width = parent.offsetWidth;
        const height = parent.offsetHeight;
        if (width === 0 || height === 0) return;

        const dx = (info.offset.x / width) * 1000;
        const dy = (info.offset.y / height) * 1000;
        
        const [y1, x1, y2, x2] = img.box_2d;
        const h = y2 - y1;
        const w = x2 - x1;
        
        const newY1 = Math.round(Math.max(0, Math.min(1000 - h, dragStartPos.current.y1 + dy)));
        const newX1 = Math.round(Math.max(0, Math.min(1000 - w, dragStartPos.current.x1 + dx)));
        
        updateImage({
          box_2d: [newY1, newX1, newY1 + h, newX1 + w]
        });
        x.set(0);
        y.set(0);
        dragStartPos.current = null;
      }}
      className={cn(
        "absolute group cursor-pointer pointer-events-auto"
      )}
      onClick={(e) => {
        e.stopPropagation();
        setIsAddingTextMode(false);
        setSelectedManualImageId(img.id);
      }}
    >
      <div className={cn(
        "w-full h-full relative",
        isSelected && !isCropping && "outline outline-2 outline-black",
        isSelected && isCropping && "outline outline-2 outline-black"
      )}>
        {isSelected && isCropping && (
          <img 
            src={img.url} 
            className={cn("w-full h-full object-cover pointer-events-none opacity-50", img.isHighContrast && "contrast-150 saturate-0")}
            alt="Original Overlay" 
            style={img.crop ? {
              position: 'absolute',
              width: `${10000 / Math.max(0.1, img.crop.xmax - img.crop.xmin)}%`,
              height: `${10000 / Math.max(0.1, img.crop.ymax - img.crop.ymin)}%`,
              left: `-${img.crop.xmin * 100 / Math.max(0.1, img.crop.xmax - img.crop.xmin)}%`,
              top: `-${img.crop.ymin * 100 / Math.max(0.1, img.crop.ymax - img.crop.ymin)}%`,
              maxWidth: 'none',
              objectFit: 'fill'
            } : {
              position: 'absolute',
              width: '100%',
              height: '100%',
              left: 0,
              top: 0
            }}
          />
        )}
        <div 
          className={cn(
            "w-full h-full relative overflow-hidden",
            img.isHighContrast && "contrast-[1.25] grayscale"
          )}
          style={img.hasOutline ? { border: `2px solid ${img.color || '#000000'}`, boxSizing: 'border-box' } : undefined}
        >
          <img 
            src={img.url} 
            className="w-full h-full object-fill pointer-events-none" 
            alt="Inserted" 
            style={img.crop ? {
              position: 'absolute',
              width: `${10000 / Math.max(0.1, img.crop.xmax - img.crop.xmin)}%`,
              height: `${10000 / Math.max(0.1, img.crop.ymax - img.crop.ymin)}%`,
              left: `-${img.crop.xmin * 100 / Math.max(0.1, img.crop.xmax - img.crop.xmin)}%`,
              top: `-${img.crop.ymin * 100 / Math.max(0.1, img.crop.ymax - img.crop.ymin)}%`,
              maxWidth: 'none',
              objectFit: 'fill'
            } : undefined}
          />
        </div>
        
        {isSelected && (
          <>
            {/* Scale/Crop Handles */}
            {!isCropping && (
              <>
                <div 
                  onMouseDown={(e) => handleScaleStart(e, 'nw')}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute top-0 left-0 w-8 h-8 z-50 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center cursor-nw-resize pointer-events-auto"
                >
                  <div className="w-3 h-3 border border-white rounded-full bg-black shadow-sm" />
                </div>
                <div 
                  onMouseDown={(e) => handleScaleStart(e, 'ne')}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute top-0 right-0 w-8 h-8 z-50 translate-x-1/2 -translate-y-1/2 flex items-center justify-center cursor-ne-resize pointer-events-auto"
                >
                  <div className="w-3 h-3 border border-white rounded-full bg-black shadow-sm" />
                </div>
                <div 
                  onMouseDown={(e) => handleScaleStart(e, 'sw')}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute bottom-0 left-0 w-8 h-8 z-50 -translate-x-1/2 translate-y-1/2 flex items-center justify-center cursor-sw-resize pointer-events-auto"
                >
                  <div className="w-3 h-3 border border-white rounded-full bg-black shadow-sm" />
                </div>
                <div 
                  onMouseDown={(e) => handleScaleStart(e, 'se')}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute bottom-0 right-0 w-8 h-8 z-50 translate-x-1/2 translate-y-1/2 flex items-center justify-center cursor-se-resize pointer-events-auto"
                >
                  <div className="w-3 h-3 border border-white rounded-full bg-black shadow-sm" />
                </div>
              </>
            )}

            {/* Crop Corner Handles (L-brackets like standard cropping tools) */}
            {isCropping && (
              <>
                {/* NW */}
                <div 
                  onMouseDown={(e) => handleScaleStart(e, 'nw')}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute top-0 left-0 w-8 h-8 z-50 -translate-x-[2px] -translate-y-[2px] cursor-nw-resize pointer-events-auto"
                >
                  <div className="absolute top-0 left-0 w-6 h-[4px] bg-black" />
                  <div className="absolute top-0 left-0 w-[4px] h-6 bg-black" />
                </div>
                {/* NE */}
                <div 
                  onMouseDown={(e) => handleScaleStart(e, 'ne')}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute top-0 right-0 w-8 h-8 z-50 translate-x-[2px] -translate-y-[2px] cursor-ne-resize pointer-events-auto"
                >
                  <div className="absolute top-0 right-0 w-6 h-[4px] bg-black" />
                  <div className="absolute top-0 right-0 w-[4px] h-6 bg-black" />
                </div>
                {/* SW */}
                <div 
                  onMouseDown={(e) => handleScaleStart(e, 'sw')}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute bottom-0 left-0 w-8 h-8 z-50 -translate-x-[2px] translate-y-[2px] cursor-sw-resize pointer-events-auto"
                >
                  <div className="absolute bottom-0 left-0 w-6 h-[4px] bg-black" />
                  <div className="absolute bottom-0 left-0 w-[4px] h-6 bg-black" />
                </div>
                {/* SE */}
                <div 
                  onMouseDown={(e) => handleScaleStart(e, 'se')}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute bottom-0 right-0 w-8 h-8 z-50 translate-x-[2px] translate-y-[2px] cursor-se-resize pointer-events-auto"
                >
                  <div className="absolute bottom-0 right-0 w-6 h-[4px] bg-black" />
                  <div className="absolute bottom-0 right-0 w-[4px] h-6 bg-black" />
                </div>
              </>
            )}

            {/* Content Toolbar */}
            <div 
              className="absolute -top-14 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white border border-gray-200 text-slate-800 shadow-md p-1.5 rounded-lg z-50 pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="relative flex items-center">
                <Button size="icon" variant="ghost" className={cn("h-9 w-9 hover:bg-slate-100", !isColorFolded ? "text-blue-600 bg-slate-100" : "text-slate-700")} onClick={() => setIsColorFolded(!isColorFolded)} title="Colors">
                  <Palette className="h-4 w-4" />
                </Button>
                
                <AnimatePresence>
                  {!isColorFolded && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute bottom-full left-0 mb-3 p-1.5 bg-background border border-border shadow-lg rounded-lg flex flex-row gap-1.5 items-center z-[110]"
                    >
                      <div className="flex flex-row gap-1.5">
                        {['#000000', '#ffffff', '#ef4444', '#22c55e', '#3b82f6'].map(c => (
                          <button
                            key={c}
                            className={cn(
                              "w-5 h-5 rounded-full border shadow-sm transition-transform hover:scale-110",
                              img.color === c ? "ring-2 ring-blue-600 ring-offset-1" : ""
                            )}
                            style={{ backgroundColor: c }}
                            onClick={(e) => {
                              e.stopPropagation();
                              updateImage({ color: c, hasOutline: true });
                              setIsColorFolded(true);
                            }}
                            title={c}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="w-px h-5 bg-gray-200 mx-1" />

              <Button size="icon" variant="ghost" className="h-9 w-9 text-slate-700 hover:bg-slate-100 hover:text-slate-900" onClick={() => updateImage({ isHighContrast: !img.isHighContrast })} title="High Contrast">
                <Contrast className={cn("h-4 w-4", img.isHighContrast && "text-blue-600")} />
              </Button>
              <Button size="icon" variant="ghost" className="h-9 w-9 text-slate-700 hover:bg-slate-100 hover:text-slate-900" onClick={() => updateImage({ hasOutline: !img.hasOutline })} title="Outline">
                <Square className={cn("h-4 w-4", img.hasOutline && "text-blue-600")} />
              </Button>
              <Button size="icon" variant="ghost" className="h-9 w-9 text-slate-700 hover:bg-slate-100 hover:text-slate-900" onClick={() => moveLayer('up')} title="Layer Up (U)">
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-9 w-9 text-slate-700 hover:bg-slate-100 hover:text-slate-900" onClick={() => moveLayer('down')} title="Layer Down (D)">
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className={cn("h-9 w-9", isCropping ? "bg-slate-200 text-slate-900 hover:bg-slate-300" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900")} onClick={() => setIsCropping(!isCropping)} title="Crop">
                <Crop className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-9 w-9 text-slate-700 hover:bg-slate-100 hover:text-slate-900" onPointerDown={(e) => { e.stopPropagation(); dragControls.start(e); }} title="Move">
                <Move className="h-4 w-4" />
              </Button>
              <div className="w-px h-5 bg-gray-200 mx-1" />
              <Button size="icon" variant="ghost" className="h-9 w-9 text-red-500 hover:bg-red-50 hover:text-red-600" onClick={deleteItem} title="Delete">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
};

interface ManualTextItemProps {
  key?: React.Key;
  mt: ManualText;
  activePage: PageData;
  currentPageIndex: number;
  isSelected: boolean;
  viewMode: string;
  setSelectedManualTextId: (id: string | null) => void;
  setSelectedManualImageId: (id: string | null) => void;
  setOriginalTextBeforeEdit: (text: string) => void;
  originalTextBeforeEdit: string;
  pages: PageData[];
  setPages: (pages: PageData[]) => void;
  manualTextRef: React.RefObject<HTMLDivElement>;
  setIsAddingTextMode: (val: boolean) => void;
}

const ManualTextItem = ({
  mt,
  activePage,
  currentPageIndex,
  isSelected,
  viewMode,
  setSelectedManualTextId,
  setSelectedManualImageId,
  setOriginalTextBeforeEdit,
  originalTextBeforeEdit,
  pages,
  setPages,
  manualTextRef,
  setIsAddingTextMode
}: ManualTextItemProps) => {
  const [isColorFolded, setIsColorFolded] = useState(true);
  const dragControls = useDragControls();
  const itemRef = React.useRef<HTMLDivElement>(null);
  const dragStartPos = React.useRef<{ y1: number; x1: number } | null>(null);
  
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const getBoxStyleLocal = (boxInput: any) => {
    const [y1, x1, y2, x2] = boxInput;
    return {
      top: `${(y1 / 1000) * 100}%`,
      left: `${(x1 / 1000) * 100}%`,
      width: `${((x2 - x1) / 1000) * 100}%`,
      height: `${((y2 - y1) / 1000) * 100}%`,
    };
  };

  const style = getBoxStyleLocal(mt.box_2d);

  const deleteItem = () => {
    const updatedPages = [...pages];
    const page = { ...updatedPages[currentPageIndex] };
    if (page.manualTexts) {
      page.manualTexts = page.manualTexts.filter(m => m.id !== mt.id);
      updatedPages[currentPageIndex] = page;
      setPages(updatedPages);
      setSelectedManualTextId(null);
    }
  };

  useEffect(() => {
    if (!isSelected) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === 'Delete') {
        e.stopPropagation();
        deleteItem();
        return;
      }

      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
        e.stopPropagation();
        setSelectedManualTextId(null);
      } else if (e.key.toLowerCase() === 'u') {
        e.stopPropagation();
        const updatedPages = [...pages];
        const p = updatedPages[currentPageIndex];
        if (p.manualTexts) {
          const idx = p.manualTexts.findIndex(m => m.id === mt.id);
          if (idx !== -1 && idx < p.manualTexts.length - 1) {
            const newManualTexts = [...p.manualTexts];
            [newManualTexts[idx], newManualTexts[idx+1]] = [newManualTexts[idx+1], newManualTexts[idx]];
            p.manualTexts = newManualTexts;
            setPages(updatedPages);
          }
        }
      } else if (e.key.toLowerCase() === 'd') {
        e.stopPropagation();
        const updatedPages = [...pages];
        const p = updatedPages[currentPageIndex];
        if (p.manualTexts) {
          const idx = p.manualTexts.findIndex(m => m.id === mt.id);
          if (idx !== -1 && idx > 0) {
            const newManualTexts = [...p.manualTexts];
            [newManualTexts[idx], newManualTexts[idx-1]] = [newManualTexts[idx-1], newManualTexts[idx]];
            p.manualTexts = newManualTexts;
            setPages(updatedPages);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSelected, mt.id, currentPageIndex, pages, setPages, setSelectedManualTextId]);

  return (
    <motion.div
      ref={itemRef}
      initial={false}
      style={{
        ...style,
        x,
        y,
        border: isSelected ? '2px solid #000000' : 'none',
        zIndex: isSelected ? 30 : 20,
        backgroundColor: 'transparent',
        borderRadius: '4px',
        height: 'auto',
        minHeight: style.height
      }}
      drag={isSelected}
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0}
      onDragStart={() => {
        dragStartPos.current = { y1: mt.box_2d[0], x1: mt.box_2d[1] };
      }}
      onDragEnd={(event, info) => {
        if (!dragStartPos.current) return;
        
        const parent = itemRef.current?.parentElement;
        if (!parent) return;
        
        const width = parent.offsetWidth;
        const height = parent.offsetHeight;
        
        if (width === 0 || height === 0) return;

        const dx = (info.offset.x / width) * 1000;
        const dy = (info.offset.y / height) * 1000;
        
        const updatedPages = [...pages];
        const pageIndex = currentPageIndex;
        const page = { ...updatedPages[pageIndex] };
        
        if (page.manualTexts) {
          const manualTexts = [...page.manualTexts];
          const idx = manualTexts.findIndex(m => m.id === mt.id);
          if (idx !== -1) {
            const currentBox = manualTexts[idx].box_2d;
            const h = currentBox[2] - currentBox[0];
            const w = currentBox[3] - currentBox[1];
            
            const newY1 = Math.round(Math.max(0, Math.min(1000 - h, dragStartPos.current.y1 + dy)));
            const newX1 = Math.round(Math.max(0, Math.min(1000 - w, dragStartPos.current.x1 + dx)));
            
            manualTexts[idx] = {
              ...manualTexts[idx],
              box_2d: [newY1, newX1, newY1 + h, newX1 + w]
            };
            page.manualTexts = manualTexts;
            updatedPages[pageIndex] = page;
            
            // Critical: Reset motion values BEFORE updating state
            x.set(0);
            y.set(0);
            setPages(updatedPages);
          }
        }
        dragStartPos.current = null;
      }}
      className={cn(
        "absolute flex items-center justify-center cursor-pointer pointer-events-auto",
        !isSelected && "transition-all duration-300"
      )}
      whileDrag={{ 
        zIndex: 100
      }}
      onClick={(e) => {
        e.stopPropagation();
        setIsAddingTextMode(false);
        if (!isSelected) {
          setSelectedManualTextId(mt.id);
          setOriginalTextBeforeEdit(mt.text);
          setSelectedManualImageId(null);
        }
      }}
    >
      <div 
        ref={isSelected ? manualTextRef : null}
        className="w-full h-full flex items-center justify-center p-2 outline-none min-w-[50px] min-h-[1em]"
        contentEditable={isSelected}
        suppressContentEditableWarning
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            (e.currentTarget as HTMLElement).blur();
            setSelectedManualTextId(null);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            // Revert text
            e.currentTarget.innerText = originalTextBeforeEdit;
            (e.currentTarget as HTMLElement).blur();
            setSelectedManualTextId(null);
          }
        }}
        onBlur={(e) => {
          const newText = e.currentTarget.innerText || "";
          const updatedPages = [...pages];
          const p = updatedPages[currentPageIndex];
          if (p.manualTexts) {
            const idx = p.manualTexts.findIndex(m => m.id === mt.id);
            if (idx !== -1) {
              p.manualTexts[idx].text = newText;
              setPages(updatedPages);
            }
          }
        }}
        style={{
          color: mt.color,
          fontSize: `calc(var(--cw, ${activePage.width}px) * ${(mt.fontSize / activePage.width)})`,
          fontFamily: "Helvetica, Arial, sans-serif",
          textAlign: 'center',
          wordBreak: 'break-word',
          lineHeight: 1.2,
          whiteSpace: 'pre-wrap'
        }}
      >
        {mt.text}
      </div>
      
      {/* Floating Toolbar for Manual Text */}
      {isSelected && (
        <div 
          className="absolute -top-16 left-1/2 -translate-x-1/2 flex items-center gap-0.5 bg-background text-foreground border border-border shadow-md rounded-xl p-0.5 z-[100] animate-in fade-in zoom-in slide-in-from-bottom-2 duration-200 pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-0.5 px-1 border-r border-border h-9">
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                className={cn("w-7 h-7 hover:bg-muted shrink-0", !isColorFolded && "text-primary")}
                onClick={() => setIsColorFolded(!isColorFolded)}
                title={isColorFolded ? "Show Colors" : "Hide Colors"}
              >
                <Palette className="w-4 h-4" />
              </Button>
              
              <AnimatePresence>
                {!isColorFolded && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute bottom-full left-0 mb-3 p-1.5 bg-background border border-border shadow-lg rounded-lg flex flex-row gap-1.5 items-center z-[110]"
                  >
                    <div className="flex flex-row gap-1.5">
                      {['#000000', '#ffffff', '#ef4444', '#22c55e', '#3b82f6'].map(c => (
                        <button
                          key={c}
                          className={cn(
                            "w-5 h-5 rounded-full border shadow-sm transition-transform hover:scale-110",
                            mt.color === c ? "ring-2 ring-primary ring-offset-1" : ""
                          )}
                          style={{ backgroundColor: c }}
                          onClick={() => {
                            const updatedPages = [...pages];
                            const p = updatedPages[currentPageIndex];
                            if (p.manualTexts) {
                              const idx = p.manualTexts.findIndex(m => m.id === mt.id);
                              if (idx !== -1) {
                                p.manualTexts[idx].color = c;
                                setPages(updatedPages);
                              }
                            }
                          }}
                        />
                      ))}
                    </div>
                    <div className="h-6 w-px bg-border flex-shrink-0" />
                    <div className="relative w-6 h-6 rounded-full border overflow-hidden shadow-inner">
                      <input 
                        type="color" 
                        value={mt.color}
                        onChange={(e) => {
                          const updatedPages = [...pages];
                          const p = updatedPages[currentPageIndex];
                          if (p.manualTexts) {
                            const idx = p.manualTexts.findIndex(m => m.id === mt.id);
                            if (idx !== -1) {
                              p.manualTexts[idx].color = e.target.value;
                              setPages(updatedPages);
                            }
                          }
                        }}
                        className="absolute inset-[-50%] w-[200%] h-[200%] cursor-pointer border-none p-0 bg-transparent"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          
          <div className="flex items-center gap-1 px-1 border-r border-border h-9">
            <Select 
              value={mt.fontSize.toString()}
              onValueChange={(val) => {
                const updatedPages = [...pages];
                const p = updatedPages[currentPageIndex];
                if (p.manualTexts) {
                  const idx = p.manualTexts.findIndex(m => m.id === mt.id);
                  if (idx !== -1) {
                    p.manualTexts[idx].fontSize = parseInt(val);
                    setPages(updatedPages);
                  }
                }
              }}
            >
              <SelectTrigger className="w-14 h-8 text-xs font-bold bg-background text-foreground border-border px-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background text-foreground">
                {[12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 64, 72, 84, 96, 120, 144, 200, 256].map(size => (
                  <SelectItem key={size} value={size.toString()} className="text-xs">{size}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => {
                const updatedPages = [...pages];
                const p = updatedPages[currentPageIndex];
                if (p.manualTexts) {
                  const idx = p.manualTexts.findIndex(m => m.id === mt.id);
                  if (idx !== -1 && idx < p.manualTexts.length - 1) {
                    const newManualTexts = [...p.manualTexts];
                    [newManualTexts[idx], newManualTexts[idx+1]] = [newManualTexts[idx+1], newManualTexts[idx]];
                    p.manualTexts = newManualTexts;
                    setPages(updatedPages);
                  }
                }
              }}
              title="Layer Up (U)"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => {
                const updatedPages = [...pages];
                const p = updatedPages[currentPageIndex];
                if (p.manualTexts) {
                  const idx = p.manualTexts.findIndex(m => m.id === mt.id);
                  if (idx !== -1 && idx > 0) {
                    const newManualTexts = [...p.manualTexts];
                    [newManualTexts[idx], newManualTexts[idx-1]] = [newManualTexts[idx-1], newManualTexts[idx]];
                    p.manualTexts = newManualTexts;
                    setPages(updatedPages);
                  }
                }
              }}
              title="Layer Down (D)"
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onPointerDown={(e) => { e.stopPropagation(); dragControls.start(e); }}
              title="Move"
            >
              <Move className="h-4 w-4" />
            </Button>
            <div className="w-px h-5 bg-border mx-0.5" />
            <Button 
              size="icon" 
              variant="ghost" 
              className="h-8 w-8 text-destructive hover:bg-destructive/10" 
              onClick={(e) => {
                e.stopPropagation();
                const updatedPages = [...pages];
                const p = updatedPages[currentPageIndex];
                if (p.manualTexts) {
                  p.manualTexts = p.manualTexts.filter(m => m.id !== mt.id);
                  setPages(updatedPages);
                  setSelectedManualTextId(null);
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
};

const RetroProgressBar = ({ progress }: { progress: number }) => (
  <div className="flex items-center gap-3 w-full max-w-[400px] font-serif text-primary">
    <span className="text-2xl italic min-w-[55px] text-right drop-shadow-sm">{progress}%</span>
    <div className="flex-1 h-8 border border-primary p-1 bg-background shadow-[2px_2px_0px_hsl(var(--primary))]">
      <div 
        className="h-full bg-primary transition-all duration-500 ease-out" 
        style={{ width: `${progress}%` }} 
      />
    </div>
  </div>
);

// Helper to safely encode UTF-8 string to base64
function b64EncodeUnicode(str: string) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function(match, p1) {
    return String.fromCharCode(parseInt(p1, 16));
  }));
}

export default function ComicEditor() {
  const [pages, setPages] = useState<PageData[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [showCollageModal, setShowCollageModal] = useState(false);
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const [isRandomMode, setIsRandomMode] = useState(false);
  const [collageStep, setCollageStep] = useState<'template' | 'settings'>('template');
  const [collageOutline, setCollageOutline] = useState<boolean>(false);
  const [collageHighContrast, setCollageHighContrast] = useState<boolean>(false);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [tempText, setTempText] = useState("");
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
  const [isAddingTextMode, setIsAddingTextMode] = useState(false);
  const [pageInputValue, setPageInputValue] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const [isPortrait, setIsPortrait] = useState(false);

  // Default fold on portrait screen
  useEffect(() => {
    const handleResize = () => {
      const portrait = window.innerHeight > window.innerWidth;
      setIsPortrait(portrait);
      if (portrait) {
        setIsSidebarOpen(false);
      } else {
        setIsSidebarOpen(true);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAddingTextMode(false);
        setSelectedManualTextId(null);
        setSelectedManualImageId(null);
        setEditingIndex(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
  const [isGridView, setIsGridView] = useState(false);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [selectedManualTextId, setSelectedManualTextId] = useState<string | null>(null);
  const [selectedManualImageId, setSelectedManualImageId] = useState<string | null>(null);
  const [originalTextBeforeEdit, setOriginalTextBeforeEdit] = useState<string>("");
  const manualTextRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedManualTextId && manualTextRef.current) {
      manualTextRef.current.focus();
      // Move cursor to end
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(manualTextRef.current);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [selectedManualTextId]);

  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [showCoffeeModal, setShowCoffeeModal] = useState(false);
  const [showGithubModal, setShowGithubModal] = useState(false);
  const [githubToken, setGithubToken] = useState(() => localStorage.getItem('github_token') || "");
  const [githubRepo, setGithubRepo] = useState(() => localStorage.getItem('github_username_repo') || "");
  const [githubPath, setGithubPath] = useState(() => localStorage.getItem('github_file_path') || "README.md");
  const [githubBranch, setGithubBranch] = useState(() => localStorage.getItem('github_branch') || "main");
  const [githubCommitMsg, setGithubCommitMsg] = useState("Sync transcribed comic to README.md via EbookCC");
  const [isSyncingGithub, setIsSyncingGithub] = useState(false);

  const generateMarkdown = () => {
    const exportPages = getExportablePages();
    let md = `# EbookCC Comic Transcription & Translation\n\n`;
    md += `Detected and translated using **[EbookCC](https://ai.studio/build)** on ${new Date().toLocaleDateString()}.\n\n`;
    md += `## Comic Book Summary\n`;
    md += `- **Total Pages**: ${exportPages.length}\n`;
    md += `- **Generated At**: ${new Date().toUTCString()}\n\n`;
    md += `---\n\n`;

    for (let i = 0; i < exportPages.length; i++) {
      const page = exportPages[i];
      const allTexts = [...(page.detectedTexts || []), ...(page.manualTexts || [])];
      
      md += `## Page ${i + 1}\n\n`;
      if (page.filename) {
        md += `*Filename: \`${page.filename}\`*\n\n`;
      }
      
      if (allTexts.length > 0) {
        md += `> [!NOTE]\n`;
        md += `> Transcribed & Translated Dialogue:\n\n`;
        
        const sortedTexts = sortTextsReadingOrder(allTexts);
        sortedTexts.forEach((textObj, idx) => {
          md += `${idx + 1}. **${textObj.text.replace(/\n/g, ' ')}**\n`;
        });
        md += `\n`;
      } else {
        md += `*No text transcribed on this page.*\n\n`;
      }
      md += `---\n\n`;
    }
    
    md += `*Transcribed and formatted with zero-latency OCR & LLM processing using EbookCC.*`;
    return md;
  };

  const handleSyncToGithub = async () => {
    if (!githubToken.trim()) {
      toast.error("GitHub Personal Access Token is required.");
      return;
    }
    if (!githubRepo.trim() || !githubRepo.includes('/')) {
      toast.error("Please enter repository in owner/repo format (e.g. username/repo).");
      return;
    }
    if (!githubPath.trim()) {
      toast.error("File path is required.");
      return;
    }

    setIsSyncingGithub(true);
    const toastId = toast.loading("Connecting to GitHub and checking repository...");

    try {
      const parts = githubRepo.split('/');
      const owner = parts[0].trim();
      const repo = parts[1].trim();
      const cleanPath = githubPath.trim().replace(/^\//, ''); // strip leading slash
      const branchName = githubBranch.trim() || "main";

      // Save user configuration
      localStorage.setItem('github_token', githubToken.trim());
      localStorage.setItem('github_username_repo', githubRepo.trim());
      localStorage.setItem('github_file_path', cleanPath);
      localStorage.setItem('github_branch', branchName);

      const markdownContent = generateMarkdown();

      // Encode content strictly to base64 UTF-8
      const encodedContent = b64EncodeUnicode(markdownContent);

      const headers: Record<string, string> = {
        "Authorization": `token ${githubToken.trim()}`,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      };

      // Step 1: Check if file already exists so we can get its SHA hash
      const checkUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(cleanPath)}?ref=${encodeURIComponent(branchName)}`;
      let currentSha: string | undefined = undefined;

      try {
        const getRes = await fetch(checkUrl, { headers });
        if (getRes.ok) {
          const fileData = await getRes.json();
          currentSha = fileData.sha;
          console.log("[GitHub Sync] Existing file found. SHA:", currentSha);
        } else if (getRes.status === 404) {
          console.log("[GitHub Sync] Creating new file (no existing file found)");
        } else {
          const errorMsg = await getRes.text();
          throw new Error(`GitHub check error (${getRes.status}): ${errorMsg || getRes.statusText}`);
        }
      } catch (getErr: any) {
        if (getErr.message?.includes("check error")) {
          throw getErr;
        }
        console.warn("[GitHub Sync] Non-blocking check warning:", getErr);
      }

      // Step 2: Push/Update file
      const updateUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(cleanPath)}`;
      const putRes = await fetch(updateUrl, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          message: githubCommitMsg.trim() || `Sync transcribed comic to ${cleanPath} via EbookCC`,
          content: encodedContent,
          sha: currentSha,
          branch: branchName
        })
      });

      if (!putRes.ok) {
        const errorText = await putRes.text();
        throw new Error(`GitHub upload failed (${putRes.status}): ${errorText || putRes.statusText}`);
      }

      const uploadData = await putRes.json();
      const htmlUrl = uploadData?.content?.html_url || `https://github.com/${owner}/${repo}/blob/${branchName}/${cleanPath}`;

      toast.success("Successfully synchronized to GitHub!", {
        id: toastId,
        description: `Your ${cleanPath} is now live!`,
        action: {
          label: "View Commit",
          onClick: () => window.open(htmlUrl, "_blank")
        }
      });
      setShowGithubModal(false);
      setShowCoffeeModal(true);
    } catch (err: any) {
      console.error("[GitHub Sync Error]", err);
      let errMsg = err.message || "Unknown error";
      if (errMsg.includes("401") || errMsg.includes("Unauthorized")) {
        errMsg = "Unauthorized token. Please verify your Personal Access Token (PAT) permissions.";
      } else if (errMsg.includes("404")) {
        errMsg = "Repository or branch not found. Check repository string format (owner/repo) and branch spelling.";
      }
      toast.error(`GitHub Sync Failed: ${errMsg}`, { id: toastId, duration: 6000 });
    } finally {
      setIsSyncingGithub(false);
    }
  };
  const [customApiKey, setCustomApiKey] = useState(() => localStorage.getItem('gemini_api_key') || "");
  const [translateDuringBatch, setTranslateDuringBatch] = useState(false);
  const [ocrDuringBatch, setOcrDuringBatch] = useState(false);
  const [splitDuringBatch, setSplitDuringBatch] = useState(false);
  const [batchTargetLanguage, setBatchTargetLanguage] = useState("English");

  const [llmEngine, setLlmEngine] = useState<'gemini' | 'local'>(() => (localStorage.getItem('llm_engine') || 'gemini') as 'gemini' | 'local');
  const [localLlmUrl, setLocalLlmUrl] = useState(() => localStorage.getItem('local_llm_url') || "http://localhost:11434/v1");
  const [localLlmModel, setLocalLlmModel] = useState(() => localStorage.getItem('local_llm_model') || "llama3");
  const [localLlmApiKey, setLocalLlmApiKey] = useState(() => localStorage.getItem('local_llm_api_key') || "");
  const [isTestingLocalLlm, setIsTestingLocalLlm] = useState(false);
  const [showLocalLlmGuide, setShowLocalLlmGuide] = useState(false);
  const [activeGuideTab, setActiveGuideTab] = useState<'comparison' | 'lmstudio' | 'ollama'>('comparison');

  const handleTestLocalLlm = async () => {
    setIsTestingLocalLlm(true);
    try {
      const cleanBaseUrl = localLlmUrl.endsWith('/') ? localLlmUrl.slice(0, -1) : localLlmUrl;
      const url = `${cleanBaseUrl}/chat/completions`;
      
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (localLlmApiKey) {
        headers["Authorization"] = `Bearer ${localLlmApiKey}`;
      }

      let res;
      try {
        const isHttpsPage = typeof window !== 'undefined' && window.location?.protocol === 'https:';
        const isHttpUrl = url.toLowerCase().startsWith('http://');
        // Loopback URLs (localhost/127.0.0.1) should NEVER go through the server-side proxy
        // because the browser allows direct HTTP fetch from HTTPS contexts to localhost (secure contexts),
        // whereas the cloud server proxy can never reach the user's local PC loopback.
        const isLoopback = url.toLowerCase().includes('//localhost') || url.toLowerCase().includes('//127.0.0.1') || url.toLowerCase().includes('//[::1]');

        if (isHttpsPage && isHttpUrl && !isLoopback) {
          console.log("[Local LLM Test] Redirecting to backend proxy to bypass HTTPS Mixed Content");
          res = await fetch("/api/local-llm-proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url,
              method: "POST",
              headers,
              body: {
                model: localLlmModel,
                messages: [
                  { role: "user", content: "Respond with the single word 'OK'." }
                ],
                max_tokens: 5,
                temperature: 0.1
              }
            })
          });
        } else {
          res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: localLlmModel,
              messages: [
                { role: "user", content: "Respond with the single word 'OK'." }
              ],
              max_tokens: 5,
              temperature: 0.1
            })
          });
        }
      } catch (fetchErr: any) {
        console.error("Local LLM test fetch error:", fetchErr);
        
        const isPrivateIp = url.includes("localhost") || url.includes("127.0.0.1") || /192\.168\./.test(url) || /10\./.test(url) || /172\.(1[6-9]|2[0-9]|3[0-1])\./.test(url);
        const isHttpsHost = typeof window !== 'undefined' && window.location?.protocol === 'https:';
        const isCloudHost = typeof window !== 'undefined' && !window.location?.hostname.includes("localhost") && !window.location?.hostname.includes("127.0.0.1");

        let customDiagnostics = `Could not fetch from local endpoint "${cleanBaseUrl}".\n\n`;

        if (isPrivateIp && isHttpsHost && isCloudHost) {
          customDiagnostics += 
            `💡 NETWORK BOUNDARY DETECTED:\n\n` +
            `You are currently running EbookCC on a secure cloud preview (${window.location.host}), but your LLM server is running inside your private local home network (${cleanBaseUrl}).\n\n` +
            `Public cloud servers in a GCP datacenter cannot connect to private IPs behind your NAT router!\n\n` +
            `To make this work immediately:\n` +
            `1. [RECOMMENDED] Download EbookCC and run it locally with "npm run dev". On http://localhost:3000, secure origin limits are removed and everything works perfectly!\n\n` +
            `2. Use an HTTPS Tunnel (like ngrok http 1234) on your terminal, then paste the resulting secure public https:// url here.\n\n` +
            `3. Set up a CORS-allowed public gateway.`;
        } else {
          customDiagnostics +=
            `Troubleshooting checklist:\n` +
            `1. Ensure your local AI is running (e.g. Ollama/LM Studio).\n` +
            `2. Is CORS enabled? For Ollama, launch in terminal with:\n` +
            `   OLLAMA_ORIGINS="*" ollama serve\n` +
            `3. Is the model name "${localLlmModel}" exact?\n` +
            `4. Mixed Content: Ensure your browser is not blocking requests from secure pages to http://localhost.`;
        }

        throw new Error(customDiagnostics);
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        let message = `Endpoint returned status ${res.status}. ${errText || res.statusText}`;
        
        const isPrivateIp = url.includes("localhost") || url.includes("127.0.0.1") || /192\.168\./.test(url) || /10\./.test(url) || /172\.(1[6-9]|2[0-9]|3[0-1])\./.test(url);
        const isCloudHost = typeof window !== 'undefined' && !window.location?.hostname.includes("localhost") && !window.location?.hostname.includes("127.0.0.1");
        
        if (isPrivateIp && isCloudHost && (res.status === 405 || res.status === 403 || res.status === 500 || errText.includes("ETIMEDOUT") || errText.includes("ENOTFOUND") || errText.includes("ECONNREFUSED") || errText.includes("Proxy failed"))) {
          message = 
            `💡 CLOUD TO LOCAL BOUNDARY CONSTRAINT DETECTED (Status ${res.status})\n\n` +
            `Because EbookCC is running on a secure cloud-hosted website, the server-side proxy cannot route to your private home network IP address "${cleanBaseUrl}".\n\n` +
            `Since your local AI (such as LM Studio or Ollama) is running on the SAME computer, please update your configuration:\n\n` +
            `👉 Change the base URL to:\n` +
            `"http://127.0.0.1:1234/v1" or "http://localhost:1234/v1" (for LM Studio)\n` +
            `"http://127.0.0.1:11434/v1" or "http://localhost:11434/v1" (for Ollama)\n\n` +
            `Loopback addresses (localhost/127.0.0.1) are treated as secure contexts by the browser. EbookCC will connect to them DIRECTLY from your browser, completely bypassing the cloud proxy and working instantly!`;
        }
        
        throw new Error(message);
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content?.trim() || "";
      if (text) {
        toast.success(`Success! Connected to model '${localLlmModel}'. Response: "${text}"`);
      } else {
        toast.warning("Connected but received empty response from LLM.");
      }
    } catch (err: any) {
      console.error(err);
      toast.error(`Local LLM Connection Failed: ${err.message || 'Check URL/model and ensure Ollama/server is running and CORS are allowed.'}`);
    } finally {
      setIsTestingLocalLlm(false);
    }
  };

  const needsPageProcessing = (p: PageData) => {
    if (p.isIgnored) return false;
    if (p.status === 'pending' || p.status === 'error') return true;
    if (ocrDuringBatch && !p.hasOcrRun) return true;
    if (splitDuringBatch && !p.hasLayoutRun) return true;
    if (translateDuringBatch && p.translatedLanguage !== batchTargetLanguage) return true;
    return false;
  };
  const [loadingText, setLoadingText] = useState("Uploading...");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [batchProgress, setBatchProgress] = useState(0);
  const [processedCount, setProcessedCount] = useState(() => parseInt(localStorage.getItem('gemini_processed_count') || '0', 10));
  const { theme, setTheme, resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === 'dark';

  const imageRef = useRef<HTMLImageElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const editorContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    if (node) {
      const observer = new ResizeObserver((entries) => {
        if (entries[0]) {
          node.style.setProperty('--cw', `${entries[0].contentRect.width}px`);
        }
      });
      observer.observe(node);
      resizeObserverRef.current = observer;
      node.style.setProperty('--cw', `${node.getBoundingClientRect().width}px`);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl + A shortcut (and Cmd + A for Mac)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        const activeElement = document.activeElement;
        const isInput = activeElement?.tagName === 'INPUT' || 
                        activeElement?.tagName === 'TEXTAREA' || 
                        (activeElement as HTMLElement)?.isContentEditable ||
                        activeElement?.hasAttribute('contenteditable');
        
        if (!isInput && pages.length > 0) {
          e.preventDefault();
          setSelectedPages(new Set(pages.map((_, i) => i)));
          setIsGridView(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pages.length]);

  const activePage = pages[currentPageIndex];

  const [activePagePanels, setActivePagePanels] = useState<ExportPanel[]>([]);
  const [isPanelsLoading, setIsPanelsLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (viewMode === 'preview' && activePage && !activePage.isTextOnly && splitDuringBatch) {
      setIsPanelsLoading(true);
      getPanelsForPage(activePage, activePage.originalImage, true, customApiKey)
        .then(res => {
          if (active) {
            setActivePagePanels(res);
            setIsPanelsLoading(false);
          }
        })
        .catch(err => {
          console.error("Error loading preview panels", err);
          if (active) {
            setActivePagePanels([]);
            setIsPanelsLoading(false);
          }
        });
    } else {
      setActivePagePanels([]);
      setIsPanelsLoading(false);
    }
    return () => {
      active = false;
    };
  }, [currentPageIndex, viewMode, activePage, splitDuringBatch, customApiKey]);

  useEffect(() => {
    setPageInputValue((currentPageIndex + 1).toString());
    
    // Auto-scroll sidebar to follow active page
    if (isSidebarOpen && !isGridView) {
      const activeThumb = document.getElementById(`thumb-${currentPageIndex}`);
      if (activeThumb) {
        activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [currentPageIndex, isSidebarOpen, isGridView]);

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
      } else if (e.key === 'Delete' || (e.key === 'Backspace' && isGridView)) {
        if (isGridView && selectedPages.size > 0) {
          setPages(prev => prev.filter((_, idx) => !selectedPages.has(idx)));
          setSelectedPages(new Set());
          setLastSelectedIndex(null);
          setCurrentPageIndex(0);
          setIsGridView(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pages.length, isGridView, selectedPages, currentPageIndex]);

  const processUploadedFiles = async (acceptedFiles: File[]) => {
    setIsUploading(true);
    setLoadingText("Initializing...");
    setUploadProgress(5);
    
    // Ensure UI has rendered the overlay
    await new Promise(resolve => setTimeout(resolve, 150));
    
    setLoadingText("Processing Files...");
    setUploadProgress(10);
    let newPages: PageData[] = [];
    const file = acceptedFiles[0];
    
    try {
      if (file.name.toLowerCase().endsWith('.zip') || file.name.toLowerCase().endsWith('.cbz')) {
        setLoadingText("Unzipping Archive...");
        setUploadProgress(15);
        const zip = await JSZip.loadAsync(file);
        setUploadProgress(25);
        setLoadingText("Extracting Images...");
        
        const imageFiles = Object.keys(zip.files)
          .filter(name => name.match(/\.(jpe?g|png|webp)$/i))
          .sort((a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}));
          
        setUploadProgress(30);
        for (let j = 0; j < imageFiles.length; j++) {
          const name = imageFiles[j];
          if (zip.files[name].dir) continue;
          
          const blob = await zip.files[name].async("blob");
          const url = URL.createObjectURL(blob);
          const dims = await getImageDimensions(url);
          const processed = await rotateImageIfNeeded(url, dims.width, dims.height);
          newPages.push({ id: name + Date.now(), filename: name, originalImage: processed.url, cleanedImage: null, detectedTexts: [], status: 'pending', width: processed.width, height: processed.height });
          setUploadProgress(Math.round(5 + ((j + 1) / imageFiles.length) * 95));
          // Yield to renderer frequently to keep progress bar fluid
          await new Promise(r => setTimeout(r, 10));
        }
        toast.success(`Extracted ${newPages.length} pages`);
      } else {
        const sortedFiles = [...acceptedFiles].sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'}));
        for (let i = 0; i < sortedFiles.length; i++) {
          const f = sortedFiles[i];
          const url = URL.createObjectURL(f);
          const dims = await getImageDimensions(url);
          const processed = await rotateImageIfNeeded(url, dims.width, dims.height);
          newPages.push({ id: f.name + Date.now(), filename: f.name, originalImage: processed.url, cleanedImage: null, detectedTexts: [], status: 'pending', width: processed.width, height: processed.height });
          setUploadProgress(Math.round(5 + ((i + 1) / sortedFiles.length) * 95));
          // Yield to renderer frequently to keep progress bar fluid
          await new Promise(r => setTimeout(r, 10));
        }
      }
      
      setPages(prev => [...prev, ...newPages]);
      if (pages.length === 0 && newPages.length > 0) {
        setCurrentPageIndex(0);
        setViewMode('edit');
      }
      
      setUploadProgress(100);
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      toast.error("Failed to process files");
    } finally {
      setIsUploading(false);
    }
  };

  const onDrop = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    
    // Start progress feedback IMMEDIATELY
    setIsUploading(true);
    setUploadProgress(5);
    setLoadingText("Identifying files...");
    
    // Give browser a moment to render the loading overlay
    await new Promise(r => setTimeout(r, 100));

    const file = acceptedFiles[0];
    const fileNameLower = file.name.toLowerCase();
    const isZip = fileNameLower.endsWith('.zip') || fileNameLower.endsWith('.cbz');
    const isEbook = fileNameLower.endsWith('.pdf') || fileNameLower.endsWith('.epub') || fileNameLower.endsWith('.mobi') || fileNameLower.endsWith('.cbr');
    
    // If it's an ebook, let user know it's detected but not yet processed
    if (isEbook) {
      toast.info("This feature is still in development. Please stay tuned!");
      setIsUploading(false);
      setUploadProgress(0);
      return;
    }

    // If images are uploaded and it's not a zip, show collage modal
    if (!isZip) {
      setPendingFiles(acceptedFiles);
      setUploadProgress(100);
      setIsUploading(false);
      setShowCollageModal(true);
      return;
    }
    
    await processUploadedFiles(acceptedFiles);
  };

  const generateCollage = async (templateName: string, pageFiles: File[], options?: { outline?: boolean, highContrast?: boolean }) => {
    const template = LAYOUTS[templateName];
    if (!template) {
      console.error(`Template ${templateName} not found`);
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1600;
    const scale = 1200 / 317.5;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 1. Black Fills (Initial pass for static ones, but we might override for dynamic templates)
    if (!['batch_12', 'batch_13', 'batch_14'].includes(templateName)) {
      ctx.fillStyle = '#000000';
      for (const fill of template.black_fills) {
        ctx.fillRect(fill.x * scale, fill.y * scale, fill.width * scale, fill.height * scale);
      }
    }

    // 2. Preload images for this page to get ratios
    const imagePool = await Promise.all(pageFiles.map(async (file) => {
      return new Promise<{ img: HTMLImageElement, ratio: number, objectUrl: string }>((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => resolve({ img, ratio: img.width / img.height, objectUrl });
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error(`Failed to load image: ${file.name}`));
        };
        img.src = objectUrl;
      });
    }));

    // 3. Match images to slots based on ratio
    const remainingImages = [...imagePool];
    const placedImages: { dX: number, dY: number, dW: number, dH: number, slotIdx: number }[] = [];
    
    for (let i = 0; i < template.image_slots.length; i++) {
        const slot = template.image_slots[i];
        const slotW = slot.width * scale;
        const slotH = slot.height * scale;
        const slotRatio = slotW / slotH;
        const slotX = slot.x * scale;
        const slotY = slot.y * scale;

        if (remainingImages.length === 0) {
            continue;
        }

        // Find best ratio match
        let bestMatchIdx = 0;
        let minDiff = Math.abs(remainingImages[0].ratio - slotRatio);
        
        for (let j = 1; j < remainingImages.length; j++) {
            const diff = Math.abs(remainingImages[j].ratio - slotRatio);
            if (diff < minDiff) {
                minDiff = diff;
                bestMatchIdx = j;
            }
        }

        const { img, ratio: imgRatio, objectUrl } = remainingImages.splice(bestMatchIdx, 1)[0];

        let dW, dH, dX, dY;

        if (imgRatio > slotRatio) {
            // Image is wider than slot relative to height -> fit to width
            dW = slotW;
            dH = slotW / imgRatio;
            dX = slotX;
            dY = slotY + (slotH - dH) / 2;
        } else {
            // Image is taller than slot relative to width -> fit to height
            dH = slotH;
            dW = slotH * imgRatio;
            dX = slotX + (slotW - dW) / 2;
            dY = slotY;
        }

        // Apply High Contrast if enabled
        if (options?.highContrast) {
          ctx.filter = 'grayscale(1) contrast(1.25)';
        }

        ctx.drawImage(img, 0, 0, img.width, img.height, dX, dY, dW, dH);
        
        // Reset filter
        ctx.filter = 'none';

        // Outline setting:
        // 12, 13, 14 always have outline
        // 6, 7, 8 always not have
        // others follow user setting
        let shouldDrawOutline = options?.outline;
        if (['batch_12', 'batch_13', 'batch_14'].includes(templateName)) {
            shouldDrawOutline = true;
        } else if (['batch_6', 'batch_7', 'batch_8'].includes(templateName)) {
            shouldDrawOutline = false;
        }

        if (shouldDrawOutline) {
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 2; // Slightly thicker for print quality
          ctx.strokeRect(dX, dY, dW, dH);
        }

        placedImages.push({ dX, dY, dW, dH, slotIdx: i });
        URL.revokeObjectURL(objectUrl);
    }

    // 4. Dynamic Black Fills for 12, 13, 14
    if (['batch_12', 'batch_13', 'batch_14'].includes(templateName)) {
        const shadowSize = 10; 
        ctx.fillStyle = '#000000';
        
        for (const p of placedImages) {
            const slot = template.image_slots[p.slotIdx];
            
            // Heuristic to detect if this slot has a corresponding bottom/right bar in the original template
            const hasBottomFill = template.black_fills.some(f => 
                Math.abs(f.y - (slot.y + slot.height)) < 10 && f.width > f.height
            );
            const hasRightFill = template.black_fills.some(f => 
                Math.abs(f.x - (slot.x + slot.width)) < 10 && f.height > f.width
            );

            if (hasBottomFill) {
                // bottom: 15px x width, Indent 15px
                ctx.fillRect(p.dX + shadowSize, p.dY + p.dH, p.dW, shadowSize);
            }
            if (hasRightFill) {
                // right: 15px x height, Indent 15px
                ctx.fillRect(p.dX + p.dW, p.dY + shadowSize, shadowSize, p.dH);
            }
        }
    }

    // Clean up any unused images
    remainingImages.forEach(item => URL.revokeObjectURL(item.objectUrl));

    // Yield to let UI update before heavy operation
    await new Promise(r => setTimeout(r, 10));

    return {
        url: canvas.toDataURL('image/jpeg', 0.9),
        width: canvas.width,
        height: canvas.height
    };
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 
      'image/*': [],
      'application/zip': ['.zip', '.cbz'],
      'application/x-zip-compressed': ['.zip', '.cbz'],
      'application/pdf': ['.pdf'],
      'application/epub+zip': ['.epub'],
      'application/x-mobipocket-ebook': ['.mobi'],
      'application/x-cbr': ['.cbr']
    },
    useFsAccessApi: false,
    multiple: true,
  } as any);

  const processPage = async (pageIndex: number) => {
    const page = pages[pageIndex];
    if (!page || page.status === 'processing' || page.isIgnored) return;

    const runOcr = ocrDuringBatch && !page.hasOcrRun;
    const runLayout = splitDuringBatch && !page.hasLayoutRun;
    const runTranslate = translateDuringBatch && (page.translatedLanguage !== batchTargetLanguage || runOcr);

    console.log(`[Batch] Processing page ${pageIndex + 1}/${pages.length}`, {
      ocrRequested: ocrDuringBatch,
      splitRequested: splitDuringBatch,
      translateRequested: translateDuringBatch,
      runOcr,
      runLayout,
      runTranslate
    });

    if (!runOcr && !runLayout && !runTranslate) {
      setPages(prev => prev.map((p, idx) => idx === pageIndex ? { ...p, status: 'done' } : p));
      return;
    }

    if (llmEngine === 'gemini' && !customApiKey && (runOcr || runTranslate)) {
      setIsBatchProcessing(false);
      setShowApiKeyModal(true);
      return;
    }

    setPages(prev => prev.map((p, idx) => idx === pageIndex ? { ...p, status: 'processing' } : p));
    
    try {
      let result: ComicText[] = [];
      let localTexts: any[] | undefined = page.yoloTexts;
      let localPanels: any[] | undefined = page.detectedPanels;
      
      // Load full-res image once for processing
      const fullImg = new Image();
      fullImg.crossOrigin = "Anonymous";
      fullImg.src = page.originalImage;
      await new Promise((resolve) => { fullImg.onload = resolve; fullImg.onerror = resolve; });

      const canvas = document.createElement('canvas');
      canvas.width = fullImg.naturalWidth;
      canvas.height = fullImg.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Could not create canvas context");
      ctx.drawImage(fullImg, 0, 0);

      const aiBase64 = await resizeImageForAI(page.originalImage, 1600);

      // 1. Initial Layout Detection (YOLO / Predict API)
      if (runLayout && (!localTexts || !localPanels)) {
        try {
          console.log("Running layout detection...");
          const layoutResult = await runPredictAPI(aiBase64);
          if (layoutResult) {
            localTexts = layoutResult.texts || [];
            localPanels = layoutResult.panels || [];
          }
        } catch (apiErr) {
          console.log("Predict API failed:", apiErr);
        }
      }

      const hasLayoutPanels = localPanels && localPanels.length > 0;

      // Branch A: Both Panels and Text detected (or just Panels) -> Comic Mode
      if (splitDuringBatch && hasLayoutPanels) {
        toast.info(`Comic detected: Processing ${localPanels.length} panels...`);
        
        // Sort panels by reading order before processing
        const sortedPanels = [...localPanels].sort((a, b) => {
          const boxA = a.box_2d || a;
          const boxB = b.box_2d || b;
          const yDiff = boxA[0] - boxB[0];
          if (Math.abs(yDiff) < 50) return boxA[1] - boxB[1];
          return yDiff;
        });

        const finalResults: ComicText[] = [];
        
        if (runOcr) {
          for (let i = 0; i < sortedPanels.length; i++) {
            const panel = sortedPanels[i];
            const box = panel.box_2d || panel;
            
            // Crop panel for OCR with a small margin for context
            const margin = 20; // 2% margin
            const pSx = Math.max(0, ((box[1] - margin) / 1000) * fullImg.naturalWidth);
            const pSy = Math.max(0, ((box[0] - margin) / 1000) * fullImg.naturalHeight);
            const pSw = Math.min(fullImg.naturalWidth - pSx, ((box[3] - box[1] + 2 * margin) / 1000) * fullImg.naturalWidth);
            const pSh = Math.min(fullImg.naturalHeight - pSy, ((box[2] - box[0] + 2 * margin) / 1000) * fullImg.naturalHeight);
            
            const pCanvas = document.createElement('canvas');
            pCanvas.width = pSw;
            pCanvas.height = pSh;
            const pCtx = pCanvas.getContext('2d');
            if (pCtx) {
              pCtx.fillStyle = '#ffffff';
              pCtx.fillRect(0, 0, pSw, pSh);
              pCtx.drawImage(fullImg, pSx, pSy, pSw, pSh, 0, 0, pSw, pSh);
              const pBase64 = pCanvas.toDataURL('image/jpeg', 0.9);
              
              // Wait slightly between panels to help avoid early rate limiting
              if (i > 0) await new Promise(r => setTimeout(r, 1000));

              // Run OCR on panel with panel-hint (-1) (Gemini or Local LLM)
              const panelTexts = await detectComicText(
                pBase64,
                customApiKey,
                -1,
                'gemini',
                undefined,
                {
                  engine: llmEngine,
                  url: localLlmUrl,
                  model: localLlmModel,
                  apiKey: localLlmApiKey
                }
              );
              
              // Transform panel coordinates back to page coordinates
              // Note: we need to account for the margin we added during cropping
              panelTexts.forEach(pt => {
                const [pyMin, pxMin, pyMax, pxMax] = pt.box_2d;
                
                // Local coords in the crop (0-1000) mapped to the crop's width/height
                const cropLocalXMin = (pxMin / 1000) * pSw;
                const cropLocalYMin = (pyMin / 1000) * pSh;
                const cropLocalXMax = (pxMax / 1000) * pSw;
                const cropLocalYMax = (pyMax / 1000) * pSh;
                
                // Map crop local pixels to fullImg pixels
                const fullImgPixelXMin = pSx + cropLocalXMin;
                const fullImgPixelYMin = pSy + cropLocalYMin;
                const fullImgPixelXMax = pSx + cropLocalXMax;
                const fullImgPixelYMax = pSy + cropLocalYMax;
                
                // Map fullImg pixels back to page-relative units (0-1000)
                const yMin = (fullImgPixelYMin / fullImg.naturalHeight) * 1000;
                const xMin = (fullImgPixelXMin / fullImg.naturalWidth) * 1000;
                const yMax = (fullImgPixelYMax / fullImg.naturalHeight) * 1000;
                const xMax = (fullImgPixelXMax / fullImg.naturalWidth) * 1000;
                
                const tXCenter = (xMin + xMax) / 2;
                const tYCenter = (yMin + yMax) / 2;
                
                // Only include if text center is actually inside the panel boundaries (ignoring the margin context)
                const isInside = tXCenter >= box[1] - 5 && tXCenter <= box[3] + 5 &&
                                tYCenter >= box[0] - 5 && tYCenter <= box[2] + 5;
                
                if (isInside) {
                  finalResults.push({ 
                    ...pt, 
                    box_2d: [yMin, xMin, yMax, xMax],
                    panelIdx: localPanels.indexOf(panel)
                  });
                }
              });
            }
          }
          result = finalResults;
        } else {
          result = page.detectedTexts || [];
        }
      } 
      // Branch B: No Panels detected or split disabled -> Regular Book Mode
      else {
        if (runOcr) {
          toast.info("Analyzing layout and extracting text...");
          // Follow "Non-panel" branch: Regular book -> OCR and analyze layout (Gemini or Local LLM)
          const rawResult = await detectComicText(
            aiBase64,
            customApiKey,
            localTexts?.length || 0,
            'gemini',
            undefined,
            {
              engine: llmEngine,
              url: localLlmUrl,
              model: localLlmModel,
              apiKey: localLlmApiKey
            }
          );
          // Canonical sort for the book page
          result = sortTextsReadingOrder(rawResult);
        } else {
          result = page.detectedTexts || []; // Keep existing if no OCR requested
        }
      }

      // Cache yoloTexts and detectedPanels to save computation next time or during export
      if ((localTexts && localTexts !== page.yoloTexts) || (localPanels && localPanels !== page.detectedPanels)) {
        setPages(prev => prev.map((p, idx) => idx === pageIndex ? { ...p, yoloTexts: localTexts, detectedPanels: localPanels } : p));
      }

      const hasPanels = localPanels && localPanels.length > 0;

      if (result.length === 0 && !splitDuringBatch) {
        setPages(prev => prev.map((p, idx) => idx === pageIndex ? { 
          ...p, 
          status: 'done',
          hasOcrRun: page.hasOcrRun || ocrDuringBatch,
          hasLayoutRun: page.hasLayoutRun || splitDuringBatch,
          translatedLanguage: translateDuringBatch ? batchTargetLanguage : page.translatedLanguage
        } : p));
        if (!hasPanels) {
          toast.info("No panels or text detected on this page.");
        }
        return;
      }

      const isBookMode = !localPanels || localPanels.length === 0;

      const processedResults = result.map((item) => {
        // Only refine if it's likely a short comic bubble AND we are in comic mode
        const shouldRefine = !isBookMode && item.text.length < 50;
        const refinedBox = shouldRefine ? refineTextBubbleBounds(ctx, item.box_2d) : item.box_2d;
        const bgColor = getAverageColorFromCanvas(ctx, refinedBox);
        let maskBase64 = undefined;
        let mask_box_2d = undefined;
        if (localTexts) {
          let bestMatch = null;
          let bestScore = -1;
          for (const lt of localTexts) {
            const lBox = lt.box_2d || lt;
            const x1 = Math.max(lBox[1], item.box_2d[1]);
            const y1 = Math.max(lBox[0], item.box_2d[0]);
            const x2 = Math.min(lBox[3], item.box_2d[3]);
            const y2 = Math.min(lBox[2], item.box_2d[2]);
            const intersect = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
            const a1 = Math.max(0, lBox[3] - lBox[1]) * Math.max(0, lBox[2] - lBox[0]);
            const a2 = Math.max(0, item.box_2d[3] - item.box_2d[1]) * Math.max(0, item.box_2d[2] - item.box_2d[0]);
            const iou = intersect / (a1 + a2 - intersect + 1e-6);
            if (iou > bestScore && iou > 0.01) {
              bestScore = iou;
              bestMatch = lt;
            }
          }
          if (bestMatch && bestMatch.maskBase64) {
            maskBase64 = bestMatch.maskBase64;
            mask_box_2d = bestMatch.box_2d || bestMatch;
          }
        }
        return { ...item, box_2d: refinedBox, bgColor, maskBase64, mask_box_2d };
      });

      const cleanedImage = await generateCleanedImageFromElement(fullImg, processedResults);
      
      let finalResults = processedResults;

      if (runTranslate && batchTargetLanguage && finalResults.length > 0) {
        try {
          const textsToTranslate = finalResults.map(t => t.text);
          const translatedTexts = await translateTexts(
            textsToTranslate,
            batchTargetLanguage,
            customApiKey,
            {
              engine: llmEngine,
              url: localLlmUrl,
              model: localLlmModel,
              apiKey: localLlmApiKey
            }
          );
          finalResults = finalResults.map((t, i) => ({
            ...t,
            text: translatedTexts[i] || t.text
          }));
        } catch (translateError: any) {
          console.error("Translation during batch failed:", translateError);
           if (translateError?.message?.toLowerCase().includes("quota") || translateError?.status === 429) {
             setShowApiKeyModal(true);
             toast.error(isBatchProcessing ? "Batch stopped: Gemini API Quota Exceeded during translation. Please provide your own API key." : "Gemini API Quota Exceeded during translation. Please provide your own API key.");
             throw translateError;
           }
        }
      }

      let calculatedIsTextOnly = false;
      if (localPanels && localPanels.length === 0 && finalResults && finalResults.length > 0) {
        calculatedIsTextOnly = true;
      }

      setPages(prev => prev.map((p, idx) => idx === pageIndex ? { 
        ...p, 
        detectedTexts: finalResults, 
        cleanedImage, 
        status: 'done',
        isTextOnly: calculatedIsTextOnly,
        hasOcrRun: page.hasOcrRun || ocrDuringBatch,
        hasLayoutRun: page.hasLayoutRun || splitDuringBatch,
        translatedLanguage: translateDuringBatch ? batchTargetLanguage : page.translatedLanguage
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
        toast.error(isBatchProcessing ? "Batch stopped: Gemini API Quota Exceeded. Please provide your own API key." : "Gemini API Quota Exceeded. Please provide your own API key.");
        throw error;
      } else if (errorMsg.toLowerCase().includes("api key missing") || errorMsg.toLowerCase().includes("server missing gemini api key")) {
        setIsBatchProcessing(false);
        setShowApiKeyModal(true);
        toast.error(isBatchProcessing ? "Batch stopped: Gemini API Key is missing." : "Gemini API Key is missing. Please provide your own to continue.");
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
    // If no AI options are selected, skip batch processing and export directly
    if (!ocrDuringBatch && !splitDuringBatch && !translateDuringBatch) {
      toast.info("No AI processing requested. Ready to export.");
      // Just mark all pending pages as done
      setPages(prev => prev.map(p => p.status === 'pending' ? { ...p, status: 'done' } : p));
      // Trigger EPUB export as a default reasonable comic format
      downloadEpub();
      return;
    }

    setIsBatchProcessing(true);
    setBatchProgress(0);
    
    // Determine which pages to process
    const indicesToProcess = selectedPages.size > 0 
      ? Array.from(selectedPages).filter(i => needsPageProcessing(pages[i]))
      : pages.map((_, i) => i).filter(i => needsPageProcessing(pages[i]));

    if (indicesToProcess.length === 0) {
      toast.info("All requested pages are already processed. Ready to export.");
      setIsBatchProcessing(false);
      return;
    }

    // Step 1: Blank Check Phase
    toast.info(`Initial scan for blank pages...`);
    const preservedIndices: number[] = [];
    for (let idxIdx = 0; idxIdx < indicesToProcess.length; idxIdx++) {
      const idx = indicesToProcess[idxIdx];
      const page = pages[idx];
      if (page.status === 'done' || page.hasOcrRun || page.hasLayoutRun) {
        preservedIndices.push(idx); // Already did blank check previously, skip blank check but keep for processing
        continue;
      }
      
      const isBlank = await isPageLikelyBlank(page.originalImage);
      if (isBlank) {
        setPages(prev => prev.map((p, pIdx) => pIdx === idx ? { ...p, status: 'done', isIgnored: true } : p));
        console.log(`[Batch] Auto-ignored page ${idx + 1} (likely blank)`);
      } else {
        preservedIndices.push(idx);
      }
      setBatchProgress(Math.round(((idxIdx + 1) / indicesToProcess.length) * 10)); // Allocate 10% to scan
    }

    if (preservedIndices.length === 0) {
      setIsBatchProcessing(false);
      toast.success("Batch review complete. All pages were empty.");
      return;
    }

    toast.info(`Processing ${preservedIndices.length} content pages...`);
    
    let stoppedBecauseOfQuota = false;

    for (let index = 0; index < preservedIndices.length; index++) {
      const i = preservedIndices[index];
      setCurrentPageIndex(i); // Follow along
      const chunkSize = 90 / preservedIndices.length;
      const progressBefore = Math.round(10 + (index * chunkSize));
      setBatchProgress(progressBefore);
      
      try {
        const progressAfterApi = 10 + (index * chunkSize) + (chunkSize * 0.4);
        let simProgress = progressBefore;
        
        // Setup an interval to animate progress while waiting for the Gemini API
        const simInterval = setInterval(() => {
           simProgress += (progressAfterApi - simProgress) * 0.1; // Ease-out approach
           setBatchProgress(Math.round(simProgress));
        }, 500);

        try {
          await processPage(i);
        } catch (err) {
          clearInterval(simInterval);
          throw err;
        }
        
        clearInterval(simInterval);
        setBatchProgress(Math.round(progressAfterApi));
        
        if (index < preservedIndices.length - 1) {
           // Wait ~4.5s to respect 15 RPM limits on Gemini 2.5 Flash Free Tier
           const delaySteps = 45;
           const progressPerStep = (chunkSize * 0.6) / delaySteps;
           
           for (let step = 1; step <= delaySteps; step++) {
             await new Promise(r => setTimeout(r, 100)); // 100ms per step
             setBatchProgress(Math.round(progressAfterApi + (progressPerStep * step)));
           }
        } else {
           // Last item finishes the full chunk
           const progressAfter = Math.round(10 + ((index + 1) * chunkSize));
           setBatchProgress(progressAfter);
        }
      } catch (e: any) {
        if (e?.message?.toLowerCase().includes("quota") || e?.status === 429) {
          stoppedBecauseOfQuota = true;
          break; // Stop batch processing on quota error
        }
        console.error(`Failed to process page ${i + 1}:`, e);
      }
    }
    
    setIsBatchProcessing(false);
    if (!stoppedBecauseOfQuota) {
      toast.success("Batch processing complete!");
    }
    setSelectedPages(new Set());
  };

  const getBoxStyle = (boxInput: any, imgWidth: number, imgHeight: number) => {
    const box = Array.isArray(boxInput) ? boxInput : (boxInput.box_2d || [0,0,0,0]);
    const [ymin, xmin, ymax, xmax] = box;
    
    const paddingPx = 0;
    
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
        const sortedTexts = sortTextsReadingOrder(p.detectedTexts);
        const targetObj = sortedTexts[index];
        const originalIndex = p.detectedTexts.indexOf(targetObj);
        
        if (originalIndex !== -1) {
          const newTexts = [...p.detectedTexts];
          newTexts[originalIndex] = { ...newTexts[originalIndex], text: tempText };
          return { ...p, detectedTexts: newTexts };
        }
      }
      return p;
    }));
    setEditingIndex(null);
  };

  const getMergedImageData = async (page: PageData): Promise<string> => {
    return new Promise(async (resolve) => {
      const sourceUrl = page.cleanedImage || page.originalImage;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = sourceUrl;
      
      try {
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
        });
      } catch (err) {
        console.error("Failed to load base image for export merge", err);
        resolve(sourceUrl);
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(sourceUrl);
        return;
      }

      // 1. Draw original image with white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      ctx.filter = 'none'; // Ensure no residue filters

      // 2. Draw manual images
      if (page.manualImages && page.manualImages.length > 0) {
        for (const mImg of page.manualImages) {
          try {
            const overlayImg = new Image();
            overlayImg.crossOrigin = "anonymous";
            overlayImg.src = mImg.url;
            await new Promise((res, rej) => {
              overlayImg.onload = res;
              overlayImg.onerror = rej;
            });

            const [ymin, xmin, ymax, xmax] = mImg.box_2d;
            const dx = (xmin / 1000) * canvas.width;
            const dy = (ymin / 1000) * canvas.height;
            const dw = ((xmax - xmin) / 1000) * canvas.width;
            const dh = ((ymax - ymin) / 1000) * canvas.height;

            ctx.save();
            if (mImg.isHighContrast) {
              ctx.filter = 'grayscale(1) contrast(1.25)';
            }
            
            if (mImg.crop) {
                // Handle cropping
                const cX = mImg.crop.xmin * overlayImg.width / 100;
                const cY = mImg.crop.ymin * overlayImg.height / 100;
                const cW = (mImg.crop.xmax - mImg.crop.xmin) * overlayImg.width / 100;
                const cH = (mImg.crop.ymax - mImg.crop.ymin) * overlayImg.height / 100;
                ctx.drawImage(overlayImg, cX, cY, cW, cH, dx, dy, dw, dh);
            } else {
                ctx.drawImage(overlayImg, dx, dy, dw, dh);
            }
            if (mImg.hasOutline) {
                ctx.strokeStyle = mImg.color || '#000000';
                ctx.lineWidth = 2; // Make it 2px for better visibility
                // 1 pixel relative to original image size
                ctx.strokeRect(dx, dy, dw, dh);
            }
            ctx.restore();
          } catch (e) {
            console.error("Failed to render manual image in export", e);
          }
        }
      }

      // 3. Draw manual texts
      if (page.manualTexts && page.manualTexts.length > 0) {
        for (const mText of page.manualTexts) {
          const [ymin, xmin, ymax, xmax] = mText.box_2d;
          const dx = (xmin / 1000) * canvas.width;
          const dy = (ymin / 1000) * canvas.height;
          const dw = ((xmax - xmin) / 1000) * canvas.width;
          const dh = ((ymax - ymin) / 1000) * canvas.height;

          ctx.save();
          const fontSize = (mText.fontSize / page.width) * canvas.width;
          ctx.font = `${fontSize}px Helvetica, Arial, sans-serif`;
          ctx.fillStyle = mText.color || '#000000';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          // Basic text wrapping on canvas
          const lines = mText.text.split('\n');
          const lineHeight = fontSize * 1.2;
          const totalHeight = lines.length * lineHeight;
          let startY = dy + (dh - totalHeight) / 2 + lineHeight / 2;

          for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], dx + dw / 2, startY + i * lineHeight);
          }
          ctx.restore();
        }
      }

      resolve(canvas.toDataURL('image/jpeg', 0.9));
    });
  };

  const getExportablePages = () => {
    if (selectedPages.size > 0) {
      return pages.filter((_, i) => selectedPages.has(i));
    }
    return pages;
  };

  const downloadHtml = async () => {
    const exportPages = getExportablePages();
    if (exportPages.length === 0) return;
    toast.info("Generating HTML...");

    let pagesHtml = '';

    for (let i = 0; i < exportPages.length; i++) {
      const page = exportPages[i];
      const base64Data = await getMergedImageData(page);

      let panelsHtml = '';
      const allTexts = [...(page.detectedTexts || []), ...(page.manualTexts || [])];
      const hasText = allTexts.length > 0;
      
      if (!hasText && !splitDuringBatch) {
        panelsHtml = `
      <div class="panel-card">
        <div class="panel-image-container">
          <img src="${base64Data}" class="panel-img" alt="Panel" />
        </div>
      </div>`;
      } else if (hasText && page.isTextOnly) {
        const sortedTexts = sortTextsReadingOrder(allTexts);
        const textContent = sortedTexts.map(t => {
          return t.text.split('\n').map(p => `<p class="panel-text-line">${p}</p>`).join('');
        }).join('');
        panelsHtml = `
      <div class="panel-card">
        <div class="panel-text-container" style="max-width: 800px; padding: 40px; font-family: serif; font-size: 1.2rem;">
          ${textContent}
        </div>
      </div>`;
      } else {
        const panels = await getPanelsForPage(page, base64Data, splitDuringBatch, customApiKey);
        if (panels.length === 0) {
          panelsHtml = `
        <div class="panel-card">
          <div class="panel-image-container">
            <img src="${base64Data}" class="panel-img" alt="Panel" />
          </div>
          ${allTexts.length > 0 ? `<div class="panel-text-container">${sortTextsReadingOrder(allTexts).map(t => `<p class="panel-text-line">${t.text}</p>`).join('')}</div>` : ''}
        </div>`;
        } else {
          for (let p of panels) {
            let imageHtml = '';
            if (p.base64Image) {
              imageHtml = `
            <div class="panel-image-container">
              <img src="${p.base64Image}" class="panel-img" alt="Panel" />
            </div>`;
            }

            const textContent = p.texts.length > 0 
              ? sortTextsReadingOrder(p.texts).map(t => `<p class="panel-text-line">${t.text.replace(/\n/g, ' ')}</p>`).join('')
              : '';
            
            panelsHtml += `
          <div class="panel-card">
            ${imageHtml}
            ${textContent ? `<div class="panel-text-container">${textContent}</div>` : ''}
          </div>`;
          }
        }
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
    body { margin: 0; padding: ${splitDuringBatch ? '20px' : '0'}; background: #fff; font-family: 'Arial', sans-serif; display: flex; flex-direction: column; align-items: center; }
    .page-wrapper { width: 100%; max-width: ${splitDuringBatch ? '1000px' : '100%'}; margin-bottom: 0px; display: flex; flex-direction: column; gap: 0px; }
    .panel-card { display: flex; flex-direction: column; align-items: center; width: 100%; border: none; margin: 0; padding: 0; }
    .panel-image-container { width: 100%; display: flex; justify-content: center; margin-bottom: 0px; }
    .panel-img { width: 100%; max-width: 100%; height: auto; display: block; }
    .panel-text-container { width: 100%; max-width: 100%; text-align: left; padding: 20px; box-sizing: border-box; }
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
    setShowCoffeeModal(true);
    setTimeout(() => {
      toast("Easily Send to Kindle", { icon: "!", duration: 4000 });
    }, 500);
  };

  const downloadPdf = async () => {
    const exportPages = getExportablePages();
    if (exportPages.length === 0) return;
    toast.info("Generating PDF (Panel by Panel)...");

    try {
      const { jsPDF } = await import('jspdf');

      // Use standard A4 portrait for reflowable panels
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a4'
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = splitDuringBatch ? 40 : 0;
      const contentWidth = pageWidth - margin * 2;
      let currentY = margin;
      let isFirstPage = true;

      const checkAddPage = (neededHeight: number) => {
        if (currentY + neededHeight > pageHeight - margin) {
          pdf.addPage();
          currentY = margin;
        }
      };

      const addTextWithCanvas = (textStr: string) => {
        const fontSize = 12; // pt
        const lineHeight = 16; // pt
        const scale = 2; // retina display sharpness
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.font = `${fontSize * scale}px Helvetica, Arial, "Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", sans-serif`;
        
        const paragraphs = textStr.split('\n');
        let lines: string[] = [];
        
        for (const p of paragraphs) {
          if (!p.trim()) {
            lines.push('');
            continue;
          }
          let currentLine = '';
          for (let i = 0; i < p.length; i++) {
            const char = p[i];
            const testLine = currentLine + char;
            const w = ctx.measureText(testLine).width / scale;
            if (w > contentWidth && i > 0) {
              lines.push(currentLine);
              currentLine = char;
            } else {
              currentLine = testLine;
            }
          }
          lines.push(currentLine);
        }
        
        // Render chunks
        let chunkLines: string[] = [];
        
        const flushChunk = () => {
           if (chunkLines.length === 0) return;
           const h = chunkLines.length * lineHeight;
           canvas.width = contentWidth * scale;
           canvas.height = h * scale;
           ctx.font = `${fontSize * scale}px Helvetica, Arial, "Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", sans-serif`;
           ctx.fillStyle = '#000000';
           ctx.textBaseline = 'top';
           ctx.clearRect(0,0, canvas.width, canvas.height);
           
           for (let i = 0; i < chunkLines.length; i++) {
              ctx.fillText(chunkLines[i], 0, i * lineHeight * scale);
           }
           
           const dataUrl = canvas.toDataURL('image/png', 0.9);
           pdf.addImage(dataUrl, 'PNG', margin, currentY, contentWidth, h);
           currentY += h;
           chunkLines = [];
        };

        for (const line of lines) {
           if (currentY + (chunkLines.length * lineHeight) + lineHeight > pageHeight - margin) {
              flushChunk();
              pdf.addPage();
              currentY = margin;
           }
           chunkLines.push(line);
        }
        flushChunk();
      };

      for (let i = 0; i < exportPages.length; i++) {
        const page = exportPages[i];
        const base64Data = await getMergedImageData(page);

        if (page.isTextOnly && (!page.manualImages || page.manualImages.length === 0)) {
            // Text-only
            const allTexts = [...(page.detectedTexts || []), ...(page.manualTexts || [])];
            const sortedTexts = sortTextsReadingOrder(allTexts);
            const textStr = sortedTexts.map(t => t.text.trim()).join('\n\n');
            if (textStr) {
               addTextWithCanvas(textStr);
               currentY += 20;
            }
        } else {
            // Panels logic same as HTML export
            const panels = await getPanelsForPage(page, base64Data, splitDuringBatch, customApiKey);
            
            if (panels.length === 0) {
               // Fallback: full image + text
               const imgProps = pdf.getImageProperties(base64Data);
               const ratio = imgProps.width / imgProps.height;
               const targetWidth = contentWidth;
               const targetHeight = targetWidth / ratio;
               
               checkAddPage(targetHeight + 20);
               pdf.addImage(base64Data, 'JPEG', margin, currentY, targetWidth, targetHeight);
               currentY += targetHeight + 20;

               const allTexts = [...(page.detectedTexts || []), ...(page.manualTexts || [])];
               if (allTexts.length > 0) {
                 const sortedTexts = sortTextsReadingOrder(allTexts);
                 const textStr = sortedTexts.map(t => t.text.replace(/\n/g, ' ')).join('\n\n');
                 if (textStr) {
                    addTextWithCanvas(textStr);
                    currentY += 20;
                 }
               }
            } else {
               for (let p of panels) {
                  if (p.base64Image) {
                     const imgProps = pdf.getImageProperties(p.base64Image);
                     let ptrWidth = imgProps.width;
                     let ptrHeight = imgProps.height;
                     if (ptrWidth > contentWidth) {
                        const ratio = ptrWidth / ptrHeight;
                        ptrWidth = contentWidth;
                        ptrHeight = ptrWidth / ratio;
                     }
                     // Center image
                     const xOffset = margin + (contentWidth - ptrWidth) / 2;
                     
                     checkAddPage(ptrHeight + 10);
                     pdf.addImage(p.base64Image, 'JPEG', xOffset, currentY, ptrWidth, ptrHeight);
                     currentY += ptrHeight + 10;
                  }
                  
                  if (p.texts.length > 0) {
                     const sortedTexts = sortTextsReadingOrder(p.texts);
                     const textContent = sortedTexts.map(t => t.text.replace(/\n/g, ' ')).join('\n\n');
                     if (textContent) {
                        addTextWithCanvas(textContent);
                        currentY += 10; // extra spacing after text
                     }
                  }
               }
            }
        }
      }

      pdf.save('comic_export.pdf');
      toast.success("PDF generated successfully!");
      setShowCoffeeModal(true);
    } catch (error) {
      console.error("PDF generation failed:", error);
      toast.error("Failed to generate PDF");
    }
  };

  const downloadEpub = async () => {
    const exportPages = getExportablePages();
    if (exportPages.length === 0) return;
    toast.info("Generating EPUB (Panel by Panel)...");
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
    let ncxItems = '';
    let seqIndex = 1;

    const isNoOptions = !ocrDuringBatch && !translateDuringBatch && !splitDuringBatch;
    const isSplitOnly = !ocrDuringBatch && !translateDuringBatch && splitDuringBatch;
    const hasAnyText = exportPages.some(p => ((p.detectedTexts?.length || 0) + (p.manualTexts?.length || 0)) > 0);
    const useReflowable = isSplitOnly || hasAnyText;

    for (let i = 0; i < exportPages.length; i++) {
      const page = exportPages[i];
      const base64Data = await getMergedImageData(page);
      
      const isTextOnly = (page.isTextOnly || false) && (!page.manualImages || page.manualImages.length === 0);
      const allPageTexts = [...(page.detectedTexts || []), ...(page.manualTexts || [])];

      if (isTextOnly) {
        const pageId = `page${seqIndex}`;
        manifestItems += `    <item id="${pageId}" href="${pageId}.xhtml" media-type="application/xhtml+xml" />\n`;
        spineItems += `    <itemref idref="${pageId}"/>\n`;
        navItems += `      <li><a href="${pageId}.xhtml">Text Page ${seqIndex}</a></li>\n`;
        ncxItems += `    <navPoint id="${pageId}" playOrder="${seqIndex}">
      <navLabel><text>Text Page ${seqIndex}</text></navLabel>
      <content src="${pageId}.xhtml"/>
    </navPoint>\n`;

        const sortedTexts = sortTextsReadingOrder(allPageTexts);
        const textContent = sortedTexts.map(t => {
          const paragraphs = t.text.split('\n').map(p => `<p>${p}</p>`).join('');
          return paragraphs;
        }).join('');
        
        zip.file(`OEBPS/${pageId}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Text Page ${seqIndex}</title>
  ${useReflowable ? '' : '<meta name="viewport" content="width=1200, height=1600"/>'}
  <style>
    body { margin: 0; padding: 2em; background: #fff; color: #000; font-family: sans-serif; box-sizing: border-box; }
    p { margin-bottom: 1em; line-height: 1.5; font-size: 1.2em; text-align: justify; }
  </style>
</head>
<body>
${textContent}
</body>
</html>`);
        seqIndex++;
      } else {
         const panels = await getPanelsForPage(page, base64Data, splitDuringBatch, customApiKey);
         
         if (panels.length === 0 || (!splitDuringBatch && panels.length === 1)) {
             const pageId = `page${seqIndex}`;
             const imgId = `img${seqIndex}`;
             const imgFilename = `image${seqIndex}.jpg`;
             const w = page.width || 1200;
             const h = page.height || 1600;

             manifestItems += `    <item id="${pageId}" href="${pageId}.xhtml" media-type="application/xhtml+xml"/>\n`;
             spineItems += `    <itemref idref="${pageId}"/>\n`;
             navItems += `      <li><a href="${pageId}.xhtml">Page ${seqIndex}</a></li>\n`;
             ncxItems += `    <navPoint id="${pageId}" playOrder="${seqIndex}">
      <navLabel><text>Page ${seqIndex}</text></navLabel>
      <content src="${pageId}.xhtml"/>
    </navPoint>\n`;

             manifestItems += `    <item id="${imgId}" href="images/${imgFilename}" media-type="image/jpeg"/>\n`;
             const base64DataRaw = base64Data.split(',')[1];
             zip.file(`OEBPS/images/${imgFilename}`, base64DataRaw, { base64: true });
             
             let textContentHtml = '';
             let hasText = allPageTexts.length > 0;
             if (hasText) {
                 const sortedTexts = sortTextsReadingOrder(allPageTexts);
                 textContentHtml = sortedTexts.map(t => `<p class="panel-text-line">${t.text.replace(/\n/g, ' ')}</p>`).join('');
             }
             
             zip.file(`OEBPS/${pageId}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Page ${seqIndex}</title>
  ${hasText || useReflowable ? '' : `<meta name="viewport" content="width=${w}, height=${h}"/>`}
  <style>
    body { margin: 0; padding: 0; background: ${isNoOptions ? '#fff' : '#000'}; ${hasText || useReflowable ? 'text-align: center;' : `width: ${w}px; height: ${h}px; display: flex; justify-content: center; align-items: center;`} }
    .comic-img { width: 100%; max-width: ${w}px; height: auto; object-fit: contain; }
    .panel-text-container { max-width: 800px; margin: 20px auto; padding: 20px; font-family: sans-serif; background: transparent; color: ${isNoOptions ? '#000' : '#fff'}; text-align: left;}
    .panel-text-line { font-size: 1.2em; line-height: 1.5; margin-bottom: 10px; }
  </style>
</head>
<body>
  <img src="images/${imgFilename}" class="comic-img" alt="Page ${seqIndex}" />
  ${hasText ? `<div class="panel-text-container">${textContentHtml}</div>` : ''}
</body>
</html>`);
             seqIndex++;
         } else if (isSplitOnly) {
             // Reflowable mode for "Split Only" - multiple panels per page
             const pageId = `page${seqIndex}`;
             manifestItems += `    <item id="${pageId}" href="${pageId}.xhtml" media-type="application/xhtml+xml" />\n`;
             spineItems += `    <itemref idref="${pageId}"/>\n`;
             navItems += `      <li><a href="${pageId}.xhtml">Page ${seqIndex}</a></li>\n`;
             ncxItems += `    <navPoint id="${pageId}" playOrder="${seqIndex}">
      <navLabel><text>Page ${seqIndex}</text></navLabel>
      <content src="${pageId}.xhtml"/>
    </navPoint>\n`;

             let panelsHtml = '';
             for (let pIdx = 0; pIdx < panels.length; pIdx++) {
                const p = panels[pIdx];
                const panelImgFilename = `image${seqIndex}_p${pIdx}.jpg`;
                const imgId = `img${seqIndex}_p${pIdx}`;

                let panelTextHtml = '';
                if (p.texts && p.texts.length > 0) {
                   const sortedTexts = sortTextsReadingOrder(p.texts);
                   panelTextHtml = sortedTexts.map(t => `<p class="panel-text-line">${t.text.replace(/\n/g, ' ')}</p>`).join('');
                }

                if (p.base64Image) {
                   const panelBase64DataRaw = p.base64Image.split(',')[1];
                   zip.file(`OEBPS/images/${panelImgFilename}`, panelBase64DataRaw, { base64: true });
                   manifestItems += `    <item id="${imgId}" href="images/${panelImgFilename}" media-type="image/jpeg"/>\n`;
                   panelsHtml += `<div class="panel-box"><img src="images/${panelImgFilename}" class="comic-img" alt="Panel ${pIdx + 1}" /></div>\n`;
                }

                if (panelTextHtml) {
                   panelsHtml += `<div class="panel-text-container">${panelTextHtml}</div>\n`;
                }
             }

             zip.file(`OEBPS/${pageId}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Page ${seqIndex} Panels</title>
  <style>
    body { margin: 0; padding: 0; background: #fff; text-align: center; }
    .panel-box { margin-bottom: 0px; page-break-inside: avoid; display: block; width: 100%; }
    .comic-img { width: 100%; max-width: 1200px; height: auto; display: block; margin: 0 auto; }
    .panel-text-container { max-width: 800px; margin: 20px auto; padding: 20px; font-family: sans-serif; background: transparent; color: #000; text-align: left; }
    .panel-text-line { font-size: 1.2em; line-height: 1.5; margin-bottom: 10px; }
  </style>
</head>
<body>
${panelsHtml}
</body>
</html>`);
             seqIndex++;
         } else {
             // Fixed layout - one per panel (for AI processed pages)
             for (let pIdx = 0; pIdx < panels.length; pIdx++) {
                const p = panels[pIdx];
                const pageId = `page${seqIndex}_p${pIdx}`;
                const panelImgFilename = `image${seqIndex}_p${pIdx}.jpg`;
                const imgId = `img${seqIndex}_p${pIdx}`;
                const w = p.right - p.left;
                const h = p.bottom - p.top;

                let panelTextHtml = '';
                let hasText = p.texts && p.texts.length > 0;
                if (hasText) {
                   const sortedTexts = sortTextsReadingOrder(p.texts);
                   panelTextHtml = sortedTexts.map(t => `<p class="panel-text-line">${t.text.replace(/\n/g, ' ')}</p>`).join('');
                }

                manifestItems += `    <item id="${pageId}" href="${pageId}.xhtml" media-type="application/xhtml+xml"/>\n`;
                spineItems += `    <itemref idref="${pageId}"/>\n`;
                
                if (pIdx === 0) {
                    navItems += `      <li><a href="${pageId}.xhtml">Page ${seqIndex}</a></li>\n`;
                    ncxItems += `    <navPoint id="${pageId}" playOrder="${seqIndex}">
      <navLabel><text>Page ${seqIndex}</text></navLabel>
      <content src="${pageId}.xhtml"/>
    </navPoint>\n`;
                }

                if (p.base64Image) {
                   const panelBase64DataRaw = p.base64Image.split(',')[1];
                   zip.file(`OEBPS/images/${panelImgFilename}`, panelBase64DataRaw, { base64: true });
                   manifestItems += `    <item id="${imgId}" href="images/${panelImgFilename}" media-type="image/jpeg"/>\n`;
                }
                
                zip.file(`OEBPS/${pageId}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Page ${seqIndex} Panel ${pIdx + 1}</title>
  ${hasText || useReflowable ? '' : `<meta name="viewport" content="width=${w}, height=${h}"/>`}
  <style>
    body { margin: 0; padding: 0; background: #000; ${hasText || useReflowable ? 'text-align: center;' : `width: ${w}px; height: ${h}px; display: flex; justify-content: center; align-items: center; overflow: hidden;`} }
    .comic-img { width: 100%; max-width: ${w}px; height: auto; object-fit: contain; display: block; margin: 0 auto; }
    .panel-text-container { max-width: 800px; margin: 20px auto; padding: 20px; font-family: sans-serif; background: transparent; color: #fff; text-align: left; }
    .panel-text-line { font-size: 1.2em; line-height: 1.5; margin-bottom: 10px; }
  </style>
</head>
<body>
  <img src="images/${panelImgFilename}" class="comic-img" alt="Panel ${pIdx + 1}"/>
  ${hasText ? `<div class="panel-text-container">${panelTextHtml}</div>` : ''}
</body>
</html>`);
             }
             seqIndex++;
         }
      }
    }

    const uuid = `comic-${Date.now()}`;
    const ncxContent = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${uuid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>Comic Book Export</text></docTitle>
  <navMap>
${ncxItems}  </navMap>
</ncx>`;
    zip.file("OEBPS/toc.ncx", ncxContent);

    const opfContent = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:${uuid}</dc:identifier>
    <dc:title>Comic Book Export</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.[0-9]+Z$/, 'Z')}</meta>
    ${isSplitOnly ? `
    <meta property="rendition:layout">reflowable</meta>
    ` : `
    <!-- Fixed Layout Metadata -->
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">portrait</meta>
    <meta property="rendition:spread">none</meta>
    <meta name="fixed-layout" content="true"/>
    <meta name="book-type" content="comic"/>
    <meta name="primary-writing-mode" content="horizontal-lr"/>
    <meta name="zero-gutter" content="true"/>
    <meta name="zero-margin" content="true"/>
    `}
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifestItems}  </manifest>
  <spine toc="ncx">
${spineItems}  </spine>
</package>`;
    zip.file("OEBPS/content.opf", opfContent);

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

    const content = await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'comic_book.epub';
    a.click();
    toast.success("EPUB generated successfully!");
    setShowCoffeeModal(true);
  };

  const downloadText = () => {
    const exportPages = getExportablePages();
    let textContent = "";
    for (let i = 0; i < exportPages.length; i++) {
       const page = exportPages[i];
       const allTexts = [...(page.detectedTexts || []), ...(page.manualTexts || [])];
       // Include text for all selected/exported pages
       if (allTexts.length > 0) {
         textContent += `--- Page ${i + 1} ---\n`;
         const sortedTexts = sortTextsReadingOrder(allTexts);
         for (let textObj of sortedTexts) {
           textContent += `${textObj.text}\n`;
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
    setShowCoffeeModal(true);
  };

  const processSidebarContent = (
    <div className="space-y-6 w-fit flex flex-col items-center shrink-0">
      {activePage?.detectedTexts && activePage.detectedTexts.length > 0 && (
        <div className="space-y-3 max-h-[320px] flex flex-col mb-4 w-fit items-center">
          <div className="flex items-center shrink-0 gap-4 w-fit">
            <span className="text-sm font-medium whitespace-nowrap">Page {currentPageIndex + 1} Texts</span>
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              {activePage.detectedTexts.length}
            </span>
          </div>
          <div className="overflow-y-auto space-y-2 pr-2 custom-scrollbar pb-2 max-h-[282px] w-fit">
            {sortTextsReadingOrder(activePage.detectedTexts).map((t, i) => (
              <div 
                key={i}
                className={cn(
                  "p-2 rounded border text-xs cursor-pointer transition-colors hover:bg-muted flex items-start gap-2 min-w-0 max-w-[200px]",
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

      <div className={cn("shrink-0 w-fit", activePage?.detectedTexts && activePage.detectedTexts.length > 0 && "pt-4 border-t")}>
        <div className="space-y-4 w-fit flex flex-col items-center">
          <div className="flex flex-col gap-3 items-center w-fit pb-2">
            <div 
              className="flex items-center gap-3 p-2 rounded-none hover:bg-accent/50 cursor-pointer transition-colors w-fit justify-center"
              onClick={() => {
                const allSelected = ocrDuringBatch && splitDuringBatch && translateDuringBatch;
                setOcrDuringBatch(!allSelected);
                setSplitDuringBatch(!allSelected);
                setTranslateDuringBatch(!allSelected);
              }}
            >
              <div className={`shrink-0 w-4 h-4 border flex items-center justify-center transition-colors ${ocrDuringBatch && splitDuringBatch && translateDuringBatch ? 'bg-primary border-primary' : 'border-muted-foreground'}`}>
                {ocrDuringBatch && splitDuringBatch && translateDuringBatch && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
              </div>
              <label className="text-xs font-bold cursor-pointer uppercase tracking-wider text-muted-foreground whitespace-nowrap">All (process all)</label>
            </div>

            <div className="pl-2 space-y-2.5 border-l-2 border-muted ml-0.5 w-fit flex flex-col items-start">
              <div className="flex items-center gap-3 cursor-pointer group w-fit" onClick={() => setSplitDuringBatch(!splitDuringBatch)}>
                <Checkbox 
                  checked={splitDuringBatch} 
                  onCheckedChange={(c) => setSplitDuringBatch(!!c)}
                  className="w-4 h-4 border-muted-foreground rounded-none"
                />
                <div className="flex flex-col w-fit">
                  <label className="text-sm font-medium cursor-pointer group-hover:text-primary transition-colors whitespace-nowrap">Split Panels</label>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">Detect and individualize panels</span>
                </div>
              </div>
              <div className="flex items-center gap-3 cursor-pointer group w-fit" onClick={() => setOcrDuringBatch(!ocrDuringBatch)}>
                <Checkbox 
                  checked={ocrDuringBatch} 
                  onCheckedChange={(c) => setOcrDuringBatch(!!c)}
                  className="w-4 h-4 border-muted-foreground rounded-none"
                />
                <div className="flex flex-col w-fit">
                  <label className="text-sm font-medium cursor-pointer group-hover:text-primary transition-colors whitespace-nowrap">Extract Text (OCR)</label>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">Extract text via Gemini Flash</span>
                </div>
              </div>
              <div className="flex items-center gap-3 cursor-pointer group w-fit" onClick={() => setTranslateDuringBatch(!translateDuringBatch)}>
                <Checkbox 
                  id="translate-batch-sb" 
                  checked={translateDuringBatch} 
                  onCheckedChange={(c) => setTranslateDuringBatch(!!c)} 
                  className="w-4 h-4 border-muted-foreground rounded-none"
                />
                <label className="text-sm font-medium cursor-pointer group-hover:text-primary transition-colors whitespace-nowrap">Translate Text</label>
              </div>
            </div>

            {translateDuringBatch && (
              <div className="mt-1 animate-in fade-in slide-in-from-top-1 px-1 w-fit">
                <Select value={batchTargetLanguage} onValueChange={setBatchTargetLanguage}>
                  <SelectTrigger className="w-[140px] h-8 text-[11px]">
                    <SelectValue placeholder="Select Language" />
                  </SelectTrigger>
                  <SelectContent>
                    <div className="max-h-[200px] overflow-y-auto">
                      {LANGUAGES.map(lang => (
                        <SelectItem key={lang} value={lang} className="text-xs">{lang}</SelectItem>
                      ))}
                    </div>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <Button 
            variant="ghost"
            className="w-fit gap-2 h-9" 
            onClick={() => processPage(currentPageIndex)} 
            disabled={activePage?.status === 'processing' || isBatchProcessing || activePage?.isIgnored}
          >
            {activePage?.status === 'processing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span className="whitespace-nowrap">Process Current Page</span>
          </Button>

          <Button 
            variant="ghost"
            className="w-fit gap-2 h-9" 
            onClick={handleBatchProcess} 
            disabled={isBatchProcessing || pages.length === 0 || (pages.every(p => !needsPageProcessing(p)) && (ocrDuringBatch || splitDuringBatch || translateDuringBatch))}
          >
            {isBatchProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : (!ocrDuringBatch && !splitDuringBatch && !translateDuringBatch ? <Download className="w-4 h-4" /> : <Play className="w-4 h-4" />)}
            <span className="whitespace-nowrap">
              {(!ocrDuringBatch && !splitDuringBatch && !translateDuringBatch) 
                ? (selectedPages.size > 0 ? `Export Selected (${selectedPages.size})` : "Export Directly")
                : (selectedPages.size > 0 ? `Batch Process Selected (${selectedPages.size})` : "Batch Process All")
              }
            </span>
          </Button>
          
          <div className="pt-4 border-t mt-4 space-y-2 flex flex-col items-center w-fit">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                  <Button 
                    variant="ghost" 
                    className="w-fit gap-2 h-9"
                    disabled={pages.length === 0 || (!pages.some(p => p.status === 'done' || p.isIgnored) && (ocrDuringBatch || splitDuringBatch || translateDuringBatch))} 
                  >
                    <Download className="w-4 h-4" /> <span className="whitespace-nowrap">Export</span>
                  </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-48" align="center">
                <DropdownMenuItem onClick={downloadText} className="cursor-pointer">
                  <Download className="w-4 h-4 mr-2" /> TXT
                </DropdownMenuItem>
                <DropdownMenuItem onClick={downloadHtml} className="cursor-pointer">
                  <Download className="w-4 h-4 mr-2" /> HTML
                </DropdownMenuItem>
                <DropdownMenuItem onClick={downloadPdf} className="cursor-pointer">
                  <Download className="w-4 h-4 mr-2" /> PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={downloadEpub} className="cursor-pointer">
                  <Book className="w-4 h-4 mr-2" /> EPUB
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowGithubModal(true)} className="cursor-pointer text-sky-600 dark:text-sky-400 font-medium hover:text-sky-700 dark:hover:text-sky-300">
                  <Github className="w-4 h-4 mr-2" /> Sync to GitHub
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <a 
              href="https://www.amazon.com/sendtokindle/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5 mt-1 underline underline-offset-4 w-fit"
            >
              <span className="whitespace-nowrap">Send to Kindle</span> <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          <Button 
            variant="ghost" 
            className="w-fit gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 mt-4 h-9" 
            onClick={() => {
              setPages([]);
              setCurrentPageIndex(0);
            }}
          >
            <Trash2 className="w-4 h-4" />
            <span className="whitespace-nowrap">Clear All Pages</span>
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {pages.length === 0 ? (
        <div className="relative max-w-6xl mx-auto p-6 space-y-8">
          <div className="fixed top-4 right-4 z-50 flex gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} 
              className="w-10 h-10 rounded-full hover:bg-muted text-primary bg-transparent"
              title="Toggle Dark Mode"
            >
              {isDarkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </Button>
          </div>

          <header className="text-center space-y-2 pt-4">
            <h1 className="text-4xl font-bold tracking-tight text-foreground flex items-center justify-center gap-4">
              <motion.div 
                whileHover={{ scale: 1.05 }}
                className="h-10 flex items-center justify-center"
              >
                <img src="/logo.png" alt="Logo" className="h-full w-auto block select-none" />
              </motion.div>
              EbookCC
            </h1>
            <p className="text-muted-foreground text-lg font-bold">
              All you need to create and convert ebook
            </p>
            <Slideshow />
          </header>

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
                <p className="text-xl font-medium">Drop files here</p>
                <p className="text-sm text-muted-foreground mt-1">Supported: EPUB, CBZ, ZIP, PDF, IMAGES</p>
                <p className="text-muted-foreground">or click to browse files</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="h-screen bg-background flex flex-col overflow-hidden">
          <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md">
            <div className="w-full px-2 h-11 flex items-center justify-between gap-2">
              {/* Left Actions */}
              <div className="flex flex-1 items-center gap-0.5 overflow-x-auto no-scrollbar py-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                  className="w-8 h-8 shrink-0"
                  title={isSidebarOpen ? "Hide Sidebar" : "Show Sidebar"}
                >
                  {isSidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
                </Button>
                <div className="w-px h-5 bg-border mx-0.5 shrink-0" />
                
                {/* Tools Group (Always Visible) */}
                <div className="flex items-center gap-0.5">
                  {/* Portrait/Mobile Tools Group */}
                  <div className={cn("flex", !isPortrait && "sm:hidden")}>
                    {isGridView ? (
                      <Button 
                        variant="secondary" 
                        size="sm" 
                        onClick={() => {
                          setIsGridView(false);
                          setSelectedPages(new Set());
                          setLastSelectedIndex(null);
                        }}
                        className="h-8 px-3 gap-1.5 shrink-0 text-xs font-bold"
                      >
                        <CheckSquare className="w-4 h-4" /> <span>Done</span>
                      </Button>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 px-2 gap-1 shrink-0">
                            <Sparkles className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-48">
                          <DropdownMenuItem onClick={() => {
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.accept = 'image/*';
                            input.onchange = async (e) => {
                              const target = e.target as HTMLInputElement;
                              if (target.files && target.files[0]) {
                                const file = target.files[0];
                                const reader = new FileReader();
                                reader.onload = (event) => {
                                  const base64 = event.target?.result as string;
                                  const img = new Image();
                                  img.onload = () => {
                                    const updatedPages = [...pages];
                                    const pageIndex = currentPageIndex;
                                    const page = { ...updatedPages[pageIndex] };
                                    const pageRatio = page.width > 0 ? page.height / page.width : 1.5;
                                    const imgRatio = img.width > 0 ? img.width / img.height : 1;
                                    const relativeW = page.width > 0 ? ((img.width * 0.25) / page.width) * 1000 : 300;
                                    const initW = Math.round(relativeW);
                                    const initH = Math.round(initW / (pageRatio * imgRatio));
                                    const newImage: ManualImage = {
                                      id: Math.random().toString(36).substr(2, 9),
                                      url: base64,
                                      aspectRatio: imgRatio,
                                      box_2d: [100, 100, 100 + initH, 100 + initW],
                                      isHighContrast: false,
                                      color: '#000000'
                                    };
                                    page.manualImages = [...(page.manualImages || []), newImage];
                                    updatedPages[pageIndex] = page;
                                    setPages(updatedPages);
                                    setSelectedManualImageId(newImage.id);
                                    setSelectedManualTextId(null);
                                  };
                                  img.src = base64;
                                };
                                reader.readAsDataURL(file);
                              }
                            };
                            input.click();
                          }}>
                            <Upload className="w-4 h-4 mr-2" /> Insert Image
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => {
                            setViewMode('preview');
                            setIsAddingTextMode(true);
                          }}>
                            <Type className="w-4 h-4 mr-2" /> Add Text
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => {
                            setIsGridView(true);
                            setSelectedPages(new Set());
                            setLastSelectedIndex(null);
                          }}>
                            <CheckSquare className="w-4 h-4 mr-2" /> Select
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>

                  {/* Desktop Tools */}
                  <div className={cn("items-center gap-0.5", isPortrait ? "hidden" : "hidden sm:flex")}>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'image/*';
                        input.onchange = async (e) => {
                          const target = e.target as HTMLInputElement;
                          if (target.files && target.files[0]) {
                            const file = target.files[0];
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              const base64 = event.target?.result as string;
                              const img = new Image();
                              img.onload = () => {
                                const updatedPages = [...pages];
                                const pageIndex = currentPageIndex;
                                const page = { ...updatedPages[pageIndex] };
                                
                                const pageRatio = page.width > 0 ? page.height / page.width : 1.5;
                                const imgRatio = img.width > 0 ? img.width / img.height : 1;
                                
                                // Insert scaled to 25% of its natural size for better view
                                const relativeW = page.width > 0 ? ((img.width * 0.25) / page.width) * 1000 : 300;
                                const initW = relativeW;
                                const initH = initW / (pageRatio * imgRatio);

                                const newImage: ManualImage = {
                                  id: Math.random().toString(36).substr(2, 9),
                                  url: base64,
                                  aspectRatio: imgRatio,
                                  box_2d: [100, 100, 100 + initH, 100 + initW],
                                  isHighContrast: false,
                                  color: '#000000'
                                };
                                
                                page.manualImages = [...(page.manualImages || []), newImage];
                                updatedPages[pageIndex] = page;
                                setPages(updatedPages);
                                setSelectedManualImageId(newImage.id);
                                setSelectedManualTextId(null);
                              };
                              img.src = base64;
                            };
                            reader.readAsDataURL(file);
                          }
                        };
                        input.click();
                      }}
                      className="gap-1.5 h-8 px-2 shrink-0 text-xs"
                    >
                      <Upload className="w-3.5 h-3.5" /> <span className={cn(isPortrait ? "hidden" : "hidden md:inline")}>Insert Image</span>
                    </Button>
                    <Button 
                      variant={(isAddingTextMode) ? "secondary" : "ghost"} 
                      size="sm" 
                      onClick={() => {
                        setViewMode('preview');
                        setIsAddingTextMode(!isAddingTextMode);
                      }}
                      className="gap-1.5 h-8 px-2 shrink-0 text-xs"
                    >
                      <Type className="w-3.5 h-3.5" /> <span className={cn(isPortrait ? "hidden" : "hidden md:inline")}>Add Text</span>
                    </Button>
                  </div>
                </div>

                <div className="w-px h-5 bg-border mx-0.5 shrink-0" />
                
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
                      className={cn("gap-1.5 h-8 px-2 shrink-0 text-xs", isPortrait ? "hidden" : "hidden sm:flex")}
                    >
                      <CheckSquare className="w-3.5 h-3.5" /> <span className={cn(isPortrait ? "hidden" : "hidden md:inline")}>{isGridView ? "Done" : "Select"}</span>
                    </Button>

                {/* Bulk Actions Floating Bar (Sole Layer underneath Select) */}
                <AnimatePresence>
                  {isGridView && (
                    <motion.div
                      initial={{ y: -10, opacity: 0 }}
                      animate={{ y: 38, opacity: 1 }}
                      exit={{ y: -10, opacity: 0 }}
                      transition={{ type: "spring", damping: 20, stiffness: 300 }}
                      className="absolute left-4 top-0 bg-background/95 backdrop-blur-sm border border-border shadow-md rounded-lg px-2 py-1.5 flex items-center gap-1.5 z-[60] pointer-events-auto"
                    >
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
                        className="gap-1.5 h-7 px-2 shrink-0 text-[10px] font-bold uppercase tracking-wider"
                      >
                        <Upload className="w-3.5 h-3.5" /> <span>Add Page</span>
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
                        className="gap-1.5 h-7 px-2 shrink-0 text-[10px] font-bold uppercase tracking-wider"
                      >
                        <CheckSquare className="w-3.5 h-3.5" /> <span>{selectedPages.size === pages.length ? "Deselect All" : "Select All"}</span>
                      </Button>
                      
                      {selectedPages.size > 0 && (
                        <>
                          <div className="w-px h-4 bg-border mx-0.5 shrink-0" />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const sortedSelected = Array.from(selectedPages).sort((a: any, b: any) => a - b);
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
                            className="h-7 w-7 p-0 shrink-0"
                            disabled={Array.from(selectedPages).some((idx: any) => idx === 0)}
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const sortedSelected = Array.from(selectedPages).sort((a: any, b: any) => b - a);
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
                            className="h-7 w-7 p-0 shrink-0"
                            disabled={Array.from(selectedPages).some((idx: any) => idx === pages.length - 1)}
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const newPages = [...pages];
                              selectedPages.forEach(idx => {
                                newPages[idx as number].isIgnored = !newPages[idx as number].isIgnored;
                              });
                              setPages(newPages);
                              setSelectedPages(new Set());
                            }}
                            className="h-7 w-7 p-0 shrink-0"
                            title="Ignore Selected"
                          >
                            <X className="w-3.5 h-3.5" />
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
                            className="h-7 w-7 p-0 shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Center Brand */}
              <div className="flex shrink-0 items-center justify-center gap-2">
                 <motion.div 
                   whileHover={{ scale: 1.05 }}
                   className="h-8 w-8 flex items-center justify-center"
                 >
                   <img src="/logo.png" alt="Logo" className="h-full w-auto block select-none" />
                 </motion.div>
                 <h1 className={cn("text-lg font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent", isPortrait ? "hidden" : "hidden sm:block")}>EbookCC</h1>
              </div>

              {/* Right Actions */}
              <div className="flex flex-1 items-center justify-end gap-0.5">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => setShowApiKeyModal(true)} 
                  className="w-8 h-8 rounded-md hover:bg-muted"
                  title="App Settings"
                >
                  <Settings className="w-5 h-5" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} 
                  className="w-8 h-8 rounded-md hover:bg-muted"
                  title="Toggle Dark Mode"
                >
                  {isDarkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                </Button>
              </div>
            </div>
          </header>

          <main className="flex-1 relative w-full overflow-hidden flex">
            {/* Sidebar Thumbnails */}
            <AnimatePresence initial={false}>
              {isSidebarOpen && !isGridView && (
                <motion.aside
                  initial={{ x: -180, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -180, opacity: 0 }}
                  transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                  className="relative z-40 w-[160px] border-r bg-background/95 backdrop-blur-md shadow-sm flex flex-col overflow-hidden h-full shrink-0"
                >
                  <div className="p-3 border-b shrink-0 flex items-center justify-between">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Pages</span>
                    <div className="flex items-center gap-1">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-5 w-5 rounded-none hover:bg-muted" 
                        onClick={() => setCurrentPageIndex(p => Math.max(0, p - 1))}
                        disabled={currentPageIndex === 0}
                      >
                        <ChevronLeft className="w-3 h-3" />
                      </Button>
                      <div className="flex items-center gap-0.5">
                        <input
                          type="text"
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
                          className="w-7 h-5 text-[10px] text-center bg-muted border-none p-0 focus-visible:ring-1 focus-visible:ring-primary rounded-none font-bold"
                        />
                        <span className="text-[9px] text-muted-foreground/60 font-mono">/ {pages.length}</span>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-5 w-5 rounded-none hover:bg-muted" 
                        onClick={() => setCurrentPageIndex(p => Math.min(pages.length - 1, p + 1))}
                        disabled={currentPageIndex === pages.length - 1}
                      >
                        <ChevronRight className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto no-scrollbar p-2 space-y-2">
                    {pages.map((page, idx) => (
                      <div 
                        key={page.id}
                        id={`thumb-${idx}`}
                        onClick={() => setCurrentPageIndex(idx)}
                        className={cn(
                          "relative aspect-[2/3] w-full rounded-none overflow-hidden cursor-pointer border-2 transition-all bg-white",
                          currentPageIndex === idx 
                            ? "border-primary shadow-md ring-2 ring-primary outline outline-2 outline-primary outline-offset-2" 
                            : "border-black/20 hover:border-black/60 opacity-85 hover:opacity-100 outline outline-1 outline-black/10"
                        )}
                      >
                        <img src={page.originalImage} className="w-full h-full object-cover" alt={`Thumb ${idx}`} />
                        <div className="absolute bottom-1 left-1 bg-black text-white text-[7px] font-bold px-1 py-0.5 rounded-none min-w-[14px] text-center">
                          {idx + 1}
                        </div>
                        {page.status === 'done' && (
                          <div className="absolute top-1 right-1 bg-green-500 rounded-none p-0.5 shadow-sm">
                            <Check className="w-2 h-2 text-white" />
                          </div>
                        )}
                        {page.status === 'processing' && (
                          <div className="absolute inset-0 bg-background/40 flex items-center justify-center">
                            <Loader2 className="w-4 h-4 text-white animate-spin" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.aside>
              )}
            </AnimatePresence>

            <div className="flex-1 flex overflow-hidden relative">
              {/* Main Content Area */}
              <div className="flex-1 overflow-y-auto no-scrollbar relative h-full">
                <div className={cn(
                  "w-full pt-0",
                  isPortrait ? "px-4 md:px-6 max-w-[1600px] mx-auto" : "pl-4 md:pl-6 pr-0 max-w-none"
                )}>
                  <div className={cn("w-full space-y-0", !isGridView && !isPortrait && "pr-4")}>
                    
                    {isGridView ? (
                      <Card className="p-6 bg-foreground/5 rounded-none border-2 border-muted min-h-[500px] mt-4">
                        <div className={cn("grid gap-4", isPortrait ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5")}>
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
                                "relative aspect-[2/3] rounded-none overflow-hidden cursor-pointer border-2 transition-all bg-white",
                                selectedPages.has(idx) ? "border-primary shadow-lg scale-95" : "border-black/30 hover:border-primary/50 hover:scale-[1.02]",
                                page.isIgnored && !selectedPages.has(idx) && "opacity-50"
                              )}
                            >
                              <img src={page.originalImage} className="w-full h-full object-cover" alt={`Page ${idx + 1}`} />
                              <div className="absolute top-2 left-2 bg-black text-white text-[10px] px-1.5 py-0.5 rounded-none font-mono">
                                {(idx + 1).toString().padStart(2, '0')}
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
                      <div className="relative w-full flex items-center justify-center p-0">
                        {activePage ? (
                          <div 
                            className={cn(
                              "relative w-full transition-opacity duration-300", 
                              activePage.isIgnored ? "opacity-50" : "opacity-100",
                              isAddingTextMode ? "cursor-crosshair" : "cursor-default"
                            )} 
                          >
                            <div className="relative mx-auto w-fit h-fit" ref={editorContainerRef}>
                              <div
                                className="relative"
                                onClick={(e) => {
                                  if (isAddingTextMode) {
                                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                    const x = ((e.clientX - rect.left) / rect.width) * 1000;
                                    const y = ((e.clientY - rect.top) / rect.height) * 1000;
                                    const boxW = 200;
                                    const boxH = 40;
                                    const newTextId = Math.random().toString(36).substr(2, 9);
                                    const newText: ManualText = {
                                      id: newTextId,
                                      text: "",
                                      box_2d: [
                                        Math.max(0, y - boxH / 2),
                                        Math.max(0, x - boxW / 2),
                                        Math.min(1000, y + boxH / 2),
                                        Math.min(1000, x + boxW / 2)
                                      ],
                                      color: "#000000",
                                      fontSize: 72
                                    };
                                    const updatedPages = [...pages];
                                    const page = { ...updatedPages[currentPageIndex] };
                                    page.manualTexts = [...(page.manualTexts || []), newText];
                                    updatedPages[currentPageIndex] = page;
                                    setPages(updatedPages);
                                    setSelectedManualTextId(newTextId);
                                    setIsAddingTextMode(false);
                                    return;
                                  }

                                  if (selectedManualImageId || selectedManualTextId || editingIndex !== null) {
                                    setSelectedManualImageId(null);
                                    setSelectedManualTextId(null);
                                    setEditingIndex(null);
                                    return;
                                  }

                                  if (activePage.isTextOnly) {
                                    setIsGridView(true);
                                    return;
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
                              {viewMode === 'preview' && activePage.isTextOnly ? (
                                <div className="w-full h-auto bg-white p-8 sm:p-16 text-black flex flex-col gap-6" style={{ minHeight: '600px' }}>
                                  {sortTextsReadingOrder(activePage.detectedTexts).map((item, idx) => {
                                    const fontSizeCqi = activePage.width > 0 ? (Math.max(16, activePage.width * 0.015) / activePage.width) * 100 : 2;
                                    return (
                                    <div 
                                      key={`${activePage.id}-${idx}`} 
                                      className="text-left font-serif whitespace-pre-wrap"
                                      style={{ 
                                        fontSize: `calc(var(--cw, 800px) * ${fontSizeCqi / 100})`,
                                        lineHeight: 1.6
                                      }}
                                    >
                                      {item.text}
                                    </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <>
                                  {viewMode === 'preview' && activePagePanels.length > 0 ? (
                                    <div className="flex flex-col gap-8 max-h-[calc(100vh-3rem)] overflow-y-auto p-4 w-full">
                                      {activePagePanels.map((panel, pIdx) => (
                                        <div key={pIdx} className="overflow-hidden bg-white max-w-[600px] mx-auto border border-gray-100 rounded-lg shadow-md p-6 flex flex-col items-center gap-6">
                                          {panel.base64Image && (
                                            <div className="w-full flex justify-center overflow-hidden">
                                              <img
                                                src={panel.base64Image}
                                                alt={`Panel ${pIdx + 1}`}
                                                className="max-h-[400px] object-contain rounded border border-gray-100"
                                              />
                                            </div>
                                          )}
                                          {panel.texts && panel.texts.length > 0 && (
                                            <div className="w-full text-left p-4 bg-slate-50 border-l-4 border-primary rounded">
                                              {sortTextsReadingOrder(panel.texts).map((t, tIdx) => (
                                                <p key={tIdx} className="text-base font-serif text-slate-800 leading-relaxed mb-3 last:mb-0">
                                                  {t.text}
                                                </p>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  ) : viewMode === 'preview' && isPanelsLoading ? (
                                    <div className="flex flex-col items-center justify-center py-20 gap-3">
                                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                      <p className="text-sm text-muted-foreground font-medium">Splitting panels & loading preview...</p>
                                    </div>
                                  ) : (
                                    <>
                                      <img
                                        ref={imageRef}
                                        src={viewMode === 'edit' ? activePage.originalImage : (activePage.cleanedImage || activePage.originalImage)}
                                        alt={`Page ${currentPageIndex + 1}`}
                                        className="max-h-[calc(100vh-3rem)] w-auto block bg-white border border-black mx-auto"
                                      />
                                      {activePage.status === 'done' && activePage.detectedTexts.length > 0 && (
                                        <div className="mt-8 mb-12 p-8 bg-white text-black border-t text-left">
                                          <h3 className="text-lg font-bold mb-6 border-b pb-2 flex items-center gap-2">
                                            <Book className="w-5 h-5 text-primary" /> Extracted Text
                                          </h3>
                                          <div className="space-y-6">
                                            {sortTextsReadingOrder(activePage.detectedTexts).map((item, idx) => (
                                              <div key={idx} className="group relative">
                                                <div className="absolute -left-6 top-1 text-[10px] text-muted-foreground opacity-50 font-mono">
                                                  {(idx + 1).toString().padStart(2, '0')}
                                                </div>
                                                <p className="text-xl leading-relaxed font-serif whitespace-pre-wrap select-text">
                                                  {item.text}
                                                </p>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </>
                                  )}
                                <AnimatePresence>
                                  {viewMode === 'edit' && sortTextsReadingOrder(activePage.detectedTexts).map((item, idx) => {
                                    const boxStyle = getBoxStyle(item.box_2d, activePage.width, activePage.height);
                                    const boxToUse = item.box_2d || [0,0,0,0];
                                    const [ymin, xmin, ymax, xmax] = boxToUse;
                                    const textW = ((xmax - xmin) / 1000) * activePage.width;
                                    const textH = ((ymax - ymin) / 1000) * (activePage.height || 1);
                                    let estimatedFontSizePx = calculateOptimalFontSize(item.text.trim(), textW * 0.95, textH * 0.95);
                                    const fontSizeCqi = activePage.width > 0 ? (Math.max(4, estimatedFontSizePx) / activePage.width) * 100 : 2;
                                    return (
                                      <motion.div
                                        key={`${activePage.id}-${idx}`}
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className={cn(
                                          "absolute group transition-all flex items-center justify-center overflow-hidden",
                                          viewMode === 'edit' && "cursor-pointer border border-transparent hover:border-primary hover:bg-primary/10",
                                          editingIndex === idx && "border-primary bg-white z-10",
                                          viewMode === 'preview' && "select-text"
                                        )}
                                        style={{ ...boxStyle, backgroundColor: 'transparent' }}
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
                                              style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: `calc(var(--cw, 800px) * ${fontSizeCqi / 100})`, lineHeight: 1.25 }}
                                              value={tempText}
                                              onChange={(e) => setTempText(e.target.value)}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                  e.preventDefault();
                                                  handleSaveEdit(idx);
                                                }
                                              }}
                                            />
                                            <div className="absolute -bottom-8 right-0 flex gap-1 bg-white p-1 rounded border">
                                              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleSaveEdit(idx)}>
                                                <Check className="h-3 w-3 text-green-600" />
                                              </Button>
                                              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingIndex(null)}>
                                                <X className="h-3 w-3 text-red-600" />
                                              </Button>
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="w-full h-full flex items-center justify-center overflow-hidden transition-all duration-300 opacity-100">
                                            <div 
                                              className={cn("font-medium text-black whitespace-pre-wrap text-center", viewMode === 'preview' ? "" : "bg-white/90 px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity")}
                                              style={{ fontFamily: "Helvetica, Arial, sans-serif", wordBreak: 'break-word', textWrap: 'balance', fontSize: `calc(var(--cw, 800px) * ${fontSizeCqi / 100})`, lineHeight: 1.25 }}
                                            >
                                              {item.text}
                                            </div>
                                          </div>
                                        )}
                                      </motion.div>
                                    );
                                  })}
                                  {activePage.manualImages?.map((img) => (
                                    <ImageItem key={img.id} img={img} activePage={activePage} currentPageIndex={currentPageIndex} isSelected={selectedManualImageId === img.id} setSelectedManualImageId={setSelectedManualImageId} pages={pages} setPages={setPages} viewMode={viewMode} pageRatio={activePage.width > 0 ? activePage.height / activePage.width : 1.5} setIsAddingTextMode={setIsAddingTextMode} />
                                  ))}
                                  {activePage.manualTexts?.map((mt) => (
                                    <ManualTextItem key={mt.id} mt={mt} activePage={activePage} currentPageIndex={currentPageIndex} isSelected={selectedManualTextId === mt.id} viewMode={viewMode} setSelectedManualTextId={setSelectedManualTextId} setSelectedManualImageId={setSelectedManualImageId} setOriginalTextBeforeEdit={setOriginalTextBeforeEdit} originalTextBeforeEdit={originalTextBeforeEdit} pages={pages} setPages={setPages} manualTextRef={manualTextRef} setIsAddingTextMode={setIsAddingTextMode} />
                                  ))}
                                </AnimatePresence>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                    )}

                    {/* Process Sidebar in Portrait or Grid View */}
                    {(isPortrait || isGridView) && (
                      <div className="mt-8 pb-12 border-t pt-8">
                        <div className="w-fit mx-auto">
                           {processSidebarContent}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Sidebar for Landscape */}
              {!isPortrait && !isGridView && (
                <aside className="w-fit min-w-0 max-w-[320px] shrink-0 border-l bg-background/50 backdrop-blur-md flex flex-col h-full overflow-y-auto no-scrollbar sticky top-0">
                  <div className="px-3 py-6 w-fit">
                    {processSidebarContent}
                  </div>
                </aside>
              )}
            </div>
          </main>
        </div>
      )}
      {/* Settings Modal */}
      <AnimatePresence>
        {showApiKeyModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/50 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-background border rounded-xl shadow-2xl p-6 w-full space-y-4 my-8 max-h-[90vh] overflow-y-auto custom-scrollbar max-w-xl"
            >
              <h2 className="text-xl font-bold mb-4">App Settings</h2>

              <div className="space-y-4">
                {/* Engine Selector Tab */}
                <div className="flex bg-muted p-1 rounded-lg border border-border">
                  <button
                    id="engine-gemini-btn"
                    onClick={() => setLlmEngine('gemini')}
                    className={cn(
                      "flex-1 text-center py-1.5 text-xs font-medium rounded-md transition-colors",
                      llmEngine === 'gemini' 
                        ? "bg-background text-foreground shadow-sm font-semibold" 
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Google Gemini (Cloud)
                  </button>
                  <button
                    id="engine-local-btn"
                    onClick={() => setLlmEngine('local')}
                    className={cn(
                      "flex-1 text-center py-1.5 text-xs font-medium rounded-md transition-colors",
                      llmEngine === 'local' 
                        ? "bg-background text-foreground shadow-sm font-semibold" 
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Local LLM (Ollama/LM Studio/OpenAI)
                  </button>
                </div>

                {llmEngine === 'gemini' ? (
                  <div className="space-y-4 pt-2">
                    <h3 className="font-semibold text-primary text-sm flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-emerald-500 animate-pulse" />
                      Gemini AI Cloud Engine
                    </h3>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      We use <code className="bg-muted px-1 rounded">gemini-flash-lite-latest</code> for high-precision OCR and translation. 
                      I've added <b>automatic retry logic</b> and <b>backoff</b> to handle free-tier rate limits, but a personal API key is recommended for large batches.
                      <br />
                      <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-primary hover:underline font-medium">
                        Get your free Gemini API Key here
                      </a>
                    </p>
                    <div>
                      <label className="text-xs font-semibold text-foreground">Gemini API Key</label>
                      <input
                        id="gemini-api-key-input"
                        type="password"
                        value={customApiKey}
                        onChange={(e) => setCustomApiKey(e.target.value)}
                        placeholder="AIzaSy..."
                        className="w-full mt-1.5 px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm font-sans"
                      />
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Your key is stored only in your browser's local storage.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between border-b pb-2">
                      <div className="flex items-center gap-2">
                        <Coffee className="w-4 h-4 text-sky-500" />
                        <h3 className="font-semibold text-primary text-sm">
                          Local LLM Translation & OCR Settings
                        </h3>
                      </div>
                      <span className="text-[10px] bg-sky-500/10 text-sky-700 dark:text-sky-400 font-semibold px-2 py-0.5 rounded-full border border-sky-500/20 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
                        Self-Hosted Setup
                      </span>
                    </div>

                    <p className="text-muted-foreground text-xs leading-relaxed">
                      Run standard OpenAI-compatible APIs on your device (Ollama, LM Studio, or Llama.cpp) for secure, private translations and offline bubble text extraction.
                    </p>

                    <div className="space-y-5 pt-1">
                      {/* Input Form Fields (Fully Stretched/Stacked in same-sized modal) */}
                      <div className="space-y-4">
                        <div>
                          <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                            Local API Base URL
                          </label>
                          <input
                            id="local-llm-url-input"
                            type="text"
                            value={localLlmUrl}
                            onChange={(e) => setLocalLlmUrl(e.target.value)}
                            placeholder="http://localhost:11434/v1"
                            className="w-full mt-1.5 px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm font-mono shadow-sm border-border/80"
                          />
                          <p className="text-[10px] text-muted-foreground mt-1.5 flex flex-wrap gap-1 items-center">
                            <span>Default:</span>
                            <span className="bg-muted px-1.5 py-0.5 rounded font-mono text-[9px] text-foreground border shadow-sm">Ollama: :11434/v1</span>
                            <span className="bg-muted px-1.5 py-0.5 rounded font-mono text-[9px] text-foreground border shadow-sm">LM Studio: :1234/v1</span>
                          </p>
                          {(() => {
                            const isPrivateIp = localLlmUrl.includes("192.168.") || localLlmUrl.includes("10.") || /172\.(1[6-9]|2[0-9]|3[0-1])\./.test(localLlmUrl);
                            const isCloudHost = typeof window !== 'undefined' && !window.location?.hostname.includes("localhost") && !window.location?.hostname.includes("127.0.0.1");
                            if (isPrivateIp && isCloudHost) {
                              return (
                                <div className="mt-2.5 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-800 dark:text-red-400 text-[11px] leading-relaxed">
                                  <span className="font-bold text-red-700 dark:text-red-400 block mb-1">⚠️ Cloud Request Restriction</span>
                                  Because EbookCC is running on a secure cloud website, public servers cannot call private home IP addresses (like your computer's home LAN IP).
                                  <br />
                                  <span className="block mt-1 font-semibold">👉 Easy Fix:</span>
                                  Change the Base URL to <b><code>http://127.0.0.1:1234/v1</code></b> instead! Your browser will resolve it directly as a secure loopback context.
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="text-xs font-semibold text-foreground">Model Name</label>
                            <input
                              id="local-llm-model-input"
                              type="text"
                              value={localLlmModel}
                              onChange={(e) => setLocalLlmModel(e.target.value)}
                              placeholder="llama3"
                              className="w-full mt-1.5 px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm font-sans shadow-sm border-border/80"
                            />
                          </div>

                          <div>
                            <label className="text-xs font-semibold text-foreground">Local API Key (Optional)</label>
                            <input
                              id="local-llm-key-input"
                              type="password"
                              value={localLlmApiKey}
                              onChange={(e) => setLocalLlmApiKey(e.target.value)}
                              placeholder="Optional authentication token"
                              className="w-full mt-1.5 px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm font-sans shadow-sm border-border/80"
                            />
                          </div>
                        </div>

                        <div className="pt-1">
                          <Button 
                            id="btn-test-local-llm"
                            type="button" 
                            variant="outline" 
                            size="sm" 
                            className="w-full text-xs text-foreground bg-background hover:bg-muted font-medium py-2 rounded-lg"
                            onClick={handleTestLocalLlm}
                            disabled={isTestingLocalLlm}
                          >
                            {isTestingLocalLlm ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                                Contacting local API...
                              </>
                            ) : (
                              "Test Local LLM Connection"
                            )}
                          </Button>
                        </div>
                      </div>

                      {/* Stacked Underneath Section: Setup Guides & Info */}
                      <div className="flex flex-col bg-muted/40 border border-border/60 rounded-xl p-4 overflow-hidden select-none">
                        <div className="flex items-center gap-1.5 font-bold text-[13px] text-foreground pb-2.5 border-b border-border/60">
                          <BookOpen className="w-3.5 h-3.5 text-sky-500" />
                          <span>Local Model Settings & Tips</span>
                        </div>

                        {/* Tabs */}
                        <div className="flex bg-muted p-1 rounded-lg border border-border/60 my-2.5">
                          <button
                            type="button"
                            onClick={() => setActiveGuideTab('comparison')}
                            className={cn(
                              "flex-1 text-[11px] text-center py-1 font-medium rounded-md transition-colors",
                              activeGuideTab === 'comparison'
                                ? "bg-background text-foreground shadow-sm font-semibold"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            Cloud vs Local
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveGuideTab('lmstudio')}
                            className={cn(
                              "flex-1 text-[11px] text-center py-1 font-medium rounded-md transition-colors",
                              activeGuideTab === 'lmstudio'
                                ? "bg-background text-foreground shadow-sm font-semibold"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            LM Studio
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveGuideTab('ollama')}
                            className={cn(
                              "flex-1 text-[11px] text-center py-1 font-medium rounded-md transition-colors",
                              activeGuideTab === 'ollama'
                                ? "bg-background text-foreground shadow-sm font-semibold"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            Ollama
                          </button>
                        </div>

                        {/* Tab Content */}
                        <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-[11px] leading-relaxed text-foreground/90 max-h-[220px] custom-scrollbar">
                          {activeGuideTab === 'comparison' && (
                            <div className="space-y-3 animate-fadeIn">
                              <div className="p-2.5 bg-sky-500/5 border border-sky-500/15 rounded-lg text-foreground">
                                <span className="font-bold flex items-center gap-1.5 text-sky-600 dark:text-sky-400 text-[11px]">
                                  <Info className="w-3.5 h-3.5" />
                                  Why are local results differences noticeable?
                                </span>
                                <p className="mt-1 text-[10px] leading-normal text-muted-foreground">
                                  Your local model (like <b>gemma-4-e4b</b> or <b>llama3.2-vision</b>) is lightweight (4B-8B parameter weights) and typically compressed with <b>4-bit quantization (Q4_K_M)</b> to run on standard home consumer GPUs. 
                                  Cloud engines like <b>Gemini Flash</b> use massive, non-quantized multimodality trained with deep spatial awareness for cartoon/document bubble layout matching!
                                </p>
                              </div>

                              <div className="space-y-2">
                                <span className="font-bold block text-foreground">Capabilities Highlight:</span>
                                <ul className="list-disc pl-4 space-y-1 text-muted-foreground text-[10.5px]">
                                  <li>
                                    <b className="text-foreground">Lesser Coordinate Detail:</b> Quantized weights lose spatial fine-tuning depth. This introduces noise, resulting in slightly offset text bounding boxes.
                                  </li>
                                  <li>
                                    <b className="text-foreground">Stylized Font Hardness:</b> Artistic, handwritten, or distorted cartoon dialogue fonts are hard for 4B models to transcribe perfectly compared to cloud models.
                                  </li>
                                  <li>
                                    <b className="text-foreground">OCR vs Translation:</b> Small models perform outstandingly for <b>Standard Translation</b>! Consider using Cloud APIs for OCR scans, then local LLMs for free translation steps!
                                  </li>
                                </ul>
                              </div>
                            </div>
                          )}

                          {activeGuideTab === 'lmstudio' && (
                            <div className="space-y-2.5 animate-fadeIn">
                              <span className="font-bold text-foreground flex items-center gap-1.5">
                                <Lightbulb className="w-3.5 h-3.5 text-sky-500" />
                                LM Studio Best Practices
                              </span>
                              
                              <p className="text-muted-foreground">
                                LM Studio provides an OpenAI-compatible interface directly on port 1234.
                              </p>

                              <div className="space-y-2">
                                <span className="font-semibold block text-red-600 dark:text-red-400 flex items-center gap-1">
                                  ⚠️ Enable CORS Header (Crucial)
                                </span>
                                <p className="text-[10.5px] text-muted-foreground pl-1">
                                  Go to the <b>Local Server Settings</b> panel (left-side menu tab with a computer icon) in LM Studio. Scroll down, find <b>CORS (Cross-Origin Resource Sharing)</b>, and toggle it <b>ON</b>.
                                  <br />
                                  <i>If disabled, your browser will block EbookCC requests with mixed-context policy blocks!</i>
                                </p>
                              </div>

                              <div className="space-y-1 font-mono text-[10px] bg-muted/60 p-2 border rounded">
                                <p className="text-xs font-sans font-semibold text-foreground mb-1">Recommended Local Vision Models:</p>
                                <p className="text-muted-foreground">1. Google Gemma 2 (9B IT GGUF) - Excellent text</p>
                                <p className="text-muted-foreground">2. llama-3.2-11b-vision-instruct</p>
                                <p className="text-muted-foreground">3. qwen2.5-vl-7b-instruct</p>
                              </div>

                              <div className="p-2.5 bg-red-500/5 border border-red-500/15 rounded-lg text-[10px] leading-relaxed">
                                <span className="font-semibold text-red-600 dark:text-red-400 block mb-1">🧪 MiniCPM-V 2.6 & Custom Models Tip:</span>
                                If you see a warning like <code className="bg-background px-1 rounded text-red-500 font-mono text-[9.5px]">Received channelSend for unknown channel (ID = 7)</code>, it means the model utilizes custom non-standard tokenizers or positional multi-crop vision structures not fully compliant with LM Studio's standard OpenAI channel API. 
                                <br />
                                <span className="block mt-1 font-bold">How to fix:</span>
                                Use a standard, fully supported vision paradigm like <b>Qwen2.5-VL</b> or <b>Llama-3.2-Vision</b>, or ensure your LM Studio application is upgraded to the latest release channel supporting expanded custom multi-crop channels.
                              </div>

                              <div className="text-[10px] bg-sky-500/10 text-sky-700 dark:text-sky-400 p-2 rounded">
                                <b>Direct Connection Tip:</b> Enter <code>http://127.0.0.1:1234/v1</code> as the Base URL. Browsers treat loopback URLs as secure context, completely bypassing any HTTPS mixed content blocks!
                              </div>
                            </div>
                          )}

                          {activeGuideTab === 'ollama' && (
                            <div className="space-y-2.5 animate-fadeIn">
                              <span className="font-bold text-foreground flex items-center gap-1.5">
                                <Lightbulb className="w-3.5 h-3.5 text-sky-500" />
                                Ollama CORS Options
                              </span>
                              
                              <p className="text-muted-foreground">
                                Ollama runs on port 11434 by default. Because of default server security, it blocks external frontend websites unless Origins is set properly.
                              </p>

                              <div className="space-y-2">
                                <span className="font-semibold block text-foreground">How to run with OLLAMA_ORIGINS="*" :</span>
                                
                                <div className="space-y-1.5 pl-1 text-muted-foreground text-[10.5px]">
                                  <div className="mb-2">
                                    🪟 <b>Windows:</b> Quit Ollama from system tray first, then launch with PowerShell/CMD:
                                    <pre className="bg-muted p-1.5 rounded font-mono text-[9px] mt-1 text-foreground">
                                      $env:OLLAMA_ORIGINS="*"<br />
                                      ollama serve
                                    </pre>
                                  </div>
                                  <div className="mb-2">
                                    🍎 <b>macOS:</b> Close from status icon, then run Terminal command:
                                    <pre className="bg-muted p-1.5 rounded font-mono text-[9px] mt-1 text-foreground">
                                      OLLAMA_ORIGINS="*" ollama serve
                                    </pre>
                                  </div>
                                  <div>
                                    🐧 <b>Linux:</b> Edit service with <code>systemctl edit ollama.service</code> and paste:
                                    <pre className="bg-muted p-1.5 rounded font-mono text-[9px] mt-1 text-foreground">
                                      [Service]<br />
                                      Environment="OLLAMA_ORIGINS=*"
                                    </pre>
                                    Reload with <code>systemctl daemon-reload && systemctl restart ollama</code>.
                                  </div>
                                </div>
                              </div>

                              <div className="p-2 rounded bg-sky-500/10 text-sky-700 dark:text-sky-400">
                                <b>Required Multimodal Model:</b> Always pull vision-enabled engines like <code>ollama run llama3.2-vision</code> or <code>ollama pull qwen2.5-vision:7b</code> to scan panel imagery successfully.
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setShowApiKeyModal(false)}>
                  Cancel
                </Button>
                <Button onClick={() => {
                  if (customApiKey.trim()) localStorage.setItem('gemini_api_key', customApiKey.trim());
                  else localStorage.removeItem('gemini_api_key');
                  
                  localStorage.setItem('llm_engine', llmEngine);
                  localStorage.setItem('local_llm_url', localLlmUrl.trim());
                  localStorage.setItem('local_llm_model', localLlmModel.trim());
                  localStorage.setItem('local_llm_api_key', localLlmApiKey.trim());

                  setShowApiKeyModal(false);
                  toast.success("Settings saved!");
                }}>
                  Save & Continue
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Collage Modal */}
      <AnimatePresence>
        {showCollageModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-background/70 backdrop-blur-md p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="bg-background border rounded-2xl shadow-2xl p-8 max-w-4xl w-full my-8 max-h-[95vh] flex flex-col overflow-hidden"
            >
              <div className="flex justify-between items-center">
                <div className="space-y-1">
                  <h2 className="text-2xl font-bold">{collageStep === 'template' ? 'Choose Layout' : 'Advanced Settings'}</h2>
                  <p className="text-sm text-muted-foreground">
                    {collageStep === 'template' 
                      ? `Select one or more templates for ${pendingFiles.length} images` 
                      : 'Customize how images are rendered in the collage'}
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="rounded-full" onClick={() => {
                  setShowCollageModal(false);
                  setCollageStep('template');
                  processUploadedFiles(pendingFiles);
                }}>
                  <X className="w-6 h-6" />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto py-4 px-1 min-h-0 custom-scrollbar space-y-6">
                {collageStep === 'template' ? (
                  <div className={cn("grid gap-3 p-4 bg-muted/20 rounded-xl border border-border/50", isPortrait ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8")}>
                    {Object.keys(LAYOUTS).map(templateId => (
                    <div 
                      key={templateId}
                      onClick={() => {
                        setIsRandomMode(false);
                        setSelectedTemplates(prev => 
                          prev.includes(templateId) ? prev.filter(id => id !== templateId) : [...prev, templateId]
                        );
                      }}
                      className={cn(
                        "group relative aspect-[3/4] border-2 rounded-lg cursor-pointer transition-all p-1.5 flex flex-col items-center justify-center gap-1.5",
                        selectedTemplates.includes(templateId) && !isRandomMode 
                          ? "border-primary bg-primary/10 shadow-md ring-2 ring-primary/20" 
                          : "border-transparent bg-card hover:border-muted-foreground/30 hover:bg-muted/30"
                      )}
                    >
                      <div className="relative w-full aspect-[3/4] rounded overflow-hidden bg-slate-100">
                         {LAYOUTS[templateId].image_slots.map((slot, i) => (
                           <div 
                              key={i}
                              className="absolute border border-slate-300 bg-slate-200"
                              style={{
                                left: `${(slot.x / 317.5) * 100}%`,
                                top: `${(slot.y / 423.33) * 100}%`,
                                width: `${(slot.width / 317.5) * 100}%`,
                                height: `${(slot.height / 423.33) * 100}%`
                              }}
                           />
                         ))}
                         {LAYOUTS[templateId].black_fills.map((fill, i) => (
                           <div 
                              key={i}
                              className="absolute bg-slate-800"
                              style={{
                                left: `${(fill.x / 317.5) * 100}%`,
                                top: `${(fill.y / 423.33) * 100}%`,
                                width: `${(fill.width / 317.5) * 100}%`,
                                height: `${(fill.height / 423.33) * 100}%`
                              }}
                           />
                         ))}
                      </div>
                      <span className={cn(
                        "text-[9px] font-mono font-bold uppercase truncate w-full text-center transition-colors",
                        selectedTemplates.includes(templateId) && !isRandomMode ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                      )}>
                        {templateId.replace('batch_', '')}
                      </span>
                      {selectedTemplates.includes(templateId) && !isRandomMode && (
                        <div className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground rounded-full p-0.5 shadow-md">
                          <Check className="w-2.5 h-2.5" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                  <div className="p-6 bg-muted/20 rounded-xl border border-border/50 space-y-6">
                    <div className="flex items-center gap-4 p-4 bg-background border rounded-lg shadow-sm">
                    <Checkbox 
                      checked={collageOutline} 
                      onCheckedChange={(checked) => setCollageOutline(!!checked)}
                      className="w-5 h-5 shrink-0"
                    />
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-primary" />
                        <h3 className="font-semibold">Image Outlines</h3>
                      </div>
                      <p className="text-sm text-muted-foreground">Add a black border around each image in the collage.</p>
                      <p className="text-[10px] text-primary/70 font-medium">* Templates 12-14 always have outlines; 6-8 never have them.</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 p-4 bg-background border rounded-lg shadow-sm">
                    <Checkbox 
                      checked={collageHighContrast} 
                      onCheckedChange={(checked) => setCollageHighContrast(!!checked)}
                      className="w-5 h-5 shrink-0"
                    />
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Contrast className="w-4 h-4 text-primary" />
                        <h3 className="font-semibold">B&W High Contrast</h3>
                      </div>
                      <p className="text-sm text-muted-foreground">Convert all images to grayscale with boosted contrast (Manga style).</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                {collageStep === 'template' ? (
                  <>
                    <div className="flex gap-2 flex-1">
                      <Button 
                        variant={isRandomMode ? "default" : "outline"}
                        className={cn("flex-1 h-12", isRandomMode && "bg-primary text-primary-foreground")}
                        onClick={() => {
                          setIsRandomMode(true);
                          setSelectedTemplates([]);
                        }}
                      >
                        <Shuffle className="w-4 h-4 mr-2" />
                        Random Layouts
                      </Button>
                      <Button 
                        variant="outline"
                        className="flex-1 h-12"
                        onClick={() => {
                            setShowCollageModal(false);
                            processUploadedFiles(pendingFiles);
                        }}
                      >
                        Skip Collage
                      </Button>
                    </div>
                    <Button 
                      className="flex-1 h-12 font-bold"
                      disabled={selectedTemplates.length === 0 && !isRandomMode}
                      onClick={() => setCollageStep('settings')}
                    >
                      Continue to Settings
                      <ChevronRight className="w-4 h-4 ml-2" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button 
                      variant="outline"
                      className="flex-1 h-12"
                      onClick={() => setCollageStep('template')}
                    >
                      <ChevronLeft className="w-4 h-4 mr-2" />
                      Back to Layouts
                    </Button>
                    <Button 
                      className="flex-[2] h-12 font-bold"
                      disabled={isUploading}
                      onClick={async () => {
                        if (pendingFiles.length === 0) return;
                        
                        setIsUploading(true);
                        setLoadingText("Creating Collages...");
                        setUploadProgress(5);
                        setShowCollageModal(false);
                        setCollageStep('template'); // Reset for next time
                        
                        // YIELD to React immediately so the loading overlay appears!
                        await new Promise(r => setTimeout(r, 100));
                        
                        const toastId = toast.loading(`Creating collages... (0/${pendingFiles.length} images)`);
                        
                        try {
                          // 1. Pre-calculate all image ratios
                          let completedRatios = 0;
                          const imagesWithRatios = [];
                          for (let i = 0; i < pendingFiles.length; i++) {
                            const file = pendingFiles[i];
                            const ratio = await new Promise<number>((resolve, reject) => {
                              const img = new Image();
                              const objectUrl = URL.createObjectURL(file);
                              img.onload = () => {
                                const r = img.width / img.height;
                                URL.revokeObjectURL(objectUrl);
                                resolve(r);
                              };
                              img.onerror = () => {
                                URL.revokeObjectURL(objectUrl);
                                resolve(1); // fallback ratio
                              };
                              img.src = objectUrl;
                            });
                            imagesWithRatios.push({ file, ratio });
                            completedRatios++;
                            setUploadProgress(Math.round(5 + (completedRatios / pendingFiles.length) * 20)); // Allocate 20% to pre-calculation
                            // Yield to renderer frequently to keep progress bar fluid
                            await new Promise(r => setTimeout(r, 10));
                          }

                          const collageResults = [];
                          let currentImgIdx = 0;
                          const templatePool = isRandomMode ? Object.keys(LAYOUTS) : selectedTemplates;

                          while (currentImgIdx < imagesWithRatios.length) {
                              const remainingCount = imagesWithRatios.length - currentImgIdx;
                              let bestTId = templatePool[0];
                              let minScore = Infinity;
                              
                              for (const tId of templatePool) {
                                  const template = LAYOUTS[tId];
                                  const slotCount = template.image_slots.length;
                                  const batchSize = Math.min(slotCount, remainingCount);
                                  const batch = imagesWithRatios.slice(currentImgIdx, currentImgIdx + batchSize);
                                  
                                  let totalDiff = 0;
                                  const slots = [...template.image_slots];
                                  const tempBatch = [...batch];
                                  
                                  while (slots.length > 0 && tempBatch.length > 0) {
                                      const slot = slots.shift()!;
                                      const slotRatio = slot.width / slot.height;
                                      let bestImgIdx = 0;
                                      let bestImgDiff = Math.abs(tempBatch[0].ratio - slotRatio);
                                      for (let j = 1; j < tempBatch.length; j++) {
                                          const diff = Math.abs(tempBatch[j].ratio - slotRatio);
                                          if (diff < bestImgDiff) {
                                              bestImgDiff = diff;
                                              bestImgIdx = j;
                                          }
                                      }
                                      totalDiff += bestImgDiff;
                                      tempBatch.splice(bestImgIdx, 1);
                                  }
                                  const penalty = (slotCount - batchSize) * 0.5;
                                  const score = (totalDiff / batchSize) + penalty;
                                  if (score < minScore) {
                                      minScore = score;
                                      bestTId = tId;
                                  }
                              }

                              const finalTemplate = LAYOUTS[bestTId];
                              const pageFilesBatch = pendingFiles.slice(currentImgIdx, currentImgIdx + finalTemplate.image_slots.length);
                              
                              // Pass options to generateCollage
                              const res = await generateCollage(bestTId, pageFilesBatch, {
                                outline: collageOutline,
                                highContrast: collageHighContrast
                              });

                              if (res) {
                                  collageResults.push({ ...res, name: `Collage_Page${collageResults.length + 1}_${bestTId}` });
                              }
                              currentImgIdx += finalTemplate.image_slots.length;
                              setUploadProgress(Math.round(25 + (currentImgIdx / pendingFiles.length) * 75)); // Progress from 25% to 100%
                              toast.loading(`Creating collages... (${Math.min(currentImgIdx, pendingFiles.length)}/${pendingFiles.length} images)`, { id: toastId });
                          }
                          
                          const newPages: PageData[] = collageResults.map((c, idx) => ({
                            id: c.name + idx + Date.now(),
                            filename: c.name,
                            originalImage: c.url,
                            cleanedImage: null,
                            detectedTexts: [],
                            status: 'pending',
                            width: c.width,
                            height: c.height
                          }));
                          
                          setPages(prev => [...prev, ...newPages]);
                          setPendingFiles([]);
                          setSelectedTemplates([]);
                          if (pages.length === 0 && newPages.length > 0) {
                            setCurrentPageIndex(0);
                            setViewMode('edit');
                          }
                          toast.success(`Created ${newPages.length} collages`, { id: toastId });
                          setUploadProgress(100);
                          await new Promise(r => setTimeout(r, 500));
                        } catch (error) {
                          console.error("Collage creation failed:", error);
                          toast.error("Failed to create collage", { id: toastId });
                        } finally {
                          setIsUploading(false);
                        }
                      }}
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      Generate {pendingFiles.length} Images to Collages
                    </Button>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {isUploading && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-background/80 backdrop-blur-sm shadow-[0_0_50px_rgba(0,0,0,0.1)]">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-8 px-12 py-12 rounded-lg bg-background shadow-2xl border border-border max-h-[90vh] overflow-y-auto"
            >
            {loadingText.toLowerCase().includes("collage") ? null : (
              <Loader2 className="w-12 h-12 text-primary animate-spin" />
            )}
            <div className="text-center">
              <h3 className="text-3xl font-bold font-serif mb-2 text-primary">{loadingText}</h3>
              <p className="text-muted-foreground font-medium text-lg leading-tight px-4 min-h-[3rem]">
                {loadingText.toLowerCase().includes("collage") || loadingText.toLowerCase().includes("reading") || loadingText.toLowerCase().includes("identifying")
                  ? "Organizing your images into layout templates" 
                  : "Preparing your ebook pages for processing"}
              </p>
            </div>

            {loadingText.toLowerCase().includes("collage") && (
              <RetroProgressBar progress={uploadProgress} />
            )}
          </motion.div>
        </div>
      )}

      {isBatchProcessing && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-8 px-12 py-12 rounded-lg bg-background shadow-2xl border border-border max-w-[500px] w-full mx-4"
          >
            <div className="text-center space-y-1">
              <h3 className="text-3xl font-bold font-serif mb-2 text-primary">Processing Batch...</h3>
              <p className="text-muted-foreground font-medium text-lg leading-tight px-4">AI is analyzing and translating your comic</p>
            </div>

            <RetroProgressBar progress={batchProgress} />
            
            <Button 
              variant="outline" 
              size="sm"
              className="mt-4 border-foreground text-foreground hover:bg-foreground hover:text-background transition-colors rounded-none"
              onClick={() => setIsBatchProcessing(false)}
            >
              Stop Batch
            </Button>
          </motion.div>
        </div>
      )}

      {/* Floating Ko-fi Button */}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-2">
        <motion.a
          id="ko-fi-float-btn"
          href="https://ko-fi.com/kollolliver"
          target="_blank"
          rel="noopener noreferrer"
          whileHover={{ scale: 1.05, y: -2 }}
          whileTap={{ scale: 0.95 }}
          className="flex items-center justify-center gap-2 bg-[#FF5E5B] hover:bg-[#ff4a47] text-white font-medium py-3 px-5 portrait:p-3 max-sm:p-3 rounded-full shadow-lg border border-[#ff3d3a] transition-all text-sm group pointer-events-auto"
        >
          <Coffee className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
          <span className="portrait:hidden max-sm:hidden">Buy me a coffee</span>
          <Heart className="w-4 h-4 fill-white text-white animate-pulse portrait:hidden max-sm:hidden" />
        </motion.a>
      </div>

      {/* "Buy me a coffee" modal shown after export */}
      <AnimatePresence>
        {showCoffeeModal && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <motion.div
              id="coffee-modal"
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative flex flex-col items-center gap-5 px-8 py-10 rounded-2xl bg-background shadow-2xl border border-border max-w-[450px] w-full mx-4 text-center"
            >
              {/* Close Button */}
              <button
                id="close-coffee-modal-btn"
                onClick={() => setShowCoffeeModal(false)}
                className="absolute top-4 right-4 p-2 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="w-16 h-16 rounded-full bg-[#FF5E5B]/10 flex items-center justify-center text-[#FF5E5B] animate-bounce">
                <Coffee className="w-8 h-8" />
              </div>

              <div className="space-y-2">
                <h3 className="text-2xl font-bold font-serif text-foreground">Export Complete! 🎉</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Thank you for using EbookCC! If this tool saved you time and made your comic-reading journey better, please consider supporting the creator with a coffee.
                </p>
              </div>

              <div className="flex flex-col gap-2 w-full mt-2">
                <a
                  id="ko-fi-modal-donate-btn"
                  href="https://ko-fi.com/kollolliver"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setShowCoffeeModal(false)}
                  className="flex items-center justify-center gap-2 bg-[#FF5E5B] hover:bg-[#ff4a47] text-white font-semibold py-3 px-6 rounded-xl shadow-md transition-all text-sm group"
                >
                  <Coffee className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
                  <span>Support on Ko-fi</span>
                  <Heart className="w-4 h-4 fill-white text-white animate-pulse" />
                </a>
                
                <Button
                  id="not-now-coffee-modal-btn"
                  variant="ghost"
                  className="rounded-xl py-3 text-muted-foreground hover:text-foreground hover:bg-muted"
                  onClick={() => setShowCoffeeModal(false)}
                >
                  Maybe later
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* GitHub Sync Modal */}
      <AnimatePresence>
        {showGithubModal && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div
              id="github-sync-modal"
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-background border rounded-2xl shadow-2xl p-6 max-w-md w-full relative space-y-4 text-left"
            >
              {/* Close button */}
              <button
                id="close-github-modal-btn"
                onClick={() => setShowGithubModal(false)}
                className="absolute top-4 right-4 p-2 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3 border-b pb-3">
                <div className="p-2.5 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
                  <Github className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">Sync to GitHub</h3>
                  <p className="text-xs text-muted-foreground">Push transcribed comic markdown as a commit</p>
                </div>
              </div>

              <div className="space-y-3 text-xs leading-relaxed">
                <div className="space-y-1 bg-muted p-2 rounded border border-border text-[11px] text-muted-foreground leading-normal">
                  💡 <b>Quick Setup Guide:</b> 
                  <ul className="list-disc pl-4 mt-1 space-y-0.5">
                    <li>Generate a <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="underline hover:text-sky-500">Personal Access Token (PAT)</a> with <code className="bg-background px-1 rounded border border-border/50 text-foreground font-semibold">repo</code> scope.</li>
                    <li>Specify your repository in <code className="bg-background px-1 rounded border border-border/50 text-foreground">owner/repo</code> format.</li>
                  </ul>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-foreground flex items-center gap-1">
                    GitHub Personal Access Token (PAT)
                  </label>
                  <input
                    type="password"
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full px-3 py-2 border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-sky-500 text-foreground font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-foreground">
                    Repository (owner/name)
                  </label>
                  <input
                    type="text"
                    value={githubRepo}
                    onChange={(e) => setGithubRepo(e.target.value)}
                    placeholder="kollolliver/comic-translations"
                    className="w-full px-3 py-2 border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-sky-500 text-foreground"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-foreground">
                      File Path in Repo
                    </label>
                    <input
                      type="text"
                      value={githubPath}
                      onChange={(e) => setGithubPath(e.target.value)}
                      placeholder="README.md"
                      className="w-full px-3 py-2 border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-sky-500 text-foreground"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-foreground">
                      Repository Branch
                    </label>
                    <input
                      type="text"
                      value={githubBranch}
                      onChange={(e) => setGithubBranch(e.target.value)}
                      placeholder="main"
                      className="w-full px-3 py-2 border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-sky-500 text-foreground"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-foreground">
                    Commit Message
                  </label>
                  <input
                    type="text"
                    value={githubCommitMsg}
                    onChange={(e) => setGithubCommitMsg(e.target.value)}
                    placeholder="Sync transcribed comic to README.md via EbookCC"
                    className="w-full px-3 py-2 border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-sky-500 text-foreground"
                  />
                </div>
              </div>

              <div className="bg-sky-50 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/40 rounded-lg p-3 text-[11px] text-sky-800 dark:text-sky-300 flex items-start gap-2 leading-relaxed">
                <span className="shrink-0 mt-0.5">ℹ️</span>
                <p>
                  Your current transcribed and translated comic dialogue will be formatted into a clean Markdown document (containing page segments and dialog bullet indices) and synced directly.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t text-sm">
                <Button
                  variant="outline"
                  onClick={() => setShowGithubModal(false)}
                  disabled={isSyncingGithub}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSyncToGithub}
                  disabled={isSyncingGithub}
                  className="bg-sky-600 hover:bg-sky-700 text-white gap-2 font-semibold border-none"
                >
                  {isSyncingGithub ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <Github className="w-4 h-4" />
                      Sync to GitHub
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
