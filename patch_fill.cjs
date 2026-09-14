const fs = require('fs');
let code = fs.readFileSync('src/components/comic/RasterDrawingCanvas.tsx', 'utf-8');

// 1. Fix Flood Fill
const oldFillStart = `
    const startIdx = (startY * w + startX) * 4;
    // If clicked on an existing dark stroke boundary, do not fill
    if (data[startIdx + 3] > 120) return;

    // Flood fill traversal
    const visited = new Uint8Array(w * h);
    const queue: number[] = [startX, startY];
    visited[startY * w + startX] = 1;

    const filledPixels: number[] = [];
    let reachedEdge = false;
    const ALPHA_BARRIER = 80;

    let minX = startX, maxX = startX, minY = startY, maxY = startY;

    while (queue.length > 0) {
`;

const newFillStart = `
    const startIdx = (startY * w + startX) * 4;
    const targetR = data[startIdx];
    const targetG = data[startIdx + 1];
    const targetB = data[startIdx + 2];
    const targetA = data[startIdx + 3];

    // If filling with the same color, abort
    if (Math.abs(targetR - fr) < 5 && Math.abs(targetG - fg) < 5 && Math.abs(targetB - fb) < 5) return;

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
`;
code = code.replace(oldFillStart, newFillStart);

const oldFillLoop = `
        const nIdx = nPos * 4;
        const nAlpha = data[nIdx + 3];

        if (nAlpha < ALPHA_BARRIER) {
          queue.push(nx, ny);
        }
`;

const newFillLoop = `
        const nIdx = nPos * 4;
        if (colorMatch(nIdx)) {
          queue.push(nx, ny);
        }
`;
code = code.replace(oldFillLoop, newFillLoop);

// 2. Fix Lasso render inside drawMainFrame
const oldDrawMain = `
    // 2. Render drafting tempBuffer (in-progress stroke) with EXACT same transformation
    const tempBuf = tempBufferRef.current;
    if (tempBuf && isPointerDownRef.current && activeStrokeRef.current) {
      ctx.drawImage(
        tempBuf.canvas,
        0, 0, tempBuf.canvas.width, tempBuf.canvas.height,
        0, 0, pixelW, pixelH
      );
    }
  };
`;

const newDrawMain = `
    // 2. Render drafting tempBuffer (in-progress stroke) with EXACT same transformation
    const tempBuf = tempBufferRef.current;
    if (tempBuf && isPointerDownRef.current && activeStrokeRef.current) {
      ctx.drawImage(
        tempBuf.canvas,
        0, 0, tempBuf.canvas.width, tempBuf.canvas.height,
        0, 0, pixelW, pixelH
      );
    }

    // 3. Render Selection (Lasso path + selected items)
    if (lassoPath && lassoPath.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#007AFF';
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([5 * dpr, 5 * dpr]);
      ctx.beginPath();
      lassoPath.forEach((pt, i) => {
        const x = (pt.x / 100) * pixelW;
        const y = (pt.y / 100) * pixelH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (!isPointerDownRef.current) ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = 'rgba(0, 122, 255, 0.15)';
      ctx.fill();
      ctx.restore();
    }

    if (selectedIds.size > 0 && isDrawingMode) {
      ctx.save();
      ctx.strokeStyle = '#007AFF';
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      
      const layerBuf = layerBufferRef.current;
      const bufW = layerBuf?.canvas.width || pixelW;
      const bufH = layerBuf?.canvas.height || pixelH;

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
    }
  };
`;
// Fix because oldDrawMain has "as CanvasImageSource"
const actualOldDrawMain = `
    // 2. Render drafting tempBuffer (in-progress stroke) with EXACT same transformation
    const tempBuf = tempBufferRef.current;
    if (tempBuf && isPointerDownRef.current && activeStrokeRef.current) {
      ctx.drawImage(
        tempBuf.canvas as CanvasImageSource,
        0, 0, tempBuf.canvas.width, tempBuf.canvas.height,
        0, 0, pixelW, pixelH
      );
    }
  };
`;
const actualNewDrawMain = actualOldDrawMain.replace('  };\n', '') + newDrawMain.replace(`
    // 2. Render drafting tempBuffer (in-progress stroke) with EXACT same transformation
    const tempBuf = tempBufferRef.current;
    if (tempBuf && isPointerDownRef.current && activeStrokeRef.current) {
      ctx.drawImage(
        tempBuf.canvas,
        0, 0, tempBuf.canvas.width, tempBuf.canvas.height,
        0, 0, pixelW, pixelH
      );
    }
`, '');
code = code.replace(actualOldDrawMain, actualNewDrawMain);

fs.writeFileSync('src/components/comic/RasterDrawingCanvas.tsx', code);
console.log('Applied fill and lasso patches.');
