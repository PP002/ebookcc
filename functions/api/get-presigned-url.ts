import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const onRequestPost = async (context: any) => {
  try {
    const { request, env } = context;
    const body = await request.json();
    const { fileName, fileType, folder } = body;

    const accessKeyId = env.R2_ACCESS_KEY_ID || "ed020adf41c86d841254e3dd0d4bee2a";
    const secretAccessKey = env.R2_SECRET_ACCESS_KEY || "13bbca496ee48a15650081575e298da228dbc4b8a2e18b4375491070d99d8eab";
    const bucket = env.R2_BUCKET_NAME || "ebookcc-media";
    const accountId = env.R2_ACCOUNT_ID || "fa7ead1c0aaa1e931de55eb01c384876";
    let endpoint = env.R2_ENDPOINT;

    if (!endpoint && accountId) {
      endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    }
    
    if (!endpoint) {
       endpoint = "https://fa7ead1c0aaa1e931de55eb01c384876.r2.cloudflarestorage.com";
    }

    const s3 = new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });

    const targetFolder = folder ? folder.replace(/^\/+|\/+$/g, "") : "uploads";
    const cleanFilename = fileName ? fileName.replace(/[^a-zA-Z0-9_.-]/g, "_") : `file-${Date.now()}`;
    const objectKey = `${targetFolder}/${Date.now()}-${cleanFilename}`;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: fileType || "application/octet-stream",
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

    return new Response(JSON.stringify({ uploadUrl, key: objectKey, bucket }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
