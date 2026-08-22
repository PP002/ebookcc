import React, { useRef, useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { getSvgPathFromPoints, TreeNode, PanelNode, SplitNode, Stroke } from './ComicCanvas';

export interface BubbleData {
  id?: string;
  text: string;
  x: number; // 0 to 100 (%)
  y: number; // 0 to 100 (%)
  style?: string;
  tailX?: number;
  tailY?: number;
  points?: { x: number; y: number }[];
}

export interface ComicPageData {
  id?: string;
  tree?: TreeNode;
  bubbles?: BubbleData[];
  cover?: string;
  imageUrl?: string;
  image?: string;
  url?: string;
}

// Chaikin smoothing algorithm for freehand speech bubble contours
function chaikinSmooth(points: { x: number; y: number }[], iterations: number = 3): { x: number; y: number }[] {
  if (!points || points.length < 3) return points;
  let current = [...points];
  for (let iter = 0; iter < iterations; iter++) {
    const nextList: { x: number; y: number }[] = [];
    const len = current.length;
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
}

function generateDefaultSpeechBubblePoints(): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const cx = 50;
  const cy = 45;
  const rx = 44;
  const ry = 34;
  const tEnd = 0.70 * Math.PI;
  const steps = 80;
  for (let i = 0; i < steps; i++) {
    const t = tEnd + (i / steps) * (2 * Math.PI);
    const x = cx + rx * Math.cos(t);
    const y = cy + ry * Math.sin(t);
    points.push({ x, y });
  }
  return points;
}

export function SpeechBubbleRenderer({ bubble }: { bubble: BubbleData }) {
  const [dimensions, setDimensions] = useState({ w: 120, h: 50 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setDimensions({ w: rect.width, h: rect.height });
      }
    }
  }, [bubble.text, bubble.style]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const style = window.getComputedStyle(el);
        const padX = parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0');
        const padY = parseFloat(style.paddingTop || '0') + parseFloat(style.paddingBottom || '0');
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
  const style = bubble.style || 'classic';

  const tailX = bubble.tailX !== undefined ? bubble.tailX : (style === 'freehand' ? 15 : W * 0.15);
  const tailY = bubble.tailY !== undefined ? bubble.tailY : (style === 'freehand' ? 120 : H + 30);

  let dPath = '';

  if (style === 'action') {
    const cx = W / 2;
    const cy = H / 2;
    const pointsCount = 32;
    const rawPoints: { x: number; y: number }[] = [];
    for (let i = 0; i < pointsCount; i++) {
      const theta = (i / pointsCount) * 2 * Math.PI;
      const isEven = i % 2 === 0;
      const wave = 0.03 * Math.sin(theta * 6);
      const factor = isEven ? (0.84 + wave) : (1.20 + wave);
      const px = cx + (W / 2) * Math.cos(theta) * factor;
      const py = cy + (H / 2) * Math.sin(theta) * factor;
      rawPoints.push({ x: px, y: py });
    }

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
      if (idx === baseStartIdx) break;
    }
    finalPoints.push({ x: tailX, y: tailY });

    dPath = finalPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
  } else if (style === 'freehand') {
    const cx = W / 2;
    const cy = H / 2;

    let normPoints = bubble.points;
    if (!normPoints || normPoints.length < 3) {
      normPoints = generateDefaultSpeechBubblePoints();
    }

    const smoothedNorm = chaikinSmooth(normPoints, 3);
    const bodyPts = smoothedNorm.map((p) => ({
      x: (p.x / 100) * W,
      y: (p.y / 100) * H,
    }));

    const N = bodyPts.length;
    const tailPxX = (tailX / 100) * W;
    const tailPxY = (tailY / 100) * H;

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
  } else {
    // Classic rectangular comic bubble with corner-snapped tail
    const cx = W / 2;
    const cy = H / 2;
    const dx = tailX - cx;
    const dy = tailY - cy;
    const slope = H / W;
    let side: 'top' | 'bottom' | 'left' | 'right' = 'bottom';

    if (Math.abs(dy) > Math.abs(dx) * slope) {
      side = dy > 0 ? 'bottom' : 'top';
    } else {
      side = dx > 0 ? 'right' : 'left';
    }

    const halfBase = Math.max(8, Math.min(W, H) * 0.12);
    let B1 = { x: 0, y: 0 };
    let B2 = { x: 0, y: 0 };

    if (side === 'bottom') {
      const C = Math.max(halfBase + 4, Math.min(W - halfBase - 4, tailX));
      B1 = { x: C - halfBase, y: H };
      B2 = { x: C + halfBase, y: H };
    } else if (side === 'top') {
      const C = Math.max(halfBase + 4, Math.min(W - halfBase - 4, tailX));
      B1 = { x: C + halfBase, y: 0 };
      B2 = { x: C - halfBase, y: 0 };
    } else if (side === 'left') {
      const C = Math.max(halfBase + 4, Math.min(H - halfBase - 4, tailY));
      B1 = { x: 0, y: C - halfBase };
      B2 = { x: 0, y: C + halfBase };
    } else if (side === 'right') {
      const C = Math.max(halfBase + 4, Math.min(H - halfBase - 4, tailY));
      B1 = { x: W, y: C + halfBase };
      B2 = { x: W, y: C - halfBase };
    }

    const pts: { x: number; y: number }[] = [];

    if (side === 'top') {
      pts.push({ x: 0, y: 0 }, B2, { x: tailX, y: tailY }, B1, { x: W, y: 0 });
    } else {
      pts.push({ x: 0, y: 0 }, { x: W, y: 0 });
    }

    if (side === 'right') {
      pts.push(B2, { x: tailX, y: tailY }, B1, { x: W, y: H });
    } else {
      pts.push({ x: W, y: H });
    }

    if (side === 'bottom') {
      pts.push(B2, { x: tailX, y: tailY }, B1, { x: 0, y: H });
    } else {
      pts.push({ x: 0, y: H });
    }

    if (side === 'left') {
      pts.push(B2, { x: tailX, y: tailY }, B1, { x: 0, y: 0 });
    } else {
      pts.push({ x: 0, y: 0 });
    }

    dPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
  }

  return (
    <div className="relative pointer-events-none select-none">
      <svg className="absolute inset-0 w-full h-full -z-10" style={{ overflow: 'visible' }}>
        <path
          d={dPath}
          fill="#ffffff"
          stroke="#000000"
          strokeWidth={style === 'freehand' ? 2.5 : 1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div
        ref={containerRef}
        className={cn(
          "text-xs break-words text-center min-w-[60px] max-w-[180px] whitespace-pre-wrap outline-none font-semibold select-none",
          style === 'action'
            ? "font-extrabold uppercase text-black py-4 px-6"
            : style === 'freehand'
            ? "text-black py-5 px-7 italic font-sans leading-tight"
            : "text-black py-2.5 px-4"
        )}
      >
        {bubble.text}
      </div>
    </div>
  );
}

