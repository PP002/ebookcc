export const onRequest = async (context: any) => {
  const { request, env } = context;
  const url = new URL(request.url);
  
  // Replace with the deployed Cloud Run URL if available in env, or fallback to the provided dev url
  const targetHost = env.VITE_API_URL || env.API_URL || "https://ais-dev-hdnihrh5osfa2rtxf3lhro-642769293101.europe-west2.run.app";

  if (!targetHost || targetHost === "") {
     return new Response(JSON.stringify({ error: "API_URL environment variable is not configured." }), { 
       status: 404,
       headers: { "Content-Type": "application/json" }
     });
  }

  const targetUrl = new URL(url.pathname + url.search, targetHost);
  const proxyRequest = new Request(targetUrl.toString(), request);
  proxyRequest.headers.set("X-Forwarded-Host", url.hostname);

  return fetch(proxyRequest);
};
