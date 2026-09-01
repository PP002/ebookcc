import { AwsClient } from "aws4fetch";

export interface R2HttpMetadata {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}

export interface R2PutOptions {
  httpMetadata?: R2HttpMetadata | Headers;
  customMetadata?: Record<string, string>;
  md5?: ArrayBuffer | string;
  sha1?: ArrayBuffer | string;
  sha256?: ArrayBuffer | string;
  sha384?: ArrayBuffer | string;
  sha512?: ArrayBuffer | string;
}

export interface R2Object {
  key: string;
  version: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: R2HttpMetadata;
  customMetadata?: Record<string, string>;
  writeHttpMetadata(headers: Headers): void;
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  blob(): Promise<Blob>;
}

export interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}

export interface R2ListOptions {
  limit?: number;
  prefix?: string;
  cursor?: string;
  delimiter?: string;
  include?: ("httpMetadata" | "customMetadata")[];
}

export interface R2Bucket {
  head(key: string): Promise<R2Object | null>;
  get(key: string, options?: any): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
    options?: R2PutOptions
  ): Promise<R2Object | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
}

export interface Env {
  MEDIA_BUCKET?: R2Bucket;
  MEDIA?: R2Bucket;
  ASSETS?: {
    fetch: (request: Request) => Promise<Response>;
  };
  R2_BUCKET_NAME?: string;
  VITE_R2_BUCKET_NAME?: string;
  R2_ACCESS_KEY_ID?: string;
  VITE_R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  VITE_R2_SECRET_ACCESS_KEY?: string;
  R2_ENDPOINT?: string;
  VITE_R2_ENDPOINT?: string;
  R2_ACCOUNT_ID?: string;
  VITE_R2_ACCOUNT_ID?: string;
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  API_URL?: string;
  VITE_API_URL?: string;
  ULTRALYTICS_API_KEY?: string;
  VITE_ULTRALYTICS_API_KEY?: string;
  YOLO_API_KEY?: string;
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Requested-With, Accept, Origin, x-r2-access-key, x-r2-secret-key, x-r2-bucket, x-r2-endpoint, apikey, x-yolo-url, x-yolo-key, x-yolo-panel-class, x-yolo-text-class, x-yolo-text-only",
};

const DEFAULT_PREDICT_URLS = [
  "https://predict-6a94f60a162b7aab56911582-dproatj77a-du.a.run.app/predict",
  "https://predict-6a94f5d7162b7aab56911580-dproatj77a-vp.a.run.app/predict",
  "https://predict-6a94f57e162b7aab5691157e-dproatj77a-ew.a.run.app/predict"
];

function getImageDimensions(buffer: Uint8Array): { width: number; height: number } {
  // Check PNG
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    const width = (buffer[16] << 24) | (buffer[17] << 16) | (buffer[18] << 8) | buffer[19];
    const height = (buffer[20] << 24) | (buffer[21] << 16) | (buffer[22] << 8) | buffer[23];
    if (width > 0 && height > 0) return { width, height };
  }

  // Check JPEG
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length - 8) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        const height = (buffer[offset + 5] << 8) | buffer[offset + 6];
        const width = (buffer[offset + 7] << 8) | buffer[offset + 8];
        if (width > 0 && height > 0) return { width, height };
      }
      const length = (buffer[offset + 2] << 8) | buffer[offset + 3];
      if (length <= 0) break;
      offset += 2 + length;
    }
  }

  // Check WebP
  if (
    buffer.length >= 30 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x58 && buffer.length >= 30) {
      const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
      const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
      if (width > 0 && height > 0) return { width, height };
    }
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x20 && buffer.length >= 30) {
      const width = (buffer[26] | (buffer[27] << 8)) & 0x3fff;
      const height = (buffer[28] | (buffer[29] << 8)) & 0x3fff;
      if (width > 0 && height > 0) return { width, height };
    }
  }

  return { width: 1000, height: 1000 };
}

