/**
 * broadcastTtsRouting.ts
 *
 * Dedicated Language Routing, Character Voice Mapping, and Audio Normalization
 * for the Broadcast Free-plan TTS engine.
 */

import { CharacterBible } from "./broadcastTypes";

// Supported languages on Workers AI Free Models:
// English: @cf/deepgram/aura-2-en, fallback to @cf/inworld/tts-1.5-max
// Spanish: @cf/deepgram/aura-2-es
// Other languages are not provided free of charge (requires own API key or platform credits).
export const SUPPORTED_LANGUAGES_FREE = {
  deepgram_en: ["en"],
  inworld_en: ["en"],
  deepgram_es: ["es"],
};

export const ALL_SUPPORTED_LANGUAGES = ["en", "es"];

export const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  hi: "Hindi",
  ar: "Arabic",
  he: "Hebrew",
};

export function getUnsupportedFreeTtsFeedbackMessage(lang: string): string {
  const norm = (lang || "").toLowerCase().split(/[-_]/)[0];
  const langLabel = LANGUAGE_DISPLAY_NAMES[norm] ? `${LANGUAGE_DISPLAY_NAMES[norm]} (${norm})` : norm || "this language";
  return `TTS for ${langLabel} is not provided free of charge on Cloudflare Workers AI (Free tier supports English and Spanish only). Please input your API key in /ai settings or choose Platform Credits to continue.`;
}

// Built-in speaker catalogs
export const DEEPGRAM_AURA_SPEAKERS = {
  // Requirement 8: ONLY English uses British RP accent
  narrator_british: "draco", // Draco is the premier British RP baritone narrator
  narrator_alt: "orpheus",
  female: ["luna", "stella", "athena", "hera", "thalia", "asteria"],
  male: ["orion", "arcas", "perseus", "angus", "helios", "zeus"],
};

export const DEEPGRAM_AURA_ES_SPEAKERS = {
  narrator_native: "nestor",
  female: ["celeste", "estrella", "carina", "diana", "selena"],
  male: ["nestor", "sirio", "alvaro", "aquila", "javier"],
};

export const INWORLD_SPEAKERS = {
  // English British RP narrator for Inworld
  narrator_british: "Oliver",
  // Standard neutral narrator for other languages (NO British RP accent!)
  narrator_native: "Dennis",
  female: [
    "Loretta", "Darlene", "Marlene", "Evelyn", "Celeste", "Pippa",
    "Tessa", "Abby", "Serena", "Anjali", "Saarvi", "Claire", "Jessica", "Lauren"
  ],
  male: [
    "Dennis", "Hank", "Liam", "Callum", "Hamish", "Graham",
    "Rupert", "Mortimer", "Snik", "Arjun", "Oliver", "Simon",
    "Elliot", "James", "Gareth", "Vinny", "Ethan", "Tyler"
  ],
};

/**
 * Detect language from text script patterns and metadata
 */
