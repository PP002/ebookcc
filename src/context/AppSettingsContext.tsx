import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { toast } from 'sonner';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getApiUrl } from '@/lib/api';


export type LlmEngine = 'gemini' | 'local' | 'pollinations' | 'openai' | 'claude' | 'qwen' | 'puter';

export interface UserSession {
  email: string;
  name?: string;
  uid: string;
  avatarUrl?: string;
  photoURL?: string;
}

export interface AppSettings {
  llmEngine: LlmEngine;
  setLlmEngine: (val: LlmEngine) => void;
  geminiApiKey: string;
  setGeminiApiKey: (val: string) => void;
  stabilityApiKey: string;
  setStabilityApiKey: (val: string) => void;
  localLlmUrl: string;
  setLocalLlmUrl: (val: string) => void;
  localLlmModel: string;
  setLocalLlmModel: (val: string) => void;
  localLlmApiKey: string;
  setLocalLlmApiKey: (val: string) => void;
  showSettingsDialog: boolean;
  setShowSettingsDialog: (val: boolean) => void;
  
  // Supabase & Cloudflare R2 integrations
  supabaseUrl: string;
  setSupabaseUrl: (val: string) => void;
  supabaseAnonKey: string;
  setSupabaseAnonKey: (val: string) => void;
  googleClientId: string;
  setGoogleClientId: (val: string) => void;
  r2AccessKeyId: string;
  setR2AccessKeyId: (val: string) => void;
  r2SecretAccessKey: string;
  setR2SecretAccessKey: (val: string) => void;
  r2BucketName: string;
  setR2BucketName: (val: string) => void;
  r2Endpoint: string;
  setR2Endpoint: (val: string) => void;
  
  // User Session
  user: UserSession | null;
  setUser: (val: UserSession | null) => void;
  showAuthDialog: boolean;
  setShowAuthDialog: (val: boolean) => void;
  isPasswordRecovery: boolean;
  setIsPasswordRecovery: (val: boolean) => void;
}

const AppSettingsContext = createContext<AppSettings | undefined>(undefined);

