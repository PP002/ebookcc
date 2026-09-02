import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { Plus, Bot, Image as ImageIcon, Trash2, Contrast, Square, ArrowUp, ArrowDown, Crop, Move, Maximize, Minimize, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { ImageToolbar } from './ImageToolbar';
import { getStroke } from 'perfect-freehand';
import { useLanguage } from '@/context/LanguageContext';

export type Point = { 
  x: number; 
  y: number; 
  pressure?: number;
  tiltX?: number;
  tiltY?: number;
  pointerType?: string;
};

const hitMapCache = new Map<string, { data: Uint8ClampedArray, width: number, height: number }>();

export const HOLLOW_CROSS_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='17' height='17' viewBox='0 0 17 17'%3E%3Cpath d='M8.5 1v5M8.5 11v5M1 8.5h5M11 8.5h5' stroke='white' stroke-width='3' stroke-linecap='square'/%3E%3Cpath d='M8.5 1v5M8.5 11v5M1 8.5h5M11 8.5h5' stroke='black' stroke-width='1.2' stroke-linecap='square'/%3E%3C/svg%3E") 8 8, crosshair`;

export function getSvgPathFromPoints(points: Point[], brushRadius: number, aspectRatio: number = 1) {
  if (points.length === 0) return '';
  
  const hasRealPressure = points.some(p => p.pressure !== undefined && p.pressure !== 0 && p.pressure !== 0.5 && p.pressure !== 1);
  const isPen = points.some(p => p.pointerType === 'pen') || hasRealPressure;
  
  // Scale factor to convert 0-100 percentage coordinates to a "pixel-like" space
  // so perfect-freehand's velocity-based pressure simulation works consistently.
  const SCALE = 10;
  const aspect = aspectRatio > 0 ? aspectRatio : 1;

  // Single-point tap: render a clean circular dot matching the brush radius without ballooning
  if (points.length === 1) {
    const p = points[0];
    let pr = p.pressure !== undefined && p.pressure > 0 ? p.pressure : 0.5;
    if (isPen && (p.pressure === 0 || p.pressure === 0.5)) pr = 0.35;
    const r = Math.max(0.2, (brushRadius * (0.35 + pr * 0.65)) / 2);
    const rx = r / aspect;
    const ry = r;
    return `M ${(p.x - rx).toFixed(3)} ${p.y.toFixed(3)} A ${rx.toFixed(3)} ${ry.toFixed(3)} 0 1 0 ${(p.x + rx).toFixed(3)} ${p.y.toFixed(3)} A ${rx.toFixed(3)} ${ry.toFixed(3)} 0 1 0 ${(p.x - rx).toFixed(3)} ${p.y.toFixed(3)} Z`;
  }
  
  // Smooth pressures along the stroke to eliminate starting spikes and hardware jitter
  const smoothedPressures: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    let pr = p.pressure !== undefined && p.pressure > 0 ? p.pressure : 0.5;
    if (isPen) {
      if (p.tiltX !== undefined && p.tiltY !== undefined) {
        const maxTilt = Math.max(Math.abs(p.tiltX), Math.abs(p.tiltY));
        if (maxTilt > 0) {
          pr = Math.min(1.0, pr * (1 + (maxTilt / 90) * 0.4));
        }
      }
      if (i === 0) {
        // Fix initial big dot: if first point has high default pressure, match or clamp to next point
        const nextPr = points[1]?.pressure && points[1].pressure > 0 ? points[1].pressure : pr;
        pr = Math.min(pr, nextPr);
      } else if (i === 1 && points.length > 2) {
        pr = (smoothedPressures[0] + pr + (points[2]?.pressure ?? pr)) / 3;
      } else {
        const prev = smoothedPressures[i - 1];
        pr = prev * 0.35 + pr * 0.65;
      }
    }
    smoothedPressures.push(pr);
  }

  const strokeInput: [number, number, number | undefined][] = points.map((p, i) => [
    p.x * aspect * SCALE,
    p.y * SCALE,
    isPen ? smoothedPressures[i] : undefined,
  ]);

  const strokePoints = getStroke(
    strokeInput,
    {
      size: brushRadius * SCALE,
      thinning: 0.5,
      smoothing: 0.65,
      streamline: 0.5,
      simulatePressure: !isPen,
      start: {
        taper: isPen ? Math.min(brushRadius * SCALE * 0.4, 8) : Math.min(brushRadius * SCALE * 0.8, 14),
        easing: (t) => t * (2 - t),
        cap: true,
      },
      end: {
        taper: isPen ? Math.min(brushRadius * SCALE * 0.3, 6) : Math.min(brushRadius * SCALE * 0.6, 10),
        easing: (t) => t * (2 - t),
        cap: true,
      }
    }
  );
  
  if (strokePoints.length === 0) return '';
  
  let d = `M ${(strokePoints[0][0] / (aspect * SCALE)).toFixed(3)} ${(strokePoints[0][1] / SCALE).toFixed(3)}`;
  for (let i = 0; i < strokePoints.length - 1; i++) {
    const p0 = strokePoints[i];
    const p1 = strokePoints[i + 1];
    const midX = (p0[0] + p1[0]) / 2;
    const midY = (p0[1] + p1[1]) / 2;
    d += ` Q ${(p0[0] / (aspect * SCALE)).toFixed(3)} ${(p0[1] / SCALE).toFixed(3)} ${(midX / (aspect * SCALE)).toFixed(3)} ${(midY / SCALE).toFixed(3)}`;
  }
  d += ' Z';
  return d;
}

export type Stroke = { 
  id: string, 
  type?: 'stroke' | 'fill',
  points: Point[], 
  color: string, 
  brushRadius: number, 
  fill?: string,
  imageUrl?: string,
  bounds?: {x: number, y: number, w: number, h: number},
  isFullArea?: boolean;
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

export function getNodeByPath(tree: TreeNode, path: number[]): PanelNode | null {
  if (path.length === 0) {
    return tree.type === 'panel' ? tree : null;
  }
  if (tree.type === 'panel') return null;
  const isFirst = path[0] === 0;
  const nextPath = path.slice(1);
  return getNodeByPath(isFirst ? tree.c1 : tree.c2, nextPath);
}

export function replaceNodeByPath(rootTree: TreeNode, currentPath: number[], replacement: TreeNode): TreeNode {
  if (currentPath.length === 0) return replacement;
  if (rootTree.type === 'panel') return rootTree;
  const isFirst = currentPath[0] === 0;
  const nextPath = currentPath.slice(1);
  return {
    ...rootTree,
    c1: isFirst ? replaceNodeByPath(rootTree.c1, nextPath, replacement) : rootTree.c1,
    c2: !isFirst ? replaceNodeByPath(rootTree.c2, nextPath, replacement) : rootTree.c2,
  };
}

export function cloneTreeWithEmptyPanels(node: TreeNode): TreeNode {
  if (node.type === 'panel') {
    return { type: 'panel', id: genId() };
  }
  return {
    type: 'split',
    id: genId(),
    dir: node.dir,
    percent: node.percent,
    c1: cloneTreeWithEmptyPanels(node.c1),
    c2: cloneTreeWithEmptyPanels(node.c2),
  };
}

export interface PanelBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  node: TreeNode;
}

export function getLeafBoxes(node: TreeNode, x = 0, y = 0, w = 100, h = 100): PanelBox[] {
  if (node.type === 'panel') {
    return [{ id: node.id, x, y, w, h, node }];
  }
  const isRow = node.dir === 'row';
  const p = node.percent / 100;
  if (isRow) {
    const w1 = w * p;
    const w2 = w * (1 - p);
    return [
      ...getLeafBoxes(node.c1, x, y, w1, h),
      ...getLeafBoxes(node.c2, x + w1, y, w2, h),
    ];
  } else {
    const h1 = h * p;
    const h2 = h * (1 - p);
    return [
      ...getLeafBoxes(node.c1, x, y, w, h1),
      ...getLeafBoxes(node.c2, x, y + h1, w, h2),
    ];
  }
}

export interface BorderingSegment {
  id: string;
  startPercent: number;
  endPercent: number;
  posPercent: number;
}

export function getBorderingSegments(node: TreeNode, dir: Direction): BorderingSegment[] {
  const leafBoxes = getLeafBoxes(node);
  if (leafBoxes.length === 0) return [];
  
  const isRow = dir === 'row';
  if (isRow) {
    const maxX = Math.max(...leafBoxes.map(b => b.x + b.w));
    const bordering = leafBoxes.filter(b => (b.x + b.w) >= maxX - 0.5);
    bordering.sort((a, b) => a.y - b.y);
    return bordering.map(b => ({
      id: b.id,
      startPercent: Math.max(0, b.y),
      endPercent: Math.min(100, b.y + b.h),
      posPercent: Math.max(5, Math.min(95, b.y + b.h / 2)),
    }));
  } else {
    const maxY = Math.max(...leafBoxes.map(b => b.y + b.h));
    const bordering = leafBoxes.filter(b => (b.y + b.h) >= maxY - 0.5);
    bordering.sort((a, b) => a.x - b.x);
    return bordering.map(b => ({
      id: b.id,
      startPercent: Math.max(0, b.x),
      endPercent: Math.min(100, b.x + b.w),
      posPercent: Math.max(5, Math.min(95, b.x + b.w / 2)),
    }));
  }
}

export interface GutterButtonInfo {
  targetPanelId: string;
  posAlongEdge: number; // percentage in canvas coordinates (e.g. Y center for vertical gutter, X center for horizontal gutter)
  startPercent: number;
  endPercent: number;
}

export interface SharedEdge {
  id: string;
  dir: Direction; // 'row' = vertical dividing line (separating left and right panels), 'col' = horizontal dividing line (separating top and bottom panels)
  posPercent: number; // coordinate of the dividing line (X for 'row', Y for 'col')
  startPercent: number; // start along the line (Y for 'row', X for 'col') - follows the longest panel!
  endPercent: number; // end along the line (Y for 'row', X for 'col') - follows the longest panel!
  leftPanelIds: string[];
  rightPanelIds: string[];
  topPanelIds: string[];
  bottomPanelIds: string[];
  minPos: number;
  maxPos: number;
  buttons: GutterButtonInfo[]; // Buttons for the RIGHT panels (for 'row') or UNDER panels (for 'col')
}

