import fs from 'fs';
import path from 'path';
import https from 'https';

const baseUrl = 'https://raw.githubusercontent.com/PP002/ComicEd/main/Models/yolo26m-seg/';
const files = [
  'model.json',
  'metadata.yaml',
  'group1-shard1of12.bin',
  'group1-shard2of12.bin',
  'group1-shard3of12.bin',
  'group1-shard4of12.bin',
  'group1-shard5of12.bin',
  'group1-shard6of12.bin',
  'group1-shard7of12.bin',
  'group1-shard8of12.bin',
  'group1-shard9of12.bin',
  'group1-shard10of12.bin',
  'group1-shard11of12.bin',
  'group1-shard12of12.bin',
];

const dir = path.join(process.cwd(), 'public', 'models', 'yolo26m-seg');
fs.mkdirSync(dir, { recursive: true });

async function download(file) {
  return new Promise((resolve, reject) => {
    const dest = path.join(dir, file);
    const fileStream = fs.createWriteStream(dest);
    https.get(baseUrl + file, (response) => {
      if (response.statusCode >= 400) {
          reject(new Error(`Status ${response.statusCode} for ${file}`));
          return;
      }
      response.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function main() {
  for (const file of files) {
    console.log(`Downloading ${file}...`);
    try {
        await download(file);
    } catch (e) {
        console.error(`Failed to download ${file}:`, e.message);
    }
  }
  console.log('Done!');
}

main();
