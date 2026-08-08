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
  const fullDataUrl = base64Data.startsWith("data:") ? base64Data : `data:image/jpeg;base64,${base64Data}`;

  // Method 1: Try direct presigned S3 upload if R2 configured
  try {
    const blobRes = await fetch(fullDataUrl);
    const blob = await blobRes.blob();
    const mimeType = blob.type || "application/octet-stream";

    let ext = "png";
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) ext = "jpg";
    else if (mimeType.includes("webp")) ext = "webp";
    else if (mimeType.includes("gif")) ext = "gif";
    else if (mimeType.includes("json")) ext = "json";

    const finalFilename = filename || `media-${Date.now()}.${ext}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

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
      }),
      signal: controller.signal
    }).finally(() => clearTimeout(timer));
    
    if (presignRes.ok) {
      const presignData = await presignRes.json();
      const { uploadUrl, key, bucket } = presignData;
      if (uploadUrl && key) {
        const uploadController = new AbortController();
        const uploadTimer = setTimeout(() => uploadController.abort(), 30000);

        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          body: blob,
          headers: {
            "Content-Type": mimeType
          },
          signal: uploadController.signal
        }).finally(() => clearTimeout(uploadTimer));

        if (uploadRes.ok) {
          const fileUrl = `/api/media/file/${encodeURIComponent(bucket)}/${key}`;
          return { success: true, url: fileUrl, key };
        }
      }
    }
  } catch (_) {}

  // Method 2: Rapid Server Endpoint Fallback (/api/media/upload)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    const fallbackRes = await fetch(`${getApiUrl()}/api/media/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getR2Headers(config)
      },
      body: JSON.stringify({
        base64Image: fullDataUrl,
        filename,
        folder
      }),
      signal: controller.signal
    }).finally(() => clearTimeout(timer));

    if (fallbackRes.ok) {
      const fallbackData = await fallbackRes.json();
      if (fallbackData.url) {
        return { success: true, url: fallbackData.url, key: fallbackData.key };
      }
    } else {
      const errData = await fallbackRes.json().catch(() => ({}));
      return { success: false, url: "", error: errData.error || `Server HTTP ${fallbackRes.status}` };
    }
  } catch (err: any) {
    console.warn("R2 upload error:", err?.message || err);
    return { success: false, url: "", error: err?.message || "Upload network request failed" };
  }

  return { success: false, url: "", error: "Failed uploading media object to Cloudflare R2" };
}

export async function compressBase64ToWebP(
  dataUrl: string,
  maxDimension = 1600,
  quality = 0.82
): Promise<{ base64Url: string; blob: Blob; ext: string; mimeType: string }> {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    try {
      const res = await fetch(dataUrl || "");
      const blob = await res.blob();
      return { base64Url: dataUrl, blob, ext: "png", mimeType: blob.type || "image/png" };
    } catch (_) {
      return { base64Url: dataUrl, blob: new Blob([]), ext: "png", mimeType: "image/png" };
    }
  }

  // If already small (<120KB), fast convert to Blob
  if (dataUrl.length < 130000) {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const mimeType = blob.type || "image/png";
      const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
      return { base64Url: dataUrl, blob, ext, mimeType };
    } catch (_) {}
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        const webpUrl = canvas.toDataURL("image/webp", quality);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve({ base64Url: webpUrl, blob, ext: "webp", mimeType: "image/webp" });
            } else {
              fetch(webpUrl).then(r => r.blob()).then(b => resolve({ base64Url: webpUrl, blob: b, ext: "webp", mimeType: "image/webp" }));
            }
          },
          "image/webp",
          quality
        );
      } else {
        fetch(dataUrl).then(r => r.blob()).then(b => resolve({ base64Url: dataUrl, blob: b, ext: "png", mimeType: b.type || "image/png" }));
      }
    };
    img.onerror = () => {
      fetch(dataUrl).then(r => r.blob()).then(b => resolve({ base64Url: dataUrl, blob: b, ext: "png", mimeType: b.type || "image/png" }));
    };
    img.src = dataUrl;
  });
}

export interface ClientUploadTask {
  filename: string;
  folder: string;
  dataUrl: string;
  updateUrl: (url: string) => void;
}