export function getSharedEdges(leafBoxes: PanelBox[]): SharedEdge[] {
  const edges: SharedEdge[] = [];
  const tol = 0.5; // percentage alignment tolerance

  // 1. VERTICAL DIVIDERS (dir: 'row') - divides left panels from right panels
  const rawXCoords: number[] = [];
  for (const b of leafBoxes) {
    const rightX = b.x + b.w;
    if (rightX > 0.5 && rightX < 99.5) {
      rawXCoords.push(rightX);
    }
  }
  rawXCoords.sort((a, b) => a - b);
  const xCoords: number[] = [];
  for (const rx of rawXCoords) {
    if (xCoords.length === 0 || Math.abs(xCoords[xCoords.length - 1] - rx) >= tol * 1.5) {
      xCoords.push(rx);
    }
  }

  for (const x of xCoords) {
    const leftPanels = leafBoxes.filter(b => Math.abs((b.x + b.w) - x) < tol);
    const rightPanels = leafBoxes.filter(b => Math.abs(b.x - x) < tol);
    if (leftPanels.length === 0 || rightPanels.length === 0) continue;

    const sortedLeft = [...leftPanels].sort((a, b) => a.y - b.y);
    const sortedRight = [...rightPanels].sort((a, b) => a.y - b.y);
    const allSeamBoxes = [...sortedLeft, ...sortedRight].sort((a, b) => a.y - b.y);

    interface YInterval {
      startY: number;
      endY: number;
      left: PanelBox[];
      right: PanelBox[];
    }

    const intervals: YInterval[] = [];
    for (const b of allSeamBoxes) {
      const isLeft = Math.abs((b.x + b.w) - x) < tol;
      const bStartY = b.y;
      const bEndY = b.y + b.h;

      let merged = false;
      for (const inv of intervals) {
        if (bStartY <= inv.endY + tol && bEndY >= inv.startY - tol) {
          inv.startY = Math.min(inv.startY, bStartY);
          inv.endY = Math.max(inv.endY, bEndY);
          if (isLeft) {
            if (!inv.left.some(p => p.id === b.id)) inv.left.push(b);
          } else {
            if (!inv.right.some(p => p.id === b.id)) inv.right.push(b);
          }
          merged = true;
          break;
        }
      }

      if (!merged) {
        intervals.push({
          startY: bStartY,
          endY: bEndY,
          left: isLeft ? [b] : [],
          right: isLeft ? [] : [b],
        });
      }
    }

    // Merge any intervals that touch or overlap
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < intervals.length; i++) {
        for (let j = i + 1; j < intervals.length; j++) {
          const a = intervals[i];
          const b = intervals[j];
          if (b.startY <= a.endY + tol && b.endY >= a.startY - tol) {
            a.startY = Math.min(a.startY, b.startY);
            a.endY = Math.max(a.endY, b.endY);
            for (const p of b.left) {
              if (!a.left.some(xp => xp.id === p.id)) a.left.push(p);
            }
            for (const p of b.right) {
              if (!a.right.some(xp => xp.id === p.id)) a.right.push(p);
            }
            intervals.splice(j, 1);
            changed = true;
            break;
          }
        }
        if (changed) break;
      }
    }

    // For each connected interval, find common (+) cross cut points that exist on BOTH sides
    for (const inv of intervals) {
      if (inv.left.length === 0 || inv.right.length === 0) continue;

      const leftCuts = new Set<number>();
      for (const lp of inv.left) {
        if (lp.y > inv.startY + tol && lp.y < inv.endY - tol) leftCuts.add(Math.round(lp.y * 100) / 100);
        if (lp.y + lp.h > inv.startY + tol && lp.y + lp.h < inv.endY - tol) leftCuts.add(Math.round((lp.y + lp.h) * 100) / 100);
      }

      const rightCuts = new Set<number>();
      for (const rp of inv.right) {
        if (rp.y > inv.startY + tol && rp.y < inv.endY - tol) rightCuts.add(Math.round(rp.y * 100) / 100);
        if (rp.y + rp.h > inv.startY + tol && rp.y + rp.h < inv.endY - tol) rightCuts.add(Math.round((rp.y + rp.h) * 100) / 100);
      }

      const commonCuts: number[] = [];
      for (const lc of leftCuts) {
        for (const rc of rightCuts) {
          if (Math.abs(lc - rc) < tol) {
            if (!commonCuts.some(c => Math.abs(c - lc) < tol)) {
              commonCuts.push((lc + rc) / 2);
            }
          }
        }
      }
      commonCuts.sort((a, b) => a - b);

      const partitionY = [inv.startY, ...commonCuts, inv.endY];

      for (let i = 0; i < partitionY.length - 1; i++) {
        const segStart = partitionY[i];
        const segEnd = partitionY[i + 1];
        if (segEnd - segStart <= tol) continue;

        const segLeft = inv.left.filter(lp => {
          const overlap = Math.min(lp.y + lp.h, segEnd) - Math.max(lp.y, segStart);
          return overlap > tol;
        });

        const segRight = inv.right.filter(rp => {
          const overlap = Math.min(rp.y + rp.h, segEnd) - Math.max(rp.y, segStart);
          return overlap > tol;
        });

        if (segLeft.length === 0 || segRight.length === 0) continue;

        const minPos = Math.max(...segLeft.map(l => l.x));
        const maxPos = Math.min(...segRight.map(r => r.x + r.w));

        const buttons: GutterButtonInfo[] = [];
        const seenBtnTargets = new Set<string>();
        for (const rp of segRight) {
          if (!seenBtnTargets.has(rp.id)) {
            seenBtnTargets.add(rp.id);
            buttons.push({
              targetPanelId: rp.id,
              posAlongEdge: rp.y + rp.h / 2,
              startPercent: rp.y,
              endPercent: rp.y + rp.h,
            });
          }
        }

        const leftKey = segLeft.map(l => l.id).sort().join('_');
        const rightKey = segRight.map(r => r.id).sort().join('_');
        const roundedX = Math.round(x * 10) / 10;
        const roundedStart = Math.round(segStart * 10) / 10;
        const roundedEnd = Math.round(segEnd * 10) / 10;

        edges.push({
          id: `v_${roundedX}_${leftKey}_${rightKey}_${roundedStart}_${roundedEnd}`,
          dir: 'row',
          posPercent: x,
          startPercent: segStart,
          endPercent: segEnd,
          leftPanelIds: segLeft.map(l => l.id),
          rightPanelIds: segRight.map(r => r.id),
          topPanelIds: [],
          bottomPanelIds: [],
          minPos,
          maxPos,
          buttons,
        });
      }
    }
  }

  // 2. HORIZONTAL DIVIDERS (dir: 'col') - divides top panels from bottom panels
  const rawYCoords: number[] = [];
  for (const b of leafBoxes) {
    const bottomY = b.y + b.h;
    if (bottomY > 0.5 && bottomY < 99.5) {
      rawYCoords.push(bottomY);
    }
  }
  rawYCoords.sort((a, b) => a - b);
  const yCoords: number[] = [];
  for (const ry of rawYCoords) {
    if (yCoords.length === 0 || Math.abs(yCoords[yCoords.length - 1] - ry) >= tol * 1.5) {
      yCoords.push(ry);
    }
  }

  for (const y of yCoords) {
    const topPanels = leafBoxes.filter(b => Math.abs((b.y + b.h) - y) < tol);
    const bottomPanels = leafBoxes.filter(b => Math.abs(b.y - y) < tol);
    if (topPanels.length === 0 || bottomPanels.length === 0) continue;

    const sortedTop = [...topPanels].sort((a, b) => a.x - b.x);
    const sortedBottom = [...bottomPanels].sort((a, b) => a.x - b.x);
    const allSeamBoxes = [...sortedTop, ...sortedBottom].sort((a, b) => a.x - b.x);

    interface XInterval {
      startX: number;
      endX: number;
      top: PanelBox[];
      bottom: PanelBox[];
    }

    const intervals: XInterval[] = [];
    for (const b of allSeamBoxes) {
      const isTop = Math.abs((b.y + b.h) - y) < tol;
      const bStartX = b.x;
      const bEndX = b.x + b.w;

      let merged = false;
      for (const inv of intervals) {
        if (bStartX <= inv.endX + tol && bEndX >= inv.startX - tol) {
          inv.startX = Math.min(inv.startX, bStartX);
          inv.endX = Math.max(inv.endX, bEndX);
          if (isTop) {
            if (!inv.top.some(p => p.id === b.id)) inv.top.push(b);
          } else {
            if (!inv.bottom.some(p => p.id === b.id)) inv.bottom.push(b);
          }
          merged = true;
          break;
        }
      }

      if (!merged) {
        intervals.push({
          startX: bStartX,
          endX: bEndX,
          top: isTop ? [b] : [],
          bottom: isTop ? [] : [b],
        });
      }
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < intervals.length; i++) {
        for (let j = i + 1; j < intervals.length; j++) {
          const a = intervals[i];
          const b = intervals[j];
          if (b.startX <= a.endX + tol && b.endX >= a.startX - tol) {
            a.startX = Math.min(a.startX, b.startX);
            a.endX = Math.max(a.endX, b.endX);
            for (const p of b.top) {
              if (!a.top.some(xp => xp.id === p.id)) a.top.push(p);
            }
            for (const p of b.bottom) {
              if (!a.bottom.some(xp => xp.id === p.id)) a.bottom.push(p);
            }
            intervals.splice(j, 1);
            changed = true;
            break;
          }
        }
        if (changed) break;
      }
    }

    for (const inv of intervals) {
      if (inv.top.length === 0 || inv.bottom.length === 0) continue;

      const topCuts = new Set<number>();
      for (const tp of inv.top) {
        if (tp.x > inv.startX + tol && tp.x < inv.endX - tol) topCuts.add(Math.round(tp.x * 100) / 100);
        if (tp.x + tp.w > inv.startX + tol && tp.x + tp.w < inv.endX - tol) topCuts.add(Math.round((tp.x + tp.w) * 100) / 100);
      }

      const bottomCuts = new Set<number>();
      for (const bp of inv.bottom) {
        if (bp.x > inv.startX + tol && bp.x < inv.endX - tol) bottomCuts.add(Math.round(bp.x * 100) / 100);
        if (bp.x + bp.w > inv.startX + tol && bp.x + bp.w < inv.endX - tol) bottomCuts.add(Math.round((bp.x + bp.w) * 100) / 100);
      }

      const commonCuts: number[] = [];
      for (const tc of topCuts) {
        for (const bc of bottomCuts) {
          if (Math.abs(tc - bc) < tol) {
            if (!commonCuts.some(c => Math.abs(c - tc) < tol)) {
              commonCuts.push((tc + bc) / 2);
            }
          }
        }
      }
      commonCuts.sort((a, b) => a - b);

      const partitionX = [inv.startX, ...commonCuts, inv.endX];

      for (let i = 0; i < partitionX.length - 1; i++) {
        const segStart = partitionX[i];
        const segEnd = partitionX[i + 1];
        if (segEnd - segStart <= tol) continue;

        const segTop = inv.top.filter(tp => {
          const overlap = Math.min(tp.x + tp.w, segEnd) - Math.max(tp.x, segStart);
          return overlap > tol;
        });

        const segBottom = inv.bottom.filter(bp => {
          const overlap = Math.min(bp.x + bp.w, segEnd) - Math.max(bp.x, segStart);
          return overlap > tol;
        });

        if (segTop.length === 0 || segBottom.length === 0) continue;

        const minPos = Math.max(...segTop.map(t => t.y));
        const maxPos = Math.min(...segBottom.map(b => b.y + b.h));

        const buttons: GutterButtonInfo[] = [];
        const seenBtnTargets = new Set<string>();
        for (const bp of segBottom) {
          if (!seenBtnTargets.has(bp.id)) {
            seenBtnTargets.add(bp.id);
            buttons.push({
              targetPanelId: bp.id,
              posAlongEdge: bp.x + bp.w / 2,
              startPercent: bp.x,
              endPercent: bp.x + bp.w,
            });
          }
        }

        const topKey = segTop.map(t => t.id).sort().join('_');
        const bottomKey = segBottom.map(b => b.id).sort().join('_');
        const roundedY = Math.round(y * 10) / 10;
        const roundedStart = Math.round(segStart * 10) / 10;
        const roundedEnd = Math.round(segEnd * 10) / 10;

        edges.push({
          id: `h_${roundedY}_${topKey}_${bottomKey}_${roundedStart}_${roundedEnd}`,
          dir: 'col',
          posPercent: y,
          startPercent: segStart,
          endPercent: segEnd,
          leftPanelIds: [],
          rightPanelIds: [],
          topPanelIds: segTop.map(t => t.id),
          bottomPanelIds: segBottom.map(b => b.id),
          minPos,
          maxPos,
          buttons,
        });
      }
    }
  }

  // Deduplicate edges and enforce strictly unique IDs
  const uniqueEdges: SharedEdge[] = [];
  const seenEdgeIds = new Set<string>();

  for (const edge of edges) {
    const isDuplicateGeom = uniqueEdges.some(
      e => e.dir === edge.dir &&
           Math.abs(e.posPercent - edge.posPercent) < tol &&
           Math.abs(e.startPercent - edge.startPercent) < tol &&
           Math.abs(e.endPercent - edge.endPercent) < tol
    );
    if (isDuplicateGeom) {
      continue;
    }

    let finalId = edge.id;
    let dupCounter = 1;
    while (seenEdgeIds.has(finalId)) {
      finalId = `${edge.id}_${dupCounter++}`;
    }
    seenEdgeIds.add(finalId);

    uniqueEdges.push({
      ...edge,
      id: finalId,
    });
  }

  return uniqueEdges;
}

export interface SplitNodeInfo {
  id: string;
  dir: Direction;
  bounds: { x: number; y: number; w: number; h: number };
  cutPos: number; // absolute X for 'row', absolute Y for 'col'
  startPos: number; // absolute Y for 'row', absolute X for 'col'
  endPos: number; // absolute Y+H for 'row', absolute X+W for 'col'
  c1LeafIds: string[];
  c2LeafIds: string[];
}

