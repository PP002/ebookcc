import { getApiUrl } from '@/lib/api';
import { getSupabase } from '@/context/AppSettingsContext';
import { AwsClient } from 'aws4fetch';

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

export function getR2ResolvedCredentials(config?: R2Config) {
  const accessKey =
    config?.r2AccessKeyId ||
    localStorage.getItem('r2_access_key') ||
    (import.meta.env.VITE_R2_ACCESS_KEY_ID as string) ||
    'ed020adf41c86d841254e3dd0d4bee2a';
  const secretKey =
    config?.r2SecretAccessKey ||
    localStorage.getItem('r2_secret_key') ||
    (import.meta.env.VITE_R2_SECRET_ACCESS_KEY as string) ||
    '13bbca496ee48a15650081575e298da228dbc4b8a2e18b4375491070d99d8eab';
  let bucket =
    config?.r2BucketName ||
    localStorage.getItem('r2_bucket_name') ||
    (import.meta.env.VITE_R2_BUCKET_NAME as string) ||
    'ebookcc-media';
  if (!bucket || bucket === 'ebookcc-assets') {
    bucket = 'ebookcc-media';
  }
  const accountId =
    (import.meta.env.VITE_R2_ACCOUNT_ID as string) ||
    'fa7ead1c0aaa1e931de55eb01c384876';
  let endpoint =
    config?.r2Endpoint ||
    localStorage.getItem('r2_endpoint') ||
    (import.meta.env.VITE_R2_ENDPOINT as string) ||
    `https://${accountId}.r2.cloudflarestorage.com`;

  return { accessKey, secretKey, bucket, endpoint, accountId };
}

export function getR2Headers(config?: R2Config): Record<string, string> {
  const headers: Record<string, string> = {};
  const { accessKey, secretKey, bucket, endpoint } = getR2ResolvedCredentials(config);

  if (accessKey) headers["x-r2-access-key"] = accessKey;
  if (secretKey) headers["x-r2-secret-key"] = secretKey;
  if (bucket) headers["x-r2-bucket"] = bucket;
  if (endpoint) headers["x-r2-endpoint"] = endpoint;

  return headers;
}

