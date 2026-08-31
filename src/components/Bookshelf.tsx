import React, { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useAppSettings } from '@/context/AppSettingsContext';
import { fetchPublishedWorksFromR2, deletePublishedWorkFromR2 } from '@/lib/r2Storage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  BookOpen, Play, ChevronLeft, ChevronRight, X, Clock, Eye, 
  Sparkles, ExternalLink, ZoomIn, Info, User, PenTool, Trash2
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { ComicPageRenderer, ComicTreeNodeView } from '@/components/ComicPageRenderer';

interface PublishedItem {
  id: string;
  title: string;
  author: string;
  authorId?: string;
  authorEmail?: string;
  type: 'comic' | 'novel';
  cover: string;
  description: string;
  content?: string;
  pages?: any[];
  timestamp: number;
}

const defaultBooks: PublishedItem[] = [];

function MetroBookTile({
  book,
  index,
  onOpen,
  onEdit,
  onDelete,
  isDefault,
  isAuthor
}: {
  book: PublishedItem;
  index: number;
  onOpen: () => void;
  onEdit?: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  isDefault?: boolean;
  isAuthor?: boolean;
}) {
  const [slideIndex, setSlideIndex] = useState(0);

  // Unique hash seed per tile to shuffle sliding timers and starting phases
  const tileSeed = React.useMemo(() => {
    let h = 0;
    const str = (book.id || '') + (index || 0);
    for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
    return Math.abs(h);
  }, [book.id, index]);

  // Extract full comic pages for live tile slideshow
  const comicPagesList = React.useMemo(() => {
    if (book.type !== 'comic') return [];
    
    if (book.pages && Array.isArray(book.pages) && book.pages.length > 0) {
      return book.pages.map((page: any, idx: number) => {
        let speechSnippet = "";
        if (page?.bubbles && Array.isArray(page.bubbles)) {
          const firstText = page.bubbles.find((b: any) => b?.text && b.text.trim());
          if (firstText) speechSnippet = firstText.text.trim();
        }

        return {
          pageNum: idx + 1,
          tree: page?.tree || null,
          image: page?.cover || page?.image || page?.imageUrl || null,
          speechSnippet: speechSnippet,
        };
      });
    }

    return [{
      pageNum: 1,
      tree: null,
      image: book.cover || null,
      speechSnippet: book.description || '',
    }];
  }, [book]);

  // Extract novel background image
  const novelBgImage = React.useMemo(() => {
    if (book.type !== 'novel') return null;
    if (book.cover && book.cover.trim() !== '') return book.cover;
    if (book.content) {
      const match = book.content.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (match && match[1]) return match[1];
    }
    return null;
  }, [book]);

  // Extract novel text snippets for live tile rotation
  const novelSnippets = React.useMemo(() => {
    if (book.type !== 'novel') return [];
    const raw = book.content || book.description || '';
    const clean = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    
    if (!clean) {
      return [
        'A creative story authored in eBookCC.',
        `Written by ${book.author || 'Author'} • Tap to read`,
        'Published novel work in library.'
      ];
    }

    const sentences = clean.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences.length > 1) {
      const chunks: string[] = [];
      let cur = "";
      for (const s of sentences) {
        if ((cur + " " + s).length > 85) {
          if (cur.trim()) chunks.push(cur.trim());
          cur = s;
        } else {
          cur += " " + s;
        }
      }
      if (cur.trim()) chunks.push(cur.trim());
      if (chunks.length > 1) return chunks;
    }

    return [
      `"${clean}"`,
      `Story by ${book.author || 'Unknown'} • Tap to read full novel`,
      `Excerpt: ${clean.length > 50 ? clean.slice(0, 50) + '...' : clean}`
    ];
  }, [book]);

  // Shuffled pause durations: 3s, 4.5s, 6s, 7s
  const PAUSE_TIMES = React.useMemo(() => [3000, 4500, 6000, 7000], []);

  // Unique permuted pause sequence for this specific tile
  const tilePauseSequence = React.useMemo(() => {
    const shift = tileSeed % PAUSE_TIMES.length;
    return [...PAUSE_TIMES.slice(shift), ...PAUSE_TIMES.slice(0, shift)];
  }, [tileSeed, PAUSE_TIMES]);

  // Initial delay on mount so cards don't all trigger their first slide at the same time
  const initialDelay = React.useMemo(() => {
    return ((tileSeed * 1337 + index * 179) % 3500) + 500;
  }, [tileSeed, index]);

  const [hasStarted, setHasStarted] = useState(false);

  // 4 Direction shuffle: left-to-right, right-to-left, top-to-bottom, bottom-to-top
  const DIRECTIONS = React.useMemo(() => [
    { initial: { x: "100%", y: "0%", opacity: 0 }, exit: { x: "-100%", y: "0%", opacity: 0 } }, // right-to-left
    { initial: { x: "-100%", y: "0%", opacity: 0 }, exit: { x: "100%", y: "0%", opacity: 0 } }, // left-to-right
    { initial: { x: "0%", y: "-100%", opacity: 0 }, exit: { x: "0%", y: "100%", opacity: 0 } }, // top-to-bottom
    { initial: { x: "0%", y: "100%", opacity: 0 }, exit: { x: "0%", y: "-100%", opacity: 0 } }, // bottom-to-top
  ], []);

  // Live slideshow timer with individual staggered start delays and shuffled pause timings
  useEffect(() => {
    const listLen = book.type === 'comic' ? comicPagesList.length : novelSnippets.length;
    if (listLen <= 1) return;

    let timer: NodeJS.Timeout;

    if (!hasStarted) {
      timer = setTimeout(() => {
        setHasStarted(true);
        setSlideIndex(1);
      }, initialDelay);
    } else {
      const currentPause = tilePauseSequence[slideIndex % tilePauseSequence.length];
      timer = setTimeout(() => {
        setSlideIndex((prev) => prev + 1);
      }, currentPause);
    }

    return () => clearTimeout(timer);
  }, [slideIndex, hasStarted, initialDelay, tilePauseSequence, book.type, comicPagesList.length, novelSnippets.length]);

  const currentComicPage = comicPagesList[(slideIndex + tileSeed) % (comicPagesList.length || 1)] || comicPagesList[0];
  const currentNovelSnippet = novelSnippets[(slideIndex + tileSeed) % (novelSnippets.length || 1)] || novelSnippets[0];
  const currentDirection = DIRECTIONS[(slideIndex + tileSeed) % DIRECTIONS.length];

  return (
    <div
      onClick={onOpen}
      className="flex-shrink-0 w-[180px] group flex flex-col cursor-pointer select-none"
    >
      {/* BOOK PREVIEW CONTAINER */}
      <div className="relative w-full h-[240px] flex flex-col justify-between bg-card text-card-foreground border border-border/80 rounded-md shadow-md overflow-hidden transition-all duration-300 group-hover:shadow-xl group-hover:border-primary/60 group-active:scale-95">
        {/* BACKGROUND & METRO LIVE TILE CONTENT */}
        {book.type === 'comic' ? (
          // COMIC METRO LIVE TILE: Display ENTIRE Page Layout in 3:4 aspect ratio box
          <div className="absolute inset-0 bg-muted/20 overflow-hidden flex items-center justify-center p-1.5">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={`comic-page-${slideIndex}`}
                initial={currentDirection.initial}
                animate={{ x: "0%", y: "0%", opacity: 1 }}
                exit={currentDirection.exit}
                transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
                className="w-full h-full flex flex-col items-center justify-center overflow-hidden"
              >
                {currentComicPage?.tree ? (
                  <div className="w-full h-full bg-white border border-zinc-900 flex flex-col overflow-hidden relative">
                    <ComicTreeNodeView node={currentComicPage.tree} />
                  </div>
                ) : currentComicPage?.image ? (
                  <img
                    src={currentComicPage.image || undefined}
                    alt={book.title}
                    className="w-full h-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full bg-muted/40 flex flex-col items-center justify-center p-4 text-center border border-border/40">
                    <Sparkles className="w-8 h-8 text-amber-500 mb-2 animate-pulse" />
                    <span className="text-xs font-bold text-foreground line-clamp-2">{book.title}</span>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
            {/* Metro Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-card/80 via-transparent to-transparent pointer-events-none" />
          </div>
        ) : (
          // NOVEL METRO LIVE TILE: Clean surface or background image without blue vertical line
          <div className="absolute inset-0 bg-card overflow-hidden">
            {novelBgImage ? (
              <>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.img
                    key={`novel-bg-${slideIndex}`}
                    src={novelBgImage || undefined}
                    alt={book.title}
                    initial={currentDirection.initial}
                    animate={{ x: "0%", y: "0%", opacity: 0.35 }}
                    exit={currentDirection.exit}
                    transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
                    className="absolute inset-0 w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </AnimatePresence>
                <div className="absolute inset-0 bg-gradient-to-t from-card via-card/80 to-card/30 pointer-events-none" />
              </>
            ) : (
              // Clean, unadorned solid background (no blue vertical line)
              <div className="w-full h-full bg-card" />
            )}
          </div>
        )}

        {/* TOP HEADER BAR: METRO TYPE BADGE */}
        <div className="relative z-10 p-2 flex items-center justify-between w-full">
          <span
            className={`px-2 py-0.5 text-[9px] font-black tracking-widest uppercase text-white shadow-sm font-mono rounded-xs ${
              book.type === 'comic' ? 'bg-amber-600' : 'bg-blue-600'
            }`}
          >
            {book.type}
          </span>
        </div>

        {/* MIDDLE DYNAMIC CONTENT AREA: SHUFFLED DIRECTION LIVE SLIDE */}
        <div className="relative z-10 px-3 py-1 flex-1 flex flex-col justify-end pb-2 overflow-hidden">
          {book.type === 'novel' ? (
            // Dynamic novel live text slide (no blue vertical accent line)
            <div className="relative w-full h-24 overflow-hidden flex items-center">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.p
                  key={`novel-text-${slideIndex}`}
                  initial={currentDirection.initial}
                  animate={{ x: "0%", y: "0%", opacity: 1 }}
                  exit={currentDirection.exit}
                  transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
                  className="absolute inset-0 text-[11px] leading-relaxed text-card-foreground font-serif line-clamp-4 italic bg-card/90 border border-border/50 p-2 backdrop-blur-xs flex items-center rounded-sm shadow-xs"
                >
                  {currentNovelSnippet}
                </motion.p>
              </AnimatePresence>
            </div>
          ) : (
            // Dynamic comic speech bubble preview
            currentComicPage?.speechSnippet && (
              <div className="relative w-full overflow-hidden">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.p
                    key={`comic-bubble-${slideIndex}`}
                    initial={currentDirection.initial}
                    animate={{ x: "0%", y: "0%", opacity: 1 }}
                    exit={currentDirection.exit}
                    transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
                    className="text-[10px] leading-tight text-card-foreground font-sans line-clamp-2 bg-card/90 p-1.5 rounded-sm border border-amber-500/40 backdrop-blur-xs shadow-xs"
                  >
                    💬 "{currentComicPage.speechSnippet}"
                  </motion.p>
                </AnimatePresence>
              </div>
            )
          )}
        </div>
      </div>

      {/* TITLE & AUTHOR (BELOW THE BOOK PREVIEW) */}
      <div className="pt-2 px-0.5 flex flex-col gap-1 w-full">
        <h4 className="text-xs font-bold text-card-foreground truncate group-hover:text-primary transition-colors tracking-tight font-sans" title={book.title}>
          {book.title || "Untitled"}
        </h4>
        
        <div className="flex items-center justify-between text-[10px] text-muted-foreground font-medium">
          <span className="truncate flex items-center gap-1 max-w-[140px]" title={book.author}>
            <User className="w-3 h-3 text-muted-foreground shrink-0" />
            {book.author || "Author"}
          </span>
        </div>

        {isAuthor && onEdit && (
          <div className="flex items-center justify-between gap-1.5 mt-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(e);
              }}
              className="flex-1 py-1 px-2 bg-primary text-primary-foreground hover:bg-primary/90 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1 rounded-xs transition-colors cursor-pointer"
              title="Edit in Creator Workspace"
            >
              <PenTool className="w-3 h-3" />
              <span>Edit</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(e);
              }}
              className="p-1 bg-muted/60 border border-border hover:border-destructive/60 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xs text-[10px] transition-colors flex items-center justify-center cursor-pointer"
              title="Delete from Bookshelf & Storage"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Bookshelf({ 
  onOpenInWorkspace,
  onOpenInReader
}: { 
  onOpenInWorkspace?: (type: 'comic' | 'novel', id: string) => void;
  onOpenInReader?: (type: 'comic' | 'novel', id: string) => void;
}) {
  const { user } = useAppSettings();
  const [books, setBooks] = useState<PublishedItem[]>([]);
  const [selectedBook, setSelectedBook] = useState<PublishedItem | null>(null);
  const [activeComicPage, setActiveComicPage] = useState(0);
  const [fontSize, setFontSize] = useState<'sm' | 'md' | 'lg' | 'xl'>('md');
  const shelfRef = useRef<HTMLDivElement>(null);

  // Load books from localStorage & Cloudflare R2 media storage
  const loadBooks = async () => {
    try {
      const userPublishedJson = localStorage.getItem("ebookcc_published_items") || "[]";
      const userPublished = JSON.parse(userPublishedJson);
      if (Array.isArray(userPublished)) {
        setBooks(userPublished);
      }
    } catch (e) {
      setBooks([]);
    }

    try {
      const res = await fetchPublishedWorksFromR2();
      if (res.success && Array.isArray(res.works)) {
        // Sync directly with authoritative R2 media storage.
        const r2Works = res.works;
        const sorted = [...r2Works].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        localStorage.setItem("ebookcc_published_items", JSON.stringify(sorted));
        setBooks(sorted);
      }
    } catch (_) {}
  };

  useEffect(() => {
    loadBooks();
    
    // Auto sync when local storage updates or custom events fire
    const handleSync = () => loadBooks();
    window.addEventListener('storage', handleSync);
    window.addEventListener('ebookcc_published', handleSync);
    window.addEventListener('focus', handleSync);

    return () => {
      window.removeEventListener('storage', handleSync);
      window.removeEventListener('ebookcc_published', handleSync);
      window.removeEventListener('focus', handleSync);
    };
  }, []);

  const scrollShelf = (direction: 'left' | 'right') => {
    if (shelfRef.current) {
      const scrollAmount = shelfRef.current.clientWidth * 0.75;
      shelfRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  const handleOpenBook = (book: PublishedItem) => {
    if (onOpenInReader) {
      onOpenInReader(book.type, book.id);
    } else {
      setSelectedBook(book);
      setActiveComicPage(0);
      toast.success(`Opening: ${book.title}`);
    }
  };

  const deletePublishedBook = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to remove this book from the public bookshelf? All associated files in R2 cloud storage will also be deleted.")) {
      try {
        const userPublishedJson = localStorage.getItem("ebookcc_published_items") || "[]";
        const userPublished = JSON.parse(userPublishedJson);
        const filtered = userPublished.filter((b: any) => b.id !== id);
        localStorage.setItem("ebookcc_published_items", JSON.stringify(filtered));
        setBooks(filtered);

        await deletePublishedWorkFromR2(id);

        window.dispatchEvent(new Event("ebookcc_published"));
        window.dispatchEvent(new Event("storage"));

        await loadBooks();
        toast.success("Book and all cloud assets removed successfully from R2 storage.");
      } catch (err) {
        toast.error("Failed to delete book.");
      }
    }
  };

  const getFontSizeClass = () => {
    switch (fontSize) {
      case 'sm': return 'text-sm leading-relaxed';
      case 'lg': return 'text-lg leading-relaxed';
      case 'xl': return 'text-xl leading-loose';
      default: return 'text-base leading-relaxed';
    }
  };

  if (books.length === 0) {
    return null;
  }

  // Helper to extract safe page array
  const selectedComicPages = selectedBook
    ? (Array.isArray(selectedBook.pages)
        ? selectedBook.pages
        : typeof selectedBook.pages === 'string'
        ? (() => { try { return JSON.parse(selectedBook.pages); } catch (_) { return []; } })()
        : [])
    : [];

  const isSelectedAuthor = selectedBook && (
    !selectedBook.id.startsWith("default-") && (
      !selectedBook.authorId || 
      (user && user.uid === selectedBook.authorId) || 
      (user && user.email === selectedBook.authorEmail) ||
      (user && user.name === selectedBook.author)
    )
  );

  return (
    <div className="w-full py-8 border-t border-border/40 max-w-full" id="bookshelf-section">
      <div className="w-full">
        {/* Title & Stats */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-primary px-2.5 py-1 bg-primary/10 rounded-full">
              Published Works
            </span>
            <h2 className="text-2xl font-black tracking-tight text-foreground mt-2 flex items-center gap-2">
              <BookOpen className="w-6 h-6 text-primary" />
              Creative Bookshelf
            </h2>
          </div>
        </div>

        {/* Horizontal scroll shelf wrapper */}
        <div className="relative group/shelf">
          {/* Left / Right Flip Arrow Buttons */}
          {books.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => scrollShelf('left')}
                className="absolute -left-3 top-1/2 -translate-y-1/2 z-20 p-2.5 rounded-full bg-background/95 border border-border shadow-xl text-foreground hover:bg-primary hover:text-primary-foreground transition-all duration-200 focus:outline-none backdrop-blur-md opacity-90 sm:opacity-0 sm:group-hover/shelf:opacity-100 sm:group-hover/shelf:translate-x-0 cursor-pointer"
                aria-label="Scroll left"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => scrollShelf('right')}
                className="absolute -right-3 top-1/2 -translate-y-1/2 z-20 p-2.5 rounded-full bg-background/95 border border-border shadow-xl text-foreground hover:bg-primary hover:text-primary-foreground transition-all duration-200 focus:outline-none backdrop-blur-md opacity-90 sm:opacity-0 sm:group-hover/shelf:opacity-100 sm:group-hover/shelf:translate-x-0 cursor-pointer"
                aria-label="Scroll right"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}

          <div 
            ref={shelfRef}
            className="flex gap-6 overflow-x-auto pb-6 scroll-smooth select-none px-1 no-scrollbar [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
          >
            {books.map((book, idx) => {
              const isAuthor = !book.id.startsWith("default-") && (
                !book.authorId || 
                (user && user.uid === book.authorId) || 
                (user && user.email === book.authorEmail) ||
                (user && user.name === book.author)
              );

              return (
                <MetroBookTile
                  key={book.id}
                  book={book}
                  index={idx}
                  onOpen={() => handleOpenBook(book)}
                  onEdit={onOpenInWorkspace ? (e) => {
                    e.stopPropagation();
                    onOpenInWorkspace(book.type, book.id);
                  } : undefined}
                  onDelete={(e) => deletePublishedBook(e, book.id)}
                  isDefault={book.id.startsWith("default-")}
                  isAuthor={isAuthor}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* IMMERSIVE READER DIALOG */}
      <Dialog open={!!selectedBook} onOpenChange={() => setSelectedBook(null)}>
        <DialogContent className="sm:max-w-[750px] max-h-[92vh] flex flex-col p-0 overflow-hidden border bg-background text-foreground shadow-2xl rounded-xl">
          {selectedBook && (
            <>
              {/* Header Panel */}
              <div className="p-4 border-b bg-muted/20 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`p-1.5 rounded ${selectedBook.type === 'comic' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'}`}>
                    <BookOpen className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-foreground truncate max-w-[400px]">{selectedBook.title}</h3>
                    <p className="text-xs text-muted-foreground">by {selectedBook.author}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Font Size controls for novel */}
                  {selectedBook.type === 'novel' && (
                    <div className="flex items-center gap-1 border rounded-md p-0.5 bg-background">
                      <Button 
                        variant={fontSize === 'sm' ? 'secondary' : 'ghost'} 
                        size="icon" 
                        className="h-6 w-6 text-[10px] font-bold"
                        onClick={() => setFontSize('sm')}
                      >
                        A-
                      </Button>
                      <Button 
                        variant={fontSize === 'md' ? 'secondary' : 'ghost'} 
                        size="icon" 
                        className="h-6 w-6 text-xs font-bold"
                        onClick={() => setFontSize('md')}
                      >
                        A
                      </Button>
                      <Button 
                        variant={fontSize === 'lg' ? 'secondary' : 'ghost'} 
                        size="icon" 
                        className="h-6 w-6 text-sm font-bold"
                        onClick={() => setFontSize('lg')}
                      >
                        A+
                      </Button>
                    </div>
                  )}

                  {/* Open in Workspace trigger */}
                  {onOpenInWorkspace && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-8 text-xs font-semibold gap-1.5 bg-primary/10 border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                      onClick={() => {
                        const type = selectedBook.type;
                        const id = selectedBook.id;
                        setSelectedBook(null);
                        onOpenInWorkspace(type, id);
                      }}
                    >
                      <PenTool className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Edit in Workspace</span>
                    </Button>
                  )}

                  {/* Delete button in dialog if author */}
                  {isSelectedAuthor && (
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10" 
                      title="Delete from Bookshelf & Storage"
                      onClick={(e) => {
                        const id = selectedBook.id;
                        setSelectedBook(null);
                        deletePublishedBook(e, id);
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}

                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 rounded-full" 
                    onClick={() => setSelectedBook(null)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* BOOK READER PANEL */}
              <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-card/10">
                {selectedBook.type === 'novel' ? (
                  <article className="max-w-2xl mx-auto prose dark:prose-invert font-serif">
                    <div 
                      className={`${getFontSizeClass()} text-foreground/90 space-y-5`}
                      dangerouslySetInnerHTML={{ __html: selectedBook.content || "<p className='italic text-muted-foreground'>This book contains no text content yet.</p>" }}
                    />
                  </article>
                ) : (
                  // COMIC SLIDE-BY-SLIDE VIEW
                  <div className="flex flex-col items-center justify-center space-y-4">
                    {selectedComicPages && selectedComicPages.length > 0 ? (
                      <div className="relative max-w-lg w-full h-[65vh] flex items-center justify-center">
                        <ComicPageRenderer 
                          page={selectedComicPages[activeComicPage]} 
                          className="h-full max-h-full max-w-full"
                        />
                        <div className="absolute top-2 right-2 px-2 py-1 bg-black/75 text-white text-[10px] font-bold font-mono rounded z-30 pointer-events-none">
                          Page {activeComicPage + 1} of {selectedComicPages.length}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-20 border-2 border-dashed rounded-lg bg-muted/10 max-w-sm">
                        <Info className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-xs text-muted-foreground">No active pages found for this published comic strip.</p>
                      </div>
                    )}

                    {/* Pagination control footer for Comic */}
                    {selectedComicPages && selectedComicPages.length > 0 && (
                      <div className="flex items-center gap-4 pt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={activeComicPage === 0}
                          onClick={() => setActiveComicPage(prev => Math.max(0, prev - 1))}
                          className="h-8 px-3"
                        >
                          <ChevronLeft className="w-4 h-4 mr-1" />
                          Previous
                        </Button>
                        <span className="text-xs font-bold font-mono">
                          {activeComicPage + 1} / {selectedComicPages.length}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={activeComicPage === selectedComicPages.length - 1}
                          onClick={() => setActiveComicPage(prev => Math.min(selectedComicPages.length - 1, prev + 1))}
                          className="h-8 px-3"
                        >
                          Next
                          <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
