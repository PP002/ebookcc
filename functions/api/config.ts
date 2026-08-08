const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin",
};

export const onRequestOptions = async () => new Response(null, { status: 204, headers: corsHeaders });

export const onRequestGet = async (context: any) => {
  const { env, request } = context;
  const rawBucket = (env.R2_BUCKET_NAME || env.VITE_R2_BUCKET_NAME || "").trim();
  const bucket = (!rawBucket || rawBucket === "ebookcc-assets") ? "ebookcc-media" : rawBucket;
  const accountId = (env.R2_ACCOUNT_ID || env.VITE_R2_ACCOUNT_ID || "").trim();
  const rawEndpoint = (env.R2_ENDPOINT || env.VITE_R2_ENDPOINT || "").trim();
  const endpoint = rawEndpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "https://fa7ead1c0aaa1e931de55eb01c384876.r2.cloudflarestorage.com");
  const defaultSupabaseUrl = "https://wipjqdmystqfzwsmvscx.supabase.co";

  return new Response(JSON.stringify({
    supabaseUrl: (env.SUPABASE_URL || env.VITE_SUPABASE_URL || defaultSupabaseUrl).trim(),
    supabaseAnonKey: (env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || "sb_publishable_qP560tjdVzDl4lsNTe0WUQ_S6BF7dEX").trim(),
    r2BucketName: bucket,
    r2Endpoint: endpoint,
    isCloudflareWorker: true
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
};
