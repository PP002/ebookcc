const fs = require('fs');
let code = fs.readFileSync('src/components/comic/RasterDrawingCanvas.tsx', 'utf-8');

const helpers = `
function getSelectionBounds(strokes: Stroke[], selectedIds: Set<string>, width: number, height: number) {
  let minX = 1000, minY = 1000, maxX = -1000, maxY = -1000;
  let hasValid = false;
  strokes.forEach(s => {
    if (!selectedIds.has(s.id)) return;
    if (s.type === 'fill' && s.bounds) {
      if (s.bounds.x < minX) minX = s.bounds.x;
      if (s.bounds.x + s.bounds.w > maxX) maxX = s.bounds.x + s.bounds.w;
      if (s.bounds.y < minY) minY = s.bounds.y;
      if (s.bounds.y + s.bounds.h > maxY) maxY = s.bounds.y + s.bounds.h;
      hasValid = true;
    } else if (s.points && s.points.length > 0) {
      const r = s.brushRadius || 2;
      const aspect = width / height;
      s.points.forEach(p => {
        if (p.x - r < minX) minX = p.x - r;
        if (p.x + r > maxX) maxX = p.x + r;
        if (p.y - r * aspect < minY) minY = p.y - r * aspect;
        if (p.y + r * aspect > maxY) maxY = p.y + r * aspect;
      });
      hasValid = true;
    }
  });
  if (!hasValid) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function transformStrokes(strokes: Stroke[], startBounds: {x:number, y:number, w:number, h:number}, currentBounds: {x:number, y:number, w:number, h:number}): Stroke[] {
  if (startBounds.w === 0 || startBounds.h === 0) return strokes;
  const scaleX = currentBounds.w / startBounds.w;
  const scaleY = currentBounds.h / startBounds.h;
  const dx = currentBounds.x - startBounds.x * scaleX;
  const dy = currentBounds.y - startBounds.y * scaleY;
  
  return strokes.map(s => {
    if (s.type === 'fill' && s.bounds) {
      return {
        ...s,
        bounds: {
          x: s.bounds.x * scaleX + dx,
          y: s.bounds.y * scaleY + dy,
          w: s.bounds.w * scaleX,
          h: s.bounds.h * scaleY
        }
      };
    } else if (s.points) {
      return {
        ...s,
        points: s.points.map(p => ({
          x: p.x * scaleX + dx,
          y: p.y * scaleY + dy
        })),
        brushRadius: s.brushRadius ? s.brushRadius * Math.max(scaleX, scaleY) : undefined
      };
    }
    return s;
  });
}
`;

// Insert helpers before component
code = code.replace("export const RasterDrawingCanvas: React.FC<RasterDrawingCanvasProps> = ({", helpers + "\nexport const RasterDrawingCanvas: React.FC<RasterDrawingCanvasProps> = ({");

// Insert ref
const refCode = `
  const transformStateRef = useRef<{
    active: boolean;
    mode: 'move' | 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r';
    startPt: Point;
    startBounds: { x: number, y: number, w: number, h: number };
    currentBounds: { x: number, y: number, w: number, h: number };
    strokes: Stroke[];
  } | null>(null);
  
  const hitTestSelection = (pt: Point) => {
    if (selectedIds.size === 0 || drawTool !== 'select') return null;
    const bounds = getSelectionBounds(drawings, selectedIds, dimensions.width, dimensions.height);
    if (!bounds) return null;
    
    const rx = 1500 / dimensions.width;
    const ry = 1500 / dimensions.height;
    const { x, y, w, h } = bounds;
    
    // Corners
    if (Math.abs(pt.x - x) <= rx && Math.abs(pt.y - y) <= ry) return 'tl';
    if (Math.abs(pt.x - (x+w)) <= rx && Math.abs(pt.y - y) <= ry) return 'tr';
    if (Math.abs(pt.x - x) <= rx && Math.abs(pt.y - (y+h)) <= ry) return 'bl';
    if (Math.abs(pt.x - (x+w)) <= rx && Math.abs(pt.y - (y+h)) <= ry) return 'br';
    
    // Edges
    if (Math.abs(pt.y - y) <= ry && pt.x >= x && pt.x <= x+w) return 't';
    if (Math.abs(pt.y - (y+h)) <= ry && pt.x >= x && pt.x <= x+w) return 'b';
    if (Math.abs(pt.x - x) <= rx && pt.y >= y && pt.y <= y+h) return 'l';
    if (Math.abs(pt.x - (x+w)) <= rx && pt.y >= y && pt.y <= y+h) return 'r';
    
    // Inside
    if (pt.x >= x && pt.x <= x+w && pt.y >= y && pt.y <= y+h) return 'move';
    return null;
  };
`;
code = code.replace("const [lassoPath, setLassoPathState] = useState<Point[] | null>(null);", refCode + "\n  const [lassoPath, setLassoPathState] = useState<Point[] | null>(null);");

fs.writeFileSync('src/components/comic/RasterDrawingCanvas.tsx', code);
console.log('Patched top level');
