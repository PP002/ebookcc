import React, { useState, useRef, useEffect } from 'react';
import { BookOpen, PenTool, Eraser, LassoSelect, MousePointer2, PaintBucket, Wrench, Plus, Trash2, Layout, Smile, Sparkles, Type, Image as ImageIcon, Layers, Save, Check, ChevronLeft, Download, PanelLeftClose, PanelLeftOpen, ChevronDown, Heading1, Heading2, Minus, List, MessageSquare, Bot, Contrast, Square, ArrowUp, ArrowDown, Crop, Move } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { ImageToolbar } from './ImageToolbar';
import { ComicCanvas, createGridTree, fillFirstEmptyPanel, updatePanelImage, TreeNode } from './ComicCanvas';
import JSZip from 'jszip';
import { AIGeneratorDialog } from './AIGeneratorDialog';
import { AIFullComicDialog } from './AIFullComicDialog';
import { AIFullStoryDialog } from './AIFullStoryDialog';

interface CreateProps {
  setActiveView: (view: 'home' | 'read' | 'create' | 'convert') => void;
  onActiveStateChange?: (active: boolean) => void;
}

interface Bubble {
  id: string;
  text: string;
  x: number;
  y: number;
  style: 'classic' | 'action' | 'whisper';
}

interface ComicPage {
  id: string;
  tree: TreeNode;
  bubbles: Bubble[];
}

interface Panel {
  id: string;
  gridArea: string;
  bgImageUrl?: string;
  bgColor: string;
}


const cropImageToCover = async (dataUrl: string, targetWidth: number, targetHeight: number): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(dataUrl);
      
      const imgRatio = img.width / img.height;
      const targetRatio = targetWidth / targetHeight;
      
      let drawW, drawH, drawX, drawY;
      
      if (imgRatio > targetRatio) {
        drawH = targetHeight;
        drawW = targetHeight * imgRatio;
        drawX = (targetWidth - drawW) / 2;
        drawY = 0;
      } else {
        drawW = targetWidth;
        drawH = targetWidth / imgRatio;
        drawX = 0;
        drawY = (targetHeight - drawH) / 2;
      }
      
      ctx.drawImage(img, drawX, drawY, drawW, drawH);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => resolve(dataUrl); // fallback
    img.src = dataUrl;
  });
};

const computePanels = (node: any, x: number, y: number, w: number, h: number): any[] => {
  if (node.type === 'panel') {
    return [{ x, y, w, h, id: node.id, imageUrl: node.imageUrl }];
  }
  if (node.dir === 'row') {
    const w1 = w * (node.percent / 100);
    const w2 = w - w1;
    return [
      ...computePanels(node.c1, x, y, w1, h),
      ...computePanels(node.c2, x + w1, y, w2, h),
    ];
  } else {
    const h1 = h * (node.percent / 100);
    const h2 = h - h1;
    return [
      ...computePanels(node.c1, x, y, w, h1),
      ...computePanels(node.c2, x, y + h1, w, h2),
    ];
  }
};

const CanvasResizeOverlay = ({ imgElement, updateToc }: { imgElement: HTMLImageElement, updateToc: () => void }) => {
  const [rect, setRect] = useState(imgElement.getBoundingClientRect());
  
  useEffect(() => {
     const iv = setInterval(() => {
         const newRect = imgElement.getBoundingClientRect();
         if (newRect.width !== rect.width || newRect.height !== rect.height || newRect.top !== rect.top || newRect.left !== rect.left) {
             setRect(newRect);
         }
     }, 30);
     return () => clearInterval(iv);
  }, [imgElement, rect]);

  const handleResizeStart = (e: React.PointerEvent, handle: string) => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = imgElement.clientWidth;
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);

      const onPointerMove = (evt: PointerEvent) => {
         let dx = evt.clientX - startX;
         let newWidth = startWidth;
         
         if (handle.includes('e')) newWidth = startWidth + dx;
         if (handle.includes('w')) newWidth = startWidth - dx;

         // Calculate percentage width to be responsive
         const parentWidth = imgElement.parentElement?.clientWidth || window.innerWidth;
         const percentageW = (Math.max(20, newWidth) / parentWidth) * 100;
         imgElement.style.width = percentageW + '%';
         imgElement.style.height = 'auto';
         setRect(imgElement.getBoundingClientRect());
         updateToc();
      };
      
      const onPointerUp = (evt: PointerEvent) => {
         target.releasePointerCapture(evt.pointerId);
         target.removeEventListener('pointermove', onPointerMove);
         target.removeEventListener('pointerup', onPointerUp);
      };
      
      target.addEventListener('pointermove', onPointerMove);
      target.addEventListener('pointerup', onPointerUp);
  };

  return (
    <div style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width, height: rect.height, zIndex: 109, pointerEvents: 'none', outline: '2px solid black' }}>
        {['nw', 'ne', 'sw', 'se'].map(h => (
           <div 
             key={h}
             onPointerDown={(e) => handleResizeStart(e, h)}
             className="absolute w-8 h-8 z-[120] flex items-center justify-center pointer-events-auto"
             style={{
                top: `${h.includes('n') ? 0 : 100}%`,
                left: `${h.includes('w') ? 0 : 100}%`,
                transform: 'translate(-50%, -50%)',
                cursor: `${h}-resize`,
                touchAction: 'none'
             }}
           >
             <div className="w-3 h-3 border border-white rounded-full bg-black shadow-sm" />
           </div>
        ))}
    </div>
  );
};

const CanvasCropOverlay = ({ imgElement, onClose, updateToc }: { imgElement: HTMLImageElement, onClose: () => void, updateToc: () => void }) => {
  const initCrop = { 
    top: parseFloat(imgElement.dataset.cropTop || '0'), 
    right: parseFloat(imgElement.dataset.cropRight || '0'), 
    bottom: parseFloat(imgElement.dataset.cropBottom || '0'), 
    left: parseFloat(imgElement.dataset.cropLeft || '0') 
  };
  const [crop, setCrop] = useState(initCrop);
  const [rect, setRect] = useState(imgElement.getBoundingClientRect());
  
  useEffect(() => {
     imgElement.style.opacity = '0';
     return () => {
         imgElement.style.opacity = '1';
     };
  }, [imgElement]);

  useEffect(() => {
     const iv = setInterval(() => setRect(imgElement.getBoundingClientRect()), 50);
     return () => clearInterval(iv);
  }, [imgElement]);

  const origSrc = imgElement.dataset.origSrc || imgElement.src;

  const origWidth = rect.width / (1 - (initCrop.left + initCrop.right) / 100);
  const origHeight = rect.height / (1 - (initCrop.top + initCrop.bottom) / 100);
  const origLeft = rect.left - (initCrop.left / 100) * origWidth;
  const origTop = rect.top - (initCrop.top / 100) * origHeight;

  const handlePointerDown = (e: React.PointerEvent, handle: string) => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startCrop = { ...crop };
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
      
      const onPointerMove = (evt: PointerEvent) => {
         const dx = evt.clientX - startX;
         const dy = evt.clientY - startY;
         const dxPct = (dx / origWidth) * 100;
         const dyPct = (dy / origHeight) * 100;
         
         const newCrop = { ...startCrop };
         if (handle.includes('n')) newCrop.top = Math.max(0, Math.min(100 - newCrop.bottom - 5, startCrop.top + dyPct));
         if (handle.includes('s')) newCrop.bottom = Math.max(0, Math.min(100 - newCrop.top - 5, startCrop.bottom - dyPct));
         if (handle.includes('w')) newCrop.left = Math.max(0, Math.min(100 - newCrop.right - 5, startCrop.left + dxPct));
         if (handle.includes('e')) newCrop.right = Math.max(0, Math.min(100 - newCrop.left - 5, startCrop.right - dxPct));
         setCrop(newCrop);
      };
      
      const onPointerUp = (evt: PointerEvent) => {
         target.releasePointerCapture(evt.pointerId);
         target.removeEventListener('pointermove', onPointerMove);
         target.removeEventListener('pointerup', onPointerUp);
      };
      
      target.addEventListener('pointermove', onPointerMove);
      target.addEventListener('pointerup', onPointerUp);
  };
  
  const applyCrop = () => {
      imgElement.dataset.origSrc = origSrc;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
          const canvas = document.createElement('canvas');
          const natW = img.naturalWidth;
          const natH = img.naturalHeight;
          const cLeft = (crop.left / 100) * natW;
          const cTop = (crop.top / 100) * natH;
          const cWidth = natW - cLeft - ((crop.right / 100) * natW);
          const cHeight = natH - cTop - ((crop.bottom / 100) * natH);
          
          canvas.width = Math.max(1, cWidth);
          canvas.height = Math.max(1, cHeight);
          const ctx = canvas.getContext('2d');
          if (ctx) {
             try {
               ctx.drawImage(img, cLeft, cTop, cWidth, cHeight, 0, 0, canvas.width, canvas.height);
               imgElement.src = canvas.toDataURL('image/png');
               imgElement.dataset.cropLeft = crop.left.toString();
               imgElement.dataset.cropTop = crop.top.toString();
               imgElement.dataset.cropRight = crop.right.toString();
               imgElement.dataset.cropBottom = crop.bottom.toString();
               updateToc();
             } catch(e) {
               console.error('Failed to crop: ', e);
             }
          }
          onClose();
      };
      img.src = origSrc;
  };

  return (
    <div style={{ position: 'fixed', top: origTop, left: origLeft, width: origWidth, height: origHeight, zIndex: 110, pointerEvents: 'none' }}>
        <img src={origSrc} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', opacity: 0.5, pointerEvents: 'none', borderRadius: imgElement.style.borderRadius, outline: '2px solid black' }} alt="crop background" />
        <div style={{ 
            position: 'absolute', 
            top: `${crop.top}%`, right: `${crop.right}%`, bottom: `${crop.bottom}%`, left: `${crop.left}%`,
            outline: '2px solid black',
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.4)',
            overflow: 'hidden'
        }}>
            <img src={origSrc} style={{
                position: 'absolute',
                width: `${100 / (1 - (crop.left+crop.right)/100)}%`,
                height: `${100 / (1 - (crop.top+crop.bottom)/100)}%`,
                left: `-${crop.left / (1 - (crop.left+crop.right)/100)}%`,
                top: `-${crop.top / (1 - (crop.top+crop.bottom)/100)}%`,
                objectFit: 'fill',
                maxWidth: 'none'
            }} alt="crop overlay" />
        </div>
        
        {['nw', 'ne', 'sw', 'se'].map(h => (
           <div 
             key={h}
             onPointerDown={(e) => handlePointerDown(e, h)}
             className={`absolute w-8 h-8 z-[120] pointer-events-auto cursor-${h}-resize`}
             style={{
                top: `${h.includes('n') ? crop.top : 100 - crop.bottom}%`,
                left: `${h.includes('w') ? crop.left : 100 - crop.right}%`,
                transform: `translate(${h.includes('w') ? '-2px' : '-30px'}, ${h.includes('n') ? '-2px' : '-30px'})`,
                touchAction: 'none'
             }}
           >
             <div className={`absolute ${h.includes('n') ? 'top-0' : 'bottom-0'} ${h.includes('w') ? 'left-0' : 'right-0'} w-6 h-[4px] bg-black`} />
             <div className={`absolute ${h.includes('n') ? 'top-0' : 'bottom-0'} ${h.includes('w') ? 'left-0' : 'right-0'} w-[4px] h-6 bg-black`} />
           </div>
        ))}
        
        <div style={{ position: 'absolute', top: -40, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'auto', display: 'flex', gap: 8, zIndex: 120 }}>
            <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); onClose(); }}>Cancel</Button>
            <Button size="sm" onClick={(e) => { e.stopPropagation(); applyCrop(); }}>Apply</Button>
        </div>
    </div>
  );
};

