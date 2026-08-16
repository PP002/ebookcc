import { AwsClient } from "aws4fetch";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin, x-r2-access-key, x-r2-secret-key, x-r2-bucket, x-r2-endpoint, apikey",
};

export const onRequestOptions = async () => new Response(null, { status: 204, headers: corsHeaders });

export const onRequestPost = async (context: any) => {
  try {
    const { request, env } = context;
    const contentType = request.headers.get("content-type") || "";
    const r2 = env.MEDIA_BUCKET || env.MEDIA;

    let buffer: Uint8Array;
    let mimeType = "image/png";
    let ext = "png";
    let filename = "";
    let folder = "media";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as any;
      if (!file) {
        return new Response(JSON.stringify({ error: "Missing file in formData" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const arrayBuffer = await file.arrayBuffer();
      buffer = new Uint8Array(arrayBuffer);
      mimeType = file.type || "application/octet-stream";
      filename = file.name || `media-${Date.now()}`;
      folder = (formData.get("folder") as string) || "media";
    } else {
      const body = await request.json().catch(() => ({}));
      const base64Image = body.base64Image;

      if (!base64Image) {
        return new Response(JSON.stringify({ error: "Missing base64Image data" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const matches = base64Image.match(/^data:([A-Za-z-+\/0-9.]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        mimeType = matches[1];
        const raw = atob(matches[2]);
        buffer = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) buffer[i] = raw.charCodeAt(i);
      } else {
        const raw = atob(base64Image);
        buffer = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) buffer[i] = raw.charCodeAt(i);
      }

      if (mimeType.includes("jpeg") || mimeType.includes("jpg")) ext = "jpg";
      else if (mimeType.includes("webp")) ext = "webp";
      else if (mimeType.includes("gif")) ext = "gif";
      else if (mimeType.includes("json")) ext = "json";

      filename = body.filename || `media-${Date.now()}.${ext}`;
      folder = body.folder || "media";
    }

    const targetFolder = folder ? folder.replace(/^\/+|\/+$/g, "") : "media";
    const cleanFilename = filename ? filename.replace(/[^a-zA-Z0-9_.-]/g, "_") : `media-${Date.now()}.${ext}`;
    const objectKey = `${targetFolder}/${Date.now()}-${cleanFilename}`;
    const bucket = env.R2_BUCKET_NAME || "ebookcc-media";

    // 1. Direct upload via native Cloudflare R2 binding
    if (r2 && typeof r2.put === "function") {
      await r2.put(objectKey, buffer, {
        httpMetadata: {
          contentType: mimeType,
          cacheControl: "public, max-age=31536000, immutable"
        }
      });

      const fileUrl = `/api/media/file/${encodeURIComponent(bucket)}/${objectKey}`;
      return new Response(JSON.stringify({ success: true, url: fileUrl, key: objectKey, bucket }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 2. Fallback via S3 Credentials
    const accessKeyId = env.R2_ACCESS_KEY_ID || "ed020adf41c86d841254e3dd0d4bee2a";
    const secretAccessKey = env.R2_SECRET_ACCESS_KEY || "13bbca496ee48a15650081575e298da228dbc4b8a2e18b4375491070d99d8eab";
    const accountId = env.R2_ACCOUNT_ID || "fa7ead1c0aaa1e931de55eb01c384876";
    let endpoint = env.R2_ENDPOINT;

    if (!endpoint && accountId) {
      endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    }
    if (!endpoint) {
       endpoint = "https://fa7ead1c0aaa1e931de55eb01c384876.r2.cloudflarestorage.com";
    }

    const aws = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
    const url = new URL(`/${bucket}/${objectKey}`, endpoint);
    
    const signedRequest = await aws.sign(url, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: buffer as any
    });

    const uploadRes = await fetch(signedRequest);
    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return new Response(JSON.stringify({ error: `R2 Upload Failed: ${errText}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const fileUrl = `/api/media/file/${encodeURIComponent(bucket)}/${objectKey}`;

    return new Response(JSON.stringify({ success: true, url: fileUrl, key: objectKey, bucket }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
};