export function detectLanguage(text: string, declaredLanguage?: string): string {
  const sample = (text || "").trim();

  if (sample.length > 0) {
    // 1. Non-Latin script sniffing from verbatim text
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(sample)) return "ja";
    if (/[\uac00-\ud7af]/.test(sample)) return "ko";
    if (/[\u4e00-\u9fa5]/.test(sample)) return "zh";
    if (/[\u0600-\u06ff]/.test(sample)) return "ar";
    if (/[\u0590-\u05ff]/.test(sample)) return "he";
    if (/[\u0400-\u04ff]/.test(sample)) return "ru";
    if (/[\u0900-\u097f]/.test(sample)) return "hi";

    // 2. Distinctive European characters & high-frequency word scoring
    if (/[ąćęłńóśźż]/i.test(sample)) return "pl";
    if (/[äöüß]/i.test(sample) && /\b(der|die|das|und|ist|nicht|mit|auf|für|von|sich|ein|eine)\b/i.test(sample)) return "de";
    if (/[ñ¿¡]/i.test(sample)) return "es";
    if (/[ãõ]/i.test(sample)) return "pt";
    if (/[œæ]/i.test(sample)) return "fr";

    const lower = ` ${sample.toLowerCase()} `;
    const countMatches = (re: RegExp) => (lower.match(re) || []).length;

    const frScore =
      countMatches(/\b(le|la|les|des|une|dans|pour|avec|sur|est|sont|pas|plus|comme|tout|mais|cette|mon|son|nous|vous|ils|elles|du|au|aux|je|tu|il|elle|se|ne|qui|que|matin|jour|nuit)\b/g) +
      (sample.match(/[àâçéèêëîïôûù]/gi)?.length || 0);
    const esScore =
      countMatches(/\b(el|la|los|las|una|unos|unas|del|al|con|por|para|como|pero|más|este|esta|todo|toda|son|está|están|hay|fue|era|muy|sin|sobre|entre|cuando|donde)\b/g) +
      (sample.match(/[áéíóúüñ¿¡]/gi)?.length || 0);
    const deScore =
      countMatches(/\b(der|die|das|den|dem|des|ein|eine|und|ist|sind|war|nicht|mit|auf|für|von|sich|auch|als|nach|wie|aber|wenn|nur|noch)\b/g) +
      (sample.match(/[äöüß]/gi)?.length || 0) * 2;
    const itScore =
      countMatches(/\b(il|lo|gli|uno|una|della|dei|degli|delle|nel|nella|con|non|più|sono|era|come|anche|questo|questa|tutto|tutti|suo|sua|perché|quando)\b/g) +
      (sample.match(/[àèéìíîòóùú]/gi)?.length || 0);
    const ptScore =
      countMatches(/\b(os|as|um|uma|uns|umas|do|da|dos|das|no|na|nos|nas|com|por|para|não|mais|como|mas|seu|sua|foi|são|está|muito|também)\b/g) +
      (sample.match(/[ãõáéíóúâêôç]/gi)?.length || 0);
    const nlScore =
      countMatches(/\b(de|het|een|van|en|het|niet|voor|met|zijn|aan|ook|naar|maar|bij|nog|uit)\b/g);

    const enScore =
      countMatches(/\b(the|and|that|have|for|not|with|you|this|but|his|from|they|she|her|would|there|their|what|about|which|when|into)\b/g);

    const scores: Array<[string, number]> = [
      ["fr", frScore],
      ["es", esScore],
      ["de", deScore],
      ["it", itScore],
      ["pt", ptScore],
      ["nl", nlScore],
      ["en", enScore],
    ];
    scores.sort((a, b) => b[1] - a[1]);
    if (scores[0][1] >= 2 && scores[0][1] > enScore) {
      return scores[0][0];
    }
    if (enScore >= 2) {
      return "en";
    }

    // Fallback to diacritics if text is very short
    if (/[àâçèêëîïôûùÿ]/i.test(sample)) return "fr";
    if (/[áíóúü]/i.test(sample)) return "es";
    if (/[äöüß]/i.test(sample)) return "de";
  }

  if (declaredLanguage && typeof declaredLanguage === "string") {
    const norm = declaredLanguage.trim().toLowerCase().split(/[-_]/)[0];
    if (norm && norm.length >= 2) return norm;
  }

  return "en";
}

/**
 * Validates if the language is supported by the free plan models (English and Spanish only)
 */
export function isLanguageSupportedFree(lang: string): boolean {
  const norm = (lang || "en").toLowerCase().split(/[-_]/)[0];
  return norm === "en" || norm === "es";
}

/**
 * Language router for Free Plan TTS
 * - English -> @cf/deepgram/aura-2-en, fallback to @cf/inworld/tts-1.5-max
 * - Spanish -> @cf/deepgram/aura-2-es
 * - Other languages -> null (not provided free of charge)
 */
