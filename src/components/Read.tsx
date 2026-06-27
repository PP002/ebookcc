import React, { useState, useEffect, useCallback } from 'react';
import { BookOpen, PenTool, Wrench, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw, Book, Star, Sparkles, FolderOpen, Heart, Layers, PanelLeftOpen, PanelLeftClose, Maximize, Minimize, Sun, Moon, Settings, Grid, Crop } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useDropzone } from 'react-dropzone';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from 'next-themes';
import { ReactReader as ReactReaderOrig, ReactReaderStyle } from 'react-reader';
const ReactReader = ReactReaderOrig as any;
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import JSZip from 'jszip';
import { runPredictAPI, autoCropImageBorders } from '@/components/Convert';
import { toast } from 'sonner';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface ReadProps {
  setActiveView: (view: 'home' | 'read' | 'create' | 'convert') => void;
  onActiveStateChange?: (active: boolean) => void;
  onFullscreenChange?: (isFullscreen: boolean) => void;
}

interface BookItem {
  id: string;
  title: string;
  author: string;
  cover: string;
  chapters: number;
  rating: number;
  pages: string[];
  fileType?: 'images' | 'epub' | 'pdf' | 'text';
  file?: File;
  fileBuffer?: ArrayBuffer;
}

export const Read: React.FC<ReadProps> = ({ setActiveView, onActiveStateChange, onFullscreenChange }) => {
  const [selectedBook, setSelectedBook] = useState<BookItem | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [location, setLocation] = useState<string | number>(0);
  const [pdfNumPages, setPdfNumPages] = useState<number | null>(null);
  const [textPages, setTextPages] = useState(1);
  const textContentRef = React.useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { theme, setTheme } = useTheme();
  useEffect(() => {
    if (onFullscreenChange) {
      onFullscreenChange(isFullscreen);
    }
  }, [isFullscreen, onFullscreenChange]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontFamily, setFontFamily] = useState('font-serif');
  const [readTheme, setReadTheme] = useState({ id: 'system', bg: '', text: '' });
  const [fontSize, setFontSize] = useState<number>(18);
  const [textAlign, setTextAlign] = useState('text-left');
  
  const [cropBorders, setCropBorders] = useState(false);
  const [gridView, setGridView] = useState(false);
  
  const [panelsCache, setPanelsCache] = useState<Record<number, string[]>>({});
  const [croppedCache, setCroppedCache] = useState<Record<number, string>>({});
  const [isProcessingPage, setIsProcessingPage] = useState(false);
  const [currentPanelIndex, setCurrentPanelIndex] = useState(0);

  useEffect(() => {
    if (!selectedBook || selectedBook.fileType === 'pdf' || selectedBook.fileType === 'epub' || selectedBook.fileType === 'text') return;
    
    let isActive = true;

    const processPageInBg = async (idx: number) => {
      if (!isActive) return;
      let croppedData: string | null = null;
      let panelsData: string[] | null = null;

      if (cropBorders && !croppedCache[idx]) {
        try {
          if (!isActive) return;
          const res = await autoCropImageBorders(selectedBook.pages[idx]);
          if (!isActive) return;
          if (res) {
             croppedData = res.url;
          }
        } catch(e) {}
      }

      if (gridView && !panelsCache[idx]) {
        try {
          if (!isActive || !gridView) return;
          const imgToProcess = croppedData || (croppedCache[idx] ? croppedCache[idx] : selectedBook.pages[idx]);
          
          const base64Source = await new Promise<string>((resolve) => {
              if (imgToProcess.startsWith('data:')) return resolve(imgToProcess);
              const img = new Image();
              if (imgToProcess && !imgToProcess.startsWith('blob:') && !imgToProcess.startsWith('data:')) {
                  img.crossOrigin = 'Anonymous';
              }
              img.onload = () => {
                  if (!isActive || !gridView) return;
                  const canvas = document.createElement('canvas');
                  canvas.width = img.width;
                  canvas.height = img.height;
                  const ctx = canvas.getContext('2d');
                  if (ctx) {
                      ctx.drawImage(img, 0, 0);
                      resolve(canvas.toDataURL('image/jpeg', 0.95));
                  } else {
                      resolve(imgToProcess);
                  }
              };
              img.onerror = () => resolve(imgToProcess);
              img.src = imgToProcess;
          });

          if (!isActive || !gridView) return;
          const layoutResult = await runPredictAPI(base64Source);
          if (!isActive || !gridView) return;
          let regions = layoutResult?.panels || [];
          
          if (regions.length > 0) {
              regions = [...regions].sort((a: any, b: any) => {
                  const boxA = a.box_2d || a;
                  const boxB = b.box_2d || b;
                  const yDiff = boxA[0] - boxB[0];
                  if (Math.abs(yDiff) < 50) return boxA[1] - boxB[1];
                  return yDiff;
              });
              
              if (!isActive || !gridView) return;
              const base64Panels = await new Promise<string[]>((resolve) => {
                 const img = new Image();
                 img.src = imgToProcess;
                 if (imgToProcess && !imgToProcess.startsWith('blob:') && !imgToProcess.startsWith('data:')) {
                     img.crossOrigin = 'Anonymous';
                 }
                 img.onload = () => {
                     if (!isActive || !gridView) return resolve([imgToProcess]);
                     const canvas = document.createElement('canvas');
                     const ctx = canvas.getContext('2d');
                     if (!ctx) return resolve([imgToProcess]);
                     
                     const extracted = regions.map((p: any) => {
                         const box = p.box_2d || p;
                         const [ymin, xmin, ymax, xmax] = box;
                         const y = (ymin / 1000) * img.height;
                         const x = (xmin / 1000) * img.width;
                         const h = ((ymax - ymin) / 1000) * img.height;
                         const w = ((xmax - xmin) / 1000) * img.width;
                         canvas.width = w;
                         canvas.height = h;
                         ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
                         return canvas.toDataURL('image/jpeg', 0.95);
                     });
                     resolve(extracted);
                 };
                 img.onerror = () => resolve([imgToProcess]);
              });
              
              if (!isActive || !gridView) return;
              panelsData = base64Panels;
          } else {
              panelsData = [imgToProcess];
          }
        } catch(e) {}
      }

      if (isActive) {
        if (croppedData) {
          setCroppedCache(prev => ({ ...prev, [idx]: croppedData as string }));
        }
        if (panelsData) {
          setPanelsCache(prev => ({ ...prev, [idx]: panelsData as string[] }));
        }
      }
    };

    // Process current page first, then continue processing next pages
    const processQueue = async () => {
       if (!isActive) return;
       setIsProcessingPage(true);
       if ((cropBorders && !croppedCache[currentPage]) || (gridView && !panelsCache[currentPage])) {
          await processPageInBg(currentPage);
       }
       if (isActive) setIsProcessingPage(false);
       
       // Background sequential processing for ALL subsequent pages
       let i = currentPage + 1;
       while (i < selectedBook.pages.length && isActive) {
           if (!isActive) break;
           if ((cropBorders && !croppedCache[i]) || (gridView && !panelsCache[i])) {
               await processPageInBg(i);
           }
           i++;
       }
    };

    processQueue();
    return () => { isActive = false; };
  }, [selectedBook, currentPage, cropBorders, gridView]);

  // Notify user when they navigate to a page that hasn't finished layout detection yet
  useEffect(() => {
    if (selectedBook && gridView && !panelsCache[currentPage]) {
      toast.info(`Page ${currentPage + 1} layout detection is in progress... Panels will render automatically when complete.`, {
        id: `grid-loading-${currentPage}`
      });
    }
  }, [currentPage, gridView, selectedBook, !!panelsCache[currentPage]]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ width, height });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [selectedBook?.fileType]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  useEffect(() => {
    if (isSidebarOpen && !isFullscreen) {
      const el = document.getElementById(`thumb-${currentPage}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [currentPage, isSidebarOpen, isFullscreen]);

  const [pageInputValue, setPageInputValue] = useState("");

  useEffect(() => {
    if (selectedBook?.fileType === 'text' && textContentRef.current && containerSize.width > 0) {
      const timer = setTimeout(() => {
        if (textContentRef.current) {
          const scrollWidth = textContentRef.current.scrollWidth;
          const pages = Math.round(scrollWidth / containerSize.width);
          setTextPages(Math.max(1, pages));
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [selectedBook, containerSize.width, containerSize.height]);

  useEffect(() => {
    if (onActiveStateChange) {
      onActiveStateChange(selectedBook !== null);
    }
  }, [selectedBook, onActiveStateChange]);

  const nextPage = useCallback(() => {
    if (selectedBook) {
      if (gridView && panelsCache[currentPage] && panelsCache[currentPage].length > 0) {
        if (currentPanelIndex < panelsCache[currentPage].length - 1) {
          setCurrentPanelIndex(prev => prev + 1);
          return;
        }
      }

      const maxPages = selectedBook.fileType === 'pdf' && pdfNumPages 
        ? pdfNumPages 
        : selectedBook.fileType === 'text' ? textPages 
        : selectedBook.pages.length;
      
      setCurrentPage(p => {
        const next = Math.min(maxPages - 1, p + 1);
        if (next !== p) {
           setCurrentPanelIndex(0);
        }
        return next;
      });
    }
  }, [selectedBook, pdfNumPages, textPages, gridView, panelsCache, currentPage, currentPanelIndex]);

  const prevPage = useCallback(() => {
    if (selectedBook) {
      if (gridView && panelsCache[currentPage] && panelsCache[currentPage].length > 0) {
        if (currentPanelIndex > 0) {
          setCurrentPanelIndex(prev => prev - 1);
          return;
        }
      }

      setCurrentPage(p => {
        const prev = Math.max(0, p - 1);
        if (prev !== p) {
          if (gridView && panelsCache[prev] && panelsCache[prev].length > 0) {
            setCurrentPanelIndex(panelsCache[prev].length - 1);
          } else {
            setCurrentPanelIndex(0);
          }
        }
        return prev;
      });
    }
  }, [selectedBook, gridView, panelsCache, currentPage, currentPanelIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't page if user is typing in an input
      if (document.activeElement?.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') nextPage();
      else if (e.key === 'ArrowLeft') prevPage();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextPage, prevPage]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      let pages: string[] = [];
      let fileType: 'images' | 'epub' | 'pdf' | 'text' = 'images';
      let fileBuffer: ArrayBuffer | undefined = undefined;

      const fileName = file.name.toLowerCase();
      // Generate basic object URL if Image
      if (file.type.startsWith('image/')) {
        pages = [URL.createObjectURL(file)];
      } else if (fileName.endsWith('.cbz') || fileName.endsWith('.zip')) {
        try {
          const zip = new JSZip();
          const loadedZip = await zip.loadAsync(file);
          const imageFiles = Object.keys(loadedZip.files).filter(name => name.match(/\.(jpe?g|png|webp|gif)$/i)).sort();
          if (imageFiles.length > 0) {
            pages = await Promise.all(imageFiles.map(async name => {
              const blob = await loadedZip.files[name].async("blob");
              return URL.createObjectURL(blob);
            }));
          } else {
            pages = [`https://placehold.co/800x1200/png?text=No+Images+in+Archive`];
          }
        } catch (e) {
            pages = [`https://placehold.co/800x1200/png?text=Failed+to+read+Archive`];
        }
      } else if (fileName.endsWith('.pdf')) {
        fileType = 'pdf';
        pages = [`https://placehold.co/800x1200/png?text=Loading+PDF...`];
      } else if (fileName.endsWith('.epub')) {
        fileType = 'epub';
        try {
          fileBuffer = await file.arrayBuffer();
        } catch (e) {
          console.error(e);
        }
        pages = [`https://placehold.co/800x1200/png?text=Loading+EPUB...`];
      } else if (fileName.endsWith('.txt') || fileName.endsWith('.html') || fileName.endsWith('.htm') || fileName.endsWith('.docx')) {
        fileType = 'text';
        if (fileName.endsWith('.docx')) {
          try {
            const arrayBuffer = await file.arrayBuffer();
            const mammoth = await import('mammoth');
            const result = await mammoth.extractRawText({ arrayBuffer });
            pages = [result.value];
          } catch (e) {
            pages = ["Failed to read DOCX file"];
          }
        } else {
          try {
            pages = [await file.text()];
          } catch (e) {
            pages = ["Failed to read text file"];
          }
        }
      } else {
        pages = [`https://placehold.co/800x1200/png?text=Preview+of+${file.name}`];
      }

      setSelectedBook({
        id: 'uploaded-' + Date.now(),
        title: file.name,
        author: 'Local File',
        cover: pages[0], 
        chapters: 1,
        rating: 0,
        pages,
        fileType,
        file,
        fileBuffer
      });
      setCurrentPage(0);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 
      'image/*': [],
      'application/zip': ['.zip', '.cbz'],
      'application/x-zip-compressed': ['.zip', '.cbz'],
      'application/pdf': ['.pdf'],
      'application/epub+zip': ['.epub'],
      'application/x-mobipocket-ebook': ['.mobi'],
      'application/x-cbr': ['.cbr'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/plain': ['.txt'],
      'text/html': ['.html'],
      'application/x-fictionbook+xml': ['.fb2']
    },
    useFsAccessApi: false,
    multiple: false,
  } as any);

  return (
    <div className={cn("relative flex-1 flex flex-col mx-auto w-full h-full min-h-0", !selectedBook ? "max-w-6xl p-2" : "max-w-none p-0 overflow-hidden")}>
      {/* Active Component Area */}
      {!selectedBook ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-4xl mx-auto w-full min-h-[70vh]">
          <div
            {...getRootProps()}
            className={cn(
              "w-full border border-dashed border-border/50 p-8 text-center cursor-pointer bg-card/50 hover:border-primary transition-all rounded-none min-h-[250px] flex flex-col justify-center items-center shadow-sm hover:shadow-md",
              isDragActive && "border-primary bg-primary/5"
            )}
            style={{ outline: "none" }}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center gap-4 max-w-md">
              <div className="p-4 bg-background rounded-none shrink-0 text-center">
                <Layers className="w-12 h-12 text-primary mx-auto mb-2 text-primary" />
                <h2 className="text-sm font-black uppercase tracking-wider text-foreground">Drag & Drop eBook Files Here</h2>
                <p className="text-[11px] text-muted-foreground font-semibold mt-1.5 leading-relaxed">
                  Supported: <span className="text-foreground">EPUB, CBZ, ZIP, PDF, JPG, PNG, WEBP, DOCX, TXT, HTML, FB2</span>
                </p>
                <p className="text-[10px] text-muted-foreground/80 mt-1">
                  or click inside this workspace block to browse local files
                </p>
              </div>

              <div className="text-center font-semibold text-[11px] text-muted-foreground bg-muted p-2.5">
                <Sparkles className="w-3.5 h-3.5 inline mr-1 text-primary animate-pulse" />
                Your private local reader. No files are uploaded to the cloud.
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 bg-background flex flex-col overflow-hidden min-h-0">
          {!isFullscreen && (
            <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md shrink-0">
            <div className="w-full px-2 h-11 flex items-center justify-between gap-2">
              <div className="flex flex-1 items-center gap-2 overflow-x-auto no-scrollbar py-1">
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
                <Button variant="ghost" size="sm" onClick={() => setSelectedBook(null)} className="h-8 gap-2 text-xs font-semibold px-3 shrink-0 hover:bg-transparent hover:text-foreground">
                  <ChevronLeft className="w-3.5 h-3.5" /> Back
                </Button>
                <div className="ml-2 hidden sm:block shrink-0 max-w-[200px] md:max-w-[300px]">
                  <h2 className="text-sm font-bold text-foreground truncate">{selectedBook.title}</h2>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {selectedBook.fileType !== 'text' && selectedBook.fileType !== 'pdf' && selectedBook.fileType !== 'epub' && (
                   <>
                     <Button 
                       variant={cropBorders ? "default" : "outline"}
                       size="icon" 
                       className="h-8 w-8" 
                       onClick={() => setCropBorders(!cropBorders)}
                       title="Crop Page Borders"
                     >
                        <Crop className="w-3.5 h-3.5" />
                     </Button>
                     <Button 
                       variant={gridView ? "default" : "outline"}
                       size="icon" 
                       className="h-8 w-8" 
                       onClick={() => setGridView(!gridView)}
                       title="Split Panels (Grid View)"
                     >
                        <Grid className="w-3.5 h-3.5" />
                     </Button>
                   </>
                )}
                <Button 
                  variant={settingsOpen ? "default" : "outline"} 
                  size="icon" 
                  className="h-8 w-8" 
                  onClick={() => setSettingsOpen(!settingsOpen)}
                >
                  <Settings className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setIsFullscreen(true)} title="Fullscreen">
                   <Maximize className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </header>
          )}

          <main className="flex-1 relative w-full overflow-hidden flex min-h-0 bg-background text-foreground">
            {/* Settings Overlay */}
            <AnimatePresence>
              {settingsOpen && (
                <>
                  <div className="fixed inset-0 z-[55]" onClick={() => setSettingsOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute z-[60] top-2 right-2 sm:right-4 w-72 bg-popover text-popover-foreground rounded-lg shadow-xl border p-4 space-y-4"
                  >
                  <div className="space-y-3 p-1">
                     <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Font Size</label>
                        <div className="flex bg-muted rounded-md overflow-hidden p-0.5 items-center justify-between">
                             <button onClick={() => setFontSize(f => Math.max(8, f - 2))} className="px-3 py-1 flex-1 text-center font-bold hover:bg-background rounded text-muted-foreground cursor-pointer">-</button>
                             <input type="number" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value) || 18)} className="w-16 bg-transparent text-center focus:outline-none focus:ring-0 text-sm font-semibold text-foreground mx-1" />
                             <button onClick={() => setFontSize(f => Math.min(100, f + 2))} className="px-3 py-1 flex-1 text-center font-bold hover:bg-background rounded text-muted-foreground cursor-pointer">+</button>
                        </div>
                     </div>
                     <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Alignment</label>
                        <div className="flex bg-muted rounded-md overflow-hidden p-0.5">
                           {[
                             {id: 'text-left', label: 'Left'},
                             {id: 'text-center', label: 'Center'},
                             {id: 'text-justify', label: 'Justify'}
                           ].map(al => (
                             <button
                               key={al.id}
                               onClick={() => setTextAlign(al.id)}
                               className={cn("flex-1 py-1 text-sm font-semibold rounded shadow-sm hover:bg-background/50", textAlign === al.id ? "bg-background text-foreground" : "text-muted-foreground bg-transparent shadow-none")}
                             >
                               {al.label}
                             </button>
                           ))}
                        </div>
                     </div>
                     <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Font</label>
                        <div className="flex flex-col gap-1">
                           {[
                             {id: 'font-serif', label: 'Serif'},
                             {id: 'font-sans', label: 'Sans-serif'},
                             {id: 'font-mono', label: 'Monospace'}
                           ].map(font => (
                             <button
                               key={font.id}
                               onClick={() => setFontFamily(font.id)}
                               className={cn("text-left px-3 py-1.5 text-sm font-semibold rounded hover:bg-muted/70", font.id, fontFamily === font.id ? "bg-muted text-foreground" : "text-muted-foreground bg-transparent")}
                             >
                               {font.label} abc
                             </button>
                           ))}
                        </div>
                     </div>
                     <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Theme</label>
                        <div className="grid grid-cols-2 gap-1.5">
                           {[
                             {id: 'system', bg: '', text: '', label: 'System'},
                             {id: 'sepia-light', bg: '#faf9f6', text: '#2c2c2c', label: 'Sepia Light'},
                             {id: 'sepia-dark', bg: '#2c2c2c', text: '#d4d4d4', label: 'Sepia Dark'},
                             {id: 'oled', bg: '#000000', text: '#d4d4d4', label: 'OLED'},
                           ].map(th => (
                             <button
                               key={th.id}
                               onClick={() => setReadTheme(th)}
                               style={th.bg ? { backgroundColor: th.bg, color: th.text, borderColor: th.text } : {}}
                               className={cn("flex items-center justify-center gap-2 px-2 py-2 text-xs font-semibold rounded border", !th.bg && "bg-background text-foreground", readTheme.id === th.id ? "ring-2 ring-primary ring-offset-1 ring-offset-popover" : "opacity-80 hover:opacity-100")}
                             >
                               {th.label}
                             </button>
                           ))}
                        </div>
                     </div>
                  </div>
                </motion.div>
                </>
              )}
            </AnimatePresence>

            {/* Fullscreen exit button */}
            {isFullscreen && (
              <Button
                variant="secondary"
                size="icon"
                className="absolute z-[100] top-4 right-4 bg-background/80 hover:bg-background/90 text-foreground shadow-md backdrop-blur-md"
                onClick={() => setIsFullscreen(false)}
              >
                <Minimize className="w-4 h-4" />
              </Button>
            )}

            {/* Sidebar Thumbnails */}
            <AnimatePresence initial={false}>
              {isSidebarOpen && !isFullscreen && (
                <motion.aside
                  initial={{ x: -180, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -180, opacity: 0 }}
                  transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                  className="absolute z-40 top-0 left-0 bottom-0 w-[160px] border-r bg-background/95 backdrop-blur-md shadow-2xl flex flex-col overflow-hidden"
                >
                  <div className="p-3 border-b shrink-0 flex items-center justify-between">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Pages</span>
                    <div className="flex items-center gap-1">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-5 w-5 rounded-none hover:bg-muted" 
                        onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                        disabled={currentPage === 0}
                      >
                        <ChevronLeft className="w-3 h-3" />
                      </Button>
                      <div className="flex items-center gap-0.5">
                        <input
                          type="text"
                          value={pageInputValue || (currentPage + 1).toString()}
                          onChange={(e) => {
                            setPageInputValue(e.target.value);
                            const val = parseInt(e.target.value);
                            const maxPages = selectedBook.fileType === 'pdf' && pdfNumPages ? pdfNumPages : selectedBook.pages.length;
                            if (!isNaN(val) && val >= 1 && val <= maxPages) {
                              setCurrentPage(val - 1);
                            }
                          }}
                          onBlur={() => setPageInputValue("")}
                          className="w-7 h-5 text-[10px] text-center bg-muted border-none p-0 focus-visible:ring-1 focus-visible:ring-primary rounded-none font-bold"
                        />
                        <span className="text-[9px] text-muted-foreground/60 font-mono">
                          / {selectedBook.fileType === 'pdf' && pdfNumPages ? pdfNumPages : selectedBook.pages.length}
                        </span>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-5 w-5 rounded-none hover:bg-muted" 
                        onClick={() => {
                          const maxPages = selectedBook.fileType === 'pdf' && pdfNumPages ? pdfNumPages : selectedBook.pages.length;
                          setCurrentPage(p => Math.min(maxPages - 1, p + 1));
                        }}
                        disabled={currentPage === ((selectedBook.fileType === 'pdf' && pdfNumPages ? pdfNumPages : selectedBook.pages.length) - 1)}
                      >
                        <ChevronRight className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto no-scrollbar p-2 space-y-2" id="thumbnail-container">
                    {selectedBook.fileType === 'pdf' ? (
                      <div className="p-4 text-xs text-center text-muted-foreground">PDF Thumbnails preview is standard</div>
                    ) : selectedBook.fileType === 'epub' || selectedBook.fileType === 'text' ? (
                      <div className="p-4 text-xs text-center text-muted-foreground">Table of Contents / Text Mode</div>
                    ) : (
                      selectedBook.pages.map((p, idx) => (
                        <div 
                          key={idx}
                          id={`thumb-${idx}`}
                          onClick={() => setCurrentPage(idx)}
                          className={cn(
                            "relative aspect-[2/3] w-full rounded-none overflow-hidden cursor-pointer border transition-all bg-background",
                            currentPage === idx 
                              ? "border-primary shadow-sm ring-1 ring-primary outline outline-1 outline-primary outline-offset-2" 
                              : "border-border/50 hover:border-foreground/60 opacity-85 hover:opacity-100 outline outline-1 outline-border/20"
                          )}
                        >
                          <img src={p} className="w-full h-full object-cover" alt={`Thumb ${idx}`} />
                          <div className="absolute bottom-1 left-1 bg-foreground text-background text-[7px] font-bold px-1 py-0.5 rounded-none min-w-[14px] text-center">
                            {idx + 1}
                          </div>
                          {panelsCache[idx] && (
                            <div className="absolute top-1 right-1 bg-primary text-primary-foreground p-0.5 shadow border border-background rounded flex items-center justify-center" title="Layout Detected in Cache">
                              <Grid className="w-2.5 h-2.5" />
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </motion.aside>
              )}
            </AnimatePresence>

            <div ref={containerRef} className="flex-1 overflow-hidden relative w-full h-full transition-colors duration-300">
              {selectedBook.fileType === 'epub' && (selectedBook.fileBuffer || selectedBook.file) ? (
                <div className="absolute inset-0 z-0">
                  <ReactReader
                    url={selectedBook.fileBuffer || (selectedBook.file as any)}
                    location={location}
                    locationChanged={(epubcition: string) => setLocation(epubcition)}
                    showToc={false}
                    styles={{
                      ...ReactReaderStyle,
                      container: {
                        ...ReactReaderStyle.container,
                        backgroundColor: 'transparent'
                      },
                      readerArea: { 
                        ...ReactReaderStyle.readerArea,
                        backgroundColor: 'transparent'
                      },
                      reader: {
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        bottom: 0,
                        right: 0
                      },
                      titleArea: { display: 'none' },
                      prev: { display: 'none' },
                      next: { display: 'none' },
                      arrow: { display: 'none' },
                      tocAreaButton: { display: 'none' }
                    }}
                    epubOptions={{
                      flow: "paginated",
                      width: "100%",
                      height: "100%",
                    }}
                    swipeable={true}
                    getRendition={(rendition: any) => {
                      const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
                      rendition.themes.default({
                        'html': {
                          'background': 'transparent !important',
                        },
                        'body': { 
                          'padding': '0 !important', 
                          'margin': '0 !important',
                          'background': 'transparent !important',
                          'color': isDark ? '#f8fafc !important' : '#0f172a !important'
                        },
                        'p, span, div, h1, h2, h3, h4, h5, h6, a, li, blockquote': {
                          'color': isDark ? '#f8fafc !important' : '#0f172a !important'
                        },
                        'img': {
                          'max-width': '100% !important',
                          'height': 'auto !important'
                        }
                      });
                      rendition.on('click', (e: any) => {
                        const width = e.view ? e.view.innerWidth : window.innerWidth;
                        if (e.clientX > width / 2) {
                          rendition.next();
                        } else {
                          rendition.prev();
                        }
                      });
                    }}
                  />
                </div>
              ) : selectedBook.fileType === 'pdf' && selectedBook.file ? (
                <>
                  <div className="absolute inset-y-0 left-0 w-1/3 z-10 cursor-pointer" onClick={(e) => { e.stopPropagation(); prevPage(); }} title="Previous Page" />
                  <div className="absolute inset-y-0 right-0 w-1/3 z-10 cursor-pointer" onClick={(e) => { e.stopPropagation(); nextPage(); }} title="Next Page" />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-0">
                    <Document 
                      file={selectedBook.file} 
                      onLoadSuccess={({ numPages }) => {
                        setPdfNumPages(numPages);
                      }}
                      className="flex flex-col items-center justify-center h-full w-full pointer-events-auto"
                    >
                      <Page 
                        pageNumber={currentPage + 1} 
                        renderTextLayer={true} 
                        renderAnnotationLayer={true} 
                        className="max-w-full max-h-full drop-shadow-2xl flex items-center justify-center"
                        height={containerSize.height ? containerSize.height : undefined}
                      />
                    </Document>
                  </div>
                </>
               ) : selectedBook.fileType === 'text' && selectedBook.file ? (
                (() => {
                  const padding = containerSize.width >= 768 ? 32 : 16;
                  const totalPadding = padding * 2;
                  const colWidth = Math.max(100, containerSize.width - totalPadding);
                  const isHtml = selectedBook.title.toLowerCase().endsWith('.html') || selectedBook.title.toLowerCase().endsWith('.htm');
                  
                  let displayContent = selectedBook.pages[0];
                  if (isHtml) {
                    const bodyMatch = displayContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                    if (bodyMatch) displayContent = bodyMatch[1];
                    displayContent = displayContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
                    displayContent = displayContent.replace(/<link[^>]*>/gi, "");
                  }

                  return (
                    <>
                       <div className="absolute inset-y-0 left-0 w-1/3 z-10 cursor-pointer" onClick={(e) => { e.stopPropagation(); prevPage(); }} title="Previous Page" />
                      <div className="absolute inset-y-0 right-0 w-1/3 z-10 cursor-pointer" onClick={(e) => { e.stopPropagation(); nextPage(); }} title="Next Page" />
                      <div className="absolute inset-0 overflow-hidden pointer-events-none">
                         <div 
                            className={cn("w-full h-full pointer-events-auto", !readTheme.bg ? 'bg-background text-foreground' : '')}
                            style={{
                               backgroundColor: readTheme.bg || undefined,
                               color: readTheme.text || undefined,
                               transform: `translateX(-${currentPage * containerSize.width}px)`,
                               transition: 'transform 0.3s ease'
                            }}
                         >
                            <div 
                               ref={textContentRef}
                               className={cn(
                                 "h-full leading-relaxed break-words [&_img]:max-w-full [&_img]:max-h-[calc(100vh-12rem)] [&_img]:object-contain [&_img]:break-inside-avoid [&_p>img]:break-inside-avoid [&_figure]:break-inside-avoid",
                                 !isHtml && "whitespace-pre-wrap",
                                 fontFamily,
                                 textAlign
                               )}
                               style={{
                                  fontSize: `${fontSize}px`,
                                  padding: `${padding}px`,
                                  columnWidth: `${colWidth}px`,
                                  columnGap: `${totalPadding}px`,
                               }}
                            >
                               {isHtml ? (
                                 <div dangerouslySetInnerHTML={{ __html: displayContent }} />
                               ) : (
                                 displayContent
                               )}
                            </div>
                         </div>
                      </div>
                    </>
                  );
                })()
              ) : (
                <>
                  <div className="absolute inset-y-0 left-0 w-1/3 z-10 cursor-pointer" onClick={(e) => { e.stopPropagation(); prevPage(); }} title="Previous Page" />
                  <div className="absolute inset-y-0 right-0 w-1/3 z-10 cursor-pointer" onClick={(e) => { e.stopPropagation(); nextPage(); }} title="Next Page" />
                  <div className={cn("absolute inset-0 flex items-center justify-center transition-transform pointer-events-none p-0", !readTheme.bg ? 'bg-background' : '')} style={{ backgroundColor: readTheme.bg || undefined }}>
                    {gridView && panelsCache[currentPage] && panelsCache[currentPage].length > 0 ? (
                       <img key={currentPanelIndex} src={panelsCache[currentPage][currentPanelIndex]} className="w-full h-full object-contain pointer-events-auto select-none" />
                    ) : cropBorders && croppedCache[currentPage] ? (
                       <img 
                         src={croppedCache[currentPage]} 
                         alt={`Page ${currentPage + 1}`} 
                         className="w-full h-full object-contain pointer-events-auto select-none"
                       />
                    ) : (
                       <img 
                         src={selectedBook.pages[currentPage]} 
                         alt={`Page ${currentPage + 1}`} 
                         className="w-full h-full object-contain pointer-events-auto select-none"
                       />
                    )}
                    {(isProcessingPage && gridView && !panelsCache[currentPage]) && (
                        <div className="absolute inset-x-0 bottom-8 flex justify-center pointer-events-none">
                            <div className="bg-background/80 text-foreground px-4 py-2 rounded-full text-xs shadow border animate-pulse backdrop-blur flex items-center gap-2">
                                <Sparkles className="w-3.5 h-3.5" /> Detecting layout...
                            </div>
                        </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </main>
        </div>
      )}
    </div>
  );
};
