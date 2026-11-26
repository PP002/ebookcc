/**
 * videoToComic.ts
 *
 * Client-side 4-Stage "Video to Comic / Image" Keyframe Extractor (100% HTML5 <video> + <canvas>, no FFmpeg).
 *
 * Pipeline:
 * - STAGE 1 (Analysis — signatures only, no full frames in memory):
 *   Samples every 0.5 s (configurable; uses requestVideoFrameCallback when available; skips last 0.5 s).
 *   Stores compact FrameSignature per sample: timestamp, 16x16 blurred gray thumbnail, 64-bit dHash,
 *   32-bin luminance histogram, 8x8 shadow-lifted cell mean luminance, noise-robust sharpness
 *   (3x3 Gaussian blur -> 4x4 Tenengrad with foreground weighting), edge energy, and neighbor stability.
 *
 * - STAGE 2 (Candidate Pool = ALL Clear Frames + 1.5 s window compute-thinning, no count cap):
 *   A sample is CLEAR when all 4 hold:
 *   1. Not blank: on shadow-lifted frame, blank only if (p99 - p1) < 3 and edgeEnergy ~ 0.
 *   2. Sharp enough: sharpness >= max(P25 of valid samples, 0.6 * median) OR sharpest within +/-1.5 s.
 *   3. Not motion-blurred: stability <= video-adaptive threshold OR most stable within +/-1.0 s.
 *   4. Not inside a genuine dissolve/fade (high monotonic global change over <= 2.0 s; if > 3.0 s, kept as motion).
 *   Keeps the top-scoring CLEAR sample in each 1.5 s window (compute thinning only; zero count cap).
 *
 * - STAGE 3 (One Global Similarity Dedupe — Background-Weighted Leader Clustering):
 *   Distance: d = 0.35 * d_bg + 0.25 * d_hist + 0.25 * d_hash + 0.15 * d_center
 *   - d_bg: mean abs diff of 8x8 cell luminance over the OUTER ring (excluding central 40% & bottom 25%),
 *           divided by the video's noise floor.
 *   - d_hist: 1 - 32-bin luminance histogram correlation.
 *   - d_hash: normalized Hamming distance of 64-bit dHash.
 *   - d_center: normalized diff of the central 40% zone.
 *   Global two-pass leader clustering ordered by compositeScore (highest first), with second-pass representative
 *   merging so any recurring shot later in the video is merged into the same cluster.
 *   simThreshold calibrated from video's median consecutive CLEAR distance S inside stable stretches:
 *   Loose = 3.5 * S (fewer frames), Balanced = 2.0 * S, Strict = 1.2 * S (more frames), plus numeric override.
 *
 * - STAGE 4 (Final Full-Resolution Capture with Same-Cluster Fallback):
 *   Seeks only to chosen cluster representative timestamps, waits for 'seeked' + presented frame,
 *   captures full resolution, and verifies non-blank & sharpness floor (falling back to the next-best
 *   frame in the same cluster if needed).
 */

import { TreeNode, createGridTree } from '@/components/ComicCanvas';

// ============================================================================
// CENTRALIZED CONFIGURATION OBJECT (All thresholds live here)
// ============================================================================

export type SimilarityStrictness = 'loose' | 'balanced' | 'strict';

export const VIDEO_TO_COMIC_CONFIG = {
  // Stage 1: Sampling & Analysis Canvas
  sampling: {
    defaultStepSeconds: 0.5, // Sample every 0.5 s
    skipTailSeconds: 0.5, // Skip the last 0.5 s of video
    maxAnalysisSamples: 4500, // Supports 35+ min at 0.5s without memory pressure (signatures only)
    analysisCanvasWidth: 320,
    contactSheetThumbWidth: 96,
    contactSheetThumbHeight: 54,
    contactSheetJpegQuality: 0.64,
  },

  // Stage 1: Shadow-Lift for Dark Content
  shadowLift: {
    darkMeanThreshold: 105, // Apply shadow lift when frame mean luma is dark/dim
    gammaFloor: 0.62, // Lifts dark shadows smoothly without blowing out highlights
    p01Target: 0.01,
    p99Target: 0.99,
  },

  // Stage 2: Clear Frame Filtering & 1.5s Window Thinning
  clearFilter: {
    // 1. Blank rejection: blank ONLY if (p99 - p1) < 3 AND edgeEnergy < blankMaxEdgeEnergy
    blankMinDynamicSpan: 3.0,
    blankMaxEdgeEnergy: 0.85,
    // 2. Sharpness check: sharpness >= max(P25, 0.6 * median) OR local peak within +/- 1.5s
    sharpnessMedianMultiplier: 0.60,
    sharpnessPercentile: 0.25,
    localSharpestWindowSec: 1.5, // +/- 1.5 s
    // 3. Motion-blur check: stability <= adaptive threshold OR most stable within +/- 1.0s
    stabilityMadMultiplier: 2.8,
    stabilityPercentileFallback: 0.82,
    localMostStableWindowSec: 1.0, // +/- 1.0 s
    // 4. Dissolve / fade rejection: high monotonic global change lasting <= 2.0s (if > 3.0s, keep as motion)
    transitionStepMadMultiplier: 2.5,
    transitionMinStepDiff: 5.5,
    transitionMaxDurationSec: 2.0,
    motionKeepDurationSec: 3.0,
    transitionMonotonicRatio: 0.72,
    // Compute thinning window (no count cap)
    thinningWindowSec: 1.5,
  },

  // Stage 2 & 3: Composite Quality Score Weights
  scoring: {
    sharpnessTopRegionsCount: 6, // Top 6 of 16 (4x4) cells
    sharpnessTopRegionsWeight: 0.68,
    sharpnessGlobalWeight: 0.32,
    weightRelativeSharpness: 0.38,
    weightStability: 0.28,
    weightCenterSubject: 0.20,
    weightNotTransition: 0.10,
    weightSubtitleBonus: 0.04, // Small bonus when subtitle is crisp & stable
  },

  // Stage 3: Background-Weighted Global Similarity Distance & Leader Clustering
  similarity: {
    weightBg: 0.35,
    weightHist: 0.25,
    weightHash: 0.25,
    weightCenter: 0.15,
    // Calibration of baseline S (median consecutive CLEAR distance inside stable stretches)
    stableStretchPercentileCutoff: 0.75,
    minBaselineS: 0.042,
    maxBaselineS: 0.24,
    // Strictness multipliers applied to S:
    // Loose = 3.5 * S (fewer frames), Balanced = 2.0 * S, Strict = 1.2 * S (more frames)
    strictnessMultipliers: {
      loose: 3.5,
      balanced: 2.0,
      strict: 1.2,
    },
    // Scale factor mapping outer-ring noise ratio (raw_d_bg / noiseFloor) onto [0..1] scale
    bgNoiseRatioScale: 0.16,
    centerDiffNormScale: 55.0,
    minNoiseFloorLuma: 2.2,
  },

  // Optional Subtitle Protection (Default OFF)
  subtitle: {
    protectSubtitlesDefault: false,
    bandTopRatio: 0.75,
    bandBottomRatio: 0.96,
    bandLeftRatio: 0.10,
    bandRightRatio: 0.90,
    gridCols: 16,
    gridRows: 4, // 64-bit text mask
    brightContrastOffset: 26,
    minEdgeGradient: 16,
    cellActivePixelRatio: 0.085,
    minActiveBitsForSubtitle: 3,
    minBlankGapSampleRatio: 0.15, // Subtitle band must be blank in >= 15% of samples to be valid
    hammingNewSubtitleThreshold: 10,
    minStableDurationSec: 0.80, // Must stay stable for >= 0.8 s
    stabilityMaxHamming: 5,
  },
};

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type ClearRejectReason =
  | 'CLEAR'
  | 'BLANK'
  | 'TOO_BLURRY'
  | 'MOTION_BLUR'
  | 'TRANSITION';

export type CandidateDecisionCode =
  | 'KEPT'
  | 'DUP_CLUSTER'
  | 'BLANK'
  | 'TOO_BLURRY'
  | 'MOTION_BLUR'
  | 'TRANSITION';

export interface CandidateDebugRecord {
  sampleIndex: number;
  timestamp: number;
  isClear: boolean;
  rejectReason: ClearRejectReason;
  passedWindowThinning: boolean;
  clusterId: number | null;
  distanceToRep: number | null;
  isClusterRep: boolean;
  kept: boolean;
  decisionCode: CandidateDecisionCode;
  decisionDetail: string;
  // Stage 1 & 2 metrics
  rawSharpness: number;
  relativeSharpness: number;
  edgeEnergy: number;
  p99MinusP1: number;
  stability: number; // Neighbor diff (lower = more stable)
  stabilityScore: number; // 0..1 (higher = more stable)
  centerSubjectScore: number;
  compositeScore: number;
  // Distance components to cluster representative
  dBg: number | null;
  dHist: number | null;
  dHash: number | null;
  dCenter: number | null;
  // Subtitle diagnostics
  subtitleActiveBits: number;
  subtitleStable: boolean;
  // Contact sheet thumbnail (96x54 JPEG dataUrl)
  previewDataUrl?: string;
}

export interface ClusterSummaryRecord {
  clusterId: number;
  repSampleIndex: number;
  repTimestamp: number;
  repScore: number;
  memberCount: number;
  memberSampleIndices: number[]; // Ordered by compositeScore descending (for Stage 4 fallback)
  previewDataUrl?: string;
}

export interface VideoExtractionDebugReport {
  durationSec: number;
  sampleStepSec: number;
  totalSamples: number;
  clearCount: number;
  windowCandidateCount: number;
  clusterCount: number;
  keptCount: number;
  rejectedCount: number;
  noiseFloorOuterBg: number;
  baselineS: number;
  simThreshold: number;
  simThresholdOverride: number | null;
  strictness: SimilarityStrictness;
  protectSubtitles: boolean;
  subtitleTrackValidated: boolean;
  subtitleBlankRatio: number;
  sharpnessFloor: number;
  motionBlurThreshold: number;
  clusters: ClusterSummaryRecord[];
  candidates: CandidateDebugRecord[];
}

export interface FrameSignature {
  sampleIndex: number;
  timestamp: number;
  /** 16x16 blurred grayscale thumbnail (256 bytes) */
  thumb16: Uint8Array;
  /** 64-bit horizontal gradient dHash (64 bytes of 0/1) */
  dHash: Uint8Array;
  /** 32-bin normalized luminance histogram (32 floats summing to 1) */
  lumaHist32: Float32Array;
  /** 64-bin normalized luminance histogram (kept for compatibility) */
  lumaHist64: Float32Array;
  /** 64-bin RGB color histogram (kept for compatibility) */
  colorHist: Float32Array;
  /** 8x8 shadow-lifted cell mean luminance (64 floats, 0..255) */
  cellLuma8x8: Float32Array;
  /** 8x8 average RGB (192 floats, kept for compatibility) */
  blockRgb: Float32Array;
  /** Noise-robust sharpness (3x3 Gaussian blur -> 4x4 Tenengrad with foreground weighting) */
  sharpness: number;
  /** Mean edge gradient energy on shadow-lifted blurred frame */
  edgeEnergy: number;
  /** Difference to both temporal neighbors on 8x8 cell luminance (lower = more stable) */
  stability: number;
  /** Forward step difference to previous frame on 8x8 cell luminance */
  stepDiff: number;
  /** Signed luminance drift from previous frame (used for monotonic dissolve/fade detection) */
  signedStepDrift: number;
  /** Central 40% subject gradient energy ratio (0..1) */
  centerSubjectRatio: number;
  /** 1st percentile luminance on shadow-lifted frame */
  p1Luma: number;
  /** 99th percentile luminance on shadow-lifted frame */
  p99Luma: number;
  /** Dynamic range (p99 - p1) on shadow-lifted frame */
  p99MinusP1: number;
  /** Raw mean luminance (0..255) */
  meanLuma: number;
  /** Raw luminance std dev */
  stdLuma: number;
  /** 64-bit subtitle binary text mask (16x4) */
  subtitleMask: Uint8Array;
  /** Active bit count in subtitleMask (0..64) */
  subtitleActiveBits: number;
  /** Whether frame is blank ((p99 - p1) < 3 and edgeEnergy ~ 0) */
  isPureColor: boolean;
  /** Tiny 96x54 JPEG thumbnail for Debug Panel & Contact Sheet */
  previewDataUrl?: string;
}

