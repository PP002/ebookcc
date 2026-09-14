import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { TreeNode, PanelBox, getLeafBoxes, Direction, genId } from '../ComicCanvas';
import { DrawingEngine } from './DrawingEngine';
import { DrawingTool, PanelBoundary } from './drawingTypes';
import { LayerManagerUI } from './LayerManagerUI';
import { HOLLOW_CROSS_CURSOR } from '../ComicCanvas';

interface UnifiedComicCanvasProps {
  tree: TreeNode;
  onChange: (newTree: TreeNode) => void;
  isDrawingMode: boolean;
  drawTool: DrawingTool;
  drawColor: string;
  drawRadius: number;
  touchOff: boolean;
  setTouchOff: (val: boolean) => void;
  isExpanded?: boolean;
  onExpandPanel?: (panelId: string) => void;
  aspectRatio?: number;
  engineRef?: React.MutableRefObject<DrawingEngine | null>;
  isLayerUIOpen?: boolean;
  onCloseLayerUI?: () => void;
}

export const UnifiedComicCanvas: React.FC<UnifiedComicCanvasProps> = ({
  tree,
  onChange,
  isDrawingMode,
  drawTool,
  drawColor,
  drawRadius,
  touchOff,
  setTouchOff,
  isExpanded,
  onExpandPanel,
  aspectRatio = 0.75,
  engineRef,
  isLayerUIOpen = false,
  onCloseLayerUI,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastPenTimeRef = useRef<number>(0);
  const isPointerDownRef = useRef<boolean>(false);
  const activePanelRef = useRef<PanelBox | null>(null);

  // Drawing Engine Instance
  const [engine, setEngine] = useState<DrawingEngine | null>(null);

  // Image cache for panel background photos
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [, setImageTick] = useState(0);

  // Leaf panels from tree
  const panelBoxes: PanelBox[] = useMemo(() => getLeafBoxes(tree), [tree]);

  // Boundaries for clipping masks
  const panelBoundaries: PanelBoundary[] = useMemo(() => {
    return panelBoxes.map((b) => ({
      id: b.id,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
    }));
  }, [panelBoxes]);

  // Initialize Drawing Engine once
  useEffect(() => {
    const newEngine = new DrawingEngine(1200, 1600);
    setEngine(newEngine);
    if (engineRef) {
      engineRef.current = newEngine;
    }

    // Load any legacy drawings from panel nodes into the Inks layer
    panelBoxes.forEach((b) => {
      if (b.node.type === 'panel' && b.node.drawings && b.node.drawings.length > 0) {
        newEngine.loadLegacyDrawings(b.node.drawings, {
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
        });
      }
    });

    return () => {
      newEngine.dispose();
      if (engineRef) {
        engineRef.current = null;
      }
    };
  }, []); // Run once on mount

  // Preload images for panel nodes
  useEffect(() => {
    let hasNew = false;
    panelBoxes.forEach((b) => {
      const url = (b.node as any).imageUrl;
      if (url && !imageCacheRef.current.has(url)) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          setImageTick((t) => t + 1);
        };
        img.src = url;
        imageCacheRef.current.set(url, img);
        hasNew = true;
      }
    });
    if (hasNew) {
      setImageTick((t) => t + 1);
    }
  }, [panelBoxes]);

  // RequestAnimationFrame Unified Render Loop
  const renderFrame = useCallback(() => {
    const canvas = mainCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !engine) return;

    const mainCtx = canvas.getContext('2d');
    if (!mainCtx) return;

    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    // Adjust internal pixel dimensions using devicePixelRatio to prevent bitmap blur or stretching
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const displayWidth = Math.round(rect.width);
    const displayHeight = Math.round(rect.height);
    const pixelWidth = Math.round(displayWidth * dpr);
    const pixelHeight = Math.round(displayHeight * dpr);

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
    }

    // Set scale for high-DPI rendering
    mainCtx.save();
    mainCtx.scale(dpr, dpr);

    // Build panel background mapping
    const bgMap = new Map<string, { color?: string; image?: HTMLImageElement | null; isContrast?: boolean }>();
    panelBoxes.forEach((b) => {
      const url = (b.node as any).imageUrl;
      const img = url ? imageCacheRef.current.get(url) || null : null;
      bgMap.set(b.id, {
        color: (b.node as any).bgColor || '#ffffff',
        image: img,
        isContrast: !!(b.node as any).isHighContrast,
      });
    });

    // Execute Unified Render Pipeline:
    // ctx.save() -> ctx.clip(panelPath) -> composite visible layer buffers -> ctx.restore()
    engine.renderTo(
      mainCtx,
      displayWidth,
      displayHeight,
      panelBoundaries,
      bgMap,
      activePanelRef.current?.id
    );

    // Render panel borders & outlines
    panelBoxes.forEach((b) => {
      const px = (b.x / 100) * displayWidth;
      const py = (b.y / 100) * displayHeight;
      const pw = (b.w / 100) * displayWidth;
      const ph = (b.h / 100) * displayHeight;

      if ((b.node as any).hasOutline) {
        mainCtx.strokeStyle = (b.node as any).color || '#000000';
        mainCtx.lineWidth = 2;
        mainCtx.strokeRect(px, py, pw, ph);
      }
    });

    mainCtx.restore();
  }, [engine, panelBoxes, panelBoundaries]);

  // Trigger RAF when engine or container changes
  useEffect(() => {
    let animId: number;
    const scheduleRender = () => {
      animId = requestAnimationFrame(renderFrame);
    };

    scheduleRender();

    if (engine) {
      const unsub = engine.subscribe(scheduleRender);
      window.addEventListener('resize', scheduleRender);
      return () => {
        cancelAnimationFrame(animId);
        unsub();
        window.removeEventListener('resize', scheduleRender);
      };
    }

    return () => cancelAnimationFrame(animId);
  }, [renderFrame, engine]);

  // Pointer event helpers
  const getPagePercentPt = (e: React.PointerEvent) => {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0, pressure: 0.5 };
    const rect = container.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    const pressure =
      e.pointerType === 'pen'
        ? e.pressure && e.pressure > 0 && e.pressure !== 0.5
          ? e.pressure
          : 0.35
        : 0.5;
    return { x, y, pressure, pointerType: e.pointerType, tiltX: e.tiltX, tiltY: e.tiltY };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isDrawingMode || !engine) return;

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

    const pt = getPagePercentPt(e);
    isPointerDownRef.current = true;

    // Find which panel was clicked
    const clickedPanel = panelBoxes.find(
      (b) => pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h
    ) || panelBoxes[0];

    activePanelRef.current = clickedPanel;

    const panelBounds = clickedPanel
      ? { x: clickedPanel.x, y: clickedPanel.y, w: clickedPanel.w, h: clickedPanel.h }
      : undefined;

    if (drawTool === 'pen' || drawTool === 'erase') {
      engine.startStroke(
        pt,
        drawTool,
        drawColor,
        drawRadius,
        clickedPanel?.id,
        panelBounds
      );
      requestAnimationFrame(renderFrame);
    } else if (drawTool === 'fill') {
      engine.floodFill(pt.x, pt.y, drawColor, panelBounds);
      requestAnimationFrame(renderFrame);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawingMode || !engine || !isPointerDownRef.current) return;

    if (e.pointerType === 'pen') {
      lastPenTimeRef.current = Date.now();
    }

    if (e.pointerType === 'touch') {
      if (touchOff || Date.now() - lastPenTimeRef.current < 2000) {
        return;
      }
    }

    const pt = getPagePercentPt(e);

    if (drawTool === 'pen' || drawTool === 'erase') {
      engine.updateStroke(pt);
      requestAnimationFrame(renderFrame);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isPointerDownRef.current || !engine) return;
    isPointerDownRef.current = false;
    activePanelRef.current = null;

    if (drawTool === 'pen' || drawTool === 'erase') {
      // Bake stroke directly onto active layer's memory buffer & clear tempCanvas
      engine.bakeStroke();
      requestAnimationFrame(renderFrame);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full select-none touch-none overflow-hidden"
      style={{
        cursor: isDrawingMode ? HOLLOW_CROSS_CURSOR : 'default',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* High-Performance Main Display Canvas */}
      <canvas
        ref={mainCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {/* Autodesk SketchBook Inspired Layer Manager */}
      {isLayerUIOpen && (
        <LayerManagerUI
          engine={engine}
          isOpen={isLayerUIOpen}
          onClose={onCloseLayerUI || (() => {})}
        />
      )}
    </div>
  );
};
