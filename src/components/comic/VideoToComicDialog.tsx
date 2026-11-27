import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Film,
  CheckCircle2,
  Sliders,
  Sparkles,
  Trash2,
  Check,
  CheckSquare,
  Square,
  Eye,
} from 'lucide-react';
import {
  extractVideoKeyframes,
  runGlobalStage2AndStage3,
  captureKeyframesForClusters,
  paginateKeyframesTo6PanelPages,
  ExtractedKeyframe,
  ComicPageData,
  VideoProcessingProgress,
  SimilarityStrictness,
  VideoExtractionDebugReport,
  CachedAnalysisSession,
  ClusterSummaryRecord,
  VIDEO_TO_COMIC_CONFIG,
} from '@/lib/videoToComic';
import { useLanguage } from '@/context/LanguageContext';
import {
  VIDEO_TO_COMIC_TRANSLATIONS,
  formatVideoComicTemplate,
} from '@/data/videoToComicTranslations';
import { toast } from 'sonner';

interface VideoToComicDialogProps {
  isOpen: boolean;
  onClose: () => void;
  videoFile: File | null;
  onComplete: (newPages: ComicPageData[], keyframes: ExtractedKeyframe[]) => void;
}

const STRICTNESS_LEVELS: SimilarityStrictness[] = ['loose', 'balanced', 'strict'];