export const Create: React.FC<CreateProps> = ({ setActiveView, onActiveStateChange }) => {
  const [createMode, setCreateMode] = useState<'select' | 'comic' | 'document'>('select');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isBubbleSidebarOpen, setIsBubbleSidebarOpen] = useState(false);
  const [isAIGeneratorOpen, setIsAIGeneratorOpen] = useState(false);
  const [isAIFullComicDialogOpen, setIsAIFullComicDialogOpen] = useState(false);
  const [aiFullComicPrompt, setAiFullComicPrompt] = useState("");
  const [isAIFullStoryDialogOpen, setIsAIFullStoryDialogOpen] = useState(false);
  const [aiFullStoryPrompt, setAiFullStoryPrompt] = useState("");
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawTool, setDrawTool] = useState<'pen'|'erase'|'select'|'fill'>('pen');
  const [drawColor, setDrawColor] = useState('#000000');
  const [drawRadius, setDrawRadius] = useState(2);
  const [drawToolbarPos, setDrawToolbarPos] = useState({ x: window.innerWidth / 2 - 120, y: 16 });
  const [isDraggingToolbar, setIsDraggingToolbar] = useState(false);
  const dragToolbarStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });

  const [tocItems, setTocItems] = useState<{id: string, text: string, level: number}[]>([]);

  const [floatingMenuProps, setFloatingMenuProps] = useState<{ visible: boolean; top: number; left: number }>({ visible: false, top: 0, left: 0 });
  const [imageMenuProps, setImageMenuProps] = useState<{ visible: boolean; top: number; left: number; imgElement: HTMLImageElement | null }>({ visible: false, top: 0, left: 0, imgElement: null });
  const [isImageCropping, setIsImageCropping] = useState(false);
  const [isImageColorFolded, setIsImageColorFolded] = useState(true);
  const [comicPages, setComicPagesState] = useState<ComicPage[]>([
    {
      id: Date.now().toString(),
      tree: createGridTree(3, 2),
      bubbles: [
        { id: '1', text: 'HELLO WORLD!', x: 25, y: 30, style: 'classic' },
        { id: '2', text: 'WHAT A COOL WORKSPACE!', x: 60, y: 65, style: 'action' },
      ]
    }
  ]);
  const [activePageIndex, setActivePageIndex] = useState(0);

  const historyRef = useRef<ComicPage[][]>([]);
  const historyIndexRef = useRef<number>(-1);

  // Initialize history sync eagerly
  if (historyRef.current.length === 0) {
    historyRef.current = [comicPages];
    historyIndexRef.current = 0;
  }

  const setComicPages = (newPagesOrUpdater: ComicPage[] | ((prev: ComicPage[]) => ComicPage[])) => {
    setComicPagesState(prev => {
      const nextPages = typeof newPagesOrUpdater === 'function' ? newPagesOrUpdater(prev) : newPagesOrUpdater;
      const nextIndex = historyIndexRef.current + 1;
      const newHistory = historyRef.current.slice(0, nextIndex);
      newHistory.push(nextPages);
      if (newHistory.length > 50) newHistory.shift();
      historyRef.current = newHistory;
      historyIndexRef.current = newHistory.length - 1;
      return nextPages;
    });
  };

  
  const activePage = comicPages[activePageIndex] || comicPages[0];
  const comicTree = activePage.tree;
  const bubbles = activePage.bubbles;

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable) return;
      
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            // REDO
            if (historyIndexRef.current < historyRef.current.length - 1) {
              historyIndexRef.current++;
              setComicPagesState(historyRef.current[historyIndexRef.current]);
            }
          } else {
            // UNDO
            if (historyIndexRef.current > 0) {
              historyIndexRef.current--;
              setComicPagesState(historyRef.current[historyIndexRef.current]);
            }
          }
          return;
        }
      }

      if (createMode === 'comic') {
        const key = e.key.toLowerCase();
        if (key === 'd') {
          setIsDrawingMode(prev => {
            if (!prev) setDrawTool('pen');
            return true;
          });
        }
        if (isDrawingMode) {
          if (key === 'e') setDrawTool('erase');
          if (key === 'l') setDrawTool('select');
          if (key === 'p') setDrawTool('pen');
          if (key === 'f') setDrawTool('fill');
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [createMode, isDrawingMode]);

  useEffect(() => {
    const handleUp = () => setIsDraggingToolbar(false);
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (isDraggingToolbar) {
        if (e.cancelable) {
          e.preventDefault();
        }
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        let newX = dragToolbarStartRef.current.posX + (clientX - dragToolbarStartRef.current.x);
        let newY = dragToolbarStartRef.current.posY + (clientY - dragToolbarStartRef.current.y);
        
        // Boundaries
        newX = Math.max(0, Math.min(newX, window.innerWidth - 320));
        newY = Math.max(0, Math.min(newY, window.innerHeight - 60));
        
        setDrawToolbarPos({ x: newX, y: newY });
      }
    };

    if (isDraggingToolbar) {
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
      window.addEventListener('touchmove', handleMove, { passive: false });
      window.addEventListener('touchend', handleUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [isDraggingToolbar]);

  useEffect(() => {
    const handleOpenAIGenerator = () => setIsAIGeneratorOpen(true);
    const handleOpenDrawMode = () => setIsDrawingMode(true);
    const handleOpenGenerateFullComic = (e: any) => {
      setCreateMode('comic');
      if (e.detail?.prompt) {
        setAiFullComicPrompt(e.detail.prompt);
        setIsAIFullComicDialogOpen(true);
      }
    };
    
    const handleOpenGenerateFullStory = (e: any) => {
      setCreateMode('document');
      if (e.detail?.prompt) {
        setAiFullStoryPrompt(e.detail.prompt);
        setIsAIFullStoryDialogOpen(true);
      }
    };
    
    const handleOpenComicCreator = () => {
      setCreateMode('comic');
    };
    
    const handleOpenStoryWriter = () => {
      setCreateMode('document');
    };
    
    window.addEventListener('open-ai-script-dialog', handleOpenAIGenerator);
    window.addEventListener('open-draw-mode', handleOpenDrawMode);
    window.addEventListener('open-generate-full-comic', handleOpenGenerateFullComic);
    window.addEventListener('open-generate-full-story', handleOpenGenerateFullStory);
    window.addEventListener('open-comic-creator', handleOpenComicCreator);
    window.addEventListener('open-story-writer', handleOpenStoryWriter);
    
    return () => {
      window.removeEventListener('open-ai-script-dialog', handleOpenAIGenerator);
      window.removeEventListener('open-draw-mode', handleOpenDrawMode);
      window.removeEventListener('open-generate-full-comic', handleOpenGenerateFullComic);
      window.removeEventListener('open-generate-full-story', handleOpenGenerateFullStory);
      window.removeEventListener('open-comic-creator', handleOpenComicCreator);
      window.removeEventListener('open-story-writer', handleOpenStoryWriter);
    };
  }, []);

  useEffect(() => {
    const handleInsertImage = (e: any) => {
      const imageUrl = e.detail?.imageUrl;
      if (!imageUrl) return;
      if (createMode === 'document') {
        if (editorRef.current) {
          editorRef.current.focus();
          const img = document.createElement('img');
          img.src = imageUrl;
          img.style.width = '33.33%';
          
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            range.insertNode(img);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          } else {
            editorRef.current.appendChild(img);
          }
          updateToc();
        }
      } else if (createMode === 'comic') {
        setComicPages(prev => {
           let updatedPages = [...prev];
          const page = updatedPages[activePageIndex];
           if (page) {
             const activePath = (window as any).activeComicPanelPath;
             if (activePath) {
               const replaceNodeByPath = (node: TreeNode, curPath: number[], url: string): TreeNode => {
                 if (curPath.length === 0 && node.type === 'panel') {
                    // When replacing a panel image from AI, we also clear drawings so they don't overlap awkwardly
                    return { ...node, imageUrl: url, drawings: [] };
                 }
                 if (node.type !== 'panel') {
                    const isFirst = curPath[0] === 0;
                    const nextPath = curPath.slice(1);
                    return {
                       ...node,
                       c1: isFirst ? replaceNodeByPath(node.c1, nextPath, url) : node.c1,
                       c2: !isFirst ? replaceNodeByPath(node.c2, nextPath, url) : node.c2
                    };
                 }
                 return node;
               };
               updatedPages[activePageIndex] = { ...page, tree: replaceNodeByPath(page.tree, activePath, imageUrl) };
               setTimeout(() => toast.success("Image placed in selected panel!"), 0);
             } else {
               const { tree, updated } = fillFirstEmptyPanel(page.tree, imageUrl);
               if (updated) {
                 updatedPages[activePageIndex] = { ...page, tree };
                 setTimeout(() => toast.success("Image added to comic!"), 0);
               } else {
                 setTimeout(() => toast.info("No empty panels on this page. Please add an empty panel first!"), 0);
               }
             }
           }
           return updatedPages;
        });
      }
    };
    
    window.addEventListener('insert-comic-image', handleInsertImage);
    
    (window as any).getComicCanvasContext = async () => {
       if (createMode === 'comic' && comicRef.current) {
          try {
             const { toPng } = await import('html-to-image');
             const dataUrl = await toPng(comicRef.current, { quality: 0.8 });
             return dataUrl;
          } catch(e) {
             console.error("toPng error", e);
             return null;
          }
       }
       return null;
    };

    return () => {
      window.removeEventListener('insert-comic-image', handleInsertImage);
      delete (window as any).getComicCanvasContext;
    };
  }, [createMode, activePageIndex]);

  const updateActivePageTree = (newTree: TreeNode) => {
    setComicPages(pages => pages.map((p, i) => i === activePageIndex ? { ...p, tree: newTree } : p));
  };

  const updateActivePageBubbles = (newBubbles: Bubble[]) => {
    setComicPages(pages => pages.map((p, i) => i === activePageIndex ? { ...p, bubbles: newBubbles } : p));
  };

  const handleFullComicGenerated = async (scriptData: any, sketch: string | null) => {
    if (!scriptData || !scriptData.pages) return;
    setIsAIFullComicDialogOpen(false);
    
    toast.info("Generating comic pages! This might take a minute...", { duration: 5000 });

    const sharedConsistencySeed = Math.floor(Math.random() * 100000000);
    const newPages: ComicPage[] = [];

    for (let pIdx = 0; pIdx < scriptData.pages.length; pIdx++) {
      const pageScript = scriptData.pages[pIdx];
      const panelsCount = pageScript.panels ? pageScript.panels.length : 0;
      
      let rows = 1, cols = 1;
      if (panelsCount === 2) { rows = 2; cols = 1; }
      else if (panelsCount === 3 || panelsCount === 4) { rows = 2; cols = 2; }
      else if (panelsCount >= 5) { rows = 3; cols = 2; }
      
      const tree = createGridTree(rows, cols);
      const bubbles: Bubble[] = [];

      let currentTree = tree;
      
      // Update state progressively
      const newPageId = Date.now().toString() + pIdx;
      setComicPages(prev => {
        const isDefault = prev.length === 1 && prev[0].bubbles?.length === 2 && prev[0].bubbles[0].text === 'HELLO WORLD!';
        const newPages = isDefault && pIdx === 0 ? [{ id: newPageId, tree: currentTree, bubbles }] : [...prev, { id: newPageId, tree: currentTree, bubbles }];
        if (pIdx === 0) {
            const idx = newPages.findIndex(p => p.id === newPageId);
            requestAnimationFrame(() => setActivePageIndex(idx !== -1 ? idx : 0));
        }
        return newPages;
      });

      for (let i = 0; i < panelsCount; i++) {
        const panel = pageScript.panels[i];
        if (!panel) continue;
        const prompt = panel.imagePrompt + ", comic book art style, graphic novel, vivid colors, inked lines, cel shaded";
        
        try {
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 800)); // Small delay to avoid rate limiting
          }
          let imageUrl = null;
          toast.loading(`Generating artwork for panel ${i + 1} of ${panelsCount}...`);

          try {
            const res = await fetch("/api/generate-image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt: prompt + (sketch ? " consistent with sketch" : ""),
                aspectRatio: "1:1",
                imageBase64: sketch,
                engine: "pollinations", // Force fast generator
                seed: sharedConsistencySeed
              })
            });
            
            if (res.ok) {
              const data = await res.json();
              imageUrl = data.imageUrl;
            } else {
              throw new Error("Backend failed");
            }
          } catch (e: any) {
            console.warn("Falling back to client-side proxy-less generation...", e);
            const encodedPrompt = encodeURIComponent(prompt + (sketch ? " consistent with sketch" : ""));
            imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&seed=${sharedConsistencySeed}&model=flux`;
          }

          if (imageUrl) {
             // Pre-fetch to ensure the generation completes before we attempt to render
             try {
                const imgResult = await fetch(imageUrl);
                if (imgResult.ok) {
                   const contentType = imgResult.headers.get('content-type');
                   if (contentType && contentType.startsWith('image/')) {
                      const imgBlob = await imgResult.blob();
                      imageUrl = URL.createObjectURL(imgBlob);
                   }
                }
             } catch(e) {}
             
             const { tree: newT, updated } = fillFirstEmptyPanel(currentTree, imageUrl);
             if (updated) {
               currentTree = newT;
               setComicPages(prev => {
                 const updatedPages = [...prev];
                   const ptIdx = updatedPages.findIndex(p => p.id === newPageId);
                   if (ptIdx !== -1) updatedPages[ptIdx] = { ...updatedPages[ptIdx], tree: currentTree };
                   return updatedPages;
                 });
               }
            }
        } catch (e) {
          console.error("Failed to generate panel image", e);
        }
        
        toast.dismiss();

        if (panel.dialogue) {
           bubbles.push({
             id: Math.random().toString(),
             text: panel.dialogue,
             x: 10 + ((i % cols) * 45),
             y: 10 + (Math.floor(i / cols) * 40),
             style: 'classic'
           });
           setComicPages(prev => {
             const updatedPages = [...prev];
             const ptIdx = updatedPages.findIndex(p => p.id === newPageId);
             if (ptIdx !== -1) updatedPages[ptIdx] = { ...updatedPages[ptIdx], bubbles: [...bubbles] };
             return updatedPages;
           });
        }
      }
    }
    toast.dismiss();
    toast.success("Full comic generated!");
  };

  const isPointerDown = useRef(false);

  useEffect(() => {
    const handleSelectionChange = () => {
      if (createMode !== 'document') {
        setFloatingMenuProps(prev => prev.visible ? { ...prev, visible: false } : prev);
        return;
      }

      if (isPointerDown.current) {
        setFloatingMenuProps(prev => prev.visible ? { ...prev, visible: false } : prev);
        return;
      }

      const selection = window.getSelection();
      let hasTextContent = false;
      if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const clone = range.cloneContents();
        hasTextContent = clone.textContent?.trim().length ? true : false;
        if (clone.querySelectorAll('img').length > 0 && clone.textContent?.trim().length === 0) {
           hasTextContent = false;
        }
      }
      
      if (selection && hasTextContent && editorRef.current && editorRef.current.contains(selection.anchorNode)) {
        const range = selection.getRangeAt(0);
        const rects = range.getClientRects();
        if (rects.length > 0) {
          const rect = rects[0];
          setFloatingMenuProps({
            visible: true,
            top: Math.max(10, rect.top - 46),
            left: Math.max(10, Math.min(rect.left + rect.width / 2, window.innerWidth - 100)),
          });
        }
      } else {
        setFloatingMenuProps(prev => prev.visible ? { ...prev, visible: false } : prev);
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.floating-toolbar')) return;
      isPointerDown.current = true;
      setFloatingMenuProps(prev => prev.visible ? { ...prev, visible: false } : prev);
    };

    const handlePointerUp = () => {
      isPointerDown.current = false;
      setTimeout(handleSelectionChange, 10);
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [createMode]);

  useEffect(() => {
    if (onActiveStateChange) {
      onActiveStateChange(createMode !== 'select');
    }
  }, [createMode, onActiveStateChange]);

  const [activeBubbleId, setActiveBubbleId] = useState<string | null>(null);
  const [newBubbleText, setNewBubbleText] = useState('Bubble dialogue...');
  const [bubbleStyle, setBubbleStyle] = useState<'classic' | 'action' | 'whisper'>('classic');
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGeneratingText, setIsGeneratingText] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const comicRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const generateText = async () => {
    if (!aiPrompt.trim()) return;
    setIsGeneratingText(true);
    try {
      let generatedText = "";
      try {
        const res = await fetch("/api/generate-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: aiPrompt })
        });
        if (res.ok) {
          const data = await res.json();
          generatedText = data.text;
        } else {
          throw new Error("Backend text gen failed");
        }
      } catch (e: any) {
        console.warn("Falling back to client-side proxy-less text generation...", e);
        const sysPrompt = "You are a comic book script writer. Given a scenario, generate a short, punchy single speech bubble line of dialogue (or sound effect). Maximum 10-15 words. ONLY return the text that goes in the bubble, nothing else.";
        const openAiMessages = [
          { role: "system", content: sysPrompt },
          { role: "user", content: aiPrompt }
        ];
        const polRes = await fetch("https://text.pollinations.ai/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: openAiMessages, model: "openai" })
        });
        if (!polRes.ok) throw new Error("Fallback text generation failed");
        generatedText = await polRes.text();
      }

      setNewBubbleText(generatedText);
      if (activeBubbleId) {
        updateBubbleText(activeBubbleId, generatedText);
      }
      toast.success("Dialogue generated!");
    } catch (err: any) {
      toast.error(err.message || "Failed to generate dialogue");
    } finally {
      setIsGeneratingText(false);
    }
  };

  const addBubble = () => {
    const freshBubble: Bubble = {
      id: Date.now().toString(),
      text: newBubbleText || 'Dialogue',
      x: 35 + Math.random() * 20,
      y: 35 + Math.random() * 20,
      style: bubbleStyle,
    };
    updateActivePageBubbles([...bubbles, freshBubble]);
    setActiveBubbleId(freshBubble.id);
  };

  const removeBubble = (id: string) => {
    updateActivePageBubbles(bubbles.filter(b => b.id !== id));
    if (activeBubbleId === id) setActiveBubbleId(null);
  };

  const updateBubbleText = (id: string, text: string) => {
    updateActivePageBubbles(bubbles.map(b => b.id === id ? { ...b, text } : b));
  };

  const moveBubble = (id: string, dir: 'up' | 'down' | 'left' | 'right') => {
    updateActivePageBubbles(bubbles.map(b => {
      if (b.id !== id) return b;
      let { x, y } = b;
      if (dir === 'up') y = Math.max(0, y - 5);
      if (dir === 'down') y = Math.min(100, y + 5);
      if (dir === 'left') x = Math.max(0, x - 5);
      if (dir === 'right') x = Math.min(100, x + 5);
      return { ...b, x, y };
    }));
  };

  const updateToc = () => {
    if (!editorRef.current) return;
    const headings = editorRef.current.querySelectorAll('h1, h2');
    const seenIds = new Set<string>();
    
    const items = Array.from(headings).map((h: Element, index) => {
      const htmlEl = h as HTMLElement;
      
      // Generate a new ID if it doesn't have one, or if we've already seen this ID (e.g. from copy-pasting nodes)
      if (!htmlEl.id || seenIds.has(htmlEl.id)) {
        htmlEl.id = 'heading-' + Math.random().toString(36).substring(2, 9);
      }
      seenIds.add(htmlEl.id);
      
      return {
        id: htmlEl.id,
        text: htmlEl.textContent || (htmlEl.tagName === 'H1' ? 'Untitled Title' : 'Untitled Subtitle'),
        level: htmlEl.tagName === 'H1' ? 1 : 2
      };
    });
    setTocItems(items);
  };

  const execDocCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    updateToc();
  };

  useEffect(() => {
    if (createMode === 'document' && editorRef.current) {
      if (editorRef.current.innerHTML.trim() === '') {
         editorRef.current.innerHTML = '<h1></h1><h2></h2><p><br></p>';
         updateToc();
      }
    }
  }, [createMode]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (imageMenuProps.visible && imageMenuProps.imgElement) {
        e.preventDefault();
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        imageMenuProps.imgElement.parentNode?.insertBefore(p, imageMenuProps.imgElement);
        
        const sel = window.getSelection();
        if (sel) {
          const newRange = document.createRange();
          newRange.setStart(p, 0);
          newRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(newRange);
        }
        
        setImageMenuProps(prev => ({ ...prev, visible: false }));
        setTimeout(() => updateToc(), 0);
        return;
      }

      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return;
      let node: Node | null = selection.anchorNode;
      let isHeader = '';
      while (node && node !== editorRef.current) {
        if (node.nodeName === 'H1' || node.nodeName === 'H2') {
          isHeader = node.nodeName;
          break;
        }
        node = node.parentNode;
      }

      if (isHeader) {
        e.preventDefault();
        document.execCommand('insertParagraph', false);
        document.execCommand('formatBlock', false, `<${isHeader}>`);
      } else {
        // For mobile and touch keyboards where default Enter behavior is inconsistent
        if (e.nativeEvent.isComposing) return;
        e.preventDefault();
        document.execCommand('insertParagraph', false);
      }
      setTimeout(() => updateToc(), 0);
    } else {
      setTimeout(() => updateToc(), 0);
    }
  };

  const insertImageToDoc = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (editorRef.current) {
            editorRef.current.focus();
            const img = document.createElement('img');
            img.src = event.target?.result as string;
            img.style.width = '33.33%';
            
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
              const range = sel.getRangeAt(0);
              range.insertNode(img);
              range.collapse(false);
              sel.removeAllRanges();
              sel.addRange(range);
            } else {
              editorRef.current.appendChild(img);
            }
            updateToc();
          }
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  const getBubbleStyleClass = (style: 'classic' | 'action' | 'whisper') => {
    switch (style) {
      case 'action':
        return 'border border-red-500 bg-yellow-100 text-red-600 font-extrabold uppercase rounded-none px-3 py-1.5 shadow-[2px_2px_0px_0px_rgba(239,68,68,1)]';
      case 'whisper':
        return 'border border-dashed border-zinc-400 bg-white text-zinc-600 rounded-full px-4 py-2 italic';
      default:
        return 'border border-foreground bg-white text-black font-semibold rounded-2xl px-4 py-2 shadow-sm';
    }
  };

  const handleExport = async (format: string) => {
    toast.info(`Exporting as ${format.toUpperCase()}...`);
    
    const content = editorRef.current?.innerText || '';
    const htmlContent = editorRef.current?.innerHTML || '';

    try {
      if (createMode === 'comic') {
         if (!comicRef.current) return;
         
         let pageDataUrls: string[] = [];
         let pageBubbleStats: { [pageIndex: number]: { [bubbleId: string]: { w: number, h: number } } } = {};
         const originalIndex = activePageIndex;
         
         const { toPng } = await import('html-to-image');
         for (let i = 0; i < comicPages.length; i++) {
           toast.info(`Rendering page ${i + 1} of ${comicPages.length}...`);
           setActivePageIndex(i);
           await new Promise(r => setTimeout(r, 200));
           if (!comicRef.current) continue;
           
           try {
             // Extract bubble dimensions before toPng
             const bubblesOnPage = comicRef.current.querySelectorAll('.bubble-overlay');
             pageBubbleStats[i] = {};
             bubblesOnPage.forEach((el) => {
                const bId = el.getAttribute('data-bubble-id');
                if (bId) {
                   pageBubbleStats[i][bId] = {
                      w: (el as HTMLElement).offsetWidth,
                      h: (el as HTMLElement).offsetHeight
                   };
                   console.log('BUBBLE STATS', bId, pageBubbleStats[i][bId]);
                }
             });

             // toPng automatically extracts and inline computes styles without custom CSS parsing crashes
             const dataUrl = await toPng(comicRef.current, {
               backgroundColor: '#ffffff',
               pixelRatio: 2,
               skipFonts: false,
               style: {
                 border: 'none',
                 boxShadow: 'none',
                 transform: 'none',
                 margin: '0'
               },
               filter: (node) => {
                 if (node instanceof HTMLElement && node.dataset && node.dataset.exportIgnore) {
                   return false;
                 }
                 return true;
               }
             });
             pageDataUrls.push(dataUrl);
           } catch (err) {
             console.error("Failed to render page", i, err);
             toast.error(`Failed to render page ${i + 1}`);
           }
         }

         setActivePageIndex(originalIndex);

         if (format === 'png') {
           if (pageDataUrls.length === 1) {
             const a = document.createElement('a');
             a.href = pageDataUrls[0];
             a.download = 'comic.png';
             a.click();
           } else {
             const zip = new JSZip();
             pageDataUrls.forEach((data, i) => zip.file(`page_${String(i + 1).padStart(3, '0')}.png`, data.split(',')[1], { base64: true }));
             const blob = await zip.generateAsync({ type: 'blob' });
             const a = document.createElement('a');
             a.href = URL.createObjectURL(blob);
             a.download = 'comic.zip';
             a.click();
           }
         } else if (format === 'cbz' || format === 'zip') {
           const zip = new JSZip();
           pageDataUrls.forEach((data, i) => zip.file(`page_${String(i + 1).padStart(3, '0')}.png`, data.split(',')[1], { base64: true }));
           const blob = await zip.generateAsync({ type: 'blob' });
           const a = document.createElement('a');
           a.href = URL.createObjectURL(blob);
           a.download = `comic.${format}`;
           a.click();
         } else if (format === 'pdf') {
           const pdfMake = (await import('pdfmake/build/pdfmake')).default;
           const pdfFonts = (await import('pdfmake/build/vfs_fonts')).default;
           if (pdfFonts && pdfFonts.pdfMake) pdfMake.vfs = pdfFonts.pdfMake.vfs;
           else if (pdfFonts && (pdfFonts as any).vfs) pdfMake.vfs = (pdfFonts as any).vfs;
           
           const PAGE_W = 1200;
           const PAGE_H = 1600;
           
           const allContent: any[] = [];
           
           for (let i = 0; i < comicPages.length; i++) {
             if (i > 0) {
               allContent.push({ text: ' ', pageBreak: 'before', fontSize: 1 });
             }

             allContent.push({
               canvas: [{ type: 'rect', x: 0, y: 0, w: PAGE_W, h: PAGE_H, color: '#ffffff' }],
               absolutePosition: { x: 0, y: 0 }
             });
             
             const panels = computePanels(comicPages[i].tree, 0, 0, PAGE_W, PAGE_H);
             
             for (const panel of panels) {
               allContent.push({
                 canvas: [
                   { 
                     type: 'rect', 
                     x: panel.x, 
                     y: panel.y, 
                     w: panel.w, 
                     h: panel.h, 
                     lineWidth: 6,
                     lineColor: '#18181b',
                     color: '#ffffff' 
                   }
                 ],
                 absolutePosition: { x: 0, y: 0 }
               });
               
               if (panel.imageUrl) {
                 const insetX = panel.x + 3;
                 const insetY = panel.y + 3;
                 const insetW = panel.w - 6;
                 const insetH = panel.h - 6;
                 
                 const cropped = await cropImageToCover(panel.imageUrl, insetW, insetH);
                 allContent.push({
                   image: cropped,
                   absolutePosition: { x: insetX, y: insetY },
                   width: insetW,
                   height: insetH
                 });
               }
             }

             const bubbles = comicPages[i].bubbles;
             for (const b of bubbles) {
                const canvasH = comicRef.current?.offsetHeight || 800;
                const canvasW = comicRef.current?.offsetWidth || 600;
                const stats = pageBubbleStats[i]?.[b.id] || { w: 100, h: 50 };
                const pdfW = (stats.w / canvasW) * PAGE_W;
                const pdfH = (stats.h / canvasH) * PAGE_H;
                const fontSize = (14 / Math.max(canvasH, canvasW)) * Math.max(PAGE_H, PAGE_W); // slightly smaller to fit
                
                const left = (b.x / 100) * PAGE_W - (pdfW / 2);
                const top = (b.y / 100) * PAGE_H - (pdfH / 2);
       
                let bgColor = '#ffffff';
                let lineColor = '#000000';
                let isDashed = false;
                let borderRadius = Math.min(pdfW, pdfH) * 0.2;
                let fontBold = false;
                let fontItalic = false;
                let textColor = '#000000';
                let domPaddingY = 8;
                let domPaddingX = 16;
                let borderWidth = 2;

                if (b.style === 'action') {
                  bgColor = '#fef08a';
                  lineColor = '#ef4444';
                  textColor = '#dc2626';
                  borderRadius = 0;
                  fontBold = true;
                  domPaddingY = 6;
                  domPaddingX = 12;
                  
                  const offX = (2 / canvasW) * PAGE_W;
                  const offY = (2 / canvasH) * PAGE_H;
                  allContent.push({
                    canvas: [{ type: 'rect', x: left + offX, y: top + offY, w: pdfW, h: pdfH, color: '#ef4444' }],
                    absolutePosition: { x: 0, y: 0 }
                  });
                } else if (b.style === 'whisper') {
                  isDashed = true;
                  lineColor = '#a1a1aa';
                  textColor = '#52525b';
                  borderRadius = Math.min(pdfW, pdfH) / 2;
                  fontItalic = true;
                }
                
                const lineW = (borderWidth / canvasW) * PAGE_W;
                
                allContent.push({
                   canvas: [
                     {
                       type: 'rect',
                       x: left,
                       y: top,
                       w: pdfW,
                       h: pdfH,
                       r: borderRadius,
                       color: bgColor,
                       lineColor: lineColor,
                       lineWidth: lineW,
                       dash: isDashed ? { length: lineW*4, space: lineW*4 } : undefined
                     }
                   ],
                   absolutePosition: { x: 0, y: 0 }
                });
                
                const pdfPaddingY = (domPaddingY / canvasH) * PAGE_H;
                const pdfPaddingX = (domPaddingX / canvasW) * PAGE_W;
                const textWidth = pdfW * 1.05; // Slightly larger to prevent premature wrapping
                const textLeft = left - (pdfW * 0.025); // Center the expanded width
                
                allContent.push({
                  absolutePosition: { x: textLeft, y: top + pdfPaddingY + (lineW*0.6) },
                  columns: [
                    {
                      text: b.style === 'action' ? b.text.toUpperCase() : (b.text || ''),
                      width: textWidth,
                      color: textColor,
                      fontSize: fontSize,
                      bold: fontBold,
                      italics: fontItalic,
                      alignment: 'center',
                      lineHeight: 1.15,
                      margin: [0, 0, 0, 0]
                    }
                  ]
                });
             }
           }
           
           const docDefinition = {
             pageSize: { width: PAGE_W, height: PAGE_H },
             pageMargins: [0, 0, 0, 0] as [number, number, number, number],
             content: allContent
           };
           
           pdfMake.createPdf(docDefinition as any).download('comic.pdf');
         } else if (format === 'epub') {
           const zip = new JSZip();
           zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
           zip.file("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>`);
           
            let manifest = '';
           let spine = '';
           pageDataUrls.forEach((data, i) => {
              const b64 = data.split(',')[1];
              zip.file(`OEBPS/images/page_${i + 1}.png`, b64, { base64: true });
              manifest += `<item id="img${i}" href="images/page_${i + 1}.png" media-type="image/png"/>\n`;
              manifest += `<item id="page${i}" href="page_${i + 1}.xhtml" media-type="application/xhtml+xml"/>\n`;
              spine += `<itemref idref="page${i}"/>\n`;
              
              const htmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Page ${i + 1}</title>
  <meta name="viewport" content="width=1200, height=1600"/>
  <style>
    * { margin: 0; padding: 0; }
    html, body { width: 1200px; height: 1600px; overflow: hidden; }
    .page-container { width: 1200px; height: 1600px; position: relative; }
    .bg-image { width: 1200px; height: 1600px; position: absolute; top: 0; left: 0; z-index: 1; display: block; object-fit: contain; }
    .bubble { position: absolute; z-index: 2; color: transparent; text-align: center; transform: translate(-50%, -50%); display: flex; align-items: center; justify-content: center; }
    .bubble::selection { background: rgba(0,100,255,0.3); color: transparent; }
  </style>
</head>
<body>
  <div class="page-container">
    <img class="bg-image" src="images/page_${i + 1}.png" alt="Page ${i + 1}"/>
    ${comicPages[i].bubbles.map(b => {
      const stats = pageBubbleStats[i]?.[b.id] || { w: 100, h: 50 };
      const canvasW = comicRef.current?.offsetWidth || 600;
      const canvasH = comicRef.current?.offsetHeight || 800;
      const wPx = (stats.w / canvasW) * 1200;
      const hPx = (stats.h / canvasH) * 1600;
      const fontSizePx = (16 / canvasH) * 1600;
      return `<div class="bubble" style="left: ${b.x}%; top: ${b.y}%; width: ${wPx}px; height: ${hPx}px; font-size: ${fontSizePx}px;">${b.text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
    }).join('\n    ')}
  </div>
</body>
</html>`;
              zip.file(`OEBPS/page_${i + 1}.xhtml`, htmlContent);
           });
           
           zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">\n<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n  <dc:title>Comic</dc:title>\n  <dc:language>en</dc:language>\n  <dc:identifier id="BookId">urn:uuid:${Date.now()}</dc:identifier>\n  <meta property="rendition:layout">pre-paginated</meta>\n  <meta property="rendition:spread">none</meta>\n</metadata>\n<manifest>${manifest}</manifest>\n<spine>${spine}</spine>\n</package>`);
           
           const blob = await zip.generateAsync({ type: 'blob' });
           const a = document.createElement('a');
           a.href = URL.createObjectURL(blob);
           a.download = `comic.epub`;
           a.click();
         }
         toast.success(`${format.toUpperCase()} export complete!`);
         return;
      } else if (format === 'txt') {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'document.txt';
        a.click();
        URL.revokeObjectURL(url);
      } else if (format === 'pdf') {
         toast.info("Generating PDF...");
         try {
           const htmlToPdfmake = (await import('html-to-pdfmake')).default;
           const pdfMake = (await import('pdfmake/build/pdfmake')).default;
           const pdfFonts = (await import('pdfmake/build/vfs_fonts')).default;
           if (pdfFonts && pdfFonts.pdfMake) {
             pdfMake.vfs = pdfFonts.pdfMake.vfs;
           } else if (pdfFonts && (pdfFonts as any).vfs) {
             pdfMake.vfs = (pdfFonts as any).vfs;
           }
           
           const val = htmlToPdfmake(htmlContent, {
             defaultStyles: {
               h1: { fontSize: 24, bold: true, margin: [0, 0, 0, 10] },
               h2: { fontSize: 18, color: '#444444', margin: [0, 0, 0, 10] },
               p: { margin: [0, 0, 0, 10] }
             }
           });
           
           const addImageFit = (nodes: any) => {
             if (Array.isArray(nodes)) {
               for (const node of nodes) addImageFit(node);
             } else if (nodes && typeof nodes === 'object') {
               if (nodes.image) {
                 nodes.fit = [500, 740];
                 delete nodes.width;
                 delete nodes.height;
               }
               for (const key in nodes) {
                 if (key !== 'image') addImageFit(nodes[key]);
               }
             }
           };
           addImageFit(val);

           const docDefinition = { 
             content: val,
             defaultStyle: { font: 'Roboto' }
           };
           pdfMake.createPdf(docDefinition).download('document.pdf');
           toast.success("PDF export complete!");
         } catch (err: any) {
           toast.error("Failed to generate PDF: " + err.message);
         }
      } else if (format === 'epub' || format === 'docx') {
         toast.info(`Generating ${format.toUpperCase()}...`);
         const response = await fetch(`/api/export/${format}`, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ html: htmlContent, title: 'Document' })
         });
         
         if (!response.ok) {
           const errText = await response.text();
           throw new Error(`Export failed: ${errText}`);
         }
         
         const json = await response.json();
         if (!json.data) throw new Error("No data received from server");
         
         // Decode Base64 to ArrayBuffer
         const binaryString = window.atob(json.data);
         const bytes = new Uint8Array(binaryString.length);
         for (let i = 0; i < binaryString.length; i++) {
             bytes[i] = binaryString.charCodeAt(i);
         }
         
         const mimeType = format === 'docx' 
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
            : 'application/epub+zip';
         const blob = new Blob([bytes.buffer], { type: mimeType });
         const url = URL.createObjectURL(blob);
         const a = document.createElement('a');
         a.href = url;
         a.download = `document.${format}`;
         a.click();
         URL.revokeObjectURL(url);
      } else if (format === 'cbz') {
         // Create simple text/html fallback for cbz unsupported direct generation
         const blob = new Blob([htmlContent], { type: 'text/html' });
         const url = URL.createObjectURL(blob);
         const a = document.createElement('a');
         a.href = url;
         a.download = `document.html`;
         a.click();
         URL.revokeObjectURL(url);
         toast.info("Saved CBZ as HTML file for now.");
      }
      toast.success(`${format.toUpperCase()} export complete!`);
    } catch (e) {
      console.error("Export failure:", e);
      toast.error(`Export to ${format.toUpperCase()} failed.`);
    }
  };

  const renderExportMenu = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 shrink-0 h-8 text-xs font-semibold">
          <Download className="w-4 h-4"/> <span className="hidden sm:inline">Export</span> <ChevronDown className="w-3 h-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {createMode === 'document' ? (
            <>
                <DropdownMenuItem onClick={() => handleExport('pdf')}>PDF</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('epub')}>EPUB</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('docx')}>DOCX</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('txt')}>TXT</DropdownMenuItem>
            </>
        ) : (
            <>
                <DropdownMenuItem onClick={() => handleExport('pdf')}>PDF</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('epub')}>EPUB</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('cbz')}>CBZ</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('zip')}>ZIP</DropdownMenuItem>
                <div className="w-full h-px bg-border my-1" />
                <DropdownMenuItem onClick={() => handleExport('png')}>Image (PNG)</DropdownMenuItem>
            </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (createMode === 'select') {
    return (
      <div className="max-w-4xl mx-auto p-4 space-y-8 flex flex-col items-center justify-center min-h-[calc(100vh-8rem)]">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold font-serif">Choose a Canvas</h1>
          <p className="text-muted-foreground text-sm">Select the type of creation you want to start with.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-6 w-full max-w-2xl">
          <Card 
            className="p-6 border border-border cursor-pointer hover:border-primary transition-all hover:shadow-md flex flex-col items-center text-center gap-4 bg-card"
            onClick={() => setCreateMode('comic')}
          >
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary">
              <Layout className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-bold mb-1">Free Online Comic Book & Manga Creator</h3>
            </div>
          </Card>
          <Card 
            className="p-6 border border-border cursor-pointer hover:border-primary transition-all hover:shadow-md flex flex-col items-center text-center gap-4 bg-card"
            onClick={() => setCreateMode('document')}
          >
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary">
              <Type className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-bold mb-1">Rich Text Script & Document Editor</h3>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (createMode === 'document') {
    return (
      <div className="flex-1 bg-background flex flex-col overflow-hidden h-[100dvh]">
        <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md shrink-0 no-print">
          <div className="w-full px-2 h-11 flex items-center justify-between gap-2">
            <div className="flex flex-1 items-center gap-0.5 overflow-x-auto no-scrollbar py-1">
              <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                  className="w-8 h-8 shrink-0"
                  title={isSidebarOpen ? "Hide Sidebar" : "Show Sidebar"}
                >
                  {isSidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
              </Button>
              <div className="w-px h-5 bg-border mx-1 shrink-0" />
              <Button variant="ghost" size="sm" onClick={() => setCreateMode('select')} className="gap-2 text-xs font-semibold px-3 shrink-0">
                <ChevronLeft className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Back</span>
              </Button>
              <div className="w-px h-5 bg-border mx-1 hidden sm:block shrink-0" />
              <div className="flex items-center gap-0.5">
                <Button variant="ghost" size="sm" className="gap-2 shrink-0" onClick={insertImageToDoc} title="Insert Image">
                  <ImageIcon className="w-4 h-4" /> <span className="hidden sm:inline">Image</span>
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2 pr-2">
              {renderExportMenu()}
            </div>
          </div>
        </header>

        <main className="flex-1 relative w-full overflow-hidden flex min-h-0 bg-background print-wrapper">
          <AnimatePresence>
            {floatingMenuProps.visible && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
                transition={{ duration: 0.15 }}
                onMouseDown={(e) => e.preventDefault()}
                className="floating-toolbar fixed z-[100] flex flex-wrap justify-center items-center gap-1 p-1 bg-background border shadow-lg rounded-md no-print w-fit max-w-[90vw]"
                style={{ top: floatingMenuProps.top, left: floatingMenuProps.left, transform: 'translateX(-50%)' }}
              >
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => execDocCommand('formatBlock', 'H1')}><Heading1 className="w-3.5 h-3.5 md:mr-1.5"/> <span className="hidden md:inline">Title</span></Button>
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => execDocCommand('formatBlock', 'H2')}><Heading2 className="w-3.5 h-3.5 md:mr-1.5"/> <span className="hidden md:inline">Subtitle</span></Button>
                <div className="w-px h-4 bg-border mx-1" />
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => execDocCommand('formatBlock', 'P')}><Type className="w-3.5 h-3.5 md:mr-1.5"/> <span className="hidden md:inline">Text</span></Button>
                <div className="w-px h-4 bg-border mx-1 border-r border-border" />
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-primary" onMouseDown={(e) => e.preventDefault()} onClick={() => {
                  const selection = window.getSelection()?.toString();
                  if (selection) {
                    window.dispatchEvent(new CustomEvent('quote-to-agent', { detail: { type: 'text', text: selection } }));
                  }
                }}><Bot className="w-4 h-4 md:mr-1.5"/> <span className="hidden md:inline">Ask AI</span></Button>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {imageMenuProps.visible && imageMenuProps.imgElement && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => e.stopPropagation()}
                className="fixed z-[100] pointer-events-auto"
                style={{ top: imageMenuProps.top, left: imageMenuProps.left, transform: 'translate(-50%, -100%) translateY(-10px)' }}
              >
                  <ImageToolbar 
                    color={imageMenuProps.imgElement?.style.borderColor || '#000000'}
                    isHighContrast={!!imageMenuProps.imgElement?.style.filter.includes('grayscale')}
                    hasOutline={!!imageMenuProps.imgElement?.style.border}
                    onUpdate={(updates) => {
                       if (!imageMenuProps.imgElement) return;
                       if (updates.color !== undefined || updates.hasOutline !== undefined) {
                          if (updates.hasOutline !== false) {
                            imageMenuProps.imgElement.style.border = `2px solid ${updates.color || imageMenuProps.imgElement.style.borderColor || '#000000'}`;
                            imageMenuProps.imgElement.style.boxSizing = 'border-box';
                          } else {
                            imageMenuProps.imgElement.style.border = '';
                          }
                       }
                       if (updates.isHighContrast !== undefined) {
                           imageMenuProps.imgElement.style.filter = updates.isHighContrast ? 'grayscale(1) contrast(1.25)' : '';
                       }
                       if (updates.url !== undefined) {
                           imageMenuProps.imgElement.src = updates.url;
                       }
                       updateToc();
                       setImageMenuProps(prev => ({ ...prev }));
                    }}
                    onMoveLayer={(dir) => {
                       if (!imageMenuProps.imgElement) return;
                       if (dir === 'up' && imageMenuProps.imgElement.previousElementSibling) {
                           imageMenuProps.imgElement.parentNode?.insertBefore(imageMenuProps.imgElement, imageMenuProps.imgElement.previousElementSibling);
                       } else if (dir === 'down' && imageMenuProps.imgElement.nextElementSibling) {
                           imageMenuProps.imgElement.parentNode?.insertBefore(imageMenuProps.imgElement.nextElementSibling, imageMenuProps.imgElement);
                       }
                       updateToc();
                    }}
                    onCropToggle={() => {
                       setIsImageCropping(!isImageCropping);
                    }}
                    isCropping={isImageCropping}
                    onDragStartMove={(e) => {
                       if (!imageMenuProps.imgElement) return;
                       e.dataTransfer.effectAllowed = 'copyMove';
                       
                       const originalId = imageMenuProps.imgElement.id || ('img-' + Date.now());
                       imageMenuProps.imgElement.id = originalId;
                       
                       const clone = imageMenuProps.imgElement.cloneNode(true) as HTMLImageElement;
                       clone.id = ''; 
                       
                       e.dataTransfer.setData('image-drag-id', originalId);
                       e.dataTransfer.setData('text/html', clone.outerHTML);
                       e.dataTransfer.setData('text/plain', ' ');
                       e.dataTransfer.setDragImage(imageMenuProps.imgElement, 0, 0);
                       setTimeout(() => setImageMenuProps(prev => ({...prev, visible: false})), 0);
                    }}
                    onClickAskAI={() => {
                        if (!imageMenuProps.imgElement) return;
                        window.dispatchEvent(new CustomEvent('quote-to-agent', {
                           detail: { type: 'image', imageUrl: imageMenuProps.imgElement.src }
                        }));
                        setImageMenuProps(prev => ({ ...prev, visible: false }));
                    }}
                    onRegenerate={() => {
                       if (!imageMenuProps.imgElement) return;
                       const match = imageMenuProps.imgElement.src.match(/prompt\/([^?]+)/);
                       if (match) {
                          try {
                             const prompt = decodeURIComponent(match[1]);
                             const newSeed = Math.floor(Math.random() * 100000000);
                             const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${newSeed}&model=flux`;
                             imageMenuProps.imgElement.src = url;
                             updateToc();
                          } catch(e) {}
                       }
                       setImageMenuProps(prev => ({ ...prev, visible: false }));
                    }}
                    onDelete={() => {
                        if (!imageMenuProps.imgElement) return;
                        imageMenuProps.imgElement.remove();
                        updateToc();
                        setImageMenuProps(prev => ({ ...prev, visible: false }));
                    }}
                  />
              </motion.div>
            )}
          </AnimatePresence>
          {isImageCropping && imageMenuProps.visible && imageMenuProps.imgElement && (
            <CanvasCropOverlay 
              imgElement={imageMenuProps.imgElement} 
              onClose={() => setIsImageCropping(false)} 
              updateToc={updateToc} 
            />
          )}
          {!isImageCropping && imageMenuProps.visible && imageMenuProps.imgElement && (
            <CanvasResizeOverlay 
              imgElement={imageMenuProps.imgElement} 
              updateToc={updateToc} 
            />
          )}
          <AnimatePresence initial={false}>
            {isSidebarOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-30 bg-black/5"
                  onClick={() => setIsSidebarOpen(false)}
                />
                <motion.aside
                  initial={{ x: -180, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -180, opacity: 0 }}
                  transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                  className="absolute z-40 top-0 left-0 bottom-0 w-[140px] md:w-[180px] border-r bg-background/95 backdrop-blur-md shadow-2xl flex flex-col overflow-hidden no-print"
                >
                  <div className="p-3 border-b shrink-0 flex items-center justify-between bg-muted/30">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5"><List className="w-3 h-3"/> Outline</span>
                  </div>
                  <div className="flex-1 overflow-y-auto no-scrollbar py-2">
                    {tocItems.map((item, idx) => (
                      <div 
                        key={idx}
                        className={`px-4 py-1.5 hover:bg-muted cursor-pointer transition-colors border-l-2 border-transparent hover:border-primary flex items-start truncate`}
                        onClick={() => {
                          const el = document.getElementById(item.id);
                          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }}
                      >
                        <span className={item.level === 1 ? "text-sm font-semibold text-foreground truncate" : "text-xs font-normal pl-3 text-muted-foreground truncate"}>
                          {item.text}
                        </span>
                      </div>
                    ))}
                    {tocItems.length === 0 && (
                      <div className="text-center p-4 text-xs font-semibold text-muted-foreground/60">
                        Empty outline
                      </div>
                    )}
                  </div>
                </motion.aside>
              </>
            )}
          </AnimatePresence>
           <div className="flex-1 p-2 md:p-6 overflow-hidden flex flex-col items-center print-wrapper">
             <div 
               ref={editorRef}
               onScroll={() => {
                 if (floatingMenuProps.visible) {
                    const selection = window.getSelection();
                    if (selection && selection.rangeCount > 0) {
                      const range = selection.getRangeAt(0);
                      const rects = range.getClientRects();
                      if (rects.length > 0) {
                        const rect = rects[0];
                        setFloatingMenuProps(prev => ({ ...prev, top: Math.max(10, rect.top - 46), left: Math.max(10, Math.min(rect.left + rect.width / 2, window.innerWidth - 100)) }));
                      }
                    }
                 }
                 if (imageMenuProps.visible && imageMenuProps.imgElement) {
                    const rect = imageMenuProps.imgElement.getBoundingClientRect();
                    setImageMenuProps(prev => ({ ...prev, top: rect.top, left: rect.left + rect.width / 2 }));
                 }
               }}
               onKeyDown={handleKeyDown}
               onClick={(e) => {
                 const target = e.target as HTMLElement;
                 if (target.tagName === 'IMG') {
                   const rect = target.getBoundingClientRect();
                   setImageMenuProps({
                     visible: true,
                     top: rect.top,
                     left: rect.left + rect.width / 2,
                     imgElement: target as HTMLImageElement
                   });
                 } else {
                   setImageMenuProps(prev => ({ ...prev, visible: false }));
                   if (target === editorRef.current) {
                     const sel = window.getSelection();
                     if (sel) {
                       let p = editorRef.current.lastElementChild;
                       if (!p || p.tagName !== 'P' || (p.textContent?.trim() !== '' && !p.querySelector('br'))) {
                         p = document.createElement('p');
                         p.innerHTML = '<br>';
                         editorRef.current.appendChild(p);
                       }
                       const range = document.createRange();
                       range.selectNodeContents(p);
                       range.collapse(false);
                       sel.removeAllRanges();
                       sel.addRange(range);
                     }
                   }
                 }
               }}
               onDragOver={(e) => {
                 const types = Array.from(e.dataTransfer.types);
                 if (types.includes('image-drag-id') || types.includes('text/html')) {
                   e.preventDefault();
                   // @ts-ignore
                   const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
                   if (range) {
                     const sel = window.getSelection();
                     sel?.removeAllRanges();
                     sel?.addRange(range);
                   }
                 }
               }}
               onDrop={(e) => {
                 const dragId = e.dataTransfer.getData('image-drag-id');
                 if (dragId) {
                   e.preventDefault();
                   setImageMenuProps(prev => ({ ...prev, visible: false }));
                   
                   const oldImg = document.getElementById(dragId);
                   if (oldImg) {
                     // @ts-ignore
                     const dropRange = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
                     
                     if (dropRange) {
                       dropRange.insertNode(oldImg);
                       dropRange.collapse(false);
                       const sel = window.getSelection();
                       sel?.removeAllRanges();
                       sel?.addRange(dropRange);
                     } else {
                       const sel = window.getSelection();
                       if (sel && sel.rangeCount > 0) {
                         const range = sel.getRangeAt(0);
                         range.insertNode(oldImg);
                         range.collapse(false);
                         sel.removeAllRanges();
                         sel.addRange(range);
                       }
                     }
                   }
                   
                   setTimeout(() => {
                     updateToc();
                   }, 0);
                 }
               }}
               className="w-full max-w-4xl bg-card border shadow-sm p-8 md:p-12 overflow-y-auto font-serif text-lg leading-relaxed outline-none [&_img]:max-w-full [&_img]:my-4 [&_img]:rounded-md [&_h1]:text-4xl [&_h1]:font-extrabold [&_h1]:text-foreground [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-muted-foreground editor-doc h-full print-content" 
               contentEditable 
               suppressContentEditableWarning 
               data-placeholder="Start writing your story..."
               style={{ emptyCells: 'show' }}
               onInput={updateToc}
             >
             </div>
          </div>
          <style dangerouslySetInnerHTML={{__html: `
            .editor-doc h1 { border-bottom: 2px dashed #e5e7eb; padding-bottom: 0.25rem; margin-bottom: 0.5rem; }
            .editor-doc h2 { border-bottom: 1px dashed #e5e7eb; padding-bottom: 0.25rem; margin-bottom: 1rem; }
            .editor-doc img { page-break-inside: avoid; break-inside: avoid; }
            .editor-doc p { min-height: 1.5em; cursor: text; outline: none; }
            .editor-doc h1:empty:before, .editor-doc h1:has(> br:only-child):before { content: 'Title'; color: #4b5563; pointer-events: none; opacity: 0.5; }
            .editor-doc h2:empty:before, .editor-doc h2:has(> br:only-child):before { content: 'Subtitle'; color: #4b5563; pointer-events: none; opacity: 0.5; }
            .editor-doc:empty:before, .editor-doc:has(> br:only-child):before { content: 'Start writing your story...'; color: #4b5563; pointer-events: none; opacity: 0.5; }
            .editor-doc p:empty:before, .editor-doc p:has(> br:only-child):before { content: 'Start writing your story...'; color: #4b5563; pointer-events: none; opacity: 0.5; }
            .editor-doc div:empty:before, .editor-doc div:has(> br:only-child):before { content: 'Start writing your story...'; color: #4b5563; pointer-events: none; opacity: 0.5; }
         `}} />
        </main>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-background flex flex-col overflow-hidden h-[100dvh]">
      <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md shrink-0">
        <div className="w-full px-2 h-11 flex items-center justify-between gap-2">
          <div className="flex flex-1 items-center gap-0.5 overflow-x-auto no-scrollbar py-1">
            <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="w-8 h-8 shrink-0"
                title={isSidebarOpen ? "Hide Sidebar" : "Show Sidebar"}
              >
                {isSidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            </Button>
            <div className="w-px h-5 bg-border mx-1 shrink-0" />
            <Button variant="ghost" size="sm" onClick={() => setCreateMode('select')} className="gap-1 text-xs font-semibold px-2 shrink-0">
              <ChevronLeft className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Back</span>
            </Button>
            <div className="w-px h-5 bg-border mx-1 shrink-0" />
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant={isDrawingMode ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  const val = !isDrawingMode;
                  setIsDrawingMode(val);
                  if (val) setDrawTool('pen');
                }}
                className={`gap-1 px-2 text-xs font-semibold ${isDrawingMode ? 'bg-primary/20 text-primary hover:bg-primary/30' : 'text-muted-foreground hover:text-foreground'}`}
                title="Draw Mode (Hotkey: D)"
              >
                <PenTool className="w-4 h-4" /> <span className="hidden sm:inline">Draw</span>
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 pr-2">
            {renderExportMenu()}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsBubbleSidebarOpen(!isBubbleSidebarOpen)}
              className="gap-2 shrink-0 h-8 text-xs font-semibold"
            >
              <MessageSquare className="w-3.5 h-3.5" /> <span className="hidden sm:inline">bubbles</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 relative w-full overflow-hidden flex bg-background">
        <AIGeneratorDialog 
          open={isAIGeneratorOpen} 
          onOpenChange={setIsAIGeneratorOpen} 
          onGeneratorSuccess={(imageUrl) => {
            const { tree, updated } = fillFirstEmptyPanel(comicTree, imageUrl);
            if (updated) {
              updateActivePageTree(tree);
              toast.success("Image added to comic panel!");
            } else {
              toast.error("No empty panels available on the current page to insert the image.");
            }
          }}
        />
        <AIFullComicDialog 
          open={isAIFullComicDialogOpen}
          onOpenChange={setIsAIFullComicDialogOpen}
          onComicGenerated={handleFullComicGenerated}
          initialPrompt={aiFullComicPrompt}
          autoSubmit={true}
        />
        <AIFullStoryDialog
          open={isAIFullStoryDialogOpen}
          onOpenChange={setIsAIFullStoryDialogOpen}
          initialPrompt={aiFullStoryPrompt}
          autoSubmit={true}
          onStoryGenerated={(htmlContent) => {
            setIsAIFullStoryDialogOpen(false);
            if (editorRef.current) {
               editorRef.current.innerHTML = htmlContent;
               toast.success("Story generated successfully!");
            }
          }}
        />
        <AnimatePresence initial={false}>
          {isSidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-30 bg-black/5"
                onClick={() => setIsSidebarOpen(false)}
              />
              <motion.aside
                initial={{ x: -180, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -180, opacity: 0 }}
                transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                className="absolute top-0 left-0 bottom-0 z-40 w-[160px] border-r bg-background/95 backdrop-blur-md shadow-2xl flex flex-col overflow-hidden shrink-0"
              >
              <div className="p-3 border-b shrink-0 flex items-center justify-between">
                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Pages</span>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-5 w-5 rounded-none hover:bg-muted" 
                  onClick={() => {
                    setComicPages([...comicPages, {
                      id: Date.now().toString(),
                      tree: createGridTree(3, 2),
                      bubbles: []
                    }]);
                    setActivePageIndex(comicPages.length);
                  }}
                  title="Add Page"
                >
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto no-scrollbar py-2 space-y-2 p-2">
                {comicPages.map((page, idx) => (
                  <div 
                    key={page.id}
                    onClick={() => setActivePageIndex(idx)}
                    className={`relative aspect-[3/4] w-full rounded-md border overflow-hidden cursor-pointer bg-zinc-100 transition-all ${activePageIndex === idx ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/50'}`}
                  >
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-1">
                       <span className="text-[9px] font-bold text-white shadow-sm">Page {idx + 1}</span>
                    </div>
                    {comicPages.length > 1 && (
                      <div className="absolute top-1 right-1 opacity-0 hover:opacity-100 transition-opacity">
                         <Button
                           variant="destructive"
                           size="icon"
                           className="w-5 h-5 rounded-full"
                           onClick={(e) => {
                             e.stopPropagation();
                             const newPages = comicPages.filter((_, i) => i !== idx);
                             setComicPages(newPages);
                             if (activePageIndex >= newPages.length) setActivePageIndex(Math.max(0, newPages.length - 1));
                           }}
                         >
                           <Trash2 className="w-3 h-3" />
                         </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </motion.aside>
            </>
          )}
        </AnimatePresence>
        
        <div className="flex-1 w-full min-h-0 relative h-full flex flex-col lg:flex-row bg-background overflow-hidden">
          {/* Main Canvas Area */}
          <div className="flex-1 relative h-full flex justify-center items-center p-2 lg:p-4 min-w-0 min-h-0 bg-background/50 overflow-hidden">
             <div className="relative max-h-full max-w-full inline-flex justify-center items-center h-full">
                <svg viewBox="0 0 3 4" className="block h-full max-w-full max-h-full w-auto opacity-0 pointer-events-none" />
                <div ref={comicRef} className="absolute top-0 left-0 w-full h-full bg-background ring-1 ring-border shadow-2xl overflow-hidden">
               <ComicCanvas tree={comicTree} onChange={updateActivePageTree} isDrawingMode={isDrawingMode} drawTool={drawTool} drawColor={drawColor} drawRadius={drawRadius} />

             {/* Bubble overlays layer */}
             {bubbles.map((b) => (
               <div
                 key={b.id}
                 data-bubble-id={b.id}
                 style={{ left: `${b.x}%`, top: `${b.y}%` }}
                 onDoubleClick={(e) => {
                   e.stopPropagation();
                   removeBubble(b.id);
                 }}
                 onPointerDown={(e) => {
                   // Ignore drag operations initiated inside the contenteditable text
                   if ((e.target as HTMLElement).closest('[contenteditable="true"]')) {
                     return;
                   }
                   e.stopPropagation();
                   setActiveBubbleId(b.id);
                   setNewBubbleText(b.text);
                   setBubbleStyle(b.style);
                   const target = e.currentTarget as HTMLElement;
                   const parent = target.parentElement!;
                   
                   let initialX = e.clientX;
                   let initialY = e.clientY;
                   let startLeft = b.x;
                   let startTop = b.y;

                   const onPointerMove = (ev: PointerEvent) => {
                     const rect = parent.getBoundingClientRect();
                     const dX = ((ev.clientX - initialX) / rect.width) * 100;
                     const dY = ((ev.clientY - initialY) / rect.height) * 100;
                     updateActivePageBubbles(bubbles.map(bubble => bubble.id === b.id ? {
                       ...bubble,
                       x: Math.max(0, Math.min(100, startLeft + dX)),
                       y: Math.max(0, Math.min(100, startTop + dY))
                     } : bubble));
                   };

                   const onPointerUp = (ev: PointerEvent) => {
                     target.releasePointerCapture(ev.pointerId);
                     target.removeEventListener('pointermove', onPointerMove);
                     target.removeEventListener('pointerup', onPointerUp);
                   };

                   target.setPointerCapture(e.pointerId);
                   target.addEventListener('pointermove', onPointerMove);
                   target.addEventListener('pointerup', onPointerUp);
                 }}
                 className={`bubble-overlay absolute transform -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing select-none touch-none ${
                   activeBubbleId === b.id ? 'ring-2 ring-primary ring-offset-2 z-30' : 'z-20'
                 }`}
               >
                 <div className={getBubbleStyleClass(b.style)}>
                   <div
                     contentEditable
                     suppressContentEditableWarning
                     onClick={(e) => e.stopPropagation()}
                     onDoubleClick={(e) => {
                       e.stopPropagation();
                       removeBubble(b.id);
                     }}
                     onPointerDown={(e) => {
                       e.stopPropagation();
                       (window as any)._bubbleLongPress = setTimeout(() => {
                          window.dispatchEvent(new CustomEvent('quote-to-agent', {
                             detail: { type: 'text', text: b.text }
                          }));
                       }, 500);
                     }}
                     onPointerUp={(e) => {
                        if ((window as any)._bubbleLongPress) clearTimeout((window as any)._bubbleLongPress);
                     }}
                     onPointerLeave={(e) => {
                        if ((window as any)._bubbleLongPress) clearTimeout((window as any)._bubbleLongPress);
                     }}
                     onPointerCancel={(e) => {
                        if ((window as any)._bubbleLongPress) clearTimeout((window as any)._bubbleLongPress);
                     }}
                     onBlur={(e) => {
                       const txt = e.currentTarget.innerText || '';
                       updateBubbleText(b.id, txt);
                     }}
                     onInput={(e) => {
                       const txt = e.currentTarget.innerText || '';
                       setNewBubbleText(txt);
                       updateBubbleText(b.id, txt);
                     }}
                     onKeyDown={(e) => {
                       e.stopPropagation();
                     }}
                     className="text-xs break-words text-center min-w-[60px] max-w-[180px] whitespace-pre-wrap outline-none cursor-text py-0.5 px-1 font-semibold"
                     title="Double click outside text to delete bubble"
                   >
                     {b.text}
                   </div>
                 </div>
               </div>
             ))}
          </div>
          </div>

          {/* removed hint */}
        </div>

        {/* Sidebar Controls */}
        <AnimatePresence initial={false}>
          {isBubbleSidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-40 bg-black/5"
                onClick={() => setIsBubbleSidebarOpen(false)}
              />
              <motion.aside
                initial={{ x: 320, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 320, opacity: 0 }}
                transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                className="absolute right-0 top-0 bottom-0 w-[320px] shrink-0 border-l border-border bg-background/95 backdrop-blur-md shadow-2xl p-4 overflow-y-auto z-50 flex flex-col gap-4"
              >
                <Card className="p-4 border border-border rounded-none shadow-none bg-card space-y-4">
                  <h3 className="text-sm font-bold text-foreground">Bubble Creator Dialogue</h3>
            
            <div className="space-y-2">
              <div className="flex justify-between items-center bg-muted/50 p-2 rounded-md border border-border">
                <div className="flex flex-col flex-1 mr-2 gap-2">
                  <span className="text-[10px] font-mono font-bold text-muted-foreground flex items-center gap-1"><Sparkles className="w-3 h-3 text-primary"/> AI WRITER</span>
                  <input
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="E.g. Hero's dramatic entrance..."
                    className="w-full text-xs p-1.5 border border-border bg-background rounded-sm outline-none focus:border-primary"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') generateText();
                    }}
                  />
                </div>
                <Button 
                  size="sm" 
                  onClick={generateText}
                  disabled={isGeneratingText || !aiPrompt.trim()}
                  className="h-8 text-[10px] mt-6"
                >
                  {isGeneratingText ? "..." : "Generate"}
                </Button>
              </div>
              <label className="text-[10px] font-mono font-bold text-muted-foreground block mt-4">TEXT VALUE</label>
              <textarea
                ref={textareaRef}
                value={newBubbleText}
                onChange={(e) => {
                  setNewBubbleText(e.target.value);
                  if (activeBubbleId) updateBubbleText(activeBubbleId, e.target.value);
                }}
                className="w-full text-xs font-semibold p-2 border border-border bg-background h-16 resize-none rounded-none outline-none focus:border-primary"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-mono font-bold text-muted-foreground block">BUBBLE EXPRESSION STYLE</label>
              <div className="grid grid-cols-3 gap-2">
                {(['classic', 'action', 'whisper'] as const).map((style) => (
                  <Button 
                    key={style}
                    variant={bubbleStyle === style ? 'default' : 'ghost'}
                    className={`capitalize text-[10px] h-8 rounded-none px-1 ${bubbleStyle !== style ? 'border border-border hover:bg-muted' : ''}`}
                    onClick={() => {
                      setBubbleStyle(style);
                      if (activeBubbleId) {
                        updateActivePageBubbles(bubbles.map(b => b.id === activeBubbleId ? { ...b, style } : b));
                      }
                    }}
                  >
                    {style}
                  </Button>
                ))}
              </div>
            </div>

            <Button onClick={addBubble} className="w-full gap-2 rounded-none bg-primary hover:bg-primary/95 text-xs text-primary-foreground h-9 font-bold">
              <Plus className="w-4 h-4" /> Add Bubble to Panel
            </Button>
          </Card>

          {activeBubbleId && (
            <Card className="p-4 border border-border rounded-none shadow-none bg-card space-y-4 border-primary">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-foreground">Bubble Settings</span>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeBubble(activeBubbleId)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </Card>
          )}

          <div className="flex flex-col gap-2 pt-2 pb-8 lg:pb-2">
            <Button variant="ghost" className="w-full rounded-none gap-1.5 text-xs h-9 text-destructive hover:bg-destructive/10 hover:text-destructive border border-destructive/20" onClick={() => {
              updateActivePageBubbles([]);
              setActiveBubbleId(null);
            }}>
              <Trash2 className="w-4 h-4" />
              Reset Panel
            </Button>
          </div>
        </motion.aside>
        </>
        )}
        </AnimatePresence>
        </div>
        
        {/* Drawing Mode Toolbar */}
        {isDrawingMode && (
          <div 
            className="fixed bg-background text-foreground border shadow-lg rounded-2xl md:rounded-full flex flex-wrap items-center justify-center p-1.5 gap-1 z-50 backdrop-blur-md cursor-move select-none w-fit max-w-[90vw]"
            style={{ left: Math.max(0, Math.min(drawToolbarPos.x, window.innerWidth - 320)), top: Math.max(10, drawToolbarPos.y), touchAction: 'none' }}
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).tagName.toLowerCase() === 'input' || (e.target as HTMLElement).closest('button')) return;
              setIsDraggingToolbar(true);
              dragToolbarStartRef.current = { x: e.clientX, y: e.clientY, posX: drawToolbarPos.x, posY: drawToolbarPos.y };
            }}
            onTouchStart={(e) => {
              if ((e.target as HTMLElement).tagName.toLowerCase() === 'input' || (e.target as HTMLElement).closest('button')) return;
              setIsDraggingToolbar(true);
              dragToolbarStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, posX: drawToolbarPos.x, posY: drawToolbarPos.y };
            }}
          >
            <Button variant={drawTool === 'pen' ? 'secondary' : 'ghost'} size="icon" className="w-8 h-8 rounded-full" onClick={() => setDrawTool('pen')} title="Pen (P)">
              <PenTool className="w-4 h-4" />
            </Button>
            <Button variant={drawTool === 'erase' ? 'secondary' : 'ghost'} size="icon" className="w-8 h-8 rounded-full" onClick={() => setDrawTool('erase')} title="Erase (E)">
              <Eraser className="w-4 h-4" />
            </Button>
            <Button variant={drawTool === 'fill' ? 'secondary' : 'ghost'} size="icon" className="w-8 h-8 rounded-full" onClick={() => setDrawTool('fill')} title="Fill (F)">
              <PaintBucket className="w-4 h-4" />
            </Button>
            <Button variant={drawTool === 'select' ? 'secondary' : 'ghost'} size="icon" className="w-8 h-8 rounded-full" onClick={() => setDrawTool('select')} title="Lasso (L)">
              <LassoSelect className="w-4 h-4" />
            </Button>
            <div className="w-px h-6 bg-border mx-1" />
            <input type="color" value={drawColor} onChange={(e) => setDrawColor(e.target.value)} className="w-6 h-6 rounded cursor-pointer border-0 p-0" title="Color" />
            <input type="range" min="1" max="20" value={drawRadius} onChange={(e) => setDrawRadius(parseInt(e.target.value))} className="w-16 mx-2 cursor-pointer" title="Brush Size" />
          </div>
        )}
      </main>
    </div>
  );
};

