import React, { useState, useRef, useEffect } from 'react';
import { Plus, Bot, Image as ImageIcon, Trash2, Contrast, Square, ArrowUp, ArrowDown, Crop, Move } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { ImageToolbar } from './ImageToolbar';

export type Point = { x: number, y: number };

const hitMapCache = new Map<string, { data: Uint8ClampedArray, width: number, height: number }>();
export type Stroke = { 
  id: string, 
  type?: 'stroke' | 'fill',
  points: Point[], 
  color: string, 
  brushRadius: number, 
  fill?: string,
  imageUrl?: string,
  bounds?: {x: number, y: number, w: number, h: number}
};

export type Direction = 'row' | 'col';
export type PanelNode = {
  id: string;
  type: 'panel';
  imageUrl?: string;
  drawings?: Stroke[];
  isHighContrast?: boolean;
  hasOutline?: boolean;
  color?: string;
};
export type SplitNode = {
  id: string;
  type: 'split';
  dir: Direction;
  percent: number; // 0 to 100
  c1: TreeNode;
  c2: TreeNode;
};
export type TreeNode = PanelNode | SplitNode;

export const genId = () => Math.random().toString(36).substring(2, 9);

export function makeGrid(rows: number, cols: number): TreeNode {
  const mkRow = (): TreeNode => {
    let nodes: TreeNode[] = Array.from({ length: cols }).map(() => ({ type: 'panel', id: genId() }));
    while (nodes.length > 1) {
      const c2 = nodes.pop()!;
      const c1 = nodes.pop()!;
      nodes.push({
        type: 'split',
        id: genId(),
        dir: 'row',
        percent: 100 * ((nodes.length + 1) / (nodes.length + 2)), // Wait, this math might be wrong. Let's just do a simpler tree.
        c1, c2
      });
    }
    return nodes[0];
  };

  const rowsArr = Array.from({ length: rows }).map(mkRow);
  let root = rowsArr[0];
  for (let r = 1; r < rows; r++) {
    root = {
      type: 'split',
      id: genId(),
      dir: 'col',
      percent: 100 * (r / (r + 1)),
      c1: root,
      c2: rowsArr[r]
    };
  }
  return root;
}

// Fixed balanced tree generator
export function createGridTree(rows: number, cols: number): TreeNode {
  const build = (r1: number, r2: number, c1: number, c2: number): TreeNode => {
    if (r2 === r1 && c2 === c1) return { type: 'panel', id: genId() };
    if (r2 > r1) {
      const mid = Math.floor((r1 + r2) / 2);
      return {
        type: 'split', id: genId(), dir: 'col',
        percent: ((mid - r1 + 1) / (r2 - r1 + 1)) * 100,
        c1: build(r1, mid, c1, c2),
        c2: build(mid + 1, r2, c1, c2)
      };
    } else {
      const mid = Math.floor((c1 + c2) / 2);
      return {
        type: 'split', id: genId(), dir: 'row',
        percent: ((mid - c1 + 1) / (c2 - c1 + 1)) * 100,
        c1: build(r1, r2, c1, mid),
        c2: build(r1, r2, mid + 1, c2)
      };
    }
  };
  return build(0, rows - 1, 0, cols - 1);
}

export function fillFirstEmptyPanel(tree: TreeNode, imageUrl: string): { tree: TreeNode; updated: boolean } {
  if (tree.type === 'panel') {
    if (!tree.imageUrl) {
      return { tree: { ...tree, imageUrl }, updated: true };
    }
    return { tree, updated: false };
  }
  
  const { tree: newC1, updated: u1 } = fillFirstEmptyPanel(tree.c1, imageUrl);
  if (u1) return { tree: { ...tree, c1: newC1 }, updated: true };
  
  const { tree: newC2, updated: u2 } = fillFirstEmptyPanel(tree.c2, imageUrl);
  if (u2) return { tree: { ...tree, c2: newC2 }, updated: true };
  
  return { tree, updated: false };
}

export function updatePanelImage(tree: TreeNode, targetIndex: number, url: string, currentIndex: { value: number } = { value: 0 }): { tree: TreeNode; updated: boolean } {
  if (tree.type === 'panel') {
    if (currentIndex.value === targetIndex) {
      return { tree: { ...tree, imageUrl: url }, updated: true };
    }
    currentIndex.value++;
    return { tree, updated: false };
  }
  
  const { tree: newC1, updated: u1 } = updatePanelImage(tree.c1, targetIndex, url, currentIndex);
  if (u1) return { tree: { ...tree, c1: newC1 }, updated: true };
  
  const { tree: newC2, updated: u2 } = updatePanelImage(tree.c2, targetIndex, url, currentIndex);
  if (u2) return { tree: { ...tree, c2: newC2 }, updated: true };
  
  return { tree, updated: false };
}

interface ComicCanvasProps {
  tree: TreeNode;
  onChange: (tree: TreeNode) => void;
  isDrawingMode?: boolean;
  drawTool?: 'pen'|'erase'|'select'|'fill';
  drawColor?: string;
  drawRadius?: number;
}

