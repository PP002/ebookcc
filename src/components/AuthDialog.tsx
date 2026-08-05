import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAppSettings, getSupabase } from '@/context/AppSettingsContext';
import { Loader2, Mail, Lock, User, LogIn, UserPlus, Shield, BookOpen, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { GoogleLogin } from '@react-oauth/google';

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AuthDialog({ open, onOpenChange }: AuthDialogProps) {
  const { 
    user, setUser, 
    supabaseUrl, supabaseAnonKey, googleClientId,
    isPasswordRecovery, setIsPasswordRecovery,
  } = useAppSettings();

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [verificationSentEmail, setVerificationSentEmail] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  useEffect(() => {
    if (!open) {
      setLoading(false);
      setIsSignUp(false);
      setEmail("");
      setPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowResetPassword(false);
      setVerificationSentEmail(null);
      setNeedsConfirmation(false);
    }
  }, [open]);

  const handleResendVerification = async () => {
    const targetEmail = verificationSentEmail || email;
    if (!targetEmail) {
      toast.error("Please enter your email address.");
      return;
    }
    setIsResending(true);
    const supabase = getSupabase(supabaseUrl, supabaseAnonKey);
    if (!supabase) {
      toast.error("Supabase is not connected.");
      setIsResending(false);
      return;
    }
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: targetEmail,
      options: {
        emailRedirectTo: window.location.origin,
      }
    });
    if (error) {
      toast.error(error.message || "Failed to resend confirmation email.");
    } else {
      toast.success(`Verification email resent to ${targetEmail}! Check your inbox.`);
    }
    setIsResending(false);
  };

  

  const handleResetPassword = async () => {
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
      redirectTo: `${window.location.origin}?type=recovery`,
    });
    if (error) {
      toast.error(error.message || "Failed to send reset email.");
    } else {
      toast.success("Password reset email sent! Please check your inbox for the reset link.");
      setShowResetPassword(false);
    }
    setIsResetting(false);
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      toast.error("Password must be at least 6 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    setIsUpdatingPassword(true);
    const supabase = getSupabase(supabaseUrl, supabaseAnonKey);
    if (!supabase) {
      toast.error("Supabase is not connected.");
      setIsUpdatingPassword(false);
      return;
    }
    const { data, error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      toast.error(error.message || "Failed to update password.");
    } else {
      toast.success("Password updated successfully! Welcome back.");
      if (data?.user) {
        setUser({
          email: data.user.email || "",
          name: data.user.user_metadata?.display_name || data.user.email?.split('@')[0] || "User",
          uid: data.user.id
        });
      }
      setIsPasswordRecovery(false);
      onOpenChange(false);
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
    setIsUpdatingPassword(false);
  };

  const handleGoogleSuccess = async (credentialResponse: any) => {
    if (!credentialResponse.credential) {
      toast.error("No credential received from Google");
      return;
    }
    setLoading(true);
    const supabase = getSupabase(supabaseUrl, supabaseAnonKey);
    if (!supabase) {
      toast.error("Supabase is not connected.");
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: credentialResponse.credential
      });
      if (error) {
        toast.error(error.message || "Failed to sign in with Google.");
        setLoading(false);
        return;
      }
      
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) {
        setUser({
          email: sessionData.session.user.email || "",
          name: sessionData.session.user.user_metadata?.full_name || sessionData.session.user.email?.split('@')[0] || "User",
          uid: sessionData.session.user.id,
          avatarUrl: sessionData.session.user.user_metadata?.avatar_url,
        });
        toast.success("Successfully signed in with Google!");
        onOpenChange(false);
      }
    } catch (err: any) {
      toast.error("Failed to connect to Google login.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignInClick = async () => {
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
    setNeedsConfirmation(false);
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
            emailRedirectTo: window.location.origin,
            data: {
              display_name: name || email.split('@')[0],
            }
          }
        });
        if (error) {
          throw error;
        }
        
        // If Supabase has email confirmation disabled, a session is returned immediately
        if (data?.session && data?.user) {
          setUser({
            email: data.user.email || email,
            name: data.user.user_metadata?.display_name || name || email.split('@')[0],
            uid: data.user.id
          });
          toast.success("Welcome! Account created successfully.");
          onOpenChange(false);
        } else if (data?.user) {
          // Email confirmation is required by Supabase settings
          setVerificationSentEmail(email);
          toast.success("Registration successful! Please verify your email.");
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
            setNeedsConfirmation(true);
            toast.error("Email not verified. Please check your inbox and verify your email before signing in.");
            return;
          }
          throw error;
        }
        if (data?.session && data?.user) {
          setUser({
            email: data.user.email || email,
            name: data.user.user_metadata?.display_name || email.split('@')[0],
            uid: data.user.id
          });
          toast.success("Welcome back! Signed in securely.");
          onOpenChange(false);
        }
      }
    } catch (err: any) {
      console.error("Supabase Auth error:", err);
      const errMsg = err?.message || "";
      if (errMsg.toLowerCase().includes("email not confirmed")) {
        setNeedsConfirmation(true);
        toast.error("Email not verified. Please check your inbox and verify your email before signing in.");
      } else {
        if (errMsg.toLowerCase().includes("invalid login credentials") || errMsg.toLowerCase().includes("invalid email or password")) {
          setShowResetPassword(true);
        }
        toast.error(errMsg || "Authentication failed. Try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (isPasswordRecovery) {
    return (
      <Dialog open={open} onOpenChange={(val) => {
        onOpenChange(val);
        if (!val) setIsPasswordRecovery(false);
      }}>
        <DialogContent className="sm:max-w-[400px] p-6 border shadow-2xl bg-background text-foreground rounded-lg">
          <DialogHeader className="text-center space-y-2">
            <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-1">
              <Lock className="w-6 h-6" />
            </div>
            <DialogTitle className="text-xl font-bold text-center">
              Set New Password
            </DialogTitle>
            <p className="text-xs text-muted-foreground text-center">
              Enter your new password below to update your account credentials.
            </p>
          </DialogHeader>

          <form onSubmit={handleUpdatePassword} className="space-y-4 pt-2">
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                <Lock className="w-3.5 h-3.5" /> New Password
              </label>
              <input
                type="password"
                placeholder="At least 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full text-sm p-2 border border-border bg-background rounded-md outline-none focus:border-primary shadow-sm"
                required
                minLength={6}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                <Lock className="w-3.5 h-3.5" /> Confirm New Password
              </label>
              <input
                type="password"
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full text-sm p-2 border border-border bg-background rounded-md outline-none focus:border-primary shadow-sm"
                required
                minLength={6}
              />
            </div>

            <Button 
              type="submit" 
              disabled={isUpdatingPassword}
              className="w-full h-10 font-semibold flex items-center justify-center gap-2 rounded-full"
            >
              {isUpdatingPassword ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Update Password & Sign In</span>
                </>
              )}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    );
  }

  if (verificationSentEmail) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[420px] p-6 border shadow-2xl bg-background text-foreground rounded-lg">
          <DialogHeader className="text-center space-y-2">
            <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-1">
              <Mail className="w-6 h-6" />
            </div>
            <DialogTitle className="text-xl font-bold text-center">
              Verify Your Email Address
            </DialogTitle>
            <p className="text-xs text-muted-foreground text-center">
              A verification link was sent to <span className="font-semibold text-foreground">{verificationSentEmail}</span>.
            </p>
          </DialogHeader>

          <div className="p-4 bg-muted/40 rounded-lg border text-xs text-muted-foreground space-y-2 text-center my-2">
            <p>
              Please click the link in your email to verify your account and complete registration.
            </p>
            <p className="text-[11px] opacity-80">
              (If you don't see the email, please check your spam or junk folder.)
            </p>
          </div>

          <div className="space-y-2 pt-2">
            <Button
              type="button"
              variant="default"
              onClick={handleResendVerification}
              disabled={isResending}
              className="w-full h-10 font-semibold gap-2 rounded-full"
            >
              {isResending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              <span>Resend Verification Link</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setVerificationSentEmail(null);
                setIsSignUp(false);
              }}
              className="w-full h-10 font-semibold rounded-full"
            >
              Back to Sign In
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

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
          {googleClientId ? (
            <div className="flex justify-center w-full min-h-[40px]">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => {
                  toast.error('Google login failed');
                }}
                useOneTap
                theme="outline"
                size="large"
                shape="pill"
                width="100%"
                text="continue_with"
              />
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleSignInClick}
              disabled={loading}
              className="w-full h-10 border border-border hover:bg-accent/60 font-semibold text-sm flex items-center justify-center gap-2.5 transition-all shadow-sm rounded-full"
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
          )}

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

              {!showResetPassword ? (
                <>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                        <Lock className="w-3.5 h-3.5" /> Password
                      </label>
                      {!isSignUp && (
                        <button
                          type="button"
                          onClick={() => setShowResetPassword(true)}
                          className="text-xs text-primary hover:underline font-medium"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full text-sm p-2 border border-border bg-background rounded-md outline-none focus:border-primary shadow-sm"
                      required
                    />
                  </div>

                  {needsConfirmation && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 rounded-md text-xs space-y-2">
                      <p className="font-medium">Your email address has not been verified yet.</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleResendVerification}
                        disabled={isResending}
                        className="w-full h-8 text-xs border-amber-500/40 hover:bg-amber-500/10 text-amber-700 dark:text-amber-300 font-semibold"
                      >
                        {isResending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Mail className="w-3 h-3 mr-1" />}
                        Resend Verification Link
                      </Button>
                    </div>
                  )}

                  <Button 
                    type="submit" 
                    className="w-full h-10 mt-2 font-semibold flex items-center justify-center gap-2 rounded-full"
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
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
                </>
              ) : (
                <div className="pt-2 space-y-3 animate-in fade-in zoom-in duration-200">
                  <p className="text-xs text-muted-foreground text-center">
                    Enter your email above and click below to receive a password reset link.
                  </p>
                  <Button 
                    type="button" 
                    className="w-full h-10 font-semibold flex items-center justify-center gap-2 rounded-full"
                    onClick={handleResetPassword}
                    disabled={isResetting}
                  >
                    {isResetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                    <span>Send Password Reset Email</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowResetPassword(false)}
                    className="w-full text-xs"
                  >
                    Back to Sign In
                  </Button>
                </div>
              )}
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