export interface CachedAnalysisSession {
  durationSec: number;
  sampleStepSec: number;
  videoWidth: number;
  videoHeight: number;
  signatures: FrameSignature[];
}

export interface VideoToComicOptions {
  /** Sample interval in seconds for Stage 1 (default: 0.5) */
  stepSeconds?: number;
  /** Legacy compatibility options */
  sceneThreshold?: number;
  minSceneInterval?: number;
  /** Similarity strictness preset: 'loose' | 'balanced' | 'strict' (default: 'balanced') */
  strictness?: SimilarityStrictness;
  /** Advanced numeric override for simThreshold (optional) */
  simThresholdOverride?: number | null;
  /** Optional subtitle protection (default: false) */
  protectSubtitles?: boolean;
  /** Target image format for Stage 4 full-res capture (default: 'image/jpeg') */
  imageFormat?: 'image/jpeg' | 'image/png' | 'image/webp';
  /** Image quality (0 to 1, default: 0.88) */
  imageQuality?: number;
  /** Capture 96x54 thumbnails for debug contact sheet (default: true) */
  includeDebugThumbnails?: boolean;
  /** Callback receiving the cached Stage 1 signatures so UI can re-run Stage 3 instantaneously */
  onAnalysisCached?: (session: CachedAnalysisSession) => void;
  /** Callback receiving the full Stage 2 + Stage 3 debug report */
  onDebugReport?: (report: VideoExtractionDebugReport) => void;
  /** Progress callback */
  onProgress?: (progress: VideoProcessingProgress) => void;
  /** Cancellation check callback */
  isCancelled?: () => boolean;
}

export interface VideoProcessingProgress {
  phase: 'init' | 'scanning' | 'refining' | 'extracting' | 'complete' | 'error';
  percent: number;
  statusText: string;
  currentTime?: number;
  totalDuration?: number;
  candidatesFound?: number;
  currentStep?: number;
  totalSteps?: number;
}

export interface ExtractedKeyframe {
  timestamp: number;
  dataUrl: string;
  blob: Blob;
  sharpnessScore: number;
  compositeScore?: number;
  clusterId?: number;
  decisionCode?: CandidateDecisionCode;
  index: number;
}

export interface ComicPageData {
  id: string;
  tree: TreeNode;
  bubbles: any[];
  title?: string;
}

// ============================================================================
// OUTER RING & CENTRAL 40% CELL MASKS ON 8x8 GRID
// ============================================================================

/**
 * 8x8 grid region partition:
 * - Bottom 25% subtitle band: rows 6..7 (16 cells) -> excluded from outer background
 * - Central ~40% subject zone: rows 2..5, cols 2..5 (16 cells) -> used for d_center
 * - OUTER ring (background): rows 0..1 (all cols 0..7) + rows 2..5 (cols 0..1 and 6..7) (32 cells) -> used for d_bg
 */
const OUTER_RING_CELL_INDICES: number[] = [];
const CENTER_ZONE_CELL_INDICES: number[] = [];

for (let r = 0; r < 8; r++) {
  for (let c = 0; c < 8; c++) {
    const idx = (r << 3) | c;
    if (r >= 6) {
      // Bottom 25% band (excluded from d_bg and d_center)
      continue;
    }
    if (r >= 2 && r <= 5 && c >= 2 && c <= 5) {
      CENTER_ZONE_CELL_INDICES.push(idx);
    } else {
      OUTER_RING_CELL_INDICES.push(idx);
    }
  }
}

// ============================================================================
// MATH & SIGNAL PROCESSING UTILITIES
// ============================================================================

export function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) * 0.5
    : sorted[mid];
}

export function computePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(p * (sorted.length - 1)))
  );
  return sorted[idx];
}

export function computeBinaryHamming(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  let dist = 0;
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) dist++;
  }
  return dist;
}

export function computeHistogramCorrelation(
  histA: Float32Array,
  histB: Float32Array
): number {
  const n = Math.min(histA.length, histB.length);
  if (n === 0) return 1;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += histA[i];
    meanB += histB[i];
  }
  meanA /= n;
  meanB /= n;

  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = histA[i] - meanA;
    const db = histB[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const denom = Math.sqrt(denA * denB);
  if (denom < 1e-8) return 1;
  return Math.max(-1, Math.min(1, num / denom));
}

export function computeFrameDifference(
  dataA: Uint8ClampedArray,
  dataB: Uint8ClampedArray
): number {
  if (dataA.length !== dataB.length || dataA.length === 0) return 0;
  let totalDiff = 0;
  const numPixels = dataA.length / 4;
  for (let i = 0; i < dataA.length; i += 4) {
    const diffR = Math.abs(dataA[i] - dataB[i]);
    const diffG = Math.abs(dataA[i + 1] - dataB[i + 1]);
    const diffB = Math.abs(dataA[i + 2] - dataB[i + 2]);
    totalDiff += (diffR + diffG + diffB) / 3;
  }
  return totalDiff / numPixels;
}

/**
 * Fast 3x3 Gaussian blur `[1,2,1; 2,4,2; 1,2,1] / 16` to suppress sensor noise & compression grain.
 */
function blurGrayscale3x3(
  gray: Float32Array,
  width: number,
  height: number
): Float32Array {
  const out = new Float32Array(width * height);
  if (width < 3 || height < 3) {
    out.set(gray);
    return out;
  }

  for (let x = 0; x < width; x++) {
    out[x] = gray[x];
    out[(height - 1) * width + x] = gray[(height - 1) * width + x];
  }
  for (let y = 0; y < height; y++) {
    out[y * width] = gray[y * width];
    out[y * width + (width - 1)] = gray[y * width + (width - 1)];
  }

  for (let y = 1; y < height - 1; y++) {
    const rPrev = (y - 1) * width;
    const rCurr = y * width;
    const rNext = (y + 1) * width;
    for (let x = 1; x < width - 1; x++) {
      const sum =
        gray[rPrev + x - 1] +
        2 * gray[rPrev + x] +
        gray[rPrev + x + 1] +
        2 * gray[rCurr + x - 1] +
        4 * gray[rCurr + x] +
        2 * gray[rCurr + x + 1] +
        gray[rNext + x - 1] +
        2 * gray[rNext + x] +
        gray[rNext + x + 1];
      out[rCurr + x] = sum * 0.0625;
    }
  }
  return out;
}

/**
 * Shadow-lifts dark content so dark indoor/night frames have recoverable detail,
 * and computes p1 and p99 on the shadow-lifted frame for blank detection ((p99 - p1) < 3).
 */
function shadowLiftAndPercentiles(
  blurredGray: Float32Array,
  width: number,
  height: number,
  meanLuma: number
): { lifted: Float32Array; p1: number; p99: number } {
  const n = blurredGray.length;
  const lifted = new Float32Array(n);
  const { darkMeanThreshold, gammaFloor, p01Target, p99Target } =
    VIDEO_TO_COMIC_CONFIG.shadowLift;

  // Compute adaptive shadow-lifting gamma (< 1.0 when dark, 1.0 when bright)
  const needLift = meanLuma > 1.5 && meanLuma < darkMeanThreshold;
  const gamma = needLift
    ? Math.max(
        gammaFloor,
        1.0 - ((darkMeanThreshold - meanLuma) / darkMeanThreshold) * (1.0 - gammaFloor)
      )
    : 1.0;

  // Lookup table for fast gamma lift on 0..255
  const lut = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    lut[v] = gamma < 0.999 ? 255 * Math.pow(v / 255, gamma) : v;
  }

  const hist = new Int32Array(256);
  const marginX = Math.max(1, Math.floor(width * 0.04));
  const marginY = Math.max(1, Math.floor(height * 0.04));
  let activeCount = 0;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    const inY = y >= marginY && y < height - marginY;
    for (let x = 0; x < width; x++) {
      const idx = row + x;
      const rawVal = Math.max(0, Math.min(255, Math.round(blurredGray[idx])));
      const liftedVal = lut[rawVal];
      lifted[idx] = liftedVal;

      if (inY && x >= marginX && x < width - marginX) {
        const bin = Math.max(0, Math.min(255, Math.round(liftedVal)));
        hist[bin]++;
        activeCount++;
      }
    }
  }

  if (activeCount === 0) {
    return { lifted, p1: 0, p99: 0 };
  }

  const target01 = Math.max(1, Math.floor(activeCount * p01Target));
  const target99 = Math.max(1, Math.floor(activeCount * p99Target));
  let cum = 0;
  let p1 = 0;
  let p99 = 0;
  let found01 = false;

  for (let b = 0; b < 256; b++) {
    cum += hist[b];
    if (!found01 && cum >= target01) {
      p1 = b;
      found01 = true;
    }
    if (cum >= target99) {
      p99 = b;
      break;
    }
  }

  return { lifted, p1, p99 };
}

/**
 * Noise-robust sharpness (Tenengrad on a 4x4 grid after 3x3 Gaussian blur,
 * weighted 68% top-6 regions + 32% global) plus edgeEnergy and centerSubjectRatio.
 */
function computeTenengradAndEdgeEnergy(
  liftedGray: Float32Array,
  width: number,
  height: number
): {
  sharpness: number;
  edgeEnergy: number;
  centerSubjectRatio: number;
  strongEdgeRatio: number;
} {
  if (width < 8 || height < 8) {
    return {
      sharpness: 0,
      edgeEnergy: 0,
      centerSubjectRatio: 0.5,
      strongEdgeRatio: 0,
    };
  }

  const marginX = Math.max(2, Math.floor(width * 0.05));
  const marginY = Math.max(2, Math.floor(height * 0.05));
  const startX = marginX;
  const endX = width - marginX;
  const startY = marginY;
  const endY = height - marginY;
  const activeW = Math.max(1, endX - startX);
  const activeH = Math.max(1, endY - startY);

  const gridCols = 4;
  const gridRows = 4;
  const numCells = gridCols * gridRows;
  const cellTenengradSum = new Float32Array(numCells);
  const cellCounts = new Int32Array(numCells);

  let globalTenengradSum = 0;
  let edgeMagSum = 0;
  let strongEdgeCount = 0;
  let centerEnergySum = 0;
  let centerCount = 0;
  let outerEnergySum = 0;
  let outerCount = 0;
  let totalCount = 0;

  for (let y = startY; y < endY; y++) {
    const rPrev = (y - 1) * width;
    const rCurr = y * width;
    const rNext = (y + 1) * width;
    const cy = Math.min(
      gridRows - 1,
      Math.floor(((y - startY) * gridRows) / activeH)
    );

    for (let x = startX; x < endX; x++) {
      const cx = Math.min(
        gridCols - 1,
        Math.floor(((x - startX) * gridCols) / activeW)
      );
      const cellIdx = cy * gridCols + cx;

      // Sobel 3x3 operators
      const gx =
        -liftedGray[rPrev + x - 1] +
        liftedGray[rPrev + x + 1] -
        2 * liftedGray[rCurr + x - 1] +
        2 * liftedGray[rCurr + x + 1] -
        liftedGray[rNext + x - 1] +
        liftedGray[rNext + x + 1];

      const gy =
        -liftedGray[rPrev + x - 1] -
        2 * liftedGray[rPrev + x] -
        liftedGray[rPrev + x + 1] +
        liftedGray[rNext + x - 1] +
        2 * liftedGray[rNext + x] +
        liftedGray[rNext + x + 1];

      const gradMag = Math.sqrt(gx * gx + gy * gy) * 0.25;
      edgeMagSum += gradMag;

      const tenengrad = gradMag > 3.0 ? gradMag * gradMag : 0;
      globalTenengradSum += tenengrad;
      cellTenengradSum[cellIdx] += tenengrad;
      cellCounts[cellIdx]++;
      totalCount++;

      if (gradMag > 12) {
        strongEdgeCount++;
      }

      if (cy >= 1 && cy <= 2 && cx >= 1 && cx <= 2) {
        centerEnergySum += gradMag;
        centerCount++;
      } else {
        outerEnergySum += gradMag;
        outerCount++;
      }
    }
  }

  if (totalCount === 0) {
    return {
      sharpness: 0,
      edgeEnergy: 0,
      centerSubjectRatio: 0.5,
      strongEdgeRatio: 0,
    };
  }

  const globalMean = globalTenengradSum / totalCount;
  const edgeEnergy = edgeMagSum / totalCount;

  const cellMeans: number[] = [];
  for (let i = 0; i < numCells; i++) {
    if (cellCounts[i] > 0) {
      cellMeans.push(cellTenengradSum[i] / cellCounts[i]);
    }
  }
  cellMeans.sort((a, b) => b - a);

  const topK = Math.min(
    VIDEO_TO_COMIC_CONFIG.scoring.sharpnessTopRegionsCount,
    cellMeans.length
  );
  let topSum = 0;
  for (let k = 0; k < topK; k++) {
    topSum += cellMeans[k];
  }
  const topMean = topK > 0 ? topSum / topK : globalMean;

  const sharpness =
    VIDEO_TO_COMIC_CONFIG.scoring.sharpnessTopRegionsWeight * topMean +
    VIDEO_TO_COMIC_CONFIG.scoring.sharpnessGlobalWeight * globalMean;

  const centerMean = centerCount > 0 ? centerEnergySum / centerCount : 0;
  const outerMean = outerCount > 0 ? outerEnergySum / outerCount : 0;
  const centerSubjectRatio =
    centerMean + outerMean > 0.001
      ? Math.min(1, centerMean / (centerMean + outerMean * 0.85))
      : 0.5;

  return {
    sharpness,
    edgeEnergy,
    centerSubjectRatio,
    strongEdgeRatio: strongEdgeCount / totalCount,
  };
}