export const ComicCanvas: React.FC<ComicCanvasProps> = ({ tree, onChange, isDrawingMode = false, drawTool = 'pen', drawColor = '#000000', drawRadius = 2 }) => {
  const addAtEdge = (edge: 'top' | 'bottom' | 'left' | 'right') => {
    let newTree: TreeNode;
    if (edge === 'left') {
      newTree = {
        type: 'split',
        id: genId(),
        dir: 'row',
        percent: 25,
        c1: { type: 'panel', id: genId() },
        c2: tree
      };
    } else if (edge === 'right') {
      newTree = {
        type: 'split',
        id: genId(),
        dir: 'row',
        percent: 75,
        c1: tree,
        c2: { type: 'panel', id: genId() }
      };
    } else if (edge === 'top') {
      newTree = {
        type: 'split',
        id: genId(),
        dir: 'col',
        percent: 25,
        c1: { type: 'panel', id: genId() },
        c2: tree
      };
    } else { // bottom
      newTree = {
        type: 'split',
        id: genId(),
        dir: 'col',
        percent: 75,
        c1: tree,
        c2: { type: 'panel', id: genId() }
      };
    }
    onChange(newTree);
  };

  return (
    <div className="w-full h-full bg-white relative select-none group/canvas">
      <SplitView node={tree} path={[]} onChange={onChange} rootTree={tree} isDrawingMode={isDrawingMode} drawTool={drawTool} drawColor={drawColor} drawRadius={drawRadius} />

      {/* Top Edge Plus Button */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 opacity-0 group-hover/canvas:opacity-100 transition-opacity" data-export-ignore="true">
        <Button 
          size="icon" 
          variant="secondary" 
          className="w-6 h-6 rounded-full border border-foreground shadow-md bg-white hover:bg-zinc-100 hover:scale-115 transition-all text-black p-0 flex items-center justify-center cursor-pointer"
          onClick={() => addAtEdge('top')}
          title="Add panel at top edge"
        >
          <Plus className="w-3.5 h-3.5 stroke-[3]" />
        </Button>
      </div>

      {/* Bottom Edge Plus Button */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-30 opacity-0 group-hover/canvas:opacity-100 transition-opacity" data-export-ignore="true">
        <Button 
          size="icon" 
          variant="secondary" 
          className="w-6 h-6 rounded-full border border-foreground shadow-md bg-white hover:bg-zinc-100 hover:scale-115 transition-all text-black p-0 flex items-center justify-center cursor-pointer"
          onClick={() => addAtEdge('bottom')}
          title="Add panel at bottom edge"
        >
          <Plus className="w-3.5 h-3.5 stroke-[3]" />
        </Button>
      </div>

      {/* Left Edge Plus Button */}
      <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-30 opacity-0 group-hover/canvas:opacity-100 transition-opacity" data-export-ignore="true">
        <Button 
          size="icon" 
          variant="secondary" 
          className="w-6 h-6 rounded-full border border-foreground shadow-md bg-white hover:bg-zinc-100 hover:scale-115 transition-all text-black p-0 flex items-center justify-center cursor-pointer"
          onClick={() => addAtEdge('left')}
          title="Add panel at left edge"
        >
          <Plus className="w-3.5 h-3.5 stroke-[3]" />
        </Button>
      </div>

      {/* Right Edge Plus Button */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-30 opacity-0 group-hover/canvas:opacity-100 transition-opacity" data-export-ignore="true">
        <Button 
          size="icon" 
          variant="secondary" 
          className="w-6 h-6 rounded-full border border-foreground shadow-md bg-white hover:bg-zinc-100 hover:scale-115 transition-all text-black p-0 flex items-center justify-center cursor-pointer"
          onClick={() => addAtEdge('right')}
          title="Add panel at right edge"
        >
          <Plus className="w-3.5 h-3.5 stroke-[3]" />
        </Button>
      </div>
    </div>
  );
};

const SplitView: React.FC<{ node: TreeNode; path: number[]; onChange: (t: TreeNode) => void; rootTree: TreeNode; isDrawingMode: boolean; drawTool: 'pen'|'erase'|'select'|'fill'; drawColor: string; drawRadius: number; }> = ({ node, path, onChange, rootTree, isDrawingMode, drawTool, drawColor, drawRadius }) => {
  if (node.type === 'panel') {
    return <PanelView node={node} path={path} onChange={onChange} rootTree={rootTree} isDrawingMode={isDrawingMode} drawTool={drawTool} drawColor={drawColor} drawRadius={drawRadius} />;
  }

  const { dir, percent, c1, c2 } = node;

  const replaceNode = (newTree: TreeNode, currentPath: number[], replacement: TreeNode): TreeNode => {
    if (currentPath.length === 0) return replacement;
    if (newTree.type === 'panel') return newTree;
    const isFirst = currentPath[0] === 0;
    const nextPath = currentPath.slice(1);
    return {
      ...newTree,
      c1: isFirst ? replaceNode(newTree.c1, nextPath, replacement) : newTree.c1,
      c2: !isFirst ? replaceNode(newTree.c2, nextPath, replacement) : newTree.c2,
    };
  };

  const setPercent = (p: number) => {
    onChange(replaceNode(rootTree, path, { ...node, percent: p }));
  };

  const handlePlus = () => {
    // Add a new panel in this gutter, by splitting c2
    onChange(replaceNode(rootTree, [...path, 1], {
      type: 'split',
      id: genId(),
      dir: node.dir,
      percent: 50,
      c1: { type: 'panel', id: genId() },
      c2: node.c2
    }));
  };

  return (
    <div className={`relative flex w-full h-full ${dir === 'row' ? 'flex-row' : 'flex-col'}`}>
      <div style={{ [dir === 'row' ? 'width' : 'height']: `${percent}%` }} className="relative">
        <SplitView node={c1} path={[...path, 0]} onChange={onChange} rootTree={rootTree} isDrawingMode={isDrawingMode} drawTool={drawTool} drawColor={drawColor} drawRadius={drawRadius} />
      </div>
      <Gutter dir={dir} percent={percent} onDrag={setPercent} onPlus={handlePlus} />
      <div style={{ [dir === 'row' ? 'width' : 'height']: `${100 - percent}%` }} className="relative">
        <SplitView node={c2} path={[...path, 1]} onChange={onChange} rootTree={rootTree} isDrawingMode={isDrawingMode} drawTool={drawTool} drawColor={drawColor} drawRadius={drawRadius} />
      </div>
    </div>
  );
};

const Gutter: React.FC<{ dir: Direction; percent: number; onDrag: (p: number) => void; onPlus: () => void }> = ({ dir, percent, onDrag, onPlus }) => {
  const isRow = dir === 'row';
  const [showAi, setShowAi] = useState(false);
  const longPressTimeout = useRef<NodeJS.Timeout | null>(null);
  
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    if (e.pointerType === 'mouse' && e.ctrlKey) {
      setShowAi(true);
      return;
    }

    setShowAi(false);
    let isDragging = false;
    
    if (e.pointerType !== 'mouse') {
      longPressTimeout.current = setTimeout(() => {
        if (!isDragging) {
          setShowAi(true);
        }
      }, 500);
    }

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const parent = target.parentElement!;
    const rect = parent.getBoundingClientRect();
    
    const onPointerMove = (ev: PointerEvent) => {
      isDragging = true;
      if (longPressTimeout.current) clearTimeout(longPressTimeout.current);
      let p;
      if (isRow) {
        let x = ev.clientX - rect.left;
        p = (x / rect.width) * 100;
      } else {
        let y = ev.clientY - rect.top;
        p = (y / rect.height) * 100;
      }
      p = Math.max(5, Math.min(95, p));
      onDrag(p);
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (longPressTimeout.current) clearTimeout(longPressTimeout.current);
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', onPointerUp);
    };

    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerup', onPointerUp);
  };

  return (
    <div 
      className={`absolute z-10 flex items-center justify-center bg-transparent hover:bg-primary transition-colors group touch-none select-none ${
        isRow ? 'w-4 h-full -ml-2 top-0 cursor-col-resize' : 'h-4 w-full -mt-2 left-0 cursor-row-resize'
      }`}
      style={{ [isRow ? 'left' : 'top']: `${percent}%` }}
      onPointerDown={handlePointerDown}
      onPointerLeave={() => {
         if (longPressTimeout.current) clearTimeout(longPressTimeout.current);
         setShowAi(false);
      }}
    >
      <div className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity absolute flex gap-1 pointer-events-none text-white z-20" data-export-ignore="true">
        <Button size="icon" variant="default" className="w-6 h-6 rounded-full pointer-events-auto shadow-md" onPointerDown={(e) => { e.stopPropagation(); onPlus(); }} onClick={(e) => e.stopPropagation()}>
            <Plus className="w-4 h-4" />
        </Button>
        {showAi && (
          <Button size="icon" variant="default" className="w-6 h-6 rounded-full pointer-events-auto shadow-md bg-[#2DC6CF] hover:bg-[#20b2ba]" onPointerDown={(e) => { 
              e.stopPropagation(); 
              window.dispatchEvent(new CustomEvent('quote-to-agent', {
                  detail: { type: 'text', text: 'How should I divide this comic panel layout?' }
              }));
              setShowAi(false);
          }} onClick={(e) => e.stopPropagation()}>
              <Bot className="w-3.5 h-3.5 text-black" />
          </Button>
        )}
      </div>
    </div>
  );
};

const distToSegment = (p: Point, v: Point, w: Point) => {
  const l2 = (w.x - v.x)**2 + (w.y - v.y)**2;
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x)*(w.x - v.x) + (p.y - v.y)*(w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (v.x + t*(w.x - v.x)), p.y - (v.y + t*(w.y - v.y)));
};

const pointInPolygon = (point: Point, polygon: Point[]) => {
  let isInside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y))
        && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) isInside = !isInside;
  }
  return isInside;
};

