const fs = require('fs');
let code = fs.readFileSync('src/components/comic/RasterDrawingCanvas.tsx', 'utf-8');

// pointerDown logic for select
const oldPointerDownSelect = `    } else if (drawTool === 'select') {
      setLassoPath([pt]);
      setLassoPathState([pt]);
      lassoPathRef.current = [pt];
      setSelectedIds(new Set());
      requestRender();
    }`;

const newPointerDownSelect = `    } else if (drawTool === 'select') {
      const mode = hitTestSelection(pt) as any;
      if (mode) {
        const bounds = getSelectionBounds(drawings, selectedIds, dimensions.width, dimensions.height);
        if (bounds) {
          const strokes = drawings.filter(s => selectedIds.has(s.id));
          transformStateRef.current = {
            active: true,
            mode,
            startPt: pt,
            startBounds: { ...bounds },
            currentBounds: { ...bounds },
            strokes: JSON.parse(JSON.stringify(strokes))
          };
          lastDrawingsRef.current = []; // force rebake of layerBuffer to exclude selected
          const buf = layerBufferRef.current;
          if (buf) {
            bakeAllDrawings(drawings.filter(s => !selectedIds.has(s.id)), buf.ctx, buf.canvas.width, buf.canvas.height);
          }
          requestRender();
          return;
        }
      }
      setLassoPathState([pt]);
      lassoPathRef.current = [pt];
      setSelectedIds(new Set());
      requestRender();
    }`;

code = code.replace(oldPointerDownSelect, newPointerDownSelect);

// pointerMove logic
const oldPointerMoveStart = `  const handlePointerMove = (e: React.PointerEvent) => {
    const pt = getPt(e);
    setHoverPt(pt);

    if (!isDrawingMode || !isPointerDownRef.current) return;`;

const newPointerMoveStart = `  const handlePointerMove = (e: React.PointerEvent) => {
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

    if (transformStateRef.current) {
      const state = transformStateRef.current;
      const dx = pt.x - state.startPt.x;
      const dy = pt.y - state.startPt.y;
      
      const nb = { ...state.startBounds };
      if (state.mode === 'move') {
        nb.x += dx;
        nb.y += dy;
      } else {
        if (state.mode.includes('l')) { nb.x += dx; nb.w -= dx; }
        if (state.mode.includes('r')) { nb.w += dx; }
        if (state.mode.includes('t')) { nb.y += dy; nb.h -= dy; }
        if (state.mode.includes('b')) { nb.h += dy; }
        if (nb.w < 1) { nb.x -= (1 - nb.w); nb.w = 1; }
        if (nb.h < 1) { nb.y -= (1 - nb.h); nb.h = 1; }
      }
      state.currentBounds = nb;
      
      const transformed = transformStrokes(state.strokes, state.startBounds, state.currentBounds);
      const temp = tempBufferRef.current;
      if (temp) {
        bakeAllDrawings(transformed, temp.ctx, temp.canvas.width, temp.canvas.height);
      }
      drawMainFrame();
      return;
    }
`;
code = code.replace(oldPointerMoveStart, newPointerMoveStart);

// pointerUp logic
const oldPointerUpStart = `  const handlePointerUp = (e: React.PointerEvent) => {
    isPointerDownRef.current = false;
    if (!isDrawingMode) return;`;

const newPointerUpStart = `  const handlePointerUp = (e: React.PointerEvent) => {
    isPointerDownRef.current = false;
    if (!isDrawingMode) return;
    
    if (transformStateRef.current) {
      const state = transformStateRef.current;
      if (state.currentBounds.x !== state.startBounds.x || state.currentBounds.w !== state.startBounds.w || state.currentBounds.y !== state.startBounds.y || state.currentBounds.h !== state.startBounds.h) {
        const transformed = transformStrokes(state.strokes, state.startBounds, state.currentBounds);
        const nextDrawings = drawings.map(s => {
          const t = transformed.find(ts => ts.id === s.id);
          return t ? t : s;
        });
        onChange(nextDrawings);
      }
      transformStateRef.current = null;
      lastDrawingsRef.current = []; // force rebake layerBuffer
      const buf = layerBufferRef.current;
      if (buf) bakeAllDrawings(drawings, buf.ctx, buf.canvas.width, buf.canvas.height);
      requestRender();
      return;
    }
`;
code = code.replace(oldPointerUpStart, newPointerUpStart);

fs.writeFileSync('src/components/comic/RasterDrawingCanvas.tsx', code);
console.log('Patched pointer logic');