export const VideoToComicDialog: React.FC<VideoToComicDialogProps> = ({
  isOpen,
  onClose,
  videoFile,
  onComplete,
}) => {
  const { language } = useLanguage();
  const copy =
    VIDEO_TO_COMIC_TRANSLATIONS[language] || VIDEO_TO_COMIC_TRANSLATIONS.en;
  const copyRef = useRef(copy);
  useEffect(() => {
    copyRef.current = copy;
  }, [copy]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<VideoProcessingProgress>({
    phase: 'init',
    percent: 0,
    statusText: '',
  });
  const [statusMode, setStatusMode] = useState<
    'preparing' | 'initializing' | 'live' | 'reclustered' | 'ready' | 'empty'
  >('preparing');

  const [extractedKeyframes, setExtractedKeyframes] = useState<ExtractedKeyframe[]>([]);
  const [cachedSession, setCachedSession] = useState<CachedAnalysisSession | null>(null);
  const [activeClusters, setActiveClusters] = useState<ClusterSummaryRecord[]>([]);
  const [needsStage4Capture, setNeedsStage4Capture] = useState<boolean>(false);

  // Individual Preview window state & multi-select state for deleting unwanted frames
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [selectedClusterIds, setSelectedClusterIds] = useState<Set<number>>(
    () => new Set()
  );
  const lastClickedIdxRef = useRef<number | null>(null);

  const [strictness, setStrictness] = useState<SimilarityStrictness>('balanced');
  const [simThresholdOverrideInput, setSimThresholdOverrideInput] = useState<string>('');
  const [protectSubtitles, setProtectSubtitles] = useState<boolean>(
    VIDEO_TO_COMIC_CONFIG.subtitle.protectSubtitlesDefault
  );
  const [analysisReport, setAnalysisReport] =
    useState<VideoExtractionDebugReport | null>(null);

  const isCancelledRef = useRef<boolean>(false);
  const activeRunIdRef = useRef<number>(0);
  const startedFileRef = useRef<File | null>(null);
  const onCompleteRef = useRef(onComplete);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const parsedSimOverride = useMemo(() => {
    const trimmed = simThresholdOverrideInput.trim();
    if (!trimmed) return null;
    const val = parseFloat(trimmed);
    return Number.isFinite(val) && val > 0 ? val : null;
  }, [simThresholdOverrideInput]);

  // Map full-res captured keyframes by clusterId so previews show crisp frames
  const keyframeByClusterId = useMemo(() => {
    const map = new Map<number, ExtractedKeyframe>();
    for (const kf of extractedKeyframes) {
      if (typeof kf.clusterId === 'number') {
        map.set(kf.clusterId, kf);
      }
    }
    return map;
  }, [extractedKeyframes]);

  const applyKeyframesToCanvas = useCallback(
    (keyframes: ExtractedKeyframe[], file: File) => {
      if (keyframes.length === 0) {
        toast.error(copyRef.current.toasts.noKeyframesToApply);
        return;
      }
      const pages = paginateKeyframesTo6PanelPages(keyframes, {
        baseTitle: file.name.replace(/\.[^/.]+$/, ''),
      });
      setIsPreviewOpen(false);
      onCompleteRef.current(pages, keyframes);
      onCloseRef.current();
    },
    []
  );

  /**
   * Re-runs ONLY Stage 3 (and Stage 2 clear check) instantaneously on cached Stage 1 signatures
   * without re-decoding the video!
   */
  const rerunStage3OnCachedSignatures = useCallback(
    (
      session: CachedAnalysisSession,
      nextStrictness: SimilarityStrictness,
      nextOverride: number | null,
      nextProtectSub: boolean
    ) => {
      const { clusters, report } = runGlobalStage2AndStage3(session.signatures, {
        strictness: nextStrictness,
        simThresholdOverride: nextOverride,
        protectSubtitles: nextProtectSub,
        sampleStepSec: session.sampleStepSec,
        durationSec: session.durationSec,
      });
      setActiveClusters(clusters);
      setSelectedClusterIds(new Set());
      lastClickedIdxRef.current = null;
      setAnalysisReport(report);
      setNeedsStage4Capture(true);
      setStatusMode(clusters.length > 0 ? 'reclustered' : 'empty');
      setProgress({
        phase: 'complete',
        percent: 100,
        statusText: '',
        candidatesFound: clusters.length,
      });
    },
    []
  );

  const startInitialConversion = useCallback(
    async (file: File) => {
      const runId = ++activeRunIdRef.current;
      isCancelledRef.current = false;
      setIsProcessing(true);
      setIsPreviewOpen(false);
      setExtractedKeyframes([]);
      setCachedSession(null);
      setActiveClusters([]);
      setSelectedClusterIds(new Set());
      lastClickedIdxRef.current = null;
      setAnalysisReport(null);
      setNeedsStage4Capture(false);
      setStatusMode('initializing');
      setProgress({
        phase: 'init',
        percent: 0,
        statusText: '',
      });

      try {
        const keyframes = await extractVideoKeyframes(file, {
          stepSeconds: VIDEO_TO_COMIC_CONFIG.sampling.defaultStepSeconds,
          strictness,
          simThresholdOverride: parsedSimOverride,
          protectSubtitles,
          includeDebugThumbnails: true,
          isCancelled: () =>
            isCancelledRef.current || activeRunIdRef.current !== runId,
          onAnalysisCached: (session) => {
            if (activeRunIdRef.current === runId) {
              setCachedSession(session);
            }
          },
          onDebugReport: (report) => {
            if (activeRunIdRef.current === runId) {
              setAnalysisReport(report);
              setActiveClusters(report.clusters);
              setSelectedClusterIds(new Set());
              lastClickedIdxRef.current = null;
            }
          },
          onProgress: (p) => {
            if (activeRunIdRef.current === runId) {
              setStatusMode('live');
              setProgress(p);
            }
          },
        });

        if (isCancelledRef.current || activeRunIdRef.current !== runId) return;

        setExtractedKeyframes(keyframes);
        setIsProcessing(false);

        if (keyframes.length === 0) {
          setStatusMode('empty');
          toast.error(copyRef.current.toasts.noClearKeyframes);
          return;
        }

        setStatusMode('ready');
        setProgress({
          phase: 'complete',
          percent: 100,
          statusText: '',
          candidatesFound: keyframes.length,
        });

        toast.success(
          formatVideoComicTemplate(copyRef.current.toasts.extractedReady, {
            count: keyframes.length,
            pages: Math.ceil(keyframes.length / 6),
          })
        );
      } catch (err: any) {
        if (activeRunIdRef.current !== runId) return;
        setIsProcessing(false);
        if (isCancelledRef.current) {
          toast.info(copyRef.current.toasts.cancelled);
        } else {
          toast.error(
            formatVideoComicTemplate(copyRef.current.toasts.conversionFailed, {
              error: err?.message || copyRef.current.toasts.unknownError,
            })
          );
        }
      }
    },
    [strictness, parsedSimOverride, protectSubtitles]
  );

  // Auto-run Stage 1..4 once when opened with a new video file (always waits for manual Apply)
  useEffect(() => {
    if (isOpen && videoFile) {
      if (startedFileRef.current === videoFile) {
        return;
      }
      startedFileRef.current = videoFile;
      startInitialConversion(videoFile);
    } else if (!isOpen) {
      startedFileRef.current = null;
      isCancelledRef.current = true;
      activeRunIdRef.current++;
      setIsProcessing(false);
      setIsPreviewOpen(false);
      setSelectedClusterIds(new Set());
      lastClickedIdxRef.current = null;
    }
  }, [isOpen, videoFile, startInitialConversion]);

  // Handle instant Stage 3 re-clustering when user adjusts strictness, numeric override, or subtitle protection
  const handleStrictnessChange = (nextStrictness: SimilarityStrictness) => {
    setStrictness(nextStrictness);
    if (cachedSession) {
      rerunStage3OnCachedSignatures(
        cachedSession,
        nextStrictness,
        parsedSimOverride,
        protectSubtitles
      );
    }
  };

  const handleOverrideChange = (rawVal: string) => {
    setSimThresholdOverrideInput(rawVal);
    const trimmed = rawVal.trim();
    const num = trimmed ? parseFloat(trimmed) : null;
    const validOverride =
      num !== null && Number.isFinite(num) && num > 0 ? num : null;
    if (cachedSession) {
      rerunStage3OnCachedSignatures(
        cachedSession,
        strictness,
        validOverride,
        protectSubtitles
      );
    }
  };

  const handleProtectSubtitlesChange = (checked: boolean) => {
    setProtectSubtitles(checked);
    if (cachedSession) {
      rerunStage3OnCachedSignatures(
        cachedSession,
        strictness,
        parsedSimOverride,
        checked
      );
    }
  };

  // Multi-select toggle (supports Shift+Click for range selection)
  const handleToggleFrameSelection = (
    clusterId: number,
    index: number,
    shiftKey: boolean
  ) => {
    if (isProcessing) return;
    setSelectedClusterIds((prev) => {
      const next = new Set(prev);
      if (
        shiftKey &&
        lastClickedIdxRef.current !== null &&
        lastClickedIdxRef.current >= 0 &&
        lastClickedIdxRef.current < activeClusters.length
      ) {
        const start = Math.min(lastClickedIdxRef.current, index);
        const end = Math.max(lastClickedIdxRef.current, index);
        const shouldSelect = !prev.has(clusterId);
        for (let i = start; i <= end; i++) {
          const cid = activeClusters[i]?.clusterId;
          if (cid !== undefined) {
            if (shouldSelect) {
              next.add(cid);
            } else {
              next.delete(cid);
            }
          }
        }
      } else {
        if (next.has(clusterId)) {
          next.delete(clusterId);
        } else {
          next.add(clusterId);
        }
      }
      return next;
    });
    lastClickedIdxRef.current = index;
  };

  const handleSelectAllOrClear = () => {
    if (isProcessing || activeClusters.length === 0) return;
    if (selectedClusterIds.size === activeClusters.length) {
      setSelectedClusterIds(new Set());
    } else {
      setSelectedClusterIds(new Set(activeClusters.map((c) => c.clusterId)));
    }
    lastClickedIdxRef.current = null;
  };

  const handleDeleteSelectedFrames = () => {
    if (isProcessing || selectedClusterIds.size === 0) return;
    const deleteCount = selectedClusterIds.size;
    const remainingClusters = activeClusters.filter(
      (c) => !selectedClusterIds.has(c.clusterId)
    );
    const remainingKeyframes = extractedKeyframes
      .filter(
        (kf) =>
          kf.clusterId === undefined || !selectedClusterIds.has(kf.clusterId)
      )
      .map((kf, idx) => ({ ...kf, index: idx }));

    setActiveClusters(remainingClusters);
    setExtractedKeyframes(remainingKeyframes);
    setSelectedClusterIds(new Set());
    lastClickedIdxRef.current = null;

    if (remainingClusters.length === 0) {
      setStatusMode('empty');
    } else if (needsStage4Capture) {
      setStatusMode('reclustered');
    } else {
      setStatusMode('ready');
    }

    toast.success(
      formatVideoComicTemplate(copy.toasts.deletedFrames, {
        count: deleteCount,
      })
    );
  };

  const handleApplyOrCapture = async () => {
    if (!videoFile) return;

    // If Stage 3 was re-clustered on cached signatures, run Stage 4 full-res capture for the remaining clusters
    if (needsStage4Capture && cachedSession && activeClusters.length > 0) {
      const runId = ++activeRunIdRef.current;
      isCancelledRef.current = false;
      setIsPreviewOpen(false);
      setIsProcessing(true);
      setStatusMode('live');
      try {
        const kfs = await captureKeyframesForClusters(
          videoFile,
          cachedSession,
          activeClusters,
          analysisReport?.sharpnessFloor ?? 0,
          {
            isCancelled: () =>
              isCancelledRef.current || activeRunIdRef.current !== runId,
            onProgress: (p) => {
              if (activeRunIdRef.current === runId) {
                setProgress(p);
              }
            },
          }
        );
        if (isCancelledRef.current || activeRunIdRef.current !== runId) return;
        setExtractedKeyframes(kfs);
        setNeedsStage4Capture(false);
        setIsProcessing(false);
        applyKeyframesToCanvas(kfs, videoFile);
      } catch (err: any) {
        if (activeRunIdRef.current !== runId) return;
        setIsProcessing(false);
        toast.error(
          formatVideoComicTemplate(copyRef.current.toasts.captureFailed, {
            error: err?.message || copyRef.current.toasts.unknownError,
          })
        );
      }
      return;
    }

    // Filter extractedKeyframes against activeClusters in case frames were deleted
    const activeIds = new Set(activeClusters.map((c) => c.clusterId));
    const keyframesToApply =
      activeIds.size > 0
        ? extractedKeyframes
            .filter(
              (kf) => kf.clusterId === undefined || activeIds.has(kf.clusterId)
            )
            .map((kf, idx) => ({ ...kf, index: idx }))
        : [];

    applyKeyframesToCanvas(keyframesToApply, videoFile);
  };

  const handleCancel = () => {
    isCancelledRef.current = true;
    activeRunIdRef.current++;
    startedFileRef.current = null;
    setIsProcessing(false);
    setIsPreviewOpen(false);
    onCloseRef.current();
  };

  const strictnessLabels: Record<SimilarityStrictness, string> = {
    loose: copy.strictnessLoose,
    balanced: copy.strictnessBalanced,
    strict: copy.strictnessStrict,
  };

  const strictnessSliderIdx = STRICTNESS_LEVELS.indexOf(strictness);
  const displayedFrameCount = activeClusters.length;
  const displayedPageCount = Math.ceil(Math.max(1, displayedFrameCount) / 6);

  // Maintain exact original video aspect ratio in previews
  const videoWidth = cachedSession?.videoWidth || 16;
  const videoHeight = cachedSession?.videoHeight || 9;
  const videoAspectRatio = videoWidth / Math.max(1, videoHeight);
  const previewGridColsClass =
    videoAspectRatio < 0.85
      ? 'grid-cols-4 sm:grid-cols-5'
      : 'grid-cols-3 sm:grid-cols-4';

  // Localized status text derived from current stage & progress
  const localizedStatusText = useMemo(() => {
    if (statusMode === 'preparing') return copy.status.preparing;
    if (statusMode === 'initializing') return copy.status.initializing;
    if (statusMode === 'empty') return copy.status.noFramesLeft;
    if (statusMode === 'reclustered') {
      return formatVideoComicTemplate(copy.status.reclustered, {
        count: displayedFrameCount,
        pages: Math.ceil(displayedFrameCount / 6),
      });
    }
    if (statusMode === 'ready') {
      return formatVideoComicTemplate(copy.status.ready, {
        count: displayedFrameCount,
        pages: Math.ceil(displayedFrameCount / 6),
      });
    }
    if (progress.phase === 'scanning') {
      const scanPct =
        progress.currentStep && progress.totalSteps
          ? Math.min(
              100,
              Math.round((progress.currentStep / progress.totalSteps) * 100)
            )
          : Math.min(100, Math.round((progress.percent / 62) * 100));
      return formatVideoComicTemplate(copy.status.scanning, {
        percent: scanPct,
      });
    }
    if (progress.phase === 'refining') return copy.status.refining;
    if (progress.phase === 'extracting') {
      return formatVideoComicTemplate(copy.status.extracting, {
        current: progress.currentStep ?? 0,
        total: progress.totalSteps ?? displayedFrameCount,
      });
    }
    if (progress.phase === 'complete') {
      return formatVideoComicTemplate(copy.status.ready, {
        count: displayedFrameCount,
        pages: Math.ceil(displayedFrameCount / 6),
      });
    }
    return copy.status.initializing;
  }, [statusMode, progress, copy, displayedFrameCount]);

  const localizedPhaseLabel =
    copy.phases[progress.phase] || progress.phase;

  const selectedCount = selectedClusterIds.size;
  const allSelected =
    activeClusters.length > 0 && selectedCount === activeClusters.length;

  return (
    <>
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open && !isPreviewOpen) handleCancel();
        }}
      >
        <DialogContent
          dir={language === 'ar' ? 'rtl' : 'ltr'}
          className="w-[min(calc(100vw-2rem),560px)] max-w-none sm:max-w-none h-auto max-h-[88vh] bg-card border-border shadow-2xl p-4 sm:p-5 overflow-hidden flex flex-col gap-3"
        >
        <DialogHeader className="min-w-0 shrink-0 pr-7">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <Film className="w-4 h-4" />
            </div>
            <DialogTitle className="text-base font-semibold truncate">
              {copy.title}
            </DialogTitle>
          </div>
        </DialogHeader>

        {videoFile && (
          <div className="min-h-0 flex flex-col gap-2.5 overflow-y-auto pr-0.5 min-w-0">
            {/* Video metadata banner */}
            <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/40 border border-border/60 text-xs min-w-0 shrink-0 overflow-hidden">
              <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                <Film className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span
                  className="font-semibold text-foreground truncate block min-w-0"
                  title={videoFile.name}
                >
                  {videoFile.name}
                </span>
              </div>
              <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
                {(videoFile.size / (1024 * 1024)).toFixed(1)} MB
              </span>
            </div>

            {/* STAGE 3: Similarity Strictness & Instant Re-Clustering Controls */}
            <div className="p-2.5 rounded-xl border border-border/70 bg-muted/20 space-y-2 min-w-0 shrink-0 overflow-hidden">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Sliders className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>{copy.similarityStrictness}</span>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {STRICTNESS_LEVELS.map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => handleStrictnessChange(lvl)}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors border truncate cursor-pointer ${
                      strictness === lvl
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background/70 text-muted-foreground border-border hover:text-foreground'
                    }`}
                  >
                    {strictnessLabels[lvl]}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2.5">
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {copy.looseHint}
                </span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={1}
                  value={strictnessSliderIdx}
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    handleStrictnessChange(STRICTNESS_LEVELS[idx] || 'balanced');
                  }}
                  className="w-full h-1.5 accent-primary cursor-pointer"
                />
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {copy.strictHint}
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-border/50 text-xs">
                <label className="flex items-center gap-1.5 text-muted-foreground">
                  <span>{copy.simThresholdLabel}</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="1.50"
                    placeholder={
                      analysisReport
                        ? `${analysisReport.simThreshold}`
                        : copy.autoPlaceholder
                    }
                    value={simThresholdOverrideInput}
                    onChange={(e) => handleOverrideChange(e.target.value)}
                    className="w-20 h-6 px-1.5 rounded border border-border bg-background text-foreground text-xs font-mono"
                  />
                  {analysisReport && (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      (S={analysisReport.baselineS})
                    </span>
                  )}
                </label>

                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={protectSubtitles}
                    onChange={(e) =>
                      handleProtectSubtitlesChange(e.target.checked)
                    }
                    className="rounded border-border accent-primary"
                  />
                  <span>{copy.subtitleLineSplit}</span>
                </label>
              </div>
            </div>

            {/* Progress Bar & Live Stage Status */}
            <div className="p-3 rounded-xl border border-primary/20 bg-primary/5 space-y-2 min-w-0 shrink-0 overflow-hidden">
              <div className="flex items-start justify-between gap-2.5 text-xs min-w-0">
                <span className="font-medium text-foreground break-words min-w-0 flex-1 leading-snug">
                  {localizedStatusText}
                </span>
                <span className="font-mono text-primary font-bold shrink-0">
                  {progress.percent}%
                </span>
              </div>

              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-200 rounded-full"
                  style={{
                    width: `${Math.min(100, Math.max(0, progress.percent))}%`,
                  }}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted-foreground min-w-0">
                <span className="truncate min-w-0">
                  {copy.stageLabel}{' '}
                  <strong className="text-foreground">
                    {localizedPhaseLabel}
                  </strong>
                </span>
                <span className="shrink-0">
                  {formatVideoComicTemplate(copy.selectedSummary, {
                    count: displayedFrameCount,
                    pages: displayedPageCount,
                  })}
                </span>
              </div>
            </div>

            {statusMode === 'empty' && !isProcessing && (
              <div className="p-3 border border-dashed border-border rounded-lg bg-background/40 text-xs text-muted-foreground text-center shrink-0">
                {copy.allDeletedNotice}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="mx-0 mb-0 p-0 pt-2.5 border-t border-border/60 bg-transparent flex flex-row items-center justify-between gap-2 shrink-0 sm:justify-between">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCancel}
            >
              {isProcessing ? copy.cancel : copy.close}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={isProcessing || displayedFrameCount === 0}
              onClick={() => setIsPreviewOpen(true)}
            >
              <Eye className="w-3.5 h-3.5 shrink-0" />
              <span>
                {copy.previewButton}
                {displayedFrameCount > 0 ? ` (${displayedFrameCount})` : ''}
              </span>
            </Button>
          </div>

          {!isProcessing && displayedFrameCount > 0 && videoFile && (
            <Button
              type="button"
              variant="default"
              size="sm"
              className="gap-1.5 min-w-0 truncate"
              onClick={handleApplyOrCapture}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="truncate">
                {needsStage4Capture
                  ? formatVideoComicTemplate(copy.captureAndApply, {
                      count: displayedFrameCount,
                    })
                  : formatVideoComicTemplate(copy.applyKeyframes, {
                      count: displayedFrameCount,
                    })}
              </span>
            </Button>
          )}
        </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Individual Preview Window (Original Video Ratio + Multi-Select Delete) */}
      <Dialog open={isOpen && isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent
          dir={language === 'ar' ? 'rtl' : 'ltr'}
          className="w-[min(calc(100vw-2rem),960px)] max-w-none sm:max-w-none h-[min(86vh,760px)] max-h-[86vh] bg-card border-border shadow-2xl p-4 sm:p-5 overflow-hidden flex flex-col gap-3"
        >
          <DialogHeader className="min-w-0 shrink-0 pr-7">
            <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
                <DialogTitle className="text-base font-semibold truncate">
                  {formatVideoComicTemplate(copy.previewTitle, {
                    count: activeClusters.length,
                  })}
                </DialogTitle>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatVideoComicTemplate(copy.comicPagesCount, {
                    pages: Math.ceil(activeClusters.length / 6),
                  })}
                </span>
              </div>
            </div>
          </DialogHeader>

          {/* Selection toolbar */}
          {activeClusters.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
              {selectedCount > 0 ? (
                <span className="text-xs font-medium text-destructive">
                  {formatVideoComicTemplate(copy.selectedCount, {
                    count: selectedCount,
                  })}
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  {copy.selectHint}
                </span>
              )}

              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs gap-1"
                  onClick={handleSelectAllOrClear}
                >
                  {allSelected ? (
                    <CheckSquare className="w-3.5 h-3.5" />
                  ) : (
                    <Square className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {allSelected ? copy.clearSelection : copy.selectAll}
                  </span>
                </Button>

                {selectedCount > 0 && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-7 px-2.5 text-xs gap-1"
                    onClick={handleDeleteSelectedFrames}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>
                      {formatVideoComicTemplate(copy.deleteSelected, {
                        count: selectedCount,
                      })}
                    </span>
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Frame grid maintaining exact original video frame ratio */}
          {activeClusters.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-6 border border-dashed border-border rounded-lg bg-background/40 text-xs text-muted-foreground text-center">
              {copy.allDeletedNotice}
            </div>
          ) : (
            <div
              className={`grid ${previewGridColsClass} gap-2.5 items-start content-start flex-1 min-h-0 overflow-y-auto p-2 border border-border rounded-lg bg-background/50`}
            >
              {activeClusters.map((cl, idx) => {
                const isSelected = selectedClusterIds.has(cl.clusterId);
                const imgSrc =
                  keyframeByClusterId.get(cl.clusterId)?.dataUrl ||
                  cl.previewDataUrl;

                return (
                  <div
                    key={cl.clusterId}
                    role="button"
                    tabIndex={isProcessing ? -1 : 0}
                    aria-disabled={isProcessing}
                    aria-pressed={isSelected}
                    onClick={(e) =>
                      handleToggleFrameSelection(
                        cl.clusterId,
                        idx,
                        e.shiftKey
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleToggleFrameSelection(
                          cl.clusterId,
                          idx,
                          e.shiftKey
                        );
                      }
                    }}
                    className={`group relative w-full self-start rounded overflow-hidden border bg-black/80 transition-all select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      isProcessing
                        ? 'cursor-default border-border'
                        : isSelected
                        ? 'cursor-pointer border-destructive ring-2 ring-destructive shadow-sm'
                        : 'cursor-pointer border-border hover:border-primary/70'
                    }`}
                    title={`#${idx + 1} • ${cl.repTimestamp.toFixed(1)}s`}
                  >
                    {imgSrc ? (
                      <img
                        src={imgSrc}
                        alt={formatVideoComicTemplate(copy.frameAlt, {
                          id: idx + 1,
                        })}
                        className={`w-full h-auto block transition-opacity ${
                          isSelected ? 'opacity-70' : 'opacity-100'
                        }`}
                        draggable={false}
                      />
                    ) : (
                      <div className="w-full py-6 flex items-center justify-center text-[9px] text-muted-foreground">
                        #{idx + 1}
                      </div>
                    )}

                    {/* Selection tint overlay */}
                    {isSelected && (
                      <div className="absolute inset-0 bg-destructive/20 pointer-events-none" />
                    )}

                    {/* Frame number badge */}
                    <span className="absolute top-1 left-1 text-[9px] bg-primary/90 text-primary-foreground px-1 rounded font-mono leading-tight">
                      #{idx + 1}
                    </span>

                    {/* Multi-select checkbox badge */}
                    {!isProcessing && (
                      <span
                        className={`absolute top-1 right-1 w-4 h-4 rounded flex items-center justify-center border transition-colors ${
                          isSelected
                            ? 'bg-destructive border-destructive text-destructive-foreground'
                            : 'bg-black/55 border-white/60 text-transparent group-hover:border-white'
                        }`}
                      >
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </span>
                    )}

                    {/* Timestamp badge */}
                    <span className="absolute bottom-1 right-1 text-[9px] bg-black/75 text-white px-1 rounded font-mono leading-tight">
                      {cl.repTimestamp.toFixed(1)}s
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <DialogFooter className="mx-0 mb-0 p-0 pt-2.5 border-t border-border/60 bg-transparent flex flex-row items-center justify-between gap-2 shrink-0 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsPreviewOpen(false)}
            >
              {copy.close}
            </Button>

            {!isProcessing && displayedFrameCount > 0 && videoFile && (
              <Button
                type="button"
                variant="default"
                size="sm"
                className="gap-1.5 min-w-0 truncate"
                onClick={handleApplyOrCapture}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span className="truncate">
                  {needsStage4Capture
                    ? formatVideoComicTemplate(copy.captureAndApply, {
                        count: displayedFrameCount,
                      })
                    : formatVideoComicTemplate(copy.applyKeyframes, {
                        count: displayedFrameCount,
                      })}
                </span>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
