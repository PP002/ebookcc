/**
 * serverBroadcast.ts
 *
 * Server-side Orchestration for Audio Drama Broadcast Pipeline:
 * - Stage 2: Vision Analysis (Own Key / Platform Credits -> Workers AI fallback)
 * - Stage 3: Script Direction (Own Key / Platform Credits -> Workers AI fallback with verbatim text enforcement)
 * - Stage 4: Voice Synthesis (Own Key / Platform Credits -> Workers AI TTS fallback, strictly MP3, zero WAV)
 * - Stage 5: Music & Sound Effects (ElevenLabs Music/SFX -> CC0 manifest fallback)
 * - Shared R2 Cache: Zero paid AI calls on cache hit; automatic purge of any legacy .wav objects
 */

import express from "express";
import fs from "fs";
import path from "path";
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { GoogleGenAI } from "@google/genai";
import { BROADCAST_CONFIG, FREE_MODELS, getModels } from "../lib/broadcastConfig";
import {
  BroadcastJobRecord,
  CharacterBible,
  DirectorCharacter,
  DirectorEvent,
  DirectorScript,
  ExtractionResult,
  VisionResult,
} from "../lib/broadcastTypes";
import { toPlainText } from "../lib/cleanPlainText";
import {
  isTableOfContentsOrFrontMatter,
  stripTableOfContentsAndFrontMatter,
} from "../lib/broadcastExtractor";
import {
  detectLanguage,
  isLanguageSupportedFree,
  resolveFreeTtsModel,
  extractVerbatimTtsText,
  getOrAssignFreeSpeaker,
  normalizeAndSniffAudio,
  ALL_SUPPORTED_LANGUAGES,
  SniffedAudioResult,
  getUnsupportedFreeTtsFeedbackMessage,
} from "../lib/broadcastTtsRouting";
import { reserveJobFunds, settleJobFunds, getOrCreateWallet } from "./serverBilling";
import { getUserDecryptedKey, getUserAiSettingsSummary } from "./serverAiSettings";

// In-memory active jobs map (synced with R2)
const activeJobs = new Map<string, BroadcastJobRecord>();

// Preloaded CC0 Manifest cache
let cc0ManifestCache: { bgm: any[]; sfx: any[] } | null = null;

function loadCc0Manifest(): { bgm: any[]; sfx: any[] } {
  if (cc0ManifestCache) return cc0ManifestCache;
  try {
    const manifestPath = path.join(process.cwd(), "public", "Audio", "manifest.json");
    if (fs.existsSync(manifestPath)) {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      cc0ManifestCache = JSON.parse(raw);
      return cc0ManifestCache!;
    }
  } catch (e) {
    console.warn("[Broadcast] Could not read CC0 Audio manifest:", e);
  }
  return { bgm: [], sfx: [] };
}

export function getCloudflareGatewayUrl(
  provider: "anthropic" | "elevenlabs" | "openai" | "google-ai-studio",
  subpath: string
): { url: string; usingGateway: boolean; gatewayName: string } {
  const accountId =
    process.env.CLOUDFLARE_ACCOUNT_ID ||
    process.env.CF_ACCOUNT_ID ||
    process.env.R2_ACCOUNT_ID ||
    "fa7ead1c0aaa1e931de55eb01c384876";
  const cleanSubpath = subpath.startsWith("/") ? subpath : `/${subpath}`;

  let gatewayName = "";
  if (provider === "anthropic") {
    gatewayName = process.env.CF_GATEWAY_CODECRAFTAI || BROADCAST_CONFIG.GATEWAYS.ANTHROPIC;
  } else if (provider === "elevenlabs") {
    gatewayName = process.env.CF_GATEWAY_ELEVENLABS || BROADCAST_CONFIG.GATEWAYS.ELEVENLABS;
  } else if (provider === "openai") {
    gatewayName = process.env.CF_GATEWAY_OPENAI || BROADCAST_CONFIG.GATEWAYS.OPENAI;
  } else if (provider === "google-ai-studio") {
    gatewayName = process.env.CF_GATEWAY_GOOGLE_AI_STUDIO || BROADCAST_CONFIG.GATEWAYS.GOOGLE_AI_STUDIO;
  }

  return {
    url: `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayName}/${provider}${cleanSubpath}`,
    usingGateway: true,
    gatewayName,
  };
}

/**
 * Resolves the user's AI configuration, inputted API keys, and whether to use
 * Own Key, Platform Credits, or fallback to Cloudflare Workers AI.
 *
 * Core Rule:
 * If not any API key is inputted AND not choosing platform credits (or wallet balance is 0),
 * automatically fallback to using Workers AI to generate the audio drama.
 */
export interface BroadcastExecutionPlan {
  userId: string;
  mainMode: "platform_credits" | "own_key";
  choosingPlatformCredits: boolean;
  hasSufficientPlatformCredits: boolean;
  hasAnyApiKey: boolean;
  useWorkersAiFallback: boolean;
  isPaidPlatformRun: boolean;
  keys: {
    google: string | null;
    openai: string | null;
    anthropic: string | null;
    elevenlabs: string | null;
    cartesia: string | null;
    qwen: string | null;
    cloudflare: string | null;
  };
  stageMode: {
    vision_analyst: "platform_credits" | "own_key" | "workers_ai";
    director: "platform_credits" | "own_key" | "workers_ai";
    tts: "platform_credits" | "own_key" | "workers_ai";
    music: "platform_credits" | "own_key" | "workers_ai";
    sfx: "platform_credits" | "own_key" | "workers_ai";
  };
}

export function resolveBroadcastExecutionPlan(
  req: express.Request,
  costEstimate: number = 0
): BroadcastExecutionPlan {
  const body = req.body || {};
  const userId =
    body.user_id ||
    (req.headers["x-user-id"] as string) ||
    body.email ||
    "authenticated_user";

  const serverSummary = getUserAiSettingsSummary(userId);
  const clientFeatureSettings = body.ai_feature_settings || {};
  const mergedSettings: Record<string, any> = {
    ...serverSummary.featureSettings,
    ...clientFeatureSettings,
  };

  // Determine main mode from explicit request body or saved server preference
  let mainMode: "platform_credits" | "own_key" = serverSummary.mainMode;
  if (body.ai_main_mode === "own_key" || body.mode === "own_key") {
    mainMode = "own_key";
  } else if (body.ai_main_mode === "platform_credits" || body.mode === "platform_credits") {
    mainMode = "platform_credits";
  }

  const clientKeys = body.client_keys || {};
  const cleanKey = (val: any): string | null =>
    typeof val === "string" && val.trim().length > 3 ? val.trim() : null;

  const keys = {
    google:
      getUserDecryptedKey(userId, "google") ||
      cleanKey(clientKeys.google) ||
      null,
    openai:
      getUserDecryptedKey(userId, "openai") ||
      cleanKey(clientKeys.openai) ||
      null,
    anthropic:
      getUserDecryptedKey(userId, "anthropic") ||
      cleanKey(clientKeys.anthropic) ||
      null,
    elevenlabs:
      getUserDecryptedKey(userId, "elevenlabs") ||
      cleanKey(clientKeys.elevenlabs) ||
      null,
    cartesia:
      getUserDecryptedKey(userId, "cartesia") ||
      cleanKey(clientKeys.cartesia) ||
      null,
    qwen:
      getUserDecryptedKey(userId, "qwen") ||
      cleanKey(clientKeys.qwen) ||
      null,
    cloudflare:
      getUserDecryptedKey(userId, "cloudflare") ||
      getUserDecryptedKey(userId, "workers_ai") ||
      cleanKey(clientKeys.cloudflare) ||
      cleanKey(process.env.CLOUDFLARE_API_TOKEN) ||
      cleanKey(process.env.CF_API_TOKEN) ||
      null,
  };

  const hasAnyApiKey = Boolean(
    keys.google ||
      keys.openai ||
      keys.anthropic ||
      keys.elevenlabs ||
      keys.cartesia ||
      keys.qwen
  );

  // Check if user is choosing platform credits
  const explicitPlatformCredits =
    body.use_platform_credits !== undefined
      ? Boolean(body.use_platform_credits)
      : mainMode === "platform_credits" &&
        mergedSettings.director?.mode !== "own_key" &&
        mergedSettings.tts?.mode !== "own_key";

  const wallet = getOrCreateWallet(userId, body.email || "");
  const hasSufficientPlatformCredits =
    wallet.balanceUsd > 0 && wallet.balanceUsd >= Math.max(0.01, costEstimate);

  const isPaidPlatformRun = explicitPlatformCredits && hasSufficientPlatformCredits;

  // Resolve per-stage execution mode:
  // If a stage is not using paid platform credits and has no matching API key inputted (or own_key is not active),
  // it falls back to Workers AI!
  const hasVisionKey = Boolean(keys.google || keys.openai || keys.anthropic || keys.qwen);
  const hasDirectorKey = Boolean(keys.google || keys.anthropic || keys.openai || keys.qwen);
  const hasTtsKey = Boolean(keys.elevenlabs || keys.openai);
  const hasMusicKey = Boolean(keys.elevenlabs);
  const hasSfxKey = Boolean(keys.elevenlabs);

  const resolveStage = (
    secKey: string,
    hasKeyForStage: boolean
  ): "platform_credits" | "own_key" | "workers_ai" => {
    const secMode = mergedSettings[secKey]?.mode || mainMode;
    if (secMode === "platform_credits" && isPaidPlatformRun) {
      return "platform_credits";
    }
    if (secMode === "own_key" && hasKeyForStage) {
      return "own_key";
    }
    return "workers_ai";
  };

  const stageMode = {
    vision_analyst: resolveStage("vision_analyst", hasVisionKey),
    director: resolveStage("director", hasDirectorKey),
    tts: resolveStage("tts", hasTtsKey),
    music: resolveStage("music", hasMusicKey),
    sfx: resolveStage("sfx", hasSfxKey),
  };

  const useWorkersAiFallback =
    !isPaidPlatformRun &&
    (stageMode.director === "workers_ai" || stageMode.tts === "workers_ai");

  return {
    userId,
    mainMode,
    choosingPlatformCredits: explicitPlatformCredits,
    hasSufficientPlatformCredits,
    hasAnyApiKey,
    useWorkersAiFallback,
    isPaidPlatformRun,
    keys,
    stageMode,
  };
}

/**
 * Helper to call Cloudflare Workers AI for LLM/Vision tasks:
 * 1. Direct Cloudflare REST API if cfToken is available
 * 2. Production Cloudflare Worker endpoint (https://ebookcc.com/api/ai/chat) which has native env.AI binding
 */
