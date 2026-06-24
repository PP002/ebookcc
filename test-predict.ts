import fs from 'fs';

async function check() {
  const base64Image = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCABQAFADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAaEQEBAQEAAwAAAAAAAAAAAAAAAQIDESEx/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ANjAAKAAAAAAAAAAAB//2Q==";
  try {
    const imgBuf = Buffer.from(base64Image.split(",")[1], 'base64');
    const form = new FormData();
    form.append("file", new Blob([imgBuf], { type: 'image/jpeg' }), "image.jpg");
    form.append("conf", "0.15");

    const res = await fetch("https://predict-69ffb8299f770dcc9b69-dproatj77a-uw.a.run.app/predict", {
        method: "POST",
        headers: {
            "Authorization": "Bearer ul_2c576727830ac3f6a98acfb1b82e5c3fb7b4899b"
        },
        body: form
    });
    console.log(res.status);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.log(e);
  }
}

check();