// Lazy init supabase client
let supabaseInstance: SupabaseClient | null = null;
export function getSupabase(url: string, key: string): SupabaseClient | null {
  if (!url || !key) return null;
  if (!supabaseInstance) {
    try {
      supabaseInstance = createClient(url, key);
    } catch (e) {
      console.error("Supabase initialization error:", e);
    }
  }
  return supabaseInstance;
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [llmEngine, setLlmEngine] = useState<LlmEngine>(() => (localStorage.getItem('llm_engine') || 'pollinations') as LlmEngine);
  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem('gemini_api_key') || "");
  const [stabilityApiKey, setStabilityApiKey] = useState(() => localStorage.getItem('stability_api_key') || "");
  const [localLlmUrl, setLocalLlmUrl] = useState(() => localStorage.getItem('local_llm_url') || "http://localhost:11434/v1");
  const [localLlmModel, setLocalLlmModel] = useState(() => localStorage.getItem('local_llm_model') || "llama3");
  const [localLlmApiKey, setLocalLlmApiKey] = useState(() => localStorage.getItem('local_llm_api_key') || "");
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);

  // Supabase & Cloudflare R2 states
  const [supabaseUrl, setSupabaseUrl] = useState(() => {
    let saved = localStorage.getItem('supabase_url');
    // If the saved URL is the old default or a local proxy path, scrub it out to allow direct connection
    if (saved && saved.includes("/supabase-api")) {
      saved = "https://wipjqdmystqfzwsmvscx.supabase.co";
      localStorage.setItem('supabase_url', saved);
    }
    return saved || import.meta.env.VITE_SUPABASE_URL || "https://wipjqdmystqfzwsmvscx.supabase.co";
  });
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(() => {
    return localStorage.getItem('supabase_anon_key') || import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_qP560tjdVzDl4lsNTe0WUQ_S6BF7dEX";
  });
  const [googleClientId, setGoogleClientId] = useState(() => {
    return localStorage.getItem('google_client_id') || import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
  });
  const [r2AccessKeyId, setR2AccessKeyId] = useState(() => {
    return localStorage.getItem('r2_access_key') || import.meta.env.VITE_R2_ACCESS_KEY_ID || "";
  });
  const [r2SecretAccessKey, setR2SecretAccessKey] = useState(() => {
    return localStorage.getItem('r2_secret_key') || import.meta.env.VITE_R2_SECRET_ACCESS_KEY || "";
  });
  const [r2BucketName, setR2BucketName] = useState(() => {
    const saved = localStorage.getItem('r2_bucket_name') || import.meta.env.VITE_R2_BUCKET_NAME;
    if (!saved || saved === "ebookcc-assets") return "ebookcc-media";
    return saved;
  });
  const [r2Endpoint, setR2Endpoint] = useState(() => {
    return localStorage.getItem('r2_endpoint') || import.meta.env.VITE_R2_ENDPOINT || "";
  });

  // Fetch safe configuration from backend on mount
  useEffect(() => {
    fetch(`${getApiUrl()}/api/config`)
      .then(res => {
        if (!res.ok) throw new Error("Config fetch failed");
        return res.json();
      })
      .then(data => {
        let fetchedSupabaseUrl = data.supabaseUrl || "";
        if (fetchedSupabaseUrl.includes("/supabase-api")) {
          fetchedSupabaseUrl = "https://wipjqdmystqfzwsmvscx.supabase.co";
        }
        setSupabaseUrl(prev => prev || fetchedSupabaseUrl);
        setSupabaseAnonKey(prev => prev || data.supabaseAnonKey || "sb_publishable_qP560tjdVzDl4lsNTe0WUQ_S6BF7dEX");
        setR2BucketName(prev => prev || data.r2BucketName || "");
        setR2Endpoint(prev => prev || data.r2Endpoint || "");
      })
      .catch(err => {
        console.warn("Could not retrieve secure configuration from backend server, using default or local values.", err);
      });
  }, []);

  // Auth User state
  const [user, setUser] = useState<UserSession | null>(() => {
    const saved = localStorage.getItem('auth_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  // Check URL on load for recovery link or auth tokens/errors
  useEffect(() => {
    const handleUrlAuth = async () => {
      if (!supabaseUrl || !supabaseAnonKey) return;
      const supabase = getSupabase(supabaseUrl, supabaseAnonKey);
      if (!supabase) return;

      const hash = window.location.hash || "";
      const search = window.location.search || "";
      const href = window.location.href || "";

      // Parse hash and search params
      const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
      const searchParams = new URLSearchParams(search);

      // 1. Check for error description from Supabase auth redirect
      const errorDesc = hashParams.get('error_description') || searchParams.get('error_description');
      const errorMsg = hashParams.get('error') || searchParams.get('error');

      if (errorDesc || errorMsg) {
        const decodedMsg = decodeURIComponent((errorDesc || errorMsg || "").replace(/\+/g, ' '));
        toast.error(`Authentication error: ${decodedMsg}`);
        if (href.includes('recovery') || href.includes('reset') || href.includes('type=recovery')) {
          setIsPasswordRecovery(false);
          setShowAuthDialog(true);
        }
        return;
      }

      // 2. Check for type=recovery anywhere in hash, search, or href
      const isRecovery = 
        hashParams.get('type') === 'recovery' || 
        searchParams.get('type') === 'recovery' ||
        href.includes('type=recovery') ||
        href.includes('recovery');

      if (isRecovery) {
        setIsPasswordRecovery(true);
        setShowAuthDialog(true);
      }

      // 3. Handle Implicit flow: access_token and refresh_token in hash
      const accessToken = hashParams.get('access_token') || searchParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token') || searchParams.get('refresh_token');

      if (accessToken && refreshToken) {
        try {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (!error && data?.session) {
            if (isRecovery) {
              setIsPasswordRecovery(true);
              setShowAuthDialog(true);
              toast.success("Recovery session established! Please enter your new password.");
            }
          } else if (error) {
            console.error("Error setting session from URL tokens:", error);
          }
        } catch (e) {
          console.error("setSession error:", e);
        }
      }

      // 4. Handle PKCE code in query params
      const code = searchParams.get('code') || hashParams.get('code');
      if (code) {
        try {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (!error && data?.session) {
            if (isRecovery) {
              setIsPasswordRecovery(true);
              setShowAuthDialog(true);
              toast.success("Recovery session established! Please enter your new password.");
            }
          } else if (error) {
            console.error("Error exchanging code for session:", error);
          }
        } catch (e) {
          console.error("exchangeCodeForSession error:", e);
        }
      }

      // 5. Handle OTP / token_hash verification
      const tokenHash = searchParams.get('token_hash') || hashParams.get('token_hash');
      const otpType = (searchParams.get('type') || hashParams.get('type') || 'recovery') as any;

      if (tokenHash) {
        try {
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: otpType,
          });
          if (!error && data?.session) {
            if (otpType === 'recovery' || isRecovery) {
              setIsPasswordRecovery(true);
              setShowAuthDialog(true);
              toast.success("Recovery link verified! Please enter your new password.");
            } else {
              toast.success("Email verified successfully!");
            }
          } else if (error) {
            toast.error(error.message || "Failed to verify link.");
          }
        } catch (e) {
          console.error("Error verifying OTP:", e);
        }
      }
    };

    handleUrlAuth();
  }, [supabaseUrl, supabaseAnonKey]);

  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey) return;
    const supabase = getSupabase(supabaseUrl, supabaseAnonKey);
    if (!supabase) return;

    // Fetch initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser({
          email: session.user.email || "",
          name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || "User",
          avatarUrl: session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture,
          uid: session.user.id
        });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
        setShowAuthDialog(true);
        toast.info("Password reset link verified! Please enter your new password below.");
      }
      if (session?.user) {
        setUser({
          email: session.user.email || "",
          name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || "User",
          avatarUrl: session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture,
          uid: session.user.id
        });
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabaseUrl, supabaseAnonKey]);


  useEffect(() => {
    localStorage.setItem('llm_engine', llmEngine);
  }, [llmEngine]);

  useEffect(() => {
    if (geminiApiKey) localStorage.setItem('gemini_api_key', geminiApiKey);
    else localStorage.removeItem('gemini_api_key');
  }, [geminiApiKey]);

  useEffect(() => {
    if (stabilityApiKey) localStorage.setItem('stability_api_key', stabilityApiKey);
    else localStorage.removeItem('stability_api_key');
  }, [stabilityApiKey]);

  useEffect(() => {
    if (localLlmUrl) localStorage.setItem('local_llm_url', localLlmUrl);
  }, [localLlmUrl]);

  useEffect(() => {
    if (localLlmModel) localStorage.setItem('local_llm_model', localLlmModel);
  }, [localLlmModel]);

  useEffect(() => {
    if (localLlmApiKey) localStorage.setItem('local_llm_api_key', localLlmApiKey);
    else localStorage.removeItem('local_llm_api_key');
  }, [localLlmApiKey]);

  // Save integration keys
  useEffect(() => {
    if (supabaseUrl) localStorage.setItem('supabase_url', supabaseUrl);
    else localStorage.removeItem('supabase_url');
    // reset client on key change
    supabaseInstance = null;
  }, [supabaseUrl]);

  useEffect(() => {
    if (supabaseAnonKey) localStorage.setItem('supabase_anon_key', supabaseAnonKey);
    else localStorage.removeItem('supabase_anon_key');
    supabaseInstance = null;
  }, [supabaseAnonKey]);

  useEffect(() => {
    if (googleClientId) localStorage.setItem('google_client_id', googleClientId);
    else localStorage.removeItem('google_client_id');
  }, [googleClientId]);

  useEffect(() => {
    if (r2AccessKeyId) localStorage.setItem('r2_access_key', r2AccessKeyId);
    else localStorage.removeItem('r2_access_key');
  }, [r2AccessKeyId]);

  useEffect(() => {
    if (r2SecretAccessKey) localStorage.setItem('r2_secret_key', r2SecretAccessKey);
    else localStorage.removeItem('r2_secret_key');
  }, [r2SecretAccessKey]);

  useEffect(() => {
    if (r2BucketName) localStorage.setItem('r2_bucket_name', r2BucketName);
    else localStorage.removeItem('r2_bucket_name');
  }, [r2BucketName]);

  useEffect(() => {
    if (r2Endpoint) localStorage.setItem('r2_endpoint', r2Endpoint);
    else localStorage.removeItem('r2_endpoint');
  }, [r2Endpoint]);

  // Persist user session
  useEffect(() => {
    if (user) {
      localStorage.setItem('auth_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('auth_user');
    }
  }, [user]);

  return (
    <AppSettingsContext.Provider value={{
      llmEngine, setLlmEngine,
      geminiApiKey, setGeminiApiKey,
      stabilityApiKey, setStabilityApiKey,
      localLlmUrl, setLocalLlmUrl,
      localLlmModel, setLocalLlmModel,
      localLlmApiKey, setLocalLlmApiKey,
      showSettingsDialog, setShowSettingsDialog,
      
      // Integrations
      supabaseUrl, setSupabaseUrl,
      supabaseAnonKey, setSupabaseAnonKey,
      googleClientId, setGoogleClientId,
      r2AccessKeyId, setR2AccessKeyId,
      r2SecretAccessKey, setR2SecretAccessKey,
      r2BucketName, setR2BucketName,
      r2Endpoint, setR2Endpoint,
      
      // User Auth
      user, setUser,
      showAuthDialog, setShowAuthDialog,
      isPasswordRecovery, setIsPasswordRecovery
    }}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext);
  if (!context) throw new Error("useAppSettings must be used within AppSettingsProvider");
  return context;
}

export function handleApiError(err: any, setShowSettingsDialog: (val: boolean) => void, engine?: string) {
  const errorMsg = typeof err === 'string' ? err : (err.message || "");
  if (
    errorMsg.includes("429") || 
    errorMsg.includes("403") || 
    errorMsg.toLowerCase().includes("quota") || 
    errorMsg.includes("API_KEY_INVALID") || 
    errorMsg.toLowerCase().includes("user free tier expire") ||
    errorMsg.toLowerCase().includes("api key expired") ||
    errorMsg.toLowerCase().includes("api key not valid") ||
    errorMsg.toLowerCase().includes("api key missing") ||
    (engine === 'pollinations' && (errorMsg.includes("Failed to fetch") || errorMsg.includes("fetch") || errorMsg.includes("502") || errorMsg.includes("503") || errorMsg.includes("timeout")))
  ) {
    setShowSettingsDialog(true);
    if (engine === 'pollinations') {
      toast.error("Pollinations API is overloaded. Please switch to Gemini or another provider in App Settings.");
    } else {
      toast.error("API Key issue or Quota Exceeded. Please check App Settings.");
    }
    return true; 
  }
  return false;
}
