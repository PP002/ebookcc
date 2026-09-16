/**
 * bubbleContour.ts
 *
 * Advanced vector geometry for Freehand Speech Bubbles:
 * - Preserves hand-drawn convex arrows, tails, and protrusions (never chops them off).
 * - Corner-preserving smoothing: silky-smooth vector curves along the bubble body,
 *   while maintaining crisp, razor-sharp vertices at corners and arrow/protrusion tips.
 * - Smooth C1/C2 cubic Bezier interpolation with sharp C0 cusps at feature vertices.
 */

import { recognizeSmartShape } from "./smartShapeRecognizer";

export interface ContourPoint {
  x: number;
  y: number;
}

/**
 * Calculates line segment intersection between (p1, p2) and (p3, p4).
 */
function getSegmentIntersection(
  p1: ContourPoint,
  p2: ContourPoint,
  p3: ContourPoint,
  p4: ContourPoint
): { point: ContourPoint; t: number; u: number } | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;

  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-7) return null;

  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;

  if (t >= 0.001 && t <= 0.999 && u >= 0.001 && u <= 0.999) {
    return {
      point: {
        x: p1.x + t * d1x,
        y: p1.y + t * d1y,
      },
      t,
      u,
    };
  }
  return null;
}

/**
 * Extracts a clean closed outer contour from raw freehand bubble points:
 * - Trims self-intersections and outer dangling line tails.
 * - Automatically removes overlapping internal lines, scribble marks, or crossing strokes inside the boundary,
 *   yielding a single, unified, clean outer contour.
 */
export function extractCleanOuterBoundary(rawPoints: ContourPoint[]): ContourPoint[] {
  if (!rawPoints || rawPoints.length < 4) return rawPoints ? [...rawPoints] : [];

  // Step 1: Distance filtering to eliminate duplicate / sub-pixel noise
  const filtered: ContourPoint[] = [rawPoints[0]];
  for (let i = 1; i < rawPoints.length; i++) {
    const prev = filtered[filtered.length - 1];
    const curr = rawPoints[i];
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) >= 0.4 || i === rawPoints.length - 1) {
      filtered.push(curr);
    }
  }

  const N = filtered.length;
  if (N < 4) return filtered;

  // Step 2: Find all segment-segment intersections
  interface IntersectionHit {
    i: number;
    j: number;
    point: ContourPoint;
    t: number;
    u: number;
  }

  const hits: IntersectionHit[] = [];
  for (let i = 0; i < N - 2; i++) {
    const p1 = filtered[i];
    const p2 = filtered[i + 1];
    for (let j = i + 2; j < N - 1; j++) {
      if (Math.abs(i - j) <= 1) continue;
      const p3 = filtered[j];
      const p4 = filtered[j + 1];

      const hit = getSegmentIntersection(p1, p2, p3, p4);
      if (hit && hit.t >= 0 && hit.t <= 1 && hit.u >= 0 && hit.u <= 1) {
        hits.push({ i, j, point: hit.point, t: hit.t, u: hit.u });
      }
    }
  }

  // If no self-intersections found, ensure simple closed loop
  if (hits.length === 0) {
    const result = [...filtered];
    const first = result[0];
    const last = result[result.length - 1];
    if (Math.hypot(last.x - first.x, last.y - first.y) > 0.001) {
      result.push({ x: first.x, y: first.y });
    }
    return result;
  }

  // If self-intersections exist (e.g. crossing start/end or crossing loops):
  // Find the primary enclosed boundary loop with maximum enclosed area
  let bestClosingHit: IntersectionHit | null = null;
  let maxLoopArea = 0;

  for (const h of hits) {
    const loop = [h.point, ...filtered.slice(h.i + 1, h.j + 1), h.point];
    let area = 0;
    for (let k = 0; k < loop.length - 1; k++) {
      area += loop[k].x * loop[k + 1].y - loop[k + 1].x * loop[k].y;
    }
    area = Math.abs(area) / 2;
    if (area > maxLoopArea) {
      maxLoopArea = area;
      bestClosingHit = h;
    }
  }

  if (bestClosingHit && maxLoopArea > 10) {
    // Return the closed inner loop; outer dangling tails (before i and after j) are cleanly discarded!
    return [
      bestClosingHit.point,
      ...filtered.slice(bestClosingHit.i + 1, bestClosingHit.j + 1),
      bestClosingHit.point,
    ];
  }

  // Fallback: connect endpoints
  const fallback = [...filtered];
  fallback.push({ x: fallback[0].x, y: fallback[0].y });
  return fallback;
}

