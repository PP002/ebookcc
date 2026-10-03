import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  PenTool,
  Eraser,
  Scissors,
  LassoSelect,
  MousePointer2,
  PaintBucket,
  Wrench,
  Plus,
  Trash2,
  Layout,
  Smile,
  Sparkles,
  Type,
  Image as ImageIcon,
  Layers,
  Save,
  Check,
  ChevronLeft,
  Download,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  Heading1,
  Heading2,
  Minus,
  List,
  MessageSquare,
  Bot,
  Contrast,
  Square,
  ArrowUp,
  ArrowDown,
  Crop,
  Move,
  Hand,
  Clock,
  Play,
  Share2,
  UserPlus,
  User,
  Lock,
  Shapes,
  Undo2,
  Redo2,
  Copy,
  Clipboard,
  Minimize,
  Maximize,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  saveUnfinishedComic,
  getUnfinishedComics,
  deleteUnfinishedComic,
  removeUnfinishedComicDraft,
  saveUnfinishedStory,
  getUnfinishedStories,
  deleteUnfinishedStory,
  removeUnfinishedStoryDraft,
  UnfinishedComic,
  UnfinishedStory
} from "@/lib/historyCache";
import { publishWorkToR2, fetchPublishedWorksFromR2, fetchSinglePublishedWork, deletePublishedWorkFromR2, savePublishedWorkLocally } from "@/lib/r2Storage";
import { useLanguage } from "@/context/LanguageContext";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { ComicTreeNodeView } from "@/components/ComicPageRenderer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { ImageToolbar } from "./ImageToolbar";
import {
  ComicCanvas,
  createGridTree,
  cloneTreeWithEmptyPanels,
  fillFirstEmptyPanel,
  updatePanelImage,
  TreeNode,
  Stroke,
  PanelNode,
} from "./ComicCanvas";
import { LayerManagerUI } from "./comic/LayerManagerUI";
import { ComicLayer, ComicLayerGroup } from "./comic/drawingTypes";
import JSZip from "jszip";
import { AIGeneratorDialog } from "./AIGeneratorDialog";
import { AIFullComicDialog } from "./AIFullComicDialog";
import { AIFullStoryDialog } from "./AIFullStoryDialog";
import { useAppSettings } from "@/context/AppSettingsContext";
import { getApiUrl } from '@/lib/api';
import { GoogleDriveDialog, GoogleDriveIcon } from "./GoogleDriveDialog";
import {
  processFreehandBubblePoints,
  generateBubbleSvgPath,
  detectCornersAndProtrusions,
} from "./comic/bubbleContour";
import { ShapeAwareTextLayout } from "./comic/ShapeAwareTextLayout";


interface CreateProps {
  setActiveView: (view: "home" | "read" | "create" | "convert") => void;
  onActiveStateChange?: (active: boolean) => void;
  onFullscreenChange?: (fullscreen: boolean) => void;
}

interface Bubble {
  id: string;
  text: string;
  x: number;
  y: number;
  style: "classic" | "action" | "freehand";
  points?: { x: number; y: number }[];
  hasTail?: boolean;
  tailX?: number;
  tailY?: number;
}

export type PenMode = "normal" | "smartShape" | "freehandBubble";

interface ComicPage {
  id: string;
  tree: TreeNode;
  bubbles: Bubble[];
}

interface Panel {
  id: string;
  gridArea: string;
  bgImageUrl?: string;
  bgColor: string;
}

const getSvgPathFromNormalizedPoints = (points: { x: number; y: number }[]): string => {
  if (!points || points.length === 0) return "";
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  let i = 1;
  for (; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    d += ` Q ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  if (i < points.length) {
    d += ` L ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}`;
  }
  d += " Z";
  return d;
};

const smoothPoints = (points: { x: number; y: number }[]): { x: number; y: number }[] => {
  if (!points || points.length < 3) return points;
  const smoothed: { x: number; y: number }[] = [];
  smoothed.push({ ...points[0] });
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    smoothed.push({
      x: (prev.x + curr.x * 2 + next.x) / 4,
      y: (prev.y + curr.y * 2 + next.y) / 4
    });
  }
  smoothed.push({ ...points[points.length - 1] });
  return smoothed;
};

const chaikinSmooth = (points: { x: number; y: number }[], iterations: number = 3): { x: number; y: number }[] => {
  if (!points || points.length < 3) return points;
  let current = [...points];
  for (let iter = 0; iter < iterations; iter++) {
    const nextList: { x: number; y: number }[] = [];
    const len = current.length;
    // Chaikin corner cutting for closed shapes
    for (let i = 0; i < len; i++) {
      const p0 = current[i];
      const p1 = current[(i + 1) % len];
      nextList.push({
        x: p0.x * 0.75 + p1.x * 0.25,
        y: p0.y * 0.75 + p1.y * 0.25
      });
      nextList.push({
        x: p0.x * 0.25 + p1.x * 0.75,
        y: p0.y * 0.25 + p1.y * 0.75
      });
    }
    current = nextList;
  }
  return current;
};

const generatePerfectSpeechBubblePoints = (): { x: number; y: number }[] => {
  const points: { x: number; y: number }[] = [];
  const cx = 50;
  const cy = 45;
  const rx = 44;
  const ry = 34;

  // Gap for the speech tail in radians (bottom-left area)
  const tStart = 0.55 * Math.PI;
  const tEnd = 0.70 * Math.PI;

  const steps = 80;
  for (let i = 0; i < steps; i++) {
    const t = tEnd + (i / steps) * (2 * Math.PI);
    const x = cx + rx * Math.cos(t);
    const y = cy + ry * Math.sin(t);
    points.push({ x, y });
  }

  return points;
};

const cropImageToCover = async (
  dataUrl: string,
  targetWidth: number,
  targetHeight: number,
): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(dataUrl);

      const imgRatio = img.width / img.height;
      const targetRatio = targetWidth / targetHeight;

      let drawW, drawH, drawX, drawY;

      if (imgRatio > targetRatio) {
        drawH = targetHeight;
        drawW = targetHeight * imgRatio;
        drawX = (targetWidth - drawW) / 2;
        drawY = 0;
      } else {
        drawW = targetWidth;
        drawH = targetWidth / imgRatio;
        drawX = 0;
        drawY = (targetHeight - drawH) / 2;
      }

      ctx.drawImage(img, drawX, drawY, drawW, drawH);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => resolve(dataUrl); // fallback
    img.src = dataUrl;
  });
};

const computePanels = (
  node: any,
  x: number,
  y: number,
  w: number,
  h: number,
): any[] => {
  if (node.type === "panel") {
    return [{ x, y, w, h, id: node.id, imageUrl: node.imageUrl }];
  }
  if (node.dir === "row") {
    const w1 = w * (node.percent / 100);
    const w2 = w - w1;
    return [
      ...computePanels(node.c1, x, y, w1, h),
      ...computePanels(node.c2, x + w1, y, w2, h),
    ];
  } else {
    const h1 = h * (node.percent / 100);
    const h2 = h - h1;
    return [
      ...computePanels(node.c1, x, y, w, h1),
      ...computePanels(node.c2, x, y + h1, w, h2),
    ];
  }
};

const escapeXmlText = (str: string): string => {
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

const escapeXmlAttr = (str: string): string => {
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

const generateClientDocx = async (html: string, title: string): Promise<Blob> => {
  const zip = new JSZip();

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, "text/html");

  const mediaFiles: { name: string; ext: string; b64: string; rId: string; id: number }[] = [];
  const imgElements = doc.querySelectorAll("img");
  let imgIndex = 1;

  for (let i = 0; i < imgElements.length; i++) {
    const img = imgElements[i] as HTMLImageElement;
    const src = img.getAttribute("src") || "";
    let b64 = "";
    let ext = "png";

    if (src.startsWith("data:image/")) {
      const match = src.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (match) {
        ext = match[1].toLowerCase().includes("jpeg") || match[1].toLowerCase().includes("jpg") ? "jpeg" : match[1].toLowerCase();
        b64 = match[2].trim();
      }
    } else if (src.startsWith("blob:") || src.startsWith("http:") || src.startsWith("https:") || src.startsWith("/")) {
      try {
        const resp = await fetch(src);
        const b = await resp.blob();
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((res) => {
          reader.onloadend = () => res(reader.result as string);
          reader.readAsDataURL(b);
        });
        const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        if (match) {
          ext = match[1].toLowerCase().includes("jpeg") || match[1].toLowerCase().includes("jpg") ? "jpeg" : match[1].toLowerCase();
          b64 = match[2].trim();
        }
      } catch (e) {
        console.warn("Failed to read image for docx", e);
      }
    }

    if (b64) {
      const rId = `rIdImg${imgIndex}`;
      const fileName = `image${imgIndex}.${ext === "jpeg" ? "jpg" : ext}`;
      const currentId = imgIndex;
      imgIndex++;
      mediaFiles.push({ name: fileName, ext, b64, rId, id: currentId });
      img.setAttribute("data-docx-rid", rId);
      img.setAttribute("data-docx-id", String(currentId));
    }
  }

  let bodyXml = "";

  const processNode = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const txt = escapeXmlText(node.textContent || "");
      if (txt.trim()) {
        bodyXml += `<w:p><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${txt}</w:t></w:r></w:p>`;
      }
      return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();

      if (tag === "h1") {
        const txt = escapeXmlText(el.textContent || "");
        bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/><w:color w:val="0F172A"/></w:rPr><w:t>${txt}</w:t></w:r></w:p>`;
      } else if (tag === "h2") {
        const txt = escapeXmlText(el.textContent || "");
        bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:spacing w:before="200" w:after="80"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="34"/><w:szCs w:val="34"/><w:color w:val="1E293B"/></w:rPr><w:t>${txt}</w:t></w:r></w:p>`;
      } else if (tag === "h3") {
        const txt = escapeXmlText(el.textContent || "");
        bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading3"/><w:spacing w:before="160" w:after="60"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="334155"/></w:rPr><w:t>${txt}</w:t></w:r></w:p>`;
      } else if (tag === "img") {
        const rId = el.getAttribute("data-docx-rid");
        const docxId = el.getAttribute("data-docx-id") || "1";
        if (rId) {
          const cx = 5400000;
          const cy = 4050000;
          bodyXml += `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="200" w:after="200"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${docxId}" name="Picture ${docxId}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docxId}" name="Picture ${docxId}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
        }
      } else if (tag === "p" || tag === "div") {
        let currentRuns = "";
        el.childNodes.forEach((child) => {
          if (child.nodeType === Node.TEXT_NODE) {
            const txt = escapeXmlText(child.textContent || "");
            if (txt) {
              currentRuns += `<w:r><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${txt}</w:t></w:r>`;
            }
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            const childEl = child as HTMLElement;
            const childTag = childEl.tagName.toLowerCase();
            if (childTag === "br") {
              currentRuns += `<w:r><w:br/></w:r>`;
            } else if (childTag === "img") {
              if (currentRuns) {
                bodyXml += `<w:p><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr>${currentRuns}</w:p>`;
                currentRuns = "";
              }
              const rId = childEl.getAttribute("data-docx-rid");
              const docxId = childEl.getAttribute("data-docx-id") || "1";
              if (rId) {
                const cx = 5400000;
                const cy = 4050000;
                bodyXml += `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="200" w:after="200"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${docxId}" name="Picture ${docxId}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docxId}" name="Picture ${docxId}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
              }
            } else {
              const isBold = childTag === "strong" || childTag === "b" || childEl.style.fontWeight === "bold";
              const isItalic = childTag === "em" || childTag === "i" || childEl.style.fontStyle === "italic";
              const txt = escapeXmlText(childEl.textContent || "");
              currentRuns += `<w:r><w:rPr>${isBold ? "<w:b/>" : ""}${isItalic ? "<w:i/>" : ""}<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${txt}</w:t></w:r>`;
            }
          }
        });
        if (currentRuns) {
          bodyXml += `<w:p><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr>${currentRuns}</w:p>`;
        }
      } else if (tag === "hr") {
        bodyXml += `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CBD5E1"/></w:pPr><w:spacing w:before="120" w:after="120"/></w:pPr></w:p>`;
      } else {
        el.childNodes.forEach(processNode);
      }
    }
  };

  doc.body.childNodes.forEach(processNode);

  if (!bodyXml.trim()) {
    bodyXml = `<w:p><w:r><w:t xml:space="preserve">${escapeXmlText(title || "Document")}</w:t></w:r></w:p>`;
  }

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>
</Types>`
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );

  let docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
  <Relationship Id="rIdFonts" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>\n`;

  mediaFiles.forEach((m) => {
    docRels += `  <Relationship Id="${m.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>\n`;
    zip.file(`word/media/${m.name}`, m.b64, { base64: true });
  });
  docRels += `</Relationships>`;
  zip.file("word/_rels/document.xml.rels", docRels);

  zip.file(
    "word/settings.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:defaultTabStop w:val="720"/>
  <w:characterSpacingControl w:val="doNotCompress"/>
</w:settings>`
  );

  zip.file(
    "word/fontTable.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fontTable xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:font w:name="Calibri">
    <w:panose1 w:val="020F0502020204030204"/>
    <w:charset w:val="00"/>
    <w:family w:val="swiss"/>
    <w:pitch w:val="variable"/>
  </w:font>
</w:fontTable>`
  );

  zip.file(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>
        <w:sz w:val="22"/>
        <w:szCs w:val="22"/>
        <w:lang w:val="en-US"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="160" w:line="276" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:before="240" w:after="120"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="44"/>
      <w:szCs w:val="44"/>
      <w:color w:val="0F172A"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:before="200" w:after="80"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="34"/>
      <w:szCs w:val="34"/>
      <w:color w:val="1E293B"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:before="160" w:after="60"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="28"/>
      <w:szCs w:val="28"/>
      <w:color w:val="334155"/>
    </w:rPr>
  </w:style>
</w:styles>`
  );

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" 
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" 
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" 
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" 
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:w10="urn:schemas-microsoft-com:office:word"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">
  <w:body>
    ${bodyXml}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  zip.file("word/document.xml", docXml);

  return await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
};

const CanvasResizeOverlay = ({
  targetElement,
  onResize,
  onPositionChange,
  updateToc,
}: {
  targetElement: HTMLElement;
  onResize?: (widthPercent: number) => void;
  onPositionChange?: (rect: DOMRect) => void;
  updateToc: () => void;
}) => {
  const [rect, setRect] = useState(() => targetElement.getBoundingClientRect());
  const prevRectRef = useRef<DOMRect>(targetElement.getBoundingClientRect());
  const onPositionChangeRef = useRef(onPositionChange);
  onPositionChangeRef.current = onPositionChange;
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const updateTocRef = useRef(updateToc);
  updateTocRef.current = updateToc;

  useEffect(() => {
    let animFrame: number;
    const checkRect = () => {
      const newRect = targetElement.getBoundingClientRect();
      const prev = prevRectRef.current;
      if (
        Math.abs(newRect.width - prev.width) > 0.5 ||
        Math.abs(newRect.height - prev.height) > 0.5 ||
        Math.abs(newRect.top - prev.top) > 0.5 ||
        Math.abs(newRect.left - prev.left) > 0.5
      ) {
        prevRectRef.current = newRect;
        setRect(newRect);
        onPositionChangeRef.current?.(newRect);
      }
    };

    const iv = setInterval(checkRect, 100);
    window.addEventListener("scroll", checkRect, true);
    window.addEventListener("resize", checkRect);

    return () => {
      clearInterval(iv);
      cancelAnimationFrame(animFrame);
      window.removeEventListener("scroll", checkRect, true);
      window.removeEventListener("resize", checkRect);
    };
  }, [targetElement]);

  const handleResizeStart = (e: React.PointerEvent, handle: string) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = targetElement.clientWidth;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const onPointerMove = (evt: PointerEvent) => {
      let dx = evt.clientX - startX;
      let newWidth = startWidth;

      if (handle.includes("e")) newWidth = startWidth + dx;
      if (handle.includes("w")) newWidth = startWidth - dx;

      // Calculate percentage width to be responsive
      const parentWidth =
        targetElement.parentElement?.clientWidth || window.innerWidth;
      const percentageW = Math.min(100, Math.max(20, (newWidth / parentWidth) * 100));
      targetElement.style.width = percentageW + "%";
      if (targetElement.tagName === "IMG") {
        targetElement.style.height = "auto";
      }
      const updatedRect = targetElement.getBoundingClientRect();
      prevRectRef.current = updatedRect;
      setRect(updatedRect);
      onResizeRef.current?.(percentageW);
      onPositionChangeRef.current?.(updatedRect);
    };

    const onPointerUp = (evt: PointerEvent) => {
      target.releasePointerCapture(evt.pointerId);
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", onPointerUp);
      updateTocRef.current?.();
    };

    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", onPointerUp);
  };

  return (
    <div
      style={{
        position: "fixed",
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        zIndex: 109,
        pointerEvents: "none",
        outline: "2px solid black",
      }}
    >
      {["nw", "ne", "sw", "se"].map((h) => (
        <div
          key={h}
          onPointerDown={(e) => handleResizeStart(e, h)}
          className="absolute w-8 h-8 z-[120] flex items-center justify-center pointer-events-auto"
          style={{
            top: `${h.includes("n") ? 0 : 100}%`,
            left: `${h.includes("w") ? 0 : 100}%`,
            transform: "translate(-50%, -50%)",
            cursor: `${h}-resize`,
            touchAction: "none",
          }}
        >
          <div className="w-3 h-3 border border-white rounded-full bg-black shadow-sm" />
        </div>
      ))}
    </div>
  );
};

const CanvasCropOverlay = ({
  imgElement,
  onClose,
  updateToc,
}: {
  imgElement: HTMLImageElement;
  onClose: () => void;
  updateToc: () => void;
}) => {
  const initCrop = {
    top: parseFloat(imgElement.dataset.cropTop || "0"),
    right: parseFloat(imgElement.dataset.cropRight || "0"),
    bottom: parseFloat(imgElement.dataset.cropBottom || "0"),
    left: parseFloat(imgElement.dataset.cropLeft || "0"),
  };
  const [crop, setCrop] = useState(initCrop);
  const [rect, setRect] = useState(imgElement.getBoundingClientRect());

  useEffect(() => {
    imgElement.style.opacity = "0";
    return () => {
      imgElement.style.opacity = "1";
    };
  }, [imgElement]);

  useEffect(() => {
    const iv = setInterval(() => {
      const newRect = imgElement.getBoundingClientRect();
      setRect((prev) => {
        if (
          Math.abs(newRect.width - prev.width) > 0.5 ||
          Math.abs(newRect.height - prev.height) > 0.5 ||
          Math.abs(newRect.top - prev.top) > 0.5 ||
          Math.abs(newRect.left - prev.left) > 0.5
        ) {
          return newRect;
        }
        return prev;
      });
    }, 50);
    return () => clearInterval(iv);
  }, [imgElement]);

  const origSrc = imgElement.dataset.origSrc || imgElement.src;

  const origWidth = rect.width / (1 - (initCrop.left + initCrop.right) / 100);
  const origHeight = rect.height / (1 - (initCrop.top + initCrop.bottom) / 100);
  const origLeft = rect.left - (initCrop.left / 100) * origWidth;
  const origTop = rect.top - (initCrop.top / 100) * origHeight;

  const handlePointerDown = (e: React.PointerEvent, handle: string) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startCrop = { ...crop };
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const onPointerMove = (evt: PointerEvent) => {
      const dx = evt.clientX - startX;
      const dy = evt.clientY - startY;
      const dxPct = (dx / origWidth) * 100;
      const dyPct = (dy / origHeight) * 100;

      const newCrop = { ...startCrop };
      if (handle.includes("n"))
        newCrop.top = Math.max(
          0,
          Math.min(100 - newCrop.bottom - 5, startCrop.top + dyPct),
        );
      if (handle.includes("s"))
        newCrop.bottom = Math.max(
          0,
          Math.min(100 - newCrop.top - 5, startCrop.bottom - dyPct),
        );
      if (handle.includes("w"))
        newCrop.left = Math.max(
          0,
          Math.min(100 - newCrop.right - 5, startCrop.left + dxPct),
        );
      if (handle.includes("e"))
        newCrop.right = Math.max(
          0,
          Math.min(100 - newCrop.left - 5, startCrop.right - dxPct),
        );
      setCrop(newCrop);
    };

    const onPointerUp = (evt: PointerEvent) => {
      target.releasePointerCapture(evt.pointerId);
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", onPointerUp);
    };

    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", onPointerUp);
  };

  const applyCrop = () => {
    imgElement.dataset.origSrc = origSrc;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const natW = img.naturalWidth;
      const natH = img.naturalHeight;
      const cLeft = (crop.left / 100) * natW;
      const cTop = (crop.top / 100) * natH;
      const cWidth = natW - cLeft - (crop.right / 100) * natW;
      const cHeight = natH - cTop - (crop.bottom / 100) * natH;

      canvas.width = Math.max(1, cWidth);
      canvas.height = Math.max(1, cHeight);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        try {
          ctx.drawImage(
            img,
            cLeft,
            cTop,
            cWidth,
            cHeight,
            0,
            0,
            canvas.width,
            canvas.height,
          );
          imgElement.src = canvas.toDataURL("image/png");
          imgElement.dataset.cropLeft = crop.left.toString();
          imgElement.dataset.cropTop = crop.top.toString();
          imgElement.dataset.cropRight = crop.right.toString();
          imgElement.dataset.cropBottom = crop.bottom.toString();
          updateToc();
        } catch (e) {
          console.error("Failed to crop: ", e);
        }
      }
      onClose();
    };
    img.src = origSrc;
  };

  return (
    <div
      style={{
        position: "fixed",
        top: origTop,
        left: origLeft,
        width: origWidth,
        height: origHeight,
        zIndex: 110,
        pointerEvents: "none",
      }}
    >
      <img
        src={origSrc || undefined}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "fill",
          opacity: 0.5,
          pointerEvents: "none",
          borderRadius: imgElement.style.borderRadius,
          outline: "2px solid black",
        }}
        alt="crop background"
      />
      <div
        style={{
          position: "absolute",
          top: `${crop.top}%`,
          right: `${crop.right}%`,
          bottom: `${crop.bottom}%`,
          left: `${crop.left}%`,
          outline: "2px solid black",
          boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.4)",
          overflow: "hidden",
        }}
      >
        <img
          src={origSrc || undefined}
          style={{
            position: "absolute",
            width: `${100 / (1 - (crop.left + crop.right) / 100)}%`,
            height: `${100 / (1 - (crop.top + crop.bottom) / 100)}%`,
            left: `-${crop.left / (1 - (crop.left + crop.right) / 100)}%`,
            top: `-${crop.top / (1 - (crop.top + crop.bottom) / 100)}%`,
            objectFit: "fill",
            maxWidth: "none",
          }}
          alt="crop overlay"
        />
      </div>

      {["nw", "ne", "sw", "se"].map((h) => (
        <div
          key={h}
          onPointerDown={(e) => handlePointerDown(e, h)}
          className={`absolute w-8 h-8 z-[120] pointer-events-auto cursor-${h}-resize`}
          style={{
            top: `${h.includes("n") ? crop.top : 100 - crop.bottom}%`,
            left: `${h.includes("w") ? crop.left : 100 - crop.right}%`,
            transform: `translate(${h.includes("w") ? "-2px" : "-30px"}, ${h.includes("n") ? "-2px" : "-30px"})`,
            touchAction: "none",
          }}
        >
          <div
            className={`absolute ${h.includes("n") ? "top-0" : "bottom-0"} ${h.includes("w") ? "left-0" : "right-0"} w-6 h-[4px] bg-black`}
          />
          <div
            className={`absolute ${h.includes("n") ? "top-0" : "bottom-0"} ${h.includes("w") ? "left-0" : "right-0"} w-[4px] h-6 bg-black`}
          />
        </div>
      ))}

      <div
        style={{
          position: "absolute",
          top: -40,
          left: "50%",
          transform: "translateX(-50%)",
          pointerEvents: "auto",
          display: "flex",
          gap: 8,
          zIndex: 120,
        }}
      >
        <Button
          size="sm"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            applyCrop();
          }}
        >
          Apply
        </Button>
      </div>
    </div>
  );
};

interface InteractiveBubbleProps {
  bubble: Bubble;
  isActive: boolean;
  onUpdateTail: (tailX: number, tailY: number) => void;
  onUpdateText: (text: string) => void;
  removeBubble: () => void;
  onActivate?: () => void;
}

const InteractiveBubble: React.FC<InteractiveBubbleProps> = ({
  bubble,
  isActive,
  onUpdateTail,
  onUpdateText,
  removeBubble,
  onActivate,
}) => {
  const { t } = useLanguage();
  const [dimensions, setDimensions] = useState({ w: 120, h: 60 });
  const [isEditing, setIsEditing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Measure dimensions when text changes or on mount
  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setDimensions((prev) =>
          Math.abs(prev.w - rect.width) < 0.5 && Math.abs(prev.h - rect.height) < 0.5
            ? prev
            : { w: rect.width, h: rect.height }
        );
      }
    }
  }, [bubble.text]);

  // Use a ResizeObserver for real-time measurements (as the user types)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        // Include padding
        const style = window.getComputedStyle(el);
        const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const newW = width + padX;
        const newH = height + padY;
        if (width > 0 && height > 0) {
          setDimensions((prev) =>
            Math.abs(prev.w - newW) < 0.5 && Math.abs(prev.h - newH) < 0.5
              ? prev
              : { w: newW, h: newH }
          );
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const W = Math.max(bubble.style === "freehand" ? 130 : 120, dimensions.w);
  const H = Math.max(bubble.style === "freehand" ? 65 : 55, dimensions.h);

  // Initialize tail if not set
  const tailX = bubble.tailX !== undefined ? bubble.tailX : (bubble.style === "freehand" ? 15 : W * 0.15);
  const tailY = bubble.tailY !== undefined ? bubble.tailY : (bubble.style === "freehand" ? 120 : H + 35);

  // Generate SVG path based on style
  let dPath = "";
  if (bubble.style === "classic" || bubble.style === "action") {
    const cx = W / 2;
    const cy = H / 2;
    
    if (bubble.style === "action") {
      // 1. Spikey burst shape with integrated tail
      const pointsCount = 32;
      const rawPoints: { x: number; y: number }[] = [];
      for (let i = 0; i < pointsCount; i++) {
        const theta = (i / pointsCount) * 2 * Math.PI;
        const isEven = i % 2 === 0;
        // Deterministic ripple to look hand-drawn and comic-like
        const wave = 0.03 * Math.sin(theta * 6);
        const factor = isEven ? (0.84 + wave) : (1.20 + wave);
        const px = cx + (W / 2) * Math.cos(theta) * factor;
        const py = cy + (H / 2) * Math.sin(theta) * factor;
        rawPoints.push({ x: px, y: py });
      }

      // Find the index closest to tail angle
      const dx = tailX - cx;
      const dy = tailY - cy;
      let thetaTail = Math.atan2(dy, dx);
      if (thetaTail < 0) thetaTail += 2 * Math.PI;

      let closestIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < pointsCount; i++) {
        const theta = (i / pointsCount) * 2 * Math.PI;
        let diff = Math.abs(theta - thetaTail);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }

      const finalPoints: { x: number; y: number }[] = [];
      const baseStartIdx = (closestIdx - 2 + pointsCount) % pointsCount;
      const baseEndIdx = (closestIdx + 2) % pointsCount;

      for (let j = 0; j < pointsCount; j++) {
        const idx = (baseEndIdx + j) % pointsCount;
        finalPoints.push(rawPoints[idx]);
        if (idx === baseStartIdx) {
          break;
        }
      }
      finalPoints.push({ x: tailX, y: tailY });

      dPath = finalPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";
    } else {
      // 2. Classic box shape with snapping/dynamic boundary-attachment tail
      const dx = tailX - cx;
      const dy = tailY - cy;
      const slope = H / W;
      let side: "top" | "bottom" | "left" | "right" = "bottom";

      if (Math.abs(dy) > Math.abs(dx) * slope) {
        side = dy > 0 ? "bottom" : "top";
      } else {
        side = dx > 0 ? "right" : "left";
      }

      const halfBase = Math.max(8, Math.min(W, H) * 0.12);
      let B1 = { x: 0, y: 0 };
      let B2 = { x: 0, y: 0 };

      if (side === "bottom") {
        const C = Math.max(halfBase + 4, Math.min(W - halfBase - 4, tailX));
        B1 = { x: C - halfBase, y: H };
        B2 = { x: C + halfBase, y: H };
      } else if (side === "top") {
        const C = Math.max(halfBase + 4, Math.min(W - halfBase - 4, tailX));
        B1 = { x: C + halfBase, y: 0 };
        B2 = { x: C - halfBase, y: 0 };
      } else if (side === "left") {
        const C = Math.max(halfBase + 4, Math.min(H - halfBase - 4, tailY));
        B1 = { x: 0, y: C - halfBase };
        B2 = { x: 0, y: C + halfBase };
      } else if (side === "right") {
        const C = Math.max(halfBase + 4, Math.min(H - halfBase - 4, tailY));
        B1 = { x: W, y: C + halfBase };
        B2 = { x: W, y: C - halfBase };
      }

      const pts: { x: number; y: number }[] = [];

      // Top-Left -> Top-Right
      if (side === "top") {
        pts.push({ x: 0, y: 0 });
        pts.push(B2);
        pts.push({ x: tailX, y: tailY });
        pts.push(B1);
        pts.push({ x: W, y: 0 });
      } else {
        pts.push({ x: 0, y: 0 });
        pts.push({ x: W, y: 0 });
      }

      // Top-Right -> Bottom-Right
      if (side === "right") {
        pts.push(B2);
        pts.push({ x: tailX, y: tailY });
        pts.push(B1);
        pts.push({ x: W, y: H });
      } else {
        pts.push({ x: W, y: H });
      }

      // Bottom-Right -> Bottom-Left
      if (side === "bottom") {
        pts.push(B2);
        pts.push({ x: tailX, y: tailY });
        pts.push(B1);
        pts.push({ x: 0, y: H });
      } else {
        pts.push({ x: 0, y: H });
      }

      // Bottom-Left -> Top-Left
      if (side === "left") {
        pts.push(B2);
        pts.push({ x: tailX, y: tailY });
        pts.push(B1);
        pts.push({ x: 0, y: 0 });
      } else {
        pts.push({ x: 0, y: 0 });
      }

      dPath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";
    }
  } else if (bubble.style === "freehand") {
    const cx = W / 2;
    const cy = H / 2;

    let normPoints = bubble.points;
    if (!normPoints || normPoints.length < 3) {
      normPoints = generatePerfectSpeechBubblePoints();
    }

    // Scale contour points to match current container dimensions W and H
    const bodyPts = normPoints.map((p) => ({
      x: (p.x / 100) * W,
      y: (p.y / 100) * H,
    }));

    const N = bodyPts.length;

    // Convert tail coordinates from percentage to container pixels
    const tailPxX = (tailX / 100) * W;
    const tailPxY = (tailY / 100) * H;

    // Detect corners and convex arrow/protrusion tips
    const { cornerIndices, tipIndex } = detectCornersAndProtrusions(bodyPts);

    const hasTail = bubble.hasTail ?? (tipIndex !== null);

    // If an arrow tip or protrusion was drawn, preserve it and allow tail handle dragging to move it
    if (hasTail && tipIndex !== null && tipIndex >= 0 && tipIndex < N) {
      const ptsCopy = bodyPts.map((p) => ({ ...p }));
      ptsCopy[tipIndex] = { x: tailPxX, y: tailPxY };
      dPath = generateBubbleSvgPath(ptsCopy, cornerIndices);
    } else if (hasTail && bubble.tailX !== undefined && bubble.tailY !== undefined) {
      // Freehand template bubble that explicitly has a tail (e.g. from default template)
      const dx = tailPxX - cx;
      const dy = tailPxY - cy;
      const tailAngle = Math.atan2(dy, dx);

      let closestIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < N; i++) {
        const ptAngle = Math.atan2(bodyPts[i].y - cy, bodyPts[i].x - cx);
        let diff = Math.abs(ptAngle - tailAngle);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }

      const baseRange = Math.max(1, Math.min(4, Math.floor(N * 0.04)));
      const idxStart = (closestIdx - baseRange + N) % N;
      const idxEnd = (closestIdx + baseRange) % N;

      const pathPts: { x: number; y: number }[] = [];
      let curr = idxEnd;
      while (curr !== idxStart) {
        pathPts.push(bodyPts[curr]);
        curr = (curr + 1) % N;
      }
      pathPts.push(bodyPts[idxStart]);

      const tailCornerIdx = pathPts.length;
      pathPts.push({ x: tailPxX, y: tailPxY });

      dPath = generateBubbleSvgPath(pathPts, [tailCornerIdx]);
    } else {
      // If NO sharp projection is detected: Treat the shape as a simple oval/smooth bubble—do NOT force or auto-inject a tail arrow.
      dPath = generateBubbleSvgPath(bodyPts, cornerIndices);
    }
  }

  // Pointer event for dragging the tail tip
  const handleTailPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    
    // We need to find the bubble overlay container to get client coordinates relative to top-left of the bubble
    const bubbleEl = containerRef.current;
    if (!bubbleEl) return;

    const onPointerMove = (ev: PointerEvent) => {
      const rect = bubbleEl.getBoundingClientRect();
      let newTailX = ev.clientX - rect.left;
      let newTailY = ev.clientY - rect.top;
      
      if (bubble.style === "freehand") {
        newTailX = (newTailX / W) * 100;
        newTailY = (newTailY / H) * 100;
      }
      
      onUpdateTail(newTailX, newTailY);
    };

    const onPointerUp = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
    };

    target.setPointerCapture(e.pointerId);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  };

  const bubblePolygon = useMemo(() => {
    if (bubble.style === "freehand") {
      let normPoints = bubble.points;
      if (!normPoints || normPoints.length < 3) {
        normPoints = generatePerfectSpeechBubblePoints();
      }
      return normPoints.map((p) => ({
        x: (p.x / 100) * W,
        y: (p.y / 100) * H,
      }));
    } else if (bubble.style === "action") {
      // Action burst shape has sharp outward spikes and inward valleys.
      // Text MUST be strictly confined to the safe inner valley region to prevent extending beyond boundaries!
      const pts: { x: number; y: number }[] = [];
      const steps = 36;
      const cx = W / 2;
      const cy = H / 2;
      // Inward valley safe boundary (0.70 of outer radius)
      const rx = (W / 2) * 0.70;
      const ry = (H / 2) * 0.70;
      for (let i = 0; i < steps; i++) {
        const th = (i / steps) * 2 * Math.PI;
        pts.push({
          x: cx + rx * Math.cos(th),
          y: cy + ry * Math.sin(th),
        });
      }
      return pts;
    } else {
      // Classic bubble is a rectangular comic dialogue box
      const pad = 6;
      return [
        { x: pad, y: pad },
        { x: W - pad, y: pad },
        { x: W - pad, y: H - pad },
        { x: pad, y: H - pad },
      ];
    }
  }, [bubble.style, bubble.points, W, H]);

  return (
    <div className="relative">
      {/* Background SVG for all styles */}
      <svg
        className="absolute inset-0 w-full h-full -z-10"
        style={{ overflow: "visible" }}
      >
        <path
          d={dPath}
          fill="#ffffff"
          stroke="#000000"
          strokeWidth={bubble.style === "freehand" ? 2.5 : 1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* Shape-Aware Dynamic Text Layout */}
      {!isEditing && (
        <ShapeAwareTextLayout
          text={bubble.text}
          polygon={bubblePolygon}
          width={W}
          height={H}
          fontSize={bubble.style === "action" ? 13 : 12}
          fontWeight={bubble.style === "action" ? "800" : "600"}
          fontStyle={bubble.style === "freehand" ? "italic" : "normal"}
          margin={bubble.style === "action" ? 3 : (bubble.style === "freehand" ? 3 : 2)}
          color="#000000"
        />
      )}

      {/* Text Container for editing and size measurement */}
      <div
        ref={containerRef}
        contentEditable
        suppressContentEditableWarning
        onClick={(e) => {
          e.stopPropagation();
          onActivate?.();
        }}
        onFocus={() => {
          setIsEditing(true);
          onActivate?.();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onActivate?.();
          (window as any)._bubbleLongPress = setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("quote-to-agent", {
                detail: { type: "text", text: bubble.text },
              }),
            );
          }, 500);
        }}
        onPointerUp={(e) => {
          if ((window as any)._bubbleLongPress)
            clearTimeout((window as any)._bubbleLongPress);
        }}
        onPointerLeave={(e) => {
          if ((window as any)._bubbleLongPress)
            clearTimeout((window as any)._bubbleLongPress);
        }}
        onPointerCancel={(e) => {
          if ((window as any)._bubbleLongPress)
            clearTimeout((window as any)._bubbleLongPress);
        }}
        onBlur={(e) => {
          setIsEditing(false);
          const txt = e.currentTarget.innerText || "";
          onUpdateText(txt);
        }}
        onInput={(e) => {
          const txt = e.currentTarget.innerText || "";
          onUpdateText(txt);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
        }}
        className={`text-xs break-words text-center min-w-[100px] max-w-[240px] whitespace-pre-wrap outline-none cursor-text select-text font-semibold ${
          !isEditing ? "opacity-0" : "opacity-100"
        } ${
          bubble.style === "action"
            ? "font-extrabold uppercase text-black py-1.5 px-3"
            : bubble.style === "freehand"
            ? "text-black py-1.5 px-3 italic font-sans leading-tight"
            : "text-black py-1 px-1.5"
        }`}
      >
        {bubble.text}
      </div>

      {/* Tail Drag Handle (Only when selected/active and not freehand) */}
      {isActive && bubble.style !== "freehand" && (
        <div
          onPointerDown={handleTailPointerDown}
          className="absolute w-4 h-4 bg-red-500 border-2 border-white rounded-full cursor-crosshair z-50 flex items-center justify-center shadow-lg transform -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${tailX}px`,
            top: `${tailY}px`,
          }}
          title={t("dragToResizeTail")}
        >
          <div className="w-1.5 h-1.5 bg-white rounded-full" />
        </div>
      )}
    </div>
  );
};