/**
 * Computes a 64-bit binary text mask for the lower 25% subtitle band (used only as a scoring bonus
 * and optional validated subtitle protection).
 */
function computeSubtitleBinaryMask(
  blurredGray: Float32Array,
  width: number,
  height: number
): { mask: Uint8Array; activeBits: number } {
  const {
    bandTopRatio,
    bandBottomRatio,
    bandLeftRatio,
    bandRightRatio,
    gridCols,
    gridRows,
    brightContrastOffset,
    minEdgeGradient,
    cellActivePixelRatio,
  } = VIDEO_TO_COMIC_CONFIG.subtitle;

  const mask = new Uint8Array(gridCols * gridRows);
  if (width < 16 || height < 16) {
    return { mask, activeBits: 0 };
  }

  const yStart = Math.max(1, Math.floor(height * bandTopRatio));
  const yEnd = Math.min(height - 1, Math.floor(height * bandBottomRatio));
  const xStart = Math.max(1, Math.floor(width * bandLeftRatio));
  const xEnd = Math.min(width - 1, Math.floor(width * bandRightRatio));
  const bandW = Math.max(1, xEnd - xStart);
  const bandH = Math.max(1, yEnd - yStart);

  let activeBits = 0;

  for (let ry = 0; ry < gridRows; ry++) {
    const cy0 = yStart + Math.floor((ry * bandH) / gridRows);
    const cy1 = Math.max(cy0 + 1, yStart + Math.floor(((ry + 1) * bandH) / gridRows));

    for (let rx = 0; rx < gridCols; rx++) {
      const cx0 = xStart + Math.floor((rx * bandW) / gridCols);
      const cx1 = Math.max(cx0 + 1, xStart + Math.floor(((rx + 1) * bandW) / gridCols));

      let lumaSum = 0;
      let minLuma = 255;
      let pixCount = 0;
      for (let y = cy0; y < cy1; y++) {
        const row = y * width;
        for (let x = cx0; x < cx1; x++) {
          const val = blurredGray[row + x];
          lumaSum += val;
          if (val < minLuma) minLuma = val;
          pixCount++;
        }
      }
      if (pixCount === 0) continue;
      const meanBg = lumaSum / pixCount;
      const bgRef = 0.65 * meanBg + 0.35 * minLuma;

      let textPixelCount = 0;
      for (let y = cy0; y < cy1; y++) {
        const row = y * width;
        for (let x = cx0; x < cx1; x++) {
          const val = blurredGray[row + x];
          const gx = Math.abs(blurredGray[row + x + 1] - blurredGray[row + x - 1]);
          const gy = Math.abs(blurredGray[row + width + x] - blurredGray[row - width + x]);
          const grad = Math.max(gx, gy);

          if (
            (val - bgRef >= brightContrastOffset && grad >= minEdgeGradient) ||
            (val >= 180 && minLuma <= 65 && grad >= minEdgeGradient * 1.15)
          ) {
            textPixelCount++;
          }
        }
      }

      const bitIdx = ry * gridCols + rx;
      if (textPixelCount / pixCount >= cellActivePixelRatio) {
        mask[bitIdx] = 1;
        activeBits++;
      }
    }
  }

  return { mask, activeBits };
}

/**
 * Checks whether an ImageData frame is blank:
 * Judged on the shadow-lifted frame; blank ONLY if (p99 - p1) < 3 and edge energy is about 0.
 */
export function isPureColorFrame(imageData: ImageData): boolean {
  const { width, height, data } = imageData;
  if (width < 8 || height < 8) return true;

  const rawGray = new Float32Array(width * height);
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    rawGray[p] = l;
    sum += l;
  }
  const meanLuma = rawGray.length > 0 ? sum / rawGray.length : 0;
  const blurred = blurGrayscale3x3(rawGray, width, height);
  const { lifted, p1, p99 } = shadowLiftAndPercentiles(blurred, width, height, meanLuma);
  const { edgeEnergy } = computeTenengradAndEdgeEnergy(lifted, width, height);

  return (
    p99 - p1 < VIDEO_TO_COMIC_CONFIG.clearFilter.blankMinDynamicSpan &&
    edgeEnergy < VIDEO_TO_COMIC_CONFIG.clearFilter.blankMaxEdgeEnergy
  );
}

export function computeSharpnessAnalysis(imageData: ImageData): {
  score: number;
  strongEdgeRatio: number;
  acutance: number;
  isBlurry: boolean;
} {
  const { width, height, data } = imageData;
  if (width < 8 || height < 8) {
    return { score: 0, strongEdgeRatio: 0, acutance: 0, isBlurry: true };
  }
  const gray = new Float32Array(width * height);
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = l;
    sum += l;
  }
  const blurred = blurGrayscale3x3(gray, width, height);
  const { lifted } = shadowLiftAndPercentiles(
    blurred,
    width,
    height,
    sum / Math.max(1, gray.length)
  );
  const res = computeTenengradAndEdgeEnergy(lifted, width, height);
  return {
    score: res.sharpness,
    strongEdgeRatio: res.strongEdgeRatio,
    acutance: Math.min(2.0, Math.sqrt(res.sharpness) / 12),
    isBlurry: res.sharpness < 2.0 && res.edgeEnergy < 0.85,
  };
}

export function computeLaplacianVariance(imageData: ImageData): number {
  return computeSharpnessAnalysis(imageData).score;
}

/**
 * STAGE 1: Extracts a compact FrameSignature from a 320px analysis canvas frame.
 */
export function computeFrameSignature(
  imageData: ImageData,
  timestamp = 0,
  previewDataUrl?: string,
  sampleIndex = 0
): FrameSignature {
  const { width, height, data } = imageData;
  const numPixels = width * height;
  const rawGray = new Float32Array(numPixels);
  let totalRawLuma = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    rawGray[p] = l;
    totalRawLuma += l;
  }
  const meanLuma = numPixels > 0 ? totalRawLuma / numPixels : 0;

  // 1. 3x3 Gaussian blur to suppress sensor noise & compression grain
  const blurredGray = blurGrayscale3x3(rawGray, width, height);

  // 2. Shadow-lift for dark content + p1/p99 percentiles
  const { lifted: liftedGray, p1: p1Luma, p99: p99Luma } = shadowLiftAndPercentiles(
    blurredGray,
    width,
    height,
    meanLuma
  );
  const p99MinusP1 = Math.max(0, p99Luma - p1Luma);

  const marginX = Math.max(1, Math.floor(width * 0.04));
  const marginY = Math.max(1, Math.floor(height * 0.04));
  const activeW = Math.max(1, width - 2 * marginX);
  const activeH = Math.max(1, height - 2 * marginY);

  // 3. 16x16 blurred gray thumbnail
  const thumb16 = new Uint8Array(256);
  for (let ty = 0; ty < 16; ty++) {
    const y0 = marginY + Math.floor((ty * activeH) / 16);
    const y1 = Math.max(y0 + 1, marginY + Math.floor(((ty + 1) * activeH) / 16));
    for (let tx = 0; tx < 16; tx++) {
      const x0 = marginX + Math.floor((tx * activeW) / 16);
      const x1 = Math.max(x0 + 1, marginX + Math.floor(((tx + 1) * activeW) / 16));
      let sum = 0;
      let cnt = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) {
          sum += liftedGray[row + x];
          cnt++;
        }
      }
      thumb16[ty * 16 + tx] = cnt > 0 ? Math.max(0, Math.min(255, Math.round(sum / cnt))) : 0;
    }
  }

  // 4. 8x8 shadow-lifted cell mean luminance + 32-bin luminance histogram
  const gridCols = 8;
  const gridRows = 8;
  const cellLuma8x8 = new Float32Array(64);
  const blockRgb = new Float32Array(64 * 3);
  const lumaHist32 = new Float32Array(32);
  const lumaHist64 = new Float32Array(64);
  const colorHist = new Float32Array(64);
  let histCount = 0;

  for (let by = 0; by < gridRows; by++) {
    const y0 = marginY + Math.floor((by * activeH) / gridRows);
    const y1 = Math.max(y0 + 1, marginY + Math.floor(((by + 1) * activeH) / gridRows));

    for (let bx = 0; bx < gridCols; bx++) {
      const x0 = marginX + Math.floor((bx * activeW) / gridCols);
      const x1 = Math.max(x0 + 1, marginX + Math.floor(((bx + 1) * activeW) / gridCols));

      let cellSum = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let bCount = 0;

      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) {
          const p = row + x;
          const idx = p * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const lv = liftedGray[p];

          cellSum += lv;
          rSum += r;
          gSum += g;
          bSum += b;
          bCount++;

          const bin32 = Math.min(31, Math.max(0, lv >> 3));
          lumaHist32[bin32] += 1;

          const bin64 = Math.min(63, Math.max(0, lv >> 2));
          lumaHist64[bin64] += 1;

          const rBin = Math.min(3, r >> 6);
          const gBin = Math.min(3, g >> 6);
          const bBin = Math.min(3, b >> 6);
          colorHist[(rBin << 4) | (gBin << 2) | bBin] += 1;
          histCount++;
        }
      }

      const cellIdx = (by << 3) | bx;
      if (bCount > 0) {
        cellLuma8x8[cellIdx] = cellSum / bCount;
        blockRgb[cellIdx * 3] = rSum / bCount;
        blockRgb[cellIdx * 3 + 1] = gSum / bCount;
        blockRgb[cellIdx * 3 + 2] = bSum / bCount;
      }
    }
  }

  if (histCount > 0) {
    for (let i = 0; i < 32; i++) lumaHist32[i] /= histCount;
    for (let i = 0; i < 64; i++) {
      lumaHist64[i] /= histCount;
      colorHist[i] /= histCount;
    }
  }

  let lumaVar = 0;
  for (let i = 0; i < 64; i++) {
    const dl = cellLuma8x8[i] - meanLuma;
    lumaVar += dl * dl;
  }
  const stdLuma = Math.sqrt(lumaVar / 64);

  // 5. 64-bit dHash on 9x8 shadow-lifted blurred grid
  const dHashCols = 9;
  const dHashGrid = new Float32Array(dHashCols * gridRows);
  for (let by = 0; by < gridRows; by++) {
    const y0 = marginY + Math.floor((by * activeH) / gridRows);
    const y1 = Math.max(y0 + 1, marginY + Math.floor(((by + 1) * activeH) / gridRows));
    for (let bx = 0; bx < dHashCols; bx++) {
      const x0 = marginX + Math.floor((bx * activeW) / dHashCols);
      const x1 = Math.max(x0 + 1, marginX + Math.floor(((bx + 1) * activeW) / dHashCols));
      let lSum = 0;
      let cnt = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) {
          lSum += liftedGray[row + x];
          cnt++;
        }
      }
      dHashGrid[by * dHashCols + bx] = cnt > 0 ? lSum / cnt : 0;
    }
  }

  const dHash = new Uint8Array(64);
  for (let by = 0; by < gridRows; by++) {
    for (let bx = 0; bx < gridCols; bx++) {
      const left = dHashGrid[by * dHashCols + bx];
      const right = dHashGrid[by * dHashCols + bx + 1];
      dHash[(by << 3) | bx] = left > right ? 1 : 0;
    }
  }

  // 6. Noise-robust sharpness (3x3 blur -> 4x4 Tenengrad) & edge energy
  const { sharpness, edgeEnergy, centerSubjectRatio } =
    computeTenengradAndEdgeEnergy(liftedGray, width, height);

  // 7. Subtitle binary mask (for scoring bonus & optional validated subtitle protection)
  const { mask: subtitleMask, activeBits: subtitleActiveBits } =
    computeSubtitleBinaryMask(blurredGray, width, height);

  // Stage 2 Rule 1: Blank ONLY if (p99 - p1) < 3 and edge energy is about 0
  const isBlank =
    p99MinusP1 < VIDEO_TO_COMIC_CONFIG.clearFilter.blankMinDynamicSpan &&
    edgeEnergy < VIDEO_TO_COMIC_CONFIG.clearFilter.blankMaxEdgeEnergy;

  return {
    sampleIndex,
    timestamp,
    thumb16,
    dHash,
    lumaHist32,
    lumaHist64,
    colorHist,
    cellLuma8x8,
    blockRgb,
    sharpness,
    edgeEnergy,
    stability: 0, // Populated once neighbor signatures are available
    stepDiff: 0,
    signedStepDrift: 0,
    centerSubjectRatio,
    p1Luma,
    p99Luma,
    p99MinusP1,
    meanLuma,
    stdLuma,
    subtitleMask,
    subtitleActiveBits,
    isPureColor: isBlank,
    previewDataUrl,
  };
}

