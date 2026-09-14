import { getStroke } from 'perfect-freehand';
import { Point, Stroke, getSvgPathFromPoints } from '../ComicCanvas';
import {
  DrawingLayer,
  DrawingTool,
  SerializedLayer,
  UndoStep,
  ActiveStroke,
  PanelBoundary,
} from './drawingTypes';

/**
 * Creates an OffscreenCanvas or hidden HTMLCanvasElement
 */
function createBuffer(width: number, height: number): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    return { canvas, ctx };
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    return { canvas, ctx };
  }
}

/**
 * High-Performance Multi-Layer Drawing Engine
 * Inspired by Autodesk SketchBook:
 * - Offscreen layers buffer rasterized drawing data
 * - Active stroke rendered on lightweight tempCanvas, then baked on pointerup
 * - Memory-safe capped Undo/Redo stack
 * - Non-destructive panel clipping masks
 */
export class DrawingEngine {
  public width: number;
  public height: number;
  public layers: DrawingLayer[] = [];
  public activeLayerId: string = '';

  // Lightweight drafting canvas for current active stroke
  private tempCanvas: OffscreenCanvas | HTMLCanvasElement;
  private tempCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  // Active stroke drafting data
  private activeStroke: ActiveStroke | null = null;

  // Memory-safe Capped Undo/Redo stacks
  private undoStack: UndoStep[] = [];
  private redoStack: UndoStep[] = [];
  private readonly MAX_UNDO_STEPS = 25;

  // Change notification listener
  private onChangeListeners: Set<() => void> = new Set();

  constructor(width: number = 1200, height: number = 1600) {
    this.width = width;
    this.height = height;

    const temp = createBuffer(width, height);
    this.tempCanvas = temp.canvas;
    this.tempCtx = temp.ctx;

    // Initialize with default Layer 1 ("Inks")
    this.addLayer('Inks');
  }

  public subscribe(cb: () => void): () => void {
    this.onChangeListeners.add(cb);
    return () => this.onChangeListeners.delete(cb);
  }

  private notify() {
    this.onChangeListeners.forEach((cb) => cb());
  }

  public getActiveLayer(): DrawingLayer | undefined {
    return this.layers.find((l) => l.id === this.activeLayerId) || this.layers[0];
  }

  public resize(width: number, height: number) {
    const newW = Math.max(100, Math.round(width));
    const newH = Math.max(100, Math.round(height));
    if (this.width === newW && this.height === newH) return;

    const oldW = this.width;
    const oldH = this.height;
    this.width = newW;
    this.height = newH;

    // Resize tempCanvas
    const temp = createBuffer(newW, newH);
    this.tempCanvas = temp.canvas;
    this.tempCtx = temp.ctx;

    // Resize layer canvases and scale contents smoothly
    this.layers = this.layers.map((layer) => {
      const newBuf = createBuffer(newW, newH);
      newBuf.ctx.imageSmoothingEnabled = true;
      newBuf.ctx.imageSmoothingQuality = 'high';
      newBuf.ctx.drawImage(layer.canvas as CanvasImageSource, 0, 0, oldW, oldH, 0, 0, newW, newH);
      return {
        ...layer,
        canvas: newBuf.canvas,
        ctx: newBuf.ctx,
      };
    });

    // Clear undo/redo on hard resolution resize to prevent dimensional mismatch
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  /* ---------------- Layer Management ---------------- */

  public addLayer(name?: string): string {
    const id = `layer-${Math.random().toString(36).substring(2, 9)}`;
    const layerName = name || `Layer ${this.layers.length + 1}`;
    const buf = createBuffer(this.width, this.height);

    const layer: DrawingLayer = {
      id,
      name: layerName,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      canvas: buf.canvas,
      ctx: buf.ctx,
    };

    // Insert new layer on top
    this.layers = [...this.layers, layer];
    this.activeLayerId = id;
    this.notify();
    return id;
  }

  public deleteLayer(id: string): boolean {
    if (this.layers.length <= 1) return false; // Always keep at least 1 layer
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx === -1) return false;

    this.layers = this.layers.filter((l) => l.id !== id);
    if (this.activeLayerId === id) {
      const nextActive = this.layers[Math.max(0, idx - 1)];
      this.activeLayerId = nextActive.id;
    }
    // Clean up undo items related to this layer
    this.undoStack = this.undoStack.filter((u) => u.layerId !== id);
    this.redoStack = this.redoStack.filter((r) => r.layerId !== id);
    this.notify();
    return true;
  }

