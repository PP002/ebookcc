export interface R2Config {
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2BucketName?: string;
  r2Endpoint?: string;
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
    const res = await fetch("/api/media/test-r2", {
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

    const presignRes = await fetch("/api/get-presigned-url", {
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
  try {
    const res = await fetch("/api/published-works", {
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
  try {
    const res = await fetch("/api/published-works", {
      method: "GET",
      headers: {
        ...getR2Headers(config)
      }
    });

    if (!res.ok) return { success: false, works: [] };
    const data = await res.json();
    if (data && Array.isArray(data.works)) {
      return { success: true, works: data.works };
    }
    return { success: false, works: [] };
  } catch (err) {
    console.warn("Failed fetching published works from R2 API:", err);
    return { success: false, works: [] };
  }
}

export async function deletePublishedWorkFromR2(
  id: string,
  config?: R2Config
): Promise<boolean> {
  try {
    const res = await fetch(`/api/published-works/${encodeURIComponent(id)}`, {
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
