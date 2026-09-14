const fs = require('fs');
let code = fs.readFileSync('src/components/comic/RasterDrawingCanvas.tsx', 'utf-8');

const effectToAdd = `
  // Trigger render when lasso or selection changes
  useEffect(() => {
    requestRender();
  }, [lassoPath, selectedIds, requestRender]);
`;

const insertAfter = `
  // Re-bake when drawings, layers, or background color change externally
  useEffect(() => {
    if (
      drawings !== lastDrawingsRef.current ||
      layers !== lastLayersRef.current ||
      backgroundColor !== lastBgColorRef.current
    ) {
      lastDrawingsRef.current = drawings;
      lastLayersRef.current = layers;
      lastBgColorRef.current = backgroundColor;
      const buf = layerBufferRef.current;
      if (buf) {
        bakeAllDrawings(drawings, buf.ctx, buf.canvas.width, buf.canvas.height);
        requestRender();
      }
    }
  }, [drawings, layers, backgroundColor, bakeAllDrawings, requestRender]);
`.trim();

code = code.replace(insertAfter, insertAfter + "\n" + effectToAdd);

fs.writeFileSync('src/components/comic/RasterDrawingCanvas.tsx', code);
console.log('Added useEffect for lassoPath and selectedIds rendering.');
