import re
with open("src/components/AuthDialog.tsx", "r", encoding="utf-8") as f:
    content = f.read()

reset_pw = """  const handleResetPassword = async () => {
    if (!email) {
      toast.error("Please enter your email address first.");
      return;
    }
    setIsResetting(true);
    const supabase = getSupabase(supabaseUrl, supabaseAnonKey);
    if (!supabase) {
      toast.error("Supabase is not connected. Please add your credentials in Settings.");
      setIsResetting(false);
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) {
      toast.error(error.message || "Failed to send reset email.");
    } else {
      toast.success("Password reset email sent! Check your inbox.");
      setShowResetPassword(false);
    }
    setIsResetting(false);
  };"""

content = re.sub(
    r"const handleResetPassword = async \(\) => \{.*?(?=  const handleGoogleSignInClick)",
    reset_pw + "\n\n",
    content,
    flags=re.DOTALL
)

with open("src/components/AuthDialog.tsx", "w", encoding="utf-8") as f:
    f.write(content)