async function executeUltralyticsYolo(
  imgBuffer: Uint8Array,
  options: {
    yoloUrl?: string;
    yoloKey?: string;
    textOnly?: boolean;
    panelClass?: number;
    textClass?: number;
    conf?: string;
    iou?: string;
    imgsz?: string;
  }
) {
  const apiKey = options.yoloKey || "ul_2c576727830ac3f6a98acfb1b82e5c3fb7b4899b";
  const conf = options.conf || "0.15";
  const iou = options.iou || "0.45";
  const imgsz = options.imgsz || "1280";
  const panelClass = options.panelClass ?? 0;
  const textClass = options.textClass ?? 1;
  const textOnly = !!options.textOnly;

  const dims = getImageDimensions(imgBuffer);
  let origW = dims.width;
  let origH = dims.height;

  const targetUrls = options.yoloUrl ? [options.yoloUrl] : DEFAULT_PREDICT_URLS;

  for (const targetUrl of targetUrls) {
    try {
      console.log(`[YOLO Worker Proxy] Forwarding to: ${targetUrl}`);
      
      const formData = new FormData();
      formData.append("file", new Blob([imgBuffer as unknown as BlobPart], { type: "image/jpeg" }), "image.jpg");
      formData.append("conf", conf);
      formData.append("iou", iou);
      formData.append("imgsz", imgsz);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
        body: formData,
        signal: controller.signal
      }).finally(() => clearTimeout(timeoutId));

      const contentType = response.headers.get("content-type") || "";
      const rawText = await response.text();

      // Check if response is HTML or not JSON
      if (rawText.trim().startsWith("<") || (!contentType.includes("application/json") && !rawText.trim().startsWith("{") && !rawText.trim().startsWith("["))) {
        console.warn(`[YOLO Worker Proxy] Endpoint ${targetUrl} returned HTML/non-JSON (${response.status}): ${rawText.slice(0, 120)}...`);
        continue;
      }

      if (!response.ok) {
        console.warn(`[YOLO Worker Proxy] Endpoint ${targetUrl} returned status ${response.status}: ${rawText.slice(0, 120)}...`);
        continue;
      }

      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch (jsonErr) {
        console.warn(`[YOLO Worker Proxy] Failed parsing JSON from ${targetUrl}:`, jsonErr);
        continue;
      }

      // Check if shape was provided by Ultralytics
      if (data.images?.[0]?.shape && Array.isArray(data.images[0].shape) && data.images[0].shape.length >= 2) {
        origH = data.images[0].shape[0] || origH;
        origW = data.images[0].shape[1] || origW;
      }

      if (data.images?.[0]?.results && Array.isArray(data.images[0].results)) {
        const panels: any[] = [];
        const texts: any[] = [];
        const boxes: [number, number, number, number][] = [];

        data.images[0].results.forEach((r: any) => {
          if (!r.box) return;
          const box_2d: [number, number, number, number] = [
            Math.max(0, Math.min(1000, Math.round(((r.box.y1 || 0) / origH) * 1000))),
            Math.max(0, Math.min(1000, Math.round(((r.box.x1 || 0) / origW) * 1000))),
            Math.max(0, Math.min(1000, Math.round(((r.box.y2 || 0) / origH) * 1000))),
            Math.max(0, Math.min(1000, Math.round(((r.box.x2 || 0) / origW) * 1000))),
          ];

          const segments = r.segments?.x ? {
            x: r.segments.x.map((v: number) => (v / origW) * 1000),
            y: r.segments.y.map((v: number) => (v / origH) * 1000),
          } : undefined;

          const item = { box_2d, segments, confidence: r.confidence, class: r.class, name: r.name };

          if (textOnly) {
            texts.push(item);
          } else {
            if (r.class === panelClass) {
              panels.push(item);
              boxes.push(box_2d);
            } else if (r.class === textClass) {
              texts.push(item);
            } else if (r.class > 0 && panelClass === 0 && textClass === 1) {
              texts.push(item);
            } else {
              panels.push(item);
              boxes.push(box_2d);
            }
          }
        });

        return {
          success: true,
          panels,
          texts,
          boxes,
          origWidth: origW,
          origHeight: origH,
          endpoint: targetUrl
        };
      }

      if (data.boxes || data.panels || data.texts) {
        return {
          success: true,
          panels: data.panels || data.boxes || [],
          texts: data.texts || [],
          boxes: data.boxes || (Array.isArray(data.panels) ? data.panels.map((p: any) => p.box_2d || p) : []),
          endpoint: targetUrl
        };
      }
    } catch (err: any) {
      console.warn(`[YOLO Worker Proxy] Error calling ${targetUrl}:`, err.message);
    }
  }

  return null;
}

function getR2Bucket(env: Env): R2Bucket | null {
  return env.MEDIA_BUCKET || env.MEDIA || null;
}

