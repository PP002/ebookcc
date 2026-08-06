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

  // 6-digit authorization code states for register & password reset
  const [signupOtpCode, setSignupOtpCode] = useState("");
  const [signupCodeSent, setSignupCodeSent] = useState(false);
  const [isSendingSignupCode, setIsSendingSignupCode] = useState(false);
  const [isVerifyingSignupOtp, setIsVerifyingSignupOtp] = useState(false);

  const [showResetCodeInput, setShowResetCodeInput] = useState(false);
  const [resetOtpEmail, setResetOtpEmail] = useState("");
  const [resetOtpCode, setResetOtpCode] = useState("");
  const [isVerifyingResetOtp, setIsVerifyingResetOtp] = useState(false);
  const [isResetCodeVerified, setIsResetCodeVerified] = useState(false);

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
      setSignupOtpCode("");
      setSignupCodeSent(false);
      setIsSendingSignupCode(false);
      setShowResetCodeInput(false);
      setResetOtpCode("");
      setResetOtpEmail("");
      setIsResetCodeVerified(false);
    }
  }, [open]);

  const handleSendSignupCode = async () => {
    if (!email || !email.includes('@')) {
      toast.error("Please enter a valid email address first.");
      return;
    }
    if (!password || password.length < 6) {
      toast.error("Please enter a password with at least 6 characters first.");
      return;
    }
    setIsSendingSignupCode(true);
    const supabase = getSupabase(supabaseUrl, supabaseAnonKey);
    if (!supabase) {
      toast.error("Supabase is not connected. Check Settings.");
      setIsSendingSignupCode(false);
      return;
    }
    try {
      let err = null;
      if (!signupCodeSent) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              display_name: name || email.split('@')[0],
            }
          }
        });
        err = error;
      } else {
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email,
        });
        err = error;
      }
      if (err) {
        toast.error(err.message || "Failed to send authorization code.");
      } else {
        setSignupCodeSent(true);
        toast.success(`6-digit authorization code sent to ${email}! (Expires in 5 minutes)`);
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to send authorization code.");
    } finally {
      setIsSendingSignupCode(false);
    }
  };

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
      toast.success(`6-digit authorization code resent to ${targetEmail}! Check your inbox.`);
    }
    setIsResending(false);
  };

  const handleSendResetCode = async () => {
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
      toast.error(error.message || "Failed to send reset code.");
    } else {
      toast.success(`6-digit authorization code sent to ${email}! (Expires in 5 minutes)`);
      setResetOtpEmail(email);
      setShowResetCodeInput(true);
      setIsResetCodeVerified(false);
    }
    setIsResetting(false);
  };

  const handleVerifyResetOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const code = resetOtpCode.trim();
    if (!code || code.length !== 6) {
      toast.error("Please enter the complete 6-digit authorization code.");
      return;
    }
    setIsVerifyingResetOtp(true);
    const supabase = getSupabase(supabaseUrl, supabaseAnonKey);
    if (!supabase) {
      toast.error("Supabase is not connected.");
      setIsVerifyingResetOtp(false);
      return;
    }
    const targetEmail = resetOtpEmail || email;
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: targetEmail,
        token: code,
        type: 'recovery',
      });
      if (error) {
        toast.error(error.message || "Invalid or expired authorization code. Codes expire in 5 minutes.");
      } else if (data?.session || data?.user) {
        toast.success("Authorization code verified! Set your new password below.");
        setIsResetCodeVerified(true);
      } else {
        toast.error("Code verified but session failed to initiate. Please try again.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to verify reset authorization code.");
    } finally {
      setIsVerifyingResetOtp(false);
    }
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

    try {
      const { data, error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        toast.error(error.message || "Failed to update password.");
      } else {
        toast.success("Password updated successfully! Welcome back.");
        const updatedUser = data?.user;
        if (updatedUser) {
          setUser({
            email: updatedUser.email || email || "",
            name: updatedUser.user_metadata?.full_name || updatedUser.user_metadata?.name || updatedUser.user_metadata?.display_name || (updatedUser.email ? updatedUser.email.split('@')[0] : "User"),
            uid: updatedUser.id
          });
        }
        setIsPasswordRecovery(false);
        setShowResetPassword(false);
        setShowResetCodeInput(false);
        setIsResetCodeVerified(false);
        setNewPassword("");
        setConfirmPassword("");
        setResetOtpCode("");
        onOpenChange(false);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to update password.");
    } finally {
      setIsUpdatingPassword(false);
    }
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

    if (isSignUp) {
      if (!email || !password) {
        toast.error("Please enter email and password.");
        return;
      }
      if (password.length < 6) {
        toast.error("Password must be at least 6 characters long.");
        return;
      }
      const supabase = getSupabase(supabaseUrl, supabaseAnonKey);
      if (!supabase) {
        toast.error("Supabase is not connected.");
        return;
      }

      // If user provided a 6-digit code in the signup code box:
      if (signupOtpCode.trim().length === 6) {
        setIsVerifyingSignupOtp(true);
        try {
          let { data, error } = await supabase.auth.verifyOtp({
            email,
            token: signupOtpCode.trim(),
            type: 'signup',
          });
          if (error) {
            const res = await supabase.auth.verifyOtp({
              email,
              token: signupOtpCode.trim(),
              type: 'email',
            });
            data = res.data;
            error = res.error;
          }
          if (error) {
            toast.error(error.message || "Invalid or expired authorization code. Codes expire in 5 minutes.");
          } else if (data?.session && data?.user) {
            setUser({
              email: data.user.email || email,
              name: data.user.user_metadata?.display_name || name || email.split('@')[0],
              uid: data.user.id
            });
            toast.success("Account registered and signed in successfully!");
            onOpenChange(false);
          } else {
            toast.success("Account verified! You can now sign in.");
            setIsSignUp(false);
          }
        } catch (err: any) {
          toast.error(err?.message || "Failed to verify authorization code.");
        } finally {
          setIsVerifyingSignupOtp(false);
        }
        return;
      }

      // If user hasn't sent code yet, send it automatically
      if (!signupCodeSent) {
        await handleSendSignupCode();
        return;
      }

      toast.error("Please enter the 6-digit authorization code sent to your email.");
      return;
    }

    if (!email || !password) {
      toast.error("Please fill in all fields.");
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
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        if (error.message?.toLowerCase().includes("email not confirmed")) {
          setNeedsConfirmation(true);
          toast.error("Email not verified. Enter authorization code or check your inbox.");
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
    } catch (err: any) {
      console.error("Supabase Auth error:", err);
      const errMsg = err?.message || "";
      if (errMsg.toLowerCase().includes("email not confirmed")) {
        setNeedsConfirmation(true);
        toast.error("Email not verified. Please check your inbox for authorization code.");
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

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsPasswordRecovery(false);
                  setShowResetPassword(true);
                }}
                className="text-xs text-primary hover:underline font-medium"
              >
                Link expired or having issues? Request a new reset link
              </button>
            </div>
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
              <Shield className="w-6 h-6" />
            </div>
            <DialogTitle className="text-xl font-bold text-center">
              Enter Authorization Code
            </DialogTitle>
            <p className="text-xs text-muted-foreground text-center">
              We sent a 6-digit authorization code to <span className="font-semibold text-foreground">{verificationSentEmail}</span>.
              <br />
              <span className="text-amber-600 dark:text-amber-400 font-medium">(Code expires in 5 minutes)</span>
            </p>
          </DialogHeader>

          <form onSubmit={handleVerifySignupOtp} className="space-y-4 pt-2">
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground block text-center">
                6-Digit Authorization Code
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="0 0 0 0 0 0"
                value={signupOtpCode}
                onChange={(e) => setSignupOtpCode(e.target.value.replace(/[^0-9]/g, ''))}
                className="w-full text-center text-2xl font-mono tracking-widest p-2.5 border border-border bg-background rounded-md outline-none focus:border-primary shadow-sm"
                required
                autoFocus
              />
            </div>

            <Button
              type="submit"
              disabled={isVerifyingSignupOtp || signupOtpCode.length !== 6}
              className="w-full h-10 font-semibold gap-2 rounded-full"
            >
              {isVerifyingSignupOtp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              <span>Verify Code & Complete Sign Up</span>
            </Button>
          </form>

          <div className="p-3 bg-muted/40 rounded-lg border text-xs text-muted-foreground text-center space-y-1">
            <p className="font-medium text-foreground">Or verify via email link</p>
            <p className="text-[11px]">
              You can also click the verification link in your email inbox to verify directly.
            </p>
          </div>

          <div className="space-y-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={handleResendVerification}
              disabled={isResending}
              className="w-full h-9 text-xs font-semibold gap-2 rounded-full"
            >
              {isResending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
              <span>Resend 6-Digit Code</span>
            </Button>

            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setVerificationSentEmail(null);
                setSignupOtpCode("");
                setIsSignUp(false);
              }}
              className="w-full h-8 text-xs font-medium rounded-full"
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

                  {/* REGISTER WINDOW: BELOW PASSWORD DISPLAY SEND AUTH CODE SECTION DIRECTLY */}
                  {isSignUp && (
                    <div className="p-3 bg-muted/40 border border-border rounded-lg space-y-2 text-left animate-in fade-in zoom-in duration-200">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-foreground flex items-center gap-1">
                          <Shield className="w-3.5 h-3.5 text-primary" /> 6-Digit Authorization Code
                        </label>
                        <button
                          type="button"
                          onClick={handleSendSignupCode}
                          disabled={isSendingSignupCode || !email || !password}
                          className="text-xs text-primary hover:underline font-semibold disabled:opacity-50 flex items-center gap-1"
                        >
                          {isSendingSignupCode ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" /> Sending...
                            </>
                          ) : signupCodeSent ? (
                            "Resend Code"
                          ) : (
                            "Send Code"
                          )}
                        </button>
                      </div>

                      {signupCodeSent && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                          Code sent to <span className="font-semibold">{email}</span> (expires in 5m)
                        </p>
                      )}

                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        placeholder="0 0 0 0 0 0"
                        value={signupOtpCode}
                        onChange={(e) => setSignupOtpCode(e.target.value.replace(/[^0-9]/g, ''))}
                        className="w-full text-center text-xl font-mono tracking-widest p-2 border border-border bg-background rounded-md outline-none focus:border-primary shadow-sm"
                      />
                    </div>
                  )}

                  {needsConfirmation && !isSignUp && (
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
                        Resend Authorization Code
                      </Button>
                    </div>
                  )}

                  <Button 
                    type="submit" 
                    className="w-full h-10 mt-2 font-semibold flex items-center justify-center gap-2 rounded-full"
                    disabled={loading || isVerifyingSignupOtp || isSendingSignupCode}
                  >
                    {(loading || isVerifyingSignupOtp || isSendingSignupCode) ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : isSignUp ? (
                      <>
                        <UserPlus className="w-4 h-4" />
                        <span>Verify Code & Register Account</span>
                      </>
                    ) : (
                      <>
                        <LogIn className="w-4 h-4" />
                        <span>Sign In Securely</span>
                      </>
                    )}
                  </Button>
                </>
              ) : !showResetCodeInput ? (
                <div className="pt-2 space-y-3 animate-in fade-in zoom-in duration-200">
                  <p className="text-xs text-muted-foreground text-center">
                    Enter your email above to receive a 6-digit authorization code for password reset.
                    <br />
                    <span className="text-amber-600 dark:text-amber-400 font-medium">(Code expires in 5 minutes)</span>
                  </p>
                  <Button 
                    type="button" 
                    className="w-full h-10 font-semibold flex items-center justify-center gap-2 rounded-full"
                    onClick={handleSendResetCode}
                    disabled={isResetting}
                  >
                    {isResetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                    <span>Send 6-Digit Authorization Code</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setShowResetPassword(false);
                      setIsResetCodeVerified(false);
                    }}
                    className="w-full text-xs"
                  >
                    Back to Sign In
                  </Button>
                </div>
              ) : !isResetCodeVerified ? (
                <div className="pt-2 space-y-3 animate-in fade-in zoom-in duration-200">
                  <div className="text-center space-y-1">
                    <p className="text-xs font-medium text-foreground">
                      6-Digit Authorization Code Sent
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Sent to <span className="font-semibold text-foreground">{resetOtpEmail || email}</span>
                      <br />
                      <span className="text-amber-600 dark:text-amber-400 font-medium">(Expires in 5 minutes)</span>
                    </p>
                  </div>

                  <div className="space-y-1">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="0 0 0 0 0 0"
                      value={resetOtpCode}
                      onChange={(e) => setResetOtpCode(e.target.value.replace(/[^0-9]/g, ''))}
                      className="w-full text-center text-2xl font-mono tracking-widest p-2 border border-border bg-background rounded-md outline-none focus:border-primary shadow-sm"
                      required
                      autoFocus
                    />
                  </div>

                  <Button 
                    type="button"
                    className="w-full h-10 font-semibold flex items-center justify-center gap-2 rounded-full"
                    onClick={handleVerifyResetOtp}
                    disabled={isVerifyingResetOtp || resetOtpCode.length !== 6}
                  >
                    {isVerifyingResetOtp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                    <span>Verify Code</span>
                  </Button>

                  <div className="flex items-center justify-between text-xs pt-1 px-1">
                    <button
                      type="button"
                      onClick={handleSendResetCode}
                      disabled={isResetting}
                      className="text-primary hover:underline font-medium"
                    >
                      Resend Code
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowResetCodeInput(false);
                        setResetOtpCode("");
                      }}
                      className="text-muted-foreground hover:underline font-medium"
                    >
                      Back to Email
                    </button>
                  </div>
                </div>
              ) : (
                /* AFTER TAP VERIFY CODE: DISPLAY RESET COLUMN BELOW DIRECTLY */
                <div className="pt-2 space-y-3 animate-in fade-in zoom-in duration-200 border-t pt-3">
                  <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 rounded-md text-xs font-medium text-center flex items-center justify-center gap-1.5">
                    <Shield className="w-4 h-4" />
                    <span>Authorization code verified! Enter new password below:</span>
                  </div>

                  <div className="space-y-1 text-left">
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

                  <div className="space-y-1 text-left">
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
                    type="button"
                    className="w-full h-10 font-semibold flex items-center justify-center gap-2 rounded-full"
                    onClick={handleUpdatePassword}
                    disabled={isUpdatingPassword || !newPassword || newPassword.length < 6}
                  >
                    {isUpdatingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                    <span>Save New Password & Sign In</span>
                  </Button>

                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setShowResetPassword(false);
                        setShowResetCodeInput(false);
                        setIsResetCodeVerified(false);
                      }}
                      className="text-xs text-muted-foreground hover:underline font-medium"
                    >
                      Cancel & Back to Sign In
                    </button>
                  </div>
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
