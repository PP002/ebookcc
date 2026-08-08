import { AwsClient } from "aws4fetch";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin",
};

export const onRequestOptions = async () => new Response(null, { status: 204, headers: corsHeaders });

export const onRequestPost = async (context: any) => {
  try {
    const { request, env } = context;
    const body = await request.json().catch(() => ({}));
    
    if (!body || !body.id) {
       return new Response(JSON.stringify({ error: "Invalid payload" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    const jsonKey = `published/${body.id}.json`;
    const jsonBuffer = new TextEncoder().encode(JSON.stringify(body));
    
    const url = new URL(`/${bucket}/${jsonKey}`, endpoint);
    
    const signedRequest = await aws.sign(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: jsonBuffer
    });

    const uploadRes = await fetch(signedRequest);
    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return new Response(JSON.stringify({ error: `R2 Upload Failed: ${errText}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true, message: "Published work saved to Cloudflare R2 via Worker", item: body }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
};

export const onRequestGet = async (context: any) => {
  return new Response(JSON.stringify([]), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
};