/**
 * Recursive renderer for Comic Tree Nodes (PanelNode and SplitNode)
 * Structurally and visually identical to ComicCanvas.tsx
 */
export function ComicTreeNodeView({ node }: { node: TreeNode | any }) {
  if (!node) return <div className="w-full h-full bg-white" />;

  if (node.type === 'panel') {
    let imgUrl = node.imageUrl || node.drawing || node.bgImageUrl || node.image;
    if (!imgUrl && Array.isArray(node.drawings) && node.drawings.length > 0) {
      const strokeImg = node.drawings.find((d: any) => d && d.imageUrl && typeof d.imageUrl === 'string' && d.imageUrl.trim() !== '');
      if (strokeImg) imgUrl = strokeImg.imageUrl;
    }

    const hasImage = !!(imgUrl && typeof imgUrl === 'string' && imgUrl.trim() !== '');
    const hasDrawings = Array.isArray(node.drawings) && node.drawings.length > 0;
    const hasLegacyDrawing = !!(node.drawing && typeof node.drawing === 'string' && node.drawing.trim() !== '');
    const hasContent = hasImage || hasDrawings || hasLegacyDrawing;

    const isContrast = !!node.isHighContrast;
    const hasOutline = !!node.hasOutline;
    const outlineColor = node.color || '#000000';
    const bgColor = node.bgColor || node.color || node.bg || '#ffffff';

    return (
      <div className="w-full h-full bg-white relative overflow-hidden flex items-center justify-center p-[2px] min-w-0 min-h-0">
        <div
          className={cn(
            "w-full h-full bg-white relative overflow-hidden flex items-center justify-center min-w-0 min-h-0",
            hasContent ? "border border-zinc-900" : "border-none"
          )}
          style={{ backgroundColor: bgColor }}
        >
          {imgUrl ? (
            <div
              className={cn(
                "w-full h-full relative overflow-hidden",
                isContrast && "contrast-[1.25] grayscale"
              )}
              style={hasOutline ? { border: `2px solid ${outlineColor}`, boxSizing: 'border-box' } : undefined}
            >
              <img
                src={imgUrl}
                alt="Comic Panel"
                className={cn(
                  "w-full h-full object-cover select-none pointer-events-none bg-white",
                  isContrast && "contrast-[1.25] grayscale"
                )}
                referrerPolicy="no-referrer"
              />
            </div>
          ) : (
            <div className="w-full h-full bg-white" />
          )}

          {/* Freehand vector drawings layer */}
          {hasDrawings && (
            <svg
              className="absolute inset-0 w-full h-full z-10 pointer-events-none"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {node.drawings.map((s: Stroke) => {
                if (!s) return null;
                if (s.type === 'fill' && s.imageUrl && s.bounds) {
                  return (
                    <image
                      key={s.id}
                      href={s.imageUrl}
                      x={s.bounds.x}
                      width={s.bounds.w}
                      y={s.bounds.y}
                      height={s.bounds.h}
                      preserveAspectRatio="none"
                    />
                  );
                }
                if (!s.points || s.points.length === 0) return null;
                const d = getSvgPathFromPoints(s.points, s.brushRadius || 2);
                if (!d) return null;
                return <path key={s.id} d={d} fill={s.color || '#000000'} />;
              })}
            </svg>
          )}

          {/* Legacy drawing overlay */}
          {node.drawing && typeof node.drawing === 'string' && (
            <img
              src={node.drawing}
              alt=""
              className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none bg-transparent"
              referrerPolicy="no-referrer"
            />
          )}
        </div>
      </div>
    );
  }

  if (node.type === 'split') {
    const isRow = node.dir === 'row' || node.dir === 'h' || node.dir === 'horizontal' || node.direction === 'horizontal';
    const percent = typeof node.percent === 'number' ? node.percent : (typeof node.splitRatio === 'number' ? node.splitRatio : 50);
    const c1 = node.c1 || node.left;
    const c2 = node.c2 || node.right;

    return (
      <div className={cn("relative flex w-full h-full min-w-0 min-h-0 bg-white", isRow ? "flex-row" : "flex-col")}>
        <div style={{ [isRow ? 'width' : 'height']: `${percent}%` }} className="relative min-w-0 min-h-0 overflow-hidden bg-white">
          <ComicTreeNodeView node={c1} />
        </div>
        <div style={{ [isRow ? 'width' : 'height']: `${100 - percent}%` }} className="relative min-w-0 min-h-0 overflow-hidden bg-white">
          <ComicTreeNodeView node={c2} />
        </div>
      </div>
    );
  }

  return <div className="w-full h-full bg-white" />;
}