// ============================================================================
// STAGE 3 DISTANCE FUNCTION (Background-Weighted Global Similarity)
// ============================================================================

export interface GlobalDistanceComponents {
  distance: number;
  dBg: number;
  dHist: number;
  dHash: number;
  dCenter: number;
  rawOuterBgDiff: number;
  rawCenterDiff: number;
  dHashHamming: number;
  histCorrelation: number;
}

/**
 * Computes the background-weighted distance between two frames so a moving subject
 * in a static camera shot does not make frames look "different":
 *
 *   distance = 0.35 * d_bg + 0.25 * d_hist + 0.25 * d_hash + 0.15 * d_center
 *
 * - d_bg: mean abs diff of 8x8 cell luminance over the OUTER ring (excluding central 40%
 *         and bottom 25% subtitle band), divided by the video's noise floor.
 * - d_hist: 1 - 32-bin luminance histogram correlation.
 * - d_hash: normalized Hamming distance of 64-bit dHash.
 * - d_center: normalized diff of the central 40% zone.
 */
export function computeGlobalFrameDistance(
  sigA: FrameSignature,
  sigB: FrameSignature,
  noiseFloorOuterBg = 3.0
): GlobalDistanceComponents {
  const cfgSim = VIDEO_TO_COMIC_CONFIG.similarity;

  // 1. Outer ring background diff (rows 0..5 excluding central 4x4)
  let outerDiffSum = 0;
  for (let i = 0; i < OUTER_RING_CELL_INDICES.length; i++) {
    const idx = OUTER_RING_CELL_INDICES[i];
    outerDiffSum += Math.abs(sigA.cellLuma8x8[idx] - sigB.cellLuma8x8[idx]);
  }
  const rawOuterBgDiff =
    OUTER_RING_CELL_INDICES.length > 0
      ? outerDiffSum / OUTER_RING_CELL_INDICES.length
      : 0;

  const effectiveNoiseFloor = Math.max(cfgSim.minNoiseFloorLuma, noiseFloorOuterBg);
  const dBg = Math.min(
    1.5,
    (rawOuterBgDiff / effectiveNoiseFloor) * cfgSim.bgNoiseRatioScale
  );

  // 2. 32-bin luminance histogram distance: 1 - correlation
  const histCorrelation = computeHistogramCorrelation(
    sigA.lumaHist32,
    sigB.lumaHist32
  );
  const dHist = Math.max(0, Math.min(1.5, 1.0 - histCorrelation));

  // 3. Normalized 64-bit dHash Hamming distance
  const dHashHamming = computeBinaryHamming(sigA.dHash, sigB.dHash);
  const dHash = dHashHamming / 64.0;

  // 4. Central 40% zone difference
  let centerDiffSum = 0;
  for (let i = 0; i < CENTER_ZONE_CELL_INDICES.length; i++) {
    const idx = CENTER_ZONE_CELL_INDICES[i];
    centerDiffSum += Math.abs(sigA.cellLuma8x8[idx] - sigB.cellLuma8x8[idx]);
  }
  const rawCenterDiff =
    CENTER_ZONE_CELL_INDICES.length > 0
      ? centerDiffSum / CENTER_ZONE_CELL_INDICES.length
      : 0;
  const dCenter = Math.min(1.5, rawCenterDiff / cfgSim.centerDiffNormScale);

  const distance =
    cfgSim.weightBg * dBg +
    cfgSim.weightHist * dHist +
    cfgSim.weightHash * dHash +
    cfgSim.weightCenter * dCenter;

  return {
    distance,
    dBg,
    dHist,
    dHash,
    dCenter,
    rawOuterBgDiff,
    rawCenterDiff,
    dHashHamming,
    histCorrelation,
  };
}

/**
 * Legacy compatibility helper.
 */
export function compareFrameSignatures(sigA: FrameSignature, sigB: FrameSignature) {
  const d = computeGlobalFrameDistance(sigA, sigB, 3.0);
  return {
    blockDiff: d.rawOuterBgDiff,
    topBlocksDiff: d.rawCenterDiff,
    centerDiff: d.rawCenterDiff,
    subtitleDiff: computeBinaryHamming(sigA.subtitleMask, sigB.subtitleMask),
    effectiveDiff: d.distance * 100,
    histDist: d.dHist,
    hammingRatio: d.dHash,
    distance: d.distance,
  };
}

export function areFramesVisuallySimilar(
  sigA: FrameSignature,
  sigB: FrameSignature,
  _timeDeltaSec: number,
  sceneThreshold = 18
): boolean {
  const d = computeGlobalFrameDistance(sigA, sigB, 3.0);
  const simThresh = (sceneThreshold / 18) * 0.16;
  return d.distance <= simThresh;
}

// ============================================================================
// STAGE 2 & STAGE 3: ALL-CLEAR POOL + GLOBAL SIMILARITY LEADER CLUSTERING
// ============================================================================

/**
 * Populates neighbor stability (`0.5 * (diffPrev + diffNext)` on 8x8 cell luminance)
 * and forward step differences for all Stage 1 signatures.
 */
export function populateSignatureStability(signatures: FrameSignature[]): void {
  const n = signatures.length;
  if (n === 0) return;

  const stepDiffs = new Float32Array(n);
  const signedDrifts = new Float32Array(n);

  for (let i = 1; i < n; i++) {
    let absSum = 0;
    let signedSum = 0;
    const prev = signatures[i - 1].cellLuma8x8;
    const curr = signatures[i].cellLuma8x8;
    for (let c = 0; c < 64; c++) {
      const delta = curr[c] - prev[c];
      absSum += Math.abs(delta);
      signedSum += delta;
    }
    stepDiffs[i] = absSum / 64;
    signedDrifts[i] = signedSum / 64;
    signatures[i].stepDiff = stepDiffs[i];
    signatures[i].signedStepDrift = signedDrifts[i];
  }

  for (let i = 0; i < n; i++) {
    const prevDiff = i > 0 ? stepDiffs[i] : i + 1 < n ? stepDiffs[i + 1] : 0;
    const nextDiff = i + 1 < n ? stepDiffs[i + 1] : prevDiff;
    signatures[i].stability = (prevDiff + nextDiff) * 0.5;
  }
}

/**
 * Detects genuine short dissolves/fades:
 * Global change is high AND monotonic over <= 2.0 s.
 * If high change lasts > 3.0 s (or is non-monotonic), treats it as continuous camera/subject motion and keeps it.
 */
function detectGenuineDissolvesAndFades(
  signatures: FrameSignature[],
  sampleStepSec: number
): Uint8Array {
  const n = signatures.length;
  const isTransition = new Uint8Array(n);
  if (n < 3) return isTransition;

  const cfgClear = VIDEO_TO_COMIC_CONFIG.clearFilter;
  const stepDiffs = signatures.slice(1).map((s) => s.stepDiff);
  const medianStep = computeMedian(stepDiffs);
  const madStep = computeMedian(stepDiffs.map((d) => Math.abs(d - medianStep)));
  const highStepThreshold = Math.max(
    cfgClear.transitionMinStepDiff,
    medianStep + cfgClear.transitionStepMadMultiplier * 1.4826 * madStep
  );

  let i = 1;
  while (i < n) {
    if (signatures[i].stepDiff < highStepThreshold) {
      i++;
      continue;
    }

    // Found start of a high global change run
    const runStart = i;
    while (i < n && signatures[i].stepDiff >= highStepThreshold * 0.85) {
      i++;
    }
    const runEnd = i - 1; // inclusive
    const runSamples = runEnd - runStart + 1;
    const runDurationSec =
      signatures[runEnd].timestamp -
      signatures[Math.max(0, runStart - 1)].timestamp;

    // Single-step instantaneous jump is a hard cut, NOT a dissolve ramp
    if (runSamples <= 1) {
      continue;
    }

    // If high change lasts > 3.0 s (or > 2.0 s), treat it as motion and keep it!
    if (runDurationSec > cfgClear.transitionMaxDurationSec) {
      continue;
    }

    // Check if the multi-step ramp (2..4 samples, <= 2.0 s) is monotonic
    // (i.e. each frame moves progressively away from the pre-transition frame toward the post-transition frame)
    const preIdx = Math.max(0, runStart - 1);
    const postIdx = Math.min(n - 1, runEnd + 1);
    const preCells = signatures[preIdx].cellLuma8x8;
    const postCells = signatures[postIdx].cellLuma8x8;

    let monotonicSteps = 0;
    let prevDistToPost = 0;
    for (let c = 0; c < 64; c++) {
      prevDistToPost += Math.abs(preCells[c] - postCells[c]);
    }

    for (let k = runStart; k <= runEnd; k++) {
      let distToPost = 0;
      const curCells = signatures[k].cellLuma8x8;
      for (let c = 0; c < 64; c++) {
        distToPost += Math.abs(curCells[c] - postCells[c]);
      }
      if (distToPost < prevDistToPost * 0.98) {
        monotonicSteps++;
      }
      prevDistToPost = distToPost;
    }

    const monotonicRatio = monotonicSteps / runSamples;
    if (
      monotonicRatio >= cfgClear.transitionMonotonicRatio &&
      runDurationSec <= cfgClear.motionKeepDurationSec
    ) {
      for (let k = runStart; k <= runEnd; k++) {
        isTransition[k] = 1;
      }
    }
  }

  return isTransition;
}

/**
 * Executes STAGE 2 (Collect ALL Clear Frames + 1.5s compute thinning)
 * and STAGE 3 (One Global Background-Weighted Similarity Leader Clustering).
 *
 * Can be re-run in < 5 ms on cached Stage 1 signatures whenever the user moves the Strictness slider!
 */
