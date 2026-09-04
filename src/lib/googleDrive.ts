/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut as fbSignOut
} from 'firebase/auth';
import { get, set, del, keys } from 'idb-keyval';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App instance safely (singleton)
const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
];

const provider = new GoogleAuthProvider();
DRIVE_SCOPES.forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({
  prompt: 'select_account',
});

// In-memory access token cache (MANDATORY: never store in localStorage or sessionStorage)
let cachedAccessToken: string | null = null;
let cachedUser: User | null = null;
let isSigningIn = false;

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  sizeBytes?: number;
  modifiedTime?: string;
  thumbnailLink?: string;
  iconLink?: string;
  webViewLink?: string;
  isFolder?: boolean;
}

export interface DriveProgress {
  loaded: number;
  total: number;
  percent: number;
  status: 'connecting' | 'downloading' | 'saving_idb' | 'preparing_upload' | 'uploading' | 'completed' | 'error';
  message?: string;
}

export interface CachedDriveFileMeta {
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
  cachedAt: number;
}

const IDB_DRIVE_CACHE_PREFIX = 'ebookcc_gdrive_cached_file_';
const IDB_DRIVE_META_KEY = 'ebookcc_gdrive_cached_files_meta';

/**
 * Initialize auth state listener.
 */
export const initGoogleDriveAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    cachedUser = user;
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        // Token must be acquired through signInWithPopup user interaction
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

/**
 * Sign in with Google using Firebase Auth popup to obtain an access token with Drive scopes.
 * Must be triggered by a direct user click.
 */
export const signInWithGoogleDrive = async (): Promise<{ user: User; accessToken: string }> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google did not return an access token for Drive access.');
    }
    cachedAccessToken = credential.accessToken;
    cachedUser = result.user;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    const isPopupBlocked = error?.code === 'auth/popup-blocked' || error?.message?.includes('popup-blocked');
    const isPopupClosed = error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request';
    if (isPopupBlocked) {
      console.warn('[GoogleDrive] Sign-in popup was blocked by the browser. Popups may need to be allowed or the app opened in a new tab.');
    } else if (isPopupClosed) {
      console.warn('[GoogleDrive] Sign-in popup was closed by user.');
    } else {
      console.error('[GoogleDrive] Sign in error:', error);
    }
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/**
 * Retrieve the active in-memory access token.
 */
export const getDriveAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

/**
 * Check if the user is currently authenticated with a valid in-memory token.
 */
export const isDriveAuthenticated = (): boolean => {
  return !!(cachedAccessToken && cachedUser);
};

/**
 * Retrieve current cached user.
 */
export const getCurrentDriveUser = (): User | null => {
  return cachedUser;
};

/**
 * Sign out and clear cached token.
 */
export const signOutGoogleDrive = async (): Promise<void> => {
  await fbSignOut(auth);
  cachedAccessToken = null;
  cachedUser = null;
};

/* ─────────────────────────────────────────────────────────────────────────────
 * DIRECT GOOGLE DRIVE API CALLS (Bypasses all Cloudflare Workers & Proxies)
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Formats bytes to human-readable string.
 */