/**
 * Unified Full Comic Page Viewer Component
 * Accurately replicates the 3:4 aspect-ratio geometry, panel borders, split layout,
 * drawing strokes, and speech bubbles exactly as rendered on the Create canvas.
 */
export const ComicPageRenderer: React.FC<{
  page: ComicPageData | string | null;
  className?: string;
  showShadow?: boolean;
}> = ({ page, className, showShadow = true }) => {
  if (!page) {
    return (
      <div className={cn("relative max-h-full max-w-full inline-flex justify-center items-center h-full", className)}>
        <svg viewBox="0 0 3 4" className="block h-full max-w-full max-h-full w-auto opacity-0 pointer-events-none" />
        <div className="absolute top-0 left-0 w-full h-full bg-white ring-1 ring-border flex items-center justify-center text-xs text-muted-foreground">
          No Comic Page Content
        </div>
      </div>
    );
  }

  // Handle flat single image page (e.g. uploaded CBZ/JPG or rendered cover)
  if (typeof page === 'string') {
    return (
      <div className={cn("relative max-h-full max-w-full inline-flex justify-center items-center h-full", className)}>
        <svg viewBox="0 0 3 4" className="block h-full max-w-full max-h-full w-auto opacity-0 pointer-events-none" />
        <div className={cn("absolute top-0 left-0 w-full h-full bg-white ring-1 ring-border overflow-hidden", showShadow && "shadow-2xl")}>
          <img
            src={page}
            alt="Comic Page"
            className="w-full h-full object-contain pointer-events-auto select-none bg-white"
            referrerPolicy="no-referrer"
          />
        </div>
      </div>
    );
  }

  const hasTree = !!page.tree;
  const flatCover = page.cover || page.imageUrl || page.image || page.url;

  return (
    <div className={cn("relative max-h-full max-w-full inline-flex justify-center items-center h-full pointer-events-auto", className)}>
      {/* 3:4 Aspect ratio locking SVG */}
      <svg viewBox="0 0 3 4" className="block h-full max-w-full max-h-full w-auto opacity-0 pointer-events-none" />

      {/* Comic Page Canvas Root */}
      <div className={cn("absolute top-0 left-0 w-full h-full bg-white ring-1 ring-border overflow-hidden select-none", showShadow && "shadow-2xl")}>
        {hasTree ? (
          <div className="w-full h-full bg-white relative select-none">
            <ComicTreeNodeView node={page.tree} />
          </div>
        ) : flatCover ? (
          <img
            src={flatCover}
            alt="Comic Cover"
            className="w-full h-full object-contain pointer-events-auto select-none bg-white"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-full h-full bg-white flex items-center justify-center text-xs text-muted-foreground font-mono">
            Empty Comic Page
          </div>
        )}

        {/* Speech Bubbles Overlay Layer */}
        {Array.isArray(page.bubbles) && page.bubbles.map((bubble, bIdx) => {
          if (!bubble || !bubble.text) return null;
          const posX = typeof bubble.x === 'number' ? bubble.x : 20;
          const posY = typeof bubble.y === 'number' ? bubble.y : 20;

          return (
            <div
              key={bubble.id || bIdx}
              className="absolute z-20 pointer-events-none transform -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${posX}%`,
                top: `${posY}%`,
              }}
            >
              <SpeechBubbleRenderer bubble={bubble} />
            </div>
          );
        })}
      </div>
    </div>
  );
};