export function runGlobalStage2AndStage3(
  signatures: FrameSignature[],
  options: {
    strictness?: SimilarityStrictness;
    simThresholdOverride?: number | null;
    protectSubtitles?: boolean;
    sampleStepSec?: number;
    durationSec?: number;
  } = {}
): {
  clusters: ClusterSummaryRecord[];
  report: VideoExtractionDebugReport;
} {
  const n = signatures.length;
  const strictness = options.strictness || 'balanced';
  const simThresholdOverride =
    options.simThresholdOverride !== undefined &&
    options.simThresholdOverride !== null &&
    Number.isFinite(options.simThresholdOverride) &&
    options.simThresholdOverride > 0
      ? options.simThresholdOverride
      : null;
  const protectSubtitles =
    options.protectSubtitles ?? VIDEO_TO_COMIC_CONFIG.subtitle.protectSubtitlesDefault;
  const sampleStepSec = options.sampleStepSec || VIDEO_TO_COMIC_CONFIG.sampling.defaultStepSeconds;
  const durationSec =
    options.durationSec ||
    (n > 0 ? signatures[n - 1].timestamp + sampleStepSec : 0);

  if (n === 0) {
    return {
      clusters: [],
      report: {
        durationSec: 0,
        sampleStepSec,
        totalSamples: 0,
        clearCount: 0,
        windowCandidateCount: 0,
        clusterCount: 0,
        keptCount: 0,
        rejectedCount: 0,
        noiseFloorOuterBg: 2.5,
        baselineS: 0.08,
        simThreshold: 0.16,
        simThresholdOverride,
        strictness,
        protectSubtitles,
        subtitleTrackValidated: false,
        subtitleBlankRatio: 1,
        sharpnessFloor: 0,
        motionBlurThreshold: 0,
        clusters: [],
        candidates: [],
      },
    };
  }

  populateSignatureStability(signatures);

  const cfgClear = VIDEO_TO_COMIC_CONFIG.clearFilter;
  const cfgScore = VIDEO_TO_COMIC_CONFIG.scoring;
  const cfgSim = VIDEO_TO_COMIC_CONFIG.similarity;
  const cfgSub = VIDEO_TO_COMIC_CONFIG.subtitle;

  // --------------------------------------------------------------------------
  // STAGE 2: Determine CLEAR status for every sample
  // --------------------------------------------------------------------------
  const nonBlankSamples = signatures.filter((s) => !s.isPureColor);
  const validPool = nonBlankSamples.length > 0 ? nonBlankSamples : signatures;

  // 2a. Sharpness threshold: max(P25 of valid samples, 0.6 * median)
  const validSharpness = validPool.map((s) => s.sharpness);
  const p25Sharpness = computePercentile(
    validSharpness,
    cfgClear.sharpnessPercentile
  );
  const medianSharpness = computeMedian(validSharpness);
  const sharpnessFloor = Math.max(
    p25Sharpness,
    cfgClear.sharpnessMedianMultiplier * medianSharpness
  );
  const p95Sharpness = Math.max(
    sharpnessFloor + 1e-4,
    computePercentile(validSharpness, 0.95)
  );

  // 2b. Motion-blur stability threshold (adaptive from video's neighbor stability distribution)
  const validStabilities = validPool.map((s) => s.stability);
  const medianStability = computeMedian(validStabilities);
  const madStability = computeMedian(
    validStabilities.map((st) => Math.abs(st - medianStability))
  );
  const p82Stability = computePercentile(
    validStabilities,
    cfgClear.stabilityPercentileFallback
  );
  const motionBlurThreshold = Math.max(
    3.5,
    p82Stability,
    medianStability + cfgClear.stabilityMadMultiplier * 1.4826 * madStability
  );

  // 2c. Dissolve / fade detection (high monotonic global change over <= 2.0 s)
  const isTransitionFlags = detectGenuineDissolvesAndFades(
    signatures,
    sampleStepSec
  );

  // 2d. Subtitle stability & track validation (for scoring bonus & optional protection)
  const minSubStableSteps = Math.max(
    1,
    Math.round(cfgSub.minStableDurationSec / Math.max(0.1, sampleStepSec))
  );
  const subtitleStableFlags = new Uint8Array(n);
  let blankSubtitleSampleCount = 0;

  for (let i = 0; i < n; i++) {
    if (signatures[i].subtitleActiveBits < cfgSub.minActiveBitsForSubtitle) {
      blankSubtitleSampleCount++;
      continue;
    }
    let stable = true;
    for (let k = 1; k <= minSubStableSteps; k++) {
      if (i + k >= n) break;
      if (
        computeBinaryHamming(
          signatures[i].subtitleMask,
          signatures[i + k].subtitleMask
        ) > cfgSub.stabilityMaxHamming
      ) {
        stable = false;
        break;
      }
    }
    subtitleStableFlags[i] = stable ? 1 : 0;
  }

  const subtitleBlankRatio = blankSubtitleSampleCount / n;
  const subtitleTrackValidated =
    subtitleBlankRatio >= cfgSub.minBlankGapSampleRatio &&
    subtitleBlankRatio < 0.99;

  // Evaluate all 4 CLEAR conditions & compute compositeScore for each sample
  const clearFlags = new Uint8Array(n);
  const rejectReasons: ClearRejectReason[] = new Array(n).fill('CLEAR');
  const compositeScores = new Float32Array(n);
  const relSharpnessArr = new Float32Array(n);
  const stabilityScoreArr = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const s = signatures[i];

    // Relative sharpness (0..1) and stability score (0..1)
    const relSharp = Math.max(
      0,
      Math.min(1, s.sharpness / Math.max(1e-4, p95Sharpness))
    );
    const stabScore = 1.0 / (1.0 + (s.stability / Math.max(1.5, motionBlurThreshold)));
    const notTrans = !s.isPureColor && isTransitionFlags[i] === 0 ? 1.0 : 0.0;
    const subBonus =
      subtitleTrackValidated &&
      s.subtitleActiveBits >= cfgSub.minActiveBitsForSubtitle &&
      subtitleStableFlags[i] === 1
        ? 1.0
        : 0.5;

    const compScore =
      cfgScore.weightRelativeSharpness * relSharp +
      cfgScore.weightStability * stabScore +
      cfgScore.weightCenterSubject * s.centerSubjectRatio +
      cfgScore.weightNotTransition * notTrans +
      cfgScore.weightSubtitleBonus * subBonus;

    relSharpnessArr[i] = relSharp;
    stabilityScoreArr[i] = stabScore;
    compositeScores[i] = compScore;

    // Rule 1: Not blank ((p99 - p1) < 3 and edgeEnergy ~ 0)
    if (s.isPureColor) {
      rejectReasons[i] = 'BLANK';
      continue;
    }

    // Rule 4: Not inside a genuine dissolve/fade (<= 2s monotonic high change)
    if (isTransitionFlags[i] === 1) {
      rejectReasons[i] = 'TRANSITION';
      continue;
    }

    // Rule 2: Sharp enough (>= sharpnessFloor OR sharpest sample within +/- 1.5 s)
    let isLocalSharpest = true;
    for (let j = 0; j < n; j++) {
      if (j === i || signatures[j].isPureColor) continue;
      if (
        Math.abs(signatures[j].timestamp - s.timestamp) <=
        cfgClear.localSharpestWindowSec
      ) {
        if (signatures[j].sharpness > s.sharpness * 1.02) {
          isLocalSharpest = false;
          break;
        }
      }
    }
    const sharpEnough = s.sharpness >= sharpnessFloor || isLocalSharpest;
    if (!sharpEnough) {
      rejectReasons[i] = 'TOO_BLURRY';
      continue;
    }

    // Rule 3: Not motion-blurred (stability <= motionBlurThreshold OR most stable within +/- 1.0 s)
    let isLocalMostStable = true;
    for (let j = 0; j < n; j++) {
      if (j === i || signatures[j].isPureColor) continue;
      if (
        Math.abs(signatures[j].timestamp - s.timestamp) <=
        cfgClear.localMostStableWindowSec
      ) {
        if (signatures[j].stability < s.stability * 0.98) {
          isLocalMostStable = false;
          break;
        }
      }
    }
    const stableEnough = s.stability <= motionBlurThreshold || isLocalMostStable;
    if (!stableEnough) {
      rejectReasons[i] = 'MOTION_BLUR';
      continue;
    }

    clearFlags[i] = 1;
    rejectReasons[i] = 'CLEAR';
  }

  // Fallback if all samples were rejected (e.g., an all-blank test clip)
  let clearIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (clearFlags[i] === 1) clearIndices.push(i);
  }
  if (clearIndices.length === 0) {
    let bestIdx = 0;
    for (let i = 1; i < n; i++) {
      if (compositeScores[i] > compositeScores[bestIdx]) bestIdx = i;
    }
    clearFlags[bestIdx] = 1;
    rejectReasons[bestIdx] = 'CLEAR';
    clearIndices = [bestIdx];
  }

  // 2e. 1.5 s Window Compute-Thinning (keep only the top-scoring CLEAR sample in each 1.5 s window, no count cap)
  const windowSec = cfgClear.thinningWindowSec;
  const windowBestMap = new Map<number, number>();
  for (const idx of clearIndices) {
    const wId = Math.floor(signatures[idx].timestamp / windowSec);
    const existing = windowBestMap.get(wId);
    if (existing === undefined || compositeScores[idx] > compositeScores[existing]) {
      windowBestMap.set(wId, idx);
    }
  }
  const windowCandidateSet = new Set<number>(windowBestMap.values());
  const windowCandidates = Array.from(windowCandidateSet).sort((a, b) => a - b);

  // --------------------------------------------------------------------------
  // STAGE 3: Calibrate Outer-Ring Noise Floor & Video-Adaptive Baseline S
  // --------------------------------------------------------------------------
  const consecutiveOuterDiffs: number[] = [];
  for (let i = 1; i < clearIndices.length; i++) {
    const prevSig = signatures[clearIndices[i - 1]];
    const currSig = signatures[clearIndices[i]];
    let outerSum = 0;
    for (let k = 0; k < OUTER_RING_CELL_INDICES.length; k++) {
      const cellIdx = OUTER_RING_CELL_INDICES[k];
      outerSum += Math.abs(currSig.cellLuma8x8[cellIdx] - prevSig.cellLuma8x8[cellIdx]);
    }
    consecutiveOuterDiffs.push(
      OUTER_RING_CELL_INDICES.length > 0
        ? outerSum / OUTER_RING_CELL_INDICES.length
        : 0
    );
  }

  // Video's outer-ring background noise floor ( inside stable stretches )
  const stableOuterDiffs =
    consecutiveOuterDiffs.length >= 4
      ? [...consecutiveOuterDiffs]
          .sort((a, b) => a - b)
          .slice(
            0,
            Math.max(
              2,
              Math.floor(
                consecutiveOuterDiffs.length *
                  cfgSim.stableStretchPercentileCutoff
              )
            )
          )
      : consecutiveOuterDiffs;

  const medianOuterDiff = computeMedian(stableOuterDiffs);
  const madOuterDiff = computeMedian(
    stableOuterDiffs.map((d) => Math.abs(d - medianOuterDiff))
  );
  const noiseFloorOuterBg = Math.max(
    cfgSim.minNoiseFloorLuma,
    medianOuterDiff + 1.4826 * madOuterDiff
  );

  // Compute consecutive CLEAR distances inside stable stretches to calibrate baseline S ("same picture" level)
  const consecutiveClearDistances: number[] = [];
  for (let i = 1; i < clearIndices.length; i++) {
    const prevSig = signatures[clearIndices[i - 1]];
    const currSig = signatures[clearIndices[i]];
    if (currSig.timestamp - prevSig.timestamp <= sampleStepSec * 3.5) {
      const d = computeGlobalFrameDistance(
        prevSig,
        currSig,
        noiseFloorOuterBg
      ).distance;
      consecutiveClearDistances.push(d);
    }
  }

  let baselineS = 0.08;
  if (consecutiveClearDistances.length > 0) {
    const sortedConsec = [...consecutiveClearDistances].sort((a, b) => a - b);
    const stableSlice = sortedConsec.slice(
      0,
      Math.max(
        1,
        Math.floor(sortedConsec.length * cfgSim.stableStretchPercentileCutoff)
      )
    );
    const rawMedianS = computeMedian(stableSlice);
    baselineS = Math.max(
      cfgSim.minBaselineS,
      Math.min(cfgSim.maxBaselineS, rawMedianS)
    );
  }

  const strictnessMultiplier = cfgSim.strictnessMultipliers[strictness];
  const simThreshold =
    simThresholdOverride !== null
      ? simThresholdOverride
      : baselineS * strictnessMultiplier;

  // --------------------------------------------------------------------------
  // STAGE 3: Two-Pass Global Leader Clustering (ordered by compositeScore desc)
  // --------------------------------------------------------------------------
  const sortedCandidatesDesc = [...windowCandidates].sort(
    (a, b) => compositeScores[b] - compositeScores[a]
  );

  interface InternalCluster {
    repIdx: number;
    members: number[]; // All window candidate indices assigned to this cluster
  }

  const rawClusters: InternalCluster[] = [];

  // Pass 1: Assign each candidate to the closest existing representative within simThreshold,
  // or start a new cluster representative
  for (const candIdx of sortedCandidatesDesc) {
    const candSig = signatures[candIdx];
    let bestCluster: InternalCluster | null = null;
    let bestDist = Infinity;

    for (let c = 0; c < rawClusters.length; c++) {
      const cl = rawClusters[c];
      const repSig = signatures[cl.repIdx];
      const d = computeGlobalFrameDistance(
        candSig,
        repSig,
        noiseFloorOuterBg
      ).distance;
      if (d <= simThreshold && d < bestDist) {
        bestDist = d;
        bestCluster = cl;
      }
    }

    if (bestCluster) {
      bestCluster.members.push(candIdx);
    } else {
      rawClusters.push({
        repIdx: candIdx,
        members: [candIdx],
      });
    }
  }

  // Pass 2: Merge any representatives within simThreshold of each other (highest score absorbs lower score)
  rawClusters.sort(
    (a, b) => compositeScores[b.repIdx] - compositeScores[a.repIdx]
  );
  const mergedClusters: InternalCluster[] = [];

  for (const cl of rawClusters) {
    const clRepSig = signatures[cl.repIdx];
    let targetCluster: InternalCluster | null = null;
    let minDist = Infinity;

    for (const keptCl of mergedClusters) {
      const keptRepSig = signatures[keptCl.repIdx];
      const d = computeGlobalFrameDistance(
        clRepSig,
        keptRepSig,
        noiseFloorOuterBg
      ).distance;
      if (d <= simThreshold && d < minDist) {
        minDist = d;
        targetCluster = keptCl;
      }
    }

    if (targetCluster) {
      targetCluster.members.push(...cl.members);
    } else {
      mergedClusters.push({
        repIdx: cl.repIdx,
        members: [...cl.members],
      });
    }
  }

  // Optional Subtitle Protection (Default OFF):
  // If protectSubtitles is true AND subtitleTrackValidated is true, split out a secondary cluster
  // only when a member has a validated new stable subtitle line (>= 0.8s) different from the cluster's rep.
  const finalInternalClusters: InternalCluster[] = [];
  if (protectSubtitles && subtitleTrackValidated) {
    for (const cl of mergedClusters) {
      const acceptedSubMasks: Uint8Array[] = [];
      const repSig = signatures[cl.repIdx];
      if (repSig.subtitleActiveBits >= cfgSub.minActiveBitsForSubtitle) {
        acceptedSubMasks.push(repSig.subtitleMask);
      }

      const primaryMembers: number[] = [cl.repIdx];
      const extraSubClusters: InternalCluster[] = [];

      // Sort non-rep members by compositeScore descending
      const otherMembers = cl.members
        .filter((idx) => idx !== cl.repIdx)
        .sort((a, b) => compositeScores[b] - compositeScores[a]);

      for (const mIdx of otherMembers) {
        const mSig = signatures[mIdx];
        if (
          mSig.subtitleActiveBits >= cfgSub.minActiveBitsForSubtitle &&
          subtitleStableFlags[mIdx] === 1
        ) {
          let isDistinctSub = true;
          for (const mask of acceptedSubMasks) {
            if (
              computeBinaryHamming(mask, mSig.subtitleMask) <
              cfgSub.hammingNewSubtitleThreshold
            ) {
              isDistinctSub = false;
              break;
            }
          }
          if (isDistinctSub) {
            acceptedSubMasks.push(mSig.subtitleMask);
            extraSubClusters.push({
              repIdx: mIdx,
              members: [mIdx],
            });
            continue;
          }
        }
        primaryMembers.push(mIdx);
      }

      finalInternalClusters.push({
        repIdx: cl.repIdx,
        members: primaryMembers,
      });
      finalInternalClusters.push(...extraSubClusters);
    }
  } else {
    finalInternalClusters.push(...mergedClusters);
  }

  // Sort final clusters chronologically by representative timestamp
  finalInternalClusters.sort(
    (a, b) =>
      signatures[a.repIdx].timestamp - signatures[b.repIdx].timestamp
  );

  // Build ClusterSummaryRecords and assign every CLEAR sample to its cluster for the Debug Panel
  const sampleToClusterId = new Int32Array(n).fill(-1);
  const isClusterRepFlags = new Uint8Array(n);
  const clusters: ClusterSummaryRecord[] = [];

  for (let cIdx = 0; cIdx < finalInternalClusters.length; cIdx++) {
    const cl = finalInternalClusters[cIdx];
    const clusterId = cIdx + 1;
    // Order members by compositeScore descending for Stage 4 fallback
    const sortedMembers = [...cl.members].sort(
      (a, b) => compositeScores[b] - compositeScores[a]
    );
    const repIdx = sortedMembers[0];
    isClusterRepFlags[repIdx] = 1;

    for (const mIdx of sortedMembers) {
      sampleToClusterId[mIdx] = clusterId;
    }

    clusters.push({
      clusterId,
      repSampleIndex: repIdx,
      repTimestamp: signatures[repIdx].timestamp,
      repScore: Number(compositeScores[repIdx].toFixed(3)),
      memberCount: sortedMembers.length,
      memberSampleIndices: sortedMembers,
      previewDataUrl: signatures[repIdx].previewDataUrl,
    });
  }

  // Also map non-window CLEAR samples (thinned within 1.5s window) to their closest cluster representative
  for (const idx of clearIndices) {
    if (sampleToClusterId[idx] === -1 && clusters.length > 0) {
      let bestCl = clusters[0];
      let bestD = Infinity;
      for (const cl of clusters) {
        const d = computeGlobalFrameDistance(
          signatures[idx],
          signatures[cl.repSampleIndex],
          noiseFloorOuterBg
        ).distance;
        if (d < bestD) {
          bestD = d;
          bestCl = cl;
        }
      }
      sampleToClusterId[idx] = bestCl.clusterId;
      // Add to fallback members of that cluster if not already present
      if (!bestCl.memberSampleIndices.includes(idx)) {
        bestCl.memberSampleIndices.push(idx);
        bestCl.memberSampleIndices.sort(
          (a, b) => compositeScores[b] - compositeScores[a]
        );
        bestCl.memberCount = bestCl.memberSampleIndices.length;
      }
    }
  }

  // Build per-sample CandidateDebugRecord table
  const candidates: CandidateDebugRecord[] = new Array(n);
  const clusterById = new Map<number, ClusterSummaryRecord>();
  for (const cl of clusters) clusterById.set(cl.clusterId, cl);

  let keptCount = 0;
  for (let i = 0; i < n; i++) {
    const s = signatures[i];
    const isClear = clearFlags[i] === 1;
    const rejReason = rejectReasons[i];
    const passedWindow = windowCandidateSet.has(i);
    const cId = sampleToClusterId[i] !== -1 ? sampleToClusterId[i] : null;
    const isRep = isClusterRepFlags[i] === 1;

    let distToRep: number | null = null;
    let dBg: number | null = null;
    let dHist: number | null = null;
    let dHash: number | null = null;
    let dCenter: number | null = null;

    if (cId !== null) {
      const cl = clusterById.get(cId);
      if (cl) {
        if (cl.repSampleIndex === i) {
          distToRep = 0;
          dBg = 0;
          dHist = 0;
          dHash = 0;
          dCenter = 0;
        } else {
          const distComp = computeGlobalFrameDistance(
            s,
            signatures[cl.repSampleIndex],
            noiseFloorOuterBg
          );
          distToRep = Number(distComp.distance.toFixed(4));
          dBg = Number(distComp.dBg.toFixed(3));
          dHist = Number(distComp.dHist.toFixed(3));
          dHash = Number(distComp.dHash.toFixed(3));
          dCenter = Number(distComp.dCenter.toFixed(3));
        }
      }
    }

    let decisionCode: CandidateDecisionCode;
    let decisionDetail: string;

    if (!isClear) {
      decisionCode = rejReason === 'CLEAR' ? 'TOO_BLURRY' : rejReason;
      if (rejReason === 'BLANK') {
        decisionDetail = `Blank frame: (p99-p1)=${s.p99MinusP1.toFixed(1)} < 3 & edgeEnergy=${s.edgeEnergy.toFixed(2)}`;
      } else if (rejReason === 'TOO_BLURRY') {
        decisionDetail = `Below sharpness floor (${s.sharpness.toFixed(1)} < ${sharpnessFloor.toFixed(1)}) and not local 1.5s peak`;
      } else if (rejReason === 'MOTION_BLUR') {
        decisionDetail = `High neighbor instability (${s.stability.toFixed(1)} > ${motionBlurThreshold.toFixed(1)}) and not local 1.0s stable peak`;
      } else {
        decisionDetail = 'Inside monotonic <=2.0s dissolve/fade transition';
      }
    } else if (isRep) {
      decisionCode = 'KEPT';
      decisionDetail = `Cluster #${cId} representative (highest score ${compositeScores[i].toFixed(3)})`;
      keptCount++;
    } else {
      decisionCode = 'DUP_CLUSTER';
      const cl = cId !== null ? clusterById.get(cId) : undefined;
      decisionDetail = passedWindow
        ? `Merged into Cluster #${cId} (rep at ${cl ? cl.repTimestamp.toFixed(2) : '?'}s, dist=${distToRep?.toFixed(3)} <= ${simThreshold.toFixed(3)})`
        : `Thinned in 1.5s window / merged into Cluster #${cId} (dist=${distToRep?.toFixed(3)})`;
    }

    candidates[i] = {
      sampleIndex: i,
      timestamp: Number(s.timestamp.toFixed(3)),
      isClear,
      rejectReason: rejReason,
      passedWindowThinning: passedWindow,
      clusterId: cId,
      distanceToRep: distToRep,
      isClusterRep: isRep,
      kept: isRep,
      decisionCode,
      decisionDetail,
      rawSharpness: Number(s.sharpness.toFixed(2)),
      relativeSharpness: Number(relSharpnessArr[i].toFixed(3)),
      edgeEnergy: Number(s.edgeEnergy.toFixed(2)),
      p99MinusP1: Number(s.p99MinusP1.toFixed(1)),
      stability: Number(s.stability.toFixed(2)),
      stabilityScore: Number(stabilityScoreArr[i].toFixed(3)),
      centerSubjectScore: Number(s.centerSubjectRatio.toFixed(3)),
      compositeScore: Number(compositeScores[i].toFixed(3)),
      dBg,
      dHist,
      dHash,
      dCenter,
      subtitleActiveBits: s.subtitleActiveBits,
      subtitleStable: subtitleStableFlags[i] === 1,
      previewDataUrl: s.previewDataUrl,
    };
  }

  const report: VideoExtractionDebugReport = {
    durationSec: Number(durationSec.toFixed(2)),
    sampleStepSec: Number(sampleStepSec.toFixed(3)),
    totalSamples: n,
    clearCount: clearIndices.length,
    windowCandidateCount: windowCandidates.length,
    clusterCount: clusters.length,
    keptCount,
    rejectedCount: n - keptCount,
    noiseFloorOuterBg: Number(noiseFloorOuterBg.toFixed(3)),
    baselineS: Number(baselineS.toFixed(4)),
    simThreshold: Number(simThreshold.toFixed(4)),
    simThresholdOverride,
    strictness,
    protectSubtitles,
    subtitleTrackValidated,
    subtitleBlankRatio: Number(subtitleBlankRatio.toFixed(3)),
    sharpnessFloor: Number(sharpnessFloor.toFixed(2)),
    motionBlurThreshold: Number(motionBlurThreshold.toFixed(2)),
    clusters,
    candidates,
  };

  return { clusters, report };
}