/**
 * Resamples a closed polygon evenly along its cumulative arc length.
 * Eliminates sampling speed variations (jitter from slow drawing vs sparse fast drawing).
 */
export function resampleClosedLoop(points: ContourPoint[], targetCount: number = 100): ContourPoint[] {
  if (!points || points.length < 3) return points ? [...points] : [];

  // Ensure loop is closed
  const pts = [...points];
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (Math.hypot(last.x - first.x, last.y - first.y) > 0.001) {
    pts.push({ x: first.x, y: first.y });
  }

  // Calculate cumulative arc lengths
  const cumLengths: number[] = [0];
  let totalLength = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    totalLength += d;
    cumLengths.push(totalLength);
  }

  if (totalLength < 0.001) return pts.slice(0, 3);

  const step = totalLength / targetCount;
  const resampled: ContourPoint[] = [];

  let currentIdx = 0;
  for (let i = 0; i < targetCount; i++) {
    const targetDist = i * step;

    while (currentIdx < cumLengths.length - 1 && cumLengths[currentIdx + 1] < targetDist) {
      currentIdx++;
    }

    const segStartDist = cumLengths[currentIdx];
    const segEndDist = cumLengths[currentIdx + 1] || totalLength;
    const segLen = segEndDist - segStartDist;

    const t = segLen > 0 ? (targetDist - segStartDist) / segLen : 0;
    const pA = pts[currentIdx];
    const pB = pts[Math.min(currentIdx + 1, pts.length - 1)];

    resampled.push({
      x: pA.x + (pB.x - pA.x) * t,
      y: pA.y + (pB.y - pA.y) * t,
    });
  }

  return resampled;
}

/**
 * Conditional Arrow Tail & Corner Detection:
 * Analyzes the boundary curvature for a sharp convex projection (an acute triangular extension pointing outward).
 * If a sharp projection is present: Registers it as the speech bubble's pointer tail with an editable anchor handle.
 * If NO sharp projection is detected: Treats the shape as a simple oval/smooth bubble—does NOT force or auto-inject a tail arrow.
 */
