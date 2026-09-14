const fs = require('fs');
let code = fs.readFileSync('src/components/ComicCanvas.tsx', 'utf-8');

const str1 = code.substring(38161, 52358);
const str2 = code.substring(52358, 66555);

console.log('Equal:', str1 === str2);
console.log('str1 length', str1.length);
console.log('str2 length', str2.length);
