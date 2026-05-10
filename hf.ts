import https from 'https';
https.get('https://huggingface.co/api/models/mnemic/comic_speechbubble_yolov8/tree/main', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(data));
});
