import React, { useRef, useEffect, useState, useLayoutEffect, useCallback, useMemo } from 'react';
import { Point, Stroke } from '../ComicCanvas';
import { ComicLayer, ComicLayerGroup } from './drawingTypes';

export const PRECISE_CROSSHAIR_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='21' height='21' viewBox='0 0 21 21'%3E%3Ccircle cx='10.5' cy='10.5' r='1.5' fill='%23000000'/%3E%3Cpath d='M10.5 1v6M10.5 14v6M1 10.5h6M14 10.5h6' stroke='%23ffffff' stroke-width='3' stroke-linecap='square'/%3E%3Cpath d='M10.5 1v6M10.5 14v6M1 10.5h6M14 10.5h6' stroke='%23000000' stroke-width='1.2' stroke-linecap='square'/%3E%3C/svg%3E") 10 10, crosshair`;

export const FILL_BUCKET_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z' fill='white'/%3E%3Cpath d='m5 2 5 5'/%3E%3Cpath d='M2 13h15'/%3E%3Cpath d='M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z' fill='black'/%3E%3C/svg%3E") 3 21, crosshair`;

interface RasterDrawingCanvasProps {
  drawings: Stroke[];
  onChange: (d: Stroke[]) => void;
  isDrawingMode: boolean;
  drawTool: 'pen' | 'erase' | 'select' | 'fill';
  eraserType?: 'stroke' | 'pixel';
  drawColor: string;
  drawRadius: number;
  touchOff?: boolean;
  setTouchOff?: (val: boolean) => void;
  aspectRatio?: number;
  panelBox?: { x: number; y: number; w: number; h: number };
  isExpanded?: boolean;
  layers?: ComicLayer[];
  activeLayerId?: string;
  layerGroups?: ComicLayerGroup[];
  backgroundColor?: string;
}

interface CanvasBuffer {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
}

/**
 * Creates an OffscreenCanvas or fallback HTMLCanvasElement
 */
function createBuffer(width: number, height: number): CanvasBuffer {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    return { canvas, ctx };
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  return { canvas, ctx };
}

/**
 * High-Performance Raster Drawing Canvas
 * - Responsive 1:1 screen-to-canvas coordinate synchronization
 * - Near-zero latency stroke tracking with zero rubber-band cursor drift
 * - Boundary-checked flood fill (never fills open canvas / outside closed shapes)
 * - Multi-layer compositing with opacity and background color support
 */
const globalImageCache = new Map<string, HTMLImageElement>();


