import { AwsClient } from "aws4fetch";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Requested-With, Accept, Origin, x-r2-access-key, x-r2-secret-key, x-r2-bucket, x-r2-endpoint, apikey, x-yolo-url, x-yolo-key, x-yolo-panel-class, x-yolo-text-class, x-yolo-text-only",
};

const DEFAULT_PREDICT_URLS = [
  "https://predict-6a94f60a162b7aab56911582-dproatj77a-du.a.run.app/predict",
  "https://predict-6a94f5d7162b7aab56911580-dproatj77a-vp.a.run.app/predict",
  "https://predict-6a94f57e162b7aab5691157e-dproatj77a-ew.a.run.app/predict"
];

function getImageDimensions(buffer: Uint8Array): { width: number; height: number } {
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    const width = (buffer[16] << 24) | (buffer[17] << 16) | (buffer[18] << 8) | buffer[19];
    const height = (buffer[20] << 24) | (buffer[21] << 16) | (buffer[22] << 8) | buffer[23];
    if (width > 0 && height > 0) return { width, height };
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length - 8) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        const height = (buffer[offset + 5] << 8) | buffer[offset + 6];
        const width = (buffer[offset + 7] << 8) | buffer[offset + 8];
        if (width > 0 && height > 0) return { width, height };
      }
      const length = (buffer[offset + 2] << 8) | buffer[offset + 3];
      if (length <= 0) break;
      offset += 2 + length;
    }
  }

  if (
    buffer.length >= 30 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x58 && buffer.length >= 30) {
      const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
      const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
      if (width > 0 && height > 0) return { width, height };
    }
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x20 && buffer.length >= 30) {
      const width = (buffer[26] | (buffer[27] << 8)) & 0x3fff;
      const height = (buffer[28] | (buffer[29] << 8)) & 0x3fff;
      if (width > 0 && height > 0) return { width, height };
    }
  }

  return { width: 1000, height: 1000 };
}

function parseBase64(base64Image: string) {
  const matches = base64Image.match(/^data:([A-Za-z-+\/0-9.]+);base64,(.+)$/);
  if (matches && matches.length === 3) {
    const raw = atob(matches[2]);
    const buffer = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buffer[i] = raw.charCodeAt(i);
    return buffer;
  }
  const raw = atob(base64Image);
  const buffer = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buffer[i] = raw.charCodeAt(i);
  return buffer;
}

export const onRequestOptions = async () => new Response(null, { status: 204, headers: corsHeaders });