// ============================================================================
// VIDEO SEEKING & PAGINATION HELPERS
// ============================================================================

export function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Seeks an HTML5 video element to a specific timestamp and waits for 'seeked'
 * and a presented frame (using requestVideoFrameCallback when available, else requestAnimationFrame).
 */
export function seekVideo(
  video: HTMLVideoElement,
  time: number,
  timeoutMs = 5500
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const duration =
      Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const maxSafeTime = Math.max(0, duration - 0.05);
    const clampedTime = Math.max(0, Math.min(time, maxSafeTime));

    const waitForPresentedFrame = () => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve(video.readyState >= 2);
        }
      };

      const settleFrame = () => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => finish());
        }
        setTimeout(finish, 18);
      };

      if (video.readyState >= 2) {
        settleFrame();
        return;
      }

      let dataResolved = false;
      const onData = () => {
        if (!dataResolved) {
          dataResolved = true;
          video.removeEventListener('loadeddata', onData);
          video.removeEventListener('canplay', onData);
          clearTimeout(dataTimer);
          settleFrame();
        }
      };
      const dataTimer = setTimeout(() => {
        if (!dataResolved) {
          dataResolved = true;
          video.removeEventListener('loadeddata', onData);
          video.removeEventListener('canplay', onData);
          finish();
        }
      }, 1500);

      video.addEventListener('loadeddata', onData, { once: true });
      video.addEventListener('canplay', onData, { once: true });
    };

    if (
      Math.abs(video.currentTime - clampedTime) < 0.012 &&
      video.readyState >= 2
    ) {
      waitForPresentedFrame();
      return;
    }

    let resolved = false;
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      clearTimeout(timeoutTimer);
    };

    const onSeeked = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        waitForPresentedFrame();
      }
    };

    const onError = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(
          new Error('Video seek error: ' + (video.error?.message || 'unknown'))
        );
      }
    };

    const timeoutTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(video.readyState >= 2);
      }
    }, timeoutMs);

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });

    try {
      video.currentTime =
        Math.abs(video.currentTime - clampedTime) < 0.001 && clampedTime === 0
          ? Math.min(0.01, maxSafeTime)
          : clampedTime;
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

export function populateTreeWithImages(
  tree: TreeNode,
  images: string[]
): TreeNode {
  let imgIdx = 0;
  function walk(node: TreeNode): TreeNode {
    if (node.type === 'panel') {
      const nextImg = images[imgIdx++];
      return {
        ...node,
        imageUrl: nextImg || node.imageUrl,
      };
    }
    return {
      ...node,
      c1: walk(node.c1),
      c2: walk(node.c2),
    };
  }
  return walk(tree);
}

export function paginateKeyframesTo6PanelPages(
  keyframes: (ExtractedKeyframe | string)[],
  options?: { baseTitle?: string; panelsPerPage?: number }
): ComicPageData[] {
  const images = keyframes.map((k) =>
    typeof k === 'string' ? k : k.dataUrl
  );
  const panelsPerPage = options?.panelsPerPage || 6;
  const baseTitle = options?.baseTitle || 'Comic Page';
  const pages: ComicPageData[] = [];

  const totalPages = Math.ceil(images.length / panelsPerPage) || 1;

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const startIdx = pageIdx * panelsPerPage;
    const pageImages = images.slice(startIdx, startIdx + panelsPerPage);

    const emptyGrid = createGridTree(3, 2);
    const populatedTree = populateTreeWithImages(emptyGrid, pageImages);

    pages.push({
      id: `comic-page-${Date.now()}-${pageIdx}`,
      title: `${baseTitle} ${pageIdx + 1}`,
      tree: populatedTree,
      bubbles: [],
    });
  }

  return pages;
}

