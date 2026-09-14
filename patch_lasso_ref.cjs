const fs = require('fs');
let code = fs.readFileSync('src/components/comic/RasterDrawingCanvas.tsx', 'utf-8');

const lassoStateStr = 'const [lassoPath, setLassoPath] = useState<Point[] | null>(null);';
const lassoRefStr = `
  const [lassoPath, setLassoPathState] = useState<Point[] | null>(null);
  const lassoPathRef = useRef<Point[] | null>(null);
  const setLassoPath = useCallback((val: Point[] | null | ((prev: Point[] | null) => Point[] | null)) => {
    if (typeof val === 'function') {
      lassoPathRef.current = val(lassoPathRef.current);
    } else {
      lassoPathRef.current = val;
    }
    setLassoPathState(lassoPathRef.current);
  }, []);
`.trim();

code = code.replace(lassoStateStr, lassoRefStr);

// In handlePointerUp, change lassoPath to lassoPathRef.current
const oldUpStr = `    } else if (drawTool === 'select' && lassoPath && lassoPath.length > 2) {
      const selected = drawings.filter((s) => strokeInLasso(s, lassoPath));`;
const newUpStr = `    } else if (drawTool === 'select' && lassoPathRef.current && lassoPathRef.current.length > 2) {
      const selected = drawings.filter((s) => strokeInLasso(s, lassoPathRef.current!));`;

code = code.replace(oldUpStr, newUpStr);

fs.writeFileSync('src/components/comic/RasterDrawingCanvas.tsx', code);
console.log('Patched lasso path ref');
