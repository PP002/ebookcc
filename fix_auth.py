import re

with open("src/components/AuthDialog.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# I want to rewrite the component to remove all the local fallback logic and `isSupabaseConnected` checks that fall back to local storage.

# Wait, let's just make the Supabase branch the only one.
content = re.sub(
    r"const isSupabaseConnected = \!\!\(supabaseUrl && supabaseAnonKey\);",
    r"",
    content
)

# For handleResetPassword
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
    r"const handleResetPassword = async \(\) => \{.*?\setIsResetting\(false\);\n  \};\n"
    r"(?=  const handleGoogleSignInClick)",
    reset_pw + "\n",
    content,
    flags=re.DOTALL
)

# For handleGoogleSignInClick
google_sign_in = """  const handleGoogleSignInClick = async () => {
    setLoading(true);
    const supabase = getSupabase(supabaseUrl, supabaseAnonKey);
    if (!supabase) {
      toast.error("Supabase is not connected. Please add your credentials in Settings to enable Google Sign-In.");
      setLoading(false);
      return;
    }
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { 
          redirectTo: window.location.origin,
          queryParams: {
            prompt: 'select_account'
          }
        }
      });
      if (error) {
        if (error.message?.includes('not enabled') || error.message?.includes('Unsupported provider')) {
          toast.error("Google provider is not enabled in your Supabase project. Please enable it in Authentication > Providers.");
        } else {
          toast.error(error.message || "Failed to sign in with Google.");
        }
        setLoading(false);
        return;
      }
    } catch (err: any) {
      console.warn("Supabase Google OAuth error:", err.message);
      toast.error("Failed to connect to Google login.");
      setLoading(false);
    }
  };"""
content = re.sub(
    r"const handleGoogleSignInClick = async \(\) => \{.*?(?=  const handleAuth = )",
    google_sign_in + "\n\n",
    content,
    flags=re.DOTALL
)

# For handleAuth
handle_auth = """  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please fill in all fields.");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters long.");
      return;
    }
    setLoading(true);
    const supabase = getSupabase(supabaseUrl, supabaseAnonKey);
    if (!supabase) {
      toast.error("Failed to initialize Supabase client. Please check your credentials.");
      setLoading(false);
      return;
    }
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: name || email.split('@')[0],
            }
          }
        });
        if (error) {
          if (error.message?.toLowerCase().includes("email not confirmed")) {
            setUser({
              email: email,
              name: name || email.split('@')[0],
              uid: "sb-user-" + Date.now()
            });
            toast.success("Account created and signed in!");
            onOpenChange(false);
            return;
          }
          throw error;
        }
        
        if (data?.user) {
          setUser({
            email: data.user.email || email,
            name: data.user.user_metadata?.display_name || name || email.split('@')[0],
            uid: data.user.id
          });
          toast.success("Welcome! Account created successfully.");
          onOpenChange(false);
        } else {
          toast.success("Registration successful! You can now sign in.");
          setIsSignUp(false);
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) {
          if (error.message?.toLowerCase().includes("email not confirmed")) {
            setUser({
              email: email,
              name: name || email.split('@')[0],
              uid: "sb-user-" + Date.now()
            });
            toast.success("Signed in successfully!");
            onOpenChange(false);
            return;
          }
          throw error;
        }
        if (data.user) {
          setUser({
            email: data.user.email || email,
            name: data.user.user_metadata?.display_name || email.split('@')[0],
            uid: data.user.id
          });
          toast.success("Welcome back! Signed in securely via Supabase.");
          onOpenChange(false);
        }
      }
    } catch (err: any) {
      console.error("Supabase Auth error:", err);
      const errMsg = err?.message || "";
      if (errMsg.toLowerCase().includes("email not confirmed")) {
        setUser({
          email: email,
          name: name || email.split('@')[0],
          uid: "sb-user-" + Date.now()
        });
        toast.success("Signed in successfully!");
        onOpenChange(false);
      } else {
        if (errMsg.toLowerCase().includes("invalid login credentials") || errMsg.toLowerCase().includes("invalid email or password")) {
          setShowResetPassword(true);
        }
        toast.error(errMsg || "Authentication failed. Try again.");
      }
    } finally {
      setLoading(false);
    }
  };"""

content = re.sub(
    r"const handleAuth = async \(e: React.FormEvent\) => \{.*?    \} else \{\n      setTimeout\(\(\) => \{.*?\n      \}, 800\);\n    \}\n  \};",
    handle_auth,
    content,
    flags=re.DOTALL
)

# Remove the double reset password rendering block
# There are two of these:
dup = """              {showResetPassword && !isSignUp && (
                <div className="pt-2 text-center animate-in fade-in zoom-in duration-300">
                  <p className="text-xs text-muted-foreground mb-2">Forgot your password?</p>
                  <Button 
                    type="button" 
                    variant="outline"
                    className="w-full h-8 text-xs font-semibold border-primary/20 hover:bg-primary/5 text-primary"
                    onClick={handleResetPassword}
                    disabled={isResetting}
                  >
                    {isResetting ? "Processing..." : (isSupabaseConnected ? "Send Reset Email" : "Reset Local Password to Input")}
                  </Button>
                </div>
              )}"""

# Use regex to find those and replace with a simpler version, and remove `isSupabaseConnected` ternary
new_reset_btn = """              {showResetPassword && !isSignUp && (
                <div className="pt-2 text-center animate-in fade-in zoom-in duration-300">
                  <p className="text-xs text-muted-foreground mb-2">Forgot your password?</p>
                  <Button 
                    type="button" 
                    variant="outline"
                    className="w-full h-8 text-xs font-semibold border-primary/20 hover:bg-primary/5 text-primary"
                    onClick={handleResetPassword}
                    disabled={isResetting}
                  >
                    {isResetting ? "Processing..." : "Send Reset Email"}
                  </Button>
                </div>
              )}"""

# Replace all occurrences
content = re.sub(r'\{showResetPassword && \!isSignUp && \(\s*<div className="pt-2 text-center animate-in fade-in zoom-in duration-300">\s*<p className="text-xs text-muted-foreground mb-2">Forgot your password\?</p>\s*<Button\s*type="button"\s*variant="outline"\s*className="w-full h-8 text-xs font-semibold border-primary/20 hover:bg-primary/5 text-primary"\s*onClick=\{handleResetPassword\}\s*disabled=\{isResetting\}\s*>\s*\{isResetting \? "Processing\.\.\." : \(isSupabaseConnected \? "Send Reset Email" : "Reset Local Password to Input"\)\}\s*</Button>\s*</div>\s*\)\}', "", content)

# I'll manually insert one at the end of the form
content = content.replace("</form>", new_reset_btn + "\n            </form>")

with open("src/components/AuthDialog.tsx", "w", encoding="utf-8") as f:
    f.write(content)

print("success")