export function getSplitNodesInfo(node: TreeNode, x = 0, y = 0, w = 100, h = 100): SplitNodeInfo[] {
  if (node.type === 'panel') return [];

  const isRow = node.dir === 'row';
  const p = node.percent / 100;
  const cutPos = isRow ? x + w * p : y + h * p;
  const startPos = isRow ? y : x;
  const endPos = isRow ? y + h : x + w;

  const w1 = isRow ? w * p : w;
  const h1 = isRow ? h : h * p;
  const x2 = isRow ? x + w1 : x;
  const y2 = isRow ? y : y + h1;
  const w2 = isRow ? w * (1 - p) : w;
  const h2 = isRow ? h : h * (1 - p);

  const c1Leaves = getLeafBoxes(node.c1).map(b => b.id);
  const c2Leaves = getLeafBoxes(node.c2).map(b => b.id);

  const current: SplitNodeInfo = {
    id: node.id,
    dir: node.dir,
    bounds: { x, y, w, h },
    cutPos,
    startPos,
    endPos,
    c1LeafIds: c1Leaves,
    c2LeafIds: c2Leaves,
  };

  return [
    current,
    ...getSplitNodesInfo(node.c1, x, y, w1, h1),
    ...getSplitNodesInfo(node.c2, x2, y2, w2, h2),
  ];
}

export function updateTreePercents(
  node: TreeNode,
  updates: Map<string, number>
): TreeNode {
  if (node.type === 'panel') return node;
  const newPercent = updates.has(node.id) ? updates.get(node.id)! : node.percent;
  return {
    ...node,
    percent: newPercent,
    c1: updateTreePercents(node.c1, updates),
    c2: updateTreePercents(node.c2, updates),
  };
}

function getClusteredCutValues(values: number[], min: number, max: number, eps: number): number[] {
  const filtered = values
    .filter(v => v > min + eps && v < max - eps)
    .sort((a, b) => a - b);
  const clustered: number[] = [];
  for (const v of filtered) {
    if (clustered.length === 0 || Math.abs(clustered[clustered.length - 1] - v) > eps * 2) {
      clustered.push(v);
    }
  }
  return clustered;
}

export function boxesToTree(
  boxes: PanelBox[],
  bounds = { x: 0, y: 0, w: 100, h: 100 }
): TreeNode {
  if (boxes.length === 0) {
    return { type: 'panel', id: genId() };
  }
  if (boxes.length === 1) {
    return boxes[0].node;
  }

  const eps = 0.2;

  // Extract all candidate vertical cut positions (X coordinates)
  const xValues: number[] = [];
  for (const b of boxes) {
    xValues.push(b.x);
    xValues.push(b.x + b.w);
  }
  const xCandidates = getClusteredCutValues(xValues, bounds.x, bounds.x + bounds.w, eps);

  const validXCuts: { x: number; left: PanelBox[]; right: PanelBox[]; score: number }[] = [];
  for (const x of xCandidates) {
    const left: PanelBox[] = [];
    const right: PanelBox[] = [];
    let isValid = true;

    for (const b of boxes) {
      if (b.x + b.w <= x + eps) {
        left.push(b);
      } else if (b.x >= x - eps) {
        right.push(b);
      } else {
        isValid = false;
        break;
      }
    }

    if (isValid && left.length > 0 && right.length > 0) {
      const distFromCenter = Math.abs(x - (bounds.x + bounds.w / 2));
      validXCuts.push({ x, left, right, score: distFromCenter });
    }
  }

  // Extract all candidate horizontal cut positions (Y coordinates)
  const yValues: number[] = [];
  for (const b of boxes) {
    yValues.push(b.y);
    yValues.push(b.y + b.h);
  }
  const yCandidates = getClusteredCutValues(yValues, bounds.y, bounds.y + bounds.h, eps);

  const validYCuts: { y: number; top: PanelBox[]; bottom: PanelBox[]; score: number }[] = [];
  for (const y of yCandidates) {
    const top: PanelBox[] = [];
    const bottom: PanelBox[] = [];
    let isValid = true;

    for (const b of boxes) {
      if (b.y + b.h <= y + eps) {
        top.push(b);
      } else if (b.y >= y - eps) {
        bottom.push(b);
      } else {
        isValid = false;
        break;
      }
    }

    if (isValid && top.length > 0 && bottom.length > 0) {
      const distFromCenter = Math.abs(y - (bounds.y + bounds.h / 2));
      validYCuts.push({ y, top, bottom, score: distFromCenter });
    }
  }

  validXCuts.sort((a, b) => a.score - b.score);
  validYCuts.sort((a, b) => a.score - b.score);

  // If both valid, pick the cut with lower score (closest to center / best balance)
  if (validXCuts.length > 0 && (validYCuts.length === 0 || validXCuts[0].score <= validYCuts[0].score)) {
    const bestCut = validXCuts[0];
    const percent = Math.max(1, Math.min(99, ((bestCut.x - bounds.x) / bounds.w) * 100));
    return {
      type: 'split',
      id: genId(),
      dir: 'row',
      percent,
      c1: boxesToTree(bestCut.left, { x: bounds.x, y: bounds.y, w: bestCut.x - bounds.x, h: bounds.h }),
      c2: boxesToTree(bestCut.right, { x: bestCut.x, y: bounds.y, w: bounds.x + bounds.w - bestCut.x, h: bounds.h }),
    };
  } else if (validYCuts.length > 0) {
    const bestCut = validYCuts[0];
    const percent = Math.max(1, Math.min(99, ((bestCut.y - bounds.y) / bounds.h) * 100));
    return {
      type: 'split',
      id: genId(),
      dir: 'col',
      percent,
      c1: boxesToTree(bestCut.top, { x: bounds.x, y: bounds.y, w: bounds.w, h: bestCut.y - bounds.y }),
      c2: boxesToTree(bestCut.bottom, { x: bounds.x, y: bestCut.y, w: bounds.w, h: bounds.y + bounds.h - bestCut.y }),
    };
  }

  // Fallback if no clean cut found: split along median
  const avgX = boxes.reduce((s, b) => s + b.x + b.w / 2, 0) / boxes.length;
  const left = boxes.filter(b => b.x + b.w / 2 <= avgX);
  const right = boxes.filter(b => b.x + b.w / 2 > avgX);
  if (left.length > 0 && right.length > 0) {
    return {
      type: 'split',
      id: genId(),
      dir: 'row',
      percent: 50,
      c1: boxesToTree(left, { ...bounds, w: bounds.w / 2 }),
      c2: boxesToTree(right, { ...bounds, x: bounds.x + bounds.w / 2, w: bounds.w / 2 }),
    };
  }

  return boxes[0].node;
}

export function replacePanelById(
  node: TreeNode,
  targetId: string,
  replacement: (target: PanelNode) => TreeNode
): TreeNode {
  if (node.type === 'panel') {
    if (node.id === targetId) {
      return replacement(node);
    }
    return node;
  }
  return {
    ...node,
    c1: replacePanelById(node.c1, targetId, replacement),
    c2: replacePanelById(node.c2, targetId, replacement),
  };
}

export function getSegmentsAlongDir(node: TreeNode, dir: Direction): TreeNode[] {
  if (node.type === 'panel') return [node];
  if (node.dir === dir) {
    return [
      ...getSegmentsAlongDir(node.c1, dir),
      ...getSegmentsAlongDir(node.c2, dir),
    ];
  }
  return [node];
}

export function separateLeftOrAbove(node: TreeNode, dir: Direction): TreeNode {
  if (node.type === 'panel') {
    return {
      type: 'split',
      id: genId(),
      dir,
      percent: 50,
      c1: node,
      c2: { type: 'panel', id: genId() },
    };
  }

  // If node is a split with the same direction, the child closest to the gutter is c2
  if (node.dir === dir) {
    return {
      ...node,
      c2: separateLeftOrAbove(node.c2, dir),
    };
  }

  // If node is a split with different direction, split along dir
  return {
    type: 'split',
    id: genId(),
    dir,
    percent: 50,
    c1: node,
    c2: { type: 'panel', id: genId() },
  };
}

interface ComicCanvasProps {
  tree: TreeNode;
  onChange: (tree: TreeNode) => void;
  isDrawingMode?: boolean;
  drawTool?: 'pen'|'erase'|'select'|'fill';
  drawColor?: string;
  drawRadius?: number;
  touchOff?: boolean;
  setTouchOff?: (val: boolean) => void;
  onExpandedChange?: (isExpanded: boolean) => void;
}

