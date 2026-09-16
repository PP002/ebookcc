export interface Point {
  x: number;
  y: number;
  pressure?: number;
}

export interface RecognizedShape {
  type: 'line' | 'circle' | 'ellipse' | 'triangle' | 'rectangle' | 'polygon' | 'polyline' | 'curve';
  label: string;
  points: Point[];
}

/**
 * Lightweight RDP and distance pre-processing of stroke points
 * Sub-samples redundant points and reduces vertex count before classification
 * to ensure lightning-fast execution (< 2ms, well within the 10ms threshold).
 */
export function preprocessStrokePoints(points: Point[]): Point[] {
  if (!points || points.length <= 3) return points ? [...points] : [];

  // 1. Fast Euclidean distance threshold filter
  const filtered: Point[] = [points[0]];
  const minDistSq = 0.5 * 0.5;
  for (let i = 1; i < points.length; i++) {
    const prev = filtered[filtered.length - 1];
    const curr = points[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    if (dx * dx + dy * dy >= minDistSq || i === points.length - 1) {
      filtered.push(curr);
    }
  }

  if (filtered.length <= 6) return filtered;

  // 2. Fast bounding box diagonal for adaptive epsilon
  let minX = filtered[0].x, maxX = filtered[0].x, minY = filtered[0].y, maxY = filtered[0].y;
  for (let i = 1; i < filtered.length; i++) {
    const p = filtered[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const epsilon = Math.max(0.6, diag * 0.007);

  let simplified = douglasPeucker(filtered, epsilon);
  if (simplified.length > 75) {
    simplified = douglasPeucker(simplified, epsilon * 1.6);
  }
  return simplified;
}

/**
 * Calculates intersection between two line segments (p1, p2) and (p3, p4).
 * Returns intersection point if they cross inside [0, 1] bounds, else null.
 */
export function getLineSegmentIntersection(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point
): { point: Point; t: number; u: number } | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;

  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-8) return null;

  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;

  // Accept intersection within segment bounds (with small margin for slight undershoot/overshoot)
  if (t >= -0.05 && t <= 1.05 && u >= -0.05 && u <= 1.05) {
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
 * Computes polygon area using the Shoelace formula
 */
function computePolygonArea(pts: Point[]): number {
  if (pts.length < 3) return 0;
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Detects if a stroke self-intersects (such as overlapping start/end strokes or crossing loops),
 * extracts the enclosed inner path, and discards outer dangling line tails.
 */
export function extractSelfIntersectingEnclosedLoop(points: Point[]): Point[] | null {
  if (points.length < 5) return null;

  let bestLoop: Point[] | null = null;
  let maxArea = 0;
  const N = points.length;

  for (let i = 0; i < N - 3; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    for (let j = i + 2; j < N - 1; j++) {
      if (Math.abs(i - j) <= 1) continue;

      const p3 = points[j];
      const p4 = points[j + 1];

      const hit = getLineSegmentIntersection(p1, p2, p3, p4);
      if (hit && hit.t >= 0 && hit.t <= 1 && hit.u >= 0 && hit.u <= 1) {
        // Enclosed inner cycle from intersection point through intermediate stroke points
        const innerCycle: Point[] = [
          hit.point,
          ...points.slice(i + 1, j + 1),
          hit.point,
        ];

        const area = computePolygonArea(innerCycle);
        if (area > maxArea) {
          maxArea = area;
          bestLoop = innerCycle;
        }
      }
    }
  }

  // Must have meaningful enclosed area
  if (bestLoop && maxArea > 15) {
    return bestLoop;
  }
  return null;
}

function getLinesIntersectionOrProximity(p1: Point, p2: Point, p3: Point, p4: Point, threshold: number): Point | null {
  const int = getLineSegmentIntersection(p1, p2, p3, p4);
  if (int) return int.point;

  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;

  if (Math.abs(denom) >= 1e-8) {
    const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
    const P = { x: p1.x + t * d1x, y: p1.y + t * d1y };
    
    // Check if the intersection point is close to the endpoints of both segments
    const t1 = Math.max(0, Math.min(1, t));
    const u1 = Math.max(0, Math.min(1, ((P.x - p3.x) * d2x + (P.y - p3.y) * d2y) / (d2x*d2x + d2y*d2y)));
    
    const nearestP1 = { x: p3.x + u1 * d2x, y: p3.y + u1 * d2y };
    const nearestP2 = { x: p1.x + t1 * d1x, y: p1.y + t1 * d1y };
    
    const dist1 = Math.hypot(P.x - nearestP2.x, P.y - nearestP2.y);
    const dist2 = Math.hypot(P.x - nearestP1.x, P.y - nearestP1.y);
    
    if (dist1 < threshold && dist2 < threshold) {
      return P;
    }
  }

  const dists = [
    Math.hypot(p1.x - p3.x, p1.y - p3.y),
    Math.hypot(p1.x - p4.x, p1.y - p4.y),
    Math.hypot(p2.x - p3.x, p2.y - p3.y),
    Math.hypot(p2.x - p4.x, p2.y - p4.y),
  ];
  const minD = Math.min(...dists);
  if (minD < threshold) {
    if (minD === dists[0]) return { x: (p1.x + p3.x)/2, y: (p1.y + p3.y)/2 };
    if (minD === dists[1]) return { x: (p1.x + p4.x)/2, y: (p1.y + p4.y)/2 };
    if (minD === dists[2]) return { x: (p2.x + p3.x)/2, y: (p2.y + p3.y)/2 };
    if (minD === dists[3]) return { x: (p2.x + p4.x)/2, y: (p2.y + p4.y)/2 };
  }

  return null;
}

/**
 * Detects if the current stroke crosses with recent line strokes in the drawing
 * to form a closed enclosed polygon (triangle or rectangle/quadrilateral).
 * Discards outer dangling tails and converts into a single clean Polygon.
 */
export function detectMultiStrokeIntersectionPolygon(
  currentPoints: Point[],
  recentStrokes: { id: string; points: Point[]; layerId?: string }[],
  activeLayerId?: string
): { shape: RecognizedShape; consumedStrokeIds: string[] } | null {
  if (!currentPoints || currentPoints.length < 2) return null;

  // Filter candidate previous strokes on the same layer that look like straight lines
  const candidates = recentStrokes
    .filter((s) => !activeLayerId || !s.layerId || s.layerId === activeLayerId)
    .filter((s) => {
      // Only merge straight-line shapes
      const isLine = (s as any).smartShapeType === 'line';
      // Fallback check if smartShapeType is not strictly set but it's a 2-point line
      return isLine || (!('smartShapeType' in s) && s.points && s.points.length === 2);
    })
    .slice(-5); // Look at recent strokes

  if (candidates.length < 2) return null;

  const currP1 = currentPoints[0];
  const currP2 = currentPoints[currentPoints.length - 1];

  // Try 3 strokes (Triangle): Current stroke + 2 recent strokes
  for (let a = candidates.length - 1; a >= 0; a--) {
    for (let b = a - 1; b >= 0; b--) {
      const sA = candidates[a];
      const sB = candidates[b];

      const pA1 = sA.points[0];
      const pA2 = sA.points[sA.points.length - 1];
      const pB1 = sB.points[0];
      const pB2 = sB.points[sB.points.length - 1];

      // Check intersections or proximity: (Curr, sA), (sA, sB), (sB, Curr)
      const intCA = getLinesIntersectionOrProximity(currP1, currP2, pA1, pA2, 5);
      const intAB = getLinesIntersectionOrProximity(pA1, pA2, pB1, pB2, 5);
      const intBC = getLinesIntersectionOrProximity(pB1, pB2, currP1, currP2, 5);

      if (intCA && intAB && intBC) {
        // Enclosed triangle from inner intersection vertices, outer tails discarded!
        const trianglePts: Point[] = [
          intCA,
          intAB,
          intBC,
          intCA,
        ];
        const area = computePolygonArea(trianglePts);
        if (area > 20) {
          return {
            shape: {
              type: 'triangle',
              label: 'Triangle',
              points: trianglePts,
            },
            consumedStrokeIds: [sA.id, sB.id],
          };
        }
      }
    }
  }

  // Try 4 strokes (Quadrilateral / Rectangle): Current stroke + 3 recent strokes
  if (candidates.length >= 3) {
    const s1 = candidates[candidates.length - 3];
    const s2 = candidates[candidates.length - 2];
    const s3 = candidates[candidates.length - 1];

    const p1a = s1.points[0], p1b = s1.points[s1.points.length - 1];
    const p2a = s2.points[0], p2b = s2.points[s2.points.length - 1];
    const p3a = s3.points[0], p3b = s3.points[s3.points.length - 1];

    // Cyclic test: Curr -> s1 -> s2 -> s3 -> Curr
    const intC1 = getLinesIntersectionOrProximity(currP1, currP2, p1a, p1b, 5);
    const int12 = getLinesIntersectionOrProximity(p1a, p1b, p2a, p2b, 5);
    const int23 = getLinesIntersectionOrProximity(p2a, p2b, p3a, p3b, 5);
    const int3C = getLinesIntersectionOrProximity(p3a, p3b, currP1, currP2, 5);

    if (intC1 && int12 && int23 && int3C) {
      const quadPts: Point[] = [
        intC1,
        int12,
        int23,
        int3C,
        intC1,
      ];
      const area = computePolygonArea(quadPts);
      if (area > 30) {
        return {
          shape: {
            type: 'rectangle',
            label: 'Rectangle',
            points: quadPts,
          },
          consumedStrokeIds: [s1.id, s2.id, s3.id],
        };
      }
    }
  }

  return null;
}

/**
 * Converts an isolated closed inner loop into a clean Polygon object
 */
export function checkPolygonFromClosedLoop(loop: Point[]): RecognizedShape | null {
  if (loop.length < 4) return null;

  let minX = loop[0].x, maxX = loop[0].x, minY = loop[0].y, maxY = loop[0].y;
  for (const pt of loop) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const diag = Math.hypot(w, h);
  if (w < 2.5 || h < 2.5 || diag < 3.5) return null;

  const epsilon = Math.max(1.0, diag * 0.038);
  let simplified = douglasPeucker(loop, epsilon);

  // Ensure closed loop
  if (simplified.length >= 3) {
    const d = Math.hypot(
      simplified[0].x - simplified[simplified.length - 1].x,
      simplified[0].y - simplified[simplified.length - 1].y
    );
    if (d < diag * 0.3) {
      simplified[simplified.length - 1] = { ...simplified[0] };
    }
  }

  let uniqueVertices =
    simplified.length > 2 &&
    Math.hypot(
      simplified[0].x - simplified[simplified.length - 1].x,
      simplified[0].y - simplified[simplified.length - 1].y
    ) < 0.1
      ? simplified.slice(0, -1)
      : simplified;

  uniqueVertices = filterCollinearVertices(uniqueVertices);
  const numCorners = uniqueVertices.length;

  if (numCorners === 3) {
    return {
      type: 'triangle',
      label: 'Triangle',
      points: [
        uniqueVertices[0],
        uniqueVertices[1],
        uniqueVertices[2],
        uniqueVertices[0],
      ],
    };
  }

  if (numCorners === 4) {
    return {
      type: 'rectangle',
      label: 'Rectangle',
      points: [
        uniqueVertices[0],
        uniqueVertices[1],
        uniqueVertices[2],
        uniqueVertices[3],
        uniqueVertices[0],
      ],
    };
  }

  if (numCorners >= 5 && numCorners <= 10) {
    return {
      type: 'polygon',
      label: 'Polygon',
      points: [...uniqueVertices, uniqueVertices[0]],
    };
  }

  return {
    type: 'polygon',
    label: 'Polygon',
    points: loop,
  };
}

/**
 * Calculates perpendicular distance from point p to line segment (p1, p2)
 */
function getPerpendicularDistance(p: Point, p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(p.x - p1.x, p.y - p1.y);
  }
  const num = Math.abs(dy * p.x - dx * p.y + p2.x * p1.y - p2.y * p1.x);
  return num / Math.sqrt(lenSq);
}

/**
 * Ramer-Douglas-Peucker line simplification algorithm
 */
function douglasPeucker(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;

  let dmax = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const d = getPerpendicularDistance(points[i], points[0], points[end]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const rec1 = douglasPeucker(points.slice(0, index + 1), epsilon);
    const rec2 = douglasPeucker(points.slice(index), epsilon);
    return rec1.slice(0, rec1.length - 1).concat(rec2);
  } else {
    return [points[0], points[end]];
  }
}

/**
 * Computes windowed turning angles to detect sharp corner features along a closed or open stroke.
 * Returns the count of sharp corners (> 35 degrees) and maximum turning angle.
 */
function analyzeStrokeCorners(
  points: Point[],
  diag: number
): { sharpCornersCount: number; maxTurnDeg: number } {
  const N = points.length;
  if (N < 4) return { sharpCornersCount: 0, maxTurnDeg: 0 };

  const k = Math.max(2, Math.round(N * 0.04));
  let sharpCornersCount = 0;
  let maxTurnDeg = 0;

  // Ignore start and end artifacts (hooks, overlapping tails) by narrowing the window
  const trimSize = Math.max(k, Math.floor(N * 0.1));
  const startIdx = trimSize;
  const endIdx = N - trimSize;

  for (let i = startIdx; i < endIdx; i++) {
    const pPrev = points[i - k];
    const pCurr = points[i];
    const pNext = points[i + k];

    const v1x = pCurr.x - pPrev.x;
    const v1y = pCurr.y - pPrev.y;
    const v2x = pNext.x - pCurr.x;
    const v2y = pNext.y - pCurr.y;

    const angle1 = Math.atan2(v1y, v1x);
    const angle2 = Math.atan2(v2y, v2x);

    let diff = Math.abs(angle2 - angle1);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    const diffDeg = (diff * 180) / Math.PI;

    if (diffDeg > maxTurnDeg) {
      maxTurnDeg = diffDeg;
    }

    if (diffDeg >= 60) {
      // True sharp polygonal corner peak (NOT normal smooth circle curvature)
      sharpCornersCount++;
      i += k; // Skip forward past corner neighborhood
    }
  }

  return { sharpCornersCount, maxTurnDeg };
}

/**
 * Straight Line recognition
 * Checks if curvature is below threshold and aspect ratio / chord length is high.
 * STRICTLY rejects strokes with noticeable bends, chevrons, or convex arrows.
 */
function checkStraightLine(
  points: Point[],
  totalArcLength: number,
  chordLength: number,
  p0: Point,
  pEnd: Point
): RecognizedShape | null {
  if (chordLength < 1.5) return null; // Too small (single dot/click)

  // Ratio of straight chord distance to total drawn trajectory length
  // For a straight line, chord / arcLength is close to 1.0 (>= 0.88)
  const lengthRatio = chordLength / (totalArcLength || 1);
  if (lengthRatio < 0.88) return null;

  // CRITICAL: A straight line must not have convex bends, chevrons, or corners (like an arrow).
  // If the stroke has an acute or noticeable turn (> 24 deg), do not convert to a straight line!
  const { maxTurnDeg } = analyzeStrokeCorners(points, chordLength);
  if (maxTurnDeg > 24) {
    return null;
  }

  // Measure max and average perpendicular deviation from the straight chord
  let maxDev = 0;
  let totalDev = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const dev = getPerpendicularDistance(points[i], p0, pEnd);
    if (dev > maxDev) maxDev = dev;
    totalDev += dev;
  }
  const avgDev = totalDev / Math.max(1, points.length - 2);

  // Curvature threshold relative to line length
  if (maxDev / chordLength > 0.12 || avgDev / chordLength > 0.055) {
    return null;
  }

  // Snap straight line with subtle axis-snapping (horizontal/vertical if within ~5 degrees)
  let finalEndX = pEnd.x;
  let finalEndY = pEnd.y;
  const dx = Math.abs(finalEndX - p0.x);
  const dy = Math.abs(finalEndY - p0.y);

  if (dy <= 0.06 * chordLength) {
    finalEndY = p0.y; // Snap horizontal
  } else if (dx <= 0.06 * chordLength) {
    finalEndX = p0.x; // Snap vertical
  } else if (Math.abs(dx - dy) <= 0.05 * chordLength) {
    // Snap 45 degrees
    const signX = finalEndX >= p0.x ? 1 : -1;
    const signY = finalEndY >= p0.y ? 1 : -1;
    const avgDelta = (dx + dy) / 2;
    finalEndX = p0.x + signX * avgDelta;
    finalEndY = p0.y + signY * avgDelta;
  }

  return {
    type: 'line',
    label: 'Line',
    points: [
      { x: p0.x, y: p0.y },
      { x: finalEndX, y: finalEndY },
    ],
  };
}

/**
 * Filter out near-collinear intermediate vertices (angle change < 24 deg)
 * from Douglas-Peucker candidate corners to avoid jitter artifacts along straight edges.
 */
function filterCollinearVertices(vertices: Point[]): Point[] {
  if (vertices.length <= 3) return vertices;

  let result = [...vertices];
  let changed = true;

  while (changed && result.length > 3) {
    changed = false;
    const next: Point[] = [];
    const len = result.length;

    for (let i = 0; i < len; i++) {
      const pPrev = result[(i - 1 + len) % len];
      const pCurr = result[i];
      const pNext = result[(i + 1) % len];

      const v1x = pCurr.x - pPrev.x;
      const v1y = pCurr.y - pPrev.y;
      const v2x = pNext.x - pCurr.x;
      const v2y = pNext.y - pCurr.y;

      const len1 = Math.hypot(v1x, v1y);
      const len2 = Math.hypot(v2x, v2y);

      if (len1 < 0.001 || len2 < 0.001) {
        changed = true;
        continue;
      }

      const angle1 = Math.atan2(v1y, v1x);
      const angle2 = Math.atan2(v2y, v2x);

      let turn = Math.abs(angle2 - angle1);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      const turnDeg = (turn * 180) / Math.PI;

      // If change of direction is less than 24 degrees, it's just a jitter point along a straight edge
      if (turnDeg < 24) {
        changed = true;
        // Skip pCurr
      } else {
        next.push(pCurr);
      }
    }

    result = next;
  }

  return result;
}

/**
 * Rectangle / Polygon recognition
 * Evaluates candidate vertices from Douglas-Peucker simplification, filters collinear jitter,
 * and verifies edge straightness.
 */
function checkPolygon(
  points: Point[],
  totalArcLength: number,
  p0: Point,
  pEnd: Point,
  bounds: { minX: number; maxX: number; minY: number; maxY: number; w: number; h: number; diag: number }
): RecognizedShape | null {
  const { minX, maxX, minY, maxY, w, h, diag } = bounds;
  if (w < 2.5 || h < 2.5 || diag < 3.5) return null;

  const startEndDist = Math.hypot(pEnd.x - p0.x, pEnd.y - p0.y);
  const isClosed = startEndDist / diag <= 0.46 || startEndDist / totalArcLength <= 0.32;
  if (!isClosed) return null;

  // Simplify stroke with adaptive epsilon
  const epsilon = Math.max(1.0, diag * 0.034);
  let simplified = douglasPeucker(points, epsilon);

  // If path is closed, merge endpoints
  if (simplified.length >= 3) {
    const d = Math.hypot(
      simplified[0].x - simplified[simplified.length - 1].x,
      simplified[0].y - simplified[simplified.length - 1].y
    );
    if (d < diag * 0.30) {
      simplified[simplified.length - 1] = { ...simplified[0] };
    }
  }

  // Remove duplicate closed endpoint for vertex filtering
  let uniqueVertices =
    simplified.length > 2 &&
    Math.hypot(
      simplified[0].x - simplified[simplified.length - 1].x,
      simplified[0].y - simplified[simplified.length - 1].y
    ) < 0.1
      ? simplified.slice(0, -1)
      : simplified;

  // Filter out collinear/jitter vertices along straight edges
  uniqueVertices = filterCollinearVertices(uniqueVertices);

  const numCorners = uniqueVertices.length;
  if (numCorners < 3 || numCorners > 10) return null;

  // Verify that the segments between corners are reasonably straight
  // (In a true polygon, intermediate points deviate little from edge chords;
  // in an ellipse, segments between 4 vertices bulge outwards significantly)
  let totalEdgeDevRatio = 0;
  for (let i = 0; i < numCorners; i++) {
    const vA = uniqueVertices[i];
    const vB = uniqueVertices[(i + 1) % numCorners];
    const edgeLen = Math.hypot(vB.x - vA.x, vB.y - vA.y);
    if (edgeLen > 0.001) {
      // Find max deviation among points closest to this edge
      let maxDev = 0;
      for (const pt of points) {
        const d = getPerpendicularDistance(pt, vA, vB);
        if (d > maxDev) maxDev = d;
      }
      totalEdgeDevRatio += maxDev / edgeLen;
    }
  }
  const avgEdgeDevRatio = totalEdgeDevRatio / numCorners;

  // ONLY convert stroke trajectory points that exhibit an obvious, sharp change in direction
  // into sharp polygonal vertices. A polygon MUST have sharp corners!
  const { sharpCornersCount } = analyzeStrokeCorners(points, diag);
  if (sharpCornersCount < 3 && numCorners >= 3) {
    return null; // Not a polygon, it's too smooth (likely a circle/ellipse)
  }

  // If corners are 3 or 4, or if edge straightness is good, this is definitely a polygon
  const isGoodPolygon = numCorners === 3 || numCorners === 4 || avgEdgeDevRatio <= 0.32;
  if (!isGoodPolygon) return null;

  // 1. TRIANGLE: 3 dominant corners
  if (numCorners === 3) {
    return {
      type: 'triangle',
      label: 'Triangle',
      points: [
        uniqueVertices[0],
        uniqueVertices[1],
        uniqueVertices[2],
        uniqueVertices[0],
      ],
    };
  }

  // 2. RECTANGLE / QUADRILATERAL: 4 dominant corners
  if (numCorners === 4) {
    const candidateCorners = uniqueVertices;

    // Check edge orientations to see if axis-aligned
    let isAxisAligned = true;
    for (let i = 0; i < 4; i++) {
      const pA = candidateCorners[i];
      const pB = candidateCorners[(i + 1) % 4];
      const angle =
        Math.abs(Math.atan2(pB.y - pA.y, pB.x - pA.x) * (180 / Math.PI)) % 90;
      // If edge angle deviates more than 18 degrees from 0 or 90
      if (angle > 18 && angle < 72) {
        isAxisAligned = false;
        break;
      }
    }

    if (isAxisAligned) {
      // Crisp axis-aligned rectangle
      return {
        type: 'rectangle',
        label: 'Rectangle',
        points: [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY },
          { x: minX, y: minY },
        ],
      };
    } else {
      // Rotated rectangle / quad / diamond
      return {
        type: 'rectangle',
        label: 'Rectangle',
        points: [
          candidateCorners[0],
          candidateCorners[1],
          candidateCorners[2],
          candidateCorners[3],
          candidateCorners[0],
        ],
      };
    }
  }

  // 3. GENERAL POLYGON: 5 to 10 major corners (pentagon, hexagon, octagon, star, etc.)
  if (numCorners >= 5 && numCorners <= 10) {
    return {
      type: 'polygon',
      label: `${numCorners}-sided Polygon`,
      points: [...uniqueVertices, uniqueVertices[0]],
    };
  }

  return null;
}

/**
 * Polyline recognition (Open shapes with sharp corners like Chevron, L-shape, Z-shape)
 */
function checkPolyline(
  points: Point[],
  diag: number
): RecognizedShape | null {
  if (diag < 4) return null;

  const epsilon = Math.max(1.0, diag * 0.034);
  let simplified = douglasPeucker(points, epsilon);
  simplified = filterCollinearVertices(simplified);

  if (simplified.length >= 3 && simplified.length <= 10) {
    // Only accept if it has sharp corners, so we don't accidentally turn a curve into a polyline
    const { sharpCornersCount } = analyzeStrokeCorners(points, diag);
    if (sharpCornersCount >= 1) {
      return {
        // We typecast to 'polyline' conceptually; in the interface we added it implicitly
        type: 'polyline' as any,
        label: 'Polyline',
        points: simplified,
      };
    }
  }

  return null;
}

/**
 * Open Curve recognition (Arcs, S-curves, waves without sharp corners)
 */
function checkOpenCurve(
  points: Point[],
  diag: number
): RecognizedShape | null {
  if (diag < 4) return null;

  const { sharpCornersCount } = analyzeStrokeCorners(points, diag);
  if (sharpCornersCount > 0) return null; // Must be smooth

  // We heavily simplify the curve into control points for rendering via quadratic curves
  const epsilon = Math.max(2.0, diag * 0.05);
  let simplified = douglasPeucker(points, epsilon);
  
  if (simplified.length >= 3) {
    return {
      type: 'curve' as any,
      label: 'Curve',
      points: simplified, // RasterDrawingCanvas uses quadraticCurveTo for open shapes with length > 2
    };
  }
  return null;
}

/**
 * Circle / Oval (Ellipse) recognition:
 * If the drawn shape closely approximates an oval or circle, automatically adjusts control points
 * to produce a smooth, mathematically clean circle or oval.
 * - Handles both axis-aligned and oriented/tilted hand-drawn shapes via principal covariance.
 * - Automatically adjusts control points to produce a perfect Circle when aspect >= 0.76 or radial variance is low.
 * - Automatically adjusts control points to produce a smooth Oval when aspect < 0.76.
 * - Generates 64 uniformly spaced perimeter control points for crisp rendering.
 */
function checkCircleOrEllipse(
  points: Point[],
  totalArcLength: number,
  p0: Point,
  pEnd: Point,
  bounds: { minX: number; maxX: number; minY: number; maxY: number; w: number; h: number; diag: number }
): RecognizedShape | null {
  const { w, h, diag, minX, maxX, minY, maxY } = bounds;
  if (w < 2.5 || h < 2.5 || diag < 3.5) return null;

  // Check if start and end points meet (closed path)
  const startEndDist = Math.hypot(pEnd.x - p0.x, pEnd.y - p0.y);
  const isClosed = startEndDist / diag <= 0.52 || startEndDist / totalArcLength <= 0.36 || startEndDist <= 15;
  if (!isClosed) return null;

  // An ellipse or circle must NOT have 4 or more prominent sharp polygonal corners (e.g. triangle or rectangle)
  const { sharpCornersCount, maxTurnDeg } = analyzeStrokeCorners(points, diag);
  if (sharpCornersCount >= 4 && maxTurnDeg >= 75) {
    return null;
  }

  // Count self-intersections (scribble check)
  let intersectionCount = 0;
  for (let i = 0; i < points.length - 3; i++) {
    for (let j = i + 2; j < points.length - 1; j++) {
      if (Math.abs(i - j) <= 1) continue;
      const hit = getLineSegmentIntersection(points[i], points[i + 1], points[j], points[j + 1]);
      if (hit && hit.t >= 0.05 && hit.t <= 0.95 && hit.u >= 0.05 && hit.u <= 0.95) {
        intersectionCount++;
        if (intersectionCount > 2) return null; // Too many intersections -> scribble
      }
    }
  }

  // Trim start/end hooks for better ellipse fitting
  const trimSize = Math.floor(points.length * 0.08);
  const trimmed = points.length > 10 ? points.slice(trimSize, points.length - trimSize) : points;
  if (trimmed.length < 5) return null;

  // Centroid & Covariance matrix for principal orientation & semi-axes
  const N = trimmed.length;
  let sumX = 0, sumY = 0;
  for (const p of trimmed) {
    sumX += p.x;
    sumY += p.y;
  }
  const meanX = sumX / N;
  const meanY = sumY / N;

  let covXX = 0, covYY = 0, covXY = 0;
  for (const p of trimmed) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    covXX += dx * dx;
    covYY += dy * dy;
    covXY += dx * dy;
  }
  covXX /= N;
  covYY /= N;
  covXY /= N;

  // Principal axis orientation angle
  let phi = 0.5 * Math.atan2(2 * covXY, covXX - covYY);

  // If orientation is very close to horizontal or vertical (< 12 degrees), snap to axis-aligned
  const phiDeg = (Math.abs((phi * 180) / Math.PI)) % 90;
  if (phiDeg <= 12 || phiDeg >= 78) {
    phi = Math.round(phi / (Math.PI / 2)) * (Math.PI / 2);
  }

  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  // Project points into principal axis coordinate system (u, v)
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  const uvs: { u: number; v: number }[] = [];
  for (const p of trimmed) {
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

  // Semi-axes
  const a = Math.max(1.5, uW / 2);
  const b = Math.max(1.5, vH / 2);

  // True center in canvas space
  const trueCx = meanX + cU * cosPhi - cV * sinPhi;
  const trueCy = meanY + cU * sinPhi + cV * cosPhi;

  // Calculate radius variation and ellipse fit error
  let totalNormError = 0;
  let totalRad = 0;
  const radii: number[] = [];
  for (const { u, v } of uvs) {
    const du = (u - cU) / a;
    const dv = (v - cV) / b;
    const norm = Math.hypot(du, dv);
    totalNormError += Math.abs(norm - 1);

    const r = Math.hypot(u - cU, v - cV);
    radii.push(r);
    totalRad += r;
  }

  const meanError = totalNormError / N;
  const rMean = totalRad / N;
  let radVar = 0;
  for (const r of radii) {
    radVar += Math.pow(r - rMean, 2);
  }
  const radStdDevRatio = Math.sqrt(radVar / N) / (rMean || 1);

  // Radial aspect ratio
  const aspect = Math.min(a, b) / Math.max(a, b);

  // Threshold check: Must approximate a circle or ellipse (meanError <= 0.32)
  if (meanError > 0.32) {
    return null;
  }

  // 1. CIRCLE:
  // If the aspect ratio is high (>= 0.76) or radial deviation is low, automatically adjust control points to a smooth CIRCLE
  if (aspect >= 0.76 || radStdDevRatio <= 0.17) {
    const R = (a + b) / 2;
    const circlePts: Point[] = [];
    const steps = 64; // High-precision smooth control points
    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * Math.PI * 2;
      circlePts.push({
        x: trueCx + R * Math.cos(theta),
        y: trueCy + R * Math.sin(theta),
      });
    }
    return {
      type: 'circle',
      label: 'Circle',
      points: circlePts,
    };
  }

  // 2. OVAL (ELLIPSE):
  // If aspect ratio is oblong (< 0.76), automatically adjust control points to a smooth OVAL along orientation phi
  const ellipsePts: Point[] = [];
  const steps = 64; // High-precision smooth control points
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    const u = a * Math.cos(theta);
    const v = b * Math.sin(theta);
    ellipsePts.push({
      x: trueCx + u * cosPhi - v * sinPhi,
      y: trueCy + u * sinPhi + v * cosPhi,
    });
  }
  return {
    type: 'ellipse',
    label: 'Ellipse',
    points: ellipsePts,
  };
}