export function detectSharpConvexProjection(
  points: ContourPoint[],
  angleThresholdDeg: number = 25
): { hasProjection: boolean; tipIndex: number | null; cornerIndices: number[] } {
  const N = points.length;
  if (N < 5) return { hasProjection: false, tipIndex: null, cornerIndices: [] };

  // 1. Centroid and distance distribution
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < N; i++) {
    cx += points[i].x;
    cy += points[i].y;
  }
  cx /= N;
  cy /= N;

  const radii = points.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const meanRadius = radii.reduce((sum, r) => sum + r, 0) / N;

  // Window size for computing turning angles (approx ~4-5% of total points)
  const k = Math.max(2, Math.round(N * 0.04));

  const candidateProtrusions: { index: number; rRatio: number; apexDeg: number; score: number }[] = [];
  const corners: number[] = [];

  for (let i = 0; i < N; i++) {
    const pPrev = points[(i - k + N) % N];
    const pCurr = points[i];
    const pNext = points[(i + k) % N];

    // Direction vectors to adjacent neighborhood
    const v1x = pPrev.x - pCurr.x;
    const v1y = pPrev.y - pCurr.y;
    const v2x = pNext.x - pCurr.x;
    const v2y = pNext.y - pCurr.y;

    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < 0.001 || len2 < 0.001) continue;

    const dot = v1x * v2x + v1y * v2y;
    const cosAngle = Math.max(-1, Math.min(1, dot / (len1 * len2)));
    const apexAngleDeg = (Math.acos(cosAngle) * 180) / Math.PI;

    // Turning angle at vertex
    const angleIn = Math.atan2(pCurr.y - pPrev.y, pCurr.x - pPrev.x);
    const angleOut = Math.atan2(pNext.y - pCurr.y, pNext.x - pCurr.x);
    let diff = Math.abs(angleOut - angleIn);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    const turnDeg = (diff * 180) / Math.PI;

    if (turnDeg >= angleThresholdDeg) {
      corners.push(i);
    }

    const r = radii[i];
    const rRatio = r / (meanRadius || 1);

    // Is it a local maximum in distance from centroid?
    const isLocalRadiusMax =
      r >= radii[(i - 1 + N) % N] &&
      r >= radii[(i + 1) % N] &&
      r >= radii[(i - 2 + N) % N] &&
      r >= radii[(i + 2) % N];

    // Outward orientation check: does the tip point away from centroid?
    const midX = (pPrev.x + pNext.x) / 2;
    const midY = (pPrev.y + pNext.y) / 2;
    const outDx = pCurr.x - cx;
    const outDy = pCurr.y - cy;
    const tipDx = pCurr.x - midX;
    const tipDy = pCurr.y - midY;
    const pointsOutward = outDx * tipDx + outDy * tipDy > 0;

    // Acute triangular extension pointing outward:
    // - Local radius peak protruding substantially beyond mean body radius (>= 1.20)
    // - Acute apex angle (<= 85 deg)
    // - Sharp turning angle (>= 90 deg)
    // - Extends outward away from center
    if (
      isLocalRadiusMax &&
      rRatio >= 1.20 &&
      apexAngleDeg <= 85 &&
      turnDeg >= 90 &&
      pointsOutward
    ) {
      candidateProtrusions.push({
        index: i,
        rRatio,
        apexDeg: apexAngleDeg,
        score: rRatio * 2 + (180 - apexAngleDeg) / 45,
      });
    }
  }

  // Non-maximum suppression: merge corner candidates too close along the loop
  const minSeparation = Math.max(3, Math.round(N * 0.05));
  const suppressedCorners: number[] = [];
  for (const c of corners) {
    if (!suppressedCorners.some((sc) => Math.min(Math.abs(sc - c), N - Math.abs(sc - c)) < minSeparation)) {
      suppressedCorners.push(c);
    }
  }

  let tipIndex: number | null = null;
  if (candidateProtrusions.length > 0) {
    // Select the most prominent acute outward projection
    candidateProtrusions.sort((a, b) => b.score - a.score);
    tipIndex = candidateProtrusions[0].index;
    if (!suppressedCorners.includes(tipIndex)) {
      suppressedCorners.push(tipIndex);
    }
  }

  suppressedCorners.sort((a, b) => a - b);

  return {
    hasProjection: tipIndex !== null,
    tipIndex,
    cornerIndices: suppressedCorners,
  };
}

/**
 * Identifies sharp corners and outward protrusions (e.g. convex arrow tips and tail vertices).
 * Backwards-compatible wrapper around detectSharpConvexProjection.
 */
export function detectCornersAndProtrusions(
  points: ContourPoint[],
  angleThresholdDeg: number = 50
): { cornerIndices: number[]; tipIndex: number | null } {
  const res = detectSharpConvexProjection(points, angleThresholdDeg);
  return {
    cornerIndices: res.cornerIndices,
    tipIndex: res.tipIndex,
  };
}

/**
 * Endpoint-anchored smoothing.
 * Smooths the intermediate points of each segment while keeping detected sharp corners
 * strictly anchored in place to preserve sharp arrow tips and vertices.
 */
export function smoothContourPreservingCorners(
  points: ContourPoint[],
  cornerIndices: number[],
  passes: number = 2
): ContourPoint[] {
  const N = points.length;
  if (N < 5) return points;

  // If no sharp corners detected, smooth entire loop cyclically
  if (cornerIndices.length === 0) {
    let current = points.map((p) => ({ ...p }));
    for (let p = 0; p < passes; p++) {
      const next: ContourPoint[] = [];
      for (let i = 0; i < N; i++) {
        const pPrev = current[(i - 1 + N) % N];
        const pCurr = current[i];
        const pNext = current[(i + 1) % N];
        next.push({
          x: pPrev.x * 0.2 + pCurr.x * 0.6 + pNext.x * 0.2,
          y: pPrev.y * 0.2 + pCurr.y * 0.6 + pNext.y * 0.2,
        });
      }
      current = next;
    }
    return current;
  }

  const cornerSet = new Set(cornerIndices);
  let current = points.map((p) => ({ ...p }));

  for (let p = 0; p < passes; p++) {
    const next: ContourPoint[] = current.map((pt) => ({ ...pt }));

    for (let i = 0; i < N; i++) {
      // Corner vertices remain strictly anchored!
      if (cornerSet.has(i)) {
        continue;
      }

      const pPrev = current[(i - 1 + N) % N];
      const pCurr = current[i];
      const pNext = current[(i + 1) % N];

      next[i] = {
        x: pPrev.x * 0.22 + pCurr.x * 0.56 + pNext.x * 0.22,
        y: pPrev.y * 0.22 + pCurr.y * 0.56 + pNext.y * 0.22,
      };
    }
    current = next;
  }

  return current;
}

