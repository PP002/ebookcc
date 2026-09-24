import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { BookOpen, PenTool, Wrench, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw, Book, Star, Sparkles, FolderOpen, Heart, Layers, PanelLeftOpen, PanelLeftClose, Maximize, Minimize, Sun, Moon, Laptop, Settings, Grid, Crop, Trash2, Play, MessageSquare, StickyNote, ArrowLeftRight, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useDropzone } from 'react-dropzone';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from 'next-themes';
import { EpubView } from 'react-reader';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import JSZip from 'jszip';
import { runPredictAPI, autoCropImageBorders } from '@/components/Convert';
import { toast } from 'sonner';
import { saveRecentBook, getRecentBooksMeta, getFullBookFile, deleteRecentBook, RecentBookMetadata, clearAllHistory } from '@/lib/historyCache';
import { useLanguage } from '@/context/LanguageContext';
import { ComicPageRenderer, ComicTreeNodeView } from '@/components/ComicPageRenderer';
import { ReaderNotesSidebar } from '@/components/ReaderNotesSidebar';
import { getLocalNotes, fetchCloudComments } from '@/lib/commentsStorage';
import { fetchPublishedWorksFromR2, fetchSinglePublishedWork } from '@/lib/r2Storage';
import { detectReadingDirectionWaterfall, ReadingDirection } from '@/utils/readingDirection';
import { GoogleDriveDialog, GoogleDriveIcon } from '@/components/GoogleDriveDialog';
import { getLibraryProxyUrl, getArchivePageImageUrl } from '@/lib/publicLibrary';
// @ts-ignore
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function SplitPanelsIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="7" y="3.5" width="10" height="17" rx="1.5" />
      <path d="M4.5 7H2.5v10h2" />
      <path d="M19.5 7h2v10h-2" />
    </svg>
  );
}

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
  pages: any[];
  fileType?: 'images' | 'epub' | 'pdf' | 'text' | 'comic' | 'docx';
  file?: File;
  fileBuffer?: ArrayBuffer;
  streamUrl?: string;
  archiveIdentifier?: string;
  isBookshelf?: boolean;
  readingDirection?: 'rtl' | 'ltr';
  readingDirectionInfo?: string;
}

function checkIfBookshelf(book: BookItem | null): boolean {
  if (!book) return false;
  if (book.isBookshelf) return true;
  if (book.id && !book.id.startsWith("uploaded-")) {
    try {
      const pub = JSON.parse(localStorage.getItem("ebookcc_published_items") || "[]");
      if (pub.some((item: any) => item.id === book.id)) return true;
    } catch (_) {}
  }
  return false;
}

function isBookshelfComic(book: BookItem | null): boolean {
  if (!book) return false;
  if (book.fileType === 'comic') return true;
  if (Array.isArray(book.pages) && book.pages.some(p => p && typeof p === 'object' && (p.tree || p.panels || p.bubbles))) {
    return true;
  }
  return false;
}

const imageBlobCache = new Map<string, string>();

function getPageImageUrl(page: any): string | null {
  if (!page) return null;
  if (typeof page === 'string') return page.trim() || null;
  if (typeof page === 'object') {
    const candidate = page.imageUrl || page.image || page.cover || page.url;
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim();
    }
  }
  return null;
}

async function fetchCleanImageBlobUrl(url: string): Promise<string> {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return url;
  if (imageBlobCache.has(url)) return imageBlobCache.get(url)!;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (res.ok) {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      imageBlobCache.set(url, blobUrl);
      return blobUrl;
    }
  } catch (_) {}
  try {
    const proxyUrl = getLibraryProxyUrl(url);
    const res = await fetch(proxyUrl);
    if (res.ok) {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      imageBlobCache.set(url, blobUrl);
      return blobUrl;
    }
  } catch (_) {}
  return url;
}

/**
 * Checks if a book was authored / published via the CREATE tool.
 * Published creator works already possess panel architectures and should NEVER invoke YOLO.
 */
function isPublishedCreatorWork(book: BookItem | null): boolean {
  if (!book) return false;
  // If it's an archive.org comic or Gutenberg, it is not a creator-published work
  if (book.archiveIdentifier || (typeof book.id === 'string' && book.id.startsWith('archive-')) || (book as any).source === 'archive' || (book as any).source === 'gutenberg') {
    return false;
  }
  // If pages contain creator canvas nodes (tree, panels, bubbles)
  if (Array.isArray(book.pages) && book.pages.some(p => p && typeof p === 'object' && (p.tree || p.panels || p.bubbles))) {
    return true;
  }
  if ((book as any).source === 'creator' || (book as any).source === 'published') {
    return true;
  }
  // Bookshelf comic that is not an external archive stream
  if (book.isBookshelf && book.fileType === 'comic' && !book.archiveIdentifier) {
    return true;
  }
  return false;
}

/**
 * Recursively extracts all asset panel images from a comic page in reading order.
 * Works with ComicCreator layout trees (SplitNode / PanelNode), panel arrays, or direct page assets.
 * Respects reading direction (LTR vs RTL) for horizontal splits and panel sequences.
 */
function extractAssetPanelsFromPage(page: any, readingDirection: ReadingDirection = 'ltr'): string[] {
  if (!page) return [];
  if (typeof page === 'string') {
    return page.trim() !== '' ? [page] : [];
  }

  const panels: string[] = [];

  const traverseNode = (node: any) => {
    if (!node) return;

    if (node.type === 'panel') {
      const img = node.imageUrl || node.drawing || node.bgImageUrl || node.image;
      if (img && typeof img === 'string' && img.trim() !== '') {
        panels.push(img);
      } else if (Array.isArray(node.drawings) && node.drawings.length > 0) {
        const strokeWithImg = node.drawings.find((d: any) => d && d.imageUrl && typeof d.imageUrl === 'string' && d.imageUrl.trim() !== '');
        if (strokeWithImg) {
          panels.push(strokeWithImg.imageUrl);
        }
      }
    } else if (node.type === 'split') {
      const isRow = node.dir === 'row' || node.dir === 'h' || node.dir === 'horizontal' || node.direction === 'horizontal';
      const c1 = node.c1 || node.left;
      const c2 = node.c2 || node.right;
      if (isRow && readingDirection === 'rtl') {
        // In RTL manga, panels on the right side come before panels on the left side
        traverseNode(c2);
        traverseNode(c1);
      } else {
        traverseNode(c1);
        traverseNode(c2);
      }
    }
  };

  if (page.tree) {
    traverseNode(page.tree);
  } else if (Array.isArray(page.panels)) {
    const list = readingDirection === 'rtl' ? [...page.panels].reverse() : page.panels;
    list.forEach((p: any) => {
      if (typeof p === 'string') {
        if (p.trim() !== '') panels.push(p);
      } else if (p && typeof p === 'object') {
        const img = p.imageUrl || p.drawing || p.image || p.url || p.cover;
        if (img && typeof img === 'string' && img.trim() !== '') panels.push(img);
      }
    });
  } else if (page.imageUrl || page.cover || page.image || page.url) {
    const single = page.imageUrl || page.cover || page.image || page.url;
    if (typeof single === 'string' && single.trim() !== '') {
      panels.push(single);
    }
  }

  return panels;
}

interface ExtractedComicEpub {
  isComic: boolean;
  pages: string[];
  readingDirection?: ReadingDirection;
  readingDirectionDetail?: string;
  cover?: string;
  totalImages: number;
}

/**
 * Inspects and extracts images from an EPUB file.
 * Handles comic books, manga, and fixed-layout image EPUBs with spine reading order
 * or natural sorting, ensuring comic EPUBs open seamlessly.
 */
async function extractComicFromEpub(fileOrBuffer: File | ArrayBuffer): Promise<ExtractedComicEpub | null> {
  try {
    const zip = new JSZip();
    const loadedZip = await zip.loadAsync(fileOrBuffer);

    // 1. Gather all potential image files
    const allImageFiles = Object.keys(loadedZip.files).filter(name =>
      !name.startsWith('__MACOSX') &&
      !loadedZip.files[name].dir &&
      name.match(/\.(jpe?g|png|webp|gif|avif)$/i)
    );

    if (allImageFiles.length === 0) {
      return null;
    }

    // 2. Try to locate OPF file from META-INF/container.xml
    let opfPath: string | null = null;
    const containerFile = loadedZip.file("META-INF/container.xml") ||
      Object.values(loadedZip.files).find(f => f.name.toLowerCase() === "meta-inf/container.xml");
    if (containerFile) {
      try {
        const containerXml = await containerFile.async("text");
        const match = containerXml.match(/<rootfile[^>]*full-path=["']([^"']+)["']/i);
        if (match && match[1]) {
          opfPath = match[1];
        }
      } catch (_) {}
    }

    if (!opfPath) {
      opfPath = Object.keys(loadedZip.files).find(n => n.toLowerCase().endsWith('.opf')) || null;
    }

    let orderedImagePaths: string[] = [];
    let detectedDirection: ReadingDirection | undefined = undefined;
    let detectedDirectionDetail: string | undefined = undefined;
    let totalTextChars = 0;
    let totalXhtmlFiles = 0;
    let spineImagesCount = 0;
    let totalSpineItems = 0;

    const opfDir = opfPath && opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

    const resolveZipPath = (baseDir: string, relativeHref: string): string => {
      let cleanHref = decodeURIComponent(relativeHref.split('#')[0].split('?')[0]);
      const combined = (baseDir ? baseDir : '') + cleanHref;
      const parts = combined.split('/');
      const resolved: string[] = [];
      for (const part of parts) {
        if (part === '.' || part === '') continue;
        if (part === '..') {
          resolved.pop();
        } else {
          resolved.push(part);
        }
      }
      return resolved.join('/');
    };

    const opfFile = opfPath ? (loadedZip.file(opfPath) || Object.values(loadedZip.files).find(f => f.name.toLowerCase() === opfPath!.toLowerCase())) : null;

    if (opfFile) {
      try {
        const opfText = await opfFile.async("text");
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(opfText, "application/xml");

        // Check reading direction from spine: page-progression-direction="rtl"
        const spineEl = xmlDoc.querySelector("spine");
        if (spineEl) {
          const ppd = spineEl.getAttribute("page-progression-direction");
          if (ppd === "rtl") {
            detectedDirection = "rtl";
            detectedDirectionDetail = "EPUB spine (page-progression-direction: rtl)";
          } else if (ppd === "ltr") {
            detectedDirection = "ltr";
            detectedDirectionDetail = "EPUB spine (page-progression-direction: ltr)";
          }
        }

        // Build manifest map: id -> { path, mediaType }
        const manifestItems = xmlDoc.querySelectorAll("manifest > item");
        const manifestMap = new Map<string, { path: string; mediaType: string }>();
        manifestItems.forEach(item => {
          const id = item.getAttribute("id");
          const href = item.getAttribute("href");
          const mediaType = item.getAttribute("media-type") || "";
          if (id && href) {
            manifestMap.set(id, {
              path: resolveZipPath(opfDir, href),
              mediaType: mediaType.toLowerCase()
            });
          }
        });

        // Walk spine itemrefs in reading order
        const itemrefs = xmlDoc.querySelectorAll("spine > itemref");
        totalSpineItems = itemrefs.length;
        for (let i = 0; i < itemrefs.length; i++) {
          const idref = itemrefs[i].getAttribute("idref");
          if (!idref) continue;
          const manifestItem = manifestMap.get(idref);
          if (!manifestItem) continue;

          if (manifestItem.mediaType.startsWith("image/")) {
            orderedImagePaths.push(manifestItem.path);
            spineImagesCount++;
          } else if (
            manifestItem.mediaType.includes("xhtml") ||
            manifestItem.mediaType.includes("html") ||
            manifestItem.mediaType.includes("xml")
          ) {
            const zipEntry = loadedZip.file(manifestItem.path) ||
              Object.values(loadedZip.files).find(f => f.name.toLowerCase() === manifestItem.path.toLowerCase());
            if (zipEntry) {
              const htmlContent = await zipEntry.async("text");
              const plainText = htmlContent.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
              totalTextChars += plainText.length;
              totalXhtmlFiles++;

              // Look for <img> or SVG <image> tag
              const imgMatch = htmlContent.match(/<(?:img|image)[^>]*(?:src|href|xlink:href)=["']([^"']+)["']/i);
              if (imgMatch && imgMatch[1]) {
                const xhtmlDir = manifestItem.path.includes("/") ? manifestItem.path.substring(0, manifestItem.path.lastIndexOf("/") + 1) : "";
                const imgPath = resolveZipPath(xhtmlDir, imgMatch[1]);
                orderedImagePaths.push(imgPath);
                spineImagesCount++;
              }
            }
          }
        }
      } catch (xmlErr) {
        console.warn("[Read] Failed to parse EPUB OPF:", xmlErr);
      }
    }

    // Match file paths in zip (case-insensitive)
    const findMatchingZipKey = (pathStr: string) => {
      if (loadedZip.files[pathStr]) return pathStr;
      const lower = pathStr.toLowerCase();
      return Object.keys(loadedZip.files).find(k => k.toLowerCase() === lower);
    };

    let finalImageFiles = orderedImagePaths
      .map(findMatchingZipKey)
      .filter((p): p is string => Boolean(p));

    // Fallback: If spine extraction yielded fewer than 2 images, but allImageFiles has images,
    // use natural sort of all images (matching Convert)
    if (finalImageFiles.length === 0 || (finalImageFiles.length === 1 && allImageFiles.length > 2)) {
      finalImageFiles = [...allImageFiles].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
      );
    }

    // Deduplicate
    finalImageFiles = Array.from(new Set(finalImageFiles));

    // Decision: Is this a Comic EPUB?
    const avgTextPerHtml = totalXhtmlFiles > 0 ? (totalTextChars / totalXhtmlFiles) : 0;
    const isComic = finalImageFiles.length >= 2 && (
      totalXhtmlFiles === 0 ||
      avgTextPerHtml < 500 ||
      (totalTextChars < 8000 && finalImageFiles.length >= 2) ||
      (totalSpineItems > 0 && spineImagesCount / totalSpineItems >= 0.5)
    );

    if (isComic && finalImageFiles.length > 0) {
      const pageBlobs = await Promise.all(
        finalImageFiles.map(async imgPath => {
          const blob = await loadedZip.files[imgPath].async("blob");
          return URL.createObjectURL(blob);
        })
      );

      return {
        isComic: true,
        pages: pageBlobs,
        readingDirection: detectedDirection,
        readingDirectionDetail: detectedDirectionDetail,
        cover: pageBlobs[0],
        totalImages: pageBlobs.length,
      };
    }

    return {
      isComic: false,
      pages: [],
      readingDirection: detectedDirection,
      readingDirectionDetail: detectedDirectionDetail,
      totalImages: finalImageFiles.length,
    };
  } catch (err) {
    console.error("[Read] Error checking comic EPUB:", err);
    return null;
  }
}

