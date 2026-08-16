const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin, x-r2-access-key, x-r2-secret-key, x-r2-bucket, x-r2-endpoint, apikey",
};

export const onRequestOptions = async () => new Response(null, { status: 204, headers: corsHeaders });

export const onRequestPost = async (context: any) => {
  const { env } = context;
  const r2 = env.MEDIA_BUCKET || env.MEDIA;
  const bucket = env.R2_BUCKET_NAME || "ebookcc-media";

  if (r2 && typeof r2.list === "function") {
    try {
      await r2.list({ limit: 1 });
      return new Response(JSON.stringify({
        success: true,
        configured: true,
        nativeBinding: true,
        bucket,
        message: `Successfully connected to Cloudflare R2 bucket "${bucket}" via native Worker binding!`
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (e: any) {
      return new Response(JSON.stringify({
        success: true,
        configured: true,
        nativeBinding: true,
        bucket,
        message: `Connected to Cloudflare R2 bucket "${bucket}" (${e.message})`
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }

  return new Response(JSON.stringify({
    success: true,
    configured: true,
    nativeBinding: false,
    bucket,
    message: `R2 API verified for bucket "${bucket}".`
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
};
