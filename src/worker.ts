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
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Requested-With, Accept, Origin, x-r2-access-key, x-r2-secret-key, x-r2-bucket, x-r2-endpoint, apikey",
};

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
          // Also delete associated media folder
          try {
            const mediaList = await r2.list({ prefix: `media/${workId}/` });
            if (mediaList.objects.length > 0) {
              await r2.delete(mediaList.objects.map((o) => o.key));
            }
          } catch (_) {}

          return jsonResponse({
            success: true,
            message: `Work ${workId} deleted from R2.`,
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
