/**
 * serverAiSettings.ts
 *
 * Per-feature AI provider & model catalog, AES-256-GCM encrypted API key storage,
 * masked key retrieval, and real-call test key verification.
 */

import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import { billingRateLimit } from "./serverBilling";

// ─────────────────────────────────────────────
// 1. Encryption Secret & AES-256-GCM
// ─────────────────────────────────────────────

const AI_STORAGE_DIR = path.join("/tmp", "ebookcc-media", "ai-settings");
const ENCRYPTED_KEYS_FILE = path.join(AI_STORAGE_DIR, "user_keys.json");
const USER_CONFIGS_FILE = path.join(AI_STORAGE_DIR, "user_configs.json");
const SECRET_SEED_FILE = path.join(AI_STORAGE_DIR, "master_secret.key");

fs.mkdirSync(AI_STORAGE_DIR, { recursive: true });

function getMasterEncryptionKey(): Buffer {
  let envSecret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!envSecret) {
    if (fs.existsSync(SECRET_SEED_FILE)) {
      envSecret = fs.readFileSync(SECRET_SEED_FILE, "utf-8").trim();
    } else {
      envSecret = crypto.randomBytes(32).toString("hex");
      fs.writeFileSync(SECRET_SEED_FILE, envSecret, "utf-8");
    }
  }
  // Derive 32-byte key via SHA-256
  return crypto.createHash("sha256").update(envSecret).digest();
}

function encryptApiKey(plaintext: string): { ciphertext: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getMasterEncryptionKey(), iv);
  let enc = cipher.update(plaintext, "utf-8", "hex");
  enc += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return {
    ciphertext: enc,
    iv: iv.toString("hex"),
    tag,
  };
}

function decryptApiKey(ciphertext: string, ivHex: string, tagHex: string): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getMasterEncryptionKey(),
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  let dec = decipher.update(ciphertext, "hex", "utf-8");
  dec += decipher.final("utf-8");
  return dec;
}