function getSelectionBounds(strokes: Stroke[], selectedIds: Set<string>, width: number, height: number) {
  let minX = 1000, minY = 1000, maxX = -1000, maxY = -1000;
  let hasValid = false;
  strokes.forEach(s => {
    if (!selectedIds.has(s.id)) return;
    if (s.type === 'fill' && s.bounds) {
      if (s.bounds.x < minX) minX = s.bounds.x;
      if (s.bounds.x + s.bounds.w > maxX) maxX = s.bounds.x + s.bounds.w;
      if (s.bounds.y < minY) minY = s.bounds.y;
      if (s.bounds.y + s.bounds.h > maxY) maxY = s.bounds.y + s.bounds.h;
      hasValid = true;
    } else if (s.points && s.points.length > 0) {
      const r = s.brushRadius || 2;
      const aspect = width / height;
      s.points.forEach(p => {
        if (p.x - r < minX) minX = p.x - r;
        if (p.x + r > maxX) maxX = p.x + r;
        if (p.y - r * aspect < minY) minY = p.y - r * aspect;
        if (p.y + r * aspect > maxY) maxY = p.y + r * aspect;
      });
      hasValid = true;
    }
  });
  if (!hasValid) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function transformStrokes(strokes: Stroke[], startBounds: {x:number, y:number, w:number, h:number}, currentBounds: {x:number, y:number, w:number, h:number}): Stroke[] {
  if (startBounds.w === 0 || startBounds.h === 0) return strokes;
  const scaleX = currentBounds.w / startBounds.w;
  const scaleY = currentBounds.h / startBounds.h;
  const dx = currentBounds.x - startBounds.x * scaleX;
  const dy = currentBounds.y - startBounds.y * scaleY;
  
  return strokes.map(s => {
    if (s.type === 'fill' && s.bounds) {
      return {
        ...s,
        bounds: {
          x: s.bounds.x * scaleX + dx,
          y: s.bounds.y * scaleY + dy,
          w: s.bounds.w * scaleX,
          h: s.bounds.h * scaleY
        }
      };
    } else if (s.points) {
      return {
        ...s,
        points: s.points.map(p => ({
          x: p.x * scaleX + dx,
          y: p.y * scaleY + dy
        })),
        brushRadius: s.brushRadius ? s.brushRadius * Math.max(scaleX, scaleY) : undefined
      };
    }
    return s;
  });
}

export const RasterDrawingCanvas: React.FC<RasterDrawingCanvasProps> = ({
  drawings,
  onChange,
  isDrawingMode,
  drawTool,
  eraserType = 'pixel',
  drawColor,
  drawRadius,
  touchOff = false,
  setTouchOff,
  aspectRatio,
  panelBox,
  isExpanded = false,
  layers,
  activeLayerId = 'layer-1',
  layerGroups = [],
  backgroundColor = '#ffffff',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);

  // Raster memory buffer holding baked artwork (OffscreenCanvas or Canvas)
  const layerBufferRef = useRef<CanvasBuffer | null>(null);

  // Lightweight drafting buffer for active in-progress stroke (OffscreenCanvas or Canvas)
  const tempBufferRef = useRef<CanvasBuffer | null>(null);

  // Active stroke state
  const activeStrokeRef = useRef<Stroke | null>(null);
  const isPointerDownRef = useRef<boolean>(false);
  const lastPenTimeRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);

  // Hover cursor ring position
  const [hoverPt, setHoverPt] = useState<Point | null>(null);

  // Selection state
  
  const transformStateRef = useRef<{
    active: boolean;
    mode: 'move' | 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r';
    startPt: Point;
    startBounds: { x: number, y: number, w: number, h: number };
    currentBounds: { x: number, y: number, w: number, h: number };
    strokes: Stroke[];
  } | null>(null);
  
  const hitTestSelection = (pt: Point) => {
    if (selectedIds.size === 0 || drawTool !== 'select') return null;
    const bounds = transformStateRef.current
      ? transformStateRef.current.currentBounds
      : getSelectionBounds(drawings, selectedIds, dimensions.width, dimensions.height);
    if (!bounds) return null;
    
    // Hit-radius in percentage units (~14px target area)
    const rx = 1400 / Math.max(1, dimensions.width);
    const ry = 1400 / Math.max(1, dimensions.height);
    const { x, y, w, h } = bounds;
    const mx = x + w / 2;
    const my = y + h / 2;
    
    // 4 Corners: tl, tr, bl, br
    if (Math.abs(pt.x - x) <= rx && Math.abs(pt.y - y) <= ry) return 'tl';
    if (Math.abs(pt.x - (x + w)) <= rx && Math.abs(pt.y - y) <= ry) return 'tr';
    if (Math.abs(pt.x - x) <= rx && Math.abs(pt.y - (y + h)) <= ry) return 'bl';
    if (Math.abs(pt.x - (x + w)) <= rx && Math.abs(pt.y - (y + h)) <= ry) return 'br';
    
    // 4 Edge Midpoints: t, b, l, r
    if (Math.abs(pt.x - mx) <= rx && Math.abs(pt.y - y) <= ry) return 't';
    if (Math.abs(pt.x - mx) <= rx && Math.abs(pt.y - (y + h)) <= ry) return 'b';
    if (Math.abs(pt.x - x) <= rx && Math.abs(pt.y - my) <= ry) return 'l';
    if (Math.abs(pt.x - (x + w)) <= rx && Math.abs(pt.y - my) <= ry) return 'r';
    
    // Interior -> Move
    if (pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h) return 'move';
    return null;
  };

  const [lassoPath, setLassoPathState] = useState<Point[] | null>(null);
  const lassoPathRef = useRef<Point[] | null>(null);
  const setLassoPath = useCallback((val: Point[] | null | ((prev: Point[] | null) => Point[] | null)) => {
    if (typeof val === 'function') {
      lassoPathRef.current = val(lassoPathRef.current);
    } else {
      lassoPathRef.current = val;
    }
    setLassoPathState(lassoPathRef.current);
  }, []);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Track baked drawings count to avoid unnecessary re-baking
  const lastDrawingsRef = useRef<Stroke[]>([]);
  const lastLayersRef = useRef<ComicLayer[] | undefined>(undefined);
  const lastBgColorRef = useRef<string>(backgroundColor);

  // Dimension tracking using layout pixels
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: 600,
    height: 800,
  });

  // Observe container size accurately using clientWidth / clientHeight to avoid CSS transform scaling bugs
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const width = el.clientWidth || Math.round(el.getBoundingClientRect().width);
      const height = el.clientHeight || Math.round(el.getBoundingClientRect().height);
      if (width > 0 && height > 0) {
        setDimensions({
          width,
          height,
        });
      }
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Point helper in percentage [0..100] directly mapped to bounding client rect
  const getPt = useCallback((e: React.PointerEvent | PointerEvent): Point => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };

    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    const pressure =
      e.pointerType === 'pen' && e.pressure && e.pressure > 0
        ? e.pressure
        : 0.5;

    return {
      x,
      y,
      pressure,
      pointerType: e.pointerType,
      tiltX: e.tiltX,
      tiltY: e.tiltY,
    };
  }, []);

  const COMIC_PAGE_ASPECT = 0.75;
  const CANONICAL_BASE_RES = 2000;

  // Derive fixed panel aspect ratio from panelBox or aspectRatio prop
  const safeAspect = useMemo(() => {
    if (panelBox && panelBox.w > 0 && panelBox.h > 0) {
      return (panelBox.w / panelBox.h) * COMIC_PAGE_ASPECT;
    }
    if (aspectRatio && aspectRatio > 0) {
      return aspectRatio;
    }
    return COMIC_PAGE_ASPECT;
  }, [panelBox?.w, panelBox?.h, aspectRatio]);

  // Fixed canonical resolution for internal OffscreenCanvas buffers
  // This resolution depends ONLY on the panel's aspect ratio and NEVER changes
  // between Normal View and Full Panel mode.
  const canonicalResolution = useMemo(() => {
    const aspect = safeAspect > 0 ? safeAspect : 0.75;
    let width: number;
    let height: number;
    if (aspect >= 1) {
      width = CANONICAL_BASE_RES;
      height = Math.max(10, Math.round(CANONICAL_BASE_RES / aspect));
    } else {
      width = Math.max(10, Math.round(CANONICAL_BASE_RES * aspect));
      height = CANONICAL_BASE_RES;
    }
    return { width, height };
  }, [safeAspect]);

  const { width: canonicalWidth, height: canonicalHeight } = canonicalResolution;

  // Canonical stroke radius calculation relative to the main 4:3 page
  // The main canvas is a 4:3 page with nominal width 1000 units.
  // drawRadius represents stroke diameter on the page.
  // A panel has width boxW (% of page width).
  // In the panel's 0..100% coordinate space:
  // radiusInPanel = (drawRadius / (1000 * (boxW / 100))) * 100 * 100 = (drawRadius * 10) / boxW
  const boxW = panelBox && panelBox.w > 0 ? panelBox.w : 100;
  const currentRadiusInPanel = (drawRadius * 10) / boxW;

  const getActualRadius = useCallback(() => {
    return currentRadiusInPanel;
  }, [currentRadiusInPanel]);

  const drawMainFrameRef = useRef<() => void>(() => {});
  // Request render to main display canvas
  const requestRender = useCallback(() => {
    if (rafIdRef.current) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      drawMainFrameRef.current();
    });
  }, []);

  // Composite layers and temp buffer to main screen canvas
  const drawMainFrame = () => {

    const mainCanvas = mainCanvasRef.current;
    if (!mainCanvas) return;
    const ctx = mainCanvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = dimensions;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const pixelW = Math.max(1, Math.round(width * dpr));
    const pixelH = Math.max(1, Math.round(height * dpr));

    if (mainCanvas.width !== pixelW || mainCanvas.height !== pixelH) {
      mainCanvas.width = pixelW;
      mainCanvas.height = pixelH;
      mainCanvas.style.width = '100%';
      mainCanvas.style.height = '100%';
    }

    ctx.clearRect(0, 0, pixelW, pixelH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 1. Render baked artwork buffer (scaled from canonical coordinates to display resolution)
    const layerBuf = layerBufferRef.current;
    if (layerBuf) {
      ctx.drawImage(
        layerBuf.canvas as CanvasImageSource,
        0, 0, layerBuf.canvas.width, layerBuf.canvas.height,
        0, 0, pixelW, pixelH
      );
    }

    // 2. Render drafting tempBuffer (in-progress stroke) with EXACT same transformation
    const tempBuf = tempBufferRef.current;
    if (tempBuf && ((isPointerDownRef.current && activeStrokeRef.current) || transformStateRef.current)) {
      ctx.drawImage(
        tempBuf.canvas as CanvasImageSource,
        0, 0, tempBuf.canvas.width, tempBuf.canvas.height,
        0, 0, pixelW, pixelH
      );
    }

    // 3. Render lasso selection overlay if active
    if (lassoPath && lassoPath.length > 1 && isDrawingMode && drawTool === 'select') {
      ctx.save();
      ctx.strokeStyle = '#3b82f6';
      ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      for (let i = 0; i < lassoPath.length; i++) {
        const p = lassoPath[i];
        const px = (p.x / 100) * pixelW;
        const py = (p.y / 100) * pixelH;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      if (!isPointerDownRef.current) ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    }

    // 4. Render selected items bounds & 8 interactive handles
    if (selectedIds.size > 0 && isDrawingMode && drawTool === 'select') {
      const bounds = transformStateRef.current ? transformStateRef.current.currentBounds : getSelectionBounds(drawings, selectedIds, dimensions.width, dimensions.height);
      
      if (bounds) {
        ctx.save();
        const bx = (bounds.x / 100) * pixelW;
        const by = (bounds.y / 100) * pixelH;
        const bw = (bounds.w / 100) * pixelW;
        const bh = (bounds.h / 100) * pixelH;
        
        // Subtle interior tint to clearly indicate draggable selection plane
        ctx.fillStyle = 'rgba(59, 130, 246, 0.05)';
        ctx.fillRect(bx, by, bw, bh);

        // Bounding box dashed border
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.strokeRect(bx, by, bw, bh);
        
        // 8 Interactive handles (4 corners + 4 edge midpoints)
        ctx.setLineDash([]);
        const hSize = 4 * dpr; // 8px square
        const drawHandle = (hx: number, hy: number) => {
          ctx.save();
          ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
          ctx.shadowBlur = 3 * dpr;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 1 * dpr;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(hx - hSize, hy - hSize, hSize * 2, hSize * 2);
          ctx.restore();

          ctx.strokeStyle = '#2563eb';
          ctx.lineWidth = 1.5 * dpr;
          ctx.strokeRect(hx - hSize, hy - hSize, hSize * 2, hSize * 2);
        };
        
        // 4 Corner points
        drawHandle(bx, by);                   // Top-Left (tl)
        drawHandle(bx + bw, by);              // Top-Right (tr)
        drawHandle(bx, by + bh);              // Bottom-Left (bl)
        drawHandle(bx + bw, by + bh);         // Bottom-Right (br)

        // 4 Edge midpoints
        drawHandle(bx + bw / 2, by);          // Top-Center (t)
        drawHandle(bx + bw / 2, by + bh);     // Bottom-Center (b)
        drawHandle(bx, by + bh / 2);          // Middle-Left (l)
        drawHandle(bx + bw, by + bh / 2);     // Middle-Right (r)
        
        ctx.restore();
      }
    }
  };
  drawMainFrameRef.current = drawMainFrame;


  // Helper to bake all strokes onto a 2D context respecting layers and background color
  const bakeAllDrawings = useCallback((
    strokes: Stroke[],
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    bufW: number,
    bufH: number
  ) => {
    ctx.clearRect(0, 0, bufW, bufH);

    // If layers are configured, render by layer stack
    if (layers && layers.length > 0) {
      // Find background layer (Skip rendering background here so it's transparent, letting parent panel image/color show through)
      const bgLayer = layers.find((l) => l.isBackground);

      // Group visibility mapping
      const hiddenGroups = new Set(
        layerGroups.filter((g) => g.visible === false).map((g) => g.id)
      );

      // Render regular layers from bottom to top
      for (const layer of layers) {
        if (layer.isBackground) continue;
        if (layer.visible === false) continue;
        if (layer.groupId && hiddenGroups.has(layer.groupId)) continue;

        ctx.save();
        ctx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1;

        // Filter strokes belonging to this layer
        const layerStrokes = strokes.filter(
          (s) => s.layerId === layer.id || (!s.layerId && layer.id === 'layer-1')
        );

        for (const stroke of layerStrokes) {
          if (stroke.type === 'fill' && stroke.imageUrl && stroke.bounds) {
            const drawImg = (img: HTMLImageElement) => {
              const bx = (stroke.bounds!.x / 100) * bufW;
              const by = (stroke.bounds!.y / 100) * bufH;
              const bw = (stroke.bounds!.w / 100) * bufW;
              const bh = (stroke.bounds!.h / 100) * bufH;
              ctx.drawImage(img, bx, by, bw, bh);
            };
            
            const cachedImg = globalImageCache.get(stroke.imageUrl);
            if (cachedImg && cachedImg.complete && cachedImg.naturalWidth > 0) {
              drawImg(cachedImg);
            } else {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.onload = () => {
                globalImageCache.set(stroke.imageUrl!, img);
                drawImg(img);
                requestRender();
              };
              img.src = stroke.imageUrl;
            }
          } else if (stroke.points && stroke.points.length > 0) {
            renderStrokeToCtx(
              ctx,
              stroke.points,
              stroke.brushRadius,
              stroke.color,
              stroke.type === 'erase',
              bufW,
              bufH
            );
          }
        }
        ctx.restore();
      }
    } else {
      // Single layer fallback
      for (const stroke of strokes) {
        if (stroke.type === 'fill' && stroke.imageUrl && stroke.bounds) {
          const drawImg = (img: HTMLImageElement) => {
            const bx = (stroke.bounds!.x / 100) * bufW;
            const by = (stroke.bounds!.y / 100) * bufH;
            const bw = (stroke.bounds!.w / 100) * bufW;
            const bh = (stroke.bounds!.h / 100) * bufH;
            ctx.drawImage(img, bx, by, bw, bh);
          };
          
          const cachedImg = globalImageCache.get(stroke.imageUrl);
          if (cachedImg && cachedImg.complete && cachedImg.naturalWidth > 0) {
            drawImg(cachedImg);
          } else {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              globalImageCache.set(stroke.imageUrl!, img);
              drawImg(img);
              requestRender();
            };
            img.src = stroke.imageUrl;
          }
        } else if (stroke.points && stroke.points.length > 0) {
          renderStrokeToCtx(
            ctx,
            stroke.points,
            stroke.brushRadius,
            stroke.color,
            stroke.type === 'erase',
            bufW,
            bufH
          );
        }
      }
    }
  }, [layers, layerGroups, backgroundColor, requestRender]);

  // Render a stroke with exact 1:1 cursor alignment and smooth rounded joints
  const renderStrokeToCtx = (
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    points: Point[],
    radius: number,
    color: string,
    isEraser: boolean,
    bufW: number,
    bufH: number
  ) => {
    if (points.length === 0) return;

    ctx.save();
    if (isEraser) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000000';
      ctx.strokeStyle = '#000000';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
    }

    // Diameter of stroke in buffer pixels
    const pixelDiameter = Math.max(1, (radius / 100) * bufW);

    if (points.length === 1) {
      const p = points[0];
      const px = (p.x / 100) * bufW;
      const py = (p.y / 100) * bufH;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0.5, pixelDiameter / 2), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    ctx.lineWidth = pixelDiameter;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    const p0 = points[0];
    const px0 = (p0.x / 100) * bufW;
    const py0 = (p0.y / 100) * bufH;
    ctx.moveTo(px0, py0);

    if (points.length === 2) {
      const p1 = points[1];
      ctx.lineTo((p1.x / 100) * bufW, (p1.y / 100) * bufH);
    } else {
      for (let i = 1; i < points.length - 1; i++) {
        const pi = points[i];
        const piNext = points[i + 1];
        const xi = (pi.x / 100) * bufW;
        const yi = (pi.y / 100) * bufH;
        const xNext = (piNext.x / 100) * bufW;
        const yNext = (piNext.y / 100) * bufH;
        const midX = (xi + xNext) / 2;
        const midY = (yi + yNext) / 2;
        ctx.quadraticCurveTo(xi, yi, midX, midY);
      }
      const pLast = points[points.length - 1];
      ctx.lineTo((pLast.x / 100) * bufW, (pLast.y / 100) * bufH);
    }

    ctx.stroke();
    ctx.restore();
  };

  // Initialize and maintain layer and temp OffscreenCanvas buffers.
  // Buffers are ONLY created or re-allocated when canonicalResolution changes.
  // View mode changes (Normal View vs Full Panel mode) or window resizing NEVER re-allocate
  // or modify layer resolutions or stroke coordinates.
  useEffect(() => {
    if (canonicalWidth <= 0 || canonicalHeight <= 0) return;

    if (!layerBufferRef.current) {
      layerBufferRef.current = createBuffer(canonicalWidth, canonicalHeight);
      tempBufferRef.current = createBuffer(canonicalWidth, canonicalHeight);
      bakeAllDrawings(drawings, layerBufferRef.current.ctx, canonicalWidth, canonicalHeight);
      lastDrawingsRef.current = drawings;
      lastLayersRef.current = layers;
      lastBgColorRef.current = backgroundColor;
    } else {
      const currentCanvas = layerBufferRef.current.canvas;
      if (currentCanvas.width !== canonicalWidth || currentCanvas.height !== canonicalHeight) {
        // Aspect ratio structure changed: resize existing buffers to avoid rapid re-allocations that cause GC flashes
        layerBufferRef.current.canvas.width = canonicalWidth;
        layerBufferRef.current.canvas.height = canonicalHeight;
        if (tempBufferRef.current) {
          tempBufferRef.current.canvas.width = canonicalWidth;
          tempBufferRef.current.canvas.height = canonicalHeight;
        } else {
          tempBufferRef.current = createBuffer(canonicalWidth, canonicalHeight);
        }
        bakeAllDrawings(drawings, layerBufferRef.current.ctx, canonicalWidth, canonicalHeight);
        lastDrawingsRef.current = drawings;
      }
    }

    // Ensure tempBuffer resolution strictly matches layerBuffer resolution
    if (!tempBufferRef.current) {
      tempBufferRef.current = createBuffer(canonicalWidth, canonicalHeight);
    } else if (
      tempBufferRef.current.canvas.width !== canonicalWidth ||
      tempBufferRef.current.canvas.height !== canonicalHeight
    ) {
      tempBufferRef.current.canvas.width = canonicalWidth;
      tempBufferRef.current.canvas.height = canonicalHeight;
    }

    requestRender();
  }, [canonicalWidth, canonicalHeight, bakeAllDrawings, drawings, layers, backgroundColor, requestRender]);

  // When dimensions change (e.g. Normal View vs Full Panel switch, window resize, zoom):
  // Re-composite existing canonical buffers onto mainCanvas at the new screen dimensions.
  // DO NOT touch layerBuffer or tempBuffer resolution.
  useEffect(() => {
    requestRender();
  }, [dimensions, requestRender]);

  // Re-bake when drawings, layers, or background color change externally
  useEffect(() => {
    if (
      drawings !== lastDrawingsRef.current ||
      layers !== lastLayersRef.current ||
      backgroundColor !== lastBgColorRef.current
    ) {
      lastDrawingsRef.current = drawings;
      lastLayersRef.current = layers;
      lastBgColorRef.current = backgroundColor;
      const buf = layerBufferRef.current;
      if (buf) {
        bakeAllDrawings(drawings, buf.ctx, buf.canvas.width, buf.canvas.height);
        requestRender();
      }
    }
  }, [drawings, layers, backgroundColor, bakeAllDrawings, requestRender]);

  // Trigger render when lasso or selection changes
  useEffect(() => {
    requestRender();
  }, [lassoPath, selectedIds, requestRender]);


  /**
   * Flood Fill Implementation
   * STRICT REQUIREMENT: Remove the function from the Fill tool to fill the entire canvas by filling the outside of closed stroke shapes.
   * If the fill hits the canvas perimeter/edges, it aborts immediately with zero modifications!
   */
  const handleFillClick = (pt: Point) => {
    const layerBuf = layerBufferRef.current;
    if (!layerBuf) return;
    const { canvas, ctx } = layerBuf;
    const w = canvas.width;
    const h = canvas.height;

    const startX = Math.round((pt.x / 100) * w);
    const startY = Math.round((pt.y / 100) * h);
    if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // Parse fill color
    const hex = drawColor.replace('#', '');
    const fr = parseInt(hex.substring(0, 2), 16) || 0;
    const fg = parseInt(hex.substring(2, 4), 16) || 0;
    const fb = parseInt(hex.substring(4, 6), 16) || 0;
    const fa = 255;

    const startIdx = (startY * w + startX) * 4;
    const targetR = data[startIdx];
    const targetG = data[startIdx + 1];
    const targetB = data[startIdx + 2];
    const targetA = data[startIdx + 3];

    // If filling with the same color, abort
    if (Math.abs(targetR - fr) < 5 && Math.abs(targetG - fg) < 5 && Math.abs(targetB - fb) < 5 && Math.abs(targetA - fa) < 5) return;

    const colorMatch = (idx) => {
      const dr = data[idx] - targetR;
      const dg = data[idx + 1] - targetG;
      const db = data[idx + 2] - targetB;
      const da = data[idx + 3] - targetA;
      return (dr * dr + dg * dg + db * db + da * da) < 4000;
    };

    // Flood fill traversal
    const visited = new Uint8Array(w * h);
    const queue = [startX, startY];
    visited[startY * w + startX] = 1;

    const filledPixels = [];
    let reachedEdge = false;

    let minX = startX, maxX = startX, minY = startY, maxY = startY;

    while (queue.length > 0) {
      const cy = queue.pop()!;
      const cx = queue.pop()!;

      // BOUNDARY CHECK:
      // If the flood touches any boundary/perimeter of the canvas, the click was in the open canvas / outside closed shapes!
      // ABORT immediately so the entire canvas is NEVER filled!
      if (cx <= 1 || cx >= w - 2 || cy <= 1 || cy >= h - 2) {
        reachedEdge = true;
        break;
      }

      filledPixels.push(cx, cy);
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;

      const neighbors = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1],
      ];

      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
          reachedEdge = true;
          break;
        }
        const nPos = ny * w + nx;
        if (visited[nPos]) continue;
        visited[nPos] = 1;

        const nIdx = nPos * 4;
        if (colorMatch(nIdx)) {
          queue.push(nx, ny);
        }
      }

      if (reachedEdge) break;
    }

    // If it reached the edge of the canvas, abort completely!
    if (reachedEdge) {
      return;
    }

    // It is a fully closed shape! Create a raster fill image
    const fillCanvas = document.createElement('canvas');
    const fw = Math.max(1, maxX - minX + 1);
    const fh = Math.max(1, maxY - minY + 1);
    fillCanvas.width = fw;
    fillCanvas.height = fh;
    const fCtx = fillCanvas.getContext('2d');
    if (!fCtx) return;

    const fImgData = fCtx.createImageData(fw, fh);
    const fData = fImgData.data;

    for (let i = 0; i < filledPixels.length; i += 2) {
      const px = filledPixels[i] - minX;
      const py = filledPixels[i + 1] - minY;
      const idx = (py * fw + px) * 4;
      fData[idx] = fr;
      fData[idx + 1] = fg;
      fData[idx + 2] = fb;
      fData[idx + 3] = fa;
    }
    fCtx.putImageData(fImgData, 0, 0);

    const fillStroke: Stroke = {
      id: Math.random().toString(36).substring(2, 9),
      type: 'fill',
      layerId: activeLayerId,
      color: drawColor,
      brushRadius: 0,
      imageUrl: fillCanvas.toDataURL(),
      bounds: {
        x: (minX / w) * 100,
        y: (minY / h) * 100,
        w: (fw / w) * 100,
        h: (fh / h) * 100,
      },
      points: [],
    };

    ctx.drawImage(fillCanvas, minX, minY);
    const nextDrawings = [...drawings, fillStroke];
    lastDrawingsRef.current = nextDrawings;
    requestRender();
    onChange(nextDrawings);
  };

  // Pointer Handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isDrawingMode) return;

    if (e.pointerType === 'pen') {
      lastPenTimeRef.current = Date.now();
      if (!touchOff && setTouchOff) setTouchOff(true);
    }

    if (e.pointerType === 'touch') {
      if (touchOff || Date.now() - lastPenTimeRef.current < 2000) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }

    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      // Ignored if capture fails
    }

    isPointerDownRef.current = true;
    const pt = getPt(e);
    setHoverPt(pt);

    if (drawTool === 'fill') {
      handleFillClick(pt);
      return;
    }

    if (drawTool === 'pen') {
      const initialPt = { ...pt };
      const newStroke: Stroke = {
        id: Math.random().toString(36).substring(2, 9),
        layerId: activeLayerId,
        points: [initialPt],
        color: drawColor,
        brushRadius: getActualRadius(),
      };
      activeStrokeRef.current = newStroke;

      // Ensure temp buffer exists and strictly matches layer buffer resolution
      const layer = layerBufferRef.current;
      if (
        !tempBufferRef.current ||
        !layer ||
        tempBufferRef.current.canvas.width !== layer.canvas.width ||
        tempBufferRef.current.canvas.height !== layer.canvas.height
      ) {
        tempBufferRef.current = createBuffer(canonicalWidth, canonicalHeight);
      }

      // Draw initial dot on tempBuffer
      const temp = tempBufferRef.current;
      if (temp) {
        temp.ctx.clearRect(0, 0, temp.canvas.width, temp.canvas.height);
        renderStrokeToCtx(
          temp.ctx,
          newStroke.points,
          newStroke.brushRadius,
          newStroke.color,
          false,
          temp.canvas.width,
          temp.canvas.height
        );
      }
      drawMainFrame();
    } else if (drawTool === 'erase') {
      const rad = getActualRadius();
      if (eraserType === 'stroke') {
        const remaining = drawings.filter((s) => {
          // Only erase on active layer if layerId is specified
          if (s.layerId && s.layerId !== activeLayerId) return true;
          return !strokeIntersects(s, pt, rad * 0.75);
        });
        if (remaining.length !== drawings.length) {
          onChange(remaining);
        }
      } else {
        // PIXEL ERASER (by brush size)
        const initialPt = { ...pt };
        const newEraseStroke: Stroke = {
          id: Math.random().toString(36).substring(2, 9),
          type: 'erase',
          layerId: activeLayerId,
          points: [initialPt],
          color: '#000000',
          brushRadius: rad,
        };
        activeStrokeRef.current = newEraseStroke;

        const layer = layerBufferRef.current;
        if (layer) {
          renderStrokeToCtx(
            layer.ctx,
            newEraseStroke.points,
            newEraseStroke.brushRadius,
            '#000000',
            true,
            layer.canvas.width,
            layer.canvas.height
          );
        }
        drawMainFrame();
      }
    } else if (drawTool === 'select') {
      if (selectedIds.size > 0) {
        const mode = hitTestSelection(pt);
        if (mode) {
          const bounds = getSelectionBounds(drawings, selectedIds, dimensions.width, dimensions.height);
          if (bounds) {
            const selectedStrokes = drawings.filter((s) => selectedIds.has(s.id));
            const unselectedStrokes = drawings.filter((s) => !selectedIds.has(s.id));

            // Bake unselected strokes into layerBuffer
            const layer = layerBufferRef.current;
            if (layer) {
              bakeAllDrawings(unselectedStrokes, layer.ctx, layer.canvas.width, layer.canvas.height);
            }

            // Put selected strokes into tempBuffer for real-time 60fps transform
            const temp = tempBufferRef.current;
            if (temp) {
              temp.ctx.clearRect(0, 0, temp.canvas.width, temp.canvas.height);
              bakeAllDrawings(selectedStrokes, temp.ctx, temp.canvas.width, temp.canvas.height);
            }

            transformStateRef.current = {
              active: true,
              mode,
              startPt: pt,
              startBounds: { ...bounds },
              currentBounds: { ...bounds },
              strokes: selectedStrokes,
            };

            if (containerRef.current) {
              if (mode === 'move') {
                containerRef.current.style.cursor = 'grabbing';
              } else if (mode === 'tl' || mode === 'br') {
                containerRef.current.style.cursor = 'nwse-resize';
              } else if (mode === 'tr' || mode === 'bl') {
                containerRef.current.style.cursor = 'nesw-resize';
              } else if (mode === 'l' || mode === 'r') {
                containerRef.current.style.cursor = 'ew-resize';
              } else if (mode === 't' || mode === 'b') {
                containerRef.current.style.cursor = 'ns-resize';
              }
            }

            drawMainFrame();
            return;
          }
        }
      }

      // Clicked outside existing selection: start new lasso selection
      setLassoPath([pt]);
      setSelectedIds(new Set());
      transformStateRef.current = null;
      requestRender();
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const pt = getPt(e);
    setHoverPt(pt);

    if (!isDrawingMode) return;

    if (!isPointerDownRef.current) {
      if (drawTool === 'select' && selectedIds.size > 0) {
        const mode = hitTestSelection(pt);
        let cursor = PRECISE_CROSSHAIR_CURSOR;
        if (mode === 'move') cursor = 'move';
        else if (mode === 'tl' || mode === 'br') cursor = 'nwse-resize';
        else if (mode === 'tr' || mode === 'bl') cursor = 'nesw-resize';
        else if (mode === 'l' || mode === 'r') cursor = 'ew-resize';
        else if (mode === 't' || mode === 'b') cursor = 'ns-resize';
        if (containerRef.current) containerRef.current.style.cursor = cursor;
      } else {
        if (containerRef.current) containerRef.current.style.cursor = isDrawingMode ? PRECISE_CROSSHAIR_CURSOR : 'default';
      }
      return;
    }

    if (transformStateRef.current?.active) {
      const state = transformStateRef.current;
      const dx = pt.x - state.startPt.x;
      const dy = pt.y - state.startPt.y;

      const nb = { ...state.startBounds };
      if (state.mode === 'move') {
        nb.x += dx;
        nb.y += dy;
      } else {
        // Corner and edge midpoint transform logic
        if (state.mode === 'tl') {
          nb.x += dx; nb.w -= dx;
          nb.y += dy; nb.h -= dy;
        } else if (state.mode === 'tr') {
          nb.w += dx;
          nb.y += dy; nb.h -= dy;
        } else if (state.mode === 'bl') {
          nb.x += dx; nb.w -= dx;
          nb.h += dy;
        } else if (state.mode === 'br') {
          nb.w += dx;
          nb.h += dy;
        } else if (state.mode === 't') {
          nb.y += dy; nb.h -= dy;
        } else if (state.mode === 'b') {
          nb.h += dy;
        } else if (state.mode === 'l') {
          nb.x += dx; nb.w -= dx;
        } else if (state.mode === 'r') {
          nb.w += dx;
        }

        // Clamp minimum size to prevent inversion/flipping
        if (nb.w < 0.5) {
          if (state.mode === 'l' || state.mode === 'tl' || state.mode === 'bl') {
            nb.x = state.startBounds.x + state.startBounds.w - 0.5;
          }
          nb.w = 0.5;
        }
        if (nb.h < 0.5) {
          if (state.mode === 't' || state.mode === 'tl' || state.mode === 'tr') {
            nb.y = state.startBounds.y + state.startBounds.h - 0.5;
          }
          nb.h = 0.5;
        }
      }
      state.currentBounds = nb;

      // Update cursor during active dragging
      if (containerRef.current) {
        if (state.mode === 'move') {
          containerRef.current.style.cursor = 'grabbing';
        } else if (state.mode === 'tl' || state.mode === 'br') {
          containerRef.current.style.cursor = 'nwse-resize';
        } else if (state.mode === 'tr' || state.mode === 'bl') {
          containerRef.current.style.cursor = 'nesw-resize';
        } else if (state.mode === 'l' || state.mode === 'r') {
          containerRef.current.style.cursor = 'ew-resize';
        } else if (state.mode === 't' || state.mode === 'b') {
          containerRef.current.style.cursor = 'ns-resize';
        }
      }

      const transformed = transformStrokes(state.strokes, state.startBounds, state.currentBounds);
      const temp = tempBufferRef.current;
      if (temp) {
        temp.ctx.clearRect(0, 0, temp.canvas.width, temp.canvas.height);
        bakeAllDrawings(transformed, temp.ctx, temp.canvas.width, temp.canvas.height);
      }
      drawMainFrame();
      return;
    }


    if (e.pointerType === 'pen') {
      lastPenTimeRef.current = Date.now();
    }

    if (e.pointerType === 'touch') {
      if (touchOff || Date.now() - lastPenTimeRef.current < 2000) return;
    }

    if (drawTool === 'pen' && activeStrokeRef.current) {
      const pts = activeStrokeRef.current.points;
      const last = pts[pts.length - 1];

      // Smooth sampling
      if (Math.hypot(pt.x - last.x, pt.y - last.y) > 0.02) {
        pts.push(pt);
        const temp = tempBufferRef.current;
        if (temp) {
          temp.ctx.clearRect(0, 0, temp.canvas.width, temp.canvas.height);
          renderStrokeToCtx(
            temp.ctx,
            pts,
            activeStrokeRef.current.brushRadius,
            activeStrokeRef.current.color,
            false,
            temp.canvas.width,
            temp.canvas.height
          );
        }
        drawMainFrame();
      }
    } else if (drawTool === 'erase') {
      const rad = getActualRadius();
      if (eraserType === 'stroke') {
        const remaining = drawings.filter((s) => {
          if (s.layerId && s.layerId !== activeLayerId) return true;
          return !strokeIntersects(s, pt, rad * 0.75);
        });
        if (remaining.length !== drawings.length) {
          onChange(remaining);
        }
      } else if (activeStrokeRef.current) {
        // PIXEL ERASER (by brush size)
        const pts = activeStrokeRef.current.points;
        const last = pts[pts.length - 1];
        if (Math.hypot(pt.x - last.x, pt.y - last.y) > 0.02) {
          pts.push(pt);
          const layer = layerBufferRef.current;
          if (layer) {
            renderStrokeToCtx(
              layer.ctx,
              [last, pt],
              activeStrokeRef.current.brushRadius,
              '#000000',
              true,
              layer.canvas.width,
              layer.canvas.height
            );
          }
          drawMainFrame();
        }
      }
    } else if (drawTool === 'select' && lassoPath) {
      const last = lassoPath[lassoPath.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) > 0.5) {
        setLassoPath((prev) => (prev ? [...prev, pt] : null));
        requestRender();
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    try {
      if ((e.currentTarget as HTMLElement).hasPointerCapture?.(e.pointerId)) {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      }
    } catch {
      // Ignored
    }

    if (!isPointerDownRef.current) return;
    isPointerDownRef.current = false;

    if (transformStateRef.current?.active) {
      const state = transformStateRef.current;
      transformStateRef.current = null;

      const transformed = transformStrokes(state.strokes, state.startBounds, state.currentBounds);
      const transformedMap = new Map(transformed.map((s) => [s.id, s]));
      const nextDrawings = drawings.map((s) => transformedMap.get(s.id) || s);

      lastDrawingsRef.current = nextDrawings;

      const layer = layerBufferRef.current;
      const temp = tempBufferRef.current;
      if (temp) {
        temp.ctx.clearRect(0, 0, temp.canvas.width, temp.canvas.height);
      }
      if (layer) {
        bakeAllDrawings(nextDrawings, layer.ctx, layer.canvas.width, layer.canvas.height);
      }

      if (containerRef.current) {
        const pt = getPt(e);
        const mode = hitTestSelection(pt);
        let cursor = PRECISE_CROSSHAIR_CURSOR;
        if (mode === 'move') cursor = 'move';
        else if (mode === 'tl' || mode === 'br') cursor = 'nwse-resize';
        else if (mode === 'tr' || mode === 'bl') cursor = 'nesw-resize';
        else if (mode === 'l' || mode === 'r') cursor = 'ew-resize';
        else if (mode === 't' || mode === 'b') cursor = 'ns-resize';
        containerRef.current.style.cursor = cursor;
      }

      onChange(nextDrawings);
      drawMainFrame();
      return;
    }

    if (drawTool === 'pen' && activeStrokeRef.current) {
      const stroke = activeStrokeRef.current;
      activeStrokeRef.current = null;

      const layer = layerBufferRef.current;
      const temp = tempBufferRef.current;

      if (layer && temp) {
        // 1. Bake stroke onto layerBuffer using EXACT same local coordinates and resolution
        renderStrokeToCtx(
          layer.ctx,
          stroke.points,
          stroke.brushRadius,
          stroke.color,
          false,
          layer.canvas.width,
          layer.canvas.height
        );

        // 2. Clear drafting buffer
        temp.ctx.clearRect(0, 0, temp.canvas.width, temp.canvas.height);
      }

      // 3. Immediately redraw display canvas with zero frame lag or jump
      drawMainFrame();

      // 4. Update drawings state & memoized ref
      const nextDrawings = [...drawings, stroke];
      lastDrawingsRef.current = nextDrawings;
      onChange(nextDrawings);
    } else if (drawTool === 'erase' && eraserType === 'pixel' && activeStrokeRef.current) {
      const stroke = activeStrokeRef.current;
      activeStrokeRef.current = null;

      if (stroke.points && stroke.points.length > 0) {
        const nextDrawings = [...drawings, stroke];
        lastDrawingsRef.current = nextDrawings;
        const layer = layerBufferRef.current;
        if (layer) {
          bakeAllDrawings(nextDrawings, layer.ctx, layer.canvas.width, layer.canvas.height);
        }
        drawMainFrame();
        onChange(nextDrawings);
      }
    } else if (drawTool === 'select' && lassoPathRef.current && lassoPathRef.current.length > 2) {
      const selected = drawings.filter((s) => strokeInLasso(s, lassoPathRef.current!));
      setSelectedIds(new Set(selected.map((s) => s.id)));
      setLassoPath(null);
      requestRender();
    }
  };

  // When switching away from select tool or exiting drawing mode, clear lasso selection and active transform
  useEffect(() => {
    if (!isDrawingMode || drawTool !== 'select') {
      if (selectedIds.size > 0) {
        setSelectedIds(new Set());
      }
      if (lassoPathRef.current) {
        setLassoPath(null);
      }
      if (transformStateRef.current) {
        transformStateRef.current = null;
        const temp = tempBufferRef.current;
        if (temp) {
          temp.ctx.clearRect(0, 0, temp.canvas.width, temp.canvas.height);
        }
      }
      if (containerRef.current) {
        containerRef.current.style.cursor = isDrawingMode ? PRECISE_CROSSHAIR_CURSOR : 'default';
      }
      requestRender();
    }
  }, [drawTool, isDrawingMode, requestRender, setLassoPath, selectedIds.size]);

  // Keyboard shortcut: Delete or Escape selected strokes
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selectedIds.size > 0 &&
        isDrawingMode &&
        drawTool === 'select'
      ) {
        const remaining = drawings.filter((s) => !selectedIds.has(s.id));
        onChange(remaining);
        setSelectedIds(new Set());
      } else if (
        e.key === 'Escape' &&
        selectedIds.size > 0 &&
        isDrawingMode &&
        drawTool === 'select'
      ) {
        setSelectedIds(new Set());
        setLassoPath(null);
        requestRender();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [drawings, selectedIds, isDrawingMode, drawTool, onChange, requestRender]);

  const brushCssDiameter = Math.max(2, (currentRadiusInPanel / 100) * dimensions.width);

  return (
    <div
      ref={containerRef}
      data-panel-drawing="true"
      data-drawing-container="true"
      className={`absolute inset-0 w-full h-full overflow-hidden ${
        isDrawingMode ? 'z-30 touch-none pointer-events-auto' : 'z-10 pointer-events-none touch-none'
      }`}
      style={{
        // cursor is now managed dynamically in pointerMove
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => setHoverPt(null)}
      onTouchStart={(e) => {
        if (isDrawingMode) {
          e.stopPropagation();
        }
      }}
      onTouchMove={(e) => {
        if (isDrawingMode) {
          e.stopPropagation();
        }
      }}
      onTouchEnd={(e) => {
        if (isDrawingMode) {
          e.stopPropagation();
        }
      }}
      onTouchCancel={(e) => {
        if (isDrawingMode) {
          e.stopPropagation();
        }
      }}
    >
      <canvas
        ref={mainCanvasRef}
        data-panel-drawing="true"
        data-drawing-container="true"
        className="w-full h-full block pointer-events-none"
        style={{ width: '100%', height: '100%' }}
      />

      {/* Live Brush Hover/Drawing Indicator Circle */}
      {hoverPt && isDrawingMode && (drawTool === 'pen' || drawTool === 'erase') && (
        <div
          className="pointer-events-none absolute rounded-full border border-black/80 dark:border-white/80 -translate-x-1/2 -translate-y-1/2 z-30 transition-none"
          style={{
            left: `${hoverPt.x}%`,
            top: `${hoverPt.y}%`,
            width: `${brushCssDiameter}px`,
            height: `${brushCssDiameter}px`,
            boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.8), inset 0 0 0 1px rgba(0, 0, 0, 0.15)',
            backgroundColor: drawTool === 'erase' ? 'rgba(255, 255, 255, 0.35)' : `${drawColor}25`,
          }}
        >
          {brushCssDiameter >= 8 && (
            <div className="absolute top-1/2 left-1/2 w-1 h-1 -translate-x-1/2 -translate-y-1/2 bg-black dark:bg-white rounded-full opacity-60" />
          )}
        </div>
      )}
    </div>
  );
};