/**
 * Builds an SVG path string `d` with:
 * - Crisp, razor-sharp C0 cusps at sharp corners / arrow tips
 * - Silky-smooth C1 cubic Bezier splines along curves between corners
 */
export function generateBubbleSvgPath(
  points: ContourPoint[],
  cornerIndices: number[] = []
): string {
  const N = points.length;
  if (N < 3) return '';

  // Case 1: No corners -> smooth closed cubic spline
  if (cornerIndices.length === 0) {
    let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let i = 0; i < N; i++) {
      const p0 = points[(i - 1 + N) % N];
      const p1 = points[i];
      const p2 = points[(i + 1) % N];
      const p3 = points[(i + 2) % N];

      // Catmull-Rom to Cubic Bezier control points
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
    }
    d += ' Z';
    return d;
  }

  // Case 2: One or more sharp corners / arrow tips
  // Partition into segments between corners
  const sortedCorners = [...cornerIndices].sort((a, b) => a - b);
  const startIdx = sortedCorners[0];

  let d = `M ${points[startIdx].x.toFixed(2)} ${points[startIdx].y.toFixed(2)}`;

  const numCorners = sortedCorners.length;
  for (let c = 0; c < numCorners; c++) {
    const cCurrent = sortedCorners[c];
    const cNext = sortedCorners[(c + 1) % numCorners];

    // Collect points for segment from cCurrent to cNext
    const segPts: ContourPoint[] = [];
    let idx = cCurrent;
    while (true) {
      segPts.push(points[idx]);
      if (idx === cNext) break;
      idx = (idx + 1) % N;
    }

    const segLen = segPts.length;
    if (segLen === 2) {
      // Direct sharp line between adjacent corners
      d += ` L ${segPts[1].x.toFixed(2)} ${segPts[1].y.toFixed(2)}`;
    } else if (segLen > 2) {
      // Smooth cubic curve along the segment, with clamped one-sided tangents at the corner ends
      for (let i = 0; i < segLen - 1; i++) {
        const p1 = segPts[i];
        const p2 = segPts[i + 1];

        // Start tangent
        let t1x: number, t1y: number;
        if (i === 0) {
          // Sharp cusp leaving the corner: tangent points along the edge
          t1x = p2.x - p1.x;
          t1y = p2.y - p1.y;
        } else {
          t1x = (p2.x - segPts[i - 1].x) / 2;
          t1y = (p2.y - segPts[i - 1].y) / 2;
        }

        // End tangent
        let t2x: number, t2y: number;
        if (i === segLen - 2) {
          // Sharp cusp arriving at the corner: tangent points along the edge
          t2x = p2.x - p1.x;
          t2y = p2.y - p1.y;
        } else {
          t2x = (segPts[i + 2].x - p1.x) / 2;
          t2y = (segPts[i + 2].y - p1.y) / 2;
        }

        const cp1x = p1.x + t1x / 3;
        const cp1y = p1.y + t1y / 3;
        const cp2x = p2.x - t2x / 3;
        const cp2y = p2.y - t2y / 3;

        d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
      }
    }
  }

  d += ' Z';
  return d;
}

/**
 * Generates a smooth, professional manga-style rounded rectangular dialogue contour.
 */
