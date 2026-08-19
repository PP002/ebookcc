import React, { useState, useRef, useEffect } from "react";
import {
  BookOpen,
  PenTool,
  Eraser,
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
  Lock,
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
  saveUnfinishedStory,
  getUnfinishedStories,
  deleteUnfinishedStory,
  UnfinishedComic,
  UnfinishedStory
} from "@/lib/historyCache";
import { publishWorkToR2, fetchPublishedWorksFromR2, deletePublishedWorkFromR2 } from "@/lib/r2Storage";
import { useLanguage } from "@/context/LanguageContext";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
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
  fillFirstEmptyPanel,
  updatePanelImage,
  TreeNode,
  Stroke,
} from "./ComicCanvas";
import JSZip from "jszip";
import { AIGeneratorDialog } from "./AIGeneratorDialog";
import { AIFullComicDialog } from "./AIFullComicDialog";
import { AIFullStoryDialog } from "./AIFullStoryDialog";
import { useAppSettings } from "@/context/AppSettingsContext";
import { getApiUrl } from '@/lib/api';


interface CreateProps {
  setActiveView: (view: "home" | "read" | "create" | "convert") => void;
  onActiveStateChange?: (active: boolean) => void;
}

interface Bubble {
  id: string;
  text: string;
  x: number;
  y: number;
  style: "classic" | "action" | "freehand";
  points?: { x: number; y: number }[];
  tailX?: number;
  tailY?: number;
}

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

function MiniPageGrid({ node }: { node: any }) {
  if (!node) return null;

  if (node.type === "panel") {
    let imgUrl = node.imageUrl || node.drawing || node.bgImageUrl || node.image;
    if (!imgUrl && Array.isArray(node.drawings) && node.drawings.length > 0) {
      const strokeImg = node.drawings.find((d: any) => d && d.imageUrl);
      if (strokeImg) imgUrl = strokeImg.imageUrl;
    }

    const hasImage = !!(imgUrl && typeof imgUrl === 'string' && imgUrl.trim() !== '');

    return (
      <div className="w-full h-full bg-white relative overflow-hidden flex items-center justify-center p-[1px] min-w-0 min-h-0">
        <div 
          className={cn(
            "w-full h-full bg-white overflow-hidden relative flex items-center justify-center min-w-0 min-h-0",
            hasImage ? "border border-zinc-900" : "border-none"
          )}
          style={{ backgroundColor: node.bgColor || node.color || node.bg || '#ffffff' }}
        >
          {hasImage ? (
            <img 
              src={imgUrl} 
              alt="" 
              className={cn(
                "w-full h-full object-cover bg-white pointer-events-none select-none",
                node.isHighContrast && "grayscale contrast-125"
              )} 
              referrerPolicy="no-referrer" 
            />
          ) : (
            <div className="w-full h-full bg-white" />
          )}
        </div>
      </div>
    );
  }

  if (node.type === "split") {
    const isRow = node.dir === "row" || node.dir === "h" || node.dir === "horizontal" || node.direction === "horizontal";
    const pct = typeof node.percent === "number" ? node.percent : (typeof node.splitRatio === "number" ? node.splitRatio : 50);
    const c1 = node.c1 || node.left;
    const c2 = node.c2 || node.right;

    return (
      <div className={`flex w-full h-full min-w-0 min-h-0 bg-white ${isRow ? "flex-row" : "flex-col"}`}>
        <div style={isRow ? { width: `${pct}%` } : { height: `${pct}%` }} className="flex min-w-0 min-h-0 bg-white overflow-hidden">
          <MiniPageGrid node={c1} />
        </div>
        <div style={isRow ? { width: `${100 - pct}%` } : { height: `${100 - pct}%` }} className="flex min-w-0 min-h-0 bg-white overflow-hidden">
          <MiniPageGrid node={c2} />
        </div>
      </div>
    );
  }

  return <div className="w-full h-full bg-white" />;
}

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