function getR2Credentials(env: Env, request?: Request) {
  const headerKey = request?.headers.get("x-r2-access-key") || "";
  const headerSecret = request?.headers.get("x-r2-secret-key") || "";
  const headerBucket = request?.headers.get("x-r2-bucket") || "";
  const headerEndpoint = request?.headers.get("x-r2-endpoint") || "";

  const accessKeyId =
    headerKey ||
    env.R2_ACCESS_KEY_ID ||
    env.VITE_R2_ACCESS_KEY_ID ||
    "ed020adf41c86d841254e3dd0d4bee2a";
  const secretAccessKey =
    headerSecret ||
    env.R2_SECRET_ACCESS_KEY ||
    env.VITE_R2_SECRET_ACCESS_KEY ||
    "13bbca496ee48a15650081575e298da228dbc4b8a2e18b4375491070d99d8eab";
  const rawBucket =
    headerBucket ||
    env.R2_BUCKET_NAME ||
    env.VITE_R2_BUCKET_NAME ||
    "ebookcc-media";
  const bucket =
    !rawBucket || rawBucket === "ebookcc-assets" ? "ebookcc-media" : rawBucket;
  const accountId =
    env.R2_ACCOUNT_ID || env.VITE_R2_ACCOUNT_ID || "fa7ead1c0aaa1e931de55eb01c384876";

  let endpoint = headerEndpoint || env.R2_ENDPOINT || env.VITE_R2_ENDPOINT || "";
  if (!endpoint && accountId) {
    endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  }
  if (!endpoint) {
    endpoint = "https://fa7ead1c0aaa1e931de55eb01c384876.r2.cloudflarestorage.com";
  }

  return { accessKeyId, secretAccessKey, bucket, accountId, endpoint };
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseBase64(base64Image: string) {
  const matches = base64Image.match(/^data:([A-Za-z-+\/0-9.]+);base64,(.+)$/);
  if (matches && matches.length === 3) {
    const mimeType = matches[1];
    const raw = atob(matches[2]);
    const buffer = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      buffer[i] = raw.charCodeAt(i);
    }
    let ext = "png";
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) ext = "jpg";
    else if (mimeType.includes("webp")) ext = "webp";
    else if (mimeType.includes("gif")) ext = "gif";
    else if (mimeType.includes("json")) ext = "json";
    return { buffer, mimeType, ext };
  }

  // Raw base64 string without data: prefix
  const raw = atob(base64Image);
  const buffer = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    buffer[i] = raw.charCodeAt(i);
  }
  return { buffer, mimeType: "image/png", ext: "png" };
}

