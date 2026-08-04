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
  fileType: 'images' | 'epub' | 'pdf' | 'text' | 'comic';
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

export async function saveRecentBook(
  book: {
    id: string;
    title: string;
    author: string;
    cover: string;
    fileType: 'images' | 'epub' | 'pdf' | 'text' | 'comic';
    pages: any[];
    file?: File;
    fileBuffer?: ArrayBuffer;
  },
  lastReadPage: number,
  lastReadLocation?: string | number
): Promise<void> {
  const metadata: RecentBookMetadata = {
    id: book.id,
    title: book.title,
    author: book.author || 'Local File',
    cover: book.cover && typeof book.cover === 'string' && (book.cover.startsWith('data:') || book.cover.startsWith('http')) ? book.cover : (book.cover || 'https://placehold.co/150x220/png?text=eBook'),
    fileType: book.fileType,
    lastReadPage,
    lastReadLocation,
    timestamp: Date.now(),
    hasFile: !!(book.file || book.fileBuffer || (book.pages && book.pages.length > 1))
  };

  // 1. Save metadata to list in localStorage for instant access
  try {
    const listJson = localStorage.getItem("ebookcc_recent_books_meta") || "[]";
    let list: RecentBookMetadata[] = JSON.parse(listJson);
    list = list.filter((item) => item.id !== book.id);
    list.unshift(metadata);
    // Limit to 20 items
    if (list.length > 20) list.pop();
    localStorage.setItem("ebookcc_recent_books_meta", JSON.stringify(list));
  } catch (e) {
    console.error("localStorage save failed", e);
  }

  // 2. Save full payload (including File or ArrayBuffer blobs) to IndexedDB
  await executeTransaction("read_books", "readwrite", (store) => {
    return store.put({
      id: book.id,
      title: book.title,
      author: book.author,
      cover: book.cover,
      fileType: book.fileType,
      pages: Array.isArray(book.pages)
        ? book.pages.filter(p => typeof p === 'string' ? !p.startsWith('blob:') : true)
        : [],
      file: book.file,
      fileBuffer: book.fileBuffer,
      lastReadPage,
      lastReadLocation,
      timestamp: Date.now()
    });
  });
}

export function getRecentBooksMeta(): RecentBookMetadata[] {
  try {
    const listJson = localStorage.getItem("ebookcc_recent_books_meta") || "[]";
    return JSON.parse(listJson);
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
    const listJson = localStorage.getItem("ebookcc_recent_books_meta") || "[]";
    let list: RecentBookMetadata[] = JSON.parse(listJson);
    list = list.filter((item) => item.id !== id);
    localStorage.setItem("ebookcc_recent_books_meta", JSON.stringify(list));
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
  localStorage.removeItem("ebookcc_recent_books_meta");
  
  try {
    const db = await getDB();
    const transaction = db.transaction(["read_books", "comics", "stories", "conversions"], "readwrite");
    transaction.objectStore("read_books").clear();
    transaction.objectStore("comics").clear();
    transaction.objectStore("stories").clear();
    transaction.objectStore("conversions").clear();
    
    return new Promise((resolve) => {
      transaction.oncomplete = () => resolve();
    });
  } catch (e) {
    console.error("Failed to clear database stores:", e);
  }
}