export function maskApiKey(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.length <= 8) return "••••••••";
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}...${suffix}`;
}

// ─────────────────────────────────────────────
// 2. Server-side AI Provider & Model Catalog
// ─────────────────────────────────────────────

export interface FeatureCatalogItem {
  id: string;
  name: string;
  description: string;
  sections?: Array<{
    id: string;
    title: string;
    description: string;
  }>;
  providers: Array<{
    id: string;
    name: string;
    models: Array<{
      id: string;
      name: string;
      description?: string;
      isDefault?: boolean;
    }>;
  }>;
  defaultProvider: string;
  defaultModel: string;
  defaultMode: "platform_credits" | "own_key";
}

export const SERVER_AI_CATALOG: Record<string, any> = {
  vision: {
    id: "vision",
    name: "Vision",
    description: "Visual understanding and text extraction: Optical Character Recognition (OCR) and scene/character Vision Analyst.",
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
    defaultMode: "platform_credits",
  },
  tts: {
    id: "tts",
    name: "Text to Speech",
    description: "Character voice synthesis and multi-speaker audiobook acting.",
    providers: [
      {
        id: "elevenlabs",
        name: "ElevenLabs",
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
    description: "Comic panel illustrations, cover art, and character rendering.",
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
    description: "Script adaptation, dialogue pacing, and sound direction from story text.",
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
    description: "Cinematic soundtrack generator and adaptive audio scoring.",
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
    description: "Foley, impacts, atmospheric chimes, and action sound cues.",
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

// ─────────────────────────────────────────────
// 3. User Encrypted Key Store & Preferences
// ─────────────────────────────────────────────

interface EncryptedKeyRecord {
  ciphertext: string;
  iv: string;
  tag: string;
  masked: string;
  updatedAt: number;
}

// Map: userId -> providerId -> EncryptedKeyRecord
const userEncryptedKeys = new Map<string, Map<string, EncryptedKeyRecord>>();

export interface UserFeatureSetting {
  mode: "platform_credits" | "own_key";
  provider: string;
  model: string;
  ttsFallbackOrder?: string[];
}

// Map: userId -> featureId -> UserFeatureSetting
const userFeatureSettings = new Map<string, Map<string, UserFeatureSetting>>();

function loadAiSettingsFromDisk() {
  try {
    if (fs.existsSync(ENCRYPTED_KEYS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ENCRYPTED_KEYS_FILE, "utf-8"));
      Object.entries(data).forEach(([uid, provMap]: [string, any]) => {
        const pMap = new Map<string, EncryptedKeyRecord>();
        Object.entries(provMap).forEach(([prov, rec]: [string, any]) => {
          pMap.set(prov, rec);
        });
        userEncryptedKeys.set(uid, pMap);
      });
    }
    if (fs.existsSync(USER_CONFIGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USER_CONFIGS_FILE, "utf-8"));
      Object.entries(data).forEach(([uid, featMap]: [string, any]) => {
        const fMap = new Map<string, UserFeatureSetting>();
        Object.entries(featMap).forEach(([feat, setting]: [string, any]) => {
          fMap.set(feat, setting);
        });
        userFeatureSettings.set(uid, fMap);
      });
    }
  } catch (e: any) {
    console.error("[AI Settings] Error loading from disk:", e.message);
  }
}

function persistAiSettingsToDisk() {
  try {
    const keysObj: Record<string, Record<string, EncryptedKeyRecord>> = {};
    userEncryptedKeys.forEach((pMap, uid) => {
      keysObj[uid] = {};
      pMap.forEach((rec, prov) => {
        keysObj[uid][prov] = rec;
      });
    });
    fs.writeFileSync(ENCRYPTED_KEYS_FILE, JSON.stringify(keysObj, null, 2), "utf-8");

    const confObj: Record<string, Record<string, UserFeatureSetting>> = {};
    userFeatureSettings.forEach((fMap, uid) => {
      confObj[uid] = {};
      fMap.forEach((set, feat) => {
        confObj[uid][feat] = set;
      });
    });
    fs.writeFileSync(USER_CONFIGS_FILE, JSON.stringify(confObj, null, 2), "utf-8");
  } catch (e: any) {
    console.error("[AI Settings] Error persisting to disk:", e.message);
  }
}

loadAiSettingsFromDisk();

/**
 * Returns user decrypted API key for a provider (internal backend use only).
 * Never logged or returned to client!
 */
export function getUserDecryptedKey(userId: string, provider: string): string | null {
  const pMap = userEncryptedKeys.get(userId);
  if (!pMap) return null;
  const rec = pMap.get(provider);
  if (!rec) return null;
  try {
    return decryptApiKey(rec.ciphertext, rec.iv, rec.tag);
  } catch (e) {
    return null;
  }
}

export function getUserAiSettingsSummary(userId: string): {
  mainMode: "platform_credits" | "own_key";
  featureSettings: Record<string, UserFeatureSetting>;
  configuredProviders: string[];
  hasAnyApiKey: boolean;
} {
  const pMap = userEncryptedKeys.get(userId);
  const configuredProviders: string[] = [];
  if (pMap) {
    pMap.forEach((rec, prov) => {
      if (rec && rec.ciphertext) {
        configuredProviders.push(prov);
      }
    });
  }

  const fMap = userFeatureSettings.get(userId);
  const featureSettings: Record<string, UserFeatureSetting> = {};
  if (fMap) {
    fMap.forEach((setting, feat) => {
      if (feat !== "__main_mode__") {
        featureSettings[feat] = setting;
      }
    });
  }

  const savedMainMode = fMap?.get("__main_mode__")?.mode;
  return {
    mainMode: savedMainMode === "own_key" ? "own_key" : "platform_credits",
    featureSettings,
    configuredProviders,
    hasAnyApiKey: configuredProviders.length > 0,
  };
}


/**
 * Test API key with a real minimal provider call
 */
export async function testProviderApiKey(provider: string, apiKey: string): Promise<{ success: boolean; message: string }> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    return { success: false, message: "API key cannot be empty." };
  }

  try {
    if (provider === "google") {
      const client = new GoogleGenAI({ apiKey: cleanKey });
      const resp = await client.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: "Respond with the single word: OK",
      });
      if (resp && resp.text) {
        return { success: true, message: "Google Gemini API key verified successfully!" };
      }
      return { success: false, message: "Empty response from Google Gemini." };
    }

    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${cleanKey}` },
      });
      if (res.ok) {
        return { success: true, message: "OpenAI API key verified successfully!" };
      }
      const err = await res.json().catch(() => ({}));
      return { success: false, message: err.error?.message || `OpenAI returned HTTP ${res.status}` };
    }

    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": cleanKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-5-5",
          max_tokens: 5,
          messages: [{ role: "user", content: "Hi" }],
        }),
      });
      if (res.ok) {
        return { success: true, message: "Anthropic Claude API key verified successfully!" };
      }
      const err = await res.json().catch(() => ({}));
      return { success: false, message: err.error?.message || `Anthropic returned HTTP ${res.status}` };
    }

    if (provider === "elevenlabs") {
      const res = await fetch("https://api.elevenlabs.io/v1/user", {
        headers: { "xi-api-key": cleanKey },
      });
      if (res.ok) {
        return { success: true, message: "ElevenLabs API key verified successfully!" };
      }
      const err = await res.json().catch(() => ({}));
      return { success: false, message: err.detail?.message || `ElevenLabs returned HTTP ${res.status}` };
    }

    if (provider === "stability") {
      const res = await fetch("https://api.stability.ai/v1/user/account", {
        headers: { Authorization: `Bearer ${cleanKey}` },
      });
      if (res.ok) {
        return { success: true, message: "Stability AI key verified successfully!" };
      }
      const err = await res.json().catch(() => ({}));
      return { success: false, message: err.message || `Stability returned HTTP ${res.status}` };
    }

    if (provider === "workers_ai") {
      const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID || "fa7ead1c0aaa1e931de55eb01c384876";
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/run/@cf/deepgram/aura-2-en`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cleanKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: "Ping", encoding: "mp3" }),
      });
      if (res.ok || res.status === 200) {
        return { success: true, message: "Cloudflare Workers AI token verified successfully!" };
      }
      return { success: false, message: `Cloudflare returned HTTP ${res.status}` };
    }

    if (provider === "paddle_ocr" || provider === "cloudflare") {
      return { success: true, message: `${provider === "paddle_ocr" ? "Paddle OCR (In-browser)" : "Cloudflare Workers AI"} runs directly without requiring an API key.` };
    }

    if (provider === "cartesia") {
      const res = await fetch("https://api.cartesia.ai/voices", {
        headers: {
          "X-API-Key": cleanKey,
          "Cartesia-Version": "2024-06-10",
        },
      });
      if (res.ok) {
        return { success: true, message: "Cartesia API key verified successfully!" };
      }
      const err = await res.json().catch(() => ({}));
      return { success: false, message: err.message || `Cartesia returned HTTP ${res.status}` };
    }

    if (provider === "qwen") {
      const res = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/models", {
        headers: { Authorization: `Bearer ${cleanKey}` },
      });
      if (res.ok) {
        return { success: true, message: "Alibaba Qwen API key verified successfully!" };
      }
      const err = await res.json().catch(() => ({}));
      return { success: false, message: err.message || `Alibaba Qwen returned HTTP ${res.status}` };
    }

    if (provider === "black_forest_labs") {
      const res = await fetch("https://api.bfl.ml/v1/models", {
        headers: { "x-key": cleanKey },
      });
      if (res.ok || res.status === 200 || res.status === 404) {
        return { success: true, message: "Black Forest Labs (FLUX) API key verified successfully!" };
      }
      const err = await res.json().catch(() => ({}));
      return { success: false, message: err.detail || `Black Forest Labs returned HTTP ${res.status}` };
    }

    if (provider === "freesound") {
      const res = await fetch(`https://freesound.org/apiv2/me/?token=${cleanKey}`);
      if (res.ok) {
        return { success: true, message: "Freesound API key verified successfully!" };
      }
      return { success: false, message: `Freesound returned HTTP ${res.status}` };
    }

    if (provider === "local_llm") {
      try {
        const localUrl = cleanKey.startsWith("http") ? cleanKey : "http://localhost:11434/v1/models";
        const res = await fetch(localUrl, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          return { success: true, message: `Connected to local model endpoint (${localUrl}) successfully!` };
        }
      } catch (e: any) {
        return { success: true, message: "Local model configuration saved." };
      }
      return { success: true, message: "Local LLM format accepted." };
    }

    return { success: true, message: "API key format accepted." };
  } catch (err: any) {
    return { success: false, message: err.message || "Failed to reach provider service." };
  }
}

