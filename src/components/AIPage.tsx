/**
 * AIPage.tsx
 *
 * Dedicated sub-page at /AI (and /ai):
 * - Edge-to-edge full webpage layout (no 4:3 aspect ratio, no heavy outer card boxes or margins)
 * - Foldable left sidebar navigation (expand/collapse toggle)
 * - Pipelines:
 *   1. Vision (contains both "OCR" and "Vision Analyst" sections on one page)
 *      - OCR: Paddle OCR (in-browser, no need API), Google Gemini, OpenAI, Anthropic Claude, Alibaba Qwen, Cloudflare (Workers AI, no need API), Local LLM.
 *      - Vision Analyst: Google Gemini, OpenAI, Anthropic Claude, Alibaba Qwen, Local LLM.
 *   2. Text to Speech: Elevenlabs, Cartesia, Google Gemini, OpenAI, Local LLM (with priority fallback reorder).
 *   3. Text to Images: Stability AI, Black Forest Labs, Google Gemini, OpenAI, Local LLM.
 *   4. Director: Google Gemini, OpenAI, Anthropic Claude, Alibaba Qwen, Local LLM.
 *   5. Music: ElevenLabs, Stability AI, Meta, Freesound API, Local LLM.
 *   6. Sound Effects: ElevenLabs, Stability AI, Meta, Freesound API, Local LLM.
 *
 * Each pipeline features:
 * - Switch button: "Use platform credits" vs "Use my own API key"
 * - Provider dropdown menu
 * - Model dropdown menu
 * - Input box API Key with password masking, AES-256-GCM encryption, Save, Test Key, and Masked Key view
 */

import React, { useState, useEffect } from "react";
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
  ArrowLeft,
  CreditCard,
  Check,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useAppSettings } from "@/context/AppSettingsContext";
import { getApiUrl } from "@/lib/api";
import { toast } from "sonner";

export type PipelineId =
  | "vision"
  | "tts"
  | "text_to_image"
  | "director"
  | "music"
  | "sfx";

interface ProviderModel {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
}

interface ProviderItem {
  id: string;
  name: string;
  noApiNeeded?: boolean;
  models: ProviderModel[];
}

interface AIPageProps {
  onBack: () => void;
  onNavigateBilling?: () => void;
}