async function runWorkersAiTextModel(
  systemPrompt: string,
  userPrompt: string,
  cfToken?: string | null,
  customCandidateModels?: string[]
): Promise<string | null> {
  const cfAccount =
    process.env.CLOUDFLARE_ACCOUNT_ID ||
    process.env.CF_ACCOUNT_ID ||
    process.env.R2_ACCOUNT_ID ||
    "fa7ead1c0aaa1e931de55eb01c384876";

  const candidateModels =
    customCandidateModels && customCandidateModels.length > 0
      ? customCandidateModels
      : [
          FREE_MODELS.director,
          FREE_MODELS.director_alt,
        ];

  // 1. Try direct Cloudflare API if token is provided
  if (cfToken) {
    for (const model of candidateModels) {
      if (!model) continue;
      try {
        const res = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/run/${model}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${cfToken}`,
            },
            body: JSON.stringify({
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              max_tokens: 2048,
            }),
            signal: AbortSignal.timeout(18000),
          }
        );
        if (res.ok) {
          const cfData: any = await res.json();
          const rawText = cfData.result?.response || cfData.result?.text || "";
          if (rawText && rawText.trim()) return rawText.trim();
        }
      } catch (_) {}
    }
  }

  // 2. Fallback to live Cloudflare Worker endpoint (https://ebookcc.com/api/ai/chat) bound to env.AI
  try {
    const workerRes = await fetch("https://ebookcc.com/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: systemPrompt,
        prompt: userPrompt,
        max_tokens: 1024,
        models: candidateModels,
      }),
      signal: AbortSignal.timeout(18000),
    });
    if (workerRes.ok) {
      const data: any = await workerRes.json();
      const text = data.text || data.response || data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (text && text.trim()) return text.trim();
    }
  } catch (e: any) {
    console.info("[Workers AI Worker Bridge Notice]:", e.message);
  }

  return null;
}

function extractJsonObject(rawText: string): any | null {
  if (!rawText) return null;
  try {
    let cleaned = rawText.trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    } else {
      cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    }
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
    return JSON.parse(cleaned);
  } catch (_) {
    return null;
  }
}

/**
 * Stage 3 Script Director using Claude or OpenAI with user key or gateway
 */
async function callClaudeDirector(
  systemPrompt: string,
  userPrompt: string,
  anthropicKey?: string | null
): Promise<DirectorScript | null> {
  try {
    const url = anthropicKey
      ? "https://api.anthropic.com/v1/messages"
      : getCloudflareGatewayUrl("anthropic", "/v1/messages").url;

    const headers: Record<string, string> = {
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    };
    if (anthropicKey) {
      headers["x-api-key"] = anthropicKey;
    }

    const res = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(BROADCAST_CONFIG.TIMEOUTS.DIRECTOR_TIMEOUT_MS),
      headers,
      body: JSON.stringify({
        model: BROADCAST_CONFIG.DIRECTOR_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (res.ok) {
      const data: any = await res.json();
      const rawText = data.content?.[0]?.text || "";
      const parsed = extractJsonObject(rawText);
      if (parsed && parsed.characters && parsed.scenes && parsed.scenes.length > 0) {
        return parsed as DirectorScript;
      }
    }
  } catch (err: any) {
    console.info("[Broadcast Director] Claude call notice, falling back:", err.message);
  }
  return null;
}

async function callOpenAiDirector(
  systemPrompt: string,
  userPrompt: string,
  openAiKey?: string | null
): Promise<DirectorScript | null> {
  if (!openAiKey) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(BROADCAST_CONFIG.TIMEOUTS.DIRECTOR_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (res.ok) {
      const data: any = await res.json();
      const rawText = data.choices?.[0]?.message?.content || "";
      const parsed = extractJsonObject(rawText);
      if (parsed && parsed.characters && parsed.scenes && parsed.scenes.length > 0) {
        return parsed as DirectorScript;
      }
    }
  } catch (err: any) {
    console.info("[Broadcast Director] OpenAI call notice, falling back:", err.message);
  }
  return null;
}

/**
 * Workers AI Script Director:
 * Uses Cloudflare Workers AI to cast characters, design voices, and set scene mood & BGM,
 * while guaranteeing 100% verbatim event preservation without token truncation.
 */
async function callWorkersAIDirector(
  extraction: ExtractionResult,
  cleanChapterText: string,
  detectedLang: string,
  cfToken?: string | null
): Promise<DirectorScript> {
  const isEnglish = detectedLang.startsWith("en");
  const baseScript =
    extraction.bookType === "novel"
      ? buildDirectorScriptFromText(extraction, cleanChapterText, detectedLang)
      : directComicPages(extraction, null, null, null, detectedLang);

  // Ask Workers AI for compact casting & scene direction metadata (fits easily in <400 tokens)
  const excerpt =
    extraction.bookType === "novel"
      ? cleanChapterText.slice(0, 1500)
      : JSON.stringify((extraction.pages || []).slice(0, 4)).slice(0, 1500);

  const castingSystemPrompt = `You are an Audio Drama Director. Analyze the story excerpt and output ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "setting": "short vivid setting description",
  "mood": "calm | tense | mystery | action | dramatic",
  "scene_summary": "one sentence summary",
  "bgm_prompt": "instrumental music cue description",
  "characters": [
    { "id": "narrator", "name": "Narrator", "gender": "neutral", "age_group": "adult", "personality": "articulate", "voice_design": "${
      isEnglish
        ? "Refined British RP narrator voice, articulate, warm and resonant"
        : "Articulate, warm and resonant native narrator voice"
    }" },
    { "id": "c1", "name": "Character Name", "gender": "male or female", "age_group": "teen or adult", "personality": "two words", "voice_design": "short vocal timbre description" }
  ]
}`;

  const castingUserPrompt = `Book Title: ${extraction.title || "Story"}\nLanguage: ${detectedLang}\nExcerpt:\n${excerpt}`;

  // Director fallback models: @cf/nvidia/nemotron-3-120b-a12b, fallback to @cf/deepseek-ai/deepseek-v4.1-flash-1017
  const aiRaw = await runWorkersAiTextModel(
    castingSystemPrompt,
    castingUserPrompt,
    cfToken,
    [FREE_MODELS.director, FREE_MODELS.director_alt]
  );
  const parsed = aiRaw ? extractJsonObject(aiRaw) : null;

  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.characters) && parsed.characters.length > 0) {
      const validChars: DirectorCharacter[] = parsed.characters
        .filter((c: any) => c && typeof c === "object" && (c.id || c.name))
        .map((c: any, idx: number) => ({
          id: c.id || (idx === 0 ? "narrator" : `c${idx}`),
          name: c.name || (idx === 0 ? "Narrator" : `Character ${idx}`),
          gender: c.gender || "neutral",
          age_group: c.age_group || "adult",
          personality: c.personality || "expressive",
          voice_design:
            c.voice_design ||
            (idx === 0 && isEnglish
              ? BROADCAST_CONFIG.VOICE_DEFAULTS.DEFAULT_NARRATOR_VOICE_DESIGN
              : "Warm, expressive natural voice"),
        }));
      if (!validChars.some((c) => c.id === "narrator")) {
        validChars.unshift(baseScript.characters[0]);
      }
      if (!validChars.some((c) => c.id === "c1") && baseScript.characters[1]) {
        validChars.push(baseScript.characters[1]);
      }
      baseScript.characters = validChars;
    }

    if (baseScript.scenes[0]) {
      if (typeof parsed.setting === "string" && parsed.setting.trim()) {
        baseScript.scenes[0].setting = parsed.setting.trim();
      }
      if (typeof parsed.mood === "string" && parsed.mood.trim()) {
        baseScript.scenes[0].mood = parsed.mood.trim();
      }
      if (typeof parsed.scene_summary === "string" && parsed.scene_summary.trim()) {
        baseScript.scenes[0].scene_summary = parsed.scene_summary.trim();
      }
      if (typeof parsed.bgm_prompt === "string" && parsed.bgm_prompt.trim()) {
        baseScript.scenes[0].bgm_prompt = parsed.bgm_prompt.trim();
      }
    }
  }

  return baseScript;
}

/**
 * Splits long text into natural sentence chunks <= maxLen characters for TTS synthesis
 */
function splitTextIntoTtsChunks(text: string, maxLen = 180): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];

  const sentences = clean.match(/[^.!?。！？；;]+[.!?。！？；;]*\s*/g) || [clean];
  const chunks: string[] = [];
  let current = "";

  for (const s of sentences) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    if ((current + " " + trimmed).trim().length <= maxLen) {
      current = (current + " " + trimmed).trim();
    } else {
      if (current) chunks.push(current);
      if (trimmed.length <= maxLen) {
        current = trimmed;
      } else {
        // Split further on commas or words
        const words = trimmed.split(/\s+/);
        current = "";
        for (const w of words) {
          if ((current + " " + w).trim().length <= maxLen) {
            current = (current + " " + w).trim();
          } else {
            if (current) chunks.push(current);
            current = w.slice(0, maxLen);
          }
        }
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Clean spoken MP3 synthesizer fallback when running outside Cloudflare Worker native binding
 * without CLOUDFLARE_API_TOKEN. Strictly returns real spoken MP3 (audio/mpeg), NEVER WAV.
 */
async function synthesizeSpokenMp3Fallback(
  verbatimText: string,
  lang: string,
  isNarrator: boolean
): Promise<Buffer | null> {
  const chunks = splitTextIntoTtsChunks(verbatimText, 180);
  if (chunks.length === 0) return null;

  // Requirement 8: ONLY English uses British RP accent (en-GB); non-English uses native locale
  const normLang = (lang || "en").toLowerCase().split(/[-_]/)[0];
  let tl = normLang;
  if (normLang === "en") {
    tl = isNarrator ? "en-GB" : "en-US";
  } else if (normLang === "zh") {
    tl = "zh-CN";
  }

  const mp3Buffers: Buffer[] = [];
  for (const chunk of chunks) {
    const encoded = encodeURIComponent(chunk);
    const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&q=${encoded}&tl=${encodeURIComponent(
      tl
    )}&client=tw-ob`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new Error(`TTS MP3 stream returned HTTP ${res.status}`);
    }
    const ab = await res.arrayBuffer();
    if (ab.byteLength > 32) {
      mp3Buffers.push(Buffer.from(ab));
    }
  }

  if (mp3Buffers.length === 0) return null;
  return Buffer.concat(mp3Buffers);
}

/**
 * Workers AI TTS Synthesizer:
 * 1. Language routing:
 *    - English: @cf/deepgram/aura-2-en, fallback to @cf/inworld/tts-1.5-max
 *    - Spanish: @cf/deepgram/aura-2-es
 *    - Other languages: NOT provided free of charge (gives feedback to input API key or choose platform credits)
 * 2. Explicit audio format: encoding: "mp3" for Deepgram, output_format: "mp3" for Inworld.
 * 3. Normalize output & sniff magic bytes (strictly MP3/OGG/FLAC; NEVER generates synthetic WAV).
 * 4. Send TTS only the verbatim event.text.
 * 6. Map each character to distinct built-in speaker and store in character bible.
 * 8. ONLY English uses British RP accent!
 */