function distToSegment(p: Point, v: Point, w: Point): number {
  const l2 = (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
}

// Intersection helpers
function strokeIntersects(s: Stroke, pt: Point, r: number): boolean {
  if (s.type === 'fill' && s.bounds) {
    const { x, y, w, h } = s.bounds;
    return pt.x >= x - r && pt.x <= x + w + r && pt.y >= y - r && pt.y <= y + h + r;
  }
  if (s.points && s.points.length > 0) {
    for (let i = 0; i < s.points.length; i++) {
      const p = s.points[i];
      if (Math.hypot(p.x - pt.x, p.y - pt.y) < r) return true;
      if (i > 0) {
        if (distToSegment(pt, s.points[i - 1], p) <= r) return true;
      }
    }
  }
  return false;
}

function strokeInLasso(s: Stroke, lasso: Point[]): boolean {
  if (lasso.length < 3) return false;
  
  const isInside = (p) => {
    let inside = false;
    for (let i = 0, j = lasso.length - 1; i < lasso.length; j = i++) {
      const xi = lasso[i].x, yi = lasso[i].y;
      const xj = lasso[j].x, yj = lasso[j].y;
      const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  if (s.type === 'fill' && s.bounds) {
    const { x, y, w, h } = s.bounds;
    return isInside({ x: x + w/2, y: y + h/2 }) || 
           isInside({ x, y }) || 
           isInside({ x: x+w, y: y+h });
  }

  if (!s.points || s.points.length === 0) return false;

  for (let step = 0; step < s.points.length; step += Math.max(1, Math.floor(s.points.length / 10))) {
    if (isInside(s.points[step])) return true;
  }
  return false;
}
