import { AwsClient } from "aws4fetch";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin, x-r2-access-key, x-r2-secret-key, x-r2-bucket, x-r2-endpoint, apikey",
};

export const onRequestOptions = async () => new Response(null, { status: 204, headers: corsHeaders });

export const onRequestGet = async (context: any) => {
  const { request, env, params } = context;
  const url = new URL(request.url);

  // Extract requested filename from params or URL path
  let filename = "";
  if (Array.isArray(params?.filename)) {
    filename = params.filename.join("/");
  } else if (typeof params?.filename === "string") {
    filename = params.filename;
  } else {
    filename = url.pathname.split("/").pop() || "";
  }

  filename = decodeURIComponent(filename);

  const candidateKeys = [
    `Models/${filename}`,
    `models/${filename}`,
    filename
  ];

  const batchMatch = filename.match(/batch[=-]?(\d+)/i);
  if (batchMatch) {
    const bNum = batchMatch[1];
    candidateKeys.push(
      `Models/imagez=640-quantize=w8a32-batch=${bNum}.tflite`,
      `models/imagez=640-quantize=w8a32-batch=${bNum}.tflite`,
      `Models/panel-batch${bNum}.tflite`,
      `models/panel-batch${bNum}.tflite`
    );
  }

  // 1. Try native Cloudflare R2 binding
  const r2 = env.MEDIA_BUCKET || env.MEDIA || env.BUCKET || env.R2;
  if (r2 && typeof r2.get === "function") {
    for (const key of candidateKeys) {
      try {
        const object = await r2.get(key);
        if (object) {
          const headers = new Headers(corsHeaders);
          if (typeof object.writeHttpMetadata === "function") {
            object.writeHttpMetadata(headers);
          }
          headers.set("Content-Type", "application/octet-stream");
          headers.set("Cache-Control", "public, max-age=31536000, immutable");
          if (object.httpEtag) headers.set("etag", object.httpEtag);
          return new Response(object.body, { headers });
        }
      } catch (_) {}
    }
  }

  // 2. Try AWS S3 client over R2 endpoint using environment credentials
  const accessKeyId = env.R2_ACCESS_KEY_ID || "ed020adf41c86d841254e3dd0d4bee2a";
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY || "13bbca496ee48a15650081575e298da228dbc4b8a2e18b4375491070d99d8eab";
  const accountId = env.R2_ACCOUNT_ID || "fa7ead1c0aaa1e931de55eb01c384876";
  const bucket = env.R2_BUCKET_NAME || "ebookcc-media";
  let endpoint = env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;

  if (accessKeyId && secretAccessKey) {
    try {
      const aws = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
      for (const key of candidateKeys) {
        try {
          const s3Url = new URL(`/${bucket}/${encodeURIComponent(key).replace(/%2F/g, "/")}`, endpoint);
          const signedRequest = await aws.sign(s3Url, { method: "GET" });
          const res = await fetch(signedRequest);
          if (res.ok) {
            const headers = new Headers(corsHeaders);
            headers.set("Content-Type", "application/octet-stream");
            headers.set("Cache-Control", "public, max-age=31536000, immutable");
            const cl = res.headers.get("content-length");
            if (cl) headers.set("Content-Length", cl);
            return new Response(res.body, { headers });
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  // 3. Fallback: Proxy to backend server if configured
  const backendHost = env.VITE_API_URL || env.API_URL || "https://ais-dev-hdnihrh5osfa2rtxf3lhro-642769293101.europe-west2.run.app";
  if (backendHost) {
    try {
      const targetUrl = new URL(`/Models/${filename}`, backendHost);
      const res = await fetch(targetUrl.toString(), {
        headers: { "Accept": "application/octet-stream" }
      });
      if (res.ok && !res.headers.get("content-type")?.includes("text/html")) {
        const headers = new Headers(corsHeaders);
        headers.set("Content-Type", "application/octet-stream");
        headers.set("Cache-Control", "public, max-age=31536000, immutable");
        return new Response(res.body, { headers });
      }
    } catch (_) {}
  }

  return new Response(JSON.stringify({ error: `Model file ${filename} not found in R2 /Models/` }), {
    status: 404,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
};
