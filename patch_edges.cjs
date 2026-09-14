const fs = require('fs');
let code = fs.readFileSync('src/components/ComicCanvas.tsx', 'utf-8');

const startStr = "const SharedEdgesOverlay: React.FC<{";
const endStr = "export const ComicCanvas: React.FC<ComicCanvasProps> = ({";

const startIndex = code.indexOf(startStr);
const endIndex = code.indexOf(endStr);

if (startIndex !== -1 && endIndex !== -1) {
  code = code.substring(0, startIndex) + code.substring(endIndex);
  fs.writeFileSync('src/components/ComicCanvas.tsx', code);
  console.log('Removed old SharedEdgesOverlay');
} else {
  console.log('Could not find bounds');
}
