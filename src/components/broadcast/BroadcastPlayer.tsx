/**
 * BroadcastPlayer.tsx
 *
 * Client-Side Audio Drama Player for the READ page:
 * - Authentication verification (prompts login if guest without blocking reader)
 * - Confirmation with remaining quota & cost estimate
 * - Progressive delivery (plays scene 1 as soon as available)
 * - 3-bus audio mixer controls (Voice, BGM, SFX)
 * - Live subtitles, character cast drawer with mute controls
 * - Reader page & panel highlight synchronization
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Radio,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Music,
  Sparkles,
  Users,
  Settings2,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Lock,
  ChevronDown,
  ChevronUp,
  Sliders,
  RotateCcw,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAppSettings } from "@/context/AppSettingsContext";
import { useLanguage } from "@/context/LanguageContext";
import { BROADCAST_CONFIG } from "@/lib/broadcastConfig";
import {
  BroadcastJobRecord,
  BroadcastJobStatus,
  DirectorCharacter,
  DirectorEvent,
  DirectorScene,
  DirectorScript,
  ExtractionResult,
} from "@/lib/broadcastTypes";
import { BroadcastAudioMixer } from "@/lib/broadcastAudioMixer";
import {
  extractComicBatch,
  extractNovelChapter,
  extractCurrentReaderText,
  generateBroadcastCacheKey,
  isImageUrl,
  isTableOfContentsOrFrontMatter,
  stripTableOfContentsAndFrontMatter,
} from "@/lib/broadcastExtractor";
import { toPlainText } from "@/lib/cleanPlainText";
import {
  detectLanguage,
  isLanguageSupportedFree,
  getUnsupportedFreeTtsFeedbackMessage,
} from "@/lib/broadcastTtsRouting";

export function isNovelBook(book: any): boolean {
  if (!book) return false;
  const fileType = (book.fileType || "").toLowerCase();
  const type = (book.type || "").toLowerCase();
  const contentType = (book.content_type || "").toLowerCase();
  const source = (book.source || "").toLowerCase();
  const id = typeof book.id === "string" ? book.id.toLowerCase() : "";

  if (
    fileType === "epub" ||
    fileType === "text" ||
    fileType === "txt" ||
    fileType === "docx" ||
    fileType === "novel" ||
    type === "novel" ||
    contentType === "novel" ||
    contentType === "epub" ||
    source === "gutenberg" ||
    id.startsWith("gutenberg-")
  ) {
    return true;
  }

  if (fileType === "comic" || fileType === "images" || contentType === "comic" || type === "comic" || source === "archive") {
    return false;
  }

  return false;
}

interface BroadcastPlayerProps {
  book: any;
  currentPage: number;
  chapterText?: string;
  chapterId?: string;
  pageUrls?: string[];
  readingDirection?: "ltr" | "rtl";
  isOpen: boolean;
  onClose: () => void;
  onNavigatePage?: (page: number) => void;
  onHighlightBBox?: (bbox: [number, number, number, number] | null) => void;
  onHighlightText?: (text: string | null, eventIndex?: number) => void;
  onExtractChapterText?: () => Promise<string> | string;
}

export function BroadcastPlayer({
  book,
  currentPage,
  chapterText,
  chapterId,
  pageUrls,
  readingDirection = "ltr",
  isOpen,
  onClose,
  onNavigatePage,
  onHighlightBBox,
  onHighlightText,
  onExtractChapterText,
}: BroadcastPlayerProps) {
  const { user, setShowAuthDialog, walletBalance, geminiApiKey } = useAppSettings();
  const { t, language } = useLanguage();

  // AI Settings & Workers AI Fallback State
  const [aiMainMode, setAiMainMode] = useState<"platform_credits" | "own_key">(() => {
    try {
      return localStorage.getItem("ai_main_billing_mode") === "own_key" ? "own_key" : "platform_credits";
    } catch {
      return "platform_credits";
    }
  });
  const [aiFeatureSettings, setAiFeatureSettings] = useState<Record<string, any>>(() => {
    try {
      const raw = localStorage.getItem("ai_feature_settings");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [hasServerApiKeys, setHasServerApiKeys] = useState<boolean>(false);
  const [hasTtsServerKey, setHasTtsServerKey] = useState<boolean>(false);

  // State Machine
  const [confirmed, setConfirmed] = useState(false);
  const [jobStatus, setJobStatus] = useState<BroadcastJobStatus>("queued");
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Script & Player Data
  const [script, setScript] = useState<DirectorScript | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const [activeEventIndex, setActiveEventIndex] = useState(0);
  const [currentEvent, setCurrentEvent] = useState<DirectorEvent | null>(null);
  const [currentScene, setCurrentScene] = useState<DirectorScene | null>(null);

  // Audio & Mixer state
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [bgmVolume, setBgmVolume] = useState<number>(BROADCAST_CONFIG.AUDIO_DEFAULTS.DEFAULT_BGM_GAIN);
  const [sfxVolume, setSfxVolume] = useState<number>(BROADCAST_CONFIG.AUDIO_DEFAULTS.DEFAULT_SFX_GAIN);
  const [isBgmOn, setIsBgmOn] = useState(true);
  const [isSfxOn, setIsSfxOn] = useState(true);
  const [mutedCharIds, setMutedCharIds] = useState<string[]>([]);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [showCastDrawer, setShowCastDrawer] = useState(false);
  const [showAudioControls, setShowAudioControls] = useState(false);
  const [costEstimate, setCostEstimate] = useState<number>(0.15);

  const mixerRef = useRef<BroadcastAudioMixer | null>(null);
  const pollingTimerRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Keep latest parent callbacks in refs so BroadcastAudioMixer is NEVER destroyed/recreated
  // when parent (Read.tsx) re-renders (e.g. when turning off subtitles and highlighting text).
  const onNavigatePageRef = useRef(onNavigatePage);
  onNavigatePageRef.current = onNavigatePage;
  const onHighlightBBoxRef = useRef(onHighlightBBox);
  onHighlightBBoxRef.current = onHighlightBBox;
  const onHighlightTextRef = useRef(onHighlightText);
  onHighlightTextRef.current = onHighlightText;
  const onExtractChapterTextRef = useRef(onExtractChapterText);
  onExtractChapterTextRef.current = onExtractChapterText;

  // Initialize Audio Mixer ONCE on mount (never tear down on prop/callback re-renders)
  useEffect(() => {
    const mixer = new BroadcastAudioMixer({
      onEventStart: (event, sIdx, eIdx) => {
        setActiveSceneIndex(sIdx);
        setActiveEventIndex(eIdx);
        setCurrentEvent(event);

        // Highlight sync for comic panels or novel pages
        if (event.source?.page !== undefined && onNavigatePageRef.current) {
          onNavigatePageRef.current(event.source.page);
        }
        if (event.source?.bbox && onHighlightBBoxRef.current) {
          onHighlightBBoxRef.current(event.source.bbox);
        } else if (onHighlightBBoxRef.current) {
          onHighlightBBoxRef.current(null);
        }
      },
      onSceneChange: (scene, sIdx) => {
        setActiveSceneIndex(sIdx);
        setCurrentScene(scene);
      },
      onPlaybackComplete: () => {
        setIsPlaying(false);
        if (onHighlightBBoxRef.current) onHighlightBBoxRef.current(null);
        if (onHighlightTextRef.current) onHighlightTextRef.current(null);
      },
      onError: (err) => {
        console.error("[Broadcast Player] Mixer playback error:", err);
      },
    });

    mixerRef.current = mixer;

    return () => {
      mixer.destroy();
      mixerRef.current = null;
      if (pollingTimerRef.current) clearTimeout(pollingTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // Synchronize book text highlight and follow when subtitles are turned off
  useEffect(() => {
    const highlightFn = onHighlightTextRef.current;
    if (!highlightFn) return;
    if (
      isOpen &&
      jobStatus === "ready" &&
      !showSubtitles &&
      currentEvent &&
      currentEvent.type !== "sfx" &&
      currentEvent.text
    ) {
      highlightFn(toPlainText(currentEvent.text), activeSceneIndex * 1000 + activeEventIndex);
    } else {
      highlightFn(null);
    }
  }, [isOpen, jobStatus, showSubtitles, currentEvent, activeSceneIndex, activeEventIndex]);

  // Reset playback pause when drawer closes, and sync AI settings when opened
  useEffect(() => {
    if (!isOpen) {
      mixerRef.current?.pause();
      setIsPlaying(false);
      onHighlightTextRef.current?.(null);
      return;
    }

    try {
      const savedMain = localStorage.getItem("ai_main_billing_mode");
      if (savedMain === "own_key" || savedMain === "platform_credits") {
        setAiMainMode(savedMain);
      }
      const savedFeat = localStorage.getItem("ai_feature_settings");
      if (savedFeat) {
        setAiFeatureSettings(JSON.parse(savedFeat));
      }
    } catch (_) {}

    if (user?.uid) {
      fetch(`/api/ai/user-settings`, {
        headers: { "x-user-id": user.uid },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          if (data.mainMode === "own_key" || data.mainMode === "platform_credits") {
            setAiMainMode(data.mainMode);
          }
          if (data.featureSettings) {
            setAiFeatureSettings(data.featureSettings);
          }
          if (data.maskedKeys && typeof data.maskedKeys === "object") {
            setHasServerApiKeys(Object.keys(data.maskedKeys).length > 0);
            setHasTtsServerKey(Boolean(data.maskedKeys.elevenlabs || data.maskedKeys.openai));
          }
        })
        .catch(() => {});
    }
  }, [isOpen, user?.uid]);

  const ttsSectionMode = aiFeatureSettings?.tts?.mode || aiMainMode;
  const isTtsOwnKey = ttsSectionMode === "own_key" && hasTtsServerKey;
  const isUsingPlatformCredits =
    ttsSectionMode === "platform_credits" &&
    (walletBalance > 0 || Boolean((user as any)?.is_paid || (user as any)?.plan === "paid"));
  const isWorkersAiFallback = !isUsingPlatformCredits && !isTtsOwnKey;

  // Compute cost estimate
  useEffect(() => {
    const isNovel = isNovelBook(book);
    if (!isNovel && pageUrls && pageUrls.length > 0) {
      const pageCount = Math.min(
        pageUrls.length - currentPage,
        BROADCAST_CONFIG.LIMITS.DEFAULT_PAGES_PER_BATCH
      );
      setCostEstimate(Math.max(1, pageCount) * BROADCAST_CONFIG.QUOTAS.ESTIMATED_COST_PER_PAGE_USD);
    } else {
      setCostEstimate(BROADCAST_CONFIG.QUOTAS.ESTIMATED_COST_PER_CHAPTER_USD);
    }
  }, [book, pageUrls, currentPage]);

  /**
   * Start Broadcast Generation
   */
  const handleStartBroadcast = async () => {
    if (!user) {
      setShowAuthDialog(true);
      return;
    }

    setConfirmed(true);
    setJobStatus("extracting");
    setProgressPercent(10);
    setStatusMessage("Extracting content and formatting for audio production...");
    setErrorMessage(null);

    try {
      let extraction: ExtractionResult;
      const isNovel = isNovelBook(book);

      // Novels do NOT require the use of visual models to analyze images (such as book covers and illustrations).
      if (isNovel) {
        let text = chapterText ? stripTableOfContentsAndFrontMatter(chapterText) : "";

        // If chapterText is empty, short, an image URL, or a Table of Contents, dynamically extract Chapter 1 from reader
        if (!text || text.length < 150 || isImageUrl(text) || isTableOfContentsOrFrontMatter(text)) {
          if (onExtractChapterTextRef.current) {
            try {
              const dyn = await onExtractChapterTextRef.current();
              const cleanDyn = dyn ? stripTableOfContentsAndFrontMatter(dyn) : "";
              if (cleanDyn && cleanDyn.length >= 80 && !isImageUrl(cleanDyn)) {
                text = cleanDyn;
              }
            } catch (_) {}
          }
        }

        if (!text || text.length < 80 || isImageUrl(text) || isTableOfContentsOrFrontMatter(text)) {
          const domText = extractCurrentReaderText();
          const cleanDom = domText ? stripTableOfContentsAndFrontMatter(domText) : "";
          if (cleanDom && cleanDom.length >= 80 && !isImageUrl(cleanDom)) {
            text = cleanDom;
          }
        }

        if (!text || text.trim().length < 25 || isImageUrl(text)) {
          setJobStatus("failed");
          setErrorMessage(
            "Could not extract chapter text from the current book yet. Please wait for the chapter page to finish loading (or flip past the cover/table of contents page) and retry."
          );
          return;
        }

        extraction = await extractNovelChapter({
          bookTitle: book?.title || "Novel",
          bookAuthor: book?.author,
          chapterText: text,
          chapterId: chapterId || `chap_${currentPage}`,
          chapterIndex: currentPage,
          language,
        });
      } else {
        // Comic / Manga / Graphic novel extraction using visual models and OCR
        // If on page 0 (cover), auto-navigate reader to page 1
        if (currentPage === 0 && pageUrls && pageUrls.length > 1 && onNavigatePage) {
          onNavigatePage(1);
        }

        const urls = (pageUrls || []).filter((u) => typeof u === "string" && u.trim().length > 0);
        extraction = await extractComicBatch({
          bookTitle: book?.title || "Comic Book",
          bookAuthor: book?.author,
          pageUrls: urls,
          currentPageIndex: currentPage,
          readingDirection,
          language,
          onProgress: (pct, msg) => {
            setProgressPercent(pct);
            setStatusMessage(msg);
          },
        });

        // Skip to generate of non-text books (such as non-ocr-result comics)
        if (
          extraction.hasNoText ||
          !extraction.pages ||
          extraction.pages.length === 0 ||
          extraction.pages.every((p) => !p.lines || p.lines.length === 0)
        ) {
          console.warn("[Broadcast] No dialogue or OCR text found in this comic; skipping generation.");
          setJobStatus("failed");
          setErrorMessage(
            "No speech or dialogue detected in this comic (OCR found no text). Non-text books or silent comics cannot be broadcast as audio drama."
          );
          return;
        }
      }

      // If using free Cloudflare Workers AI fallback, verify language support (English & Spanish only)
      const sampleTextForLang =
        extraction.bookType === "novel"
          ? String(extraction.chapterText || "")
          : (extraction.pages || [])
              .flatMap((p) => (p.lines || []).map((l) => l.text || ""))
              .join(" ");
      const detectedLang = detectLanguage(sampleTextForLang, extraction.language);
      if (isWorkersAiFallback && !isLanguageSupportedFree(detectedLang)) {
        setJobStatus("failed");
        setErrorMessage(getUnsupportedFreeTtsFeedbackMessage(detectedLang));
        return;
      }

      // Compute deterministic cache key
      const rangeId =
        extraction.bookType === "comic"
          ? `${extraction.pageRange[0]}-${extraction.pageRange[1]}`
          : extraction.chapterId || `chap_${currentPage}`;
      const cacheKey = await generateBroadcastCacheKey(extraction.sourceHash, rangeId, language);

      setProgressPercent(35);
      setStatusMessage(
        isUsingPlatformCredits
          ? "Checking shared audio drama cache..."
          : "Checking local audio drama cache..."
      );

      // 0. Check local browser cache first
      const localCachedScript = loadLocalBroadcastScript(cacheKey);
      if (localCachedScript) {
        const cleanLocalScript = sanitizeScriptPlainText(localCachedScript);
        setScript(cleanLocalScript);
        setJobStatus("ready");
        setProgressPercent(100);
        setStatusMessage("Loaded from local cache!");
        mixerRef.current?.loadScript(cleanLocalScript);
        setCurrentScene(cleanLocalScript.scenes[0] || null);
        setCurrentEvent(cleanLocalScript.scenes[0]?.events[0] || null);
        mixerRef.current?.play().then(() => setIsPlaying(true));
        return;
      }

      // Submit or fetch cached job
      const res = await fetch("/api/broadcast/job", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(user.uid ? { "x-user-id": user.uid } : {}),
        },
        body: JSON.stringify({
          cache_key: cacheKey,
          book_id: book?.id || book?.title || "book",
          title: book?.title || "Broadcast",
          extraction,
          user_id: user.uid || user.email,
          email: user.email,
          is_paid: isUsingPlatformCredits,
          use_platform_credits: isUsingPlatformCredits,
          ai_main_mode: aiMainMode,
          ai_feature_settings: aiFeatureSettings,
          client_keys: {
            google: geminiApiKey?.trim() || undefined,
          },
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.status === "failed" || data.error) {
        setJobStatus("failed");
        setErrorMessage(data.error || `HTTP ${res.status}: Failed to submit broadcast job`);
        return;
      }

      // Immediate / cached script ready
      if (data.cached && data.script) {
        const cleanCachedScript = sanitizeScriptPlainText(data.script);
        if (!isUsingPlatformCredits) {
          saveLocalBroadcastScript(cacheKey, cleanCachedScript);
        }
        setScript(cleanCachedScript);
        setJobStatus("ready");
        setProgressPercent(100);
        setStatusMessage(
          isUsingPlatformCredits ? "Loaded from shared cache!" : "Saved to local cache!"
        );
        mixerRef.current?.loadScript(cleanCachedScript);
        setCurrentScene(cleanCachedScript.scenes[0] || null);
        setCurrentEvent(cleanCachedScript.scenes[0]?.events[0] || null);
        // Auto play on ready
        mixerRef.current?.play().then(() => setIsPlaying(true));
        return;
      }

      // New Job: Poll until ready
      const jobId = data.job_id;
      setJobStatus("directing");
      setStatusMessage("Directing scenes and character voices...");
      pollJobProgress(jobId, cacheKey, isUsingPlatformCredits);
    } catch (err: any) {
      console.error("[Broadcast] Extraction/Start Error:", err);
      setJobStatus("failed");
      setErrorMessage(err.message || "Failed to initialize audio drama broadcast");
    }
  };

  /**
   * Local browser storage helpers for non-Platform-Credits plans
   */
  const LOCAL_BROADCAST_PREFIX = "ebookcc_local_broadcast_";

  const loadLocalBroadcastScript = (cacheKey: string): DirectorScript | null => {
    try {
      const raw = localStorage.getItem(`${LOCAL_BROADCAST_PREFIX}${cacheKey}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as DirectorScript;
      const allEvents = (parsed?.scenes || []).flatMap((sc) => sc.events || []);
      if (allEvents.length === 0) return null;
      const hasWav = allEvents.some(
        (ev) => typeof ev.audio_url === "string" && ev.audio_url.toLowerCase().endsWith(".wav")
      );
      const isStub =
        allEvents.length === 1 &&
        typeof allEvents[0]?.text === "string" &&
        allEvents[0].text.trim().endsWith("The narrative begins.");
      const combinedText = allEvents.map((ev) => ev.text || "").join("\n");
      const isTocScript = isTableOfContentsOrFrontMatter(combinedText);
      if (hasWav || isStub || isTocScript) {
        localStorage.removeItem(`${LOCAL_BROADCAST_PREFIX}${cacheKey}`);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  };

  const saveLocalBroadcastScript = (cacheKey: string, inScript: DirectorScript) => {
    try {
      localStorage.setItem(`${LOCAL_BROADCAST_PREFIX}${cacheKey}`, JSON.stringify(inScript));
    } catch (_) {
      // If localStorage quota is full, evict oldest local broadcast entries
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(LOCAL_BROADCAST_PREFIX)) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.slice(0, Math.max(1, Math.ceil(keysToRemove.length / 2))).forEach((k) => {
          localStorage.removeItem(k);
        });
        localStorage.setItem(`${LOCAL_BROADCAST_PREFIX}${cacheKey}`, JSON.stringify(inScript));
      } catch {}
    }
  };

  /**
   * Sanitizes script events to ensure plain text subtitles and speech,
   * and strips any legacy .wav URLs
   */
  const sanitizeScriptPlainText = (inScript: DirectorScript): DirectorScript => {
    if (!inScript || !Array.isArray(inScript.scenes)) return inScript;
    return {
      ...inScript,
      scenes: inScript.scenes.map((sc) => ({
        ...sc,
        events: (sc.events || []).map((ev) => ({
          ...ev,
          text: ev.text ? toPlainText(ev.text) : ev.text,
          audio_url:
            typeof ev.audio_url === "string" && ev.audio_url.toLowerCase().endsWith(".wav")
              ? undefined
              : ev.audio_url,
        })),
      })),
    };
  };

  /**
   * Polls asynchronous job status until ready
   */
  const pollJobProgress = (jobId: string, cacheKey?: string, isPlatformCreditsPlan?: boolean) => {
    let attempts = 0;
    const poll = async () => {
      attempts++;
      try {
        const res = await fetch(`/api/broadcast/job/${jobId}`);
        if (res.ok) {
          const job: BroadcastJobRecord = await res.json();
          setJobStatus(job.status);
          setProgressPercent(job.progress);
          setStatusMessage(job.status_text || "Processing audio drama...");

          if (job.status === "ready" && job.script) {
            const cleanScript = sanitizeScriptPlainText(job.script);
            if (!isPlatformCreditsPlan && (cacheKey || cleanScript.cache_key)) {
              saveLocalBroadcastScript(cacheKey || cleanScript.cache_key, cleanScript);
            }
            setScript(cleanScript);
            mixerRef.current?.loadScript(cleanScript);
            setCurrentScene(cleanScript.scenes[0] || null);
            setCurrentEvent(cleanScript.scenes[0]?.events[0] || null);
            mixerRef.current?.play().then(() => setIsPlaying(true));
            return;
          }

          if (job.status === "failed") {
            setErrorMessage(job.error || "Generation failed");
            return;
          }
        }
      } catch (e) {
        console.warn("[Broadcast] Poll retry:", e);
      }

      if (attempts < 60) {
        pollingTimerRef.current = setTimeout(poll, 2000);
      } else {
        setJobStatus("failed");
        setErrorMessage("Generation timed out. Please try again.");
      }
    };

    poll();
  };

  // Playback Control Handlers
  const handleTogglePlay = async () => {
    if (!mixerRef.current) return;
    if (isPlaying) {
      mixerRef.current.pause();
      setIsPlaying(false);
    } else {
      await mixerRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleNextEvent = () => {
    mixerRef.current?.nextEvent();
  };

  const handlePrevEvent = () => {
    mixerRef.current?.previousEvent();
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    mixerRef.current?.setPlaybackRate(speed);
  };

  const handleToggleBgm = () => {
    const next = !isBgmOn;
    setIsBgmOn(next);
    mixerRef.current?.toggleBgm(next);
  };

  const handleToggleSfx = () => {
    const next = !isSfxOn;
    setIsSfxOn(next);
    mixerRef.current?.toggleSfx(next);
  };

  const handleBgmVolume = (val: number) => {
    setBgmVolume(val);
    mixerRef.current?.setBgmVolume(val);
  };

  const handleSfxVolume = (val: number) => {
    setSfxVolume(val);
    mixerRef.current?.setSfxVolume(val);
  };

  const handleToggleMuteCharacter = (charId: string) => {
    if (!mixerRef.current) return;
    const isMutedNow = mixerRef.current.toggleCharacterMute(charId);
    setMutedCharIds((prev) =>
      isMutedNow ? [...prev, charId] : prev.filter((id) => id !== charId)
    );
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="fixed bottom-0 left-0 right-0 z-[65] pointer-events-auto flex flex-col items-center justify-end p-2 sm:p-4 select-none"
      >
        {/* Main Floating Broadcast Console */}
        <div className="w-full max-w-4xl bg-background/95 dark:bg-card/95 backdrop-blur-xl border border-border/80 shadow-2xl rounded-2xl overflow-hidden flex flex-col transition-all">
          {/* Header Bar */}
          <div className="px-4 py-2.5 bg-muted/40 border-b border-border/40 flex items-center justify-between text-xs font-medium">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                {isPlaying && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                )}
                <span
                  className={cn(
                    "relative inline-flex rounded-full h-2.5 w-2.5",
                    isPlaying ? "bg-primary" : "bg-muted-foreground/40"
                  )}
                />
              </span>
              <Radio className="w-4 h-4 text-primary" />
              <span className="font-semibold text-foreground tracking-wide uppercase text-[11px]">
                Broadcast Audio Drama
              </span>
              {currentScene && (
                <span className="text-muted-foreground truncate max-w-[200px] sm:max-w-md hidden sm:inline">
                  • {currentScene.setting} ({currentScene.mood})
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {script && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => setShowCastDrawer(!showCastDrawer)}
                    title="Character Voice Cast"
                  >
                    <Users className="w-3.5 h-3.5 mr-1" />
                    <span>Cast ({script.characters.length})</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => setShowAudioControls(!showAudioControls)}
                    title="Audio Mix Controls"
                  >
                    <Sliders className="w-3.5 h-3.5 mr-1" />
                    <span>Mix</span>
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground ml-1"
                onClick={onClose}
                title="Close Broadcast"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Body Content */}
          <div className="p-3 sm:p-4 flex flex-col gap-3">
            {/* 1. NOT LOGGED IN STATE */}
            {!user ? (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-2 px-1">
                <div className="flex items-center gap-3 text-left">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Lock className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">
                      Log in to use Broadcast
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Audio drama casting, voice acting and music scoring require an account. Reading remains completely free and unblocked.
                    </p>
                  </div>
                </div>
                <Button
                  onClick={() => setShowAuthDialog(true)}
                  className="w-full sm:w-auto shrink-0 shadow-sm font-semibold"
                >
                  Log In / Sign Up
                </Button>
              </div>
            ) : !confirmed ? (
              /* 2. CONFIRMATION & QUOTA PRE-CHECK */
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-2 px-1">
                <div className="flex items-center gap-3 text-left">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">
                      Generate Audio Drama for "{book?.title || "Current Selection"}"
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {isWorkersAiFallback
                        ? "Verbatim multi-character voice acting (Free tier: English & Spanish TTS • Music & SFX require API key or Platform Credits)."
                        : "Verbatim multi-character voice acting, dynamic BGM and sound effects."}
                      {isUsingPlatformCredits
                        ? ` • Platform Credits • Est. cost: ~$${costEstimate.toFixed(2)} USD`
                        : isWorkersAiFallback
                        ? " • Workers AI Fallback (Free • 10,000 Neurons/day)"
                        : " • Own API Key Mode (Workers AI fallback if needed)"}
                      {" • Daily quota: " + BROADCAST_CONFIG.QUOTAS.DAILY_BROADCAST_LIMIT + " runs."}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <Button variant="outline" size="sm" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleStartBroadcast} className="font-semibold shadow-sm">
                    Start Broadcast
                  </Button>
                </div>
              </div>
            ) : jobStatus !== "ready" && jobStatus !== "failed" ? (
              /* 3. PROGRESSIVE PIPELINE PROGRESS */
              <div className="py-3 px-2 flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-foreground font-medium">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span>{statusMessage || "Preparing audio drama broadcast..."}</span>
                  </div>
                  <span className="font-mono text-xs font-bold text-muted-foreground">
                    {progressPercent}%
                  </span>
                </div>
                {/* Progress bar */}
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                  <span>Pipeline: {jobStatus.toUpperCase()}</span>
                  <button
                    onClick={() => {
                      setConfirmed(false);
                      setJobStatus("queued");
                    }}
                    className="hover:underline text-destructive cursor-pointer"
                  >
                    Cancel Generation
                  </button>
                </div>
              </div>
            ) : jobStatus === "failed" ? (
              /* 4. ERROR STATE */
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 py-2 px-1 text-destructive">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <span className="text-xs font-medium leading-relaxed">
                    {errorMessage || "Audio Drama generation encountered an issue."}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                  {errorMessage &&
                    (errorMessage.toLowerCase().includes("api key") ||
                      errorMessage.toLowerCase().includes("platform credits")) && (
                      <>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => {
                            window.history.pushState({}, "", "/ai");
                            window.dispatchEvent(new PopStateEvent("popstate"));
                          }}
                          className="shrink-0 text-xs"
                        >
                          Input API Key (/ai)
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            window.history.pushState({}, "", "/billing");
                            window.dispatchEvent(new PopStateEvent("popstate"));
                          }}
                          className="shrink-0 text-xs"
                        >
                          Platform Credits
                        </Button>
                      </>
                    )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleStartBroadcast}
                    className="shrink-0 text-foreground text-xs"
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                    Retry
                  </Button>
                </div>
              </div>
            ) : (
              /* 5. ACTIVE PLAYER CONSOLE */
              <div className="flex flex-col gap-3">
                {/* Live Subtitle & Speaker Callout */}
                {showSubtitles && (
                  <div className="min-h-[52px] bg-muted/60 dark:bg-muted/30 rounded-xl p-3 border border-border/40 flex items-start gap-3 transition-all">
                    {currentEvent && (
                      <>
                        <div className="shrink-0 flex flex-col items-center">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-primary/15 text-primary border border-primary/20">
                            {currentEvent.character === "narrator"
                              ? "Narrator"
                              : script?.characters.find((c) => c.id === currentEvent.character)?.name ||
                                currentEvent.character}
                          </span>
                          {currentEvent.emotion && currentEvent.emotion !== "neutral" && (
                            <span className="text-[9px] text-muted-foreground mt-0.5 font-medium italic">
                              {currentEvent.emotion}
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-medium text-foreground leading-relaxed flex-1">
                          {currentEvent.type === "sfx" ? (
                            <span className="italic text-muted-foreground">
                              [Sound Effect: {toPlainText(currentEvent.sfx_prompt) || "Impact"}]
                            </span>
                          ) : (
                            toPlainText(currentEvent.text) || "..."
                          )}
                        </p>
                      </>
                    )}
                  </div>
                )}

                {/* Primary Player Controls */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  {/* Left: Speed selector */}
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground mr-1 hidden sm:inline">
                      Speed
                    </span>
                    {[0.75, 1.0, 1.25, 1.5].map((s) => (
                      <button
                        key={s}
                        onClick={() => handleSpeedChange(s)}
                        className={cn(
                          "px-2 py-0.5 text-[11px] font-bold rounded cursor-pointer transition-colors",
                          playbackSpeed === s
                            ? "bg-primary text-primary-foreground shadow-xs"
                            : "text-muted-foreground hover:bg-muted"
                        )}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>

                  {/* Center: Play/Pause/Skips */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-foreground"
                      onClick={handlePrevEvent}
                      title="Previous Line"
                    >
                      <SkipBack className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      className="h-10 w-10 rounded-full shadow-md"
                      onClick={handleTogglePlay}
                      title={isPlaying ? "Pause" : "Play"}
                    >
                      {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-foreground"
                      onClick={handleNextEvent}
                      title="Next Line"
                    >
                      <SkipForward className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Right: Subtitle & Audio toggles */}
                  <div className="flex items-center gap-1">
                    <Button
                      variant={showSubtitles ? "default" : "outline"}
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setShowSubtitles(!showSubtitles)}
                      title="Toggle Subtitles"
                    >
                      Subtitles
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Cast Drawer (Voice Timbre & Per-Character Mute) */}
            <AnimatePresence>
              {showCastDrawer && script && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-t border-border/40 pt-3 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                    <span>CAST & VOICE DESIGN</span>
                    <span>{script.characters.length} Voices Assigned</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                    {script.characters.map((char) => {
                      const isMuted = mutedCharIds.includes(char.id);
                      return (
                        <div
                          key={char.id}
                          className={cn(
                            "p-2.5 rounded-xl border text-xs flex items-center justify-between transition-all",
                            isMuted
                              ? "bg-muted/30 border-dashed border-border opacity-60"
                              : "bg-muted/60 border-border/60"
                          )}
                        >
                          <div className="flex-1 pr-2 truncate">
                            <div className="flex items-center gap-1.5 font-semibold text-foreground truncate">
                              <span>{char.name || char.id}</span>
                              <span className="text-[10px] text-muted-foreground font-normal">
                                ({char.gender}, {char.age_group})
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                              {char.voice_design}
                            </p>
                          </div>
                          <Button
                            variant={isMuted ? "destructive" : "ghost"}
                            size="sm"
                            className="h-7 px-2 text-[11px] shrink-0"
                            onClick={() => handleToggleMuteCharacter(char.id)}
                            title={isMuted ? "Unmute Voice" : "Mute Voice"}
                          >
                            {isMuted ? (
                              <VolumeX className="w-3.5 h-3.5 mr-1" />
                            ) : (
                              <Volume2 className="w-3.5 h-3.5 mr-1" />
                            )}
                            <span>{isMuted ? "Muted" : "Mute"}</span>
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Audio Mix Controls (BGM & SFX sliders) */}
            <AnimatePresence>
              {showAudioControls && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-t border-border/40 pt-3 flex flex-col gap-2.5"
                >
                  {script?.music_sfx_enabled === false && (
                    <div className="text-[11px] text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg border border-border/50 flex items-center justify-between gap-2">
                      <span>
                        Music and Sound Effects are not provided free of charge on the Workers AI free tier. Input an API key in{" "}
                        <a href="/ai" className="underline text-primary font-medium">
                          /ai
                        </a>{" "}
                        or choose Platform Credits to enable Music &amp; SFX.
                      </span>
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row gap-4">
                    {/* BGM Volume */}
                    <div
                      className={cn(
                        "flex-1 flex items-center gap-3 bg-muted/40 p-2.5 rounded-xl border border-border/40",
                        script?.music_sfx_enabled === false && "opacity-50 pointer-events-none"
                      )}
                    >
                      <Button
                        variant={isBgmOn && script?.music_sfx_enabled !== false ? "default" : "outline"}
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={handleToggleBgm}
                        disabled={script?.music_sfx_enabled === false}
                      >
                        <Music className="w-4 h-4" />
                      </Button>
                      <div className="flex-1 flex flex-col gap-1">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
                          <span>Background Music</span>
                          <span>
                            {script?.music_sfx_enabled === false ? "Disabled (Free Tier)" : `${Math.round(bgmVolume * 100)}%`}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={bgmVolume}
                          onChange={(e) => handleBgmVolume(parseFloat(e.target.value))}
                          disabled={!isBgmOn || script?.music_sfx_enabled === false}
                          className="w-full accent-primary h-1.5 bg-muted rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* SFX Volume */}
                    <div
                      className={cn(
                        "flex-1 flex items-center gap-3 bg-muted/40 p-2.5 rounded-xl border border-border/40",
                        script?.music_sfx_enabled === false && "opacity-50 pointer-events-none"
                      )}
                    >
                      <Button
                        variant={isSfxOn && script?.music_sfx_enabled !== false ? "default" : "outline"}
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={handleToggleSfx}
                        disabled={script?.music_sfx_enabled === false}
                      >
                        <Sparkles className="w-4 h-4" />
                      </Button>
                      <div className="flex-1 flex flex-col gap-1">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
                          <span>Sound Effects</span>
                          <span>
                            {script?.music_sfx_enabled === false ? "Disabled (Free Tier)" : `${Math.round(sfxVolume * 100)}%`}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={sfxVolume}
                          onChange={(e) => handleSfxVolume(parseFloat(e.target.value))}
                          disabled={!isSfxOn || script?.music_sfx_enabled === false}
                          className="w-full accent-primary h-1.5 bg-muted rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
