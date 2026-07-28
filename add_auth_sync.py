import re

with open("src/context/AppSettingsContext.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# We need to add an effect that listens to auth state changes from Supabase
effect = """
  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey) return;
    const supabase = getSupabase(supabaseUrl, supabaseAnonKey);
    if (!supabase) return;

    // Fetch initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser({
          email: session.user.email || "",
          name: session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || "User",
          uid: session.user.id
        });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({
          email: session.user.email || "",
          name: session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || "User",
          uid: session.user.id
        });
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabaseUrl, supabaseAnonKey]);
"""

# Insert right after the user state definition
content = re.sub(
    r"(const \[showAuthDialog, setShowAuthDialog\] = useState\(false\);)",
    r"\1" + effect,
    content
)

with open("src/context/AppSettingsContext.tsx", "w", encoding="utf-8") as f:
    f.write(content)

