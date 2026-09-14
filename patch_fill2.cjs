const fs = require('fs');
let code = fs.readFileSync('src/components/comic/RasterDrawingCanvas.tsx', 'utf-8');

code = code.replace(
  "if (Math.abs(targetR - fr) < 5 && Math.abs(targetG - fg) < 5 && Math.abs(targetB - fb) < 5) return;",
  "if (Math.abs(targetR - fr) < 5 && Math.abs(targetG - fg) < 5 && Math.abs(targetB - fb) < 5 && Math.abs(targetA - fa) < 5) return;"
);

fs.writeFileSync('src/components/comic/RasterDrawingCanvas.tsx', code);
console.log('Patched alpha check in handleFillClick.');
