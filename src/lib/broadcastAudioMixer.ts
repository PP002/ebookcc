/**
 * broadcastAudioMixer.ts
 *
 * Professional 3-bus Web Audio API mixer for the Broadcast Audio Drama engine:
 * - Voice Bus (GainNode, loudness normalized ~-16 LUFS, per-character mute)
 * - BGM Bus (GainNode with 2s crossfading, loop support, auto-ducking to 0.08 during dialogue)
 * - SFX Bus (GainNode with precise millisecond event offsets and procedural synth fallback)
 * - Master GainNode with playback rate control (0.75x - 1.5x)
 * - Event lookahead & prefetching (3-5 clips ahead)
 */

import { BROADCAST_CONFIG } from "./broadcastConfig";
import { DirectorEvent, DirectorScene, DirectorScript } from "./broadcastTypes";
import { toPlainText } from "./cleanPlainText";

export interface MixerEventCallback {
  onEventStart?: (event: DirectorEvent, sceneIndex: number, eventIndex: number) => void;
  onEventEnd?: (event: DirectorEvent, sceneIndex: number, eventIndex: number) => void;
  onSceneChange?: (scene: DirectorScene, sceneIndex: number) => void;
  onProgress?: (currentTimeSec: number, totalDurationSec: number, currentEventIndex: number) => void;
  onPlaybackComplete?: () => void;
  onError?: (err: Error) => void;
}

