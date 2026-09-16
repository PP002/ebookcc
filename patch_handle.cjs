const fs = require('fs');
let code = fs.readFileSync('src/components/Create.tsx', 'utf8');

const targetStr = `                        {/* Little Red Drag Handle with Red Cross Arrow Icon when active */}
                        {activeBubbleId === b.id && b.style !== "freehand" && (
                          <div
                            onPointerDown={(e) => {`;
                            
const replacementStr = `                        {/* Little Red Drag Handle with Red Cross Arrow Icon when active */}
                        {activeBubbleId === b.id && b.style !== "freehand" && (
                          <div
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              removeBubble(b.id);
                            }}
                            onPointerDown={(e) => {`;

if (code.includes(targetStr)) {
  code = code.replace(targetStr, replacementStr);
  fs.writeFileSync('src/components/Create.tsx', code);
  console.log("Success patch handle");
} else {
  console.log("Failed to find target string");
}
