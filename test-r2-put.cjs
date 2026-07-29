const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const s3 = new S3Client({
  region: "auto",
  endpoint: "https://fa7ead1c0aaa1e931de55eb01c384876.r2.cloudflarestorage.com",
  credentials: {
    accessKeyId: "ed020adf41c86d841254e3dd0d4bee2a",
    secretAccessKey: "13bbca496ee48a15650081575e298da228dbc4b8a2e18b4375491070d99d8eab"
  }
});

async function run() {
  try {
    const res = await s3.send(new PutObjectCommand({ 
      Bucket: "ebookcc-media", 
      Key: "published_works/test.json",
      Body: JSON.stringify({ test: 123 }),
      ContentType: "application/json"
    }));
    console.log("Put Success");
  } catch (err) {
    console.error("Put Error:", err.message);
  }
}
run();
