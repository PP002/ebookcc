import os

with open("index.html", "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace(
    '<script src="https://js.puter.com/v2/"></script>',
    '<script src="https://js.puter.com/v2/" defer></script>'
)

with open("index.html", "w", encoding="utf-8") as f:
    f.write(content)
print("Updated index.html to defer puter.js")
