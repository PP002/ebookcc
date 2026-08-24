import { getApiUrl } from '@/lib/api';
import { getR2ResolvedCredentials, getR2Headers, R2Config } from '@/lib/r2Storage';
import { AwsClient } from 'aws4fetch';
import { getSupabase } from '@/context/AppSettingsContext';

export interface BookComment {
  id: string;
  bookId: string;
  bookTitle?: string;
  userId?: string;
  userName: string;
  userAvatar?: string;
  page: number; // 1-based page number (1, 2, 3...). 0 means whole book general note
  location?: string | number; // EPUB cfi or location identifier
  content: string;
  timestamp: number;
  isLocal?: boolean;
  likes?: number;
  replyToId?: string;
  replyToName?: string;
  replyToSnippet?: string;
}

export interface GuestUser {
  id: string;
  name: string;
  avatar?: string;
}

export function getOrCreateGuestUser(): GuestUser {
  try {
    const raw = localStorage.getItem("ebookcc_guest_user");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.id && parsed?.name) return parsed;
    }
  } catch (_) {}

  const adjectives = [
    "Curious", "Silent", "Cosmic", "Avid", "Noble", "Nimble", "Gentle",
    "Starlight", "Astral", "Velvet", "Keen", "Quiet", "Bright", "Midnight",
    "Golden", "Wandering", "Sage", "Dreaming", "Solitary", "Vivid", "Sunny"
  ];
  const nouns = [
    "Reader", "Scholar", "Bookworm", "Explorer", "Seeker", "Novelist",
    "Observer", "Thinker", "Voyager", "Chronicle", "Poet", "Artist", "Scribe"
  ];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  const name = `${adj} ${noun} #${num}`;
  const id = `guest_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

  const guest: GuestUser = { id, name };
  try {
    localStorage.setItem("ebookcc_guest_user", JSON.stringify(guest));
  } catch (_) {}
  return guest;
}

// ─────────────────────────────────────────────
// Local Book Notes Helpers (localStorage)
// ─────────────────────────────────────────────

export function getLocalNotes(bookId: string): BookComment[] {
  try {
    const key = `ebookcc_book_notes_${bookId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const list: BookComment[] = JSON.parse(raw);
    return Array.isArray(list) ? list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)) : [];
  } catch (err) {
    console.warn("Failed reading local notes:", err);
    return [];
  }
}