function checkIsAuthor(item: any, user: any) {
  if (!item) return false;
  
  // If work explicitly has an authorId, author_id or authorEmail attached from auth session
  const itemAuthorId = item.authorId || item.author_id;
  if (itemAuthorId || item.authorEmail) {
    if (!user) return false;
    if (itemAuthorId && user.uid && itemAuthorId === user.uid) return true;
    if (itemAuthorId && user.id && itemAuthorId === user.id) return true;
    if (item.authorEmail && user.email && item.authorEmail === user.email) return true;
    return false;
  }

  // If work has an author name stored
  if (item.author && item.author !== "Creative Publisher" && item.author !== "Author") {
    if (!user) return false;
    return item.author === user.name || item.author === user.email;
  }

  // Default / anonymous / local works created locally without user session
  return true;
}

function CreateMetroTile({
  book,
  index,
  user,
  onEdit,
  onDelete,
  onExportDrive,
}: {
  book: any;
  index: number;
  user: any;
  onEdit: (item: any) => void;
  onDelete: (e: React.MouseEvent, item: any) => void;
  onExportDrive?: (e: React.MouseEvent, item: any) => void;
}) {
  const { t } = useLanguage();
  const [slideIndex, setSlideIndex] = useState(0);

  const isAuthor = checkIsAuthor(book, user);

  // Unique hash seed per tile
  const tileSeed = React.useMemo(() => {
    let h = 0;
    const str = (book.id || '') + (index || 0);
    for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
    return Math.abs(h);
  }, [book.id, index]);

  // Extract full comic pages for live tile slideshow
  const comicPagesList = React.useMemo(() => {
    if (book.type !== 'comic') return [];
    
    if (book.pages && Array.isArray(book.pages) && book.pages.length > 0) {
      return book.pages.map((page: any, idx: number) => {
        let speechSnippet = "";
        if (page?.bubbles && Array.isArray(page.bubbles)) {
          const firstText = page.bubbles.find((b: any) => b?.text && b.text.trim());
          if (firstText) speechSnippet = firstText.text.trim();
        }

        return {
          pageNum: idx + 1,
          tree: page?.tree || null,
          image: page?.cover || page?.image || page?.imageUrl || null,
          speechSnippet: speechSnippet,
        };
      });
    }

    return [{
      pageNum: 1,
      tree: null,
      image: book.cover || null,
      speechSnippet: book.description || '',
    }];
  }, [book]);

  // Extract novel background image
  const novelBgImage = React.useMemo(() => {
    if (book.type !== 'novel') return null;
    if (book.cover && book.cover.trim() !== '') return book.cover;
    if (book.content) {
      const match = book.content.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (match && match[1]) return match[1];
    }
    return null;
  }, [book]);

  // Extract novel text snippets
  const novelSnippets = React.useMemo(() => {
    if (book.type !== 'novel') return [];
    const raw = book.content || book.description || '';
    const clean = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    
    if (!clean) {
      return [
        'A creative story authored in eBookCC.',
        `Written by ${book.author || 'Author'} • Tap to edit`,
        'Published novel work in library.'
      ];
    }

    const sentences = clean.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences.length > 1) {
      const chunks: string[] = [];
      let cur = "";
      for (const s of sentences) {
        if ((cur + " " + s).length > 85) {
          if (cur.trim()) chunks.push(cur.trim());
          cur = s;
        } else {
          cur += " " + s;
        }
      }
      if (cur.trim()) chunks.push(cur.trim());
      if (chunks.length > 1) return chunks;
    }

    return [
      `"${clean}"`,
      `Story by ${book.author || 'Unknown'} • Quick Edit in Workspace`,
      `Excerpt: ${clean.length > 50 ? clean.slice(0, 50) + '...' : clean}`
    ];
  }, [book]);

  const PAUSE_TIMES = React.useMemo(() => [3000, 4500, 6000, 7000], []);

  const tilePauseSequence = React.useMemo(() => {
    const shift = tileSeed % PAUSE_TIMES.length;
    return [...PAUSE_TIMES.slice(shift), ...PAUSE_TIMES.slice(0, shift)];
  }, [tileSeed, PAUSE_TIMES]);

  const initialDelay = React.useMemo(() => {
    return ((tileSeed * 1337 + index * 179) % 3500) + 500;
  }, [tileSeed, index]);

  const [hasStarted, setHasStarted] = useState(false);

  const DIRECTIONS = React.useMemo(() => [
    { initial: { x: "100%", y: "0%", opacity: 0 }, exit: { x: "-100%", y: "0%", opacity: 0 } },
    { initial: { x: "-100%", y: "0%", opacity: 0 }, exit: { x: "100%", y: "0%", opacity: 0 } },
    { initial: { x: "0%", y: "-100%", opacity: 0 }, exit: { x: "0%", y: "100%", opacity: 0 } },
    { initial: { x: "0%", y: "100%", opacity: 0 }, exit: { x: "0%", y: "-100%", opacity: 0 } },
  ], []);

  useEffect(() => {
    const listLen = book.type === 'comic' ? comicPagesList.length : novelSnippets.length;
    if (listLen <= 1) return;

    let timer: NodeJS.Timeout;

    if (!hasStarted) {
      timer = setTimeout(() => {
        setHasStarted(true);
        setSlideIndex(1);
      }, initialDelay);
    } else {
      const currentPause = tilePauseSequence[slideIndex % tilePauseSequence.length];
      timer = setTimeout(() => {
        setSlideIndex((prev) => prev + 1);
      }, currentPause);
    }

    return () => clearTimeout(timer);
  }, [slideIndex, hasStarted, initialDelay, tilePauseSequence, book.type, comicPagesList.length, novelSnippets.length]);

  const currentComicPage = comicPagesList[(slideIndex + tileSeed) % (comicPagesList.length || 1)] || comicPagesList[0];
  const currentNovelSnippet = novelSnippets[(slideIndex + tileSeed) % (novelSnippets.length || 1)] || novelSnippets[0];
  const currentDirection = DIRECTIONS[(slideIndex + tileSeed) % DIRECTIONS.length];

  return (
    <div
      onClick={() => onEdit(book)}
      className="group relative flex flex-col cursor-pointer select-none w-full"
    >
      {/* BOOK PREVIEW CONTAINER */}
      <div className="relative aspect-[3/4] w-full flex flex-col justify-between bg-slate-900 border border-border/80 rounded-none shadow-xs overflow-hidden transition-all duration-300 group-hover:shadow-md group-hover:border-primary/50 group-active:scale-95">
        {/* BACKGROUND & METRO LIVE TILE CONTENT */}
        {book.type === 'comic' ? (
          <div className="absolute inset-0 bg-white overflow-hidden flex items-center justify-center p-0.5">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={`comic-page-${slideIndex}`}
                initial={currentDirection.initial}
                animate={{ x: "0%", y: "0%", opacity: 1 }}
                exit={currentDirection.exit}
                transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
                className="w-full h-full flex flex-col items-center justify-center overflow-hidden bg-white"
              >
                {currentComicPage?.tree ? (
                  <div className="w-full h-full bg-white border border-zinc-900 flex flex-col overflow-hidden relative">
                    <ComicTreeNodeView node={currentComicPage.tree} />
                  </div>
                ) : currentComicPage?.image ? (
                  <img
                    src={currentComicPage.image || undefined}
                    alt={book.title}
                    className="w-full h-full object-contain bg-white"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full bg-slate-50 flex flex-col items-center justify-center p-2 text-center border border-zinc-300">
                    <Sparkles className="w-6 h-6 text-primary mb-1 animate-pulse" />
                    <span className="text-[10px] font-bold text-foreground line-clamp-2">{book.title}</span>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent pointer-events-none" />
          </div>
        ) : (
          <div className="absolute inset-0 bg-slate-900 overflow-hidden">
            {novelBgImage ? (
              <>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.img
                    key={`novel-bg-${slideIndex}`}
                    src={novelBgImage || undefined}
                    alt={book.title}
                    initial={currentDirection.initial}
                    animate={{ x: "0%", y: "0%", opacity: 0.35 }}
                    exit={currentDirection.exit}
                    transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
                    className="absolute inset-0 w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </AnimatePresence>
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/80 to-slate-950/40 pointer-events-none" />
              </>
            ) : (
              <div className="w-full h-full bg-slate-900 flex flex-col justify-between p-2 select-none text-left">
                <div className="flex items-center justify-between border-b border-white/10 pb-0.5">
                  <span className="text-[7px] font-mono uppercase font-bold text-slate-400">Novel</span>
                  <span className="text-[7px] font-mono text-primary font-bold uppercase">DOC</span>
                </div>
                <div className="my-auto space-y-0.5 py-0.5">
                  <h5 className="text-[10px] font-serif font-bold text-slate-100 line-clamp-2 leading-tight">
                    {book.title}
                  </h5>
                  <p className="text-[8px] text-slate-400 italic font-serif truncate">
                    {book.author || "Author"}
                  </p>
                </div>
                <div className="text-[6px] text-slate-500 font-mono border-t border-white/10 pt-0.5 text-center truncate">
                  eBookCC Original
                </div>
              </div>
            )}
          </div>
        )}

        {/* TOP HEADER BAR: METRO TYPE BADGE */}
        <div className="relative z-10 p-1.5 flex items-center justify-between w-full pointer-events-none">
          <span
            className={`px-1.5 py-0.5 text-[8px] font-black tracking-wider uppercase text-white shadow-xs font-mono ${
              book.type === 'comic' ? 'bg-amber-600' : 'bg-blue-600'
            }`}
          >
            {book.type}
          </span>
        </div>

        {/* MIDDLE DYNAMIC CONTENT AREA */}
        <div className="relative z-10 px-2 py-1 flex-1 flex flex-col justify-end pb-1.5 overflow-hidden pointer-events-none">
          {book.type === 'novel' ? (
            novelBgImage && (
              <div className="relative w-full h-16 overflow-hidden flex items-center">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.p
                    key={`novel-text-${slideIndex}`}
                    initial={currentDirection.initial}
                    animate={{ x: "0%", y: "0%", opacity: 1 }}
                    exit={currentDirection.exit}
                    transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
                    className="absolute inset-0 text-[9px] leading-tight text-slate-200 font-serif line-clamp-3 italic bg-slate-950/85 p-1.5 backdrop-blur-xs flex items-center"
                  >
                    {currentNovelSnippet}
                  </motion.p>
                </AnimatePresence>
              </div>
            )
          ) : (
            currentComicPage?.speechSnippet && (
              <div className="relative w-full overflow-hidden">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.p
                    key={`comic-bubble-${slideIndex}`}
                    initial={currentDirection.initial}
                    animate={{ x: "0%", y: "0%", opacity: 1 }}
                    exit={currentDirection.exit}
                    transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
                    className="text-[9px] leading-tight text-amber-100 font-sans line-clamp-2 bg-slate-950/85 p-1 rounded-none border border-amber-500/40 backdrop-blur-xs"
                  >
                    💬 "{currentComicPage.speechSnippet}"
                  </motion.p>
                </AnimatePresence>
              </div>
            )
          )}
        </div>
      </div>

      {/* METADATA AREA: Line 1 Title (contain delete/actions), Line 2 Author */}
      <div className="p-1.5 flex flex-col w-full min-w-0">
        <div className="flex items-center justify-between gap-1 w-full min-w-0">
          <h4 className="text-xs font-bold text-foreground truncate group-hover:text-primary transition-colors flex-1" title={book.title}>
            {book.title || "Untitled Work"}
          </h4>
          
          <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            {isAuthor ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(book);
                  }}
                  className="w-4 h-4 p-0 text-muted-foreground hover:text-primary hover:bg-primary/10"
                  title={t("edit")}
                >
                  <PenTool className="w-2.5 h-2.5" />
                </Button>
                {onExportDrive && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      onExportDrive(e, book);
                    }}
                    className="w-4 h-4 p-0 text-muted-foreground hover:text-primary hover:bg-primary/10"
                    title="Save to Google Drive"
                  >
                    <GoogleDriveIcon className="w-2.5 h-2.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(e, book);
                  }}
                  className="w-4 h-4 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  title={t("deleteWork")}
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </Button>
              </>
            ) : (
              <span className="text-[8px] text-amber-500 font-mono flex items-center gap-0.5" title={t("readOnly")}>
                <Lock className="w-2.5 h-2.5" />
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px] text-muted-foreground font-medium mt-0.5 min-w-0">
          <span className="truncate flex-1" title={book.author || "Author"}>
            {book.author || "Author"}
          </span>
        </div>
      </div>
    </div>
  );
}

