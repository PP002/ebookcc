/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Simple IndexedDB wrapper for durable full-stack file and project caching
const DB_NAME = "ebookcc_history_db";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("Failed to open history database");
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      
      // Store 1: Read Books (including files / array buffers)
      if (!db.objectStoreNames.contains("read_books")) {
        db.createObjectStore("read_books", { keyPath: "id" });
      }

      // Store 2: Unfinished Comics (trees, page list, bubbles, thumbnail)
      if (!db.objectStoreNames.contains("comics")) {
        db.createObjectStore("comics", { keyPath: "id" });
      }

      // Store 3: Unfinished Stories (html text/chapters)
      if (!db.objectStoreNames.contains("stories")) {
        db.createObjectStore("stories", { keyPath: "id" });
      }

      // Store 4: Conversion Logs
      if (!db.objectStoreNames.contains("conversions")) {
        db.createObjectStore("conversions", { keyPath: "id" });
      }
    };
  });

  return dbPromise;
}

// Helper to perform simple transaction
async function executeTransaction(
  storeName: string,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest | void
): Promise<any> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const request = callback(store);

      if (request) {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } else {
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => reject(transaction.error);
      }
    });
  } catch (error) {
    console.error(`Database transaction failed on ${storeName}:`, error);
    return null;
  }
}

// Types for history
export interface RecentBookMetadata {
  id: string;
  title: string;
  author: string;
  cover: string; // Base64 or placeholder URL
  fileType: 'images' | 'epub' | 'pdf' | 'text' | 'comic' | 'docx';
  lastReadPage: number;
  lastReadLocation?: string | number;
  timestamp: number;
  hasFile?: boolean;
}

export interface UnfinishedComic {
  id: string;
  title: string;
  pages: any[]; // ComicPage array
  activePageIndex: number;
  thumbnail?: string; // Small preview image
  timestamp: number;
}

export interface UnfinishedStory {
  id: string;
  title: string;
  htmlContent: string;
  timestamp: number;
}

export interface ConversionLog {
  id: string;
  sourceFileName: string;
  targetFormat: string;
  status: 'completed' | 'failed' | 'processing';
  timestamp: number;
  size?: string;
  downloadUrl?: string; // ObjectURL or base64
  error?: string;
}

/* ==========================================================================
   READ BOOK CACHE
   ========================================================================== */

/**
 * Downscales and compresses a source image URL, blob URL, or data URL into a tiny,
 * compact JPEG thumbnail (max 120x160, quality 0.6) suitable for localStorage storage.
 * Keeps remote URLs (http/https//) as-is since their string length is minimal.
 */
async function compressCoverToThumbnail(source: string, maxW = 120, maxH = 160, quality = 0.6): Promise<string> {
  if (!source || typeof source !== 'string') return '';
  // Remote URLs or root-relative paths are already tiny strings (< 200 chars)
  if (source.startsWith('http://') || source.startsWith('https://') || source.startsWith('/')) {
    return source;
  }

  return new Promise<string>((resolve) => {
    const img = new Image();
    const timeout = setTimeout(() => {
      resolve(source.length < 5000 ? source : '');
    }, 2000);

    img.onload = () => {
      clearTimeout(timeout);
      try {
        const { width, height } = img;
        if (!width || !height) {
          resolve(source.length < 5000 ? source : '');
          return;
        }

        const ratio = Math.min(maxW / width, maxH / height, 1);
        const targetW = Math.max(1, Math.round(width * ratio));
        const targetH = Math.max(1, Math.round(height * ratio));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(source.length < 5000 ? source : '');
          return;
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);

        const compressed = canvas.toDataURL('image/jpeg', quality);
        if (compressed.length > 20000) {
          // If still over 20KB, return empty string so we don't blow quota
          resolve('');
        } else {
          resolve(compressed);
        }
      } catch (err) {
        console.warn('[historyCache] Failed compressing cover canvas:', err);
        resolve(source.length < 5000 ? source : '');
      }
    };

    img.onerror = () => {
      clearTimeout(timeout);
      resolve(source.length < 5000 ? source : '');
    };

    img.src = source;
  });
}

/**
 * Safely persists RecentBookMetadata to localStorage with progressive quota mitigation.
 * Never throws QuotaExceededError - aggressively strips heavy data covers if quota is tight.
 */