async function synthesizeWorkersAiTts(
  rawText: string,
  character: string = "narrator",
  declaredLanguage?: string,
  characterBible?: CharacterBible,
  cfTokenOverride?: string | null
): Promise<SniffedAudioResult> {
  const lang = detectLanguage(rawText, declaredLanguage);
  if (!isLanguageSupportedFree(lang)) {
    throw new Error(getUnsupportedFreeTtsFeedbackMessage(lang));
  }

  const routing = resolveFreeTtsModel(lang);
  if (!routing) {
    throw new Error(getUnsupportedFreeTtsFeedbackMessage(lang));
  }

  const verbatimText = extractVerbatimTtsText(rawText);
  if (!verbatimText) {
    throw new Error("No verbatim text to synthesize.");
  }

  const cfToken =
    cfTokenOverride || process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
  const cfAccount =
    process.env.CLOUDFLARE_ACCOUNT_ID ||
    process.env.CF_ACCOUNT_ID ||
    process.env.R2_ACCOUNT_ID ||
    "fa7ead1c0aaa1e931de55eb01c384876";

  // Build candidate TTS model runs in priority order:
  // English: [@cf/deepgram/aura-2-en, @cf/inworld/tts-1.5-max]
  // Spanish: [@cf/deepgram/aura-2-es]
  const modelAttempts: Array<{
    model: string;
    provider: "deepgram" | "deepgram_es" | "inworld";
    speaker: string;
    payload: any;
  }> = [];

  const primarySpeaker = getOrAssignFreeSpeaker(
    character,
    characterBible?.characters?.[character],
    routing.provider,
    lang,
    characterBible
  );

  if (routing.provider === "deepgram" || routing.provider === "deepgram_es") {
    modelAttempts.push({
      model: routing.model,
      provider: routing.provider,
      speaker: primarySpeaker,
      payload: {
        text: verbatimText,
        encoding: "mp3",
        speaker: primarySpeaker,
      },
    });
  } else {
    modelAttempts.push({
      model: routing.model,
      provider: "inworld",
      speaker: primarySpeaker,
      payload: {
        text: verbatimText,
        voice_id: primarySpeaker,
        output_format: "mp3",
      },
    });
  }

  if (routing.fallbackModel && routing.fallbackProvider === "inworld") {
    const fallbackSpeaker = getOrAssignFreeSpeaker(
      character,
      characterBible?.characters?.[character],
      "inworld",
      lang,
      characterBible
    );
    modelAttempts.push({
      model: routing.fallbackModel,
      provider: "inworld",
      speaker: fallbackSpeaker,
      payload: {
        text: verbatimText,
        voice_id: fallbackSpeaker,
        output_format: "mp3",
      },
    });
  }

  let rawAudioData: any = null;

  // 1. Try direct Cloudflare Workers AI REST API if token is available
  if (cfToken) {
    for (const attempt of modelAttempts) {
      if (rawAudioData) break;
      const endpoints = [
        `https://gateway.ai.cloudflare.com/v1/${cfAccount}/ebookcc-gateway_codecraftai_default/workers-ai/run/${attempt.model}`,
        `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/run/${attempt.model}`,
      ];

      for (const endpoint of endpoints) {
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            signal: AbortSignal.timeout(15000),
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${cfToken}`,
            },
            body: JSON.stringify(attempt.payload),
          });

          if (res.ok) {
            const contentType = res.headers.get("content-type") || "";
            if (contentType.includes("json")) {
              rawAudioData = await res.json();
            } else {
              rawAudioData = await res.arrayBuffer();
            }
            break;
          }
        } catch (_) {}
      }
    }
  }

  // 2. Try Cloudflare Worker native env.AI endpoint on ebookcc.com
  if (!rawAudioData) {
    try {
      const workerTtsRes = await fetch("https://ebookcc.com/api/broadcast/tts", {
        method: "POST",
        signal: AbortSignal.timeout(12000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: verbatimText,
          character,
          language: lang,
          is_paid: false,
          character_bible: characterBible,
        }),
      });
      if (workerTtsRes.ok) {
        const ct = workerTtsRes.headers.get("content-type") || "";
        if (ct.includes("audio/")) {
          rawAudioData = await workerTtsRes.arrayBuffer();
        }
      }
    } catch (_) {}
  }

  // 3. If running in preview container without direct Workers AI binding, synthesize clean spoken MP3 (never WAV)
  if (!rawAudioData) {
    const isNarrator = character === "narrator" || !character;
    const mp3Buf = await synthesizeSpokenMp3Fallback(verbatimText, lang, isNarrator);
    if (mp3Buf) {
      rawAudioData = mp3Buf;
    }
  }

  if (!rawAudioData) {
    throw new Error("Workers AI TTS returned no audio data.");
  }

  const sniffed = await normalizeAndSniffAudio(rawAudioData);
  return sniffed;
}

const VISION_SYSTEM_PROMPT = `You are the Vision Analyst for an audio-drama production pipeline. You receive up to 15 consecutive comic/manga/illustrated-book pages as images, plus the OCR text for each page (grouped by panel when available), plus basic book metadata. Your job is to describe what is visible so that a script director can later cast voices and design the soundscape. You do NOT write the script.

RULES
1. Output ONLY one valid JSON object that matches the schema below. No markdown fences, no commentary.
2. The OCR text is the source of truth for wording. Never invent, paraphrase or translate dialogue. If you believe an OCR line is wrong, keep the original in "text" and put your suggested correction in "ocr_correction".
3. Describe only what is visible. Do not guess identities, names or plot that neither the images nor the text support. When unsure, use null or lower the confidence value.
4. Track characters across pages. Assign stable ids (c1, c2, ...) based on appearance (hair, clothing, species, build, distinctive features). If a name appears in text, attach it; otherwise leave "name" null and describe them.
5. For every panel, determine the reading order (respect right-to-left for manga when the book metadata says so or when the layout makes it obvious) and attribute each speech balloon, thought bubble, caption, and sound-effect lettering to a speaker (character id, "narrator", or "unknown") using the balloon tail direction and context.
6. Capture performance cues useful for acting: facial expression, body language, volume (whisper/normal/shout inferred from balloon border, font size, exclamation marks), emotional state (fear, rage, mischief, sorrow, romantic tension...), and physical state (out of breath, crying, eating...).
7. Extract sound effects: onomatopoeia written in art, explosions, rain, footsteps, doors, engine noises. Describe the implied real-world sound, not the spelling.
8. Extract setting and mood per panel/scene: location, time of day, weather, lighting, acoustic space, and tension level (0.0 to 1.0).

JSON OUTPUT SCHEMA:
{
  "characters": [
    { "id": "c1", "name": "string or null", "appearance": "hair, clothing, build (max 25 words)", "gender": "male/female/other/null", "age_group": "child/teen/adult/elder/null" }
  ],
  "pages": [
    {
      "page_index": 0,
      "panels": [
        {
          "panel_index": 0,
          "environment": "description",
          "characters_present": ["c1"],
          "balloons": [
            { "speaker": "c1", "text": "verbatim OCR text", "ocr_correction": null, "volume": "normal", "emotion": "surprised" }
          ],
          "sound_effects": [
            { "lettering": "BAM", "implied_sound": "heavy wooden door slamming" }
          ]
        }
      ]
    }
  ]
}`;

const DIRECTOR_SYSTEM_PROMPT = `You are the Audio Drama Director. You take the source text (chapter text for novels, or panel-attributed OCR text plus vision analysis for comics), the book metadata, and the character bible carried over from previous chapters.
Your job is to produce a DirectorScript JSON: a sequence of scenes and events (dialogue, narration, sfx) ready for voice acting and audio mixing.

CRITICAL RULES:
1. Output ONLY a valid JSON object matching the DirectorScript schema. No markdown fences, no conversational text.
2. VERBATIM RULE: Every word of narration and dialogue in the source text must appear in the events in exact order. You must NEVER add, remove, rewrite, summarize, or alter the original words. Splitting long sentences into multiple events is permitted; changing words is strictly forbidden.
3. CASTING & VOICES: Assign every speaking line to a character (or 'narrator'). Maintain persistent character IDs (c1, c2, ...).
   - NARRATOR VOICE: For English works ONLY, the default narrator voice MUST be a British RP (Received Pronunciation) accent with articulate, warm diction, resonant timbre, and measured cinematic pacing (e.g., "Refined British RP narrator voice, articulate, warm and resonant with steady cinematic pacing"). For non-English works, use an articulate, warm and resonant native narrator voice (never British RP).
   - For each character, provide:
     - name, gender, age_group, personality
     - voice_design: ONE vivid English sentence describing their vocal timbre, pitch, texture, and accent (e.g., "Gravelly middle-aged baritone with a weary cynical drawl").
4. DELIVERY: For each event, supply:
   - emotion (neutral, happy, sad, angry, fearful, surprised, whisper, excited, etc.)
   - intensity (0.0 to 1.0)
   - delivery: short physical acting direction (e.g., "gasping between words", "stifling laughter", "coldly detached")
   - pause_after_ms: natural silence following the line (200-800ms)
5. SOUNDSCAPE & MUSIC:
   - For each scene: setting, mood, scene_summary, bgm_prompt (instrumental music cue, e.g., "Slow minor-key cello and acoustic piano for a solemn reunion", loopable: true).
   - For sfx: sfx_prompt (e.g., "heavy wooden door slamming shut in stone corridor"), sfx_duration_sec, sfx_offset_ms.

JSON OUTPUT SCHEMA:
{
  "characters": [
    { "id": "c1", "name": "Hero", "gender": "male", "age_group": "teen", "personality": "brave and impulsive", "voice_design": "Warm energetic youthful tenor with determined cadence" }
  ],
  "scenes": [
    {
      "id": "s1",
      "setting": "Castle Courtyard at Dusk",
      "mood": "tense",
      "scene_summary": "The party confronts the royal guard outside the gate.",
      "bgm_prompt": "Urgent cinematic strings with distant war drums",
      "bgm_loop": true,
      "events": [
        { "id": "e1", "type": "narration", "character": "narrator", "text": "The iron portcullis slammed down with a deafening clang.", "emotion": "tense", "pause_after_ms": 400 },
        { "id": "e2", "type": "sfx", "character": "narrator", "text": null, "sfx_prompt": "heavy iron portcullis crashing down against stone pavement", "sfx_duration_sec": 1.8 },
        { "id": "e3", "type": "dialogue", "character": "c1", "text": "There's no going back now!", "emotion": "shout", "intensity": 0.9, "delivery": "shouting above the rumble, teeth gritted", "pause_after_ms": 350 }
      ]
    }
  ]
}`;

export interface BroadcastServerDependencies {
  getAIClient: (customKey?: string) => any;
  getR2ClientAndBucket: (req?: express.Request, customBucket?: string) => {
    s3: any;
    bucket: string;
    endpoint: string;
    isConfigured: boolean;
  };
  safeS3Send: (s3: any, command: any, timeoutMs?: number) => Promise<any>;
}

/**
 * Checks if a cached DirectorScript contains any legacy .wav URLs
 * or has speaking events with zero generated audio_url files.
 */
function scriptHasLegacyWavUrls(script: DirectorScript | null | undefined): boolean {
  if (!script || !Array.isArray(script.scenes)) return false;
  let speakingCount = 0;
  let voicedCount = 0;
  const speakingTexts: string[] = [];
  for (const sc of script.scenes) {
    for (const ev of sc.events || []) {
      if (typeof ev.audio_url === "string" && ev.audio_url.toLowerCase().endsWith(".wav")) {
        return true;
      }
      if ((ev.type === "dialogue" || ev.type === "narration") && ev.text && String(ev.text).trim()) {
        speakingCount++;
        speakingTexts.push(String(ev.text).trim());
        if (typeof ev.audio_url === "string" && ev.audio_url.trim().length > 0) {
          voicedCount++;
        }
      }
    }
  }
  if (speakingCount > 0 && voicedCount === 0) {
    return true;
  }
  // Invalidate previously cached 1-line synthetic stub scripts ("... The narrative begins.")
  if (speakingCount === 1 && speakingTexts[0]?.endsWith("The narrative begins.")) {
    return true;
  }
  // Invalidate any cached script whose content is a Table of Contents or front matter
  if (speakingTexts.length > 0 && isTableOfContentsOrFrontMatter(speakingTexts.join("\n"))) {
    return true;
  }
  return false;
}

export function setupBroadcastRoutes(
  app: express.Express,
  deps: {
    getAIClient: (customKey?: string) => any;
    getR2ClientAndBucket: (req?: express.Request, customBucket?: string) => {
      s3: any;
      bucket: string;
      endpoint: string;
      isConfigured: boolean;
    };
    safeS3Send: (s3: any, command: any, timeoutMs?: number) => Promise<any>;
  }
) {
  const { getAIClient, getR2ClientAndBucket, safeS3Send } = deps;

  // Local storage cache path
  const BROADCAST_CACHE_DIR = path.join("/tmp", "ebookcc-media", "broadcast");
  fs.mkdirSync(BROADCAST_CACHE_DIR, { recursive: true });

  /**
   * Purge any .wav files and poisoned/unvoiced broadcast scripts from R2 bucket and local cache
   */
  async function purgeWavFilesFromR2AndLocal(req?: express.Request): Promise<number> {
    let deletedCount = 0;

    // 1. Clean local /tmp/ebookcc-media/broadcast of any .wav files or scripts referencing .wav / 0 audio URLs
    try {
      const walkAndClean = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkAndClean(fullPath);
          } else if (entry.name.toLowerCase().endsWith(".wav")) {
            fs.unlinkSync(fullPath);
            deletedCount++;
          } else if (entry.name === "script.json") {
            try {
              const parsed = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
              if (scriptHasLegacyWavUrls(parsed)) {
                fs.unlinkSync(fullPath);
                deletedCount++;
              }
            } catch (_) {}
          }
        }
      };
      walkAndClean(BROADCAST_CACHE_DIR);
    } catch (_) {}

    // 2. Clean remote R2 bucket of any .wav files and known unvoiced scripts
    const { s3, bucket, isConfigured } = getR2ClientAndBucket(req);
    if (isConfigured && s3) {
      try {
        let continuationToken: string | undefined = undefined;
        const keysToDelete = new Set<string>([
          "broadcast/broadcast_e2fbd6fdd1b8dceaac40944008f8e0f2/script.json",
        ]);
        const taintedPrefixes = new Set<string>();

        do {
          const listRes = await safeS3Send(
            s3,
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: "broadcast/",
              ContinuationToken: continuationToken,
            }),
            15000
          );
          for (const obj of listRes?.Contents || []) {
            const key = obj.Key || "";
            if (key.toLowerCase().endsWith(".wav")) {
              keysToDelete.add(key);
              const parts = key.split("/");
              if (parts.length >= 2) {
                taintedPrefixes.add(`${parts[0]}/${parts[1]}/script.json`);
              }
            }
          }
          continuationToken = listRes?.NextContinuationToken;
        } while (continuationToken);

        taintedPrefixes.forEach((k) => keysToDelete.add(k));
        const allKeys = Array.from(keysToDelete);

        for (let i = 0; i < allKeys.length; i += 100) {
          const batch = allKeys.slice(i, i + 100);
          await safeS3Send(
            s3,
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: batch.map((Key) => ({ Key })) },
            }),
            15000
          );
          deletedCount += batch.length;
        }
        if (allKeys.length > 0) {
          console.log(`[Broadcast R2 Cleanup] Purged ${allKeys.length} legacy/invalid objects from R2 bucket "${bucket}".`);
        }
      } catch (err: any) {
        console.warn("[Broadcast R2 Cleanup] Notice:", err.message);
      }
    }

    return deletedCount;
  }

  // Run automatic R2 .wav cleanup on server startup
  setTimeout(() => {
    purgeWavFilesFromR2AndLocal().catch(() => {});
  }, 1500);

  // Route: Purge .wav files on demand
  app.all("/api/broadcast/purge-wav", async (req, res): Promise<any> => {
    const count = await purgeWavFilesFromR2AndLocal(req);
    return res.json({ success: true, deleted_count: count });
  });

  // ─────────────────────────────────────────────
  // 1. R2 Shared Cache Helpers
  // ─────────────────────────────────────────────

  async function getCachedScriptFromR2(req: express.Request, cacheKey: string): Promise<DirectorScript | null> {
    const { s3, bucket, isConfigured } = getR2ClientAndBucket(req);
    const scriptKey = `broadcast/${cacheKey}/script.json`;

    // 1. Check local tmp directory first
    const localPath = path.join(BROADCAST_CACHE_DIR, cacheKey, "script.json");
    if (fs.existsSync(localPath)) {
      try {
        const raw = fs.readFileSync(localPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (scriptHasLegacyWavUrls(parsed)) {
          fs.rmSync(path.join(BROADCAST_CACHE_DIR, cacheKey), { recursive: true, force: true });
        } else {
          return parsed;
        }
      } catch (_) {}
    }

    // 2. Check remote R2
    if (isConfigured && s3) {
      try {
        const data = await safeS3Send(
          s3,
          new GetObjectCommand({ Bucket: bucket, Key: scriptKey }),
          8000
        );
        if (data && data.Body) {
          const raw = await data.Body.transformToString("utf-8");
          const parsed = JSON.parse(raw);
          if (scriptHasLegacyWavUrls(parsed)) {
            console.log(`[Broadcast Cache] Invalidating legacy/unvoiced script in R2 for key: ${cacheKey}`);
            await safeS3Send(
              s3,
              new DeleteObjectCommand({ Bucket: bucket, Key: scriptKey }),
              8000
            ).catch(() => {});
            return null;
          }
          fs.mkdirSync(path.dirname(localPath), { recursive: true });
          fs.writeFileSync(localPath, raw, "utf-8");
          return parsed;
        }
      } catch (_) {
        // Cache miss
      }
    }
    return null;
  }

  async function saveScriptToR2(
    req: express.Request,
    cacheKey: string,
    script: DirectorScript,
    shouldUploadToR2: boolean = false
  ) {
    const { s3, bucket, isConfigured } = getR2ClientAndBucket(req);
    const scriptKey = `broadcast/${cacheKey}/script.json`;
    const jsonStr = JSON.stringify(script, null, 2);

    // Always save locally
    const localPath = path.join(BROADCAST_CACHE_DIR, cacheKey, "script.json");
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, jsonStr, "utf-8");

    // Only upload to R2 when generated by the Platform Credits plan
    if (!shouldUploadToR2) {
      console.log(`[Broadcast Cache] Saved script locally (non-platform-credits plan, skipped R2 upload): ${cacheKey}`);
      return;
    }

    if (isConfigured && s3) {
      try {
        await safeS3Send(
          s3,
          new PutObjectCommand({
            Bucket: bucket,
            Key: scriptKey,
            Body: Buffer.from(jsonStr, "utf-8"),
            ContentType: "application/json",
          }),
          20000
        );
        console.log(`[Broadcast Cache] Successfully persisted Platform Credits script to R2: ${scriptKey}`);
      } catch (err: any) {
        console.warn(`[Broadcast Cache] Failed saving script to R2:`, err.message);
      }
    }
  }

  // ─────────────────────────────────────────────
  // 2. Route: POST /api/broadcast/job (Check Cache or Start Async Pipeline)
  // ─────────────────────────────────────────────
  app.post("/api/broadcast/job", async (req, res): Promise<any> => {
    try {
      const { cache_key, book_id, title, extraction, character_bible } = req.body;
      if (!cache_key || !extraction) {
        return res.status(400).json({ error: "cache_key and extraction data are required" });
      }

      const rawCostEstimate =
        extraction.bookType === "comic"
          ? (extraction.pages?.length || 1) * BROADCAST_CONFIG.QUOTAS.ESTIMATED_COST_PER_PAGE_USD
          : BROADCAST_CONFIG.QUOTAS.ESTIMATED_COST_PER_CHAPTER_USD;

      const plan = resolveBroadcastExecutionPlan(req, rawCostEstimate);

      // Free Workers AI TTS only supports English (@cf/deepgram/aura-2-en, @cf/inworld/tts-1.5-max) and Spanish (@cf/deepgram/aura-2-es).
      // Other languages are not provided free of charge: give immediate feedback to input API key or choose platform credits.
      const sampleForLangCheck =
        extraction.chapterText ||
        (extraction.pages || [])
          .flatMap((p: any) => (p.lines || []).map((l: any) => l.text || ""))
          .join(" ")
          .slice(0, 1200);
      const preDetectedLang = detectLanguage(sampleForLangCheck, extraction.language);

      if (plan.stageMode.tts === "workers_ai" && !isLanguageSupportedFree(preDetectedLang)) {
        return res.json({
          cached: false,
          status: "failed",
          unsupported_free_language: true,
          detected_language: preDetectedLang,
          error: getUnsupportedFreeTtsFeedbackMessage(preDetectedLang),
        });
      }

      // SHARED CACHE CHECK: A cache hit must trigger ZERO paid AI calls!
      const cached = await getCachedScriptFromR2(req, cache_key);
      if (cached) {
        const cachedLang = cached.language || preDetectedLang;
        if (plan.stageMode.tts === "workers_ai" && !isLanguageSupportedFree(cachedLang)) {
          return res.json({
            cached: false,
            status: "failed",
            unsupported_free_language: true,
            detected_language: cachedLang,
            error: getUnsupportedFreeTtsFeedbackMessage(cachedLang),
          });
        }
        console.log(`[Broadcast Cache HIT] Reusing cached broadcast for key: ${cache_key}`);
        const isMusicPaid = plan.stageMode.music === "platform_credits" || plan.stageMode.music === "own_key";
        const isSfxPaid = plan.stageMode.sfx === "platform_credits" || plan.stageMode.sfx === "own_key";
        const returnedScript: DirectorScript = {
          ...cached,
          music_sfx_enabled: isMusicPaid || isSfxPaid,
          scenes: (cached.scenes || []).map((sc) => ({
            ...sc,
            bgm_url: isMusicPaid ? sc.bgm_url : undefined,
            bgm_prompt: isMusicPaid ? sc.bgm_prompt : undefined,
            events: (sc.events || [])
              .filter((ev) => isSfxPaid || ev.type !== "sfx")
              .map((ev) => ({
                ...ev,
                sfx_prompt: isSfxPaid ? ev.sfx_prompt : undefined,
              })),
          })),
        };
        return res.json({
          cached: true,
          status: "ready",
          progress: 100,
          script: returnedScript,
        });
      }

      console.log(
        `[Broadcast Cache MISS] Initiating broadcast for "${title}" (${cache_key}) | ` +
          `mainMode=${plan.mainMode}, hasAnyApiKey=${plan.hasAnyApiKey}, ` +
          `isPaidPlatformRun=${plan.isPaidPlatformRun}, useWorkersAiFallback=${plan.useWorkersAiFallback}`
      );

      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const jobRecord: BroadcastJobRecord = {
        job_id: jobId,
        user_id: plan.userId,
        cache_key,
        book_id: book_id || "book",
        title: title || "Audio Drama",
        status: "queued",
        progress: 5,
        created_at: Date.now(),
        is_paid: plan.isPaidPlatformRun,
        cost_estimate: plan.isPaidPlatformRun ? rawCostEstimate : 0,
      };

      // Reserve funds ONLY if the user explicitly chose Platform Credits AND has sufficient balance
      if (plan.isPaidPlatformRun && jobRecord.cost_estimate > 0) {
        const reserveRes = await reserveJobFunds({
          userId: jobRecord.user_id,
          jobId,
          estimatedCost: jobRecord.cost_estimate,
          feature: "broadcast",
          provider: "ai_cascade",
          isWorkersAiModel: false,
          email: req.body.email || (req.headers["x-user-email"] as string) || "",
        });

        if (!reserveRes.approved) {
          // Fallback to Workers AI instead of blocking generation
          console.info(
            `[Broadcast Billing] Platform credits reservation declined (${reserveRes.reason}); falling back to Workers AI.`
          );
          jobRecord.is_paid = false;
          jobRecord.cost_estimate = 0;
          plan.isPaidPlatformRun = false;
          plan.useWorkersAiFallback = true;
          if (plan.stageMode.vision_analyst === "platform_credits") plan.stageMode.vision_analyst = "workers_ai";
          if (plan.stageMode.director === "platform_credits") plan.stageMode.director = "workers_ai";
          if (plan.stageMode.tts === "platform_credits") plan.stageMode.tts = "workers_ai";
          if (plan.stageMode.music === "platform_credits") plan.stageMode.music = "workers_ai";
          if (plan.stageMode.sfx === "platform_credits") plan.stageMode.sfx = "workers_ai";

          if (plan.stageMode.tts === "workers_ai" && !isLanguageSupportedFree(preDetectedLang)) {
            return res.json({
              cached: false,
              status: "failed",
              unsupported_free_language: true,
              detected_language: preDetectedLang,
              error: getUnsupportedFreeTtsFeedbackMessage(preDetectedLang),
            });
          }
        }
      }

      activeJobs.set(jobId, jobRecord);

      // Launch async pipeline in background
      runBroadcastPipelineAsync(req, jobRecord, extraction, character_bible, plan);

      return res.json({
        cached: false,
        job_id: jobId,
        status: "queued",
        progress: 5,
        cost_estimate: jobRecord.cost_estimate,
        using_workers_ai: plan.useWorkersAiFallback,
        stage_mode: plan.stageMode,
      });
    } catch (e: any) {
      console.error("[API /api/broadcast/job] Error:", e);
      return res.status(500).json({ error: e.message || "Failed to initialize broadcast job" });
    }
  });

  // ─────────────────────────────────────────────
  // 3. Route: GET /api/broadcast/job/:jobId (Progress Polling)
  // ─────────────────────────────────────────────
  app.get("/api/broadcast/job/:jobId", async (req, res): Promise<any> => {
    const job = activeJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "Broadcast job not found" });
    }
    return res.json(job);
  });

  // ─────────────────────────────────────────────
  // 4. Route: POST /api/broadcast/vision (Stage 2)
  // ─────────────────────────────────────────────
  app.post("/api/broadcast/vision", async (req, res): Promise<any> => {
    try {
      const { pages, book_metadata } = req.body;
      if (!pages || !Array.isArray(pages)) {
        return res.status(400).json({ error: "pages array required" });
      }

      const plan = resolveBroadcastExecutionPlan(req, 0.03);
      const visionResult = await executeVisionAnalysis(pages, book_metadata, getAIClient, plan);
      return res.json(visionResult);
    } catch (e: any) {
      console.error("[API /api/broadcast/vision] Error:", e);
      return res.status(500).json({ error: e.message || "Vision analysis failed" });
    }
  });

  // ─────────────────────────────────────────────
  // 5. Route: POST /api/broadcast/director (Stage 3)
  // ─────────────────────────────────────────────
  app.post("/api/broadcast/director", async (req, res): Promise<any> => {
    try {
      const { extraction, vision_result, book_metadata, character_bible } = req.body;
      const plan = resolveBroadcastExecutionPlan(req, 0.05);
      const script = await executeScriptDirector(
        extraction,
        vision_result,
        book_metadata,
        character_bible,
        getAIClient,
        plan
      );
      return res.json(script);
    } catch (e: any) {
      console.error("[API /api/broadcast/director] Error:", e);
      return res.status(500).json({ error: e.message || "Script direction failed" });
    }
  });

  // ─────────────────────────────────────────────
  // 6. Route: POST /api/broadcast/tts (Stage 4)
  // ─────────────────────────────────────────────
  app.post("/api/broadcast/tts", async (req, res): Promise<any> => {
    try {
      const { text, character, voice_design, emotion, delivery, cache_key, event_id } = req.body;
      if (!text) {
        return res.status(400).json({ error: "text is required" });
      }

      const audioFileName = `${event_id || Math.random().toString(36).slice(2, 9)}.mp3`;
      const localAudioPath = path.join(BROADCAST_CACHE_DIR, cache_key || "temp", "audio", audioFileName);
      if (fs.existsSync(localAudioPath)) {
        return res.json({
          audio_url: `/api/broadcast/asset/${encodeURIComponent(cache_key || "temp")}/audio/${audioFileName}`,
        });
      }

      const plan = resolveBroadcastExecutionPlan(req, 0.01);
      const declaredLang = req.body.language || req.body.lang;
      const cleanText = extractVerbatimTtsText(text);
      const lang = detectLanguage(cleanText, declaredLang);

      let audioBuffer: Buffer | null = null;
      let contentType = "audio/mpeg";
      let extension = "mp3";

      if (plan.stageMode.tts === "own_key" || plan.stageMode.tts === "platform_credits") {
        audioBuffer = await synthesizeTtsCascade({
          text: cleanText,
          character: character || "narrator",
          language: lang,
          voice_design,
          emotion,
          delivery,
          elevenLabsKey: plan.keys.elevenlabs,
          openAiKey: plan.keys.openai,
          useGateway: plan.stageMode.tts === "platform_credits",
        });
      }

      // Fallback to Workers AI if not using paid/own key or if provider cascade returned null
      if (!audioBuffer) {
        if (!isLanguageSupportedFree(lang)) {
          return res.status(400).json({
            error: getUnsupportedFreeTtsFeedbackMessage(lang),
            unsupported_free_language: true,
            detected_language: lang,
            supported_languages: ALL_SUPPORTED_LANGUAGES,
          });
        }

        const sniffedResult = await synthesizeWorkersAiTts(
          cleanText,
          character || "narrator",
          lang,
          req.body.character_bible,
          plan.keys.cloudflare
        );

        if (sniffedResult && sniffedResult.buffer && sniffedResult.extension !== "wav") {
          audioBuffer = sniffedResult.buffer;
          contentType = sniffedResult.contentType || "audio/mpeg";
          extension = sniffedResult.extension || "mp3";
        }
      }

      if (audioBuffer && extension !== "wav") {
        const finalAudioFileName = `${event_id || Math.random().toString(36).slice(2, 9)}.${extension}`;
        const targetAudioPath = path.join(BROADCAST_CACHE_DIR, cache_key || "temp", "audio", finalAudioFileName);
        fs.mkdirSync(path.dirname(targetAudioPath), { recursive: true });
        fs.writeFileSync(targetAudioPath, audioBuffer);

        const { s3, bucket, isConfigured } = getR2ClientAndBucket(req);
        if (plan.isPaidPlatformRun && isConfigured && s3 && cache_key) {
          const r2Key = `broadcast/${cache_key}/audio/${finalAudioFileName}`;
          safeS3Send(
            s3,
            new PutObjectCommand({
              Bucket: bucket,
              Key: r2Key,
              Body: audioBuffer,
              ContentType: contentType,
            }),
            15000
          ).catch((e) => console.warn("[Broadcast TTS] R2 upload warn:", e.message));
        }

        return res.json({
          audio_url: `/api/broadcast/asset/${encodeURIComponent(cache_key || "temp")}/audio/${finalAudioFileName}`,
          content_type: contentType,
        });
      }

      return res.json({ audio_url: null, subtitle_only: true });
    } catch (e: any) {
      console.error("[API /api/broadcast/tts] Error:", e);
      return res.status(500).json({ error: e.message || "TTS generation failed" });
    }
  });

  // ─────────────────────────────────────────────
  // 6.5 Route: ALL /api/broadcast/tts-test (Debug Endpoint)
  // ─────────────────────────────────────────────
  app.all("/api/broadcast/tts-test", async (req, res): Promise<any> => {
    try {
      const q = req.query || {};
      const b = req.body || {};
      const text =
        (b.text as string) ||
        (q.text as string) ||
        "Hello, this is an audio broadcast test with Received Pronunciation.";
      const declaredLang = (b.lang || b.language || q.lang || q.language || "en") as string;
      const character = (b.character || q.character || "narrator") as string;
      const explicitSpeaker = (b.speaker || q.speaker) as string | undefined;
      const explicitModel = (b.model || q.model) as string | undefined;

      const lang = detectLanguage(text, declaredLang);
      if (!isLanguageSupportedFree(lang)) {
        return res.status(400).json({
          success: false,
          error: getUnsupportedFreeTtsFeedbackMessage(lang),
          unsupported_free_language: true,
          detected_language: lang,
          supported_languages: ALL_SUPPORTED_LANGUAGES,
        });
      }

      const routing = resolveFreeTtsModel(lang);
      const modelUsed = explicitModel || routing?.model || "@cf/deepgram/aura-2-en";
      const speakerUsed =
        explicitSpeaker ||
        (routing
          ? getOrAssignFreeSpeaker(character, undefined, routing.provider, lang)
          : "draco");

      const sniffedResult = await synthesizeWorkersAiTts(text, character, lang);

      const testAudioName = `test_${Date.now()}.${sniffedResult.extension}`;
      const testAudioPath = path.join(BROADCAST_CACHE_DIR, "debug", testAudioName);
      fs.mkdirSync(path.dirname(testAudioPath), { recursive: true });
      fs.writeFileSync(testAudioPath, sniffedResult.buffer);

      return res.json({
        success: true,
        model_used: modelUsed,
        speaker_used: speakerUsed,
        language: lang,
        response_type: Buffer.isBuffer(sniffedResult.buffer) ? "Buffer/ArrayBuffer" : typeof sniffedResult.buffer,
        byte_length: sniffedResult.byteLength,
        magic_bytes_hex: sniffedResult.magicBytesHex,
        detected_format: sniffedResult.contentType,
        extension: sniffedResult.extension,
        audio_url: `/api/broadcast/asset/debug/${testAudioName}`,
      });
    } catch (err: any) {
      console.error("[API /api/broadcast/tts-test] Error:", err);
      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  // ─────────────────────────────────────────────
  // 7. Route: POST /api/broadcast/audio-fx (Stage 5)
  // Music and SFX are NOT provided free of charge.
  // ─────────────────────────────────────────────
  app.post("/api/broadcast/audio-fx", async (req, res): Promise<any> => {
    try {
      const { type, prompt, duration_sec } = req.body;
      const manifest = loadCc0Manifest();
      const plan = resolveBroadcastExecutionPlan(req, 0.01);
      const isMusicPaid = plan.stageMode.music === "platform_credits" || plan.stageMode.music === "own_key";
      const isSfxPaid = plan.stageMode.sfx === "platform_credits" || plan.stageMode.sfx === "own_key";
      const isPaid = type === "bgm" ? isMusicPaid : isSfxPaid;
      const models = getModels(process.env, isPaid);

      if (!isPaid) {
        return res.json({
          url: null,
          matched_id: null,
          synth_type: null,
          free_tier_disabled: true,
          message: "Music and SFX are not provided free of charge. Input an API key or choose Platform Credits to enable Music and SFX.",
        });
      }

      if (isSfxPaid && type === "sfx" && models.sfx !== null && prompt) {
        try {
          const sfxUrl = plan.keys.elevenlabs
            ? "https://api.elevenlabs.io/v1/sound-effects"
            : getCloudflareGatewayUrl("elevenlabs", "/v1/sound-effects").url;
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (plan.keys.elevenlabs) {
            headers["xi-api-key"] = plan.keys.elevenlabs;
          }
          const sfxRes = await fetch(sfxUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
              text: prompt,
              duration_seconds: duration_sec || 2.0,
            }),
          });
          if (sfxRes.ok) {
            const sfxBuf = await sfxRes.arrayBuffer();
            const sfxFileName = `sfx_${Math.random().toString(36).slice(2, 9)}.mp3`;
            const localSfxPath = path.join(BROADCAST_CACHE_DIR, "fx", sfxFileName);
            fs.mkdirSync(path.dirname(localSfxPath), { recursive: true });
            fs.writeFileSync(localSfxPath, Buffer.from(sfxBuf));
            return res.json({
              url: `/api/broadcast/asset/fx/${sfxFileName}`,
              synth_type: "generated_sfx",
            });
          }
        } catch (sfxErr: any) {
          console.warn("[Broadcast Audio-FX] ElevenLabs SFX call notice, using CC0 library:", sfxErr.message);
        }
      }

      if (type === "bgm") {
        const pLower = (prompt || "").toLowerCase();
        const match = manifest.bgm.find((item) =>
          item.tags.some((tag: string) => pLower.includes(tag))
        );
        return res.json({
          url: match ? match.url : null,
          matched_id: match ? match.id : null,
          synth_type: match ? match.synth_type : "piano_pad",
        });
      } else {
        const pLower = (prompt || "").toLowerCase();
        const match = manifest.sfx.find((item) =>
          item.tags.some((tag: string) => pLower.includes(tag))
        );
        return res.json({
          url: match ? match.url : null,
          matched_id: match ? match.id : null,
          synth_type: match ? match.synth_type : "impact_punch",
        });
      }
    } catch (e: any) {
      return res.status(500).json({ error: e.message || "Audio FX lookup failed" });
    }
  });

  // ─────────────────────────────────────────────
  // 8. Route: GET /api/broadcast/asset/* (Serve Audio & Scripts)
  // ─────────────────────────────────────────────
  app.get("/api/broadcast/asset/*", async (req, res): Promise<any> => {
    try {
      const relPath = req.params[0];
      if (!relPath || relPath.includes("..") || relPath.toLowerCase().endsWith(".wav")) {
        return res.status(404).send("Broadcast asset not found");
      }

      // Check local cache
      const localFilePath = path.join(BROADCAST_CACHE_DIR, relPath);
      if (fs.existsSync(localFilePath)) {
        if (relPath.endsWith(".mp3")) res.setHeader("Content-Type", "audio/mpeg");
        else if (relPath.endsWith(".ogg") || relPath.endsWith(".opus")) res.setHeader("Content-Type", "audio/ogg");
        else if (relPath.endsWith(".flac")) res.setHeader("Content-Type", "audio/flac");
        else if (relPath.endsWith(".json")) res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        return res.sendFile(localFilePath);
      }

      // Check R2
      const { s3, bucket, isConfigured } = getR2ClientAndBucket(req);
      if (isConfigured && s3) {
        try {
          const r2Key = `broadcast/${relPath}`;
          const s3Obj = await safeS3Send(
            s3,
            new GetObjectCommand({ Bucket: bucket, Key: r2Key }),
            10000
          );
          if (s3Obj && s3Obj.Body) {
            if (relPath.endsWith(".mp3")) res.setHeader("Content-Type", "audio/mpeg");
            else if (relPath.endsWith(".ogg") || relPath.endsWith(".opus")) res.setHeader("Content-Type", "audio/ogg");
            else if (relPath.endsWith(".flac")) res.setHeader("Content-Type", "audio/flac");
            else if (relPath.endsWith(".json")) res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            const byteArray = await s3Obj.Body.transformToByteArray();
            return res.send(Buffer.from(byteArray));
          }
        } catch (_) {}
      }

      return res.status(404).send("Broadcast asset not found");
    } catch (e: any) {
      return res.status(500).send("Error serving broadcast asset");
    }
  });

  // ─────────────────────────────────────────────
  // Async Orchestration Pipeline
  // ─────────────────────────────────────────────
  async function runBroadcastPipelineAsync(
    req: express.Request,
    job: BroadcastJobRecord,
    extraction: ExtractionResult,
    characterBible: any,
    plan: BroadcastExecutionPlan
  ) {
    try {
      // 1. Stage 2: Vision Analysis (for comics)
      let visionResult: VisionResult | null = null;
      if (extraction.bookType === "comic" && extraction.pages && extraction.pages.length > 0) {
        job.status = "vision";
        job.progress = 25;
        job.status_text =
          plan.stageMode.vision_analyst === "workers_ai"
            ? "Analyzing panels and expressions via Workers AI..."
            : "Analyzing visual cues, expressions and panels...";

        try {
          visionResult = await executeVisionAnalysis(
            extraction.pages,
            { title: extraction.title, author: extraction.author, language: extraction.language },
            deps.getAIClient,
            plan
          );
        } catch (visionErr) {
          console.warn("[Broadcast] Vision analysis failed, falling back to OCR text mode:", visionErr);
          visionResult = buildFallbackVisionResult(extraction.pages);
        }
      }

      // 2. Stage 3: Script Direction
      job.status = "directing";
      job.progress = 50;
      job.status_text =
        plan.stageMode.director === "workers_ai"
          ? "Directing scenes and character voices via Workers AI..."
          : "Directing acting performance and audio soundscape...";

      const script = await executeScriptDirector(
        extraction,
        visionResult,
        { title: extraction.title, author: extraction.author, language: extraction.language },
        characterBible,
        deps.getAIClient,
        plan
      );

      script.cache_key = job.cache_key;
      script.pipeline_version = BROADCAST_CONFIG.PIPELINE_VERSION;

      // 3. Stage 4: Voice Synthesis (Stage 4)
      job.status = "voicing";
      job.progress = 65;
      job.status_text =
        plan.stageMode.tts === "workers_ai"
          ? "Synthesizing character voice performances via Workers AI..."
          : "Synthesizing voice performances...";

      const sampleForLang =
        extraction.chapterText ||
        script.scenes
          .flatMap((s) => s.events.map((e) => e.text || ""))
          .join(" ")
          .slice(0, 1000);
      const lang = detectLanguage(sampleForLang, extraction.language);
      script.language = lang;

      if (plan.stageMode.tts === "workers_ai" && !isLanguageSupportedFree(lang)) {
        job.status = "failed";
        job.error = getUnsupportedFreeTtsFeedbackMessage(lang);
        return;
      }

      const speakingEvents = script.scenes.flatMap((sc) =>
        sc.events.filter((ev) => (ev.type === "dialogue" || ev.type === "narration") && ev.text && ev.text.trim())
      );

      let processedEvents = 0;
      let voicedEventsCount = 0;
      let unsupportedLangError: string | null = null;
      const CONCURRENCY = 4;

      for (let i = 0; i < speakingEvents.length; i += CONCURRENCY) {
        if (unsupportedLangError) break;
        const batch = speakingEvents.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async (ev) => {
            if (unsupportedLangError) return;
            const cleanText = extractVerbatimTtsText(ev.text);
            ev.text = cleanText;
            if (!cleanText) return;

            let extension = "mp3";
            let contentType = "audio/mpeg";
            let audioBuf: Buffer | null = null;

            // Try Own Key or Platform Credits first if configured for TTS stage
            if (plan.stageMode.tts === "own_key" || plan.stageMode.tts === "platform_credits") {
              audioBuf = await synthesizeTtsCascade({
                text: cleanText,
                character: ev.character || "narrator",
                language: lang,
                voice_design: ev.delivery,
                emotion: ev.emotion,
                elevenLabsKey: plan.keys.elevenlabs,
                openAiKey: plan.keys.openai,
                useGateway: plan.stageMode.tts === "platform_credits",
              });
            }

            // Fallback to Workers AI if not using paid/own key or if provider cascade failed
            if (!audioBuf) {
              if (!isLanguageSupportedFree(lang)) {
                unsupportedLangError = getUnsupportedFreeTtsFeedbackMessage(lang);
                return;
              }
              try {
                const sniffed = await synthesizeWorkersAiTts(
                  cleanText,
                  ev.character || "narrator",
                  lang,
                  characterBible,
                  plan.keys.cloudflare
                );
                if (sniffed && sniffed.buffer && sniffed.extension !== "wav") {
                  audioBuf = sniffed.buffer;
                  extension = sniffed.extension || "mp3";
                  contentType = sniffed.contentType || "audio/mpeg";
                }
              } catch (ttsErr: any) {
                console.warn(`[Broadcast Stage 4 TTS warning for event ${ev.id}]:`, ttsErr.message);
              }
            }

            // Persist ONLY valid non-WAV audio files (e.g. .mp3) to local cache & R2
            if (audioBuf && extension !== "wav") {
              const audioFileName = `${ev.id}.${extension}`;
              const localAudioPath = path.join(BROADCAST_CACHE_DIR, job.cache_key, "audio", audioFileName);

              if (!fs.existsSync(localAudioPath)) {
                fs.mkdirSync(path.dirname(localAudioPath), { recursive: true });
                fs.writeFileSync(localAudioPath, audioBuf);

                const { s3, bucket, isConfigured } = getR2ClientAndBucket(req);
                if (plan.isPaidPlatformRun && isConfigured && s3) {
                  const r2Key = `broadcast/${job.cache_key}/audio/${audioFileName}`;
                  safeS3Send(
                    s3,
                    new PutObjectCommand({
                      Bucket: bucket,
                      Key: r2Key,
                      Body: audioBuf,
                      ContentType: contentType,
                    }),
                    10000
                  ).catch(() => {});
                }
              }

              ev.audio_url = `/api/broadcast/asset/${encodeURIComponent(job.cache_key)}/audio/${audioFileName}`;
              voicedEventsCount++;
            }

            processedEvents++;
            if (speakingEvents.length > 0) {
              job.progress = 65 + Math.round((processedEvents / speakingEvents.length) * 20);
            }
          })
        );
      }

      if (unsupportedLangError) {
        job.status = "failed";
        job.error = unsupportedLangError;
        return;
      }

      if (speakingEvents.length > 0 && voicedEventsCount === 0) {
        job.status = "failed";
        job.error = !isLanguageSupportedFree(lang)
          ? getUnsupportedFreeTtsFeedbackMessage(lang)
          : "TTS voice synthesis failed to generate audio files. Please verify your API key in /ai settings or choose Platform Credits.";
        return;
      }

      // 4. Stage 5: Music & Sound Effects (ONLY for Own Key or Platform Credits; NOT provided free of charge)
      const isMusicPaid = plan.stageMode.music === "platform_credits" || plan.stageMode.music === "own_key";
      const isSfxPaid = plan.stageMode.sfx === "platform_credits" || plan.stageMode.sfx === "own_key";
      script.music_sfx_enabled = isMusicPaid || isSfxPaid;

      if (isMusicPaid || isSfxPaid) {
        job.status = "scoring";
        job.progress = 90;
        job.status_text = "Composing music cues and sound effects...";

        const manifest = loadCc0Manifest();
        for (const scene of script.scenes) {
          if (isMusicPaid && scene.bgm_prompt) {
            const pLower = scene.bgm_prompt.toLowerCase();
            const match = manifest.bgm.find((item) =>
              item.tags.some((tag: string) => pLower.includes(tag))
            );
            if (match) scene.bgm_url = match.url;
          } else if (!isMusicPaid) {
            scene.bgm_url = undefined;
            scene.bgm_prompt = undefined;
          }

          if (isSfxPaid) {
            for (const ev of scene.events) {
              if (ev.type === "sfx" || ev.sfx_prompt) {
                const sfxP = (ev.sfx_prompt || "").toLowerCase();
                const match = manifest.sfx.find((item) =>
                  item.tags.some((tag: string) => sfxP.includes(tag))
                );
                if (match) ev.audio_url = match.url;
              }
            }
          } else {
            scene.events = scene.events
              .filter((ev) => ev.type !== "sfx")
              .map((ev) => ({
                ...ev,
                sfx_prompt: undefined,
              }));
          }
        }
      } else {
        // Free Workers AI tier: Music and SFX are not provided free of charge
        for (const scene of script.scenes) {
          scene.bgm_url = undefined;
          scene.bgm_prompt = undefined;
          scene.events = scene.events
            .filter((ev) => ev.type !== "sfx")
            .map((ev) => ({
              ...ev,
              sfx_prompt: undefined,
            }));
        }
      }

      // Persist the complete script (only upload to R2 for Platform Credits plan; save locally for others)
      await saveScriptToR2(req, job.cache_key, script, plan.isPaidPlatformRun);

      // Finish Job
      job.status = "ready";
      job.progress = 100;
      job.status_text = "Audio Drama ready for broadcast playback!";
      job.script = script;
      job.first_scene_ready = true;
      console.log(`[Broadcast] Job ${job.job_id} successfully completed!`);

      // Settle reserved funds on success
      if (job.is_paid && job.cost_estimate > 0) {
        await settleJobFunds({
          userId: job.user_id,
          jobId: job.job_id,
          actualCost: job.cost_estimate,
          success: true,
        }).catch((e) => console.warn("[Billing] Settlement error:", e.message));
      }
    } catch (pipelineErr: any) {
      console.error(`[Broadcast] Pipeline failed for job ${job.job_id}:`, pipelineErr);
      job.status = "failed";
      job.error = pipelineErr.message || "Failed to generate audio drama";

      // Refund reserved funds in full on failure
      if (job.is_paid && job.cost_estimate > 0) {
        await settleJobFunds({
          userId: job.user_id,
          jobId: job.job_id,
          actualCost: 0,
          success: false,
        }).catch((e) => console.warn("[Billing] Refund error:", e.message));
      }
    }
  }
}

// ─────────────────────────────────────────────
// Vision Analysis Executor (Stage 2)
// ─────────────────────────────────────────────
async function executeVisionAnalysis(
  pages: any[],
  bookMetadata: any,
  getAIClient: (customKey?: string) => any,
  plan?: BroadcastExecutionPlan
): Promise<VisionResult> {
  const mode = plan?.stageMode.vision_analyst || "workers_ai";

  // 1. Try Own Key (Google Gemini) or Platform Credits
  if (mode === "own_key" || mode === "platform_credits") {
    const ai = plan?.keys.google
      ? new GoogleGenAI({ apiKey: plan.keys.google })
      : getAIClient(plan?.keys.google || undefined);
    if (ai) {
      try {
        const contents: any[] = [];
        contents.push({ text: VISION_SYSTEM_PROMPT });
        contents.push({
          text: `Book Title: ${bookMetadata?.title || "Unknown"}\nAuthor: ${bookMetadata?.author || "Unknown"}\nPages Count: ${pages.length}\nHere are the page images and OCR transcriptions:`,
        });

        for (const p of pages) {
          const ocrSummary = (p.lines || []).map((l: any) => `[Panel ${l.panelIndex}] "${l.text}"`).join("\n");
          contents.push({
            text: `--- PAGE ${p.pageIndex + 1} OCR TEXT ---\n${ocrSummary || "(No OCR detected)"}`,
          });

          if (p.imageDataUrl && p.imageDataUrl.startsWith("data:image")) {
            const [meta, rawData] = p.imageDataUrl.split(",");
            const mime = meta.match(/data:(.*?);/)?.[1] || "image/jpeg";
            contents.push({
              inlineData: {
                mimeType: mime,
                data: rawData,
              },
            });
          }
        }

        const response = await ai.models.generateContent({
          model: BROADCAST_CONFIG.VISION_MODEL,
          contents,
          config: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        });

        const parsed = extractJsonObject(response.text || "");
        if (parsed && parsed.characters && parsed.pages) {
          return parsed as VisionResult;
        }
      } catch (err: any) {
        console.warn("[Broadcast Vision] Paid/Own-key model error, falling back to Workers AI:", err.message);
      }
    }
  }

  // 2. Fallback to Workers AI Vision Analyst:
  // Primary: @cf/google/gemma-4-26b-a4b-it, Fallback: @cf/deepseek-ai/deepseek-v4.1-flash-1017
  try {
    const ocrDigest = pages
      .slice(0, 6)
      .map((p: any, idx: number) => {
        const lines = (p.lines || []).map((l: any) => l.text).join(" | ");
        return `Page ${idx + 1}: ${lines}`;
      })
      .join("\n");

    if (ocrDigest.trim().length > 10) {
      const rawVision = await runWorkersAiTextModel(
        VISION_SYSTEM_PROMPT,
        `Book: ${bookMetadata?.title || "Comic"}\nOCR Lines:\n${ocrDigest.slice(0, 2000)}`,
        plan?.keys.cloudflare,
        [FREE_MODELS.vision, FREE_MODELS.vision_fallback]
      );
      const parsed = rawVision ? extractJsonObject(rawVision) : null;
      if (parsed && Array.isArray(parsed.characters) && Array.isArray(parsed.pages)) {
        return parsed as VisionResult;
      }
    }
  } catch (_) {}

  return buildFallbackVisionResult(pages);
}

function buildFallbackVisionResult(pages: any[]): VisionResult {
  return {
    is_degraded: true,
    characters: [
      { id: "c1", name: "Protagonist", appearance: "Lead character", gender: "male", age_group: "teen" },
      { id: "c2", name: "Companion", appearance: "Support character", gender: "female", age_group: "teen" },
    ],
    pages: pages.map((p, pIdx) => ({
      page_index: p.pageIndex !== undefined ? p.pageIndex : pIdx,
      panels: [
        {
          panel_index: 0,
          characters_present: ["c1"],
          balloons: (p.lines || []).map((line: any, idx: number) => ({
            speaker: idx % 2 === 0 ? "c1" : "narrator",
            text: line.text,
            ocr_correction: null,
            volume: "normal" as const,
            emotion: "neutral",
          })),
        },
      ],
    })),
  };
}

// ─────────────────────────────────────────────
// Script Director Executor (Stage 3)
// ─────────────────────────────────────────────
async function executeScriptDirector(
  extraction: ExtractionResult,
  visionResult: VisionResult | null,
  bookMetadata: any,
  characterBible: any,
  getAIClient: (customKey?: string) => any,
  plan?: BroadcastExecutionPlan
): Promise<DirectorScript> {
  const rawPlain = toPlainText(extraction.chapterText || "");
  const strippedPlain = stripTableOfContentsAndFrontMatter(rawPlain);
  const cleanChapterText = strippedPlain.length >= 60 ? strippedPlain : rawPlain;
  const sampleText =
    cleanChapterText ||
    (extraction.pages || [])
      .flatMap((p: any) => (p.lines || []).map((l: any) => l.text || ""))
      .join(" ");
  const detectedLang = detectLanguage(sampleText, extraction.language);
  const mode = plan?.stageMode.director || "workers_ai";

  // 1. If Own Key or Platform Credits is active for Director, try user's configured provider / cascade first
  if (mode === "own_key" || mode === "platform_credits") {
    const prompt =
      extraction.bookType === "novel"
        ? `BOOK METADATA:\nTitle: ${extraction.title}\nAuthor: ${extraction.author || "Unknown"}\nLanguage: ${detectedLang}\n\nCHAPTER TEXT:\n${cleanChapterText.slice(0, 8000)}`
        : `BOOK METADATA:\nTitle: ${extraction.title}\nLanguage: ${detectedLang}\nCOMIC PANELS AND OCR:\n${JSON.stringify(extraction.pages || []).slice(0, 8000)}`;

    // Try Anthropic Claude if key available or platform credits
    if (plan?.keys.anthropic || mode === "platform_credits") {
      const claudeScript = await callClaudeDirector(DIRECTOR_SYSTEM_PROMPT, prompt, plan?.keys.anthropic);
      if (claudeScript) {
        claudeScript.book_id = extraction.title;
        claudeScript.cache_key = extraction.sourceHash;
        claudeScript.chapter_id = extraction.chapterId;
        claudeScript.language = detectedLang;
        claudeScript.pipeline_version = BROADCAST_CONFIG.PIPELINE_VERSION;
        claudeScript.created_at = Date.now();
        return claudeScript;
      }
    }

    // Try OpenAI if key available
    if (plan?.keys.openai) {
      const openAiScript = await callOpenAiDirector(DIRECTOR_SYSTEM_PROMPT, prompt, plan.keys.openai);
      if (openAiScript) {
        openAiScript.book_id = extraction.title;
        openAiScript.cache_key = extraction.sourceHash;
        openAiScript.chapter_id = extraction.chapterId;
        openAiScript.language = detectedLang;
        openAiScript.pipeline_version = BROADCAST_CONFIG.PIPELINE_VERSION;
        openAiScript.created_at = Date.now();
        return openAiScript;
      }
    }

    // Try Google Gemini if key available or platform credits
    const ai = plan?.keys.google
      ? new GoogleGenAI({ apiKey: plan.keys.google })
      : mode === "platform_credits"
      ? getAIClient()
      : null;

    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: BROADCAST_CONFIG.DIRECTOR_FALLBACK_MODEL,
          contents: [{ text: `${DIRECTOR_SYSTEM_PROMPT}\n\n${prompt}` }],
          config: {
            responseMimeType: "application/json",
            temperature: 0.3,
          },
        });

        const parsed = extractJsonObject(response.text || "");
        if (parsed && parsed.characters && parsed.scenes && parsed.scenes.length > 0) {
          return {
            book_id: extraction.title,
            cache_key: extraction.sourceHash,
            chapter_id: extraction.chapterId,
            language: detectedLang,
            pipeline_version: BROADCAST_CONFIG.PIPELINE_VERSION,
            characters: parsed.characters,
            scenes: parsed.scenes,
            created_at: Date.now(),
          };
        }
      } catch (e: any) {
        console.warn("[Broadcast Director] Gemini call notice, falling back to Workers AI:", e.message);
      }
    }
  }

  // 2. Fallback to Cloudflare Workers AI Director
  console.log(`[Broadcast Director] Using Cloudflare Workers AI Director fallback (lang=${detectedLang})`);
  return await callWorkersAIDirector(extraction, cleanChapterText, detectedLang, plan?.keys.cloudflare);
}

function buildDirectorScriptFromText(
  extraction: ExtractionResult,
  rawText?: string,
  detectedLang?: string
): DirectorScript {
  const lang = detectedLang || detectLanguage(rawText || extraction.chapterText || "", extraction.language);
  const isEnglish = lang.toLowerCase().startsWith("en");
  const chapterText = toPlainText(rawText || extraction.chapterText || "");
  const paragraphs = chapterText.split(/\n+/).filter((p) => p.trim().length > 0);
  const rawEvents: DirectorEvent[] = [];

  let eventCounter = 1;
  let charToggle = 0;

  const pushSplitChunks = (
    type: "narration" | "dialogue",
    character: string,
    text: string,
    pauseMs: number
  ) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;
    const chunks = splitTextIntoTtsChunks(clean, 260);
    for (const chunk of chunks) {
      rawEvents.push({
        id: `e${eventCounter++}`,
        type,
        character,
        text: chunk,
        emotion: "neutral",
        pause_after_ms: pauseMs,
      });
    }
  };

  for (const para of paragraphs) {
    const quoteRegex = /([“"«「『][^”"»」』]+[”"»」』])/g;
    let lastIdx = 0;
    let match;

    while ((match = quoteRegex.exec(para)) !== null) {
      if (match.index > lastIdx) {
        const narration = para.slice(lastIdx, match.index).trim();
        if (narration) {
          pushSplitChunks("narration", "narrator", narration, 300);
        }
      }
      const dialogue = match[1].replace(/^[“"«「『]|[”"»」』]$/g, "").trim();
      if (dialogue) {
        charToggle++;
        pushSplitChunks("dialogue", charToggle % 2 === 1 ? "c1" : "c2", dialogue, 380);
      }
      lastIdx = match.index + match[0].length;
    }

    if (lastIdx < para.length) {
      const remaining = para.slice(lastIdx).trim();
      if (remaining) {
        pushSplitChunks("narration", "narrator", remaining, 350);
      }
    }
  }

  // Merge consecutive short narration lines (up to ~260 chars) so a chapter produces
  // smooth narration segments rather than hundreds of tiny fragments, capped at 36 events per chapter batch
  const mergedEvents: DirectorEvent[] = [];
  for (const ev of rawEvents) {
    const prev = mergedEvents[mergedEvents.length - 1];
    if (
      prev &&
      prev.type === "narration" &&
      ev.type === "narration" &&
      (prev.text || "").length + (ev.text || "").length < 260
    ) {
      prev.text = `${prev.text} ${ev.text}`.trim();
    } else {
      mergedEvents.push({ ...ev, id: `e${mergedEvents.length + 1}` });
    }
    if (mergedEvents.length >= 36) break;
  }

  return {
    book_id: extraction.title,
    cache_key: extraction.sourceHash,
    chapter_id: extraction.chapterId,
    language: lang,
    pipeline_version: BROADCAST_CONFIG.PIPELINE_VERSION,
    characters: [
      {
        id: "narrator",
        name: "Narrator",
        gender: "neutral",
        age_group: "adult",
        personality: "expressive and measured",
        voice_design: isEnglish
          ? BROADCAST_CONFIG.VOICE_DEFAULTS.DEFAULT_NARRATOR_VOICE_DESIGN
          : "Articulate, warm and resonant native narrator voice with steady cinematic pacing",
      },
      {
        id: "c1",
        name: "Protagonist",
        gender: "male",
        age_group: "adult",
        personality: "observant and thoughtful",
        voice_design: "Warm clear natural voice with expressive emotional range",
      },
      {
        id: "c2",
        name: "Companion",
        gender: "female",
        age_group: "adult",
        personality: "spirited and perceptive",
        voice_design: "Bright melodic expressive voice with natural warmth",
      },
    ],
    scenes: [
      {
        id: "s1",
        setting: "Story Opening",
        mood: "calm",
        scene_summary: "Opening narration and dialogue.",
        bgm_prompt: "Gentle acoustic piano and strings",
        bgm_loop: true,
        events:
          mergedEvents.length > 0
            ? mergedEvents
            : [
                {
                  id: "e1",
                  type: "narration",
                  character: "narrator",
                  text: chapterText.slice(0, 300) || extraction.title || "The story begins.",
                  emotion: "neutral",
                  pause_after_ms: 400,
                },
              ],
      },
    ],
    created_at: Date.now(),
  };
}

function directComicPages(
  extraction: ExtractionResult,
  visionResult: VisionResult | null,
  characterBible: any,
  ai: any,
  detectedLang?: string
): DirectorScript {
  const pages = extraction.pages || [];
  const events: DirectorEvent[] = [];
  let eventCounter = 1;

  for (const page of pages) {
    for (const line of page.lines) {
      if (line.text && line.text.trim()) {
        events.push({
          id: `e${eventCounter++}`,
          type: "dialogue",
          character: eventCounter % 2 === 0 ? "c1" : "c2",
          text: toPlainText(line.text.trim()),
          emotion: "neutral",
          pause_after_ms: 400,
          source: {
            page: page.pageIndex,
            bbox: line.bbox,
          },
        });
      }
    }
  }

  const lang = detectedLang || extraction.language || "en";
  const isEnglish = lang.toLowerCase().startsWith("en");
  return {
    book_id: extraction.title,
    cache_key: extraction.sourceHash,
    page_range: extraction.pageRange,
    language: lang,
    pipeline_version: BROADCAST_CONFIG.PIPELINE_VERSION,
    characters: [
      {
        id: "narrator",
        name: "Narrator",
        gender: "neutral",
        age_group: "adult",
        personality: "dramatic",
        voice_design: isEnglish
          ? BROADCAST_CONFIG.VOICE_DEFAULTS.DEFAULT_NARRATOR_VOICE_DESIGN
          : "Articulate, warm and resonant native narrator voice with steady cinematic pacing",
      },
      {
        id: "c1",
        name: "Protagonist",
        gender: "male",
        age_group: "teen",
        personality: "determined",
        voice_design: "Youthful vibrant hero voice with expressive emotion",
      },
      {
        id: "c2",
        name: "Companion",
        gender: "female",
        age_group: "teen",
        personality: "witty",
        voice_design: "Bright melodic friendly voice with subtle humor",
      },
    ],
    scenes: [
      {
        id: "s1",
        setting: "Comic Scene",
        mood: "action",
        scene_summary: "Main sequence across extracted comic pages.",
        bgm_prompt: "Dynamic cinematic suspense and light adventure percussion",
        bgm_loop: true,
        events:
          events.length > 0
            ? events.slice(0, 24)
            : [
                {
                  id: "e1",
                  type: "narration",
                  character: "narrator",
                  text: "The scene unfolds.",
                  emotion: "neutral",
                },
              ],
      },
    ],
    created_at: Date.now(),
  };
}

// ─────────────────────────────────────────────
// TTS Provider Cascade Executor (Stage 4)
// ─────────────────────────────────────────────
async function synthesizeTtsCascade(params: {
  text: string;
  character: string;
  language?: string;
  voice_design?: string;
  emotion?: string;
  delivery?: string;
  elevenLabsKey?: string | null;
  openAiKey?: string | null;
  useGateway?: boolean;
}): Promise<Buffer | null> {
  const elevenLabsKey = params.elevenLabsKey || process.env.ELEVENLABS_API_KEY;
  const openAiKey = params.openAiKey || process.env.OPENAI_API_KEY;
  const useGateway = Boolean(params.useGateway);

  const isNarrator = params.character === "narrator";
  const isEnglish = (params.language || "en").toLowerCase().startsWith("en");

  // 1. ElevenLabs
  if (elevenLabsKey || useGateway) {
    try {
      const voiceId =
        isNarrator && isEnglish
          ? BROADCAST_CONFIG.VOICE_DEFAULTS.ELEVENLABS_NARRATOR_VOICE_ID
          : "21m00Tcm4TlvDq8ikWAM";

      const url = elevenLabsKey
        ? `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`
        : getCloudflareGatewayUrl("elevenlabs", `/v1/text-to-speech/${voiceId}`).url;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (elevenLabsKey) {
        headers["xi-api-key"] = elevenLabsKey;
      }

      const res = await fetch(url, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers,
        body: JSON.stringify({
          text: params.text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: isNarrator ? 0.65 : 0.5,
            similarity_boost: 0.8,
          },
        }),
      });
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        const sniffed = await normalizeAndSniffAudio(arrayBuf);
        if (sniffed.extension !== "wav") {
          return sniffed.buffer;
        }
      }
    } catch (e: any) {
      console.warn("[Broadcast TTS] ElevenLabs call notice, moving to next provider:", e?.message);
    }
  }

  // 2. OpenAI TTS
  if (openAiKey || useGateway) {
    try {
      const voiceName =
        isNarrator && isEnglish
          ? BROADCAST_CONFIG.VOICE_DEFAULTS.OPENAI_NARRATOR_VOICE
          : "alloy";

      const url = openAiKey
        ? "https://api.openai.com/v1/audio/speech"
        : getCloudflareGatewayUrl("openai", "/v1/audio/speech").url;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (openAiKey) {
        headers["Authorization"] = `Bearer ${openAiKey}`;
      }

      const res = await fetch(url, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers,
        body: JSON.stringify({
          model: "tts-1",
          voice: voiceName,
          input: params.text,
          response_format: "mp3",
        }),
      });
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        const sniffed = await normalizeAndSniffAudio(arrayBuf);
        if (sniffed.extension !== "wav") {
          return sniffed.buffer;
        }
      }
    } catch (e: any) {
      console.warn("[Broadcast TTS] OpenAI TTS call notice, moving to Workers AI fallback:", e?.message);
    }
  }

  return null;
}