export async function processParallelMediaUploads(
  tasks: ClientUploadTask[],
  config?: R2Config,
  onProgress?: (progress: number, stage: string) => void,
  concurrency = 4
): Promise<void> {
  if (tasks.length === 0) return;

  let completed = 0;
  const total = tasks.length;

  if (onProgress) onProgress(10, `Compressing & uploading ${total} comic assets in parallel...`);

  const runTask = async (task: ClientUploadTask) => {
    try {
      // Step 1: Compress image on client
      const compressed = await compressBase64ToWebP(task.dataUrl, 1600, 0.82);

      // Step 2: Upload to R2 / media endpoint
      const result = await uploadMediaToR2(
        compressed.base64Url,
        task.filename,
        task.folder,
        config
      );

      if (result.success && result.url) {
        task.updateUrl(result.url);
      } else {
        throw new Error(result.error || `Failed uploading asset ${task.filename} to Cloudflare R2`);
      }
    } catch (err: any) {
      console.error(`[Client Parallel Upload] Failed uploading ${task.filename}:`, err);
      throw err;
    } finally {
      completed++;
      const percent = Math.min(85, 10 + Math.round((completed / total) * 75));
      if (onProgress) onProgress(percent, `Uploaded asset ${completed}/${total}`);
    }
  };

  // Run in chunks with concurrency pool
  for (let i = 0; i < tasks.length; i += concurrency) {
    const chunk = tasks.slice(i, i + concurrency);
    await Promise.all(chunk.map(task => runTask(task)));
  }
}

export function fastBase64Hash(str: string): string {
  if (!str || typeof str !== "string") return "empty";
  const len = str.length;
  let h1 = 0x811c9dc5;
  let h2 = 0x097c1fda;

  const sampleSize = 800;
  const step = len > sampleSize ? Math.floor(len / sampleSize) : 1;

  for (let i = 0; i < len; i += step) {
    const code = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x05924715);
  }

  const hashPart = ((h1 ^ h2) >>> 0).toString(36);
  const lenPart = len.toString(36);
  const startPart = str.slice(0, 16).replace(/[^a-zA-Z0-9]/g, "");
  return `${lenPart}_${hashPart}_${startPart}`;
}

