import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AnimatePresence, motion } from 'motion/react';
import { Palette, Contrast, ArrowUp, ArrowDown, Crop, Move, Image as ImageIcon, Bot, Trash2, X, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
// import { DragControls } from 'motion/react';

export interface ImageToolbarProps {
  color?: string;
  isHighContrast?: boolean;
  hasOutline?: boolean;
  onUpdate: (updates: { color?: string; isHighContrast?: boolean; hasOutline?: boolean; url?: string }) => void;
  onDelete: () => void;
  onMoveLayer: (dir: 'up' | 'down') => void;
  onCropToggle?: () => void;
  isCropping?: boolean;
  onPointerDownMove?: (e: React.PointerEvent) => void;
  onDragStartMove?: (e: React.DragEvent) => void;
  onClickAskAI: () => void;
  onRegenerate?: () => void;
}

export const ImageToolbar: React.FC<ImageToolbarProps> = ({
  color = '#000000',
  isHighContrast = false,
  hasOutline = false,
  onUpdate,
  onDelete,
  onMoveLayer,
  onCropToggle,
  isCropping = false,
  onPointerDownMove,
  onDragStartMove,
  onClickAskAI,
  onRegenerate
}) => {
  const [isColorFolded, setIsColorFolded] = useState(true);

  // Normalize color to match array values if it comes in as RGB
  const normalizeColor = (c: string) => {
    if (!c) return '#000000';
    if (c.startsWith('rgb')) {
      const match = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (match) {
        return '#' + [match[1], match[2], match[3]].map(x => {
          const hex = parseInt(x).toString(16);
          return hex.length === 1 ? '0' + hex : hex;
        }).join('');
      }
    }
    return c;
  };

  const normalizedColor = normalizeColor(color);

  return (
    <div 
      className="flex items-center gap-0.5 bg-background text-foreground border border-border shadow-md p-1 rounded-xl z-50 pointer-events-auto"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="relative flex items-center">
        <Button size="icon" variant="ghost" className={cn("h-8 w-8 hover:bg-muted shrink-0", !isColorFolded && "text-primary")} onClick={() => setIsColorFolded(!isColorFolded)} title="Colors">
          <Palette className="h-4 w-4" />
        </Button>
        
        <AnimatePresence>
          {!isColorFolded && (
            <motion.div 
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute bottom-full left-0 mb-3 p-1.5 bg-background border border-border shadow-lg rounded-lg flex flex-row gap-1.5 items-center z-[110]"
            >
              <div className="flex flex-row gap-1.5">
                {['none', '#000000', '#ffffff', '#ef4444', '#22c55e', '#3b82f6'].map(c => (
                  <button
                    key={c}
                    className={cn(
                      "w-5 h-5 rounded-full border shadow-sm transition-transform hover:scale-110 flex items-center justify-center",
                      (normalizedColor === c && hasOutline) || (c === 'none' && !hasOutline) ? "ring-2 ring-primary ring-offset-1" : ""
                    )}
                    style={{ backgroundColor: c === 'none' ? 'transparent' : c }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (c === 'none') {
                        onUpdate({ hasOutline: false });
                      } else {
                        onUpdate({ color: c, hasOutline: true });
                      }
                      setIsColorFolded(true);
                    }}
                    title={c === 'none' ? 'No Outline' : c}
                  >
                    {c === 'none' && <X className="w-3 h-3 text-muted-foreground" />}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="w-px h-5 bg-border mx-0.5" />

      <Button size="icon" variant="ghost" className="h-8 w-8 hover:bg-muted shrink-0" onClick={() => onUpdate({ isHighContrast: !isHighContrast })} title="High Contrast">
        <Contrast className={cn("h-4 w-4", isHighContrast && "text-primary")} />
      </Button>
      <Button size="icon" variant="ghost" className="h-8 w-8 hover:bg-muted shrink-0" onClick={() => onMoveLayer('up')} title="Layer Up (U)">
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button size="icon" variant="ghost" className="h-8 w-8 hover:bg-muted shrink-0" onClick={() => onMoveLayer('down')} title="Layer Down (D)">
        <ArrowDown className="h-4 w-4" />
      </Button>
      <Button size="icon" variant="ghost" className={cn("h-8 w-8 shrink-0 hover:bg-muted", isCropping && "text-primary bg-muted")} onClick={() => onCropToggle && onCropToggle()} title="Crop">
        <Crop className="h-4 w-4" />
      </Button>
      <Button size="icon" variant="ghost" className="h-8 w-8 hover:bg-muted shrink-0" onPointerDown={onPointerDownMove} draggable={!!onDragStartMove} onDragStart={onDragStartMove} title="Move">
        <Move className="h-4 w-4" />
      </Button>
      <div className="w-px h-5 bg-border mx-0.5" />
      <Button size="icon" variant="ghost" className="h-8 w-8 hover:bg-muted shrink-0" onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) {
                  const reader = new FileReader();
                  reader.onload = (re) => {
                      onUpdate({ url: re.target?.result as string });
                  };
                  reader.readAsDataURL(file);
              }
          };
          input.click();
      }} title="Replace Image">
        <ImageIcon className="h-4 w-4" />
      </Button>
      <Button size="icon" variant="ghost" className="h-8 w-8 hover:bg-muted shrink-0 text-[#2DC6CF]" onClick={onClickAskAI} title="Ask AI">
        <Bot className="h-4 w-4" />
      </Button>
      {onRegenerate && (
        <Button size="icon" variant="ghost" className="h-8 w-8 hover:bg-muted shrink-0 text-amber-500" onClick={onRegenerate} title="Regenerate Image">
          <RefreshCw className="h-4 w-4" />
        </Button>
      )}
      <div className="w-px h-5 bg-border mx-0.5" />
      <Button size="icon" variant="ghost" className="h-8 w-8 hover:bg-destructive/10 text-destructive hover:text-destructive shrink-0" onClick={onDelete} title="Delete">
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
};
