const fs = require('fs');
let code = fs.readFileSync('src/components/comic/RasterDrawingCanvas.tsx', 'utf-8');

// 1. Fix strokeInLasso to check multiple points
const oldStrokeInLasso = `
function strokeInLasso(s: Stroke, lasso: Point[]): boolean {
  if (!s.points || s.points.length === 0 || lasso.length < 3) return false;
  const p = s.points[0];
  let inside = false;
  for (let i = 0, j = lasso.length - 1; i < lasso.length; j = i++) {
    const xi = lasso[i].x,
      yi = lasso[i].y;
    const xj = lasso[j].x,
      yj = lasso[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
`.trim();

const newStrokeInLasso = `
function strokeInLasso(s: Stroke, lasso: Point[]): boolean {
  if (!s.points || s.points.length === 0 || lasso.length < 3) return false;
  
  // Check if ANY point is inside the lasso
  for (let step = 0; step < s.points.length; step += Math.max(1, Math.floor(s.points.length / 10))) {
    const p = s.points[step];
    let inside = false;
    for (let i = 0, j = lasso.length - 1; i < lasso.length; j = i++) {
      const xi = lasso[i].x, yi = lasso[i].y;
      const xj = lasso[j].x, yj = lasso[j].y;
      const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}
`.trim();

code = code.replace(oldStrokeInLasso, newStrokeInLasso);

// 2. Add selected items rendering to drawMainFrame
const oldLassoRender = `
    // 3. Render lasso selection overlay if active
    if (lassoPath && lassoPath.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#3b82f6';
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
      ctx.stroke();
      ctx.restore();
    }
  };
`.trim();

const newLassoRender = `
    // 3. Render lasso selection overlay if active
    if (lassoPath && lassoPath.length > 1) {
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

    // 4. Render selected items bounds
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
    }
  };
`.trim();

code = code.replace(oldLassoRender, newLassoRender);

// Also need to make sure `drawings` and `selectedIds` can be accessed in `drawMainFrame`.
// Oh wait, `drawMainFrame` is inside the component, so it can access `drawings` and `selectedIds`! Wait, no, `drawMainFrame` is defined as a closure without dependencies for `requestRender`?? Let's check if it uses a ref or fresh closure.
fs.writeFileSync('src/components/comic/RasterDrawingCanvas.tsx', code);
console.log('Patched lasso rendering.');