export async function publishWorkToR2(
  item: any,
  config?: R2Config,
  onProgress?: (progress: number, stage: string) => void
): Promise<{ success: boolean; item: any; message: string }> {
  if (onProgress) onProgress(5, "Preparing comic book assets for rapid publish...");

  const workId = String(item.id || Date.now()).replace(/[^a-zA-Z0-9_-]/g, "_");
  const cleanedItem = JSON.parse(JSON.stringify(item));
  const uploadTasks: ClientUploadTask[] = [];

  // Look up previously published version to reuse unchanged assets
  let prevItem: any = null;
  try {
    const localJson = localStorage.getItem("ebookcc_published_items");
    if (localJson) {
      const list = JSON.parse(localJson);
      prevItem = list.find((w: any) => w && String(w.id) === String(item.id));
    }
  } catch (_) {}

  const existingAssetHashes: Record<string, string> = prevItem && prevItem.assetHashes ? { ...prevItem.assetHashes } : {};
  const newAssetHashes: Record<string, string> = {};
  let skippedCount = 0;

  const handleAsset = (
    rawUrl: string | undefined,
    prefix: string,
    updateFn: (url: string) => void
  ) => {
    if (!rawUrl || typeof rawUrl !== "string") return;

    // 1. If ALREADY a hosted media URL (not a base64 data string)
    if (!rawUrl.startsWith("data:")) {
      skippedCount++;
      return;
    }

    // 2. Base64 data URL: calculate fast content hash
    const hash = fastBase64Hash(rawUrl);

    // 3. If hash matches previously uploaded asset, REUSE instantly without re-uploading
    if (existingAssetHashes[hash]) {
      updateFn(existingAssetHashes[hash]);
      newAssetHashes[hash] = existingAssetHashes[hash];
      skippedCount++;
      return;
    }

    // 4. New or modified asset -> enqueue for parallel compression & upload
    uploadTasks.push({
      filename: `${prefix}-${hash.slice(0, 16)}.webp`,
      folder: `media/${workId}`,
      dataUrl: rawUrl,
      updateUrl: (uploadedUrl) => {
        updateFn(uploadedUrl);
        newAssetHashes[hash] = uploadedUrl;
      }
    });
  };

  // 1. Cover
  if (cleanedItem.cover) {
    handleAsset(cleanedItem.cover, "cover", (url) => { cleanedItem.cover = url; });
  }

  // 2. Comic pages & panels
  if (cleanedItem.type === "comic" && Array.isArray(cleanedItem.pages)) {
    let imgIdx = 1;
    const collectNodeTasks = (node: any, pageIdx: number) => {
      if (!node) return;
      if (node.type === "panel") {
        if (node.imageUrl) {
          const targetNode = node;
          handleAsset(node.imageUrl, `p${pageIdx + 1}-panel-${imgIdx++}`, (url) => {
            targetNode.imageUrl = url;
          });
        }
        if (node.drawing) {
          const targetNode = node;
          handleAsset(node.drawing, `p${pageIdx + 1}-draw-${imgIdx++}`, (url) => {
            targetNode.drawing = url;
          });
        }
      } else if (node.type === "split") {
        if (node.left) collectNodeTasks(node.left, pageIdx);
        if (node.right) collectNodeTasks(node.right, pageIdx);
        if (node.c1) collectNodeTasks(node.c1, pageIdx);
        if (node.c2) collectNodeTasks(node.c2, pageIdx);
      }
    };

    for (let i = 0; i < cleanedItem.pages.length; i++) {
      const page = cleanedItem.pages[i];
      if (page && page.tree) {
        collectNodeTasks(page.tree, i);
      }
    }
  }

  // 3. Novel inline images
  if (cleanedItem.type === "novel" && typeof cleanedItem.content === "string") {
    let contentHtml = cleanedItem.content;
    const matches = [...contentHtml.matchAll(/src=["'](data:image\/[a-zA-Z0-9-+\/]+;base64,[^"']+)["']/g)];
    let inlineIdx = 1;

    for (const match of matches) {
      const rawDataUrl = match[1];
      const targetDataUrl = rawDataUrl;
      handleAsset(rawDataUrl, `inline-${inlineIdx++}`, (url) => {
        cleanedItem.content = cleanedItem.content.replace(targetDataUrl, url);
      });
    }
  }

  // Execute Parallel Compression & Batch Uploads
  if (uploadTasks.length > 0) {
    if (onProgress) {
      const msg = skippedCount > 0
        ? `[Delta Sync] ${skippedCount} unchanged assets skipped, uploading ${uploadTasks.length} modified pages...`
        : `Compressing & uploading ${uploadTasks.length} comic assets...`;
      onProgress(15, msg);
    }
    const startTime = Date.now();
    try {
      await processParallelMediaUploads(uploadTasks, config, onProgress, 4);
      console.log(`[R2 Rapid Publish] Uploaded ${uploadTasks.length} modified assets (skipped ${skippedCount} unchanged) in ${Date.now() - startTime}ms`);
    } catch (uploadErr: any) {
      console.error("R2 asset upload failed:", uploadErr);
      return {
        success: false,
        item: cleanedItem,
        message: uploadErr.message || "Failed uploading comic image assets to Cloudflare R2"
      };
    }
  } else if (skippedCount > 0) {
    if (onProgress) onProgress(80, `[Delta Sync] All ${skippedCount} assets up-to-date! Skipping re-upload.`);
  }

  cleanedItem.assetHashes = { ...existingAssetHashes, ...newAssetHashes };

  if (onProgress) onProgress(90, "Saving lightweight manifest to Cloudflare R2...");

  // Sync to Supabase table asynchronously in background if connected
  const supabase = getActiveSupabaseClient();
  if (supabase) {
    (async () => {
      try {
        const { error } = await supabase.from('published_works').upsert({
          id: cleanedItem.id,
          title: cleanedItem.title || 'Untitled',
          type: cleanedItem.type || 'comic',
          author: cleanedItem.author || 'Anonymous',
          author_id: cleanedItem.author_id || cleanedItem.authorId || '',
          cover_url: cleanedItem.coverUrl || cleanedItem.cover || '',
          pages: cleanedItem.pages || [],
          content: cleanedItem.content || '',
          description: cleanedItem.description || '',
          timestamp: cleanedItem.timestamp || Date.now()
        });
        if (error) console.warn("Supabase published_works table sync notice:", error.message);
      } catch (sbErr: any) {
        console.warn("Supabase published_works table sync skipped/failed:", sbErr?.message);
      }
    })();
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);

    const res = await fetch(`${getApiUrl()}/api/published-works`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getR2Headers(config)
      },
      body: JSON.stringify({ item: cleanedItem }),
      signal: controller.signal
    }).finally(() => clearTimeout(timer));

    const contentType = res.headers.get("content-type") || "";
    if (!res.ok) {
      let errorMsg = `Server error HTTP ${res.status}`;
      if (contentType.includes("application/json")) {
        const errData = await res.json().catch(() => ({}));
        errorMsg = errData.error || errorMsg;
      }
      throw new Error(errorMsg);
    }

    if (!contentType.includes("application/json")) {
      throw new Error("Server API unavailable or returned non-JSON");
    }

    const data = await res.json();
    if (onProgress) onProgress(100, "Published successfully to Cloudflare R2!");

    return {
      success: true,
      item: data.item || cleanedItem,
      message: data.message || "Published work saved to cloud media storage"
    };
  } catch (err: any) {
    console.error("R2 publication error:", err.message);
    return {
      success: false,
      item: cleanedItem,
      message: err.message || "Failed publishing work manifest to Cloudflare R2"
    };
  }
}

export async function fetchPublishedWorksFromR2(
  config?: R2Config
): Promise<{ success: boolean; works: any[] }> {
  let worksList: any[] = [];

  // Try fetching from server R2 API first
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    const res = await fetch(`${getApiUrl()}/api/published-works`, {
      method: "GET",
      headers: {
        ...getR2Headers(config)
      },
      signal: controller.signal
    }).finally(() => clearTimeout(timer));

    const contentType = res.headers.get("content-type") || "";
    if (res.ok && contentType.includes("application/json")) {
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
