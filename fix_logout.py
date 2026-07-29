import os

with open("src/components/AppSettingsDialog.tsx", "r", encoding="utf-8") as f:
    content = f.read()

old_logout = """  const handleLogout = async () => {
    if (supabaseUrl && supabaseAnonKey) {
      const supabase = getSupabase(supabaseUrl, supabaseAnonKey);
      if (supabase) {
        await supabase.auth.signOut();
      }
    }
    setUser(null);
    toast.success("Signed out successfully.");
  };"""

new_logout = """  const handleLogout = async () => {
    if (supabaseUrl && supabaseAnonKey) {
      const supabase = getSupabase(supabaseUrl, supabaseAnonKey);
      if (supabase) {
        try {
          await supabase.auth.signOut();
        } catch (err) {}
      }
    }
    setUser(null);
    localStorage.removeItem("auth_user");
    toast.success("Signed out successfully.");
    setTimeout(() => {
      window.location.reload();
    }, 100);
  };"""

if old_logout in content:
    content = content.replace(old_logout, new_logout)
    with open("src/components/AppSettingsDialog.tsx", "w", encoding="utf-8") as f:
        f.write(content)
    print("Updated logout in AppSettingsDialog.tsx")
else:
    print("old_logout not found in AppSettingsDialog.tsx")