export function resolveFreeTtsModel(lang: string): {
  model: string;
  fallbackModel?: string;
  provider: "deepgram" | "deepgram_es" | "inworld";
  fallbackProvider?: "inworld";
} | null {
  const norm = (lang || "en").toLowerCase().split(/[-_]/)[0];

  if (norm === "en") {
    return {
      model: "@cf/deepgram/aura-2-en",
      fallbackModel: "@cf/inworld/tts-1.5-max",
      provider: "deepgram",
      fallbackProvider: "inworld",
    };
  }

  if (norm === "es") {
    return {
      model: "@cf/deepgram/aura-2-es",
      provider: "deepgram_es",
    };
  }

  return null;
}

/**
 * Requirement 4: Send TTS only the verbatim event.text.
 * Never include delivery, emotion tags, character names, or JSON.
 */
export function extractVerbatimTtsText(rawInput: string | null | undefined): string {
  if (!rawInput) return "";
  let text = String(rawInput);

  // 1. Strip HTML tags and entities
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<\/?[a-z0-9]+[^>]*>/gi, " ");
  text = text.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");

  // 2. Strip JSON if wrapped
  if (text.trim().startsWith("{") && text.trim().endsWith("}")) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.text) text = String(parsed.text);
      else if (parsed.dialogue) text = String(parsed.dialogue);
      else if (parsed.content) text = String(parsed.content);
    } catch (_) {}
  }

  // 3. Strip character prefix (e.g. "Narrator: ", "Protagonist: ", "c1: ", "Alice: ")
  text = text.replace(/^(?:narrator|protagonist|companion|hero|c\d+|[a-zA-Z0-9_\-\s]{1,20})\s*:\s*/i, "");

  // 4. Strip bracketed emotion tags (e.g. [happy], [whisper], [sad], [laugh], [sigh])
  text = text.replace(/\[\s*(?:happy|sad|angry|whisper|shout|excited|fearful|surprised|sigh|laugh|cry|gasp|[a-z0-9_\-\s]+)\s*\]/gi, "");

  // 5. Strip parenthetical delivery directions (e.g. (whispering quietly), (sighs), (in tears))
  text = text.replace(/\([a-zA-Z0-9_\-\s,.'"]+\)/g, "");

  // 6. Strip stage action asterisks (e.g. *chuckle*, *cough*)
  text = text.replace(/\*[a-zA-Z0-9_\-\s,.'"]+\*/g, "");

  // 7. Normalize whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/**
 * Requirement 6: Character voices on the free plan:
 * Map each character to a distinct built-in speaker of the active model
 * and store the mapping in the book's character bible.
 *
 * Requirement 8: ONLY English uses British RP accent.
 */
export function getOrAssignFreeSpeaker(
  characterId: string,
  charMeta: { gender?: string; age_group?: string; name?: string } | undefined,
  modelProvider: "deepgram" | "deepgram_es" | "inworld",
  language: string,
  characterBible?: CharacterBible
): string {
  const isEnglish = (language || "en").toLowerCase().startsWith("en");
  const isNarrator = characterId === "narrator" || !characterId;
  const mappingKey = `${modelProvider}:${characterId}`;

  // Initialize voice mappings on character bible if not present
  if (characterBible && !characterBible.voice_mappings) {
    characterBible.voice_mappings = {};
  }

  // 1. Check existing mapping in character bible
  if (characterBible?.voice_mappings?.[mappingKey]) {
    return characterBible.voice_mappings[mappingKey];
  }

  // 2. Deepgram Aura-2 English Speakers (@cf/deepgram/aura-2-en)
  if (modelProvider === "deepgram") {
    if (isNarrator) {
      // Requirement 8: British RP for English narrator
      const narratorSpeaker = DEEPGRAM_AURA_SPEAKERS.narrator_british; // "draco"
      if (characterBible) characterBible.voice_mappings[mappingKey] = narratorSpeaker;
      return narratorSpeaker;
    }

    const gender = (charMeta?.gender || "").toLowerCase();
    const isFemale = gender.includes("female") || gender.includes("woman") || gender.includes("girl");

    const pool = isFemale ? DEEPGRAM_AURA_SPEAKERS.female : DEEPGRAM_AURA_SPEAKERS.male;
    const assignedSoFar = Object.values(characterBible?.voice_mappings || {});

    const available = pool.filter((spk) => !assignedSoFar.includes(spk));
    const chosen = available.length > 0 ? available[0] : pool[Math.floor(Math.random() * pool.length)];

    if (characterBible) {
      characterBible.voice_mappings[mappingKey] = chosen;
      if (characterBible.characters && characterBible.characters[characterId]) {
        characterBible.characters[characterId].assigned_voice = {
          provider: "workers_ai",
          voice_id: chosen,
          speaker_id: chosen,
          model: "@cf/deepgram/aura-2-en",
          accent: isEnglish ? "British RP" : "native",
        };
      }
    }
    return chosen;
  }

  // 3. Deepgram Aura-2 Spanish Speakers (@cf/deepgram/aura-2-es)
  if (modelProvider === "deepgram_es") {
    if (isNarrator) {
      const narratorSpeaker = DEEPGRAM_AURA_ES_SPEAKERS.narrator_native; // "nestor"
      if (characterBible) characterBible.voice_mappings[mappingKey] = narratorSpeaker;
      return narratorSpeaker;
    }

    const gender = (charMeta?.gender || "").toLowerCase();
    const isFemale = gender.includes("female") || gender.includes("woman") || gender.includes("girl");
    const pool = isFemale ? DEEPGRAM_AURA_ES_SPEAKERS.female : DEEPGRAM_AURA_ES_SPEAKERS.male;
    const assignedSoFar = Object.values(characterBible?.voice_mappings || {});
    const available = pool.filter((spk) => !assignedSoFar.includes(spk));
    const chosen = available.length > 0 ? available[0] : pool[Math.floor(Math.random() * pool.length)];

    if (characterBible) {
      characterBible.voice_mappings[mappingKey] = chosen;
      if (characterBible.characters && characterBible.characters[characterId]) {
        characterBible.characters[characterId].assigned_voice = {
          provider: "workers_ai",
          voice_id: chosen,
          speaker_id: chosen,
          model: "@cf/deepgram/aura-2-es",
          accent: "native",
        };
      }
    }
    return chosen;
  }

  // 4. Inworld TTS 1.5 Max Speakers (@cf/inworld/tts-1.5-max)
  if (modelProvider === "inworld") {
    if (isNarrator) {
      const narratorVoice = isEnglish
        ? INWORLD_SPEAKERS.narrator_british
        : INWORLD_SPEAKERS.narrator_native;

      if (characterBible) characterBible.voice_mappings[mappingKey] = narratorVoice;
      return narratorVoice;
    }

    const gender = (charMeta?.gender || "").toLowerCase();
    const isFemale = gender.includes("female") || gender.includes("woman") || gender.includes("girl");
    const pool = isFemale ? INWORLD_SPEAKERS.female : INWORLD_SPEAKERS.male;

    const assignedSoFar = Object.values(characterBible?.voice_mappings || {});
    const available = pool.filter((spk) => !assignedSoFar.includes(spk));
    const chosen = available.length > 0 ? available[0] : pool[Math.floor(Math.random() * pool.length)];

    if (characterBible) {
      characterBible.voice_mappings[mappingKey] = chosen;
      if (characterBible.characters && characterBible.characters[characterId]) {
        characterBible.characters[characterId].assigned_voice = {
          provider: "workers_ai",
          voice_id: chosen,
          speaker_id: chosen,
          model: "@cf/inworld/tts-1.5-max",
          accent: isEnglish ? "British RP" : "native",
        };
      }
    }
    return chosen;
  }

  return "draco";
}

export interface SniffedAudioResult {
  buffer: Buffer;
  contentType: "audio/mpeg" | "audio/wav" | "audio/ogg" | "audio/flac";
  extension: "mp3" | "wav" | "ogg" | "flac";
  magicBytesHex: string;
  byteLength: number;
}

/**
 * Requirement 3: Normalize model output in Worker / server:
 * Accept ReadableStream, ArrayBuffer, Uint8Array, or JSON with base64 "audio" field.
 * Sniff magic bytes to set correct Content-Type (mp3/wav/ogg/flac).
 * If unrecognized, throw and log the first 16 bytes in hex.
 */
export async function normalizeAndSniffAudio(raw: any): Promise<SniffedAudioResult> {
  let buf: Buffer;

  if (Buffer.isBuffer(raw)) {
    buf = raw;
  } else if (raw instanceof Uint8Array) {
    buf = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  } else if (raw instanceof ArrayBuffer) {
    buf = Buffer.from(raw);
  } else if (typeof raw === "string") {
    const cleaned = raw.replace(/^data:audio\/[a-z0-9]+;base64,/i, "").trim();
    buf = Buffer.from(cleaned, "base64");
  } else if (raw && typeof raw.getReader === "function") {
    // ReadableStream reader
    const reader = raw.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    buf = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
  } else if (raw && typeof raw === "object") {
    const b64 =
      raw.audio ||
      raw.result?.audio ||
      (typeof raw.result === "string" ? raw.result : null);

    if (typeof b64 === "string") {
      buf = Buffer.from(b64, "base64");
    } else if (raw.result instanceof ArrayBuffer || raw.result instanceof Uint8Array) {
      buf = Buffer.from(raw.result);
    } else {
      throw new Error(`JSON response does not contain a base64 audio field: ${JSON.stringify(raw).slice(0, 120)}`);
    }
  } else {
    throw new Error(`Unsupported raw response type for audio normalization: ${typeof raw}`);
  }

  if (!buf || buf.length < 4) {
    const hex = buf ? Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join(" ") : "empty";
    console.error(`[Audio Sniffer] Audio buffer too small (${buf?.length || 0} bytes). First bytes: ${hex}`);
    throw new Error(`Audio buffer too small (${buf?.length || 0} bytes). Hex: ${hex}`);
  }

  const hex16 = Array.from(buf.slice(0, Math.min(16, buf.length)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");

  // 1. MP3 Detection:
  // - Starts with ID3v2 tag: "ID3" (0x49 0x44 0x33)
  // - Or MPEG-1/2 Audio Frame Sync: 11 bits set to 1 (0xFF followed by 0xE0 mask)
  const isId3 = buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33;
  const isMpegSync = buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) !== 0x00;

  if (isId3 || isMpegSync) {
    return {
      buffer: buf,
      contentType: "audio/mpeg",
      extension: "mp3",
      magicBytesHex: hex16,
      byteLength: buf.length,
    };
  }

  // 2. WAV Detection:
  // - "RIFF" (0x52 0x49 0x46 0x46) at offset 0
  // - "WAVE" (0x57 0x41 0x56 0x45) at offset 8
  const isRiff = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46;
  const isWave = buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45;
  if (isRiff && isWave) {
    return {
      buffer: buf,
      contentType: "audio/wav",
      extension: "wav",
      magicBytesHex: hex16,
      byteLength: buf.length,
    };
  }

  // 3. OGG Detection:
  // - "OggS" (0x4F 0x67 0x67 0x53)
  if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) {
    return {
      buffer: buf,
      contentType: "audio/ogg",
      extension: "ogg",
      magicBytesHex: hex16,
      byteLength: buf.length,
    };
  }

  // 4. FLAC Detection:
  // - "fLaC" (0x66 0x4C 0x61 0x43)
  if (buf[0] === 0x66 && buf[1] === 0x4c && buf[2] === 0x61 && buf[3] === 0x43) {
    return {
      buffer: buf,
      contentType: "audio/flac",
      extension: "flac",
      magicBytesHex: hex16,
      byteLength: buf.length,
    };
  }

  // If unrecognized, throw and log the first 16 bytes in hex
  console.error(`[Audio Sniffer Error] Unrecognized audio format. First 16 bytes: ${hex16}`);
  throw new Error(`Unrecognized audio format. First 16 bytes: ${hex16}`);
}
