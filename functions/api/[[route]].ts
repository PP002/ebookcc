const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin, x-r2-access-key, x-r2-secret-key, x-r2-bucket, x-r2-endpoint",
};

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};

export const onRequest = async (context: any) => {
  const { request, env } = context;
  const url = new URL(request.url);
  
  // Replace with the deployed Cloud Run URL if available in env, or fallback to the provided dev url
  const targetHost = env.VITE_API_URL || env.API_URL || "https://ais-dev-hdnihrh5osfa2rtxf3lhro-642769293101.europe-west2.run.app";

  if (!targetHost || targetHost === "") {
     return new Response(JSON.stringify({ error: "API_URL environment variable is not configured." }), { 
       status: 404,
       headers: { ...corsHeaders, "Content-Type": "application/json" }
     });
  }

  // Forward the request to the target server
  const targetUrl = new URL(url.pathname + url.search, targetHost);
  const proxyRequest = new Request(targetUrl.toString(), request);
  proxyRequest.headers.set("X-Forwarded-Host", url.hostname);

  try {
    const response = await fetch(proxyRequest);
    // Add CORS headers to the proxied response
    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) {
      newHeaders.set(key, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "Proxy to backend failed", details: err.message }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
};
