/**
 * AISettingsDialog.tsx
 *
 * AI Settings Page Dialog (4:3 aspect ratio window):
 * - Layout: Left sidebar menu + right content pane (on mobile: top dropdown).
 * - 4:3 Window Aspect Ratio.
 * - Sidebar items:
 *   1. Vision (two sections on one page: "OCR" and "Vision Analyst")
 *   2. Text to Speech (with interactive reorderable provider fallback order)
 *   3. Text to Image
 *   4. Director
 *   5. Music
 *   6. Sound Effects
 *   7. Storage & Cloud (Dedicated sidebar: Supabase DB & Cloudflare R2 & Drive sync)
 *   8. General & Local LLM (Dedicated sidebar: Global LLM engine, Ollama/LM Studio local model)
 *
 * Features per section:
 * - Switch button to choose "Use platform credits" vs "Use my own API key"
 * - Provider & model dropdowns loaded from server config (/api/ai/config)
 * - API key field with password input, "Save", and "Test key"
 * - Masked key display (sk-...abcd) with "Replace" and "Delete"
 * - Dynamic price hints
 */

import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Eye,
  Volume2,
  Image as ImageIcon,
  Film,
  Music,
  Zap,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Key,
  Trash2,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  ShieldCheck,
  Sparkles,
  Info,
  Database,
  Cpu,
  Cloud,
  HardDrive,
} from "lucide-react";
import { useAppSettings } from "@/context/AppSettingsContext";
import { getApiUrl } from "@/lib/api";
import { toast } from "sonner";

type TabId =
  | "vision"
  | "tts"
  | "text_to_image"
  | "director"
  | "music"
  | "sfx"
  | "storage"
  | "general_llm";

interface ServerFeatureItem {
  id: string;
  name: string;
  description: string;
  sections?: Array<{ id: string; title: string; description: string }>;
  providers: Array<{
    id: string;
    name: string;
    models: Array<{ id: string; name: string; description?: string; isDefault?: boolean }>;
  }>;
  defaultProvider: string;
  defaultModel: string;
  defaultMode: "platform_credits" | "own_key";
}