export const onRequestPost = async (context: any) => {
  const { request, env } = context;
  try {
    const contentType = request.headers.get("content-type") || "";
    let body: any = {};
    let imgBuffer: Uint8Array | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = (formData.get("file") || formData.get("image")) as File | null;
      if (file) {
        imgBuffer = new Uint8Array(await file.arrayBuffer());
      }
      body = {
        yoloUrl: formData.get("yoloUrl") || formData.get("x-yolo-url"),
        yoloKey: formData.get("yoloKey") || formData.get("x-yolo-key"),
        textOnly: formData.get("textOnly") === "true" || formData.get("x-yolo-text-only") === "true",
        panelClass: formData.get("panelClass") ? parseInt(formData.get("panelClass") as string, 10) : undefined,
        textClass: formData.get("textClass") ? parseInt(formData.get("textClass") as string, 10) : undefined,
        conf: formData.get("conf") as string,
        iou: formData.get("iou") as string,
        imgsz: formData.get("imgsz") as string,
      };
    } else {
      body = (await request.json().catch(() => ({}))) as any;
      if (body.base64Image || body.image) {
        imgBuffer = parseBase64(body.base64Image || body.image);
      } else if (body.fileKey) {
        const r2 = env.MEDIA_BUCKET || env.MEDIA;
        if (r2) {
          const obj = await r2.get(body.fileKey);
          if (obj) imgBuffer = new Uint8Array(await obj.arrayBuffer());
        }
        if (!imgBuffer) {
          const accessKeyId = env.R2_ACCESS_KEY_ID || "ed020adf41c86d841254e3dd0d4bee2a";
          const secretAccessKey = env.R2_SECRET_ACCESS_KEY || "13bbca496ee48a15650081575e298da228dbc4b8a2e18b4375491070d99d8eab";
          const bucket = env.R2_BUCKET_NAME || "ebookcc-media";
          const accountId = env.R2_ACCOUNT_ID || "fa7ead1c0aaa1e931de55eb01c384876";
          const endpoint = env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;
          const aws = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
          const getUrl = new URL(`/${bucket}/${body.fileKey}`, endpoint);
          const signedGet = await aws.sign(getUrl, { method: "GET" });
          const s3Res = await fetch(signedGet);
          if (s3Res.ok) imgBuffer = new Uint8Array(await s3Res.arrayBuffer());
        }
      }
    }

    if (!imgBuffer || imgBuffer.length === 0) {
      return new Response(JSON.stringify({ error: "Missing image data (expected file, base64Image, or fileKey)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const yoloUrl = (request.headers.get("x-yolo-url") || body.yoloUrl || "").trim() || undefined;
    const yoloKey = (request.headers.get("x-yolo-key") || body.yoloKey || env.ULTRALYTICS_API_KEY || env.VITE_ULTRALYTICS_API_KEY || env.YOLO_API_KEY || "ul_2c576727830ac3f6a98acfb1b82e5c3fb7b4899b").trim();
    const textOnly = request.headers.get("x-yolo-text-only") === "true" || !!body.textOnly;
    const panelClass = request.headers.get("x-yolo-panel-class") ? parseInt(request.headers.get("x-yolo-panel-class")!, 10) : (body.panelClass ?? 0);
    const textClass = request.headers.get("x-yolo-text-class") ? parseInt(request.headers.get("x-yolo-text-class")!, 10) : (body.textClass ?? 1);
    const conf = body.conf || "0.15";
    const iou = body.iou || "0.45";
    const imgsz = body.imgsz || "1280";

    const dims = getImageDimensions(imgBuffer);
    let origW = dims.width;
    let origH = dims.height;
    const targetUrls = yoloUrl ? [yoloUrl] : DEFAULT_PREDICT_URLS;

    for (const targetUrl of targetUrls) {
      try {
        const formData = new FormData();
        formData.append("file", new Blob([imgBuffer as unknown as BlobPart], { type: "image/jpeg" }), "image.jpg");
        formData.append("conf", conf);
        formData.append("iou", iou);
        formData.append("imgsz", imgsz);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        const headers: Record<string, string> = {};
        if (yoloKey) {
          headers["Authorization"] = `Bearer ${yoloKey}`;
          headers["x-api-key"] = yoloKey;
        }

        const response = await fetch(targetUrl, {
          method: "POST",
          headers,
          body: formData,
          signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId));

        const contentType = response.headers.get("content-type") || "";
        const rawText = await response.text();

        if (rawText.trim().startsWith("<") || (!contentType.includes("application/json") && !rawText.trim().startsWith("{") && !rawText.trim().startsWith("["))) {
          console.warn(`[Functions YOLO Proxy] Non-JSON or HTML from ${targetUrl}: ${rawText.slice(0, 120)}`);
          continue;
        }

        if (!response.ok) {
          console.warn(`[Functions YOLO Proxy] Status ${response.status} from ${targetUrl}`);
          continue;
        }

        const data = JSON.parse(rawText);

        if (data.images?.[0]?.shape && Array.isArray(data.images[0].shape) && data.images[0].shape.length >= 2) {
          origH = data.images[0].shape[0] || origH;
          origW = data.images[0].shape[1] || origW;
        }

        if (data.images?.[0]?.results && Array.isArray(data.images[0].results)) {
          const panels: any[] = [];
          const texts: any[] = [];
          const boxes: [number, number, number, number][] = [];

          data.images[0].results.forEach((r: any) => {
            if (!r.box) return;
            const box_2d: [number, number, number, number] = [
              Math.max(0, Math.min(1000, Math.round(((r.box.y1 || 0) / origH) * 1000))),
              Math.max(0, Math.min(1000, Math.round(((r.box.x1 || 0) / origW) * 1000))),
              Math.max(0, Math.min(1000, Math.round(((r.box.y2 || 0) / origH) * 1000))),
              Math.max(0, Math.min(1000, Math.round(((r.box.x2 || 0) / origW) * 1000))),
            ];

            const segments = r.segments?.x ? {
              x: r.segments.x.map((v: number) => (v / origW) * 1000),
              y: r.segments.y.map((v: number) => (v / origH) * 1000),
            } : undefined;

            const item = { box_2d, segments, confidence: r.confidence, class: r.class, name: r.name };

            const rName = (r.name || "").toLowerCase();
            const isPanelName = rName.includes("panel") || rName.includes("frame") || rName.includes("border");
            const isTextName = rName.includes("text") || rName.includes("bubble") || rName.includes("balloon") || rName.includes("caption") || rName.includes("dialog");

            if (textOnly) {
              texts.push(item);
            } else if (isPanelName) {
              panels.push(item);
              boxes.push(box_2d);
            } else if (isTextName) {
              texts.push(item);
            } else if (r.class === panelClass) {
              panels.push(item);
              boxes.push(box_2d);
            } else if (r.class === textClass) {
              texts.push(item);
            } else if (r.class > 0 && panelClass === 0 && textClass === 1) {
              texts.push(item);
            } else {
              panels.push(item);
              boxes.push(box_2d);
            }
          });

          return new Response(JSON.stringify({
            success: true,
            panels,
            texts,
            boxes,
            origWidth: origW,
            origHeight: origH,
            endpoint: targetUrl,
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (data.boxes || data.panels || data.texts) {
          return new Response(JSON.stringify({
            success: true,
            panels: data.panels || data.boxes || [],
            texts: data.texts || [],
            boxes: data.boxes || (Array.isArray(data.panels) ? data.panels.map((p: any) => p.box_2d || p) : []),
            endpoint: targetUrl,
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (err: any) {
        console.warn(`[Functions YOLO Proxy] Error trying ${targetUrl}:`, err.message);
      }
    }

    return new Response(JSON.stringify({
      success: false,
      fallback: true,
      error: "Ultralytics YOLO inference endpoints unreachable",
      panels: [],
      texts: [],
      boxes: [],
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({
      success: false,
      fallback: true,
      error: err.message || "Failed processing YOLO detection",
      panels: [],
      texts: [],
      boxes: [],
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};
