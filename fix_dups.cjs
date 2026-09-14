const fs = require('fs');
const code = fs.readFileSync('src/components/ComicCanvas.tsx', 'utf-8');

const s1 = code.indexOf("const SplitView: React.FC<{");
const s2 = code.indexOf("const SplitView: React.FC<{", s1 + 1);
const s3 = code.indexOf("export const ComicCanvas: React.FC<ComicCanvasProps> = ({");

console.log({ s1, s2, s3, len: code.length });