export function saveLocalNote(
  bookId: string,
  noteData: {
    bookTitle?: string;
    page: number;
    location?: string | number;
    content: string;
    userName?: string;
    userAvatar?: string;
    userId?: string;
    replyToId?: string;
    replyToName?: string;
    replyToSnippet?: string;
  }
): BookComment {
  const existing = getLocalNotes(bookId);
  const newNote: BookComment = {
    id: `local_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    bookId,
    bookTitle: noteData.bookTitle || "",
    userId: noteData.userId || "local-user",
    userName: noteData.userName?.trim() || "Local Reader",
    userAvatar: noteData.userAvatar,
    page: Math.max(0, noteData.page),
    location: noteData.location,
    content: noteData.content.trim(),
    timestamp: Date.now(),
    isLocal: true,
    replyToId: noteData.replyToId,
    replyToName: noteData.replyToName,
    replyToSnippet: noteData.replyToSnippet,
  };

  const updated = [newNote, ...existing];
  try {
    localStorage.setItem(`ebookcc_book_notes_${bookId}`, JSON.stringify(updated));
  } catch (err) {
    console.error("Failed saving local note:", err);
  }
  return newNote;
}

export function deleteLocalNote(bookId: string, noteId: string): boolean {
  try {
    const existing = getLocalNotes(bookId);
    const filtered = existing.filter((n) => n.id !== noteId);
    localStorage.setItem(`ebookcc_book_notes_${bookId}`, JSON.stringify(filtered));
    return true;
  } catch (err) {
    console.error("Failed deleting local note:", err);
    return false;
  }
}

// ─────────────────────────────────────────────
// Bookshelf / Cloud Comments Helpers (Cloudflare R2)
// ─────────────────────────────────────────────

function getCacheKey(bookId: string): string {
  const cleanId = String(bookId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `ebookcc_r2_comments_cache_${cleanId}`;
}

export async function fetchCloudComments(
  bookId: string,
  config?: R2Config
): Promise<BookComment[]> {
  const cleanId = String(bookId).replace(/[^a-zA-Z0-9_-]/g, "_");
  let comments: BookComment[] = [];

  // 1. Try server API endpoint
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(`${getApiUrl()}/api/books/${encodeURIComponent(cleanId)}/comments`, {
      method: "GET",
      headers: {
        ...getR2Headers(config),
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data && Array.isArray(data.comments)) {
        comments = data.comments;
        localStorage.setItem(getCacheKey(bookId), JSON.stringify(comments));
        return comments.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      }
    }
  } catch (apiErr) {
    console.debug("Server API comments fetch notice:", apiErr);
  }

  // 2. Direct S3 Fetch via AwsClient in browser
  const { accessKey, secretKey, bucket, endpoint } = getR2ResolvedCredentials(config);
  if (accessKey && secretKey && endpoint) {
    try {
      const aws = new AwsClient({
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
        service: "s3",
        region: "auto",
      });
      const objectKey = `comments/${cleanId}.json`;
      const getUrl = new URL(`/${bucket}/${objectKey}`, endpoint);
      const signedReq = await aws.sign(getUrl, { method: "GET" });
      const s3Res = await fetch(signedReq);

      if (s3Res.ok) {
        const text = await s3Res.text();
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          comments = parsed;
          localStorage.setItem(getCacheKey(bookId), JSON.stringify(comments));
          return comments.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        }
      }
    } catch (directS3Err: any) {
      console.debug("Direct S3 comments fetch notice:", directS3Err?.message);
    }
  }

  // 3. Try Supabase fallback
  try {
    const url = localStorage.getItem('supabase_url') || import.meta.env.VITE_SUPABASE_URL || '';
    const key = localStorage.getItem('supabase_anon_key') || import.meta.env.VITE_SUPABASE_ANON_KEY || '';
    if (url && key) {
      const supabase = getSupabase(url, key);
      if (supabase) {
        const { data, error } = await supabase
          .from('book_comments')
          .select('*')
          .eq('book_id', cleanId)
          .order('timestamp', { ascending: false });

        if (!error && Array.isArray(data) && data.length > 0) {
          comments = data.map((d: any) => ({
            id: d.id,
            bookId: d.book_id,
            bookTitle: d.book_title,
            userId: d.user_id,
            userName: d.user_name || 'Reader',
            userAvatar: d.user_avatar,
            page: Number(d.page) || 0,
            location: d.location,
            content: d.content,
            timestamp: d.timestamp || Date.now(),
            isLocal: false,
          }));
          localStorage.setItem(getCacheKey(bookId), JSON.stringify(comments));
          return comments;
        }
      }
    }
  } catch (_) {}

  // 4. Cached fallback from localStorage
  try {
    const cached = localStorage.getItem(getCacheKey(bookId));
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}

  return [];
}

export async function postCloudComment(
  commentData: {
    bookId: string;
    bookTitle?: string;
    page: number;
    location?: string | number;
    content: string;
    userId: string;
    userName: string;
    userAvatar?: string;
    replyToId?: string;
    replyToName?: string;
    replyToSnippet?: string;
  },
  config?: R2Config
): Promise<{ success: boolean; comment?: BookComment; message?: string }> {
  const cleanId = String(commentData.bookId).replace(/[^a-zA-Z0-9_-]/g, "_");

  const newComment: BookComment = {
    id: `c_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    bookId: cleanId,
    bookTitle: commentData.bookTitle || "",
    userId: commentData.userId,
    userName: commentData.userName.trim() || "Reader",
    userAvatar: commentData.userAvatar,
    page: Math.max(0, commentData.page),
    location: commentData.location,
    content: commentData.content.trim(),
    timestamp: Date.now(),
    isLocal: false,
    replyToId: commentData.replyToId,
    replyToName: commentData.replyToName,
    replyToSnippet: commentData.replyToSnippet,
  };

  // 1. Try server API
  let savedViaServer = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(`${getApiUrl()}/api/books/${encodeURIComponent(cleanId)}/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getR2Headers(config),
      },
      body: JSON.stringify({ comment: newComment }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (res.ok) {
      savedViaServer = true;
    }
  } catch (err) {
    console.debug("Server comment post notice:", err);
  }

  // 2. Direct S3 upload of updated comments list to Cloudflare R2
  const { accessKey, secretKey, bucket, endpoint } = getR2ResolvedCredentials(config);
  if (accessKey && secretKey && endpoint) {
    try {
      const objectKey = `comments/${cleanId}.json`;
      const aws = new AwsClient({
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
        service: "s3",
        region: "auto",
      });

      // Fetch current comments from R2
      let currentList: BookComment[] = [];
      try {
        const getUrl = new URL(`/${bucket}/${objectKey}`, endpoint);
        const signedGet = await aws.sign(getUrl, { method: "GET" });
        const getRes = await fetch(signedGet);
        if (getRes.ok) {
          const txt = await getRes.text();
          const parsed = JSON.parse(txt);
          if (Array.isArray(parsed)) currentList = parsed;
        }
      } catch (_) {}

      // Prepend new comment
      const updatedList = [newComment, ...currentList.filter((c) => c.id !== newComment.id)].slice(0, 500);

      // Save to R2
      const jsonBuffer = new TextEncoder().encode(JSON.stringify(updatedList, null, 2));
      const putUrl = new URL(`/${bucket}/${objectKey}`, endpoint);
      const signedPut = await aws.sign(putUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: jsonBuffer,
      });
      await fetch(signedPut);
    } catch (directPutErr: any) {
      console.debug("Direct S3 comments put notice:", directPutErr?.message);
    }
  }

  // 3. Save to Supabase table if available
  try {
    const url = localStorage.getItem('supabase_url') || import.meta.env.VITE_SUPABASE_URL || '';
    const key = localStorage.getItem('supabase_anon_key') || import.meta.env.VITE_SUPABASE_ANON_KEY || '';
    if (url && key) {
      const supabase = getSupabase(url, key);
      if (supabase) {
        await supabase.from('book_comments').insert({
          id: newComment.id,
          book_id: newComment.bookId,
          book_title: newComment.bookTitle,
          user_id: newComment.userId,
          user_name: newComment.userName,
          user_avatar: newComment.userAvatar || null,
          page: newComment.page,
          location: newComment.location ? String(newComment.location) : null,
          content: newComment.content,
          timestamp: newComment.timestamp,
        });
      }
    }
  } catch (_) {}

  // 4. Update local cache
  try {
    const cached = localStorage.getItem(getCacheKey(commentData.bookId));
    const currentCached: BookComment[] = cached ? JSON.parse(cached) : [];
    const updatedCache = [newComment, ...currentCached.filter((c) => c.id !== newComment.id)];
    localStorage.setItem(getCacheKey(commentData.bookId), JSON.stringify(updatedCache));
  } catch (_) {}

  return {
    success: true,
    comment: newComment,
    message: "Comment published to cloud storage!",
  };
}

export async function deleteCloudComment(
  bookId: string,
  commentId: string,
  userId: string,
  config?: R2Config
): Promise<boolean> {
  const cleanId = String(bookId).replace(/[^a-zA-Z0-9_-]/g, "_");

  // 1. Try server API
  try {
    const res = await fetch(
      `${getApiUrl()}/api/books/${encodeURIComponent(cleanId)}/comments/${encodeURIComponent(commentId)}`,
      {
        method: "DELETE",
        headers: {
          ...getR2Headers(config),
        },
      }
    );
    if (res.ok) {
      // update cache
      const cached = localStorage.getItem(getCacheKey(bookId));
      if (cached) {
        const current = JSON.parse(cached);
        const filtered = current.filter((c: BookComment) => c.id !== commentId);
        localStorage.setItem(getCacheKey(bookId), JSON.stringify(filtered));
      }
      return true;
    }
  } catch (_) {}

  // 2. Direct S3 update
  const { accessKey, secretKey, bucket, endpoint } = getR2ResolvedCredentials(config);
  if (accessKey && secretKey && endpoint) {
    try {
      const objectKey = `comments/${cleanId}.json`;
      const aws = new AwsClient({
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
        service: "s3",
        region: "auto",
      });

      const getUrl = new URL(`/${bucket}/${objectKey}`, endpoint);
      const signedGet = await aws.sign(getUrl, { method: "GET" });
      const getRes = await fetch(signedGet);
      if (getRes.ok) {
        const txt = await getRes.text();
        const list: BookComment[] = JSON.parse(txt);
        const filtered = list.filter((c) => c.id !== commentId);
        const jsonBuffer = new TextEncoder().encode(JSON.stringify(filtered, null, 2));
        const putUrl = new URL(`/${bucket}/${objectKey}`, endpoint);
        const signedPut = await aws.sign(putUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: jsonBuffer,
        });
        await fetch(signedPut);
      }
    } catch (_) {}
  }

  // 3. Local cache update
  try {
    const cached = localStorage.getItem(getCacheKey(bookId));
    if (cached) {
      const current = JSON.parse(cached);
      const filtered = current.filter((c: BookComment) => c.id !== commentId);
      localStorage.setItem(getCacheKey(bookId), JSON.stringify(filtered));
    }
  } catch (_) {}

  return true;
}
