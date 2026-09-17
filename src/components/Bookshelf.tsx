import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useAppSettings, getSupabase } from '@/context/AppSettingsContext';
import { fetchPublishedWorksFromR2, deletePublishedWorkFromR2, safeSetPublishedCache } from '@/lib/r2Storage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  BookOpen, Play, ChevronLeft, ChevronRight, X, Clock, Eye, 
  Sparkles, ExternalLink, ZoomIn, Info, User, PenTool, Trash2,
  Search, BookText, Globe, Plus, Check, Loader2, ArrowLeft, Download, CornerDownLeft
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { ComicPageRenderer, ComicTreeNodeView } from '@/components/ComicPageRenderer';
import { 
  PublicBookItem, 
  searchGutenbergBooks, 
  searchArchiveComics, 
  FEATURED_PUBLIC_DOMAIN_ITEMS, 
  getRandomLibrarySelection,
  getLibraryProxyUrl,
  getArchivePageImageUrl
} from '@/lib/publicLibrary';

export interface PublishedItem {
  id: string;
  title: string;
  author: string;
  authorId?: string;
  authorEmail?: string;
  type: 'comic' | 'novel';
  content_type?: 'epub' | 'comic' | 'novel';
  resource_url?: string;
  cover_url?: string;
  identifier?: string;
  cover: string;
  description: string;
  content?: string;
  pages?: any[];
  timestamp: number;
  total_pages?: number;
  source?: 'local' | 'published' | 'gutenberg' | 'archive';
  download_count?: number;
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
  onDelete?: (e: React.MouseEvent) => void;
  isDefault?: boolean;
  isAuthor?: boolean;
}) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [imgError, setImgError] = useState(false);

  // Check if book is standard public domain item
  const isPublicDomain = Boolean(
    isDefault ||
    book.id.startsWith("default-") || 
    book.id.startsWith("gutenberg-") || 
    book.id.startsWith("archive-") ||
    book.source === 'gutenberg' || 
    book.source === 'archive' || 
    book.identifier ||
    (book.resource_url && (book.resource_url.includes('gutenberg.org') || book.resource_url.includes('archive.org')))
  );

  const cleanArchiveId = React.useMemo(() => {
    if (book.identifier) return book.identifier.replace(/^archive-/, '');
    if (book.id && book.id.startsWith('archive-')) return book.id.replace(/^archive-/, '');
    if (book.resource_url && book.resource_url.includes('archive.org/download/')) {
      const match = book.resource_url.match(/archive\.org\/download\/([^/]+)/);
      if (match && match[1]) return match[1];
    }
    return '';
  }, [book.identifier, book.id, book.resource_url]);

  const [archiveImgAttempt, setArchiveImgAttempt] = useState(0);

  // Determine fallback first page image if cover is missing or is generic archive logo
  const effectiveCover = React.useMemo(() => {
    const rawCover = book.cover || book.cover_url || '';
    const isGenericArchiveLogo = rawCover.includes('archive.org/services/img');

    if (cleanArchiveId) {
      if (archiveImgAttempt === 0) {
        if (rawCover && !isGenericArchiveLogo) return rawCover;
        return `https://archive.org/download/${cleanArchiveId}/page/n0_medium.jpg`;
      } else if (archiveImgAttempt === 1) {
        return `https://archive.org/download/${cleanArchiveId}/page/n0.jpg`;
      } else if (archiveImgAttempt === 2) {
        return `https://archive.org/download/${cleanArchiveId}/page/n1_medium.jpg`;
      } else if (archiveImgAttempt === 3) {
        return `https://archive.org/download/${cleanArchiveId}/page/n1.jpg`;
      }
    }

    if (rawCover && !isGenericArchiveLogo) return rawCover;
    return '';
  }, [book.cover, book.cover_url, cleanArchiveId, archiveImgAttempt]);

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
      image: book.cover || book.cover_url || null,
      speechSnippet: book.description || '',
    }];
  }, [book]);

  // Extract novel background image
  const novelBgImage = React.useMemo(() => {
    if (book.type !== 'novel') return null;
    if (book.cover && book.cover.trim() !== '') return book.cover;
    if (book.cover_url && book.cover_url.trim() !== '') return book.cover_url;
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
        'A creative story authored in eBookCC. Open the book to immerse yourself in the full narrative.',
        `Written by ${book.author || 'Author'}. Turn the pages to explore chapters and dialogue.`,
        'Published literary work in the community bookshelf library.'
      ];
    }

    const sentences = clean.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences.length > 1) {
      const chunks: string[] = [];
      let cur = "";
      for (const s of sentences) {
        if ((cur + " " + s).length > 180) {
          if (cur.trim()) chunks.push(cur.trim());
          cur = s.trim();
        } else {
          cur += (cur ? " " : "") + s.trim();
        }
      }
      if (cur.trim()) chunks.push(cur.trim());
      if (chunks.length > 1) return chunks;
    }

    if (clean.length > 120) {
      const words = clean.split(/\s+/);
      const chunks: string[] = [];
      let cur = "";
      for (const w of words) {
        if ((cur + " " + w).length > 180) {
          if (cur.trim()) chunks.push(cur.trim());
          cur = w;
        } else {
          cur += (cur ? " " : "") + w;
        }
      }
      if (cur.trim()) chunks.push(cur.trim());
      if (chunks.length > 1) return chunks;
    }

    return [
      `"${clean}"`,
      `Story by ${book.author || 'Unknown'} • Tap to read full novel`,
      clean.length > 60 ? clean.slice(0, 60) + '...' : clean
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

  useEffect(() => {
    if (isPublicDomain) return; // Public domain books/comics do not need slideshow
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
  }, [isPublicDomain, slideIndex, hasStarted, initialDelay, tilePauseSequence, book.type, comicPagesList.length, novelSnippets.length]);

  const currentComicPage = comicPagesList[(slideIndex + tileSeed) % (comicPagesList.length || 1)] || comicPagesList[0];
  const currentNovelSnippet = novelSnippets[(slideIndex + tileSeed) % (novelSnippets.length || 1)] || novelSnippets[0];
  const currentDirection = DIRECTIONS[(slideIndex + tileSeed) % DIRECTIONS.length];

  return (
    <div
      onClick={onOpen}
      className="flex-shrink-0 w-[80px] sm:w-[130px] md:w-[160px] lg:w-[180px] group flex flex-col cursor-pointer select-none"
    >
      {/* BOOK PREVIEW CONTAINER: 4/3 Aspect Ratio */}
      <div className="relative w-full aspect-[3/4] flex flex-col justify-between bg-card text-card-foreground border border-border/80 rounded-md shadow-none overflow-hidden transition-all duration-300 group-hover:border-primary/60 group-active:scale-95">
        {/* BACKGROUND & METRO LIVE TILE CONTENT */}
        {isPublicDomain ? (
          // STATIC COVER OR FIRST PAGE FOR PUBLIC DOMAIN LIBRARY BOOKS & COMICS
          <div className="absolute inset-0 bg-muted/20 overflow-hidden flex items-center justify-center">
            {effectiveCover && !imgError ? (
              <img
                key={`archive-cov-${effectiveCover}`}
                src={effectiveCover}
                alt={book.title}
                onError={() => {
                  if (cleanArchiveId && archiveImgAttempt < 3) {
                    setArchiveImgAttempt(prev => prev + 1);
                  } else {
                    setImgError(true);
                  }
                }}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                referrerPolicy="no-referrer"
              />
            ) : (
              // First page representation on book card when no cover image is available
              <div className="w-full h-full bg-card p-2 sm:p-3 flex flex-col justify-between text-left select-none overflow-hidden border border-border/40">
                <div className="flex items-center justify-between border-b border-border/40 pb-0.5">
                  <span className="text-[7px] sm:text-[8px] font-mono uppercase font-bold text-muted-foreground tracking-wider">Page 1</span>
                  <span className="text-[7px] sm:text-[8px] font-mono text-muted-foreground uppercase">{book.type}</span>
                </div>
                <div className="my-auto space-y-0.5 sm:space-y-1 py-1">
                  <h5 className="text-[9px] sm:text-[11px] font-serif font-bold text-foreground line-clamp-2 leading-tight">
                    {book.title}
                  </h5>
                  <p className="text-[8px] sm:text-[9px] text-muted-foreground italic font-serif truncate">
                    By {book.author || "Author"}
                  </p>
                  <p className="text-[7px] sm:text-[8px] text-foreground/75 font-serif line-clamp-3 sm:line-clamp-4 leading-relaxed mt-0.5">
                    {book.description || currentNovelSnippet || "Opening chapter excerpt from the public domain library collection."}
                  </p>
                </div>
                <div className="text-[6px] sm:text-[7px] text-muted-foreground/60 font-mono border-t border-border/30 pt-0.5 text-center truncate">
                  {book.source === 'gutenberg' ? 'Project Gutenberg' : 'Internet Archive'}
                </div>
              </div>
            )}
          </div>
        ) : book.type === 'comic' ? (
          // COMIC METRO LIVE TILE: Display ENTIRE Page Layout in 4/3 aspect ratio box
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
                ) : (currentComicPage?.image || book.cover || book.cover_url) ? (
                  <img
                    src={currentComicPage?.image || book.cover || book.cover_url || undefined}
                    alt={book.title}
                    className="w-full h-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full bg-card p-2 sm:p-3 flex flex-col justify-between text-left select-none overflow-hidden border border-border/40">
                    <div className="flex items-center justify-between border-b border-border/40 pb-0.5">
                      <span className="text-[7px] sm:text-[8px] font-mono uppercase font-bold text-muted-foreground">Page 1</span>
                      <span className="text-[7px] sm:text-[8px] font-mono text-amber-500 font-bold uppercase">COMIC</span>
                    </div>
                    <div className="my-auto space-y-1 text-center py-1">
                      <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 text-amber-500 mx-auto opacity-70 animate-pulse" />
                      <span className="text-[9px] sm:text-xs font-bold text-foreground line-clamp-2">{book.title}</span>
                    </div>
                    <div className="text-[6px] sm:text-[7px] text-muted-foreground/60 font-mono border-t border-border/30 pt-0.5 text-center">
                      Comic Creator Project
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        ) : (
          // NOVEL METRO LIVE TILE: Novel slide show fills the ENTIRE page
          <div className="absolute inset-0 bg-card overflow-hidden">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={`novel-page-${slideIndex}`}
                initial={currentDirection.initial}
                animate={{ x: "0%", y: "0%", opacity: 1 }}
                exit={currentDirection.exit}
                transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
                className="absolute inset-0 w-full h-full flex flex-col justify-between pt-6 sm:pt-8 px-2.5 sm:px-3.5 pb-2 sm:pb-3 overflow-hidden bg-card select-none"
              >
                {novelBgImage && (
                  <div className="absolute inset-0 pointer-events-none opacity-20 overflow-hidden">
                    <img
                      src={novelBgImage || undefined}
                      alt=""
                      className="w-full h-full object-cover filter blur-[1px]"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                )}
                <div className="relative z-10 flex-1 flex flex-col justify-center">
                  <p className="text-[10px] sm:text-[12px] leading-relaxed text-card-foreground font-serif line-clamp-6 sm:line-clamp-7 italic text-left tracking-normal">
                    {currentNovelSnippet}
                  </p>
                </div>
                <div className="relative z-10 pt-1 flex items-center justify-between text-[8px] sm:text-[9px] text-muted-foreground font-serif border-t border-border/30 mt-auto">
                  <span className="truncate max-w-[80px] sm:max-w-[100px]">{book.title}</span>
                  <span className="font-mono text-[7px] sm:text-[8px] opacity-70">p. {((slideIndex + tileSeed) % Math.max(1, novelSnippets.length)) + 1}</span>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        )}

        {/* TOP HEADER BAR: METRO TYPE BADGE */}
        <div className="relative z-20 p-1.5 sm:p-2 flex items-center justify-between w-full pointer-events-none">
          <span
            className={`px-1.5 sm:px-2 py-0.5 text-[8px] sm:text-[9px] font-black tracking-widest uppercase text-white font-mono rounded-xs shadow-xs ${
              book.type === 'comic'
                ? 'bg-purple-600'
                : 'bg-blue-600'
            }`}
          >
            {book.type}
          </span>
        </div>

        {/* MIDDLE DYNAMIC CONTENT AREA: Comic speech bubble preview if creator comic */}
        {!isPublicDomain && book.type === 'comic' && currentComicPage?.speechSnippet && (
          <div className="relative z-10 px-2 sm:px-3 py-1 flex-1 flex flex-col justify-end pb-1.5 sm:pb-2 overflow-hidden">
            <div className="relative w-full overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.p
                  key={`comic-bubble-${slideIndex}`}
                  initial={currentDirection.initial}
                  animate={{ x: "0%", y: "0%", opacity: 1 }}
                  exit={currentDirection.exit}
                  transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
                  className="text-[9px] sm:text-[10px] leading-tight text-card-foreground font-sans line-clamp-2 bg-card/90 p-1 sm:p-1.5 rounded-sm border border-amber-500/40 backdrop-blur-xs"
                >
                  💬 "{currentComicPage.speechSnippet}"
                </motion.p>
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      {/* METADATA AREA: Line 1 Title (contain delete), Line 2 Author (with edit) - No empty blank space */}
      <div className="pt-1.5 px-0.5 flex flex-col w-full min-w-0">
        <div className="flex items-center justify-between gap-1 w-full min-w-0">
          <h4 className="text-xs font-bold text-card-foreground truncate group-hover:text-primary transition-colors tracking-tight font-sans flex-1" title={book.title}>
            {book.title || "Untitled"}
          </h4>
          {isAuthor && onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(e);
              }}
              className="p-0.5 text-muted-foreground hover:text-destructive transition-colors shrink-0"
              title="Delete Published Work"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
        
        <div className="flex items-center justify-between text-[10px] text-muted-foreground font-medium mt-0.5">
          <span className="truncate flex items-center gap-1 flex-1" title={book.author}>
            <User className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
            {book.author || "Author"}
          </span>
          {isAuthor && onEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(e);
              }}
              className="text-[9px] font-bold text-primary hover:underline uppercase flex items-center gap-0.5 shrink-0 ml-1"
              title="Edit in Workspace"
            >
              <PenTool className="w-2.5 h-2.5" />
              <span>Edit</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

let globalRandomSeedItems: PublishedItem[] | null = null;

export function Bookshelf({ 
  onOpenInWorkspace,
  onOpenInReader
}: { 
  onOpenInWorkspace?: (type: 'comic' | 'novel', id: string) => void;
  onOpenInReader?: (type: 'comic' | 'novel', id: string) => void;
}) {
  const { user, supabaseUrl, supabaseAnonKey } = useAppSettings();
  const [books, setBooks] = useState<PublishedItem[]>([]);
  const [selectedBook, setSelectedBook] = useState<PublishedItem | null>(null);
  const [activeComicPage, setActiveComicPage] = useState(0);
  const [fontSize, setFontSize] = useState<'sm' | 'md' | 'lg' | 'xl'>('md');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'books' | 'comics'>('all');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<PublicBookItem[] | null>(null);
  const shelf1Ref = useRef<HTMLDivElement>(null);
  const shelf2Ref = useRef<HTMLDivElement>(null);
  const novelScrollRef = useRef<HTMLDivElement>(null);
  const lockedNovelAnchorRef = useRef<{ charOffset: number } | null>(null);
  const isAdjustingFontSizeRef = useRef<boolean>(false);

  // Dynamic overflow tracking for page-turning arrow buttons on both shelves
  const [shelf1Overflow, setShelf1Overflow] = useState({
    isOverflowing: false,
    canScrollLeft: false,
    canScrollRight: false,
  });

  const [shelf2Overflow, setShelf2Overflow] = useState({
    isOverflowing: false,
    canScrollLeft: false,
    canScrollRight: false,
  });

  const updateShelfOverflow = useCallback(() => {
    const checkEl = (el: HTMLDivElement | null) => {
      if (!el) return { isOverflowing: false, canScrollLeft: false, canScrollRight: false };
      const isOverflowing = el.scrollWidth > el.clientWidth + 4;
      const canScrollLeft = isOverflowing && el.scrollLeft > 6;
      const canScrollRight = isOverflowing && el.scrollLeft < el.scrollWidth - el.clientWidth - 6;
      return { isOverflowing, canScrollLeft, canScrollRight };
    };

    setShelf1Overflow(checkEl(shelf1Ref.current));
    setShelf2Overflow(checkEl(shelf2Ref.current));
  }, []);

  const calculateNovelAbsoluteAnchor = (container: HTMLElement): number => {
    try {
      const containerRect = container.getBoundingClientRect();
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let totalChars = 0;
      let textNode: Text | null;
      const range = document.createRange();

      while ((textNode = walker.nextNode() as Text | null)) {
        const text = textNode.textContent || "";
        const len = text.length;
        if (len === 0) continue;

        range.selectNodeContents(textNode);
        const rects = range.getClientRects();
        let intersectsTop = false;
        for (let i = 0; i < rects.length; i++) {
          if (rects[i].bottom > containerRect.top + 4) {
            intersectsTop = true;
            break;
          }
        }

        if (intersectsTop) {
          for (let c = 0; c < len; c++) {
            if (/\s/.test(text[c])) continue;
            try {
              range.setStart(textNode, c);
              range.setEnd(textNode, Math.min(c + 1, len));
              const crs = range.getClientRects();
              if (crs.length > 0 && crs[0].bottom > containerRect.top + 4) {
                return totalChars + c;
              }
            } catch (e) {
              break;
            }
          }
        }
        totalChars += len;
      }
    } catch (e) {}
    return 0;
  };

  const handleNovelFontSizeChange = (newSize: 'sm' | 'md' | 'lg' | 'xl') => {
    if (novelScrollRef.current) {
      if (lockedNovelAnchorRef.current === null) {
        const offset = calculateNovelAbsoluteAnchor(novelScrollRef.current);
        lockedNovelAnchorRef.current = { charOffset: offset };
      }
    }
    isAdjustingFontSizeRef.current = true;
    setFontSize(newSize);
  };

  useLayoutEffect(() => {
    if (lockedNovelAnchorRef.current && novelScrollRef.current) {
      const { charOffset } = lockedNovelAnchorRef.current;
      const container = novelScrollRef.current;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let totalChars = 0;
      let textNode: Text | null;
      const range = document.createRange();

      while ((textNode = walker.nextNode() as Text | null)) {
        const text = textNode.textContent || "";
        const len = text.length;
        if (totalChars + len > charOffset) {
          const offsetInNode = Math.max(0, Math.min(charOffset - totalChars, len - 1));
          try {
            range.setStart(textNode, offsetInNode);
            range.setEnd(textNode, Math.min(offsetInNode + 1, len));
            const rects = range.getClientRects();
            if (rects.length > 0) {
              const rect = rects[0];
              const containerRect = container.getBoundingClientRect();
              const delta = rect.top - containerRect.top;
              container.scrollTop += delta;
              break;
            }
          } catch (e) {}

          const pRect = textNode.parentElement?.getBoundingClientRect();
          if (pRect) {
            const containerRect = container.getBoundingClientRect();
            container.scrollTop += (pRect.top - containerRect.top);
            break;
          }
          break;
        }
        totalChars += len;
      }
      requestAnimationFrame(() => {
        isAdjustingFontSizeRef.current = false;
      });
    }
  }, [fontSize]);

  // Helper to distinguish user/community created published works from public domain library books
  const isCreatorWork = (b: PublishedItem): boolean => {
    if (!b || !b.id) return false;
    if (b.source === 'gutenberg' || b.source === 'archive') return false;
    if (b.id.startsWith('gutenberg-') || b.id.startsWith('archive-')) return false;
    return true;
  };

  // Helper to ensure user-published works are ALWAYS placed at the front
  const sortBooksWithPublishedFirst = (items: PublishedItem[]): PublishedItem[] => {
    return [...items].sort((a, b) => {
      const aCreator = isCreatorWork(a);
      const bCreator = isCreatorWork(b);
      if (aCreator && !bCreator) return -1;
      if (!aCreator && bCreator) return 1;
      return (b.timestamp || 0) - (a.timestamp || 0);
    });
  };

  // Load books on webapp load:
  // 1. Randomly select from public domain library pool to fill at least two bookshelves (~18 items)
  // 2. Load creator published works from local cache and R2 cloud storage
  // 3. User-published works are ALWAYS sorted to the front of the shelf
  const loadBooks = async () => {
    // 1. Generate fresh random public domain selection (fill 1 shelf)
    if (!globalRandomSeedItems) {
      const randomPool = getRandomLibrarySelection(10);
      globalRandomSeedItems = randomPool.map((item, idx) => ({
        id: item.id,
        title: item.title,
        author: item.author,
        cover: item.cover_url,
        cover_url: item.cover_url,
        type: item.content_type === 'comic' ? 'comic' : 'novel',
        content_type: item.content_type,
        resource_url: item.resource_url,
        identifier: item.identifier,
        description: item.description || '',
        total_pages: item.total_pages,
        source: item.source,
        download_count: item.download_count,
        timestamp: Date.now() - (idx + 1) * 3600000,
      })) as PublishedItem[];
    }
    const randomSeedItems = globalRandomSeedItems;

    // 2. Read existing user-published creator works from localStorage
    let localCreatorWorks: PublishedItem[] = [];
    try {
      const userPublishedJson = localStorage.getItem("ebookcc_published_items");
      if (userPublishedJson) {
        const parsed = JSON.parse(userPublishedJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          localCreatorWorks = parsed.filter(item => isCreatorWork(item));
        }
      }
    } catch (_) {}

    // Initialize with creator works at the front, followed by random library items
    const initialList = sortBooksWithPublishedFirst([...localCreatorWorks, ...randomSeedItems]);
    setBooks(initialList);
    safeSetPublishedCache(initialList);

    // 3. Network-First: Fetch authoritative, latest published works from R2 media storage / Server API
    try {
      const res = await fetchPublishedWorksFromR2();
      if (res.success && Array.isArray(res.works)) {
        const r2Works: PublishedItem[] = res.works.filter(w => isCreatorWork(w));

        const creatorMap = new Map<string, PublishedItem>();
        localCreatorWorks.forEach(w => creatorMap.set(w.id, w));
        r2Works.forEach(w => creatorMap.set(w.id, w));

        const allCreatorWorks = Array.from(creatorMap.values());
        const combined = sortBooksWithPublishedFirst([...allCreatorWorks, ...randomSeedItems]);
        setBooks(combined);
        safeSetPublishedCache(combined);
      }
    } catch (netErr) {
      // Silently fall back to cached works
    }
  };

  useEffect(() => {
    loadBooks();
    
    // Auto sync when local storage updates or custom events fire
    const handleSync = () => loadBooks();
    window.addEventListener('storage', handleSync);
    window.addEventListener('ebookcc_published', handleSync);
    window.addEventListener('focus', handleSync);

    const supabase = getSupabase(supabaseUrl, supabaseAnonKey);
    let channel: any;
    if (supabase) {
      channel = supabase.channel('public:published_works')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'published_works' }, () => {
          loadBooks();
        })
        .subscribe();
    }

    return () => {
      window.removeEventListener('storage', handleSync);
      window.removeEventListener('ebookcc_published', handleSync);
      window.removeEventListener('focus', handleSync);
      if (channel) {
        supabase?.removeChannel(channel);
      }
    };
  }, [supabaseUrl, supabaseAnonKey]);

  // Monitor horizontal scroll overflow on both shelves to only show arrows when needed
  useEffect(() => {
    const el1 = shelf1Ref.current;
    const el2 = shelf2Ref.current;

    updateShelfOverflow();
    if (el1) el1.addEventListener('scroll', updateShelfOverflow, { passive: true });
    if (el2) el2.addEventListener('scroll', updateShelfOverflow, { passive: true });
    window.addEventListener('resize', updateShelfOverflow);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => updateShelfOverflow());
      if (el1) ro.observe(el1);
      if (el2) ro.observe(el2);
    }

    return () => {
      if (el1) el1.removeEventListener('scroll', updateShelfOverflow);
      if (el2) el2.removeEventListener('scroll', updateShelfOverflow);
      window.removeEventListener('resize', updateShelfOverflow);
      if (ro) ro.disconnect();
    };
  }, [updateShelfOverflow, books, searchResults]);

  // Dual Catalog Search (Gutendex & Internet Archive)
  const handleCatalogSearch = async () => {
    const q = searchQuery.trim();
    if (!q) {
      toast.info("Please enter a book or comic title to search the public domain catalog.");
      return;
    }

    setIsSearching(true);
    try {
      let combined: PublicBookItem[] = [];

      if (typeFilter === 'books') {
        const res = await searchGutenbergBooks(q);
        combined = res.results;
      } else if (typeFilter === 'comics') {
        const res = await searchArchiveComics(q);
        combined = res.results;
      } else {
        const [gutenRes, archiveRes] = await Promise.all([
          searchGutenbergBooks(q),
          searchArchiveComics(q),
        ]);
        const maxLen = Math.max(gutenRes.results.length, archiveRes.results.length);
        for (let i = 0; i < maxLen; i++) {
          if (gutenRes.results[i]) combined.push(gutenRes.results[i]);
          if (archiveRes.results[i]) combined.push(archiveRes.results[i]);
        }
      }

      setSearchResults(combined);
      if (combined.length === 0) {
        toast.info(`No public domain titles found for "${q}". Try another keyword.`);
      } else {
        toast.success(`Found ${combined.length} titles in public domain library!`);
      }
    } catch (err: any) {
      console.error("Public catalog search failed:", err);
      toast.error("Failed to query catalog. Please try again.");
    } finally {
      setIsSearching(false);
    }
  };

  // Add lightweight metadata to Bookshelf without pre-downloading large files
  const addToBookshelf = (item: PublicBookItem) => {
    const isAlreadySaved = books.some(b => b.id === item.id || (item.identifier && b.identifier === item.identifier));
    if (isAlreadySaved) {
      toast.info(`"${item.title}" is already on your Bookshelf`);
      return;
    }

    const newItem: PublishedItem = {
      id: item.id,
      title: item.title,
      author: item.author,
      cover: item.cover_url,
      cover_url: item.cover_url,
      type: item.content_type === 'comic' ? 'comic' : 'novel',
      content_type: item.content_type,
      resource_url: item.resource_url,
      identifier: item.identifier,
      description: item.description || '',
      total_pages: item.total_pages,
      source: item.source,
      download_count: item.download_count,
      timestamp: Date.now(),
    };

    const updated = sortBooksWithPublishedFirst([newItem, ...books]);
    setBooks(updated);
    safeSetPublishedCache(updated);
    window.dispatchEvent(new Event("ebookcc_published"));
    window.dispatchEvent(new Event("storage"));
    toast.success(`Added "${item.title}" to Bookshelf!`);
  };

  const scrollShelf = (shelfNum: 1 | 2, direction: 'left' | 'right') => {
    const el = shelfNum === 1 ? shelf1Ref.current : shelf2Ref.current;
    if (el) {
      const scrollAmount = Math.max(el.clientWidth * 0.75, 300);
      el.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
      setTimeout(updateShelfOverflow, 350);
    }
  };

  const handleOpenBook = (book: PublishedItem | PublicBookItem) => {
    const payload: PublishedItem = {
      id: book.id,
      title: book.title,
      author: book.author,
      cover: (book as any).cover || (book as any).cover_url || '',
      cover_url: (book as any).cover_url || (book as any).cover || '',
      type: (book as any).content_type === 'comic' || (book as any).type === 'comic' ? 'comic' : 'novel',
      content_type: (book as any).content_type || (book as any).type,
      resource_url: (book as any).resource_url,
      identifier: (book as any).identifier,
      description: (book as any).description || '',
      total_pages: (book as any).total_pages,
      source: (book as any).source,
      timestamp: (book as any).timestamp || Date.now(),
    };

    sessionStorage.setItem("ebookcc_open_read_item", JSON.stringify(payload));

    if (onOpenInReader) {
      onOpenInReader(payload.type, payload.id);
    } else {
      setSelectedBook(payload);
      setActiveComicPage(0);
      toast.success(`Opening: ${payload.title}`);
    }
  };

  const deletePublishedBook = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to permanently delete this published work?")) {
      try {
        const filtered = books.filter((b: PublishedItem) => b.id !== id);
        setBooks(filtered);
        safeSetPublishedCache(filtered);

        // Only delete from R2 if it is a user-published original creation
        if (!id.startsWith("gutenberg-") && !id.startsWith("archive-")) {
          try {
            await deletePublishedWorkFromR2(id);
          } catch (_) {}
        }

        window.dispatchEvent(new Event("ebookcc_published"));
        window.dispatchEvent(new Event("storage"));
        toast.success("Published work deleted.");
      } catch (err) {
        toast.error("Failed to delete published work.");
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

  // Filter bookshelf by search term if searchResults is not active
  const filteredBooks = books.filter(b => {
    if (typeFilter === 'books' && (b.type !== 'novel' && b.content_type !== 'epub' && b.source !== 'gutenberg')) return false;
    if (typeFilter === 'comics' && (b.type !== 'comic' && b.content_type !== 'comic' && b.source !== 'archive')) return false;
    if (!searchQuery.trim() || searchResults !== null) return true;
    const term = searchQuery.toLowerCase();
    return b.title.toLowerCase().includes(term) || (b.author && b.author.toLowerCase().includes(term));
  });

  // Convert public domain search results into PublishedItem format so they can take the place of displayed books
  const searchDisplayBooks: PublishedItem[] = useMemo(() => {
    if (searchResults === null) return [];
    return searchResults.map((item, idx) => ({
      id: item.id,
      title: item.title,
      author: item.author,
      cover: item.cover_url,
      cover_url: item.cover_url,
      type: (item.content_type === 'comic' ? 'comic' : 'novel') as 'comic' | 'novel',
      content_type: item.content_type,
      resource_url: item.resource_url,
      identifier: item.identifier,
      description: item.description || '',
      total_pages: item.total_pages,
      source: item.source,
      download_count: item.download_count,
      timestamp: Date.now() - idx,
    }));
  }, [searchResults]);

  // When search results are active, they take the place of displayed books across the shelves
  const activeBooks = searchResults !== null ? searchDisplayBooks : filteredBooks;

  // Helper to extract safe page array
  const selectedComicPages = selectedBook
    ? (Array.isArray(selectedBook.pages)
        ? selectedBook.pages
        : typeof selectedBook.pages === 'string'
        ? (() => { try { return JSON.parse(selectedBook.pages); } catch (_) { return []; } })()
        : [])
    : [];

  const isSelectedAuthor = selectedBook && (
    !selectedBook.id.startsWith("default-") && 
    !selectedBook.id.startsWith("gutenberg-") && 
    !selectedBook.id.startsWith("archive-") && (
      !selectedBook.authorId || 
      (user && user.uid === selectedBook.authorId) || 
      (user && user.email === selectedBook.authorEmail) ||
      (user && user.name === selectedBook.author)
    )
  );

  return (
    <div className="w-full pt-4 pb-0 border-t border-border/40 max-w-full shadow-none" id="bookshelf-section">
      <div className="w-full">
        {/* Header & Integrated Search Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2.5 shrink-0">
              <BookOpen className="w-6 h-6 text-primary" />
              Bookshelf
            </h2>
          </div>

          {/* Integrated Search Box beside Bookshelf */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
            <div className="relative w-full sm:w-80 group">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCatalogSearch();
                }}
                placeholder="Search Gutenberg & Archive..."
                className="w-full pl-9 pr-14 py-1.5 text-xs rounded-lg border border-border bg-background/90 focus:bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs transition-all"
              />
              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                {searchQuery && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setSearchResults(null);
                    }}
                    className="p-1 text-muted-foreground hover:text-foreground cursor-pointer rounded-md"
                    title="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={handleCatalogSearch}
                  disabled={isSearching || !searchQuery.trim()}
                  className="p-1 text-primary hover:text-primary/80 disabled:opacity-50 cursor-pointer rounded-md"
                  title="Search Catalog"
                >
                  {isSearching ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CornerDownLeft className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Type Toggle: All | Books | Comics */}
            <div className="flex items-center p-0.5 rounded-lg border border-border bg-muted/40 shrink-0 text-xs font-medium w-full sm:w-auto">
              <button
                onClick={() => setTypeFilter('all')}
                className={cn(
                  "flex-1 sm:flex-none px-2.5 py-1 rounded-md transition-all cursor-pointer text-xs text-center",
                  typeFilter === 'all'
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                All
              </button>
              <button
                onClick={() => setTypeFilter('books')}
                className={cn(
                  "flex-1 sm:flex-none px-2.5 py-1 rounded-md transition-all flex items-center justify-center gap-1 cursor-pointer text-xs",
                  typeFilter === 'books'
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title="Gutenberg Books"
              >
                <BookText className="w-3 h-3 text-emerald-500" />
                Books
              </button>
              <button
                onClick={() => setTypeFilter('comics')}
                className={cn(
                  "flex-1 sm:flex-none px-2.5 py-1 rounded-md transition-all flex items-center justify-center gap-1 cursor-pointer text-xs",
                  typeFilter === 'comics'
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title="Internet Archive Comics"
              >
                <Sparkles className="w-3 h-3 text-amber-500" />
                Comics
              </button>
            </div>
          </div>
        </div>

        {/* Active Search Notification Banner: Search results take the place of displayed books */}
        {searchResults !== null && (
          <div className="flex items-center justify-between px-4 py-2 bg-primary/10 border border-primary/25 rounded-lg mb-4 text-xs shadow-xs">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              <span className="font-semibold text-foreground">
                Showing {searchResults.length} search results for "{searchQuery}"
              </span>
              <span className="text-muted-foreground text-[11px] hidden sm:inline">
                (Search results take the place of displayed books across the shelves)
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchResults(null);
                setSearchQuery('');
              }}
              className="h-7 text-xs gap-1.5 cursor-pointer hover:bg-background"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Clear Search
            </Button>
          </div>
        )}

        {/* The Bookshelf Container */}
        <div className="flex flex-col gap-4">
          <div className="relative flex flex-col">
            {/* Horizontal scroll shelf wrapper */}
            <div className="relative group/shelf1 shadow-none">
              {/* Shelf Page-Turning Arrows */}
              {shelf1Overflow.isOverflowing && (
                <>
                  {shelf1Overflow.canScrollLeft && (
                    <button
                      type="button"
                      onClick={() => scrollShelf(1, 'left')}
                      className="absolute -left-3 top-1/2 -translate-y-1/2 z-20 p-2.5 rounded-full bg-background/95 border border-border shadow-md text-foreground hover:bg-primary hover:text-primary-foreground transition-all duration-200 focus:outline-none backdrop-blur-md cursor-pointer"
                      aria-label="Scroll Shelf left"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                  )}
                  {shelf1Overflow.canScrollRight && (
                    <button
                      type="button"
                      onClick={() => scrollShelf(1, 'right')}
                      className="absolute -right-3 top-1/2 -translate-y-1/2 z-20 p-2.5 rounded-full bg-background/95 border border-border shadow-md text-foreground hover:bg-primary hover:text-primary-foreground transition-all duration-200 focus:outline-none backdrop-blur-md cursor-pointer"
                      aria-label="Scroll Shelf right"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  )}
                </>
              )}

              <div 
                ref={shelf1Ref}
                className="flex gap-3 sm:gap-6 overflow-x-auto pb-1 scroll-smooth select-none px-1 no-scrollbar [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
              >
                {activeBooks.length === 0 ? (
                  <div className="w-full py-8 text-center border border-dashed rounded-lg bg-muted/10">
                    <BookOpen className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                    <p className="text-xs font-semibold text-foreground">
                      {searchResults !== null ? "No matching search results" : "Library is empty"}
                    </p>
                  </div>
                ) : (
                  activeBooks.map((book, idx) => {
                    const isAuthor = !book.id.startsWith("default-") && 
                      !book.id.startsWith("gutenberg-") && 
                      !book.id.startsWith("archive-") && (
                      !book.authorId || 
                      (user && user.uid === book.authorId) || 
                      (user && user.email === book.authorEmail) ||
                      (user && user.name === book.author)
                    );

                    return (
                      <MetroBookTile
                        key={`s1-${book.id}-${idx}`}
                        book={book}
                        index={idx}
                        onOpen={() => handleOpenBook(book)}
                        onEdit={onOpenInWorkspace && isAuthor ? (e) => {
                          e.stopPropagation();
                          onOpenInWorkspace(book.type, book.id);
                        } : undefined}
                        onDelete={isAuthor ? (e) => deletePublishedBook(e, book.id) : undefined}
                        isDefault={book.id.startsWith("default-")}
                        isAuthor={isAuthor}
                      />
                    );
                  })
                )}
              </div>
            </div>
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
                        onClick={() => handleNovelFontSizeChange('sm')}
                      >
                        A-
                      </Button>
                      <Button 
                        variant={fontSize === 'md' ? 'secondary' : 'ghost'} 
                        size="icon" 
                        className="h-6 w-6 text-xs font-bold"
                        onClick={() => handleNovelFontSizeChange('md')}
                      >
                        A
                      </Button>
                      <Button 
                        variant={fontSize === 'lg' ? 'secondary' : 'ghost'} 
                        size="icon" 
                        className="h-6 w-6 text-sm font-bold"
                        onClick={() => handleNovelFontSizeChange('lg')}
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
              <div 
                ref={novelScrollRef} 
                onScroll={() => {
                  if (!isAdjustingFontSizeRef.current) {
                    lockedNovelAnchorRef.current = null;
                  }
                }}
                className="flex-1 overflow-y-auto p-6 md:p-8 bg-card/10"
              >
                {selectedBook.type === 'novel' ? (
                  <article className="max-w-2xl mx-auto prose font-serif reader-content-body">
                    <div 
                      className={`${getFontSizeClass()} text-foreground space-y-5`}
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
