import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { Plus, Bot, Image as ImageIcon, Trash2, Contrast, Square, ArrowUp, ArrowDown, Crop, Move, Maximize, Minimize, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { ImageToolbar } from './ImageToolbar';
import { getStroke } from 'perfect-freehand';
import { useLanguage } from '@/context/LanguageContext';
import { RasterDrawingCanvas } from './comic/RasterDrawingCanvas';
import { ComicLayer, ComicLayerGroup } from './comic/drawingTypes';
import { BubbleData, SpeechBubbleRenderer } from './ComicPageRenderer';

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
  type?: 'stroke' | 'fill' | 'erase',
  layerId?: string,
  points: Point[], 
  color: string, 
  brushRadius: number, 
  fill?: string,
  imageUrl?: string,
  bounds?: {x: number, y: number, w: number, h: number},
  isFullArea?: boolean;
  smartShapeType?: string;
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
  layers?: ComicLayer[];
  layerGroups?: ComicLayerGroup[];
  activeLayerId?: string;
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

/**
 * Transforms drawing stroke coordinates when a panel is moved or resized.
 * Guarantees that strokes remain in their exact physical page positions:
 * they DO NOT contract or expand, and are ONLY covered or displayed by the panel frame.
 */
export function transformDrawingsForBounds(
  drawings: Stroke[] | undefined,
  oldBox: { x: number; y: number; w: number; h: number },
  newBox: { x: number; y: number; w: number; h: number }
): Stroke[] {
  if (!drawings || drawings.length === 0) return [];
  if (oldBox.w <= 0 || oldBox.h <= 0 || newBox.w <= 0 || newBox.h <= 0) return drawings;

  if (
    Math.abs(oldBox.x - newBox.x) < 0.0001 &&
    Math.abs(oldBox.y - newBox.y) < 0.0001 &&
    Math.abs(oldBox.w - newBox.w) < 0.0001 &&
    Math.abs(oldBox.h - newBox.h) < 0.0001
  ) {
    return drawings;
  }

  const safeNewW = Math.max(0.0001, newBox.w);
  const safeNewH = Math.max(0.0001, newBox.h);
  const scaleW = oldBox.w / safeNewW;
  const scaleH = oldBox.h / safeNewH;

  return drawings.map((s) => {
    // Stroke brush radius is specified as a percentage of panel width.
    // To preserve the exact physical stroke diameter on the page:
    // newRadius * newW === oldRadius * oldW => newRadius = oldRadius * scaleW
    const newRadius = (s.brushRadius !== undefined ? s.brushRadius : 2) * scaleW;

    if (s.type === 'fill' && s.bounds) {
      const pageX = oldBox.x + (s.bounds.x / 100) * oldBox.w;
      const pageY = oldBox.y + (s.bounds.y / 100) * oldBox.h;
      const pageW = (s.bounds.w / 100) * oldBox.w;
      const pageH = (s.bounds.h / 100) * oldBox.h;

      return {
        ...s,
        brushRadius: newRadius,
        bounds: {
          x: ((pageX - newBox.x) / safeNewW) * 100,
          y: ((pageY - newBox.y) / safeNewH) * 100,
          w: (pageW / safeNewW) * 100,
          h: (pageH / safeNewH) * 100,
        },
        points: s.points && s.points.length > 0 ? s.points.map((p) => {
          const ptPageX = oldBox.x + (p.x / 100) * oldBox.w;
          const ptPageY = oldBox.y + (p.y / 100) * oldBox.h;
          return {
            ...p,
            x: ((ptPageX - newBox.x) / safeNewW) * 100,
            y: ((ptPageY - newBox.y) / safeNewH) * 100,
          };
        }) : s.points,
      };
    }

    const newPoints = (s.points || []).map((p) => {
      const ptPageX = oldBox.x + (p.x / 100) * oldBox.w;
      const ptPageY = oldBox.y + (p.y / 100) * oldBox.h;
      return {
        ...p,
        x: ((ptPageX - newBox.x) / safeNewW) * 100,
        y: ((ptPageY - newBox.y) / safeNewH) * 100,
      };
    });

    return {
      ...s,
      brushRadius: newRadius,
      points: newPoints,
    };
  });
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


export function updateTreeFromBoxes(
  node: TreeNode,
  updatedBoxesMap: Map<string, PanelBox>
): { node: TreeNode, w: number, h: number } {
  if (node.type === 'panel') {
    const box = updatedBoxesMap.get(node.id);
    if (!box) return { node, w: 0, h: 0 };
    return { node: box.node, w: box.w, h: box.h };
  }

  const isRow = node.dir === 'row';
  const res1 = updateTreeFromBoxes(node.c1, updatedBoxesMap);
  const res2 = updateTreeFromBoxes(node.c2, updatedBoxesMap);

  let newPercent = node.percent;
  let newW = 0;
  let newH = 0;
  if (isRow) {
    newW = res1.w + res2.w;
    newH = Math.max(res1.h, res2.h);
    if (newW > 0) newPercent = (res1.w / newW) * 100;
  } else {
    newH = res1.h + res2.h;
    newW = Math.max(res1.w, res2.w);
    if (newH > 0) newPercent = (res1.h / newH) * 100;
  }

  return {
    node: {
      ...node,
      percent: newPercent,
      c1: res1.node,
      c2: res2.node,
    },
    w: newW,
    h: newH,
  };
}

export function boxesToTree(
  boxes: PanelBox[],
  bounds = { x: 0, y: 0, w: 100, h: 100 },
  path = 'root'
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
      id: `split_${path}`,
      dir: 'row',
      percent,
      c1: boxesToTree(bestCut.left, { x: bounds.x, y: bounds.y, w: bestCut.x - bounds.x, h: bounds.h }, `${path}_0`),
      c2: boxesToTree(bestCut.right, { x: bestCut.x, y: bounds.y, w: bounds.x + bounds.w - bestCut.x, h: bounds.h }, `${path}_1`),
    };
  } else if (validYCuts.length > 0) {
    const bestCut = validYCuts[0];
    const percent = Math.max(1, Math.min(99, ((bestCut.y - bounds.y) / bounds.h) * 100));
    return {
      type: 'split',
      id: `split_${path}`,
      dir: 'col',
      percent,
      c1: boxesToTree(bestCut.top, { x: bounds.x, y: bounds.y, w: bounds.w, h: bestCut.y - bounds.y }, `${path}_0`),
      c2: boxesToTree(bestCut.bottom, { x: bounds.x, y: bestCut.y, w: bounds.w, h: bounds.y + bounds.h - bestCut.y }, `${path}_1`),
    };
  }

  // Fallback if no clean cut found: split along median
  const avgX = boxes.reduce((s, b) => s + b.x + b.w / 2, 0) / boxes.length;
  const left = boxes.filter(b => b.x + b.w / 2 <= avgX);
  const right = boxes.filter(b => b.x + b.w / 2 > avgX);
  if (left.length > 0 && right.length > 0) {
    return {
      type: 'split',
      id: `split_${path}`,
      dir: 'row',
      percent: 50,
      c1: boxesToTree(left, { ...bounds, w: bounds.w / 2 }, `${path}_0`),
      c2: boxesToTree(right, { ...bounds, x: bounds.x + bounds.w / 2, w: bounds.w / 2 }, `${path}_1`),
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

export function replaceNodeById(
  node: TreeNode,
  targetId: string,
  replacement: (target: TreeNode) => TreeNode
): TreeNode {
  if (node.id === targetId) {
    return replacement(node);
  }
  if (node.type === 'split') {
    return {
      ...node,
      c1: replaceNodeById(node.c1, targetId, replacement),
      c2: replaceNodeById(node.c2, targetId, replacement),
    };
  }
  return node;
}


export function splitPanelWithDrawings(
  tree: TreeNode,
  targetPanelId: string,
  dir: Direction
): TreeNode {
  const currentBoxes = getLeafBoxes(tree);
  const targetBox = currentBoxes.find((b) => b.id === targetPanelId);

  return replacePanelById(tree, targetPanelId, (target) => {
    let updatedTarget = target;
    if (target.drawings && target.drawings.length > 0 && targetBox) {
      const newBox = {
        x: targetBox.x,
        y: targetBox.y,
        w: dir === 'row' ? targetBox.w / 2 : targetBox.w,
        h: dir === 'col' ? targetBox.h / 2 : targetBox.h,
      };
      const transformed = transformDrawingsForBounds(target.drawings, targetBox, newBox);
      updatedTarget = { ...target, drawings: transformed };
    }
    return {
      type: 'split',
      id: genId(),
      dir,
      percent: 50,
      c1: updatedTarget,
      c2: {
        type: 'panel',
        id: genId(),
      },
    };
  });
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
  penMode?: 'normal' | 'smartShape' | 'freehandBubble';
  eraserType?: 'stroke'|'pixel';
  drawColor?: string;
  drawRadius?: number;
  touchOff?: boolean;
  setTouchOff?: (val: boolean) => void;
  onExpandedChange?: (isExpanded: boolean) => void;
  layers?: ComicLayer[];
  activeLayerId?: string;
  selectedLayerIds?: string[];
  layerGroups?: ComicLayerGroup[];
  backgroundColor?: string;
  bubbles?: BubbleData[];
  onConvertFreehandBubble?: (stroke: Stroke, panelBox?: { x: number; y: number; w: number; h: number }) => void;
}

export const COMIC_PAGE_ASPECT = 3 / 4; // Height/Width = 4:3 page ratio (Width/Height = 3/4 = 0.75)

export const ComicCanvas: React.FC<ComicCanvasProps> = ({ 
  tree, 
  onChange, 
  isDrawingMode = false, 
  drawTool = 'pen', 
  penMode = 'normal',
  eraserType = 'pixel',
  drawColor = '#000000', 
  drawRadius = 2,
  touchOff = false,
  setTouchOff,
  onExpandedChange,
  layers,
  activeLayerId,
  selectedLayerIds,
  layerGroups,
  backgroundColor,
  bubbles,
  onConvertFreehandBubble,
}) => {
  const { t } = useLanguage();
  const [expandedPanelPath, setExpandedPanelPath] = useState<number[] | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [containerAspect, setContainerAspect] = useState<number>(COMIC_PAGE_ASPECT);

  useLayoutEffect(() => {
    if (!canvasContainerRef.current) return;
    const updateContainerAspect = () => {
      // Only measure container aspect when NOT in expanded panel mode to keep the 4:3 page aspect stable
      if (canvasContainerRef.current && expandedPanelPath === null) {
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
  }, [expandedPanelPath]);

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
    onChange(splitPanelWithDrawings(tree, targetPanelId, dir));
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

    // Transform drawings of all existing panels to match their new positions in newTree
    const oldBoxes = getLeafBoxes(tree);
    const oldBoxesMap = new Map(oldBoxes.map(b => [b.id, b]));
    const newBoxes = getLeafBoxes(newTree);

    let transformedTree: TreeNode = newTree;
    for (const nb of newBoxes) {
      const ob = oldBoxesMap.get(nb.id);
      if (ob && nb.node.type === 'panel' && nb.node.drawings && nb.node.drawings.length > 0) {
        if (
          Math.abs(nb.x - ob.x) > 0.0001 ||
          Math.abs(nb.y - ob.y) > 0.0001 ||
          Math.abs(nb.w - ob.w) > 0.0001 ||
          Math.abs(nb.h - ob.h) > 0.0001
        ) {
          const transformed = transformDrawingsForBounds(nb.node.drawings, ob, nb);
          transformedTree = replacePanelById(transformedTree, nb.id, (node) => ({
            ...node,
            drawings: transformed,
          }));
        }
      }
    }
    onChange(transformedTree);
  };

  return (
    <div
      ref={canvasContainerRef}
      className={cn(
        "w-full h-full relative select-none group/canvas",
        expandedNode && expandedPanelPath !== null ? "bg-background" : "bg-white"
      )}
      style={{
        backgroundColor: expandedNode && expandedPanelPath !== null ? undefined : (backgroundColor || '#ffffff'),
      }}
    >
      {expandedNode && expandedPanelPath !== null ? (
        <ExpandedPanelWorkspace
          node={expandedNode}
          path={expandedPanelPath}
          onChange={onChange}
          rootTree={tree}
          isDrawingMode={isDrawingMode}
          drawTool={drawTool}
          eraserType={eraserType}
          drawColor={drawColor}
          drawRadius={drawRadius}
          touchOff={touchOff}
          setTouchOff={setTouchOff}
          penMode={penMode}
          onConvertFreehandBubble={onConvertFreehandBubble}
          onExitExpanded={() => setExpandedPanelPath(null)}
          originalRatio={(() => {
            const box = leafBoxes.find(b => b.node.id === expandedNode.id);
            if (box && box.w > 0 && box.h > 0) {
              return (box.w / box.h) * COMIC_PAGE_ASPECT;
            }
            return COMIC_PAGE_ASPECT;
          })()}
          layers={layers}
          activeLayerId={activeLayerId}
          selectedLayerIds={selectedLayerIds}
          layerGroups={layerGroups}
          backgroundColor={backgroundColor}
          bubbles={bubbles}
          leafBoxes={leafBoxes}
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
            penMode={penMode}
            eraserType={eraserType}
            drawColor={drawColor} 
            drawRadius={drawRadius} 
            touchOff={touchOff} 
            setTouchOff={setTouchOff} 
            onExpandPanel={(p) => setExpandedPanelPath(p)}
            containerAspect={containerAspect}
            leafBoxes={leafBoxes}
            layers={layers}
            activeLayerId={activeLayerId}
            selectedLayerIds={selectedLayerIds}
            layerGroups={layerGroups}
            backgroundColor={backgroundColor}
            onConvertFreehandBubble={onConvertFreehandBubble}
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


const Resizer: React.FC<{
  node: TreeNode;
  onChange: (t: TreeNode) => void;
  rootTree: TreeNode;
  isDrawingMode: boolean;
}> = () => {
  return null;
};

const SplitView: React.FC<{ 
  node: TreeNode; 
  path: number[]; 
  onChange: (t: TreeNode) => void; 
  rootTree: TreeNode; 
  isDrawingMode: boolean; 
  drawTool: 'pen'|'erase'|'select'|'fill'; 
  penMode?: 'normal' | 'smartShape' | 'freehandBubble';
  eraserType?: 'stroke'|'pixel';
  drawColor: string; 
  drawRadius: number; 
  touchOff?: boolean;
  setTouchOff?: (val: boolean) => void;
  onExpandPanel?: (path: number[]) => void;
  containerAspect?: number;
  leafBoxes?: PanelBox[];
  layers?: ComicLayer[];
  activeLayerId?: string;
  selectedLayerIds?: string[];
  layerGroups?: ComicLayerGroup[];
  backgroundColor?: string;
  onConvertFreehandBubble?: (stroke: Stroke, panelBox?: { x: number; y: number; w: number; h: number }) => void;
}> = ({ 
  node, 
  path, 
  onChange, 
  rootTree, 
  isDrawingMode, 
  drawTool, 
  penMode = 'normal',
  eraserType = 'pixel',
  drawColor, 
  drawRadius, 
  touchOff, 
  setTouchOff, 
  onExpandPanel,
  containerAspect = 3 / 4,
  leafBoxes,
  layers,
  activeLayerId,
  selectedLayerIds,
  layerGroups,
  backgroundColor,
  onConvertFreehandBubble,
}) => {
  const boxes = leafBoxes || useMemo(() => getLeafBoxes(rootTree), [rootTree]);

  if (node.type === 'panel') {
    const box = boxes.find(b => b.node.id === node.id);
    const panelAspect = (box && box.h > 0) ? (box.w / box.h) * COMIC_PAGE_ASPECT : COMIC_PAGE_ASPECT;
    return (
      <PanelView 
        node={node} 
        path={path} 
        onChange={onChange} 
        rootTree={rootTree} 
        isDrawingMode={isDrawingMode} 
        drawTool={drawTool} 
        penMode={penMode}
        eraserType={eraserType}
        drawColor={drawColor} 
        drawRadius={drawRadius} 
        touchOff={touchOff} 
        setTouchOff={setTouchOff} 
        onExpandPanel={onExpandPanel}
        aspectRatio={panelAspect}
        panelBox={box}
        layers={layers}
        activeLayerId={activeLayerId}
        selectedLayerIds={selectedLayerIds}
        layerGroups={layerGroups}
        backgroundColor={backgroundColor}
        onConvertFreehandBubble={onConvertFreehandBubble}
      />
    );
  }

  const { dir, percent, c1, c2 } = node;

  return (
    <div className={`split-container relative flex w-full h-full min-w-0 min-h-0 ${dir === 'row' ? 'flex-row' : 'flex-col'}`}>
      <div style={{ [dir === 'row' ? 'width' : 'height']: `${percent}%` }} className="relative min-w-0 min-h-0 overflow-hidden">
        <SplitView node={c1} path={[...path, 0]} onChange={onChange} rootTree={rootTree} isDrawingMode={isDrawingMode} drawTool={drawTool} penMode={penMode} eraserType={eraserType} drawColor={drawColor} drawRadius={drawRadius} touchOff={touchOff} setTouchOff={setTouchOff} onExpandPanel={onExpandPanel} containerAspect={containerAspect} leafBoxes={boxes} layers={layers} activeLayerId={activeLayerId} selectedLayerIds={selectedLayerIds} layerGroups={layerGroups} backgroundColor={backgroundColor} onConvertFreehandBubble={onConvertFreehandBubble} />
      </div>
      
      <Resizer node={node} onChange={onChange} rootTree={rootTree} isDrawingMode={isDrawingMode} />

      <div style={{ [dir === 'row' ? 'width' : 'height']: `${100 - percent}%` }} className="relative min-w-0 min-h-0 overflow-hidden">
        <SplitView node={c2} path={[...path, 1]} onChange={onChange} rootTree={rootTree} isDrawingMode={isDrawingMode} drawTool={drawTool} penMode={penMode} eraserType={eraserType} drawColor={drawColor} drawRadius={drawRadius} touchOff={touchOff} setTouchOff={setTouchOff} onExpandPanel={onExpandPanel} containerAspect={containerAspect} leafBoxes={boxes} layers={layers} activeLayerId={activeLayerId} selectedLayerIds={selectedLayerIds} layerGroups={layerGroups} backgroundColor={backgroundColor} onConvertFreehandBubble={onConvertFreehandBubble} />
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
  const [snapIndicator, setSnapIndicator] = useState<{ x: number; y: number } | null>(null);
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
    setSnapIndicator(null);
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

      // 8px magnetic auto-snap threshold converted to container percentage
      const SNAP_PX = 8;
      const snapThreshold = isRow
        ? (SNAP_PX / Math.max(1, rect.width)) * 100
        : (SNAP_PX / Math.max(1, rect.height)) * 100;

      interface SnapCandidate {
        pos: number;
        dist: number;
        isCross: boolean;
        crossPoint: { x: number; y: number };
      }
      const snapCandidates: SnapCandidate[] = [];

      // 1. Magnetic snap to perpendicular seams (forming a 4-way "+" cross)
      for (const b of initialBoxes) {
        if (isRow) {
          const touchesTop = Math.abs((b.y + b.h) - edge.startPercent) < 2.5;
          const touchesBottom = Math.abs(b.y - edge.endPercent) < 2.5;
          if (touchesTop || touchesBottom) {
            const junctionY = touchesTop ? edge.startPercent : edge.endPercent;
            if (b.x > 1 && b.x < 99) {
              const dist = Math.abs(currentPos - b.x);
              if (dist <= snapThreshold) {
                snapCandidates.push({ pos: b.x, dist, isCross: true, crossPoint: { x: b.x, y: junctionY } });
              }
            }
            if (b.x + b.w > 1 && b.x + b.w < 99) {
              const dist = Math.abs(currentPos - (b.x + b.w));
              if (dist <= snapThreshold) {
                snapCandidates.push({ pos: b.x + b.w, dist, isCross: true, crossPoint: { x: b.x + b.w, y: junctionY } });
              }
            }
          }
        } else {
          const touchesLeft = Math.abs((b.x + b.w) - edge.startPercent) < 2.5;
          const touchesRight = Math.abs(b.x - edge.endPercent) < 2.5;
          if (touchesLeft || touchesRight) {
            const junctionX = touchesLeft ? edge.startPercent : edge.endPercent;
            if (b.y > 1 && b.y < 99) {
              const dist = Math.abs(currentPos - b.y);
              if (dist <= snapThreshold) {
                snapCandidates.push({ pos: b.y, dist, isCross: true, crossPoint: { x: junctionX, y: b.y } });
              }
            }
            if (b.y + b.h > 1 && b.y + b.h < 99) {
              const dist = Math.abs(currentPos - (b.y + b.h));
              if (dist <= snapThreshold) {
                snapCandidates.push({ pos: b.y + b.h, dist, isCross: true, crossPoint: { x: junctionX, y: b.y + b.h } });
              }
            }
          }
        }
      }

      // 2. Magnetic snap to other gutters in the same direction
      for (const other of sharedEdges) {
        if (other.id === edge.id || other.dir !== edge.dir) continue;
        const dist = Math.abs(currentPos - other.posPercent);
        if (dist <= snapThreshold) {
          const touchesSeam = Math.abs(other.endPercent - edge.startPercent) < 2.5 || Math.abs(other.startPercent - edge.endPercent) < 2.5;
          const seamCoord = Math.abs(other.endPercent - edge.startPercent) < 2.5 ? edge.startPercent : edge.endPercent;
          snapCandidates.push({
            pos: other.posPercent,
            dist,
            isCross: touchesSeam,
            crossPoint: isRow ? { x: other.posPercent, y: seamCoord } : { x: seamCoord, y: other.posPercent },
          });
        }
      }

      // 3. Magnetic snap to min / max gutter boundary limits
      if (Math.abs(clampedPos - edge.minPos) <= snapThreshold) {
        snapCandidates.push({
          pos: edge.minPos,
          dist: Math.abs(clampedPos - edge.minPos),
          isCross: false,
          crossPoint: isRow ? { x: edge.minPos, y: edge.startPercent } : { x: edge.startPercent, y: edge.minPos },
        });
      }
      if (Math.abs(clampedPos - edge.maxPos) <= snapThreshold) {
        snapCandidates.push({
          pos: edge.maxPos,
          dist: Math.abs(clampedPos - edge.maxPos),
          isCross: false,
          crossPoint: isRow ? { x: edge.maxPos, y: edge.endPercent } : { x: edge.endPercent, y: edge.maxPos },
        });
      }

      // Prioritize '+' cross junction formation first, then smallest distance
      snapCandidates.sort((a, b) => {
        if (a.isCross && !b.isCross) return -1;
        if (!a.isCross && b.isCross) return 1;
        return a.dist - b.dist;
      });

      let activeIndicator: { x: number; y: number } | null = null;
      if (snapCandidates.length > 0) {
        clampedPos = snapCandidates[0].pos;
        if (snapCandidates[0].isCross) {
          activeIndicator = snapCandidates[0].crossPoint;
        }
      }
      setSnapIndicator(activeIndicator);

      // Resize immediate neighbor panels touching this edge segment
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

        const origB = initialBoxes.find(x => x.id === b.id) || b;
        let updatedNode = b.node;
        if (
          b.node.type === 'panel' &&
          origB.node.type === 'panel' &&
          origB.node.drawings &&
          origB.node.drawings.length > 0 &&
          (Math.abs(newX - origB.x) > 0.0001 ||
           Math.abs(newY - origB.y) > 0.0001 ||
           Math.abs(newW - origB.w) > 0.0001 ||
           Math.abs(newH - origB.h) > 0.0001)
        ) {
          const transformedDrawings = transformDrawingsForBounds(
            origB.node.drawings,
            { x: origB.x, y: origB.y, w: origB.w, h: origB.h },
            { x: newX, y: newY, w: newW, h: newH }
          );
          updatedNode = { ...b.node, drawings: transformedDrawings };
        }

        return { ...b, x: newX, y: newY, w: newW, h: newH, node: updatedNode };
      });

      // Filter out small panels that collapsed (hit another gutter or boundary)
      const collapseThreshold = 1.5;
      const nonCollapsed = updatedBoxes.filter(b => b.w > collapseThreshold && b.h > collapseThreshold);
      
      let newTree;
      // If no panels collapsed, check if current tree topology matches the updated layout
      if (nonCollapsed.length === updatedBoxes.length) {
        const boxesMap = new Map(updatedBoxes.map(b => [b.id, b]));
        const candidateTree = updateTreeFromBoxes(tree, boxesMap).node;
        const candidateBoxes = getLeafBoxes(candidateTree);
        let matches = true;
        for (const ub of updatedBoxes) {
          const cb = candidateBoxes.find(x => x.id === ub.id);
          if (!cb || Math.abs(cb.x - ub.x) > 0.3 || Math.abs(cb.y - ub.y) > 0.3 || Math.abs(cb.w - ub.w) > 0.3 || Math.abs(cb.h - ub.h) > 0.3) {
            matches = false;
            break;
          }
        }
        if (matches) {
          newTree = candidateTree;
        } else {
          newTree = boxesToTree(updatedBoxes);
        }
      } else {
        const boxesToBuild = nonCollapsed.length > 0 ? nonCollapsed : updatedBoxes;
        newTree = boxesToTree(boxesToBuild);
      }
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
      setSnapIndicator(null);
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
    onChange(splitPanelWithDrawings(tree, targetPanelId, dir));
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

      {/* 4-Way (+) Cross Magnetic Snap Indicator */}
      {snapIndicator && (
        <div
          className="absolute pointer-events-none z-40 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center animate-in fade-in zoom-in-75 duration-100"
          style={{
            left: `${snapIndicator.x}%`,
            top: `${snapIndicator.y}%`,
          }}
        >
          <div className="relative flex items-center justify-center">
            <div className="absolute w-8 h-8 rounded-full bg-blue-500/25 animate-ping" />
            <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-lg border-2 border-white ring-2 ring-blue-400/50">
              <span className="text-[14px] font-extrabold leading-none select-none">+</span>
            </div>
          </div>
        </div>
      )}
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

const PanelView: React.FC<{ 
  node: PanelNode; 
  path: number[]; 
  onChange: (t: TreeNode) => void; 
  rootTree: TreeNode; 
  isDrawingMode: boolean; 
  drawTool: 'pen'|'erase'|'select'|'fill'; 
  penMode?: 'normal' | 'smartShape' | 'freehandBubble';
  eraserType?: 'stroke'|'pixel';
  drawColor: string; 
  drawRadius: number; 
  touchOff?: boolean;
  setTouchOff?: (val: boolean) => void;
  isExpanded?: boolean;
  hideExpandButton?: boolean;
  onExpandPanel?: (path: number[]) => void;
  onToggleExpand?: () => void;
  aspectRatio?: number;
  panelBox?: PanelBox;
  layers?: ComicLayer[];
  activeLayerId?: string;
  selectedLayerIds?: string[];
  layerGroups?: ComicLayerGroup[];
  backgroundColor?: string;
  onConvertFreehandBubble?: (stroke: Stroke, panelBox?: { x: number; y: number; w: number; h: number }) => void;
}> = ({ 
  node, 
  path, 
  onChange, 
  rootTree, 
  isDrawingMode, 
  drawTool, 
  penMode = 'normal',
  eraserType = 'pixel',
  drawColor, 
  drawRadius, 
  touchOff, 
  setTouchOff,
  isExpanded = false,
  hideExpandButton = false,
  onExpandPanel,
  onToggleExpand,
  aspectRatio,
  panelBox,
  layers,
  activeLayerId,
  selectedLayerIds,
  layerGroups,
  backgroundColor,
  onConvertFreehandBubble,
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
        "w-full h-full relative flex items-center justify-center overflow-hidden",
        isExpanded ? "p-0" : "p-[3px]"
      )}
      style={{ backgroundColor: isExpanded ? (node.color || backgroundColor || '#ffffff') : 'transparent' }}
      onPointerDown={handlePointerDown}
    >
      <div 
        ref={panelInnerRef}
        className={cn(
          "w-full h-full relative cursor-pointer group overflow-hidden",
          isExpanded 
            ? "border-0" 
            : "border border-zinc-900 hover:border-primary/60 dark:hover:border-primary/80"
        )}
        style={{ backgroundColor: node.color || backgroundColor || '#ffffff' }}
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
        <RasterDrawingCanvas 
          drawings={node.drawings || []} 
          onChange={handleDrawingsChange} 
          isDrawingMode={isDrawingMode} 
          drawTool={drawTool} 
          penMode={penMode}
          eraserType={eraserType}
          drawColor={drawColor} 
          drawRadius={drawRadius} 
          touchOff={touchOff} 
          setTouchOff={setTouchOff} 
          aspectRatio={aspectRatio}
          panelBox={panelBox}
          isExpanded={isExpanded}
          layers={layers}
          activeLayerId={activeLayerId}
          layerGroups={layerGroups}
          backgroundColor={backgroundColor}
          onConvertFreehandBubble={onConvertFreehandBubble}
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
  penMode?: 'normal' | 'smartShape' | 'freehandBubble';
  eraserType?: 'stroke'|'pixel';
  drawColor: string;
  drawRadius: number;
  touchOff?: boolean;
  setTouchOff?: (val: boolean) => void;
  onExitExpanded: () => void;
  originalRatio: number;
  layers?: ComicLayer[];
  activeLayerId?: string;
  selectedLayerIds?: string[];
  layerGroups?: ComicLayerGroup[];
  backgroundColor?: string;
  bubbles?: BubbleData[];
  leafBoxes?: PanelBox[];
  onConvertFreehandBubble?: (stroke: Stroke, panelBox?: { x: number; y: number; w: number; h: number }) => void;
}> = ({
  node,
  path,
  onChange,
  rootTree,
  isDrawingMode,
  drawTool,
  penMode = 'normal',
  eraserType = 'pixel',
  drawColor,
  drawRadius,
  touchOff,
  setTouchOff,
  onExitExpanded,
  originalRatio,
  layers,
  activeLayerId,
  selectedLayerIds,
  layerGroups,
  backgroundColor,
  bubbles,
  leafBoxes,
  onConvertFreehandBubble,
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

  const panelBox = useMemo(() => {
    const boxes = getLeafBoxes(rootTree);
    return boxes.find(b => b.node.id === node.id);
  }, [rootTree, node.id]);

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

      {/* Main Panel Viewport Area */}
      <div
        ref={panelAreaRef}
        className="flex-1 w-full min-h-0 relative flex items-center justify-center p-4 overflow-hidden"
        data-workspace-bg="true"
      >
        {/* Panel Box with zoom & pan transforms and consistent panel mask clipping */}
        <div
          ref={panelBoxRef}
          style={{
            width: `${baseW}px`,
            height: `${baseH}px`,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomScale})`,
            transformOrigin: 'center center',
          }}
          className="relative bg-white overflow-hidden border border-zinc-900 shadow-2xl shrink-0"
        >
          <PanelView
            node={node}
            path={path}
            onChange={onChange}
            rootTree={rootTree}
            isDrawingMode={isDrawingMode}
            drawTool={drawTool}
            penMode={penMode}
            eraserType={eraserType}
            drawColor={drawColor}
            drawRadius={drawRadius}
            touchOff={touchOff}
            setTouchOff={setTouchOff}
            isExpanded={true}
            hideExpandButton={true}
            onToggleExpand={onExitExpanded}
            aspectRatio={originalRatio}
            panelBox={panelBox}
            layers={layers}
            activeLayerId={activeLayerId}
            selectedLayerIds={selectedLayerIds}
            layerGroups={layerGroups}
            backgroundColor={backgroundColor}
            onConvertFreehandBubble={onConvertFreehandBubble}
          />

          {/* Speech Bubbles on this expanded panel - intentionally hidden per user request */}
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

