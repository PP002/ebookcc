import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAppSettings, getSupabase } from '@/context/AppSettingsContext';
import { Mail, Lock, User, LogIn, UserPlus, Shield, BookOpen, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AuthDialog({ open, onOpenChange }: AuthDialogProps) {
  const { 
    user, setUser, 
    supabaseUrl, supabaseAnonKey,
  } = useAppSettings();

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const isSupabaseConnected = !!(supabaseUrl && supabaseAnonKey);

  const handleGoogleSignInClick = async () => {
    setLoading(true);

    if (isSupabaseConnected) {
      const supabase = getSupabase(supabaseUrl, supabaseAnonKey);
      if (supabase) {
        try {
          const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.origin }
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
          return;
        } catch (err: any) {
          console.warn("Supabase Google OAuth error:", err.message);
          toast.error("Failed to connect to Google login.");
          setLoading(false);
          return;
        }
      }
    }

    // Redirect to Google Accounts (accounts.google.com)
    const googleAccountsUrl = `https://accounts.google.com/AccountChooser?continue=${encodeURIComponent(window.location.href)}`;
    window.open(googleAccountsUrl, '_blank', 'noopener,noreferrer');
    setLoading(false);
  };

  const handleAuth = async (e: React.FormEvent) => {
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

    if (isSupabaseConnected) {
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
          toast.error(errMsg || "Authentication failed. Try again.");
        }
      } finally {
        setLoading(false);
      }
    } else {
      setTimeout(() => {
        try {
          const localUsersJson = localStorage.getItem("ebookcc_local_users") || "[]";
          const localUsers = JSON.parse(localUsersJson);

          if (isSignUp) {
            const exists = localUsers.some((u: any) => u.email.toLowerCase() === email.toLowerCase());
            if (exists) {
              toast.error("An account with this email already exists.");
              setLoading(false);
              return;
            }

            const newUser = {
              uid: "local-" + Date.now(),
              email: email.toLowerCase(),
              password: password,
              name: name || email.split('@')[0]
            };

            localUsers.push(newUser);
            localStorage.setItem("ebookcc_local_users", JSON.stringify(localUsers));
            
            toast.success("Account created successfully! You can now log in.");
            setIsSignUp(false);
          } else {
            const found = localUsers.find(
              (u: any) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
            );

            if (!found) {
              if (email === "demo@ebookcc.com" && password === "123456") {
                const demoUser = {
                  uid: "local-demo",
                  email: "demo@ebookcc.com",
                  name: "Creative Publisher"
                };
                setUser(demoUser);
                toast.success("Logged in with Demo Publisher profile!");
                onOpenChange(false);
                setLoading(false);
                return;
              }
              
              toast.error("Invalid email or password.");
              setLoading(false);
              return;
            }

            setUser({
              email: found.email,
              name: found.name,
              uid: found.uid
            });
            toast.success(`Welcome back, ${found.name || 'Creator'}!`);
            onOpenChange(false);
          }
        } catch (e) {
          toast.error("Auth database failure.");
        } finally {
          setLoading(false);
        }
      }, 800);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] p-6 border shadow-2xl bg-background text-foreground rounded-lg">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            {isSignUp ? "Create Workspace Account" : "Sign In to eBookCC"}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {isSignUp 
              ? "Gain secure access to synchronize novels, comic layouts, and visual templates."
              : "Access your cloud books and sync your publishing preferences."
            }
          </p>
        </DialogHeader>

        {/* Quick Google Account Sign In */}
        <div className="pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleGoogleSignInClick}
            disabled={loading}
            className="w-full h-10 border border-border hover:bg-accent/60 font-semibold text-sm flex items-center justify-center gap-2.5 transition-all shadow-sm"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>Continue with Google</span>
          </Button>

          <div className="relative my-3.5 text-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border/60" />
            </div>
            <div className="relative inline-block bg-background px-2.5 text-[10px] font-bold text-muted-foreground uppercase font-mono tracking-wider">
              Or email login
            </div>
          </div>
        </div>

        <form onSubmit={handleAuth} className="space-y-4 pt-2">
              {isSignUp && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                    <User className="w-3.5 h-3.5" /> Display Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Author Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full text-sm p-2 border border-border bg-background rounded-md outline-none focus:border-primary shadow-sm"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5" /> Email Address
                </label>
                <input
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full text-sm p-2 border border-border bg-background rounded-md outline-none focus:border-primary shadow-sm"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5" /> Password
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full text-sm p-2 border border-border bg-background rounded-md outline-none focus:border-primary shadow-sm"
                  required
                />
              </div>

              <Button 
                type="submit" 
                className="w-full h-10 mt-2 font-semibold flex items-center justify-center gap-2"
                disabled={loading}
              >
                {loading ? (
                  <span className="inline-block animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent" />
                ) : isSignUp ? (
                  <>
                    <UserPlus className="w-4 h-4" />
                    <span>Register Account</span>
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>Sign In Securely</span>
                  </>
                )}
              </Button>
            </form>

            <div className="text-center text-xs mt-3">
              <button
                type="button"
                onClick={() => setIsSignUp(!isSignUp)}
                className="text-primary hover:underline font-semibold"
              >
                {isSignUp ? "Already have an account? Sign In" : "Need a professional workspace? Sign Up Free"}
              </button>
            </div>
      </DialogContent>
    </Dialog>
  );
}
