const fs = require('fs');
let code = fs.readFileSync('src/components/comic/RasterDrawingCanvas.tsx', 'utf-8');

const wrongCode = `
  // Composite layers and temp buffer to main screen canvas
  const drawMainFrame = () => {
  drawMainFrameRef.current = drawMainFrame;
`;

const rightCode = `
  // Composite layers and temp buffer to main screen canvas
  const drawMainFrame = () => {
`;

code = code.replace(wrongCode, rightCode);

// Add it OUTSIDE the function
const funcEnd = `      ctx.restore();
    }
  };`;
const funcEndNew = `      ctx.restore();
    }
  };
  drawMainFrameRef.current = drawMainFrame;
`;

code = code.replace(funcEnd, funcEndNew);

fs.writeFileSync('src/components/comic/RasterDrawingCanvas.tsx', code);
console.log('Fixed drawMainFrameRef placement.');
