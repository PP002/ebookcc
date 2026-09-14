const fs = require('fs');
let code = fs.readFileSync('src/components/comic/RasterDrawingCanvas.tsx', 'utf-8');

const oldStrokeInLasso = `
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

const newStrokeInLasso = `
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
`.trim();

code = code.replace(oldStrokeInLasso, newStrokeInLasso);
fs.writeFileSync('src/components/comic/RasterDrawingCanvas.tsx', code);
console.log('Fixed strokeInLasso for fill bounds.');
