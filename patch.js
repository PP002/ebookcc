const fs = require('fs');
let code = fs.readFileSync('src/components/ComicCanvas.tsx', 'utf-8');

const helper = `
export function updateTreeFromBoxes(
  node: TreeNode,
  updatedBoxesMap: Map<string, PanelBox>
): { node: TreeNode, w: number, h: number } {
  if (node.type === 'panel') {
    const box = updatedBoxesMap.get(node.id);
    if (!box) return { node, w: 0, h: 0 };
    return { node: box.node, w: box.w, h: box.h };
  }

  const isRow = node.dir === 'row';
  const res1 = updateTreeFromBoxes(node.c1, updatedBoxesMap);
  const res2 = updateTreeFromBoxes(node.c2, updatedBoxesMap);

  let newPercent = node.percent;
  let newW = 0;
  let newH = 0;
  if (isRow) {
    newW = res1.w + res2.w;
    newH = Math.max(res1.h, res2.h);
    if (newW > 0) newPercent = (res1.w / newW) * 100;
  } else {
    newH = res1.h + res2.h;
    newW = Math.max(res1.w, res2.w);
    if (newH > 0) newPercent = (res1.h / newH) * 100;
  }

  return {
    node: {
      ...node,
      percent: newPercent,
      c1: res1.node,
      c2: res2.node,
    },
    w: newW,
    h: newH,
  };
}
`;

code = code.replace('export function boxesToTree(', helper + '\nexport function boxesToTree(');

const applyMoveOld = `
      // Filter out small panels that collapsed (hit another gutter or boundary)
      const collapseThreshold = 1.5;
      const nonCollapsed = updatedBoxes.filter(b => b.w > collapseThreshold && b.h > collapseThreshold);
      const boxesToBuild = nonCollapsed.length > 0 ? nonCollapsed : updatedBoxes;

      const newTree = boxesToTree(boxesToBuild);
      onChange(newTree);
`;

const applyMoveNew = `
      // Filter out small panels that collapsed (hit another gutter or boundary)
      const collapseThreshold = 1.5;
      const nonCollapsed = updatedBoxes.filter(b => b.w > collapseThreshold && b.h > collapseThreshold);
      
      let newTree;
      // If no panels collapsed, strictly preserve the tree topology to prevent React unmount flashes
      if (nonCollapsed.length === updatedBoxes.length) {
        const boxesMap = new Map(updatedBoxes.map(b => [b.id, b]));
        newTree = updateTreeFromBoxes(initialTreeRef.current, boxesMap).node;
      } else {
        const boxesToBuild = nonCollapsed.length > 0 ? nonCollapsed : updatedBoxes;
        newTree = boxesToTree(boxesToBuild);
      }
      onChange(newTree);
`;

code = code.replace(applyMoveOld, applyMoveNew);
fs.writeFileSync('src/components/ComicCanvas.tsx', code);
console.log("Patched ComicCanvas.tsx");