interface RecentBookCardProps {
  book: RecentBookMetadata;
  onOpen: (book: RecentBookMetadata) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  t: (key: string) => string;
}

const RecentBookCard: React.FC<RecentBookCardProps> = ({ book, onOpen, onDelete, t }) => {
  const [imgError, setImgError] = useState(false);

  const cleanArchiveId = book.id?.startsWith('archive-')
    ? book.id.replace(/^archive-/, '')
    : (book as any).identifier || null;

  const rawCover = typeof book.cover === 'string' ? book.cover : '';
  const hasValidCover = !imgError && rawCover && 
    (rawCover.startsWith('data:') || rawCover.startsWith('http') || rawCover.startsWith('blob:') || rawCover.startsWith('/')) &&
    !rawCover.includes('placehold.co') &&
    !rawCover.includes('archive.org/services/img');

  const effectiveRecentCover = hasValidCover
    ? rawCover
    : (!imgError && cleanArchiveId)
    ? `https://archive.org/download/${cleanArchiveId}/page/n0_medium.jpg`
    : null;

  return (
    <div 
      onClick={() => onOpen(book)}
      className="group relative flex flex-col bg-card hover:bg-accent/35 border border-border hover:border-primary/50 transition-all duration-300 rounded-none overflow-hidden cursor-pointer shadow-xs hover:shadow-md w-full select-none m-0 p-0"
    >
      {/* Cover Preview: Auto-resize by natural cover aspect ratio with zero blank margins */}
      {effectiveRecentCover && !imgError ? (
        <div className="relative w-full overflow-hidden border-b bg-card block m-0 p-0 leading-none text-[0px]">
          <img 
            src={effectiveRecentCover} 
            alt={book.title}
            onError={() => setImgError(true)}
            className="w-full h-auto block m-0 p-0 object-cover transition-transform duration-300 group-hover:scale-105"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
            <div className="p-2 bg-primary text-primary-foreground rounded-full shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            </div>
          </div>
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 text-[8px] font-black tracking-wider uppercase bg-black/80 text-white rounded-none leading-normal">
            {book.fileType === 'comic' || book.fileType === 'images' ? 'Comic' : book.fileType}
          </span>
        </div>
      ) : (
        // Standard 3:4 layout if no cover or if cover image failed to load (preserves card height)
        <div className="relative w-full aspect-[3/4] min-h-[140px] bg-card overflow-hidden flex flex-col justify-between border-b p-2 sm:p-2.5 select-none text-left">
          <div className="flex items-center justify-between border-b border-border/40 pb-0.5">
            <span className="text-[7px] font-mono uppercase font-bold text-muted-foreground">Page 1</span>
            <span className="text-[7px] font-mono text-primary font-bold uppercase">{book.fileType}</span>
          </div>
          <div className="my-auto space-y-0.5 py-0.5">
            <h5 className="text-[10px] font-serif font-bold text-foreground line-clamp-2 leading-tight">
              {book.title}
            </h5>
            <p className="text-[8px] text-muted-foreground italic font-serif truncate">
              {book.author === "Local File" ? t("localFile") : book.author}
            </p>
          </div>
          <div className="text-[6px] text-muted-foreground/60 font-mono border-t border-border/30 pt-0.5 text-center truncate">
            Offline Document
          </div>
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
            <div className="p-2 bg-primary text-primary-foreground rounded-full shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            </div>
          </div>
        </div>
      )}

      {/* Book Metadata: Line 1 Title (contain delete), Line 2 Author */}
      <div className="p-1.5 flex flex-col w-full min-w-0 bg-card">
        <div className="flex items-center justify-between gap-1 w-full min-w-0">
          <h4 className="text-xs font-bold text-foreground truncate group-hover:text-primary transition-colors flex-1" title={book.title}>
            {book.title}
          </h4>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => onDelete(e, book.id)}
            className="w-4 h-4 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 cursor-pointer"
            title="Remove from history"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground truncate font-medium mt-0.5" title={book.author === "Local File" ? t("localFile") : book.author}>
          {book.author === "Local File" ? t("localFile") : book.author}
        </p>
      </div>
    </div>
  );
};

