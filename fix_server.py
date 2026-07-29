import os

with open("server.ts", "r", encoding="utf-8") as f:
    content = f.read()

# Fix config response
content = content.replace(
    'const rawBucket = process.env.R2_BUCKET_NAME;',
    'const rawBucket = (process.env.R2_BUCKET_NAME || "").trim();'
)

content = content.replace(
    'process.env.SUPABASE_URL || "https://wipjqdmystqfzwsmvscx.supabase.co"',
    '(process.env.SUPABASE_URL || "https://wipjqdmystqfzwsmvscx.supabase.co").trim()'
)

content = content.replace(
    'process.env.SUPABASE_ANON_KEY || "sb_publishable_qP560tjdVzDl4lsNTe0WUQ_S6BF7dEX"',
    '(process.env.SUPABASE_ANON_KEY || "sb_publishable_qP560tjdVzDl4lsNTe0WUQ_S6BF7dEX").trim()'
)

content = content.replace(
    'process.env.R2_ENDPOINT ||',
    '(process.env.R2_ENDPOINT || "").trim() ||'
)

# Fix getR2ClientAndBucket
content = content.replace(
    'const accessKeyId = (req?.headers["x-r2-access-key"] as string) || process.env.R2_ACCESS_KEY_ID || "ed020adf41c86d841254e3dd0d4bee2a";',
    'const accessKeyId = ((req?.headers["x-r2-access-key"] as string) || process.env.R2_ACCESS_KEY_ID || "ed020adf41c86d841254e3dd0d4bee2a").trim();'
)

content = content.replace(
    'const secretAccessKey = (req?.headers["x-r2-secret-key"] as string) || process.env.R2_SECRET_ACCESS_KEY || "13bbca496ee48a15650081575e298da228dbc4b8a2e18b4375491070d99d8eab";',
    'const secretAccessKey = ((req?.headers["x-r2-secret-key"] as string) || process.env.R2_SECRET_ACCESS_KEY || "13bbca496ee48a15650081575e298da228dbc4b8a2e18b4375491070d99d8eab").trim();'
)

content = content.replace(
    'let bucket = customBucket || (req?.headers["x-r2-bucket"] as string) || process.env.R2_BUCKET_NAME || "ebookcc-media";',
    'let bucket = (customBucket || (req?.headers["x-r2-bucket"] as string) || process.env.R2_BUCKET_NAME || "ebookcc-media").trim();'
)

content = content.replace(
    'let endpoint = (req?.headers["x-r2-endpoint"] as string) || process.env.R2_ENDPOINT;',
    'let endpoint = ((req?.headers["x-r2-endpoint"] as string) || process.env.R2_ENDPOINT || "").trim();'
)

with open("server.ts", "w", encoding="utf-8") as f:
    f.write(content)

print("Updated server.ts")
