const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin, x-r2-access-key, x-r2-secret-key, x-r2-bucket, x-r2-endpoint, apikey",
};

export const onRequestOptions = async () => new Response(null, { status: 204, headers: corsHeaders });

export const onRequestGet = async (context: any) => {
  try {
    const { request, env, params } = context;
    const r2 = env.MEDIA_BUCKET || env.MEDIA;
    const url = new URL(request.url);

    // Extract object key from params.file or pathname
    let objectKey = "";
    if (Array.isArray(params.file)) {
      const parts = [...params.file];
      if (parts.length > 1 && (parts[0] === "ebookcc-media" || parts[0] === "ebookcc-assets" || parts[0] === env.R2_BUCKET_NAME)) {
        objectKey = parts.slice(1).join("/");
      } else {
        objectKey = parts.join("/");
      }
    } else {
      objectKey = url.pathname.replace(/^\/api\/media\/file\//, "").replace(/^ebookcc-media\//, "");
    }

    if (r2 && typeof r2.get === "function") {
      const object = await r2.get(objectKey);
      if (object) {
        const headers = new Headers(corsHeaders);
        object.writeHttpMetadata(headers);
        headers.set("etag", object.httpEtag);
        headers.set("Cache-Control", "public, max-age=31536000, immutable");
        return new Response(object.body, { headers });
      }
    }

    return new Response("Media file not found", { status: 404, headers: corsHeaders });
  } catch (err: any) {
    return new Response(`Error serving media: ${err.message}`, { status: 500, headers: corsHeaders });
  }
};
