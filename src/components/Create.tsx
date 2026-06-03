import React, { useState, useRef, useEffect } from 'react';
import { BookOpen, PenTool, Wrench, Plus, Trash2, Layout, Smile, Sparkles, Type, Image, Layers, Save, Check, ChevronLeft, Download, PanelLeftClose, PanelLeftOpen, ChevronDown, Heading1, Heading2, Minus, List, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { ComicCanvas, createGridTree, TreeNode } from './ComicCanvas';
import JSZip from 'jszip';

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

export const Create: React.FC<CreateProps> = ({ setActiveView, onActiveStateChange }) => {
  const [createMode, setCreateMode] = useState<'select' | 'comic' | 'document'>('select');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isBubbleSidebarOpen, setIsBubbleSidebarOpen] = useState(false);
  const [tocItems, setTocItems] = useState<{id: string, text: string, level: number}[]>([]);

  const [floatingMenuProps, setFloatingMenuProps] = useState<{ visible: boolean; top: number; left: number }>({ visible: false, top: 0, left: 0 });
  const [comicPages, setComicPages] = useState<ComicPage[]>([
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
  
  const activePage = comicPages[activePageIndex] || comicPages[0];
  const comicTree = activePage.tree;
  const bubbles = activePage.bubbles;

  const updateActivePageTree = (newTree: TreeNode) => {
    setComicPages(pages => pages.map((p, i) => i === activePageIndex ? { ...p, tree: newTree } : p));
  };

  const updateActivePageBubbles = (newBubbles: Bubble[]) => {
    setComicPages(pages => pages.map((p, i) => i === activePageIndex ? { ...p, bubbles: newBubbles } : p));
  };

  useEffect(() => {
    const handleSelectionChange = () => {
      if (createMode !== 'document') {
        if (floatingMenuProps.visible) setFloatingMenuProps(prev => ({ ...prev, visible: false }));
        return;
      }

      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && editorRef.current && editorRef.current.contains(selection.anchorNode)) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setFloatingMenuProps({
          visible: true,
          top: rect.top - 40,
          left: rect.left + rect.width / 2,
        });
      } else {
        setFloatingMenuProps(prev => ({ ...prev, visible: false }));
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [createMode, floatingMenuProps.visible]);

  useEffect(() => {
    if (onActiveStateChange) {
      onActiveStateChange(createMode !== 'select');
    }
  }, [createMode, onActiveStateChange]);

  const [activeBubbleId, setActiveBubbleId] = useState<string | null>(null);
  const [newBubbleText, setNewBubbleText] = useState('Bubble dialogue...');
  const [bubbleStyle, setBubbleStyle] = useState<'classic' | 'action' | 'whisper'>('classic');
  const editorRef = useRef<HTMLDivElement>(null);
  const comicRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
            document.execCommand('insertImage', false, event.target?.result as string);
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
        return 'border-2 border-red-500 bg-yellow-100 text-red-600 font-extrabold uppercase rounded-none px-3 py-1.5 shadow-[2px_2px_0px_0px_rgba(239,68,68,1)]';
      case 'whisper':
        return 'border-2 border-dashed border-zinc-400 bg-white text-zinc-600 rounded-full px-4 py-2 italic';
      default:
        return 'border-2 border-foreground bg-white text-black font-semibold rounded-2xl px-4 py-2 shadow-sm';
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
            className="p-6 border-2 border-border cursor-pointer hover:border-primary transition-all hover:shadow-md flex flex-col items-center text-center gap-4 bg-card"
            onClick={() => setCreateMode('comic')}
          >
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary">
              <Layout className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-bold mb-1">Free Online Comic Book & Manga Creator</h3>
              <p className="text-xs text-muted-foreground">Design custom comic strips, multi-panel manga layouts, and graphic novels with dynamic speech bubbles and high-quality exports.</p>
            </div>
          </Card>
          <Card 
            className="p-6 border-2 border-border cursor-pointer hover:border-primary transition-all hover:shadow-md flex flex-col items-center text-center gap-4 bg-card"
            onClick={() => setCreateMode('document')}
          >
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary">
              <Type className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-bold mb-1">Rich Text Script & Document Editor</h3>
              <p className="text-xs text-muted-foreground">Author professional screenplays, outline narratives, and format text documents with our intuitive browser-based WYSIWYG editor.</p>
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
                  <Image className="w-4 h-4" /> <span className="hidden sm:inline">Image</span>
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
                className="fixed z-[100] flex items-center gap-1 p-1 bg-background border shadow-lg rounded-md no-print"
                style={{ top: floatingMenuProps.top, left: floatingMenuProps.left, transform: 'translateX(-50%)' }}
              >
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => execDocCommand('formatBlock', 'H1')}><Heading1 className="w-3.5 h-3.5 mr-1.5"/> Title</Button>
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => execDocCommand('formatBlock', 'H2')}><Heading2 className="w-3.5 h-3.5 mr-1.5"/> Subtitle</Button>
                <div className="w-px h-4 bg-border mx-1" />
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => execDocCommand('formatBlock', 'P')}><Type className="w-3.5 h-3.5 mr-1.5"/> Text</Button>
              </motion.div>
            )}
          </AnimatePresence>
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
               onKeyDown={handleKeyDown}
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
            <Button variant="ghost" size="sm" onClick={() => setCreateMode('select')} className="gap-2 text-xs font-semibold px-3 shrink-0">
              <ChevronLeft className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Back</span>
            </Button>
            <div className="w-px h-5 bg-border mx-2 shrink-0" />
            <div className="hidden sm:flex items-center gap-1">
              {/* Toolbar intentionally kept minimal */}
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
                    className={`relative aspect-[3/4] w-full rounded-md border-2 overflow-hidden cursor-pointer bg-zinc-100 transition-all ${activePageIndex === idx ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/50'}`}
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
               <ComicCanvas tree={comicTree} onChange={updateActivePageTree} />

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

                   const onPointerUp = () => {
                     window.removeEventListener('pointermove', onPointerMove);
                     window.removeEventListener('pointerup', onPointerUp);
                   };

                   window.addEventListener('pointermove', onPointerMove);
                   window.addEventListener('pointerup', onPointerUp);
                 }}
                 className={`bubble-overlay absolute transform -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing select-none ${
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
                     onPointerDown={(e) => e.stopPropagation()}
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
                <Card className="p-4 border-2 border-border rounded-none shadow-none bg-card space-y-4">
                  <h3 className="text-sm font-bold text-foreground">Bubble Creator Dialogue</h3>
            
            <div className="space-y-2">
              <label className="text-[10px] font-mono font-bold text-muted-foreground block">TEXT VALUE</label>
              <textarea
                ref={textareaRef}
                value={newBubbleText}
                onChange={(e) => {
                  setNewBubbleText(e.target.value);
                  if (activeBubbleId) updateBubbleText(activeBubbleId, e.target.value);
                }}
                className="w-full text-xs font-semibold p-2 border-2 border-border bg-background h-16 resize-none rounded-none outline-none focus:border-primary"
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
            <Card className="p-4 border-2 border-border rounded-none shadow-none bg-card space-y-4 border-primary">
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
      </main>
    </div>
  );
};