  public duplicateLayer(id: string): string | null {
    const src = this.layers.find((l) => l.id === id);
    if (!src) return null;

    const newId = `layer-${Math.random().toString(36).substring(2, 9)}`;
    const buf = createBuffer(this.width, this.height);
    buf.ctx.drawImage(src.canvas as CanvasImageSource, 0, 0);

    const dupLayer: DrawingLayer = {
      id: newId,
      name: `${src.name} (Copy)`,
      visible: src.visible,
      opacity: src.opacity,
      blendMode: src.blendMode,
      canvas: buf.canvas,
      ctx: buf.ctx,
    };

    const idx = this.layers.findIndex((l) => l.id === id);
    const updated = [...this.layers];
    updated.splice(idx + 1, 0, dupLayer);
    this.layers = updated;
    this.activeLayerId = newId;
    this.notify();
    return newId;
  }

  public toggleLayerVisibility(id: string) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l));
    this.notify();
  }

  public setLayerOpacity(id: string, opacity: number) {
    const clamped = Math.max(0, Math.min(1, opacity));
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, opacity: clamped } : l));
    this.notify();
  }

  public setLayerBlendMode(id: string, mode: GlobalCompositeOperation) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, blendMode: mode } : l));
    this.notify();
  }

  public setActiveLayer(id: string) {
    if (this.layers.some((l) => l.id === id)) {
      this.activeLayerId = id;
      this.notify();
    }
  }

  public renameLayer(id: string, name: string) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, name } : l));
    this.notify();
  }

  public reorderLayers(startIndex: number, endIndex: number) {
    if (
      startIndex < 0 ||
      startIndex >= this.layers.length ||
      endIndex < 0 ||
      endIndex >= this.layers.length ||
      startIndex === endIndex
    ) {
      return;
    }
    const updated = [...this.layers];
    const [moved] = updated.splice(startIndex, 1);
    updated.splice(endIndex, 0, moved);
    this.layers = updated;
    this.notify();
  }

  public clearLayer(id: string) {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return;
    this.saveUndoSnapshot(id);
    layer.ctx.clearRect(0, 0, this.width, this.height);
    this.notify();
  }

  public mergeDown(id: string) {
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx <= 0) return; // Cannot merge bottom-most layer

    const top = this.layers[idx];
    const bottom = this.layers[idx - 1];

    this.saveUndoSnapshot(bottom.id);

    bottom.ctx.save();
    bottom.ctx.globalAlpha = top.opacity;
    bottom.ctx.globalCompositeOperation = top.blendMode;
    bottom.ctx.drawImage(top.canvas as CanvasImageSource, 0, 0);
    bottom.ctx.restore();

    this.deleteLayer(top.id);
    this.activeLayerId = bottom.id;
    this.notify();
  }

  /* ---------------- Memory-Safe Undo / Redo ---------------- */

  private saveUndoSnapshot(layerId: string) {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return;

    try {
      const imageData = layer.ctx.getImageData(0, 0, this.width, this.height);
      this.undoStack.push({ layerId, imageData });
      if (this.undoStack.length > this.MAX_UNDO_STEPS) {
        this.undoStack.shift(); // Drop oldest step to cap memory
      }
      this.redoStack = []; // Clear redo on new action
    } catch (err) {
      console.warn('Unable to capture undo snapshot:', err);
    }
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public undo(): boolean {
    if (this.undoStack.length === 0) return false;
    const step = this.undoStack.pop()!;
    const layer = this.layers.find((l) => l.id === step.layerId);
    if (!layer) return false;

    try {
      // Save current state to redo stack
      const currentData = layer.ctx.getImageData(0, 0, this.width, this.height);
      this.redoStack.push({ layerId: step.layerId, imageData: currentData });
      if (this.redoStack.length > this.MAX_UNDO_STEPS) {
        this.redoStack.shift();
      }

      // Restore snapshot
      layer.ctx.putImageData(step.imageData, 0, 0);
      this.notify();
      return true;
    } catch (e) {
      console.error('Undo failed:', e);
      return false;
    }
  }

  public redo(): boolean {
    if (this.redoStack.length === 0) return false;
    const step = this.redoStack.pop()!;
    const layer = this.layers.find((l) => l.id === step.layerId);
    if (!layer) return false;

    try {
      // Save current state to undo stack
      const currentData = layer.ctx.getImageData(0, 0, this.width, this.height);
      this.undoStack.push({ layerId: step.layerId, imageData: currentData });
      if (this.undoStack.length > this.MAX_UNDO_STEPS) {
        this.undoStack.shift();
      }

      // Restore snapshot
      layer.ctx.putImageData(step.imageData, 0, 0);
      this.notify();
      return true;
    } catch (e) {
      console.error('Redo failed:', e);
      return false;
    }
  }

  /* ---------------- Drafting & Stroke Baking Engine ---------------- */

  /**
   * Begins an active stroke on tempCanvas
   * Coordinates p are in page percentages [0..100]
   */
  public startStroke(
    p: Point,
    tool: DrawingTool,
    color: string,
    brushRadius: number,
    panelId?: string,
    panelBounds?: { x: number; y: number; w: number; h: number }
  ) {
    this.activeStroke = {
      id: Math.random().toString(36).substring(2, 9),
      tool,
      color,
      brushRadius,
      points: [p],
      panelId,
      panelBounds,
    };

    // Ensure tempCanvas internal buffer resolution matches engine resolution
    if (this.tempCanvas.width !== this.width || this.tempCanvas.height !== this.height) {
      const temp = createBuffer(this.width, this.height);
      this.tempCanvas = temp.canvas;
      this.tempCtx = temp.ctx;
    }

    // Clear tempCanvas
    this.tempCtx.clearRect(0, 0, this.width, this.height);

    // Draw initial dot / point on tempCanvas
    this.renderStrokeToCanvas(
      this.tempCtx,
      this.activeStroke.points,
      this.activeStroke.brushRadius,
      this.activeStroke.color,
      this.activeStroke.tool === 'erase',
      this.activeStroke.panelBounds
    );

    this.notify();
  }

  /**
   * Appends points to active stroke and updates tempCanvas
   */
  public updateStroke(p: Point) {
    if (!this.activeStroke) return;
    const pts = this.activeStroke.points;
    const last = pts[pts.length - 1];

    // Minimal distance filter for performance
    if (Math.hypot(p.x - last.x, p.y - last.y) < 0.05) return;

    this.activeStroke.points.push(p);

    // Clear and redraw active stroke on tempCanvas
    this.tempCtx.clearRect(0, 0, this.width, this.height);
    this.renderStrokeToCanvas(
      this.tempCtx,
      this.activeStroke.points,
      this.activeStroke.brushRadius,
      this.activeStroke.color,
      this.activeStroke.tool === 'erase',
      this.activeStroke.panelBounds
    );

    this.notify();
  }

  /**
   * Bakes active stroke directly into the active layer's memory buffer
   * and clears tempCanvas. Stroke history is discarded.
   */
  public bakeStroke(): boolean {
    if (!this.activeStroke || this.activeStroke.points.length === 0) {
      this.activeStroke = null;
      this.tempCtx.clearRect(0, 0, this.width, this.height);
      return false;
    }

    const stroke = this.activeStroke;
    this.activeStroke = null;

    const layer = this.getActiveLayer();
    if (!layer) {
      this.tempCtx.clearRect(0, 0, this.width, this.height);
      return false;
    }

    // Save undo snapshot before baking into layer
    this.saveUndoSnapshot(layer.id);

    // Ensure active layer buffer resolution matches engine resolution
    if (layer.canvas.width !== this.width || layer.canvas.height !== this.height) {
      const newBuf = createBuffer(this.width, this.height);
      newBuf.ctx.drawImage(layer.canvas as CanvasImageSource, 0, 0, this.width, this.height);
      layer.canvas = newBuf.canvas;
      layer.ctx = newBuf.ctx;
    }

    // Bake stroke into active layer buffer
    this.renderStrokeToCanvas(
      layer.ctx,
      stroke.points,
      stroke.brushRadius,
      stroke.color,
      stroke.tool === 'erase',
      stroke.panelBounds
    );

    // Clear tempCanvas immediately
    this.tempCtx.clearRect(0, 0, this.width, this.height);
    this.notify();
    return true;
  }

  public cancelStroke() {
    this.activeStroke = null;
    this.tempCtx.clearRect(0, 0, this.width, this.height);
    this.notify();
  }

  /**
   * Renders stroke points to a target 2D context using perfect-freehand smoothing
   */
  private renderStrokeToCanvas(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    points: Point[],
    brushRadius: number,
    color: string,
    isEraser: boolean,
    panelBounds?: { x: number; y: number; w: number; h: number }
  ) {
    if (points.length === 0) return;

    ctx.save();

    // Clip to panel boundaries if provided (so strokes never bleed outside their panel)
    if (panelBounds) {
      const clipX = (panelBounds.x / 100) * this.width;
      const clipY = (panelBounds.y / 100) * this.height;
      const clipW = (panelBounds.w / 100) * this.width;
      const clipH = (panelBounds.h / 100) * this.height;
      ctx.beginPath();
      ctx.rect(clipX, clipY, clipW, clipH);
      ctx.clip();
    }

    if (isEraser) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000000';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = color;
    }

    const aspect = this.width / this.height;

    // Single dot tap
    if (points.length === 1) {
      const p = points[0];
      const px = (p.x / 100) * this.width;
      const py = (p.y / 100) * this.height;
      const r = Math.max(1, (brushRadius / 100) * this.width * 0.5);

      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // Convert points from [0..100] percentage coordinates to pixel coordinates
    const input: [number, number, number | undefined][] = points.map((p) => [
      (p.x / 100) * this.width,
      (p.y / 100) * this.height,
      p.pressure !== undefined && p.pressure > 0 ? p.pressure : 0.5,
    ]);

    const pixelRadius = Math.max(1, (brushRadius / 100) * this.width);

    const outline = getStroke(input, {
      size: pixelRadius,
      thinning: 0.5,
      smoothing: 0.65,
      streamline: 0.6,
      simulatePressure: true,
      last: true,
    });

    if (outline.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(outline[0][0], outline[0][1]);
      for (let i = 1; i < outline.length; i++) {
        ctx.lineTo(outline[i][0], outline[i][1]);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      // Fallback simple line
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = pixelRadius;
      ctx.strokeStyle = isEraser ? '#000000' : color;
      ctx.beginPath();
      ctx.moveTo((points[0].x / 100) * this.width, (points[0].y / 100) * this.height);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo((points[i].x / 100) * this.width, (points[i].y / 100) * this.height);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  /* ---------------- Flood Fill Tool ---------------- */

  public floodFill(
    seedXPercent: number,
    seedYPercent: number,
    fillColor: string,
    panelBounds?: { x: number; y: number; w: number; h: number }
  ) {
    const layer = this.getActiveLayer();
    if (!layer) return;

    this.saveUndoSnapshot(layer.id);

    const startX = Math.round((seedXPercent / 100) * this.width);
    const startY = Math.round((seedYPercent / 100) * this.height);

    if (startX < 0 || startX >= this.width || startY < 0 || startY >= this.height) return;

    // Create a composite buffer to sample boundary pixels from all visible layers
    const compositeBuf = createBuffer(this.width, this.height);
    for (const l of this.layers) {
      if (!l.visible || l.opacity <= 0) continue;
      compositeBuf.ctx.drawImage(l.canvas as CanvasImageSource, 0, 0);
    }

    const imgData = compositeBuf.ctx.getImageData(0, 0, this.width, this.height);
    const data = imgData.data;

    // Target fill color
    const hex = fillColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16) || 0;
    const g = parseInt(hex.substring(2, 4), 16) || 0;
    const b = parseInt(hex.substring(4, 6), 16) || 0;
    const a = 255;

    // Target layer output data
    const targetImgData = layer.ctx.getImageData(0, 0, this.width, this.height);
    const targetData = targetImgData.data;

    const startIdx = (startY * this.width + startX) * 4;
    const startAlpha = data[startIdx + 3];

    // Restrict fill within panel if provided
    let minX = 0,
      maxX = this.width,
      minY = 0,
      maxY = this.height;
    if (panelBounds) {
      minX = Math.max(0, Math.floor((panelBounds.x / 100) * this.width));
      maxX = Math.min(this.width, Math.ceil(((panelBounds.x + panelBounds.w) / 100) * this.width));
      minY = Math.max(0, Math.floor((panelBounds.y / 100) * this.height));
      maxY = Math.min(this.height, Math.ceil(((panelBounds.y + panelBounds.h) / 100) * this.height));
    }

    const visited = new Uint8Array(this.width * this.height);
    const queue: number[] = [startX, startY];
    visited[startY * this.width + startX] = 1;

    const ALPHA_BARRIER = 80; // Stroke darkness considered a wall

    while (queue.length > 0) {
      const cy = queue.pop()!;
      const cx = queue.pop()!;

      const idx = (cy * this.width + cx) * 4;
      targetData[idx] = r;
      targetData[idx + 1] = g;
      targetData[idx + 2] = b;
      targetData[idx + 3] = a;

      const neighbors = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1],
      ];

      for (const [nx, ny] of neighbors) {
        if (nx < minX || nx >= maxX || ny < minY || ny >= maxY) continue;
        const nPos = ny * this.width + nx;
        if (visited[nPos]) continue;
        visited[nPos] = 1;

        const nIdx = nPos * 4;
        const nAlpha = data[nIdx + 3];

        if (nAlpha < ALPHA_BARRIER) {
          queue.push(nx, ny);
        }
      }
    }

    layer.ctx.putImageData(targetImgData, 0, 0);
    this.notify();
  }

  /* ---------------- Unified Render Pipeline ---------------- */

  /**
   * Driven through a single requestAnimationFrame loop on the main canvas:
   * ctx.save() -> ctx.clip(panelPath) -> composite visible layer buffers -> ctx.restore().
   */
  public renderTo(
    mainCtx: CanvasRenderingContext2D,
    displayWidth: number,
    displayHeight: number,
    panels: PanelBoundary[],
    panelBackgrounds?: Map<string, { color?: string; image?: HTMLImageElement | null; isContrast?: boolean }>,
    activePanelId?: string
  ) {
    mainCtx.save();
    mainCtx.clearRect(0, 0, displayWidth, displayHeight);

    // Render panels through non-destructive clipping masks
    for (const panel of panels) {
      mainCtx.save();

      // 1. Build clip boundary path (window shape)
      const px = (panel.x / 100) * displayWidth;
      const py = (panel.y / 100) * displayHeight;
      const pw = (panel.w / 100) * displayWidth;
      const ph = (panel.h / 100) * displayHeight;

      mainCtx.beginPath();
      mainCtx.rect(px, py, pw, ph);
      mainCtx.clip();

      // 2. Draw background color if configured
      const bgInfo = panelBackgrounds?.get(panel.id);
      mainCtx.fillStyle = bgInfo?.color || '#ffffff';
      mainCtx.fillRect(px, py, pw, ph);

      // 3. Draw panel photo / generated image if present
      if (bgInfo?.image && bgInfo.image.complete && bgInfo.image.naturalWidth > 0) {
        mainCtx.save();
        if (bgInfo.isContrast) {
          mainCtx.filter = 'contrast(125%) grayscale(100%)';
        }
        // Draw image aspect-fill inside panel box
        const img = bgInfo.image;
        const imgAspect = img.naturalWidth / img.naturalHeight;
        const boxAspect = pw / ph;
        let sx = 0,
          sy = 0,
          sw = img.naturalWidth,
          sh = img.naturalHeight;
        if (boxAspect > imgAspect) {
          sh = img.naturalWidth / boxAspect;
          sy = (img.naturalHeight - sh) / 2;
        } else {
          sw = img.naturalHeight * boxAspect;
          sx = (img.naturalWidth - sw) / 2;
        }
        mainCtx.drawImage(img, sx, sy, sw, sh, px, py, pw, ph);
        mainCtx.restore();
      }

      // 4. Composite visible artwork layer buffers through the panel's clipping mask
      for (const layer of this.layers) {
        if (!layer.visible || layer.opacity <= 0) continue;
        mainCtx.save();
        mainCtx.globalAlpha = layer.opacity;
        mainCtx.globalCompositeOperation = layer.blendMode;
        mainCtx.drawImage(layer.canvas as CanvasImageSource, 0, 0, displayWidth, displayHeight);
        mainCtx.restore();
      }

      // 5. If there's an active in-progress drafting stroke in this panel, composite tempCanvas
      if (this.activeStroke && (!this.activeStroke.panelId || this.activeStroke.panelId === panel.id)) {
        mainCtx.save();
        if (this.activeStroke.tool === 'erase') {
          mainCtx.globalCompositeOperation = 'destination-out';
        } else {
          mainCtx.globalCompositeOperation = 'source-over';
        }
        mainCtx.drawImage(this.tempCanvas as CanvasImageSource, 0, 0, displayWidth, displayHeight);
        mainCtx.restore();
      }

      // Restore panel clipping mask
      mainCtx.restore();
    }

    mainCtx.restore();
  }

  /* ---------------- Legacy Compatibility & Serialization ---------------- */

  /**
   * Auto-bakes legacy Stroke[] data onto the Inks layer on load
   */
  public loadLegacyDrawings(drawings: Stroke[], panelBounds?: { x: number; y: number; w: number; h: number }) {
    if (!drawings || drawings.length === 0) return;
    const layer = this.getActiveLayer();
    if (!layer) return;

    for (const stroke of drawings) {
      if (stroke.type === 'fill' && stroke.imageUrl && stroke.bounds) {
        // Render fill image
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const bx = ((stroke.bounds!.x * (panelBounds ? panelBounds.w / 100 : 1) + (panelBounds?.x || 0)) / 100) * this.width;
          const by = ((stroke.bounds!.y * (panelBounds ? panelBounds.h / 100 : 1) + (panelBounds?.y || 0)) / 100) * this.height;
          const bw = ((stroke.bounds!.w * (panelBounds ? panelBounds.w / 100 : 1)) / 100) * this.width;
          const bh = ((stroke.bounds!.h * (panelBounds ? panelBounds.h / 100 : 1)) / 100) * this.height;
          layer.ctx.drawImage(img, bx, by, bw, bh);
          this.notify();
        };
        img.src = stroke.imageUrl;
      } else if (stroke.points && stroke.points.length > 0) {
        // Map points from panel percentage to page percentage
        const mappedPoints = stroke.points.map((p) => {
          if (!panelBounds) return p;
          return {
            x: panelBounds.x + (p.x / 100) * panelBounds.w,
            y: panelBounds.y + (p.y / 100) * panelBounds.h,
            pressure: p.pressure,
            pointerType: p.pointerType,
          };
        });

        this.renderStrokeToCanvas(
          layer.ctx,
          mappedPoints,
          stroke.brushRadius || 2,
          stroke.color || '#000000',
          false,
          panelBounds
        );
      }
    }
    this.notify();
  }

  /**
   * Exports layers as serialized data
   */
  public async exportSerializedLayers(): Promise<SerializedLayer[]> {
    const results: SerializedLayer[] = [];
    for (const layer of this.layers) {
      let dataUrl = '';
      if (layer.canvas instanceof HTMLCanvasElement) {
        dataUrl = layer.canvas.toDataURL('image/png');
      } else if (typeof OffscreenCanvas !== 'undefined' && layer.canvas instanceof OffscreenCanvas) {
        try {
          const blob = await layer.canvas.convertToBlob({ type: 'image/png' });
          dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        } catch {
          // Fallback
        }
      }
      results.push({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        dataUrl,
      });
    }
    return results;
  }

  /**
   * Imports layers from serialized data
   */
  public async importSerializedLayers(serialized: SerializedLayer[]) {
    if (!serialized || serialized.length === 0) return;
    const newLayers: DrawingLayer[] = [];

    for (const s of serialized) {
      const buf = createBuffer(this.width, this.height);
      if (s.dataUrl) {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            buf.ctx.drawImage(img, 0, 0, this.width, this.height);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = s.dataUrl!;
        });
      }
      newLayers.push({
        id: s.id,
        name: s.name,
        visible: s.visible,
        opacity: s.opacity,
        blendMode: (s.blendMode as GlobalCompositeOperation) || 'source-over',
        canvas: buf.canvas,
        ctx: buf.ctx,
      });
    }

    if (newLayers.length > 0) {
      this.layers = newLayers;
      this.activeLayerId = newLayers[0].id;
      this.undoStack = [];
      this.redoStack = [];
      this.notify();
    }
  }

  /**
   * Exports flattened full page as Data URL
   */
  public getFlattenedDataUrl(): string {
    const flat = createBuffer(this.width, this.height);
    for (const l of this.layers) {
      if (!l.visible || l.opacity <= 0) continue;
      flat.ctx.globalAlpha = l.opacity;
      flat.ctx.globalCompositeOperation = l.blendMode;
      flat.ctx.drawImage(l.canvas as CanvasImageSource, 0, 0);
    }
    if (flat.canvas instanceof HTMLCanvasElement) {
      return flat.canvas.toDataURL('image/png');
    }
    return '';
  }

  public dispose() {
    this.onChangeListeners.clear();
    this.layers = [];
    this.undoStack = [];
    this.redoStack = [];
  }
}