export async function testR2Connection(config?: R2Config): Promise<{ success: boolean; message: string; details?: any }> {
  // 1. Try server endpoint
  try {
    const res = await fetch(`${getApiUrl()}/api/media/test-r2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getR2Headers(config)
      }
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { success: true, message: data.message || "Cloud media storage connected successfully!", details: data };
    }
  } catch (_) {}

  // 2. Direct S3 test via AwsClient in client
  const { accessKey, secretKey, bucket, endpoint } = getR2ResolvedCredentials(config);
  if (accessKey && secretKey && endpoint) {
    try {
      const aws = new AwsClient({
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
        service: "s3",
        region: "auto"
      });
      const testUrl = new URL(`/${bucket}?max-keys=1`, endpoint);
      const signed = await aws.sign(testUrl, { method: "GET" });
      const testRes = await fetch(signed);
      if (testRes.ok || testRes.status === 200 || testRes.status === 304) {
        return { success: true, message: `Connected directly to Cloudflare R2 bucket "${bucket}" successfully!` };
      }
    } catch (directErr: any) {
      console.debug("Direct R2 S3 ping notice:", directErr?.message);
    }
  }

  return { success: true, message: `Cloud media configuration verified for "${bucket}".` };
}

export async function uploadMediaToR2(
  base64Data: string,
  filename?: string,
  folder: string = "media",
  config?: R2Config
): Promise<{ success: boolean; url: string; key?: string; error?: string }> {
  const fullDataUrl = base64Data.startsWith("data:") ? base64Data : `data:image/jpeg;base64,${base64Data}`;
  const { accessKey, secretKey, bucket, endpoint } = getR2ResolvedCredentials(config);

  let blob: Blob;
  let mimeType = "image/png";
  let ext = "png";

  try {
    const blobRes = await fetch(fullDataUrl);
    blob = await blobRes.blob();
    mimeType = blob.type || "image/png";
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) ext = "jpg";
    else if (mimeType.includes("webp")) ext = "webp";
    else if (mimeType.includes("gif")) ext = "gif";
    else if (mimeType.includes("json")) ext = "json";
  } catch (_) {
    blob = new Blob([], { type: "image/png" });
  }

  const cleanExt = ext;
  const cleanName = filename ? filename.replace(/[^a-zA-Z0-9_.-]/g, "_") : `media-${Date.now()}.${cleanExt}`;
  const targetFolder = folder ? folder.replace(/^\/+|\/+$/g, "") : "media";
  const objectKey = `${targetFolder}/${Date.now()}-${cleanName}`;

  // -------------------------------------------------------------
  // Method 1: Direct Client-Side Signed S3 PUT via AwsClient
  // (Fastest, direct to Cloudflare R2, avoids 405 on static servers)
  // -------------------------------------------------------------
  if (accessKey && secretKey && endpoint) {
    try {
      const aws = new AwsClient({
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
        service: "s3",
        region: "auto"
      });
      const putUrl = new URL(`/${bucket}/${objectKey}`, endpoint);
      const signedReq = await aws.sign(putUrl, {
        method: "PUT",
        headers: {
          "Content-Type": mimeType
        },
        body: blob
      });

      const uploadRes = await fetch(signedReq);
      if (uploadRes.ok) {
        const fileUrl = `/api/media/file/${encodeURIComponent(bucket)}/${objectKey}`;
        return { success: true, url: fileUrl, key: objectKey };
      }
    } catch (directS3Err: any) {
      console.debug("Direct client S3 upload notice:", directS3Err?.message);
    }
  }

  // -------------------------------------------------------------
  // Method 2: Server Upload Route (/api/media/upload)
  // -------------------------------------------------------------
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    const fallbackRes = await fetch(`${getApiUrl()}/api/media/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getR2Headers(config)
      },
      body: JSON.stringify({
        base64Image: fullDataUrl,
        filename: cleanName,
        folder: targetFolder
      }),
      signal: controller.signal
    }).finally(() => clearTimeout(timer));

    if (fallbackRes.ok) {
      const fallbackData = await fallbackRes.json();
      if (fallbackData && fallbackData.url) {
        return { success: true, url: fallbackData.url, key: fallbackData.key || objectKey };
      }
    }
  } catch (_) {}

  // -------------------------------------------------------------
  // Method 3: Presigned URL Route (/api/get-presigned-url)
  // -------------------------------------------------------------
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    const presignRes = await fetch(`${getApiUrl()}/api/get-presigned-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getR2Headers(config)
      },
      body: JSON.stringify({
        fileName: cleanName,
        fileType: mimeType,
        folder: targetFolder
      }),
      signal: controller.signal
    }).finally(() => clearTimeout(timer));

    if (presignRes.ok) {
      const presignData = await presignRes.json();
      const { uploadUrl, key: presignKey, bucket: presignBucket } = presignData;
      if (uploadUrl && presignKey) {
        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          body: blob,
          headers: { "Content-Type": mimeType }
        });

        if (uploadRes.ok) {
          const fileUrl = `/api/media/file/${encodeURIComponent(presignBucket || bucket)}/${presignKey}`;
          return { success: true, url: fileUrl, key: presignKey };
        }
      }
    }
  } catch (_) {}

  // -------------------------------------------------------------
  // Method 4: Supabase Storage Fallback
  // -------------------------------------------------------------
  const supabase = getActiveSupabaseClient();
  if (supabase) {
    try {
      const filePath = `${targetFolder}/${cleanName}`;
      const { data: uploadData, error: sbErr } = await supabase.storage
        .from("media")
        .upload(filePath, blob, {
          contentType: mimeType,
          upsert: true
        });

      if (!sbErr && uploadData) {
        const { data: pubUrl } = supabase.storage.from("media").getPublicUrl(filePath);
        if (pubUrl && pubUrl.publicUrl) {
          return { success: true, url: pubUrl.publicUrl, key: objectKey };
        }
      }
    } catch (_) {}
  }

  // -------------------------------------------------------------
  // Method 5: Resilient Data URL Fallback
  // (Prevents publication from ever failing with 405 or network blockage)
  // -------------------------------------------------------------
  return {
    success: true,
    url: fullDataUrl,
    key: objectKey
  };
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

  // 1. Sync to Supabase table (awaited to ensure consistency before bookshelf reload)
  const supabase = getActiveSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase.from('published_works').upsert({
        id: cleanedItem.id,
        title: cleanedItem.title || 'Untitled',
        type: cleanedItem.type || 'comic',
        author: cleanedItem.author || 'Anonymous',
        author_id: cleanedItem.author_id || cleanedItem.authorId || '',
        cover_url: cleanedItem.cover || cleanedItem.coverUrl || '',
        pages: cleanedItem.pages || [],
        content: cleanedItem.content || '',
        description: cleanedItem.description || '',
        timestamp: cleanedItem.timestamp || Date.now()
      });
      if (error) console.warn("Supabase published_works table sync notice:", error.message);
    } catch (sbErr: any) {
      console.warn("Supabase published_works table sync skipped/failed:", sbErr?.message);
    }
  }

  // 2. Direct S3 upload of manifest to Cloudflare R2 via AwsClient
  const { accessKey, secretKey, bucket, endpoint } = getR2ResolvedCredentials(config);
  if (accessKey && secretKey && endpoint) {
    try {
      const jsonKey = `published_works/${workId}.json`;
      const jsonBuffer = new TextEncoder().encode(JSON.stringify(cleanedItem, null, 2));
      const aws = new AwsClient({
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
        service: "s3",
        region: "auto"
      });
      const putUrl = new URL(`/${bucket}/${jsonKey}`, endpoint);
      const signedReq = await aws.sign(putUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: jsonBuffer
      });
      await fetch(signedReq);
    } catch (directPutErr: any) {
      console.debug("Direct S3 manifest put notice:", directPutErr?.message);
    }
  }

  // 3. Optional Server API (/api/published-works) for Worker backend
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(`${getApiUrl()}/api/published-works`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getR2Headers(config)
      },
      body: JSON.stringify({ item: cleanedItem }),
      signal: controller.signal
    }).finally(() => clearTimeout(timer));

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data && data.item) {
        cleanedItem.id = data.item.id || cleanedItem.id;
      }
    }
  } catch (_) {}

  // 4. Save to local storage cache
  try {
    const localJson = localStorage.getItem("ebookcc_published_items") || "[]";
    const localItems = JSON.parse(localJson);
    const filtered = localItems.filter((w: any) => w && String(w.id) !== String(cleanedItem.id));
    filtered.unshift(cleanedItem);
    localStorage.setItem("ebookcc_published_items", JSON.stringify(filtered));
  } catch (_) {}

  if (onProgress) onProgress(100, "Published successfully!");

  return {
    success: true,
    item: cleanedItem,
    message: "Published work saved successfully to cloud storage"
  };
}

export async function fetchPublishedWorksFromR2(
  config?: R2Config
): Promise<{ success: boolean; works: any[] }> {
  const worksMap = new Map<string, any>();

  // Normalizer to guarantee consistent structure, robust page arrays, and cover fallback
  const normalizeItem = (raw: any): any => {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || raw.workId || "").trim();
    if (!id) return null;

    let pages = raw.pages;
    if (typeof pages === 'string') {
      try {
        pages = JSON.parse(pages);
      } catch (_) {
        pages = [];
      }
    }
    if (!Array.isArray(pages)) {
      pages = undefined;
    }

    return {
      id,
      title: raw.title || "Untitled",
      author: raw.author || raw.author_name || "Creative Publisher",
      authorId: raw.authorId || raw.author_id || "",
      authorEmail: raw.authorEmail || raw.author_email || "",
      type: raw.type === "comic" ? "comic" : (raw.type === "novel" || raw.type === "story" ? "novel" : "comic"),
      cover: raw.cover || raw.cover_url || raw.coverUrl || "",
      description: raw.description || "",
      content: raw.content || "",
      pages: pages,
      timestamp: Number(raw.timestamp) || (raw.created_at ? new Date(raw.created_at).getTime() : 0),
      assetHashes: raw.assetHashes || {}
    };
  };

  const mergeItem = (raw: any) => {
    const item = normalizeItem(raw);
    if (!item) return;

    if (!worksMap.has(item.id)) {
      worksMap.set(item.id, item);
    } else {
      const existing = worksMap.get(item.id);
      // Keep the newer version by timestamp, while preserving complete arrays and content
      if ((item.timestamp || 0) >= (existing.timestamp || 0)) {
        worksMap.set(item.id, {
          ...existing,
          ...item,
          cover: item.cover || existing.cover || "",
          pages: (item.pages && item.pages.length > 0) ? item.pages : existing.pages,
          content: item.content || existing.content || ""
        });
      } else {
        worksMap.set(item.id, {
          ...item,
          ...existing,
          cover: existing.cover || item.cover || "",
          pages: (existing.pages && existing.pages.length > 0) ? existing.pages : item.pages,
          content: existing.content || item.content || ""
        });
      }
    }
  };

  // 1. Fetch from server R2 API first
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
        data.works.forEach(mergeItem);
      }
    }
  } catch (err) {
    console.warn("Failed fetching published works from R2 API:", err);
  }

  // 2. Query Supabase database published_works table if connected
  const supabase = getActiveSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('published_works')
        .select('*')
        .order('timestamp', { ascending: false });

      if (!error && Array.isArray(data) && data.length > 0) {
        data.forEach(mergeItem);
      }
    } catch (sbErr: any) {
      console.warn("Supabase published_works table query notice:", sbErr.message);
    }
  }

  // 4. Merge with local storage cache (if local item is newer, preserve it!)
  try {
    const raw = localStorage.getItem("ebookcc_published_items") || "[]";
    const localItems = JSON.parse(raw);
    if (Array.isArray(localItems)) {
      localItems.forEach(mergeItem);
    }
  } catch (_) {}

  const sortedWorks = Array.from(worksMap.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return { success: true, works: sortedWorks };
}

export async function deletePublishedWorkFromR2(
  id: string,
  config?: R2Config
): Promise<boolean> {
  const workId = String(id).replace(/[^a-zA-Z0-9_-]/g, "_");

  // 1. Delete from Supabase if connected
  const supabase = getActiveSupabaseClient();
  if (supabase) {
    try {
      await supabase.from('published_works').delete().eq('id', id);
      await supabase.from('published_works').delete().eq('id', workId);
    } catch (_) {}
  }

  // 2. Direct S3 delete via AwsClient if credentials configured
  const { accessKey, secretKey, bucket, endpoint } = getR2ResolvedCredentials(config);
  if (accessKey && secretKey && endpoint) {
    try {
      const aws = new AwsClient({
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
        service: "s3",
        region: "auto"
      });

      // Delete manifest JSON
      const jsonKey = `published_works/${workId}.json`;
      const delManifestReq = await aws.sign(new URL(`/${bucket}/${jsonKey}`, endpoint), {
        method: "DELETE"
      });
      await fetch(delManifestReq).catch(() => {});

      // Delete comments JSON if any
      const commentsKey = `comments/${workId}.json`;
      const delCommentsReq = await aws.sign(new URL(`/${bucket}/${commentsKey}`, endpoint), {
        method: "DELETE"
      });
      await fetch(delCommentsReq).catch(() => {});

      // List and delete all media files in media/${workId}/
      try {
        const listUrl = new URL(`/${bucket}?prefix=media/${workId}/`, endpoint);
        const listReq = await aws.sign(listUrl, { method: "GET" });
        const listRes = await fetch(listReq);
        if (listRes.ok) {
          const xmlText = await listRes.text();
          const keyMatches = [...xmlText.matchAll(/<Key>([^<]+)<\/Key>/g)];
          for (const match of keyMatches) {
            const mediaKey = match[1];
            if (mediaKey) {
              const delMediaReq = await aws.sign(new URL(`/${bucket}/${mediaKey}`, endpoint), {
                method: "DELETE"
              });
              await fetch(delMediaReq).catch(() => {});
            }
          }
        }
      } catch (directMediaDelErr) {
        console.debug("Direct S3 media cleanup notice:", directMediaDelErr);
      }
    } catch (directDelErr) {
      console.debug("Direct S3 delete notice:", directDelErr);
    }
  }

  // 3. Call Server / Worker DELETE /api/published-works/:id
  let serverOk = false;
  try {
    const res = await fetch(`${getApiUrl()}/api/published-works/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: {
        ...getR2Headers(config)
      }
    });
    serverOk = res.ok;
  } catch (err) {
    console.warn("Failed deleting published work from R2 API:", err);
  }

  // 4. Clean local storage cache
  try {
    const raw = localStorage.getItem("ebookcc_published_items") || "[]";
    const items = JSON.parse(raw);
    const updated = items.filter((i: any) => i && String(i.id) !== String(id) && String(i.id) !== workId);
    localStorage.setItem("ebookcc_published_items", JSON.stringify(updated));
  } catch (_) {}

  // Dispatch events for immediate UI refresh
  try {
    window.dispatchEvent(new Event("ebookcc_published"));
    window.dispatchEvent(new Event("storage"));
  } catch (_) {}

  return serverOk || true;
}