function safeSaveRecentBooksMeta(list: RecentBookMetadata[]): void {
  if (!Array.isArray(list)) return;

  // Enforce small bounds on all covers before first attempt
  const sanitized = list.slice(0, 20).map((item) => {
    if (item.cover && item.cover.length > 20000) {
      return { ...item, cover: '' };
    }
    return item;
  });

  // Attempt 1: Full sanitized list
  try {
    localStorage.setItem("ebookcc_recent_books_meta", JSON.stringify(sanitized));
    return;
  } catch (err1) {
    console.warn("[historyCache] localStorage save hit quota, applying tiered reduction...", err1);
  }

  // Attempt 2: Strip data: covers from items beyond top 4
  try {
    const tiered = sanitized.slice(0, 15).map((item, idx) => {
      if (idx >= 4 && item.cover && item.cover.startsWith('data:')) {
        return { ...item, cover: '' };
      }
      return item;
    });
    localStorage.setItem("ebookcc_recent_books_meta", JSON.stringify(tiered));
    return;
  } catch (err2) {
    console.warn("[historyCache] Tier 2 save failed, removing all base64 covers...", err2);
  }

  // Attempt 3: Remove all base64 data: covers completely, retain only URLs and essential metadata
  try {
    const urlsOnly = sanitized.slice(0, 10).map((item) => ({
      ...item,
      cover: item.cover && (item.cover.startsWith('http') || item.cover.startsWith('/')) ? item.cover : ''
    }));
    localStorage.setItem("ebookcc_recent_books_meta", JSON.stringify(urlsOnly));
    return;
  } catch (err3) {
    console.warn("[historyCache] Tier 3 save failed, storing minimal top 5 items...", err3);
  }

  // Attempt 4: Minimal top 5 records with minimal attributes
  try {
    const minimal = sanitized.slice(0, 5).map((item) => ({
      id: item.id,
      title: item.title,
      author: item.author,
      cover: '',
      fileType: item.fileType,
      lastReadPage: item.lastReadPage,
      timestamp: item.timestamp,
      hasFile: item.hasFile
    }));
    localStorage.setItem("ebookcc_recent_books_meta", JSON.stringify(minimal));
  } catch (fatalErr) {
    console.error("[historyCache] Failed to save recent books metadata to localStorage:", fatalErr);
  }
}

async function resolveThumbnailCover(cover?: string, pages?: any[]): Promise<string> {
  let candidate = cover;
  if (!candidate || typeof candidate !== 'string' || (!candidate.startsWith('data:') && !candidate.startsWith('http') && !candidate.startsWith('blob:') && !candidate.startsWith('/'))) {
    if (pages && pages.length > 0) {
      const first = pages[0];
      if (typeof first === 'string' && (first.startsWith('data:') || first.startsWith('http') || first.startsWith('blob:') || first.startsWith('/'))) {
        candidate = first;
      } else if (first && typeof first === 'object') {
        const directImg = first.cover || first.imageUrl || first.image || first.url;
        if (directImg && typeof directImg === 'string') {
          candidate = directImg;
        } else if (first.tree) {
          const findImageInTree = (node: any): string | null => {
            if (!node) return null;
            if (node.type === 'panel') {
              if (node.imageUrl) return node.imageUrl;
              if (node.drawing) return node.drawing;
              if (node.bgImageUrl) return node.bgImageUrl;
              if (Array.isArray(node.drawings) && node.drawings.length > 0) {
                const imgStroke = node.drawings.find((d: any) => d && d.imageUrl);
                if (imgStroke) return imgStroke.imageUrl;
              }
            } else if (node.type === 'split') {
              return findImageInTree(node.c1 || node.left) || findImageInTree(node.c2 || node.right);
            }
            return null;
          };
          const found = findImageInTree(first.tree);
          if (found) candidate = found;
        }
      }
    }
  }

  if (candidate && (candidate.startsWith('blob:') || candidate.startsWith('data:'))) {
    const compressed = await compressCoverToThumbnail(candidate);
    if (compressed) return compressed;
  }

  if (candidate && (candidate.startsWith('http://') || candidate.startsWith('https://') || candidate.startsWith('/'))) {
    return candidate;
  }

  return 'https://placehold.co/120x160/png?text=eBook';
}

