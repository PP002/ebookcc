const fs = require('fs');
let code = fs.readFileSync('src/components/comic/RasterDrawingCanvas.tsx', 'utf-8');

const oldDrawMainFrameStart = `
  // Composite layers and temp buffer to main screen canvas
  const drawMainFrame = () => {
`.trim();

const newDrawMainFrameStart = `
  // We use a ref to always call the latest drawMainFrame inside requestRender
  const drawMainFrameRef = useRef<() => void>();

  // Composite layers and temp buffer to main screen canvas
  const drawMainFrame = () => {
`.trim();

const oldRequestRender = `
  // Request render to main display canvas
  const requestRender = useCallback(() => {
    if (rafIdRef.current) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      drawMainFrame();
    });
  }, []);
`.trim();

const newRequestRender = `
  // Request render to main display canvas
  const requestRender = useCallback(() => {
    if (rafIdRef.current) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      if (drawMainFrameRef.current) drawMainFrameRef.current();
    });
  }, []);

  drawMainFrameRef.current = () => {
`.trim();

code = code.replace(oldRequestRender, newRequestRender);
code = code.replace(
  `  const drawMainFrame = () => {\n    const mainCanvas = mainCanvasRef.current;`, 
  `  const drawMainFrame = () => {\n    const mainCanvas = mainCanvasRef.current;`
); // Let's just do a simpler replace

// Actually, simpler to just replace:
let cleanCode = fs.readFileSync('src/components/comic/RasterDrawingCanvas.tsx', 'utf-8');
const searchReq = `  // Request render to main display canvas
  const requestRender = useCallback(() => {
    if (rafIdRef.current) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      drawMainFrame();
    });
  }, []);`;

const replaceReq = `  const drawMainFrameRef = useRef<() => void>(() => {});
  // Request render to main display canvas
  const requestRender = useCallback(() => {
    if (rafIdRef.current) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      drawMainFrameRef.current();
    });
  }, []);`;

cleanCode = cleanCode.replace(searchReq, replaceReq);

const searchDraw = `  // Composite layers and temp buffer to main screen canvas
  const drawMainFrame = () => {`;
const replaceDraw = `  // Composite layers and temp buffer to main screen canvas
  const drawMainFrame = () => {`;
// Wait, we just assign to ref!
const toAdd = `
  drawMainFrameRef.current = drawMainFrame;
`;

cleanCode = cleanCode.replace(searchDraw, searchDraw + toAdd);

fs.writeFileSync('src/components/comic/RasterDrawingCanvas.tsx', cleanCode);
console.log('Fixed requestRender closure stale issue.');
