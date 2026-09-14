const fs = require('fs');
let code = fs.readFileSync('src/components/Create.tsx', 'utf-8');

const oldBox = `className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-popover border border-border shadow-md rounded-md p-2 flex flex-col gap-2 z-[100] min-w-[48px]"`;
const newBox = `className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-popover/95 backdrop-blur-md border border-border shadow-2xl rounded-2xl p-2 flex flex-col gap-2 z-[100] min-w-[48px] animate-in fade-in slide-in-from-top-2 duration-150"`;

if (code.includes(oldBox)) {
  code = code.replace(oldBox, newBox);
  fs.writeFileSync('src/components/Create.tsx', code);
  console.log('Patched brush box');
} else {
  console.log('Could not find old box');
}
