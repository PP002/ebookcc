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
  const isPaid = !!(env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID);

  const FREE_MODELS = {
    vision:        "@cf/google/gemma-4-26b-a4b-it",
    ocr_fallback:  "@cf/meta/llama-3.2-11b-vision-instruct",
    director:      "@cf/nvidia/nemotron-3-120b-a12b",
    director_alt:  "@cf/deepseek-ai/deepseek-v4-pro-0813", 
    tts:           "@cf/deepgram/aura-2-en",
    tts_alt:       "@cf/inworld/tts-1.5-max",               
    music:         null,   
    sfx:           null,   
  };

  const PAID_MODELS = {
    vision:        "google/gemini-pro",
    ocr_fallback:  "google/gemini-flash",
    director:      "custom-codecraftai/claude-sonnet",
    tts:           "elevenlabs/...",
    tts_fallback:  "openai/tts-1",
    music:         "elevenlabs/...",
    sfx:           "elevenlabs/...",
  };

  return new Response(JSON.stringify({
    supabaseUrl: (env.SUPABASE_URL || env.VITE_SUPABASE_URL || defaultSupabaseUrl).trim(),
    supabaseAnonKey: (env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || "sb_publishable_qP560tjdVzDl4lsNTe0WUQ_S6BF7dEX").trim(),
    r2BucketName: bucket,
    r2Endpoint: endpoint,
    isCloudflareWorker: true,
    isPaid,
    models: isPaid ? PAID_MODELS : FREE_MODELS,
    gateways: {
      anthropic: "ebookcc-gateway_codecraftai_default",
      elevenlabs: "ebookcc-gateway_elevenlabs_default",
      google_ai_studio: "ebookcc-gateway_google-ai-studio_default",
      openai: "ebookcc-gateway_openai_default",
    },
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
};
