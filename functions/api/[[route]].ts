export const onRequest = async (context: any) => {
  return new Response(JSON.stringify({ error: "Cloudflare Pages Functions endpoint. Please run EbookCC backend or configure worker routes." }), {
    status: 501,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    }
  });
};