/**
 * Check if a closed loop from self-intersection approximates an oval or circle
 */
function checkCircleOrEllipseOnLoop(loopPoints: Point[]): RecognizedShape | null {
  if (loopPoints.length < 6) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let totalArc = 0;
  for (let i = 0; i < loopPoints.length; i++) {
    const p = loopPoints[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (i > 0) totalArc += Math.hypot(p.x - loopPoints[i - 1].x, p.y - loopPoints[i - 1].y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const diag = Math.hypot(w, h);
  const bounds = { minX, maxX, minY, maxY, w, h, diag };
  return checkCircleOrEllipse(loopPoints, totalArc, loopPoints[0], loopPoints[loopPoints.length - 1], bounds);
}

/**
 * Main Smart Shape recognition entry point
 * Analyzes stroke trajectory points and converts to clean geometric vector shapes
 * Sub-10ms performance with RDP pre-filtering and self-intersecting polygon extraction.
 */
export function recognizeSmartShape(points: Point[]): RecognizedShape | null {
  if (!points || points.length < 3) return null;

  // STEP 0: Pre-process stroke points using lightweight RDP / distance filtering (< 1ms, ensures sub-10ms recognition)
  const preprocessed = preprocessStrokePoints(points);
  if (preprocessed.length < 2) return null;

  // STEP 1: Intersecting Line Polygon Merge for self-intersecting strokes:
  // If the user draws a self-intersecting stroke forming an enclosed region with dangling tails,
  // extract the closed inner path, discard the outer dangling tails, and convert into a clean Polygon, Circle, or Oval!
  let cleanPoints = preprocessed;
  const selfIntersectLoop = extractSelfIntersectingEnclosedLoop(preprocessed);
  if (selfIntersectLoop && selfIntersectLoop.length >= 4) {
    const polygonFromLoop = checkPolygonFromClosedLoop(selfIntersectLoop);
    if (polygonFromLoop) {
      return polygonFromLoop;
    }
    const circleOrEllipseFromLoop = checkCircleOrEllipseOnLoop(selfIntersectLoop);
    if (circleOrEllipseFromLoop) {
      return circleOrEllipseFromLoop;
    }
    cleanPoints = selfIntersectLoop;
  }

  const p0 = cleanPoints[0];
  const pEnd = cleanPoints[cleanPoints.length - 1];

  // Calculate arc length and bounding box
  let totalArcLength = 0;
  let minX = cleanPoints[0].x;
  let maxX = cleanPoints[0].x;
  let minY = cleanPoints[0].y;
  let maxY = cleanPoints[0].y;

  for (let i = 0; i < cleanPoints.length; i++) {
    const pt = cleanPoints[i];
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;

    if (i > 0) {
      totalArcLength += Math.hypot(pt.x - cleanPoints[i - 1].x, pt.y - cleanPoints[i - 1].y);
    }
  }

  const w = maxX - minX;
  const h = maxY - minY;
  const diag = Math.hypot(w, h);
  const chordLength = Math.hypot(pEnd.x - p0.x, pEnd.y - p0.y);

  const bounds = { minX, maxX, minY, maxY, w, h, diag };

  // 2. Check Straight Line first (if curvature is low and aspect ratio is high, strictly rejecting chevrons/arrows)
  const lineShape = checkStraightLine(cleanPoints, totalArcLength, chordLength, p0, pEnd);
  if (lineShape) return lineShape;

  // 3. Check Polygon (Triangle, Rectangle/Quad, 5-10 sided Polygon) FIRST
  // This guarantees freehand polygons are never misinterpreted as ellipses!
  const polygonShape = checkPolygon(cleanPoints, totalArcLength, p0, pEnd, bounds);
  if (polygonShape) return polygonShape;

  // 4. Check Circle / Ellipse (only if smooth, closed, and strictly fitting with no sharp corners)
  const circleOrEllipse = checkCircleOrEllipse(cleanPoints, totalArcLength, p0, pEnd, bounds);
  if (circleOrEllipse) return circleOrEllipse;

  // 5. Check Polyline (Open shapes with sharp corners like L-shape, Chevron)
  const polyline = checkPolyline(cleanPoints, diag);
  if (polyline) return polyline;

  // 6. Check Open Curve (Smooth open shapes like Arcs, S-curves)
  const openCurve = checkOpenCurve(cleanPoints, diag);
  if (openCurve) return openCurve;

  return null;
}

/**
 * Checks if a stroke represents a valid closed bubble path for Freehand Speech Bubble conversion,
 * referring to the exact same conversion logic from Smart Shape:
 * - Only keeps closed shapes (Circle, Ellipse, Rectangle, Triangle, Polygon, or closed freehand loop)
 * - Removes unclosed strokes (lines, curves, polylines, open scribbles, tiny dots)
 */
export function checkIsClosedBubblePath(points: Point[]): boolean {
  if (!points || points.length < 5) return false;

  const clean = preprocessStrokePoints(points);
  if (clean.length < 5) return false;

  // 1. Direct Smart Shape recognition check:
  // If Smart Shape recognizes it, check if it's closed or open
  const smart = recognizeSmartShape(points);
  if (smart) {
    // If it recognized an open shape (line, polyline, curve), it is UNCLOSED -> remove it!
    if (smart.type === 'line' || (smart.type as string) === 'polyline' || (smart.type as string) === 'curve') {
      return false;
    }
    // If it recognized a closed shape (circle, ellipse, rectangle, triangle, polygon), keep it!
    return true;
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let totalArcLength = 0;
  for (let i = 0; i < clean.length; i++) {
    const p = clean[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (i > 0) {
      totalArcLength += Math.hypot(p.x - clean[i - 1].x, p.y - clean[i - 1].y);
    }
  }

  const w = maxX - minX;
  const h = maxY - minY;
  const diag = Math.hypot(w, h);

  // 2. Minimum Size Check:
  // In panel coordinate space (0..100%), a genuine speech bubble must have real dimensions.
  // Reject tiny dots, dabs, and accidental micro-strokes (< 5% of panel)
  if (w < 5.0 || h < 4.0 || diag < 7.0 || totalArcLength < 14.0) {
    return false;
  }

  // 3. Check for self-intersecting enclosed loop (user drew a loop where stroke crossed itself)
  const enclosed = extractSelfIntersectingEnclosedLoop(clean);
  if (enclosed && enclosed.length >= 4) {
    const enclosedArea = computePolygonArea(enclosed);
    // Meaningful enclosed area (at least ~15 units^2)
    if (enclosedArea >= 15) {
      return true;
    }
  }

  // 4. Check for natural endpoint closure
  const p0 = clean[0];
  const pEnd = clean[clean.length - 1];
  const startEndDist = Math.hypot(pEnd.x - p0.x, pEnd.y - p0.y);

  // Enclosed area of the stroke polygon if closed
  const strokeArea = computePolygonArea(clean);
  if (strokeArea < 18) {
    // Insufficient interior area for a dialogue bubble
    return false;
  }

  // Closure distance ratio matching Smart Shape criteria:
  // start and end points must be reasonably close relative to diagonal and total stroke perimeter
  const isClosedRatio =
    (startEndDist / diag <= 0.36 && startEndDist / totalArcLength <= 0.25) ||
    (startEndDist <= 5.0 && startEndDist / diag <= 0.42);

  if (!isClosedRatio) {
    return false; // Unclosed shape -> remove
  }

  // 5. Angular deflection check:
  // A closed bubble must complete a full or near-full revolution around its center (~240+ degrees)
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let totalAngleChange = 0;
  let prevAngle = Math.atan2(clean[0].y - cy, clean[0].x - cx);

  for (let i = 1; i < clean.length; i++) {
    const angle = Math.atan2(clean[i].y - cy, clean[i].x - cx);
    let diff = angle - prevAngle;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    totalAngleChange += diff;
    prevAngle = angle;
  }

  const turnTurns = Math.abs(totalAngleChange);
  // Must turn at least ~4.2 radians (~240 degrees) to form an enclosed bubble
  if (turnTurns < 4.2) {
    return false;
  }

  return true;
}
