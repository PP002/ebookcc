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
    const item = body.item || body;
    
    if (!item || !item.id) {
       return new Response(JSON.stringify({ error: "Invalid payload" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const r2 = env.MEDIA_BUCKET || env.MEDIA;
    const workId = String(item.id).replace(/[^a-zA-Z0-9_-]/g, "_");
    const jsonKey = `published_works/${workId}.json`;
    const jsonBuffer = new TextEncoder().encode(JSON.stringify(item, null, 2));

    if (r2 && typeof r2.put === "function") {
      await r2.put(jsonKey, jsonBuffer, {
        httpMetadata: { contentType: "application/json" }
      });
      return new Response(JSON.stringify({ success: true, message: "Published work saved to Cloudflare R2", item }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
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

    return new Response(JSON.stringify({ success: true, message: "Published work saved to Cloudflare R2", item }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
};

export const onRequestGet = async (context: any) => {
  try {
    const { env } = context;
    const r2 = env.MEDIA_BUCKET || env.MEDIA;
    if (r2 && typeof r2.list === "function") {
      const list = await r2.list({ prefix: "published_works/" });
      const jsonObjs = list.objects.filter((o: any) => o.key.endsWith(".json"));
      const worksList: any[] = [];
      await Promise.all(
        jsonObjs.map(async (obj: any) => {
          try {
            const itemObj = await r2.get(obj.key);
            if (itemObj) {
              const text = await itemObj.text();
              const parsed = JSON.parse(text);
              if (parsed && parsed.id) worksList.push(parsed);
            }
          } catch (_) {}
        })
      );
      worksList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return new Response(JSON.stringify({ success: true, works: worksList, source: "r2" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  } catch (_) {}

  return new Response(JSON.stringify({ success: true, works: [], source: "r2" }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
};
