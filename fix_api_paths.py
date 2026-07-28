import os
import re

def process_file(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    # We want to replace fetch("/api/...") with fetch(`${import.meta.env.VITE_API_URL || ""}/api/...`)
    # and fetch(`/api/...`) with fetch(`${import.meta.env.VITE_API_URL || ""}/api/...`)
    
    # Handle fetch("/api/...")
    new_content = re.sub(
        r'fetch\("/api/([^"]+)"',
        r'fetch(`${import.meta.env.VITE_API_URL || ""}/api/\1`',
        content
    )
    
    # Handle fetch(`/api/...`)
    new_content = re.sub(
        r'fetch\(`/api/([^`]+)`',
        r'fetch(`${import.meta.env.VITE_API_URL || ""}/api/\1`',
        new_content
    )

    if new_content != content:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(new_content)
        print(f"Updated {filepath}")

for root, _, files in os.walk("src"):
    for file in files:
        if file.endswith((".ts", ".tsx")):
            process_file(os.path.join(root, file))

print("Done")