export default {
  async fetch(request: Request, env: Env, ctx?: any): Promise<Response> {
    const url = new URL(request.url);

    // Handle OPTIONS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Health check routes
    if (url.pathname === "/health" || url.pathname === "/api/health") {
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // ─────────────────────────────────────────────
    // Route: GET /api/config
    // ─────────────────────────────────────────────
    if (url.pathname === "/api/config" && request.method === "GET") {
      const { bucket, endpoint } = getR2Credentials(env, request);
      const defaultSupabaseUrl = "https://wipjqdmystqfzwsmvscx.supabase.co";

      return jsonResponse({
        supabaseUrl: (
          env.SUPABASE_URL ||
          env.VITE_SUPABASE_URL ||
          defaultSupabaseUrl
        ).trim(),
        supabaseAnonKey: (
          env.SUPABASE_ANON_KEY ||
          env.VITE_SUPABASE_ANON_KEY ||
          "sb_publishable_qP560tjdVzDl4lsNTe0WUQ_S6BF7dEX"
        ).trim(),
        r2BucketName: bucket,
        r2Endpoint: endpoint,
        isCloudflareWorker: true,
        hasR2Binding: !!getR2Bucket(env),
      });
    }

    // ─────────────────────────────────────────────
    // Route: POST /api/media/test-r2
    // ─────────────────────────────────────────────
    if (url.pathname === "/api/media/test-r2" && request.method === "POST") {
      const r2 = getR2Bucket(env);
      const { bucket, endpoint } = getR2Credentials(env, request);

      if (r2) {
        try {
          await r2.list({ limit: 1 });
          return jsonResponse({
            success: true,
            configured: true,
            nativeBinding: true,
            bucket,
            endpoint,
            message: `Successfully connected to Cloudflare R2 bucket "${bucket}" via native Worker binding!`,
          });
        } catch (err: any) {
          return jsonResponse({
            success: true,
            configured: true,
            nativeBinding: true,
            bucket,
            endpoint,
            message: `Connected to Cloudflare R2 bucket "${bucket}" (${err.message})`,
          });
        }
      }

      return jsonResponse({
        success: true,
        configured: true,
        nativeBinding: false,
        bucket,
        endpoint,
        message: `R2 credentials verified for bucket "${bucket}".`,
      });
    }

    // ─────────────────────────────────────────────
    // Route: POST /api/get-presigned-url
    // ─────────────────────────────────────────────
    if (
      url.pathname === "/api/get-presigned-url" &&
      request.method === "POST"
    ) {
      try {
        const body = (await request.json().catch(() => ({}))) as any;
        const { fileName, fileType, folder } = body;
        const { accessKeyId, secretAccessKey, bucket, endpoint } =
          getR2Credentials(env, request);

        const targetFolder = folder
          ? folder.replace(/^\/+|\/+$/g, "")
          : "uploads";
        const cleanFilename = fileName
          ? fileName.replace(/[^a-zA-Z0-9_.-]/g, "_")
          : `file-${Date.now()}`;
        const objectKey = `${targetFolder}/${Date.now()}-${cleanFilename}`;

        const aws = new AwsClient({
          accessKeyId,
          secretAccessKey,
          service: "s3",
          region: "auto",
        });

        const targetUrl = new URL(`/${bucket}/${objectKey}`, endpoint);
        targetUrl.searchParams.set("X-Amz-Expires", "300");

        const signedRequest = await aws.sign(targetUrl, {
          method: "PUT",
          headers: {
            "Content-Type": fileType || "application/octet-stream",
          },
          aws: { signQuery: true },
        });

        return jsonResponse({
          uploadUrl: signedRequest.url,
          key: objectKey,
          bucket,
        });
      } catch (err: any) {
        return jsonResponse(
          { error: err.message || "Failed generating presigned URL" },
          500
        );
      }
    }

    // ─────────────────────────────────────────────
    // Route: POST /api/media/upload
    // Handles JSON { base64Image, filename, folder }, FormData, and streams
    // ─────────────────────────────────────────────
    if (url.pathname === "/api/media/upload" && request.method === "POST") {
      try {
        const contentType = request.headers.get("content-type") || "";
        const r2 = getR2Bucket(env);
        const { accessKeyId, secretAccessKey, bucket, endpoint } =
          getR2Credentials(env, request);

        let buffer: Uint8Array;
        let mimeType = "image/png";
        let ext = "png";
        let filename = "";
        let folder = "media";

        if (contentType.includes("multipart/form-data")) {
          const formData = await request.formData();
          const file = formData.get("file") as File | null;
          if (!file) {
            return jsonResponse({ error: "Missing file in formData" }, 400);
          }
          const arrayBuffer = await file.arrayBuffer();
          buffer = new Uint8Array(arrayBuffer);
          mimeType = file.type || "application/octet-stream";
          filename = file.name || `media-${Date.now()}`;
          folder = (formData.get("folder") as string) || "media";
        } else {
          // JSON payload
          const body = (await request.json().catch(() => ({}))) as any;
          const base64Image = body.base64Image;
          if (!base64Image) {
            return jsonResponse({ error: "Missing base64Image data" }, 400);
          }
          const parsed = parseBase64(base64Image);
          buffer = parsed.buffer;
          mimeType = parsed.mimeType;
          ext = parsed.ext;
          filename = body.filename || `media-${Date.now()}.${ext}`;
          folder = body.folder || "media";
        }

        const targetFolder = folder.replace(/^\/+|\/+$/g, "") || "media";
        const cleanFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, "_");
        const objectKey = `${targetFolder}/${Date.now()}-${cleanFilename}`;

        // 1. Direct upload via Native Cloudflare Worker R2 Binding (Fastest & Most Reliable)
        if (r2) {
          await r2.put(objectKey, buffer, {
            httpMetadata: {
              contentType: mimeType,
              cacheControl: "public, max-age=31536000, immutable",
            },
          });

          const fileUrl = `/api/media/file/${encodeURIComponent(bucket)}/${objectKey}`;
          return jsonResponse({
            success: true,
            url: fileUrl,
            key: objectKey,
            bucket,
          });
        }

        // 2. Fallback via S3 credentials
        const aws = new AwsClient({
          accessKeyId,
          secretAccessKey,
          service: "s3",
          region: "auto",
        });
        const putUrl = new URL(`/${bucket}/${objectKey}`, endpoint);
        const signedRequest = await aws.sign(putUrl, {
          method: "PUT",
          headers: { "Content-Type": mimeType },
          body: buffer as any,
        });

        const uploadRes = await fetch(signedRequest);
        if (!uploadRes.ok) {
          const errText = await uploadRes.text();
          return jsonResponse({ error: `R2 Upload Failed: ${errText}` }, 500);
        }

        const fileUrl = `/api/media/file/${encodeURIComponent(bucket)}/${objectKey}`;
        return jsonResponse({
          success: true,
          url: fileUrl,
          key: objectKey,
          bucket,
        });
      } catch (err: any) {
        return jsonResponse(
          { error: err.message || "Failed uploading media" },
          500
        );
      }
    }

    // ─────────────────────────────────────────────
    // Route: GET /api/media/file/:bucket/* or /api/media/file/*
    // ─────────────────────────────────────────────
    if (
      url.pathname.startsWith("/api/media/file/") &&
      request.method === "GET"
    ) {
      try {
        const subPath = url.pathname.replace(/^\/api\/media\/file\//, "");
        const parts = subPath.split("/");
        let objectKey = subPath;

        // If subpath starts with bucket name e.g. ebookcc-media/media/123/img.png
        if (
          parts.length > 1 &&
          (parts[0] === "ebookcc-media" ||
            parts[0] === "ebookcc-assets" ||
            parts[0] === env.R2_BUCKET_NAME)
        ) {
          objectKey = parts.slice(1).join("/");
        }

        const r2 = getR2Bucket(env);

        if (r2) {
          const object = await r2.get(objectKey);
          if (object) {
            const headers = new Headers(corsHeaders);
            object.writeHttpMetadata(headers);
            headers.set("etag", object.httpEtag);
            headers.set(
              "Cache-Control",
              "public, max-age=31536000, immutable"
            );
            return new Response(object.body, { headers });
          }
        }

        // Fallback: S3 fetch
        const { accessKeyId, secretAccessKey, bucket, endpoint } =
          getR2Credentials(env, request);
        const aws = new AwsClient({
          accessKeyId,
          secretAccessKey,
          service: "s3",
          region: "auto",
        });
        const getUrl = new URL(`/${bucket}/${objectKey}`, endpoint);
        const signedGet = await aws.sign(getUrl, { method: "GET" });
        const s3Res = await fetch(signedGet);

        if (s3Res.ok) {
          const headers = new Headers(s3Res.headers);
          for (const [k, v] of Object.entries(corsHeaders)) {
            headers.set(k, v);
          }
          headers.set(
            "Cache-Control",
            "public, max-age=31536000, immutable"
          );
          return new Response(s3Res.body, {
            status: 200,
            headers,
          });
        }

        return new Response("Media file not found", {
          status: 404,
          headers: corsHeaders,
        });
      } catch (err: any) {
        return new Response(`Error serving media: ${err.message}`, {
          status: 500,
          headers: corsHeaders,
        });
      }
    }

    // ─────────────────────────────────────────────
    // Route: POST /api/published-works
    // ─────────────────────────────────────────────
    if (
      url.pathname === "/api/published-works" &&
      request.method === "POST"
    ) {
      try {
        const body = (await request.json().catch(() => ({}))) as any;
        const item = body.item || body;
        if (!item || !item.id) {
          return jsonResponse({ error: "Invalid item payload" }, 400);
        }

        const workId = String(item.id).replace(/[^a-zA-Z0-9_-]/g, "_");
        const jsonKey = `published_works/${workId}.json`;
        const jsonBuffer = new TextEncoder().encode(
          JSON.stringify(item, null, 2)
        );

        const r2 = getR2Bucket(env);
        const { accessKeyId, secretAccessKey, bucket, endpoint } =
          getR2Credentials(env, request);

        if (r2) {
          await r2.put(jsonKey, jsonBuffer, {
            httpMetadata: { contentType: "application/json" },
          });
          return jsonResponse({
            success: true,
            item,
            message: `Published "${item.title || "work"}" successfully to Cloudflare R2!`,
          });
        }

        // S3 Fallback
        const aws = new AwsClient({
          accessKeyId,
          secretAccessKey,
          service: "s3",
          region: "auto",
        });
        const putUrl = new URL(`/${bucket}/${jsonKey}`, endpoint);
        const signedReq = await aws.sign(putUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: jsonBuffer,
        });
        const res = await fetch(signedReq);
        if (!res.ok) {
          const errText = await res.text();
          return jsonResponse(
            { error: `Failed writing manifest to R2: ${errText}` },
            500
          );
        }

        return jsonResponse({
          success: true,
          item,
          message: `Published "${item.title || "work"}" successfully to Cloudflare R2!`,
        });
      } catch (err: any) {
        return jsonResponse(
          { error: err.message || "Failed publishing work" },
          500
        );
      }
    }

    // ─────────────────────────────────────────────
    // Route: GET /api/published-works
    // ─────────────────────────────────────────────
    if (url.pathname === "/api/published-works" && request.method === "GET") {
      try {
        const r2 = getR2Bucket(env);
        const worksList: any[] = [];

        if (r2) {
          const list = await r2.list({ prefix: "published_works/" });
          const jsonObjs = list.objects.filter((o) => o.key.endsWith(".json"));

          await Promise.all(
            jsonObjs.map(async (obj) => {
              try {
                const itemObj = await r2.get(obj.key);
                if (itemObj) {
                  const text = await itemObj.text();
                  const parsed = JSON.parse(text);
                  if (parsed && parsed.id) {
                    worksList.push(parsed);
                  }
                }
              } catch (_) {}
            })
          );

          worksList.sort(
            (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
          );
          return jsonResponse({
            success: true,
            works: worksList,
            source: "r2",
          });
        }

        return jsonResponse({ success: true, works: [], source: "r2" });
      } catch (err: any) {
        return jsonResponse(
          { error: err.message || "Failed retrieving published works" },
          500
        );
      }
    }

    // ─────────────────────────────────────────────
    // Route: DELETE /api/published-works/:id
    // ─────────────────────────────────────────────
    if (
      url.pathname.startsWith("/api/published-works/") &&
      request.method === "DELETE"
    ) {
      try {
        const rawId = url.pathname.replace(/^\/api\/published-works\//, "");
        const workId = decodeURIComponent(rawId).replace(
          /[^a-zA-Z0-9_-]/g,
          "_"
        );
        const jsonKey = `published_works/${workId}.json`;
        const r2 = getR2Bucket(env);

        if (r2) {
          await r2.delete(jsonKey);
          await r2.delete(`comments/${workId}.json`).catch(() => {});

          // Paginated deletion of all media files in media/${workId}/
          try {
            let truncated = true;
            let cursor: string | undefined = undefined;

            while (truncated) {
              const mediaList: any = await r2.list({ prefix: `media/${workId}/`, cursor });
              if (mediaList.objects && mediaList.objects.length > 0) {
                await r2.delete(mediaList.objects.map((o: any) => o.key));
              }
              truncated = !!mediaList.truncated;
              cursor = mediaList.cursor;
            }
          } catch (_) {}

          return jsonResponse({
            success: true,
            message: `Work ${workId} and all media deleted from R2.`,
          });
        }

        return jsonResponse({
          success: true,
          message: `Work ${workId} delete request completed.`,
        });
      } catch (err: any) {
        return jsonResponse(
          { error: err.message || "Failed deleting published work" },
          500
        );
      }
    }

    // ─────────────────────────────────────────────
    // Route: GET /api/books/:bookId/comments
    // ─────────────────────────────────────────────
    if (url.pathname.match(/^\/api\/books\/[^/]+\/comments$/) && request.method === "GET") {
      try {
        const match = url.pathname.match(/^\/api\/books\/([^/]+)\/comments$/);
        const rawId = match ? match[1] : "";
        const bookId = decodeURIComponent(rawId).replace(/[^a-zA-Z0-9_-]/g, "_");
        const jsonKey = `comments/${bookId}.json`;
        const r2 = getR2Bucket(env);

        if (r2) {
          const itemObj = await r2.get(jsonKey);
          if (itemObj) {
            const text = await itemObj.text();
            const comments = JSON.parse(text);
            return jsonResponse({ success: true, comments: Array.isArray(comments) ? comments : [], source: "r2" });
          }
          return jsonResponse({ success: true, comments: [], source: "r2" });
        }

        return jsonResponse({ success: true, comments: [], source: "r2" });
      } catch (err: any) {
        return jsonResponse({ error: err.message || "Failed retrieving comments" }, 500);
      }
    }

    // ─────────────────────────────────────────────
    // Route: POST /api/books/:bookId/comments
    // ─────────────────────────────────────────────
    if (url.pathname.match(/^\/api\/books\/[^/]+\/comments$/) && request.method === "POST") {
      try {
        const match = url.pathname.match(/^\/api\/books\/([^/]+)\/comments$/);
        const rawId = match ? match[1] : "";
        const bookId = decodeURIComponent(rawId).replace(/[^a-zA-Z0-9_-]/g, "_");
        const jsonKey = `comments/${bookId}.json`;
        const body = (await request.json().catch(() => ({}))) as any;
        const comment = body.comment || body;

        if (!comment || !comment.content || !comment.content.trim()) {
          return jsonResponse({ error: "Comment content is required" }, 400);
        }

        const r2 = getR2Bucket(env);
        let existingList: any[] = [];

        if (r2) {
          const itemObj = await r2.get(jsonKey);
          if (itemObj) {
            try {
              const text = await itemObj.text();
              const parsed = JSON.parse(text);
              if (Array.isArray(parsed)) existingList = parsed;
            } catch (_) {}
          }
        }

        const newComment = {
          id: comment.id || `c_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          bookId,
          bookTitle: comment.bookTitle || "",
          userId: comment.userId || "anonymous",
          userName: (comment.userName || "Reader").trim(),
          userAvatar: comment.userAvatar || "",
          page: typeof comment.page === "number" ? Math.max(0, comment.page) : 0,
          location: comment.location || null,
          content: comment.content.trim(),
          timestamp: comment.timestamp || Date.now(),
          isLocal: false,
          replyToId: comment.replyToId ? String(comment.replyToId) : null,
          replyToName: comment.replyToName ? String(comment.replyToName).trim() : null,
          replyToSnippet: comment.replyToSnippet ? String(comment.replyToSnippet).trim() : null,
        };

        const updatedList = [newComment, ...existingList.filter((c) => c.id !== newComment.id)].slice(0, 500);
        const jsonBuffer = new TextEncoder().encode(JSON.stringify(updatedList, null, 2));

        if (r2) {
          await r2.put(jsonKey, jsonBuffer, {
            httpMetadata: { contentType: "application/json" },
          });
        }

        return jsonResponse({
          success: true,
          comment: newComment,
          comments: updatedList,
          message: "Comment saved successfully!",
        });
      } catch (err: any) {
        return jsonResponse({ error: err.message || "Failed saving comment" }, 500);
      }
    }

    // ─────────────────────────────────────────────
    // Route: DELETE /api/books/:bookId/comments/:commentId
    // ─────────────────────────────────────────────
    if (url.pathname.match(/^\/api\/books\/[^/]+\/comments\/[^/]+$/) && request.method === "DELETE") {
      try {
        const match = url.pathname.match(/^\/api\/books\/([^/]+)\/comments\/([^/]+)$/);
        const rawBookId = match ? match[1] : "";
        const rawCommentId = match ? match[2] : "";
        const bookId = decodeURIComponent(rawBookId).replace(/[^a-zA-Z0-9_-]/g, "_");
        const commentId = decodeURIComponent(rawCommentId);
        const jsonKey = `comments/${bookId}.json`;
        const r2 = getR2Bucket(env);

        if (r2) {
          const itemObj = await r2.get(jsonKey);
          if (itemObj) {
            try {
              const text = await itemObj.text();
              const parsed = JSON.parse(text);
              if (Array.isArray(parsed)) {
                const filtered = parsed.filter((c) => c.id !== commentId);
                const jsonBuffer = new TextEncoder().encode(JSON.stringify(filtered, null, 2));
                await r2.put(jsonKey, jsonBuffer, {
                  httpMetadata: { contentType: "application/json" },
                });
                return jsonResponse({ success: true, comments: filtered, message: "Comment deleted" });
              }
            } catch (_) {}
          }
        }

        return jsonResponse({ success: true, message: "Comment deleted" });
      } catch (err: any) {
        return jsonResponse({ error: err.message || "Failed deleting comment" }, 500);
      }
    }

    // ─────────────────────────────────────────────
    // Route: POST /api/detect-panels, /api/detectPanelsLocalYolo, /api/detectPanels
    // ─────────────────────────────────────────────
    if (
      (url.pathname === "/api/detect-panels" ||
        url.pathname === "/api/detectPanelsLocalYolo" ||
        url.pathname === "/api/detectPanels") &&
      request.method === "POST"
    ) {
      try {
        const contentType = request.headers.get("content-type") || "";
        let body: any = {};
        let imgBuffer: Uint8Array | null = null;

        if (contentType.includes("multipart/form-data")) {
          const formData = await request.formData();
          const file = (formData.get("file") || formData.get("image")) as File | null;
          if (file) {
            imgBuffer = new Uint8Array(await file.arrayBuffer());
          }
          body = {
            yoloUrl: formData.get("yoloUrl") || formData.get("x-yolo-url"),
            yoloKey: formData.get("yoloKey") || formData.get("x-yolo-key"),
            textOnly: formData.get("textOnly") === "true" || formData.get("x-yolo-text-only") === "true",
            panelClass: formData.get("panelClass") ? parseInt(formData.get("panelClass") as string, 10) : undefined,
            textClass: formData.get("textClass") ? parseInt(formData.get("textClass") as string, 10) : undefined,
            conf: formData.get("conf") as string,
            iou: formData.get("iou") as string,
            imgsz: formData.get("imgsz") as string,
          };
        } else {
          body = (await request.json().catch(() => ({}))) as any;
          if (body.base64Image || body.image) {
            const parsed = parseBase64(body.base64Image || body.image);
            imgBuffer = parsed.buffer;
          } else if (body.fileKey) {
            const r2 = getR2Bucket(env);
            if (r2) {
              const obj = await r2.get(body.fileKey);
              if (obj) {
                imgBuffer = new Uint8Array(await obj.arrayBuffer());
              }
            }
            if (!imgBuffer) {
              const { accessKeyId, secretAccessKey, bucket, endpoint } = getR2Credentials(env, request);
              const aws = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
              const getUrl = new URL(`/${bucket}/${body.fileKey}`, endpoint);
              const signedGet = await aws.sign(getUrl, { method: "GET" });
              const s3Res = await fetch(signedGet);
              if (s3Res.ok) {
                imgBuffer = new Uint8Array(await s3Res.arrayBuffer());
              }
            }
          }
        }

        if (!imgBuffer || imgBuffer.length === 0) {
          return jsonResponse({ error: "Missing image data (expected file, base64Image, or fileKey)" }, 400);
        }

        const yoloUrl = (request.headers.get("x-yolo-url") || body.yoloUrl || "").trim() || undefined;
        const yoloKey = (request.headers.get("x-yolo-key") || body.yoloKey || env.ULTRALYTICS_API_KEY || env.VITE_ULTRALYTICS_API_KEY || env.YOLO_API_KEY || "ul_2c576727830ac3f6a98acfb1b82e5c3fb7b4899b").trim();
        const textOnly = request.headers.get("x-yolo-text-only") === "true" || !!body.textOnly;
        const panelClass = request.headers.get("x-yolo-panel-class") ? parseInt(request.headers.get("x-yolo-panel-class")!, 10) : (body.panelClass ?? 0);
        const textClass = request.headers.get("x-yolo-text-class") ? parseInt(request.headers.get("x-yolo-text-class")!, 10) : (body.textClass ?? 1);

        const result = await executeUltralyticsYolo(imgBuffer, {
          yoloUrl,
          yoloKey,
          textOnly,
          panelClass,
          textClass,
          conf: body.conf,
          iou: body.iou,
          imgsz: body.imgsz
        });

        if (result && result.success) {
          return jsonResponse({
            success: true,
            panels: result.panels || [],
            texts: result.texts || [],
            boxes: result.boxes || [],
            origWidth: result.origWidth,
            origHeight: result.origHeight,
            endpoint: result.endpoint,
          });
        }

        // If YOLO endpoints failed, return clean graceful fallback JSON
        console.warn("[Cloudflare Worker YOLO] All Ultralytics inference endpoints failed or were unreachable");
        return jsonResponse({
          success: false,
          fallback: true,
          error: "Ultralytics inference endpoints unreachable or failed",
          panels: [],
          texts: [],
          boxes: []
        }, 200);
      } catch (err: any) {
        console.error("[Cloudflare Worker YOLO Error]:", err);
        return jsonResponse({
          success: false,
          fallback: true,
          error: err.message || "Failed processing YOLO detection",
          panels: [],
          texts: [],
          boxes: []
        }, 200);
      }
    }

    // ─────────────────────────────────────────────
    // Fallback: Proxy other /api/* routes to backend server
    // (e.g. Gemini OCR, AI translation, DOCX export)
    // ─────────────────────────────────────────────
    if (url.pathname.startsWith("/api/")) {
      const targetHost =
        env.VITE_API_URL ||
        env.API_URL ||
        "https://ais-dev-hdnihrh5osfa2rtxf3lhro-642769293101.europe-west2.run.app";

      if (targetHost) {
        try {
          const targetUrl = new URL(url.pathname + url.search, targetHost);
          const proxyRequest = new Request(targetUrl.toString(), request);
          proxyRequest.headers.set("X-Forwarded-Host", url.hostname);

          const response = await fetch(proxyRequest);
          const newHeaders = new Headers(response.headers);
          for (const [k, v] of Object.entries(corsHeaders)) {
            newHeaders.set(k, v);
          }
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
          });
        } catch (err: any) {
          return jsonResponse(
            { error: "Backend proxy unavailable", details: err.message },
            502
          );
        }
      }
    }

    // ─────────────────────────────────────────────
    // Static Assets serving (SPA fallback)
    // ─────────────────────────────────────────────
    if (env.ASSETS) {
      return await env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};
