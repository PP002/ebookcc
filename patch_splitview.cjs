const fs = require('fs');
let code = fs.readFileSync('src/components/ComicCanvas.tsx', 'utf-8');

const resizerCode = `
const Resizer: React.FC<{
  node: TreeNode;
  onChange: (t: TreeNode) => void;
  rootTree: TreeNode;
  isDrawingMode: boolean;
}> = ({ node, onChange, rootTree, isDrawingMode }) => {
  if (node.type !== 'split') return null;
  const isRow = node.dir === 'row';
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isDrawingMode) return;

    const container = containerRef.current?.parentElement;
    if (!container) return;

    const startRect = container.getBoundingClientRect();
    const initialBoxesMap = new Map(getLeafBoxes(rootTree).map(b => [b.id, b]));

    const onPointerMove = (ev: PointerEvent) => {
      let currentPos: number;
      if (isRow) {
        currentPos = ((ev.clientX - startRect.left) / startRect.width) * 100;
      } else {
        currentPos = ((ev.clientY - startRect.top) / startRect.height) * 100;
      }

      const newPercent = Math.max(10, Math.min(90, currentPos));
      const newTree = replaceNodeById(rootTree, node.id, (n) => ({ ...n, percent: newPercent }));
      
      const newBoxes = getLeafBoxes(newTree);
      let finalTree = newTree;
      for (const nb of newBoxes) {
        const ob = initialBoxesMap.get(nb.id);
        if (ob && nb.node.type === 'panel' && nb.node.drawings && nb.node.drawings.length > 0) {
          if (
            Math.abs(nb.x - ob.x) > 0.0001 ||
            Math.abs(nb.y - ob.y) > 0.0001 ||
            Math.abs(nb.w - ob.w) > 0.0001 ||
            Math.abs(nb.h - ob.h) > 0.0001
          ) {
            const transformed = transformDrawingsForBounds(nb.node.drawings, ob, nb);
            finalTree = replaceNodeById(finalTree, nb.id, (n) => ({ ...n, drawings: transformed }));
          }
        }
      }
      onChange(finalTree);
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  if (isDrawingMode) return null;

  return (
    <div
      ref={containerRef}
      className={\`absolute z-20 flex items-center justify-center pointer-events-auto touch-none select-none \${isRow ? 'w-6 -ml-3 cursor-col-resize flex-col' : 'h-6 -mt-3 cursor-row-resize flex-row'}\`}
      style={{
        [isRow ? 'left' : 'top']: \`\${node.percent}%\`,
        [isRow ? 'top' : 'left']: 0,
        [isRow ? 'bottom' : 'right']: 0,
      }}
      onPointerDown={handlePointerDown}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
    >
      <div className={\`\${isRow ? 'w-1 h-12' : 'h-1 w-12'} rounded-full transition-colors duration-200 \${isHovered ? 'bg-primary' : 'bg-zinc-300'}\`} />
    </div>
  );
};
`;

const splitViewStart = `const SplitView: React.FC<{`;
code = code.replace(splitViewStart, resizerCode + "\n" + splitViewStart);

const targetBlock = `
  const { dir, percent, c1, c2 } = node;

  return (
    <div className={\`split-container relative flex w-full h-full min-w-0 min-h-0 \${dir === 'row' ? 'flex-row' : 'flex-col'}\`}>
      <div style={{ [dir === 'row' ? 'width' : 'height']: \`\${percent}%\` }} className="relative min-w-0 min-h-0 overflow-hidden">
        <SplitView node={c1} path={[...path, 0]} onChange={onChange} rootTree={rootTree} isDrawingMode={isDrawingMode} drawTool={drawTool} drawColor={drawColor} drawRadius={drawRadius} touchOff={touchOff} setTouchOff={setTouchOff} onExpandPanel={onExpandPanel} containerAspect={containerAspect} leafBoxes={boxes} layers={layers} activeLayerId={activeLayerId} selectedLayerIds={selectedLayerIds} layerGroups={layerGroups} backgroundColor={backgroundColor} />
      </div>
      <div style={{ [dir === 'row' ? 'width' : 'height']: \`\${100 - percent}%\` }} className="relative min-w-0 min-h-0 overflow-hidden">
        <SplitView node={c2} path={[...path, 1]} onChange={onChange} rootTree={rootTree} isDrawingMode={isDrawingMode} drawTool={drawTool} drawColor={drawColor} drawRadius={drawRadius} touchOff={touchOff} setTouchOff={setTouchOff} onExpandPanel={onExpandPanel} containerAspect={containerAspect} leafBoxes={boxes} layers={layers} activeLayerId={activeLayerId} selectedLayerIds={selectedLayerIds} layerGroups={layerGroups} backgroundColor={backgroundColor} />
      </div>
    </div>
  );
`;

const newTargetBlock = `
  const { dir, percent, c1, c2 } = node;

  return (
    <div className={\`split-container relative flex w-full h-full min-w-0 min-h-0 \${dir === 'row' ? 'flex-row' : 'flex-col'}\`}>
      <div style={{ [dir === 'row' ? 'width' : 'height']: \`\${percent}%\` }} className="relative min-w-0 min-h-0 overflow-hidden">
        <SplitView node={c1} path={[...path, 0]} onChange={onChange} rootTree={rootTree} isDrawingMode={isDrawingMode} drawTool={drawTool} drawColor={drawColor} drawRadius={drawRadius} touchOff={touchOff} setTouchOff={setTouchOff} onExpandPanel={onExpandPanel} containerAspect={containerAspect} leafBoxes={boxes} layers={layers} activeLayerId={activeLayerId} selectedLayerIds={selectedLayerIds} layerGroups={layerGroups} backgroundColor={backgroundColor} />
      </div>
      
      <Resizer node={node} onChange={onChange} rootTree={rootTree} isDrawingMode={isDrawingMode} />

      <div style={{ [dir === 'row' ? 'width' : 'height']: \`\${100 - percent}%\` }} className="relative min-w-0 min-h-0 overflow-hidden">
        <SplitView node={c2} path={[...path, 1]} onChange={onChange} rootTree={rootTree} isDrawingMode={isDrawingMode} drawTool={drawTool} drawColor={drawColor} drawRadius={drawRadius} touchOff={touchOff} setTouchOff={setTouchOff} onExpandPanel={onExpandPanel} containerAspect={containerAspect} leafBoxes={boxes} layers={layers} activeLayerId={activeLayerId} selectedLayerIds={selectedLayerIds} layerGroups={layerGroups} backgroundColor={backgroundColor} />
      </div>
    </div>
  );
`;

if (code.includes(targetBlock.trim())) {
  code = code.replace(targetBlock.trim(), newTargetBlock.trim());
  fs.writeFileSync('src/components/ComicCanvas.tsx', code);
  console.log('Added Resizer');
} else {
  console.log('Target block not found');
}