export function generateMangaRoundedBoxContour(
  minX: number = 5,
  maxX: number = 95,
  minY: number = 5,
  maxY: number = 95,
  cornerRadius: number = 10
): ContourPoint[] {
  const balanced: ContourPoint[] = [];
  const stepsPerSide = 16;
  const left = minX;
  const right = maxX;
  const top = minY;
  const bottom = maxY;

  // Arc TR: top edge to right edge
  for (let i = 0; i <= stepsPerSide; i++) {
    const th = -Math.PI / 2 + (i / stepsPerSide) * (Math.PI / 2);
    balanced.push({
      x: right - cornerRadius + cornerRadius * Math.cos(th),
      y: top + cornerRadius + cornerRadius * Math.sin(th),
    });
  }
  // Arc BR: right edge to bottom edge
  for (let i = 0; i <= stepsPerSide; i++) {
    const th = (i / stepsPerSide) * (Math.PI / 2);
    balanced.push({
      x: right - cornerRadius + cornerRadius * Math.cos(th),
      y: bottom - cornerRadius + cornerRadius * Math.sin(th),
    });
  }
  // Arc BL: bottom edge to left edge
  for (let i = 0; i <= stepsPerSide; i++) {
    const th = Math.PI / 2 + (i / stepsPerSide) * (Math.PI / 2);
    balanced.push({
      x: left + cornerRadius + cornerRadius * Math.cos(th),
      y: bottom - cornerRadius + cornerRadius * Math.sin(th),
    });
  }
  // Arc TL: left edge to top edge
  for (let i = 0; i <= stepsPerSide; i++) {
    const th = Math.PI + (i / stepsPerSide) * (Math.PI / 2);
    balanced.push({
      x: left + cornerRadius + cornerRadius * Math.cos(th),
      y: top + cornerRadius + cornerRadius * Math.sin(th),
    });
  }

  return resampleClosedLoop(balanced, 64);
}

/**
 * Checks if a closed contour approximates an ellipse/oval or circle using the exact same
 * principal covariance and geometric analysis as Smart Shape recognition.
 * Balances its control points into a smooth, professional manga-style contour.
 */
function balanceMangaOvalContour(
  points: ContourPoint[],
  tipIndex: number | null
): ContourPoint[] | null {
  const N = points.length;
  if (N < 10) return null;

  const tailExcludeRadius = Math.max(3, Math.floor(N * 0.08));

  // Collect sample points excluding the tail tip region
  const samplePts: ContourPoint[] = [];
  for (let i = 0; i < N; i++) {
    if (tipIndex !== null) {
      const distToTip = Math.min(Math.abs(i - tipIndex), N - Math.abs(i - tipIndex));
      if (distToTip <= tailExcludeRadius) continue;
    }
    samplePts.push(points[i]);
  }

  if (samplePts.length < 5) return null;

  const sampleN = samplePts.length;
  let sumX = 0, sumY = 0;
  for (const p of samplePts) {
    sumX += p.x;
    sumY += p.y;
  }
  const meanX = sumX / sampleN;
  const meanY = sumY / sampleN;

  let covXX = 0, covYY = 0, covXY = 0;
  for (const p of samplePts) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    covXX += dx * dx;
    covYY += dy * dy;
    covXY += dx * dy;
  }
  covXX /= sampleN;
  covYY /= sampleN;
  covXY /= sampleN;

  // Principal orientation
  let phi = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
  const phiDeg = (Math.abs((phi * 180) / Math.PI)) % 90;
  if (phiDeg <= 12 || phiDeg >= 78) {
    phi = Math.round(phi / (Math.PI / 2)) * (Math.PI / 2);
  }

  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  const uvs: { u: number; v: number }[] = [];
  for (const p of samplePts) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    const u = dx * cosPhi + dy * sinPhi;
    const v = -dx * sinPhi + dy * cosPhi;
    uvs.push({ u, v });
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }

  const uW = maxU - minU;
  const vH = maxV - minV;
  const cU = (minU + maxU) / 2;
  const cV = (minV + maxV) / 2;
  let a = Math.max(4, uW / 2);
  let b = Math.max(4, vH / 2);

  const trueCx = meanX + cU * cosPhi - cV * sinPhi;
  const trueCy = meanY + cU * sinPhi + cV * cosPhi;

  let totalNormError = 0;
  for (const { u, v } of uvs) {
    const du = (u - cU) / a;
    const dv = (v - cV) / b;
    const norm = Math.hypot(du, dv);
    totalNormError += Math.abs(norm - 1);
  }

  const meanError = totalNormError / sampleN;
  if (meanError > 0.35) {
    return null;
  }

  const aspect = Math.min(a, b) / Math.max(a, b);
  const isCircle = aspect >= 0.76;
  if (isCircle) {
    const R = (a + b) / 2;
    a = R;
    b = R;
  }

  // 1. If no tail tip, produce smooth, seamless circle or oval
  if (tipIndex === null) {
    const balanced: ContourPoint[] = [];
    const steps = 64;
    for (let i = 0; i < steps; i++) {
      const theta = (i / steps) * 2 * Math.PI;
      const u = a * Math.cos(theta);
      const v = b * Math.sin(theta);
      balanced.push({
        x: trueCx + u * cosPhi - v * sinPhi,
        y: trueCy + u * sinPhi + v * cosPhi,
      });
    }
    return balanced;
  }

  // 2. If tail tip exists, preserve anchored tip and smoothly blend body
  const balanced: ContourPoint[] = [];
  for (let i = 0; i < N; i++) {
    const distToTip = Math.min(Math.abs(i - tipIndex), N - Math.abs(i - tipIndex));
    if (distToTip === 0) {
      balanced.push({ x: points[i].x, y: points[i].y });
    } else if (distToTip <= tailExcludeRadius) {
      const blendWeight = distToTip / tailExcludeRadius;
      const pt = points[i];
      const dx = pt.x - trueCx;
      const dy = pt.y - trueCy;
      const u = dx * cosPhi + dy * sinPhi;
      const v = -dx * sinPhi + dy * cosPhi;
      const theta = Math.atan2(v, u);
      const ovalU = a * Math.cos(theta);
      const ovalV = b * Math.sin(theta);
      const ovalX = trueCx + ovalU * cosPhi - ovalV * sinPhi;
      const ovalY = trueCy + ovalU * sinPhi + ovalV * cosPhi;
      balanced.push({
        x: pt.x * (1 - blendWeight * 0.85) + ovalX * (blendWeight * 0.85),
        y: pt.y * (1 - blendWeight * 0.85) + ovalY * (blendWeight * 0.85),
      });
    } else {
      const pt = points[i];
      const dx = pt.x - trueCx;
      const dy = pt.y - trueCy;
      const u = dx * cosPhi + dy * sinPhi;
      const v = -dx * sinPhi + dy * cosPhi;
      const theta = Math.atan2(v, u);
      const ovalU = a * Math.cos(theta);
      const ovalV = b * Math.sin(theta);
      balanced.push({
        x: trueCx + ovalU * cosPhi - ovalV * sinPhi,
        y: trueCy + ovalU * sinPhi + ovalV * cosPhi,
      });
    }
  }
  return balanced;
}