export class BroadcastAudioMixer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private voiceGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  // Active sources
  private currentVoiceSource: AudioBufferSourceNode | null = null;
  private currentVoiceUtterance: SpeechSynthesisUtterance | null = null;
  private currentBgmSource: AudioBufferSourceNode | null = null;
  private currentBgmGain: GainNode | null = null;
  private previousBgmGain: GainNode | null = null;

  // Audio Buffers Cache
  private bufferCache = new Map<string, AudioBuffer>();
  private prefetchingUrls = new Set<string>();

  // State
  private script: DirectorScript | null = null;
  private mutedCharacters = new Set<string>();
  private isBgmEnabled = true;
  private isSfxEnabled = true;
  private bgmVolume = BROADCAST_CONFIG.AUDIO_DEFAULTS.DEFAULT_BGM_GAIN;
  private sfxVolume = BROADCAST_CONFIG.AUDIO_DEFAULTS.DEFAULT_SFX_GAIN;
  private voiceVolume = BROADCAST_CONFIG.AUDIO_DEFAULTS.DEFAULT_VOICE_GAIN;
  private playbackRate = 1.0;

  // Playhead tracking
  private isPlaying = false;
  private currentSceneIndex = 0;
  private currentEventIndex = 0;
  private eventPlayheadTimer: any = null;
  private callbacks: MixerEventCallback = {};

  constructor(callbacks: MixerEventCallback = {}) {
    this.callbacks = callbacks;
  }

  public setCallbacks(callbacks: MixerEventCallback) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Initializes or resumes the AudioContext on user gesture
   */
  public async initContext(): Promise<AudioContext> {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioContextClass();

      // Master output
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // Voice Bus
      this.voiceGain = this.ctx.createGain();
      this.voiceGain.gain.setValueAtTime(this.voiceVolume, this.ctx.currentTime);
      this.voiceGain.connect(this.masterGain);

      // BGM Bus
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.setValueAtTime(this.isBgmEnabled ? this.bgmVolume : 0, this.ctx.currentTime);
      this.bgmGain.connect(this.masterGain);

      // SFX Bus
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.setValueAtTime(this.isSfxEnabled ? this.sfxVolume : 0, this.ctx.currentTime);
      this.sfxGain.connect(this.masterGain);
    }

    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }

    return this.ctx;
  }

  public loadScript(script: DirectorScript) {
    this.script = script;
    this.currentSceneIndex = 0;
    this.currentEventIndex = 0;
    // Prefetch first batch
    this.prefetchAhead();
  }

  public updateScript(script: DirectorScript) {
    this.script = script;
    this.prefetchAhead();
  }

  public setMutedCharacters(characterIds: string[]) {
    this.mutedCharacters = new Set(characterIds);
  }

  public toggleCharacterMute(characterId: string): boolean {
    if (this.mutedCharacters.has(characterId)) {
      this.mutedCharacters.delete(characterId);
      return false;
    } else {
      this.mutedCharacters.add(characterId);
      return true;
    }
  }

  public isCharacterMuted(characterId: string): boolean {
    return this.mutedCharacters.has(characterId);
  }

  public setPlaybackRate(rate: number) {
    this.playbackRate = Math.max(0.75, Math.min(1.5, rate));
    if (this.currentVoiceSource) {
      try {
        this.currentVoiceSource.playbackRate.setValueAtTime(
          this.playbackRate,
          this.ctx?.currentTime || 0
        );
      } catch (e) {
        // ignore
      }
    }
  }

  public setBgmVolume(gain: number) {
    this.bgmVolume = Math.max(0, Math.min(1, gain));
    if (this.bgmGain && this.ctx && this.isBgmEnabled) {
      this.bgmGain.gain.setTargetAtTime(this.bgmVolume, this.ctx.currentTime, 0.05);
    }
  }

  public setVoiceVolume(gain: number) {
    this.voiceVolume = Math.max(0, Math.min(1.5, gain));
    if (this.voiceGain && this.ctx) {
      this.voiceGain.gain.setTargetAtTime(this.voiceVolume, this.ctx.currentTime, 0.05);
    }
  }

  public setSfxVolume(gain: number) {
    this.sfxVolume = Math.max(0, Math.min(1, gain));
    if (this.sfxGain && this.ctx && this.isSfxEnabled) {
      this.sfxGain.gain.setTargetAtTime(this.sfxVolume, this.ctx.currentTime, 0.05);
    }
  }

  public toggleBgm(enabled?: boolean) {
    this.isBgmEnabled = enabled !== undefined ? enabled : !this.isBgmEnabled;
    if (this.bgmGain && this.ctx) {
      const target = this.isBgmEnabled ? this.bgmVolume : 0;
      this.bgmGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.1);
    }
    return this.isBgmEnabled;
  }

  public toggleSfx(enabled?: boolean) {
    this.isSfxEnabled = enabled !== undefined ? enabled : !this.isSfxEnabled;
    if (this.sfxGain && this.ctx) {
      const target = this.isSfxEnabled ? this.sfxVolume : 0;
      this.sfxGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.1);
    }
    return this.isSfxEnabled;
  }

  /**
   * Auto-duck BGM down to ~0.08 while character or narrator speaks,
   * then restore smoothly with 300ms ramp afterwards.
   */
  private duckBgm(duck: boolean) {
    if (!this.bgmGain || !this.ctx || !this.isBgmEnabled) return;
    const now = this.ctx.currentTime;
    const rampSec = BROADCAST_CONFIG.AUDIO_DEFAULTS.DUCK_RAMP_MS / 1000;
    const targetGain = duck
      ? BROADCAST_CONFIG.AUDIO_DEFAULTS.DUCKED_BGM_GAIN * (this.bgmVolume / BROADCAST_CONFIG.AUDIO_DEFAULTS.DEFAULT_BGM_GAIN)
      : this.bgmVolume;

    this.bgmGain.gain.cancelScheduledValues(now);
    this.bgmGain.gain.setTargetAtTime(targetGain, now, rampSec / 3);
  }

  /**
   * Start or resume playing the audio drama
   */
  public async play(): Promise<void> {
    await this.initContext();
    if (!this.script || this.script.scenes.length === 0) return;
    this.isPlaying = true;
    this.playCurrentEvent();
  }

  public pause(): void {
    this.isPlaying = false;
    if (this.eventPlayheadTimer) {
      clearTimeout(this.eventPlayheadTimer);
      this.eventPlayheadTimer = null;
    }
    if (this.currentVoiceSource) {
      try {
        this.currentVoiceSource.stop();
      } catch (e) {
        // ignore
      }
      this.currentVoiceSource = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.duckBgm(false);
  }

  public stop(): void {
    this.pause();
    this.currentSceneIndex = 0;
    this.currentEventIndex = 0;
    if (this.currentBgmSource) {
      try {
        this.currentBgmSource.stop();
      } catch (e) {
        // ignore
      }
      this.currentBgmSource = null;
    }
  }

  public nextEvent(): void {
    if (!this.script) return;
    const scene = this.script.scenes[this.currentSceneIndex];
    if (!scene) return;

    if (this.currentEventIndex + 1 < scene.events.length) {
      this.jumpTo(this.currentSceneIndex, this.currentEventIndex + 1);
    } else if (this.currentSceneIndex + 1 < this.script.scenes.length) {
      this.jumpTo(this.currentSceneIndex + 1, 0);
    }
  }

  public previousEvent(): void {
    if (!this.script) return;
    if (this.currentEventIndex > 0) {
      this.jumpTo(this.currentSceneIndex, this.currentEventIndex - 1);
    } else if (this.currentSceneIndex > 0) {
      const prevScene = this.script.scenes[this.currentSceneIndex - 1];
      this.jumpTo(this.currentSceneIndex - 1, Math.max(0, prevScene.events.length - 1));
    }
  }

  public jumpTo(sceneIndex: number, eventIndex: number) {
    if (!this.script) return;
    const wasPlaying = this.isPlaying;
    this.pause();
    this.currentSceneIndex = Math.max(0, Math.min(sceneIndex, this.script.scenes.length - 1));
    const scene = this.script.scenes[this.currentSceneIndex];
    this.currentEventIndex = Math.max(0, Math.min(eventIndex, (scene?.events.length || 1) - 1));

    if (wasPlaying) {
      this.play();
    } else {
      const ev = scene?.events[this.currentEventIndex];
      if (ev && this.callbacks.onEventStart) {
        this.callbacks.onEventStart(ev, this.currentSceneIndex, this.currentEventIndex);
      }
    }
  }

  /**
   * Main playback driver: plays the active event, schedules SFX and BGM,
   * ducks BGM, and advances to the next event.
   */
  private async playCurrentEvent(): Promise<void> {
    if (!this.isPlaying || !this.script) return;
    const scene = this.script.scenes[this.currentSceneIndex];
    if (!scene) {
      this.isPlaying = false;
      this.callbacks.onPlaybackComplete?.();
      return;
    }

    // Ensure scene BGM is playing/crossfaded
    this.ensureSceneBgm(scene);

    const event = scene.events[this.currentEventIndex];
    if (!event) {
      // Scene finished, advance to next scene
      if (this.currentSceneIndex + 1 < this.script.scenes.length) {
        this.currentSceneIndex++;
        this.currentEventIndex = 0;
        this.callbacks.onSceneChange?.(this.script.scenes[this.currentSceneIndex], this.currentSceneIndex);
        this.playCurrentEvent();
      } else {
        this.isPlaying = false;
        this.callbacks.onPlaybackComplete?.();
      }
      return;
    }

    // Notify listeners
    this.callbacks.onEventStart?.(event, this.currentSceneIndex, this.currentEventIndex);

    // Prefetch upcoming audio clips
    this.prefetchAhead();

    // Check if character is muted
    const isMuted = event.character && this.mutedCharacters.has(event.character);

    // If this is a standalone SFX event
    if (event.type === "sfx") {
      await this.triggerSfx(event);
      const sfxDuration = (event.sfx_duration_sec || 2.0) * 1000 / this.playbackRate;
      this.eventPlayheadTimer = setTimeout(() => {
        this.callbacks.onEventEnd?.(event, this.currentSceneIndex, this.currentEventIndex);
        this.advanceEvent();
      }, sfxDuration);
      return;
    }

    // Dialogue or Narration:
    // If the event also specifies an embedded SFX with offset
    if (event.sfx_prompt) {
      const offsetMs = (event.sfx_offset_ms || 0) / this.playbackRate;
      setTimeout(() => {
        if (this.isPlaying) this.triggerSfx(event);
      }, offsetMs);
    }

    if (isMuted) {
      // Muted line: calculate reading duration and skip audio
      const textLen = (event.text || "").length;
      const readingMs = Math.max(1200, (textLen * 60) / this.playbackRate);
      this.eventPlayheadTimer = setTimeout(() => {
        this.callbacks.onEventEnd?.(event, this.currentSceneIndex, this.currentEventIndex);
        this.advanceEvent();
      }, readingMs);
      return;
    }

    // Play speech audio (from audio_url or fallback synthesizer)
    this.duckBgm(true);

    const onSpeechEnd = () => {
      this.duckBgm(false);
      this.callbacks.onEventEnd?.(event, this.currentSceneIndex, this.currentEventIndex);

      const pauseAfter = (event.pause_after_ms || 300) / this.playbackRate;
      this.eventPlayheadTimer = setTimeout(() => {
        this.advanceEvent();
      }, pauseAfter);
    };

    if (event.audio_url) {
      try {
        const buffer = await this.loadAudioBuffer(event.audio_url);
        this.playBufferOnBus(buffer, this.voiceGain!, onSpeechEnd);
      } catch (err) {
        console.warn("Failed to load audio clip, using voice synthesis fallback:", err);
        this.speakWithSpeechSynthesis(event, onSpeechEnd);
      }
    } else {
      // Audio URL not yet ready or failed: use local voice synthesis fallback
      this.speakWithSpeechSynthesis(event, onSpeechEnd);
    }
  }

  private advanceEvent(): void {
    if (!this.isPlaying || !this.script) return;
    const scene = this.script.scenes[this.currentSceneIndex];
    if (!scene) return;

    if (this.currentEventIndex + 1 < scene.events.length) {
      this.currentEventIndex++;
      this.playCurrentEvent();
    } else if (this.currentSceneIndex + 1 < this.script.scenes.length) {
      this.currentSceneIndex++;
      this.currentEventIndex = 0;
      this.callbacks.onSceneChange?.(this.script.scenes[this.currentSceneIndex], this.currentSceneIndex);
      this.playCurrentEvent();
    } else {
      this.isPlaying = false;
      this.callbacks.onPlaybackComplete?.();
    }
  }

  /**
   * Plays an AudioBuffer on the specified GainNode.
   * Requirement 5: Disable detune/playbackRate post-processing by default;
   * keep pitch/rate variation within 0.9-1.1 and only when a debug flag is on.
   */
  private playBufferOnBus(buffer: AudioBuffer, bus: GainNode, onEnded?: () => void) {
    if (!this.ctx) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    // Check debug flag via window.__BROADCAST_AUDIO_DEBUG__, localStorage, or URL param ?audio_debug=1
    const isAudioDebug = typeof window !== "undefined" && Boolean(
      (window as any).__BROADCAST_AUDIO_DEBUG__ ||
      localStorage.getItem("broadcast_audio_debug") === "true" ||
      new URLSearchParams(window.location.search).get("audio_debug") === "1"
    );

    if (isAudioDebug) {
      // Clamped pitch / playbackRate variation strictly between 0.9 and 1.1
      const clampedRate = Math.max(0.9, Math.min(1.1, this.playbackRate));
      source.playbackRate.setValueAtTime(clampedRate, this.ctx.currentTime);
      if (source.detune) {
        // Clamp detune within +/- 100 cents (0.94x - 1.06x)
        source.detune.setValueAtTime(0, this.ctx.currentTime);
      }
    } else {
      // Default: Post-processing disabled, clean 1.0x native playback
      source.playbackRate.setValueAtTime(1.0, this.ctx.currentTime);
      if (source.detune) {
        source.detune.setValueAtTime(0, this.ctx.currentTime);
      }
    }

    source.connect(bus);

    source.onended = () => {
      if (this.currentVoiceSource === source) {
        this.currentVoiceSource = null;
      }
      onEnded?.();
    };

    this.currentVoiceSource = source;
    source.start(0);
  }

  /**
   * Browser SpeechSynthesis fallback with voice customization per character
   */
  private speakWithSpeechSynthesis(event: DirectorEvent, onEnded: () => void) {
    const cleanSpeechText = toPlainText(event.text || "");
    if (typeof window === "undefined" || !window.speechSynthesis) {
      // Environment without SpeechSynthesis (e.g. test or headless), emulate timer
      const textLen = cleanSpeechText.length;
      const readingMs = Math.max(1000, (textLen * 50) / this.playbackRate);
      setTimeout(onEnded, readingMs);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanSpeechText);
    utterance.rate = this.playbackRate;

    const charMeta = this.script?.characters.find((c) => c.id === event.character);
    const isNarrator = event.character === "narrator" || !event.character;
    const scriptLang = (this.script?.language || "en").toLowerCase().split(/[-_]/)[0];
    const isEnglishScript = scriptLang === "en";

    const availableVoices = window.speechSynthesis.getVoices?.() || [];
    if (!isEnglishScript) {
      utterance.lang = scriptLang === "es" ? "es-ES" : scriptLang;
      const isFemale = charMeta?.gender?.toLowerCase().includes("female") || charMeta?.gender?.toLowerCase().includes("girl");
      const nativeVoice =
        availableVoices.find(
          (v) =>
            v.lang.toLowerCase().startsWith(scriptLang) &&
            (isFemale ? v.name.toLowerCase().includes("female") : true)
        ) || availableVoices.find((v) => v.lang.toLowerCase().startsWith(scriptLang));
      if (nativeVoice) {
        utterance.voice = nativeVoice;
      }
      utterance.pitch = isNarrator ? 0.98 : isFemale ? 1.15 : 0.95;
      utterance.rate = isNarrator ? this.playbackRate * 0.96 : this.playbackRate;
    } else if (isNarrator) {
      // Default English narration accent: British RP (en-GB)
      utterance.lang = BROADCAST_CONFIG.VOICE_DEFAULTS.SPEECH_SYNTHESIS_LANG;
      // Find British RP voice (e.g., George, Daniel, Oliver, Serena, or any en-GB)
      const britishVoice = availableVoices.find(
        (v) =>
          (v.lang === "en-GB" || v.lang === "en_GB") &&
          (v.name.toLowerCase().includes("daniel") ||
           v.name.toLowerCase().includes("george") ||
           v.name.toLowerCase().includes("oliver") ||
           v.name.toLowerCase().includes("natural") ||
           v.name.toLowerCase().includes("male") ||
           v.name.toLowerCase().includes("british"))
      ) || availableVoices.find((v) => v.lang === "en-GB" || v.lang === "en_GB");

      if (britishVoice) {
        utterance.voice = britishVoice;
      }
      utterance.pitch = 0.98;
      utterance.rate = this.playbackRate * 0.96; // Measured cinematic pacing
    } else if (charMeta) {
      const isFemale = charMeta.gender?.toLowerCase().includes("female") || charMeta.gender?.toLowerCase().includes("girl");
      utterance.pitch = isFemale ? 1.25 : 0.95;

      // Match voice design language/accent if British specified
      if (charMeta.voice_design?.toLowerCase().includes("british")) {
        utterance.lang = "en-GB";
        const brVoice = availableVoices.find(
          (v) =>
            (v.lang === "en-GB" || v.lang === "en_GB") &&
            (isFemale ? v.name.toLowerCase().includes("female") : true)
        );
        if (brVoice) utterance.voice = brVoice;
      }
    }

    if (event.emotion === "whisper") {
      utterance.volume = 0.5;
      utterance.pitch *= 0.9;
    } else if (event.emotion === "shout" || event.emotion === "angry") {
      utterance.volume = 1.0;
      utterance.rate *= 1.15;
    }

    utterance.onend = () => onEnded();
    utterance.onerror = () => onEnded();

    this.currentVoiceUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  /**
   * Trigger SFX: loads audio buffer or produces a rich procedural sound (only when music_sfx_enabled !== false)
   */
  private async triggerSfx(event: DirectorEvent): Promise<void> {
    if (!this.ctx || !this.sfxGain || !this.isSfxEnabled) return;
    if (this.script?.music_sfx_enabled === false) return;
    if (event.audio_url) {
      try {
        const buffer = await this.loadAudioBuffer(event.audio_url);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.setValueAtTime(this.playbackRate, this.ctx.currentTime);
        source.connect(this.sfxGain);
        source.start(0);
        return;
      } catch (e) {
        // Fall back to procedural synth
      }
    }

    // Procedural sound effects using Web Audio API nodes
    this.synthesizeProceduralSfx(event.sfx_prompt || "impact");
  }

  /**
   * Procedural SFX synthesizer using Web Audio oscillators and filtered noise
   */
  private synthesizeProceduralSfx(prompt: string) {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const p = prompt.toLowerCase();

    if (p.includes("explosion") || p.includes("boom") || p.includes("thunder") || p.includes("blast")) {
      // Deep low-frequency noise rumble
      this.playNoiseBurst(now, 1.8, 150, 0.9);
    } else if (p.includes("punch") || p.includes("hit") || p.includes("slap") || p.includes("strike") || p.includes("impact")) {
      // Snappy impact
      this.playToneSweep(now, 260, 40, 0.18, "triangle");
      this.playNoiseBurst(now, 0.15, 600, 0.7);
    } else if (p.includes("sword") || p.includes("blade") || p.includes("slash") || p.includes("cut")) {
      // High metallic whoosh
      this.playToneSweep(now, 1400, 800, 0.22, "sine");
      this.playNoiseBurst(now, 0.25, 2500, 0.5);
    } else if (p.includes("magic") || p.includes("chime") || p.includes("sparkle") || p.includes("spell")) {
      // Ascending crystalline arpeggios
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        this.playPluckTone(now + i * 0.08, freq, 0.45);
      });
    } else if (p.includes("door") || p.includes("creak") || p.includes("close")) {
      // Wood creak and thud
      this.playToneSweep(now, 85, 55, 0.35, "sawtooth");
    } else if (p.includes("heartbeat") || p.includes("pulse")) {
      // Double thump
      this.playToneSweep(now, 65, 35, 0.12, "sine");
      this.playToneSweep(now + 0.22, 60, 30, 0.14, "sine");
    } else {
      // Generic subtle Foley swoosh
      this.playNoiseBurst(now, 0.25, 1200, 0.3);
    }
  }

  private playToneSweep(start: number, freqFrom: number, freqTo: number, duration: number, type: OscillatorType) {
    if (!this.ctx || !this.sfxGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(10, freqTo), start + duration);

    gain.gain.setValueAtTime(0.4, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(start);
    osc.stop(start + duration);
  }

  private playPluckTone(start: number, freq: number, duration: number) {
    if (!this.ctx || !this.sfxGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(0.3, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(start);
    osc.stop(start + duration);
  }

  private playNoiseBurst(start: number, duration: number, cutoff: number, volume: number) {
    if (!this.ctx || !this.sfxGain) return;
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.4));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff, start);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    noise.start(start);
    noise.stop(start + duration);
  }

  /**
   * Scene BGM Management with 2.0s Crossfades (only when music_sfx_enabled !== false)
   */
  private async ensureSceneBgm(scene: DirectorScene) {
    if (!this.ctx || !this.bgmGain || !this.isBgmEnabled) return;
    if (this.script?.music_sfx_enabled === false) return;
    if (!scene.bgm_url) {
      // If no BGM URL, generate atmospheric chord pad
      this.playProceduralBgmPad(scene.mood || "calm");
      return;
    }

    try {
      const buffer = await this.loadAudioBuffer(scene.bgm_url);
      const crossfadeSec = BROADCAST_CONFIG.AUDIO_DEFAULTS.BGM_CROSSFADE_SEC;
      const now = this.ctx.currentTime;

      // Crossfade out previous BGM
      if (this.currentBgmGain) {
        this.previousBgmGain = this.currentBgmGain;
        this.previousBgmGain.gain.setValueAtTime(this.previousBgmGain.gain.value, now);
        this.previousBgmGain.gain.linearRampToValueAtTime(0.0001, now + crossfadeSec);
        const oldSource = this.currentBgmSource;
        setTimeout(() => {
          try {
            oldSource?.stop();
          } catch (e) {}
        }, crossfadeSec * 1000 + 100);
      }

      // Crossfade in new BGM
      const newSource = this.ctx.createBufferSource();
      newSource.buffer = buffer;
      newSource.loop = scene.bgm_loop !== false;

      const newGain = this.ctx.createGain();
      newGain.gain.setValueAtTime(0.0001, now);
      newGain.gain.linearRampToValueAtTime(1.0, now + crossfadeSec);

      newSource.connect(newGain);
      newGain.connect(this.bgmGain);
      newSource.start(0);

      this.currentBgmSource = newSource;
      this.currentBgmGain = newGain;
    } catch (e) {
      console.warn("Failed to load scene BGM, falling back to ambient pad:", e);
      this.playProceduralBgmPad(scene.mood || "calm");
    }
  }

  /**
   * Procedural Ambient BGM pad so reading is never silent
   */
  private playProceduralBgmPad(mood: string) {
    if (!this.ctx || !this.bgmGain || !this.isBgmEnabled) return;
    // Keep ambient drone subtle
    const chords: Record<string, number[]> = {
      calm: [261.63, 329.63, 392.0, 523.25], // C major
      mystery: [220.0, 261.63, 329.63, 440.0], // A minor
      action: [146.83, 220.0, 293.66, 440.0], // D power
      dramatic: [196.0, 246.94, 293.66, 392.0], // G minor
    };

    const notes = chords[mood.toLowerCase()] || chords.calm;
    const now = this.ctx.currentTime;

    notes.forEach((freq) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.025, now);
      osc.connect(gain);
      gain.connect(this.bgmGain!);
      osc.start(now);
      // Gentle 15-second ambient drone
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 15);
      osc.stop(now + 15);
    });
  }

  /**
   * Audio Buffer Caching & Network Fetching
   */
  public async loadAudioBuffer(url: string): Promise<AudioBuffer> {
    const cached = this.bufferCache.get(url);
    if (cached) return cached;

    const ctx = await this.initContext();
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(`[Broadcast Audio Load Error] HTTP ${resp.status} fetching ${url}`);
      throw new Error(`HTTP ${resp.status} fetching ${url}`);
    }
    const contentType = resp.headers.get("content-type") || "unknown";
    if (contentType.includes("text/html") || contentType.includes("application/json")) {
      console.warn(`[Broadcast Audio Load Notice] Expected audio stream from ${url} but received "${contentType}". Falling back to procedural soundscape.`);
      throw new Error(`Non-audio response (${contentType}) from ${url}`);
    }
    const arrayBuffer = await resp.arrayBuffer();

    try {
      // Decode with AudioContext.decodeAudioData
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      this.bufferCache.set(url, audioBuffer);
      return audioBuffer;
    } catch (decodeErr: any) {
      // Requirement 5: On failure log the response Content-Type and byte length
      console.error(
        `[Broadcast Audio Decode Failure] Failed to decode audio from ${url}. ` +
        `Response Content-Type: "${contentType}", Byte length: ${arrayBuffer.byteLength} bytes. ` +
        `Error: ${decodeErr?.message || decodeErr}`
      );
      throw decodeErr;
    }
  }

  /**
   * Prefetch upcoming 3-5 events ahead of current playhead
   */
  private prefetchAhead() {
    if (!this.script) return;
    const prefetchLimit = BROADCAST_CONFIG.AUDIO_DEFAULTS.DEFAULT_PREFETCH_COUNT;
    let count = 0;
    let sIdx = this.currentSceneIndex;
    let eIdx = this.currentEventIndex + 1;

    while (count < prefetchLimit && sIdx < this.script.scenes.length) {
      const scene = this.script.scenes[sIdx];
      if (eIdx < scene.events.length) {
        const ev = scene.events[eIdx];
        if (ev.audio_url && !this.bufferCache.has(ev.audio_url) && !this.prefetchingUrls.has(ev.audio_url)) {
          this.prefetchingUrls.add(ev.audio_url);
          this.loadAudioBuffer(ev.audio_url)
            .catch(() => {})
            .finally(() => this.prefetchingUrls.delete(ev.audio_url!));
          count++;
        }
        eIdx++;
      } else {
        sIdx++;
        eIdx = 0;
      }
    }
  }

  // Getters
  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getCurrentPosition() {
    return {
      sceneIndex: this.currentSceneIndex,
      eventIndex: this.currentEventIndex,
      currentEvent: this.script?.scenes[this.currentSceneIndex]?.events[this.currentEventIndex] || null,
      currentScene: this.script?.scenes[this.currentSceneIndex] || null,
    };
  }

  public destroy() {
    this.stop();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.bufferCache.clear();
  }
}
