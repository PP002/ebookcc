const fs = require('fs');
let code = fs.readFileSync('src/components/ComicCanvas.tsx', 'utf-8');
const s2 = 52358;
code = code.substring(0, s2) + code.substring(s2 + 14197);
fs.writeFileSync('src/components/ComicCanvas.tsx', code);
console.log('Removed duplicate block');
