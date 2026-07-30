import os

with open("server.ts", "r", encoding="utf-8") as f:
    content = f.read()

import re

new_content = re.sub(
    r"allowedHeaders: \['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'\]",
    "allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'x-r2-access-key', 'x-r2-secret-key', 'x-r2-bucket', 'x-r2-endpoint']",
    content
)

with open("server.ts", "w", encoding="utf-8") as f:
    f.write(new_content)
print("CORS updated")
