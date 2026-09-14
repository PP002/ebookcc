const fs = require('fs');
let code = fs.readFileSync('src/components/ComicCanvas.tsx', 'utf-8');

code = code.replace(
  'newTree = updateTreeFromBoxes(initialTreeRef.current, boxesMap).node;',
  'newTree = updateTreeFromBoxes(tree, boxesMap).node;'
);

fs.writeFileSync('src/components/ComicCanvas.tsx', code);
console.log("Patched ComicCanvas.tsx again");