export async function saveRecentBook(
  book: {
    id: string;
    title: string;
    author: string;
    cover: string;
    fileType: 'images' | 'epub' | 'pdf' | 'text' | 'comic' | 'docx';
    pages: any[];
    file?: File;
    fileBuffer?: ArrayBuffer;
    readingDirection?: 'ltr' | 'rtl';
    readingDirectionInfo?: string;
  },
  lastReadPage: number,
  lastReadLocation?: string | number
): Promise<void> {
  const resolvedCover = await resolveThumbnailCover(book.cover, book.pages);

  const normalizedTitle = (book.title || '').trim().toLowerCase();

  const metadata: RecentBookMetadata = {
    id: book.id,
    title: book.title,
    author: book.author || 'Local File',
    cover: resolvedCover,
    fileType: book.fileType,
    lastReadPage,
    lastReadLocation,
    timestamp: Date.now(),
    hasFile: !!(book.file || book.fileBuffer || (book.pages && book.pages.length > 1))
  };

  // 1. Save metadata to list in localStorage, strictly deduplicating by title and id
  try {
    const list = getRecentBooksMeta().filter((item) => {
      if (!item) return false;
      if (item.id === book.id) return false;
      if (normalizedTitle && item.title && item.title.trim().toLowerCase() === normalizedTitle) return false;
      return true;
    });
    list.unshift(metadata);
    safeSaveRecentBooksMeta(list);
  } catch (e) {
    console.error("localStorage save failed", e);
  }

  // 2. Save full payload (including File or ArrayBuffer blobs) to IndexedDB
  await executeTransaction("read_books", "readwrite", (store) => {
    return store.put({
      id: book.id,
      title: book.title,
      author: book.author,
      cover: resolvedCover,
      fileType: book.fileType,
      pages: Array.isArray(book.pages)
        ? book.pages.filter(p => typeof p === 'string' ? !p.startsWith('blob:') : true)
        : [],
      file: book.file,
      fileBuffer: book.fileBuffer,
      readingDirection: book.readingDirection,
      readingDirectionInfo: book.readingDirectionInfo,
      lastReadPage,
      lastReadLocation,
      timestamp: Date.now()
    });
  });
}

export function getRecentBooksMeta(): RecentBookMetadata[] {
  try {
    const listJson = localStorage.getItem("ebookcc_recent_books_meta") || "[]";
    const list: RecentBookMetadata[] = JSON.parse(listJson);
    if (!Array.isArray(list)) return [];

    let hasOversizedCover = false;
    const sanitized = list.map((item) => {
      if (item && item.cover && item.cover.length > 20000) {
        hasOversizedCover = true;
        return { ...item, cover: '' };
      }
      return item;
    });

    // Deduplicate list by normalized title / id so duplicates are never displayed
    const seenKeys = new Set<string>();
    const deduplicated: RecentBookMetadata[] = [];
    let hadDuplicates = false;

    for (const item of sanitized) {
      if (!item) continue;
      const key = (item.title || item.id || '').trim().toLowerCase();
      if (!key || seenKeys.has(key)) {
        hadDuplicates = true;
        continue;
      }
      seenKeys.add(key);
      deduplicated.push(item);
    }

    // If any legacy item had an oversized cover or duplicates, persist cleaned list
    if (hasOversizedCover || hadDuplicates) {
      safeSaveRecentBooksMeta(deduplicated);
    }

    return deduplicated;
  } catch (e) {
    return [];
  }
}

export async function getFullBookFile(id: string): Promise<any | null> {
  return await executeTransaction("read_books", "readonly", (store) => {
    return store.get(id);
  });
}

export async function deleteRecentBook(id: string): Promise<void> {
  // Delete meta
  try {
    const list = getRecentBooksMeta().filter((item) => item.id !== id);
    safeSaveRecentBooksMeta(list);
  } catch (e) {}

  // Delete from DB
  await executeTransaction("read_books", "readwrite", (store) => {
    return store.delete(id);
  });
}


/* ==========================================================================
   COMICS CACHE
   ========================================================================== */

export async function saveUnfinishedComic(comic: {
  id: string;
  title: string;
  pages: any[];
  activePageIndex: number;
  thumbnail?: string;
}): Promise<void> {
  const payload: UnfinishedComic = {
    id: comic.id,
    title: comic.title || "Untitled Comic",
    pages: comic.pages,
    activePageIndex: comic.activePageIndex,
    thumbnail: comic.thumbnail,
    timestamp: Date.now()
  };

  await executeTransaction("comics", "readwrite", (store) => {
    return store.put(payload);
  });
}

