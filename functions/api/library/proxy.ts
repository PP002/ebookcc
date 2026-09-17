// Cloudflare Pages Function: /api/library/proxy
// Secure CORS proxy for Project Gutenberg (*.gutenberg.org) and Internet Archive (*.archive.org)

export interface Env {
  // bindings if needed
}

function isAllowedHost(urlString: string): { allowed: boolean; url?: URL; error?: string } {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { allowed: false, error: 'Protocol not allowed. Only HTTP and HTTPS are permitted.' };
    }

    const hostname = parsed.hostname.toLowerCase();
    const isWhitelisted =
      hostname === 'gutenberg.org' ||
      hostname.endsWith('.gutenberg.org') ||
      hostname === 'archive.org' ||
      hostname.endsWith('.archive.org');

    if (!isWhitelisted) {
      return {
        allowed: false,
        error: `Forbidden domain: ${hostname}. Only *.gutenberg.org and *.archive.org are authorized.`
      };
    }

    return { allowed: true, url: parsed };
  } catch {
    return { allowed: false, error: 'Invalid URL provided.' };
  }
}

export const onRequest = async (context: any) => {
  const { request } = context;

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const reqUrl = new URL(request.url);
  const targetUrl =
    reqUrl.searchParams.get('fileUrl') ||
    reqUrl.searchParams.get('url') ||
    reqUrl.searchParams.get('target');

  if (!targetUrl) {
    return new Response(
      JSON.stringify({ error: 'Missing required query parameter "fileUrl".' }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }

  const check = isAllowedHost(targetUrl);
  if (!check.allowed || !check.url) {
    return new Response(
      JSON.stringify({ error: check.error || 'Access denied by domain whitelist.' }),
      {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }

  try {
    const upstreamHeaders: HeadersInit = {
      'User-Agent': 'EbookCC-Reader/1.0',
      'Accept': '*/*',
    };

    const range = request.headers.get('range');
    if (range) {
      upstreamHeaders['Range'] = range;
    }

    const upstreamResponse = await fetch(check.url.toString(), {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: upstreamHeaders,
      redirect: 'follow',
    });

    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', '*');
    responseHeaders.set('Cache-Control', 'public, max-age=86400');

    // Forward useful headers
    const headersToForward = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'etag',
      'last-modified',
    ];

    for (const h of headersToForward) {
      const val = upstreamResponse.headers.get(h);
      if (val) responseHeaders.set(h, val);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: 'Proxy forwarding failed',
        message: err?.message || 'Unknown network error',
      }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
};
