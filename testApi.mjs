import fs from 'fs';
import fetch from 'node-fetch';

async function test() {
  const url = "https://predict-69ffb8299f770dcc9b69-dproatj77a-uw.a.run.app/predict";
  const apiKey = "ul_2c576727830ac3f6a98acfb1b82e5c3fb7b4899b";

  // create a dummy image or fetch one
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const buffer = Buffer.from(b64, 'base64');
  const blob = new Blob([buffer], { type: 'image/png' });
  
  const form = new FormData();
  form.append("file", blob, "test.png");
  form.append("conf", "0.25");
  form.append("iou", "0.7");
  form.append("imgsz", "640");

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const text = await response.text();
  console.log("Response:", text);
}

test();