export const Read: React.FC<ReadProps> = ({ setActiveView, onActiveStateChange, onFullscreenChange }) => {
  const { t } = useLanguage();
  const [selectedBook, setSelectedBook] = useState<BookItem | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [location, setLocation] = useState<string | number>(0);
  const [epubToc, setEpubToc] = useState<any[]>([]);
  const [epubCurrentPage, setEpubCurrentPage] = useState<number>(0);
  const [epubTotalPages, setEpubTotalPages] = useState<number>(0);
  const renditionRef = React.useRef<any>(null);
  const [pdfNumPages, setPdfNumPages] = useState<number | null>(null);
  const [textPages, setTextPages] = useState(1);
  const [textToc, setTextToc] = useState<any[]>([]);
  const textContentRef = React.useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();

  const [recentBooks, setRecentBooks] = useState<RecentBookMetadata[]>([]);
  const [isDownloadingEpub, setIsDownloadingEpub] = useState(false);
  const [epubDownloadError, setEpubDownloadError] = useState<string | null>(null);

  // Download remote EPUB as ArrayBuffer to bypass epubjs directory/extension detection failures
  useEffect(() => {
    if (selectedBook?.fileType === 'epub' && selectedBook.streamUrl && !selectedBook.fileBuffer) {
      let isSubscribed = true;
      setIsDownloadingEpub(true);
      setEpubDownloadError(null);

      const downloadBook = async () => {
        try {
          const fetchTarget = selectedBook.streamUrl!;
          let response = await fetch(fetchTarget);
          
          if (!response.ok && selectedBook.id.startsWith('gutenberg-')) {
            const rawId = selectedBook.id.replace('gutenberg-', '');
            // Try direct static cache pg{id}.epub via proxy
            const fallbackTarget = `/api/library/proxy/book.epub?fileUrl=${encodeURIComponent(`https://www.gutenberg.org/cache/epub/${rawId}/pg${rawId}.epub`)}`;
            response = await fetch(fallbackTarget);
          }

          if (!response.ok) {
            throw new Error(`Failed to load book from library (status ${response.status})`);
          }

          const arrayBuffer = await response.arrayBuffer();
          if (isSubscribed) {
            setSelectedBook(prev => prev ? { ...prev, fileBuffer: arrayBuffer } : null);
            setIsDownloadingEpub(false);
          }
        } catch (err: any) {
          console.error("EPUB download error:", err);
          if (isSubscribed) {
            setEpubDownloadError(err?.message || "Failed to load EPUB file");
            setIsDownloadingEpub(false);
            toast.error("Could not load Gutenberg book. Please try again.");
          }
        }
      };

      downloadBook();
      return () => {
        isSubscribed = false;
      };
    }
  }, [selectedBook?.id, selectedBook?.fileType, selectedBook?.streamUrl, selectedBook?.fileBuffer]);


  const [isNotesSidebarOpen, setIsNotesSidebarOpen] = useState<boolean>(false);
  const [notesCount, setNotesCount] = useState<number>(0);

  // Google Drive states
  const [googleDriveOpen, setGoogleDriveOpen] = useState(false);
  const [googleDriveMode, setGoogleDriveMode] = useState<'import' | 'export'>('import');

  // Export payload for currently opened book
  const exportPayload = useMemo(() => {
    if (!selectedBook) return undefined;
    let blob: Blob | undefined;
    let mimeType = 'application/octet-stream';
    let name = selectedBook.title || 'Book';

    if (selectedBook.file) {
      blob = selectedBook.file;
      mimeType = selectedBook.file.type || 'application/octet-stream';
    } else if (selectedBook.fileBuffer) {
      if (selectedBook.fileType === 'epub') {
        blob = new Blob([selectedBook.fileBuffer], { type: 'application/epub+zip' });
        mimeType = 'application/epub+zip';
        if (!name.endsWith('.epub')) name += '.epub';
      } else if (selectedBook.fileType === 'pdf') {
        blob = new Blob([selectedBook.fileBuffer], { type: 'application/pdf' });
        mimeType = 'application/pdf';
        if (!name.endsWith('.pdf')) name += '.pdf';
      }
    } else if (selectedBook.fileType === 'text') {
      const textContent = Array.isArray(selectedBook.pages) ? selectedBook.pages.join('\n\n') : String(selectedBook.pages || '');
      blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
      mimeType = 'text/plain';
      if (!name.endsWith('.txt')) name += '.txt';
    }
    return { name, blob, mimeType };
  }, [selectedBook]);

  const refreshNotesCount = useCallback(async () => {
    if (!selectedBook) {
      setNotesCount(0);
      return;
    }
    const isShelf = checkIfBookshelf(selectedBook);
    if (isShelf) {
      const list = await fetchCloudComments(selectedBook.id);
      setNotesCount(list.length);
    } else {
      const list = getLocalNotes(selectedBook.id);
      setNotesCount(list.length);
    }
  }, [selectedBook]);

  useEffect(() => {
    refreshNotesCount();
  }, [refreshNotesCount]);

  useEffect(() => {
    if (!selectedBook) {
      setRecentBooks(getRecentBooksMeta());
    }
  }, [selectedBook]);

  useEffect(() => {
    if (selectedBook) {
       const timer = setTimeout(() => {
         saveRecentBook({
           ...selectedBook,
           fileType: selectedBook.fileType || "images"
         }, currentPage, location);
       }, 500);
       return () => clearTimeout(timer);
    }
  }, [selectedBook, currentPage, location]);

  const handleRecoverEpubAsComic = async () => {
    if (!selectedBook) return;
    try {
      const buf = selectedBook.fileBuffer || (selectedBook.file ? await selectedBook.file.arrayBuffer() : null);
      if (!buf) {
        toast.error("No file buffer available to extract.");
        return;
      }
      toast.info("Extracting comic pages from EPUB...");
      const comicRes = await extractComicFromEpub(buf);
      if (comicRes && comicRes.pages.length > 0) {
        setSelectedBook(prev => prev ? {
          ...prev,
          fileType: 'images',
          pages: comicRes.pages,
          cover: comicRes.cover || prev.cover,
          readingDirection: comicRes.readingDirection || prev.readingDirection,
          readingDirectionInfo: comicRes.readingDirectionDetail || prev.readingDirectionInfo
        } : null);
        if (comicRes.readingDirection) {
          setReadingDirection(comicRes.readingDirection);
        }
        setCurrentPage(0);
        toast.success(`Loaded ${comicRes.pages.length} comic pages!`);
      } else {
        toast.error("No comic pages found in this EPUB archive.");
      }
    } catch (e) {
      console.error("[Read] Failed to extract comic from EPUB:", e);
      toast.error("Failed to extract comic pages from EPUB.");
    }
  };

  const handleOpenRecent = async (meta: RecentBookMetadata) => {
    try {
      const fullBook = await getFullBookFile(meta.id);
      if (fullBook) {
        let resolvedPages = Array.isArray(fullBook.pages) && fullBook.pages.length > 0 ? fullBook.pages : [fullBook.cover];
        let resolvedFileType = fullBook.fileType;
        let resolvedDirection = fullBook.readingDirection;
        let resolvedDirectionInfo = fullBook.readingDirectionInfo;

        // If stored file/fileBuffer exists, re-extract pages for comic EPUBs, ZIPs, or when pages were purged
        const buf = fullBook.fileBuffer || (fullBook.file ? await fullBook.file.arrayBuffer() : null);
        if (buf) {
          const isEpubLike = fullBook.fileType === 'epub' || fullBook.title?.toLowerCase().endsWith('.epub');
          const isZipLike = fullBook.title?.toLowerCase().endsWith('.zip') || fullBook.title?.toLowerCase().endsWith('.cbz') || fullBook.title?.toLowerCase().endsWith('.cbr');

          if (isEpubLike || fullBook.fileType === 'images' || fullBook.fileType === 'comic') {
            try {
              const comicRes = await extractComicFromEpub(buf);
              if (comicRes && comicRes.isComic && comicRes.pages.length > 0) {
                resolvedPages = comicRes.pages;
                resolvedFileType = 'images';
                if (comicRes.readingDirection) {
                  resolvedDirection = comicRes.readingDirection;
                  resolvedDirectionInfo = comicRes.readingDirectionDetail;
                }
              }
            } catch (err) {
              console.warn("[Read] Could not re-extract comic from EPUB buffer:", err);
            }
          } else if (isZipLike) {
            try {
              const zip = new JSZip();
              const loadedZip = await zip.loadAsync(buf);
              const imageFiles = Object.keys(loadedZip.files)
                .filter(name => !name.startsWith('__MACOSX') && !loadedZip.files[name].dir && name.match(/\.(jpe?g|png|webp|gif|avif)$/i))
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
              if (imageFiles.length > 0) {
                resolvedPages = await Promise.all(imageFiles.map(async name => {
                  const blob = await loadedZip.files[name].async("blob");
                  return URL.createObjectURL(blob);
                }));
                resolvedFileType = 'images';
              }
            } catch (err) {
              console.warn("[Read] Could not re-extract images from archive buffer:", err);
            }
          }
        }

        setSelectedBook({
          id: fullBook.id,
          title: fullBook.title,
          author: fullBook.author || 'Local File',
          cover: resolvedPages[0] || fullBook.cover,
          chapters: 1,
          rating: 0,
          pages: resolvedPages,
          fileType: resolvedFileType,
          file: fullBook.file,
          fileBuffer: fullBook.fileBuffer || buf,
          readingDirection: resolvedDirection,
          readingDirectionInfo: resolvedDirectionInfo
        });
        if (resolvedDirection) {
          setReadingDirection(resolvedDirection);
        }
        const targetPage = typeof fullBook.lastReadPage === 'number' ? fullBook.lastReadPage : 0;
        setCurrentPage(Math.max(0, Math.min(targetPage, resolvedPages.length > 0 ? resolvedPages.length - 1 : targetPage)));
        setLocation(fullBook.lastReadLocation || 0);
        toast.success(`Resumed reading: ${fullBook.title}`);
      } else {
        toast.error("Book data not found in cache.");
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to load book from history.");
    }
  };

  const handleDeleteRecent = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteRecentBook(id);
    setRecentBooks(getRecentBooksMeta());
    toast.success("Removed book from history.");
  };

  // Listen for Bookshelf open in Reader
  useEffect(() => {
    const loadFromBookshelf = async () => {
      const triggerId = sessionStorage.getItem("ebookcc_open_read_id");
      const triggerType = sessionStorage.getItem("ebookcc_open_read_type");
      const triggerItemStr = sessionStorage.getItem("ebookcc_open_read_item");
      
      if ((triggerId && triggerType) || triggerItemStr) {
        sessionStorage.removeItem("ebookcc_open_read_id");
        sessionStorage.removeItem("ebookcc_open_read_type");
        sessionStorage.removeItem("ebookcc_open_read_item");

        try {
          let book: any = null;

          if (triggerItemStr) {
            try {
              book = JSON.parse(triggerItemStr);
            } catch (_) {}
          }

          if (!book && triggerId) {
            // Network-First: query server R2 / cloud first for the latest version of the book
            try {
              book = await fetchSinglePublishedWork(triggerId);
            } catch (_) {}

            if (!book) {
              try {
                const r2WorksRes = await fetchPublishedWorksFromR2();
                if (r2WorksRes?.works && Array.isArray(r2WorksRes.works)) {
                  book = r2WorksRes.works.find((item: any) => item.id === triggerId);
                }
              } catch (_) {}
            }

            // Fallback to local storage cache if network is offline or unreached
            if (!book) {
              try {
                const pub = JSON.parse(localStorage.getItem("ebookcc_published_items") || "[]");
                book = pub.find((item: any) => item.id === triggerId);
              } catch (_) {}
            }
          }

          if (book) {
            // 1. PUBLIC DOMAIN EPUB (Gutenberg or external stream)
            const isEpub = book.content_type === 'epub' || 
              book.source === 'gutenberg' || 
              (book.resource_url && book.resource_url.includes('.epub'));

            if (isEpub) {
              const streamUrl = book.resource_url ? getLibraryProxyUrl(book.resource_url) : undefined;
              setSelectedBook({
                id: book.id,
                title: book.title,
                author: book.author || "Project Gutenberg",
                cover: book.cover || book.cover_url || "",
                chapters: 1,
                rating: 5,
                fileType: "epub",
                streamUrl,
                pages: [],
                isBookshelf: true,
              });
              setCurrentPage(0);
              setLocation(0);
              return;
            }

            // 2. PUBLIC DOMAIN COMIC (Internet Archive streaming pages)
            const isArchiveComic = book.content_type === 'comic' && 
              (book.source === 'archive' || book.identifier || book.id.startsWith('archive-'));

            if (isArchiveComic) {
              const archiveId = book.identifier || book.id.replace('archive-', '');
              const totalPages = book.total_pages || (Array.isArray(book.pages) && book.pages.length > 0 ? book.pages.length : 50);
              const streamPages = Array.from({ length: totalPages }, (_, i) => ({
                id: `archive-${archiveId}-p${i}`,
                image: getArchivePageImageUrl(archiveId, i, 'large'),
                cover: getArchivePageImageUrl(archiveId, i, 'medium'),
                imageUrl: getArchivePageImageUrl(archiveId, i, 'large'),
                pageNumber: i + 1,
              }));

              setSelectedBook({
                id: book.id,
                title: book.title,
                author: book.author || "Internet Archive Comics",
                cover: book.cover || book.cover_url || getArchivePageImageUrl(archiveId, 0, 'medium'),
                chapters: 1,
                rating: 5,
                fileType: "comic",
                archiveIdentifier: archiveId,
                pages: streamPages,
                isBookshelf: true,
              });
              setCurrentPage(0);
              return;
            }

            // 3. NOVEL / TEXT
            if (triggerType === "novel" || book.type === "novel") {
              setSelectedBook({
                id: book.id,
                title: book.title,
                author: book.author || "Creative Publisher",
                cover: book.cover || "",
                chapters: 1,
                rating: 5,
                fileType: "text",
                pages: [book.content || ""],
                isBookshelf: true,
              });
              setCurrentPage(0);
            } else {
              // 4. CREATOR ORIGINAL COMIC
              const pagesList = Array.isArray(book.pages) && book.pages.length > 0 
                ? book.pages 
                : (book.cover ? [{ cover: book.cover }] : []);
              setSelectedBook({
                id: book.id,
                title: book.title,
                author: book.author || "Creative Publisher",
                cover: book.cover || "",
                chapters: 1,
                rating: 5,
                fileType: "comic",
                pages: pagesList,
                isBookshelf: true,
              });
              setCurrentPage(0);
            }
          }
        } catch (err) {
          console.error("Failed loading from bookshelf", err);
        }
      }
    };

    loadFromBookshelf();
  }, []);

  // Sliding window cache: N+1 & N+2 pre-loader for stream-based reading
  useEffect(() => {
    if (!selectedBook || !selectedBook.pages || selectedBook.pages.length === 0) return;
    const pagesToPreload = [currentPage + 1, currentPage + 2, currentPage - 1];
    pagesToPreload.forEach((idx) => {
      if (idx >= 0 && idx < selectedBook.pages.length) {
        const page = selectedBook.pages[idx];
        const pageUrl = getPageImageUrl(page);
        if (pageUrl && typeof pageUrl === 'string' && pageUrl.startsWith('http')) {
          fetchCleanImageBlobUrl(pageUrl).catch(() => {});
        }
      }
    });
  }, [selectedBook, currentPage]);

  useEffect(() => {
    if (onFullscreenChange) {
      onFullscreenChange(isFullscreen);
    }
  }, [isFullscreen, onFullscreenChange]);

  const isTextBook = Boolean(
    selectedBook &&
    (selectedBook.fileType === 'text' || selectedBook.fileType === 'epub') &&
    !isBookshelfComic(selectedBook)
  );

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontFamily, setFontFamily] = useState('font-serif');
  const [fontSize, setFontSize] = useState<number>(18);
  const [textAlign, setTextAlign] = useState('text-left');

  const applyEpubThemeStylesRef = React.useRef<((contents: any) => void) | null>(null);

  const applyEpubThemeStyles = React.useCallback((contents: any) => {
    if (!contents) return;
    const doc = contents.document;
    if (!doc) return;

    const isDark = (theme === 'dark') || 
                   (theme === 'system' && (resolvedTheme === 'dark' || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches))) ||
                   (!theme && resolvedTheme === 'dark');

    const textColor = isDark ? '#f4f4f5' : '#18181b';
    const linkColor = isDark ? '#60a5fa' : '#2563eb';
    const borderColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.15)';

    // 1. Ensure iframe element is 100% transparent and allows transparency
    try {
      const iframe = contents.content || (doc.defaultView?.frameElement as HTMLIFrameElement | null);
      if (iframe) {
        iframe.style.setProperty('background', 'transparent', 'important');
        iframe.style.setProperty('background-color', 'transparent', 'important');
        iframe.setAttribute('allowtransparency', 'true');
      }
    } catch (e) {}

    // 2. Clear out any inline backgrounds or hardcoded colors immediately
    if (doc.documentElement) {
      doc.documentElement.style.setProperty('background', 'transparent', 'important');
      doc.documentElement.style.setProperty('background-color', 'transparent', 'important');
      doc.documentElement.style.setProperty('color', textColor, 'important');
      doc.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    }
    if (doc.body) {
      doc.body.style.setProperty('background', 'transparent', 'important');
      doc.body.style.setProperty('background-color', 'transparent', 'important');
      doc.body.style.setProperty('color', textColor, 'important');
      doc.body.removeAttribute('bgcolor');
    }

    // 3. Remove any previous custom style tag to ensure a complete fresh CSS parse
    try {
      const oldStyles = doc.querySelectorAll('#custom-epub-override-style');
      oldStyles.forEach((el: Element) => el.remove());
    } catch (e) {}

    const fontFam = fontFamily === 'font-sans' 
      ? '"Inter", ui-sans-serif, system-ui, sans-serif' 
      : fontFamily === 'font-mono' 
      ? '"JetBrains Mono", ui-monospace, monospace' 
      : 'Georgia, Cambria, "Times New Roman", Times, serif';

    const cssTextAlign = textAlign === 'text-center' ? 'center' : textAlign === 'text-justify' ? 'justify' : 'left';

    const styleEl = doc.createElement('style');
    styleEl.id = 'custom-epub-override-style';
    styleEl.textContent = `
      *, *::before, *::after {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
      }
      html, body {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        color: ${textColor} !important;
        font-family: ${fontFam} !important;
        font-size: ${fontSize}px !important;
        text-align: ${cssTextAlign} !important;
      }
      body, p, span, div, h1, h2, h3, h4, h5, h6, a, li, blockquote, em, strong, b, i, small, dd, dt, th, td, pre, code {
        color: ${textColor} !important;
      }
      a {
        color: ${linkColor} !important;
      }
      hr {
        border-color: ${borderColor} !important;
      }
      img, svg {
        max-width: 100% !important;
        height: auto !important;
      }
    `;

    // Append to body and head to guarantee final cascading order over any EPUB internal stylesheets
    if (doc.head) {
      doc.head.appendChild(styleEl);
    } else if (doc.body) {
      doc.body.appendChild(styleEl);
    } else if (doc.documentElement) {
      doc.documentElement.appendChild(styleEl);
    }
  }, [theme, resolvedTheme, fontSize, fontFamily, textAlign]);

  useEffect(() => {
    applyEpubThemeStylesRef.current = applyEpubThemeStyles;
  }, [applyEpubThemeStyles]);

  React.useEffect(() => {
    const isDark = (theme === 'dark') || 
                   (theme === 'system' && (resolvedTheme === 'dark' || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches))) ||
                   (!theme && resolvedTheme === 'dark');

    const textColor = isDark ? '#f4f4f5' : '#18181b';

    const updateAllEpubViews = () => {
      if (renditionRef.current) {
        try { renditionRef.current.themes.select(isDark ? 'dark' : 'light'); } catch(e) {}
        try { renditionRef.current.themes.fontSize(`${fontSize}px`); } catch(e) {}
        try { renditionRef.current.themes.override('color', textColor, 'important'); } catch(e) {}
        try { renditionRef.current.themes.override('background', 'transparent', 'important'); } catch(e) {}
        try { renditionRef.current.themes.override('background-color', 'transparent', 'important'); } catch(e) {}

        // Re-apply to all currently active contents
        try {
          const contentsList = renditionRef.current.getContents ? renditionRef.current.getContents() : [];
          if (Array.isArray(contentsList)) {
            contentsList.forEach((contents: any) => {
              applyEpubThemeStyles(contents);
            });
          }
        } catch (e) {}

        // Re-apply to all active rendition views
        try {
          if (renditionRef.current.views) {
            const views = renditionRef.current.views();
            if (Array.isArray(views)) {
              views.forEach((v: any) => {
                if (v && v.document) {
                  applyEpubThemeStyles({ document: v.document, content: v.iframe });
                }
              });
            }
          }
        } catch (e) {}
      }

      // Direct DOM inspection for all EPUB iframes in the document
      const iframes = document.querySelectorAll<HTMLIFrameElement>('.reader-epub-container iframe');
      iframes.forEach(iframe => {
        try {
          if (iframe.contentDocument) {
            applyEpubThemeStyles({ document: iframe.contentDocument, content: iframe });
          }
        } catch (e) {}
      });
    };

    updateAllEpubViews();
    const raf = requestAnimationFrame(updateAllEpubViews);
    const timer1 = setTimeout(updateAllEpubViews, 50);
    const timer2 = setTimeout(updateAllEpubViews, 150);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [theme, resolvedTheme, fontSize, fontFamily, textAlign, applyEpubThemeStyles]);

  const lockedEpubCfiRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (renditionRef.current && renditionRef.current.book) {
      try {
        const currentLocation = renditionRef.current.location;
        const cfi = lockedEpubCfiRef.current || (currentLocation ? currentLocation.start.cfi : null) || (typeof location === 'string' && location.startsWith('epubcfi') ? location : null);

        renditionRef.current.themes.fontSize(`${fontSize}px`);
        if (cfi) {
          try {
            renditionRef.current.display(cfi);
          } catch (e) {}
        }
        
        const width = containerSize.width || window.innerWidth;
        const height = containerSize.height || window.innerHeight;
        const chars = Math.max(100, Math.floor((width * height) / (fontSize * fontSize * 1.5)));
        
        // Debounce location generation to not block the thread and allow fast font size changes
        clearTimeout((window as any)._epubLocationTimer);
        (window as any)._epubLocationTimer = setTimeout(() => {
          renditionRef.current.book.locations.generate(chars).then(() => {
            setEpubTotalPages(renditionRef.current.book.locations.length());
            if (cfi) {
               renditionRef.current.display(cfi).then(() => {
                  if (renditionRef.current.location) {
                     setEpubCurrentPage(renditionRef.current.location.start.location);
                  }
               });
            } else if (renditionRef.current.location) {
               setEpubCurrentPage(renditionRef.current.location.start.location);
            }
          }).catch(() => {});
        }, 800);
      } catch(e) {}
    }
  }, [fontSize, containerSize.width, containerSize.height]);
  
  const [cropBorders, setCropBorders] = useState(false);
  const [gridView, setGridView] = useState(false);
  
  const [readingDirection, setReadingDirection] = useState<ReadingDirection>('ltr');
  const [directionInfo, setDirectionInfo] = useState<string>('');
  
  const [panelsCache, setPanelsCache] = useState<Record<number, string[]>>({});
  const [croppedCache, setCroppedCache] = useState<Record<number, string>>({});
  const [isProcessingPage, setIsProcessingPage] = useState(false);
  const [currentPanelIndex, setCurrentPanelIndex] = useState(0);

  // Automatic Reading Direction Detection (Waterfall Fallback)
  useEffect(() => {
    if (!selectedBook) return;
    if (selectedBook.readingDirection) {
      setReadingDirection(selectedBook.readingDirection);
      setDirectionInfo(selectedBook.readingDirectionInfo || '');
      return;
    }

    let isActive = true;
    const rawPages = Array.isArray(selectedBook.pages)
      ? selectedBook.pages.filter(p => typeof p === 'string')
      : [];

    detectReadingDirectionWaterfall({
      file: selectedBook.file,
      filename: selectedBook.title,
      pages: rawPages
    }).then(res => {
      if (!isActive) return;
      setReadingDirection(res.direction);
      setDirectionInfo(res.detail);
      setSelectedBook(prev => prev ? { ...prev, readingDirection: res.direction, readingDirectionInfo: res.detail } : null);
      if (res.strategy !== 'default') {
        toast.info(`Reading direction: ${res.direction.toUpperCase()} (${res.detail})`, {
          id: 'reading-direction-detected-toast'
        });
      }
    }).catch(err => {
      console.warn('[Read] Reading direction detection error:', err);
    });

    return () => { isActive = false; };
  }, [selectedBook?.id, selectedBook?.title]);

  // Adjust panels cache when readingDirection changes so panel order aligns with direction
  // WITHOUT wiping away already detected YOLO panels or forcing re-computation
  useEffect(() => {
    if (!selectedBook) return;
    setPanelsCache(prev => {
      const nextCache: Record<number, string[]> = {};
      const isCreator = isPublishedCreatorWork(selectedBook);

      selectedBook.pages.forEach((page, idx) => {
        if (isCreator) {
          const pre = extractAssetPanelsFromPage(page, readingDirection);
          if (pre.length > 0) nextCache[idx] = pre;
        } else if (prev[idx] && prev[idx].length > 1) {
          // Reverse existing panel order to match the new reading direction
          nextCache[idx] = [...prev[idx]].reverse();
        } else if (prev[idx]) {
          nextCache[idx] = prev[idx];
        }
      });
      return nextCache;
    });
  }, [readingDirection]);

  // Initial load of creator panels when selectedBook changes
  useEffect(() => {
    if (!selectedBook) return;
    if (isPublishedCreatorWork(selectedBook) || isBookshelfComic(selectedBook)) {
      const newCache: Record<number, string[]> = {};
      selectedBook.pages.forEach((page, idx) => {
        const panels = extractAssetPanelsFromPage(page, readingDirection);
        if (panels.length > 0) {
          newCache[idx] = panels;
        }
      });
      setPanelsCache(newCache);
    } else {
      setPanelsCache({});
    }
    setCroppedCache({});
  }, [selectedBook?.id]);

  useEffect(() => {
    if (!selectedBook || selectedBook.fileType === 'pdf' || selectedBook.fileType === 'epub' || selectedBook.fileType === 'text') return;
    
    let isActive = true;

    const processPageInBg = async (idx: number) => {
      if (!isActive || !selectedBook) return;
      const rawPage = selectedBook.pages[idx];
      const pageUrl = getPageImageUrl(rawPage);
      if (!pageUrl) return;

      let croppedData: string | null = null;
      let panelsData: string[] | null = null;

      // 1. Fetch clean, CORS-safe local blob URL for external library or remote images
      let cleanSourceUrl = pageUrl;
      if (pageUrl.startsWith('http://') || pageUrl.startsWith('https://')) {
        cleanSourceUrl = await fetchCleanImageBlobUrl(pageUrl);
        if (!isActive) return;
      }

      // 2. Crop borders if cropBorders is enabled
      if (cropBorders && !croppedCache[idx]) {
        try {
          if (!isActive) return;
          const res = await autoCropImageBorders(cleanSourceUrl);
          if (!isActive) return;
          if (res && res.url) {
             croppedData = res.url;
          }
        } catch(e) {
          console.warn('[Read] autoCropImageBorders error:', e);
        }
      }

      // 3. Split panels if gridView (Split Panels) is enabled
      const isCreatorWork = isPublishedCreatorWork(selectedBook);
      const creatorPanels = (isCreatorWork || isBookshelfComic(selectedBook)) 
        ? extractAssetPanelsFromPage(rawPage, readingDirection) 
        : [];
      const hasPreAuthoredPanels = creatorPanels.length > 0;

      if (gridView && !panelsCache[idx]) {
        if (isCreatorWork || hasPreAuthoredPanels) {
          // Published works created with CREATE tool ALREADY have pre-authored panels!
          // NEVER call the YOLO model (runPredictAPI) for published works!
          panelsData = creatorPanels.length > 0 ? creatorPanels : [cleanSourceUrl];
        } else {
          try {
            if (!isActive || !gridView) return;
            const imgToProcess = croppedData || (cropBorders && croppedCache[idx] ? croppedCache[idx] : cleanSourceUrl);
            
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
                        try {
                          resolve(canvas.toDataURL('image/jpeg', 0.95));
                        } catch (taintErr) {
                          console.warn('[Read] Canvas export error, using source:', taintErr);
                          resolve(imgToProcess);
                        }
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
                    if (Math.abs(yDiff) < 50) return readingDirection === 'rtl' ? boxB[1] - boxA[1] : boxA[1] - boxB[1];
                    return yDiff;
                });
                
                if (!isActive || !gridView) return;
                const base64Panels = await new Promise<string[]>((resolve) => {
                   const img = new Image();
                   if (imgToProcess && !imgToProcess.startsWith('blob:') && !imgToProcess.startsWith('data:')) {
                       img.crossOrigin = 'Anonymous';
                   }
                   img.onload = () => {
                       if (!isActive || !gridView) return resolve([imgToProcess]);
                       const canvas = document.createElement('canvas');
                       const ctx = canvas.getContext('2d');
                       if (!ctx) return resolve([imgToProcess]);
                       
                       try {
                         const extracted = regions.map((p: any) => {
                             const box = p.box_2d || p;
                             const [ymin, xmin, ymax, xmax] = box;
                             const y = (ymin / 1000) * img.height;
                             const x = (xmin / 1000) * img.width;
                             const h = ((ymax - ymin) / 1000) * img.height;
                             const w = ((xmax - xmin) / 1000) * img.width;
                             canvas.width = Math.max(1, Math.round(w));
                             canvas.height = Math.max(1, Math.round(h));
                             ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
                             return canvas.toDataURL('image/jpeg', 0.95);
                         });
                         resolve(extracted);
                       } catch (e) {
                         console.warn('[Read] Panel extraction error:', e);
                         resolve([imgToProcess]);
                       }
                   };
                   img.onerror = () => resolve([imgToProcess]);
                   img.src = imgToProcess;
                });
                
                if (!isActive || !gridView) return;
                panelsData = base64Panels;
            } else {
                panelsData = hasPreAuthoredPanels ? creatorPanels : [imgToProcess];
            }
          } catch(e) {
            console.warn('[Read] Panel detection error:', e);
          }
        }
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
  }, [selectedBook, currentPage, cropBorders, gridView, readingDirection]);

  // Notify user when they navigate to a page that hasn't finished layout detection yet
  useEffect(() => {
    if (selectedBook && selectedBook.fileType !== 'text' && selectedBook.fileType !== 'pdf' && selectedBook.fileType !== 'epub' && gridView && !panelsCache[currentPage]) {
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
  }, [selectedBook?.fileType, isFullscreen]);

  // Derived book layout type: Reflow text book (EPUB / Text) vs Image book (Comics / Scanned / Manga)
  const isReflowTextBook = Boolean(
    selectedBook && (
      selectedBook.fileType === 'text' || 
      selectedBook.fileType === 'docx' ||
      (selectedBook.fileType === 'epub' && (!selectedBook.pages || selectedBook.pages.length === 0))
    )
  );
  const isImageBook = Boolean(selectedBook && !isReflowTextBook);

  // DOCX and PDF files require locked page view layout (h/w = 4/3, w/h = 3/4)
  const isPagedDoc = Boolean(
    selectedBook && (
      selectedBook.fileType === 'pdf' || 
      selectedBook.fileType === 'docx' ||
      (selectedBook.fileType === 'text' && selectedBook.title?.toLowerCase().endsWith('.docx'))
    )
  );

  const PAGE_ASPECT_RATIO = 3 / 4; // Width / Height = 3 / 4 (Height / Width = 4 / 3)

  const pageDimensions = useMemo(() => {
    const containerW = containerSize.width || 0;
    const containerH = containerSize.height || 0;
    if (containerW <= 0 || containerH <= 0) {
      return { width: 0, height: 0 };
    }

    if (isPagedDoc) {
      if (containerW / containerH > PAGE_ASPECT_RATIO) {
        // Height is limiting factor
        const h = containerH;
        const w = Math.round(h * PAGE_ASPECT_RATIO);
        return { width: w, height: h };
      } else {
        // Width is limiting factor
        const w = containerW;
        const h = Math.round(w / PAGE_ASPECT_RATIO);
        return { width: w, height: h };
      }
    }

    return {
      width: containerW,
      height: containerH
    };
  }, [containerSize.width, containerSize.height, isPagedDoc]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    if (isSidebarOpen && !isFullscreen) {
      const el = document.getElementById(`thumb-${currentPage}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [currentPage, isSidebarOpen, isFullscreen]);

  const [pageInputValue, setPageInputValue] = useState("");
  
  interface AbsoluteTextAnchor {
    absoluteCharOffset: number; // Exact character index in the chapter/novel text stream
    snippet: string;            // Text snippet for logging/verification
    sourcePage: number;         // Page where the anchor was originally locked
  }

  const lockedAnchorRef = React.useRef<AbsoluteTextAnchor | null>(null);
  const [isReflowing, setIsReflowing] = useState(false);

  // Clear locked anchor on manual page turns or manual navigation
  const clearLockedAnchor = useCallback(() => {
    lockedAnchorRef.current = null;
    lockedEpubCfiRef.current = null;
  }, []);

  // 1. CALCULATE ABSOLUTE ANCHOR POINT:
  // Before changing font size, find the first visible text node on the current page.
  // Calculate its absolute character offset in the source data.
  const calculateAbsoluteAnchor = useCallback((container: HTMLElement, targetPage: number, pageWidth: number): AbsoluteTextAnchor => {
    try {
      const containerRect = container.getBoundingClientRect();
      const containerLeft = containerRect.left;
      
      // Page column horizontal boundaries in container coordinates
      const pageStartX = targetPage * pageWidth;
      const pageEndX = (targetPage + 1) * pageWidth;

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

        // Check if any part of this text node intersects target page column
        let intersectsPage = false;
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          const relLeft = r.left - containerLeft;
          const relRight = r.right - containerLeft;
          if (relRight > pageStartX + 4 && relLeft < pageEndX - 4) {
            intersectsPage = true;
            break;
          }
        }

        if (intersectsPage) {
          // Scan for the first readable non-whitespace character on this page
          for (let c = 0; c < len; c++) {
            if (/\s/.test(text[c])) continue; // skip leading whitespace
            try {
              range.setStart(textNode, c);
              range.setEnd(textNode, Math.min(c + 1, len));
              const crs = range.getClientRects();
              if (crs.length > 0 && crs[0].width > 0) {
                const relLeft = crs[0].left - containerLeft;
                const relRight = crs[0].right - containerLeft;
                if (relRight > pageStartX + 2 && relLeft < pageEndX - 2) {
                  const absoluteCharOffset = totalChars + c;
                  const snippet = text.slice(c, c + 40).replace(/\s+/g, ' ').trim();
                  return {
                    absoluteCharOffset,
                    snippet,
                    sourcePage: targetPage
                  };
                }
              }
            } catch (e) {
              break;
            }
          }
        }

        totalChars += len;
      }
    } catch (e) {
      console.error("Error calculating absolute anchor:", e);
    }

    return {
      absoluteCharOffset: 0,
      snippet: "",
      sourcePage: targetPage
    };
  }, []);

  // 3. PRECISE RESTORATION:
  // After applying the new font size and allowing the DOM to reflow, calculate the exact new page number
  // where that absolute character offset is located, and force the viewport to that exact position.
  const findPageForAbsoluteOffset = useCallback((container: HTMLElement, targetOffset: number, pageWidth: number): number => {
    try {
      const containerRect = container.getBoundingClientRect();
      const containerLeft = containerRect.left;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let totalChars = 0;
      let textNode: Text | null;
      const range = document.createRange();

      while ((textNode = walker.nextNode() as Text | null)) {
        const text = textNode.textContent || "";
        const len = text.length;

        if (totalChars + len > targetOffset) {
          const offsetInNode = Math.max(0, Math.min(targetOffset - totalChars, len - 1));

          // Test target character
          try {
            range.setStart(textNode, offsetInNode);
            range.setEnd(textNode, Math.min(offsetInNode + 1, len));
            const rects = range.getClientRects();
            if (rects.length > 0 && rects[0].width > 0) {
              const relLeft = rects[0].left - containerLeft;
              return Math.floor(Math.max(0, relLeft) / pageWidth);
            }
          } catch (e) {}

          // Probe adjacent characters in the node if exact char was whitespace or newline
          for (let delta = 1; delta <= 20; delta++) {
            if (offsetInNode + delta < len) {
              try {
                range.setStart(textNode, offsetInNode + delta);
                range.setEnd(textNode, Math.min(offsetInNode + delta + 1, len));
                const rects = range.getClientRects();
                if (rects.length > 0 && rects[0].width > 0) {
                  const relLeft = rects[0].left - containerLeft;
                  return Math.floor(Math.max(0, relLeft) / pageWidth);
                }
              } catch (e) {}
            }
            if (offsetInNode - delta >= 0) {
              try {
                range.setStart(textNode, offsetInNode - delta);
                range.setEnd(textNode, Math.min(offsetInNode - delta + 1, len));
                const rects = range.getClientRects();
                if (rects.length > 0 && rects[0].width > 0) {
                  const relLeft = rects[0].left - containerLeft;
                  return Math.floor(Math.max(0, relLeft) / pageWidth);
                }
              } catch (e) {}
            }
          }

          // Fallback to parent element rect
          const pRect = textNode.parentElement?.getBoundingClientRect();
          if (pRect) {
            const relLeft = pRect.left - containerLeft;
            return Math.floor(Math.max(0, relLeft) / pageWidth);
          }
          break;
        }

        totalChars += len;
      }

      if (totalChars > 0 && targetOffset >= totalChars) {
        const scrollWidth = container.scrollWidth;
        return Math.max(0, Math.ceil(scrollWidth / pageWidth) - 1);
      }
    } catch (e) {
      console.error("Error finding page for absolute offset:", e);
    }
    return 0;
  }, []);

  // 2. LOCK THE ANCHOR:
  // While the user is actively adjusting font size (repeatedly clicking +/-), do NOT recalculate the anchor.
  // Keep using the same absolute anchor point captured at the very first font size change.
  // Only clear/update the anchor when the user manually scrolls or changes pages.
  const updateFontSize = useCallback((newSizeOrUpdater: number | ((prev: number) => number)) => {
    if (selectedBook?.fileType === "text" && textContentRef.current) {
      const activeWidth = pageDimensions.width || containerSize.width || 600;
      if (lockedAnchorRef.current === null) {
        lockedAnchorRef.current = calculateAbsoluteAnchor(textContentRef.current, currentPage, activeWidth);
      }
      setIsReflowing(true);
    } else if (selectedBook?.fileType === "epub" && renditionRef.current) {
      if (lockedEpubCfiRef.current === null) {
        try {
          const loc = renditionRef.current.location || (renditionRef.current.currentLocation ? renditionRef.current.currentLocation() : null);
          if (loc?.start?.cfi) {
            lockedEpubCfiRef.current = loc.start.cfi;
          } else if (typeof location === 'string' && location.startsWith('epubcfi')) {
            lockedEpubCfiRef.current = location;
          }
        } catch (e) {}
      }
    }
    setFontSize(newSizeOrUpdater);
  }, [selectedBook, pageDimensions.width, containerSize.width, currentPage, calculateAbsoluteAnchor]);

  const updateTextAlign = useCallback((align: string) => {
    if (selectedBook?.fileType === "text" && textContentRef.current) {
      const activeWidth = pageDimensions.width || containerSize.width || 600;
      if (lockedAnchorRef.current === null) {
        lockedAnchorRef.current = calculateAbsoluteAnchor(textContentRef.current, currentPage, activeWidth);
      }
      setIsReflowing(true);
    }
    setTextAlign(align);
  }, [selectedBook, pageDimensions.width, containerSize.width, currentPage, calculateAbsoluteAnchor]);

  const updateFontFamily = useCallback((font: string) => {
    if (selectedBook?.fileType === "text" && textContentRef.current) {
      const activeWidth = pageDimensions.width || containerSize.width || 600;
      if (lockedAnchorRef.current === null) {
        lockedAnchorRef.current = calculateAbsoluteAnchor(textContentRef.current, currentPage, activeWidth);
      }
      setIsReflowing(true);
    }
    setFontFamily(font);
  }, [selectedBook, pageDimensions.width, containerSize.width, currentPage, calculateAbsoluteAnchor]);

  // Synchronous layout effect: executes after DOM styles are updated with new font size, before browser paint
  useLayoutEffect(() => {
    const activeWidth = pageDimensions.width || containerSize.width;
    if (selectedBook?.fileType === 'text' && textContentRef.current && activeWidth > 0) {
      const container = textContentRef.current;
      const scrollWidth = container.scrollWidth;
      const totalPages = Math.max(1, Math.ceil(scrollWidth / activeWidth));
      
      let newPage = currentPage;
      if (lockedAnchorRef.current !== null) {
        const restored = findPageForAbsoluteOffset(container, lockedAnchorRef.current.absoluteCharOffset, activeWidth);
        newPage = Math.max(0, Math.min(totalPages - 1, restored));
        // CRITICAL: Do NOT nullify lockedAnchorRef.current here!
        // Keep using the same locked anchor point while user continues adjusting font size.
      }

      setCurrentPage(newPage);
      setTextPages(totalPages);

      // Re-enable smooth transition after layout reflow has rendered
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsReflowing(false);
        });
      });

      // Update table of contents with new page offsets
      const headings = container.querySelectorAll('h1, h2, h3');
      if (headings.length > 0) {
        const newToc = Array.from(headings).map(h => {
          let current: HTMLElement | null = h as HTMLElement;
          let offsetLeft = 0;
          while (current && current !== container) {
            offsetLeft += current.offsetLeft || 0;
            current = current.offsetParent as HTMLElement | null;
          }
          const page = Math.floor(offsetLeft / activeWidth);
          return { label: h.textContent || '', page };
        }).filter(item => item.label.trim() !== '');
        setTextToc(newToc);
      } else {
        setTextToc([]);
      }
    }
  }, [selectedBook, pageDimensions.width, pageDimensions.height, fontSize, fontFamily, textAlign, findPageForAbsoluteOffset]);

  useEffect(() => {
    if (onActiveStateChange) {
      onActiveStateChange(selectedBook !== null);
    }
  }, [selectedBook, onActiveStateChange]);

  const nextPage = useCallback(() => {
    clearLockedAnchor();
    if (selectedBook) {
      if (selectedBook.fileType === 'epub' && renditionRef.current) {
        renditionRef.current.next();
        return;
      }
      
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
  }, [selectedBook, pdfNumPages, textPages, gridView, panelsCache, currentPage, currentPanelIndex, clearLockedAnchor]);

  const prevPage = useCallback(() => {
    clearLockedAnchor();
    if (selectedBook) {
      if (selectedBook.fileType === 'epub' && renditionRef.current) {
        renditionRef.current.prev();
        return;
      }

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
  }, [selectedBook, gridView, panelsCache, currentPage, currentPanelIndex, clearLockedAnchor]);

  // Touch gestures for swipe (finger slide left/right) & double-tap (toggle fullscreen)
  const touchStartRef = React.useRef<{ x: number; y: number; time: number } | null>(null);
  const lastTapRef = React.useRef<{ time: number; x: number; y: number } | null>(null);
  const isSwipingRef = React.useRef<boolean>(false);
  const lastToggleTimeRef = React.useRef<number>(0);

  const toggleFullscreenSafe = useCallback(() => {
    const now = Date.now();
    if (now - lastToggleTimeRef.current < 350) return;
    lastToggleTimeRef.current = now;
    setIsFullscreen((prev) => !prev);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now(),
      };
    } else {
      touchStartRef.current = null;
    }
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!touchStartRef.current) return;
      const touch = e.changedTouches[0];
      if (!touch) return;

      const startX = touchStartRef.current.x;
      const startY = touchStartRef.current.y;
      const startTime = touchStartRef.current.time;
      const endX = touch.clientX;
      const endY = touch.clientY;
      const elapsed = Date.now() - startTime;

      const deltaX = endX - startX;
      const deltaY = endY - startY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      // 1. Finger slide / Horizontal swipe to flip page
      if (elapsed < 700 && absX > 40 && absX > absY * 1.2) {
        isSwipingRef.current = true;
        setTimeout(() => {
          isSwipingRef.current = false;
        }, 300);

        if (deltaX < 0) {
          // Swiped left -> In LTR next page, in RTL previous page
          if (readingDirection === 'rtl') {
            prevPage();
          } else {
            nextPage();
          }
        } else {
          // Swiped right -> In LTR previous page, in RTL next page
          if (readingDirection === 'rtl') {
            nextPage();
          } else {
            prevPage();
          }
        }
        touchStartRef.current = null;
        lastTapRef.current = null;
        return;
      }

      // 2. Double tap to switch between full screen and normal
      if (absX < 25 && absY < 25 && elapsed < 350) {
        const now = Date.now();
        const lastTap = lastTapRef.current;

        if (
          lastTap &&
          now - lastTap.time < 350 &&
          Math.hypot(endX - lastTap.x, endY - lastTap.y) < 45
        ) {
          toggleFullscreenSafe();
          lastTapRef.current = null;
          touchStartRef.current = null;
          return;
        } else {
          lastTapRef.current = { time: now, x: endX, y: endY };
        }
      }

      touchStartRef.current = null;
    },
    [nextPage, prevPage, toggleFullscreenSafe, readingDirection]
  );

  const handleLeftClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isSwipingRef.current) return;
      if (readingDirection === 'rtl') {
        nextPage();
      } else {
        prevPage();
      }
    },
    [prevPage, nextPage, readingDirection]
  );

  const handleRightClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isSwipingRef.current) return;
      if (readingDirection === 'rtl') {
        prevPage();
      } else {
        nextPage();
      }
    },
    [nextPage, prevPage, readingDirection]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't page if user is typing in an input or if note float window is active
      if (isNotesSidebarOpen) return;
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      if (readingDirection === 'rtl') {
        if (e.key === 'ArrowRight') prevPage();
        else if (e.key === 'ArrowLeft') nextPage();
      } else {
        if (e.key === 'ArrowRight') nextPage();
        else if (e.key === 'ArrowLeft') prevPage();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextPage, prevPage, isNotesSidebarOpen, readingDirection]);

  const loadFile = useCallback(async (file: File) => {
    let pages: string[] = [];
    let fileType: 'images' | 'epub' | 'pdf' | 'text' = 'images';
    let fileBuffer: ArrayBuffer | undefined = undefined;
    let detectedDir: ReadingDirection = 'ltr';
    let detectedDetail = '';

    const fileName = file.name.toLowerCase();
    // Generate basic object URL if Image
    if (file.type.startsWith('image/')) {
      pages = [URL.createObjectURL(file)];
    } else if (fileName.endsWith('.cbz') || fileName.endsWith('.zip')) {
      try {
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(file);
        const imageFiles = Object.keys(loadedZip.files)
          .filter(name => !name.startsWith('__MACOSX') && !loadedZip.files[name].dir && name.match(/\.(jpe?g|png|webp|gif|avif)$/i))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
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
      try {
        fileBuffer = await file.arrayBuffer();
        const comicRes = await extractComicFromEpub(fileBuffer);
        if (comicRes && comicRes.isComic && comicRes.pages.length > 0) {
          fileType = 'images';
          pages = comicRes.pages;
          if (comicRes.readingDirection) {
            detectedDir = comicRes.readingDirection;
            detectedDetail = comicRes.readingDirectionDetail || 'Detected from EPUB spine';
          }
        } else {
          fileType = 'epub';
          pages = [`https://placehold.co/800x1200/png?text=Loading+EPUB...`];
        }
      } catch (e) {
        console.error("[Read] Failed to parse EPUB:", e);
        fileType = 'epub';
        pages = [`https://placehold.co/800x1200/png?text=Loading+EPUB...`];
      }
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

    if (!detectedDetail) {
      try {
        const dirResult = await detectReadingDirectionWaterfall({
          file,
          filename: file.name,
          pages: pages.filter(p => typeof p === 'string')
        });
        detectedDir = dirResult.direction;
        detectedDetail = dirResult.detail;
        setReadingDirection(detectedDir);
        setDirectionInfo(detectedDetail);
        if (dirResult.strategy !== 'default') {
          toast.info(`Reading direction detected: ${detectedDir.toUpperCase()} (${detectedDetail})`, {
            id: 'reading-direction-upload-toast'
          });
        }
      } catch (dirErr) {
        console.warn('[Read] Direction detection on drop failed:', dirErr);
      }
    } else {
      setReadingDirection(detectedDir);
      setDirectionInfo(detectedDetail);
    }

    const fileId = 'local-' + encodeURIComponent(file.name.toLowerCase().trim()) + '-' + file.size;

    setSelectedBook({
      id: fileId,
      title: file.name,
      author: 'Local File',
      cover: pages[0], 
      chapters: 1,
      rating: 0,
      pages,
      fileType,
      file,
      fileBuffer,
      readingDirection: detectedDir,
      readingDirectionInfo: detectedDetail
    });
    setCurrentPage(0);
  }, []);

  // Listen to open files from Google Drive globally
  useEffect(() => {
    const handleDriveFileOpen = (e: any) => {
      if (e.detail?.file) {
        loadFile(e.detail.file);
      }
    };
    window.addEventListener('ebookcc-open-drive-file', handleDriveFileOpen);
    return () => window.removeEventListener('ebookcc-open-drive-file', handleDriveFileOpen);
  }, [loadFile]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      await loadFile(file);
    }
  }, [loadFile]);

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
    <div className={cn("relative flex-1 flex flex-col w-full h-full min-h-0", !selectedBook ? "overflow-y-auto" : "p-0 overflow-hidden")}>
      {/* Active Component Area */}
      {!selectedBook ? (
        <div className="w-full max-w-full py-6 px-4 sm:px-6 md:px-8 space-y-6 flex-1 flex flex-col items-stretch">
          <div className="text-center space-y-1.5 max-w-2xl mx-auto">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground uppercase">{t("readCardTitle")}</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">{t("readCardDesc")}</p>
          </div>

          <div
            {...getRootProps()}
            className={cn(
              "w-full border border-dashed border-border/50 p-6 sm:p-8 text-center cursor-pointer bg-card/50 hover:border-primary transition-all rounded-none min-h-[160px] sm:min-h-[180px] flex flex-col justify-center items-center shadow-xs hover:shadow-md",
              isDragActive && "border-primary bg-primary/5"
            )}
            style={{ outline: "none" }}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center gap-1.5 max-w-xl">
              <Layers className="w-8 h-8 sm:w-9 sm:h-9 text-primary mb-1" />
              <h2 className="text-xs sm:text-sm font-black uppercase tracking-wider text-foreground">{t("dragDropEbookFiles")}</h2>
              <p className="text-[11px] text-muted-foreground font-semibold leading-relaxed">
                {t("supportedFormats")}: <span className="text-foreground font-bold">EPUB, CBZ, ZIP, PDF, JPG, PNG, WEBP, DOCX, TXT, HTML, FB2</span>
              </p>
              <p className="text-[10px] text-muted-foreground/70">
                {t("browseLocalFiles")}
              </p>
              <div className="pt-1.5" onClick={(e) => e.stopPropagation()}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setGoogleDriveMode('import');
                    setGoogleDriveOpen(true);
                  }}
                  className="h-7 px-3 text-xs font-semibold gap-2 border-border/80 bg-background/80 hover:bg-muted"
                >
                  <GoogleDriveIcon className="w-3.5 h-3.5" />
                  Import from Google Drive
                </Button>
              </div>
            </div>
          </div>

          {recentBooks.length > 0 && (
            <div className="space-y-3 pt-4 border-t w-full">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-primary" />
                  <h3 className="text-base sm:text-lg font-bold tracking-tight text-foreground">{t("recentlyRead")}</h3>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (window.confirm(t("confirmClearHistory") || "Are you sure you want to clear your reading history?")) {
                      localStorage.removeItem("ebookcc_recent_books_meta");
                      setRecentBooks([]);
                      try {
                        await clearAllHistory();
                      } catch (err) {
                        console.error("Error clearing history DB:", err);
                      }
                      toast.success(t("historyCleared") || "History cleared");
                    }
                  }}
                  className="text-xs text-muted-foreground hover:text-destructive h-7 px-2 cursor-pointer"
                >
                  {t("clearHistory")}
                </Button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 sm:gap-4 w-full items-end">
                {recentBooks.map((book) => (
                  <RecentBookCard
                    key={book.id}
                    book={book}
                    onOpen={handleOpenRecent}
                    onDelete={handleDeleteRecent}
                    t={t}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 bg-background flex flex-col overflow-hidden min-h-0">
          {!isFullscreen && (
            <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md shrink-0">
            <div className="relative w-full px-2 h-11 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 shrink-0 z-10">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                  className="w-8 h-8 shrink-0"
                  title={isSidebarOpen ? t("hideSidebar") : t("showSidebar")}
                >
                  {isSidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
                </Button>
                <div className="w-px h-5 bg-border mx-1 shrink-0" />
                <Button variant="ghost" size="sm" onClick={() => setSelectedBook(null)} className="h-8 gap-2 text-xs font-semibold px-3 shrink-0 hover:bg-transparent hover:text-foreground">
                  <ChevronLeft className="w-3.5 h-3.5" /> {t("back")}
                </Button>
              </div>

              {/* Centered Book Title on Toolbar - Hidden in Portrait screens */}
              <div className="absolute left-1/2 -translate-x-1/2 max-w-[28%] sm:max-w-[38%] md:max-w-[48%] lg:max-w-[58%] text-center pointer-events-none z-0 portrait:hidden portrait-hidden hidden landscape:block">
                <h2 className="text-sm font-bold text-foreground truncate pointer-events-auto select-none" title={selectedBook.title}>
                  {selectedBook.title}
                </h2>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 z-10">
                {selectedBook.fileType === 'epub' && (selectedBook.fileBuffer || selectedBook.file) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5 px-2.5"
                    onClick={handleRecoverEpubAsComic}
                    title="Read this EPUB as Comic (extract image pages)"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Comic View</span>
                  </Button>
                )}
                {selectedBook.fileType !== 'text' && selectedBook.fileType !== 'pdf' && selectedBook.fileType !== 'epub' && (
                   <>
                     <Button 
                       variant={cropBorders ? "default" : "outline"}
                       size="icon" 
                       className="h-8 w-8" 
                       onClick={() => setCropBorders(!cropBorders)}
                       title={t("cropPageBorders")}
                     >
                        <Crop className="w-3.5 h-3.5" />
                     </Button>
                     <Button 
                       variant={gridView ? "default" : "outline"}
                       size="icon" 
                       className="h-8 w-8" 
                       onClick={() => {
                         setGridView(!gridView);
                         setCurrentPanelIndex(0);
                       }}
                       title={t("splitPanels")}
                     >
                        <SplitPanelsIcon className="w-3.5 h-3.5" />
                     </Button>
                   </>
                )}
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 transition-colors hover:bg-accent"
                  onClick={() => {
                    const nextDir = readingDirection === 'rtl' ? 'ltr' : 'rtl';
                    setReadingDirection(nextDir);
                    setSelectedBook(prev => prev ? { ...prev, readingDirection: nextDir } : null);
                    toast.success(`Reading direction set to ${nextDir.toUpperCase()} (${nextDir === 'rtl' ? 'Right-to-Left / Manga' : 'Left-to-Right / Western'})`);
                  }}
                  title={`Reading direction: ${readingDirection.toUpperCase()} (${readingDirection === 'rtl' ? 'Right-to-Left / Manga' : 'Left-to-Right / Western'}). ${directionInfo ? `Source: ${directionInfo}. ` : ''}Click to switch.`}
                >
                  {readingDirection === 'rtl' ? (
                    <ArrowLeft className="w-3.5 h-3.5" />
                  ) : (
                    <ArrowRight className="w-3.5 h-3.5" />
                  )}
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setIsFullscreen(true)} title={t("fullscreen")}>
                   <Maximize className="w-3.5 h-3.5" />
                </Button>
                {isTextBook && (
                  <Button 
                    variant={settingsOpen ? "default" : "outline"} 
                    size="icon" 
                    className="h-8 w-8" 
                    onClick={() => setSettingsOpen(!settingsOpen)}
                    title={t("settings") || "Settings"}
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </Button>
                )}
                <Button 
                  variant={isNotesSidebarOpen ? "default" : "outline"} 
                  size="icon" 
                  className="h-8 w-8 relative" 
                  onClick={() => setIsNotesSidebarOpen(!isNotesSidebarOpen)}
                  title={checkIfBookshelf(selectedBook) ? "Notes & Discussion" : "Notes"}
                  id="reader-notes-toggle-btn"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  {notesCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[8px] font-bold rounded-full min-w-[14px] h-3.5 px-0.5 flex items-center justify-center pointer-events-none shadow-xs">
                      {notesCount > 99 ? '99+' : notesCount}
                    </span>
                  )}
                </Button>
              </div>
            </div>
          </header>
          )}

          <main className="flex-1 relative w-full overflow-hidden flex min-h-0 bg-background text-foreground">
            {/* Notes & Comments Floating Sidebar */}
            <ReaderNotesSidebar
              isOpen={isNotesSidebarOpen}
              onClose={() => {
                setIsNotesSidebarOpen(false);
                refreshNotesCount();
              }}
              bookId={selectedBook.id}
              bookTitle={selectedBook.title}
              isBookshelf={checkIfBookshelf(selectedBook)}
              currentPage={currentPage}
              totalPages={selectedBook.fileType === 'pdf' && pdfNumPages ? pdfNumPages : (selectedBook.pages?.length || 1)}
              onNavigateToPage={(pageNumber) => {
                clearLockedAnchor();
                const targetIdx = Math.max(0, pageNumber - 1);
                const maxP = (selectedBook.fileType === 'pdf' && pdfNumPages ? pdfNumPages : (selectedBook.pages?.length || 1)) - 1;
                setCurrentPage(Math.min(targetIdx, maxP));
                if (selectedBook.fileType === 'epub') {
                  setLocation(pageNumber);
                }
              }}
            />

            {/* Settings Overlay */}
            <AnimatePresence>
              {settingsOpen && isTextBook && (
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
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("fontSizeLabel")}</label>
                        <div className="flex bg-muted rounded-md overflow-hidden p-0.5 items-center justify-between">
                             <button onClick={() => updateFontSize(f => Math.max(8, f - 2))} className="px-3 py-1 flex-1 text-center font-bold hover:bg-background rounded text-muted-foreground cursor-pointer">-</button>
                             <input type="number" value={fontSize} onChange={(e) => updateFontSize(Number(e.target.value) || 18)} className="w-16 bg-transparent text-center focus:outline-none focus:ring-0 text-sm font-semibold text-foreground mx-1" />
                             <button onClick={() => updateFontSize(f => Math.min(100, f + 2))} className="px-3 py-1 flex-1 text-center font-bold hover:bg-background rounded text-muted-foreground cursor-pointer">+</button>
                        </div>
                     </div>
                     <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("alignmentLabel")}</label>
                        <div className="flex bg-muted rounded-md overflow-hidden p-0.5">
                           {[
                             {id: 'text-left', label: t("leftLabel")},
                             {id: 'text-center', label: t("centerLabel")},
                             {id: 'text-justify', label: t("justifyLabel")}
                           ].map(al => (
                             <button
                               key={al.id}
                               onClick={() => updateTextAlign(al.id)}
                               className={cn(
                                 "flex-1 py-1 text-sm font-semibold rounded shadow-sm hover:bg-background/50", textAlign === al.id ? "bg-background text-foreground" : "text-muted-foreground bg-transparent shadow-none")}
                             >
                               {al.label}
                             </button>
                           ))}
                        </div>
                     </div>
                     <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("fontLabel")}</label>
                        <div className="flex flex-col gap-1">
                           {[
                             {id: 'font-serif', label: t("serifLabel")},
                             {id: 'font-sans', label: t("sansSerifLabel")},
                             {id: 'font-mono', label: t("monospaceLabel")}
                           ].map(font => (
                             <button
                               key={font.id}
                               onClick={() => updateFontFamily(font.id)}
                               className={cn(
                                 "text-left px-3 py-1.5 text-sm font-semibold rounded hover:bg-muted/70", font.id, fontFamily === font.id ? "bg-muted text-foreground" : "text-muted-foreground bg-transparent")}
                             >
                               {font.label} abc
                             </button>
                           ))}
                        </div>
                     </div>
                     <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("themeLabel")}</label>
                        <div className="flex bg-muted rounded-md overflow-hidden p-0.5">
                           {[
                             { id: 'light', label: t("lightTheme") || "Light", icon: Sun },
                             { id: 'dark', label: t("darkTheme") || "Dark", icon: Moon },
                             { id: 'system', label: t("system") || "System", icon: Laptop },
                           ].map((th) => {
                             const Icon = th.icon;
                             const isActive = theme === th.id;
                             return (
                               <button
                                 key={th.id}
                                 type="button"
                                 onClick={() => setTheme(th.id)}
                                 className={cn(
                                   "flex-1 py-1.5 px-2 text-xs font-semibold rounded flex items-center justify-center gap-1.5 transition-all cursor-pointer",
                                   isActive
                                     ? "bg-background text-foreground shadow-xs"
                                     : "text-muted-foreground hover:text-foreground bg-transparent"
                                 )}
                               >
                                 <Icon className="w-3.5 h-3.5" />
                                 <span>{th.label}</span>
                               </button>
                             );
                           })}
                        </div>
                     </div>
                  </div>
                </motion.div>
                </>
              )}
            </AnimatePresence>

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
                    <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{t("pages")}</span>
                    <div className="flex items-center gap-1">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-5 w-5 rounded-none hover:bg-muted" 
                        onClick={() => {
                          clearLockedAnchor();
                          setCurrentPage(p => Math.max(0, p - 1));
                        }}
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
                            const maxPages = selectedBook.fileType === 'epub' ? Math.max(1, epubTotalPages) : selectedBook.fileType === 'text' ? textPages : (selectedBook.fileType === 'pdf' && pdfNumPages ? pdfNumPages : selectedBook.pages?.length || 1);
                            if (!isNaN(val) && val >= 1 && val <= maxPages) {
                              clearLockedAnchor();
                              setCurrentPage(val - 1);
                            }
                          }}
                          onBlur={() => setPageInputValue("")}
                          className="w-7 h-5 text-[10px] text-center bg-muted border-none p-0 focus-visible:ring-1 focus-visible:ring-primary rounded-none font-bold"
                        />
                        <span className="text-[9px] text-muted-foreground/60 font-mono">
                          / {selectedBook.fileType === 'epub' ? Math.max(1, epubTotalPages) : selectedBook.fileType === 'text' ? textPages : (selectedBook.fileType === 'pdf' && pdfNumPages ? pdfNumPages : selectedBook.pages?.length || 1)}
                        </span>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-5 w-5 rounded-none hover:bg-muted" 
                        onClick={() => {
                          clearLockedAnchor();
                          const maxPages = selectedBook.fileType === 'epub' ? Math.max(1, epubTotalPages) : selectedBook.fileType === 'text' ? textPages : (selectedBook.fileType === 'pdf' && pdfNumPages ? pdfNumPages : selectedBook.pages?.length || 1);
                          setCurrentPage(p => Math.min(maxPages - 1, p + 1));
                        }}
                        disabled={selectedBook.fileType === 'epub' ? (epubCurrentPage >= epubTotalPages) : (currentPage === ((selectedBook.fileType === 'text' ? textPages : selectedBook.fileType === 'pdf' && pdfNumPages ? pdfNumPages : selectedBook.pages?.length || 1) - 1))}
                      >
                        <ChevronRight className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto no-scrollbar p-2 space-y-2" id="thumbnail-container">
                    {selectedBook.fileType === 'pdf' ? (
                      <div className="space-y-2">
                        {Array.from({ length: pdfNumPages || 0 }).map((_, idx) => (
                          <div 
                            key={idx}
                            id={`thumb-${idx}`}
                            onClick={() => {
                              clearLockedAnchor();
                              setCurrentPage(idx);
                            }}
                            className={cn(
                              "relative aspect-[3/4] w-full rounded-none overflow-hidden cursor-pointer border transition-all bg-white flex items-center justify-center shadow-xs",
                              currentPage === idx 
                                ? "border-primary shadow-sm ring-1 ring-primary outline outline-1 outline-primary outline-offset-2" 
                                : "border-border/50 hover:border-foreground/60 opacity-85 hover:opacity-100 outline outline-1 outline-border/20"
                            )}
                          >
                            <div className="w-full h-full flex flex-col items-center justify-center bg-white p-2 text-center pointer-events-none">
                              <BookOpen className="w-5 h-5 text-muted-foreground/50 mb-1" />
                              <span className="text-[10px] font-bold text-foreground">
                                {t("page")} {idx + 1}
                              </span>
                            </div>
                            <div className="absolute bottom-1 left-1 bg-foreground text-background text-[7px] font-bold px-1 py-0.5 rounded-none min-w-[14px] text-center z-10">
                              {idx + 1}
                            </div>
                          </div>
                        ))}
                        {(!pdfNumPages || pdfNumPages === 0) && (
                          <div className="p-4 text-xs text-center text-muted-foreground">PDF Loading...</div>
                        )}
                      </div>
                   ) : selectedBook.fileType === 'epub' ? (
                        <div className="flex-1 overflow-y-auto no-scrollbar space-y-1">
                          <div className="text-sm font-bold text-muted-foreground px-2 py-2 mb-2 sticky top-0 bg-background/95 backdrop-blur z-10 border-b">
                            {t("tableOfContents") || "Table of Contents"}
                          </div>
                          {epubToc.map((item, idx) => (
                            <div 
                              key={idx}
                              onClick={() => {
                                clearLockedAnchor();
                                setLocation(item.href);
                              }}
                              className="text-xs px-2 py-1.5 hover:bg-muted cursor-pointer rounded-md truncate transition-colors text-foreground"
                            >
                              {item.label}
                            </div>
                          ))}
                          {epubToc.length === 0 && (
                            <div className="p-4 text-xs text-center text-muted-foreground">No Table of Contents</div>
                          )}
                        </div>
                      ) : selectedBook.fileType === 'text' ? (
                        <div className="flex-1 overflow-y-auto no-scrollbar space-y-1">
                          <div className="text-sm font-bold text-muted-foreground px-2 py-2 mb-2 sticky top-0 bg-background/95 backdrop-blur z-10 border-b">
                            {t("tableOfContents") || "Table of Contents"}
                          </div>
                          {textToc.map((item, idx) => (
                            <div 
                              key={idx}
                              onClick={() => {
                                clearLockedAnchor();
                                setCurrentPage(item.page);
                              }}
                              className="text-xs px-2 py-1.5 hover:bg-muted cursor-pointer rounded-md truncate transition-colors text-foreground"
                            >
                              {item.label}
                            </div>
                          ))}
                          {textToc.length === 0 && (
                            <div className="p-4 text-xs text-center text-muted-foreground">No Table of Contents</div>
                          )}
                        </div>
                      ) : (
                      selectedBook.pages.map((p, idx) => {
                        const isComicObj = typeof p === 'object' && p && (p.tree || p.panels);
                        const panels = extractAssetPanelsFromPage(p);
                        const thumbUrl = typeof p === 'string' 
                          ? p 
                          : (panels.length > 0 ? panels[0] : (p?.cover || p?.imageUrl || p?.image || p?.tree?.imageUrl || p?.tree?.drawing));

                        return (
                          <div 
                            key={idx}
                            id={`thumb-${idx}`}
                            onClick={() => {
                              clearLockedAnchor();
                              setCurrentPage(idx);
                            }}
                            className={cn(
                              "group relative aspect-[3/4] w-full rounded-none overflow-hidden cursor-pointer border transition-all bg-white flex items-center justify-center",
                              currentPage === idx 
                                ? "border-primary shadow-sm ring-1 ring-primary outline outline-1 outline-primary outline-offset-2" 
                                : "border-border/50 hover:border-foreground/60 opacity-85 hover:opacity-100 outline outline-1 outline-border/20"
                            )}
                          >
                            {isComicObj && p.tree ? (
                              <div className="absolute inset-0 bg-white flex items-center justify-center p-[2px] pointer-events-none overflow-hidden select-none">
                                <ComicTreeNodeView node={p.tree} />
                              </div>
                            ) : thumbUrl ? (
                              <img 
                                src={thumbUrl} 
                                className="w-full h-full object-cover bg-white pointer-events-none select-none" 
                                alt={`Thumb ${idx + 1}`}
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="text-[10px] font-medium text-muted-foreground p-1 text-center bg-white w-full h-full flex items-center justify-center">
                                {t("page")} {idx + 1}
                              </div>
                            )}
                            <div className="absolute bottom-1 left-1 bg-foreground text-background text-[7px] font-bold px-1 py-0.5 rounded-none min-w-[14px] text-center z-10 shadow-xs">
                              {idx + 1}
                            </div>
                            {panelsCache[idx] && (
                              <div className="absolute top-1 right-1 bg-primary text-primary-foreground p-0.5 shadow border border-background rounded flex items-center justify-center z-10" title={t("layoutDetectedInCache")}>
                                <SplitPanelsIcon className="w-2.5 h-2.5" />
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </motion.aside>
              )}
            </AnimatePresence>

            <div 
              ref={containerRef} 
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onDoubleClick={toggleFullscreenSafe}
              className="flex-1 overflow-hidden relative w-full h-full transition-colors duration-300 select-none flex items-center justify-center bg-background"
            >
              {/* Full-height click zones for previous / next page */}
              <div 
                className="absolute inset-y-0 left-0 w-1/4 sm:w-1/3 z-20 cursor-pointer" 
                onClick={handleLeftClick} 
                onDoubleClick={(e) => { e.stopPropagation(); toggleFullscreenSafe(); }} 
                title={readingDirection === 'rtl' ? t("nextPage") : t("previousPage")} 
              />
              <div 
                className="absolute inset-y-0 right-0 w-1/4 sm:w-1/3 z-20 cursor-pointer" 
                onClick={handleRightClick} 
                onDoubleClick={(e) => { e.stopPropagation(); toggleFullscreenSafe(); }} 
                title={readingDirection === 'rtl' ? t("previousPage") : t("nextPage")} 
              />

              {/* Page View Frame: locked 3:4 (h/w=4/3) for DOCX and PDF, full container for EPUB, TXT, HTML, Comics */}
              <div
                className="relative flex items-center justify-center max-w-full max-h-full p-0 m-0 transition-all duration-200"
                style={
                  isPagedDoc ? {
                    width: pageDimensions.width > 0 ? `${pageDimensions.width}px` : 'auto',
                    height: pageDimensions.height > 0 ? `${pageDimensions.height}px` : '100%',
                    aspectRatio: '3 / 4',
                  } : {
                    width: '100%',
                    height: '100%',
                  }
                }
              >
                <div className={cn(
                  "relative w-full h-full overflow-hidden flex items-center justify-center bg-transparent",
                  isPagedDoc && "shadow-2xl ring-1 ring-border/40"
                )}>
                  {selectedBook.fileType === 'epub' && (selectedBook.streamUrl || selectedBook.fileBuffer || selectedBook.file) ? (
                    <div className="absolute inset-0 z-0 bg-transparent reader-epub-container">
                      {isDownloadingEpub && (
                        <div className="absolute inset-0 z-30 bg-background/90 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center">
                          <Loader2 className="w-8 h-8 text-primary animate-spin mb-3" />
                          <p className="text-sm font-semibold text-foreground">Loading Book from Project Gutenberg...</p>
                          <p className="text-xs text-muted-foreground mt-1">Preparing chapters and reader</p>
                        </div>
                      )}
                      {epubDownloadError && (
                        <div className="absolute inset-0 z-30 bg-background flex flex-col items-center justify-center p-6 text-center">
                          <BookOpen className="w-10 h-10 text-destructive/70 mb-3" />
                          <p className="text-sm font-semibold text-foreground">Could not load EPUB Book</p>
                          <p className="text-xs text-muted-foreground mt-1 mb-4 max-w-xs">{epubDownloadError}</p>
                          <div className="flex items-center gap-2">
                            <Button 
                              size="sm" 
                              onClick={() => {
                                setSelectedBook(prev => prev ? { ...prev, fileBuffer: undefined } : null);
                              }}
                            >
                              Retry Loading
                            </Button>
                            {(selectedBook.fileBuffer || selectedBook.file) && (
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={handleRecoverEpubAsComic}
                              >
                                Open as Comic
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                      <EpubView
                        url={selectedBook.fileBuffer || selectedBook.streamUrl || (selectedBook.file as any)}
                        location={location}
                        locationChanged={(epubcition: string) => {
                          setLocation(epubcition);
                          if (renditionRef.current && renditionRef.current.location) {
                            setEpubCurrentPage(renditionRef.current.location.start.location);
                          }
                        }}
                        tocChanged={(toc: any) => setEpubToc(toc)}
                        epubViewStyles={{
                          viewHolder: {
                            position: 'relative',
                            height: '100%',
                            width: '100%',
                            backgroundColor: 'transparent'
                          },
                          view: {
                            height: '100%',
                            backgroundColor: 'transparent'
                          }
                        }}
                        epubOptions={{
                          flow: "paginated",
                          width: "100%",
                          height: "100%",
                          spread: "none",
                        }}
                        getRendition={(rendition: any) => {
                          renditionRef.current = rendition;
                          const isDark = (theme === 'dark') || 
                                         (theme === 'system' && (resolvedTheme === 'dark' || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches))) ||
                                         (!theme && resolvedTheme === 'dark');
                          const textColor = isDark ? '#f4f4f5' : '#18181b';
                          
                          rendition.themes.register('light', {
                            'html, body': { 'background': 'transparent !important', 'background-color': 'transparent !important' },
                            '*, body, p, span, div, h1, h2, h3, h4, h5, h6, a, li, blockquote, em, strong, b, i, small': { 'color': '#18181b !important' },
                            'img': { 'max-width': '100% !important', 'height': 'auto !important' }
                          });
                          rendition.themes.register('dark', {
                            'html, body': { 'background': 'transparent !important', 'background-color': 'transparent !important' },
                            '*, body, p, span, div, h1, h2, h3, h4, h5, h6, a, li, blockquote, em, strong, b, i, small': { 'color': '#f4f4f5 !important' },
                            'img': { 'max-width': '100% !important', 'height': 'auto !important' }
                          });
                          rendition.themes.select(isDark ? 'dark' : 'light');
                          rendition.themes.override('color', textColor, 'important');
                          rendition.themes.override('background', 'transparent', 'important');
                          rendition.themes.override('background-color', 'transparent', 'important');
                          rendition.themes.fontSize(`${fontSize}px`);

                          // Register content hook to inject theme and transparent background before first paint
                          rendition.hooks.content.register((contents: any) => {
                            if (applyEpubThemeStylesRef.current) {
                              applyEpubThemeStylesRef.current(contents);
                            } else {
                              applyEpubThemeStyles(contents);
                            }
                          });

                          // Register render hook to ensure iframe is transparent as soon as it is inserted
                          if (rendition.hooks.render) {
                            rendition.hooks.render.register((view: any) => {
                              if (view && view.iframe) {
                                view.iframe.style.setProperty('background', 'transparent', 'important');
                                view.iframe.style.setProperty('background-color', 'transparent', 'important');
                                view.iframe.setAttribute('allowtransparency', 'true');
                              }
                            });
                          }
                          
                          rendition.on('relocated', (location: any) => {
                            if (rendition.book.locations.length()) {
                              setEpubCurrentPage(location.start.location);
                              setEpubTotalPages(rendition.book.locations.length());
                            }
                          });

                          rendition.on('displayError', async (err: any) => {
                            console.warn('[Read] Epub display error, attempting fallback to comic:', err);
                            await handleRecoverEpubAsComic();
                          });
                          
                          rendition.book.ready.then(() => {
                            const width = containerSize.width || window.innerWidth;
                            const height = containerSize.height || window.innerHeight;
                            const chars = Math.max(100, Math.floor((width * height) / (fontSize * fontSize * 1.5)));
                            // Debounce or delay location generation to not block initial render
                            setTimeout(() => {
                              rendition.book.locations.generate(chars).then(() => {
                                setEpubTotalPages(rendition.book.locations.length());
                              }).catch(() => {});
                            }, 1000);
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
                    <div className="absolute inset-0 flex items-center justify-center p-0 bg-transparent">
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
                          className="w-full h-full flex items-center justify-center object-contain"
                          width={pageDimensions.width > 0 ? pageDimensions.width : undefined}
                          height={pageDimensions.height > 0 ? pageDimensions.height : undefined}
                        />
                      </Document>
                    </div>
                  ) : (selectedBook.fileType === 'text' || selectedBook.fileType === 'docx') && selectedBook.pages && selectedBook.pages.length > 0 ? (
                    (() => {
                      const pageWidth = pageDimensions.width || containerSize.width || 600;
                      const padding = pageWidth >= 500 ? 28 : 16;
                      const totalPadding = padding * 2;
                      const colWidth = Math.max(100, pageWidth - totalPadding);
                      const isHtml = selectedBook.title.toLowerCase().endsWith('.html') || selectedBook.title.toLowerCase().endsWith('.htm') || (selectedBook.pages[0] && /<[a-z][\s\S]*>/i.test(selectedBook.pages[0]));
                      
                      let displayContent = selectedBook.pages[0];
                      if (isHtml) {
                        const bodyMatch = displayContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                        if (bodyMatch) displayContent = bodyMatch[1];
                        displayContent = displayContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
                        displayContent = displayContent.replace(/<link[^>]*>/gi, "");
                        // Clean out hardcoded inline color/background styles that could conflict with light/dark theme
                        displayContent = displayContent.replace(/style="([^"]*)"/gi, (_, styleContent) => {
                          const cleaned = styleContent
                            .replace(/(?:^|;)\s*(?:color|background-color|background)\s*:[^;]*/gi, "")
                            .trim();
                          return cleaned ? `style="${cleaned}"` : "";
                        });
                      }

                      return (
                        <div 
                          className="absolute inset-0 overflow-hidden bg-transparent text-foreground select-text reader-text-container cursor-default"
                          onClick={(e) => {
                            // If user is selecting text, do not trigger page navigation
                            const sel = window.getSelection();
                            if (sel && sel.toString().trim().length > 0) return;
                            const target = e.target as HTMLElement;
                            if (target.closest('a, button, input, textarea')) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            const clickX = e.clientX - rect.left;
                            if (clickX > rect.width / 2) {
                              if (readingDirection === 'rtl') prevPage();
                              else nextPage();
                            } else {
                              if (readingDirection === 'rtl') nextPage();
                              else prevPage();
                            }
                          }}
                        >
                          <div 
                            className="w-full h-full"
                            style={{
                              transform: `translateX(-${currentPage * pageWidth}px)`,
                              transition: isReflowing ? 'none' : 'transform 0.3s ease'
                            }}
                          >
                            <div 
                              ref={textContentRef}
                              className={cn(
                                "reader-content-body",
                                isHtml && "prose prose-slate dark:prose-invert max-w-none [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:mt-2 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mb-3 [&_h2]:mt-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mb-2 [&_p]:mb-4 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:italic [&_hr]:border-border/40 [&_hr]:my-6 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
                                "h-full leading-relaxed break-words text-foreground [&_*]:text-foreground [&_img]:max-w-full [&_img]:max-h-[calc(100vh-12rem)] [&_img]:object-contain [&_img]:break-inside-avoid [&_p>img]:break-inside-avoid [&_figure]:break-inside-avoid",
                                !isHtml && "whitespace-pre-wrap",
                                fontFamily,
                                textAlign
                              )}
                              style={{
                                fontSize: `${fontSize}px`,
                                padding: `${padding}px`,
                                columnWidth: `${colWidth}px`,
                                columnGap: `${totalPadding}px`,
                                height: '100%',
                                color: 'var(--color-foreground)'
                              }}
                            >
                              {isHtml ? (
                                <div 
                                  className="reader-html-content"
                                  dangerouslySetInnerHTML={{ __html: displayContent }} 
                                />
                              ) : (
                                displayContent
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    (() => {
                      const rawPage = selectedBook.pages[currentPage];
                      const hasInteractiveCreatorTree = Boolean(
                        rawPage && typeof rawPage === 'object' && (rawPage.tree || (Array.isArray(rawPage.bubbles) && rawPage.bubbles.length > 0))
                      );

                      if (hasInteractiveCreatorTree && !gridView && !cropBorders) {
                        return (
                          <div className="relative w-full h-full flex items-center justify-center bg-transparent overflow-hidden">
                            <ComicPageRenderer 
                              key={`creator-page-${currentPage}`}
                              page={rawPage} 
                              className="w-full h-full" 
                            />
                          </div>
                        );
                      }

                      const rawUrl = getPageImageUrl(rawPage) || '';
                      const cachedUrl = imageBlobCache.get(rawUrl) || rawUrl;
                      const isSplitActive = Boolean(gridView && panelsCache[currentPage] && panelsCache[currentPage].length > 0);
                      const displaySrc = isSplitActive 
                        ? panelsCache[currentPage][currentPanelIndex] 
                        : (cropBorders && croppedCache[currentPage]) 
                        ? croppedCache[currentPage] 
                        : cachedUrl;

                      return (
                        <div className="relative w-full h-full flex items-center justify-center bg-transparent overflow-hidden">
                          {isSplitActive ? (
                            <div className="relative w-full h-full flex flex-col items-center justify-center p-0">
                              <img 
                                key={`reader-split-p-${currentPage}-${currentPanelIndex}`} 
                                src={displaySrc || undefined} 
                                alt={`Page ${currentPage + 1} - Panel ${currentPanelIndex + 1}`}
                                className="w-full h-full max-w-full max-h-full object-contain pointer-events-auto select-none bg-transparent transition-opacity duration-150" 
                                referrerPolicy="no-referrer"
                              />
                              {panelsCache[currentPage].length > 1 && (
                                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-background/90 backdrop-blur-md text-foreground border border-border px-3 py-1 rounded-full text-[11px] font-bold shadow-lg flex items-center gap-1.5 pointer-events-none z-20">
                                  <SplitPanelsIcon className="w-3 h-3 text-primary" />
                                  <span>{currentPanelIndex + 1} / {panelsCache[currentPage].length}</span>
                                  <span className="text-muted-foreground">•</span>
                                  <span className="text-muted-foreground">{t("page")} {selectedBook.fileType === 'epub' ? epubCurrentPage : currentPage + 1} / {selectedBook.fileType === 'epub' ? Math.max(1, epubTotalPages) : selectedBook.pages?.length || 1}</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <img 
                              key={`reader-main-p-${currentPage}`} 
                              src={displaySrc || undefined} 
                              alt={`Page ${currentPage + 1}`} 
                              className="w-full h-full max-w-full max-h-full object-contain pointer-events-auto select-none bg-transparent"
                              referrerPolicy="no-referrer"
                            />
                          )}
                          {(isProcessingPage && gridView && !panelsCache[currentPage]) && (
                            <div className="absolute inset-x-0 bottom-4 flex justify-center pointer-events-none z-30">
                              <div className="bg-background/90 text-foreground px-4 py-1.5 rounded-full text-xs shadow border animate-pulse backdrop-blur flex items-center gap-2">
                                <Sparkles className="w-3.5 h-3.5 text-primary" /> {t("detectingLayout")}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  )}
                </div>
              </div>
            </div>
          </main>
        </div>
      )}

      {/* Google Drive Dialog */}
      <GoogleDriveDialog
        open={googleDriveOpen}
        onOpenChange={setGoogleDriveOpen}
        initialMode={googleDriveMode}
        exportFile={exportPayload}
        onFileImported={loadFile}
      />
    </div>
  );
};