export function formatFileSize(bytes?: number | string): string {
  if (bytes === undefined || bytes === null || bytes === '') return 'Unknown size';
  const num = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
  if (isNaN(num) || num <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(num) / Math.log(1024));
  return `${(num / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/**
 * List files and folders from Google Drive.
 * Communicates directly with https://www.googleapis.com/drive/v3/files
 */
export async function listDriveFiles(options?: {
  folderId?: string;
  searchQuery?: string;
  filterType?: 'all' | 'books' | 'comics' | 'epubs';
  pageToken?: string;
}): Promise<{ files: DriveFileItem[]; nextPageToken?: string }> {
  const token = await getDriveAccessToken();
  if (!token) {
    throw new Error('Please sign in to Google Drive first.');
  }

  const folderId = options?.folderId || 'root';
  const queryParts: string[] = ['trashed = false'];

  if (options?.searchQuery?.trim()) {
    const term = options.searchQuery.replace(/'/g, "\\'");
    queryParts.push(`name contains '${term}'`);
  } else {
    // If not searching globally, filter by parent folder
    queryParts.push(`'${folderId}' in parents`);
  }

  // Filter types for comic and ebook applications
  if (options?.filterType === 'books') {
    const bookConditions = [
      "mimeType = 'application/vnd.google-apps.folder'",
      "mimeType = 'application/epub+zip'",
      "mimeType = 'application/pdf'",
      "mimeType = 'application/zip'",
      "mimeType = 'application/x-cbz'",
      "mimeType = 'application/x-cbr'",
      "mimeType = 'text/plain'",
      "mimeType = 'text/html'",
      "mimeType = 'application/json'",
      "mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'",
      "mimeType = 'application/vnd.google-apps.document'",
      "name contains '.epub'",
      "name contains '.pdf'",
      "name contains '.cbz'",
      "name contains '.zip'",
      "name contains '.txt'",
      "name contains '.docx'",
      "name contains '.cbr'",
      "name contains '.azw3'",
      "name contains '.mobi'",
      "name contains '.json'",
      "name contains '.html'"
    ];
    queryParts.push(`(${bookConditions.join(' or ')})`);
  } else if (options?.filterType === 'comics') {
    const comicConditions = [
      "mimeType = 'application/vnd.google-apps.folder'",
      "mimeType = 'application/zip'",
      "mimeType = 'application/x-cbz'",
      "mimeType = 'application/x-cbr'",
      "mimeType = 'application/json'",
      "mimeType contains 'image/'",
      "name contains '.cbz'",
      "name contains '.zip'",
      "name contains '.cbr'",
      "name contains '.comic.json'",
      "name contains '.json'"
    ];
    queryParts.push(`(${comicConditions.join(' or ')})`);
  } else if (options?.filterType === 'epubs') {
    const epubConditions = [
      "mimeType = 'application/vnd.google-apps.folder'",
      "mimeType = 'application/epub+zip'",
      "name contains '.epub'"
    ];
    queryParts.push(`(${epubConditions.join(' or ')})`);
  }

  const q = queryParts.join(' and ');
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', q);
  url.searchParams.set('pageSize', '60');
  url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size,modifiedTime,thumbnailLink,iconLink,webViewLink)');
  url.searchParams.set('orderBy', 'folder,modifiedTime desc,name');
  if (options?.pageToken) {
    url.searchParams.set('pageToken', options.pageToken);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errJson = await response.json().catch(() => ({}));
    throw new Error(errJson.error?.message || `Google Drive error: ${response.statusText}`);
  }

  const data = await response.json();
  const files: DriveFileItem[] = (data.files || []).map((f: any) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: formatFileSize(f.size),
    sizeBytes: f.size ? parseInt(f.size, 10) : undefined,
    modifiedTime: f.modifiedTime,
    thumbnailLink: f.thumbnailLink,
    iconLink: f.iconLink,
    webViewLink: f.webViewLink,
    isFolder: f.mimeType === 'application/vnd.google-apps.folder',
  }));

  return { files, nextPageToken: data.nextPageToken };
}

/**
 * List folders only in Google Drive (useful for choosing export destination).
 */
export async function listDriveFolders(parentFolderId: string = 'root'): Promise<DriveFileItem[]> {
  const token = await getDriveAccessToken();
  if (!token) throw new Error('Please sign in to Google Drive first.');

  const q = `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&pageSize=100&orderBy=name`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) throw new Error('Failed to fetch Drive folders.');
  const data = await response.json();
  return (data.files || []).map((f: any) => ({
    id: f.id,
    name: f.name,
    mimeType: 'application/vnd.google-apps.folder',
    isFolder: true,
  }));
}

/**
 * Create a new folder in Google Drive.
 */
export async function createDriveFolder(folderName: string, parentFolderId: string = 'root'): Promise<DriveFileItem> {
  const token = await getDriveAccessToken();
  if (!token) throw new Error('Please sign in to Google Drive first.');

  const response = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Failed to create folder in Google Drive.');
  }

  const data = await response.json();
  return {
    id: data.id,
    name: data.name,
    mimeType: data.mimeType,
    isFolder: true,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * STREAMING DOWNLOAD & DIRECT-TO-INDEXEDDB CACHE
 * Completely bypasses Cloudflare Workers to save 100% of server bandwidth.
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Check if a file is already cached in local IndexedDB.
 */
export async function getCachedDriveFile(fileId: string): Promise<Blob | null> {
  try {
    const cachedBlob = await get<Blob>(`${IDB_DRIVE_CACHE_PREFIX}${fileId}`);
    return cachedBlob || null;
  } catch (err) {
    console.warn('[GoogleDrive] IDB cache lookup error:', err);
    return null;
  }
}

/**
 * Save downloaded file blob to IndexedDB to avoid re-downloading and reduce memory spikes.
 */
async function saveBlobToIndexedDB(fileId: string, blob: Blob, name: string, mimeType: string): Promise<void> {
  try {
    await set(`${IDB_DRIVE_CACHE_PREFIX}${fileId}`, blob);

    // Update metadata list
    const metas = (await get<CachedDriveFileMeta[]>(IDB_DRIVE_META_KEY)) || [];
    const filtered = metas.filter((m) => m.fileId !== fileId);
    filtered.unshift({
      fileId,
      name,
      size: blob.size,
      mimeType,
      cachedAt: Date.now(),
    });
    // Keep max 15 cached large files to prevent filling device storage indefinitely
    if (filtered.length > 15) {
      const removed = filtered.pop();
      if (removed) {
        await del(`${IDB_DRIVE_CACHE_PREFIX}${removed.fileId}`);
      }
    }
    await set(IDB_DRIVE_META_KEY, filtered);
  } catch (err) {
    console.warn('[GoogleDrive] Failed saving to IndexedDB cache:', err);
  }
}

/**
 * Download a file directly from Google Drive into a File object.
 *
 * Performance and bandwidth architecture:
 * 1. Checks IndexedDB cache first.
 * 2. Fetches DIRECTLY from Google's content CDN (`https://www.googleapis.com/drive/v3/files/{id}?alt=media`).
 * 3. Never routes through our Cloudflare Worker or backend server.
 * 4. Reads stream chunks via `ReadableStreamDefaultReader` to stream progress without V8 JSON/string buffer blow-up.
 * 5. Caches directly into IndexedDB as a Blob.
 */
export async function downloadDriveFile(
  fileItem: DriveFileItem,
  onProgress?: (progress: DriveProgress) => void
): Promise<File> {
  const token = await getDriveAccessToken();
  if (!token) throw new Error('Please sign in to Google Drive first.');

  onProgress?.({
    loaded: 0,
    total: fileItem.sizeBytes || 0,
    percent: 0,
    status: 'connecting',
    message: 'Checking local cache...',
  });

  // 1. Check local IndexedDB cache
  const cachedBlob = await getCachedDriveFile(fileItem.id);
  if (cachedBlob && cachedBlob.size > 0) {
    onProgress?.({
      loaded: cachedBlob.size,
      total: cachedBlob.size,
      percent: 100,
      status: 'completed',
      message: 'Loaded instantly from local IndexedDB cache!',
    });
    return new File([cachedBlob], fileItem.name, {
      type: fileItem.mimeType || cachedBlob.type || 'application/octet-stream',
    });
  }

  // 2. Determine download endpoint
  let downloadUrl: string;
  let expectedMime = fileItem.mimeType;

  if (fileItem.mimeType === 'application/vnd.google-apps.document') {
    // Export Google Docs as EPUB or PDF or DOCX
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileItem.id}/export?mimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document`;
    expectedMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  } else {
    // Standard direct binary media download
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileItem.id}?alt=media`;
  }

  onProgress?.({
    loaded: 0,
    total: fileItem.sizeBytes || 0,
    percent: 0,
    status: 'downloading',
    message: 'Initiating direct client stream from Google Drive...',
  });

  const response = await fetch(downloadUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: '*/*',
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Failed to download file from Google Drive (${response.status}): ${errorText || response.statusText}`);
  }

  // Determine total size
  const contentLengthHeader = response.headers.get('content-length');
  const totalBytes = contentLengthHeader
    ? parseInt(contentLengthHeader, 10)
    : fileItem.sizeBytes || 0;

  let downloadedBlob: Blob;

  // 3. Chunked Streaming Download (No Cloudflare Worker in path)
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        receivedBytes += value.byteLength;
        const percent = totalBytes > 0 ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : 50;
        onProgress?.({
          loaded: receivedBytes,
          total: totalBytes || receivedBytes,
          percent,
          status: 'downloading',
          message: `Downloading direct from Drive: ${formatFileSize(receivedBytes)} ${totalBytes > 0 ? `/ ${formatFileSize(totalBytes)}` : ''} (${percent}%)`,
        });
      }
    }

    downloadedBlob = new Blob(chunks as any[], { type: expectedMime || 'application/octet-stream' });
  } else {
    // Fallback blob streaming
    downloadedBlob = await response.blob();
  }

  // 4. Save to IndexedDB to avoid re-downloading and reduce RAM pressure
  onProgress?.({
    loaded: downloadedBlob.size,
    total: downloadedBlob.size,
    percent: 99,
    status: 'saving_idb',
    message: 'Saving book directly into local storage...',
  });

  await saveBlobToIndexedDB(fileItem.id, downloadedBlob, fileItem.name, expectedMime || downloadedBlob.type);

  onProgress?.({
    loaded: downloadedBlob.size,
    total: downloadedBlob.size,
    percent: 100,
    status: 'completed',
    message: 'Download ready!',
  });

  return new File([downloadedBlob], fileItem.name, {
    type: expectedMime || downloadedBlob.type || 'application/octet-stream',
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
 * RESUMABLE CLIENT-SIDE CHUNKED UPLOAD TO GOOGLE DRIVE (EXPORT)
 * Bypasses Cloudflare Worker completely. Uses Google Drive Resumable Upload API.
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Resumable chunked upload to Google Drive.
 * Slices the Blob into 1MB-2MB parts to avoid loading huge books into memory at once.
 */
export async function uploadBookToGoogleDrive(
  fileOrBlob: File | Blob,
  options: {
    fileName: string;
    mimeType?: string;
    folderId?: string;
    onProgress?: (progress: DriveProgress) => void;
  }
): Promise<DriveFileItem> {
  const token = await getDriveAccessToken();
  if (!token) throw new Error('Please sign in to Google Drive first.');

  const totalSize = fileOrBlob.size;
  const fileName = options.fileName;
  const mimeType = options.mimeType || fileOrBlob.type || 'application/octet-stream';
  const folderId = options.folderId;

  options.onProgress?.({
    loaded: 0,
    total: totalSize,
    percent: 0,
    status: 'preparing_upload',
    message: 'Initializing direct Google Drive resumable upload session...',
  });

  // Step 1: Initiate Resumable Upload Session
  const metadata: any = {
    name: fileName,
    mimeType,
  };
  if (folderId && folderId !== 'root') {
    metadata.parents = [folderId];
  }

  const sessionRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': totalSize.toString(),
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!sessionRes.ok) {
    const err = await sessionRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to initiate Drive upload: ${sessionRes.statusText}`);
  }

  const uploadUrl = sessionRes.headers.get('Location');
  if (!uploadUrl) {
    throw new Error('Google Drive did not provide a resumable upload Location URL.');
  }

  // Step 2: Stream in chunks (2MB chunks, multiple of 256KB as required by Drive)
  const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB
  let offset = 0;
  let resultData: any = null;

  while (offset < totalSize) {
    const end = Math.min(offset + CHUNK_SIZE, totalSize);
    const chunk = fileOrBlob.slice(offset, end);
    const chunkLength = end - offset;

    const percent = Math.round((offset / totalSize) * 100);
    options.onProgress?.({
      loaded: offset,
      total: totalSize,
      percent,
      status: 'uploading',
      message: `Uploading directly to Google Drive: ${formatFileSize(offset)} / ${formatFileSize(totalSize)} (${percent}%)`,
    });

    const uploadChunkRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Range': `bytes ${offset}-${end - 1}/${totalSize}`,
        'Content-Length': chunkLength.toString(),
      },
      body: chunk,
    });

    // 308 Resume Incomplete indicates chunk was received, keep sending
    if (uploadChunkRes.status === 308) {
      offset = end;
    } else if (uploadChunkRes.ok || uploadChunkRes.status === 200 || uploadChunkRes.status === 201) {
      resultData = await uploadChunkRes.json().catch(() => ({}));
      offset = totalSize;
      break;
    } else {
      const errText = await uploadChunkRes.text().catch(() => '');
      throw new Error(`Upload chunk failed (${uploadChunkRes.status}): ${errText || uploadChunkRes.statusText}`);
    }
  }

  options.onProgress?.({
    loaded: totalSize,
    total: totalSize,
    percent: 100,
    status: 'completed',
    message: 'Uploaded successfully to Google Drive!',
  });

  return {
    id: resultData?.id || '',
    name: resultData?.name || fileName,
    mimeType: resultData?.mimeType || mimeType,
    webViewLink: resultData?.id ? `https://drive.google.com/file/d/${resultData.id}/view` : undefined,
  };
}

/**
 * Get all cached files in IndexedDB.
 */
export async function getCachedDriveFilesMeta(): Promise<CachedDriveFileMeta[]> {
  try {
    const metas = await get<CachedDriveFileMeta[]>(IDB_DRIVE_META_KEY);
    return metas || [];
  } catch (err) {
    return [];
  }
}

/**
 * Remove a single cached file from IndexedDB.
 */
export async function removeCachedDriveFile(fileId: string): Promise<void> {
  await del(`${IDB_DRIVE_CACHE_PREFIX}${fileId}`);
  const metas = (await get<CachedDriveFileMeta[]>(IDB_DRIVE_META_KEY)) || [];
  const filtered = metas.filter((m) => m.fileId !== fileId);
  await set(IDB_DRIVE_META_KEY, filtered);
}

/**
 * Clear all cached Google Drive files from IndexedDB.
 */
export async function clearAllDriveCache(): Promise<void> {
  const allKeys = await keys();
  for (const k of allKeys) {
    if (typeof k === 'string' && k.startsWith(IDB_DRIVE_CACHE_PREFIX)) {
      await del(k);
    }
  }
  await del(IDB_DRIVE_META_KEY);
}
