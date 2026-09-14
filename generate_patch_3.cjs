const fs = require('fs');
let code = fs.readFileSync('src/components/comic/RasterDrawingCanvas.tsx', 'utf-8');

const oldDrawTemp = `    // 2. Render drafting tempBuffer (in-progress stroke) with EXACT same transformation
    const tempBuf = tempBufferRef.current;
    if (tempBuf && isPointerDownRef.current && activeStrokeRef.current) {`;
const newDrawTemp = `    // 2. Render drafting tempBuffer (in-progress stroke) with EXACT same transformation
    const tempBuf = tempBufferRef.current;
    if (tempBuf && ((isPointerDownRef.current && activeStrokeRef.current) || transformStateRef.current)) {`;

code = code.replace(oldDrawTemp, newDrawTemp);

const oldSelectionRender = `    // 4. Render selected items bounds
    if (selectedIds.size > 0 && isDrawingMode) {
      ctx.save();
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      
      for (const stroke of drawings) {
        if (selectedIds.has(stroke.id)) {
          if (stroke.type === 'fill' && stroke.bounds) {
             const bx = (stroke.bounds.x / 100) * pixelW;
             const by = (stroke.bounds.y / 100) * pixelH;
             const bw = (stroke.bounds.w / 100) * pixelW;
             const bh = (stroke.bounds.h / 100) * pixelH;
             ctx.strokeRect(bx, by, bw, bh);
          } else if (stroke.points && stroke.points.length > 0) {
            let minX = 100, minY = 100, maxX = 0, maxY = 0;
            stroke.points.forEach(p => {
              if (p.x < minX) minX = p.x;
              if (p.x > maxX) maxX = p.x;
              if (p.y < minY) minY = p.y;
              if (p.y > maxY) maxY = p.y;
            });
            const r = stroke.brushRadius || 2;
            const px = ((minX - r) / 100) * pixelW;
            const py = ((minY - r * (pixelW/pixelH)) / 100) * pixelH;
            const pw = ((maxX - minX + r * 2) / 100) * pixelW;
            const ph = ((maxY - minY + r * 2 * (pixelW/pixelH)) / 100) * pixelH;
            ctx.strokeRect(px, py, pw, ph);
          }
        }
      }
      ctx.restore();
    }`;

const newSelectionRender = `    // 4. Render selected items bounds
    if (selectedIds.size > 0 && isDrawingMode) {
      const bounds = transformStateRef.current ? transformStateRef.current.currentBounds : getSelectionBounds(drawings, selectedIds, dimensions.width, dimensions.height);
      
      if (bounds) {
        ctx.save();
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        
        const bx = (bounds.x / 100) * pixelW;
        const by = (bounds.y / 100) * pixelH;
        const bw = (bounds.w / 100) * pixelW;
        const bh = (bounds.h / 100) * pixelH;
        
        ctx.strokeRect(bx, by, bw, bh);
        
        // Draw handles
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffffff';
        const hSize = 3 * dpr;
        const drawHandle = (hx: number, hy: number) => {
          ctx.fillRect(hx - hSize, hy - hSize, hSize * 2, hSize * 2);
          ctx.strokeRect(hx - hSize, hy - hSize, hSize * 2, hSize * 2);
        };
        
        drawHandle(bx, by);
        drawHandle(bx + bw, by);
        drawHandle(bx, by + bh);
        drawHandle(bx + bw, by + bh);
        drawHandle(bx + bw / 2, by);
        drawHandle(bx + bw / 2, by + bh);
        drawHandle(bx, by + bh / 2);
        drawHandle(bx + bw, by + bh / 2);
        
        ctx.restore();
      }
    }`;

code = code.replace(oldSelectionRender, newSelectionRender);

// also in style attribute for container, we should use PRECISE_CROSSHAIR_CURSOR or maybe not overwrite the one set by pointermove
const oldCursorStyle = `        cursor: isDrawingMode ? PRECISE_CROSSHAIR_CURSOR : undefined,`;
const newCursorStyle = `        // cursor is now managed dynamically in pointerMove`;
code = code.replace(oldCursorStyle, newCursorStyle);

fs.writeFileSync('src/components/comic/RasterDrawingCanvas.tsx', code);
console.log('Patched drawTemp and selection');