export const ComicCanvas: React.FC<ComicCanvasProps> = ({ 
  tree, 
  onChange, 
  isDrawingMode = false, 
  drawTool = 'pen', 
  drawColor = '#000000', 
  drawRadius = 2,
  touchOff = false,
  setTouchOff,
  onExpandedChange
}) => {
  const { t } = useLanguage();
  const [expandedPanelPath, setExpandedPanelPath] = useState<number[] | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [containerAspect, setContainerAspect] = useState<number>(3 / 4);

  useLayoutEffect(() => {
    if (!canvasContainerRef.current) return;
    const updateContainerAspect = () => {
      if (canvasContainerRef.current) {
        const rect = canvasContainerRef.current.getBoundingClientRect();
        if (rect.height > 0 && rect.width > 0) {
          setContainerAspect(rect.width / rect.height);
        }
      }
    };
    updateContainerAspect();
    const ro = new ResizeObserver(updateContainerAspect);
    ro.observe(canvasContainerRef.current);
    return () => ro.disconnect();
  }, []);

  // Auto-reset expanded panel if root tree changes (e.g., page switch or complete layout rebuild)
  useEffect(() => {
    setExpandedPanelPath(null);
  }, [tree.id]);

  useEffect(() => {
    onExpandedChange?.(expandedPanelPath !== null);
  }, [expandedPanelPath, onExpandedChange]);

  const expandedNode = expandedPanelPath !== null ? getNodeByPath(tree, expandedPanelPath) : null;
  useEffect(() => {
    if (expandedPanelPath !== null && !expandedNode) {
      setExpandedPanelPath(null);
    }
  }, [tree, expandedPanelPath, expandedNode]);

  const leafBoxes = useMemo(() => getLeafBoxes(tree), [tree]);
  const rightmostPanels = useMemo(() => {
    return leafBoxes.filter(b => b.x + b.w > 99.5).sort((a, b) => a.y - b.y);
  }, [leafBoxes]);
  const bottommostPanels = useMemo(() => {
    return leafBoxes.filter(b => b.y + b.h > 99.5).sort((a, b) => a.x - b.x);
  }, [leafBoxes]);

  const handleSplitPanel = (targetPanelId: string, dir: Direction) => {
    const newRoot = replacePanelById(tree, targetPanelId, (target) => {
      let updatedTarget = target;
      if (target.drawings && target.drawings.length > 0) {
        const scaleX = dir === 'row' ? 2 : 1;
        const scaleY = dir === 'col' ? 2 : 1;
        const transformed: Stroke[] = target.drawings.map(s => {
          if (s.type === 'fill' && s.bounds) {
            return {
              ...s,
              bounds: {
                x: s.bounds.x * scaleX,
                y: s.bounds.y * scaleY,
                w: s.bounds.w * scaleX,
                h: s.bounds.h * scaleY,
              }
            };
          }
          return {
            ...s,
            brushRadius: s.brushRadius * (dir === 'col' ? 2 : 1),
            points: (s.points || []).map(p => ({
              ...p,
              x: p.x * scaleX,
              y: p.y * scaleY,
            }))
          };
        });
        updatedTarget = { ...target, drawings: transformed };
      }
      return {
        type: 'split',
        id: genId(),
        dir,
        percent: 50,
        c1: updatedTarget,
        c2: { type: 'panel', id: genId() },
      };
    });
    onChange(newRoot);
  };

  const addAtEdge = (edge: 'top' | 'bottom' | 'left' | 'right') => {
    const boxes = getLeafBoxes(tree);
    const topBoxes = boxes.filter(b => b.y < 0.5).sort((a, b) => a.x - b.x);
    const bottomBoxes = boxes.filter(b => b.y + b.h > 99.5).sort((a, b) => a.x - b.x);
    const leftBoxes = boxes.filter(b => b.x < 0.5).sort((a, b) => a.y - b.y);
    const rightBoxes = boxes.filter(b => b.x + b.w > 99.5).sort((a, b) => a.y - b.y);

    const numCols = Math.max(1, topBoxes.length, bottomBoxes.length);
    const numRows = Math.max(1, leftBoxes.length, rightBoxes.length);

    let newTree: TreeNode;
    if (edge === 'top') {
      const newRow = createGridTree(1, Math.max(1, topBoxes.length));
      const percent = (1 / (numRows + 1)) * 100;
      newTree = {
        type: 'split',
        id: genId(),
        dir: 'col',
        percent,
        c1: newRow,
        c2: tree
      };
    } else if (edge === 'bottom') {
      const newRow = createGridTree(1, Math.max(1, bottomBoxes.length));
      const percent = (numRows / (numRows + 1)) * 100;
      newTree = {
        type: 'split',
        id: genId(),
        dir: 'col',
        percent,
        c1: tree,
        c2: newRow
      };
    } else if (edge === 'left') {
      const newCol = createGridTree(Math.max(1, leftBoxes.length), 1);
      const percent = (1 / (numCols + 1)) * 100;
      newTree = {
        type: 'split',
        id: genId(),
        dir: 'row',
        percent,
        c1: newCol,
        c2: tree
      };
    } else { // right
      const newCol = createGridTree(Math.max(1, rightBoxes.length), 1);
      const percent = (numCols / (numCols + 1)) * 100;
      newTree = {
        type: 'split',
        id: genId(),
        dir: 'row',
        percent,
        c1: tree,
        c2: newCol
      };
    }
    onChange(newTree);
  };

  return (
    <div
      ref={canvasContainerRef}
      className={cn(
        "w-full h-full relative select-none group/canvas",
        expandedNode && expandedPanelPath !== null ? "bg-background" : "bg-white"
      )}
    >
      {expandedNode && expandedPanelPath !== null ? (
        <ExpandedPanelWorkspace
          node={expandedNode}
          path={expandedPanelPath}
          onChange={onChange}
          rootTree={tree}
          isDrawingMode={isDrawingMode}
          drawTool={drawTool}
          drawColor={drawColor}
          drawRadius={drawRadius}
          touchOff={touchOff}
          setTouchOff={setTouchOff}
          onExitExpanded={() => setExpandedPanelPath(null)}
          originalRatio={(() => {
            const box = leafBoxes.find(b => b.node.id === expandedNode.id);
            if (box && box.w > 0 && box.h > 0) {
              return (box.w * 3) / (box.h * 4);
            }
            return 0.75;
          })()}
        />
      ) : (
        <>
          <SplitView 
            node={tree} 
            path={[]} 
            onChange={onChange} 
            rootTree={tree} 
            isDrawingMode={isDrawingMode} 
            drawTool={drawTool} 
            drawColor={drawColor} 
            drawRadius={drawRadius} 
            touchOff={touchOff} 
            setTouchOff={setTouchOff} 
            onExpandPanel={(p) => setExpandedPanelPath(p)}
            containerAspect={containerAspect}
            leafBoxes={leafBoxes}
          />

          <SharedEdgesOverlay
            tree={tree}
            onChange={onChange}
            containerRef={canvasContainerRef}
            isDrawingMode={isDrawingMode}
          />

          {/* Top Edge Plus Button */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 opacity-0 group-hover/canvas:opacity-100 transition-opacity" data-export-ignore="true">
            <Button 
              size="icon" 
              variant="secondary" 
              className="w-6 h-6 rounded-full border border-foreground shadow-md bg-white hover:bg-zinc-100 hover:scale-115 transition-all text-black p-0 flex items-center justify-center cursor-pointer"
              onClick={() => addAtEdge('top')}
              title={t("addPanelTop")}
            >
              <Plus className="w-3.5 h-3.5 stroke-[3]" />
            </Button>
          </div>

          {/* Bottom Edge Plus Buttons (Follows inner adding logic: splits individual bottommost panels) */}
          {bottommostPanels.map((panel, idx) => {
            const xCenter = panel.x + panel.w / 2;
            return (
              <div 
                key={`edge-bottom-${panel.id}-${idx}`}
                className="absolute bottom-0 -translate-x-1/2 translate-y-1/2 z-30 opacity-0 group-hover/canvas:opacity-100 transition-opacity" 
                style={{ left: `${xCenter}%` }}
                data-export-ignore="true"
              >
                <Button 
                  size="icon" 
                  variant="secondary" 
                  className="w-6 h-6 rounded-full border border-foreground shadow-md bg-white hover:bg-zinc-100 hover:scale-115 transition-all text-black p-0 flex items-center justify-center cursor-pointer"
                  onClick={() => handleSplitPanel(panel.id, 'col')}
                  title={t("addPanelBottom")}
                >
                  <Plus className="w-3.5 h-3.5 stroke-[3]" />
                </Button>
              </div>
            );
          })}

          {/* Left Edge Plus Button */}
          <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-30 opacity-0 group-hover/canvas:opacity-100 transition-opacity" data-export-ignore="true">
            <Button 
              size="icon" 
              variant="secondary" 
              className="w-6 h-6 rounded-full border border-foreground shadow-md bg-white hover:bg-zinc-100 hover:scale-115 transition-all text-black p-0 flex items-center justify-center cursor-pointer"
              onClick={() => addAtEdge('left')}
              title={t("addPanelLeft")}
            >
              <Plus className="w-3.5 h-3.5 stroke-[3]" />
            </Button>
          </div>

          {/* Right Edge Plus Buttons (Follows inner adding logic: splits individual rightmost panels) */}
          {rightmostPanels.map((panel, idx) => {
            const yCenter = panel.y + panel.h / 2;
            return (
              <div 
                key={`edge-right-${panel.id}-${idx}`}
                className="absolute right-0 top-0 -translate-y-1/2 translate-x-1/2 z-30 opacity-0 group-hover/canvas:opacity-100 transition-opacity" 
                style={{ top: `${yCenter}%` }}
                data-export-ignore="true"
              >
                <Button 
                  size="icon" 
                  variant="secondary" 
                  className="w-6 h-6 rounded-full border border-foreground shadow-md bg-white hover:bg-zinc-100 hover:scale-115 transition-all text-black p-0 flex items-center justify-center cursor-pointer"
                  onClick={() => handleSplitPanel(panel.id, 'row')}
                  title={t("addPanelRight")}
                >
                  <Plus className="w-3.5 h-3.5 stroke-[3]" />
                </Button>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
};

const SplitView: React.FC<{ 
  node: TreeNode; 
  path: number[]; 
  onChange: (t: TreeNode) => void; 
  rootTree: TreeNode; 
  isDrawingMode: boolean; 
  drawTool: 'pen'|'erase'|'select'|'fill'; 
  drawColor: string; 
  drawRadius: number; 
  touchOff?: boolean;
  setTouchOff?: (val: boolean) => void;
  onExpandPanel?: (path: number[]) => void;
  containerAspect?: number;
  leafBoxes?: PanelBox[];
}> = ({ 
  node, 
  path, 
  onChange, 
  rootTree, 
  isDrawingMode, 
  drawTool, 
  drawColor, 
  drawRadius, 
  touchOff, 
  setTouchOff, 
  onExpandPanel,
  containerAspect = 3 / 4,
  leafBoxes
}) => {
  const boxes = leafBoxes || useMemo(() => getLeafBoxes(rootTree), [rootTree]);

  if (node.type === 'panel') {
    const box = boxes.find(b => b.node.id === node.id);
    const panelAspect = (box && box.h > 0) ? (box.w / box.h) * containerAspect : 1;
    return (
      <PanelView 
        node={node} 
        path={path} 
        onChange={onChange} 
        rootTree={rootTree} 
        isDrawingMode={isDrawingMode} 
        drawTool={drawTool} 
        drawColor={drawColor} 
        drawRadius={drawRadius} 
        touchOff={touchOff} 
        setTouchOff={setTouchOff} 
        onExpandPanel={onExpandPanel}
        aspectRatio={panelAspect}
      />
    );
  }

  const { dir, percent, c1, c2 } = node;

  return (
    <div className={`split-container relative flex w-full h-full min-w-0 min-h-0 ${dir === 'row' ? 'flex-row' : 'flex-col'}`}>
      <div style={{ [dir === 'row' ? 'width' : 'height']: `${percent}%` }} className="relative min-w-0 min-h-0 overflow-hidden">
        <SplitView node={c1} path={[...path, 0]} onChange={onChange} rootTree={rootTree} isDrawingMode={isDrawingMode} drawTool={drawTool} drawColor={drawColor} drawRadius={drawRadius} touchOff={touchOff} setTouchOff={setTouchOff} onExpandPanel={onExpandPanel} containerAspect={containerAspect} leafBoxes={boxes} />
      </div>
      <div style={{ [dir === 'row' ? 'width' : 'height']: `${100 - percent}%` }} className="relative min-w-0 min-h-0 overflow-hidden">
        <SplitView node={c2} path={[...path, 1]} onChange={onChange} rootTree={rootTree} isDrawingMode={isDrawingMode} drawTool={drawTool} drawColor={drawColor} drawRadius={drawRadius} touchOff={touchOff} setTouchOff={setTouchOff} onExpandPanel={onExpandPanel} containerAspect={containerAspect} leafBoxes={boxes} />
      </div>
    </div>
  );
};

const SharedEdgesOverlay: React.FC<{
  tree: TreeNode;
  onChange: (t: TreeNode) => void;
  containerRef: React.RefObject<HTMLDivElement>;
  isDrawingMode?: boolean;
}> = ({ tree, onChange, containerRef, isDrawingMode }) => {
  const [showAiForId, setShowAiForId] = useState<string | null>(null);
  const [activeDraggingKey, setActiveDraggingKey] = useState<string | null>(null);
  const longPressTimeout = useRef<NodeJS.Timeout | null>(null);

  const leafBoxes = useMemo(() => getLeafBoxes(tree), [tree]);
  const sharedEdges = useMemo(() => getSharedEdges(leafBoxes), [leafBoxes]);

  if (isDrawingMode || sharedEdges.length === 0) {
    return null;
  }

  const handlePointerDown = (e: React.PointerEvent, edge: SharedEdge) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.pointerType === 'mouse' && e.ctrlKey) {
      setShowAiForId(edge.id);
      return;
    }

    setShowAiForId(null);
    setActiveDraggingKey(edge.id);
    let isDragging = false;

    if (e.pointerType !== 'mouse') {
      longPressTimeout.current = setTimeout(() => {
        if (!isDragging) {
          setShowAiForId(edge.id);
        }
      }, 500);
    }

    const container = containerRef.current;
    if (!container) return;

    const initialBoxes = getLeafBoxes(JSON.parse(JSON.stringify(tree)));
    const isRow = edge.dir === 'row';

    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = isRow ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';

    let rafId: number | null = null;
    let latestEvent: PointerEvent | null = null;

    const applyMove = (ev: PointerEvent) => {
      isDragging = true;
      if (longPressTimeout.current) clearTimeout(longPressTimeout.current);

      const rect = container.getBoundingClientRect();
      let currentPos: number;
      if (isRow) {
        const x = ev.clientX - rect.left;
        currentPos = (x / rect.width) * 100;
      } else {
        const y = ev.clientY - rect.top;
        currentPos = (y / rect.height) * 100;
      }

      let clampedPos = Math.max(edge.minPos, Math.min(edge.maxPos, currentPos));
      const snapThreshold = 1.5;
      if (Math.abs(clampedPos - edge.minPos) <= snapThreshold) {
        clampedPos = edge.minPos;
      } else if (Math.abs(clampedPos - edge.maxPos) <= snapThreshold) {
        clampedPos = edge.maxPos;
      }

      // Resize the adjacent panels touching this specific edge divider
      const updatedBoxes = initialBoxes.map(b => {
        let newX = b.x;
        let newY = b.y;
        let newW = b.w;
        let newH = b.h;

        if (isRow) {
          if (edge.leftPanelIds.includes(b.id)) {
            newW = Math.max(0, clampedPos - b.x);
          }
          if (edge.rightPanelIds.includes(b.id)) {
            const origB = initialBoxes.find(x => x.id === b.id)!;
            newX = clampedPos;
            newW = Math.max(0, (origB.x + origB.w) - clampedPos);
          }
        } else {
          if (edge.topPanelIds.includes(b.id)) {
            newH = Math.max(0, clampedPos - b.y);
          }
          if (edge.bottomPanelIds.includes(b.id)) {
            const origB = initialBoxes.find(x => x.id === b.id)!;
            newY = clampedPos;
            newH = Math.max(0, (origB.y + origB.h) - clampedPos);
          }
        }

        const origB = initialBoxes.find(x => x.id === b.id)!;
        let updatedNode = b.node;

        if (
          b.node.type === 'panel' &&
          b.node.drawings &&
          b.node.drawings.length > 0 &&
          origB.w > 0 &&
          origB.h > 0 &&
          newW > 0 &&
          newH > 0 &&
          (newX !== origB.x || newY !== origB.y || newW !== origB.w || newH !== origB.h)
        ) {
          const scaleX = origB.w / newW;
          const scaleY = origB.h / newH;
          const offsetX = ((origB.x - newX) / newW) * 100;
          const offsetY = ((origB.y - newY) / newH) * 100;

          const transformedDrawings: Stroke[] = b.node.drawings.map(s => {
            if (s.type === 'fill' && s.bounds) {
              return {
                ...s,
                bounds: {
                  x: offsetX + s.bounds.x * scaleX,
                  y: offsetY + s.bounds.y * scaleY,
                  w: s.bounds.w * scaleX,
                  h: s.bounds.h * scaleY,
                }
              };
            }
            return {
              ...s,
              brushRadius: s.brushRadius * (origB.h / newH),
              points: (s.points || []).map(p => ({
                ...p,
                x: offsetX + p.x * scaleX,
                y: offsetY + p.y * scaleY,
              }))
            };
          });

          updatedNode = {
            ...b.node,
            drawings: transformedDrawings
          };
        }

        return { ...b, x: newX, y: newY, w: newW, h: newH, node: updatedNode };
      });

      // Filter out small panels that collapsed (hit another gutter or boundary)
      const collapseThreshold = 1.5;
      const nonCollapsed = updatedBoxes.filter(b => b.w > collapseThreshold && b.h > collapseThreshold);
      const boxesToBuild = nonCollapsed.length > 0 ? nonCollapsed : updatedBoxes;

      const newTree = boxesToTree(boxesToBuild);
      onChange(newTree);
    };

    const onPointerMove = (ev: PointerEvent) => {
      latestEvent = ev;
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          if (latestEvent) {
            applyMove(latestEvent);
          }
          rafId = null;
        });
      }
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (longPressTimeout.current) clearTimeout(longPressTimeout.current);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (latestEvent) {
        applyMove(latestEvent);
      }
      setActiveDraggingKey(null);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;

      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp, { passive: false });
    window.addEventListener('pointercancel', onPointerUp, { passive: false });
  };

  const handleSplitPanel = (targetPanelId: string, dir: Direction) => {
    const newRoot = replacePanelById(tree, targetPanelId, (target) => {
      let updatedTarget = target;
      if (target.drawings && target.drawings.length > 0) {
        const scaleX = dir === 'row' ? 2 : 1;
        const scaleY = dir === 'col' ? 2 : 1;
        const transformed: Stroke[] = target.drawings.map(s => {
          if (s.type === 'fill' && s.bounds) {
            return {
              ...s,
              bounds: {
                x: s.bounds.x * scaleX,
                y: s.bounds.y * scaleY,
                w: s.bounds.w * scaleX,
                h: s.bounds.h * scaleY,
              }
            };
          }
          return {
            ...s,
            brushRadius: s.brushRadius * (dir === 'col' ? 2 : 1),
            points: (s.points || []).map(p => ({
              ...p,
              x: p.x * scaleX,
              y: p.y * scaleY,
            }))
          };
        });
        updatedTarget = { ...target, drawings: transformed };
      }
      return {
        type: 'split',
        id: genId(),
        dir,
        percent: 50,
        c1: updatedTarget,
        c2: { type: 'panel', id: genId() },
      };
    });
    onChange(newRoot);
  };

  return (
    <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden" data-export-ignore="true">
      {sharedEdges.map((edge, edgeIdx) => {
        const isRow = edge.dir === 'row';
        const isDraggingThis = activeDraggingKey === edge.id;
        const showAi = showAiForId === edge.id;
        const sizePercent = Math.max(1, edge.endPercent - edge.startPercent);
        const edgeKey = edge.id || `edge-${edge.dir}-${edgeIdx}`;

        return (
          <div
            key={edgeKey}
            className={`absolute flex items-center justify-center group/edge pointer-events-auto touch-none select-none z-20 ${
              isRow ? 'w-6 -ml-3 cursor-col-resize' : 'h-6 -mt-3 cursor-row-resize'
            }`}
            style={{
              [isRow ? 'left' : 'top']: `${edge.posPercent}%`,
              [isRow ? 'top' : 'left']: `${edge.startPercent}%`,
              [isRow ? 'height' : 'width']: `${sizePercent}%`,
            }}
            onPointerDown={(e) => handlePointerDown(e, edge)}
            onPointerLeave={() => {
              if (longPressTimeout.current) clearTimeout(longPressTimeout.current);
              setShowAiForId(null);
            }}
          >
            {/* Visual feedback line: visible on hover or during active drag */}
            <div
              className={`absolute transition-colors pointer-events-none ${
                isRow
                  ? `w-1 h-full ${isDraggingThis ? 'bg-blue-600' : 'bg-transparent group-hover/edge:bg-black/80'}`
                  : `h-1 w-full ${isDraggingThis ? 'bg-blue-600' : 'bg-transparent group-hover/edge:bg-black/80'}`
              }`}
            />

            {/* Render distinct (+) button aligned with each individual right/under panel */}
            {edge.buttons.map((btn, btnIdx) => {
              const edgeLength = Math.max(0.1, edge.endPercent - edge.startPercent);
              const relPercent = ((btn.posAlongEdge - edge.startPercent) / edgeLength) * 100;
              const btnKey = `${edgeKey}-btn-${btn.targetPanelId}-${btnIdx}`;

              return (
                <div
                  key={btnKey}
                  className={`transition-opacity absolute flex gap-1 pointer-events-none text-white z-30 ${
                    isDraggingThis ? 'opacity-0' : 'opacity-0 group-hover/edge:opacity-100'
                  }`}
                  style={{
                    [isRow ? 'top' : 'left']: `${relPercent}%`,
                    [isRow ? 'left' : 'top']: '50%',
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  <Button
                    size="icon"
                    variant="default"
                    className="w-6 h-6 rounded-full pointer-events-auto shadow-md bg-black text-white hover:bg-zinc-800 hover:scale-110 transition-all p-0 flex items-center justify-center cursor-pointer border border-white/20"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSplitPanel(btn.targetPanelId, edge.dir);
                    }}
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                  </Button>
                  {showAi && (
                    <Button
                      size="icon"
                      variant="default"
                      className="w-6 h-6 rounded-full pointer-events-auto shadow-md bg-[#2DC6CF] hover:bg-[#20b2ba]"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        window.dispatchEvent(
                          new CustomEvent('quote-to-agent', {
                            detail: {
                              type: 'text',
                              text: 'How should I divide this comic panel layout?',
                            },
                          })
                        );
                        setShowAiForId(null);
                      }}
                    >
                      <Bot className="w-3.5 h-3.5 text-black" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
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
    if (stroke.isFullArea) {
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
  touchOff?: boolean;
  setTouchOff?: (val: boolean) => void;
  aspectRatio?: number;
  isExpanded?: boolean;
}> = ({ 
  drawings, 
  onChange, 
  isDrawingMode, 
  drawTool, 
  drawColor, 
  drawRadius,
  touchOff = false,
  setTouchOff,
  aspectRatio,
  isExpanded = false,
}) => {
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);
  const [lassoPath, setLassoPath] = useState<Point[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragType, setDragType] = useState<'move' | 'erase_drag' | 'scale' | null>(null);
  const [isFilling, setIsFilling] = useState(false);
  const [fallbackAspect, setFallbackAspect] = useState<number>(1);
  const aspectRef = useRef<number>(1);
  const svgRef = useRef<SVGSVGElement>(null);
  const lastPenTimeRef = useRef<number>(0);

  const curAspect = (aspectRatio && aspectRatio > 0)
    ? aspectRatio
    : (fallbackAspect > 0 ? fallbackAspect : (aspectRef.current || 1));

  useLayoutEffect(() => {
    if (!svgRef.current) return;
    const updateAspect = () => {
      if (svgRef.current) {
        const rect = svgRef.current.getBoundingClientRect();
        if (rect.height > 0 && rect.width > 0) {
          const newAspect = rect.width / rect.height;
          aspectRef.current = newAspect;
          if (!aspectRatio) {
            setFallbackAspect(newAspect);
          }
        }
      }
    };
    updateAspect();
    const ro = new ResizeObserver(updateAspect);
    ro.observe(svgRef.current);
    return () => ro.disconnect();
  }, [aspectRatio]);

  // Cancel single-finger drawing stroke when multi-touch (e.g. 2-finger pinch/expand) begins
  useEffect(() => {
    const handleMultiTouch = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        setCurrentStroke(null);
        setDragType(null);
      }
    };
    window.addEventListener('touchstart', handleMultiTouch, { passive: true });
    return () => {
      window.removeEventListener('touchstart', handleMultiTouch);
    };
  }, []);

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
      pressure: e.pressure !== undefined && e.pressure > 0 ? e.pressure : (e.pointerType === 'pen' ? 0.2 : 0.5),
      tiltX: e.tiltX ?? 0,
      tiltY: e.tiltY ?? 0,
      pointerType: e.pointerType,
    };
  };

  const getActualRadius = () => {
    if (!svgRef.current) return drawRadius;
    const rect = svgRef.current.getBoundingClientRect();
    return (drawRadius * 100) / rect.width;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!isDrawingMode) return;

    if (e.pointerType === 'pen') {
      lastPenTimeRef.current = Date.now();
      if (!touchOff && setTouchOff) {
        setTouchOff(true);
      }
    }

    if (e.pointerType === 'touch') {
      if (touchOff || (Date.now() - lastPenTimeRef.current < 2000)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }

    (e.target as Element).releasePointerCapture(e.pointerId);
    const pt = getPt(e);

    if (drawTool === 'pen') {
      setSelectedIds(new Set());
      // Handle starting pressure properly to eliminate initial big dot:
      // Stylus drivers frequently report e.pressure as 0.5 or 0 on first contact before pressure is known.
      // We set a gentle starting pressure that immediately blends into actual pressure on move.
      const initialPressure = e.pointerType === 'pen'
        ? (e.pressure && e.pressure > 0 && e.pressure !== 0.5 ? e.pressure : 0.15)
        : 0.5;
      const initialPt = { ...pt, pressure: initialPressure };
      setCurrentStroke({ id: Math.random().toString(36).substring(2), points: [initialPt], color: drawColor, brushRadius: getActualRadius() });
    } else if (drawTool === 'erase') {
      setSelectedIds(new Set());
      const remaining = drawings.filter(s => !strokeIntersectsCircle(s, pt, getActualRadius() / 2));
      if (remaining.length !== drawings.length) onChange(remaining);
      setDragType('erase_drag');
    } else if (drawTool === 'select') {
      setLassoPath([pt]);
      setSelectedIds(new Set());
    } else if (drawTool === 'fill') {
      setSelectedIds(new Set());
      if (isFilling) return;

      setIsFilling(true);
      
      requestAnimationFrame(() => {
        try {
          if (!svgRef.current) { setIsFilling(false); return; }
          const effectiveAspect = curAspect > 0 ? curAspect : (aspectRef.current || 1);
          
          // 1. Calculate extended bounding box of drawings and click point
          let drawMinX = 0, drawMaxX = 100, drawMinY = 0, drawMaxY = 100;
          for (const s of drawings) {
            if (s.type === 'fill' && s.bounds) {
              drawMinX = Math.min(drawMinX, s.bounds.x);
              drawMaxX = Math.max(drawMaxX, s.bounds.x + s.bounds.w);
              drawMinY = Math.min(drawMinY, s.bounds.y);
              drawMaxY = Math.max(drawMaxY, s.bounds.y + s.bounds.h);
            } else if (s.points) {
              for (const p of s.points) {
                drawMinX = Math.min(drawMinX, p.x);
                drawMaxX = Math.max(drawMaxX, p.x);
                drawMinY = Math.min(drawMinY, p.y);
                drawMaxY = Math.max(drawMaxY, p.y);
              }
            }
          }

          const margin = 100;
          const worldMinX = Math.min(-margin, Math.floor(drawMinX - 30), Math.floor(pt.x - 30));
          const worldMaxX = Math.max(100 + margin, Math.ceil(drawMaxX + 30), Math.ceil(pt.x + 30));
          const worldMinY = Math.min(-margin, Math.floor(drawMinY - 30), Math.floor(pt.y - 30));
          const worldMaxY = Math.max(100 + margin, Math.ceil(drawMaxY + 30), Math.ceil(pt.y + 30));

          const worldW = Math.max(10, worldMaxX - worldMinX);
          const worldH = Math.max(10, worldMaxY - worldMinY);

          // Raster canvas dimensions for mask testing
          const canvasH = 1600;
          const canvasW = Math.max(100, Math.round(1600 * (worldW / worldH) * effectiveAspect));
          const canvas = document.createElement('canvas');
          canvas.width = canvasW;
          canvas.height = canvasH;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) { setIsFilling(false); return; }

          ctx.fillStyle = '#000000';
          ctx.strokeStyle = '#000000';
          ctx.save();
          ctx.scale(canvasW / worldW, canvasH / worldH);
          ctx.translate(-worldMinX, -worldMinY);

          // 2. Render all pen stroke outlines with exact vector paths
          const penStrokes = drawings.filter(s => s.type !== 'fill' && s.points && s.points.length > 0);
          for (const s of penStrokes) {
            const d = getSvgPathFromPoints(s.points, s.brushRadius, effectiveAspect);
            if (d) {
              const p2d = new Path2D(d);
              ctx.fill(p2d);
            }
          }

          // 3. Panel boundary closing: If clicking inside the comic panel area [0..100, 0..100], stroke the panel frame
          if (pt.x >= 0 && pt.x <= 100 && pt.y >= 0 && pt.y <= 100) {
            ctx.lineWidth = 1;
            ctx.strokeRect(0, 0, 100, 100);
          }

          ctx.restore();

          const srcImageData = ctx.getImageData(0, 0, canvasW, canvasH);
          const srcData = srcImageData.data;

          let startX = Math.round(((pt.x - worldMinX) / worldW) * canvasW);
          let startY = Math.round(((pt.y - worldMinY) / worldH) * canvasH);
          startX = Math.max(0, Math.min(canvasW - 1, startX));
          startY = Math.max(0, Math.min(canvasH - 1, startY));

          const STROKE_ALPHA_THRESHOLD = 30;

          // 4. Seed point search: If clicked on a stroke boundary (alpha > threshold), search outward for open interior
          let seedX = startX;
          let seedY = startY;
          if (srcData[(startY * canvasW + startX) * 4 + 3] > STROKE_ALPHA_THRESHOLD) {
            let minAlpha = srcData[(startY * canvasW + startX) * 4 + 3];
            let foundEmpty = false;
            for (let r = 1; r <= 45 && !foundEmpty; r++) {
              for (let dy = -r; dy <= r && !foundEmpty; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                  if (dx * dx + dy * dy > r * r) continue;
                  const nx = startX + dx;
                  const ny = startY + dy;
                  if (nx >= 0 && nx < canvasW && ny >= 0 && ny < canvasH) {
                    const a = srcData[(ny * canvasW + nx) * 4 + 3];
                    if (a < minAlpha) {
                      minAlpha = a;
                      seedX = nx;
                      seedY = ny;
                      if (minAlpha <= STROKE_ALPHA_THRESHOLD) {
                        foundEmpty = true;
                        break;
                      }
                    }
                  }
                }
              }
            }
          }

          // 5. Build dilated collision mask to trap flood fill inside shapes with 1-3px micro-gaps
          const isSolidStroke = (x: number, y: number) => srcData[(y * canvasW + x) * 4 + 3] > STROKE_ALPHA_THRESHOLD;
          const closedBarrier = new Uint8Array(canvasW * canvasH);
          for (let y = 0; y < canvasH; y++) {
            const rowOffset = y * canvasW;
            for (let x = 0; x < canvasW; x++) {
              if (srcData[(rowOffset + x) * 4 + 3] > STROKE_ALPHA_THRESHOLD) {
                for (let dy = -2; dy <= 2; dy++) {
                  const ny = y + dy;
                  if (ny < 0 || ny >= canvasH) continue;
                  for (let dx = -2; dx <= 2; dx++) {
                    if (dx * dx + dy * dy > 4) continue;
                    const nx = x + dx;
                    if (nx < 0 || nx >= canvasW) continue;
                    closedBarrier[ny * canvasW + nx] = 1;
                  }
                }
              }
            }
          }

          let phase1SeedX = seedX;
          let phase1SeedY = seedY;
          if (closedBarrier[seedY * canvasW + seedX] && !isSolidStroke(seedX, seedY)) {
            let found = false;
            for (let r = 1; r <= 20 && !found; r++) {
              for (let dy = -r; dy <= r && !found; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                  const nx = seedX + dx;
                  const ny = seedY + dy;
                  if (nx >= 0 && nx < canvasW && ny >= 0 && ny < canvasH && !closedBarrier[ny * canvasW + nx]) {
                    phase1SeedX = nx;
                    phase1SeedY = ny;
                    found = true;
                    break;
                  }
                }
              }
            }
          }

          const visited = new Uint8Array(canvasW * canvasH);
          const queue = new Int32Array(canvasW * canvasH);
          let head = 0;
          let tail = 0;

          if (!closedBarrier[phase1SeedY * canvasW + phase1SeedX]) {
            const startIdx = phase1SeedY * canvasW + phase1SeedX;
            queue[tail++] = startIdx;
            visited[startIdx] = 1;
          } else if (!isSolidStroke(seedX, seedY)) {
            const startIdx = seedY * canvasW + seedX;
            queue[tail++] = startIdx;
            visited[startIdx] = 1;
          }

          // Phase 1: 4-connected BFS on closedBarrier to guarantee confinement inside shape
          while (head < tail) {
            const idx = queue[head++];
            const curX = idx % canvasW;
            const curY = Math.floor(idx / canvasW);

            const left = curX > 0 ? idx - 1 : -1;
            const right = curX < canvasW - 1 ? idx + 1 : -1;
            const up = curY > 0 ? idx - canvasW : -1;
            const down = curY < canvasH - 1 ? idx + canvasW : -1;

            if (left !== -1 && !visited[left] && !closedBarrier[left]) {
              visited[left] = 1; queue[tail++] = left;
            }
            if (right !== -1 && !visited[right] && !closedBarrier[right]) {
              visited[right] = 1; queue[tail++] = right;
            }
            if (up !== -1 && !visited[up] && !closedBarrier[up]) {
              visited[up] = 1; queue[tail++] = up;
            }
            if (down !== -1 && !visited[down] && !closedBarrier[down]) {
              visited[down] = 1; queue[tail++] = down;
            }
          }

          // Check if Phase 1 fill touched outer canvas boundaries (unconstrained background)
          let p1MinX = canvasW, p1MaxX = 0, p1MinY = canvasH, p1MaxY = 0;
          for (let i = 0; i < tail; i++) {
            const idx = queue[i];
            const cx = idx % canvasW;
            const cy = Math.floor(idx / canvasW);
            if (cx < p1MinX) p1MinX = cx;
            if (cx > p1MaxX) p1MaxX = cx;
            if (cy < p1MinY) p1MinY = cy;
            if (cy > p1MaxY) p1MaxY = cy;
          }
          const touchesEdges = p1MinX <= 2 || p1MaxX >= canvasW - 3 || p1MinY <= 2 || p1MaxY >= canvasH - 3;
          const isFullArea = tail === 0 || touchesEdges;

          // Phase 2: Corner & Vertex Reclaiming on True Mask
          // Expand the visited region into all adjacent open pixels (srcData <= threshold).
          // Because the fill is already locked inside the shape, this fills all the way into sharp acute vertices and narrow corners!
          if (!isFullArea && tail > 0) {
            head = 0;
            while (head < tail) {
              const idx = queue[head++];
              const curX = idx % canvasW;
              const curY = Math.floor(idx / canvasW);

              const left = curX > 0 ? idx - 1 : -1;
              const right = curX < canvasW - 1 ? idx + 1 : -1;
              const up = curY > 0 ? idx - canvasW : -1;
              const down = curY < canvasH - 1 ? idx + canvasW : -1;

              if (left !== -1 && !visited[left] && srcData[left * 4 + 3] <= STROKE_ALPHA_THRESHOLD) {
                visited[left] = 1; queue[tail++] = left;
              }
              if (right !== -1 && !visited[right] && srcData[right * 4 + 3] <= STROKE_ALPHA_THRESHOLD) {
                visited[right] = 1; queue[tail++] = right;
              }
              if (up !== -1 && !visited[up] && srcData[up * 4 + 3] <= STROKE_ALPHA_THRESHOLD) {
                visited[up] = 1; queue[tail++] = up;
              }
              if (down !== -1 && !visited[down] && srcData[down * 4 + 3] <= STROKE_ALPHA_THRESHOLD) {
                visited[down] = 1; queue[tail++] = down;
              }
            }
          }

          // Phase 3: Build Filled Mask and Apply Under-Stroke Anti-Halo Bleed
          const filledMask = new Uint8Array(canvasW * canvasH);
          let boundMinX = canvasW, boundMaxX = 0, boundMinY = canvasH, boundMaxY = 0;

          if (isFullArea) {
            for (let idx = 0; idx < canvasW * canvasH; idx++) {
              if (srcData[idx * 4 + 3] <= STROKE_ALPHA_THRESHOLD) {
                filledMask[idx] = 1;
              }
            }
            boundMinX = 0;
            boundMinY = 0;
            boundMaxX = canvasW - 1;
            boundMaxY = canvasH - 1;
          } else if (tail > 0) {
            // Mark all visited open pixels
            for (let i = 0; i < tail; i++) {
              const idx = queue[i];
              filledMask[idx] = 1;
              const cx = idx % canvasW;
              const cy = Math.floor(idx / canvasW);
              if (cx < boundMinX) boundMinX = cx;
              if (cx > boundMaxX) boundMaxX = cx;
              if (cy < boundMinY) boundMinY = cy;
              if (cy > boundMaxY) boundMaxY = cy;
            }

            // Strictly expand 2-3px into stroke pixels (srcData > STROKE_ALPHA_THRESHOLD)
            // This eliminates white halos while preventing any bleed into exterior empty space
            const bleedRadius = 3;
            const initialTail = tail;
            for (let i = 0; i < initialTail; i++) {
              const idx = queue[i];
              const x = idx % canvasW;
              const y = Math.floor(idx / canvasW);

              for (let dy = -bleedRadius; dy <= bleedRadius; dy++) {
                const ny = y + dy;
                if (ny < 0 || ny >= canvasH) continue;
                for (let dx = -bleedRadius; dx <= bleedRadius; dx++) {
                  if (dx === 0 && dy === 0) continue;
                  if (dx * dx + dy * dy > bleedRadius * bleedRadius) continue;
                  const nx = x + dx;
                  if (nx < 0 || nx >= canvasW) continue;
                  const nIdx = ny * canvasW + nx;
                  // Bleed ONLY into stroke pixels
                  if (srcData[nIdx * 4 + 3] > STROKE_ALPHA_THRESHOLD && !filledMask[nIdx]) {
                    filledMask[nIdx] = 1;
                    if (nx < boundMinX) boundMinX = nx;
                    if (nx > boundMaxX) boundMaxX = nx;
                    if (ny < boundMinY) boundMinY = ny;
                    if (ny > boundMaxY) boundMaxY = ny;
                  }
                }
              }
            }
          }

          if ((isFullArea || tail > 0) && boundMinX <= boundMaxX && boundMinY <= boundMaxY) {
            const bw = boundMaxX - boundMinX + 1;
            const bh = boundMaxY - boundMinY + 1;

            const boundsCanvas = document.createElement('canvas');
            boundsCanvas.width = bw;
            boundsCanvas.height = bh;
            const bCtx = boundsCanvas.getContext('2d');

            if (bCtx) {
              const rColor = parseInt(drawColor.slice(1, 3), 16) || 0;
              const gColor = parseInt(drawColor.slice(3, 5), 16) || 0;
              const bColor = parseInt(drawColor.slice(5, 7), 16) || 0;

              const fillImageData = bCtx.createImageData(bw, bh);
              const fillData = fillImageData.data;

              for (let y = 0; y < bh; y++) {
                const srcY = boundMinY + y;
                for (let x = 0; x < bw; x++) {
                  const srcX = boundMinX + x;
                  if (filledMask[srcY * canvasW + srcX]) {
                    const dIdx = (y * bw + x) * 4;
                    fillData[dIdx] = rColor;
                    fillData[dIdx + 1] = gColor;
                    fillData[dIdx + 2] = bColor;
                    fillData[dIdx + 3] = 255;
                  }
                }
              }

              bCtx.putImageData(fillImageData, 0, 0);
              const newId = Math.random().toString(36).substring(2);
              hitMapCache.set(newId, { data: fillData, width: bw, height: bh });

              const newFillBounds = isFullArea ? {
                x: worldMinX,
                y: worldMinY,
                w: worldW,
                h: worldH,
              } : {
                x: worldMinX + (boundMinX / canvasW) * worldW,
                y: worldMinY + (boundMinY / canvasH) * worldH,
                w: (bw / canvasW) * worldW,
                h: (bh / canvasH) * worldH,
              };

              const newFillStroke: Stroke = {
                id: newId,
                type: 'fill',
                points: [],
                color: drawColor,
                brushRadius: 0,
                imageUrl: boundsCanvas.toDataURL('image/png'),
                isFullArea: isFullArea,
                bounds: newFillBounds
              };

              // Check if replacing an existing fill with matching bounds/location
              const existingFills = drawings.filter(s => s.type === 'fill');
              const existingPenStrokes = drawings.filter(s => s.type !== 'fill');

              // If full area, replace previous full area fill
              let updatedFills: Stroke[];
              if (isFullArea) {
                updatedFills = [...existingFills.filter(s => !s.isFullArea), newFillStroke];
              } else {
                // If there is an existing shape fill with almost identical bounding box, replace it
                const matchIdx = existingFills.findIndex(s => 
                  !s.isFullArea && 
                  s.bounds && 
                  Math.abs(s.bounds.x - newFillBounds.x) < 3.5 &&
                  Math.abs(s.bounds.y - newFillBounds.y) < 3.5 &&
                  Math.abs(s.bounds.w - newFillBounds.w) < 4.5 &&
                  Math.abs(s.bounds.h - newFillBounds.h) < 4.5
                );
                if (matchIdx !== -1) {
                  updatedFills = [...existingFills];
                  updatedFills[matchIdx] = newFillStroke;
                } else {
                  updatedFills = [...existingFills, newFillStroke];
                }
              }

              onChange([...updatedFills, ...existingPenStrokes]);
            }
          }
        } catch (err) {
          console.error("Fill tool error:", err);
        } finally {
          setIsFilling(false);
        }
      });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDrawingMode) return;

    if (e.pointerType === 'pen') {
      lastPenTimeRef.current = Date.now();
    }

    if (e.pointerType === 'touch') {
      if (touchOff || (Date.now() - lastPenTimeRef.current < 2000)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }

    const pt = getPt(e);

    if (drawTool === 'pen' && currentStroke) {
      const lastPt = currentStroke.points[currentStroke.points.length - 1];
      // Capture at a higher resolution (0.08 threshold) for high-precision stylus support
      if (Math.abs(pt.x - lastPt.x) > 0.08 || Math.abs(pt.y - lastPt.y) > 0.08) {
        if (currentStroke.points.length === 1 && pt.pointerType === 'pen') {
          // If first point was a placeholder pressure, smooth with actual point 1 pressure
          const p0 = currentStroke.points[0];
          const realP = pt.pressure || 0.2;
          const adjustedP0 = { ...p0, pressure: Math.min(p0.pressure ?? realP, realP) };
          setCurrentStroke({
            ...currentStroke,
            points: [adjustedP0, pt]
          });
        } else {
          setCurrentStroke(prev => prev ? { ...prev, points: [...prev.points, pt] } : null);
        }
      }
    } else if (drawTool === 'erase' && dragType === 'erase_drag') {
      const remaining = drawings.filter(s => !strokeIntersectsCircle(s, pt, getActualRadius() / 2));
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

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'pen') {
      lastPenTimeRef.current = Date.now();
    }
    
    if (e.pointerType === 'touch') {
      if (touchOff || (Date.now() - lastPenTimeRef.current < 2000)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }

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

  const renderStroke = (s: Stroke, isSelected: boolean, strokeIdx?: number) => {
    const strokeKey = `${s.id || 'stroke'}-${strokeIdx ?? 0}${isSelected ? '-sel' : ''}`;
    if (s.type === 'fill' && s.imageUrl && s.bounds) {
      const isFull = s.isFullArea || (s.bounds.w >= 100 && s.bounds.h >= 100 && s.bounds.x <= 0 && s.bounds.y <= 0) || s.bounds.w >= 300;
      return (
        <g key={strokeKey}>
          {isFull && (
            <g className="full-area-fill-extensions" style={{ pointerEvents: 'none' }}>
              <rect x="-500000" y="-500000" width="1000000" height={Math.max(0, s.bounds.y - (-500000))} fill={s.color} opacity={drawTool === 'erase' && isDrawingMode ? 0.7 : 1} />
              <rect x="-500000" y={s.bounds.y + s.bounds.h} width="1000000" height={Math.max(0, 500000 - (s.bounds.y + s.bounds.h))} fill={s.color} opacity={drawTool === 'erase' && isDrawingMode ? 0.7 : 1} />
              <rect x="-500000" y={s.bounds.y} width={Math.max(0, s.bounds.x - (-500000))} height={s.bounds.h} fill={s.color} opacity={drawTool === 'erase' && isDrawingMode ? 0.7 : 1} />
              <rect x={s.bounds.x + s.bounds.w} y={s.bounds.y} width={Math.max(0, 500000 - (s.bounds.x + s.bounds.w))} height={s.bounds.h} fill={s.color} opacity={drawTool === 'erase' && isDrawingMode ? 0.7 : 1} />
            </g>
          )}
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
    
    const d = getSvgPathFromPoints(s.points, s.brushRadius, curAspect);
    if (!d) return null;

    // When erasing, show strokes slightly faded so users know what tool they're using
    const opacity = (drawTool === 'erase' && isDrawingMode) ? 0.7 : 1;
    return (
      <g key={strokeKey}>
        {isSelected && (
          <path 
            d={d} 
            fill={s.color} 
            stroke="#3b82f6" 
            strokeWidth={2} 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            opacity={0.4} 
          />
        )}
        <path 
          d={d} 
          fill={s.color} 
          opacity={opacity} 
        />
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

  const onPointerEnter = (e: React.PointerEvent) => {
    if (!isDrawingMode) return;
  };

  const onPointerLeave = (e: React.PointerEvent) => {
    onPointerUp(e);
  };

  return (
    <svg 
      ref={svgRef}
      className={`absolute inset-0 w-full h-full ${isExpanded ? 'overflow-visible' : 'overflow-hidden'} ${isDrawingMode ? 'z-50 touch-none pointer-events-auto' : 'z-10 pointer-events-none touch-none'}`}
      style={{ overflow: isExpanded ? 'visible' : 'hidden', cursor: isDrawingMode ? HOLLOW_CROSS_CURSOR : undefined }}
      onPointerEnter={onPointerEnter}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {drawings.map((s, idx) => renderStroke(s, selectedIds.has(s.id), idx))}
      {currentStroke && renderStroke(currentStroke, false, -1)}
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

const PanelView: React.FC<{ 
  node: PanelNode; 
  path: number[]; 
  onChange: (t: TreeNode) => void; 
  rootTree: TreeNode; 
  isDrawingMode: boolean; 
  drawTool: 'pen'|'erase'|'select'|'fill'; 
  drawColor: string; 
  drawRadius: number; 
  touchOff?: boolean;
  setTouchOff?: (val: boolean) => void;
  isExpanded?: boolean;
  hideExpandButton?: boolean;
  onExpandPanel?: (path: number[]) => void;
  onToggleExpand?: () => void;
  aspectRatio?: number;
}> = ({ 
  node, 
  path, 
  onChange, 
  rootTree, 
  isDrawingMode, 
  drawTool, 
  drawColor, 
  drawRadius, 
  touchOff, 
  setTouchOff,
  isExpanded = false,
  hideExpandButton = false,
  onExpandPanel,
  onToggleExpand,
  aspectRatio
}) => {
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isColorFolded, setIsColorFolded] = useState(true);
  const [isCropping, setIsCropping] = useState(false);
  const panelContainerRef = useRef<HTMLDivElement>(null);
  const panelInnerRef = useRef<HTMLDivElement>(null);
  const touchDataRef = useRef<{
    startDist: number;
    hasTriggered: boolean;
  } | null>(null);

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
    if (isExpanded) {
      return;
    }
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

  const handlePointerDown = () => {
    (window as any).activeComicPanelPath = path;
    (window as any).activeComicPanelRef = panelInnerRef.current;
  };

  // Two-finger pinch-to-expand gesture for touch devices (only active in page mode)
  useEffect(() => {
    if (isExpanded) return;
    const el = panelContainerRef.current;
    if (!el) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        touchDataRef.current = { startDist: dist, hasTriggered: false };
      } else {
        touchDataRef.current = null;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && touchDataRef.current && !touchDataRef.current.hasTriggered) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const startDist = touchDataRef.current.startDist;

        if (startDist > 15) {
          const ratio = dist / startDist;
          const diff = dist - startDist;

          // Two-finger spread (pinch-out) -> expand to full canvas
          if (ratio > 1.2 || diff > 30) {
            touchDataRef.current.hasTriggered = true;
            if (e.cancelable) e.preventDefault();
            onExpandPanel?.(path);
          }
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        touchDataRef.current = null;
      }
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [isExpanded, onExpandPanel, path]);

  return (
    <div 
      ref={panelContainerRef}
      className={cn(
        "w-full h-full bg-white relative flex items-center justify-center",
        isExpanded ? "p-0 overflow-visible" : "p-[2px] overflow-hidden"
      )}
      onPointerDown={handlePointerDown}
    >
      <div 
        ref={panelInnerRef}
        className={cn(
          "w-full h-full bg-white relative cursor-pointer group",
          isExpanded 
            ? "border-0 overflow-visible" 
            : "border border-zinc-900 hover:border-primary/60 dark:hover:border-primary/80 overflow-hidden"
        )}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {/* Fullscreen / Expand button on right-top of panel */}
        {!hideExpandButton && (
          <div 
            className={cn(
              "absolute top-2 right-2 z-40 transition-all duration-200 pointer-events-auto",
              isExpanded 
                ? "opacity-100" 
                : "opacity-90 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 hover:opacity-100"
            )}
            data-export-ignore="true"
          >
            <Button
              size="icon"
              variant="secondary"
              type="button"
              className="w-8 h-8 sm:w-7 sm:h-7 rounded-md bg-white/95 hover:bg-white text-zinc-900 border border-zinc-300 shadow-md hover:scale-105 active:scale-95 transition-all p-0 flex items-center justify-center cursor-pointer dark:bg-zinc-800/95 dark:hover:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
              onClick={(e) => {
                e.stopPropagation();
                if (isExpanded) {
                  onToggleExpand?.();
                } else {
                  onExpandPanel?.(path);
                }
              }}
              title={isExpanded ? (t("restorePanel") || "Restore panel") : (t("fullscreen") || "Fullscreen")}
            >
              {isExpanded ? (
                <Minimize className="w-4 h-4 sm:w-3.5 sm:h-3.5 stroke-[2.5]" />
              ) : (
                <Maximize className="w-4 h-4 sm:w-3.5 sm:h-3.5 stroke-[2.5]" />
              )}
            </Button>
          </div>
        )}

        {node.imageUrl ? (
            <div 
              className={cn(
                "w-full h-full relative overflow-hidden",
                node.isHighContrast && "contrast-[1.25] grayscale"
              )}
              style={node.hasOutline ? { border: `2px solid ${node.color || '#000000'}`, boxSizing: 'border-box' } : undefined}
            >
              <img 
                src={node.imageUrl || undefined} 
                alt="Panel" 
                className={cn("w-full h-full object-cover select-none pointer-events-auto", node.isHighContrast && "contrast-[1.25] grayscale")} 
                onClick={handleImgClick} 
                onDoubleClick={handleDoubleClick}
              />
            </div>
        ) : !isDrawingMode && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-zinc-400 font-mono text-sm pointer-events-none p-2" data-export-ignore="true">
                <span>{t("tapToInsertImage")}</span>
                <span className="text-xs text-zinc-400/70 mt-1">{t("doubleTapToRemove")}</span>
            </div>
        )}
        {showAiIcon && node.imageUrl && (
            <div className="absolute inset-0 flex items-start justify-center bg-black/40 z-[100] animate-in fade-in" data-export-ignore="true" onClick={(e) => { e.stopPropagation(); setShowAiIcon(false); }}>
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
                         const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&safe=nsfw&seed=${newSeed}&model=flux`;
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
        <DrawingCanvas 
          drawings={node.drawings || []} 
          onChange={handleDrawingsChange} 
          isDrawingMode={isDrawingMode} 
          drawTool={drawTool} 
          drawColor={drawColor} 
          drawRadius={drawRadius} 
          touchOff={touchOff} 
          setTouchOff={setTouchOff} 
          aspectRatio={aspectRatio}
          isExpanded={isExpanded}
        />
        <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handleImageUpload} />
      </div>
    </div>
  );
};

const ExpandedPanelWorkspace: React.FC<{
  node: PanelNode;
  path: number[];
  onChange: (t: TreeNode) => void;
  rootTree: TreeNode;
  isDrawingMode: boolean;
  drawTool: 'pen'|'erase'|'select'|'fill';
  drawColor: string;
  drawRadius: number;
  touchOff?: boolean;
  setTouchOff?: (val: boolean) => void;
  onExitExpanded: () => void;
  originalRatio: number;
}> = ({
  node,
  path,
  onChange,
  rootTree,
  isDrawingMode,
  drawTool,
  drawColor,
  drawRadius,
  touchOff,
  setTouchOff,
  onExitExpanded,
  originalRatio,
}) => {
  const { t } = useLanguage();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const panelAreaRef = useRef<HTMLDivElement>(null);
  const panelBoxRef = useRef<HTMLDivElement>(null);
  const mousePosRef = useRef<{ clientX: number; clientY: number } | null>(null);

  const [zoomScale, setZoomScaleState] = useState<number>(1.0);
  const [pan, setPanState] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const zoomScaleRef = useRef<number>(1.0);
  const panRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const updateZoomAndPan = (newScale: number, newPan: { x: number; y: number }) => {
    zoomScaleRef.current = newScale;
    panRef.current = newPan;
    setZoomScaleState(newScale);
    setPanState(newPan);
  };

  const [isSpaceDown, setIsSpaceDown] = useState<boolean>(false);
  const [isDraggingPan, setIsDraggingPan] = useState<boolean>(false);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });

  // Measure panel area size with ResizeObserver
  useEffect(() => {
    const el = panelAreaRef.current || workspaceRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setContainerSize({ w: rect.width, h: rect.height });
      }
    };
    updateSize();
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute base dimensions for the panel frame to fit the top area without blank space on top
  const { baseW, baseH } = useMemo(() => {
    const maxW = Math.max(50, containerSize.w);
    const maxH = Math.max(50, containerSize.h);
    const effectiveRatio = originalRatio > 0 ? originalRatio : 0.75;
    const containerRatio = maxW / maxH;
    
    let bw: number;
    let bh: number;
    if (containerRatio >= effectiveRatio) {
      bh = maxH;
      bw = bh * effectiveRatio;
    } else {
      bw = maxW;
      bh = bw / effectiveRatio;
    }
    return { baseW: Math.round(bw), baseH: Math.round(bh) };
  }, [containerSize, originalRatio]);

  // Precise cursor-centered zoom helper: the point under the cursor remains at the exact same screen pixel
  const zoomAroundCursor = (
    factorOrCalc: number | ((prev: number) => number),
    clientX?: number,
    clientY?: number
  ) => {
    const panelBox = panelBoxRef.current || panelAreaRef.current || workspaceRef.current;
    if (!panelBox) return;

    const currentScale = zoomScaleRef.current;
    const currentPan = panRef.current;

    let nextScale: number;
    if (typeof factorOrCalc === 'function') {
      nextScale = factorOrCalc(currentScale);
    } else {
      nextScale = currentScale * factorOrCalc;
    }
    // Allow minimal zoom down to 1% (0.01) and up to 1000% (10.0)
    nextScale = Math.max(0.01, Math.min(10, +nextScale.toFixed(4)));

    if (Math.abs(nextScale - currentScale) < 0.00001) return;

    const pRect = panelBox.getBoundingClientRect();
    const centerX = pRect.left + pRect.width / 2;
    const centerY = pRect.top + pRect.height / 2;

    let targetClientX = centerX;
    let targetClientY = centerY;

    if (clientX !== undefined && clientY !== undefined) {
      targetClientX = clientX;
      targetClientY = clientY;
    } else if (mousePosRef.current) {
      targetClientX = mousePosRef.current.clientX;
      targetClientY = mousePosRef.current.clientY;
    }

    const cursorX = targetClientX - centerX;
    const cursorY = targetClientY - centerY;
    const scaleRatio = nextScale / currentScale;

    const newPan = {
      x: currentPan.x + cursorX * (1 - scaleRatio),
      y: currentPan.y + cursorY * (1 - scaleRatio),
    };

    updateZoomAndPan(nextScale, newPan);
  };

  // Handle Ctrl + mouse wheel zoom & trackpad swipe pan centered on cursor
  useEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const zoomDelta = -e.deltaY;
        const zoomFactor = Math.exp(zoomDelta * 0.0035);
        zoomAroundCursor(zoomFactor, e.clientX, e.clientY);
      } else if (!isDrawingMode) {
        // Free panning via scroll/trackpad
        const newPan = {
          x: panRef.current.x - e.deltaX,
          y: panRef.current.y - e.deltaY,
        };
        panRef.current = newPan;
        setPanState(newPan);
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [isDrawingMode]);

  // Handle Keyboard shortcuts: CTRL+=, CTRL+-, CTRL+0, ESC, and Spacebar pan
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;

      if (isCtrl && (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd')) {
        e.preventDefault();
        zoomAroundCursor((s) => Math.min(10, +(s * 1.25).toFixed(4)));
      } else if (isCtrl && (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract')) {
        e.preventDefault();
        zoomAroundCursor((s) => Math.max(0.01, +(s / 1.25).toFixed(4)));
      } else if (isCtrl && (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0')) {
        e.preventDefault();
        updateZoomAndPan(1.0, { x: 0, y: 0 });
      } else if (e.key === 'Escape') {
        onExitExpanded();
      } else if (e.code === 'Space' && !isSpaceDown && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        setIsSpaceDown(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpaceDown(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [onExitExpanded, isSpaceDown]);

  // Two-finger touch gesture for continuous pinch-to-zoom & pan on touch devices
  const touchDataRef = useRef<{
    initialDist: number;
    initialScale: number;
    initialPan: { x: number; y: number };
    initialCenter: { x: number; y: number };
    initialPanelCenter: { x: number; y: number };
  } | null>(null);

  useEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const center = {
          x: (t0.clientX + t1.clientX) / 2,
          y: (t0.clientY + t1.clientY) / 2,
        };
        const panelBox = panelBoxRef.current;
        const pRect = panelBox ? panelBox.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
        const pCenterX = pRect.left + pRect.width / 2;
        const pCenterY = pRect.top + pRect.height / 2;

        touchDataRef.current = {
          initialDist: dist,
          initialScale: zoomScaleRef.current,
          initialPan: { ...panRef.current },
          initialCenter: center,
          initialPanelCenter: { x: pCenterX, y: pCenterY },
        };
      } else {
        touchDataRef.current = null;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && touchDataRef.current) {
        if (e.cancelable) e.preventDefault();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const center = {
          x: (t0.clientX + t1.clientX) / 2,
          y: (t0.clientY + t1.clientY) / 2,
        };
        const { initialDist, initialScale, initialPan, initialCenter, initialPanelCenter } = touchDataRef.current;

        if (initialDist > 10) {
          const scaleFactor = dist / initialDist;
          const nextScale = Math.max(0.01, Math.min(10, +(initialScale * scaleFactor).toFixed(4)));
          const scaleRatio = nextScale / initialScale;

          const cursorOffsetFromCenter = {
            x: initialCenter.x - initialPanelCenter.x,
            y: initialCenter.y - initialPanelCenter.y,
          };

          const panX = initialPan.x + (center.x - initialCenter.x) + cursorOffsetFromCenter.x * (1 - scaleRatio);
          const panY = initialPan.y + (center.y - initialCenter.y) + cursorOffsetFromCenter.y * (1 - scaleRatio);

          updateZoomAndPan(nextScale, { x: panX, y: panY });
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        touchDataRef.current = null;
      }
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  // Pointer drag panning for Space+drag, Middle-click, or empty canvas drag
  const panDragStateRef = useRef<{
    startX: number;
    startY: number;
    initialPan: { x: number; y: number };
  } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    mousePosRef.current = { clientX: e.clientX, clientY: e.clientY };
    const isBg = e.target === workspaceRef.current || (e.target as HTMLElement).dataset.workspaceBg === 'true';
    if (e.button === 1 || isSpaceDown || (isBg && !isDrawingMode)) {
      e.preventDefault();
      panDragStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        initialPan: { ...panRef.current },
      };
      setIsDraggingPan(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    mousePosRef.current = { clientX: e.clientX, clientY: e.clientY };
    if (panDragStateRef.current) {
      const dx = e.clientX - panDragStateRef.current.startX;
      const dy = e.clientY - panDragStateRef.current.startY;
      const newPan = {
        x: panDragStateRef.current.initialPan.x + dx,
        y: panDragStateRef.current.initialPan.y + dy,
      };
      panRef.current = newPan;
      setPanState(newPan);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (panDragStateRef.current) {
      panDragStateRef.current = null;
      setIsDraggingPan(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  return (
    <div
      ref={workspaceRef}
      data-workspace-bg="true"
      className={cn(
        "w-full h-full relative overflow-hidden bg-background text-foreground flex flex-col items-center select-none touch-none",
        isSpaceDown ? (isDraggingPan ? "cursor-grabbing" : "cursor-grab") : ""
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Subtle blueprint dot grid pattern */}
      <div 
        className="absolute inset-0 opacity-15 pointer-events-none" 
        style={{
          backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
          backgroundSize: '24px 24px'
        }}
        data-workspace-bg="true"
      />

      {/* Main Panel Viewport Area - touches top edge with no blank space above */}
      <div
        ref={panelAreaRef}
        className="flex-1 w-full min-h-0 relative flex items-start justify-center p-0 overflow-hidden"
        data-workspace-bg="true"
      >
        {/* Panel Box with zoom & pan transforms and visible overflow */}
        <div
          ref={panelBoxRef}
          style={{
            width: `${baseW}px`,
            height: `${baseH}px`,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomScale})`,
            transformOrigin: 'center center',
          }}
          className="relative bg-white overflow-visible border border-zinc-900 shadow-md shrink-0"
        >
          <PanelView
            node={node}
            path={path}
            onChange={onChange}
            rootTree={rootTree}
            isDrawingMode={isDrawingMode}
            drawTool={drawTool}
            drawColor={drawColor}
            drawRadius={drawRadius}
            touchOff={touchOff}
            setTouchOff={setTouchOff}
            isExpanded={true}
            hideExpandButton={true}
            onToggleExpand={onExitExpanded}
            aspectRatio={baseW / baseH}
          />
        </div>
      </div>

      {/* Floating Zoom & Controls HUD placed BELOW the panel */}
      <div 
        className="w-full shrink-0 flex items-center justify-center py-2 z-50 pointer-events-auto"
        data-workspace-bg="true"
      >
        <div className="flex items-center gap-1.5 bg-background/95 backdrop-blur-md px-3 py-1.5 shadow-md border border-border text-xs font-medium text-foreground rounded-md">
          <button
            type="button"
            onClick={() => zoomAroundCursor((s) => Math.max(0.01, +(s / 1.25).toFixed(4)))}
            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded"
            title="Zoom Out (Ctrl -)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              updateZoomAndPan(1.0, { x: 0, y: 0 });
            }}
            className="px-2 py-0.5 hover:bg-muted font-mono font-bold transition-colors cursor-pointer text-foreground rounded"
            title="Reset to Full Canvas (Ctrl 0)"
          >
            {Math.max(1, Math.round(zoomScale * 100))}%
          </button>

          <button
            type="button"
            onClick={() => zoomAroundCursor((s) => Math.min(10, +(s * 1.25).toFixed(4)))}
            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded"
            title="Zoom In (Ctrl +)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <div className="w-[1px] h-4 bg-border mx-1" />

          <button
            type="button"
            onClick={() => {
              updateZoomAndPan(1.0, { x: 0, y: 0 });
            }}
            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded"
            title="Restore Full Canvas (Ctrl 0)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <div className="w-[1px] h-4 bg-border mx-1" />

          <button
            type="button"
            onClick={onExitExpanded}
            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded"
            title={`${t("restorePanel") || "Restore Page"} (Esc)`}
          >
            <Minimize className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

