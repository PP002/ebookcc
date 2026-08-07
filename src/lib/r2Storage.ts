import { getApiUrl } from '@/lib/api';
import { getSupabase } from '@/context/AppSettingsContext';

export interface R2Config {
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2BucketName?: string;
  r2Endpoint?: string;
}

function getActiveSupabaseClient() {
  try {
    const url = localStorage.getItem('supabase_url') || import.meta.env.VITE_SUPABASE_URL || '';
    const key = localStorage.getItem('supabase_anon_key') || import.meta.env.VITE_SUPABASE_ANON_KEY || '';
    if (!url || !key) return null;
    return getSupabase(url, key);
  } catch (_) {
    return null;
  }
}

export function getR2Headers(config?: R2Config): Record<string, string> {
  const headers: Record<string, string> = {};
  
  const accessKey = config?.r2AccessKeyId || localStorage.getItem('r2_access_key') || "";
  const secretKey = config?.r2SecretAccessKey || localStorage.getItem('r2_secret_key') || "";
  let bucket = config?.r2BucketName || localStorage.getItem('r2_bucket_name') || "ebookcc-media";
  if (!bucket || bucket === "ebookcc-assets") {
    bucket = "ebookcc-media";
  }
  const endpoint = config?.r2Endpoint || localStorage.getItem('r2_endpoint') || "";

  if (accessKey) headers["x-r2-access-key"] = accessKey;
  if (secretKey) headers["x-r2-secret-key"] = secretKey;
  if (bucket) headers["x-r2-bucket"] = bucket;
  if (endpoint) headers["x-r2-endpoint"] = endpoint;

  return headers;
}

export async function testR2Connection(config?: R2Config): Promise<{ success: boolean; message: string; details?: any }> {
  try {
    const res = await fetch(`${getApiUrl()}/api/media/test-r2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getR2Headers(config)
      }
    });

    const data = await res.json();
    if (!res.ok) {
      return { success: false, message: data.error || data.message || "Failed to connect to Cloudflare R2" };
    }

    return { success: true, message: data.message || "Cloud media storage connected successfully!", details: data };
  } catch (err: any) {
    return { success: false, message: err.message || "Network error connecting to R2" };
  }
}

export async function uploadMediaToR2(
  base64Data: string,
  filename?: string,
  folder: string = "media",
  config?: R2Config
): Promise<{ success: boolean; url: string; key?: string; error?: string }> {
  try {
    const fullDataUrl = base64Data.startsWith("data:") ? base64Data : `data:image/jpeg;base64,${base64Data}`;
    const blobRes = await fetch(fullDataUrl);
    const blob = await blobRes.blob();
    const mimeType = blob.type || "application/octet-stream";

    let ext = "png";
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) ext = "jpg";
    else if (mimeType.includes("webp")) ext = "webp";
    else if (mimeType.includes("gif")) ext = "gif";
    else if (mimeType.includes("json")) ext = "json";

    const finalFilename = filename || `media-${Date.now()}.${ext}`;

    const presignRes = await fetch(`${getApiUrl()}/api/get-presigned-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getR2Headers(config)
      },
      body: JSON.stringify({
        fileName: finalFilename,
        fileType: mimeType,
        folder
      })
    });
    
    const presignData = await presignRes.json();
    if (!presignRes.ok) {
      return { success: false, url: "", error: presignData.error || "Failed to get presigned URL" };
    }

    const { uploadUrl, key, bucket } = presignData;

    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      body: blob,
      headers: {
        "Content-Type": mimeType
      }
    });

    if (!uploadRes.ok) {
      return { success: false, url: "", error: "Failed to upload file to R2 directly" };
    }

    const fileUrl = `/api/media/file/${encodeURIComponent(bucket)}/${key}`;
    return { success: true, url: fileUrl, key };
  } catch (err: any) {
    return { success: false, url: "", error: err.message || "R2 media upload exception" };
  }
}

export async function publishWorkToR2(
  item: any,
  config?: R2Config
): Promise<{ success: boolean; item: any; message: string }> {
  // Sync to Supabase table asynchronously in background if connected
  const supabase = getActiveSupabaseClient();
  if (supabase) {
    supabase.from('published_works').upsert({
      id: item.id,
      title: item.title || 'Untitled',
      type: item.type || 'comic',
      author: item.author || 'Anonymous',
      author_id: item.author_id || item.authorId || '',
      cover_url: item.coverUrl || item.cover_url || '',
      pages: item.pages || [],
      content: item.content || '',
      description: item.description || '',
      timestamp: item.timestamp || Date.now()
    }).then(({ error }) => {
      if (error) console.warn("Supabase published_works table sync notice:", error.message);
    }).catch(sbErr => {
      console.warn("Supabase published_works table sync skipped/failed:", sbErr?.message);
    });
  }

  try {
    const res = await fetch(`${getApiUrl()}/api/published-works`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getR2Headers(config)
      },
      body: JSON.stringify({ item })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Server failed to publish work to R2 storage");
    }

    return {
      success: true,
      item: data.item || item,
      message: data.message || "Published work saved to cloud media storage"
    };
  } catch (err: any) {
    console.warn("R2 publication fallback to local storage:", err.message);
    return {
      success: false,
      item,
      message: err.message || "Fallback to local storage"
    };
  }
}

export async function fetchPublishedWorksFromR2(
  config?: R2Config
): Promise<{ success: boolean; works: any[] }> {
  let worksList: any[] = [];

  // Try fetching from server R2 API first
  try {
    const res = await fetch(`${getApiUrl()}/api/published-works`, {
      method: "GET",
      headers: {
        ...getR2Headers(config)
      }
    });

    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.works)) {
        worksList = data.works;
      }
    }
  } catch (err) {
    console.warn("Failed fetching published works from R2 API:", err);
  }

  // Also query Supabase database published_works table if connected
  const supabase = getActiveSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('published_works')
        .select('*')
        .order('timestamp', { ascending: false });

      if (!error && Array.isArray(data) && data.length > 0) {
        const worksMap = new Map<string, any>();
        // Add items from R2/local
        worksList.forEach(w => { if (w && w.id) worksMap.set(w.id, w); });
        // Add or replace with items from Supabase
        data.forEach((sbItem: any) => {
          if (sbItem && sbItem.id) {
            worksMap.set(sbItem.id, {
              id: sbItem.id,
              title: sbItem.title,
              type: sbItem.type,
              author: sbItem.author,
              authorId: sbItem.author_id,
              coverUrl: sbItem.cover_url,
              pages: sbItem.pages,
              content: sbItem.content,
              description: sbItem.description,
              timestamp: sbItem.timestamp || (sbItem.created_at ? new Date(sbItem.created_at).getTime() : Date.now())
            });
          }
        });
        worksList = Array.from(worksMap.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      } else if (error) {
        console.warn("Supabase published_works fetch notice:", error.message);
      }
    } catch (sbErr: any) {
      console.warn("Supabase published_works table query notice:", sbErr.message);
    }
  }

  return { success: true, works: worksList };
}

export async function deletePublishedWorkFromR2(
  id: string,
  config?: R2Config
): Promise<boolean> {
  const supabase = getActiveSupabaseClient();
  if (supabase) {
    try {
      await supabase.from('published_works').delete().eq('id', id);
    } catch (_) {}
  }

  try {
    const res = await fetch(`${getApiUrl()}/api/published-works/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: {
        ...getR2Headers(config)
      }
    });

    return res.ok;
  } catch (err) {
    console.warn("Failed deleting published work from R2:", err);
    return false;
  }
}
