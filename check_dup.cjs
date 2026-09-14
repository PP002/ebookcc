const fs = require('fs');
const code = fs.readFileSync('src/components/ComicCanvas.tsx', 'utf-8');

const s1 = code.indexOf("export const ComicCanvas: React.FC<ComicCanvasProps> = ({");
const s2 = code.indexOf("export const ComicCanvas: React.FC<ComicCanvasProps> = ({", s1 + 1);

console.log('s1', s1, 's2', s2);

// Compare from s1 to s2, with s2 to end
console.log('len between', s2 - s1);
console.log('len remaining', code.length - s2);