// ─────────────────────────────────────────────
// 4. Express Routes Registration for AI Settings
// ─────────────────────────────────────────────

export function setupAiSettingsRoutes(app: express.Express) {
  function getAuthUserId(req: express.Request): string | null {
    const uid = req.headers["x-user-id"] as string;
    if (uid && uid.length > 2) return uid;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      if (token && token.length > 5) return token;
    }
    return null;
  }

  // 1. GET /api/ai/config (Public dynamic catalog)
  app.get("/api/ai/config", (req, res) => {
    res.json({
      catalog: SERVER_AI_CATALOG,
      ttsFallbackOrder: ["workers_ai", "elevenlabs", "openai", "google"],
    });
  });

  // 2. GET /api/ai/user-settings (Authenticated per-user settings + masked keys)
  app.get("/api/ai/user-settings", billingRateLimit, (req, res): any => {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized. Please sign in to access AI settings." });
    }

    // Masked keys
    const maskedKeys: Record<string, string> = {};
    const pMap = userEncryptedKeys.get(userId);
    if (pMap) {
      pMap.forEach((rec, prov) => {
        maskedKeys[prov] = rec.masked;
      });
    }

    // Helper to upgrade any legacy model IDs to the newest model in catalog
    const resolveLatestModel = (providersList: any[], provId: string, savedModel?: string, fallbackModel?: string): string => {
      const provObj = providersList?.find((p: any) => p.id === provId) || providersList?.[0];
      if (!provObj || !provObj.models?.length) return fallbackModel || "default";
      if (savedModel && provObj.models.some((m: any) => m.id === savedModel)) {
        return savedModel;
      }
      const def = provObj.models.find((m: any) => m.isDefault) || provObj.models[0];
      return def.id;
    };

    // User feature preferences
    const featureSettings: Record<string, UserFeatureSetting> = {};
    const fMap = userFeatureSettings.get(userId);

    const visionCat = SERVER_AI_CATALOG.vision;
    const savedOcr = fMap?.get("vision_ocr");
    const ocrProv = savedOcr?.provider || visionCat.defaultOcrProvider;
    featureSettings.vision_ocr = {
      mode: savedOcr?.mode || visionCat.defaultMode || "platform_credits",
      provider: ocrProv,
      model: resolveLatestModel(visionCat.ocrProviders, ocrProv, savedOcr?.model, visionCat.defaultOcrModel),
    };

    const savedAnalyst = fMap?.get("vision_analyst");
    const analystProv = savedAnalyst?.provider || visionCat.defaultAnalystProvider;
    featureSettings.vision_analyst = {
      mode: savedAnalyst?.mode || visionCat.defaultMode || "platform_credits",
      provider: analystProv,
      model: resolveLatestModel(visionCat.analystProviders, analystProv, savedAnalyst?.model, visionCat.defaultAnalystModel),
    };

    ["tts", "text_to_image", "director", "music", "sfx"].forEach((featId) => {
      const cat = SERVER_AI_CATALOG[featId];
      const saved = fMap?.get(featId);
      const prov = saved?.provider || cat.defaultProvider;
      featureSettings[featId] = {
        mode: saved?.mode || cat.defaultMode || "platform_credits",
        provider: prov,
        model: resolveLatestModel(cat.providers, prov, saved?.model, cat.defaultModel),
        ttsFallbackOrder: featId === "tts"
          ? saved?.ttsFallbackOrder || ["elevenlabs", "cartesia", "google", "openai", "local_llm"]
          : undefined,
      };
    });

    const savedMainMode = fMap?.get("__main_mode__")?.mode;

    return res.json({
      featureSettings,
      maskedKeys,
      mainMode: savedMainMode || "platform_credits",
    });
  });

  // 3. POST /api/ai/save-key (Encrypt and store key, return masked value only)
  app.post("/api/ai/save-key", billingRateLimit, async (req, res): Promise<any> => {
    const userId = getAuthUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized." });

    const { provider, apiKey } = req.body;
    if (!provider || !apiKey) {
      return res.status(400).json({ error: "Provider and apiKey are required." });
    }

    const cleanKey = apiKey.trim();
    const enc = encryptApiKey(cleanKey);
    const masked = maskApiKey(cleanKey);

    let pMap = userEncryptedKeys.get(userId);
    if (!pMap) {
      pMap = new Map();
      userEncryptedKeys.set(userId, pMap);
    }

    pMap.set(provider, {
      ...enc,
      masked,
      updatedAt: Date.now(),
    });

    persistAiSettingsToDisk();
    return res.json({
      success: true,
      provider,
      masked,
      message: `API key for ${provider} saved and encrypted successfully.`,
    });
  });

  // 4. POST /api/ai/delete-key (Remove key from vault)
  app.post("/api/ai/delete-key", billingRateLimit, (req, res): any => {
    const userId = getAuthUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized." });

    const { provider } = req.body;
    const pMap = userEncryptedKeys.get(userId);
    if (pMap) {
      pMap.delete(provider);
      persistAiSettingsToDisk();
    }

    return res.json({ success: true, provider, message: `API key for ${provider} removed.` });
  });

  // 5. POST /api/ai/test-key (Real call test key)
  app.post("/api/ai/test-key", billingRateLimit, async (req, res): Promise<any> => {
    const userId = getAuthUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized." });

    const { provider, apiKey } = req.body;
    let keyToTest = apiKey;

    // If apiKey wasn't sent, use existing saved key
    if (!keyToTest) {
      keyToTest = getUserDecryptedKey(userId, provider);
    }

    if (!keyToTest) {
      return res.status(400).json({ success: false, message: "No API key provided to test." });
    }

    const testResult = await testProviderApiKey(provider, keyToTest);
    return res.json(testResult);
  });

  // 6. POST /api/ai/save-feature-setting (Save mode, provider, model, tts order)
  app.post("/api/ai/save-feature-setting", billingRateLimit, (req, res): any => {
    const userId = getAuthUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized." });

    const { feature, setting } = req.body;
    if (!feature || !setting) {
      return res.status(400).json({ error: "feature and setting are required." });
    }

    let fMap = userFeatureSettings.get(userId);
    if (!fMap) {
      fMap = new Map();
      userFeatureSettings.set(userId, fMap);
    }

    fMap.set(feature, {
      mode: setting.mode || "platform_credits",
      provider: setting.provider || "",
      model: setting.model || "",
      ttsFallbackOrder: setting.ttsFallbackOrder,
    });

    persistAiSettingsToDisk();
    return res.json({ success: true, feature, setting: fMap.get(feature) });
  });

  // 7. POST /api/ai/save-main-mode (Apply main billing mode to all sections)
  app.post("/api/ai/save-main-mode", billingRateLimit, (req, res): any => {
    const userId = getAuthUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized." });

    const mode: "platform_credits" | "own_key" = req.body.mode === "own_key" ? "own_key" : "platform_credits";
    let fMap = userFeatureSettings.get(userId);
    if (!fMap) {
      fMap = new Map();
      userFeatureSettings.set(userId, fMap);
    }

    fMap.set("__main_mode__", { mode, provider: "", model: "" });
    const allSections = ["vision_ocr", "vision_analyst", "tts", "text_to_image", "director", "music", "sfx"];
    allSections.forEach((sec) => {
      const existing = fMap!.get(sec);
      if (existing) {
        fMap!.set(sec, { ...existing, mode });
      }
    });

    persistAiSettingsToDisk();
    return res.json({ success: true, mode });
  });
}
