import os

with open("src/components/Bookshelf.tsx", "r", encoding="utf-8") as f:
    content = f.read()

import re

new_content = re.sub(r"// Continuous light polling to ensure seamless instant auto-sync across actions\s*const syncInterval = setInterval\(\(\) => \{\s*loadBooks\(\);\s*\}, 5000\);\s*", "", content)
new_content = new_content.replace("clearInterval(syncInterval);", "")

with open("src/components/Bookshelf.tsx", "w", encoding="utf-8") as f:
    f.write(new_content)
print("Interval removed")
