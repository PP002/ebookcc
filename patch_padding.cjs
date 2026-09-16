const fs = require('fs');
let code = fs.readFileSync('src/components/Create.tsx', 'utf8');

// Reduce py-5 px-7 to py-2 px-3
code = code.replace(/text-black py-5 px-7 italic font-sans leading-tight/g, 'text-black py-2 px-3 italic font-sans leading-tight');

// Reduce py-2.5 px-4 to py-1.5 px-2
code = code.replace(/text-black py-2\.5 px-4/g, 'text-black py-1.5 px-2');

// Reduce action bubble padding py-4 px-6 to py-2 px-3
code = code.replace(/font-extrabold uppercase text-black py-4 px-6/g, 'font-extrabold uppercase text-black py-2 px-3');

fs.writeFileSync('src/components/Create.tsx', code);
