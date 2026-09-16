const fs = require('fs');
let code = fs.readFileSync('src/components/comic/smartShapeRecognizer.ts', 'utf8');

// Relax intersection count for circle
code = code.replace(
  'if (intersectionCount > 0) return null; // ANY internal intersection -> scribble/polygon, NOT a circle',
  'if (intersectionCount > 2) return null; // Too many intersections -> scribble'
);

// Trimming hooks in circle
const circleFuncStart = code.indexOf('function checkCircleOrEllipse(');
const circleFuncBody = code.indexOf('{', circleFuncStart) + 1;

const trimLogic = `
  // Trim start/end hooks for better ellipse fitting
  const trimSize = Math.floor(points.length * 0.1);
  const trimmed = points.length > 10 ? points.slice(trimSize, points.length - trimSize) : points;
  
  // Recompute bounds and center based on trimmed points to ignore hooks
  let tMinX = trimmed[0].x, tMaxX = trimmed[0].x, tMinY = trimmed[0].y, tMaxY = trimmed[0].y;
  for (const pt of trimmed) {
    if (pt.x < tMinX) tMinX = pt.x;
    if (pt.x > tMaxX) tMaxX = pt.x;
    if (pt.y < tMinY) tMinY = pt.y;
    if (pt.y > tMaxY) tMaxY = pt.y;
  }
  const tW = tMaxX - tMinX;
  const tH = tMaxY - tMinY;
  const cx = (tMinX + tMaxX) / 2;
  const cy = (tMinY + tMaxY) / 2;
`;

// Replace cx/cy logic
code = code.replace(
  /\/\/ Center[\s\S]*?const cy = \(minY \+ maxY\) \/ 2;/,
  trimLogic
);

// Replace radii logic to use trimmed points
code = code.replace(
  /const radii = points\.map\(\(p\) => Math\.hypot\(\(p\.x - cx\), \(p\.y - cy\)\)\);/,
  'const radii = trimmed.map((p) => Math.hypot(p.x - cx, p.y - cy));'
);

code = code.replace(
  /for \(const p of points\) \{/g,
  'for (const p of trimmed) {'
);

fs.writeFileSync('src/components/comic/smartShapeRecognizer.ts', code);