const CanvasResizeOverlay = ({
  imgElement,
  updateToc,
}: {
  imgElement: HTMLImageElement;
  updateToc: () => void;
}) => {
  const [rect, setRect] = useState(imgElement.getBoundingClientRect());

  useEffect(() => {
    const iv = setInterval(() => {
      const newRect = imgElement.getBoundingClientRect();
      if (
        newRect.width !== rect.width ||
        newRect.height !== rect.height ||
        newRect.top !== rect.top ||
        newRect.left !== rect.left
      ) {
        setRect(newRect);
      }
    }, 30);
    return () => clearInterval(iv);
  }, [imgElement, rect]);

  const handleResizeStart = (e: React.PointerEvent, handle: string) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = imgElement.clientWidth;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const onPointerMove = (evt: PointerEvent) => {
      let dx = evt.clientX - startX;
      let newWidth = startWidth;

      if (handle.includes("e")) newWidth = startWidth + dx;
      if (handle.includes("w")) newWidth = startWidth - dx;

      // Calculate percentage width to be responsive
      const parentWidth =
        imgElement.parentElement?.clientWidth || window.innerWidth;
      const percentageW = (Math.max(20, newWidth) / parentWidth) * 100;
      imgElement.style.width = percentageW + "%";
      imgElement.style.height = "auto";
      setRect(imgElement.getBoundingClientRect());
      updateToc();
    };

    const onPointerUp = (evt: PointerEvent) => {
      target.releasePointerCapture(evt.pointerId);
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", onPointerUp);
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
    const iv = setInterval(
      () => setRect(imgElement.getBoundingClientRect()),
      50,
    );
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Measure dimensions when text changes or on mount
  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setDimensions({ w: rect.width, h: rect.height });
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
        if (width > 0 && height > 0) {
          setDimensions({ w: width + padX, h: height + padY });
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const W = Math.max(20, dimensions.w);
  const H = Math.max(20, dimensions.h);

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

    // Apply multi-pass Chaikin smoothing for silky smooth vector curves
    const smoothedNorm = chaikinSmooth(normPoints, 3);

    // Scale contour points to match current container W and H
    const bodyPts = smoothedNorm.map((p) => ({
      x: (p.x / 100) * W,
      y: (p.y / 100) * H,
    }));

    const N = bodyPts.length;

    // Convert tail coordinates from percentage to pixels
    const tailPxX = (tailX / 100) * W;
    const tailPxY = (tailY / 100) * H;

    // Angle to tail
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
    pathPts.push({ x: tailPxX, y: tailPxY });

    if (pathPts.length > 0) {
      let d = `M ${pathPts[0].x.toFixed(1)} ${pathPts[0].y.toFixed(1)}`;
      for (let i = 0; i < pathPts.length - 1; i++) {
        const p1 = pathPts[i];
        const p2 = pathPts[i + 1];
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        d += ` Q ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
      }
      const last = pathPts[pathPts.length - 1];
      const first = pathPts[0];
      const midX = (last.x + first.x) / 2;
      const midY = (last.y + first.y) / 2;
      d += ` Q ${last.x.toFixed(1)} ${last.y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)} Z`;
      dPath = d;
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

      {/* Text Container */}
      <div
        ref={containerRef}
        contentEditable
        suppressContentEditableWarning
        onClick={(e) => {
          e.stopPropagation();
          onActivate?.();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          removeBubble();
        }}
        onFocus={() => {
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
        className={`text-xs break-words text-center min-w-[70px] max-w-[180px] whitespace-pre-wrap outline-none cursor-text select-text font-semibold ${
          bubble.style === "action"
            ? "font-extrabold uppercase text-black py-4 px-6"
            : bubble.style === "freehand"
            ? "text-black py-5 px-7 italic font-sans leading-tight"
            : "text-black py-2.5 px-4"
        }`}
        title={t("doubleClickDeleteBubble")}
      >
        {bubble.text}
      </div>

      {/* Tail Drag Handle (Only when selected/active) */}
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

function MiniPageGrid({ node }: { node: any }) {
  if (!node) return null;

  if (node.type === "panel") {
    const hasImage = !!(
      (node.imageUrl && typeof node.imageUrl === 'string' && node.imageUrl.trim() !== '') ||
      (node.drawing && typeof node.drawing === 'string' && node.drawing.trim() !== '') ||
      (Array.isArray(node.drawings) && node.drawings.length > 0)
    );

    return (
      <div className="w-full h-full bg-white relative overflow-hidden flex items-center justify-center p-[2px]">
        <div 
          className={cn(
            "w-full h-full bg-white overflow-hidden relative flex items-center justify-center min-w-0 min-h-0",
            hasImage ? "border border-zinc-900" : "border-none"
          )}
          style={{ backgroundColor: node.color || node.bg || '#ffffff' }}
        >
          {node.imageUrl ? (
            <img src={node.imageUrl || undefined} alt="" className="w-full h-full object-cover bg-white" referrerPolicy="no-referrer" />
          ) : node.drawing ? (
            <img src={node.drawing || undefined} alt="" className="w-full h-full object-contain bg-white" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-full h-full bg-white" />
          )}
        </div>
      </div>
    );
  }

  if (node.type === "split") {
    const isRow = node.dir === "row" || node.dir === "h" || node.dir === "horizontal" || node.direction === "horizontal";
    const pct = typeof node.percent === "number" ? node.percent : (typeof node.splitRatio === "number" ? node.splitRatio : 50);
    const c1 = node.c1 || node.left;
    const c2 = node.c2 || node.right;

    return (
      <div className={`flex w-full h-full min-w-0 min-h-0 bg-white ${isRow ? "flex-row" : "flex-col"}`}>
        <div style={isRow ? { width: `${pct}%` } : { height: `${pct}%` }} className="flex min-w-0 min-h-0 bg-white">
          <MiniPageGrid node={c1} />
        </div>
        <div style={isRow ? { width: `${100 - pct}%` } : { height: `${100 - pct}%` }} className="flex min-w-0 min-h-0 bg-white">
          <MiniPageGrid node={c2} />
        </div>
      </div>
    );
  }

  return <div className="w-full h-full bg-white" />;
}

function CreateMetroTile({
  book,
  index,
  user,
  onEdit,
  onDelete,
}: {
  book: any;
  index: number;
  user: any;
  onEdit: (item: any) => void;
  onDelete: (e: React.MouseEvent, item: any) => void;
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
      className="flex-shrink-0 w-[180px] h-[240px] group relative flex flex-col justify-between bg-slate-900 border border-slate-800 rounded-none shadow-md overflow-hidden cursor-pointer select-none transition-all duration-300 hover:shadow-xl active:scale-95"
    >
      {/* BACKGROUND & METRO LIVE TILE CONTENT */}
      {book.type === 'comic' ? (
        <div className="absolute inset-0 bg-white overflow-hidden flex items-center justify-center p-1">
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
                <div className="w-full h-full p-1 bg-white border border-zinc-900 flex flex-col overflow-hidden">
                  <MiniPageGrid node={currentComicPage.tree} />
                </div>
              ) : currentComicPage?.image ? (
                <img
                  src={currentComicPage.image || undefined}
                  alt={book.title}
                  className="w-full h-full object-contain bg-white"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-full h-full bg-slate-50 flex flex-col items-center justify-center p-4 text-center border border-zinc-300">
                  <Sparkles className="w-8 h-8 text-primary mb-2 animate-pulse" />
                  <span className="text-xs font-bold text-foreground line-clamp-2">{book.title}</span>
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
            <div className="w-full h-full bg-slate-900" />
          )}
        </div>
      )}

      {/* TOP HEADER BAR: METRO TYPE BADGE */}
      <div className="relative z-10 p-2 flex items-center justify-between w-full">
        <span
          className={`px-2 py-0.5 text-[9px] font-black tracking-widest uppercase text-white shadow-sm font-mono ${
            book.type === 'comic' ? 'bg-amber-600' : 'bg-blue-600'
          }`}
        >
          {book.type}
        </span>
      </div>

      {/* MIDDLE DYNAMIC CONTENT AREA */}
      <div className="relative z-10 px-3 py-1 flex-1 flex flex-col justify-center overflow-hidden">
        {book.type === 'novel' ? (
          <div className="relative w-full h-24 overflow-hidden flex items-center">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.p
                key={`novel-text-${slideIndex}`}
                initial={currentDirection.initial}
                animate={{ x: "0%", y: "0%", opacity: 1 }}
                exit={currentDirection.exit}
                transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
                className="absolute inset-0 text-[11px] leading-relaxed text-slate-200 font-serif line-clamp-4 italic bg-slate-950/85 p-2 backdrop-blur-xs flex items-center"
              >
                {currentNovelSnippet}
              </motion.p>
            </AnimatePresence>
          </div>
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
                  className="text-[10px] leading-tight text-amber-100 font-sans line-clamp-2 bg-slate-950/85 p-1.5 rounded-none border border-amber-500/40 backdrop-blur-xs"
                >
                  💬 "{currentComicPage.speechSnippet}"
                </motion.p>
              </AnimatePresence>
            </div>
          )
        )}
      </div>

      {/* BOTTOM FOOTER: TITLE + QUICK EDIT & DELETE BUTTONS */}
      <div className="relative z-10 px-2.5 py-2 bg-slate-950/95 border-t border-slate-800/80 backdrop-blur-sm flex flex-col gap-1.5">
        <h4 className="text-xs font-black text-white truncate tracking-tight font-sans">
          {book.title || "Untitled Work"}
        </h4>
        
        {isAuthor ? (
          <div className="flex items-center justify-between gap-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(book);
              }}
              className="flex-1 py-1 px-2 bg-primary text-primary-foreground hover:bg-primary/90 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1 transition-colors"
            >
              <PenTool className="w-3 h-3" />
              {t("edit")}
            </button>
            <button
              onClick={(e) => onDelete(e, book)}
              className="p-1 bg-slate-900 border border-slate-800 hover:border-red-500/50 text-slate-400 hover:text-red-400 hover:bg-red-950/40 text-[10px] transition-colors flex items-center justify-center"
              title={t("deleteWork")}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium">
            <span className="truncate flex items-center gap-1 max-w-[110px]">
              <Lock className="w-3 h-3 text-amber-400/80 shrink-0" />
              {book.author || "Author"}
            </span>
            <span className="text-[9px] font-mono bg-slate-900 border border-slate-800 px-1 py-0.5 text-slate-500">
              {t("readOnly")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export const Create: React.FC<CreateProps> = ({
  setActiveView,
  onActiveStateChange,
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
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [touchOff, setTouchOff] = useState(false);
  const [drawTool, setDrawTool] = useState<"pen" | "erase" | "select" | "fill">(
    "pen",
  );
  const [drawColor, setDrawColor] = useState("#000000");
  const [drawRadius, setDrawRadius] = useState(2);
  const [drawToolbarPos, setDrawToolbarPos] = useState({
    x: window.innerWidth / 2 - 120,
    y: 16,
  });
  const [isDraggingToolbar, setIsDraggingToolbar] = useState(false);
  const dragToolbarStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });

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

  // History and cache states
  const [unfinishedComics, setUnfinishedComics] = useState<UnfinishedComic[]>([]);
  const [unfinishedStories, setUnfinishedStories] = useState<UnfinishedStory[]>([]);
  const [currentComicId, setCurrentComicId] = useState<string | null>(null);
  const [currentStoryId, setCurrentStoryId] = useState<string | null>(null);
  const [comicTitle, setComicTitle] = useState<string>("Untitled Comic");
  const [storyTitle, setStoryTitle] = useState<string>("Untitled Story");
  const [loadedHtmlContent, setLoadedHtmlContent] = useState<string | null>(null);

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
    if (htmlContent.includes("<img") || htmlContent.includes("<IMG")) return true;
    
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = htmlContent;
    const text = tempDiv.textContent || tempDiv.innerText || "";
    return text.trim().length > 0;
  };

  // Published works state and actions for auth/local users
  const [publishedWorks, setPublishedWorks] = useState<any[]>([]);

  const loadPublishedWorks = async () => {
    try {
      const raw = localStorage.getItem("ebookcc_published_items") || "[]";
      const items = JSON.parse(raw);
      if (Array.isArray(items)) {
        setPublishedWorks(items);
      } else {
        setPublishedWorks([]);
      }
    } catch (err) {
      setPublishedWorks([]);
    }

    try {
      const res = await fetchPublishedWorksFromR2();
      if (res.success && Array.isArray(res.works)) {
        const sorted = [...res.works].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        localStorage.setItem("ebookcc_published_items", JSON.stringify(sorted));
        setPublishedWorks(sorted);
      }
    } catch (_) {}
  };

  const handleQuickEditPublished = (item: any) => {
    if (!checkIsAuthor(item, user)) {
      toast.error(`Only the author (${item.author || "Owner"}) can edit this published work.`);
      return;
    }
    if (item.type === "comic" || (item.pages && Array.isArray(item.pages))) {
      setCurrentComicId(item.id);
      setComicTitle(item.title || "Untitled Comic");
      if (item.pages && Array.isArray(item.pages)) {
        setComicPagesState(item.pages);
      }
      setActivePageIndex(0);
      setCreateMode("comic");
      toast.success(`Loaded published comic "${item.title || 'Untitled'}" into workspace`);
    } else {
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

  // Load lists on select screen
  useEffect(() => {
    if (createMode === "select") {
      getUnfinishedComics().then(setUnfinishedComics);
      getUnfinishedStories().then(setUnfinishedStories);
      loadPublishedWorks();
      setCurrentComicId(null);
      setCurrentStoryId(null);
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
        getUnfinishedStories().then((stories) => {
          const match = stories.find(s => s.id === triggerId);
          if (match) {
            setCurrentStoryId(match.id);
            setStoryTitle(match.title);
            setLoadedHtmlContent(match.htmlContent);
            setCreateMode("document");
          } else {
            // Check published list
            try {
              const pub = JSON.parse(localStorage.getItem("ebookcc_published_items") || "[]");
              const found = pub.find((item: any) => item.id === triggerId);
              if (found) {
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
        getUnfinishedComics().then((comics) => {
          const match = comics.find(c => c.id === triggerId);
          if (match) {
            setCurrentComicId(match.id);
            setComicTitle(match.title);
            setComicPagesState(match.pages);
            setActivePageIndex(match.activePageIndex || 0);
            setCreateMode("comic");
          } else {
            // Check published list
            try {
              const pub = JSON.parse(localStorage.getItem("ebookcc_published_items") || "[]");
              const found = pub.find((item: any) => item.id === triggerId);
              if (found && found.pages) {
                setCurrentComicId(found.id);
                setComicTitle(found.title);
                setComicPagesState(found.pages);
                setActivePageIndex(0);
                setCreateMode("comic");
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
      const activeId = currentComicId || "comic-" + Date.now();
      if (!currentComicId) {
        setCurrentComicId(activeId);
      }
      if (!isComicDefaultState(comicPages)) {
        const timer = setTimeout(() => {
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

  // Initialize history sync eagerly
  if (historyRef.current.length === 0) {
    historyRef.current = [comicPages];
    historyIndexRef.current = 0;
  }

  const setComicPages = (
    newPagesOrUpdater: ComicPage[] | ((prev: ComicPage[]) => ComicPage[]),
  ) => {
    setComicPagesState((prev) => {
      const nextPages =
        typeof newPagesOrUpdater === "function"
          ? newPagesOrUpdater(prev)
          : newPagesOrUpdater;
      const nextIndex = historyIndexRef.current + 1;
      const newHistory = historyRef.current.slice(0, nextIndex);
      newHistory.push(nextPages);
      if (newHistory.length > 50) newHistory.shift();
      historyRef.current = newHistory;
      historyIndexRef.current = newHistory.length - 1;
      return nextPages;
    });
  };

  const activePage = comicPages[activePageIndex] || comicPages[0];
  const comicTree = activePage.tree;
  const bubbles = activePage.bubbles;

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA"].includes(target.tagName) ||
        target.isContentEditable
      )
        return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          if (e.shiftKey) {
            // REDO
            if (historyIndexRef.current < historyRef.current.length - 1) {
              historyIndexRef.current++;
              setComicPagesState(historyRef.current[historyIndexRef.current]);
            }
          } else {
            // UNDO
            if (historyIndexRef.current > 0) {
              historyIndexRef.current--;
              setComicPagesState(historyRef.current[historyIndexRef.current]);
            }
          }
          return;
        }
      }

      if (createMode === "comic") {
        const key = e.key.toLowerCase();
        if (key === "d") {
          setIsDrawingMode((prev) => {
            if (!prev) setDrawTool("pen");
            return true;
          });
        }
        if (isDrawingMode) {
          if (key === "e") setDrawTool("erase");
          if (key === "l") setDrawTool("select");
          if (key === "p") setDrawTool("pen");
          if (key === "f") setDrawTool("fill");
        }
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [createMode, isDrawingMode]);

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
                engine: "pollinations", // Force fast generator
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
              "Falling back to client-side proxy-less generation...",
              e,
            );
            const encodedPrompt = encodeURIComponent(
              prompt + (sketch ? " consistent with sketch" : ""),
            );
            imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&safe=nsfw&seed=${sharedConsistencySeed}&model=flux`;
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
  const [newBubbleText, setNewBubbleText] = useState("");
  const [bubbleStyle, setBubbleStyle] = useState<
    "classic" | "action" | "freehand"
  >("classic");
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGeneratingText, setIsGeneratingText] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  // Populate rich text content on story mode mount, and auto-save on change
  useEffect(() => {
    if (createMode === "document" && editorRef.current) {
      if (loadedHtmlContent !== null) {
        editorRef.current.innerHTML = loadedHtmlContent;
        setLoadedHtmlContent(null);
      } else if (editorRef.current.innerHTML.trim() === "") {
        editorRef.current.innerHTML = "<h1><br></h1><h2><br></h2><p><br></p>";
      }
      setTimeout(() => updateToc(), 100);
    }
  }, [createMode, loadedHtmlContent]);

  // Periodic/title-triggered auto-save for story
  useEffect(() => {
    if (createMode === "document" && editorRef.current) {
      const activeId = currentStoryId || "story-" + Date.now();
      if (!currentStoryId) {
        setCurrentStoryId(activeId);
      }
      const handleInput = () => {
        const html = editorRef.current?.innerHTML || "";
        if (hasStoryEditedContent(html)) {
          saveUnfinishedStory({
            id: activeId,
            title: storyTitle,
            htmlContent: html,
          });
        }
      };
      
      const el = editorRef.current;
      el.addEventListener("input", handleInput);
      
      // Also save when title changes
      const html = el.innerHTML;
      if (hasStoryEditedContent(html)) {
        saveUnfinishedStory({
          id: activeId,
          title: storyTitle,
          htmlContent: html,
        });
      }

      return () => {
        el.removeEventListener("input", handleInput);
      };
    }
  }, [createMode, storyTitle, currentStoryId]);
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

    if (strokeW < 1 && strokeH < 1) {
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

    if (pts && pts.length >= 3) {
      const rawNorm = pts.map((p) => ({
        x: Math.max(5, Math.min(95, ((p.x - minX) / (strokeW || 1)) * 90 + 5)),
        y: Math.max(5, Math.min(95, ((p.y - minY) / (strokeH || 1)) * 90 + 5)),
      }));

      normalizedPoints = chaikinSmooth(rawNorm, 3);

      let maxDist = 0;
      let furthestIdx = -1;
      for (let i = 0; i < normalizedPoints.length; i++) {
        const p = normalizedPoints[i];
        const dist = Math.hypot(p.x - 50, p.y - 50);
        if (dist > maxDist) {
          maxDist = dist;
          if (dist > 35) {
            furthestIdx = i;
            initialTailX = p.x;
            initialTailY = p.y;
          }
        }
      }

      if (furthestIdx !== -1) {
        const N = normalizedPoints.length;
        const removeRange = Math.max(3, Math.floor(N * 0.08));
        const newPts: { x: number; y: number }[] = [];
        const start = (furthestIdx + removeRange) % N;
        const end = (furthestIdx - removeRange + N) % N;
        let curr = start;
        while (curr !== end) {
          newPts.push(normalizedPoints[curr]);
          curr = (curr + 1) % N;
        }
        normalizedPoints = newPts;
      }
    } else {
      normalizedPoints = generatePerfectSpeechBubblePoints();
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
        tailX: initialTailX,
        tailY: initialTailY,
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
      tailX: initialTailX,
      tailY: initialTailY,
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
          "Falling back to client-side proxy-less text generation...",
          e,
        );
        const sysPrompt =
          "You are a comic book script writer. Given a scenario, generate a short, punchy single speech bubble line of dialogue (or sound effect). Maximum 10-15 words. ONLY return the text that goes in the bubble, nothing else.";
        const openAiMessages = [
          { role: "system", content: sysPrompt },
          { role: "user", content: aiPrompt },
        ];
        const polRes = await fetch("https://text.pollinations.ai/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: openAiMessages, model: "openai" }),
        });
        if (!polRes.ok) throw new Error("Fallback text generation failed");
        generatedText = await polRes.text();
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

  const updateToc = () => {
    if (!editorRef.current) return;
    const headings = editorRef.current.querySelectorAll("h1, h2");
    const seenIds = new Set<string>();

    const items = Array.from(headings).map((h: Element, index) => {
      const htmlEl = h as HTMLElement;

      // Generate a new ID if it doesn't have one, or if we've already seen this ID (e.g. from copy-pasting nodes)
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
    setTocItems(items);
  };

  const execDocCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    updateToc();
  };

  useEffect(() => {
    if (createMode === "document" && editorRef.current) {
      if (editorRef.current.innerHTML.trim() === "") {
        editorRef.current.innerHTML = "<h1><br></h1><h2><br></h2><p><br></p>";
        updateToc();
      }
    }
  }, [createMode]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
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
        setTimeout(() => updateToc(), 0);
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
      setTimeout(() => updateToc(), 0);
    } else {
      setTimeout(() => updateToc(), 0);
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
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
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
      content: createMode === "document" ? (editorRef.current?.innerHTML || "") : undefined,
      pages: createMode === "comic" ? comicPages : undefined,
      timestamp: Date.now()
    };

    const toastId = toast.loading("Rapidly preparing comic book assets...");

    // Publish to cloud media storage with real-time progress & parallel uploads
    const r2Result = await publishWorkToR2(newItem, undefined, (progress, stage) => {
      toast.loading(`[${progress}%] ${stage}`, { id: toastId });
    });

    if (!r2Result.success) {
      toast.dismiss(toastId);
      toast.error(`R2 Cloud Publish Failed: ${r2Result.message || "Could not publish work to Cloudflare R2"}`);
      return;
    }

    const itemToSave = r2Result.item || newItem;

    if (createMode === "comic" && Array.isArray(itemToSave.pages)) {
      setComicPages(itemToSave.pages);
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

    window.dispatchEvent(new Event("ebookcc_published"));
    window.dispatchEvent(new Event("storage"));

    toast.dismiss(toastId);
    toast.success(`Published "${title}" successfully to cloud storage & bookshelf!`);
  };

  const handleExport = async (format: string) => {
    toast.info(`Exporting as ${format.toUpperCase()}...`);

    const content = editorRef.current?.innerText || "";
    const htmlContent = editorRef.current?.innerHTML || "";

    try {
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
              skipFonts: false,
              style: {
                border: "none",
                boxShadow: "none",
                transform: "none",
                margin: "0",
              },
              filter: (node) => {
                if (
                  node instanceof HTMLElement &&
                  node.dataset &&
                  node.dataset.exportIgnore
                ) {
                  return false;
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
                nodes.fit = [500, 740];
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
      } else if (format === "epub" || format === "docx") {
        toast.info(`Generating ${format.toUpperCase()}...`);
        const response = await fetch(`${getApiUrl()}/api/export/${format}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html: htmlContent, title: "Document" }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Export failed: ${errText}`);
        }

        const json = await response.json();
        if (!json.data) throw new Error("No data received from server");

        // Decode Base64 to ArrayBuffer
        const binaryString = window.atob(json.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const mimeType =
          format === "docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "application/epub+zip";
        const blob = new Blob([bytes.buffer], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `document.${format}`;
        a.click();
        URL.revokeObjectURL(url);
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
      return div.textContent || div.innerText || '';
    };

    return (
      <div className="w-full flex-1 overflow-y-auto min-h-0 p-4 md:p-8">
        <div className="max-w-5xl mx-auto space-y-12 flex flex-col items-stretch pb-24">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-black tracking-tight text-foreground uppercase">{t("createCardTitle")}</h1>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            {t("createCardDesc")}
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 gap-6 w-full max-w-2xl mx-auto">
          <Card
            className="p-6 border border-border cursor-pointer hover:border-primary transition-all hover:shadow-md flex flex-col items-center text-center gap-4 bg-card group rounded-none"
            onClick={() => {
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
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
              <Layout className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-bold mb-1 text-foreground uppercase tracking-wide">
                {t("freeComicCreatorTitle")}
              </h3>
              <p className="text-xs text-muted-foreground">{t("freeComicCreatorDesc")}</p>
            </div>
          </Card>

          <Card
            className="p-6 border border-border cursor-pointer hover:border-primary transition-all hover:shadow-md flex flex-col items-center text-center gap-4 bg-card group rounded-none"
            onClick={() => {
              setCurrentStoryId(null);
              setStoryTitle("Untitled Story");
              setLoadedHtmlContent("<h1><br></h1><h2><br></h2><p><br></p>");
              setCreateMode("document");
            }}
          >
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
              <Type className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-bold mb-1 text-foreground uppercase tracking-wide">
                {t("richTextEditorTitle")}
              </h3>
              <p className="text-xs text-muted-foreground">{t("richTextEditorDesc")}</p>
            </div>
          </Card>
        </div>

        {/* Published Works Section (Displayed for Auth / Local Users) */}
        <div className="space-y-4 pt-8 border-t">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-black tracking-wider uppercase text-foreground flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-primary" />
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
            <div className="flex flex-wrap gap-5 items-center justify-start">
              {publishedWorks.filter((item) => checkIsAuthor(item, user)).map((item, index) => (
                <CreateMetroTile
                  key={item.id}
                  book={item}
                  index={index}
                  user={user}
                  onEdit={handleQuickEditPublished}
                  onDelete={handleDeletePublished}
                />
              ))}
            </div>
          )}
        </div>

        {/* Unfinished Comic list */}
        {unfinishedComics.length > 0 && (
          <div className="space-y-4 pt-8 border-t">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black tracking-wider uppercase text-foreground">{t("previousUnfinishedComics")}</h3>
              <span className="text-xs text-muted-foreground font-mono">{t("itemsCountLabel").replace("{count}", String(unfinishedComics.length))}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
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
                  className="group relative flex flex-col bg-card hover:bg-accent/30 border hover:border-primary/50 transition-all duration-300 rounded-none overflow-hidden cursor-pointer shadow-sm animate-fade-in"
                >
                  {/* Miniature Panel Tree Layout Preview */}
                  <div className="relative aspect-[3/4] bg-muted/10 p-2 border-b flex items-stretch">
                    <div className="w-full h-full flex flex-col items-stretch overflow-hidden border border-foreground/15 p-0.5 rounded-sm bg-background">
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
                        <Play className="w-4 h-4 fill-current ml-0.5" />
                      </div>
                    </div>
                  </div>

                  <div className="p-3 flex-1 flex flex-col justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-foreground line-clamp-1 leading-tight group-hover:text-primary transition-colors">
                        {comic.title}
                      </h4>
                      <div className="flex items-center gap-1 text-[9px] text-muted-foreground mt-1">
                        <Clock className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate">{formatTime(comic.timestamp)}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-border/40 mt-2">
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {t("pagesCountLabel").replace("{count}", String(comic.pages.length))}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await deleteUnfinishedComic(comic.id);
                          getUnfinishedComics().then(setUnfinishedComics);
                          toast.success("Comic project deleted");
                        }}
                        className="w-6 h-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Unfinished Story list */}
        {unfinishedStories.length > 0 && (
          <div className="space-y-4 pt-8 border-t">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black tracking-wider uppercase text-foreground">{t("previousUnfinishedStories")}</h3>
              <span className="text-xs text-muted-foreground font-mono">{t("itemsCountLabel").replace("{count}", String(unfinishedStories.length))}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {unfinishedStories.map((story) => (
                <Card 
                  key={story.id}
                  onClick={() => {
                    setCurrentStoryId(story.id);
                    setStoryTitle(story.title);
                    setLoadedHtmlContent(story.htmlContent);
                    setCreateMode("document");
                  }}
                  className="group relative flex flex-col justify-between bg-card hover:bg-accent/30 border hover:border-primary/50 transition-all duration-300 rounded-none overflow-hidden cursor-pointer shadow-sm animate-fade-in p-4 h-[140px]"
                >
                  <div className="space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-xs font-bold text-foreground line-clamp-1 leading-tight group-hover:text-primary transition-colors">
                        {story.title}
                      </h4>
                      <span className="text-[9px] font-bold text-primary px-1.5 py-0.5 bg-primary/10 shrink-0 uppercase">
                        DOC
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground line-clamp-3 leading-relaxed mt-1">
                      {getPreviewText(story.htmlContent) || "No text content written yet..."}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-border/40 mt-auto shrink-0">
                    <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                      <Clock className="w-2.5 h-2.5 shrink-0" />
                      <span className="truncate">{formatTime(story.timestamp)}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await deleteUnfinishedStory(story.id);
                        getUnfinishedStories().then(setUnfinishedStories);
                        toast.success("Story project deleted");
                      }}
                      className="w-6 h-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
    );
  }

  if (createMode === "document") {
    return (
      <div className="flex-1 bg-background flex flex-col overflow-hidden h-full min-h-0">
        <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md shrink-0 no-print">
          <div className="w-full px-2 h-11 flex items-center justify-between gap-2">
            <div className="flex items-center gap-0.5 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="w-8 h-8 shrink-0"
                title={isSidebarOpen ? t("hideSidebar") : t("showSidebar")}
              >
                {isSidebarOpen ? (
                  <PanelLeftClose className="w-4 h-4" />
                ) : (
                  <PanelLeftOpen className="w-4 h-4" />
                )}
              </Button>
              <div className="w-px h-5 bg-border mx-1 shrink-0" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCreateMode("select")}
                className="gap-2 text-xs font-semibold px-3 shrink-0"
              >
                <ChevronLeft className="w-3.5 h-3.5" />{" "}
                <span className="hidden sm:inline">{t("back")}</span>
              </Button>
              <div className="w-px h-5 bg-border mx-1 shrink-0" />
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 shrink-0 h-8 text-xs font-semibold"
                  onClick={insertImageToDoc}
                  title={t("insertImageTooltip")}
                >
                  <ImageIcon className="w-4 h-4" />{" "}
                  <span className="hidden sm:inline">{t("image")}</span>
                </Button>
              </div>
            </div>

            <div className="flex-1 flex items-center justify-center mx-4">
              {floatingMenuProps.visible ? (
                <div className="flex items-center gap-1 bg-muted/30 rounded-md p-0.5 border border-border/50 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onMouseDown={(e) => e.preventDefault()}
                    onTouchStart={(e) => e.preventDefault()}
                    onClick={() => execDocCommand("formatBlock", "H1")}
                  >
                    <Heading1 className="w-3.5 h-3.5 sm:mr-1.5" />{" "}
                    <span className="hidden sm:inline">{t("title")}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onMouseDown={(e) => e.preventDefault()}
                    onTouchStart={(e) => e.preventDefault()}
                    onClick={() => execDocCommand("formatBlock", "H2")}
                  >
                    <Heading2 className="w-3.5 h-3.5 sm:mr-1.5" />{" "}
                    <span className="hidden sm:inline">{t("subtitle")}</span>
                  </Button>
                  <div className="w-px h-4 bg-border mx-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onMouseDown={(e) => e.preventDefault()}
                    onTouchStart={(e) => e.preventDefault()}
                    onClick={() => execDocCommand("formatBlock", "P")}
                  >
                    <Type className="w-3.5 h-3.5 sm:mr-1.5" />{" "}
                    <span className="hidden sm:inline">{t("text")}</span>
                  </Button>
                  <div className="w-px h-4 bg-border mx-1 border-r border-border" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-primary"
                    onMouseDown={(e) => e.preventDefault()}
                    onTouchStart={(e) => e.preventDefault()}
                    onClick={() => {
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
                  onChange={(e) => setStoryTitle(e.target.value)}
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
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => e.stopPropagation()}
                className="fixed z-[100] pointer-events-auto"
                style={{
                  top: imageMenuProps.top,
                  left: imageMenuProps.left,
                  transform: "translate(-50%, -100%) translateY(-10px)",
                }}
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
                    const match =
                      imageMenuProps.imgElement.src.match(/prompt\/([^?]+)/);
                    if (match) {
                      try {
                        const prompt = decodeURIComponent(match[1]);
                        const newSeed = Math.floor(Math.random() * 100000000);
                        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&safe=nsfw&seed=${newSeed}&model=flux`;
                        imageMenuProps.imgElement.src = url;
                        updateToc();
                      } catch (e) {}
                    }
                    setImageMenuProps((prev) => ({ ...prev, visible: false }));
                  }}
                  onDelete={() => {
                    if (!imageMenuProps.imgElement) return;
                    imageMenuProps.imgElement.remove();
                    updateToc();
                    setImageMenuProps((prev) => ({ ...prev, visible: false }));
                  }}
                />
              </motion.div>
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
            imageMenuProps.visible &&
            imageMenuProps.imgElement && (
              <CanvasResizeOverlay
                imgElement={imageMenuProps.imgElement}
                updateToc={updateToc}
              />
            )}
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
                  className="absolute z-40 top-0 left-0 bottom-0 w-[140px] md:w-[180px] border-r bg-background/95 backdrop-blur-md shadow-2xl flex flex-col overflow-hidden no-print"
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
                </motion.aside>
              </>
            )}
          </AnimatePresence>
          <div className="flex-1 p-2 md:p-6 overflow-hidden flex flex-col items-center print-wrapper">
            <div
              ref={editorRef}
              onScroll={() => {
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
                if (target.tagName === "IMG") {
                  const rect = target.getBoundingClientRect();
                  setImageMenuProps({
                    visible: true,
                    top: rect.top,
                    left: rect.left + rect.width / 2,
                    imgElement: target as HTMLImageElement,
                  });
                } else {
                  setImageMenuProps((prev) => ({ ...prev, visible: false }));
                  if (target === editorRef.current) {
                    const sel = window.getSelection();
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
              onInput={updateToc}
            ></div>
          </div>
          <style
            dangerouslySetInnerHTML={{
              __html: `
            .editor-doc h1, .editor-doc h2, .editor-doc p, .editor-doc div { position: relative; min-height: 1.5em; }
            .editor-doc h1 { border-bottom: 2px dashed #e5e7eb; padding-bottom: 0.25rem; margin-bottom: 0.5rem; }
            .editor-doc h2 { border-bottom: 1px dashed #e5e7eb; padding-bottom: 0.25rem; margin-bottom: 1rem; }
            .editor-doc img { page-break-inside: avoid; break-inside: avoid; }
            .editor-doc p { cursor: text; outline: none; }
            .editor-doc h1:empty:before, .editor-doc h1:has(> br:only-child):before { content: '${t("title").replace(/'/g, "\\'")}'; color: #4b5563; pointer-events: none; opacity: 0.5; position: absolute; top: 0; left: 0; }
            .editor-doc h2:empty:before, .editor-doc h2:has(> br:only-child):before { content: '${t("subtitle").replace(/'/g, "\\'")}'; color: #4b5563; pointer-events: none; opacity: 0.5; position: absolute; top: 0; left: 0; }
            .editor-doc:empty:before, .editor-doc:has(> br:only-child):before { content: '${t("startWritingYourStory").replace(/'/g, "\\'")}'; color: #4b5563; pointer-events: none; opacity: 0.5; position: absolute; top: 0; left: 0; }
            .editor-doc p:empty:before, .editor-doc p:has(> br:only-child):before { content: '${t("startWritingYourStory").replace(/'/g, "\\'")}'; color: #4b5563; pointer-events: none; opacity: 0.5; position: absolute; top: 0; left: 0; }
            .editor-doc div:empty:before, .editor-doc div:has(> br:only-child):before { content: '${t("startWritingYourStory").replace(/'/g, "\\'")}'; color: #4b5563; pointer-events: none; opacity: 0.5; position: absolute; top: 0; left: 0; }
         `,
            }}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-background flex flex-col overflow-hidden h-full min-h-0">
      <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md shrink-0">
        <div className="w-full px-2 h-11 flex items-center justify-between gap-2">
          {/* Left Actions */}
          <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar py-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="w-8 h-8 shrink-0"
              title={isSidebarOpen ? t("hideSidebar") : t("showSidebar")}
            >
              {isSidebarOpen ? (
                <PanelLeftClose className="w-4 h-4" />
              ) : (
                <PanelLeftOpen className="w-4 h-4" />
              )}
            </Button>
            <div className="w-px h-5 bg-border mx-1 shrink-0" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCreateMode("select")}
              className="gap-1 text-xs font-semibold px-2 shrink-0"
            >
              <ChevronLeft className="w-3.5 h-3.5" />{" "}
              <span className="hidden sm:inline">{t("back")}</span>
            </Button>
            <div className="w-px h-5 bg-border mx-1 shrink-0" />
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant={isDrawingMode ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  const val = !isDrawingMode;
                  setIsDrawingMode(val);
                  if (val) setDrawTool("pen");
                }}
                className={`gap-1 px-2 text-xs font-semibold ${isDrawingMode ? "bg-primary/20 text-primary hover:bg-primary/30" : "text-muted-foreground hover:text-foreground"}`}
                title={t("drawModeTooltip")}
              >
                <PenTool className="w-4 h-4" />{" "}
                <span className="hidden sm:inline">{t("draw")}</span>
              </Button>
            </div>

            {isDrawingMode && (
              <>
                <div className="w-px h-5 bg-border mx-1 shrink-0" />
                <div className="flex items-center justify-center bg-muted/60 dark:bg-muted/30 rounded-full p-1 border border-border/40 gap-0.5 max-h-[34px] shrink-0">
                  <Button
                    variant={drawTool === "pen" ? "secondary" : "ghost"}
                    size="icon"
                    className="w-7 h-7 rounded-full"
                    onClick={() => setDrawTool("pen")}
                    title={t("penTooltip")}
                  >
                    <PenTool className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant={drawTool === "erase" ? "secondary" : "ghost"}
                    size="icon"
                    className="w-7 h-7 rounded-full"
                    onClick={() => setDrawTool("erase")}
                    title={t("eraseTooltip")}
                  >
                    <Eraser className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant={drawTool === "fill" ? "secondary" : "ghost"}
                    size="icon"
                    className="w-7 h-7 rounded-full"
                    onClick={() => setDrawTool("fill")}
                    title={t("fillTooltip")}
                  >
                    <PaintBucket className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant={drawTool === "select" ? "secondary" : "ghost"}
                    size="icon"
                    className="w-7 h-7 rounded-full"
                    onClick={() => setDrawTool("select")}
                    title={t("lassoTooltip")}
                  >
                    <LassoSelect className="w-3.5 h-3.5" />
                  </Button>
                  <div className="w-px h-4 bg-border mx-1" />
                  <Button
                    variant={touchOff ? "secondary" : "ghost"}
                    size="icon"
                    className={cn(
                      "w-7 h-7 rounded-full transition-all",
                      touchOff && "bg-amber-100 text-amber-800 hover:bg-amber-200 hover:text-amber-900 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
                    )}
                    onClick={() => setTouchOff(!touchOff)}
                    title={touchOff ? t("touchOffTooltip") : t("touchOnTooltip")}
                  >
                    <Hand className="w-3.5 h-3.5" />
                  </Button>
                  <div className="w-px h-4 bg-border mx-1" />
                  <input
                    type="color"
                    value={drawColor}
                    onChange={(e) => setDrawColor(e.target.value)}
                    className="w-5 h-5 rounded cursor-pointer border-0 p-0"
                    title={t("colorTooltip")}
                  />
                  <input
                    type="range"
                    min="1"
                    max="20"
                    value={drawRadius}
                    onChange={(e) => setDrawRadius(parseInt(e.target.value))}
                    className="w-14 sm:w-16 h-1 mx-1 cursor-pointer accent-primary"
                    title={t("brushSizeTooltip")}
                  />
                </div>
              </>
            )}
          </div>

          {/* Centered Comic Title */}
          <div className="flex-1 flex items-center justify-center mx-4">
            <input
              value={comicTitle}
              onChange={(e) => setComicTitle(e.target.value)}
              className="bg-transparent border-none text-foreground font-bold text-center text-sm focus:outline-none focus:ring-0 max-w-[180px] sm:max-w-[300px]"
              placeholder={t("comicTitlePlaceholder")}
            />
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-2 pr-2 shrink-0">
            {renderExportMenu()}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsBubbleSidebarOpen(!isBubbleSidebarOpen)}
              className="gap-2 shrink-0 h-8 text-xs font-semibold"
            >
              <MessageSquare className="w-3.5 h-3.5" />{" "}
              <span className="hidden sm:inline">{t("bubbles")}</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 relative w-full overflow-hidden flex bg-background">
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
                initial={{ x: -180, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -180, opacity: 0 }}
                transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                className="absolute top-0 left-0 bottom-0 z-40 w-[160px] border-r bg-background/95 backdrop-blur-md shadow-2xl flex flex-col overflow-hidden shrink-0"
              >
                <div className="p-3 border-b shrink-0 flex items-center justify-between">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("pages")}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 rounded-none hover:bg-muted"
                    onClick={() => {
                      setComicPages([
                        ...comicPages,
                        {
                          id: Date.now().toString(),
                          tree: createGridTree(3, 2),
                          bubbles: [],
                        },
                      ]);
                      setActivePageIndex(comicPages.length);
                    }}
                    title={t("addPage")}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
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
                        <MiniPageGrid node={page.tree} />
                      </div>

                      {/* Page Index Badge */}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-1.5 pt-3 pointer-events-none flex items-center justify-between z-10">
                        <span className="text-[9px] font-bold text-white shadow-xs">
                          {t("page")} {idx + 1}
                        </span>
                        {Array.isArray(page.bubbles) && page.bubbles.length > 0 && (
                          <span className="text-[8px] bg-white/30 text-white px-1 py-0.2 rounded-full font-medium">
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
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <div className="flex-1 w-full min-h-0 relative h-full flex flex-col lg:flex-row bg-background overflow-hidden">
          {/* Main Canvas Area */}
          <div className="flex-1 relative h-full flex justify-center items-center p-2 lg:p-4 min-w-0 min-h-0 bg-background/50 overflow-hidden">
            <div className="relative max-h-full max-w-full inline-flex justify-center items-center h-full">
              <svg
                viewBox="0 0 3 4"
                className="block h-full max-w-full max-h-full w-auto opacity-0 pointer-events-none"
              />
              <div
                ref={comicRef}
                className="absolute top-0 left-0 w-full h-full bg-background ring-1 ring-border shadow-2xl overflow-hidden"
              >
                <ComicCanvas
                  tree={comicTree}
                  onChange={updateActivePageTree}
                  isDrawingMode={isDrawingMode}
                  drawTool={drawTool}
                  drawColor={drawColor}
                  drawRadius={drawRadius}
                  touchOff={touchOff}
                  setTouchOff={setTouchOff}
                />

                {/* Bubble overlays layer */}
                {bubbles.map((b) => (
                  <div
                    key={b.id}
                    data-bubble-id={b.id}
                    style={{ left: `${b.x}%`, top: `${b.y}%` }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      removeBubble(b.id);
                    }}
                    onPointerDown={(e) => {
                      // Ignore drag operations initiated inside the contenteditable text
                      if (
                        (e.target as HTMLElement).closest(
                          '[contenteditable="true"]',
                        )
                      ) {
                        setActiveBubbleId(b.id);
                        setNewBubbleText(b.text);
                        setBubbleStyle(b.style);
                        return;
                      }
                      e.stopPropagation();
                      setActiveBubbleId(b.id);
                      setNewBubbleText(b.text);
                      setBubbleStyle(b.style);
                      const target = e.currentTarget as HTMLElement;
                      const parent = target.parentElement!;

                      let initialX = e.clientX;
                      let initialY = e.clientY;
                      let startLeft = b.x;
                      let startTop = b.y;

                      const onPointerMove = (ev: PointerEvent) => {
                        const rect = parent.getBoundingClientRect();
                        const dX = ((ev.clientX - initialX) / rect.width) * 100;
                        const dY =
                          ((ev.clientY - initialY) / rect.height) * 100;
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
                        target.removeEventListener(
                          "pointermove",
                          onPointerMove,
                        );
                        target.removeEventListener("pointerup", onPointerUp);
                      };

                      target.setPointerCapture(e.pointerId);
                      target.addEventListener("pointermove", onPointerMove);
                      target.addEventListener("pointerup", onPointerUp);
                    }}
                    className={`bubble-overlay absolute transform -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing select-none touch-none ${
                      activeBubbleId === b.id
                        ? b.style === "freehand"
                          ? "ring-2 ring-dashed ring-slate-400 ring-offset-2 rounded-[30%] z-30"
                          : "ring-2 ring-primary ring-offset-2 z-30"
                        : "z-20"
                    }`}
                  >
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
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setActiveBubbleId(b.id);
                          setNewBubbleText(b.text);
                          setBubbleStyle(b.style);
                          const target = e.currentTarget as HTMLElement;
                          const overlay = target.parentElement!;
                          const parentOfOverlay = overlay.parentElement!; // comicRef container
                          
                          let initialX = e.clientX;
                          let initialY = e.clientY;
                          let startLeft = b.x;
                          let startTop = b.y;

                          const onPointerMove = (ev: PointerEvent) => {
                            const rect = parentOfOverlay.getBoundingClientRect();
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
                        className="absolute -top-3 -right-3 w-6 h-6 bg-red-500 border border-white rounded-full flex items-center justify-center cursor-move shadow-md z-50 text-white select-none touch-none hover:bg-red-600 transition-colors"
                        title={t("dragToMoveBubble")}
                      >
                        <Move className="w-3 h-3 text-white stroke-[3px]" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* removed hint */}
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
                      <div className="grid grid-cols-3 gap-2">
                        {(["classic", "action", "freehand"] as const).map(
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
                                } else if (style === "freehand") {
                                  convertDrawnBubble();
                                }
                              }}
                            >
                              {style === "classic" ? t("classic") : style === "action" ? t("action") : t("freehand")}
                            </Button>
                          ),
                        )}
                      </div>
                    </div>

                    {bubbleStyle === "freehand" && (
                      <div className="p-2 border border-amber-200 bg-amber-50/50 rounded-none space-y-1.5 transition-all">
                        <p className="text-[10px] text-amber-800 leading-tight">
                          ✍️ <strong>{t("freehand")}:</strong> {t("freehandModeDesc")}
                        </p>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={convertDrawnBubble}
                          disabled={isTranscribing}
                          className="w-full text-[10px] h-7 bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold border border-amber-300 rounded-none flex items-center justify-center gap-1.5"
                        >
                          {isTranscribing ? (
                            <>
                              <span className="animate-spin text-amber-600">🌀</span> {t("transcribingHandwriting")}
                            </>
                          ) : (
                            <>
                              🪄 {t("convertHandDrawnBubble")}
                            </>
                          )}
                        </Button>
                      </div>
                    )}

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
      </main>
    </div>
  );
};
