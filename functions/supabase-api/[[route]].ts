export const onRequest = async (context: any) => {
  const { request } = context;
  const url = new URL(request.url);
  
  // The path will be something like /supabase-api/auth/v1/...
  // We need to rewrite it to point to Supabase
  const supabaseUrl = "https://wipjqdmystqfzwsmvscx.supabase.co";
  
  // Remove the /supabase-api prefix
  const targetPath = url.pathname.replace(/^\/supabase-api/, '');
  const targetUrl = new URL(targetPath + url.search, supabaseUrl);
  
  // Create a new request based on the original one
  const newRequest = new Request(targetUrl.toString(), request);
  
  // Important for Supabase to know the original host/protocol for redirects
  newRequest.headers.set('x-forwarded-host', url.host);
  newRequest.headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
  
  try {
    const response = await fetch(newRequest);
    return response;
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
