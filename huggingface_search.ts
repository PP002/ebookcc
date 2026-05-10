import https from 'https';
https.get('https://huggingface.co/api/models?search=comic-speech-bubble', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(JSON.parse(data).map(x => x.id)));
});