export async function getUnfinishedComics(): Promise<UnfinishedComic[]> {
  const list: UnfinishedComic[] = await executeTransaction("comics", "readonly", (store) => {
    return store.getAll();
  }) || [];
  return list.sort((a, b) => b.timestamp - a.timestamp);
}

export async function deleteUnfinishedComic(id: string): Promise<void> {
  await executeTransaction("comics", "readwrite", (store) => {
    return store.delete(id);
  });
}

export async function removeUnfinishedComicDraft(idOrTitle: string): Promise<void> {
  if (!idOrTitle) return;
  const target = idOrTitle.trim().toLowerCase();
  const list = await getUnfinishedComics();
  for (const item of list) {
    if (item.id === idOrTitle || (item.title && item.title.trim().toLowerCase() === target)) {
      await deleteUnfinishedComic(item.id);
    }
  }
}


/* ==========================================================================
   STORIES CACHE
   ========================================================================== */

export async function saveUnfinishedStory(story: {
  id: string;
  title: string;
  htmlContent: string;
}): Promise<void> {
  const payload: UnfinishedStory = {
    id: story.id,
    title: story.title || "Untitled Story",
    htmlContent: story.htmlContent,
    timestamp: Date.now()
  };

  await executeTransaction("stories", "readwrite", (store) => {
    return store.put(payload);
  });
}

export async function getUnfinishedStories(): Promise<UnfinishedStory[]> {
  const list: UnfinishedStory[] = await executeTransaction("stories", "readonly", (store) => {
    return store.getAll();
  }) || [];
  return list.sort((a, b) => b.timestamp - a.timestamp);
}

export async function deleteUnfinishedStory(id: string): Promise<void> {
  await executeTransaction("stories", "readwrite", (store) => {
    return store.delete(id);
  });
}

export async function removeUnfinishedStoryDraft(idOrTitle: string): Promise<void> {
  if (!idOrTitle) return;
  const target = idOrTitle.trim().toLowerCase();
  const list = await getUnfinishedStories();
  for (const item of list) {
    if (item.id === idOrTitle || (item.title && item.title.trim().toLowerCase() === target)) {
      await deleteUnfinishedStory(item.id);
    }
  }
}


/* ==========================================================================
   CONVERSIONS HISTORY
   ========================================================================== */

export async function addConversionHistory(conv: {
  id: string;
  sourceFileName: string;
  targetFormat: string;
  status: 'completed' | 'failed' | 'processing';
  size?: string;
  downloadUrl?: string;
  error?: string;
}): Promise<void> {
  const payload: ConversionLog = {
    ...conv,
    timestamp: Date.now()
  };

  await executeTransaction("conversions", "readwrite", (store) => {
    return store.put(payload);
  });
}

export async function getConversionHistory(): Promise<ConversionLog[]> {
  const list: ConversionLog[] = await executeTransaction("conversions", "readonly", (store) => {
    return store.getAll();
  }) || [];
  return list.sort((a, b) => b.timestamp - a.timestamp);
}

export async function deleteConversionLog(id: string): Promise<void> {
  await executeTransaction("conversions", "readwrite", (store) => {
    return store.delete(id);
  });
}


/* ==========================================================================
   GLOBAL RESET
   ========================================================================== */

export async function clearAllHistory(): Promise<void> {
  try {
    localStorage.removeItem("ebookcc_recent_books_meta");
  } catch (e) {
    console.error("Failed to remove localStorage history:", e);
  }

  try {
    const db = await getDB();
    if (!db) return;

    const existingStores = Array.from(db.objectStoreNames);
    const storesToClear = ["read_books", "comics", "stories", "conversions"].filter((s) =>
      existingStores.includes(s)
    );

    if (storesToClear.length === 0) return;

    return new Promise<void>((resolve) => {
      try {
        const transaction = db.transaction(storesToClear, "readwrite");
        storesToClear.forEach((storeName) => {
          try {
            transaction.objectStore(storeName).clear();
          } catch (err) {
            console.error(`Error clearing store ${storeName}:`, err);
          }
        });

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();

        setTimeout(() => resolve(), 1000);
      } catch (err) {
        console.error("Error executing clearAllHistory transaction:", err);
        resolve();
      }
    });
  } catch (e) {
    console.error("Failed to clear database stores:", e);
  }
}
