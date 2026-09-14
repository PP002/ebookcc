const fs = require('fs');
let code = fs.readFileSync('src/components/Create.tsx', 'utf-8');

const oldStr = `className="absolute top-full left-0 mt-2 p-2 bg-popover/95 backdrop-blur-md border border-border rounded-xl shadow-xl z-[100] flex flex-col gap-2 min-w-[150px] animate-in fade-in zoom-in-95 duration-150"`;
const newStr = `className="absolute top-full left-0 mt-2 p-2 bg-popover/95 backdrop-blur-md border border-border shadow-2xl rounded-2xl flex flex-col gap-2 min-w-[150px] animate-in fade-in slide-in-from-top-2 duration-150 z-[100]"`;

code = code.replace(oldStr, newStr);
fs.writeFileSync('src/components/Create.tsx', code);
console.log('Done');
