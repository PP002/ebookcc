const fs = require('fs');
let code = fs.readFileSync('src/components/comic/RasterDrawingCanvas.tsx', 'utf-8');

// Remove background layer drawing
const bgStart = `      // Find background layer
      const bgLayer = layers.find((l) => l.isBackground);
      if (bgLayer && bgLayer.visible !== false) {
        ctx.save();
        ctx.fillStyle = bgLayer.color || backgroundColor || '#ffffff';
        ctx.fillRect(0, 0, bufW, bufH);
        ctx.restore();
      }`;

code = code.replace(bgStart, `      // Find background layer (Skip rendering background here so it's transparent, letting parent panel image/color show through)
      const bgLayer = layers.find((l) => l.isBackground);`);

fs.writeFileSync('src/components/comic/RasterDrawingCanvas.tsx', code);
console.log('Removed background rendering from RasterDrawingCanvas.');
