/**
 * broadcastConfig.ts
 *
 * Central configuration module for the Audio Drama Broadcast feature.
 * All model IDs, provider order, quotas, limits, and timeouts live here
 * so they can be changed without code edits elsewhere.
 */

//（Free plan, 10,000 Neurons/day, make it's default for signin user but not paid）──
export const FREE_MODELS = {
  vision:            "@cf/google/gemma-4-26b-a4b-it",
  vision_fallback:   "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
  ocr:               "@cf/google/gemma-4-26b-a4b-it",
  ocr_fallback:      "@cf/meta/llama-3.2-11b-vision-instruct",
  director:          "@cf/nvidia/nemotron-3-120b-a12b",
  director_alt:      "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
  director_fallback: "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
  tts:               "@cf/deepgram/aura-2-en",
  tts_alt:           "@cf/inworld/tts-1.5-max",
  tts_es:            "@cf/deepgram/aura-2-es",
  music:             null,
  sfx:               null,
};

//（BYOK via gateway）──
export const PAID_MODELS = {
  vision:        "google/gemini-pro",  // via gateway BYOK
  ocr_fallback:  "google/gemini-flash",  // via gateway BYOK
  director:      "custom-codecraftai/claude-sonnet",  // via gateway BYOK
  tts:           "elevenlabs/...",      // via gateway BYOK
  tts_fallback:  "openai/tts-1",  // via gateway BYOK
  music:         "elevenlabs/...",      // via gateway BYOK
  sfx:           "elevenlabs/...",      // via gateway BYOK
};

export function getModels(env?: { CLOUDFLARE_ACCOUNT_ID?: string; CF_ACCOUNT_ID?: string; [key: string]: any }, isPaidUser?: boolean) {
  // If isPaidUser is explicitly specified, respect it; otherwise free plan is default for signin users
  const isPaid = isPaidUser !== undefined 
    ? Boolean(isPaidUser) 
    : Boolean(env?.IS_PAID || env?.USER_PLAN === "paid");
  return isPaid ? PAID_MODELS : FREE_MODELS;
}

export const BROADCAST_CONFIG = {
  // Models
  FREE_MODELS,
  PAID_MODELS,
  getModels,

  VISION_MODEL: "gemini-2.5-pro",
  VISION_FALLBACK_MODEL: "claude-3-7-sonnet-20250219",
  DIRECTOR_MODEL: "claude-3-7-sonnet-20250219",
  DIRECTOR_FALLBACK_MODEL: "gemini-2.5-pro",

  // Pipeline Version (used in cache key)
  PIPELINE_VERSION: "v1.2.0",

  // Providers (fixed order)
  TTS_PROVIDERS: ["elevenlabs", "openai", "gemini"] as const,
  MUSIC_PROVIDER: "elevenlabs" as const,
  SFX_PROVIDER: "elevenlabs" as const,

  // Limits
  LIMITS: {
    MAX_PAGES_PER_BATCH: 15,
    DEFAULT_PAGES_PER_BATCH: 12,
    MAX_IMAGE_LONG_EDGE: 1536,
    JPEG_QUALITY: 0.85,
    DIRECTOR_CHUNK_TOKENS: 6000,
    MAX_NOVEL_WORDS_PER_CHUNK: 3000,
  },

  // Timeouts (in ms)
  TIMEOUTS: {
    VISION_TIMEOUT_MS: 35000,
    DIRECTOR_TIMEOUT_MS: 45000,
    TTS_TIMEOUT_MS: 25000,
    AUDIO_FX_TIMEOUT_MS: 20000,
  },

  // Audio Mixer Defaults
  AUDIO_DEFAULTS: {
    DEFAULT_VOICE_GAIN: 1.0,
    DEFAULT_BGM_GAIN: 0.18,
    DUCKED_BGM_GAIN: 0.08,
    DEFAULT_SFX_GAIN: 0.6,
    BGM_CROSSFADE_SEC: 2.0,
    DUCK_RAMP_MS: 300,
    DEFAULT_PREFETCH_COUNT: 4,
  },

  // Voice & Narration Defaults
  VOICE_DEFAULTS: {
    DEFAULT_NARRATION_ACCENT: "British RP",
    DEFAULT_NARRATOR_VOICE_DESIGN: "Refined British RP narrator voice, articulate, warm and resonant with steady cinematic pacing",
    ELEVENLABS_NARRATOR_VOICE_ID: "JBFqnCBsd6RMkjVDRZzb", // George (Classic British RP narrator)
    OPENAI_NARRATOR_VOICE: "fable", // British accent voice in OpenAI TTS
    SPEECH_SYNTHESIS_LANG: "en-GB",
  },

  // Quotas & Estimates
  QUOTAS: {
    DAILY_BROADCAST_LIMIT: 20,
    ESTIMATED_COST_PER_PAGE_USD: 0.03,
    ESTIMATED_COST_PER_CHAPTER_USD: 0.15,
  },

  // Cloudflare AI Gateways (Configured with BYOK keys in Cloudflare AI Gateway)
  GATEWAYS: {
    ANTHROPIC: "ebookcc-gateway_codecraftai_default",
    ELEVENLABS: "ebookcc-gateway_elevenlabs_default",
    GOOGLE_AI_STUDIO: "ebookcc-gateway_google-ai-studio_default",
    OPENAI: "ebookcc-gateway_openai_default",
  },
};