/**
 * Checks if a closed contour approximates a rectangle/box, and if so,
 * balances its control points into a smooth, professional manga-style rounded rectangular dialogue contour.
 */
function balanceMangaRectangleContour(
  points: ContourPoint[],
  cornerIndices: number[],
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): ContourPoint[] | null {
  const N = points.length;
  if (N < 12) return null;

  if (cornerIndices.length !== 4) return null;

  const w = maxX - minX;
  const h = maxY - minY;
  if (w < 10 || h < 10) return null;

  const cornerRadius = Math.max(4, Math.min(12, Math.min(w, h) * 0.15));
  return generateMangaRoundedBoxContour(minX, maxX, minY, maxY, cornerRadius);
}

/**
 * High-level processor: takes raw points from mouse/stylus drawing,
 * applies the exact same transform logic as Smart Shape,
 * cleans up self-intersections and overlapping internal lines,
 * scales into [5, 95] bounding box, detects whether an acute outward arrow projection exists,
 * and produces smoothed vector points.
 */
export function processFreehandBubblePoints(rawPoints: ContourPoint[]): {
  normalizedPoints: ContourPoint[];
  initialTailX: number;
  initialTailY: number;
  hasArrow: boolean;
} {
  if (!rawPoints || rawPoints.length < 3) {
    return {
      normalizedPoints: [],
      initialTailX: 50,
      initialTailY: 50,
      hasArrow: false,
    };
  }

  // 1. Direct Smart Shape recognition check:
  // Use the exact same transform logic as Smart Shape
  const smart = recognizeSmartShape(rawPoints);
  if (smart && smart.points && smart.points.length >= 3) {
    if (smart.type !== 'line' && (smart.type as string) !== 'polyline' && (smart.type as string) !== 'curve') {
      const xs = smart.points.map((p) => p.x);
      const ys = smart.points.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const strokeW = Math.max(0.001, maxX - minX);
      const strokeH = Math.max(0.001, maxY - minY);

      let normalizedPoints = smart.points.map((p) => ({
        x: Math.max(4, Math.min(96, ((p.x - minX) / strokeW) * 90 + 5)),
        y: Math.max(4, Math.min(96, ((p.y - minY) / strokeH) * 90 + 5)),
      }));

      if (smart.type === 'rectangle') {
        normalizedPoints = generateMangaRoundedBoxContour(5, 95, 5, 95);
      }

      return {
        normalizedPoints,
        initialTailX: 50,
        initialTailY: 50,
        hasArrow: false,
      };
    }
  }

  // 2. Clean closed shape: apply self-intersection trimming to discard outer dangling tails
  // and remove overlapping internal lines / scribble marks yielding a single clean outer boundary
  const cleanOuter = extractCleanOuterBoundary(rawPoints);

  // Check Smart Shape recognition on the clean outer boundary
  const smartClean = recognizeSmartShape(cleanOuter);
  if (smartClean && smartClean.points && smartClean.points.length >= 3) {
    if (smartClean.type !== 'line' && (smartClean.type as string) !== 'polyline' && (smartClean.type as string) !== 'curve') {
      const xs = smartClean.points.map((p) => p.x);
      const ys = smartClean.points.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const strokeW = Math.max(0.001, maxX - minX);
      const strokeH = Math.max(0.001, maxY - minY);

      let normalizedPoints = smartClean.points.map((p) => ({
        x: Math.max(4, Math.min(96, ((p.x - minX) / strokeW) * 90 + 5)),
        y: Math.max(4, Math.min(96, ((p.y - minY) / strokeH) * 90 + 5)),
      }));

      if (smartClean.type === 'rectangle') {
        normalizedPoints = generateMangaRoundedBoxContour(5, 95, 5, 95);
      }

      return {
        normalizedPoints,
        initialTailX: 50,
        initialTailY: 50,
        hasArrow: false,
      };
    }
  }

  // 3. Calculate bounding box and normalize into 5..95 coordinate space
  const xs = cleanOuter.map((p) => p.x);
  const ys = cleanOuter.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const strokeW = Math.max(0.001, maxX - minX);
  const strokeH = Math.max(0.001, maxY - minY);

  const normRaw = cleanOuter.map((p) => ({
    x: Math.max(4, Math.min(96, ((p.x - minX) / strokeW) * 90 + 5)),
    y: Math.max(4, Math.min(96, ((p.y - minY) / strokeH) * 90 + 5)),
  }));

  // 4. Resample to uniform spacing
  const resampled = resampleClosedLoop(normRaw, 100);

  // 5. Detect acute outward projection (tail arrow) and sharp corners (>= 50 deg)
  const { hasProjection, tipIndex, cornerIndices } = detectSharpConvexProjection(resampled, 50);

  // 6. Symmetry & Balance check using the exact same transform logic as Smart Shape:
  // If the drawn shape closely approximates an oval/circle or rectangle, automatically adjust control points
  // to produce smooth, professional manga-style contours.
  const nMinX = 5, nMaxX = 95, nMinY = 5, nMaxY = 95;
  let balancedContour: ContourPoint[] | null = null;

  // Try oval / circle approximation
  balancedContour = balanceMangaOvalContour(resampled, tipIndex);

  // If not oval, check if it approximates a rectangular dialogue box
  if (!balancedContour && cornerIndices.length === 4) {
    balancedContour = balanceMangaRectangleContour(resampled, cornerIndices, nMinX, nMaxX, nMinY, nMaxY);
  }

  // 7. Smooth with corner-preserving anchor
  let smoothed = balancedContour
    ? balancedContour
    : smoothContourPreservingCorners(resampled, cornerIndices, 6);

  // Re-verify that tip is anchored if projection exists
  const hasArrow = hasProjection && tipIndex !== null && tipIndex >= 0 && tipIndex < smoothed.length;
  let initialTailX = 50;
  let initialTailY = 50;

  if (hasArrow && tipIndex !== null) {
    initialTailX = Math.round(smoothed[tipIndex].x);
    initialTailY = Math.round(smoothed[tipIndex].y);
  }

  return {
    normalizedPoints: smoothed,
    initialTailX,
    initialTailY,
    hasArrow,
  };
}
