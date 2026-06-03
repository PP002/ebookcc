import React, { useState, useRef, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type Direction = 'row' | 'col';
export type PanelNode = {
  id: string;
  type: 'panel';
  imageUrl?: string;
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

interface ComicCanvasProps {
  tree: TreeNode;
  onChange: (tree: TreeNode) => void;
}

export const ComicCanvas: React.FC<ComicCanvasProps> = ({ tree, onChange }) => {
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
      <SplitView node={tree} path={[]} onChange={onChange} rootTree={tree} />

      {/* Top Edge Plus Button */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 opacity-0 group-hover/canvas:opacity-100 transition-opacity" data-export-ignore="true">
        <Button 
          size="icon" 
          variant="secondary" 
          className="w-6 h-6 rounded-full border-2 border-foreground shadow-md bg-white hover:bg-zinc-100 hover:scale-115 transition-all text-black p-0 flex items-center justify-center cursor-pointer"
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
          className="w-6 h-6 rounded-full border-2 border-foreground shadow-md bg-white hover:bg-zinc-100 hover:scale-115 transition-all text-black p-0 flex items-center justify-center cursor-pointer"
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
          className="w-6 h-6 rounded-full border-2 border-foreground shadow-md bg-white hover:bg-zinc-100 hover:scale-115 transition-all text-black p-0 flex items-center justify-center cursor-pointer"
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
          className="w-6 h-6 rounded-full border-2 border-foreground shadow-md bg-white hover:bg-zinc-100 hover:scale-115 transition-all text-black p-0 flex items-center justify-center cursor-pointer"
          onClick={() => addAtEdge('right')}
          title="Add panel at right edge"
        >
          <Plus className="w-3.5 h-3.5 stroke-[3]" />
        </Button>
      </div>
    </div>
  );
};

const SplitView: React.FC<{ node: TreeNode; path: number[]; onChange: (t: TreeNode) => void; rootTree: TreeNode }> = ({ node, path, onChange, rootTree }) => {
  if (node.type === 'panel') {
    return <PanelView node={node} path={path} onChange={onChange} rootTree={rootTree} />;
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
        <SplitView node={c1} path={[...path, 0]} onChange={onChange} rootTree={rootTree} />
      </div>
      <Gutter dir={dir} percent={percent} onDrag={setPercent} onPlus={handlePlus} />
      <div style={{ [dir === 'row' ? 'width' : 'height']: `${100 - percent}%` }} className="relative">
        <SplitView node={c2} path={[...path, 1]} onChange={onChange} rootTree={rootTree} />
      </div>
    </div>
  );
};

const Gutter: React.FC<{ dir: Direction; percent: number; onDrag: (p: number) => void; onPlus: () => void }> = ({ dir, percent, onDrag, onPlus }) => {
  const isRow = dir === 'row';
  
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    const parent = target.parentElement!;
    const rect = parent.getBoundingClientRect();
    
    const onPointerMove = (ev: PointerEvent) => {
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

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  return (
    <div 
      className={`absolute z-10 flex items-center justify-center bg-transparent hover:bg-primary transition-colors cursor-resize group ${
        isRow ? 'w-2 h-full -ml-1 top-0 cursor-col-resize' : 'h-2 w-full -mt-1 left-0 cursor-row-resize'
      }`}
      style={{
        [isRow ? 'left' : 'top']: `${percent}%`
      }}
      onPointerDown={handlePointerDown}
    >
      <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute pointer-events-none text-white z-20" data-export-ignore="true">
        <Button size="icon" variant="default" className="w-6 h-6 rounded-full pointer-events-auto shadow-md" onClick={(e) => { e.stopPropagation(); onPlus(); }}>
            <Plus className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};

const PanelView: React.FC<{ node: PanelNode; path: number[]; onChange: (t: TreeNode) => void; rootTree: TreeNode }> = ({ node, path, onChange, rootTree }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const clickTimeout = useRef<NodeJS.Timeout | null>(null);

  const handleClick = (e: React.MouseEvent) => {
    if (e.detail === 1) {
      clickTimeout.current = setTimeout(() => {
        if (!node.imageUrl) fileInputRef.current?.click();
      }, 250);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
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
      if (e.detail === 1) {
          clickTimeout.current = setTimeout(() => {
              fileInputRef.current?.click();
          }, 250);
      }
  };

  return (
    <div className="w-full h-full bg-white relative overflow-hidden flex items-center justify-center p-[2px]">
      <div 
        className="w-full h-full border-[3px] border-zinc-900 bg-white relative cursor-pointer transition-all hover:border-primary/60 dark:hover:border-primary/80"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {node.imageUrl ? (
            <img 
              src={node.imageUrl} 
              alt="Panel" 
              className="w-full h-full object-cover select-none pointer-events-auto" 
              onClick={handleImgClick} 
              onDoubleClick={handleDoubleClick}
            />
        ) : (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-400 font-mono text-sm pointer-events-none" data-export-ignore="true">
                Tap to insert image
            </div>
        )}
        <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handleImageUpload} />
      </div>
    </div>
  );
};

