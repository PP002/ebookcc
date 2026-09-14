import { Point } from '../ComicCanvas';

export type DrawingTool = 'pen' | 'erase' | 'select' | 'fill';
export type EraserType = 'stroke' | 'pixel';

export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion';

export interface ComicLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0 to 1
  isBackground?: boolean; // Default layer is the white background
  color?: string; // Double click to change its colour
  groupId?: string | null;
  blendMode?: string;
}

export interface ComicLayerGroup {
  id: string;
  name: string;
  visible?: boolean;
  collapsed?: boolean;
}

export interface DrawingLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0 to 1
  blendMode: GlobalCompositeOperation;
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
}

export interface SerializedLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: string;
  dataUrl?: string;
}

export interface UndoStep {
  layerId: string;
  imageData: ImageData;
}

export interface ActiveStroke {
  id: string;
  tool: DrawingTool;
  color: string;
  brushRadius: number; // In page percentage units [0..100]
  points: Point[];
  panelId?: string;
  panelBounds?: { x: number; y: number; w: number; h: number };
}

export interface PanelBoundary {
  id: string;
  x: number; // 0 to 100 (%)
  y: number; // 0 to 100 (%)
  w: number; // 0 to 100 (%)
  h: number; // 0 to 100 (%)
}