const strokeInLasso = (stroke: Stroke, lasso: Point[]) => {
  if (lasso.length < 3) return false;
  let ptsInside = 0;
  if (stroke.type === 'fill' && stroke.bounds) {
     const ox = stroke.bounds.x, oy = stroke.bounds.y, w = stroke.bounds.w, h = stroke.bounds.h;
     const cache = hitMapCache.get(stroke.id);
     if (cache) {
        const pts = [];
        for (let ix=0.1; ix<=0.9; ix+=0.4) {
           for (let iy=0.1; iy<=0.9; iy+=0.4) {
              const lx = Math.floor(ix * cache.width);
              const ly = Math.floor(iy * cache.height);
              if (cache.data[(ly * cache.width + lx) * 4 + 3] > 64) {
                 pts.push({ x: ox + ix * w, y: oy + iy * h });
              }
           }
        }
        for (const p of pts) if (pointInPolygon(p, lasso)) ptsInside++;
        return ptsInside >= Math.max(1, Math.floor(pts.length * 0.3));
     } else {
        const pts = [
          {x: ox, y: oy}, {x: ox + w, y: oy}, {x: ox, y: oy + h}, {x: ox + w, y: oy + h}
        ];
        for (const p of pts) if (pointInPolygon(p, lasso)) ptsInside++;
        return ptsInside > 1;
     }
  }
  for (const p of stroke.points) {
    if (pointInPolygon(p, lasso)) ptsInside++;
  }
  return ptsInside > 0 && ptsInside >= stroke.points.length * 0.3;
};

