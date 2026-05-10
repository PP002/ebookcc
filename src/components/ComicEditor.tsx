import React, { useState, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { detectComicText, detectComicPanels, detectLayoutLocalYolo, translateTexts, ComicText, LayoutResult } from '@/services/gemini';
import { detectPanelsTfjs } from '@/lib/yoloTfjs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Download, Upload, Trash2, Edit2, Check, X, Eye, Book, Sparkles, Layers, Play, ChevronLeft, ChevronRight, CheckSquare, Languages, Sun, Moon, ExternalLink, Settings } from 'lucide-react';
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
  yoloTexts?: any[];
  detectedPanels?: any[];
  testedBoundaries?: [number, number, number, number][];
  status: 'pending' | 'processing' | 'done' | 'error';
  width: number;
  height: number;
  isIgnored?: boolean;
  isTextOnly?: boolean;
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
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return img.src;

  ctx.drawImage(img, 0, 0);

  for (const t of texts) {
    const boxToUse = t.box_2d || [0,0,0,0];
    const [ymin, xmin, ymax, xmax] = boxToUse;
    // Keep bounding box same, we shrink the mask itself
    const expansion = 0; 
    const eyMin = Math.max(0, ymin - expansion);
    const exMin = Math.max(0, xmin - expansion);
    const eyMax = Math.max(0, Math.min(1000, ymax + expansion));
    const exMax = Math.max(0, Math.min(1000, xmax + expansion));

    const x = (exMin / 1000) * canvas.width;
    const y = (eyMin / 1000) * canvas.height;
    const w = ((exMax - exMin) / 1000) * canvas.width;
    const h = ((eyMax - eyMin) / 1000) * canvas.height;

    if (t.maskBase64) {
      try {
        const maskImg = new Image();
        maskImg.crossOrigin = 'Anonymous';
        await new Promise((resolve, reject) => {
          maskImg.onload = resolve;
          maskImg.onerror = reject;
          maskImg.src = t.maskBase64!;
        });

        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = w;
        maskCanvas.height = h;
        const mctx = maskCanvas.getContext('2d');
        if (mctx) {
          const padding = 2; // slight shrink
          const drawW = Math.max(1, w - padding * 2);
          const drawH = Math.max(1, h - padding * 2);
          mctx.drawImage(maskImg, padding, padding, drawW, drawH);
          mctx.globalCompositeOperation = 'source-in';
          mctx.fillStyle = 'white';
          mctx.fillRect(0, 0, w, h);
          ctx.drawImage(maskCanvas, x, y, w, h);
        } else {
          ctx.fillStyle = 'white';
          ctx.fillRect(x, y, w, h);
        }
      } catch (e) {
        ctx.fillStyle = 'white';
        ctx.fillRect(x, y, w, h);
      }
    } else {
      ctx.fillStyle = 'white';
      ctx.fillRect(x, y, w, h);
    }
  }

  return canvas.toDataURL('image/jpeg', 0.9);
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

    // Rotate 270 degrees clockwise
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((270 * Math.PI) / 180);
    ctx.drawImage(img, -width / 2, -height / 2);

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
          console.warn("Predict API failed, falling back to TF.JS:", apiErr);
          layoutResult = await detectPanelsTfjs(img, "/models/yolo26n-seg-1280-half.tfjs/model.json", false, 1, 0, 0, 1280);
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
      rawPanels = aiPanels.map((p: any) => {
        const box = Array.isArray(p) ? p : p.box_2d;
        const mask = Array.isArray(p) ? undefined : p.maskBase64;
        return {
          yMin: Math.max(0, (box[0] / 1000) * img.height),
          xMin: Math.max(0, (box[1] / 1000) * img.width),
          yMax: Math.min(img.height, (box[2] / 1000) * img.height),
          xMax: Math.min(img.width, (box[3] / 1000) * img.width),
          maskBase64: mask
        };
      });
    }
  } catch (e) {
    console.error("AI panel detection failed, falling back to pixel scan", e);
  }

  if (rawPanels.length === 0) {
    let initialRegion: Region = { xMin: 0, xMax: img.width, yMin: 0, yMax: img.height };
    rawPanels = [initialRegion];
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

  // Assign each text to exactly one panel (the one it overlaps most / center distance is shortest)
  const textsByPanel: Map<number, ComicText[]> = new Map();
  page.detectedTexts.forEach(t => {
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
  // Auto-detect Manga mode if >= 30% of text boxes are vertical OR if CJK characters are present
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
    : (texts.length > 0 && ((verticalCount / texts.length) >= 0.2 || (cjkCount / texts.length) >= 0.3));

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
        
        if (verticalOverlap > 0.3 * minHeight || Math.abs(aTop - bTop) < 60) {
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
      // Tie-breaker inside a Row tier is Right-to-Left
      tier.sort((a, b) => {
        const aRight = a.box_2d[3];
        const bRight = b.box_2d[3];
        return bRight - aRight;
      });
      finalSorted.push(...tier);
    }
    return finalSorted;
  }

  // Western grouping: Primary flow is ROWS (Top-to-Bottom), then Left-to-Right
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
      const aHeight = aBottom - aTop;
      
      const bTop = t.box_2d[0];
      const bBottom = t.box_2d[2];
      const bHeight = bBottom - bTop;
      
      const verticalOverlap = Math.max(0, Math.min(aBottom, bBottom) - Math.max(aTop, bTop));
      if (verticalOverlap > 0.2 * Math.min(aHeight, bHeight) || Math.abs(aTop - bTop) < 80) {
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
    tier.sort((a, b) => {
      const aLeft = a.box_2d[1];
      const bLeft = b.box_2d[1];
      if (Math.abs(aLeft - bLeft) < 50) {
        return a.box_2d[0] - b.box_2d[0];
      }
      return aLeft - bLeft;
    });
    finalSorted.push(...tier);
  }
  return finalSorted;
};

export default function ComicEditor() {
  const [pages, setPages] = useState<PageData[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
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
  const [showYoloBoxes, setShowYoloBoxes] = useState(false);
  const [isTestingYolo, setIsTestingYolo] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

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
    setIsUploading(true);
    
    let newPages: PageData[] = [];
    const file = acceptedFiles[0];
    
    try {
      if (file.name.toLowerCase().endsWith('.zip') || file.name.toLowerCase().endsWith('.cbz')) {
        toast.info("Extracting archive...");
        const zip = await JSZip.loadAsync(file);
        const imageFiles = Object.keys(zip.files)
          .filter(name => name.match(/\.(jpe?g|png|webp)$/i))
          .sort((a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}));
          
        for (const name of imageFiles) {
          const blob = await zip.files[name].async("blob");
          const url = URL.createObjectURL(blob);
          const dims = await getImageDimensions(url);
          const processed = await rotateImageIfNeeded(url, dims.width, dims.height);
          newPages.push({ id: name + Date.now(), filename: name, originalImage: processed.url, cleanedImage: null, detectedTexts: [], status: 'pending', width: processed.width, height: processed.height });
        }
        toast.success(`Extracted ${newPages.length} pages`);
      } else {
        const sortedFiles = [...acceptedFiles].sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'}));
        for (const f of sortedFiles) {
          const url = URL.createObjectURL(f);
          const dims = await getImageDimensions(url);
          const processed = await rotateImageIfNeeded(url, dims.width, dims.height);
          newPages.push({ id: f.name + Date.now(), filename: f.name, originalImage: processed.url, cleanedImage: null, detectedTexts: [], status: 'pending', width: processed.width, height: processed.height });
        }
      }
      
      setPages(prev => [...prev, ...newPages]);
      if (pages.length === 0 && newPages.length > 0) {
        setCurrentPageIndex(0);
        setViewMode('edit');
      }
    } catch (e) {
      toast.error("Failed to process files");
    } finally {
      setIsUploading(false);
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
    if (!page || page.status === 'processing' || page.isIgnored) return;

    if (!customApiKey) {
      setIsBatchProcessing(false);
      setShowApiKeyModal(true);
      return;
    }

    setPages(prev => prev.map((p, idx) => idx === pageIndex ? { ...p, status: 'processing' } : p));
    
    try {
      let result = page.detectedTexts;
      let localTexts: any[] | undefined = page.yoloTexts;
      let localPanels: any[] | undefined = page.detectedPanels;
      
      // Load full-res image once for processing
      const fullImg = new Image();
      fullImg.crossOrigin = "Anonymous";
      fullImg.src = page.originalImage;
      await new Promise((resolve) => { fullImg.onload = resolve; fullImg.onerror = resolve; });

      if (result.length === 0) {
        // 1. Prepare image for AI (Resize to reasonable dimensions to save bandwidth)
        const aiBase64 = await resizeImageForAI(page.originalImage, 1600);
        
        localTexts = page.yoloTexts || localTexts;
        localPanels = page.detectedPanels || localPanels;

        if (!localTexts || !localPanels) {
          try {
            let layoutResult = null;
            try {
              console.log("Running server-side ONNX YOLO model before Gemini...");
              layoutResult = await runPredictAPI(aiBase64);
            } catch (apiErr) {
              console.log("Running TF.JS YOLO model in browser before Gemini...", apiErr);
              layoutResult = await detectPanelsTfjs(fullImg, "/models/yolo26n-seg-1280-half.tfjs/model.json", false, 1, 0, 0, 1280);
            }
            if (layoutResult) {
              if (layoutResult.texts && layoutResult.texts.length > 0) {
                localTexts = layoutResult.texts;
              }
              if (layoutResult.panels) {
                localPanels = layoutResult.panels;
              }
            }
          } catch (err) {
            console.error("YOLO detection for text failed", err);
          }
        }

        // 2. Detect text
        // Ensure localTexts only contains box arrays before passing to the API, to avoid huge payloads if mask data leaked into it.
        const cleanLocalTexts = localTexts ? localTexts.map((t: any) => Array.isArray(t) ? t : t.box_2d) : undefined;
        result = await detectComicText(aiBase64, customApiKey, cleanLocalTexts, 'gemini');
        
        // Cache yoloTexts and detectedPanels to save computation next time or during export
        if ((localTexts && localTexts !== page.yoloTexts) || (localPanels && localPanels !== page.detectedPanels)) {
          setPages(prev => prev.map((p, idx) => idx === pageIndex ? { ...p, yoloTexts: localTexts, detectedPanels: localPanels } : p));
        }

        if (result.length === 0) {
          setPages(prev => prev.map((p, idx) => idx === pageIndex ? { ...p, status: 'done' } : p));
          return;
        }
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = fullImg.naturalWidth;
      canvas.height = fullImg.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Could not create canvas context");
      ctx.drawImage(fullImg, 0, 0);

      const processedResults = result.map((item) => {
        const refinedBox = refineTextBubbleBounds(ctx, item.box_2d);
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
          const matched = bestMatch;
          if (matched && matched.maskBase64) {
            maskBase64 = matched.maskBase64;
            mask_box_2d = matched.box_2d || matched;
          }
        }
        return { ...item, box_2d: refinedBox, bgColor, maskBase64, mask_box_2d };
      });

      const cleanedImage = await generateCleanedImageFromElement(fullImg, processedResults);
      
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
        isTextOnly: calculatedIsTextOnly
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

  const handleTestYolo = async () => {
    if (pages.length === 0 || isTestingYolo) return;
    const page = pages[currentPageIndex];
    setIsTestingYolo(true);
    try {
      toast.info("Testing YOLO...");
      let layoutResult = null;
      try {
         const aiBase64 = await resizeImageForAI(page.originalImage, 1600);
         layoutResult = await runPredictAPI(aiBase64);
      } catch (err) {
         console.warn("Predict API failed in test, trying TFJS", err);
         const fullImg = new Image();
         fullImg.crossOrigin = "Anonymous";
         fullImg.src = page.originalImage;
         await new Promise((resolve) => { fullImg.onload = resolve; fullImg.onerror = resolve; });
         layoutResult = await detectPanelsTfjs(fullImg, "/models/yolo26n-seg-1280-half.tfjs/model.json", false, 1, 0, 0, 1280);
      }
      if (layoutResult) {
        setPages(prev => prev.map((p, idx) => idx === currentPageIndex ? { 
          ...p, 
          yoloTexts: layoutResult.texts,
          detectedPanels: layoutResult.panels
        } : p));
        setShowYoloBoxes(true);
        toast.success(`YOLO found ${layoutResult.panels.length} panels, ${layoutResult.texts.length} texts`);
      } else {
        toast.error("YOLO returned no result");
      }
    } catch (e: any) {
      if (e.message && e.message.includes("YOLO model not loaded")) {
        toast.error("YOLO model not loaded. Please upload your 'best.onnx' file to the 'server_models/' directory.");
      } else {
        toast.error(`YOLO failed: ${e.message}`);
      }
    } finally {
      setIsTestingYolo(false);
    }
  };

  const handleBatchProcess = async () => {
    setIsBatchProcessing(true);
    
    // Determine which pages to process
    const indicesToProcess = selectedPages.size > 0 
      ? Array.from(selectedPages).filter(i => !pages[i].isIgnored && pages[i].status !== 'done')
      : pages.map((_, i) => i).filter(i => !pages[i].isIgnored && pages[i].status !== 'done');

    if (indicesToProcess.length === 0) {
      toast.info("No pages found that require processing.");
      setIsBatchProcessing(false);
      return;
    }

    // Step 1: Blank Check Phase
    toast.info(`Initial scan for blank pages...`);
    const preservedIndices: number[] = [];
    for (const idx of indicesToProcess) {
      const page = pages[idx];
      if (page.status === 'done') continue;
      
      const isBlank = await isPageLikelyBlank(page.originalImage);
      if (isBlank) {
        setPages(prev => prev.map((p, pIdx) => pIdx === idx ? { ...p, status: 'done', isIgnored: true } : p));
        console.log(`[Batch] Auto-ignored page ${idx + 1} (likely blank)`);
      } else {
        preservedIndices.push(idx);
      }
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
      try {
        await processPage(i);
        if (index < preservedIndices.length - 1) {
           // Wait ~4.5s to respect 15 RPM limits on Gemini 2.5 Flash Free Tier
           await new Promise(r => setTimeout(r, 4500));
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

  const handleTestBoundaries = async () => {
    if (currentPageIndex < 0 || currentPageIndex >= pages.length) return;
    const page = pages[currentPageIndex];
    if (!page.originalImage || page.detectedTexts.length === 0) {
      toast.error("No text bubbles to test.");
      return;
    }

    try {
      toast.info("Testing boundaries...");
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.src = page.originalImage;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Could not create canvas context");
      ctx.drawImage(img, 0, 0);

      const refinedBoxes = page.detectedTexts.map(t => refineTextBubbleBounds(ctx, t.box_2d));

      setPages(prev => prev.map((p, idx) => idx === currentPageIndex ? { 
        ...p, 
        testedBoundaries: refinedBoxes
      } : p));
      
      toast.success("Boundaries refined! Shown in green outlines.");
    } catch (e) {
      console.error(e);
      toast.error("Failed to test boundaries");
    }
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

      let panelsHtml = '';
      if (page.detectedTexts.length === 0) {
        panelsHtml = `
      <div class="panel-card">
        <div class="panel-image-container">
          <img src="${base64Data}" class="panel-img" alt="Panel" />
        </div>
      </div>`;
      } else if (page.isTextOnly) {
        const sortedTexts = sortTextsReadingOrder(page.detectedTexts);
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
        const panels = await getPanelsForPage(page, base64Data);
        if (panels.length === 0) {
          panelsHtml = `
        <div class="panel-card">
          <div class="panel-image-container">
            <img src="${base64Data}" class="panel-img" alt="Panel" />
          </div>
          ${page.detectedTexts.length > 0 ? `<div class="panel-text-container">${sortTextsReadingOrder(page.detectedTexts).map(t => `<p class="panel-text-line">${t.text.replace(/\n/g, ' ')}</p>`).join('')}</div>` : ''}
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
      const margin = 40;
      const contentWidth = pageWidth - margin * 2;
      let currentY = margin;
      let isFirstPage = true;

      const checkAddPage = (neededHeight: number) => {
        if (currentY + neededHeight > pageHeight - margin) {
          pdf.addPage();
          currentY = margin;
        }
      };

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        let base64Data = page.originalImage;
        if (!base64Data.startsWith('data:')) {
          base64Data = await blobUrlToBase64(base64Data);
        }

        if (page.detectedTexts.length === 0) {
            // Image-only
            const imgProps = pdf.getImageProperties(base64Data);
            const ratio = imgProps.width / imgProps.height;
            const targetWidth = contentWidth;
            const targetHeight = targetWidth / ratio;
            
            checkAddPage(targetHeight + 20);
            pdf.addImage(base64Data, 'JPEG', margin, currentY, targetWidth, targetHeight);
            currentY += targetHeight + 20;

        } else if (page.isTextOnly) {
            // Text-only
            pdf.setFontSize(12);
            pdf.setTextColor(0, 0, 0);
            const sortedTexts = sortTextsReadingOrder(page.detectedTexts);
            
            sortedTexts.forEach(t => {
                const paragraphs = t.text.trim().split('\n');
                paragraphs.forEach(para => {
                    if (!para.trim()) return;
                    const textLines = pdf.splitTextToSize(para.trim(), contentWidth);
                    const lineHeight = 16;
                    checkAddPage(textLines.length * lineHeight + 10);
                    
                    textLines.forEach((line: string) => {
                       pdf.text(line, margin, currentY, { baseline: 'top' });
                       currentY += lineHeight;
                    });
                    currentY += lineHeight * 0.5;
                });
                currentY += 16;
            });
            currentY += 20;
        } else {
            // Panels logic same as HTML export
            const panels = await getPanelsForPage(page, base64Data);
            
            if (panels.length === 0) {
               // Fallback: full image + text
               const imgProps = pdf.getImageProperties(base64Data);
               const ratio = imgProps.width / imgProps.height;
               const targetWidth = contentWidth;
               const targetHeight = targetWidth / ratio;
               
               checkAddPage(targetHeight + 20);
               pdf.addImage(base64Data, 'JPEG', margin, currentY, targetWidth, targetHeight);
               currentY += targetHeight + 20;

               pdf.setFontSize(12);
               pdf.setTextColor(0, 0, 0);
               const sortedTexts = sortTextsReadingOrder(page.detectedTexts);
               const textStr = sortedTexts.map(t => t.text.replace(/\n/g, ' ')).join('\n\n');
               const textLines = pdf.splitTextToSize(textStr, contentWidth);
               const lineHeight = 16;
               checkAddPage(textLines.length * lineHeight + 10);
               textLines.forEach((line: string) => {
                 pdf.text(line, margin, currentY, { baseline: 'top' });
                 currentY += lineHeight;
               });
               currentY += 20;
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
                     pdf.setFontSize(12);
                     pdf.setTextColor(0, 0, 0);
                     const sortedTexts = sortTextsReadingOrder(p.texts);
                     const textContent = sortedTexts.map(t => t.text.replace(/\n/g, ' ')).join('\n\n');
                     
                     const textLines = pdf.splitTextToSize(textContent, contentWidth);
                     const lineHeight = 16;
                     checkAddPage(textLines.length * lineHeight + 20);
                     
                     textLines.forEach((line: string) => {
                       pdf.text(line, margin, currentY, { baseline: 'top' });
                       currentY += lineHeight;
                     });
                     currentY += 10; // extra spacing after text
                  }
               }
            }
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

    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
      const seqIndex = i + 1;
      
      const pageId = `page${seqIndex}`;
      const imgId = `img${seqIndex}`;
      const imgFilename = `image${seqIndex}.jpg`;

      const imgSrc = page.originalImage;
      let base64Data = imgSrc;
      if (!imgSrc.startsWith('data:')) {
        base64Data = await blobUrlToBase64(imgSrc);
      }
      
      const isTextOnly = page.isTextOnly || false;

      manifestItems += `    <item id="${pageId}" href="${pageId}.xhtml" media-type="application/xhtml+xml"/>\n`;
      spineItems += `    <itemref idref="${pageId}"/>\n`;
      navItems += `      <li><a href="${pageId}.xhtml">Page ${seqIndex}</a></li>\n`;
      ncxItems += `    <navPoint id="${pageId}" playOrder="${seqIndex}">
      <navLabel><text>Page ${seqIndex}</text></navLabel>
      <content src="${pageId}.xhtml"/>
    </navPoint>\n`;

      if (isTextOnly) {
        const sortedTexts = sortTextsReadingOrder(page.detectedTexts);
        const textContent = sortedTexts.map(t => {
          const paragraphs = t.text.split('\n').map(p => `<p>${p}</p>`).join('');
          return paragraphs;
        }).join('');
        
        zip.file(`OEBPS/${pageId}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Page ${seqIndex}</title>
  <meta name="viewport" content="width=800, height=1200"/>
  <style>
    body { margin: 0; padding: 2em; background: #fff; color: #000; font-family: sans-serif; box-sizing: border-box; }
    p { margin-bottom: 1em; line-height: 1.5; font-size: 1.2em; text-align: justify; }
  </style>
</head>
<body>
${textContent}
</body>
</html>`);
      } else if (page.detectedTexts.length === 0) {
        // Image only
        manifestItems += `    <item id="${imgId}" href="images/${imgFilename}" media-type="image/jpeg"/>\n`;
        zip.file(`OEBPS/${pageId}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Page ${seqIndex}</title>
  <meta name="viewport" content="width=800, height=1200"/>
  <style>
    body { margin: 0; padding: 0; width: 100%; height: 100%; background: #fff; text-align: center; }
    .comic-img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
  </style>
</head>
<body>
  <img src="images/${imgFilename}" alt="Page ${seqIndex}" class="comic-img" />
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
      } else {
         const panels = await getPanelsForPage(page, base64Data);
         
         let panelsXhtml = '';
         if (panels.length === 0) {
             manifestItems += `    <item id="${imgId}" href="images/${imgFilename}" media-type="image/jpeg"/>\n`;
             if (imgSrc.startsWith('data:')) {
               const base64DataRaw = imgSrc.split(',')[1];
               zip.file(`OEBPS/images/${imgFilename}`, base64DataRaw, { base64: true });
             } else {
               const response = await fetch(imgSrc);
               const blob = await response.blob();
               zip.file(`OEBPS/images/${imgFilename}`, blob);
             }
             
             const textContent = sortTextsReadingOrder(page.detectedTexts)
                 .map(t => `<p>${t.text.replace(/\n/g, ' ')}</p>`).join('');
                 
             panelsXhtml = `
               <div class="panel-card">
                 <img src="images/${imgFilename}" class="comic-img" alt="Page ${seqIndex}" />
                 <div class="panel-text">${textContent}</div>
               </div>
             `;
         } else {
             for (let pIdx = 0; pIdx < panels.length; pIdx++) {
                const p = panels[pIdx];
                let imageHtml = '';
                if (p.base64Image) {
                   const panelImgFilename = `page${seqIndex}_panel${pIdx}.jpg`;
                   const panelId = `img_${seqIndex}_${pIdx}`;
                   const panelBase64DataRaw = p.base64Image.split(',')[1];
                   zip.file(`OEBPS/images/${panelImgFilename}`, panelBase64DataRaw, { base64: true });
                   manifestItems += `    <item id="${panelId}" href="images/${panelImgFilename}" media-type="image/jpeg"/>\n`;
                   imageHtml = `<img src="images/${panelImgFilename}" class="comic-img" alt="Panel ${pIdx}"/>`;
                }
                
                const textContent = p.texts.length > 0 
                    ? sortTextsReadingOrder(p.texts).map(t => `<p>${t.text.replace(/\n/g, ' ')}</p>`).join('')
                    : '';
                    
                panelsXhtml += `
                  <div class="panel-card">
                    ${imageHtml}
                    ${textContent ? `<div class="panel-text">${textContent}</div>` : ''}
                  </div>
                `;
             }
         }
         
         zip.file(`OEBPS/${pageId}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Page ${seqIndex}</title>
  <meta name="viewport" content="width=800, height=1200"/>
  <style>
    body { margin: 0; padding: 1em; background: #fff; color: #000; font-family: sans-serif; text-align: center; }
    .panel-card { margin-bottom: 2em; page-break-inside: avoid; }
    .comic-img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
    .panel-text { margin-top: 1em; text-align: left; font-size: 1.2em; line-height: 1.5; }
    p { margin: 0.5em 0; }
  </style>
</head>
<body>
${panelsXhtml}
</body>
</html>`);
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
  };

  const downloadText = () => {
    let textContent = "";
    for (let i = 0; i < pages.length; i++) {
       const page = pages[i];
       // Only include text for pages that are done or intentionally ignored (if they happen to have text)
       if ((page.status === 'done' || page.isIgnored) && page.detectedTexts.length > 0) {
         textContent += `--- Page ${i + 1} ---\n`;
         const sortedTexts = sortTextsReadingOrder(page.detectedTexts);
         for (let textObj of sortedTexts) {
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
      <div className="fixed top-4 right-4 z-50 flex gap-2">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setShowApiKeyModal(true)} 
          className="w-10 h-10 rounded-full hover:bg-muted text-primary bg-background/50 backdrop-blur-sm shadow-sm border border-border/50"
          title="App Settings"
        >
          <Settings className="w-5 h-5" />
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setIsDarkMode(!isDarkMode)} 
          className="w-10 h-10 rounded-full hover:bg-muted text-primary bg-background/50 backdrop-blur-sm shadow-sm border border-border/50"
          title="Toggle Dark Mode"
        >
          {isDarkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
        </Button>
      </div>

      <header className="text-center space-y-2 pt-4">
        <h1 className="text-4xl font-bold tracking-tight text-foreground flex items-center justify-center gap-3">
          EbookCC
        </h1>
        {pages.length === 0 && (
          <p className="text-muted-foreground text-lg">
            Batch processing and export of your ebooks using AI-powered OCR tools.
          </p>
        )}
      </header>

      {isUploading && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-card shadow-xl border border-border"
          >
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <div className="text-center">
              <h3 className="text-xl font-bold">Uploading...</h3>
              <p className="text-muted-foreground">Preparing your ebook pages for processing</p>
            </div>
          </motion.div>
        </div>
      )}

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
                    {viewMode === 'preview' && activePage.isTextOnly ? (
                      <div className="w-full h-auto bg-white p-8 sm:p-16 text-black flex flex-col gap-6" style={{ minHeight: '600px', containerType: 'inline-size' }}>
                        {sortTextsReadingOrder(activePage.detectedTexts).map((item, idx) => (
                          <div 
                            key={`${activePage.id}-${idx}`} 
                            className="text-left font-serif whitespace-pre-wrap"
                            style={{ 
                              fontSize: `${(Math.max(16, activePage.width * 0.015) / activePage.width) * 100}cqi`,
                              lineHeight: 1.6
                            }}
                          >
                            {item.text}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <>
                        <img
                          ref={imageRef}
                          src={viewMode === 'edit' ? activePage.originalImage : (activePage.cleanedImage || activePage.originalImage)}
                          alt={`Page ${currentPageIndex + 1}`}
                          className="w-full h-auto block bg-white"
                        />
                        <AnimatePresence>
                          {sortTextsReadingOrder(activePage.detectedTexts).map((item, idx) => {
                            const boxStyle = getBoxStyle(item.box_2d, activePage.width, activePage.height);
                            const boxToUse = item.box_2d || [0,0,0,0];
                            const [ymin, xmin, ymax, xmax] = boxToUse;
                            const textW = ((xmax - xmin) / 1000) * activePage.width;
                            const textH = ((ymax - ymin) / 1000) * activePage.height;
                            let estimatedFontSizePx = calculateOptimalFontSize(item.text.trim(), textW * 0.95, textH * 0.95);
                            const fontSizeCqi = (Math.max(4, estimatedFontSizePx) / activePage.width) * 100;

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
                                        fontSize: `${fontSizeCqi}cqi`,
                                        lineHeight: 1.25
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
                                        textWrap: 'balance',
                                        fontSize: `${fontSizeCqi}cqi`,
                                        lineHeight: 1.25
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

                        {showYoloBoxes && (
                           <>
                             {/* Render full page SVG overlay for any segments */}
                             {((activePage.detectedPanels?.some((b: any) => b.segments)) || (activePage.yoloTexts?.some((b: any) => b.segments))) && (
                               <svg className="absolute top-0 left-0 w-full h-full pointer-events-none" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                                  {activePage.detectedPanels?.map((box: any, idx: number) => {
                                      if (!box.segments) return null;
                                      const pts = box.segments.x.map((xVal: number, i: number) => `${xVal},${box.segments.y[i]}`).join(" ");
                                      return <polygon key={`panel-poly-${idx}`} points={pts} fill="rgba(239, 68, 68, 0.2)" stroke="rgb(239, 68, 68)" strokeWidth="4" vectorEffect="non-scaling-stroke" />
                                  })}
                                  {activePage.yoloTexts?.map((box: any, idx: number) => {
                                      if (!box.segments) return null;
                                      const pts = box.segments.x.map((xVal: number, i: number) => `${xVal},${box.segments.y[i]}`).join(" ");
                                      return <polygon key={`text-poly-${idx}`} points={pts} fill="rgba(59, 130, 246, 0.2)" stroke="rgb(59, 130, 246)" strokeWidth="4" vectorEffect="non-scaling-stroke" />
                                  })}
                               </svg>
                             )}

                             {activePage.detectedPanels && activePage.detectedPanels.map((box: any, idx) => {
                               if (box.segments) return null;
                               const boxStyle = getBoxStyle(box, activePage.width, activePage.height);
                               return (
                                 <div key={`panel-${idx}`} className="absolute border-4 border-red-500 pointer-events-none overflow-hidden" style={boxStyle}>
                                   {box.maskBase64 && (
                                     <img src={box.maskBase64} className="w-full h-full object-fill opacity-80" alt="mask" />
                                   )}
                                 </div>
                               );
                             })}

                             {activePage.yoloTexts && activePage.yoloTexts.map((box: any, idx) => {
                               if (box.segments) return null;
                               const boxStyle = getBoxStyle(box, activePage.width, activePage.height);
                               return (
                                 <div key={`yolo-text-${idx}`} className="absolute border-4 border-blue-500 pointer-events-none overflow-hidden" style={boxStyle}>
                                   {box.maskBase64 && (
                                     <img src={box.maskBase64} className="w-full h-full object-fill opacity-80" alt="mask" />
                                   )}
                                 </div>
                               );
                             })}
                           </>
                        )}
                        
                        {activePage.testedBoundaries && activePage.testedBoundaries.map((box, idx) => {
                          const boxStyle = getBoxStyle(box, activePage.width, activePage.height);
                          return (
                            <div key={`tested-boundary-${idx}`} className="absolute border-2 border-red-500 bg-red-500/10 pointer-events-none" style={boxStyle} />
                          );
                        })}
                      </>
                    )}
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
              
              <div className="flex flex-col gap-2 mb-4 pb-4 border-b">
                <Button 
                  variant="outline" 
                  onClick={handleTestYolo} 
                  disabled={isTestingYolo}
                >
                  {isTestingYolo ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Test YOLO Local Model
                </Button>
                <Button 
                  variant="outline" 
                  onClick={handleTestBoundaries} 
                  disabled={!activePage || activePage.detectedTexts.length === 0}
                >
                  Test Text Boundaries Scan
                </Button>
                <div className="flex items-center gap-2 mt-2">
                  <Checkbox 
                    id="show-yolo" 
                    checked={showYoloBoxes}
                    onCheckedChange={(c) => setShowYoloBoxes(!!c)}
                  />
                  <label htmlFor="show-yolo" className="text-sm font-medium leading-none cursor-pointer">
                    Show YOLO Debug Boxes
                  </label>
                </div>
              </div>

              {activePage?.detectedTexts && activePage.detectedTexts.length > 0 && (
                <div className="space-y-3 max-h-[320px] flex flex-col mb-4">
                  <div className="flex justify-between items-center shrink-0">
                    <span className="text-sm font-medium">Page {currentPageIndex + 1} Texts</span>
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      {activePage.detectedTexts.length}
                    </span>
                  </div>
                  <div className="overflow-y-auto space-y-2 pr-2 custom-scrollbar pb-2 max-h-[282px]">
                    {sortTextsReadingOrder(activePage.detectedTexts).map((t, i) => (
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
                    disabled={activePage?.status === 'processing' || isBatchProcessing || activePage?.isIgnored}
                  >
                    {activePage?.status === 'processing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Process Current Page
                  </Button>


                  <Button 
                    variant="ghost"
                    className="w-full gap-2" 
                    onClick={handleBatchProcess} 
                    disabled={isBatchProcessing || pages.every(p => p.status === 'done' || p.isIgnored)}
                  >
                    {isBatchProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    {selectedPages.size > 0 ? `Batch Process Selected (${selectedPages.size})` : "Batch Process All"}
                  </Button>
                  
                  <div className="pt-4 border-t mt-4 space-y-2 flex flex-col items-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger 
                        render={
                          <Button 
                            variant="ghost" 
                            className="w-full gap-2"
                            disabled={pages.length === 0 || !pages.some(p => p.status === 'done' || p.isIgnored)} 
                          />
                        }
                      >
                        <Download className="w-4 h-4" /> Export
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
                      </DropdownMenuContent>
                    </DropdownMenu>
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

      {/* Settings Modal */}
      <AnimatePresence>
        {showApiKeyModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-background border rounded-xl shadow-2xl p-6 max-w-lg w-full space-y-4 my-8"
            >
              <h2 className="text-xl font-bold mb-4">App Settings</h2>

              <div className="space-y-4">
                <div className="p-4 border rounded-lg bg-card">
                  <h3 className="font-semibold mb-2">Gemini Text Engine</h3>
                  <p className="text-muted-foreground text-xs mb-3">
                    Google provides a generous free tier for the <code className="bg-muted px-1 rounded">gemini-2.0-flash-lite</code> model with 1,500 requests per day!
                    <br />
                    <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-primary hover:underline font-medium">
                      Get your free Gemini API Key here
                    </a>
                  </p>
                  <label className="text-sm font-medium">Gemini API Key</label>
                  <input
                    type="password"
                    value={customApiKey}
                    onChange={(e) => setCustomApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full mt-1 px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Your key is stored only in your browser's local storage.
                  </p>
                </div>

              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setShowApiKeyModal(false)}>
                  Cancel
                </Button>
                <Button onClick={() => {
                  if (customApiKey.trim()) localStorage.setItem('gemini_api_key', customApiKey.trim());
                  else localStorage.removeItem('gemini_api_key');
                  
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
    </div>
  );
}
