import https from 'https';
import fs from 'fs';

https.get('https://docs.ultralytics.com/integrations/tfjs/', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    fs.writeFileSync('tfjs_docs.html', data);
    console.log("Success");
  });
});