// ============================================================================
// STAGE 4: FULL-RESOLUTION CAPTURE FOR CLUSTER REPRESENTATIVES
// ============================================================================

/**
 * Captures full-resolution keyframes for the selected clusters from a video source.
 * Verifies each captured frame is not blank and still above the sharpness floor;
 * otherwise automatically falls back to the next-best frame in the same cluster.
 */
export async function captureKeyframesForClusters(
  videoSource: File | Blob | string,
  session: CachedAnalysisSession,
  clusters: ClusterSummaryRecord[],
  sharpnessFloor: number,
  options: {
    imageFormat?: 'image/jpeg' | 'image/png' | 'image/webp';
    imageQuality?: number;
    onProgress?: (progress: VideoProcessingProgress) => void;
    isCancelled?: () => boolean;
    existingVideoElement?: HTMLVideoElement | null;
  } = {}
): Promise<ExtractedKeyframe[]> {
  const {
    imageFormat = 'image/jpeg',
    imageQuality = 0.88,
    onProgress,
    isCancelled = () => false,
    existingVideoElement = null,
  } = options;

  let ownVideoUrl = '';
  let ownVideoEl: HTMLVideoElement | null = null;
  let videoEl = existingVideoElement;
  let fullCanvas: HTMLCanvasElement | null = null;
  let verifyCanvas: HTMLCanvasElement | null = null;

  try {
    if (!videoEl) {
      ownVideoEl = document.createElement('video');
      ownVideoEl.preload = 'auto';
      ownVideoEl.muted = true;
      ownVideoEl.playsInline = true;
      ownVideoEl.style.position = 'fixed';
      ownVideoEl.style.top = '-9999px';
      ownVideoEl.style.left = '-9999px';
      ownVideoEl.style.opacity = '0';
      ownVideoEl.style.pointerEvents = 'none';
      document.body.appendChild(ownVideoEl);

      if (typeof videoSource === 'string') {
        ownVideoUrl = videoSource;
      } else {
        ownVideoUrl = URL.createObjectURL(videoSource);
      }
      ownVideoEl.src = ownVideoUrl;

      await new Promise<void>((resolve, reject) => {
        if (!ownVideoEl) return resolve();
        const onLoaded = () => {
          cleanup();
          resolve();
        };
        const onErr = () => {
          cleanup();
          reject(new Error('Failed to load video for Stage 4 capture.'));
        };
        const timer = setTimeout(() => {
          cleanup();
          resolve();
        }, 10000);
        const cleanup = () => {
          clearTimeout(timer);
          ownVideoEl?.removeEventListener('loadedmetadata', onLoaded);
          ownVideoEl?.removeEventListener('error', onErr);
        };
        ownVideoEl.addEventListener('loadedmetadata', onLoaded, { once: true });
        ownVideoEl.addEventListener('error', onErr, { once: true });
        if (ownVideoEl.readyState >= 1) {
          cleanup();
          resolve();
        }
      });

      videoEl = ownVideoEl;
    }

    const videoWidth = session.videoWidth;
    const videoHeight = session.videoHeight;

    fullCanvas = document.createElement('canvas');
    fullCanvas.width = videoWidth;
    fullCanvas.height = videoHeight;
    const fullCtx = fullCanvas.getContext('2d');
    if (!fullCtx) throw new Error('Could not create full-resolution 2D canvas.');

    const verifyW = VIDEO_TO_COMIC_CONFIG.sampling.analysisCanvasWidth;
    const verifyH = Math.max(
      90,
      Math.round(verifyW * (videoHeight / Math.max(1, videoWidth)))
    );
    verifyCanvas = document.createElement('canvas');
    verifyCanvas.width = verifyW;
    verifyCanvas.height = verifyH;
    const verifyCtx = verifyCanvas.getContext('2d', { willReadFrequently: true });

    const finalKeyframes: ExtractedKeyframe[] = [];

    for (let cIdx = 0; cIdx < clusters.length; cIdx++) {
      if (isCancelled()) throw new Error('Video conversion cancelled by user.');

      const cluster = clusters[cIdx];
      const pct =
        70 + Math.round(((cIdx + 1) / Math.max(1, clusters.length)) * 28);

      onProgress?.({
        phase: 'extracting',
        percent: pct,
        statusText: `Stage 4: Capturing cluster ${cIdx + 1} of ${clusters.length} (${cluster.repTimestamp.toFixed(1)}s)...`,
        currentTime: cluster.repTimestamp,
        totalDuration: session.durationSec,
        candidatesFound: clusters.length,
        currentStep: cIdx + 1,
        totalSteps: clusters.length,
      });

      await yieldToMainThread();

      // Try the cluster representative first; if blank or below sharpness floor, try next-best member of the same cluster
      const candidatesToTry =
        cluster.memberSampleIndices.length > 0
          ? cluster.memberSampleIndices.slice(0, 4)
          : [cluster.repSampleIndex];

      let capturedFrame: ExtractedKeyframe | null = null;
      let fallbackBestFrame: ExtractedKeyframe | null = null;

      for (let attempt = 0; attempt < candidatesToTry.length; attempt++) {
        const sampleIdx = candidatesToTry[attempt];
        const sig = session.signatures[sampleIdx];
        if (!sig) continue;

        const seekOk = await seekVideo(videoEl, sig.timestamp, 5500);
        if (!seekOk) continue;

        fullCtx.drawImage(videoEl, 0, 0, videoWidth, videoHeight);

        // Verify the captured full-res frame is not blank and meets sharpness floor
        let passesVerification = true;
        let measuredSharpness = sig.sharpness;

        if (verifyCtx) {
          verifyCtx.drawImage(fullCanvas, 0, 0, verifyW, verifyH);
          const verifyData = verifyCtx.getImageData(0, 0, verifyW, verifyH);
          const verifySig = computeFrameSignature(verifyData, sig.timestamp);
          measuredSharpness = verifySig.sharpness;

          const isBlankNow = verifySig.isPureColor;
          const isAboveFloor =
            verifySig.sharpness >= sharpnessFloor * 0.72 ||
            candidatesToTry.length === 1;

          if (isBlankNow || !isAboveFloor) {
            passesVerification = false;
          }
        }

        const dataUrl = fullCanvas.toDataURL(imageFormat, imageQuality);
        const blob = await new Promise<Blob>((resolve) => {
          fullCanvas?.toBlob(
            (b) => resolve(b || new Blob([], { type: imageFormat })),
            imageFormat,
            imageQuality
          );
        });

        const candidateKf: ExtractedKeyframe = {
          timestamp: sig.timestamp,
          dataUrl,
          blob,
          sharpnessScore: measuredSharpness,
          compositeScore: cluster.repScore,
          clusterId: cluster.clusterId,
          decisionCode: 'KEPT',
          index: finalKeyframes.length,
        };

        if (
          !fallbackBestFrame ||
          candidateKf.sharpnessScore > fallbackBestFrame.sharpnessScore
        ) {
          fallbackBestFrame = candidateKf;
        }

        if (passesVerification) {
          capturedFrame = candidateKf;
          break;
        }
      }

      const chosen = capturedFrame || fallbackBestFrame;
      if (chosen) {
        finalKeyframes.push({
          ...chosen,
          index: finalKeyframes.length,
        });
      }
    }

    onProgress?.({
      phase: 'complete',
      percent: 100,
      statusText: `Extracted ${finalKeyframes.length} unique keyframes from ${clusters.length} clusters!`,
      candidatesFound: finalKeyframes.length,
    });

    return finalKeyframes;
  } finally {
    if (ownVideoUrl && typeof videoSource !== 'string') {
      try {
        URL.revokeObjectURL(ownVideoUrl);
      } catch (_) {}
    }
    if (ownVideoEl) {
      try {
        ownVideoEl.pause();
        ownVideoEl.removeAttribute('src');
        ownVideoEl.load();
        if (ownVideoEl.parentNode) {
          ownVideoEl.parentNode.removeChild(ownVideoEl);
        }
      } catch (_) {}
    }
    if (fullCanvas) {
      fullCanvas.width = 0;
      fullCanvas.height = 0;
    }
    if (verifyCanvas) {
      verifyCanvas.width = 0;
      verifyCanvas.height = 0;
    }
  }
}

