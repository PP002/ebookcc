const fs = require('fs');
let code = fs.readFileSync('src/components/ComicCanvas.tsx', 'utf-8');

const insertAfter = `
export function replacePanelById(
  node: TreeNode,
  targetId: string,
  replacement: (target: PanelNode) => TreeNode
): TreeNode {
  if (node.type === 'panel') {
    if (node.id === targetId) {
      return replacement(node);
    }
    return node;
  }
  return {
    ...node,
    c1: replacePanelById(node.c1, targetId, replacement),
    c2: replacePanelById(node.c2, targetId, replacement),
  };
}
`.trim();

const newFunc = `
export function replaceNodeById(
  node: TreeNode,
  targetId: string,
  replacement: (target: TreeNode) => TreeNode
): TreeNode {
  if (node.id === targetId) {
    return replacement(node);
  }
  if (node.type === 'split') {
    return {
      ...node,
      c1: replaceNodeById(node.c1, targetId, replacement),
      c2: replaceNodeById(node.c2, targetId, replacement),
    };
  }
  return node;
}
`;

if (code.includes(insertAfter)) {
  code = code.replace(insertAfter, insertAfter + '\n' + newFunc);
  fs.writeFileSync('src/components/ComicCanvas.tsx', code);
  console.log('Added replaceNodeById');
} else {
  console.log('Failed to find replacePanelById');
}