export function AISettingsDialog() {
  const {
    showAiSettingsDialog,
    setShowAiSettingsDialog,
    user,
    llmEngine,
    setLlmEngine,
    geminiApiKey,
    setGeminiApiKey,
    stabilityApiKey,
    setStabilityApiKey,
    localLlmUrl,
    setLocalLlmUrl,
    localLlmModel,
    setLocalLlmModel,
    localLlmApiKey,
    setLocalLlmApiKey,
    supabaseUrl,
    setSupabaseUrl,
    supabaseAnonKey,
    setSupabaseAnonKey,
    r2AccessKeyId,
    setR2AccessKeyId,
    r2SecretAccessKey,
    setR2SecretAccessKey,
    r2BucketName,
    setR2BucketName,
    r2Endpoint,
    setR2Endpoint,
  } = useAppSettings();

  const [activeTab, setActiveTab] = useState<TabId>("vision");
  const [catalog, setCatalog] = useState<Record<string, ServerFeatureItem>>({});
  const [loadingConfig, setLoadingConfig] = useState(true);

  // Per-feature user configuration state
  const [featureSettings, setFeatureSettings] = useState<
    Record<
      string,
      {
        mode: "platform_credits" | "own_key";
        provider: string;
        model: string;
        ttsFallbackOrder?: string[];
      }
    >
  >({});

  // Masked keys returned from server
  const [maskedKeys, setMaskedKeys] = useState<Record<string, string>>({});

  // Temporary input state for adding/replacing API keys: provider -> input value
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [testingKeyProvider, setTestingKeyProvider] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ provider: string; success: boolean; message: string } | null>(null);
  const [savingKeyProvider, setSavingKeyProvider] = useState<string | null>(null);

  // Price estimate hints fetched from server
  const [priceHints, setPriceHints] = useState<Record<string, string>>({});

  // Storage local inputs
  const [localSubUrl, setLocalSubUrl] = useState(supabaseUrl);
  const [localSubKey, setLocalSubKey] = useState(supabaseAnonKey);
  const [localR2Bucket, setLocalR2Bucket] = useState(r2BucketName);
  const [localR2Access, setLocalR2Access] = useState(r2AccessKeyId);
  const [localR2Secret, setLocalR2Secret] = useState(r2SecretAccessKey);
  const [localR2Endpoint, setLocalR2Endpoint] = useState(r2Endpoint);

  // General LLM local inputs
  const [localEngineVal, setLocalEngineVal] = useState(llmEngine);
  const [localGeminiKeyVal, setLocalGeminiKeyVal] = useState(geminiApiKey);
  const [localOllamaUrl, setLocalOllamaUrl] = useState(localLlmUrl);
  const [localOllamaModel, setLocalOllamaModel] = useState(localLlmModel);
  const [localOllamaKey, setLocalOllamaKey] = useState(localLlmApiKey);

  // Sync inputs on open
  useEffect(() => {
    if (showAiSettingsDialog) {
      setLocalSubUrl(supabaseUrl);
      setLocalSubKey(supabaseAnonKey);
      setLocalR2Bucket(r2BucketName);
      setLocalR2Access(r2AccessKeyId);
      setLocalR2Secret(r2SecretAccessKey);
      setLocalR2Endpoint(r2Endpoint);

      setLocalEngineVal(llmEngine);
      setLocalGeminiKeyVal(geminiApiKey);
      setLocalOllamaUrl(localLlmUrl);
      setLocalOllamaModel(localLlmModel);
      setLocalOllamaKey(localLlmApiKey);
    }
  }, [
    showAiSettingsDialog,
    supabaseUrl,
    supabaseAnonKey,
    r2BucketName,
    r2AccessKeyId,
    r2SecretAccessKey,
    r2Endpoint,
    llmEngine,
    geminiApiKey,
    localLlmUrl,
    localLlmModel,
    localLlmApiKey,
  ]);

  // Load server catalog and user settings
  useEffect(() => {
    if (!showAiSettingsDialog) return;

    setLoadingConfig(true);
    // 1. Fetch server catalog
    fetch(`${getApiUrl()}/api/ai/config`)
      .then((res) => res.json())
      .then((data) => {
        if (data.catalog) {
          setCatalog(data.catalog);
        }
      })
      .catch((e) => console.warn("Failed to fetch AI catalog:", e.message))
      .finally(() => setLoadingConfig(false));

    // 2. Fetch user settings if logged in
    if (user) {
      fetch(`${getApiUrl()}/api/ai/user-settings`, {
        headers: { "x-user-id": user.uid },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) {
            if (data.featureSettings) setFeatureSettings(data.featureSettings);
            if (data.maskedKeys) setMaskedKeys(data.maskedKeys);
          }
        })
        .catch((e) => console.warn("Failed to fetch user AI settings:", e.message));
    }
  }, [showAiSettingsDialog, user]);

  // Update price hint when active tab, provider or model changes
  useEffect(() => {
    if (!catalog[activeTab]) return;
    const currentSetting = featureSettings[activeTab] || {
      mode: catalog[activeTab].defaultMode,
      provider: catalog[activeTab].defaultProvider,
      model: catalog[activeTab].defaultModel,
    };

    if (currentSetting.mode === "own_key") {
      setPriceHints((prev) => ({
        ...prev,
        [activeTab]: "Billed directly by your own API provider (Zero platform deduction)",
      }));
      return;
    }

    fetch(`${getApiUrl()}/api/billing/estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature: activeTab === "vision" ? "vision_ocr" : activeTab,
        model: currentSetting.model,
        units: 1,
        isOwnKey: false,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.priceHint) {
          setPriceHints((prev) => ({ ...prev, [activeTab]: data.priceHint }));
        }
      })
      .catch(() => {});
  }, [activeTab, featureSettings, catalog]);

  const handleModeChange = (featId: string, mode: "platform_credits" | "own_key") => {
    setFeatureSettings((prev) => {
      const current = prev[featId] || {
        mode: catalog[featId]?.defaultMode || "platform_credits",
        provider: catalog[featId]?.defaultProvider || "workers_ai",
        model: catalog[featId]?.defaultModel || "",
      };
      const updated = { ...current, mode };
      saveFeatureSettingToServer(featId, updated);
      return { ...prev, [featId]: updated };
    });
  };

  const handleProviderChange = (featId: string, provider: string) => {
    const featCat = catalog[featId];
    const provObj = featCat?.providers.find((p) => p.id === provider);
    const newModel = provObj?.models[0]?.id || "";

    setFeatureSettings((prev) => {
      const current = prev[featId] || {
        mode: featCat?.defaultMode || "platform_credits",
        provider,
        model: newModel,
      };
      const updated = { ...current, provider, model: newModel };
      saveFeatureSettingToServer(featId, updated);
      return { ...prev, [featId]: updated };
    });
  };

  const handleModelChange = (featId: string, model: string) => {
    setFeatureSettings((prev) => {
      const current = prev[featId] || {
        mode: catalog[featId]?.defaultMode || "platform_credits",
        provider: catalog[featId]?.defaultProvider || "workers_ai",
        model,
      };
      const updated = { ...current, model };
      saveFeatureSettingToServer(featId, updated);
      return { ...prev, [featId]: updated };
    });
  };

  const saveFeatureSettingToServer = async (feature: string, setting: any) => {
    if (!user) return;
    try {
      await fetch(`${getApiUrl()}/api/ai/save-feature-setting`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": user.uid,
        },
        body: JSON.stringify({ feature, setting }),
      });
    } catch (e: any) {
      console.warn("Error saving setting:", e.message);
    }
  };

  // Reordering TTS fallback order
  const handleMoveTtsProvider = (index: number, direction: "up" | "down") => {
    const currentOrder =
      featureSettings.tts?.ttsFallbackOrder || ["workers_ai", "elevenlabs", "openai", "google"];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentOrder.length) return;

    const newOrder = [...currentOrder];
    const temp = newOrder[index];
    newOrder[index] = newOrder[targetIndex];
    newOrder[targetIndex] = temp;

    setFeatureSettings((prev) => {
      const current = prev.tts || {
        mode: "platform_credits",
        provider: "workers_ai",
        model: "@cf/deepgram/aura-2-en",
      };
      const updated = { ...current, ttsFallbackOrder: newOrder };
      saveFeatureSettingToServer("tts", updated);
      return { ...prev, tts: updated };
    });
    toast.success("TTS provider fallback order updated.");
  };

  // Save API Key to Encrypted Server Vault
  const handleSaveApiKey = async (provider: string) => {
    const rawKey = apiKeyInputs[provider]?.trim();
    if (!rawKey) {
      toast.error("Please enter an API key to save.");
      return;
    }
    if (!user) {
      toast.error("Please sign in to save your encrypted keys.");
      return;
    }

    try {
      setSavingKeyProvider(provider);
      const res = await fetch(`${getApiUrl()}/api/ai/save-key`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": user.uid,
        },
        body: JSON.stringify({ provider, apiKey: rawKey }),
      });
      const data = await res.json();
      if (res.ok && data.masked) {
        setMaskedKeys((prev) => ({ ...prev, [provider]: data.masked }));
        setApiKeyInputs((prev) => ({ ...prev, [provider]: "" }));
        toast.success(`API key for ${provider} saved and encrypted.`);
      } else {
        toast.error(data.error || "Failed to save key.");
      }
    } catch (err: any) {
      toast.error(`Error saving key: ${err.message}`);
    } finally {
      setSavingKeyProvider(null);
    }
  };

  // Delete API Key from Server Vault
  const handleDeleteApiKey = async (provider: string) => {
    if (!user) return;
    try {
      const res = await fetch(`${getApiUrl()}/api/ai/delete-key`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": user.uid,
        },
        body: JSON.stringify({ provider }),
      });
      if (res.ok) {
        setMaskedKeys((prev) => {
          const next = { ...prev };
          delete next[provider];
          return next;
        });
        toast.info(`API key for ${provider} deleted.`);
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Test API Key with a real minimal provider call
  const handleTestApiKey = async (provider: string) => {
    const rawKey = apiKeyInputs[provider]?.trim();
    setTestingKeyProvider(provider);
    setTestResult(null);

    try {
      const res = await fetch(`${getApiUrl()}/api/ai/test-key`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": user?.uid || "anon",
        },
        body: JSON.stringify({ provider, apiKey: rawKey }),
      });
      const data = await res.json();
      setTestResult({
        provider,
        success: data.success,
        message: data.message || (data.success ? "Key is valid!" : "Failed to verify key."),
      });
      if (data.success) {
        toast.success(`Key verified successfully for ${provider}!`);
      } else {
        toast.error(`Key verification failed: ${data.message}`);
      }
    } catch (e: any) {
      setTestResult({ provider, success: false, message: e.message || "Network test failed." });
      toast.error(`Key test error: ${e.message}`);
    } finally {
      setTestingKeyProvider(null);
    }
  };

  // Save Storage credentials
  const handleSaveStorage = () => {
    setSupabaseUrl(localSubUrl);
    setSupabaseAnonKey(localSubKey);
    setR2BucketName(localR2Bucket);
    setR2AccessKeyId(localR2Access);
    setR2SecretAccessKey(localR2Secret);
    setR2Endpoint(localR2Endpoint);
    toast.success("Storage and Cloud configurations saved.");
  };

  // Save General LLM settings
  const handleSaveGeneralLlm = () => {
    setLlmEngine(localEngineVal);
    setGeminiApiKey(localGeminiKeyVal);
    setLocalLlmUrl(localOllamaUrl);
    setLocalLlmModel(localOllamaModel);
    setLocalLlmApiKey(localOllamaKey);
    toast.success("General & Local LLM settings saved.");
  };

  // Sidebar navigation items: Feature items + dedicated Storage & Cloud + dedicated General LLM
  const sidebarItems: Array<{ id: TabId; label: string; icon: any; category?: string }> = [
    { id: "vision", label: "Vision", icon: Eye },
    { id: "tts", label: "Text to Speech", icon: Volume2 },
    { id: "text_to_image", label: "Text to Image", icon: ImageIcon },
    { id: "director", label: "Director", icon: Film },
    { id: "music", label: "Music", icon: Music },
    { id: "sfx", label: "Sound Effects", icon: Zap },
    { id: "storage", label: "Storage & Cloud", icon: Database, category: "Infrastructure" },
    { id: "general_llm", label: "General & Local LLM", icon: Cpu, category: "Infrastructure" },
  ];

  return (
    <Dialog open={showAiSettingsDialog} onOpenChange={setShowAiSettingsDialog}>
      <DialogContent
        className="w-[94vw] max-w-[920px] aspect-[4/3] max-h-[88vh] p-0 flex flex-col overflow-hidden gap-0 rounded-xl bg-card border-border shadow-2xl"
        style={{ aspectRatio: "4/3" }}
      >
        <DialogHeader className="px-6 py-3.5 border-b border-border bg-muted/20 flex flex-row items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-foreground">AI Provider Settings</DialogTitle>
              <p className="text-xs text-muted-foreground">Configure AI engines, models, storage, and custom API keys</p>
            </div>
          </div>
          {user && (
            <div className="text-[11px] font-mono text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-md border border-border/50">
              User: <span className="text-foreground font-semibold">{user.email}</span>
            </div>
          )}
        </DialogHeader>

        {/* Layout: Left Sidebar + Right Content Pane */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
          {/* Mobile Top Navigation Dropdown */}
          <div className="md:hidden p-3 border-b border-border bg-muted/30 shrink-0">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
              Select Category
            </label>
            <select
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value as TabId)}
              className="w-full text-xs p-2 border border-border bg-background rounded-md font-semibold text-foreground"
            >
              {sidebarItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          {/* Desktop Left Sidebar Menu */}
          <aside className="hidden md:flex flex-col w-52 shrink-0 border-r border-border bg-muted/15 p-2 space-y-1 overflow-y-auto">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              AI Pipelines
            </div>
            {sidebarItems.slice(0, 6).map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-left transition-colors cursor-pointer select-none ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-foreground/80 hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}

            <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Other Settings
            </div>
            {sidebarItems.slice(6).map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-left transition-colors cursor-pointer select-none ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-foreground/80 hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}

            <div className="mt-auto p-2.5 bg-muted/40 rounded-lg border border-border/40 text-[10px] text-muted-foreground leading-relaxed">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 mb-0.5" />
              Keys are encrypted with AES-256-GCM. Own-key mode deducts zero platform credits.
            </div>
          </aside>

          {/* Right Content Pane */}
          <main className="flex-1 p-5 overflow-y-auto space-y-5">
            {loadingConfig ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-xs">Loading provider options...</span>
              </div>
            ) : activeTab === "storage" ? (
              // ─────────────────────────────────────────────
              // Dedicated Sidebar: Storage & Cloud
              // ─────────────────────────────────────────────
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="border-b border-border pb-2.5">
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                    <Database className="w-4 h-4 text-primary" />
                    Storage & Cloud Infrastructure
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Connect persistent Supabase database, authentication, and Cloudflare R2 media storage.
                  </p>
                </div>

                {/* Supabase Section */}
                <div className="p-3.5 border border-border rounded-lg bg-muted/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-emerald-500" />
                      Supabase (Database & Auth)
                    </span>
                    <span className="text-[10px] text-muted-foreground">PostgreSQL / Auth</span>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <label className="text-[11px] font-semibold text-foreground block mb-1">
                        Supabase Project URL
                      </label>
                      <input
                        value={localSubUrl}
                        onChange={(e) => setLocalSubUrl(e.target.value)}
                        placeholder="https://xyz.supabase.co"
                        className="w-full text-xs p-2 border border-border bg-background rounded-md font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-foreground block mb-1">
                        Supabase Anon / Publishable Key
                      </label>
                      <input
                        type="password"
                        value={localSubKey}
                        onChange={(e) => setLocalSubKey(e.target.value)}
                        placeholder="sb_publishable_..."
                        className="w-full text-xs p-2 border border-border bg-background rounded-md font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Cloudflare R2 Media Storage Section */}
                <div className="p-3.5 border border-border rounded-lg bg-muted/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <Cloud className="w-3.5 h-3.5 text-blue-500" />
                      Cloudflare R2 (Media Storage)
                    </span>
                    <span className="text-[10px] text-muted-foreground">S3-Compatible Object Storage</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-[11px] font-semibold text-foreground block mb-1">Bucket Name</label>
                      <input
                        value={localR2Bucket}
                        onChange={(e) => setLocalR2Bucket(e.target.value)}
                        placeholder="ebookcc-media"
                        className="w-full text-xs p-2 border border-border bg-background rounded-md font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-foreground block mb-1">Endpoint (Optional)</label>
                      <input
                        value={localR2Endpoint}
                        onChange={(e) => setLocalR2Endpoint(e.target.value)}
                        placeholder="https://<account_id>.r2.cloudflarestorage.com"
                        className="w-full text-xs p-2 border border-border bg-background rounded-md font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-foreground block mb-1">R2 Access Key ID</label>
                      <input
                        value={localR2Access}
                        onChange={(e) => setLocalR2Access(e.target.value)}
                        placeholder="Access Key..."
                        className="w-full text-xs p-2 border border-border bg-background rounded-md font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-foreground block mb-1">R2 Secret Access Key</label>
                      <input
                        type="password"
                        value={localR2Secret}
                        onChange={(e) => setLocalR2Secret(e.target.value)}
                        placeholder="Secret Key..."
                        className="w-full text-xs p-2 border border-border bg-background rounded-md font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <Button size="sm" onClick={handleSaveStorage} className="font-semibold text-xs">
                    Save Storage Config
                  </Button>
                </div>
              </div>
            ) : activeTab === "general_llm" ? (
              // ─────────────────────────────────────────────
              // Dedicated Sidebar: General & Local LLM
              // ─────────────────────────────────────────────
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="border-b border-border pb-2.5">
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-primary" />
                    General & Local LLM Engine
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Configure the global fallback LLM engine, Google Gemini, Ollama, and offline models.
                  </p>
                </div>

                <div className="p-3.5 border border-border rounded-lg bg-muted/10 space-y-3">
                  <div>
                    <label className="text-xs font-bold block mb-1.5 text-foreground">Global LLM Provider</label>
                    <select
                      value={localEngineVal}
                      onChange={(e) => setLocalEngineVal(e.target.value as any)}
                      className="w-full text-xs p-2.5 border border-border bg-background rounded-md text-foreground font-medium"
                    >
                      <option value="gemini">Google Gemini (Recommended Cloud)</option>
                      <option value="openai">OpenAI (GPT-4o / Mini)</option>
                      <option value="claude">Anthropic Claude (Sonnet / Haiku)</option>
                      <option value="qwen">Qwen (DashScope)</option>
                      <option value="local">Local LLM (Ollama / LM Studio)</option>
                    </select>
                  </div>

                  {localEngineVal === "gemini" ? (
                    <div>
                      <label className="text-xs font-bold block mb-1 text-foreground">Google Gemini API Key</label>
                      <input
                        type="password"
                        value={localGeminiKeyVal}
                        onChange={(e) => setLocalGeminiKeyVal(e.target.value)}
                        placeholder="AIzaSy..."
                        className="w-full text-xs p-2 border border-border bg-background rounded-md font-mono"
                      />
                      <span className="text-[10px] text-muted-foreground mt-1 block">
                        Get free API keys at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-primary hover:underline">Google AI Studio</a>.
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div>
                        <label className="text-xs font-bold block mb-1 text-foreground">Endpoint Base URL</label>
                        <input
                          value={localOllamaUrl}
                          onChange={(e) => setLocalOllamaUrl(e.target.value)}
                          placeholder="http://localhost:11434/v1"
                          className="w-full text-xs p-2 border border-border bg-background rounded-md font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold block mb-1 text-foreground">Model Name</label>
                        <input
                          value={localOllamaModel}
                          onChange={(e) => setLocalOllamaModel(e.target.value)}
                          placeholder="llama3 or llama3.2-vision"
                          className="w-full text-xs p-2 border border-border bg-background rounded-md font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold block mb-1 text-foreground">API Key / Token (Optional)</label>
                        <input
                          type="password"
                          value={localOllamaKey}
                          onChange={(e) => setLocalOllamaKey(e.target.value)}
                          placeholder="Bearer token if required..."
                          className="w-full text-xs p-2 border border-border bg-background rounded-md font-mono"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-end pt-1">
                  <Button size="sm" onClick={handleSaveGeneralLlm} className="font-semibold text-xs">
                    Save LLM Settings
                  </Button>
                </div>
              </div>
            ) : (
              // ─────────────────────────────────────────────
              // Standard Feature Section: Vision, TTS, Text to Image, Director, Music, SFX
              // ─────────────────────────────────────────────
              <div className="space-y-4 animate-in fade-in duration-200">
                {(() => {
                  const featCat = catalog[activeTab];
                  if (!featCat) return null;
                  const currentSetting = featureSettings[activeTab] || {
                    mode: featCat.defaultMode,
                    provider: featCat.defaultProvider,
                    model: featCat.defaultModel,
                    ttsFallbackOrder:
                      activeTab === "tts"
                        ? ["workers_ai", "elevenlabs", "openai", "google"]
                        : undefined,
                  };

                  const selectedProviderObj =
                    featCat.providers.find((p) => p.id === currentSetting.provider) ||
                    featCat.providers[0];

                  const maskedKey = maskedKeys[currentSetting.provider];

                  return (
                    <div className="space-y-4">
                      {/* Section Title & Description */}
                      <div className="border-b border-border pb-2.5">
                        <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                          {featCat.name}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{featCat.description}</p>
                      </div>

                      {/* Vision Special: Two sub-sections (OCR and Vision Analyst) */}
                      {activeTab === "vision" && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 p-2.5 bg-muted/20 border border-border rounded-lg text-xs">
                          <div className="border-r border-border/60 pr-2">
                            <span className="font-bold text-foreground block">1. Optical Character Recognition (OCR)</span>
                            <span className="text-muted-foreground text-[10px]">
                              Translates on-page dialogue, signs, and sound lettering.
                            </span>
                          </div>
                          <div>
                            <span className="font-bold text-foreground block">2. Vision Analyst</span>
                            <span className="text-muted-foreground text-[10px]">
                              Analyzes camera pacing, character emotions, body language, and audio soundscape triggers.
                            </span>
                          </div>
                        </div>
                      )}

                      {/* SWITCH BUTTON: Left is Own Key, Right is Platform Credits */}
                      <div className="flex items-center justify-between p-3.5 rounded-xl border border-border/20 bg-muted/20">
                        <div className="space-y-0.5 pr-4">
                          <span className="text-xs font-bold text-foreground">Billing Mode</span>
                          <p className="text-[11px] text-muted-foreground">
                            {currentSetting.mode === "platform_credits"
                              ? "Execution is billed from your prepaid wallet balance with zero configuration."
                              : "Execution uses your custom API key below — zero platform credits are deducted."}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 bg-muted/40 p-1 rounded-lg shrink-0 border border-border/20 select-none">
                          <button
                            type="button"
                            onClick={() => handleModeChange(activeTab, "own_key")}
                            className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded transition-colors cursor-pointer ${
                              currentSetting.mode === "own_key"
                                ? "text-foreground font-black bg-background shadow-xs"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            Own Key
                          </button>
                          <Switch
                            checked={currentSetting.mode === "platform_credits"}
                            onCheckedChange={(checked) =>
                              handleModeChange(activeTab, checked ? "platform_credits" : "own_key")
                            }
                            aria-label={`Toggle platform credits for ${featCat.name}`}
                            className="cursor-pointer"
                          />
                          <button
                            type="button"
                            onClick={() => handleModeChange(activeTab, "platform_credits")}
                            className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded transition-colors cursor-pointer ${
                              currentSetting.mode === "platform_credits"
                                ? "text-primary font-black bg-background shadow-xs"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            Platform Credits
                          </button>
                        </div>
                      </div>

                      {/* Provider & Model Selectors (Model hidden for Paddle OCR) */}
                      {(() => {
                        const isPaddleOcr = currentSetting.provider === "paddle_ocr";
                        return (
                          <div className={`grid gap-3 ${isPaddleOcr ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"}`}>
                            <div>
                              <label className="text-xs font-bold block mb-1 text-foreground">Provider</label>
                              <select
                                value={currentSetting.provider}
                                onChange={(e) => handleProviderChange(activeTab, e.target.value)}
                                className="w-full text-xs p-2 border border-border/30 bg-background rounded-md text-foreground font-medium outline-none focus:border-primary shadow-xs"
                              >
                                {featCat.providers.map((prov) => (
                                  <option key={prov.id} value={prov.id}>
                                    {prov.name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {!isPaddleOcr && (
                              <div>
                                <label className="text-xs font-bold block mb-1 text-foreground">Model</label>
                                <select
                                  value={currentSetting.model}
                                  onChange={(e) => handleModelChange(activeTab, e.target.value)}
                                  className="w-full text-xs p-2 border border-border/30 bg-background rounded-md text-foreground font-medium outline-none focus:border-primary shadow-xs"
                                >
                                  {selectedProviderObj?.models.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.name} {m.isDefault ? "(Recommended)" : ""}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Text to Speech: Interactive Fallback Order Reordering */}
                      {activeTab === "tts" && (
                        <div className="p-3 border border-border rounded-lg bg-muted/15 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-foreground">TTS Provider Fallback Order</span>
                            <span className="text-[10px] text-muted-foreground">Top item tried first</span>
                          </div>
                          <div className="space-y-1">
                            {(
                              currentSetting.ttsFallbackOrder || [
                                "workers_ai",
                                "elevenlabs",
                                "openai",
                                "google",
                              ]
                            ).map((provId, idx, arr) => {
                              const provName =
                                featCat.providers.find((p) => p.id === provId)?.name || provId;
                              return (
                                <div
                                  key={provId}
                                  className="flex items-center justify-between px-2.5 py-1.5 bg-background border border-border rounded-md text-xs font-medium text-foreground"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="w-4 h-4 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold">
                                      {idx + 1}
                                    </span>
                                    <span>{provName}</span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      disabled={idx === 0}
                                      onClick={() => handleMoveTtsProvider(idx, "up")}
                                      className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                                      title="Move Up"
                                    >
                                      <ArrowUp className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={idx === arr.length - 1}
                                      onClick={() => handleMoveTtsProvider(idx, "down")}
                                      className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                                      title="Move Down"
                                    >
                                      <ArrowDown className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* API Key Field (Visible ONLY in "my own key" mode) */}
                      {currentSetting.mode === "own_key" && (
                        <div className="p-3.5 border border-border rounded-lg bg-muted/20 space-y-2.5 animate-in fade-in duration-200">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-bold flex items-center gap-1.5 text-foreground">
                              <Key className="w-3.5 h-3.5 text-primary" />
                              Custom API Key for {selectedProviderObj.name}
                            </label>
                            {maskedKey && (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20">
                                Encrypted & Stored
                              </span>
                            )}
                          </div>

                          {maskedKey ? (
                            <div className="flex items-center justify-between p-2.5 bg-background border border-border rounded-md">
                              <div className="font-mono text-xs text-foreground font-semibold tracking-wider">
                                {maskedKey}
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleTestApiKey(currentSetting.provider)}
                                  disabled={testingKeyProvider === currentSetting.provider}
                                  className="h-7 text-xs gap-1"
                                >
                                  {testingKeyProvider === currentSetting.provider ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <RefreshCw className="w-3 h-3" />
                                  )}
                                  Test Key
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteApiKey(currentSetting.provider)}
                                  className="h-7 text-xs text-destructive hover:bg-destructive/10"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <input
                                type="password"
                                value={apiKeyInputs[currentSetting.provider] || ""}
                                onChange={(e) =>
                                  setApiKeyInputs((prev) => ({
                                    ...prev,
                                    [currentSetting.provider]: e.target.value,
                                  }))
                                }
                                placeholder={`Enter ${selectedProviderObj.name} API Key...`}
                                className="w-full text-xs p-2 border border-border bg-background rounded-md font-mono text-foreground outline-none focus:border-primary shadow-xs"
                              />

                              <div className="flex items-center justify-end gap-2 pt-0.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleTestApiKey(currentSetting.provider)}
                                  disabled={testingKeyProvider === currentSetting.provider}
                                  className="h-7 text-xs gap-1.5"
                                >
                                  {testingKeyProvider === currentSetting.provider ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <RefreshCw className="w-3 h-3" />
                                  )}
                                  Test Key
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => handleSaveApiKey(currentSetting.provider)}
                                  disabled={savingKeyProvider === currentSetting.provider}
                                  className="h-7 text-xs font-semibold gap-1.5"
                                >
                                  {savingKeyProvider === currentSetting.provider ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="w-3 h-3" />
                                  )}
                                  Save Key
                                </Button>
                              </div>
                            </div>
                          )}

                          {/* Test Key Result Feedback */}
                          {testResult && testResult.provider === currentSetting.provider && (
                            <div
                              className={`p-2 rounded-md text-xs flex items-center gap-2 ${
                                testResult.success
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                                  : "bg-destructive/10 text-destructive border border-destructive/30"
                              }`}
                            >
                              {testResult.success ? (
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              ) : (
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              )}
                              <span>{testResult.message}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Price Hint Banner */}
                      <div className="p-2.5 bg-muted/30 border border-border rounded-lg flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Info className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span>Estimated Cost:</span>
                        </div>
                        <span className="font-semibold text-foreground">
                          {priceHints[activeTab] ||
                            (currentSetting.mode === "own_key"
                              ? "Billed directly by your provider"
                              : "Loading estimate...")}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </main>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-2.5 border-t border-border bg-muted/20 flex items-center justify-between shrink-0">
          <div className="text-[11px] text-muted-foreground">
            Settings are saved per feature and synced automatically.
          </div>
          <Button size="sm" onClick={() => setShowAiSettingsDialog(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
