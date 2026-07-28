#!/bin/bash
sed -i 's/import sharp from "sharp";/import sizeOf from "image-size";/g' server.ts
sed -i 's/const metadata = await sharp(imgBuf).metadata();/const metadata = sizeOf(imgBuf);/g' server.ts
sed -i 's/--external:sharp//g' package.json
