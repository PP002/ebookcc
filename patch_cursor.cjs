const fs = require('fs');
let code = fs.readFileSync('src/components/comic/RasterDrawingCanvas.tsx', 'utf-8');

const oldCursor = `
      style={{
        cursor: isDrawingMode
          ? drawTool === 'fill'
            ? FILL_BUCKET_CURSOR
            : PRECISE_CROSSHAIR_CURSOR
          : undefined,
      }}
`.trim();

const newCursor = `
      style={{
        cursor: isDrawingMode ? PRECISE_CROSSHAIR_CURSOR : undefined,
      }}
`.trim();

if (code.includes(oldCursor)) {
  code = code.replace(oldCursor, newCursor);
  fs.writeFileSync('src/components/comic/RasterDrawingCanvas.tsx', code);
  console.log('Patched cursor');
} else {
  console.log('Could not find cursor code');
}
