const fs = require('fs');
let code = fs.readFileSync('src/components/comic/bubbleContour.ts', 'utf8');

// We can add the shape detection in processFreehandBubblePoints
// Let's replace:
// const smoothed = smoothContourPreservingCorners(resampled, cornerIndices, 4);
// With logic to check oval/rectangle.

const replacement = `
  let smoothed = smoothContourPreservingCorners(resampled, cornerIndices, 4);

  // Symmetry & Balance: If the drawn shape closely approximates an oval or rectangle, automatically adjust control points to produce smooth, professional manga-style contours.
  // A shape with 0 sharp corners is likely an oval. A shape with 4 sharp corners is likely a rectangle.
  if (cornerIndices.length === 0) {
    // Check if it approximates an oval
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const a = (maxX - minX) / 2;
    const b = (maxY - minY) / 2;
    
    // Calculate variance from a perfect ellipse
    let error = 0;
    for (const pt of resampled) {
      const normVal = Math.pow((pt.x - cx) / a, 2) + Math.pow((pt.y - cy) / b, 2);
      error += Math.abs(normVal - 1);
    }
    const meanError = error / resampled.length;
    
    // If it's a reasonably good oval, we snap it to a perfectly symmetrical manga-style oval (using Bezier approximations)
    if (meanError < 0.25) {
      // Re-generate the points as a perfect smooth oval
      smoothed = [];
      const steps = resampled.length;
      for (let i = 0; i < steps; i++) {
        const theta = (i / steps) * 2 * Math.PI;
        smoothed.push({
          x: cx + a * Math.cos(theta),
          y: cy + b * Math.sin(theta)
        });
      }
    }
  } else if (cornerIndices.length === 4) {
    // Check if it approximates a rectangle
    // Just heavily smooth the lines between the 4 corners, maybe force them to be straight?
    // Actually, smoothContourPreservingCorners already anchors the corners, so it naturally forms a clean rectangle if the edges are smoothed heavily.
    smoothed = smoothContourPreservingCorners(resampled, cornerIndices, 8); // Extra smoothing passes
  }
`;

code = code.replace(
  'const smoothed = smoothContourPreservingCorners(resampled, cornerIndices, 4);',
  replacement
);

fs.writeFileSync('src/components/comic/bubbleContour.ts', code);