export const Create: React.FC<CreateProps> = ({
  setActiveView,
  onActiveStateChange,
  onFullscreenChange,
}) => {
  const { t, formatDate } = useLanguage();
  const { llmEngine, geminiApiKey, user, setShowAuthDialog } = useAppSettings();
  const [showPublishAuthHint, setShowPublishAuthHint] = useState(false);
  const [createMode, setCreateMode] = useState<"select" | "comic" | "document">(
    "select",
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isBubbleSidebarOpen, setIsBubbleSidebarOpen] = useState(false);
  const [isAIGeneratorOpen, setIsAIGeneratorOpen] = useState(false);
  const [isAIFullComicDialogOpen, setIsAIFullComicDialogOpen] = useState(false);
  const [aiFullComicPrompt, setAiFullComicPrompt] = useState("");
  const [isAIFullStoryDialogOpen, setIsAIFullStoryDialogOpen] = useState(false);
  const [aiFullStoryPrompt, setAiFullStoryPrompt] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [touchOff, setTouchOff] = useState(false);
  const [drawTool, setDrawTool] = useState<"pen" | "erase" | "select" | "fill">(
    "pen",
  );
  const [drawColor, setDrawColor] = useState("#000000");
  const [drawRadius, setDrawRadius] = useState(1);
  const [brushSizeInput, setBrushSizeInput] = useState<string>("1");
  const [drawToolbarPos, setDrawToolbarPos] = useState({
    x: window.innerWidth / 2 - 120,
    y: 16,
  });
  const [isDraggingToolbar, setIsDraggingToolbar] = useState(false);
  const dragToolbarStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });

  const [isBrushSizePickerOpen, setIsBrushSizePickerOpen] = useState(false);
  const [isLayerPanelOpen, setIsLayerPanelOpen] = useState(false);
  const [eraserType, setEraserType] = useState<"stroke" | "pixel">("pixel");
  const [isEraserMenuOpen, setIsEraserMenuOpen] = useState(false);
  const [penMode, setPenMode] = useState<PenMode>("normal");
  const [isPenMenuOpen, setIsPenMenuOpen] = useState(false);
  const [isLassoMenuOpen, setIsLassoMenuOpen] = useState(false);
  const brushSizePickerRef = useRef<HTMLDivElement>(null);
  const drawColorInputRef = useRef<HTMLInputElement>(null);
  const layerPanelRef = useRef<HTMLDivElement>(null);
  const eraserMenuRef = useRef<HTMLDivElement>(null);
  const penMenuRef = useRef<HTMLDivElement>(null);
  const lassoMenuRef = useRef<HTMLDivElement>(null);

  // Portrait mode detection
  const [isPortrait, setIsPortrait] = useState(() => {
    if (typeof window !== "undefined") {
      return (
        window.matchMedia("(orientation: portrait)").matches ||
        window.innerHeight > window.innerWidth
      );
    }
    return false;
  });

  useEffect(() => {
    const checkOrientation = () => {
      const portrait =
        window.matchMedia("(orientation: portrait)").matches ||
        window.innerHeight > window.innerWidth;
      setIsPortrait(portrait);
    };
    checkOrientation();

    const mediaQuery = window.matchMedia("(orientation: portrait)");
    mediaQuery.addEventListener?.("change", checkOrientation);
    window.addEventListener("resize", checkOrientation);
    window.addEventListener("orientationchange", checkOrientation);
    return () => {
      mediaQuery.removeEventListener?.("change", checkOrientation);
      window.removeEventListener("resize", checkOrientation);
      window.removeEventListener("orientationchange", checkOrientation);
    };
  }, []);

  // Layers state
  const [comicLayers, setComicLayers] = useState<ComicLayer[]>([
    {
      id: "layer-bg",
      name: "Background",
      visible: true,
      opacity: 1,
      isBackground: true,
      color: "#ffffff",
    },
    {
      id: "layer-1",
      name: "Layer 1",
      visible: true,
      opacity: 1,
    },
  ]);
  const [activeLayerId, setActiveLayerId] = useState<string>("layer-1");
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>(["layer-1"]);
  const [layerGroups, setLayerGroups] = useState<ComicLayerGroup[]>([]);
  const lastSelectedLayerIdRef = useRef<string>("layer-1");
  const [comicBackgroundColor, setComicBackgroundColor] = useState<string>("#ffffff");

  const resetDrawToolSettingsToDefault = useCallback(() => {
    setIsDrawingMode(false);
    setDrawTool("pen");
    setDrawColor("#000000");
    setDrawRadius(1);
    setBrushSizeInput("1");
    setTouchOff(false);
    setComicBackgroundColor("#ffffff");
    setComicLayers([
      {
        id: "layer-bg",
        name: "Background",
        visible: true,
        opacity: 1,
        isBackground: true,
        color: "#ffffff",
      },
      {
        id: "layer-1",
        name: "Layer 1",
        visible: true,
        opacity: 1,
      },
    ]);
    setActiveLayerId("layer-1");
    setSelectedLayerIds(["layer-1"]);
    setLayerGroups([]);
    lastSelectedLayerIdRef.current = "layer-1";
    setEraserType("pixel");
    setIsEraserMenuOpen(false);
    setIsPenMenuOpen(false);
    setIsLassoMenuOpen(false);
    setIsBrushSizePickerOpen(false);
    setIsLayerPanelOpen(false);
    setIsComicPanelExpanded(false);
  }, []);

  // Auto fold brush size picker, layers panel, eraser menu, lasso menu, and pen menu when tapping outside
  useEffect(() => {
    if (
      !isBrushSizePickerOpen &&
      !isLayerPanelOpen &&
      !isEraserMenuOpen &&
      !isPenMenuOpen &&
      !isLassoMenuOpen
    )
      return;

    const handlePointerDownOutside = (e: PointerEvent | MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        isPenMenuOpen &&
        penMenuRef.current &&
        !penMenuRef.current.contains(target)
      ) {
        setIsPenMenuOpen(false);
      }
      if (
        isEraserMenuOpen &&
        eraserMenuRef.current &&
        !eraserMenuRef.current.contains(target)
      ) {
        setIsEraserMenuOpen(false);
      }
      if (
        isLassoMenuOpen &&
        lassoMenuRef.current &&
        !lassoMenuRef.current.contains(target)
      ) {
        setIsLassoMenuOpen(false);
      }
      if (
        isBrushSizePickerOpen &&
        brushSizePickerRef.current &&
        !brushSizePickerRef.current.contains(target)
      ) {
        setIsBrushSizePickerOpen(false);
      }
      if (
        isLayerPanelOpen &&
        layerPanelRef.current &&
        !layerPanelRef.current.contains(target)
      ) {
        setIsLayerPanelOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDownOutside, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDownOutside, true);
    };
  }, [
    isBrushSizePickerOpen,
    isLayerPanelOpen,
    isEraserMenuOpen,
    isPenMenuOpen,
    isLassoMenuOpen,
  ]);

  // Close menus when exiting drawing mode or switching away
  useEffect(() => {
    if (!isDrawingMode || drawTool !== "erase") {
      setIsEraserMenuOpen(false);
    }
    if (!isDrawingMode || drawTool !== "pen") {
      setIsPenMenuOpen(false);
    }
    if (!isDrawingMode || drawTool !== "select") {
      setIsLassoMenuOpen(false);
    }
  }, [isDrawingMode, drawTool]);

  const [tocItems, setTocItems] = useState<
    { id: string; text: string; level: number }[]
  >([]);

  const [floatingMenuProps, setFloatingMenuProps] = useState<{
    visible: boolean;
    top: number;
    left: number;
  }>({ visible: false, top: 0, left: 0 });
  const [imageMenuProps, setImageMenuProps] = useState<{
    visible: boolean;
    top: number;
    left: number;
    imgElement: HTMLImageElement | null;
  }>({ visible: false, top: 0, left: 0, imgElement: null });
  const [isImageCropping, setIsImageCropping] = useState(false);
  const [isImageColorFolded, setIsImageColorFolded] = useState(true);
  const [isTextPanelSelectMode, setIsTextPanelSelectMode] = useState(false);
  const [isDrawingModalOpen, setIsDrawingModalOpen] = useState(false);
  const [inlineCanvases, setInlineCanvases] = useState<Record<string, { node: PanelNode; widthPercent: number; backgroundColor?: string }>>({});
  const [activeCanvasElements, setActiveCanvasElements] = useState<{ id: string; element: HTMLElement; label?: string }[]>([]);
  const [activeImageElements, setActiveImageElements] = useState<{ element: HTMLImageElement; label: string }[]>([]);
  const [selectedCanvasElement, setSelectedCanvasElement] = useState<HTMLElement | null>(null);
  const [selectedCanvasElements, setSelectedCanvasElements] = useState<HTMLElement[]>([]);
  const [selectedImageElements, setSelectedImageElements] = useState<HTMLImageElement[]>([]);
  const prevCreateModeRef = useRef<string>(createMode);
  const [, setScrollTick] = useState(0);

  // History and cache states
  const [unfinishedComics, setUnfinishedComics] = useState<UnfinishedComic[]>([]);
  const [unfinishedStories, setUnfinishedStories] = useState<UnfinishedStory[]>([]);
  const [currentComicId, setCurrentComicId] = useState<string | null>(null);
  const [currentStoryId, setCurrentStoryId] = useState<string | null>(null);
  const [comicTitle, setComicTitle] = useState<string>("Untitled Comic");
  const [storyTitle, setStoryTitle] = useState<string>("Untitled Story");
  const [loadedHtmlContent, setLoadedHtmlContent] = useState<string | null>(null);

  // Publication state guards to prevent unwanted auto-save after successful publishing
  const isPublishedComicRef = useRef<boolean>(false);
  const isPublishedStoryRef = useRef<boolean>(false);

  const updateToc = useCallback(() => {
    if (!editorRef.current) return;

    // Check if document is genuinely empty (no text entered)
    const text = editorRef.current.innerText || editorRef.current.textContent || "";
    const cleanText = text.replace(/[\n\r\s\t]/g, "").trim();
    const hasImages = editorRef.current.querySelectorAll("img").length > 0;
    const hasCanvases = editorRef.current.querySelectorAll(".story-inline-canvas-placeholder").length > 0;
    const isDocEmpty = cleanText.length === 0 && !hasImages && !hasCanvases;
    editorRef.current.setAttribute("data-is-empty", isDocEmpty ? "true" : "false");
    editorRef.current.setAttribute("data-has-no-text", cleanText.length === 0 ? "true" : "false");

    // Dynamic auto-labeling for images and drawing canvases (L1, L2, L3, ...) in document order
    const illustrations = editorRef.current.querySelectorAll("img, .story-inline-canvas-placeholder");
    const foundImages: { element: HTMLImageElement; label: string }[] = [];
    illustrations.forEach((el, idx) => {
      const label = `L${idx + 1}`;
      el.setAttribute("data-label", label);
      if (el.tagName === "IMG") {
        foundImages.push({ element: el as HTMLImageElement, label });
      }
    });
    setActiveImageElements(foundImages);

    // Clean up any remaining data-label attributes on pure text blocks
    const textBlocks = editorRef.current.querySelectorAll("h1, h2, p, blockquote");
    textBlocks.forEach((block) => {
      block.removeAttribute("data-label");
    });

    const headings = editorRef.current.querySelectorAll("h1, h2");
    const seenIds = new Set<string>();

    const items = Array.from(headings).map((h: Element) => {
      const htmlEl = h as HTMLElement;

      if (!htmlEl.id || seenIds.has(htmlEl.id)) {
        htmlEl.id = "heading-" + Math.random().toString(36).substring(2, 9);
      }
      seenIds.add(htmlEl.id);

      return {
        id: htmlEl.id,
        text:
          htmlEl.textContent ||
          (htmlEl.tagName === "H1" ? t("untitledTitle") : t("untitledSubtitle")),
        level: htmlEl.tagName === "H1" ? 1 : 2,
      };
    });
    setTocItems((prev) => {
      if (
        prev.length === items.length &&
        prev.every(
          (item, idx) =>
            item.id === items[idx]?.id &&
            item.text === items[idx]?.text &&
            item.level === items[idx]?.level
        )
      ) {
        return prev;
      }
      return items;
    });
  }, [t]);

  const inlineCanvasesHistoryRef = useRef<Record<string, { node: PanelNode; widthPercent: number; backgroundColor?: string }>[]>([]);
  const inlineCanvasesHistoryIndexRef = useRef<number>(-1);
  const [canUndoInline, setCanUndoInline] = useState(false);
  const [canRedoInline, setCanRedoInline] = useState(false);

  // Unified Story Document History (HTML + Inline Canvases State)
  const storyDocHistoryRef = useRef<{ html: string; canvases: Record<string, { node: PanelNode; widthPercent: number; backgroundColor?: string }> }[]>([]);
  const storyDocHistoryIndexRef = useRef<number>(-1);
  const [canUndoStoryDoc, setCanUndoStoryDoc] = useState(false);
  const [canRedoStoryDoc, setCanRedoStoryDoc] = useState(false);

  const getCleanStoryHtml = useCallback((): string => {
    if (!editorRef.current) return "";

    // Sync inlineCanvases state back to data-canvas-data on placeholders
    Object.entries(inlineCanvases).forEach(([id, data]) => {
      const el = editorRef.current?.querySelector(`[data-id="${id}"]`);
      if (el) {
        el.setAttribute("data-canvas-data", JSON.stringify(data));
        if (data.widthPercent) {
          (el as HTMLElement).style.width = `${data.widthPercent}%`;
        }
      }
    });

    const clone = editorRef.current.cloneNode(true) as HTMLElement;
    const placeholders = clone.querySelectorAll(".story-inline-canvas-placeholder");
    placeholders.forEach((el) => {
      el.innerHTML = ""; // Strip portal DOM markup so store payload is clean
    });

    return clone.innerHTML;
  }, [inlineCanvases]);

  const getRenderedStoryHtml = useCallback(async (): Promise<string> => {
    if (!editorRef.current) return "";

    const clone = editorRef.current.cloneNode(true) as HTMLElement;
    const placeholders = clone.querySelectorAll(".story-inline-canvas-placeholder");

    for (let i = 0; i < placeholders.length; i++) {
      const placeholderClone = placeholders[i] as HTMLElement;
      const canvasId = placeholderClone.getAttribute("data-id");
      const origPlaceholder = editorRef.current.querySelector(
        `.story-inline-canvas-placeholder[data-id="${canvasId}"]`
      ) as HTMLElement | null;

      let dataUrl = "";
      if (origPlaceholder) {
        const canvasEl = origPlaceholder.querySelector("canvas") as HTMLCanvasElement | null;
        if (canvasEl && canvasEl.width > 0 && canvasEl.height > 0) {
          try {
            const offscreen = document.createElement("canvas");
            offscreen.width = canvasEl.width;
            offscreen.height = canvasEl.height;
            const ctx = offscreen.getContext("2d");
            if (ctx) {
              const canvasData = (canvasId && inlineCanvases[canvasId]) || null;
              ctx.fillStyle = canvasData?.backgroundColor || "#ffffff";
              ctx.fillRect(0, 0, offscreen.width, offscreen.height);
              ctx.drawImage(canvasEl, 0, 0);
              dataUrl = offscreen.toDataURL("image/png");
            } else {
              dataUrl = canvasEl.toDataURL("image/png");
            }
          } catch (e) {
            console.error("Failed to extract canvas dataUrl", e);
          }
        }

        // Fallback using html-to-image if canvas context extraction is empty
        if (!dataUrl) {
          try {
            const { toPng } = await import("html-to-image");
            dataUrl = await toPng(origPlaceholder, {
              backgroundColor: (canvasId && inlineCanvases[canvasId]?.backgroundColor) || "#ffffff",
              pixelRatio: 2,
              skipFonts: true,
              cacheBust: false,
              filter: (node) => {
                if (node instanceof HTMLElement) {
                  if (
                    node.classList?.contains("panel-label-badge") ||
                    node.dataset?.exportIgnore === "true" ||
                    node.closest?.(".panel-label-badge, [data-export-ignore='true']")
                  ) {
                    return false;
                  }
                }
                return true;
              },
            });
          } catch (err) {
            console.warn("toPng fallback failed for placeholder", err);
          }
        }
      }

      const canvasInfo = (canvasId && inlineCanvases[canvasId]) || null;
      const widthPercent = canvasInfo?.widthPercent || 66.6;

      if (dataUrl) {
        const img = document.createElement("img");
        img.src = dataUrl;
        img.alt = "Drawing Illustration";
        img.style.width = `${widthPercent}%`;
        img.style.margin = "1.5rem auto";
        img.style.display = "block";
        img.className = "story-inline-drawing-image block mx-auto rounded-md shadow-xs max-w-full";
        placeholderClone.parentNode?.replaceChild(img, placeholderClone);
      } else {
        placeholderClone.remove();
      }
    }

    // Convert any blob: image URLs to self-contained data URLs
    const allImgs = clone.querySelectorAll("img");
    for (let i = 0; i < allImgs.length; i++) {
      const imgEl = allImgs[i] as HTMLImageElement;
      const src = imgEl.getAttribute("src") || "";
      if (src.startsWith("blob:")) {
        try {
          const resp = await fetch(src);
          const blob = await resp.blob();
          const reader = new FileReader();
          const b64Data = await new Promise<string>((res) => {
            reader.onloadend = () => res(reader.result as string);
            reader.readAsDataURL(blob);
          });
          if (b64Data) {
            imgEl.setAttribute("src", b64Data);
          }
        } catch (blobErr) {
          console.warn("Could not convert blob image to base64", blobErr);
        }
      }
    }

    // Strip out all label badges, outlines, and resize overlays from export HTML
    const badges = clone.querySelectorAll(
      ".panel-label-badge, [data-export-ignore='true'], .canvas-resize-overlay, button, [role='button']"
    );
    badges.forEach((b) => b.remove());

    return clone.innerHTML;
  }, [inlineCanvases]);

  const pushStoryDocHistory = useCallback(() => {
    if (!editorRef.current) return;
    const cleanHtml = getCleanStoryHtml();
    const snapshot = {
      html: cleanHtml,
      canvases: JSON.parse(JSON.stringify(inlineCanvases))
    };

    const nextIndex = storyDocHistoryIndexRef.current + 1;
    const newHistory = storyDocHistoryRef.current.slice(0, nextIndex);

    const last = newHistory[newHistory.length - 1];
    if (last && last.html === snapshot.html && JSON.stringify(last.canvases) === JSON.stringify(snapshot.canvases)) {
      return;
    }

    newHistory.push(snapshot);
    if (newHistory.length > 50) newHistory.shift();
    storyDocHistoryRef.current = newHistory;
    storyDocHistoryIndexRef.current = newHistory.length - 1;
    setCanUndoStoryDoc(storyDocHistoryIndexRef.current > 0);
    setCanRedoStoryDoc(false);

    // Auto-save clean html to persistent IndexedDB
    if (!isPublishedStoryRef.current) {
      const activeId = currentStoryId || "story-" + Date.now();
      if (!currentStoryId) setCurrentStoryId(activeId);
      if (hasStoryEditedContent(cleanHtml)) {
        saveUnfinishedStory({
          id: activeId,
          title: storyTitle,
          htmlContent: cleanHtml,
        });
      }
    }
  }, [getCleanStoryHtml, inlineCanvases, currentStoryId, storyTitle]);

  const handleUndoStoryDoc = useCallback(() => {
    if (storyDocHistoryIndexRef.current > 0) {
      storyDocHistoryIndexRef.current -= 1;
      const target = storyDocHistoryRef.current[storyDocHistoryIndexRef.current];
      if (target && editorRef.current) {
        editorRef.current.innerHTML = target.html;

        const placeholders = editorRef.current.querySelectorAll(".story-inline-canvas-placeholder");
        placeholders.forEach((el) => {
          el.innerHTML = "";
        });

        const clonedCanvases = JSON.parse(JSON.stringify(target.canvases));
        setInlineCanvases(clonedCanvases);

        setCanUndoStoryDoc(storyDocHistoryIndexRef.current > 0);
        setCanRedoStoryDoc(storyDocHistoryIndexRef.current < storyDocHistoryRef.current.length - 1);
        setTimeout(() => updateToc(), 50);
        return true;
      }
    }
    return false;
  }, [updateToc]);

  const handleRedoStoryDoc = useCallback(() => {
    if (storyDocHistoryIndexRef.current < storyDocHistoryRef.current.length - 1) {
      storyDocHistoryIndexRef.current += 1;
      const target = storyDocHistoryRef.current[storyDocHistoryIndexRef.current];
      if (target && editorRef.current) {
        editorRef.current.innerHTML = target.html;

        const placeholders = editorRef.current.querySelectorAll(".story-inline-canvas-placeholder");
        placeholders.forEach((el) => {
          el.innerHTML = "";
        });

        const clonedCanvases = JSON.parse(JSON.stringify(target.canvases));
        setInlineCanvases(clonedCanvases);

        setCanUndoStoryDoc(storyDocHistoryIndexRef.current > 0);
        setCanRedoStoryDoc(storyDocHistoryIndexRef.current < storyDocHistoryRef.current.length - 1);
        setTimeout(() => updateToc(), 50);
        return true;
      }
    }
    return false;
  }, [updateToc]);

  const pushInlineCanvasesHistory = useCallback((newCanvases: Record<string, { node: PanelNode; widthPercent: number; backgroundColor?: string }>) => {
    const nextIndex = inlineCanvasesHistoryIndexRef.current + 1;
    const newHistory = inlineCanvasesHistoryRef.current.slice(0, nextIndex);
    newHistory.push(JSON.parse(JSON.stringify(newCanvases)));
    if (newHistory.length > 50) newHistory.shift();
    inlineCanvasesHistoryRef.current = newHistory;
    inlineCanvasesHistoryIndexRef.current = newHistory.length - 1;
    setCanUndoInline(inlineCanvasesHistoryIndexRef.current > 0);
    setCanRedoInline(false);
  }, []);

  const handleUndoInline = useCallback(() => {
    if (inlineCanvasesHistoryIndexRef.current > 0) {
      inlineCanvasesHistoryIndexRef.current -= 1;
      const target = inlineCanvasesHistoryRef.current[inlineCanvasesHistoryIndexRef.current];
      if (target) {
        const cloned = JSON.parse(JSON.stringify(target));
        setInlineCanvases(cloned);
        Object.entries(cloned).forEach(([cid, data]: [string, any]) => {
          const el = editorRef.current?.querySelector(`[data-id="${cid}"]`);
          if (el) {
            el.setAttribute("data-canvas-data", JSON.stringify(data));
          }
        });
        setCanUndoInline(inlineCanvasesHistoryIndexRef.current > 0);
        setCanRedoInline(inlineCanvasesHistoryIndexRef.current < inlineCanvasesHistoryRef.current.length - 1);
        return true;
      }
    }
    return false;
  }, []);

  const handleRedoInline = useCallback(() => {
    if (inlineCanvasesHistoryIndexRef.current < inlineCanvasesHistoryRef.current.length - 1) {
      inlineCanvasesHistoryIndexRef.current += 1;
      const target = inlineCanvasesHistoryRef.current[inlineCanvasesHistoryIndexRef.current];
      if (target) {
        const cloned = JSON.parse(JSON.stringify(target));
        setInlineCanvases(cloned);
        Object.entries(cloned).forEach(([cid, data]: [string, any]) => {
          const el = editorRef.current?.querySelector(`[data-id="${cid}"]`);
          if (el) {
            el.setAttribute("data-canvas-data", JSON.stringify(data));
          }
        });
        setCanUndoInline(inlineCanvasesHistoryIndexRef.current > 0);
        setCanRedoInline(inlineCanvasesHistoryIndexRef.current < inlineCanvasesHistoryRef.current.length - 1);
        return true;
      }
    }
    return false;
  }, []);
  const [comicPages, setComicPagesState] = useState<ComicPage[]>([
    {
      id: Date.now().toString(),
      tree: createGridTree(3, 2),
      bubbles: [
        { id: "1", text: "HELLO WORLD!", x: 25, y: 30, style: "classic" },
        {
          id: "2",
          text: "WHAT A COOL WORKSPACE!",
          x: 60,
          y: 65,
          style: "action",
        },
      ],
    },
  ]);
  const [activePageIndex, setActivePageIndex] = useState(0);

  // Comic page flipping refs and gestures
  const comicPagesLengthRef = useRef(comicPages.length);
  comicPagesLengthRef.current = comicPages.length;
  const comicPagesRef = useRef(comicPages);
  comicPagesRef.current = comicPages;
  const activePageIndexRef = useRef(activePageIndex);
  activePageIndexRef.current = activePageIndex;
  const comicWorkspaceRef = useRef<HTMLDivElement>(null);
  const touchStartPosRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isSwipingComicPageRef = useRef<boolean>(false);

  const checkNodeForImagesOrDrawings = (node: TreeNode): boolean => {
    if (!node) return false;
    if (node.type === 'panel') {
      if (node.imageUrl) return true;
      if (node.drawings && node.drawings.length > 0) return true;
      return false;
    } else if (node.type === 'split') {
      return checkNodeForImagesOrDrawings(node.c1) || checkNodeForImagesOrDrawings(node.c2);
    }
    return false;
  };

  const isComicDefaultState = (pages: ComicPage[]): boolean => {
    if (!pages || pages.length !== 1) return false;
    const page = pages[0];
    if (!page.bubbles || page.bubbles.length !== 2) return false;
    
    const b1 = page.bubbles.find(b => b.text === "HELLO WORLD!");
    const b2 = page.bubbles.find(b => b.text === "WHAT A COOL WORKSPACE!");
    if (!b1 || !b2) return false;

    if (checkNodeForImagesOrDrawings(page.tree)) return false;

    return true;
  };

  const hasStoryEditedContent = (htmlContent: string): boolean => {
    if (!htmlContent) return false;
    if (
      htmlContent.includes("<img") || 
      htmlContent.includes("<IMG") || 
      htmlContent.includes("story-inline-canvas-placeholder") ||
      htmlContent.includes("data-canvas-data")
    ) {
      return true;
    }
    
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = htmlContent;
    const text = tempDiv.textContent || tempDiv.innerText || "";
    return text.trim().length > 0;
  };

  // Published works state and actions for auth/local users
  const [publishedWorks, setPublishedWorks] = useState<any[]>([]);

  const loadPublishedWorks = async () => {
    // Render existing cached items initially for immediate UI display
    try {
      const raw = localStorage.getItem("ebookcc_published_items");
      if (raw) {
        const items = JSON.parse(raw);
        if (Array.isArray(items) && items.length > 0) {
          setPublishedWorks(items);
        }
      }
    } catch (_) {}

    // Network-First: Fetch authoritative fresh published works from R2/server
    try {
      const res = await fetchPublishedWorksFromR2();
      if (res.success && Array.isArray(res.works)) {
        const sorted = [...res.works].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        localStorage.setItem("ebookcc_published_items", JSON.stringify(sorted));
        setPublishedWorks(sorted);
        return;
      }
    } catch (_) {}

    // Fallback: Read local storage if network is unreachable
    try {
      const raw = localStorage.getItem("ebookcc_published_items") || "[]";
      const items = JSON.parse(raw);
      setPublishedWorks(Array.isArray(items) ? items : []);
    } catch (err) {
      setPublishedWorks([]);
    }
  };

  // Keep published works synchronized across tabs, windows, and on refocus
  useEffect(() => {
    const handleSync = () => {
      loadPublishedWorks();
    };
    window.addEventListener("ebookcc_published", handleSync);
    window.addEventListener("focus", handleSync);
    window.addEventListener("storage", handleSync);
    return () => {
      window.removeEventListener("ebookcc_published", handleSync);
      window.removeEventListener("focus", handleSync);
      window.removeEventListener("storage", handleSync);
    };
  }, []);

  const handleQuickEditPublished = (item: any) => {
    if (!checkIsAuthor(item, user)) {
      toast.error(`Only the author (${item.author || "Owner"}) can edit this published work.`);
      return;
    }
    if (item.type === "comic" || (item.pages && Array.isArray(item.pages))) {
      isPublishedComicRef.current = true;
      setCurrentComicId(item.id);
      setComicTitle(item.title || "Untitled Comic");
      if (item.pages && Array.isArray(item.pages)) {
        setComicPagesState(item.pages);
      }
      setActivePageIndex(0);
      setCreateMode("comic");
      toast.success(`Loaded published comic "${item.title || 'Untitled'}" into workspace`);
    } else {
      isPublishedStoryRef.current = true;
      setCurrentStoryId(item.id);
      setStoryTitle(item.title || "Untitled Story");
      setLoadedHtmlContent(item.content || "<h1><br></h1><p><br></p>");
      setCreateMode("document");
      toast.success(`Loaded published story "${item.title || 'Untitled'}" into workspace`);
    }
  };

  const handleDeletePublished = async (e: React.MouseEvent, item: any) => {
    e.stopPropagation();
    if (!checkIsAuthor(item, user)) {
      toast.error(`Only the author (${item.author || "Owner"}) can delete this published work.`);
      return;
    }
    try {
      const raw = localStorage.getItem("ebookcc_published_items") || "[]";
      const items = JSON.parse(raw);
      const updated = items.filter((i: any) => i.id !== item.id);
      localStorage.setItem("ebookcc_published_items", JSON.stringify(updated));
      setPublishedWorks(updated);

      await deletePublishedWorkFromR2(item.id);

      window.dispatchEvent(new Event("ebookcc_published"));
      window.dispatchEvent(new Event("storage"));

      await loadPublishedWorks();
      toast.success(`Deleted "${item.title || 'item'}" from R2 media storage & bookshelf`);
    } catch (err) {
      toast.error("Failed to delete published work");
    }
  };

  // Load lists on select screen and sync/cleanup published works from unfinished drafts
  useEffect(() => {
    if (createMode === "select") {
      (async () => {
        let publishedList: any[] = [];
        try {
          const raw = localStorage.getItem("ebookcc_published_items") || "[]";
          publishedList = JSON.parse(raw);
        } catch (_) {}

        const publishedIds = new Set(publishedList.map((p: any) => String(p?.id || "")).filter(Boolean));
        const publishedTitles = new Set(publishedList.map((p: any) => String(p?.title || "").trim().toLowerCase()).filter(Boolean));

        const comics = await getUnfinishedComics();
        const cleanedComics: UnfinishedComic[] = [];
        for (const c of comics) {
          if (publishedIds.has(String(c.id)) || (c.title && publishedTitles.has(c.title.trim().toLowerCase()))) {
            await deleteUnfinishedComic(c.id);
          } else {
            cleanedComics.push(c);
          }
        }
        setUnfinishedComics(cleanedComics);

        const stories = await getUnfinishedStories();
        const cleanedStories: UnfinishedStory[] = [];
        for (const s of stories) {
          if (publishedIds.has(String(s.id)) || (s.title && publishedTitles.has(s.title.trim().toLowerCase()))) {
            await deleteUnfinishedStory(s.id);
          } else {
            cleanedStories.push(s);
          }
        }
        setUnfinishedStories(cleanedStories);
      })();

      loadPublishedWorks();
      setCurrentComicId(null);
      setCurrentStoryId(null);
      isPublishedComicRef.current = false;
      isPublishedStoryRef.current = false;
    }
  }, [createMode]);

  // Load from external trigger (e.g. Bookshelf open in workspace)
  useEffect(() => {
    const triggerId = sessionStorage.getItem("ebookcc_open_workspace_id");
    const triggerType = sessionStorage.getItem("ebookcc_open_workspace_type");
    
    if (triggerId && triggerType) {
      sessionStorage.removeItem("ebookcc_open_workspace_id");
      sessionStorage.removeItem("ebookcc_open_workspace_type");

      if (triggerType === "novel") {
        getUnfinishedStories().then(async (stories) => {
          const match = stories.find(s => s.id === triggerId);
          if (match) {
            isPublishedStoryRef.current = false;
            setCurrentStoryId(match.id);
            setStoryTitle(match.title);
            setLoadedHtmlContent(match.htmlContent);
            setCreateMode("document");
          } else {
            // Network-First: fetch latest published story from R2/server, fallback to local cache
            try {
              let found = await fetchSinglePublishedWork(triggerId);
              if (!found) {
                const r2Res = await fetchPublishedWorksFromR2();
                if (r2Res.success && Array.isArray(r2Res.works)) {
                  found = r2Res.works.find((item: any) => item.id === triggerId);
                }
              }
              if (!found) {
                const pub = JSON.parse(localStorage.getItem("ebookcc_published_items") || "[]");
                found = pub.find((item: any) => item.id === triggerId);
              }
              if (found) {
                isPublishedStoryRef.current = true;
                setCurrentStoryId(found.id);
                setStoryTitle(found.title);
                setLoadedHtmlContent(found.content || "");
                setCreateMode("document");
              }
            } catch (err) {
              console.error("Failed loading from published books", err);
            }
          }
        });
      } else if (triggerType === "comic") {
        getUnfinishedComics().then(async (comics) => {
          const match = comics.find(c => c.id === triggerId);
          if (match) {
            isPublishedComicRef.current = false;
            setCurrentComicId(match.id);
            setComicTitle(match.title);
            setComicPagesState(match.pages);
            setActivePageIndex(match.activePageIndex || 0);
            setCreateMode("comic");
          } else {
            // Network-First: fetch latest published comic from R2/server, fallback to local cache
            try {
              let found = await fetchSinglePublishedWork(triggerId);
              if (!found || !found.pages) {
                const r2Res = await fetchPublishedWorksFromR2();
                if (r2Res.success && Array.isArray(r2Res.works)) {
                  found = r2Res.works.find((item: any) => item.id === triggerId);
                }
              }
              if (!found || !found.pages) {
                const pub = JSON.parse(localStorage.getItem("ebookcc_published_items") || "[]");
                found = pub.find((item: any) => item.id === triggerId);
              }
              if (found) {
                let pages = found.pages;
                if (typeof pages === 'string') {
                  try { pages = JSON.parse(pages); } catch (_) { pages = []; }
                }
                if (Array.isArray(pages) && pages.length > 0) {
                  isPublishedComicRef.current = true;
                  setCurrentComicId(found.id);
                  setComicTitle(found.title);
                  setComicPagesState(pages);
                  setActivePageIndex(0);
                  setCreateMode("comic");
                }
              }
            } catch (err) {
              console.error("Failed loading from published books", err);
            }
          }
        });
      }
    }
  }, [createMode]);

  // Auto-save comic
  useEffect(() => {
    if (createMode === "comic") {
      if (isPublishedComicRef.current) return;
      const activeId = currentComicId || "comic-" + Date.now();
      if (!currentComicId) {
        setCurrentComicId(activeId);
      }
      if (!isComicDefaultState(comicPages)) {
        const timer = setTimeout(() => {
          if (isPublishedComicRef.current) return;
          saveUnfinishedComic({
            id: activeId,
            title: comicTitle,
            pages: comicPages,
            activePageIndex,
          });
        }, 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [createMode, comicPages, activePageIndex, comicTitle, currentComicId]);

  const historyRef = useRef<ComicPage[][]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [canUndoComic, setCanUndoComic] = useState(false);
  const [canRedoComic, setCanRedoComic] = useState(false);

  const syncUndoRedoState = useCallback(() => {
    setCanUndoComic(historyIndexRef.current > 0);
    setCanRedoComic(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  // Initialize history sync eagerly
  if (historyRef.current.length === 0) {
    historyRef.current = [JSON.parse(JSON.stringify(comicPages))];
    historyIndexRef.current = 0;
  }

  const setComicPages = useCallback((
    newPagesOrUpdater: ComicPage[] | ((prev: ComicPage[]) => ComicPage[]),
  ) => {
    isPublishedComicRef.current = false;
    setComicPagesState((prev) => {
      const nextPages =
        typeof newPagesOrUpdater === "function"
          ? newPagesOrUpdater(prev)
          : newPagesOrUpdater;
      
      const clonedSnapshot = JSON.parse(JSON.stringify(nextPages));
      const nextIndex = historyIndexRef.current + 1;
      const newHistory = historyRef.current.slice(0, nextIndex);
      newHistory.push(clonedSnapshot);
      if (newHistory.length > 50) newHistory.shift();
      historyRef.current = newHistory;
      historyIndexRef.current = newHistory.length - 1;
      setCanUndoComic(historyIndexRef.current > 0);
      setCanRedoComic(false);
      return nextPages;
    });
  }, []);

  const handleUndoComic = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current -= 1;
      const target = historyRef.current[historyIndexRef.current];
      if (target) {
        setComicPagesState(JSON.parse(JSON.stringify(target)));
        syncUndoRedoState();
      }
    }
  }, [syncUndoRedoState]);

  const handleRedoComic = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current += 1;
      const target = historyRef.current[historyIndexRef.current];
      if (target) {
        setComicPagesState(JSON.parse(JSON.stringify(target)));
        syncUndoRedoState();
      }
    }
  }, [syncUndoRedoState]);

  const activePage = comicPages[activePageIndex] || comicPages[0];
  const comicTree = activePage.tree;
  const bubbles = activePage.bubbles;

  const handleAddNewPage = useCallback(() => {
    const currentPages = comicPagesRef.current;
    const currentIndex = activePageIndexRef.current;
    const currentTree = currentPages[currentIndex]?.tree || currentPages[0]?.tree;
    const newTree = currentTree ? cloneTreeWithEmptyPanels(currentTree) : createGridTree(3, 2);
    const newPage: ComicPage = {
      id: Date.now().toString(),
      tree: newTree,
      bubbles: [],
    };
    const insertIndex = currentIndex + 1;
    const newPages = [
      ...currentPages.slice(0, insertIndex),
      newPage,
      ...currentPages.slice(insertIndex),
    ];
    setComicPages(newPages);
    setActivePageIndex(insertIndex);
  }, [setComicPages]);

  const handleDeleteCurrentPage = useCallback(() => {
    const currentPages = comicPagesRef.current;
    const currentIndex = activePageIndexRef.current;
    if (currentPages.length <= 1) {
      const defaultTree = createGridTree(3, 2);
      setComicPages([
        {
          id: Date.now().toString(),
          tree: defaultTree,
          bubbles: [],
        },
      ]);
      setActivePageIndex(0);
      return;
    }
    const newPages = currentPages.filter((_, i) => i !== currentIndex);
    const nextIndex = Math.min(currentIndex, newPages.length - 1);
    setComicPages(newPages);
    setActivePageIndex(Math.max(0, nextIndex));
  }, [setComicPages]);

  const flipToPrevComicPage = useCallback(() => {
    setActivePageIndex((prev) => {
      if (prev > 0) {
        return prev - 1;
      }
      return prev;
    });
  }, []);

  const flipToNextComicPage = useCallback(() => {
    setActivePageIndex((prev) => {
      if (prev < comicPagesLengthRef.current - 1) {
        return prev + 1;
      }
      return prev;
    });
  }, []);

  const mapTreeDrawings = useCallback(
    (node: TreeNode, fn: (strokes: Stroke[]) => Stroke[]): TreeNode => {
      if (node.type === "panel") {
        return {
          ...node,
          drawings: node.drawings ? fn(node.drawings) : [],
        };
      }
      return {
        ...node,
        c1: mapTreeDrawings(node.c1, fn),
        c2: mapTreeDrawings(node.c2, fn),
      };
    },
    [],
  );

  const handleSelectLayer = useCallback(
    (id: string, e?: React.MouseEvent) => {
      if (e?.shiftKey && lastSelectedLayerIdRef.current) {
        const ids = comicLayers.map((l) => l.id);
        const fromIdx = ids.indexOf(lastSelectedLayerIdRef.current);
        const toIdx = ids.indexOf(id);
        if (fromIdx !== -1 && toIdx !== -1) {
          const start = Math.min(fromIdx, toIdx);
          const end = Math.max(fromIdx, toIdx);
          const range = ids.slice(start, end + 1);
          setSelectedLayerIds(range);
          setActiveLayerId(id);
          return;
        }
      }

      if (e?.ctrlKey || e?.metaKey) {
        setSelectedLayerIds((prev) => {
          const exists = prev.includes(id);
          if (exists) {
            const next = prev.filter((item) => item !== id);
            return next.length > 0 ? next : [id];
          } else {
            return [...prev, id];
          }
        });
        setActiveLayerId(id);
        lastSelectedLayerIdRef.current = id;
        return;
      }

      setSelectedLayerIds([id]);
      setActiveLayerId(id);
      lastSelectedLayerIdRef.current = id;
    },
    [comicLayers],
  );

  const handleAddLayer = useCallback(() => {
    const newId = "layer-" + Date.now();
    const count = comicLayers.filter((l) => !l.isBackground).length + 1;
    const newLayer: ComicLayer = {
      id: newId,
      name: `Layer ${count}`,
      visible: true,
      opacity: 1,
    };

    setComicLayers((prev) => {
      const activeIdx = prev.findIndex((l) => l.id === activeLayerId);
      if (activeIdx !== -1) {
        const next = [...prev];
        next.splice(activeIdx + 1, 0, newLayer);
        return next;
      }
      return [...prev, newLayer];
    });

    setActiveLayerId(newId);
    setSelectedLayerIds([newId]);
    lastSelectedLayerIdRef.current = newId;
    toast.success(`Layer "${newLayer.name}" created (Ctrl+J)`);
  }, [activeLayerId, comicLayers]);

  const handleCombineLayers = useCallback(() => {
    const regularSelected = comicLayers.filter(
      (l) => selectedLayerIds.includes(l.id) && !l.isBackground,
    );

    if (regularSelected.length < 1) {
      toast.info("Select layers to combine (Ctrl+E)");
      return;
    }

    let targetLayer: ComicLayer;
    let layersToMerge: ComicLayer[];

    if (regularSelected.length === 1) {
      const currentIdx = comicLayers.findIndex((l) => l.id === regularSelected[0].id);
      if (currentIdx <= 1) {
        toast.info("Cannot merge down bottom-most layer");
        return;
      }
      targetLayer = comicLayers[currentIdx - 1];
      layersToMerge = [regularSelected[0], targetLayer];
    } else {
      const sorted = [...regularSelected].sort(
        (a, b) => comicLayers.indexOf(a) - comicLayers.indexOf(b),
      );
      targetLayer = sorted[0];
      layersToMerge = sorted;
    }

    const mergedIds = new Set(layersToMerge.map((l) => l.id));
    const targetId = targetLayer.id;

    // Update drawing strokes across current active page tree
    setComicPages((pages) =>
      pages.map((p, i) =>
        i === activePageIndex
          ? {
              ...p,
              tree: mapTreeDrawings(p.tree, (strokes) =>
                strokes.map((s) =>
                  mergedIds.has(s.layerId || "layer-1") ? { ...s, layerId: targetId } : s,
                ),
              ),
            }
          : p,
      ),
    );

    // Remove merged layers
    setComicLayers((prev) =>
      prev.filter((l) => l.id === targetId || !mergedIds.has(l.id)),
    );

    setActiveLayerId(targetId);
    setSelectedLayerIds([targetId]);
    lastSelectedLayerIdRef.current = targetId;
    toast.success(`Combined into "${targetLayer.name}" (Ctrl+E)`);
  }, [comicLayers, selectedLayerIds, activePageIndex, mapTreeDrawings]);

  const handleGroupLayers = useCallback(() => {
    const regularSelected = comicLayers.filter(
      (l) => selectedLayerIds.includes(l.id) && !l.isBackground,
    );
    if (regularSelected.length === 0) {
      toast.info("Select layers to group (Ctrl+G)");
      return;
    }

    const groupId = "group-" + Date.now();
    const groupName = `Group ${layerGroups.length + 1}`;
    const newGroup: ComicLayerGroup = {
      id: groupId,
      name: groupName,
      visible: true,
      collapsed: false,
    };

    setLayerGroups((prev) => [...prev, newGroup]);
    setComicLayers((prev) =>
      prev.map((l) =>
        selectedLayerIds.includes(l.id) && !l.isBackground
          ? { ...l, groupId }
          : l,
      ),
    );
    toast.success(`Group "${groupName}" created (Ctrl+G)`);
  }, [comicLayers, selectedLayerIds, layerGroups.length]);

  const handleDeleteLayer = useCallback(
    (id: string) => {
      const layer = comicLayers.find((l) => l.id === id);
      if (!layer || layer.isBackground) {
        toast.error("Cannot delete the background layer");
        return;
      }
      const regularLayers = comicLayers.filter((l) => !l.isBackground);
      if (regularLayers.length <= 1) {
        toast.info("Canvas must have at least one layer");
        return;
      }

      setComicPages((pages) =>
        pages.map((p, i) =>
          i === activePageIndex
            ? {
                ...p,
                tree: mapTreeDrawings(p.tree, (strokes) =>
                  strokes.filter((s) => (s.layerId || "layer-1") !== id),
                ),
              }
            : p,
        ),
      );

      const nextLayers = comicLayers.filter((l) => l.id !== id);
      setComicLayers(nextLayers);

      const nextActive = nextLayers.find((l) => !l.isBackground) || nextLayers[0];
      setActiveLayerId(nextActive.id);
      setSelectedLayerIds([nextActive.id]);
      lastSelectedLayerIdRef.current = nextActive.id;
      toast.success(`Deleted layer "${layer.name}"`);
    },
    [comicLayers, activePageIndex, mapTreeDrawings],
  );

  const handleToggleLayerVisibility = useCallback((id: string) => {
    setComicLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, visible: l.visible === false } : l)),
    );
  }, []);

  const handleToggleGroupVisibility = useCallback((groupId: string) => {
    setLayerGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, visible: g.visible === false } : g)),
    );
  }, []);

  const handleToggleGroupCollapse = useCallback((groupId: string) => {
    setLayerGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g)),
    );
  }, []);

  const handleReorderLayers = useCallback((newLayers: ComicLayer[]) => {
    setComicLayers(newLayers);
  }, []);

  const handleUpdateLayer = useCallback(
    (id: string, updates: Partial<ComicLayer>) => {
      if (updates.color) {
        if (createMode === "document") {
          const currentCanvasId = selectedCanvasElement?.getAttribute("data-id") ||
            activeCanvasElements[activeCanvasElements.length - 1]?.id;
          if (currentCanvasId) {
            setInlineCanvases((prev) => {
              const current = prev[currentCanvasId];
              if (!current) return prev;
              const updated = {
                ...prev,
                [currentCanvasId]: { ...current, backgroundColor: updates.color },
              };
              const el = editorRef.current?.querySelector(`[data-id="${currentCanvasId}"]`);
              if (el) {
                el.setAttribute("data-canvas-data", JSON.stringify(updated[currentCanvasId]));
              }
              pushInlineCanvasesHistory(updated);
              return updated;
            });
            setTimeout(updateToc, 50);
            return;
          }
        }
        setComicBackgroundColor(updates.color);
      }
      setComicLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, ...updates } : l)),
      );
    },
    [createMode, selectedCanvasElement, activeCanvasElements, updateToc, pushInlineCanvasesHistory],
  );

  const handleUpdateGroup = useCallback(
    (groupId: string, updates: Partial<ComicLayerGroup>) => {
      setLayerGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, ...updates } : g)),
      );
    },
    [],
  );

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;

      // In Document mode, handle Delete / Backspace when an illustration is selected
      if (createMode === "document" && (e.key === "Delete" || e.key === "Backspace")) {
        const hasImg = selectedImageElements.length > 0 || (imageMenuProps.visible && !!imageMenuProps.imgElement);
        const hasCanvas = selectedCanvasElements.length > 0 || !!selectedCanvasElement;

        if (hasImg || hasCanvas) {
          e.preventDefault();
          if (hasImg) {
            const toRemove = selectedImageElements.length > 0
              ? [...selectedImageElements]
              : (imageMenuProps.imgElement ? [imageMenuProps.imgElement] : []);
            toRemove.forEach((img) => img.remove());
            setSelectedImageElements([]);
            setImageMenuProps({ visible: false, top: 0, left: 0, imgElement: null });
          }
          if (hasCanvas) {
            const toRemove = selectedCanvasElements.length > 0
              ? [...selectedCanvasElements]
              : (selectedCanvasElement ? [selectedCanvasElement] : []);
            const ids = toRemove.map((c) => c.getAttribute("data-id")).filter(Boolean) as string[];
            toRemove.forEach((c) => c.remove());
            setSelectedCanvasElements([]);
            setSelectedCanvasElement(null);
            if (ids.length > 0) {
              setInlineCanvases((prev) => {
                const updated = { ...prev };
                ids.forEach((id) => delete updated[id]);
                pushInlineCanvasesHistory(updated);
                return updated;
              });
            }
          }
          updateToc();
          setTimeout(() => pushStoryDocHistory(), 50);
          return;
        }
      }

      // Document mode Undo/Redo: intercept Ctrl+Z and Ctrl+Y even in contenteditable editor
      if (createMode === "document" && (e.ctrlKey || e.metaKey)) {
        const isInput = ["INPUT", "TEXTAREA"].includes(target?.tagName || "");
        if (!isInput) {
          const key = e.key.toLowerCase();
          if (key === "z") {
            e.preventDefault();
            if (e.shiftKey) {
              if (isDrawingMode) {
                if (handleRedoInline()) return;
              } else {
                if (handleRedoStoryDoc()) return;
              }
            } else {
              if (isDrawingMode) {
                if (handleUndoInline()) return;
              } else {
                if (handleUndoStoryDoc()) return;
              }
            }
            return;
          }
          if (key === "y") {
            e.preventDefault();
            if (isDrawingMode) {
              if (handleRedoInline()) return;
            } else {
              if (handleRedoStoryDoc()) return;
            }
            return;
          }
        }
      }

      if (
        ["INPUT", "TEXTAREA"].includes(target?.tagName || "") ||
        target?.isContentEditable ||
        Boolean(target?.closest?.('[contenteditable="true"]'))
      )
        return;

      if (createMode === "comic") {
        if (
          !isAIGeneratorOpen &&
          !isAIFullComicDialogOpen &&
          !isAIFullStoryDialogOpen &&
          !showPublishAuthHint
        ) {
          // Also support CTRL+N / CMD+N as fallback for N
          if (e.key.toLowerCase() === "n") {
            e.preventDefault();
            handleAddNewPage();
            return;
          }

          // Also support CTRL+DELETE / CMD+DELETE as fallback
          if (
            e.key === "Delete" ||
            e.key === "Backspace" ||
            e.code === "Delete" ||
            e.code === "Backspace"
          ) {
            e.preventDefault();
            handleDeleteCurrentPage();
            return;
          }

          // Layer shortcuts: Ctrl+J new layer, Ctrl+E combine layers, Ctrl+G group layers
          const k = e.key.toLowerCase();
          if (k === "j") {
            e.preventDefault();
            handleAddLayer();
            return;
          }
          if (k === "e") {
            e.preventDefault();
            handleCombineLayers();
            return;
          }
          if (k === "g") {
            e.preventDefault();
            handleGroupLayers();
            return;
          }
        }

        // Comic Undo (Ctrl+Z / Cmd+Z) and Redo (Ctrl+Y / Ctrl+Shift+Z / Cmd+Shift+Z)
        if (
          (e.ctrlKey || e.metaKey) &&
          e.key.toLowerCase() === "z" &&
          !e.shiftKey
        ) {
          e.preventDefault();
          handleUndoComic();
          return;
        }
        if (
          (e.ctrlKey || e.metaKey) &&
          ((e.key.toLowerCase() === "z" && e.shiftKey) ||
            e.key.toLowerCase() === "y")
        ) {
          e.preventDefault();
          handleRedoComic();
          return;
        }

        // Single key shortcuts when not in dialogs/inputs
        if (
          !isAIGeneratorOpen &&
          !isAIFullComicDialogOpen &&
          !isAIFullStoryDialogOpen &&
          !showPublishAuthHint
        ) {
          // 'N' shortcut to add new page directly following current page
          if (e.key.toLowerCase() === "n") {
            e.preventDefault();
            handleAddNewPage();
            return;
          }

          // Arrow keys and PageUp/PageDown to flip comic pages
          if (e.key === "ArrowLeft" || e.key === "PageUp") {
            e.preventDefault();
            flipToPrevComicPage();
            return;
          }
          if (e.key === "ArrowRight" || e.key === "PageDown") {
            e.preventDefault();
            flipToNextComicPage();
            return;
          }
        }

        const key = e.key.toLowerCase();
        if (key === "d" && !e.ctrlKey && !e.metaKey) {
          setIsDrawingMode((prev) => {
            const next = !prev;
            if (next) setDrawTool("pen");
            return next;
          });
        }
        if (isDrawingMode && !e.ctrlKey && !e.metaKey) {
          if (key === "e") setDrawTool("erase");
          if (key === "l") setDrawTool("select");
          if (key === "p") setDrawTool("pen");
          if (key === "f") setDrawTool("fill");
        }
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [
    createMode,
    isDrawingMode,
    isAIGeneratorOpen,
    isAIFullComicDialogOpen,
    isAIFullStoryDialogOpen,
    showPublishAuthHint,
    handleAddNewPage,
    handleDeleteCurrentPage,
    flipToPrevComicPage,
    flipToNextComicPage,
    handleAddLayer,
    handleCombineLayers,
    handleGroupLayers,
  ]);

  // Finger swipe gesture for flipping comic pages on touch devices
  useEffect(() => {
    if (createMode !== "comic") return;
    // When any drawing tool is active, prevent drawing strokes from being misinterpreted as swipe page-turns.
    if (isDrawingMode) return;
    const el = comicWorkspaceRef.current;
    if (!el) return;

    const handleTouchStart = (e: TouchEvent) => {
      // Strictly prevent drawing strokes from being misinterpreted as swipe page-turns when drawing mode is on
      if (isDrawingMode) {
        touchStartPosRef.current = null;
        return;
      }

      if (e.touches.length !== 1) {
        touchStartPosRef.current = null;
        return;
      }

      const target = e.target as HTMLElement;
      if (
        target?.closest?.(
          'button, input, textarea, select, [data-bubble-id], [contenteditable="true"], .bubble-overlay, [data-export-ignore="true"], canvas, [data-panel-drawing], .panel-drawing-layer, [data-drawing-container], [data-panel-id], svg[data-panel-drawing]'
        )
      ) {
        touchStartPosRef.current = null;
        return;
      }

      const touch = e.touches[0];
      touchStartPosRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isDrawingMode || e.touches.length > 1) {
        touchStartPosRef.current = null;
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (isDrawingMode || !touchStartPosRef.current) return;

      const touch = e.changedTouches[0];
      if (!touch) {
        touchStartPosRef.current = null;
        return;
      }

      const start = touchStartPosRef.current;
      touchStartPosRef.current = null;

      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      const elapsed = Date.now() - start.time;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      // Fast horizontal swipe gesture (distance >= 40px, under 700ms, more horizontal than vertical)
      if (elapsed < 700 && absX >= 40 && absX > absY * 1.25) {
        isSwipingComicPageRef.current = true;
        setTimeout(() => {
          isSwipingComicPageRef.current = false;
        }, 300);

        if (deltaX < 0) {
          // Swiped Left -> Flip to Next page
          flipToNextComicPage();
        } else {
          // Swiped Right -> Flip to Previous page
          flipToPrevComicPage();
        }
      }
    };

    const handleTouchCancel = () => {
      touchStartPosRef.current = null;
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: true });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [createMode, isDrawingMode, touchOff, flipToNextComicPage, flipToPrevComicPage]);

  useEffect(() => {
    const handleUp = () => setIsDraggingToolbar(false);
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (isDraggingToolbar) {
        if (e.cancelable) {
          e.preventDefault();
        }
        const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
        const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
        let newX =
          dragToolbarStartRef.current.posX +
          (clientX - dragToolbarStartRef.current.x);
        let newY =
          dragToolbarStartRef.current.posY +
          (clientY - dragToolbarStartRef.current.y);

        // Boundaries
        newX = Math.max(0, Math.min(newX, window.innerWidth - 320));
        newY = Math.max(0, Math.min(newY, window.innerHeight - 60));

        setDrawToolbarPos({ x: newX, y: newY });
      }
    };

    if (isDraggingToolbar) {
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
      window.addEventListener("touchmove", handleMove, { passive: false });
      window.addEventListener("touchend", handleUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleUp);
    };
  }, [isDraggingToolbar]);

  useEffect(() => {
    const handleOpenAIGenerator = () => setIsAIGeneratorOpen(true);
    const handleOpenDrawMode = () => setIsDrawingMode(true);
    const handleOpenGenerateFullComic = (e: any) => {
      setCreateMode("comic");
      if (e.detail?.prompt) {
        setAiFullComicPrompt(e.detail.prompt);
        setIsAIFullComicDialogOpen(true);
      }
    };

    const handleOpenGenerateFullStory = (e: any) => {
      setCreateMode("document");
      if (e.detail?.prompt) {
        setAiFullStoryPrompt(e.detail.prompt);
        setIsAIFullStoryDialogOpen(true);
      }
    };

    const handleOpenComicCreator = () => {
      resetDrawToolSettingsToDefault();
      setCreateMode("comic");
    };

    const handleOpenStoryWriter = () => {
      setCreateMode("document");
    };

    window.addEventListener("open-ai-script-dialog", handleOpenAIGenerator);
    window.addEventListener("open-draw-mode", handleOpenDrawMode);
    window.addEventListener(
      "open-generate-full-comic",
      handleOpenGenerateFullComic,
    );
    window.addEventListener(
      "open-generate-full-story",
      handleOpenGenerateFullStory,
    );
    window.addEventListener("open-comic-creator", handleOpenComicCreator);
    window.addEventListener("open-story-writer", handleOpenStoryWriter);

    return () => {
      window.removeEventListener(
        "open-ai-script-dialog",
        handleOpenAIGenerator,
      );
      window.removeEventListener("open-draw-mode", handleOpenDrawMode);
      window.removeEventListener(
        "open-generate-full-comic",
        handleOpenGenerateFullComic,
      );
      window.removeEventListener(
        "open-generate-full-story",
        handleOpenGenerateFullStory,
      );
      window.removeEventListener("open-comic-creator", handleOpenComicCreator);
      window.removeEventListener("open-story-writer", handleOpenStoryWriter);
    };
  }, []);

  useEffect(() => {
    const handleInsertImage = (e: any) => {
      const imageUrl = e.detail?.imageUrl;
      if (!imageUrl) return;
      if (createMode === "document") {
        if (editorRef.current) {
          editorRef.current.focus();
          const img = document.createElement("img");
          img.src = imageUrl;
          img.style.width = "33.33%";

          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            range.insertNode(img);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          } else {
            editorRef.current.appendChild(img);
          }
          updateToc();
        }
      } else if (createMode === "comic") {
        setComicPages((prev) => {
          let updatedPages = [...prev];
          const page = updatedPages[activePageIndex];
          if (page) {
            const targetPanelId = e.detail?.panelId;
            const activePath = (window as any).activeComicPanelPath;
            
            if (targetPanelId) {
              const replaceNodeById = (node: TreeNode): TreeNode => {
                if (node.type === "panel" && node.id === targetPanelId) {
                  return { ...node, imageUrl: imageUrl, drawings: [] };
                }
                if (node.type !== "panel") {
                  return {
                    ...node,
                    c1: replaceNodeById(node.c1),
                    c2: replaceNodeById(node.c2),
                  };
                }
                return node;
              };
              updatedPages[activePageIndex] = {
                ...page,
                tree: replaceNodeById(page.tree),
              };
              setTimeout(() => toast.success("Image placed in panel!"), 0);
            } else if (activePath) {
              const replaceNodeByPath = (
                node: TreeNode,
                curPath: number[],
                url: string,
              ): TreeNode => {
                if (curPath.length === 0 && node.type === "panel") {
                  // When replacing a panel image from AI, we also clear drawings so they don't overlap awkwardly
                  return { ...node, imageUrl: url, drawings: [] };
                }
                if (node.type !== "panel") {
                  const isFirst = curPath[0] === 0;
                  const nextPath = curPath.slice(1);
                  return {
                    ...node,
                    c1: isFirst
                      ? replaceNodeByPath(node.c1, nextPath, url)
                      : node.c1,
                    c2: !isFirst
                      ? replaceNodeByPath(node.c2, nextPath, url)
                      : node.c2,
                  };
                }
                return node;
              };
              updatedPages[activePageIndex] = {
                ...page,
                tree: replaceNodeByPath(page.tree, activePath, imageUrl),
              };
              setTimeout(
                () => toast.success("Image placed in selected panel!"),
                0,
              );
            } else {
              const { tree, updated } = fillFirstEmptyPanel(
                page.tree,
                imageUrl,
              );
              if (updated) {
                updatedPages[activePageIndex] = { ...page, tree };
                setTimeout(() => toast.success("Image added to comic!"), 0);
              } else {
                setTimeout(
                  () =>
                    toast.info(
                      "No empty panels on this page. Please add an empty panel first!",
                    ),
                  0,
                );
              }
            }
          }
          return updatedPages;
        });
      }
    };

    window.addEventListener("insert-comic-image", handleInsertImage);

    (window as any).getComicCanvasContext = async () => {
      if (createMode === "comic" && comicRef.current) {
        try {
          const { toPng } = await import("html-to-image");
          const dataUrl = await toPng(comicRef.current, { quality: 0.8 });
          return dataUrl;
        } catch (e) {
          console.error("toPng error", e);
          return null;
        }
      }
      return null;
    };

    (window as any).getComicPanelsContext = () => {
      if (createMode !== "comic") return "";
      
      const countPanels = (node: any): any[] => {
          if (node.type === "panel") return [node];
          if (node.dir) return [...countPanels(node.c1), ...countPanels(node.c2)];
          return [];
      };
      
      const activePage = comicPages[activePageIndex] || comicPages[0];
      const panels = countPanels(activePage.tree);
      
      let context = `The current comic page has ${panels.length} panels.\n`;
      panels.forEach((p, idx) => {
          context += `Panel ID: ${p.id} - ${p.imageUrl ? "Contains an image." : "Empty."}\n`;
      });
      return context;
    };

    return () => {
      window.removeEventListener("insert-comic-image", handleInsertImage);
      delete (window as any).getComicCanvasContext;
      delete (window as any).getComicPanelsContext;
    };
  }, [createMode, activePageIndex, comicPages]);

  const updateActivePageTree = (newTree: TreeNode) => {
    setComicPages((pages) =>
      pages.map((p, i) =>
        i === activePageIndex ? { ...p, tree: newTree } : p,
      ),
    );
  };

  const updateActivePageBubbles = (newBubbles: Bubble[]) => {
    setComicPages((pages) =>
      pages.map((p, i) =>
        i === activePageIndex ? { ...p, bubbles: newBubbles } : p,
      ),
    );
  };

  const handleFullComicGenerated = async (
    scriptData: any,
    sketch: string | null,
  ) => {
    if (!scriptData || !scriptData.pages) return;
    setIsAIFullComicDialogOpen(false);

    toast.info("Generating comic pages! This might take a minute...", {
      duration: 5000,
    });

    const sharedConsistencySeed = Math.floor(Math.random() * 100000000);
    const newPages: ComicPage[] = [];

    for (let pIdx = 0; pIdx < scriptData.pages.length; pIdx++) {
      const pageScript = scriptData.pages[pIdx];
      const panelsCount = pageScript.panels ? pageScript.panels.length : 0;

      let rows = 1,
        cols = 1;
      if (panelsCount === 2) {
        rows = 2;
        cols = 1;
      } else if (panelsCount === 3 || panelsCount === 4) {
        rows = 2;
        cols = 2;
      } else if (panelsCount >= 5) {
        rows = 3;
        cols = 2;
      }

      const tree = createGridTree(rows, cols);
      const bubbles: Bubble[] = [];

      let currentTree = tree;

      // Update state progressively
      const newPageId = Date.now().toString() + pIdx;
      setComicPages((prev) => {
        const isDefault =
          prev.length === 1 &&
          prev[0].bubbles?.length === 2 &&
          prev[0].bubbles[0].text === "HELLO WORLD!";
        const newPages =
          isDefault && pIdx === 0
            ? [{ id: newPageId, tree: currentTree, bubbles }]
            : [...prev, { id: newPageId, tree: currentTree, bubbles }];
        if (pIdx === 0) {
          const idx = newPages.findIndex((p) => p.id === newPageId);
          requestAnimationFrame(() => setActivePageIndex(idx !== -1 ? idx : 0));
        }
        return newPages;
      });

      for (let i = 0; i < panelsCount; i++) {
        const panel = pageScript.panels[i];
        if (!panel) continue;
        const prompt =
          panel.imagePrompt +
          ", comic book art style, graphic novel, vivid colors, inked lines, cel shaded";

        try {
          if (i > 0) {
            await new Promise((resolve) => setTimeout(resolve, 800)); // Small delay to avoid rate limiting
          }
          let imageUrl = null;
          toast.loading(
            `Generating artwork for panel ${i + 1} of ${panelsCount}...`,
          );

          try {
            const res = await fetch(`${getApiUrl()}/api/generate-image`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt: prompt + (sketch ? " consistent with sketch" : ""),
                aspectRatio: "1:1",
                imageBase64: sketch,
                engine: llmEngine,
                seed: sharedConsistencySeed,
              }),
            });

            if (res.ok) {
              const data = await res.json();
              imageUrl = data.imageUrl;
            } else {
              throw new Error("Backend failed");
            }
          } catch (e: any) {
            console.warn(
              "Falling back to client-side FLUX generation...",
              e,
            );
            const encodedPrompt = encodeURIComponent(
              prompt + (sketch ? " consistent with sketch" : ""),
            );
            imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&seed=${sharedConsistencySeed}&nologo=true&model=flux`;
          }

          if (imageUrl) {
            // Pre-fetch to ensure the generation completes before we attempt to render
            try {
              const imgResult = await fetch(imageUrl);
              if (imgResult.ok) {
                const contentType = imgResult.headers.get("content-type");
                if (contentType && contentType.startsWith("image/")) {
                  const imgBlob = await imgResult.blob();
                  imageUrl = URL.createObjectURL(imgBlob);
                }
              }
            } catch (e) {}

            const { tree: newT, updated } = fillFirstEmptyPanel(
              currentTree,
              imageUrl,
            );
            if (updated) {
              currentTree = newT;
              setComicPages((prev) => {
                const updatedPages = [...prev];
                const ptIdx = updatedPages.findIndex((p) => p.id === newPageId);
                if (ptIdx !== -1)
                  updatedPages[ptIdx] = {
                    ...updatedPages[ptIdx],
                    tree: currentTree,
                  };
                return updatedPages;
              });
            }
          }
        } catch (e) {
          console.error("Failed to generate panel image", e);
        }

        toast.dismiss();

        if (panel.dialogue) {
          bubbles.push({
            id: Math.random().toString(),
            text: panel.dialogue,
            x: 10 + (i % cols) * 45,
            y: 10 + Math.floor(i / cols) * 40,
            style: "classic",
          });
          setComicPages((prev) => {
            const updatedPages = [...prev];
            const ptIdx = updatedPages.findIndex((p) => p.id === newPageId);
            if (ptIdx !== -1)
              updatedPages[ptIdx] = {
                ...updatedPages[ptIdx],
                bubbles: [...bubbles],
              };
            return updatedPages;
          });
        }
      }
    }
    toast.dismiss();
    toast.success("Full comic generated!");
  };

  const isPointerDown = useRef(false);

  useEffect(() => {
    const handleSelectionChange = () => {
      if (createMode !== "document") {
        setFloatingMenuProps((prev) =>
          prev.visible ? { ...prev, visible: false } : prev,
        );
        return;
      }

      if (isPointerDown.current) {
        setFloatingMenuProps((prev) =>
          prev.visible ? { ...prev, visible: false } : prev,
        );
        return;
      }

      const selection = window.getSelection();
      let hasTextContent = false;
      if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const clone = range.cloneContents();
        hasTextContent = clone.textContent?.trim().length ? true : false;
        if (
          clone.querySelectorAll("img").length > 0 &&
          clone.textContent?.trim().length === 0
        ) {
          hasTextContent = false;
        }
      }

      if (
        selection &&
        hasTextContent &&
        editorRef.current &&
        editorRef.current.contains(selection.anchorNode)
      ) {
        const range = selection.getRangeAt(0);
        const rects = range.getClientRects();
        if (rects.length > 0) {
          const rect = rects[0];
          setFloatingMenuProps({
            visible: true,
            top: Math.max(10, rect.top - 46),
            left: Math.max(
              10,
              Math.min(rect.left + rect.width / 2, window.innerWidth - 100),
            ),
          });
        }
      } else {
        setFloatingMenuProps((prev) =>
          prev.visible ? { ...prev, visible: false } : prev,
        );
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest(".floating-toolbar")) return;
      isPointerDown.current = true;
      setFloatingMenuProps((prev) =>
        prev.visible ? { ...prev, visible: false } : prev,
      );
    };

    const handlePointerUp = () => {
      isPointerDown.current = false;
      setTimeout(handleSelectionChange, 10);
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointerup", handlePointerUp);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointerup", handlePointerUp);
    };
  }, [createMode]);

  useEffect(() => {
    if (onActiveStateChange) {
      onActiveStateChange(createMode !== "select");
    }
  }, [createMode, onActiveStateChange]);

  const [activeBubbleId, setActiveBubbleId] = useState<string | null>(null);
  const [isComicPanelExpanded, setIsComicPanelExpanded] = useState(false);

  useEffect(() => {
    onFullscreenChange?.(isComicPanelExpanded);
  }, [isComicPanelExpanded, onFullscreenChange]);

  useEffect(() => {
    return () => {
      onFullscreenChange?.(false);
    };
  }, [onFullscreenChange]);

  const [newBubbleText, setNewBubbleText] = useState("");
  const [bubbleStyle, setBubbleStyle] = useState<
    "classic" | "action" | "freehand"
  >("classic");
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGeneratingText, setIsGeneratingText] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const pushStoryDocHistoryRef = useRef(pushStoryDocHistory);
  pushStoryDocHistoryRef.current = pushStoryDocHistory;
  const updateTocRef = useRef(updateToc);
  updateTocRef.current = updateToc;

  // Populate rich text content on story mode mount, and auto-save on change
  useEffect(() => {
    if (createMode === "document" && editorRef.current) {
      if (loadedHtmlContent !== null) {
        editorRef.current.innerHTML = loadedHtmlContent;

        // Hydrate inline drawing canvases from loaded HTML content
        const placeholders = editorRef.current.querySelectorAll(".story-inline-canvas-placeholder");
        const hydrated: Record<string, { node: PanelNode; widthPercent: number }> = {};
        placeholders.forEach((el) => {
          el.innerHTML = ""; // Clear residual portal DOM
          let id = el.getAttribute("data-id");
          if (!id) {
            id = "inline-canvas-" + Math.random().toString(36).substring(2, 9);
            el.setAttribute("data-id", id);
          }
          const canvasDataStr = el.getAttribute("data-canvas-data");
          let parsedData: any = null;
          if (canvasDataStr) {
            try {
              parsedData = JSON.parse(canvasDataStr);
            } catch (e) {
              console.error("Failed to parse canvas data string", e);
            }
          }

          const node: PanelNode = parsedData?.node || {
            id,
            type: "panel",
            drawings: [],
            imageUrl: "",
          };
          const widthPercent = parsedData?.widthPercent || 66.6;

          hydrated[id] = { node, widthPercent };

          // Sync back clean json attribute and style width on element
          const jsonStr = JSON.stringify({ node, widthPercent });
          el.setAttribute("data-canvas-data", jsonStr);
          (el as HTMLElement).style.width = `${widthPercent}%`;
          (el as HTMLElement).style.aspectRatio = "4/3";
          (el as HTMLElement).style.margin = "1.5rem auto";
          (el as HTMLElement).style.display = "block";
          (el as HTMLElement).style.position = "relative";
        });

        setInlineCanvases(hydrated);
        storyDocHistoryRef.current = [];
        storyDocHistoryIndexRef.current = -1;
        setLoadedHtmlContent(null);
        setTimeout(() => {
          pushStoryDocHistoryRef.current();
          updateTocRef.current();
        }, 50);
      } else if (editorRef.current.innerHTML.trim() === "") {
        editorRef.current.innerHTML = "<h1><br></h1><h2><br></h2><p><br></p>";
        storyDocHistoryRef.current = [];
        storyDocHistoryIndexRef.current = -1;
        setTimeout(() => {
          pushStoryDocHistoryRef.current();
          updateTocRef.current();
        }, 50);
      }
      setTimeout(() => updateTocRef.current(), 50);
    }
  }, [createMode, loadedHtmlContent]);

  // Sync inlineCanvases state back to DOM element data-canvas-data attributes and auto-save draft
  useEffect(() => {
    if (createMode === "document" && editorRef.current && !isPublishedStoryRef.current) {
      let changed = false;
      Object.entries(inlineCanvases).forEach(([id, data]) => {
        const el = editorRef.current?.querySelector(`[data-id="${id}"]`);
        if (el) {
          const json = JSON.stringify(data);
          if (el.getAttribute("data-canvas-data") !== json) {
            el.setAttribute("data-canvas-data", json);
            if (data.widthPercent) {
              (el as HTMLElement).style.width = `${data.widthPercent}%`;
            }
            changed = true;
          }
        }
      });
      if (changed) {
        pushStoryDocHistory();
      }
    }
  }, [inlineCanvases, createMode, pushStoryDocHistory]);

  // Use a MutationObserver to find and track placeholder divs and images for portal mounting and labels
  useEffect(() => {
    if (createMode === "document" && editorRef.current) {
      const scan = () => {
        if (!editorRef.current) return;
        const allIllustrations = editorRef.current.querySelectorAll("img, .story-inline-canvas-placeholder");
        const foundCanvases: { id: string; element: HTMLElement; label: string }[] = [];
        const foundImages: { element: HTMLImageElement; label: string }[] = [];

        allIllustrations.forEach((el, idx) => {
          const label = `L${idx + 1}`;
          el.setAttribute("data-label", label);
          if (el.classList.contains("story-inline-canvas-placeholder")) {
            const htmlEl = el as HTMLElement;
            let id = htmlEl.getAttribute("data-id");
            if (!id) {
              id = "inline-canvas-" + Math.random().toString(36).substring(2, 9);
              htmlEl.setAttribute("data-id", id);
            }
            foundCanvases.push({ id, element: htmlEl, label });
          } else if (el.tagName === "IMG") {
            foundImages.push({ element: el as HTMLImageElement, label });
          }
        });

        setActiveCanvasElements((prev) => {
          if (
            prev.length === foundCanvases.length &&
            prev.every((item, idx) => item.id === foundCanvases[idx].id && item.element === foundCanvases[idx].element && item.label === foundCanvases[idx].label)
          ) {
            return prev;
          }
          return foundCanvases;
        });

        setActiveImageElements((prev) => {
          if (
            prev.length === foundImages.length &&
            prev.every((item, idx) => item.element === foundImages[idx].element && item.label === foundImages[idx].label)
          ) {
            return prev;
          }
          return foundImages;
        });
      };

      scan();

      const observer = new MutationObserver(scan);
      observer.observe(editorRef.current, { childList: true, subtree: true });
      return () => observer.disconnect();
    } else {
      setActiveCanvasElements([]);
      setActiveImageElements([]);
    }
  }, [createMode, inlineCanvases]);

  // Periodic/title-triggered auto-save for story
  useEffect(() => {
    if (createMode === "document" && editorRef.current) {
      if (isPublishedStoryRef.current) return;
      const activeId = currentStoryId || "story-" + Date.now();
      if (!currentStoryId) {
        setCurrentStoryId(activeId);
      }
      let inputDebounceTimer: any = null;
      const handleInput = () => {
        isPublishedStoryRef.current = false;
        clearTimeout(inputDebounceTimer);
        inputDebounceTimer = setTimeout(() => {
          pushStoryDocHistory();
        }, 300);
      };
      
      const el = editorRef.current;
      el.addEventListener("input", handleInput);
      
      // Also save clean HTML when title changes
      const cleanHtml = getCleanStoryHtml();
      if (!isPublishedStoryRef.current && hasStoryEditedContent(cleanHtml)) {
        saveUnfinishedStory({
          id: activeId,
          title: storyTitle,
          htmlContent: cleanHtml,
        });
      }

      return () => {
        clearTimeout(inputDebounceTimer);
        el.removeEventListener("input", handleInput);
      };
    }
  }, [createMode, storyTitle, currentStoryId, pushStoryDocHistory, getCleanStoryHtml]);
  const comicRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [isTranscribing, setIsTranscribing] = useState(false);

  interface PanelLayout {
    id: string;
    x: number; // 0..100
    y: number; // 0..100
    w: number; // 0..100
    h: number; // 0..100
    drawings: Stroke[];
  }

  const getPanelLayouts = (node: TreeNode, x = 0, y = 0, w = 100, h = 100): PanelLayout[] => {
    if (node.type === 'panel') {
      return [{
        id: node.id,
        x, y, w, h,
        drawings: node.drawings || []
      }];
    } else if (node.type === 'split') {
      const { dir, percent, c1, c2 } = node;
      if (dir === 'row') {
        const w1 = w * (percent / 100);
        const w2 = w * ((100 - percent) / 100);
        return [
          ...getPanelLayouts(c1, x, y, w1, h),
          ...getPanelLayouts(c2, x + w1, y, w2, h)
        ];
      } else {
        const h1 = h * (percent / 100);
        const h2 = h * ((100 - percent) / 100);
        return [
          ...getPanelLayouts(c1, x, y, w, h1),
          ...getPanelLayouts(c2, x, y + h1, w, h2)
        ];
      }
    }
    return [];
  };

  const detectBubbleAndHandwriting = (drawings: Stroke[]) => {
    if (!drawings || drawings.length === 0) return null;

    // Calculate bounding box and area for each stroke
    const strokeInfos = drawings.map(s => {
      const xs = s.points.map(p => p.x);
      const ys = s.points.map(p => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const w = maxX - minX;
      const h = maxY - minY;
      const area = w * h;
      return {
        stroke: s,
        minX, maxX, minY, maxY, w, h, area
      };
    });

    // We look for a stroke that actually contains other smaller strokes inside it.
    // The bubble outline should be reasonably large.
    for (let i = 0; i < strokeInfos.length; i++) {
      const candidate = strokeInfos[i];
      if (candidate.w < 6 || candidate.h < 6) continue;

      const insideStrokes = strokeInfos.filter((other, idx) => {
        if (idx === i) return false;
        
        // Check if other stroke's center is inside the candidate
        const otherCenterX = other.minX + other.w / 2;
        const otherCenterY = other.minY + other.h / 2;
        
        return (
          otherCenterX >= candidate.minX &&
          otherCenterX <= candidate.maxX &&
          otherCenterY >= candidate.minY &&
          otherCenterY <= candidate.maxY
        );
      });

      if (insideStrokes.length > 0) {
        return {
          bubbleOutline: candidate,
          handwriting: insideStrokes,
          allInvolvedIds: [candidate.stroke.id, ...insideStrokes.map(h => h.stroke.id)]
        };
      }
    }

    return null;
  };

  const convertDrawnBubble = async () => {
    if (isTranscribing) return;
    setIsTranscribing(true);
    
    const cleanup = () => setIsTranscribing(false);
    
    const layouts = getPanelLayouts(comicTree);
    let targetPanelId: string | null = null;
    let targetLayout: PanelLayout | null = null;
    let detection: ReturnType<typeof detectBubbleAndHandwriting> = null;

    for (const layout of layouts) {
      if (layout.drawings && layout.drawings.length > 0) {
        const det = detectBubbleAndHandwriting(layout.drawings);
        if (det) {
          detection = det;
          targetPanelId = layout.id;
          targetLayout = layout;
          break;
        }
      }
    }

    const hasManualText = newBubbleText && newBubbleText.trim() !== "";

    // Fallback: If no handwriting strokes inside are found, but there are drawings and the user has manual text,
    // we use the largest stroke as the speech bubble outline!
    if (!detection && hasManualText) {
      for (const layout of layouts) {
        if (layout.drawings && layout.drawings.length > 0) {
          const strokeInfos = layout.drawings.map(s => {
            const xs = s.points.map(p => p.x);
            const ys = s.points.map(p => p.y);
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            return {
              stroke: s,
              minX, maxX, minY, maxY,
              w: maxX - minX,
              h: maxY - minY,
              area: (maxX - minX) * (maxY - minY)
            };
          });
          strokeInfos.sort((a, b) => b.area - a.area);
          const candidate = strokeInfos[0];
          
          detection = {
            bubbleOutline: candidate,
            handwriting: [],
            allInvolvedIds: [candidate.stroke.id]
          };
          targetPanelId = layout.id;
          targetLayout = layout;
          break;
        }
      }
    }

    if (!detection || !targetPanelId || !targetLayout) {
      if (hasManualText) {
        toast.info(t("usePenToolNotice"));
      } else {
        toast.info(t("noBubbleDrawingNotice"));
      }
      cleanup();
      return;
    }

    const pts = detection.bubbleOutline.stroke.points;
    if (!pts || pts.length === 0) {
      toast.info(t("noPointsFoundNotice"));
      cleanup();
      return;
    }

    const minX = detection.bubbleOutline.minX;
    const maxX = detection.bubbleOutline.maxX;
    const minY = detection.bubbleOutline.minY;
    const maxY = detection.bubbleOutline.maxY;

    const strokeW = maxX - minX;
    const strokeH = maxY - minY;

    if (strokeW < 5 || strokeH < 4) {
      toast.warning(t("drawnShapeTooSmallNotice"));
      cleanup();
      return;
    }

    const panelRelativeCenterX = minX + strokeW / 2;
    const panelRelativeCenterY = minY + strokeH / 2;

    const pageX = targetLayout.x + (panelRelativeCenterX / 100) * targetLayout.w;
    const pageY = targetLayout.y + (panelRelativeCenterY / 100) * targetLayout.h;

    const bubbleId = Math.random().toString(36).substring(2, 9);

    const removeStrokesFromTree = (node: TreeNode): TreeNode => {
      if (node.type === 'panel') {
        if (node.id === targetPanelId) {
          const involvedIds = detection!.allInvolvedIds;
          return {
            ...node,
            drawings: (node.drawings || []).filter(s => !involvedIds.includes(s.id))
          };
        }
        return node;
      } else {
        return {
          ...node,
          c1: removeStrokesFromTree(node.c1),
          c2: removeStrokesFromTree(node.c2)
        };
      }
    };

    const updatedTree = removeStrokesFromTree(comicTree);
    updateActivePageTree(updatedTree);

    // Convert hand-drawn stroke into smooth vector graphics points with smooth edges
    let normalizedPoints: { x: number; y: number }[] = [];
    let initialTailX = 20;
    let initialTailY = 85;
    let hasTail = false;

    if (pts && pts.length >= 3) {
      const processed = processFreehandBubblePoints(pts);
      normalizedPoints = processed.normalizedPoints;
      initialTailX = processed.initialTailX;
      initialTailY = processed.initialTailY;
      hasTail = processed.hasArrow;
    } else {
      normalizedPoints = generatePerfectSpeechBubblePoints();
      hasTail = true;
    }

    // If the user entered text value manually, directly move it into the custom speech bubble, bypassing OCR!
    if (hasManualText) {
      const newBubble: Bubble = {
        id: bubbleId,
        text: newBubbleText,
        x: pageX,
        y: pageY,
        style: "freehand",
        points: normalizedPoints,
        hasTail,
        tailX: hasTail ? initialTailX : undefined,
        tailY: hasTail ? initialTailY : undefined,
      };

      const currentBubbles = [...bubbles, newBubble];
      updateActivePageBubbles(currentBubbles);
      setActiveBubbleId(bubbleId);
      setBubbleStyle("freehand");
      setNewBubbleText(""); // Clear it so it doesn't trigger random fallbacks later
      toast.success(t("handDrawnBubbleCreatedSuccess"));
      cleanup();
      return;
    }

    // Otherwise, perform handwriting OCR
    const newBubble: Bubble = {
      id: bubbleId,
      text: "Converting writing to text...",
      x: pageX,
      y: pageY,
      style: "freehand",
      points: normalizedPoints,
      hasTail,
      tailX: hasTail ? initialTailX : undefined,
      tailY: hasTail ? initialTailY : undefined,
    };

    const currentBubbles = [...bubbles, newBubble];
    updateActivePageBubbles(currentBubbles);
    setActiveBubbleId(bubbleId);
    setBubbleStyle("freehand");

    try {
      const { toPng } = await import("html-to-image");
      if (!comicRef.current) throw new Error("Comic container not found");

      await new Promise(r => setTimeout(r, 150));

      const dataUrl = await toPng(comicRef.current, { pixelRatio: 1.5 });

      const cropImage = (srcDataUrl: string, pctX: number, pctY: number, pctW: number, pctH: number): Promise<string> => {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              resolve(srcDataUrl);
              return;
            }
            const realW = img.width;
            const realH = img.height;

            const padPct = 5;
            const px = Math.max(0, (pctX - padPct) / 100) * realW;
            const py = Math.max(0, (pctY - padPct) / 100) * realH;
            const pw = Math.min(100, (pctW + padPct * 2) / 100) * realW;
            const ph = Math.min(100, (pctH + padPct * 2) / 100) * realH;

            canvas.width = pw;
            canvas.height = ph;
            ctx.drawImage(img, px, py, pw, ph, 0, 0, pw, ph);
            resolve(canvas.toDataURL("image/jpeg", 0.9));
          };
          img.src = srcDataUrl;
        });
      };

      const pageBoxX = targetLayout.x + (minX / 100) * targetLayout.w;
      const pageBoxY = targetLayout.y + (minY / 100) * targetLayout.h;
      const pageBoxW = (strokeW / 100) * targetLayout.w;
      const pageBoxH = (strokeH / 100) * targetLayout.h;

      const croppedBase64 = await cropImage(dataUrl, pageBoxX, pageBoxY, pageBoxW, pageBoxH);

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (geminiApiKey) {
        headers["x-gemini-api-key"] = geminiApiKey;
      }

      const apiRes = await fetch(`${getApiUrl()}/api/readHandwriting`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          base64Image: croppedBase64,
          engine: llmEngine
        })
      });

      if (!apiRes.ok) {
        throw new Error("Transcribing endpoint failed");
      }

      const resData = await apiRes.json();
      let transcribedText = resData.text ? resData.text.trim() : "";

      // Clean/sanitize invalid JSON reasoning responses from fallbacks
      if (transcribedText.startsWith("{") || 
          transcribedText.includes('"reasoning":') || 
          transcribedText.includes("We don’t have the image") ||
          transcribedText.includes("cannot transcribe") ||
          transcribedText.length > 200) {
        console.log("[Create] Sanitized invalid handwriting transcription:", transcribedText);
        transcribedText = "";
      }

      const finalTxt = transcribedText || "Drawn bubble dialogue";

      updateActivePageBubbles(
        currentBubbles.map(b => b.id === bubbleId ? { ...b, text: finalTxt } : b)
      );
      setNewBubbleText(finalTxt);
      toast.success(t("handwritingTranscribedSuccess"));

    } catch (err: any) {
      console.error(err);
      toast.error(t("handwritingTranscribeFailed") + err.message);
      updateActivePageBubbles(
        currentBubbles.map(b => b.id === bubbleId ? { ...b, text: "Drawn bubble dialogue" } : b)
      );
      setNewBubbleText("Drawn bubble dialogue");
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleConvertStrokeToBubble = useCallback(
    (stroke: Stroke, panelBox?: { x: number; y: number; w: number; h: number }) => {
      if (!stroke.points || stroke.points.length < 3) return;
      const pts = stroke.points;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const strokeW = maxX - minX;
      const strokeH = maxY - minY;

      if (strokeW < 5 || strokeH < 4) return;

      const panelRelativeCenterX = minX + strokeW / 2;
      const panelRelativeCenterY = minY + strokeH / 2;

      let pageX = panelRelativeCenterX;
      let pageY = panelRelativeCenterY;

      if (panelBox && panelBox.w > 0 && panelBox.h > 0) {
        pageX = panelBox.x + (panelRelativeCenterX / 100) * panelBox.w;
        pageY = panelBox.y + (panelRelativeCenterY / 100) * panelBox.h;
      }

      const processed = processFreehandBubblePoints(pts);
      const normalizedPoints = processed.normalizedPoints;
      const initialTailX = processed.initialTailX;
      const initialTailY = processed.initialTailY;
      const hasTail = processed.hasArrow;

      const bubbleId = Math.random().toString(36).substring(2, 9);
      const newBubble: Bubble = {
        id: bubbleId,
        text: newBubbleText && newBubbleText.trim() !== "" ? newBubbleText : "Speech...",
        x: Math.max(5, Math.min(95, pageX)),
        y: Math.max(5, Math.min(95, pageY)),
        style: "freehand",
        points: normalizedPoints,
        hasTail,
        tailX: hasTail ? initialTailX : undefined,
        tailY: hasTail ? initialTailY : undefined,
      };

      updateActivePageBubbles([...bubbles, newBubble]);
      setActiveBubbleId(bubbleId);
      setBubbleStyle("freehand");
      toast.success(t("handDrawnBubbleCreatedSuccess") || "Converted freehand drawing to speech bubble!");
    },
    [bubbles, updateActivePageBubbles, newBubbleText, t]
  );

  const generateText = async () => {
    if (!aiPrompt.trim()) return;
    setIsGeneratingText(true);
    try {
      let generatedText = "";
      try {
        const headers: any = { "Content-Type": "application/json" };
        if (geminiApiKey) {
          headers["x-gemini-api-key"] = geminiApiKey;
        }
        const res = await fetch(`${getApiUrl()}/api/generate-text`, {
          method: "POST",
          headers,
          body: JSON.stringify({ prompt: aiPrompt, engine: llmEngine }),
        });
        if (res.ok) {
          const data = await res.json();
          generatedText = data.text;
        } else {
          throw new Error("Backend text gen failed");
        }
      } catch (e: any) {
        console.warn(
          "Backend text gen failed, falling back to client-side AI...",
          e,
        );
        const sysPrompt =
          "You are a comic book script writer. Given a scenario, generate a short, punchy single speech bubble line of dialogue (or sound effect). Maximum 10-15 words. ONLY return the text that goes in the bubble, nothing else.";

        if (!generatedText) {
          throw new Error("Unable to reach AI services right now. Please check your network or enter a free Gemini key in Settings.");
        }
      }

      setNewBubbleText(generatedText);
      if (activeBubbleId) {
        updateBubbleText(activeBubbleId, generatedText);
      }
      toast.success("Dialogue generated!");
    } catch (err: any) {
      toast.error(err.message || "Failed to generate dialogue");
    } finally {
      setIsGeneratingText(false);
    }
  };

  const addBubble = () => {
    const freshBubble: Bubble = {
      id: Date.now().toString(),
      text: newBubbleText || "Dialogue",
      x: 35 + Math.random() * 20,
      y: 35 + Math.random() * 20,
      style: bubbleStyle,
      points: bubbleStyle === "freehand" ? generatePerfectSpeechBubblePoints() : undefined,
      tailX: 20,
      tailY: 85,
    };
    updateActivePageBubbles([...bubbles, freshBubble]);
    setActiveBubbleId(freshBubble.id);
  };

  const removeBubble = (id: string) => {
    updateActivePageBubbles(bubbles.filter((b) => b.id !== id));
    if (activeBubbleId === id) setActiveBubbleId(null);
  };

  const updateBubbleText = (id: string, text: string) => {
    updateActivePageBubbles(
      bubbles.map((b) => (b.id === id ? { ...b, text } : b)),
    );
  };

  const updateBubbleTail = (id: string, tailX: number, tailY: number) => {
    updateActivePageBubbles(
      bubbles.map((b) => (b.id === id ? { ...b, tailX, tailY } : b)),
    );
  };

  const moveBubble = (id: string, dir: "up" | "down" | "left" | "right") => {
    updateActivePageBubbles(
      bubbles.map((b) => {
        if (b.id !== id) return b;
        let { x, y } = b;
        if (dir === "up") y = Math.max(0, y - 5);
        if (dir === "down") y = Math.min(100, y + 5);
        if (dir === "left") x = Math.max(0, x - 5);
        if (dir === "right") x = Math.min(100, x + 5);
        return { ...b, x, y };
      }),
    );
  };

  const scrollToCaret = useCallback(() => {
    if (!editorRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const editor = editorRef.current;
    const editorRect = editor.getBoundingClientRect();

    const rects = range.getClientRects();
    if (rects.length > 0) {
      const caretRect = rects[0];
      const bottomPadding = 56;
      const topPadding = 24;

      if (caretRect.bottom + bottomPadding > editorRect.bottom) {
        const scrollDiff = caretRect.bottom + bottomPadding - editorRect.bottom;
        editor.scrollTop += scrollDiff;
      } else if (caretRect.top - topPadding < editorRect.top) {
        const scrollDiff = editorRect.top - (caretRect.top - topPadding);
        editor.scrollTop -= scrollDiff;
      }
    } else {
      let node: Node | null = range.startContainer;
      let element: HTMLElement | null =
        node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
      if (element && editor.contains(element) && element !== editor) {
        const elemRect = element.getBoundingClientRect();
        if (elemRect.bottom + 48 > editorRect.bottom) {
          editor.scrollTop += elemRect.bottom + 48 - editorRect.bottom;
        } else if (elemRect.top - 24 < editorRect.top) {
          editor.scrollTop -= editorRect.top - (elemRect.top - 24);
        }
      }
    }
  }, []);

  const execDocCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    updateToc();
    scrollToCaret();
  };

  const findIllustrationBeforeCaret = (range: Range): HTMLElement | null => {
    if (!editorRef.current) return null;
    const isIllustration = (node: Node | null): node is HTMLElement => {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
      const el = node as HTMLElement;
      return el.tagName === "IMG" || el.classList?.contains("story-inline-canvas-placeholder");
    };

    const container = range.startContainer;
    const offset = range.startOffset;

    // Case A: Caret container is the editor itself
    if (container === editorRef.current && offset > 0) {
      const prev = editorRef.current.childNodes[offset - 1];
      if (isIllustration(prev)) return prev;
    }

    // Case B: Caret container is an Element node (e.g. <p> or <div>)
    if (container.nodeType === Node.ELEMENT_NODE) {
      if (offset > 0) {
        const prevChild = container.childNodes[offset - 1];
        if (isIllustration(prevChild)) return prevChild;
        if (prevChild.nodeType === Node.ELEMENT_NODE) {
          const lastDesc = (prevChild as HTMLElement).querySelector("img, .story-inline-canvas-placeholder");
          if (lastDesc && isIllustration(lastDesc)) return lastDesc;
        }
      } else {
        // offset === 0: Caret is at the start of container
        let current: Node = container;
        while (current.parentElement && current.parentElement !== editorRef.current && !current.previousSibling) {
          current = current.parentElement;
        }
        let prev = current.previousSibling;
        while (prev && prev.nodeType === Node.TEXT_NODE && (prev.textContent || "").trim() === "") {
          prev = prev.previousSibling;
        }
        if (isIllustration(prev)) return prev;
        if (prev && prev.nodeType === Node.ELEMENT_NODE) {
          const nested = (prev as HTMLElement).querySelector("img, .story-inline-canvas-placeholder");
          if (nested && isIllustration(nested)) return nested;
        }
      }
    }

    // Case C: Caret container is a Text node
    if (container.nodeType === Node.TEXT_NODE) {
      if (offset === 0) {
        let current: Node = container;
        while (current.parentElement && current.parentElement !== editorRef.current && !current.previousSibling) {
          current = current.parentElement;
        }
        let prev = current.previousSibling;
        while (prev && prev.nodeType === Node.TEXT_NODE && (prev.textContent || "").trim() === "") {
          prev = prev.previousSibling;
        }
        if (isIllustration(prev)) return prev;
        if (prev && prev.nodeType === Node.ELEMENT_NODE) {
          const nested = (prev as HTMLElement).querySelector("img, .story-inline-canvas-placeholder");
          if (nested && isIllustration(nested)) return nested;
        }
      }
    }

    return null;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Document mode Undo/Redo when not drawing
    if ((e.ctrlKey || e.metaKey) && !isDrawingMode) {
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedoStoryDoc();
        } else {
          handleUndoStoryDoc();
        }
        return;
      }
      if (key === "y") {
        e.preventDefault();
        handleRedoStoryDoc();
        return;
      }
    }

    // Delete or Backspace key to remove selected or preceding illustration (drawing canvas or inserted image)
    if (e.key === "Delete" || e.key === "Backspace") {
      const hasImg = selectedImageElements.length > 0 || (imageMenuProps.visible && !!imageMenuProps.imgElement);
      const hasCanvas = selectedCanvasElements.length > 0 || !!selectedCanvasElement;

      if (hasImg || hasCanvas) {
        e.preventDefault();
        if (hasImg) {
          const toRemove = selectedImageElements.length > 0
            ? [...selectedImageElements]
            : (imageMenuProps.imgElement ? [imageMenuProps.imgElement] : []);
          toRemove.forEach((img) => img.remove());
          setSelectedImageElements([]);
          setImageMenuProps({ visible: false, top: 0, left: 0, imgElement: null });
        }
        if (hasCanvas) {
          const toRemove = selectedCanvasElements.length > 0
            ? [...selectedCanvasElements]
            : (selectedCanvasElement ? [selectedCanvasElement] : []);
          const ids = toRemove.map((c) => c.getAttribute("data-id")).filter(Boolean) as string[];
          toRemove.forEach((c) => c.remove());
          setSelectedCanvasElements([]);
          setSelectedCanvasElement(null);
          if (ids.length > 0) {
            setInlineCanvases((prev) => {
              const updated = { ...prev };
              ids.forEach((id) => delete updated[id]);
              pushInlineCanvasesHistory(updated);
              return updated;
            });
          }
        }
        updateToc();
        setTimeout(() => pushStoryDocHistory(), 50);
        return;
      }

      // Backspace key when caret/cursor is positioned immediately after an image or drawing canvas
      if (e.key === "Backspace") {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          if (range.collapsed) {
            const targetToDelete = findIllustrationBeforeCaret(range);
            if (targetToDelete) {
              e.preventDefault();
              const canvasId = targetToDelete.getAttribute("data-id");
              targetToDelete.remove();
              if (canvasId) {
                setInlineCanvases((prev) => {
                  const updated = { ...prev };
                  delete updated[canvasId];
                  pushInlineCanvasesHistory(updated);
                  return updated;
                });
              }
              if (imageMenuProps.imgElement === targetToDelete) {
                setImageMenuProps({ visible: false, top: 0, left: 0, imgElement: null });
              }
              if (selectedCanvasElement === targetToDelete) {
                setSelectedCanvasElement(null);
              }
              setSelectedCanvasElements((prev) => prev.filter((el) => el !== targetToDelete));
              setSelectedImageElements((prev) => prev.filter((el) => el !== targetToDelete));
              updateToc();
              setTimeout(() => pushStoryDocHistory(), 50);
              return;
            }
          }
        }
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      if (imageMenuProps.visible && imageMenuProps.imgElement) {
        e.preventDefault();
        const p = document.createElement("p");
        p.innerHTML = "<br>";
        imageMenuProps.imgElement.parentNode?.insertBefore(
          p,
          imageMenuProps.imgElement,
        );

        const sel = window.getSelection();
        if (sel) {
          const newRange = document.createRange();
          newRange.setStart(p, 0);
          newRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(newRange);
        }

        setImageMenuProps((prev) => ({ ...prev, visible: false }));
        setTimeout(() => {
          updateToc();
          scrollToCaret();
        }, 0);
        return;
      }

      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return;
      let node: Node | null = selection.anchorNode;
      let isHeader = "";
      while (node && node !== editorRef.current) {
        if (node.nodeName === "H1" || node.nodeName === "H2") {
          isHeader = node.nodeName;
          break;
        }
        node = node.parentNode;
      }

      if (isHeader) {
        e.preventDefault();
        document.execCommand("insertParagraph", false);
        document.execCommand("formatBlock", false, `<${isHeader}>`);
      } else {
        // For mobile and touch keyboards where default Enter behavior is inconsistent
        if (e.nativeEvent.isComposing) return;
        e.preventDefault();
        document.execCommand("insertParagraph", false);
      }
      setTimeout(() => {
        updateToc();
        scrollToCaret();
      }, 0);
    } else {
      setTimeout(() => {
        updateToc();
        scrollToCaret();
      }, 0);
    }
  };

  const insertImageToDoc = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (editorRef.current) {
            editorRef.current.focus();
            const img = document.createElement("img");
            img.src = event.target?.result as string;
            img.style.width = "50%";
            img.style.margin = "1.5rem auto";
            img.style.display = "block";
            img.className = "block mx-auto border border-zinc-200 dark:border-zinc-800 rounded-md shadow-xs max-w-full";

            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
              const range = sel.getRangeAt(0);
              range.insertNode(img);
              range.collapse(false);
              sel.removeAllRanges();
              sel.addRange(range);
            } else {
              editorRef.current.appendChild(img);
            }
            updateToc();
            setTimeout(() => pushStoryDocHistory(), 50);
          }
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  const insertDrawingToDoc = (dataUrl: string) => {
    if (editorRef.current) {
      editorRef.current.focus();
      const img = document.createElement("img");
      img.src = dataUrl;
      img.style.width = "50%";
      img.style.margin = "1.5rem auto";
      img.style.display = "block";
      img.className = "block mx-auto border border-zinc-200 dark:border-zinc-800 rounded-md shadow-xs max-w-full";
      img.alt = "Drawing Illustration";

      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.insertNode(img);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        editorRef.current.appendChild(img);
      }
      setIsDrawingModalOpen(false);
      updateToc();
      setTimeout(() => pushStoryDocHistory(), 50);
    }
  };

  const handleInsertInlineCanvas = () => {
    if (!editorRef.current) return;
    editorRef.current.focus();

    setIsDrawingMode(true);
    if (penMode === "freehandBubble") {
      setPenMode("normal");
    }

    const canvasId = "inline-canvas-" + Math.random().toString(36).substring(2, 9);
    const newNode: PanelNode = {
      id: canvasId,
      type: "panel",
      drawings: [],
      imageUrl: "",
    };

    setInlineCanvases((prev) => ({
      ...prev,
      [canvasId]: { node: newNode, widthPercent: 66.6 },
    }));

    const div = document.createElement("div");
    div.className = "story-inline-canvas-placeholder select-none relative my-6 mx-auto border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 rounded-xs shadow-xs overflow-hidden";
    div.setAttribute("data-id", canvasId);
    div.setAttribute("contenteditable", "false");
    div.style.width = "66.6%";
    div.style.aspectRatio = "4/3";
    div.style.margin = "1.5rem auto";
    div.style.position = "relative";

    // Set initial data attribute for serialization
    div.setAttribute("data-canvas-data", JSON.stringify({ node: newNode, widthPercent: 66.6 }));

    const afterP = document.createElement("p");
    afterP.innerHTML = "<br>";

    const sel = window.getSelection();
    const cleanText = (editorRef.current.innerText || "").replace(/[\n\r\s\t]/g, "").trim();
    const existingCanvases = editorRef.current.querySelectorAll(".story-inline-canvas-placeholder").length;
    const existingImages = editorRef.current.querySelectorAll("img").length;

    const activeSelectedImg = (imageMenuProps.visible && imageMenuProps.imgElement)
      ? imageMenuProps.imgElement
      : (selectedImageElements.length > 0 ? selectedImageElements[0] : null);

    if (activeSelectedImg && editorRef.current.contains(activeSelectedImg)) {
      // User selected an image first, then tapped draw button:
      // Place canvas directly behind (after) the image! Never delete or replace the image!
      let insertAnchor: Node = activeSelectedImg;
      while (insertAnchor.parentNode && insertAnchor.parentNode !== editorRef.current) {
        insertAnchor = insertAnchor.parentNode;
      }
      if (insertAnchor.parentNode === editorRef.current) {
        insertAnchor.parentNode.insertBefore(div, insertAnchor.nextSibling);
        insertAnchor.parentNode.insertBefore(afterP, div.nextSibling);
      } else {
        activeSelectedImg.parentNode?.insertBefore(div, activeSelectedImg.nextSibling);
        activeSelectedImg.parentNode?.insertBefore(afterP, div.nextSibling);
      }

      // Deselect image, select the newly added canvas
      setImageMenuProps({ visible: false, top: 0, left: 0, imgElement: null });
      setSelectedImageElements([]);
      setSelectedCanvasElement(div);
      setSelectedCanvasElements([div]);
    } else if (cleanText.length === 0 && existingCanvases === 0 && existingImages === 0) {
      // Clean document with initial Title/Subtitle placeholders
      const h2 = editorRef.current.querySelector("h2");
      const emptyP = editorRef.current.querySelector("p");
      if (emptyP && (!emptyP.textContent || emptyP.textContent.trim() === "")) {
        emptyP.remove();
      }
      if (h2 && h2.parentNode === editorRef.current) {
        h2.parentNode.insertBefore(div, h2.nextSibling);
        h2.parentNode.insertBefore(afterP, div.nextSibling);
      } else {
        editorRef.current.appendChild(div);
        editorRef.current.appendChild(afterP);
      }
      setSelectedCanvasElement(div);
      setSelectedCanvasElements([div]);
    } else if (sel && sel.rangeCount > 0 && editorRef.current.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      let targetNode: Node | null = sel.anchorNode;
      while (targetNode && targetNode.parentElement && targetNode.parentElement !== editorRef.current) {
        targetNode = targetNode.parentElement;
      }
      if (targetNode && targetNode.parentNode === editorRef.current) {
        if (targetNode.nodeName === "P" && (!targetNode.textContent || targetNode.textContent.trim() === "")) {
          targetNode.parentNode.insertBefore(div, targetNode);
          targetNode.parentNode.insertBefore(afterP, targetNode.nextSibling);
          targetNode.parentNode.removeChild(targetNode);
        } else {
          targetNode.parentNode.insertBefore(div, targetNode.nextSibling);
          targetNode.parentNode.insertBefore(afterP, div.nextSibling);
        }
      } else {
        range.insertNode(div);
        range.collapse(false);
        div.parentNode?.insertBefore(afterP, div.nextSibling);
      }
      setSelectedCanvasElement(div);
      setSelectedCanvasElements([div]);
    } else {
      editorRef.current.appendChild(div);
      editorRef.current.appendChild(afterP);
      setSelectedCanvasElement(div);
      setSelectedCanvasElements([div]);
    }

    if (sel) {
      sel.removeAllRanges();
      const newRange = document.createRange();
      newRange.setStart(afterP, 0);
      newRange.collapse(true);
      sel.addRange(newRange);
    }

    setTimeout(() => {
      updateToc();
      pushStoryDocHistory();
    }, 50);
  };

  const getBubbleStyleClass = (style: "classic" | "action" | "freehand", hasPoints?: boolean) => {
    switch (style) {
      case "action":
        return "border border-red-500 bg-yellow-100 text-red-600 font-extrabold uppercase rounded-none px-3 py-1.5 shadow-[2px_2px_0px_0px_rgba(239,68,68,1)]";
      case "freehand":
        if (hasPoints) {
          return "relative px-8 py-6 italic font-serif text-slate-900";
        }
        return "border-2 border-slate-800 bg-white text-slate-900 rounded-[35%_65%_60%_40%_/_50%_60%_40%_50%] px-4 py-2 italic font-serif shadow-md";
      default:
        return "border border-foreground bg-white text-black font-semibold rounded-2xl px-4 py-2 shadow-sm";
    }
  };

  const handlePublish = async () => {
    const title = createMode === "document" ? storyTitle : comicTitle;
    if (!title || title.trim() === "" || title === "Untitled Story" || title === "Untitled Comic") {
      toast.error("Please provide a title before publishing your masterpiece!");
      return;
    }

    if (!user) {
      setShowPublishAuthHint(true);
      return;
    }
    setShowPublishAuthHint(false);

    if (createMode === "document") {
      const htmlContent = editorRef.current?.innerHTML || loadedHtmlContent || "";
      if (!hasStoryEditedContent(htmlContent)) {
        toast.error("Cannot publish an empty novel! Please write some story content first.");
        return;
      }
    } else if (createMode === "comic") {
      const hasAnyContent = comicPages.some(page => 
        checkNodeForImagesOrDrawings(page.tree) || 
        (page.bubbles && page.bubbles.some(b => b.text && b.text.trim().length > 0))
      );
      if (!hasAnyContent) {
        toast.error("Cannot publish an empty comic! Please add panel images, drawings, or speech bubbles first.");
        return;
      }
    }

    const activeId = createMode === "document" 
      ? (currentStoryId || "story-" + Date.now()) 
      : (currentComicId || "comic-" + Date.now());

    // Lookup cover image if present
    let coverUrl = "";
    if (createMode === "comic") {
      const findFirstImage = (node: any): string | null => {
        if (!node) return null;
        if (node.type === "panel") {
          return node.imageUrl || null;
        } else if (node.type === "split") {
          return findFirstImage(node.left) || findFirstImage(node.right);
        }
        return null;
      };

      let foundImg: string | null = null;
      for (const page of comicPages) {
        foundImg = findFirstImage(page.tree);
        if (foundImg) break;
      }
      coverUrl = foundImg || "";
    }

    let storyContentToPublish: string | undefined = undefined;
    if (createMode === "document") {
      storyContentToPublish = await getRenderedStoryHtml();
    }

    const newItem = {
      id: activeId,
      title: title.trim(),
      author: user?.name || user?.email || "Creative Publisher",
      authorEmail: user?.email,
      authorId: user?.uid,
      type: createMode === "document" ? "novel" : "comic",
      cover: coverUrl,
      description: createMode === "document" 
        ? "A captivating novel authored in the eBookCC creative workspace." 
        : `An action-packed visual comic strip with ${comicPages.length} custom layouts.`,
      content: storyContentToPublish,
      pages: createMode === "comic" ? comicPages : undefined,
      timestamp: Date.now()
    };

    const toastId = toast.loading("Publishing...");

    // Publish to cloud media storage with real-time progress & parallel uploads
    const r2Result = await publishWorkToR2(newItem, undefined, (progress, stage) => {
      toast.loading("Publishing...", { id: toastId });
    });

    if (!r2Result.success) {
      toast.dismiss(toastId);
      toast.error(`Publish failed: ${r2Result.message || "Could not publish work"}`);
      return;
    }

    const itemToSave = r2Result.item || newItem;

    // Immediately save complete published work to IndexedDB
    try {
      await savePublishedWorkLocally(itemToSave);
    } catch (_) {}

    if (createMode === "comic") {
      setCurrentComicId(itemToSave.id);
      if (Array.isArray(itemToSave.pages)) {
        setComicPagesState(itemToSave.pages);
      }
    } else if (createMode === "document") {
      setCurrentStoryId(itemToSave.id);
    }

    let publishedItems: any[] = [];
    try {
      const publishedItemsJson = localStorage.getItem("ebookcc_published_items") || "[]";
      publishedItems = JSON.parse(publishedItemsJson);
    } catch (_) {
      publishedItems = [];
    }
    const filtered = publishedItems.filter((item: any) => item.id !== itemToSave.id);
    filtered.unshift(itemToSave);

    try {
      localStorage.setItem("ebookcc_published_items", JSON.stringify(filtered));
    } catch (quotaErr) {
      console.warn("localStorage quota exceeded, saving lightweight items to local storage", quotaErr);
      try {
        const pruned = filtered.map((item: any) => {
          if (!item) return item;
          const copy = { ...item };
          if (typeof copy.cover === "string" && copy.cover.startsWith("data:")) {
            delete copy.cover;
          }
          if (copy.content && copy.content.length > 20000) {
            copy.content = copy.content.slice(0, 20000);
          }
          return copy;
        });
        localStorage.setItem("ebookcc_published_items", JSON.stringify(pruned));
      } catch (_) {}
    }

    setPublishedWorks(filtered);

    // =========================================================================
    // REMOVE PREVIOUS UNFINISHED WORKS FROM CREATE LANDING PAGE & DELETE CACHE LOCALLY
    // =========================================================================
    if (createMode === "comic") {
      isPublishedComicRef.current = true;
      await deleteUnfinishedComic(activeId);
      if (currentComicId && currentComicId !== activeId) {
        await deleteUnfinishedComic(currentComicId);
      }
      if (itemToSave.id && itemToSave.id !== activeId) {
        await deleteUnfinishedComic(itemToSave.id);
      }
      if (title && title.trim()) {
        await removeUnfinishedComicDraft(title);
      }
      const remainingComics = await getUnfinishedComics();
      setUnfinishedComics(remainingComics);
    } else if (createMode === "document") {
      isPublishedStoryRef.current = true;
      await deleteUnfinishedStory(activeId);
      if (currentStoryId && currentStoryId !== activeId) {
        await deleteUnfinishedStory(currentStoryId);
      }
      if (itemToSave.id && itemToSave.id !== activeId) {
        await deleteUnfinishedStory(itemToSave.id);
      }
      if (title && title.trim()) {
        await removeUnfinishedStoryDraft(title);
      }
      const remainingStories = await getUnfinishedStories();
      setUnfinishedStories(remainingStories);
    }

    sessionStorage.removeItem("ebookcc_open_workspace_id");
    sessionStorage.removeItem("ebookcc_open_workspace_type");

    window.dispatchEvent(new Event("ebookcc_published"));
    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new Event("ebookcc_history_updated"));

    toast.dismiss(toastId);
    toast.success("Published successfully!");
  };

  // Google Drive integration states
  const [googleDriveOpen, setGoogleDriveOpen] = useState(false);
  const [googleDriveMode, setGoogleDriveMode] = useState<'import' | 'export'>('import');
  const [googleDriveExportFile, setGoogleDriveExportFile] = useState<{
    name: string;
    blob?: Blob | File;
    mimeType?: string;
  } | null>(null);

  // Helper to open Google Drive import dialog
  const handleOpenDriveImport = () => {
    setGoogleDriveMode('import');
    setGoogleDriveExportFile(null);
    setGoogleDriveOpen(true);
  };

  // Helper to save current Comic Project to Google Drive (.comic.json)
  const handleSaveComicProjectToDrive = () => {
    try {
      const activeId = currentComicId || ("comic-" + Date.now());
      if (!currentComicId) setCurrentComicId(activeId);
      const safeTitle = (comicTitle || "Untitled Comic").replace(/[/\\?%*:|"<>]/g, "-").trim() || "Untitled Comic";
      const projectData = {
        type: "comic_project",
        version: 1,
        id: activeId,
        title: comicTitle || "Untitled Comic",
        pages: comicPages,
        activePageIndex,
        timestamp: Date.now(),
      };
      const jsonStr = JSON.stringify(projectData, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      setGoogleDriveExportFile({
        name: `${safeTitle}.comic.json`,
        blob,
        mimeType: "application/json",
      });
      setGoogleDriveMode("export");
      setGoogleDriveOpen(true);
    } catch (err: any) {
      toast.error("Failed to prepare comic project: " + err.message);
    }
  };

  // Helper to save current Story Project to Google Drive (.story.json)
  const handleSaveStoryProjectToDrive = () => {
    try {
      const activeId = currentStoryId || ("story-" + Date.now());
      if (!currentStoryId) setCurrentStoryId(activeId);
      const safeTitle = (storyTitle || "Untitled Story").replace(/[/\\?%*:|"<>]/g, "-").trim() || "Untitled Story";
      const html = editorRef.current?.innerHTML || loadedHtmlContent || "";
      const projectData = {
        type: "story_project",
        version: 1,
        id: activeId,
        title: storyTitle || "Untitled Story",
        htmlContent: html,
        timestamp: Date.now(),
      };
      const jsonStr = JSON.stringify(projectData, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      setGoogleDriveExportFile({
        name: `${safeTitle}.story.json`,
        blob,
        mimeType: "application/json",
      });
      setGoogleDriveMode("export");
      setGoogleDriveOpen(true);
    } catch (err: any) {
      toast.error("Failed to prepare story project: " + err.message);
    }
  };

  // Helper to save an unfinished comic draft to Google Drive
  const handleQuickExportComicDraftToDrive = (comic: UnfinishedComic) => {
    try {
      const safeTitle = (comic.title || "Untitled Comic").replace(/[/\\?%*:|"<>]/g, "-").trim() || "Untitled Comic";
      const projectData = {
        type: "comic_project",
        version: 1,
        id: comic.id,
        title: comic.title || "Untitled Comic",
        pages: comic.pages,
        activePageIndex: comic.activePageIndex || 0,
        timestamp: comic.timestamp || Date.now(),
      };
      const jsonStr = JSON.stringify(projectData, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      setGoogleDriveExportFile({
        name: `${safeTitle}.comic.json`,
        blob,
        mimeType: "application/json",
      });
      setGoogleDriveMode("export");
      setGoogleDriveOpen(true);
    } catch (err: any) {
      toast.error("Failed to prepare comic draft: " + err.message);
    }
  };

  // Helper to save an unfinished story draft to Google Drive
  const handleQuickExportStoryDraftToDrive = (story: UnfinishedStory) => {
    try {
      const safeTitle = (story.title || "Untitled Story").replace(/[/\\?%*:|"<>]/g, "-").trim() || "Untitled Story";
      const projectData = {
        type: "story_project",
        version: 1,
        id: story.id,
        title: story.title || "Untitled Story",
        htmlContent: story.htmlContent,
        timestamp: story.timestamp || Date.now(),
      };
      const jsonStr = JSON.stringify(projectData, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      setGoogleDriveExportFile({
        name: `${safeTitle}.story.json`,
        blob,
        mimeType: "application/json",
      });
      setGoogleDriveMode("export");
      setGoogleDriveOpen(true);
    } catch (err: any) {
      toast.error("Failed to prepare story draft: " + err.message);
    }
  };

  // Helper to save a published work to Google Drive
  const handleQuickExportPublishedToDrive = (e: React.MouseEvent, item: any) => {
    e.stopPropagation();
    try {
      const safeTitle = (item.title || "Untitled Work").replace(/[/\\?%*:|"<>]/g, "-").trim() || "Untitled Work";
      if (item.type === "comic" || (item.pages && Array.isArray(item.pages))) {
        let pages = item.pages;
        if (typeof pages === "string") {
          try { pages = JSON.parse(pages); } catch (_) { pages = []; }
        }
        const projectData = {
          type: "comic_project",
          version: 1,
          id: item.id,
          title: item.title || "Untitled Comic",
          pages: pages || [],
          activePageIndex: 0,
          timestamp: item.timestamp || Date.now(),
        };
        const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: "application/json" });
        setGoogleDriveExportFile({
          name: `${safeTitle}.comic.json`,
          blob,
          mimeType: "application/json",
        });
      } else {
        const projectData = {
          type: "story_project",
          version: 1,
          id: item.id,
          title: item.title || "Untitled Story",
          htmlContent: item.content || "",
          timestamp: item.timestamp || Date.now(),
        };
        const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: "application/json" });
        setGoogleDriveExportFile({
          name: `${safeTitle}.story.json`,
          blob,
          mimeType: "application/json",
        });
      }
      setGoogleDriveMode("export");
      setGoogleDriveOpen(true);
    } catch (err: any) {
      toast.error("Failed to prepare published work: " + err.message);
    }
  };

  // Handler for files imported from Google Drive
  const handleFileImportedFromDrive = async (file: File) => {
    const lowerName = file.name.toLowerCase();
    try {
      // 1. JSON project files (.comic.json, .story.json, or .json)
      if (lowerName.endsWith(".json")) {
        const text = await file.text();
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error("Invalid JSON file");
        }

        // Comic project
        if (data.type === "comic_project" || (Array.isArray(data.pages) && data.pages.length > 0)) {
          const loadedId = data.id || "comic-" + Date.now();
          const loadedTitle = data.title || file.name.replace(/\.(comic\.json|json)$/i, "");
          const loadedPages: ComicPage[] = Array.isArray(data.pages) && data.pages.length > 0
            ? data.pages
            : [
                {
                  id: Date.now().toString(),
                  tree: createGridTree(3, 2),
                  bubbles: [],
                },
              ];
          const pageIdx = typeof data.activePageIndex === "number"
            ? Math.max(0, Math.min(data.activePageIndex, loadedPages.length - 1))
            : 0;

          isPublishedComicRef.current = false;
          setCurrentComicId(loadedId);
          setComicTitle(loadedTitle);
          setComicPagesState(loadedPages);
          setActivePageIndex(pageIdx);
          setCreateMode("comic");

          saveUnfinishedComic({
            id: loadedId,
            title: loadedTitle,
            pages: loadedPages,
            activePageIndex: pageIdx,
          });
          getUnfinishedComics().then(setUnfinishedComics);

          toast.success(`Loaded comic "${loadedTitle}" from Google Drive!`);
          return;
        }

        // Story project
        if (data.type === "story_project" || typeof data.htmlContent === "string") {
          const loadedId = data.id || "story-" + Date.now();
          const loadedTitle = data.title || file.name.replace(/\.(story\.json|json)$/i, "");
          const loadedHtml = data.htmlContent || "<p></p>";

          isPublishedStoryRef.current = false;
          setCurrentStoryId(loadedId);
          setStoryTitle(loadedTitle);
          setLoadedHtmlContent(loadedHtml);
          if (editorRef.current) {
            editorRef.current.innerHTML = loadedHtml;
          }
          setCreateMode("document");

          saveUnfinishedStory({
            id: loadedId,
            title: loadedTitle,
            htmlContent: loadedHtml,
          });
          getUnfinishedStories().then(setUnfinishedStories);

          toast.success(`Loaded story "${loadedTitle}" from Google Drive!`);
          return;
        }
      }

      // 2. Comic archive (.cbz, .zip, .cbr)
      if (lowerName.endsWith(".cbz") || lowerName.endsWith(".zip") || lowerName.endsWith(".cbr")) {
        toast.info(`Extracting comic pages from ${file.name}...`);
        const zip = await JSZip.loadAsync(file);
        const imageEntries = Object.values(zip.files).filter(
          (entry) =>
            !entry.dir &&
            /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(entry.name) &&
            !entry.name.includes("__MACOSX")
        );

        if (imageEntries.length > 0) {
          imageEntries.sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
          );

          const pages: ComicPage[] = [];
          for (let i = 0; i < imageEntries.length; i++) {
            const entry = imageEntries[i];
            const blob = await entry.async("blob");
            const dataUrl = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            });

            pages.push({
              id: `${Date.now()}-${i}`,
              tree: {
                id: `panel-${Date.now()}-${i}`,
                type: "panel",
                imageUrl: dataUrl,
                drawings: [],
              },
              bubbles: [],
            });
          }

          const loadedId = "comic-" + Date.now();
          const loadedTitle = file.name.replace(/\.(cbz|zip|cbr)$/i, "");
          isPublishedComicRef.current = false;
          setCurrentComicId(loadedId);
          setComicTitle(loadedTitle);
          setComicPagesState(pages);
          setActivePageIndex(0);
          setCreateMode("comic");

          saveUnfinishedComic({
            id: loadedId,
            title: loadedTitle,
            pages,
            activePageIndex: 0,
          });
          getUnfinishedComics().then(setUnfinishedComics);

          toast.success(`Extracted ${pages.length} comic pages from "${file.name}" to continue editing!`);
          return;
        }
      }

      // 3. HTML documents (.html, .htm)
      if (lowerName.endsWith(".html") || lowerName.endsWith(".htm")) {
        const html = await file.text();
        const loadedId = "story-" + Date.now();
        const loadedTitle = file.name.replace(/\.html?$/i, "");
        isPublishedStoryRef.current = false;
        setCurrentStoryId(loadedId);
        setStoryTitle(loadedTitle);
        setLoadedHtmlContent(html);
        if (editorRef.current) {
          editorRef.current.innerHTML = html;
        }
        setCreateMode("document");

        saveUnfinishedStory({
          id: loadedId,
          title: loadedTitle,
          htmlContent: html,
        });
        getUnfinishedStories().then(setUnfinishedStories);

        toast.success(`Loaded "${file.name}" into Story Editor!`);
        return;
      }

      // 4. Plain text / Markdown (.txt, .md)
      if (lowerName.endsWith(".txt") || lowerName.endsWith(".md")) {
        const text = await file.text();
        const paragraphs = text
          .split(/\r?\n\r?\n/)
          .map((p) => `<p>${p.trim().replace(/\r?\n/g, "<br>")}</p>`)
          .join("");
        const loadedId = "story-" + Date.now();
        const loadedTitle = file.name.replace(/\.(txt|md)$/i, "");
        isPublishedStoryRef.current = false;
        setCurrentStoryId(loadedId);
        setStoryTitle(loadedTitle);
        setLoadedHtmlContent(paragraphs);
        if (editorRef.current) {
          editorRef.current.innerHTML = paragraphs;
        }
        setCreateMode("document");

        saveUnfinishedStory({
          id: loadedId,
          title: loadedTitle,
          htmlContent: paragraphs,
        });
        getUnfinishedStories().then(setUnfinishedStories);

        toast.success(`Loaded text from "${file.name}" into Story Editor!`);
        return;
      }

      // 5. EPUB files (.epub)
      if (lowerName.endsWith(".epub")) {
        toast.info(`Parsing EPUB "${file.name}"...`);
        const zip = await JSZip.loadAsync(file);
        const htmlFiles = Object.values(zip.files).filter(
          (entry) =>
            !entry.dir &&
            /\.(x?html?|xml)$/i.test(entry.name) &&
            !entry.name.includes("toc") &&
            !entry.name.includes("nav")
        );
        if (htmlFiles.length > 0) {
          htmlFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
          let combinedHtml = "";
          for (const hEntry of htmlFiles) {
            const rawHtml = await hEntry.async("text");
            const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            combinedHtml += bodyMatch ? bodyMatch[1] : rawHtml;
            combinedHtml += "<hr />";
          }
          const loadedId = "story-" + Date.now();
          const loadedTitle = file.name.replace(/\.epub$/i, "");
          isPublishedStoryRef.current = false;
          setCurrentStoryId(loadedId);
          setStoryTitle(loadedTitle);
          setLoadedHtmlContent(combinedHtml);
          if (editorRef.current) {
            editorRef.current.innerHTML = combinedHtml;
          }
          setCreateMode("document");

          saveUnfinishedStory({
            id: loadedId,
            title: loadedTitle,
            htmlContent: combinedHtml,
          });
          getUnfinishedStories().then(setUnfinishedStories);

          toast.success(`Loaded EPUB content from "${file.name}" into Story Editor!`);
          return;
        }
      }

      // 6. Single images (.png, .jpg, .jpeg, .webp, .gif)
      if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(lowerName)) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          if (createMode === "comic") {
            const { tree, updated } = fillFirstEmptyPanel(comicTree, dataUrl);
            if (updated) {
              updateActivePageTree(tree);
              toast.success(`Added image to comic panel from "${file.name}"`);
            } else {
              const newPage: ComicPage = {
                id: Date.now().toString(),
                tree: {
                  id: `panel-${Date.now()}`,
                  type: "panel",
                  imageUrl: dataUrl,
                  drawings: [],
                },
                bubbles: [],
              };
              setComicPagesState((prev) => [...prev, newPage]);
              setActivePageIndex(comicPages.length);
              toast.success(`Added new comic page with "${file.name}"`);
            }
          } else {
            const newPage: ComicPage = {
              id: Date.now().toString(),
              tree: {
                id: `panel-${Date.now()}`,
                type: "panel",
                imageUrl: dataUrl,
                drawings: [],
              },
              bubbles: [],
            };
            isPublishedComicRef.current = false;
            setCurrentComicId("comic-" + Date.now());
            setComicTitle(file.name.replace(/\.[^/.]+$/, ""));
            setComicPagesState([newPage]);
            setActivePageIndex(0);
            setCreateMode("comic");
            toast.success(`Opened comic page with "${file.name}"`);
          }
        };
        reader.readAsDataURL(file);
        return;
      }

      // 7. General text fallback
      const rawText = await file.text();
      const fallbackTitle = file.name.replace(/\.[^/.]+$/, "");
      isPublishedStoryRef.current = false;
      setCurrentStoryId("story-" + Date.now());
      setStoryTitle(fallbackTitle);
      setLoadedHtmlContent(rawText);
      if (editorRef.current) {
        editorRef.current.innerHTML = rawText;
      }
      setCreateMode("document");
      toast.success(`Loaded "${file.name}" into Story Editor!`);
    } catch (err: any) {
      console.error("Failed to load work from Google Drive:", err);
      toast.error(`Could not load file: ${err?.message || "Unknown error"}`);
    }
  };

  const renderGoogleDriveDialog = () => (
    <GoogleDriveDialog
      open={googleDriveOpen}
      onOpenChange={setGoogleDriveOpen}
      initialMode={googleDriveMode}
      exportFile={googleDriveExportFile || undefined}
      onFileImported={handleFileImportedFromDrive}
    />
  );

  const handleExport = async (format: string) => {
    toast.info(`Exporting as ${format.toUpperCase()}...`);
    setIsExporting(true);

    try {
      const getCleanPlainText = (): string => {
        if (!editorRef.current) return "";
        const clone = editorRef.current.cloneNode(true) as HTMLElement;
        const unwanted = clone.querySelectorAll(
          ".panel-label-badge, [data-export-ignore='true'], .canvas-resize-overlay, .story-inline-canvas-placeholder, button, [role='button'], .image-menu-props"
        );
        unwanted.forEach((el) => el.remove());
        return (clone.textContent || clone.innerText || "").trim();
      };

      const content = getCleanPlainText();
      const htmlContent = createMode === "document" ? await getRenderedStoryHtml() : "";

      if (createMode === "comic") {
        if (!comicRef.current) return;

        let pageDataUrls: string[] = [];
        let pageBubbleStats: {
          [pageIndex: number]: { [bubbleId: string]: { w: number; h: number } };
        } = {};
        const originalIndex = activePageIndex;

        const { toPng } = await import("html-to-image");
        for (let i = 0; i < comicPages.length; i++) {
          toast.info(`Rendering page ${i + 1} of ${comicPages.length}...`);
          setActivePageIndex(i);
          await new Promise((r) => setTimeout(r, 200));
          if (!comicRef.current) continue;

          try {
            // Extract bubble dimensions before toPng
            const bubblesOnPage =
              comicRef.current.querySelectorAll(".bubble-overlay");
            pageBubbleStats[i] = {};
            bubblesOnPage.forEach((el) => {
              const bId = el.getAttribute("data-bubble-id");
              if (bId) {
                pageBubbleStats[i][bId] = {
                  w: (el as HTMLElement).offsetWidth,
                  h: (el as HTMLElement).offsetHeight,
                };
                console.log("BUBBLE STATS", bId, pageBubbleStats[i][bId]);
              }
            });

            // toPng automatically extracts and inline computes styles without custom CSS parsing crashes
            const dataUrl = await toPng(comicRef.current, {
              backgroundColor: "#ffffff",
              pixelRatio: 2,
              skipFonts: true,
              cacheBust: false,
              style: {
                border: "none",
                boxShadow: "none",
                transform: "none",
                margin: "0",
              },
              filter: (node) => {
                if (node instanceof HTMLElement) {
                  if (
                    node.dataset?.exportIgnore === "true" ||
                    node.classList?.contains("panel-label-badge") ||
                    node.closest?.(".panel-label-badge, [data-export-ignore='true']")
                  ) {
                    return false;
                  }
                }
                return true;
              },
            });
            pageDataUrls.push(dataUrl);
          } catch (err) {
            console.error("Failed to render page", i, err);
            toast.error(`Failed to render page ${i + 1}`);
          }
        }

        setActivePageIndex(originalIndex);

        if (format === "png") {
          if (pageDataUrls.length === 1) {
            const a = document.createElement("a");
            a.href = pageDataUrls[0];
            a.download = "comic.png";
            a.click();
          } else {
            const zip = new JSZip();
            pageDataUrls.forEach((data, i) =>
              zip.file(
                `page_${String(i + 1).padStart(3, "0")}.png`,
                data.split(",")[1],
                { base64: true },
              ),
            );
            const blob = await zip.generateAsync({ type: "blob" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "comic.zip";
            a.click();
          }
        } else if (format === "cbz" || format === "zip") {
          const zip = new JSZip();
          pageDataUrls.forEach((data, i) =>
            zip.file(
              `page_${String(i + 1).padStart(3, "0")}.png`,
              data.split(",")[1],
              { base64: true },
            ),
          );
          const blob = await zip.generateAsync({ type: "blob" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `comic.${format}`;
          a.click();
        } else if (format === "pdf") {
          const pdfMake = (await import("pdfmake/build/pdfmake")).default;
          const pdfFonts = (await import("pdfmake/build/vfs_fonts")).default;
          if (pdfFonts && pdfFonts.pdfMake) pdfMake.vfs = pdfFonts.pdfMake.vfs;
          else if (pdfFonts && (pdfFonts as any).vfs)
            pdfMake.vfs = (pdfFonts as any).vfs;

          const PAGE_W = 1200;
          const PAGE_H = 1600;

          const allContent: any[] = [];

          for (let i = 0; i < comicPages.length; i++) {
            if (i > 0) {
              allContent.push({ text: " ", pageBreak: "before", fontSize: 1 });
            }

            allContent.push({
              canvas: [
                {
                  type: "rect",
                  x: 0,
                  y: 0,
                  w: PAGE_W,
                  h: PAGE_H,
                  color: "#ffffff",
                },
              ],
              absolutePosition: { x: 0, y: 0 },
            });

            const panels = computePanels(
              comicPages[i].tree,
              0,
              0,
              PAGE_W,
              PAGE_H,
            );

            for (const panel of panels) {
              allContent.push({
                canvas: [
                  {
                    type: "rect",
                    x: panel.x,
                    y: panel.y,
                    w: panel.w,
                    h: panel.h,
                    lineWidth: 6,
                    lineColor: "#18181b",
                    color: "#ffffff",
                  },
                ],
                absolutePosition: { x: 0, y: 0 },
              });

              if (panel.imageUrl) {
                const insetX = panel.x + 3;
                const insetY = panel.y + 3;
                const insetW = panel.w - 6;
                const insetH = panel.h - 6;

                const cropped = await cropImageToCover(
                  panel.imageUrl,
                  insetW,
                  insetH,
                );
                allContent.push({
                  image: cropped,
                  absolutePosition: { x: insetX, y: insetY },
                  width: insetW,
                  height: insetH,
                });
              }
            }

            const bubbles = comicPages[i].bubbles;
            for (const b of bubbles) {
              const canvasH = comicRef.current?.offsetHeight || 800;
              const canvasW = comicRef.current?.offsetWidth || 600;
              const stats = pageBubbleStats[i]?.[b.id] || { w: 100, h: 50 };
              const pdfW = (stats.w / canvasW) * PAGE_W;
              const pdfH = (stats.h / canvasH) * PAGE_H;
              const fontSize =
                (14 / Math.max(canvasH, canvasW)) * Math.max(PAGE_H, PAGE_W); // slightly smaller to fit

              const left = (b.x / 100) * PAGE_W - pdfW / 2;
              const top = (b.y / 100) * PAGE_H - pdfH / 2;

              let bgColor = "#ffffff";
              let lineColor = "#000000";
              let isDashed = false;
              let borderRadius = Math.min(pdfW, pdfH) * 0.2;
              let fontBold = false;
              let fontItalic = false;
              let textColor = "#000000";
              let domPaddingY = 8;
              let domPaddingX = 16;
              let borderWidth = 2;

              if (b.style === "action") {
                bgColor = "#fef08a";
                lineColor = "#ef4444";
                textColor = "#dc2626";
                borderRadius = 0;
                fontBold = true;
                domPaddingY = 6;
                domPaddingX = 12;

                const offX = (2 / canvasW) * PAGE_W;
                const offY = (2 / canvasH) * PAGE_H;
                allContent.push({
                  canvas: [
                    {
                      type: "rect",
                      x: left + offX,
                      y: top + offY,
                      w: pdfW,
                      h: pdfH,
                      color: "#ef4444",
                    },
                  ],
                  absolutePosition: { x: 0, y: 0 },
                });
              } else if (b.style === "freehand") {
                lineColor = "#1e293b";
                bgColor = "#ffffff";
                textColor = "#0f172a";
                borderRadius = 12;
                fontItalic = true;
              }

              const lineW = (borderWidth / canvasW) * PAGE_W;

              allContent.push({
                canvas: [
                  {
                    type: "rect",
                    x: left,
                    y: top,
                    w: pdfW,
                    h: pdfH,
                    r: borderRadius,
                    color: bgColor,
                    lineColor: lineColor,
                    lineWidth: lineW,
                    dash: isDashed
                      ? { length: lineW * 4, space: lineW * 4 }
                      : undefined,
                  },
                ],
                absolutePosition: { x: 0, y: 0 },
              });

              const pdfPaddingY = (domPaddingY / canvasH) * PAGE_H;
              const pdfPaddingX = (domPaddingX / canvasW) * PAGE_W;
              const textWidth = pdfW * 1.05; // Slightly larger to prevent premature wrapping
              const textLeft = left - pdfW * 0.025; // Center the expanded width

              allContent.push({
                absolutePosition: {
                  x: textLeft,
                  y: top + pdfPaddingY + lineW * 0.6,
                },
                columns: [
                  {
                    text:
                      b.style === "action"
                        ? b.text.toUpperCase()
                        : b.text || "",
                    width: textWidth,
                    color: textColor,
                    fontSize: fontSize,
                    bold: fontBold,
                    italics: fontItalic,
                    alignment: "center",
                    lineHeight: 1.15,
                    margin: [0, 0, 0, 0],
                  },
                ],
              });
            }
          }

          const docDefinition = {
            pageSize: { width: PAGE_W, height: PAGE_H },
            pageMargins: [0, 0, 0, 0] as [number, number, number, number],
            content: allContent,
          };

          pdfMake.createPdf(docDefinition as any).download("comic.pdf");
        } else if (format === "epub") {
          const zip = new JSZip();
          zip.file("mimetype", "application/epub+zip", {
            compression: "STORE",
          });
          zip.file(
            "META-INF/container.xml",
            `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>`,
          );

          let manifest = "";
          let spine = "";
          pageDataUrls.forEach((data, i) => {
            const b64 = data.split(",")[1];
            zip.file(`OEBPS/images/page_${i + 1}.png`, b64, { base64: true });
            manifest += `<item id="img${i}" href="images/page_${i + 1}.png" media-type="image/png"/>\n`;
            manifest += `<item id="page${i}" href="page_${i + 1}.xhtml" media-type="application/xhtml+xml"/>\n`;
            spine += `<itemref idref="page${i}"/>\n`;

            const htmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Page ${i + 1}</title>
  <meta name="viewport" content="width=1200, height=1600"/>
  <style>
    * { margin: 0; padding: 0; }
    html, body { width: 1200px; height: 1600px; overflow: hidden; }
    .page-container { width: 1200px; height: 1600px; position: relative; }
    .bg-image { width: 1200px; height: 1600px; position: absolute; top: 0; left: 0; z-index: 1; display: block; object-fit: contain; }
    .bubble { position: absolute; z-index: 2; color: transparent; text-align: center; transform: translate(-50%, -50%); display: flex; align-items: center; justify-content: center; }
    .bubble::selection { background: rgba(0,100,255,0.3); color: transparent; }
  </style>
</head>
<body>
  <div class="page-container">
    <img class="bg-image" src="images/page_${i + 1}.png" alt="Page ${i + 1}"/>
    ${comicPages[i].bubbles
      .map((b) => {
        const stats = pageBubbleStats[i]?.[b.id] || { w: 100, h: 50 };
        const canvasW = comicRef.current?.offsetWidth || 600;
        const canvasH = comicRef.current?.offsetHeight || 800;
        const wPx = (stats.w / canvasW) * 1200;
        const hPx = (stats.h / canvasH) * 1600;
        const fontSizePx = (16 / canvasH) * 1600;
        return `<div class="bubble" style="left: ${b.x}%; top: ${b.y}%; width: ${wPx}px; height: ${hPx}px; font-size: ${fontSizePx}px;">${b.text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`;
      })
      .join("\n    ")}
  </div>
</body>
</html>`;
            zip.file(`OEBPS/page_${i + 1}.xhtml`, htmlContent);
          });

          zip.file(
            "OEBPS/content.opf",
            `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">\n<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n  <dc:title>Comic</dc:title>\n  <dc:language>en</dc:language>\n  <dc:identifier id="BookId">urn:uuid:${Date.now()}</dc:identifier>\n  <meta property="rendition:layout">pre-paginated</meta>\n  <meta property="rendition:spread">none</meta>\n</metadata>\n<manifest>${manifest}</manifest>\n<spine>${spine}</spine>\n</package>`,
          );

          const blob = await zip.generateAsync({ type: "blob" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `comic.epub`;
          a.click();
        }
        toast.success(`${format.toUpperCase()} export complete!`);
        return;
      } else if (format === "txt") {
        const blob = new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "document.txt";
        a.click();
        URL.revokeObjectURL(url);
      } else if (format === "pdf") {
        toast.info("Generating PDF...");
        try {
          const htmlToPdfmake = (await import("html-to-pdfmake")).default;
          const pdfMake = (await import("pdfmake/build/pdfmake")).default;
          const pdfFonts = (await import("pdfmake/build/vfs_fonts")).default;
          if (pdfFonts && pdfFonts.pdfMake) {
            pdfMake.vfs = pdfFonts.pdfMake.vfs;
          } else if (pdfFonts && (pdfFonts as any).vfs) {
            pdfMake.vfs = (pdfFonts as any).vfs;
          }

          const val = htmlToPdfmake(htmlContent, {
            defaultStyles: {
              h1: { fontSize: 24, bold: true, margin: [0, 0, 0, 10] },
              h2: { fontSize: 18, color: "#444444", margin: [0, 0, 0, 10] },
              p: { margin: [0, 0, 0, 10] },
            },
          });

          const addImageFit = (nodes: any) => {
            if (Array.isArray(nodes)) {
              for (const node of nodes) addImageFit(node);
            } else if (nodes && typeof nodes === "object") {
              if (nodes.image) {
                nodes.alignment = "center";
                nodes.margin = [0, 15, 0, 15];
                nodes.fit = [450, 600];
                delete nodes.width;
                delete nodes.height;
              }
              for (const key in nodes) {
                if (key !== "image") addImageFit(nodes[key]);
              }
            }
          };
          addImageFit(val);

          const docDefinition = {
            content: val,
            defaultStyle: { font: "Roboto" },
          };
          pdfMake.createPdf(docDefinition).download("document.pdf");
          toast.success("PDF export complete!");
        } catch (err: any) {
          toast.error("Failed to generate PDF: " + err.message);
        }
      } else if (format === "epub") {
        toast.info("Generating EPUB...");
        try {
          const zip = new JSZip();
          zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
          zip.file(
            "META-INF/container.xml",
            `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>`
          );

          const parser = new DOMParser();
          const parsedDoc = parser.parseFromString(
            `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${(storyTitle || "Document").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</title></head><body>${htmlContent}</body></html>`,
            "text/html"
          );
          parsedDoc.querySelectorAll("script, style:not(head style)").forEach((el) => el.remove());

          const imgElements = parsedDoc.querySelectorAll("img");
          let imgIndex = 1;
          let manifestImages = "";

          for (let i = 0; i < imgElements.length; i++) {
            const imgEl = imgElements[i] as HTMLImageElement;
            const src = imgEl.getAttribute("src") || "";
            let b64 = "";
            let ext = "png";

            if (src.startsWith("data:image/")) {
              const match = src.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
              if (match) {
                ext = match[1].toLowerCase().includes("jpeg") || match[1].toLowerCase().includes("jpg") ? "jpg" : match[1].toLowerCase();
                b64 = match[2].trim();
              }
            } else if (src.startsWith("blob:") || src.startsWith("http:") || src.startsWith("https:") || src.startsWith("/")) {
              try {
                const resp = await fetch(src);
                const b = await resp.blob();
                const reader = new FileReader();
                const dataUrl = await new Promise<string>((res) => {
                  reader.onloadend = () => res(reader.result as string);
                  reader.readAsDataURL(b);
                });
                const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
                if (match) {
                  ext = match[1].toLowerCase().includes("jpeg") || match[1].toLowerCase().includes("jpg") ? "jpg" : match[1].toLowerCase();
                  b64 = match[2].trim();
                }
              } catch (e) {
                console.warn("Failed reading image for EPUB export", e);
              }
            }

            if (b64) {
              const imgId = `img_${imgIndex}`;
              const imgFileName = `image_${imgIndex}.${ext}`;
              imgIndex++;
              zip.file(`OEBPS/images/${imgFileName}`, b64, { base64: true });
              const mimeType = ext === "jpg" ? "image/jpeg" : (ext === "png" ? "image/png" : `image/${ext}`);
              manifestImages += `    <item id="${imgId}" href="images/${imgFileName}" media-type="${mimeType}"/>\n`;
              imgEl.setAttribute("src", `images/${imgFileName}`);
            }
          }

          const docTitle = (storyTitle || "Story Document").trim();
          const safeTitle = docTitle.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const safeFileName = docTitle.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, "_") || "story";

          const serializer = new XMLSerializer();
          let serializedBody = "";
          parsedDoc.body.childNodes.forEach((childNode) => {
            serializedBody += serializer.serializeToString(childNode) + "\n";
          });

          // Ensure void tags are strictly self-closing for XHTML compliance
          serializedBody = serializedBody
            .replace(/<br(?:\s*|\s+[^>]*)(?<!\/)>/gi, '<br />')
            .replace(/<hr(?:\s*|\s+[^>]*)(?<!\/)>/gi, '<hr />')
            .replace(/<img(\s+[^>]*?)(?<!\/)>/gi, '<img$1 />');

          const uid = "book-" + Date.now();
          const modTime = new Date().toISOString().replace(/\.[0-9]+Z$/, "Z");

          const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${safeTitle}</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="BookId">urn:uuid:${uid}</dc:identifier>
    <meta property="dcterms:modified">${modTime}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
${manifestImages}  </manifest>
  <spine toc="ncx">
    <itemref idref="chapter1"/>
  </spine>
</package>`;

          const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <title>Navigation</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table of Contents</h1>
    <ol>
      <li><a href="chapter1.xhtml">${safeTitle}</a></li>
    </ol>
  </nav>
</body>
</html>`;

          const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${uid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${safeTitle}</text></docTitle>
  <navMap>
    <navPoint id="navpoint-1" playOrder="1">
      <navLabel><text>${safeTitle}</text></navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`;

          const chapterXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head>
  <title>${safeTitle}</title>
  <style type="text/css">
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.7; padding: 1.5rem; color: #1e293b; background-color: #ffffff; }
    h1 { font-size: 2rem; font-weight: 800; margin-bottom: 1.25rem; color: #0f172a; }
    h2 { font-size: 1.5rem; font-weight: 700; margin-top: 1.5rem; margin-bottom: 0.75rem; color: #1e293b; }
    h3 { font-size: 1.25rem; font-weight: 600; margin-top: 1.25rem; margin-bottom: 0.5rem; color: #334155; }
    p { margin-bottom: 1rem; font-size: 1rem; }
    img { max-width: 100%; height: auto; display: block; margin: 1.5rem auto; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>${safeTitle}</h1>
  ${serializedBody}
</body>
</html>`;

          zip.file("OEBPS/content.opf", contentOpf);
          zip.file("OEBPS/nav.xhtml", navXhtml);
          zip.file("OEBPS/toc.ncx", tocNcx);
          zip.file("OEBPS/chapter1.xhtml", chapterXhtml);

          const blob = await zip.generateAsync({ type: "blob" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `${safeFileName}.epub`;
          a.click();
          URL.revokeObjectURL(a.href);
          toast.success("EPUB export complete!");
        } catch (epubErr: any) {
          console.error("EPUB export error:", epubErr);
          toast.error(`EPUB export failed: ${epubErr.message || "Unknown error"}`);
        }
      } else if (format === "docx") {
        toast.info("Generating DOCX...");
        try {
          const docxBlob = await generateClientDocx(htmlContent, storyTitle || "Document");
          const url = URL.createObjectURL(docxBlob);
          const a = document.createElement("a");
          a.href = url;
          const safeDocName = (storyTitle || "document").replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, "_") || "document";
          a.download = `${safeDocName}.docx`;
          a.click();
          URL.revokeObjectURL(url);
          toast.success("DOCX export complete!");
        } catch (docxErr: any) {
          console.error("DOCX export error:", docxErr);
          toast.error(`DOCX export failed: ${docxErr.message || "Unknown error"}`);
        }
      } else if (format === "cbz") {
        // Create simple text/html fallback for cbz unsupported direct generation
        const blob = new Blob([htmlContent], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `document.html`;
        a.click();
        URL.revokeObjectURL(url);
        toast.info("Saved CBZ as HTML file for now.");
      }
      toast.success(`${format.toUpperCase()} export complete!`);
    } catch (e) {
      console.error("Export failure:", e);
      toast.error(`Export to ${format.toUpperCase()} failed.`);
    } finally {
      setIsExporting(false);
    }
  };

  const renderExportMenu = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 shrink-0 h-8 text-xs font-semibold"
        >
          <Download className="w-4 h-4" />{" "}
          <span className="hidden sm:inline">{t("export")}</span>{" "}
          <ChevronDown className="w-3 h-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => handlePublish()} className="cursor-pointer gap-2 font-medium">
          <Share2 className="w-4 h-4 text-primary shrink-0" />
          <span>{t("publish")}</span>
        </DropdownMenuItem>
        <div className="w-full h-px bg-border my-1" />
        {createMode === "document" ? (
          <>
            <DropdownMenuItem
              onClick={() => handleSaveStoryProjectToDrive()}
              className="cursor-pointer gap-2 font-semibold text-primary focus:text-primary"
            >
              <GoogleDriveIcon className="w-3.5 h-3.5 shrink-0" />
              <span>Save</span>
            </DropdownMenuItem>
            <div className="w-full h-px bg-border my-1" />
            <DropdownMenuItem onClick={() => handleExport("pdf")}>
              PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("epub")}>
              EPUB
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("docx")}>
              DOCX
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("txt")}>
              TXT
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem
              onClick={() => handleSaveComicProjectToDrive()}
              className="cursor-pointer gap-2 font-semibold text-primary focus:text-primary"
            >
              <GoogleDriveIcon className="w-3.5 h-3.5 shrink-0" />
              <span>Save</span>
            </DropdownMenuItem>
            <div className="w-full h-px bg-border my-1" />
            <DropdownMenuItem onClick={() => handleExport("pdf")}>
              PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("epub")}>
              EPUB
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("cbz")}>
              CBZ
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("zip")}>
              ZIP
            </DropdownMenuItem>
            <div className="w-full h-px bg-border my-1" />
            <DropdownMenuItem onClick={() => handleExport("png")}>
              {t("imageFormatPng")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (createMode === "select") {
    const formatTime = (ts: number) => {
      return formatDate(ts);
    };

    const getPreviewText = (html: string) => {
      if (typeof document === 'undefined') return '';
      const div = document.createElement('div');
      div.innerHTML = html;
      const text = (div.textContent || div.innerText || '').trim();
      if (text) return text;
      if (html.includes('story-inline-canvas-placeholder')) return '[Contains drawing illustrations]';
      if (html.includes('<img') || html.includes('<IMG')) return '[Contains inserted images]';
      return '';
    };

    return (
      <div className="w-full flex-1 overflow-y-auto min-h-0 py-6 px-4 sm:px-6 md:px-8">
        <div className="w-full max-w-full space-y-8 flex flex-col items-stretch pb-16">
        <div className="text-center space-y-1.5 max-w-2xl mx-auto">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground uppercase">{t("createCardTitle")}</h1>
          <p className="text-muted-foreground text-xs sm:text-sm max-w-md mx-auto">
            {t("createCardDesc")}
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpenDriveImport}
              className="h-8 px-3 text-xs font-semibold gap-2 border-border/80 bg-background hover:bg-muted shadow-xs transition-colors"
            >
              <GoogleDriveIcon className="w-3.5 h-3.5" />
              <span>Open Work from Google Drive</span>
            </Button>
          </div>
        </div>
        
        <div className="grid md:grid-cols-2 gap-4 sm:gap-6 w-full max-w-2xl mx-auto">
          <Card
            className="p-5 sm:p-6 border border-border cursor-pointer hover:border-primary transition-all hover:shadow-md flex flex-col items-center text-center gap-3 bg-card group rounded-none"
            onClick={() => {
              resetDrawToolSettingsToDefault();
              setCurrentComicId(null);
              setComicTitle("Untitled Comic");
              setComicPagesState([
                {
                  id: Date.now().toString(),
                  tree: createGridTree(3, 2),
                  bubbles: [
                    { id: "1", text: "HELLO WORLD!", x: 25, y: 30, style: "classic" },
                    {
                      id: "2",
                      text: "WHAT A COOL WORKSPACE!",
                      x: 60,
                      y: 65,
                      style: "action",
                    },
                  ],
                }
              ]);
              setActivePageIndex(0);
              setCreateMode("comic");
            }}
          >
            <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
              <Layout className="w-7 h-7" />
            </div>
            <div>
              <h3 className="font-bold mb-0.5 text-foreground uppercase tracking-wide text-sm">
                {t("freeComicCreatorTitle")}
              </h3>
              <p className="text-xs text-muted-foreground">{t("freeComicCreatorDesc")}</p>
            </div>
          </Card>

          <Card
            className="p-5 sm:p-6 border border-border cursor-pointer hover:border-primary transition-all hover:shadow-md flex flex-col items-center text-center gap-3 bg-card group rounded-none"
            onClick={() => {
              setCurrentStoryId(null);
              setStoryTitle("Untitled Story");
              setLoadedHtmlContent("<h1><br></h1><h2><br></h2><p><br></p>");
              setCreateMode("document");
            }}
          >
            <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
              <Type className="w-7 h-7" />
            </div>
            <div>
              <h3 className="font-bold mb-0.5 text-foreground uppercase tracking-wide text-sm">
                {t("richTextEditorTitle")}
              </h3>
              <p className="text-xs text-muted-foreground">{t("richTextEditorDesc")}</p>
            </div>
          </Card>
        </div>

        {/* Published Works Section (Displayed for Auth / Local Users) */}
        <div className="space-y-3 pt-6 border-t w-full">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-black tracking-wider uppercase text-foreground flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-primary" />
                {t("publishedWorks")}
              </h3>
              {user && (
                <span className="text-[10px] font-bold bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <UserPlus className="w-3 h-3" />
                  {user.name || user.email || "Auth User"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!user && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-7 text-xs font-semibold"
                  onClick={() => setShowAuthDialog(true)}
                >
                  <UserPlus className="w-3 h-3 mr-1" /> {t("signInToSync")}
                </Button>
              )}
              <span className="text-xs text-muted-foreground font-mono">{t("worksCountLabel").replace("{count}", String(publishedWorks.filter((item) => checkIsAuthor(item, user)).length))}</span>
            </div>
          </div>

          {publishedWorks.filter((item) => checkIsAuthor(item, user)).length === 0 ? (
            <Card className="p-6 text-center bg-card/40 border border-dashed flex flex-col items-center justify-center gap-2 rounded-none">
              <BookOpen className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">{t("noPublishedWorks")}</p>
              <p className="text-xs text-muted-foreground/80 max-w-sm">
                {t("noPublishedWorksDesc")}
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 sm:gap-4 w-full">
              {publishedWorks.filter((item) => checkIsAuthor(item, user)).map((item, index) => (
                <CreateMetroTile
                  key={item.id}
                  book={item}
                  index={index}
                  user={user}
                  onEdit={handleQuickEditPublished}
                  onDelete={handleDeletePublished}
                  onExportDrive={handleQuickExportPublishedToDrive}
                />
              ))}
            </div>
          )}
        </div>

        {/* Unfinished Comic list */}
        {unfinishedComics.length > 0 && (
          <div className="space-y-3 pt-6 border-t w-full">
            <div className="flex items-center justify-between">
              <h3 className="text-base sm:text-lg font-black tracking-wider uppercase text-foreground">{t("previousUnfinishedComics")}</h3>
              <span className="text-xs text-muted-foreground font-mono">{t("itemsCountLabel").replace("{count}", String(unfinishedComics.length))}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 sm:gap-4 w-full">
              {unfinishedComics.map((comic) => (
                <Card 
                  key={comic.id}
                  onClick={() => {
                    setCurrentComicId(comic.id);
                    setComicTitle(comic.title);
                    setComicPagesState(comic.pages);
                    setActivePageIndex(comic.activePageIndex || 0);
                    setCreateMode("comic");
                  }}
                  className="group relative flex flex-col bg-card hover:bg-accent/30 border hover:border-primary/50 transition-all duration-300 rounded-none overflow-hidden cursor-pointer shadow-xs hover:shadow-md animate-fade-in w-full"
                >
                  {/* Miniature Panel Tree Layout Preview: 4/3 aspect ratio */}
                  <div className="relative aspect-[3/4] bg-muted/10 p-1.5 border-b flex items-stretch">
                    <div className="w-full h-full flex flex-col items-stretch overflow-hidden border border-foreground/15 p-0.5 rounded-none bg-background">
                      {comic.pages[0] && (
                        <div className="w-full h-full flex flex-col min-h-0 min-w-0">
                          <div className="flex-1 flex flex-col min-h-0 min-w-0">
                            {(() => {
                              const MiniGridTree = ({ node }: { node: any }): any => {
                                if (!node) return null;
                                if (node.type === "panel") {
                                  return (
                                    <div 
                                      className="flex-1 border border-foreground/10 bg-muted/30 flex items-center justify-center overflow-hidden m-0.5"
                                      style={node.bgColor ? { backgroundColor: node.bgColor } : {}}
                                    >
                                      {node.imageUrl ? (
                                        <img src={node.imageUrl || undefined} className="w-full h-full object-cover opacity-60 scale-95" />
                                      ) : (
                                        <span className="text-[6px] text-muted-foreground/60 font-black">P</span>
                                      )}
                                    </div>
                                  );
                                }
                                const isRow = node.dir === "row";
                                const pct = node.percent || 50;
                                return (
                                  <div className={cn("flex flex-1 w-full h-full min-w-0 min-h-0", isRow ? "flex-row" : "flex-col")}>
                                    <div style={isRow ? { width: `${pct}%` } : { height: `${pct}%` }} className="flex min-w-0 min-h-0">
                                      <MiniGridTree node={node.c1} />
                                    </div>
                                    <div style={isRow ? { width: `${100 - pct}%` } : { height: `${100 - pct}%` }} className="flex min-w-0 min-h-0">
                                      <MiniGridTree node={node.c2} />
                                    </div>
                                  </div>
                                );
                              };
                              return <MiniGridTree node={comic.pages[0].tree} />;
                            })()}
                          </div>
                          {comic.pages[0].bubbles?.length > 0 && (
                            <div className="absolute bottom-1 right-1 bg-primary text-primary-foreground text-[7px] font-black px-1">
                              {comic.pages[0].bubbles.length} {t("bubbles")}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {/* Hover Play Button Overlay */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="p-2 bg-primary text-primary-foreground rounded-full shadow-md transform scale-90 group-hover:scale-100 transition-transform">
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      </div>
                    </div>
                  </div>

                  {/* Metadata: Line 1 Title + delete/drive, Line 2 pages count & timestamp */}
                  <div className="p-1.5 flex flex-col w-full min-w-0">
                    <div className="flex items-center justify-between gap-1 w-full min-w-0">
                      <h4 className="text-xs font-bold text-foreground truncate group-hover:text-primary transition-colors flex-1" title={comic.title}>
                        {comic.title}
                      </h4>
                      <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleQuickExportComicDraftToDrive(comic);
                          }}
                          className="w-4 h-4 p-0 text-muted-foreground hover:text-primary hover:bg-primary/10"
                          title="Save to Google Drive"
                        >
                          <GoogleDriveIcon className="w-2.5 h-2.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await deleteUnfinishedComic(comic.id);
                            getUnfinishedComics().then(setUnfinishedComics);
                            toast.success("Comic project deleted");
                          }}
                          className="w-4 h-4 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title={t("deleteWork")}
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono mt-0.5 min-w-0">
                      <span className="truncate">
                        {t("pagesCountLabel").replace("{count}", String(comic.pages.length))}
                      </span>
                      <span className="truncate text-[9px]">{formatTime(comic.timestamp)}</span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Unfinished Story list */}
        {unfinishedStories.length > 0 && (
          <div className="space-y-3 pt-6 border-t w-full">
            <div className="flex items-center justify-between">
              <h3 className="text-base sm:text-lg font-black tracking-wider uppercase text-foreground">{t("previousUnfinishedStories")}</h3>
              <span className="text-xs text-muted-foreground font-mono">{t("itemsCountLabel").replace("{count}", String(unfinishedStories.length))}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 sm:gap-4 w-full">
              {unfinishedStories.map((story) => (
                <Card 
                  key={story.id}
                  onClick={() => {
                    setCurrentStoryId(story.id);
                    setStoryTitle(story.title);
                    setLoadedHtmlContent(story.htmlContent);
                    setCreateMode("document");
                  }}
                  className="group relative flex flex-col bg-card hover:bg-accent/30 border hover:border-primary/50 transition-all duration-300 rounded-none overflow-hidden cursor-pointer shadow-xs hover:shadow-md animate-fade-in w-full"
                >
                  {/* Miniature Story Preview: 4/3 aspect ratio */}
                  <div className="relative aspect-[3/4] bg-muted/15 p-2 border-b flex flex-col justify-between select-none">
                    <div className="flex items-center justify-between border-b border-border/40 pb-0.5">
                      <span className="text-[7px] font-mono uppercase font-bold text-muted-foreground">Draft</span>
                      <span className="text-[7px] font-mono text-primary font-bold uppercase">DOC</span>
                    </div>
                    <div className="my-auto space-y-0.5 py-0.5 overflow-hidden">
                      <h5 className="text-[10px] font-serif font-bold text-foreground line-clamp-2 leading-tight">
                        {story.title}
                      </h5>
                      <p className="text-[8px] text-muted-foreground italic font-serif line-clamp-3 leading-snug">
                        {getPreviewText(story.htmlContent) || "No text content written yet..."}
                      </p>
                    </div>
                    <div className="text-[6px] text-muted-foreground/60 font-mono border-t border-border/30 pt-0.5 text-center truncate">
                      eBookCC Story Draft
                    </div>

                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="p-2 bg-primary text-primary-foreground rounded-full shadow-md transform scale-90 group-hover:scale-100 transition-transform">
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      </div>
                    </div>
                  </div>

                  {/* Metadata: Line 1 Title + delete/drive, Line 2 timestamp */}
                  <div className="p-1.5 flex flex-col w-full min-w-0">
                    <div className="flex items-center justify-between gap-1 w-full min-w-0">
                      <h4 className="text-xs font-bold text-foreground truncate group-hover:text-primary transition-colors flex-1" title={story.title}>
                        {story.title}
                      </h4>
                      <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleQuickExportStoryDraftToDrive(story);
                          }}
                          className="w-4 h-4 p-0 text-muted-foreground hover:text-primary hover:bg-primary/10"
                          title="Save to Google Drive"
                        >
                          <GoogleDriveIcon className="w-2.5 h-2.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await deleteUnfinishedStory(story.id);
                            getUnfinishedStories().then(setUnfinishedStories);
                            toast.success("Story project deleted");
                          }}
                          className="w-4 h-4 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title={t("deleteWork")}
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono mt-0.5 min-w-0">
                      <span className="truncate flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5 shrink-0" />
                        {formatTime(story.timestamp)}
                      </span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
      {renderGoogleDriveDialog()}
    </div>
    );
  }

  if (createMode === "document") {
    return (
      <div className="flex-1 bg-background flex flex-col overflow-hidden h-full min-h-0">
        <header className="sticky top-0 z-[150] w-full border-b bg-background/80 backdrop-blur-md shrink-0 no-print overflow-visible">
          <div className="w-full px-2 h-11 flex items-center justify-between gap-2">
            <div className="flex items-center gap-0.5 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="h-8 px-2 font-mono font-black text-xs bg-transparent text-primary border-none shadow-none hover:bg-transparent shrink-0 select-none hover:scale-105 active:scale-95 transition-all"
                title={isSidebarOpen ? (t("hideSidebar") || "Hide Sidebar") : (t("showSidebar") || "Show Sidebar")}
              >
                P{activePageIndex + 1}
              </Button>
              <div className="w-px h-5 bg-border mx-1 shrink-0" />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCreateMode("select")}
                className="w-8 h-8 shrink-0"
                title={t("back") || "Back"}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (handleUndoStoryDoc()) return;
                  if (isDrawingMode || selectedCanvasElement || canUndoInline) {
                    if (handleUndoInline()) return;
                  }
                  execDocCommand("undo");
                }}
                className="w-8 h-8 shrink-0"
                title={t("undo") || "Undo (Ctrl+Z)"}
              >
                <Undo2 className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (handleRedoStoryDoc()) return;
                  if (isDrawingMode || selectedCanvasElement || canRedoInline) {
                    if (handleRedoInline()) return;
                  }
                  execDocCommand("redo");
                }}
                className="w-8 h-8 shrink-0"
                title={t("redo") || "Redo (Ctrl+Y / Ctrl+Shift+Z)"}
              >
                <Redo2 className="w-4 h-4" />
              </Button>
              <div className="w-px h-5 bg-border mx-1 shrink-0" />
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={insertImageToDoc}
                  className="gap-1.5 px-2.5 h-8 text-xs font-semibold cursor-pointer shrink-0 text-muted-foreground hover:text-foreground"
                  title={t("insert") || "Insert"}
                >
                  <ImageIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">{t("insert") || "Insert"}</span>
                </Button>
                <Button
                  variant={isDrawingMode ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => {
                    if (isDrawingMode) {
                      setIsDrawingMode(false);
                    } else {
                      setIsDrawingMode(true);
                      setDrawTool("pen");
                      if (!selectedCanvasElement) {
                        handleInsertInlineCanvas();
                      }
                    }
                  }}
                  className={`gap-1.5 px-2.5 h-8 text-xs font-semibold cursor-pointer shrink-0 ${isDrawingMode ? "bg-primary/20 text-primary hover:bg-primary/30" : "text-muted-foreground hover:text-foreground"}`}
                  title={t("drawModeTooltip") || "Draw Mode (Hotkey: D)"}
                >
                  <PenTool className="w-4 h-4" />
                  <span className="hidden sm:inline">{t("draw") || "Draw"}</span>
                </Button>
              </div>

              {/* In Landscape mode, display the same drawing tools as COMIC CREATOR at toolbar, NOT in canvas */}
              {isDrawingMode && !isPortrait && (
                <>
                  <div className="w-px h-5 bg-border mx-1 shrink-0" />
                  {renderDrawingToolbar(false, true)}
                </>
              )}
            </div>

            <div className="flex-1 flex items-center justify-center mx-4">
              {floatingMenuProps.visible ? (
                <div className="flex items-center gap-1 bg-muted/30 rounded-md p-0.5 border border-border/50 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      execDocCommand("formatBlock", "H1");
                    }}
                  >
                    <Heading1 className="w-3.5 h-3.5 sm:mr-1.5" />{" "}
                    <span className="hidden sm:inline">{t("title")}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      execDocCommand("formatBlock", "H2");
                    }}
                  >
                    <Heading2 className="w-3.5 h-3.5 sm:mr-1.5" />{" "}
                    <span className="hidden sm:inline">{t("subtitle")}</span>
                  </Button>
                  <div className="w-px h-4 bg-border mx-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      execDocCommand("formatBlock", "P");
                    }}
                  >
                    <Type className="w-3.5 h-3.5 sm:mr-1.5" />{" "}
                    <span className="hidden sm:inline">{t("text")}</span>
                  </Button>
                  <div className="w-px h-4 bg-border mx-1 border-r border-border" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-primary"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      const selection = window.getSelection()?.toString();
                      if (selection) {
                        window.dispatchEvent(
                          new CustomEvent("quote-to-agent", {
                            detail: { type: "text", text: selection },
                          }),
                        );
                      }
                    }}
                  >
                    <Bot className="w-4 h-4 sm:mr-1.5" />{" "}
                    <span className="hidden sm:inline">{t("askAiAgent")}</span>
                  </Button>
                </div>
              ) : (
                <input
                  value={storyTitle}
                  onChange={(e) => {
                    setStoryTitle(e.target.value);
                    isPublishedStoryRef.current = false;
                  }}
                  className="bg-transparent border-none text-foreground font-bold text-center text-sm focus:outline-none focus:ring-0 max-w-[180px] sm:max-w-[300px]"
                  placeholder={t("storyTitlePlaceholder")}
                />
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pr-2 shrink-0">
              {renderExportMenu()}
            </div>
          </div>
        </header>

        <main className="flex-1 relative w-full overflow-hidden flex min-h-0 bg-background print-wrapper">
          <AnimatePresence>
            {imageMenuProps.visible && imageMenuProps.imgElement && (
              <div
                key="image-toolbar-positioner"
                className="fixed z-[130] pointer-events-none"
                style={{
                  top: imageMenuProps.top,
                  left: imageMenuProps.left,
                  transform: "translate(-50%, -100%) translateY(-8px)",
                }}
              >
                <motion.div
                  initial={{ opacity: 0, y: 4, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.95 }}
                  transition={{ duration: 0.12 }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => e.stopPropagation()}
                  className="pointer-events-auto w-max"
                >
                  <ImageToolbar
                    color={
                      imageMenuProps.imgElement?.style.borderColor || "#000000"
                    }
                    isHighContrast={
                      !!imageMenuProps.imgElement?.style.filter.includes(
                        "grayscale",
                      )
                    }
                    hasOutline={!!imageMenuProps.imgElement?.style.border}
                    onUpdate={(updates) => {
                      if (!imageMenuProps.imgElement) return;
                      if (
                        updates.color !== undefined ||
                        updates.hasOutline !== undefined
                      ) {
                        if (updates.hasOutline !== false) {
                          imageMenuProps.imgElement.style.border = `2px solid ${updates.color || imageMenuProps.imgElement.style.borderColor || "#000000"}`;
                          imageMenuProps.imgElement.style.boxSizing =
                            "border-box";
                        } else {
                          imageMenuProps.imgElement.style.border = "";
                        }
                      }
                      if (updates.isHighContrast !== undefined) {
                        imageMenuProps.imgElement.style.filter =
                          updates.isHighContrast
                            ? "grayscale(1) contrast(1.25)"
                            : "";
                      }
                      if (updates.url !== undefined) {
                        imageMenuProps.imgElement.src = updates.url;
                      }
                      updateToc();
                      setImageMenuProps((prev) => ({ ...prev }));
                    }}
                    onMoveLayer={(dir) => {
                      if (!imageMenuProps.imgElement) return;
                      if (
                        dir === "up" &&
                        imageMenuProps.imgElement.previousElementSibling
                      ) {
                        imageMenuProps.imgElement.parentNode?.insertBefore(
                          imageMenuProps.imgElement,
                          imageMenuProps.imgElement.previousElementSibling,
                        );
                      } else if (
                        dir === "down" &&
                        imageMenuProps.imgElement.nextElementSibling
                      ) {
                        imageMenuProps.imgElement.parentNode?.insertBefore(
                          imageMenuProps.imgElement.nextElementSibling,
                          imageMenuProps.imgElement,
                        );
                      }
                      updateToc();
                    }}
                    onCropToggle={() => {
                      setIsImageCropping(!isImageCropping);
                    }}
                    isCropping={isImageCropping}
                    onDragStartMove={(e) => {
                      if (!imageMenuProps.imgElement) return;
                      e.dataTransfer.effectAllowed = "copyMove";

                      const originalId =
                        imageMenuProps.imgElement.id || "img-" + Date.now();
                      imageMenuProps.imgElement.id = originalId;

                      const clone = imageMenuProps.imgElement.cloneNode(
                        true,
                      ) as HTMLImageElement;
                      clone.id = "";

                      e.dataTransfer.setData("image-drag-id", originalId);
                      e.dataTransfer.setData("text/html", clone.outerHTML);
                      e.dataTransfer.setData("text/plain", " ");
                      e.dataTransfer.setDragImage(
                        imageMenuProps.imgElement,
                        0,
                        0,
                      );
                      setTimeout(
                        () =>
                          setImageMenuProps((prev) => ({
                            ...prev,
                            visible: false,
                          })),
                        0,
                      );
                    }}
                    onClickAskAI={() => {
                      if (!imageMenuProps.imgElement) return;
                      window.dispatchEvent(
                        new CustomEvent("quote-to-agent", {
                          detail: {
                            type: "image",
                            imageUrl: imageMenuProps.imgElement.src,
                          },
                        }),
                      );
                      setImageMenuProps((prev) => ({ ...prev, visible: false }));
                    }}
                    onRegenerate={() => {
                      if (!imageMenuProps.imgElement) return;
                      const promptText = imageMenuProps.imgElement.alt || "comic book illustration, vivid colors, graphic novel";
                      const seed = Math.floor(Math.random() * 100000000);
                      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(promptText)}?width=1024&height=1024&seed=${seed}&nologo=true&model=flux`;
                      imageMenuProps.imgElement.src = url;
                      updateToc();
                      setImageMenuProps((prev) => ({ ...prev, visible: false }));
                    }}
                    onDelete={() => {
                      if (!imageMenuProps.imgElement) return;
                      imageMenuProps.imgElement.remove();
                      updateToc();
                      setImageMenuProps((prev) => ({ ...prev, visible: false, imgElement: null }));
                    }}
                  />
                </motion.div>
              </div>
            )}
          </AnimatePresence>
          {isImageCropping &&
            imageMenuProps.visible &&
            imageMenuProps.imgElement && (
              <CanvasCropOverlay
                imgElement={imageMenuProps.imgElement}
                onClose={() => setIsImageCropping(false)}
                updateToc={updateToc}
              />
            )}
          {!isImageCropping &&
            (selectedImageElements.length > 0
              ? selectedImageElements
              : (imageMenuProps.visible && imageMenuProps.imgElement ? [imageMenuProps.imgElement] : [])
            ).map((img, idx) => (
              <CanvasResizeOverlay
                key={img.id || img.src || `selected-img-${idx}`}
                targetElement={img}
                onPositionChange={(newRect) => {
                  if (imageMenuProps.imgElement === img) {
                    setImageMenuProps((prev) => ({
                      ...prev,
                      top: newRect.top,
                      left: newRect.left + newRect.width / 2,
                    }));
                  }
                }}
                updateToc={updateToc}
              />
            ))}
          {!isDrawingMode &&
            (selectedCanvasElements.length > 0
              ? selectedCanvasElements
              : (selectedCanvasElement ? [selectedCanvasElement] : [])
            ).map((c, idx) => (
              <CanvasResizeOverlay
                key={c.getAttribute("data-id") || c.id || `selected-canvas-${idx}`}
                targetElement={c}
                onResize={(widthPercent) => {
                  const canvasId = c.getAttribute("data-id");
                  if (canvasId) {
                    setInlineCanvases((prev) => {
                      const current = prev[canvasId];
                      if (!current) return prev;
                      const updated = {
                        ...prev,
                        [canvasId]: { ...current, widthPercent },
                      };
                      c.setAttribute(
                        "data-canvas-data",
                        JSON.stringify(updated[canvasId])
                      );
                      pushInlineCanvasesHistory(updated);
                      return updated;
                    });
                  }
                }}
                updateToc={updateToc}
              />
            ))}
          <AnimatePresence initial={false}>
            {isSidebarOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-30 bg-black/5"
                  onClick={() => setIsSidebarOpen(false)}
                />
                <motion.aside
                  initial={{ x: -180, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -180, opacity: 0 }}
                  transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                  className="absolute z-40 top-0 left-0 bottom-0 w-[140px] md:w-[180px] border-r bg-background/95 backdrop-blur-md shadow-2xl flex flex-col overflow-visible no-print"
                >
                  <div className="p-3 border-b shrink-0 flex items-center justify-between bg-muted/30">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                      <List className="w-3 h-3" /> {t("outline")}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto no-scrollbar py-2">
                    {tocItems.map((item, idx) => (
                      <div
                        key={idx}
                        className={`px-4 py-1.5 hover:bg-muted cursor-pointer transition-colors border-l-2 border-transparent hover:border-primary flex items-start truncate`}
                        onClick={() => {
                          const el = document.getElementById(item.id);
                          if (el)
                            el.scrollIntoView({
                              behavior: "smooth",
                              block: "center",
                            });
                        }}
                      >
                        <span
                          className={
                            item.level === 1
                              ? "text-sm font-semibold text-foreground truncate"
                              : "text-xs font-normal pl-3 text-muted-foreground truncate"
                          }
                        >
                          {item.text}
                        </span>
                      </div>
                    ))}
                    {tocItems.length === 0 && (
                      <div className="text-center p-4 text-xs font-semibold text-muted-foreground/60">
                        {t("emptyOutline")}
                      </div>
                    )}
                  </div>

                  {/* Vertical drawing toolbar positioned relative to the right side of the left sidebar */}
                  {isDrawingMode && isPortrait && (
                    <div
                      data-portrait-drawing-sidebar="true"
                      className="absolute top-3 left-full ml-2.5 z-50 pointer-events-auto shrink-0"
                    >
                      {renderDrawingToolbar(true, true)}
                    </div>
                  )}
                </motion.aside>
              </>
            )}
          </AnimatePresence>
          <div className="flex-1 p-2 md:p-6 overflow-hidden flex flex-col items-center print-wrapper">
            <div
              ref={editorRef}
              onScroll={() => {
                setScrollTick((t) => (t + 1) % 1000);
                if (floatingMenuProps.visible) {
                  const selection = window.getSelection();
                  if (selection && selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    const rects = range.getClientRects();
                    if (rects.length > 0) {
                      const rect = rects[0];
                      setFloatingMenuProps((prev) => ({
                        ...prev,
                        top: Math.max(10, rect.top - 46),
                        left: Math.max(
                          10,
                          Math.min(
                            rect.left + rect.width / 2,
                            window.innerWidth - 100,
                          ),
                        ),
                      }));
                    }
                  }
                }
                if (imageMenuProps.visible && imageMenuProps.imgElement) {
                  const rect =
                    imageMenuProps.imgElement.getBoundingClientRect();
                  setImageMenuProps((prev) => ({
                    ...prev,
                    top: rect.top,
                    left: rect.left + rect.width / 2,
                  }));
                }
              }}
              onKeyDown={handleKeyDown}
              onClick={(e) => {
                const target = e.target as HTMLElement;
                const canvasPlaceholder = target.closest(".story-inline-canvas-placeholder") as HTMLElement | null;
                const isCtrl = e.ctrlKey || e.metaKey;

                if (target.tagName === "IMG") {
                  const img = target as HTMLImageElement;
                  if (!isCtrl) {
                    // Single-select: deselect any canvases, clear other images, only select this image
                    setSelectedCanvasElement(null);
                    setSelectedCanvasElements([]);
                    setSelectedImageElements([img]);
                    const rect = img.getBoundingClientRect();
                    setImageMenuProps({
                      visible: true,
                      top: rect.top,
                      left: rect.left + rect.width / 2,
                      imgElement: img,
                    });
                  } else {
                    // Multi-select with Ctrl: toggle this image
                    setSelectedImageElements((prev) => {
                      if (prev.includes(img)) {
                        const next = prev.filter((el) => el !== img);
                        if (imageMenuProps.imgElement === img) {
                          if (next.length > 0) {
                            const last = next[next.length - 1];
                            const r = last.getBoundingClientRect();
                            setImageMenuProps({
                              visible: true,
                              top: r.top,
                              left: r.left + r.width / 2,
                              imgElement: last,
                            });
                          } else {
                            setImageMenuProps({ visible: false, top: 0, left: 0, imgElement: null });
                          }
                        }
                        return next;
                      } else {
                        const r = img.getBoundingClientRect();
                        setImageMenuProps({
                          visible: true,
                          top: r.top,
                          left: r.left + r.width / 2,
                          imgElement: img,
                        });
                        return [...prev, img];
                      }
                    });
                  }
                } else if (canvasPlaceholder) {
                  if (!isCtrl) {
                    // Single-select: deselect any images, remove image adjust bar & outline
                    setImageMenuProps({ visible: false, top: 0, left: 0, imgElement: null });
                    setSelectedImageElements([]);
                    setSelectedCanvasElement(canvasPlaceholder);
                    setSelectedCanvasElements([canvasPlaceholder]);
                  } else {
                    // Multi-select with Ctrl: toggle this canvas
                    setSelectedCanvasElements((prev) => {
                      if (prev.includes(canvasPlaceholder)) {
                        const next = prev.filter((el) => el !== canvasPlaceholder);
                        setSelectedCanvasElement(next.length > 0 ? next[next.length - 1] : null);
                        return next;
                      } else {
                        setSelectedCanvasElement(canvasPlaceholder);
                        return [...prev, canvasPlaceholder];
                      }
                    });
                  }
                } else {
                  if (!isCtrl) {
                    setSelectedCanvasElement(null);
                    setSelectedCanvasElements([]);
                    setSelectedImageElements([]);
                    setImageMenuProps({ visible: false, top: 0, left: 0, imgElement: null });
                  }
                  const sel = window.getSelection();
                  // Check if selection is collapsed, only force cursor to end if user just clicked blank space
                  if (target === editorRef.current && (!sel || sel.isCollapsed)) {
                    if (sel) {
                      let p = editorRef.current.lastElementChild;
                      if (
                        !p ||
                        p.tagName !== "P" ||
                        (p.textContent?.trim() !== "" && !p.querySelector("br"))
                      ) {
                        p = document.createElement("p");
                        p.innerHTML = "<br>";
                        editorRef.current.appendChild(p);
                      }
                      const range = document.createRange();
                      range.selectNodeContents(p);
                      range.collapse(false);
                      sel.removeAllRanges();
                      sel.addRange(range);
                    }
                  }
                }
              }}
              onDragOver={(e) => {
                const types = Array.from(e.dataTransfer.types);
                if (
                  types.includes("image-drag-id") ||
                  types.includes("text/html")
                ) {
                  e.preventDefault();
                  // @ts-ignore
                  const range = document.caretRangeFromPoint
                    ? document.caretRangeFromPoint(e.clientX, e.clientY)
                    : null;
                  if (range) {
                    const sel = window.getSelection();
                    sel?.removeAllRanges();
                    sel?.addRange(range);
                  }
                }
              }}
              onDrop={(e) => {
                const dragId = e.dataTransfer.getData("image-drag-id");
                if (dragId) {
                  e.preventDefault();
                  setImageMenuProps((prev) => ({ ...prev, visible: false }));

                  const oldImg = document.getElementById(dragId);
                  if (oldImg) {
                    // @ts-ignore
                    const dropRange = document.caretRangeFromPoint
                      ? document.caretRangeFromPoint(e.clientX, e.clientY)
                      : null;

                    if (dropRange) {
                      dropRange.insertNode(oldImg);
                      dropRange.collapse(false);
                      const sel = window.getSelection();
                      sel?.removeAllRanges();
                      sel?.addRange(dropRange);
                    } else {
                      const sel = window.getSelection();
                      if (sel && sel.rangeCount > 0) {
                        const range = sel.getRangeAt(0);
                        range.insertNode(oldImg);
                        range.collapse(false);
                        sel.removeAllRanges();
                        sel.addRange(range);
                      }
                    }
                  }

                  setTimeout(() => {
                    updateToc();
                  }, 0);
                }
              }}
              className="relative w-full max-w-4xl bg-card border shadow-sm p-8 md:p-12 overflow-y-auto font-serif text-lg leading-relaxed outline-none [&_img]:max-w-full [&_img]:my-4 [&_img]:rounded-md [&_h1]:text-4xl [&_h1]:font-extrabold [&_h1]:text-foreground [&_h1]:mb-6 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-muted-foreground [&_h2]:mb-4 [&_h2]:mt-8 [&_p]:mb-4 editor-doc h-full print-content"
              contentEditable
              suppressContentEditableWarning
              data-placeholder={t("startWritingYourStory")}
              style={{ emptyCells: "show" }}
              onInput={() => {
                updateToc();
                scrollToCaret();
              }}
              onKeyUp={() => {
                scrollToCaret();
              }}
            ></div>
          </div>
          <style
            dangerouslySetInnerHTML={{
              __html: `
            .editor-doc h1, .editor-doc h2, .editor-doc p { position: relative; min-height: 1.5em; }
            .editor-doc > div:not(.story-inline-canvas-placeholder) { position: relative; min-height: 1.5em; }
            .story-inline-canvas-placeholder, .story-inline-canvas-placeholder * { min-height: 0; box-sizing: border-box; }
            .editor-doc h1 { border-bottom: 2px dashed #e5e7eb; padding-bottom: 0.25rem; margin-bottom: 0.75rem; }
            .editor-doc h2 { border-bottom: 1px dashed #e5e7eb; padding-bottom: 0.25rem; margin-bottom: 1.25rem; }
            .dark .editor-doc h1 { border-bottom-color: rgba(255, 255, 255, 0.2); }
            .dark .editor-doc h2 { border-bottom-color: rgba(255, 255, 255, 0.15); }
            .editor-doc img { page-break-inside: avoid; break-inside: avoid; display: block; margin-left: auto; margin-right: auto; max-width: 100%; }
            .story-inline-canvas-placeholder { display: block; margin-left: auto; margin-right: auto; }
            .editor-doc p { cursor: text; outline: none; margin-bottom: 1rem; }
            .editor-doc h1:empty:before, .editor-doc h1:has(> br:only-child):before { content: '${t("title").replace(/'/g, "\\'")}'; color: #4b5563; pointer-events: none; opacity: 0.5; position: absolute; top: 0; left: 0; }
            .editor-doc h2:empty:before, .editor-doc h2:has(> br:only-child):before { content: '${t("subtitle").replace(/'/g, "\\'")}'; color: #4b5563; pointer-events: none; opacity: 0.5; position: absolute; top: 0; left: 0; }
            .dark .editor-doc h1:empty:before, .dark .editor-doc h1:has(> br:only-child):before,
            .dark .editor-doc h2:empty:before, .dark .editor-doc h2:has(> br:only-child):before { color: #9ca3af; }
            .editor-doc[data-is-empty="true"] p:first-of-type:empty:before,
            .editor-doc[data-is-empty="true"] p:first-of-type:has(> br:only-child):before,
            .editor-doc[data-has-no-text="true"] p:first-of-type:empty:before,
            .editor-doc[data-has-no-text="true"] p:first-of-type:has(> br:only-child):before {
              content: '${t("startWritingYourStory").replace(/'/g, "\\'")}';
              color: #4b5563;
              pointer-events: none;
              opacity: 0.5;
              position: absolute;
              top: 0;
              left: 0;
            }
            .dark .editor-doc[data-is-empty="true"] p:first-of-type:empty:before,
            .dark .editor-doc[data-is-empty="true"] p:first-of-type:has(> br:only-child):before,
            .dark .editor-doc[data-has-no-text="true"] p:first-of-type:empty:before,
            .dark .editor-doc[data-has-no-text="true"] p:first-of-type:has(> br:only-child):before {
              color: #9ca3af;
            }
         `,
            }}
          />
        </main>
        {renderGoogleDriveDialog()}

        {/* In Portrait mode when sidebar is closed, render vertical drawing toolbar */}
        {isDrawingMode && isPortrait && !isSidebarOpen && (
          <div
            data-portrait-drawing-sidebar="true"
            className="absolute top-14 left-2 sm:left-3 z-[45] pointer-events-auto"
          >
            {renderDrawingToolbar(true, true)}
          </div>
        )}

        {/* Inserted Image Label Badges in Story Mode */}
        {!isExporting && activeImageElements.map(({ element, label }) => {
          const rect = element.getBoundingClientRect();
          const editorRect = editorRef.current?.getBoundingClientRect();
          if (!editorRect || rect.width === 0 || rect.height === 0) return null;
          if (rect.bottom < editorRect.top || rect.top > editorRect.bottom) return null;

          return (
            <div
              key={`img-badge-${label}-${element.src}`}
              data-export-ignore="true"
              style={{
                position: "fixed",
                top: Math.max(editorRect.top + 4, rect.top + 4),
                left: rect.left + 4,
                zIndex: 35,
                pointerEvents: "none",
              }}
              className="panel-label-badge select-none bg-black/85 text-white dark:bg-white/90 dark:text-black text-[10px] font-mono font-black px-1.5 py-0.5 rounded shadow-xs border border-white/20 dark:border-black/20 shrink-0 leading-none"
            >
              {label}
            </div>
          );
        })}

        {/* Inline Drawing Canvases Portals for Story Mode */}
        {activeCanvasElements.map(({ id, element, label }, index) => {
          const canvasData = inlineCanvases[id] || (() => {
            const canvasDataStr = element.getAttribute("data-canvas-data");
            if (canvasDataStr) {
              try {
                const parsed = JSON.parse(canvasDataStr);
                if (parsed && parsed.node) return parsed;
              } catch (e) {}
            }
            return { node: { id, type: "panel", drawings: [], imageUrl: "" }, widthPercent: 66.6, backgroundColor: "#ffffff" };
          })();
          const finalLabel = label || element.getAttribute("data-label") || `L${index + 1}`;
          return createPortal(
            <InlineStoryCanvas
              key={id}
              canvasId={id}
              canvasIndex={index}
              canvasLabel={finalLabel}
              node={canvasData.node}
              widthPercent={canvasData.widthPercent}
              drawTool={drawTool}
              penMode={penMode}
              eraserType={eraserType}
              drawColor={drawColor}
              drawRadius={drawRadius}
              touchOff={touchOff}
              setTouchOff={setTouchOff}
              isDrawingMode={isDrawingMode}
              layers={comicLayers}
              activeLayerId={activeLayerId}
              layerGroups={layerGroups}
              backgroundColor={canvasData.backgroundColor || '#ffffff'}
              onSelectCanvas={(e?: React.MouseEvent) => {
                const isCtrl = e ? (e.ctrlKey || e.metaKey) : false;
                if (!isCtrl) {
                  // Deselect any selected images: remove adjust outline and bar
                  setImageMenuProps({ visible: false, top: 0, left: 0, imgElement: null });
                  setSelectedImageElements([]);
                  // Select only this canvas
                  setSelectedCanvasElement(element);
                  setSelectedCanvasElements([element]);
                  if (canvasData.backgroundColor) {
                    setComicBackgroundColor(canvasData.backgroundColor);
                  }
                } else {
                  // Hold Ctrl: select multiple objects
                  setSelectedCanvasElements((prev) => {
                    if (prev.includes(element)) {
                      const next = prev.filter((el) => el !== element);
                      setSelectedCanvasElement(next.length > 0 ? next[next.length - 1] : null);
                      return next;
                    } else {
                      setSelectedCanvasElement(element);
                      return [...prev, element];
                    }
                  });
                }
              }}
              onDeleteCanvas={() => {
                element.remove();
                setInlineCanvases((prev) => {
                  const updated = { ...prev };
                  delete updated[id];
                  pushInlineCanvasesHistory(updated);
                  return updated;
                });
                setSelectedCanvasElement(null);
                setSelectedCanvasElements((prev) => prev.filter((el) => el !== element));
                setTimeout(updateToc, 50);
                toast.success("Drawing canvas deleted");
              }}
              onChange={(updatedNode) => {
                setInlineCanvases((prev) => {
                  const updated = {
                    ...prev,
                    [id]: { ...prev[id], node: updatedNode }
                  };
                  element.setAttribute("data-canvas-data", JSON.stringify(updated[id]));
                  pushInlineCanvasesHistory(updated);
                  return updated;
                });
                setTimeout(updateToc, 50);
              }}
              onWidthChange={(newWidth) => {
                setInlineCanvases((prev) => {
                  const updated = {
                    ...prev,
                    [id]: { ...prev[id], widthPercent: newWidth }
                  };
                  element.setAttribute("data-canvas-data", JSON.stringify(updated[id]));
                  element.style.width = `${newWidth}%`;
                  pushInlineCanvasesHistory(updated);
                  return updated;
                });
              }}
            />,
            element
          );
        })}
      </div>
    );
  }

  function renderDrawingToolbar(isVertical: boolean = false, disableBubblePen: boolean = false) {
    return (
      <div
        data-draw-toolbar="true"
        className={cn(
          "shrink-0",
          isVertical
            ? "w-9 p-1 flex flex-col items-center justify-center gap-1 bg-background/95 backdrop-blur-md border border-border/80 shadow-2xl rounded-2xl z-[45]"
            : "flex items-center justify-center gap-0.5 max-h-[34px]"
        )}
      >
        {/* Collapsible Pen Tool with Normal Pen, Smart Shape, and Freehand Bubble Modes */}
        <div ref={penMenuRef} className="relative flex items-center justify-center">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "w-7 h-7 rounded-full relative transition-all",
              isPenMenuOpen && "ring-2 ring-primary/40"
            )}
            onClick={() => {
              setDrawTool("pen");
              setIsPenMenuOpen((prev) => !prev);
            }}
            title={
              penMode === "smartShape"
                ? `${t("penTooltip") || "Pen"}: ${t("smartShape") || "Smart Shape"} - ${t("smartShapeDesc") || "Auto-snaps lines, circles, boxes, triangles"}`
                : penMode === "freehandBubble" && !disableBubblePen
                ? `${t("penTooltip") || "Pen"}: ${t("freehandBubble") || "Freehand Speech Bubble"} - ${t("freehandBubbleDesc") || "Converts closed loop into editable bubble"}`
                : `${t("penTooltip") || "Pen"}: ${t("normalPen") || "Normal Pen"} - ${t("normalPenDesc") || "Standard freehand stroke"}`
            }
          >
            {penMode === "smartShape" ? (
              <Shapes className="w-3.5 h-3.5 text-indigo-500" />
            ) : penMode === "freehandBubble" && !disableBubblePen ? (
              <MessageSquare className="w-3.5 h-3.5 text-amber-500" />
            ) : (
              <PenTool className="w-3.5 h-3.5" />
            )}
            {drawTool === "pen" && (
              <span
                className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-background shadow-xs pointer-events-none"
                title="Active Tool"
              />
            )}
          </Button>

          {/* Sub-menu displaying the Pen Modes */}
          {isPenMenuOpen && (
            <div
              className={cn(
                "p-1.5 bg-popover/95 backdrop-blur-md border border-border shadow-2xl rounded-xl flex flex-col gap-1 min-w-[210px] duration-150 z-[110]",
                isVertical
                  ? "absolute left-full top-0 ml-2 animate-in fade-in slide-in-from-left-2"
                  : "absolute top-full left-1/2 -translate-x-1/2 mt-2 animate-in fade-in slide-in-from-top-2"
              )}
            >
              <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase px-2 py-1 flex items-center justify-between border-b border-border/40 pb-1">
                <span>{t("penMode") || "Pen Mode"}</span>
                <span className="text-[9px] font-normal lowercase opacity-70">{t("tapToSelect") || "tap to select"}</span>
              </div>

              {/* Mode 1: Normal Pen */}
              <button
                type="button"
                onClick={() => {
                  setPenMode("normal");
                  setDrawTool("pen");
                  setIsPenMenuOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer",
                  penMode === "normal"
                    ? "bg-primary/10 text-primary font-medium"
                    : "hover:bg-muted text-foreground"
                )}
              >
                <div
                  className={cn(
                    "w-6 h-6 rounded-md flex items-center justify-center shrink-0 border",
                    penMode === "normal"
                      ? "bg-primary/15 border-primary/30 text-primary"
                      : "bg-muted/50 border-border/50 text-muted-foreground"
                  )}
                >
                  <PenTool className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs leading-none">{t("normalPen") || "Normal Pen"}</span>
                    {penMode === "normal" && (
                      <Check className="w-3.5 h-3.5 text-primary shrink-0 ml-1" />
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    {t("normalPenDesc") || "Standard freehand stroke"}
                  </span>
                </div>
              </button>

              {/* Mode 2: Smart Shape */}
              <button
                type="button"
                onClick={() => {
                  setPenMode("smartShape");
                  setDrawTool("pen");
                  setIsPenMenuOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer",
                  penMode === "smartShape"
                    ? "bg-primary/10 text-primary font-medium"
                    : "hover:bg-muted text-foreground"
                )}
              >
                <div
                  className={cn(
                    "w-6 h-6 rounded-md flex items-center justify-center shrink-0 border",
                    penMode === "smartShape"
                      ? "bg-primary/15 border-primary/30 text-indigo-500"
                      : "bg-muted/50 border-border/50 text-muted-foreground"
                  )}
                >
                  <Shapes className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs leading-none">{t("smartShape") || "Smart Shape"}</span>
                    {penMode === "smartShape" && (
                      <Check className="w-3.5 h-3.5 text-primary shrink-0 ml-1" />
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    {t("smartShapeDesc") || "Auto-snaps lines, circles, boxes, triangles"}
                  </span>
                </div>
              </button>

              {/* Mode 3: Freehand Speech Bubble (hidden when disableBubblePen is true) */}
              {!disableBubblePen && (
                <button
                  type="button"
                  onClick={() => {
                    setPenMode("freehandBubble");
                    setDrawTool("pen");
                    setIsPenMenuOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer",
                    penMode === "freehandBubble"
                      ? "bg-primary/10 text-primary font-medium"
                      : "hover:bg-muted text-foreground"
                  )}
                >
                  <div
                    className={cn(
                      "w-6 h-6 rounded-md flex items-center justify-center shrink-0 border",
                      penMode === "freehandBubble"
                        ? "bg-primary/15 border-primary/30 text-amber-500"
                        : "bg-muted/50 border-border/50 text-muted-foreground"
                    )}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs leading-none">{t("freehandBubble") || "Freehand Bubble"}</span>
                      {penMode === "freehandBubble" && (
                        <Check className="w-3.5 h-3.5 text-primary shrink-0 ml-1" />
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                      {t("freehandBubbleDesc") || "Converts closed loop into editable bubble"}
                    </span>
                  </div>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Foldable Eraser Tool with Stroke and Pixel Options */}
        <div ref={eraserMenuRef} className="relative flex items-center justify-center">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "w-7 h-7 rounded-full relative transition-all",
              isEraserMenuOpen && "ring-2 ring-primary/40"
            )}
            onClick={() => {
              setDrawTool("erase");
              setIsEraserMenuOpen((prev) => !prev);
            }}
            title={
              eraserType === "pixel"
                ? `${t("eraseTooltip") || "Eraser"}: ${t("pixelEraser") || "Pixel"} (${drawRadius}px)`
                : `${t("eraseTooltip") || "Eraser"}: ${t("strokeEraser") || "Stroke"}`
            }
          >
            <Eraser className="w-3.5 h-3.5" />
            {drawTool === "erase" && (
              <span
                className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-background shadow-xs pointer-events-none"
                title="Active Tool"
              />
            )}
          </Button>

          {/* Foldable eraser mode dropdown menu */}
          {isEraserMenuOpen && (
            <div
              className={cn(
                "p-1.5 bg-popover/95 backdrop-blur-md border border-border shadow-2xl rounded-xl flex flex-col gap-1 min-w-[190px] duration-150 z-[110]",
                isVertical
                  ? "absolute left-full top-0 ml-2 animate-in fade-in slide-in-from-left-2"
                  : "absolute top-full left-1/2 -translate-x-1/2 mt-2 animate-in fade-in slide-in-from-top-2"
              )}
            >
              <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase px-2 py-1 flex items-center justify-between border-b border-border/40 pb-1">
                <span>{t("eraserMode") || "Eraser Mode"}</span>
                <span className="text-[9px] font-normal lowercase opacity-70">{t("tapToChoose") || "tap to choose"}</span>
              </div>

              {/* Option 1: Pixel Eraser (by brush size) */}
              <button
                type="button"
                onClick={() => {
                  setEraserType("pixel");
                  setDrawTool("erase");
                  setIsEraserMenuOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer",
                  eraserType === "pixel"
                    ? "bg-primary/10 text-primary font-medium"
                    : "hover:bg-muted text-foreground"
                )}
              >
                <div
                  className={cn(
                    "w-6 h-6 rounded-md flex items-center justify-center shrink-0 border",
                    eraserType === "pixel"
                      ? "bg-primary/15 border-primary/30 text-primary"
                      : "bg-muted/50 border-border/50 text-muted-foreground"
                  )}
                >
                  <Eraser className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs leading-none">{t("pixelEraser") || "Pixel"}</span>
                    {eraserType === "pixel" && (
                      <Check className="w-3.5 h-3.5 text-primary shrink-0 ml-1" />
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    {t("pixelEraserDesc", { size: drawRadius }) || `By brush size (${drawRadius}px)`}
                  </span>
                </div>
              </button>

              {/* Option 2: Stroke Eraser */}
              <button
                type="button"
                onClick={() => {
                  setEraserType("stroke");
                  setDrawTool("erase");
                  setIsEraserMenuOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer",
                  eraserType === "stroke"
                    ? "bg-primary/10 text-primary font-medium"
                    : "hover:bg-muted text-foreground"
                )}
              >
                <div
                  className={cn(
                    "w-6 h-6 rounded-md flex items-center justify-center shrink-0 border",
                    eraserType === "stroke"
                      ? "bg-primary/15 border-primary/30 text-primary"
                      : "bg-muted/50 border-border/50 text-muted-foreground"
                  )}
                >
                  <Scissors className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs leading-none">{t("strokeEraser") || "Stroke"}</span>
                    {eraserType === "stroke" && (
                      <Check className="w-3.5 h-3.5 text-primary shrink-0 ml-1" />
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    {t("strokeEraserDesc") || "Erase whole line / object"}
                  </span>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Fill Tool */}
        <Button
          variant="ghost"
          size="icon"
          className="w-7 h-7 rounded-full relative transition-all"
          onClick={() => setDrawTool("fill")}
          title={t("fillTooltip") || "Fill (F)"}
        >
          <PaintBucket className="w-3.5 h-3.5" />
          {drawTool === "fill" && (
            <span
              className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-background shadow-xs pointer-events-none"
              title="Active Tool"
            />
          )}
        </Button>

        {/* Foldable Lasso Tool with Copy, Cut, Paste, Delete Actions placed underneath like pen and eraser tool */}
        <div ref={lassoMenuRef} className="relative flex items-center justify-center">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "w-7 h-7 rounded-full relative transition-all",
              isLassoMenuOpen && "ring-2 ring-primary/40"
            )}
            onClick={() => {
              setDrawTool("select");
              setIsLassoMenuOpen((prev) => !prev);
            }}
            title={t("lassoTooltip") || "Lasso (L)"}
          >
            <LassoSelect className="w-3.5 h-3.5" />
            {drawTool === "select" && (
              <span
                className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-background shadow-xs pointer-events-none"
                title="Active Tool"
              />
            )}
          </Button>

          {/* Foldable lasso action dropdown menu underneath */}
          {isLassoMenuOpen && (
            <div
              className={cn(
                "p-1.5 bg-popover/95 backdrop-blur-md border border-border shadow-2xl rounded-xl flex flex-col gap-1 min-w-[200px] duration-150 z-[110]",
                isVertical
                  ? "absolute left-full top-0 ml-2 animate-in fade-in slide-in-from-left-2"
                  : "absolute top-full left-1/2 -translate-x-1/2 mt-2 animate-in fade-in slide-in-from-top-2"
              )}
            >
              <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase px-2 py-1 flex items-center justify-between border-b border-border/40 pb-1">
                <span>{t("lassoActions") || "Lasso Actions"}</span>
                <span className="text-[9px] font-normal lowercase opacity-70">{t("tapAction") || "tap action"}</span>
              </div>

              {/* Action 1: Copy */}
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("comic-lasso-action", {
                      detail: { action: "copy" },
                    })
                  );
                  setIsLassoMenuOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-xs hover:bg-muted text-foreground transition-colors cursor-pointer"
              >
                <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 border bg-muted/50 border-border/50 text-primary">
                  <Copy className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs leading-none">{t("copy") || "Copy"}</span>
                    <span className="text-[9px] font-mono text-muted-foreground">Ctrl+C</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    {t("copyStrokes") || "Copy selected strokes"}
                  </span>
                </div>
              </button>

              {/* Action 2: Cut */}
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("comic-lasso-action", {
                      detail: { action: "cut" },
                    })
                  );
                  setIsLassoMenuOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-xs hover:bg-muted text-foreground transition-colors cursor-pointer"
              >
                <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 border bg-muted/50 border-border/50 text-amber-500">
                  <Scissors className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs leading-none">{t("cut") || "Cut"}</span>
                    <span className="text-[9px] font-mono text-muted-foreground">Ctrl+X</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    {t("cutStrokes") || "Cut selected strokes"}
                  </span>
                </div>
              </button>

              {/* Action 3: Paste */}
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("comic-lasso-action", {
                      detail: { action: "paste" },
                    })
                  );
                  setIsLassoMenuOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-xs hover:bg-muted text-foreground transition-colors cursor-pointer"
              >
                <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 border bg-muted/50 border-border/50 text-emerald-500">
                  <Clipboard className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs leading-none">{t("paste") || "Paste"}</span>
                    <span className="text-[9px] font-mono text-muted-foreground">Ctrl+V</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    {t("pasteStrokes") || "Paste strokes into panel"}
                  </span>
                </div>
              </button>

              {/* Action 4: Delete */}
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("comic-lasso-action", {
                      detail: { action: "delete" },
                    })
                  );
                  setIsLassoMenuOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-xs hover:bg-destructive/10 text-destructive transition-colors cursor-pointer"
              >
                <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 border bg-destructive/10 border-destructive/20 text-destructive">
                  <Trash2 className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs leading-none text-destructive">{t("delete") || "Delete"}</span>
                    <span className="text-[9px] font-mono text-destructive/70">Del / Backspace</span>
                  </div>
                  <span className="text-[10px] text-destructive/70 mt-0.5 leading-tight">
                    {t("deleteStrokesOnly") || "Delete selected stroke(s) only"}
                  </span>
                </div>
              </button>
            </div>
          )}
        </div>

        {isVertical ? (
          <div className="w-5 h-px bg-border my-0.5" />
        ) : (
          <div className="w-px h-4 bg-border mx-1 shrink-0" />
        )}

        {/* Touch Off toggle */}
        <Button
          variant={touchOff ? "secondary" : "ghost"}
          size="icon"
          className={cn(
            "w-7 h-7 rounded-full transition-all",
            touchOff &&
              "bg-amber-100 text-amber-800 hover:bg-amber-200 hover:text-amber-900 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
          )}
          onClick={() => setTouchOff(!touchOff)}
          title={touchOff ? (t("touchOffTooltip") || "Touch Off (Pen only, Palm rejection active)") : (t("touchOnTooltip") || "Touch On (Finger drawing enabled)")}
        >
          <Hand className="w-3.5 h-3.5" />
        </Button>

        {isVertical ? (
          <div className="w-5 h-px bg-border my-0.5" />
        ) : (
          <div className="w-px h-4 bg-border mx-1 shrink-0" />
        )}

        {/* Color Picker */}
        <div className="w-7 h-7 relative flex items-center justify-center">
          <button
            type="button"
            onClick={() => drawColorInputRef.current?.click()}
            className="w-5 h-5 rounded-full color-circle-button cursor-pointer shadow-xs hover:scale-105 transition-transform shrink-0 border border-black/50 dark:border-white/50"
            style={{ backgroundColor: drawColor, borderRadius: "9999px" }}
            title={t("colorTooltip") || "Color"}
          />
          <input
            ref={drawColorInputRef}
            type="color"
            value={drawColor}
            onChange={(e) => setDrawColor(e.target.value)}
            className="sr-only pointer-events-none"
            tabIndex={-1}
          />
        </div>

        {isVertical ? (
          <div className="w-5 h-px bg-border my-0.5" />
        ) : (
          <div className="w-px h-4 bg-border mx-1 shrink-0" />
        )}

        {/* Foldable Brush Size Input with Downward Arrow Beside and Dropdown */}
        <div ref={brushSizePickerRef} className="relative flex items-center justify-center">
          {isVertical ? (
            <button
              type="button"
              onClick={() => setIsBrushSizePickerOpen((prev) => !prev)}
              className={cn(
                "w-7 h-7 rounded-full border border-border/60 bg-background hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center text-xs font-mono font-bold transition-colors cursor-pointer",
                isBrushSizePickerOpen && "bg-muted text-foreground ring-1 ring-primary/60"
              )}
              title={`${t("brushSizeTooltip") || "Brush Size"}: ${drawRadius}px`}
            >
              <span className="text-[10px] font-mono leading-none">{drawRadius}</span>
            </button>
          ) : (
            <>
              <input
                type="text"
                inputMode="decimal"
                value={brushSizeInput}
                onChange={(e) => {
                  const valStr = e.target.value;
                  if (valStr === "" || /^[0-9]*\.?[0-9]*$/.test(valStr)) {
                    setBrushSizeInput(valStr);
                    const num = parseFloat(valStr);
                    if (!isNaN(num) && num > 0) {
                      setDrawRadius(num);
                    }
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                    setIsBrushSizePickerOpen(false);
                  }
                }}
                onBlur={() => {
                  const num = parseFloat(brushSizeInput);
                  if (!isNaN(num) && num >= 0.1) {
                    setDrawRadius(num);
                    setBrushSizeInput(String(num));
                  } else {
                    setDrawRadius(1);
                    setBrushSizeInput("1");
                  }
                }}
                className="w-10 h-6 text-xs text-center border border-border/60 rounded-l bg-background focus:outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none font-mono font-medium px-0.5"
                title={t("brushSizeTooltip") || "Brush Size"}
                placeholder="px"
              />
              <button
                type="button"
                onClick={() => setIsBrushSizePickerOpen((prev) => !prev)}
                className={cn(
                  "h-6 px-1 border border-l-0 border-border/60 rounded-r bg-background hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer",
                  isBrushSizePickerOpen && "bg-muted text-foreground"
                )}
                title={t("toggleSizePresets") || "Toggle brush size presets"}
              >
                <ChevronDown
                  className={cn(
                    "w-3 h-3 transition-transform duration-200",
                    isBrushSizePickerOpen && "rotate-180"
                  )}
                />
              </button>
            </>
          )}

          {/* Foldable brush size picker */}
          {isBrushSizePickerOpen && (
            <div
              className={cn(
                "p-2 bg-popover/95 backdrop-blur-md border border-border shadow-2xl rounded-2xl flex flex-col gap-2 min-w-[150px] duration-150 z-[99999]",
                isVertical
                  ? "absolute left-full top-0 ml-2 animate-in fade-in slide-in-from-left-2"
                  : "absolute top-full left-0 mt-2 animate-in fade-in slide-in-from-top-2"
              )}
            >
              <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase px-1">
                {t("sizePresets") || "Size Presets"}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { size: 0.5, px: 2 },
                  { size: 1, px: 3 },
                  { size: 1.8, px: 5 },
                  { size: 2.8, px: 7 },
                  { size: 4, px: 9 },
                  { size: 5.5, px: 11 },
                  { size: 7, px: 13 },
                  { size: 10, px: 15 },
                  { size: 15, px: 17 },
                ].map(({ size, px }) => {
                  const isSelected = drawRadius === size;
                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={() => {
                        setDrawRadius(size);
                        setBrushSizeInput(String(size));
                        setIsBrushSizePickerOpen(false);
                      }}
                      title={`${size}px`}
                      className={cn(
                        "h-10 rounded flex flex-col items-center justify-center gap-1 transition-all p-1 cursor-pointer",
                        isSelected
                          ? "bg-primary/20 text-primary ring-1 ring-primary/60 dark:bg-primary/30 font-bold"
                          : "hover:bg-muted text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <div className="w-5 h-5 flex items-center justify-center">
                        <span
                          className={cn(
                            "rounded-full brush-circle-dot transition-transform shrink-0",
                            isSelected ? "bg-primary scale-110" : "bg-foreground"
                          )}
                          style={{
                            width: `${px}px`,
                            height: `${px}px`,
                            borderRadius: "9999px",
                          }}
                        />
                      </div>
                      <span className="text-[9px] font-mono leading-none">{size}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {isVertical ? (
          <div className="w-5 h-px bg-border my-0.5" />
        ) : (
          <div className="w-px h-4 bg-border mx-1 shrink-0" />
        )}

        {/* Foldable Layer Button on Drawing Toolbar */}
        <div ref={layerPanelRef} className="relative flex items-center justify-center">
          {isVertical ? (
            <button
              type="button"
              onClick={() => setIsLayerPanelOpen((prev) => !prev)}
              className={cn(
                "w-7 h-7 rounded-full border border-border/60 bg-background hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer",
                isLayerPanelOpen && "bg-muted text-foreground ring-1 ring-primary/60"
              )}
              title={t("layersTooltip") || "Layers"}
            >
              <Layers className="w-3.5 h-3.5 text-foreground" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsLayerPanelOpen((prev) => !prev)}
              className={cn(
                "h-6 px-2 border border-border/60 rounded bg-background flex items-center gap-1.5 text-xs font-mono font-medium transition-colors cursor-pointer",
                isLayerPanelOpen
                  ? "bg-muted text-foreground ring-1 ring-primary/60"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              )}
              title={t("layersTooltip") || "Layers (Ctrl+J: New, Ctrl+E: Combine, Ctrl+G: Group)"}
            >
              <Layers className="w-3.5 h-3.5 text-foreground" />
              <span className="text-xs font-mono leading-none text-foreground">
                {comicLayers.filter((l) => !l.isBackground).length}
              </span>
              <ChevronDown
                className={cn(
                  "w-3 h-3 text-muted-foreground transition-transform duration-200",
                  isLayerPanelOpen && "rotate-180 text-foreground"
                )}
              />
            </button>
          )}

          {/* Foldable Layers Panel Dropdown */}
          {isLayerPanelOpen && (
            <div
              className={cn(
                "z-[99999]",
                isVertical
                  ? "absolute left-full top-0 ml-2"
                  : "absolute top-full left-0 sm:left-auto sm:right-0 mt-2"
              )}
            >
              <LayerManagerUI
                layers={comicLayers}
                activeLayerId={activeLayerId}
                selectedLayerIds={selectedLayerIds}
                layerGroups={layerGroups}
                isOpen={isLayerPanelOpen}
                onClose={() => setIsLayerPanelOpen(false)}
                onSelectLayer={handleSelectLayer}
                onAddLayer={handleAddLayer}
                onCombineLayers={handleCombineLayers}
                onGroupLayers={handleGroupLayers}
                onDeleteLayer={handleDeleteLayer}
                onToggleVisibility={handleToggleLayerVisibility}
                onToggleGroupVisibility={handleToggleGroupVisibility}
                onToggleGroupCollapse={handleToggleGroupCollapse}
                onUpdateLayer={handleUpdateLayer}
                onUpdateGroup={handleUpdateGroup}
                onReorderLayers={handleReorderLayers}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-background flex flex-col overflow-hidden h-full min-h-0">
      <header className="sticky top-0 z-[150] w-full border-b bg-background/80 backdrop-blur-md shrink-0 overflow-visible">
        <div className="w-full px-2 h-11 flex items-center justify-between gap-2 relative overflow-visible">
          {/* Left Actions */}
          <div className="flex items-center gap-0.5 overflow-visible py-1 shrink-0 z-20 relative">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="h-8 px-2 font-mono font-black text-xs bg-transparent text-primary border-none shadow-none hover:bg-transparent shrink-0 select-none hover:scale-105 active:scale-95 transition-all"
              title={isSidebarOpen ? (t("hideSidebar") || "Hide Sidebar") : (t("showSidebar") || "Show Sidebar")}
            >
              P{activePageIndex + 1}
            </Button>
            <div className="w-px h-5 bg-border mx-1 shrink-0" />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCreateMode("select")}
              className="w-8 h-8 shrink-0"
              title={t("back") || "Back"}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            {createMode === "comic" && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleUndoComic}
                  disabled={!canUndoComic}
                  className="w-8 h-8 shrink-0 disabled:opacity-35"
                  title={t("undo") || "Undo (Ctrl+Z)"}
                >
                  <Undo2 className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleRedoComic}
                  disabled={!canRedoComic}
                  className="w-8 h-8 shrink-0 disabled:opacity-35"
                  title={t("redo") || "Redo (Ctrl+Y / Ctrl+Shift+Z)"}
                >
                  <Redo2 className="w-4 h-4" />
                </Button>
              </>
            )}
            <div className="w-px h-5 bg-border mx-1 shrink-0" />
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant={isTextPanelSelectMode ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  const val = !isTextPanelSelectMode;
                  setIsTextPanelSelectMode(val);
                  if (val) {
                    setIsDrawingMode(false);
                    toast.info("Click panel label to switch between Image and Text panel");
                  }
                }}
                className={`gap-1 px-2 text-xs font-semibold ${isTextPanelSelectMode ? "bg-primary/20 text-primary hover:bg-primary/30" : "text-muted-foreground hover:text-foreground"}`}
                title="Toggle Text/Image Panel"
              >
                {isTextPanelSelectMode ? (
                  <>
                    <span className="w-4 h-4 inline-flex items-center justify-center font-bold text-sm">A</span>{" "}
                    <span className="hidden sm:inline">Image Panel</span>
                  </>
                ) : (
                  <>
                    <span className="w-4 h-4 inline-flex items-center justify-center font-bold text-sm">T</span>{" "}
                    <span className="hidden sm:inline">Text Panel</span>
                  </>
                )}
              </Button>
              <Button
                variant={isDrawingMode ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  const val = !isDrawingMode;
                  setIsDrawingMode(val);
                  if (val) setDrawTool("pen");
                  setIsTextPanelSelectMode(false);
                }}
                className={`gap-1 px-2 text-xs font-semibold ${isDrawingMode ? "bg-primary/20 text-primary hover:bg-primary/30" : "text-muted-foreground hover:text-foreground"}`}
                title={t("drawModeTooltip") || "Draw Mode (Hotkey: D)"}
              >
                <PenTool className="w-4 h-4" />{" "}
                <span className="hidden sm:inline">{t("draw") || "Draw"}</span>
              </Button>
            </div>

            {/* In Landscape mode, render drawing toolbar in header */}
            {isDrawingMode && !isPortrait && (
              <>
                <div className="w-px h-5 bg-border mx-1 shrink-0" />
                {renderDrawingToolbar(false)}
              </>
            )}
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-2 pr-2 shrink-0 z-20 relative ml-auto">
            {renderExportMenu()}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsBubbleSidebarOpen(!isBubbleSidebarOpen)}
              className="gap-2 shrink-0 h-8 text-xs font-semibold"
              title={t("bubbles") || "Bubbles"}
            >
              <MessageSquare className="w-3.5 h-3.5" />{" "}
              <span className="hidden sm:inline">{t("bubbles") || "Bubbles"}</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 relative w-full overflow-hidden flex bg-background">
        {/* In Portrait mode when sidebar is closed, render vertical drawing toolbar */}
        {isDrawingMode && createMode === "comic" && isPortrait && !isSidebarOpen && (
          <div
            data-portrait-drawing-sidebar="true"
            className="absolute top-3 left-2 sm:left-3 z-[45] pointer-events-auto"
          >
            {renderDrawingToolbar(true)}
          </div>
        )}
        <AIGeneratorDialog
          open={isAIGeneratorOpen}
          onOpenChange={setIsAIGeneratorOpen}
          onGeneratorSuccess={(imageUrl) => {
            const { tree, updated } = fillFirstEmptyPanel(comicTree, imageUrl);
            if (updated) {
              updateActivePageTree(tree);
              toast.success("Image added to comic panel!");
            } else {
              toast.error(
                "No empty panels available on the current page to insert the image.",
              );
            }
          }}
        />
        <AIFullComicDialog
          open={isAIFullComicDialogOpen}
          onOpenChange={setIsAIFullComicDialogOpen}
          onComicGenerated={handleFullComicGenerated}
          initialPrompt={aiFullComicPrompt}
          autoSubmit={true}
        />
        <AIFullStoryDialog
          open={isAIFullStoryDialogOpen}
          onOpenChange={setIsAIFullStoryDialogOpen}
          initialPrompt={aiFullStoryPrompt}
          autoSubmit={true}
          onStoryGenerated={(htmlContent) => {
            setIsAIFullStoryDialogOpen(false);
            if (editorRef.current) {
              editorRef.current.innerHTML = htmlContent;
              toast.success("Story generated successfully!");
            }
          }}
        />
        <AnimatePresence initial={false}>
          {isSidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-30 bg-black/5"
                onClick={() => setIsSidebarOpen(false)}
              />
              <motion.aside
                initial={{ x: -200, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -200, opacity: 0 }}
                transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                className="absolute top-0 left-0 bottom-0 z-40 w-[180px] sm:w-[200px] border-r bg-background/95 backdrop-blur-md shadow-2xl flex flex-col overflow-visible shrink-0"
              >
                {/* Left Sidebar Header with Comic Title and Page Controls */}
                <div className="p-2.5 border-b shrink-0 flex flex-col gap-2 bg-muted/20">
                  <div className="flex items-center gap-1.5 w-full bg-background border border-border/70 rounded-md px-2 py-1 shadow-xs focus-within:ring-1 focus-within:ring-primary focus-within:border-primary transition-all">
                    <BookOpen className="w-3.5 h-3.5 text-primary shrink-0" />
                    <input
                      value={comicTitle}
                      onChange={(e) => {
                        setComicTitle(e.target.value);
                        isPublishedComicRef.current = false;
                      }}
                      className="bg-transparent border-none text-foreground font-bold text-xs focus:outline-none w-full truncate"
                      placeholder={t("comicTitlePlaceholder") || "Comic Title"}
                      title={comicTitle || t("comicTitlePlaceholder")}
                    />
                  </div>
                  <div className="flex items-center justify-between px-0.5">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("pages")} ({comicPages.length})
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 rounded-md hover:bg-muted"
                      onClick={handleAddNewPage}
                      title={`${t("addPage")} (N)`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar py-2 space-y-2 p-2">
                  {comicPages.map((page, idx) => (
                    <div
                      key={page.id}
                      onClick={() => setActivePageIndex(idx)}
                      className={cn(
                        "group relative aspect-[3/4] w-full rounded-md border overflow-hidden cursor-pointer bg-white transition-all shadow-xs",
                        activePageIndex === idx 
                          ? "border-primary ring-2 ring-primary/40 shadow-sm" 
                          : "border-border hover:border-primary/50 opacity-90 hover:opacity-100"
                      )}
                    >
                      {/* Mini Page Grid Thumbnail */}
                      <div className="absolute inset-0 bg-white flex items-center justify-center p-[2px] pointer-events-none overflow-hidden select-none">
                        <ComicTreeNodeView node={page.tree} />
                      </div>

                      {/* Page Index Badge */}
                      <div className="absolute inset-x-0 bottom-0 p-1.5 pointer-events-none flex items-center justify-between z-10 bg-transparent">
                        <span className="text-[10px] font-extrabold text-foreground dark:text-white drop-shadow-md font-mono bg-transparent">
                          P{idx + 1}
                        </span>
                        {Array.isArray(page.bubbles) && page.bubbles.length > 0 && (
                          <span className="text-[8px] bg-transparent text-foreground dark:text-white drop-shadow-sm px-1 py-0.2 font-medium">
                            {page.bubbles.length} 💬
                          </span>
                        )}
                      </div>

                      {comicPages.length > 1 && (
                        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                          <Button
                            variant="destructive"
                            size="icon"
                            className="w-5 h-5 rounded-full shadow-md"
                            title={`${t("delete") || "Delete"} (Delete)`}
                            onClick={(e) => {
                              e.stopPropagation();
                              const newPages = comicPages.filter(
                                (_, i) => i !== idx,
                              );
                              setComicPages(newPages);
                              if (activePageIndex >= newPages.length)
                                setActivePageIndex(
                                  Math.max(0, newPages.length - 1),
                                );
                            }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Vertical drawing toolbar positioned relative to the right side of the left sidebar */}
                {isDrawingMode && createMode === "comic" && isPortrait && (
                  <div
                    data-portrait-drawing-sidebar="true"
                    className="absolute top-3 left-full ml-2.5 z-50 pointer-events-auto shrink-0"
                  >
                    {renderDrawingToolbar(true)}
                  </div>
                )}
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <div className="flex-1 w-full min-h-0 relative h-full flex flex-col lg:flex-row bg-background overflow-hidden">
          {/* Main Canvas Area */}
          <div
            ref={comicWorkspaceRef}
            className="flex-1 relative h-full flex justify-center items-center p-0 min-w-0 min-h-0 bg-background/50 overflow-hidden"
          >
            <div
              className={cn(
                "relative flex justify-center items-center transition-all duration-300",
                isComicPanelExpanded
                  ? "w-full h-full"
                  : "max-h-full max-w-full inline-flex h-full"
              )}
            >
              {!isComicPanelExpanded && (
                <svg
                  viewBox="0 0 3 4"
                  className="block h-full max-w-full max-h-full w-auto opacity-0 pointer-events-none"
                />
              )}
              <div
                ref={comicRef}
                data-comic-container="true"
                style={{ backgroundColor: comicBackgroundColor }}
                className={cn(
                  "w-full h-full overflow-hidden",
                  isComicPanelExpanded
                    ? "relative flex items-center justify-center"
                    : "absolute top-0 left-0 ring-1 ring-border shadow-2xl"
                )}
              >
                <ComicCanvas
                  key={`comic-page-${activePage.id || activePageIndex}`}
                  tree={comicTree}
                  onChange={updateActivePageTree}
                  isDrawingMode={isDrawingMode}
                  drawTool={drawTool}
                  penMode={penMode}
                  eraserType={eraserType}
                  drawColor={drawColor}
                  drawRadius={drawRadius}
                  touchOff={touchOff}
                  setTouchOff={setTouchOff}
                  onExpandedChange={setIsComicPanelExpanded}
                  layers={comicLayers}
                  activeLayerId={activeLayerId}
                  selectedLayerIds={selectedLayerIds}
                  layerGroups={layerGroups}
                  backgroundColor={comicBackgroundColor}
                  bubbles={bubbles}
                  onConvertFreehandBubble={handleConvertStrokeToBubble}
                  isTextPanelSelectMode={isTextPanelSelectMode}
                />

                {/* Bubble overlays layer - ALWAYS on the top, regardless of whether draw is active or not */}
                {!isComicPanelExpanded && (
                  <div
                    className="absolute inset-0 pointer-events-none z-[70] overflow-visible"
                    data-bubbles-layer="true"
                  >
                    {bubbles.map((b, bIdx) => (
                      <div
                        key={b.id}
                        data-bubble-id={b.id}
                        style={{ left: `${b.x}%`, top: `${b.y}%` }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveBubbleId(b.id);
                          setNewBubbleText(b.text);
                          setBubbleStyle(b.style);
                        }}
                        className={`bubble-overlay pointer-events-auto absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer select-none touch-none ${
                          activeBubbleId === b.id
                            ? b.style === "freehand"
                              ? "ring-2 ring-dashed ring-slate-400 ring-offset-2 rounded-[30%] z-[80]"
                              : "ring-2 ring-primary ring-offset-2 z-[80]"
                            : "z-[70]"
                        }`}
                      >
                        {/* Speech Bubble Label B+number placed on left-top of bubble */}
                        <div className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 z-[100] pointer-events-none select-none bg-blue-600 hover:bg-blue-700 text-white text-[9px] font-mono font-black px-1 py-0.2 rounded shadow-sm border border-white/30" title={`Bubble B${bIdx + 1}`}>
                          B{bIdx + 1}
                        </div>
                        <InteractiveBubble
                          bubble={b}
                          isActive={activeBubbleId === b.id}
                          onUpdateTail={(tailX, tailY) => updateBubbleTail(b.id, tailX, tailY)}
                          onUpdateText={(text) => {
                            setNewBubbleText(text);
                            updateBubbleText(b.id, text);
                          }}
                          removeBubble={() => removeBubble(b.id)}
                          onActivate={() => {
                            setActiveBubbleId(b.id);
                            setNewBubbleText(b.text);
                            setBubbleStyle(b.style);
                          }}
                        />

                        {/* Little Red Drag Handle with Red Cross Arrow Icon when active */}
                        {activeBubbleId === b.id && (
                          <div
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              removeBubble(b.id);
                            }}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              setActiveBubbleId(b.id);
                              setNewBubbleText(b.text);
                              setBubbleStyle(b.style);

                              const target = e.currentTarget as HTMLElement;
                              const now = Date.now();
                              if ((target as any)._lastHandleClick && now - (target as any)._lastHandleClick < 350) {
                                e.preventDefault();
                                removeBubble(b.id);
                                return;
                              }
                              (target as any)._lastHandleClick = now;

                              const overlay = target.parentElement!;
                              const parentOfOverlay = overlay.parentElement!; // bubbles layer container
                              
                              let initialX = e.clientX;
                              let initialY = e.clientY;
                              let startLeft = b.x;
                              let startTop = b.y;

                              const onPointerMove = (ev: PointerEvent) => {
                                const rect = (parentOfOverlay.closest('[data-comic-container="true"]') || parentOfOverlay).getBoundingClientRect();
                                const dX = ((ev.clientX - initialX) / rect.width) * 100;
                                const dY = ((ev.clientY - initialY) / rect.height) * 100;
                                updateActivePageBubbles(
                                  bubbles.map((bubble) =>
                                    bubble.id === b.id
                                      ? {
                                          ...bubble,
                                          x: Math.max(0, Math.min(100, startLeft + dX)),
                                          y: Math.max(0, Math.min(100, startTop + dY)),
                                        }
                                      : bubble,
                                  ),
                                );
                              };

                              const onPointerUp = (ev: PointerEvent) => {
                                target.releasePointerCapture(ev.pointerId);
                                target.removeEventListener("pointermove", onPointerMove);
                                target.removeEventListener("pointerup", onPointerUp);
                              };

                              target.setPointerCapture(e.pointerId);
                              target.addEventListener("pointermove", onPointerMove);
                              target.addEventListener("pointerup", onPointerUp);
                            }}
                            className="absolute -top-3 -right-3 w-6 h-6 bg-red-500 border border-white rounded-full flex items-center justify-center cursor-move shadow-md z-[85] text-white select-none touch-none hover:bg-red-600 transition-colors pointer-events-auto"
                            title={t("dragToMoveBubble")}
                          >
                            <Move className="w-3 h-3 text-white stroke-[3px]" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar Controls */}
          <AnimatePresence initial={false}>
            {isBubbleSidebarOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-40 bg-black/5"
                  onClick={() => setIsBubbleSidebarOpen(false)}
                />
                <motion.aside
                  initial={{ x: 320, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 320, opacity: 0 }}
                  transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                  className="absolute right-0 top-0 bottom-0 w-[320px] shrink-0 border-l border-border bg-background/95 backdrop-blur-md shadow-2xl p-4 overflow-y-auto z-50 flex flex-col gap-4"
                >
                  <Card className="p-4 border border-border rounded-none shadow-none bg-card space-y-4">
                    <h3 className="text-sm font-bold text-foreground">
                      {t("bubbleCreatorDialogue")}
                    </h3>

                    <div className="space-y-2">
                      <div className="flex justify-between items-center bg-muted/50 p-2 rounded-md border border-border">
                        <div className="flex flex-col flex-1 mr-2 gap-2">
                          <span className="text-[10px] font-mono font-bold text-muted-foreground flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-primary" /> {t("aiWriter")}
                          </span>
                          <input
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            placeholder={t("heroEntrancePlaceholder")}
                            className="w-full text-xs p-1.5 border border-border bg-background rounded-sm outline-none focus:border-primary"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") generateText();
                            }}
                          />
                        </div>
                        <Button
                          size="sm"
                          onClick={generateText}
                          disabled={isGeneratingText || !aiPrompt.trim()}
                          className="h-8 text-[10px] mt-6"
                        >
                          {isGeneratingText ? "..." : t("generate")}
                        </Button>
                      </div>
                      <label className="text-[10px] font-mono font-bold text-muted-foreground block mt-4">
                        {t("textValue")}
                      </label>
                      <textarea
                        ref={textareaRef}
                        value={newBubbleText}
                        onChange={(e) => {
                          setNewBubbleText(e.target.value);
                          if (activeBubbleId)
                            updateBubbleText(activeBubbleId, e.target.value);
                        }}
                        className="w-full text-xs font-semibold p-2 border border-border bg-background h-16 resize-none rounded-none outline-none focus:border-primary"
                      />
                      {newBubbleText && newBubbleText.trim() !== "" && !activeBubbleId && (
                        <div className="p-2 bg-indigo-50 border border-indigo-100 text-indigo-950 text-[10px] rounded-none mt-1 space-y-1 leading-normal">
                          <p className="font-semibold text-indigo-900 flex items-center gap-1">
                            ✏️ {t("manualTextEntered")}
                          </p>
                          <p>
                            {t("manualTextEnteredDesc")}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-mono font-bold text-muted-foreground block">
                        {t("bubbleExpressionStyle")}
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {(["classic", "action"] as const).map(
                          (style) => (
                            <Button
                              key={style}
                              variant={
                                bubbleStyle === style ? "default" : "ghost"
                              }
                              className={`capitalize text-[10px] h-8 rounded-none px-1 ${bubbleStyle !== style ? "border border-border hover:bg-muted" : ""}`}
                              onClick={() => {
                                setBubbleStyle(style);
                                if (activeBubbleId) {
                                  updateActivePageBubbles(
                                    bubbles.map((b) =>
                                      b.id === activeBubbleId
                                        ? { ...b, style }
                                        : b,
                                    ),
                                  );
                                }
                              }}
                            >
                              {style === "classic" ? t("classic") : t("action")}
                            </Button>
                          ),
                        )}
                      </div>
                      <div className="p-1.5 bg-muted/40 border border-border/50 text-[10px] text-muted-foreground flex items-center gap-1.5">
                        <span className="shrink-0">💡</span>
                        <span>{t("freehand")} bubbles are now in <strong>Pen Tool &rarr; Freehand Bubble</strong> mode.</span>
                      </div>
                    </div>

                    <Button
                      onClick={addBubble}
                      className="w-full gap-2 rounded-none bg-primary hover:bg-primary/95 text-xs text-primary-foreground h-9 font-bold"
                    >
                      <Plus className="w-4 h-4" /> {t("addBubbleToPanel")}
                    </Button>
                  </Card>

                  {activeBubbleId && (
                    <Card className="p-4 border border-border rounded-none shadow-none bg-card space-y-4 border-primary">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-foreground">
                          Bubble Settings
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive"
                          onClick={() => removeBubble(activeBubbleId)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </Card>
                  )}

                  <div className="flex flex-col gap-2 pt-2 pb-8 lg:pb-2">
                    <Button
                      variant="ghost"
                      className="w-full rounded-none gap-1.5 text-xs h-9 text-destructive hover:bg-destructive/10 hover:text-destructive border border-destructive/20"
                      onClick={() => {
                        updateActivePageBubbles([]);
                        setActiveBubbleId(null);
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                      {t("resetPanel")}
                    </Button>
                  </div>
                </motion.aside>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* Drawing Mode Toolbar moved to top header bar */}
        {/* Non-signed User Publish Hint Window */}
        <Dialog open={showPublishAuthHint} onOpenChange={setShowPublishAuthHint}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader className="flex flex-col items-center text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-2">
                <UserPlus className="h-6 w-6" />
              </div>
              <DialogTitle className="text-lg font-bold">Sign In Required to Publish</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground pt-1 text-center">
                Please create an account or sign in first to publish your story or comic to the public bookshelf.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 pt-3">
              <Button
                onClick={() => {
                  setShowPublishAuthHint(false);
                  setShowAuthDialog(true);
                }}
                className="w-full font-semibold gap-2"
              >
                <UserPlus className="w-4 h-4" />
                Sign In / Create Account
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowPublishAuthHint(false)}
                className="w-full text-xs"
              >
                Cancel
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        {/* Story Illustration Drawing Canvas Dialog Modal */}
        <Dialog open={isDrawingModalOpen} onOpenChange={setIsDrawingModalOpen}>
          <DialogContent className="sm:max-w-[650px] bg-background border border-border text-foreground p-5 shadow-2xl rounded-none">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-base font-bold font-mono">DRAW ILLUSTRATION</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Draw custom vector-like canvas shapes and lines, then insert them straight into your document.
              </DialogDescription>
            </DialogHeader>
            <div className="pt-2">
              <StoryDrawingBoard 
                onInsert={insertDrawingToDoc} 
                onCancel={() => setIsDrawingModalOpen(false)} 
              />
            </div>
          </DialogContent>
        </Dialog>

        {renderGoogleDriveDialog()}
      </main>
    </div>
  );
};

// Subcomponent: StoryDrawingBoard
const StoryDrawingBoard: React.FC<{
  onInsert: (dataUrl: string) => void;
  onCancel: () => void;
}> = ({ onInsert, onCancel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState("#000000");
  const [size, setSize] = useState(4);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 600;
    canvas.height = 400;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    setHistory([canvas.toDataURL()]);
  }, []);

  const saveToHistory = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setHistory((prev) => [...prev, canvas.toDataURL()]);
  };

  const undo = () => {
    if (history.length <= 1) return;
    const newHistory = history.slice(0, -1);
    setHistory(newHistory);
    const lastState = newHistory[newHistory.length - 1];

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = lastState;
  };

  const getCoords = (e: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const startDrawing = (e: any) => {
    if (e.touches) e.preventDefault();
    isDrawingRef.current = true;
    lastPosRef.current = getCoords(e);
  };

  const draw = (e: any) => {
    if (!isDrawingRef.current) return;
    if (e.touches) e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const currentPos = getCoords(e);

    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(currentPos.x, currentPos.y);

    ctx.strokeStyle = tool === "eraser" ? "#ffffff" : color;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    lastPosRef.current = currentPos;
  };

  const stopDrawing = () => {
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      saveToHistory();
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    saveToHistory();
  };

  const colors = [
    "#000000", "#ef4444", "#3b82f6", "#10b981", 
    "#f59e0b", "#8b5cf6", "#ec4899", "#64748b"
  ];

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 border-border/60">
        <div className="flex items-center gap-1 bg-muted/20 p-1 border border-border/40">
          <Button
            variant={tool === "pen" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 gap-1.5 font-semibold text-xs px-3 rounded-none"
            onClick={() => setTool("pen")}
          >
            <PenTool className="w-3.5 h-3.5 text-primary" />
            Pen
          </Button>
          <Button
            variant={tool === "eraser" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 gap-1.5 font-semibold text-xs px-3 rounded-none"
            onClick={() => setTool("eraser")}
          >
            <Eraser className="w-3.5 h-3.5 text-primary" />
            Eraser
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold text-muted-foreground">SIZE:</span>
          <div className="flex items-center gap-1">
            {[2, 4, 8, 16].map((sz) => (
              <Button
                key={sz}
                variant={size === sz ? "secondary" : "ghost"}
                size="icon"
                className="w-7 h-7 font-mono font-bold text-xs rounded-none"
                onClick={() => setSize(sz)}
              >
                {sz === 2 ? "XS" : sz === 4 ? "S" : sz === 8 ? "M" : "L"}
              </Button>
            ))}
          </div>
        </div>

        {tool === "pen" && (
          <div className="flex items-center gap-1 bg-muted/10 p-1 border border-border/20">
            {colors.map((c) => (
              <button
                key={c}
                className="w-5 h-5 rounded-full border border-black/10 color-circle-button transition-transform active:scale-95 cursor-pointer"
                style={{ 
                  backgroundColor: c, 
                  boxShadow: color === c ? "0 0 0 2px var(--color-primary)" : "none" 
                }}
                onClick={() => setColor(c)}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-5 h-5 cursor-pointer bg-transparent border-none p-0 ml-1"
            />
          </div>
        )}
      </div>

      <div className="relative border border-border bg-white overflow-hidden flex items-center justify-center p-0.5 shadow-sm">
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className="max-w-full h-auto cursor-crosshair block bg-white"
          style={{ width: "100%", aspectRatio: "3/2", touchAction: "none" }}
        />
      </div>

      <div className="flex justify-between items-center pt-2 border-t border-border/40">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={undo}
            disabled={history.length <= 1}
            className="text-xs font-semibold h-8 rounded-none"
          >
            Undo
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={clearCanvas}
            className="text-xs font-semibold text-destructive border-destructive/20 hover:bg-destructive/10 h-8 rounded-none"
          >
            Clear
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="text-xs font-semibold h-8 rounded-none"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const canvas = canvasRef.current;
              if (canvas) {
                onInsert(canvas.toDataURL("image/png"));
              }
            }}
            className="text-xs font-semibold h-8 gap-1.5 rounded-none font-mono"
          >
            <Check className="w-3.5 h-3.5" />
            INSERT DRAWING
          </Button>
        </div>
      </div>
    </div>
  );
};

// Subcomponent: InlineStoryCanvas
interface InlineStoryCanvasProps {
  canvasId: string;
  canvasIndex: number;
  canvasLabel?: string;
  node: PanelNode;
  widthPercent: number;
  drawTool?: 'pen'|'erase'|'select'|'fill';
  penMode?: 'normal' | 'smartShape' | 'freehandBubble';
  eraserType?: 'stroke' | 'pixel';
  drawColor?: string;
  drawRadius?: number;
  touchOff?: boolean;
  setTouchOff?: (val: boolean) => void;
  isDrawingMode?: boolean;
  layers?: ComicLayer[];
  activeLayerId?: string;
  layerGroups?: ComicLayerGroup[];
  backgroundColor?: string;
  onSelectCanvas?: (e?: React.MouseEvent) => void;
  onDeleteCanvas?: () => void;
  onChange: (updatedNode: PanelNode) => void;
  onWidthChange: (newWidth: number) => void;
}

const InlineStoryCanvas: React.FC<InlineStoryCanvasProps> = ({
  canvasId,
  canvasIndex,
  canvasLabel,
  node,
  widthPercent,
  drawTool = 'pen',
  penMode = 'normal',
  eraserType = 'pixel',
  drawColor = '#000000',
  drawRadius = 2,
  touchOff = false,
  setTouchOff,
  isDrawingMode = true,
  layers,
  activeLayerId,
  layerGroups,
  backgroundColor,
  onSelectCanvas,
  onDeleteCanvas,
  onChange,
  onWidthChange,
}) => {
  const [isFullPanel, setIsFullPanel] = useState(false);
  const [zoom, setZoom] = useState(100);

  const displayLabel = canvasLabel || `L${canvasIndex + 1}`;

  const handleCanvasDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isDrawingMode) {
      if (window.confirm("Do you want to delete this drawing canvas?")) {
        onDeleteCanvas?.();
      }
      return;
    }
    if (node.imageUrl) {
      if (window.confirm("Do you want to delete the image from this canvas?")) {
        onChange({
          ...node,
          imageUrl: "",
        });
      }
    }
  };

  return (
    <div 
      onPointerDown={(e) => {
        onSelectCanvas?.(e);
      }}
      onClick={(e) => {
        onSelectCanvas?.(e);
      }}
      className="w-full h-full relative select-none pointer-events-auto bg-transparent border-0 shadow-none group/canvas overflow-hidden"
    >
      {/* Main Canvas Area */}
      <div 
        onDoubleClick={handleCanvasDoubleClick}
        className="w-full h-full relative overflow-hidden flex items-center justify-center"
      >
        <ComicCanvas
          tree={node}
          onChange={(newTree) => onChange(newTree as PanelNode)}
          isDrawingMode={isDrawingMode}
          drawTool={drawTool}
          penMode={penMode}
          eraserType={eraserType}
          drawColor={drawColor}
          drawRadius={drawRadius}
          touchOff={touchOff}
          setTouchOff={setTouchOff}
          layers={layers}
          activeLayerId={activeLayerId}
          layerGroups={layerGroups}
          backgroundColor={backgroundColor}
          disableTapToInsertImage={true}
          hidePanelLabel={false}
          hideExpandButton={true}
          hideEdgeAddButtons={true}
          customPanelLabel={displayLabel}
          panelIndexOffset={canvasIndex}
          noPadding={true}
          onDeleteRootPanel={() => {
            if (!isDrawingMode) {
              if (window.confirm("Do you want to delete this drawing canvas?")) {
                onDeleteCanvas?.();
              }
            }
          }}
        />

        {/* Top-Right corner Full Panel toggle button only when draw button is active (hidden when folded) */}
        {isDrawingMode && (
          <div className="absolute top-1.5 right-1.5 z-30 flex items-center gap-1.5 opacity-90 sm:opacity-0 group-hover/canvas:opacity-100 transition-opacity">
            <Button
              size="icon"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                setIsFullPanel(true);
              }}
              className="w-6 h-6 bg-card/95 border border-border hover:bg-muted text-foreground hover:scale-105 active:scale-95 rounded flex items-center justify-center shadow-xs cursor-pointer"
              title="Full panel"
            >
              <Maximize className="w-3.5 h-3.5 stroke-[2.5]" />
            </Button>
          </div>
        )}
      </div>

      {/* Full-panel overlay filling entire area except toolbar, preserving ratio and displaying Comic Creator zoom bar */}
      {isFullPanel && createPortal(
        <div className="fixed inset-0 top-11 z-[99] bg-background flex flex-col items-center justify-between p-4 sm:p-6 select-none pointer-events-auto overflow-hidden border-t border-border">
          {/* Centered Canvas Container with exact aspect ratio and margin space matching Comic Creator */}
          <div className="flex-1 w-full flex items-center justify-center min-h-0 overflow-hidden relative p-2 sm:p-4">
            <div 
              style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'center center' }}
              className="relative max-h-full max-w-full aspect-[4/3] w-full max-w-4xl shadow-2xl ring-1 ring-border bg-card transition-transform duration-150 flex items-center justify-center"
            >
              <ComicCanvas
                tree={node}
                onChange={(newTree) => onChange(newTree as PanelNode)}
                isDrawingMode={isDrawingMode}
                drawTool={drawTool}
                penMode={penMode}
                eraserType={eraserType}
                drawColor={drawColor}
                drawRadius={drawRadius}
                touchOff={touchOff}
                setTouchOff={setTouchOff}
                layers={layers}
                activeLayerId={activeLayerId}
                layerGroups={layerGroups}
                backgroundColor={backgroundColor}
                disableTapToInsertImage={true}
                hidePanelLabel={false}
                hideExpandButton={true}
                hideEdgeAddButtons={true}
                customPanelLabel={displayLabel}
                panelIndexOffset={canvasIndex}
                noPadding={true}
              />
            </div>
          </div>

          {/* Bottom Zoom & Action Bar following global colour */}
          <div className="shrink-0 flex items-center justify-center pt-3 pb-1 z-50">
            <div className="flex items-center gap-1.5 px-3 py-1 bg-card/95 backdrop-blur-md border border-border shadow-md rounded-none text-xs font-mono text-foreground">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setZoom((z) => Math.max(50, z - 10))}
                className="w-6 h-6 hover:bg-muted text-foreground"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </Button>
              <span className="text-[11px] font-bold px-1 min-w-[42px] text-center select-none text-foreground">
                {zoom}%
              </span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setZoom((z) => Math.min(200, z + 10))}
                className="w-6 h-6 hover:bg-muted text-foreground"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </Button>
              <div className="w-px h-3.5 bg-border mx-1" />
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setZoom(100)}
                className="w-6 h-6 hover:bg-muted text-foreground"
                title="Reset Zoom (100%)"
              >
                <RotateCcw className="w-3 h-3" />
              </Button>
              <div className="w-px h-3.5 bg-border mx-1" />
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setIsFullPanel(false)}
                className="w-6 h-6 hover:bg-muted text-foreground"
                title="Exit Full Panel"
              >
                <Minimize className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
