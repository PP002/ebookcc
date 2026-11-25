/**
 * broadcastTypes.ts
 *
 * Data contracts and schemas for Audio Drama Broadcast pipeline:
 * - VisionResult (Stage 2)
 * - DirectorScript (Stage 3)
 * - CharacterBible (persistence across chapters)
 * - JobRecord (pipeline progress)
 */

export type BroadcastJobStatus =
  | "queued"
  | "extracting"
  | "vision"
  | "directing"
  | "voicing"
  | "scoring"
  | "ready"
  | "failed"
  | "degraded";

export type TTSProvider = "elevenlabs" | "openai" | "gemini" | "workers_ai";

// ─────────────────────────────────────────────
// Stage 1 Extraction Contracts
// ─────────────────────────────────────────────

export interface ExtractedTextLine {
  pageIndex: number;
  panelIndex: number;
  bbox?: [number, number, number, number]; // [x, y, w, h] normalized 0-1
  readingOrder: number;
  ocrConfidence: number;
  text: string;
}

export interface ExtractedPageData {
  pageIndex: number;
  imageDataUrl?: string; // downscaled max 1536px, JPEG 0.85
  lines: ExtractedTextLine[];
  width?: number;
  height?: number;
}

export interface ExtractionResult {
  bookType: "novel" | "comic";
  title: string;
  author?: string;
  language: string;
  chapterId?: string;
  pageRange: [number, number];
  chapterText?: string; // For novels
  pages?: ExtractedPageData[]; // For comics/image books
  sourceHash: string;
  hasNoText?: boolean;
}

// ─────────────────────────────────────────────
// Stage 2 Vision Analysis Contracts
// ─────────────────────────────────────────────

export interface VisionCharacter {
  id: string; // c1, c2, ...
  name: string | null;
  gender?: string | null;
  age_group?: string | null;
  appearance: string; // hair, clothing, build, distinctive features (max 25 words)
  expression?: string;
  body_language?: string;
}

export interface VisionBalloon {
  panel_index: number;
  reading_order: number;
  speaker: string; // character id, 'narrator', or 'unknown'
  text: string;
  ocr_correction?: string | null;
  volume: "whisper" | "normal" | "shout";
  emotion: string;
  bbox?: [number, number, number, number];
}

export interface VisionSoundEffect {
  panel_index: number;
  lettering: string;
  implied_sound: string;
}

export interface VisionPanel {
  panel_index: number;
  environment?: string;
  time_of_day?: string;
  weather?: string;
  tension_level?: string;
  characters_present: string[]; // character ids
  balloons: VisionBalloon[];
  sound_effects?: VisionSoundEffect[];
}

export interface VisionPage {
  page_index: number;
  panels: VisionPanel[];
}

export interface VisionResult {
  characters: VisionCharacter[];
  pages: VisionPage[];
  is_degraded?: boolean;
}

// ─────────────────────────────────────────────
// Stage 3 Director Script Contracts
// ─────────────────────────────────────────────

export interface AssignedVoice {
  provider: TTSProvider;
  voice_id: string;
  voice_design?: string;
  speaker_id?: string;
  model?: string;
  accent?: string;
}

export interface DirectorCharacter {
  id: string; // c1, c2, narrator
  name: string;
  gender: string;
  age_group: string;
  personality: string;
  voice_design: string; // ONE vivid English sentence
  assigned_voice?: AssignedVoice;
  is_muted?: boolean;
}

export interface DirectorEvent {
  id: string; // e1, e2...
  type: "dialogue" | "narration" | "sfx";
  character: string; // character id or 'narrator'
  text: string | null; // null for sfx
  emotion?: string; // neutral, happy, sad, angry, fearful, surprised, whisper, excited, etc.
  intensity?: number; // 0.0 - 1.0
  delivery?: string; // short physical stage direction in English
  pause_before_ms?: number;
  pause_after_ms?: number;
  overlap_with_previous?: boolean;
  sfx_prompt?: string;
  sfx_duration_sec?: number;
  sfx_offset_ms?: number;
  source?: {
    page?: number;
    panel?: number;
    paragraph?: number;
    sentence?: number;
    bbox?: [number, number, number, number];
  };
  audio_url?: string;
  audio_duration_ms?: number;
}

export interface DirectorScene {
  id: string;
  setting: string;
  mood: string;
  scene_summary: string;
  ambience_prompt?: string;
  bgm_prompt?: string; // Instrumental cue only
  bgm_loop?: boolean;
  bgm_url?: string;
  events: DirectorEvent[];
}

export interface DirectorScript {
  book_id: string;
  cache_key: string;
  chapter_id?: string;
  page_range?: [number, number];
  language: string;
  pipeline_version: string;
  characters: DirectorCharacter[];
  scenes: DirectorScene[];
  created_at: number;
  music_sfx_enabled?: boolean;
}

// ─────────────────────────────────────────────
// Character Bible (Cross-chapter persistence in R2)
// ─────────────────────────────────────────────

export interface CharacterBibleEntry {
  id: string;
  name: string;
  gender: string;
  age_group: string;
  personality: string;
  voice_design: string;
  assigned_voice: AssignedVoice;
  first_seen_chapter?: string;
}

export interface CharacterBible {
  book_id: string;
  characters: Record<string, CharacterBibleEntry>;
  voice_mappings?: Record<string, string>;
  updated_at: number;
}

// ─────────────────────────────────────────────
// Job Record
// ─────────────────────────────────────────────

export interface BroadcastJobRecord {
  job_id: string;
  user_id: string;
  cache_key: string;
  book_id: string;
  title: string;
  status: BroadcastJobStatus;
  progress: number; // 0 - 100
  status_text?: string;
  error?: string;
  created_at: number;
  cost_estimate: number;
  provider_used?: string;
  is_paid?: boolean;
  script?: DirectorScript;
  first_scene_ready?: boolean;
}
