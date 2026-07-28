import re
with open("src/components/AppSettingsDialog.tsx", "r", encoding="utf-8") as f:
    content = f.read()

replacement = """  const handleLogout = async () => {
    if (supabaseUrl && supabaseAnonKey) {
      const supabase = getSupabase(supabaseUrl, supabaseAnonKey);
      if (supabase) {
        await supabase.auth.signOut();
      }
    }
    setUser(null);
    toast.success("Signed out successfully.");
  };"""

content = re.sub(r"  const handleLogout = \(\) => \{\s*setUser\(null\);\s*toast\.success\(\"Signed out successfully\.\"\);\s*\};", replacement, content)

with open("src/components/AppSettingsDialog.tsx", "w", encoding="utf-8") as f:
    f.write(content)