// Comprehensive static fallback catalog to guarantee zero-delay safe rendering
const FALLBACK_CATALOG: Record<string, any> = {
  vision: {
    id: "vision",
    name: "Vision",
    description: "Multi-modal vision analysis and OCR",
    ocrProviders: [
      {
        id: "paddle_ocr",
        name: "Paddle OCR (in-browser, no need API)",
        noApiNeeded: true,
        models: [
          { id: "paddle-v5-browser", name: "PaddleOCR v5 In-Browser (Multi-Language)", isDefault: true },
          { id: "paddle-v4-browser", name: "PaddleOCR v4 High-Speed In-Browser" },
        ],
      },
      {
        id: "google",
        name: "Google Gemini",
        models: [
          { id: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen (Fast OCR)", isDefault: true },
          { id: "gemini-4-argon", name: "Gemini 4 Argon (Dense Manga Layouts)" },
          { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite (Ultra-Fast OCR)" },
        ],
      },
      {
        id: "openai",
        name: "OpenAI",
        models: [
          { id: "gpt-6.1-terra", name: "GPT-6.1 Terra (Vision & OCR)", isDefault: true },
          { id: "gpt-6.1-sol", name: "GPT-6.1 Sol (Multimodal)" },
          { id: "gpt-6-luna", name: "GPT-6 Luna (Fast OCR)" },
        ],
      },
      {
        id: "anthropic",
        name: "Anthropic Claude",
        models: [
          { id: "claude-sonnet-5-5", name: "Claude 5.5 Sonnet", isDefault: true },
          { id: "claude-opus-5-5", name: "Claude 5.5 Opus" },
          { id: "claude-haiku-5-5", name: "Claude 5.5 Haiku" },
        ],
      },
      {
        id: "qwen",
        name: "Alibaba Qwen",
        models: [
          { id: "qwen3.8-max", name: "Qwen 3.8 Max (High Precision Vision)", isDefault: true },
          { id: "qwen3-vl-plus", name: "Qwen3-VL Plus" },
          { id: "qwen3-vl-235b-a22b", name: "Qwen3-VL 235B (Ultra Dense Text)" },
        ],
      },
      {
        id: "cloudflare",
        name: "Cloudflare (Workers AI, no need API)",
        noApiNeeded: true,
        models: [
          { id: "@cf/google/gemma-4-26b-a4b-it", name: "Google Gemma 4 26B Vision (Primary)", isDefault: true },
          { id: "@cf/meta/llama-3.2-11b-vision-instruct", name: "Meta Llama 3.2 11B Vision Instruct (OCR Fallback)" },
          { id: "@cf/deepseek-ai/deepseek-v4.1-flash-1017", name: "DeepSeek v4.1 Flash 1017 (Vision Fallback)" },
        ],
      },
      {
        id: "local_llm",
        name: "Local LLM",
        models: [
          { id: "qwen3-vl:8b", name: "Qwen3-VL 8B (Local / Ollama)", isDefault: true },
          { id: "llama4-scout:17b", name: "Llama 4 Scout 17B Vision (Local)" },
          { id: "gemma4:26b", name: "Gemma 4 26B Vision (Local)" },
        ],
      },
    ],
    analystProviders: [
      {
        id: "google",
        name: "Google Gemini",
        models: [
          { id: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen (Scene Analyst)", isDefault: true },
          { id: "gemini-4-argon", name: "Gemini 4 Argon (Deep Stage Direction)" },
          { id: "gemini-4-carbon", name: "Gemini 4 Carbon (Max Multimodal Reasoning)" },
        ],
      },
      {
        id: "openai",
        name: "OpenAI",
        models: [
          { id: "gpt-6.1-terra", name: "GPT-6.1 Terra (Vision Analyst)", isDefault: true },
          { id: "gpt-6-astra", name: "GPT-6 Astra (Deep Reasoning)" },
          { id: "gpt-6.1-sol", name: "GPT-6.1 Sol (Fast Multimodal)" },
        ],
      },
      {
        id: "anthropic",
        name: "Anthropic Claude",
        models: [
          { id: "claude-sonnet-5-5", name: "Claude 5.5 Sonnet (Scene & Emotion)", isDefault: true },
          { id: "claude-opus-5-5", name: "Claude 5.5 Opus (Peak Reasoning)" },
          { id: "claude-fable-5-2", name: "Claude 5.2 Fable (Narrative Analysis)" },
        ],
      },
      {
        id: "qwen",
        name: "Alibaba Qwen",
        models: [
          { id: "qwen3.8-max", name: "Qwen 3.8 Max (Visual Reasoning)", isDefault: true },
          { id: "qwen3.7-max", name: "Qwen 3.7 Max" },
          { id: "qwen3-vl-plus", name: "Qwen3-VL Plus" },
        ],
      },
      {
        id: "local_llm",
        name: "Local LLM",
        models: [
          { id: "llama4-scout:17b", name: "Llama 4 Scout 17B Vision (Local)", isDefault: true },
          { id: "qwen3-vl:32b", name: "Qwen3-VL 32B (Local)" },
          { id: "gemma4:26b", name: "Gemma 4 26B Vision (Local)" },
        ],
      },
    ],
    defaultOcrProvider: "paddle_ocr",
    defaultOcrModel: "paddle-v5-browser",
    defaultAnalystProvider: "google",
    defaultAnalystModel: "gemini-4-hydrogen",
  },
  tts: {
    id: "tts",
    name: "Text to Speech",
    providers: [
      {
        id: "elevenlabs",
        name: "Elevenlabs",
        models: [
          { id: "eleven_v4", name: "Eleven v4 (Flagship Expressive)", isDefault: true },
          { id: "eleven_v4_turbo", name: "Eleven v4 Turbo (Ultra-Low Latency)" },
          { id: "eleven_v3", name: "Eleven v3 (Dialogue & Acting)" },
        ],
      },
      {
        id: "cartesia",
        name: "Cartesia",
        models: [
          { id: "sonic-3.6", name: "Sonic 3.6 (Real-Time Studio)", isDefault: true },
          { id: "sonic-preview", name: "Sonic Preview (Next-Gen Expressive)" },
        ],
      },
      {
        id: "google",
        name: "Google Gemini",
        models: [
          { id: "gemini-3.8-flash-tts", name: "Gemini 3.8 Flash TTS (Expressive Studio)", isDefault: true },
          { id: "gemini-3.8-flash-lite-tts", name: "Gemini 3.8 Flash Lite TTS (Fast Streaming)" },
          { id: "gemini-3.8-live", name: "Gemini 3.8 Live Native Audio" },
        ],
      },
      {
        id: "openai",
        name: "OpenAI",
        models: [
          { id: "gpt-audio", name: "GPT Audio (Natural Voice Acting)", isDefault: true },
          { id: "gpt-realtime", name: "GPT Realtime Audio" },
        ],
      },
      {
        id: "local_llm",
        name: "Local LLM",
        models: [
          { id: "kokoro-v1.0", name: "Kokoro v1.0 82M (Local Studio)", isDefault: true },
          { id: "piper-en-gb-v2", name: "Piper v2 English RP (Local)" },
        ],
      },
    ],
    defaultProvider: "elevenlabs",
    defaultModel: "eleven_v4",
    defaultMode: "platform_credits",
  },
  text_to_image: {
    id: "text_to_image",
    name: "Text to Images",
    providers: [
      {
        id: "stability",
        name: "Stability AI",
        models: [
          { id: "sd3.5-large", name: "Stable Diffusion 3.5 Large", isDefault: true },
          { id: "sd3.5-large-turbo", name: "Stable Diffusion 3.5 Large Turbo" },
          { id: "sd3.5-medium", name: "Stable Diffusion 3.5 Medium" },
          { id: "stable-image-ultra", name: "Stable Image Ultra" },
        ],
      },
      {
        id: "black_forest_labs",
        name: "Black Forest Labs",
        models: [
          { id: "flux-3-image", name: "FLUX.3 Image (Flagship)", isDefault: true },
          { id: "flux-2-pro", name: "FLUX.2 Pro" },
          { id: "flux-3-image-klein", name: "FLUX.3 Image Klein (Fast)" },
          { id: "flux-1-kontext-pro", name: "FLUX.1 Kontext Pro (Editing & Consistency)" },
        ],
      },
      {
        id: "google",
        name: "Google Gemini",
        models: [
          { id: "gemini-nano-banana-2.1", name: "Gemini Nano Banana 2.1 (Manga & Studio Art)", isDefault: true },
          { id: "gemini-3.1-flash-lite-image", name: "Gemini 3.1 Flash Lite Image (Fast)" },
          { id: "gemini-3-pro-image", name: "Gemini 3 Pro Image (High Resolution)" },
        ],
      },
      {
        id: "openai",
        name: "OpenAI",
        models: [
          { id: "gpt-image-2.6-sunburst", name: "GPT Image 2.6 Sunburst (HD Studio)", isDefault: true },
          { id: "gpt-image-2.6-flare", name: "GPT Image 2.6 Flare (Fast Render)" },
        ],
      },
      {
        id: "local_llm",
        name: "Local LLM",
        models: [
          { id: "flux-3-klein-local", name: "FLUX.3 Klein (Local GGUF / ComfyUI)", isDefault: true },
          { id: "sd3.5-large-turbo-local", name: "SD 3.5 Large Turbo (Local)" },
          { id: "flux-2-klein-4b", name: "FLUX.2 Klein 4B (Local)" },
        ],
      },
    ],
    defaultProvider: "stability",
    defaultModel: "sd3.5-large",
    defaultMode: "platform_credits",
  },
  director: {
    id: "director",
    name: "Director",
    providers: [
      {
        id: "google",
        name: "Google Gemini",
        models: [
          { id: "gemini-4-argon", name: "Gemini 4 Argon (Deep Drama & Scripting)", isDefault: true },
          { id: "gemini-4-carbon", name: "Gemini 4 Carbon (Peak Narrative Reasoning)" },
          { id: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen (Fast Adaptive Direction)" },
        ],
      },
      {
        id: "openai",
        name: "OpenAI",
        models: [
          { id: "gpt-6.1-sol", name: "GPT-6.1 Sol (Story Direction)", isDefault: true },
          { id: "gpt-6-astra", name: "GPT-6 Astra (Deep Pacing & Reasoning)" },
          { id: "gpt-6.1-terra", name: "GPT-6.1 Terra (Balanced Director)" },
        ],
      },
      {
        id: "anthropic",
        name: "Anthropic Claude",
        models: [
          { id: "claude-sonnet-5-5", name: "Claude 5.5 Sonnet (Narrative & Pacing)", isDefault: true },
          { id: "claude-opus-5-5", name: "Claude 5.5 Opus (Complex Multi-Cast Scripting)" },
          { id: "claude-fable-5-2", name: "Claude 5.2 Fable (Literary Storywriter)" },
        ],
      },
      {
        id: "qwen",
        name: "Alibaba Qwen",
        models: [
          { id: "qwen3.8-max", name: "Qwen 3.8 Max (Master Storyteller)", isDefault: true },
          { id: "qwen3.7-max", name: "Qwen 3.7 Max" },
          { id: "qwen3-235b-a22b", name: "Qwen 3 235B Instruct" },
        ],
      },
      {
        id: "local_llm",
        name: "Local LLM",
        models: [
          { id: "llama-4-maverick", name: "Llama 4 Maverick (Local Ollama)", isDefault: true },
          { id: "deepseek-v4-local", name: "DeepSeek V4 (Local)" },
          { id: "qwen3:32b", name: "Qwen 3 32B (Local Ollama)" },
        ],
      },
    ],
    defaultProvider: "google",
    defaultModel: "gemini-4-argon",
    defaultMode: "platform_credits",
  },
  music: {
    id: "music",
    name: "Music",
    providers: [
      {
        id: "elevenlabs",
        name: "ElevenLabs",
        models: [
          { id: "eleven_music_v2", name: "Eleven Music v2 (Full Broadcast Score)", isDefault: true },
          { id: "eleven_music", name: "Eleven Music v1" },
        ],
      },
      {
        id: "stability",
        name: "Stability AI",
        models: [
          { id: "stable-audio-3.0", name: "Stable Audio 3.0 (High Fidelity)", isDefault: true },
          { id: "stable-audio-3.0-medium", name: "Stable Audio 3.0 Medium" },
        ],
      },
      {
        id: "meta",
        name: "Meta",
        models: [
          { id: "audiobox-music", name: "Meta Audiobox Music (Controllable)", isDefault: true },
          { id: "musicgen-stereo-large", name: "MusicGen Stereo Large" },
          { id: "sam-audio", name: "Meta SAM Audio Studio" },
        ],
      },
      {
        id: "freesound",
        name: "Freesound API",
        models: [
          { id: "freesound-apiv2-curated-bgm", name: "Freesound Curated BGM Archives", isDefault: true },
          { id: "freesound-apiv2-ambient-loops", name: "Freesound Ambient Loops" },
        ],
      },
      {
        id: "local_llm",
        name: "Local LLM",
        models: [
          { id: "stable-audio-3-small-local", name: "Stable Audio 3 Small (Local GPU)", isDefault: true },
          { id: "audiocraft-musicgen-local", name: "AudioCraft MusicGen (Local PyTorch)" },
        ],
      },
    ],
    defaultProvider: "elevenlabs",
    defaultModel: "eleven_music_v2",
    defaultMode: "platform_credits",
  },
  sfx: {
    id: "sfx",
    name: "Sound Effects",
    providers: [
      {
        id: "elevenlabs",
        name: "ElevenLabs",
        models: [
          { id: "eleven_sfx_v3", name: "Eleven SFX v3 (Studio Foley & Impacts)", isDefault: true },
          { id: "eleven_sfx_v2", name: "Eleven SFX v2" },
        ],
      },
      {
        id: "stability",
        name: "Stability AI",
        models: [
          { id: "stable-audio-3.0-sfx", name: "Stable Audio 3.0 SFX Engine", isDefault: true },
          { id: "stable-audio-3.0-small-sfx", name: "Stable Audio 3.0 Small SFX" },
        ],
      },
      {
        id: "meta",
        name: "Meta",
        models: [
          { id: "sam-audio-sfx", name: "Meta SAM Audio Foley", isDefault: true },
          { id: "audiobox-sfx", name: "Meta Audiobox SFX" },
          { id: "audiogen-medium", name: "AudioGen Medium" },
        ],
      },
      {
        id: "freesound",
        name: "Freesound API",
        models: [
          { id: "freesound-apiv2-sfx-search", name: "Freesound Community SFX (600k+ Samples)", isDefault: true },
          { id: "freesound-apiv2-hq-wav", name: "Freesound HQ Uncompressed" },
        ],
      },
      {
        id: "local_llm",
        name: "Local LLM",
        models: [
          { id: "stable-audio-3-small-sfx-local", name: "Stable Audio 3 Small SFX (Local)", isDefault: true },
          { id: "local-foley-dsp", name: "Local DSP Foley Synthesis" },
        ],
      },
    ],
    defaultProvider: "elevenlabs",
    defaultModel: "eleven_sfx_v3",
    defaultMode: "platform_credits",
  },
};

type FeatureMode = "platform_credits" | "own_key";

interface FeatureSettingEntry {
  mode: FeatureMode;
  provider: string;
  model: string;
  ttsFallbackOrder?: string[];
}

const ALL_SECTION_KEYS = [
  "vision_ocr",
  "vision_analyst",
  "tts",
  "text_to_image",
  "director",
  "music",
  "sfx",
] as const;

const DEFAULT_FEATURE_SETTINGS: Record<string, FeatureSettingEntry> = {
  vision_ocr: {
    mode: "platform_credits",
    provider: "paddle_ocr",
    model: "paddle-v5-browser",
  },
  vision_analyst: {
    mode: "platform_credits",
    provider: "google",
    model: "gemini-4-hydrogen",
  },
  tts: {
    mode: "platform_credits",
    provider: "elevenlabs",
    model: "eleven_v4",
    ttsFallbackOrder: ["elevenlabs", "cartesia", "google", "openai", "local_llm"],
  },
  text_to_image: {
    mode: "platform_credits",
    provider: "stability",
    model: "sd3.5-large",
  },
  director: {
    mode: "platform_credits",
    provider: "google",
    model: "gemini-4-argon",
  },
  music: {
    mode: "platform_credits",
    provider: "elevenlabs",
    model: "eleven_music_v2",
  },
  sfx: {
    mode: "platform_credits",
    provider: "elevenlabs",
    model: "eleven_sfx_v3",
  },
};

function getProvidersListForSection(cat: Record<string, any>, sectionKey: string): ProviderItem[] {
  if (sectionKey === "vision_ocr") return cat.vision?.ocrProviders || FALLBACK_CATALOG.vision.ocrProviders;
  if (sectionKey === "vision_analyst") return cat.vision?.analystProviders || FALLBACK_CATALOG.vision.analystProviders;
  return cat[sectionKey]?.providers || FALLBACK_CATALOG[sectionKey]?.providers || [];
}

function normalizeFeatureSettings(
  raw: Record<string, Partial<FeatureSettingEntry>> | null | undefined,
  cat: Record<string, any>
): Record<string, FeatureSettingEntry> {
  const result: Record<string, FeatureSettingEntry> = {};
  for (const key of ALL_SECTION_KEYS) {
    const def = DEFAULT_FEATURE_SETTINGS[key];
    const entry = raw?.[key] || {};
    const providers = getProvidersListForSection(cat, key);
    const matchedProvider = providers.find((p) => p.id === entry.provider) || providers.find((p) => p.id === def.provider) || providers[0];
    const models = matchedProvider?.models || [];
    const validModel = models.some((m) => m.id === entry.model)
      ? (entry.model as string)
      : (models.find((m) => m.isDefault)?.id || models[0]?.id || def.model);

    result[key] = {
      mode: entry.mode === "own_key" ? "own_key" : entry.mode === "platform_credits" ? "platform_credits" : def.mode,
      provider: matchedProvider?.id || def.provider,
      model: validModel,
      ...(key === "tts"
        ? { ttsFallbackOrder: entry.ttsFallbackOrder || def.ttsFallbackOrder }
        : {}),
    };
  }
  return result;
}

export function AIPage({ onBack, onNavigateBilling }: AIPageProps) {
  const { user, setShowAuthDialog, walletBalance } = useAppSettings();

  const [activeTab, setActiveTab] = useState<PipelineId>("vision");
  const [catalog, setCatalog] = useState<Record<string, any>>(FALLBACK_CATALOG);
  const [isSidebarFolded, setIsSidebarFolded] = useState(false);

  const [mainBillingMode, setMainBillingMode] = useState<FeatureMode>(() => {
    try {
      const saved = localStorage.getItem("ai_main_billing_mode");
      return saved === "own_key" ? "own_key" : "platform_credits";
    } catch {
      return "platform_credits";
    }
  });

  // Per-feature user settings:
  // Keyed by: 'vision_ocr', 'vision_analyst', 'tts', 'text_to_image', 'director', 'music', 'sfx'
  const [featureSettings, setFeatureSettings] = useState<Record<string, FeatureSettingEntry>>(() => {
    try {
      const savedRaw = localStorage.getItem("ai_feature_settings");
      if (savedRaw) {
        return normalizeFeatureSettings(JSON.parse(savedRaw), FALLBACK_CATALOG);
      }
    } catch {}
    return DEFAULT_FEATURE_SETTINGS;
  });

  // Masked keys returned from server vault (keyed by provider ID)
  const [maskedKeys, setMaskedKeys] = useState<Record<string, string>>({});
  // In-progress inputs
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  // Testing status & results
  const [testingKeyProvider, setTestingKeyProvider] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ provider: string; success: boolean; message: string } | null>(null);
  const [savingKeyProvider, setSavingKeyProvider] = useState<string | null>(null);

  // Fetch catalog & user settings from server on mount
  useEffect(() => {
    let isMounted = true;
    async function loadCatalogAndSettings() {
      let activeCatalog = FALLBACK_CATALOG;
      try {
        const res = await fetch(`${getApiUrl()}/api/ai/config`, {
          headers: user ? { "x-user-id": user.uid } : {},
        });
        if (res.ok) {
          const data = await res.json();
          const serverCat = data.catalog || data.features;
          if (isMounted && serverCat && Object.keys(serverCat).length > 0) {
            activeCatalog = serverCat;
            setCatalog(serverCat);
          }
          if (isMounted && data.maskedKeys) {
            setMaskedKeys(data.maskedKeys);
          }
        }
      } catch (err) {
        console.warn("[AIPage] Using fallback catalog, server catalog fetch notice:", err);
      }

      if (user) {
        try {
          const userRes = await fetch(`${getApiUrl()}/api/ai/user-settings`, {
            headers: { "x-user-id": user.uid },
          });
          if (userRes.ok && isMounted) {
            const uData = await userRes.json();
            if (uData.maskedKeys) {
              setMaskedKeys(uData.maskedKeys);
            }
            if (uData.featureSettings) {
              const normalized = normalizeFeatureSettings(uData.featureSettings, activeCatalog);
              setFeatureSettings(normalized);
              try {
                localStorage.setItem("ai_feature_settings", JSON.stringify(normalized));
              } catch {}
            }
            if (uData.mainMode === "own_key" || uData.mainMode === "platform_credits") {
              setMainBillingMode(uData.mainMode);
              try {
                localStorage.setItem("ai_main_billing_mode", uData.mainMode);
              } catch {}
            }
          }
        } catch (err) {
          console.warn("[AIPage] Error loading user settings:", err);
        }
      }
    }
    loadCatalogAndSettings();
    return () => {
      isMounted = false;
    };
  }, [user]);

  // Master switch handler: applies chosen mode to all sections
  const handleMainModeChange = (newMode: FeatureMode) => {
    setMainBillingMode(newMode);
    try {
      localStorage.setItem("ai_main_billing_mode", newMode);
    } catch {}

    setFeatureSettings((prev) => {
      const next: Record<string, FeatureSettingEntry> = { ...prev };
      for (const key of ALL_SECTION_KEYS) {
        next[key] = {
          ...(next[key] || DEFAULT_FEATURE_SETTINGS[key]),
          mode: newMode,
        };
      }
      try {
        localStorage.setItem("ai_feature_settings", JSON.stringify(next));
      } catch {}
      return next;
    });

    if (user) {
      fetch(`${getApiUrl()}/api/ai/save-main-mode`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": user.uid,
        },
        body: JSON.stringify({ mode: newMode }),
      }).catch(() => {});
    }
  };

  // Save AES-256-GCM encrypted API key to server
  const handleSaveApiKey = async (providerId: string) => {
    const rawKey = apiKeyInputs[providerId]?.trim();
    if (!rawKey) {
      toast.error("Please enter an API key.");
      return;
    }
    if (!user) {
      toast.error("Please sign in to securely save and encrypt your API keys.");
      setShowAuthDialog(true);
      return;
    }

    setSavingKeyProvider(providerId);
    try {
      const res = await fetch(`${getApiUrl()}/api/ai/save-key`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": user.uid,
        },
        body: JSON.stringify({
          provider: providerId,
          apiKey: rawKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save API key.");
      }

      setMaskedKeys((prev) => ({
        ...prev,
        [providerId]: data.masked || data.maskedKey,
      }));
      setApiKeyInputs((prev) => ({
        ...prev,
        [providerId]: "",
      }));
      toast.success(`${providerId.toUpperCase()} API key saved and encrypted (AES-256-GCM).`);
    } catch (err: any) {
      toast.error(err.message || "Failed to save API key.");
    } finally {
      setSavingKeyProvider(null);
    }
  };

  // Test API key with minimal real call
  const handleTestApiKey = async (providerId: string) => {
    const rawKey = apiKeyInputs[providerId]?.trim();
    if (!user) {
      toast.error("Please sign in to test your API key.");
      setShowAuthDialog(true);
      return;
    }
    setTestingKeyProvider(providerId);
    setTestResult(null);

    try {
      const res = await fetch(`${getApiUrl()}/api/ai/test-key`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": user.uid,
        },
        body: JSON.stringify({
          provider: providerId,
          apiKey: rawKey || undefined, // Server uses saved encrypted key if omitted
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult({
          provider: providerId,
          success: true,
          message: data.message || "Key test succeeded! Provider responded 200 OK.",
        });
        toast.success(`Key test succeeded for ${providerId.toUpperCase()}`);
      } else {
        setTestResult({
          provider: providerId,
          success: false,
          message: data.error || data.message || "Key verification failed. Check credentials.",
        });
        toast.error(`Key test failed for ${providerId.toUpperCase()}`);
      }
    } catch (err: any) {
      setTestResult({
        provider: providerId,
        success: false,
        message: err.message || "Network error while verifying API key.",
      });
      toast.error("Network error during key verification.");
    } finally {
      setTestingKeyProvider(null);
    }
  };

  // Delete stored key
  const handleDeleteApiKey = async (providerId: string) => {
    if (!user) return;
    try {
      const res = await fetch(`${getApiUrl()}/api/ai/delete-key`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": user.uid,
        },
        body: JSON.stringify({ provider: providerId }),
      });
      if (res.ok) {
        setMaskedKeys((prev) => {
          const next = { ...prev };
          delete next[providerId];
          return next;
        });
        toast.success(`API key for ${providerId} removed.`);
      }
    } catch (err) {
      toast.error("Failed to delete key.");
    }
  };

  const updateFeatureSetting = (
    featureKey: string,
    updates: Partial<FeatureSettingEntry>
  ) => {
    setFeatureSettings((prev) => {
      const updatedEntry: FeatureSettingEntry = {
        ...(prev[featureKey] || DEFAULT_FEATURE_SETTINGS[featureKey]),
        ...updates,
      };
      const next = {
        ...prev,
        [featureKey]: updatedEntry,
      };
      try {
        localStorage.setItem("ai_feature_settings", JSON.stringify(next));
      } catch {}

      // If all sections share the same mode after a sub-switch change, keep mainBillingMode synced
      const allOwnKey = ALL_SECTION_KEYS.every((k) => next[k]?.mode === "own_key");
      const allPlatformCredits = ALL_SECTION_KEYS.every((k) => next[k]?.mode === "platform_credits");
      if (allOwnKey) {
        setMainBillingMode("own_key");
        try {
          localStorage.setItem("ai_main_billing_mode", "own_key");
        } catch {}
      } else if (allPlatformCredits) {
        setMainBillingMode("platform_credits");
        try {
          localStorage.setItem("ai_main_billing_mode", "platform_credits");
        } catch {}
      }

      if (user) {
        fetch(`${getApiUrl()}/api/ai/save-feature-setting`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": user.uid,
          },
          body: JSON.stringify({ feature: featureKey, setting: updatedEntry }),
        }).catch(() => {});
      }

      return next;
    });
  };

  const moveTtsProvider = (index: number, direction: "up" | "down") => {
    const current =
      featureSettings["tts"]?.ttsFallbackOrder ||
      (catalog.tts?.providers || []).map((p: any) => p.id);
    const newOrder = [...current];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newOrder.length) return;

    const temp = newOrder[index];
    newOrder[index] = newOrder[targetIndex];
    newOrder[targetIndex] = temp;

    updateFeatureSetting("tts", { ttsFallbackOrder: newOrder });
  };

  const sidebarItems: Array<{ id: PipelineId; label: string; icon: any }> = [
    { id: "vision", label: "Vision", icon: Eye },
    { id: "tts", label: "Text to Speech", icon: Volume2 },
    { id: "text_to_image", label: "Text to Images", icon: ImageIcon },
    { id: "director", label: "Director", icon: Film },
    { id: "music", label: "Music", icon: Music },
    { id: "sfx", label: "Sound Effects", icon: Zap },
  ];

  // Robust, crash-proof pipeline control block
  const renderPipelineControlBlock = ({
    title,
    description,
    stateKey,
    providers,
    isSubSection = false,
  }: {
    title: string;
    description: string;
    stateKey: string;
    providers: ProviderItem[];
    isSubSection?: boolean;
  }) => {
    // 1. Sanitize providers to ensure it is never empty
    const safeProviders: ProviderItem[] =
      providers && providers.length > 0
        ? providers
        : [
            {
              id: "google",
              name: "Google Gemini",
              models: [{ id: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen", isDefault: true }],
            },
          ];

    // 2. Resolve safe setting
    const setting = featureSettings[stateKey] || {
      mode: "platform_credits",
      provider: safeProviders[0]?.id || "google",
      model: safeProviders[0]?.models?.[0]?.id || "default",
    };

    const isPlatformCredits = setting.mode === "platform_credits";
    const selectedProviderObj =
      safeProviders.find((p) => p.id === setting.provider) || safeProviders[0];

    const availableModels =
      selectedProviderObj?.models && selectedProviderObj.models.length > 0
        ? selectedProviderObj.models
        : [{ id: "default", name: "Default Model" }];

    const provId = selectedProviderObj?.id || "provider";
    const provName = selectedProviderObj?.name || "Provider";
    const hasSavedMaskedKey = Boolean(maskedKeys[provId]);
    const isNoApiNeeded = Boolean(selectedProviderObj?.noApiNeeded);
    const isPaddleOcr = provId === "paddle_ocr" || selectedProviderObj?.id === "paddle_ocr";

    return (
      <div
        className={`p-4 sm:p-5 rounded-xl space-y-4 shadow-2xs ${
          isSubSection ? "bg-muted/20" : "bg-card/50"
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
          <div>
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              {title}
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
          </div>

          {/* Mode Selector Switch: Left is Own Key, Right is Platform Credits */}
          <div className="flex items-center gap-1.5 bg-muted/40 p-1 rounded-lg shrink-0 self-start sm:self-auto select-none border border-border/20">
            <button
              type="button"
              onClick={() =>
                updateFeatureSetting(stateKey, {
                  mode: "own_key",
                })
              }
              className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded transition-colors cursor-pointer ${
                !isPlatformCredits
                  ? "text-foreground font-black bg-background shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Own Key
            </button>
            <Switch
              checked={isPlatformCredits}
              onCheckedChange={(checked) =>
                updateFeatureSetting(stateKey, {
                  mode: checked ? "platform_credits" : "own_key",
                })
              }
              aria-label="Toggle Platform Credits Mode"
              className="cursor-pointer"
            />
            <button
              type="button"
              onClick={() =>
                updateFeatureSetting(stateKey, {
                  mode: "platform_credits",
                })
              }
              className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded transition-colors cursor-pointer ${
                isPlatformCredits
                  ? "text-primary font-black bg-background shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Platform Credits
            </button>
          </div>
        </div>

        {/* Dropdown Menus: Provider & Model (Model hidden for Paddle OCR) */}
        <div className={`grid gap-4 ${isPaddleOcr ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
          {/* Provider Dropdown */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground uppercase tracking-wider block">
              Provider
            </label>
            <select
              value={setting.provider}
              onChange={(e) => {
                const newProvId = e.target.value;
                const newProvObj =
                  safeProviders.find((p) => p.id === newProvId) || safeProviders[0];
                const newModelId =
                  newProvObj?.models?.find((m) => m.isDefault)?.id ||
                  newProvObj?.models?.[0]?.id ||
                  "default";
                updateFeatureSetting(stateKey, {
                  provider: newProvId,
                  model: newModelId,
                });
              }}
              className="w-full text-xs p-2.5 bg-background/80 rounded-lg font-semibold text-foreground outline-none focus:ring-1 focus:ring-primary/40 shadow-2xs"
            >
              {safeProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Model Dropdown - Hidden for Paddle OCR */}
          {!isPaddleOcr && (
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-foreground uppercase tracking-wider block">
                Model
              </label>
              <select
                value={setting.model}
                onChange={(e) => updateFeatureSetting(stateKey, { model: e.target.value })}
                className="w-full text-xs p-2.5 bg-background/80 rounded-lg font-semibold text-foreground outline-none focus:ring-1 focus:ring-primary/40 shadow-2xs"
              >
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.isDefault ? "(Default)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* API Key Input Box - Hidden in Platform Credits Mode */}
        {!isPlatformCredits && (
          <div className="pt-1">
            {isNoApiNeeded ? (
              <div className="p-3 rounded-lg bg-emerald-500/10 flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>
                  <strong>{provName}</strong> runs directly without requiring an API key.
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-primary" /> API Key ({provName})
                  </label>
                  <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-emerald-500" /> AES-256-GCM Encrypted
                  </span>
                </div>

                {hasSavedMaskedKey ? (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 bg-background/60 rounded-lg gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-foreground">
                        {maskedKeys[provId]}
                      </span>
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full">
                        Stored
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 self-end sm:self-auto">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs hover:bg-muted"
                        onClick={() => handleTestApiKey(provId)}
                        disabled={testingKeyProvider === provId}
                      >
                        {testingKeyProvider === provId ? (
                          <Loader2 className="w-3 h-3 animate-spin mr-1" />
                        ) : (
                          <RefreshCw className="w-3 h-3 mr-1" />
                        )}
                        Test Key
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-500/10"
                        onClick={() => handleDeleteApiKey(provId)}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="password"
                        placeholder={`Enter ${provName} API key...`}
                        value={apiKeyInputs[provId] || ""}
                        onChange={(e) =>
                          setApiKeyInputs((prev) => ({
                            ...prev,
                            [provId]: e.target.value,
                          }))
                        }
                        className="flex-1 text-xs p-2.5 bg-background/80 rounded-lg font-mono outline-none focus:ring-1 focus:ring-primary/40 shadow-2xs"
                      />
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          onClick={() => handleSaveApiKey(provId)}
                          disabled={savingKeyProvider === provId}
                          className="h-9 px-4 text-xs font-bold"
                        >
                          {savingKeyProvider === provId ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                          ) : (
                            "Save Key"
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleTestApiKey(provId)}
                          disabled={testingKeyProvider === provId}
                          className="h-9 px-3.5 text-xs font-bold border-border/30"
                        >
                          {testingKeyProvider === provId ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                          ) : (
                            "Test Key"
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Real Test-Key Feedback Banner */}
                {testResult && testResult.provider === provId && (
                  <div
                    className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 mt-2 ${
                      testResult.success
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-200"
                        : "bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-200"
                    }`}
                  >
                    {testResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                    )}
                    <span className="font-medium">{testResult.message}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Pricing hint */}
        <div className="flex items-center justify-between pt-0.5 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>
              {isPlatformCredits
                ? "Deducts pay-as-you-go credits from your wallet (includes 40% markup)."
                : `Billed directly to your ${provName} account. $0 platform credits deducted.`}
            </span>
          </div>
          {isPlatformCredits && onNavigateBilling && (
            <button
              onClick={onNavigateBilling}
              className="text-primary hover:underline font-bold shrink-0 ml-2 cursor-pointer"
            >
              Add Funds →
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full w-full overflow-hidden bg-background text-foreground flex flex-col min-h-0">
      {/* Top Header Bar - Borderless & Clean */}
      <header className="w-full bg-card/30 backdrop-blur-md px-4 sm:px-6 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsSidebarFolded((prev) => !prev)}
            className="h-8 w-8 text-muted-foreground hover:text-foreground hidden md:flex cursor-pointer"
            title={isSidebarFolded ? "Expand sidebar" : "Collapse sidebar"}
            aria-label="Toggle sidebar"
          >
            {isSidebarFolded ? (
              <PanelLeftOpen className="w-4 h-4 text-primary" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </Button>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Settings</span>
            <span className="text-border/40">/</span>
            <span className="font-bold text-foreground">AI Provider Settings</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 sm:gap-4">
          {user && (
            <span className="hidden sm:inline text-xs font-mono text-muted-foreground">
              {user.email}
            </span>
          )}

          {/* Main Billing Mode Switch beside Wallet: Left is Own Key, Right is Platform Credits */}
          <div className="flex items-center gap-1.5 select-none" aria-label="Main AI billing mode switch">
            <button
              type="button"
              onClick={() => handleMainModeChange("own_key")}
              className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded transition-colors cursor-pointer bg-transparent border-0 outline-none ${
                mainBillingMode === "own_key"
                  ? "text-foreground font-black"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Own Key
            </button>
            <Switch
              checked={mainBillingMode === "platform_credits"}
              onCheckedChange={(checked) =>
                handleMainModeChange(checked ? "platform_credits" : "own_key")
              }
              aria-label="Main switch: Own Key or Platform Credits"
              className="cursor-pointer"
            />
            <button
              type="button"
              onClick={() => handleMainModeChange("platform_credits")}
              className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded transition-colors cursor-pointer bg-transparent border-0 outline-none ${
                mainBillingMode === "platform_credits"
                  ? "text-primary font-black"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Platform Credits
            </button>
          </div>

          {onNavigateBilling && (
            <button
              onClick={onNavigateBilling}
              className="flex items-center gap-1.5 text-xs font-bold text-foreground hover:text-primary transition-colors cursor-pointer bg-transparent border-0 p-0 outline-none"
            >
              <CreditCard className="w-3.5 h-3.5 text-primary" />
              <span>Wallet: ${walletBalance.toFixed(2)}</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Container - Full Edge-to-Edge Webpage Layout */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0 w-full">
        {/* Mobile Top Navigation Dropdown */}
        <div className="md:hidden p-3 bg-muted/20 shrink-0">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
            Select Pipeline
          </label>
          <select
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value as PipelineId)}
            className="w-full text-xs p-2.5 border-0 bg-background/80 rounded-md font-semibold text-foreground outline-none"
          >
            {sidebarItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        {/* Desktop Left Foldable Sidebar */}
        <aside
          className={`hidden md:flex flex-col shrink-0 bg-muted/10 transition-all duration-200 select-none overflow-y-auto ${
            isSidebarFolded ? "w-14 items-center py-3 px-1.5 space-y-1.5" : "w-56 p-3 space-y-1"
          }`}
        >
          {!isSidebarFolded && (
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Pipelines
            </div>
          )}

          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                title={item.label}
                className={`flex items-center rounded-lg text-xs font-bold transition-all text-left cursor-pointer ${
                  isSidebarFolded
                    ? `w-10 h-10 justify-center ${
                        isActive
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                      }`
                    : `w-full gap-2.5 px-3 py-2.5 ${
                        isActive
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                      }`
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!isSidebarFolded && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </aside>

        {/* Right Content Workspace */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 min-h-0 bg-background/50">
          {/* 1. VISION: Contains both "OCR" and "Vision Analyst" sections on one page */}
          {activeTab === "vision" && (
            <div className="space-y-6 max-w-5xl">
              <div>
                <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Eye className="w-5 h-5 text-primary" /> Vision
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Multi-modal vision analysis for manga panels, speech balloon detection, and optical character recognition.
                </p>
              </div>

              {/* Section 1: OCR */}
              {renderPipelineControlBlock({
                title: "1. OCR (Optical Character Recognition)",
                description:
                  "Extracts dialogue and dialogue balloons. Supported: Paddle OCR, Google Gemini, OpenAI, Anthropic Claude, Alibaba Qwen, Cloudflare Workers AI, and Local LLM.",
                stateKey: "vision_ocr",
                providers: catalog.vision?.ocrProviders || FALLBACK_CATALOG.vision.ocrProviders,
                isSubSection: true,
              })}

              {/* Section 2: Vision Analyst */}
              {renderPipelineControlBlock({
                title: "2. Vision Analyst",
                description:
                  "Analyzes panel composition, character facial expressions, and stage directions. Supported: Google Gemini, OpenAI, Anthropic Claude, Alibaba Qwen, and Local LLM.",
                stateKey: "vision_analyst",
                providers: catalog.vision?.analystProviders || FALLBACK_CATALOG.vision.analystProviders,
                isSubSection: true,
              })}
            </div>
          )}

          {/* 2. TEXT TO SPEECH */}
          {activeTab === "tts" && (
            <div className="space-y-6 max-w-5xl">
              <div>
                <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Volume2 className="w-5 h-5 text-primary" /> Text to Speech
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Voice narration and character acting with British RP accents. Providers: Elevenlabs, Cartesia, Google Gemini, OpenAI, and Local LLM.
                </p>
              </div>

              {renderPipelineControlBlock({
                title: "Speech Synthesis Engine",
                description: "Select voice model and configure your provider API key.",
                stateKey: "tts",
                providers: catalog.tts?.providers || FALLBACK_CATALOG.tts.providers,
              })}

              {/* TTS Provider Fallback Priority List */}
              <div className="space-y-3 p-5 rounded-xl bg-card/50 shadow-2xs">
                <div className="flex items-center justify-between pb-1">
                  <div>
                    <span className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-primary" /> Provider Fallback Priority
                    </span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      If the primary model is throttled or fails, the system automatically falls back down this order.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5 mt-2">
                  {(
                    featureSettings["tts"]?.ttsFallbackOrder || [
                      "elevenlabs",
                      "cartesia",
                      "google",
                      "openai",
                      "local_llm",
                    ]
                  ).map((provId: string, idx: number, arr: string[]) => {
                    const allTtsProviders = catalog.tts?.providers || FALLBACK_CATALOG.tts.providers;
                    const provObj = allTtsProviders.find((p: any) => p.id === provId);
                    const provName = provObj ? provObj.name : provId;
                    return (
                      <div
                        key={provId}
                        className="flex items-center justify-between px-3 py-2 bg-background/80 border border-border/20 rounded-lg text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center font-mono text-[10px] font-bold text-muted-foreground">
                            {idx + 1}
                          </span>
                          <span className="font-semibold text-foreground">{provName}</span>
                          {idx === 0 && (
                            <span className="text-[10px] text-primary font-bold uppercase tracking-wide">
                              (Primary)
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={idx === 0}
                            onClick={() => moveTtsProvider(idx, "up")}
                            className="h-7 w-7 text-muted-foreground hover:text-foreground cursor-pointer"
                            title="Move Up"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={idx === arr.length - 1}
                            onClick={() => moveTtsProvider(idx, "down")}
                            className="h-7 w-7 text-muted-foreground hover:text-foreground cursor-pointer"
                            title="Move Down"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 3. TEXT TO IMAGES */}
          {activeTab === "text_to_image" && (
            <div className="space-y-6 max-w-5xl">
              <div>
                <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-primary" /> Text to Images
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Comic panel generation and cover concept art. Providers: Stability AI, Black Forest Labs, Google Gemini, OpenAI, and Local LLM.
                </p>
              </div>

              {renderPipelineControlBlock({
                title: "Image Generation Engine",
                description: "Select rendering model and configure your provider API key.",
                stateKey: "text_to_image",
                providers: catalog.text_to_image?.providers || FALLBACK_CATALOG.text_to_image.providers,
              })}
            </div>
          )}

          {/* 4. DIRECTOR */}
          {activeTab === "director" && (
            <div className="space-y-6 max-w-5xl">
              <div>
                <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Film className="w-5 h-5 text-primary" /> Director
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Story pacing, audio drama adaptation, and stage direction scripting. Providers: Google Gemini, OpenAI, Anthropic Claude, Alibaba Qwen, and Local LLM.
                </p>
              </div>

              {renderPipelineControlBlock({
                title: "Director Reasoning Engine",
                description: "Select reasoning model and configure your provider API key.",
                stateKey: "director",
                providers: catalog.director?.providers || FALLBACK_CATALOG.director.providers,
              })}
            </div>
          )}

          {/* 5. MUSIC */}
          {activeTab === "music" && (
            <div className="space-y-6 max-w-5xl">
              <div>
                <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Music className="w-5 h-5 text-primary" /> Music
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Atmospheric cinematic soundscapes and orchestral BGM. Providers: ElevenLabs, Stability AI, Meta, Freesound API, and Local LLM.
                </p>
              </div>

              {renderPipelineControlBlock({
                title: "Music Synthesis Engine",
                description: "Select music model and configure your provider API key.",
                stateKey: "music",
                providers: catalog.music?.providers || FALLBACK_CATALOG.music.providers,
              })}
            </div>
          )}

          {/* 6. SOUND EFFECTS */}
          {activeTab === "sfx" && (
            <div className="space-y-6 max-w-5xl">
              <div>
                <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Zap className="w-5 h-5 text-primary" /> Sound Effects
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Foley, ambient noise, and dynamic impact effects. Providers: ElevenLabs, Stability AI, Meta, Freesound API, and Local LLM.
                </p>
              </div>

              {renderPipelineControlBlock({
                title: "Sound Effects Engine",
                description: "Select SFX model and configure your provider API key.",
                stateKey: "sfx",
                providers: catalog.sfx?.providers || FALLBACK_CATALOG.sfx.providers,
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
