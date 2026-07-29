import os

with open("src/components/AppSettingsDialog.tsx", "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace(
    "import { useAppSettings } from '@/context/AppSettingsContext';",
    "import { useAppSettings, getSupabase } from '@/context/AppSettingsContext';"
)

with open("src/components/AppSettingsDialog.tsx", "w", encoding="utf-8") as f:
    f.write(content)
print("Updated imports")
