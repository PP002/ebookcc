import os

with open("src/components/AuthDialog.tsx", "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace(
    'className="w-full h-10 mt-2 font-semibold flex items-center justify-center gap-2"',
    'className="w-full h-10 mt-2 font-semibold flex items-center justify-center gap-2 rounded-full"'
)

content = content.replace(
    'className="w-full h-10 border border-border hover:bg-accent/60 font-semibold text-sm flex items-center justify-center gap-2.5 transition-all shadow-sm"',
    'className="w-full h-10 border border-border hover:bg-accent/60 font-semibold text-sm flex items-center justify-center gap-2.5 transition-all shadow-sm rounded-full"'
)

with open("src/components/AuthDialog.tsx", "w", encoding="utf-8") as f:
    f.write(content)
print("Updated AuthDialog buttons")