// ============================================================================
// MAIN ENTRY POINT: extractVideoKeyframes (Stages 1 -> 2 -> 3 -> 4)
// ============================================================================

export async function extractVideoKeyframes(
  videoSource: File | Blob | string,
  options: VideoToComicOptions = {}
): Promise<ExtractedKeyframe[]> {
  const {
    stepSeconds = VIDEO_TO_COMIC_CONFIG.sampling.defaultStepSeconds,
    strictness = 'balanced',
    simThresholdOverride = null,
    protectSubtitles = VIDEO_TO_COMIC_CONFIG.subtitle.protectSubtitlesDefault,
    imageFormat = 'image/jpeg',
    imageQuality = 0.88,
    includeDebugThumbnails = true,
    onAnalysisCached,
    onDebugReport,
    onProgress,
    isCancelled = () => false,
  } = options;

  if (typeof videoSource !== 'string' && videoSource instanceof File) {
    const ext = videoSource.name.split('.').pop()?.toLowerCase();
    if (ext === 'avi') {
      throw new Error(
        'AVI format is disabled. Please choose a supported web video container like MP4, WebM, or MOV.'
      );
    }
  }

  let videoUrl = '';
  let videoEl: HTMLVideoElement | null = null;
  let analysisCanvas: HTMLCanvasElement | null = null;
  let previewCanvas: HTMLCanvasElement | null = null;

  try {
    onProgress?.({
      phase: 'init',
      percent: 0,
      statusText: 'Initializing HTML5 video decoder...',
    });

    videoEl = document.createElement('video');
    videoEl.preload = 'auto';
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.style.position = 'fixed';
    videoEl.style.top = '-9999px';
    videoEl.style.left = '-9999px';
    videoEl.style.opacity = '0';
    videoEl.style.pointerEvents = 'none';
    document.body.appendChild(videoEl);

    const VIDEO_MIME_MAP: Record<string, string> = {
      mp4: 'video/mp4',
      m4v: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      mkv: 'video/x-matroska',
      wmv: 'video/x-ms-wmv',
      flv: 'video/x-flv',
      ogv: 'video/ogg',
      ogg: 'video/ogg',
      '3gp': 'video/3gpp',
      ts: 'video/mp2t',
      mts: 'video/mp2t',
      m2ts: 'video/mp2t',
      vob: 'video/dvd',
      asf: 'video/x-ms-asf',
    };

    let processedSource: Blob | string = videoSource;
    if (typeof videoSource !== 'string' && videoSource instanceof Blob) {
      const fileName = (videoSource as File).name || '';
      const ext = fileName.split('.').pop()?.toLowerCase() || '';
      const mappedMime = VIDEO_MIME_MAP[ext];
      if (
        mappedMime &&
        (!videoSource.type || videoSource.type === 'application/octet-stream')
      ) {
        processedSource = new Blob([videoSource], { type: mappedMime });
      }
    }

    if (typeof processedSource === 'string') {
      videoUrl = processedSource;
    } else {
      videoUrl = URL.createObjectURL(processedSource);
    }
    videoEl.src = videoUrl;

    let nativeDecodeFailed = false;
    await new Promise<void>((resolve) => {
      if (!videoEl) {
        nativeDecodeFailed = true;
        resolve();
        return;
      }
      const onLoadedMetadata = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        nativeDecodeFailed = true;
        resolve();
      };
      const metaTimer = setTimeout(() => {
        cleanup();
        nativeDecodeFailed = true;
        resolve();
      }, 12000);
      const cleanup = () => {
        clearTimeout(metaTimer);
        videoEl?.removeEventListener('loadedmetadata', onLoadedMetadata);
        videoEl?.removeEventListener('error', onError);
      };

      videoEl.addEventListener('loadedmetadata', onLoadedMetadata, {
        once: true,
      });
      videoEl.addEventListener('error', onError, { once: true });

      if (videoEl.readyState >= 1) {
        cleanup();
        resolve();
      }
    });

    if (
      nativeDecodeFailed ||
      !videoEl.duration ||
      !Number.isFinite(videoEl.duration) ||
      videoEl.duration <= 0
    ) {
      throw new Error(
        'This video format or codec is not supported by your browser. Please upload a standard MP4 (H.264), WebM, or MOV video.'
      );
    }

    // Warm up decoder
    if (videoEl.readyState < 2 || !videoEl.videoWidth || !videoEl.videoHeight) {
      try {
        await seekVideo(videoEl, Math.min(0.05, videoEl.duration * 0.01), 3000);
      } catch (_) {}
    }

    const duration = videoEl.duration;
    let rawWidth = videoEl.videoWidth || 640;
    let rawHeight = videoEl.videoHeight || 360;
    const maxDim = 1600;
    let scaleFactor = Math.min(1, maxDim / Math.max(rawWidth, rawHeight));
    let videoWidth = Math.max(1, Math.round(rawWidth * scaleFactor));
    let videoHeight = Math.max(1, Math.round(rawHeight * scaleFactor));

    const cfgSample = VIDEO_TO_COMIC_CONFIG.sampling;
    const analysisW = cfgSample.analysisCanvasWidth;
    const analysisH = Math.max(
      90,
      Math.min(360, Math.round(analysisW * (rawHeight / Math.max(1, rawWidth))))
    );

    analysisCanvas = document.createElement('canvas');
    analysisCanvas.width = analysisW;
    analysisCanvas.height = analysisH;
    const analysisCtx = analysisCanvas.getContext('2d', {
      willReadFrequently: true,
    });
    if (!analysisCtx)
      throw new Error('Could not create 2D analysis canvas context.');

    const previewMaxDim = 320;
    let previewCtx: CanvasRenderingContext2D | null = null;
    if (includeDebugThumbnails) {
      const previewScale = Math.min(1, previewMaxDim / Math.max(1, rawWidth, rawHeight));
      previewCanvas = document.createElement('canvas');
      previewCanvas.width = Math.max(2, Math.round(rawWidth * previewScale));
      previewCanvas.height = Math.max(2, Math.round(rawHeight * previewScale));
      previewCtx = previewCanvas.getContext('2d');
    }

    // -------------------------------------------------------------------------
    // STAGE 1: Sample every 0.5 s (skipping the last 0.5 s) -> compact signatures
    // -------------------------------------------------------------------------
    const effectiveStep = Math.max(
      0.2,
      Math.max(stepSeconds, duration / cfgSample.maxAnalysisSamples)
    );
    const scanEndTime = Math.max(0.05, duration - cfgSample.skipTailSeconds);

    const signatures: FrameSignature[] = [];
    const totalScanSteps = Math.max(1, Math.ceil(scanEndTime / effectiveStep));
    let currentStep = 0;

    for (let t = 0; t < scanEndTime; t += effectiveStep) {
      if (isCancelled()) throw new Error('Video conversion cancelled by user.');

      currentStep++;
      if (currentStep % 4 === 0 || currentStep === 1) {
        await yieldToMainThread();
        const pct = Math.min(62, Math.round((t / scanEndTime) * 62));
        onProgress?.({
          phase: 'scanning',
          percent: pct,
          statusText: `Stage 1: Analyzing signatures (${Math.min(100, Math.round((t / scanEndTime) * 100))}%)...`,
          currentTime: t,
          totalDuration: duration,
          candidatesFound: signatures.length,
          currentStep,
          totalSteps: totalScanSteps,
        });
      }

      const seekOk = await seekVideo(videoEl, t, 5000);
      if (!seekOk) continue;

      if (
        videoEl.videoWidth > 0 &&
        videoEl.videoHeight > 0 &&
        (videoEl.videoWidth !== rawWidth || videoEl.videoHeight !== rawHeight)
      ) {
        rawWidth = videoEl.videoWidth;
        rawHeight = videoEl.videoHeight;
        scaleFactor = Math.min(1, maxDim / Math.max(rawWidth, rawHeight));
        videoWidth = Math.max(1, Math.round(rawWidth * scaleFactor));
        videoHeight = Math.max(1, Math.round(rawHeight * scaleFactor));
      }

      const actualTime = Number.isFinite(videoEl.currentTime)
        ? videoEl.currentTime
        : t;

      analysisCtx.drawImage(videoEl, 0, 0, analysisW, analysisH);
      const analysisImageData = analysisCtx.getImageData(
        0,
        0,
        analysisW,
        analysisH
      );

      let previewDataUrl: string | undefined;
      if (previewCtx && previewCanvas) {
        const previewScale = Math.min(
          1,
          previewMaxDim / Math.max(1, rawWidth, rawHeight)
        );
        const targetPreviewW = Math.max(2, Math.round(rawWidth * previewScale));
        const targetPreviewH = Math.max(2, Math.round(rawHeight * previewScale));
        if (
          previewCanvas.width !== targetPreviewW ||
          previewCanvas.height !== targetPreviewH
        ) {
          previewCanvas.width = targetPreviewW;
          previewCanvas.height = targetPreviewH;
        }
        previewCtx.drawImage(
          videoEl,
          0,
          0,
          previewCanvas.width,
          previewCanvas.height
        );
        previewDataUrl = previewCanvas.toDataURL(
          'image/jpeg',
          cfgSample.contactSheetJpegQuality
        );
      }

      const sig = computeFrameSignature(
        analysisImageData,
        actualTime,
        previewDataUrl,
        signatures.length
      );
      signatures.push(sig);
    }

    if (signatures.length === 0) {
      await seekVideo(videoEl, 0, 4000);
      analysisCtx.drawImage(videoEl, 0, 0, analysisW, analysisH);
      const imgData = analysisCtx.getImageData(0, 0, analysisW, analysisH);
      let fallbackPreview: string | undefined;
      if (previewCtx && previewCanvas) {
        previewCtx.drawImage(
          videoEl,
          0,
          0,
          previewCanvas.width,
          previewCanvas.height
        );
        fallbackPreview = previewCanvas.toDataURL(
          'image/jpeg',
          cfgSample.contactSheetJpegQuality
        );
      }
      signatures.push(computeFrameSignature(imgData, 0, fallbackPreview, 0));
    }

    populateSignatureStability(signatures);

    const session: CachedAnalysisSession = {
      durationSec: duration,
      sampleStepSec: effectiveStep,
      videoWidth,
      videoHeight,
      signatures,
    };
    onAnalysisCached?.(session);

    // -------------------------------------------------------------------------
    // STAGE 2 & STAGE 3: All Clear Frames + One Global Similarity Dedupe
    // -------------------------------------------------------------------------
    onProgress?.({
      phase: 'refining',
      percent: 66,
      statusText:
        'Stage 2 & 3: Filtering clear frames & global similarity clustering...',
      totalDuration: duration,
      candidatesFound: signatures.length,
    });
    await yieldToMainThread();

    const { clusters, report } = runGlobalStage2AndStage3(signatures, {
      strictness,
      simThresholdOverride,
      protectSubtitles,
      sampleStepSec: effectiveStep,
      durationSec: duration,
    });

    onDebugReport?.(report);

    // -------------------------------------------------------------------------
    // STAGE 4: Final Full-Resolution Capture for Chosen Cluster Representatives
    // -------------------------------------------------------------------------
    const finalKeyframes = await captureKeyframesForClusters(
      videoSource,
      session,
      clusters,
      report.sharpnessFloor,
      {
        imageFormat,
        imageQuality,
        onProgress,
        isCancelled,
        existingVideoElement: videoEl,
      }
    );

    return finalKeyframes;
  } finally {
    if (videoUrl && typeof videoSource !== 'string') {
      try {
        URL.revokeObjectURL(videoUrl);
      } catch (_) {}
    }

    if (videoEl) {
      try {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
        if (videoEl.parentNode) {
          videoEl.parentNode.removeChild(videoEl);
        }
      } catch (_) {}
      videoEl = null;
    }

    if (analysisCanvas) {
      analysisCanvas.width = 0;
      analysisCanvas.height = 0;
      analysisCanvas = null;
    }
    if (previewCanvas) {
      previewCanvas.width = 0;
      previewCanvas.height = 0;
      previewCanvas = null;
    }
  }
}
