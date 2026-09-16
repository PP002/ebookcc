const fs = require('fs');
let code = fs.readFileSync('src/components/Create.tsx', 'utf8');

if (!code.includes("ShapeAwareTextLayout")) {
  code = code.replace(
    'import { GoogleDriveDialog, GoogleDriveIcon } from "./GoogleDriveDialog";',
    'import { GoogleDriveDialog, GoogleDriveIcon } from "./GoogleDriveDialog";\nimport { ShapeAwareTextLayout } from "./comic/ShapeAwareTextLayout";'
  );
}

// Add state for editing text
if (!code.includes('const [isEditingText, setIsEditingText] = useState(false);')) {
  code = code.replace(
    'const { t } = useLanguage();',
    'const { t } = useLanguage();\n  const [isEditingText, setIsEditingText] = useState(false);'
  );
}

// Pass bodyPts to the text layout
// First, declare bodyPts globally inside InteractiveBubble so we can use it for ShapeAwareTextLayout
code = code.replace(
  'const bodyPts = normPoints.map((p) => ({',
  'bodyPts = normPoints.map((p) => ({'
);

if (!code.includes('let bodyPts: {x: number, y: number}[] = [];')) {
  code = code.replace(
    'let dPath = "";',
    'let dPath = "";\n  let bodyPts: {x: number, y: number}[] = [];'
  );
}

// Now replace the <div contentEditable ...> with the updated version that includes the ShapeAwareTextLayout
const targetDivStart = `      <div
        ref={containerRef}
        contentEditable
        suppressContentEditableWarning`;
        
const newDivCode = `      
      {!isEditingText && bodyPts.length > 0 && bubble.style === "freehand" && (
        <ShapeAwareTextLayout text={bubble.text} polygon={bodyPts} W={W} H={H} styleType={bubble.style} />
      )}
      <div
        ref={containerRef}
        contentEditable
        suppressContentEditableWarning`;

code = code.replace(targetDivStart, newDivCode);

// Add the logic to hide text when not editing
code = code.replace(
  'onFocus={() => {\n          onActivate?.();\n        }}',
  'onFocus={() => {\n          setIsEditingText(true);\n          onActivate?.();\n        }}'
);

code = code.replace(
  'onBlur={(e) => {\n          const txt = e.currentTarget.innerText || "";\n          onUpdateText(txt);\n        }}',
  'onBlur={(e) => {\n          setIsEditingText(false);\n          const txt = e.currentTarget.innerText || "";\n          onUpdateText(txt);\n        }}'
);

code = code.replace(
  /className={\`text-xs break-words text-center min-w-\[70px\] max-w-\[180px\] whitespace-pre-wrap outline-none cursor-text select-text font-semibold \$\{([\s\S]*?)\}\`}/,
  (match, p1) => {
    return 'className={`text-xs break-words text-center min-w-[70px] max-w-[180px] whitespace-pre-wrap outline-none cursor-text select-text font-semibold ${!isEditingText && bodyPts.length > 0 && bubble.style === "freehand" ? "opacity-0" : ""} ${' + p1 + '}`}'
  }
);

fs.writeFileSync('src/components/Create.tsx', code);
console.log("Patched text layout");
