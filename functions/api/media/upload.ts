import { AwsClient } from "aws4fetch";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin, x-r2-access-key, x-r2-secret-key, x-r2-bucket, x-r2-endpoint",
};

export const onRequestOptions = async () => new Response(null, { status: 204, headers: corsHeaders });

export const onRequestPost = async (context: any) => {
  try {
    const { request, env } = context;
    const body = await request.json().catch(() => ({}));
    const { base64Image, filename, folder } = body;

    if (!base64Image) {
      return new Response(JSON.stringify({ error: "Missing base64Image data" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const accessKeyId = env.R2_ACCESS_KEY_ID || "ed020adf41c86d841254e3dd0d4bee2a";
    const secretAccessKey = env.R2_SECRET_ACCESS_KEY || "13bbca496ee48a15650081575e298da228dbc4b8a2e18b4375491070d99d8eab";
    const bucket = env.R2_BUCKET_NAME || "ebookcc-media";
    const accountId = env.R2_ACCOUNT_ID || "fa7ead1c0aaa1e931de55eb01c384876";
    let endpoint = env.R2_ENDPOINT;

    if (!endpoint && accountId) {
      endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    }
    if (!endpoint) {
       endpoint = "https://fa7ead1c0aaa1e931de55eb01c384876.r2.cloudflarestorage.com";
    }

    const aws = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });

    // Parse base64
    const matches = base64Image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return new Response(JSON.stringify({ error: "Invalid base64 string" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const mimeType = matches[1];
    const buffer = Uint8Array.from(atob(matches[2]), c => c.charCodeAt(0));

    const targetFolder = folder ? folder.replace(/^\/+|\/+$/g, "") : "uploads";
    let ext = "png";
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) ext = "jpg";
    if (mimeType.includes("webp")) ext = "webp";
    
    const cleanFilename = filename ? filename.replace(/[^a-zA-Z0-9_.-]/g, "_") : `media-${Date.now()}.${ext}`;
    const objectKey = `${targetFolder}/${Date.now()}-${cleanFilename}`;
    
    const url = new URL(`/${bucket}/${objectKey}`, endpoint);
    
    const signedRequest = await aws.sign(url, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: buffer
    });

    const uploadRes = await fetch(signedRequest);
    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return new Response(JSON.stringify({ error: `R2 Upload Failed: ${errText}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const fileUrl = `/api/media/file/${encodeURIComponent(bucket)}/${objectKey}`;

    return new Response(JSON.stringify({ url: fileUrl, key: objectKey, bucket }), {
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