const strokeIntersectsCircle = (stroke: Stroke, p: Point, r: number) => {
  if (stroke.type === 'fill' && stroke.bounds) {
    const ox = stroke.bounds.x, oy = stroke.bounds.y, w = stroke.bounds.w, h = stroke.bounds.h;
    if (p.x >= ox && p.x <= ox + w && p.y >= oy && p.y <= oy + h) {
      const cache = hitMapCache.get(stroke.id);
      if (cache) {
         const lx = Math.floor(((p.x - ox) / w) * cache.width);
         const ly = Math.floor(((p.y - oy) / h) * cache.height);
         if (lx >= 0 && lx < cache.width && ly >= 0 && ly < cache.height) {
            const idx = (ly * cache.width + lx) * 4;
            return cache.data[idx + 3] > 64;
         }
         return false;
      }
      return true;
    }
    return false;
  }
  for (let i = 0; i < stroke.points.length; i++) {
    if (i === 0) {
      if (Math.hypot(p.x - stroke.points[0].x, p.y - stroke.points[0].y) <= r) return true;
      continue;
    }
    if (distToSegment(p, stroke.points[i], stroke.points[i-1]) <= r) return true;
  }
  return false;
};

const DrawingCanvas: React.FC<{ 
  drawings: Stroke[];
  onChange: (d: Stroke[]) => void;
  isDrawingMode: boolean;
  drawTool: 'pen'|'erase'|'select'|'fill';
  drawColor: string;
  drawRadius: number;
}> = ({ drawings, onChange, isDrawingMode, drawTool, drawColor, drawRadius }) => {
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);
  const [lassoPath, setLassoPath] = useState<Point[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragType, setDragType] = useState<'move' | 'erase_drag' | 'scale' | null>(null);
  const [isFilling, setIsFilling] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    drawings.forEach(s => {
      if (s.type === 'fill' && s.imageUrl && !hitMapCache.has(s.id)) {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width; canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            hitMapCache.set(s.id, { data: ctx.getImageData(0, 0, img.width, img.height).data, width: img.width, height: img.height });
          }
        };
        img.src = s.imageUrl;
      }
    });
  }, [drawings]);

  const selectedStrokes = drawings.filter(s => selectedIds.has(s.id));
  
  // Find raw bounding box of selected strokes (without padding) for math transformation
  let selectedMinX = Infinity, selectedMaxX = -Infinity, selectedMinY = Infinity, selectedMaxY = -Infinity;
  selectedStrokes.forEach(s => {
    if (s.type === 'fill' && s.bounds) {
      selectedMinX = Math.min(selectedMinX, s.bounds.x);
      selectedMaxX = Math.max(selectedMaxX, s.bounds.x + s.bounds.w);
      selectedMinY = Math.min(selectedMinY, s.bounds.y);
      selectedMaxY = Math.max(selectedMaxY, s.bounds.y + s.bounds.h);
    } else {
      s.points.forEach(p => {
        selectedMinX = Math.min(selectedMinX, p.x);
        selectedMaxX = Math.max(selectedMaxX, p.x);
        selectedMinY = Math.min(selectedMinY, p.y);
        selectedMaxY = Math.max(selectedMaxY, p.y);
      });
    }
  });
  const hasSelection = selectedMinX <= selectedMaxX;
  const selectCenter = hasSelection ? {
    x: (selectedMinX + selectedMaxX) / 2,
    y: (selectedMinY + selectedMaxY) / 2
  } : { x: 50, y: 50 };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0 && isDrawingMode) {
        onChange(drawings.filter(s => !selectedIds.has(s.id)));
        setSelectedIds(new Set());
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [drawings, selectedIds, isDrawingMode, onChange]);

  // Replace selection colors of selected strokes with the newly picked drawColor
  useEffect(() => {
    if (selectedIds.size > 0 && isDrawingMode) {
      const needsUpdate = drawings.some(s => selectedIds.has(s.id) && s.color !== drawColor);
      if (needsUpdate) {
        const updated = drawings.map(s => {
          if (selectedIds.has(s.id)) {
            return { ...s, color: drawColor };
          }
          return s;
        });
        onChange(updated);
      }
    }
  }, [drawColor, selectedIds, drawings, isDrawingMode, onChange]);

  const getPt = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!isDrawingMode) return;
    (e.target as Element).releasePointerCapture(e.pointerId);
    const pt = getPt(e);

    if (drawTool === 'pen') {
      setSelectedIds(new Set());
      setCurrentStroke({ id: Math.random().toString(36).substring(2), points: [pt], color: drawColor, brushRadius: drawRadius });
    } else if (drawTool === 'erase') {
      setSelectedIds(new Set());
      const remaining = drawings.filter(s => !strokeIntersectsCircle(s, pt, 3));
      if (remaining.length !== drawings.length) onChange(remaining);
      setDragType('erase_drag');
    } else if (drawTool === 'select') {
      setLassoPath([pt]);
      setSelectedIds(new Set());
    } else if (drawTool === 'fill') {
      setSelectedIds(new Set());
      if (isFilling) return;
      
      const hitInd = [...drawings].reverse().findIndex(s => strokeIntersectsCircle(s, pt, 2));
      if (hitInd !== -1) {
        const trueInd = drawings.length - 1 - hitInd;
        const clickedStroke = drawings[trueInd];
        
        if (clickedStroke.type === 'fill' && hitMapCache.has(clickedStroke.id)) {
           const cache = hitMapCache.get(clickedStroke.id)!;
           const canvas = document.createElement('canvas');
           canvas.width = cache.width; canvas.height = cache.height;
           const ctx = canvas.getContext('2d')!;
           const idata = ctx.createImageData(cache.width, cache.height);
           const rColor = parseInt(drawColor.slice(1, 3), 16) || 0;
           const gColor = parseInt(drawColor.slice(3, 5), 16) || 0;
           const bColor = parseInt(drawColor.slice(5, 7), 16) || 0;
           for(let i=0; i<cache.data.length; i+=4) {
              if (cache.data[i+3] > 64) {
                 idata.data[i] = rColor;
                 idata.data[i+1] = gColor;
                 idata.data[i+2] = bColor;
                 idata.data[i+3] = 255;
              }
           }
           ctx.putImageData(idata, 0, 0);
           const newUrl = canvas.toDataURL('image/png');
           const updated = [...drawings];
           updated[trueInd] = { ...updated[trueInd], color: drawColor, imageUrl: newUrl };
           hitMapCache.set(updated[trueInd].id, { data: idata.data, width: cache.width, height: cache.height });
           onChange(updated);
           return;
        } else if (clickedStroke.type !== 'fill') {
           const updated = [...drawings];
           updated[trueInd] = { ...updated[trueInd], color: drawColor };
           onChange(updated);
           return;
        }
      }
      
      setIsFilling(true);
      
      requestAnimationFrame(() => {
        const svgRect = svgRef.current!.getBoundingClientRect();
        const canvas = document.createElement('canvas');
        const width = Math.floor(svgRect.width);
        const height = Math.floor(svgRect.height);
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) { setIsFilling(false); return; }
        
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const s of drawings) {
          if (s.type === 'fill' || !s.points || s.points.length === 0) continue;
          ctx.strokeStyle = '#000';
          ctx.lineWidth = Math.max(0.5, s.brushRadius * 0.5);
          ctx.beginPath();
          ctx.moveTo(s.points[0].x * width / 100, s.points[0].y * height / 100);
          if (s.points.length === 1) {
            ctx.lineTo(s.points[0].x * width / 100, s.points[0].y * height / 100);
          } else {
            let i = 1;
            for (; i < s.points.length - 1; i++) {
              const p1 = { x: s.points[i].x * width / 100, y: s.points[i].y * height / 100 };
              const p2 = { x: s.points[i + 1].x * width / 100, y: s.points[i + 1].y * height / 100 };
              const midX = (p1.x + p2.x) / 2;
              const midY = (p1.y + p2.y) / 2;
              ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
            }
            if (i < s.points.length) {
              ctx.lineTo(s.points[i].x * width / 100, s.points[i].y * height / 100);
            }
          }
          ctx.stroke();
        }
        
        const rColor = parseInt(drawColor.slice(1, 3), 16) || 0;
        const gColor = parseInt(drawColor.slice(3, 5), 16) || 0;
        const bColor = parseInt(drawColor.slice(5, 7), 16) || 0;

        const startX = Math.floor(pt.x * width / 100);
        const startY = Math.floor(pt.y * height / 100);
        const srcData = ctx.getImageData(0, 0, width, height).data;
        const fillImageData = ctx.createImageData(width, height);
        const fillData = fillImageData.data;
        const stack = [startX, startY];
        const visited = new Uint8Array(width * height);
        
        let minX = width, minY = height, maxX = 0, maxY = 0;
        let filledPixels = 0;
        
        if (srcData[(startY * width + startX) * 4 + 3] > 64) {
          setIsFilling(false);
          return;
        }

        while (stack.length > 0) {
          const y = stack.pop()!;
          const x = stack.pop()!;
          
          if (x < 0 || x >= width || y < 0 || y >= height) continue;
          
          const idx = y * width + x;
          if (visited[idx]) continue;
          visited[idx] = 1;
          
          if (srcData[idx * 4 + 3] > 64) continue;
          
          fillData[idx * 4] = rColor;
          fillData[idx * 4 + 1] = gColor;
          fillData[idx * 4 + 2] = bColor;
          fillData[idx * 4 + 3] = 255;
          filledPixels++;
          
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          
          stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
        }
        
        if (filledPixels > 0) {
          const padding = 1;
          minX = Math.max(0, minX - padding);
          minY = Math.max(0, minY - padding);
          maxX = Math.min(width - 1, maxX + padding);
          maxY = Math.min(height - 1, maxY + padding);
          
          const bw = maxX - minX + 1;
          const bh = maxY - minY + 1;
          const newBounds = {
            x: (minX / width) * 100,
            y: (minY / height) * 100,
            w: (bw / width) * 100,
            h: (bh / height) * 100
          };
          
          const boundsCanvas = document.createElement('canvas');
          boundsCanvas.width = bw;
          boundsCanvas.height = bh;
          const bCtx = boundsCanvas.getContext('2d');
          if (bCtx) {
            bCtx.putImageData(fillImageData, -minX, -minY);
            const newId = Math.random().toString(36).substring(2);
            hitMapCache.set(newId, { data: bCtx.getImageData(0, 0, bw, bh).data, width: bw, height: bh });
            
            onChange([{
              id: newId,
              type: 'fill',
              points: [],
              color: drawColor,
              brushRadius: 0,
              imageUrl: boundsCanvas.toDataURL('image/png'),
              bounds: newBounds
            }, ...drawings]);
          }
        }
        setIsFilling(false);
      });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDrawingMode) return;
    const pt = getPt(e);

    if (drawTool === 'pen' && currentStroke) {
      const lastPt = currentStroke.points[currentStroke.points.length - 1];
      if (Math.abs(pt.x - lastPt.x) > 0.5 || Math.abs(pt.y - lastPt.y) > 0.5) {
        setCurrentStroke(prev => prev ? { ...prev, points: [...prev.points, pt] } : null);
      }
    } else if (drawTool === 'erase' && dragType === 'erase_drag') {
      const remaining = drawings.filter(s => !strokeIntersectsCircle(s, pt, 3));
      if (remaining.length !== drawings.length) onChange(remaining);
    } else if (drawTool === 'select' && lassoPath) {
      const lastPt = lassoPath[lassoPath.length - 1];
      if (Math.abs(pt.x - lastPt.x) > 0.5 || Math.abs(pt.y - lastPt.y) > 0.5) {
        setLassoPath(prev => prev ? [...prev, pt] : null);
      }
    } else if (drawTool === 'select' && dragType === 'move' && dragStart) {
      const dx = pt.x - dragStart.x;
      const dy = pt.y - dragStart.y;
      setDragStart(pt);
      const newDrawings = drawings.map(s => {
        if (!selectedIds.has(s.id)) return s;
        if (s.type === 'fill' && s.bounds) {
          return { ...s, bounds: { ...s.bounds, x: s.bounds.x + dx, y: s.bounds.y + dy } };
        }
        return { ...s, points: s.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
      });
      onChange(newDrawings);
    } else if (drawTool === 'select' && dragType === 'scale' && dragStart && hasSelection) {
      const cx = selectCenter.x;
      const cy = selectCenter.y;
      
      const d_prev = Math.hypot(dragStart.x - cx, dragStart.y - cy);
      const d_curr = Math.hypot(pt.x - cx, pt.y - cy);
      
      if (d_prev > 0.1) {
        const s_step = d_curr / d_prev;
        setDragStart(pt);
        const newDrawings = drawings.map(s => {
          if (!selectedIds.has(s.id)) return s;
          if (s.type === 'fill' && s.bounds) {
            return {
              ...s,
              bounds: {
                x: cx + (s.bounds.x - cx) * s_step,
                y: cy + (s.bounds.y - cy) * s_step,
                w: s.bounds.w * s_step,
                h: s.bounds.h * s_step
              }
            };
          }
          return {
            ...s,
            points: s.points.map(p => ({
              x: cx + (p.x - cx) * s_step,
              y: cy + (p.y - cy) * s_step
            }))
          };
        });
        onChange(newDrawings);
      }
    }
  };

  const onPointerUp = () => {
    if (currentStroke && currentStroke.points.length > 0) {
      onChange([...drawings, currentStroke]);
    }
    if (lassoPath) {
      const selected = drawings.filter(s => strokeInLasso(s, lassoPath));
      setSelectedIds(new Set(selected.map(s => s.id)));
    }
    setCurrentStroke(null);
    setLassoPath(null);
    setDragType(null);
    setDragStart(null);
  };

  const renderStroke = (s: Stroke, isSelected: boolean) => {
    if (s.type === 'fill' && s.imageUrl && s.bounds) {
      return (
        <g key={s.id + (isSelected ? '-sel' : '')}>
          <image 
            href={s.imageUrl} 
            x={s.bounds.x} width={s.bounds.w} 
            y={s.bounds.y} height={s.bounds.h} 
            preserveAspectRatio="none" 
            opacity={drawTool === 'erase' && isDrawingMode ? 0.7 : 1}
            style={{ pointerEvents: 'none' }}
          />
          {isSelected && (
            <rect 
               x={s.bounds.x} width={s.bounds.w} y={s.bounds.y} height={s.bounds.h} 
               fill="none" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="3 3"
               vectorEffect="non-scaling-stroke"
               style={{ pointerEvents: 'none' }}
            />
          )}
        </g>
      );
    }
    if (!s.points || s.points.length === 0) return null;
    
    let d = '';
    if (s.points.length === 1) {
      d = `M ${s.points[0].x} ${s.points[0].y} L ${s.points[0].x} ${s.points[0].y}`;
    } else {
      d = `M ${s.points[0].x} ${s.points[0].y}`;
      let i = 1;
      for (; i < s.points.length - 1; i++) {
        const p1 = s.points[i];
        const p2 = s.points[i + 1];
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        d += ` Q ${p1.x} ${p1.y} ${midX} ${midY}`;
      }
      if (i < s.points.length) {
        d += ` L ${s.points[i].x} ${s.points[i].y}`;
      }
    }

    // When erasing, show strokes slightly faded so users know what tool they're using
    const opacity = (drawTool === 'erase' && isDrawingMode) ? 0.7 : 1;
    return (
      <g key={s.id + (isSelected ? '-sel' : '')}>
        {isSelected && <path d={d} stroke="#3b82f6" strokeWidth={s.brushRadius + 4} fill={s.fill || "none"} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={0.3} />}
        <path d={d} stroke={s.color} strokeWidth={s.brushRadius} fill={s.fill || "none"} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={opacity} />
      </g>
    );
  };

  let selBounds: {x:number, y:number, w:number, h:number} | null = null;
  if (selectedStrokes.length > 0) {
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    selectedStrokes.forEach(s => {
      if (s.type === 'fill' && s.bounds) {
        minX = Math.min(minX, s.bounds.x);
        minY = Math.min(minY, s.bounds.y);
        maxX = Math.max(maxX, s.bounds.x + s.bounds.w);
        maxY = Math.max(maxY, s.bounds.y + s.bounds.h);
      } else {
        s.points.forEach(p => {
          minX=Math.min(minX,p.x); minY=Math.min(minY,p.y);
          maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y);
        });
      }
    });
    if(minX <= maxX) {
      const padding = 2;
      selBounds = {x: minX - padding, y: minY - padding, w: maxX - minX + padding*2, h: maxY - minY + padding*2};
    }
  }

  let cursorClass = 'cursor-crosshair';
  if (drawTool === 'erase') cursorClass = 'cursor-pointer'; // Can be customized
  else if (drawTool === 'select') cursorClass = 'cursor-default';

  return (
    <svg 
      ref={svgRef}
      className={`absolute inset-0 w-full h-full ${isDrawingMode ? `z-50 ${cursorClass} touch-none pointer-events-auto` : 'z-10 pointer-events-none touch-none'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {drawings.map(s => renderStroke(s, selectedIds.has(s.id)))}
      {currentStroke && renderStroke(currentStroke, false)}
      
      {lassoPath && lassoPath.length > 0 && (
        <path
          d={lassoPath.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'}
          fill="rgba(59, 130, 246, 0.1)"
          stroke="#3b82f6"
          strokeWidth="1"
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {selBounds && drawTool === 'select' && (
        <>
          <rect
            x={selBounds.x} y={selBounds.y} width={selBounds.w} height={selBounds.h}
            fill="transparent"
            stroke="#3b82f6"
            strokeWidth="1.5"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
            onPointerDown={(e) => {
              e.stopPropagation();
              setDragType('move');
              setDragStart(getPt(e));
            }}
            className="cursor-move hover:bg-blue-500/10 transition-colors"
          />
          {/* Scale handle at bottom-right corner of selection bounding box */}
          <g transform={`translate(${selBounds.x + selBounds.w}, ${selBounds.y + selBounds.h})`}>
            <circle
              cx="0"
              cy="0"
              r="6"
              fill="transparent"
              className="cursor-se-resize"
              onPointerDown={(e) => {
                e.stopPropagation();
                (e.target as Element).releasePointerCapture(e.pointerId);
                setDragType('scale');
                setDragStart(getPt(e));
              }}
            />
            <circle
              cx="0"
              cy="0"
              r="2.5"
              fill="#3b82f6"
              stroke="#ffffff"
              strokeWidth="0.5"
              vectorEffect="non-scaling-stroke"
              className="pointer-events-none"
            />
          </g>
        </>
      )}
    </svg>
  );
};

const PanelView: React.FC<{ node: PanelNode; path: number[]; onChange: (t: TreeNode) => void; rootTree: TreeNode; isDrawingMode: boolean; drawTool: 'pen'|'erase'|'select'|'fill'; drawColor: string; drawRadius: number; }> = ({ node, path, onChange, rootTree, isDrawingMode, drawTool, drawColor, drawRadius }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isColorFolded, setIsColorFolded] = useState(true);
  const [isCropping, setIsCropping] = useState(false);

  const replaceNode = (newTree: TreeNode, currentPath: number[], replacement: TreeNode): TreeNode => {
    if (currentPath.length === 0) return replacement;
    if (newTree.type === 'panel') return newTree;
    const isFirst = currentPath[0] === 0;
    const nextPath = currentPath.slice(1);
    return {
      ...newTree,
      c1: isFirst ? replaceNode(newTree.c1, nextPath, replacement) : newTree.c1,
      c2: !isFirst ? replaceNode(newTree.c2, nextPath, replacement) : newTree.c2,
    };
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        onChange(replaceNode(rootTree, path, { ...node, imageUrl: ev.target?.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };
  
  const handleDrawingsChange = (newDrawings: Stroke[]) => {
      onChange(replaceNode(rootTree, path, { ...node, drawings: newDrawings }));
  };

  const clickTimeout = useRef<NodeJS.Timeout | null>(null);

  const handleClick = (e: React.MouseEvent) => {
    if (isDrawingMode) return;
    if (e.detail === 1) {
      clickTimeout.current = setTimeout(() => {
        if (!node.imageUrl) fileInputRef.current?.click();
      }, 250);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (isDrawingMode) return;
    if (clickTimeout.current) clearTimeout(clickTimeout.current);
    e.stopPropagation();
    if (path.length === 0) {
      // Cannot delete root panel if it's the only one
      return;
    }
    const removeNode = (newTree: TreeNode, currentPath: number[]): TreeNode | null => {
      if (currentPath.length === 0) return null;
      if (newTree.type === 'panel') return newTree;

      if (currentPath.length === 1) {
        const isFirst = currentPath[0] === 0;
        return isFirst ? newTree.c2 : newTree.c1;
      }
      const isFirst = currentPath[0] === 0;
      const nextPath = currentPath.slice(1);
      return {
        ...newTree,
        c1: isFirst ? (removeNode(newTree.c1, nextPath) || newTree.c1) : newTree.c1,
        c2: !isFirst ? (removeNode(newTree.c2, nextPath) || newTree.c2) : newTree.c2,
      };
    };
    
    const newTree = removeNode(rootTree, path);
    if (newTree) onChange(newTree);
  };

  const handleImgClick = (e: React.MouseEvent) => {
      if (isDrawingMode) return;
      if (e.detail === 1) {
          setShowAiIcon(true);
      }
  };

  const [showAiIcon, setShowAiIcon] = useState(false);

  const panelInnerRef = useRef<HTMLDivElement>(null);
  const handlePointerDown = () => {
    (window as any).activeComicPanelPath = path;
    (window as any).activeComicPanelRef = panelInnerRef.current;
  };

  return (
    <div className="w-full h-full bg-white relative overflow-hidden flex items-center justify-center p-[2px]" onPointerDown={handlePointerDown}>
      <div 
        ref={panelInnerRef}
        className="w-full h-full border border-zinc-900 bg-white relative cursor-pointer transition-all hover:border-primary/60 dark:hover:border-primary/80 group"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {node.imageUrl ? (
            <div 
              className={cn(
                "w-full h-full relative overflow-hidden",
                node.isHighContrast && "contrast-[1.25] grayscale"
              )}
              style={node.hasOutline ? { border: `2px solid ${node.color || '#000000'}`, boxSizing: 'border-box' } : undefined}
            >
              <img 
                src={node.imageUrl} 
                alt="Panel" 
                className={cn("w-full h-full object-cover select-none pointer-events-auto", node.isHighContrast && "contrast-[1.25] grayscale")} 
                onClick={handleImgClick} 
                onDoubleClick={handleDoubleClick}
              />
            </div>
        ) : !isDrawingMode && (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-400 font-mono text-sm pointer-events-none" data-export-ignore="true">
                Tap to insert image
            </div>
        )}
        {showAiIcon && node.imageUrl && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-[100] animate-in fade-in" data-export-ignore="true" onClick={(e) => { e.stopPropagation(); setShowAiIcon(false); }}>
                <ImageToolbar 
                  color={node.color || '#000000'}
                  isHighContrast={node.isHighContrast}
                  hasOutline={node.hasOutline}
                  onUpdate={(updates) => {
                     onChange(replaceNode(rootTree, path, { ...node, ...updates }));
                     if (updates.url) {
                        onChange(replaceNode(rootTree, path, { ...node, imageUrl: updates.url }));
                     }
                  }}
                  onMoveLayer={() => {}} // Layer up/down doesn't apply to grid panels
                  onCropToggle={() => {}} // Crop not implemented here
                  isCropping={false}
                  onPointerDownMove={(e) => { e.stopPropagation(); }} // Move doesn't apply to grid panels
                  onClickAskAI={() => {
                      window.dispatchEvent(new CustomEvent('quote-to-agent', {
                         detail: { type: 'image', imageUrl: node.imageUrl }
                      }));
                      setShowAiIcon(false);
                  }}
                  onRegenerate={() => {
                     const match = node.imageUrl?.match(/prompt\/([^?]+)/);
                     if (match) {
                       try {
                         const prompt = decodeURIComponent(match[1]);
                         const newSeed = Math.floor(Math.random() * 100000000);
                         const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${newSeed}&model=flux`;
                         onChange(replaceNode(rootTree, path, { ...node, imageUrl: url }));
                       } catch(e) {}
                     }
                     setShowAiIcon(false);
                  }}
                  onDelete={() => {
                      onChange(replaceNode(rootTree, path, { ...node, imageUrl: undefined }));
                      setShowAiIcon(false);
                  }}
                />
            </div>
        )}
        <DrawingCanvas drawings={node.drawings || []} onChange={handleDrawingsChange} isDrawingMode={isDrawingMode} drawTool={drawTool} drawColor={drawColor} drawRadius={drawRadius} />
        <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handleImageUpload} />
      </div>
    </div>
  );
};

