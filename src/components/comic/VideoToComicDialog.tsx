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
import { toast } from 'sonner';

interface VideoToComicDialogProps {
  isOpen: boolean;
  onClose: () => void;
  videoFile: File | null;
  onComplete: (newPages: ComicPageData[], keyframes: ExtractedKeyframe[]) => void;
}

const STRICTNESS_LEVELS: SimilarityStrictness[] = ['loose', 'balanced', 'strict'];

const STRICTNESS_LABELS: Record<SimilarityStrictness, string> = {
  loose: 'Loose (3.5×S)',
  balanced: 'Balanced (2.0×S)',
  strict: 'Strict (1.2×S)',
};

export const VideoToComicDialog: React.FC<VideoToComicDialogProps> = ({
  isOpen,
  onClose,
  videoFile,
  onComplete,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<VideoProcessingProgress>({
    phase: 'init',
    percent: 0,
    statusText: 'Preparing video...',
  });
  const [extractedKeyframes, setExtractedKeyframes] = useState<ExtractedKeyframe[]>([]);
  const [cachedSession, setCachedSession] = useState<CachedAnalysisSession | null>(null);
  const [activeClusters, setActiveClusters] = useState<ClusterSummaryRecord[]>([]);
  const [needsStage4Capture, setNeedsStage4Capture] = useState<boolean>(false);

  const [strictness, setStrictness] = useState<SimilarityStrictness>('balanced');
  const [simThresholdOverrideInput, setSimThresholdOverrideInput] = useState<string>('');
  const [protectSubtitles, setProtectSubtitles] = useState<boolean>(
    VIDEO_TO_COMIC_CONFIG.subtitle.protectSubtitlesDefault
  );
  const [analysisReport, setAnalysisReport] = useState<VideoExtractionDebugReport | null>(null);

  const isCancelledRef = useRef<boolean>(false);
  const activeRunIdRef = useRef<number>(0);
  const startedFileRef = useRef<File | null>(null);
  const userTunedRef = useRef<boolean>(false);
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

  const applyKeyframesToCanvas = useCallback(
    (keyframes: ExtractedKeyframe[], file: File) => {
      if (keyframes.length === 0) {
        toast.error('No keyframes available to place on canvas.');
        return;
      }
      const pages = paginateKeyframesTo6PanelPages(keyframes, {
        baseTitle: file.name.replace(/\.[^/.]+$/, ''),
      });
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
      setAnalysisReport(report);
      setNeedsStage4Capture(true);
      setProgress({
        phase: 'complete',
        percent: 100,
        statusText: `Stage 3 re-clustered from cache: ${clusters.length} unique keyframes (${Math.ceil(clusters.length / 6)} pages)`,
        candidatesFound: clusters.length,
      });
    },
    []
  );

  const startInitialConversion = useCallback(
    async (file: File) => {
      const runId = ++activeRunIdRef.current;
      isCancelledRef.current = false;
      userTunedRef.current = false;
      setIsProcessing(true);
      setExtractedKeyframes([]);
      setCachedSession(null);
      setActiveClusters([]);
      setAnalysisReport(null);
      setNeedsStage4Capture(false);
      setProgress({
        phase: 'init',
        percent: 0,
        statusText: 'Initializing video analysis...',
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
            }
          },
          onProgress: (p) => {
            if (activeRunIdRef.current === runId) {
              setProgress(p);
            }
          },
        });

        if (isCancelledRef.current || activeRunIdRef.current !== runId) return;

        setExtractedKeyframes(keyframes);
        setIsProcessing(false);

        if (keyframes.length === 0) {
          toast.error('No clear keyframes could be extracted from this video.');
          if (!userTunedRef.current) {
            onCloseRef.current();
          }
          return;
        }

        if (userTunedRef.current) {
          toast.success(
            `Extracted ${keyframes.length} keyframes (${Math.ceil(keyframes.length / 6)} pages). Adjust strictness or click "Apply to Canvas".`
          );
          return;
        }

        toast.success(
          `Extracted ${keyframes.length} unique keyframes into ${Math.ceil(keyframes.length / 6)} comic pages!`
        );
        applyKeyframesToCanvas(keyframes, file);
      } catch (err: any) {
        if (activeRunIdRef.current !== runId) return;
        setIsProcessing(false);
        if (isCancelledRef.current) {
          toast.info('Video conversion cancelled.');
        } else {
          toast.error('Conversion failed: ' + (err?.message || 'Unknown error'));
        }
        if (!userTunedRef.current) {
          onCloseRef.current();
        }
      }
    },
    [strictness, parsedSimOverride, protectSubtitles, applyKeyframesToCanvas]
  );

  // Auto-run Stage 1..4 once when opened with a new video file
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
    }
  }, [isOpen, videoFile, startInitialConversion]);

  // Handle instant Stage 3 re-clustering when user adjusts strictness, numeric override, or subtitle protection
  const handleStrictnessChange = (nextStrictness: SimilarityStrictness) => {
    userTunedRef.current = true;
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
    userTunedRef.current = true;
    setSimThresholdOverrideInput(rawVal);
    const trimmed = rawVal.trim();
    const num = trimmed ? parseFloat(trimmed) : null;
    const validOverride = num !== null && Number.isFinite(num) && num > 0 ? num : null;
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
    userTunedRef.current = true;
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

  const handleApplyOrCapture = async () => {
    if (!videoFile) return;

    // If Stage 3 was re-clustered on cached signatures, run Stage 4 full-res capture for the new cluster representatives
    if (needsStage4Capture && cachedSession && activeClusters.length > 0) {
      const runId = ++activeRunIdRef.current;
      isCancelledRef.current = false;
      setIsProcessing(true);
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
        toast.error('Capture failed: ' + (err?.message || 'Unknown error'));
      }
      return;
    }

    applyKeyframesToCanvas(extractedKeyframes, videoFile);
  };

  const handleCancel = () => {
    isCancelledRef.current = true;
    activeRunIdRef.current++;
    startedFileRef.current = null;
    setIsProcessing(false);
    onCloseRef.current();
  };

  const strictnessSliderIdx = STRICTNESS_LEVELS.indexOf(strictness);
  const displayedFrameCount =
    activeClusters.length > 0 ? activeClusters.length : extractedKeyframes.length;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent
        className="w-[min(calc(100vw-2rem),calc(88vh*4/3),720px)] max-w-none sm:max-w-none aspect-[4/3] max-h-[88vh] bg-card border-border shadow-2xl p-4 sm:p-5 overflow-hidden flex flex-col gap-3"
      >
        <DialogHeader className="min-w-0 shrink-0 pr-7">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <Film className="w-4 h-4" />
            </div>
            <DialogTitle className="text-base font-semibold truncate">
              Converting Video to Comic
            </DialogTitle>
          </div>
        </DialogHeader>

        {videoFile && (
          <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto pr-0.5 min-w-0">
            {/* Video metadata banner */}
            <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-muted/40 border border-border/60 text-xs min-w-0 shrink-0 overflow-hidden">
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
            <div className="p-3 rounded-xl border border-border/70 bg-muted/20 space-y-2.5 min-w-0 shrink-0 overflow-hidden">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Sliders className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>Similarity Strictness</span>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {STRICTNESS_LEVELS.map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => handleStrictnessChange(lvl)}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors border truncate ${
                      strictness === lvl
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background/70 text-muted-foreground border-border hover:text-foreground'
                    }`}
                  >
                    {STRICTNESS_LABELS[lvl]}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2.5">
                <span className="text-[10px] text-muted-foreground shrink-0">
                  Loose (Fewer)
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
                  Strict (More)
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-border/50 text-xs">
                <label className="flex items-center gap-1.5 text-muted-foreground">
                  <span>simThreshold:</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="1.50"
                    placeholder={
                      analysisReport ? `${analysisReport.simThreshold}` : 'Auto'
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
                  <span>Subtitle line split</span>
                </label>
              </div>
            </div>

            {/* Progress Bar & Live Stage Status */}
            <div className="p-3.5 rounded-xl border border-primary/20 bg-primary/5 space-y-2.5 min-w-0 shrink-0 overflow-hidden">
              <div className="flex items-start justify-between gap-2.5 text-xs min-w-0">
                <span className="font-medium text-foreground break-words min-w-0 flex-1 leading-snug">
                  {progress.statusText}
                </span>
                <span className="font-mono text-primary font-bold shrink-0">
                  {progress.percent}%
                </span>
              </div>

              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-200 rounded-full"
                  style={{
                    width: `${Math.min(100, Math.max(0, progress.percent))}%`,
                  }}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted-foreground min-w-0">
                <span className="truncate min-w-0">
                  Stage:{' '}
                  <strong className="capitalize text-foreground">
                    {progress.phase === 'scanning'
                      ? 'Stage 1: 0.5s Signature Scan'
                      : progress.phase === 'refining'
                      ? 'Stage 2 & 3: Clear Pool + Global Dedupe'
                      : progress.phase === 'extracting'
                      ? 'Stage 4: HD Frame Capture'
                      : progress.phase}
                  </strong>
                </span>
                <span className="shrink-0">
                  Selected: <strong>{displayedFrameCount}</strong> (
                  {Math.ceil(Math.max(1, displayedFrameCount) / 6)} Pages)
                </span>
              </div>
            </div>

            {/* Instant Preview Grid of Cluster Representatives */}
            {activeClusters.length > 0 && (
              <div className="flex-1 min-h-0 flex flex-col gap-1.5 min-w-0 overflow-hidden">
                <div className="flex justify-between items-center gap-2 text-xs min-w-0 shrink-0">
                  <span className="font-semibold text-foreground truncate flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                    Preview ({activeClusters.length} frames)
                  </span>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {Math.ceil(activeClusters.length / 6)} Comic Pages
                  </span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 flex-1 min-h-0 overflow-y-auto p-1.5 border border-border rounded-lg bg-background/50 content-start">
                  {activeClusters.map((cl) => (
                    <div
                      key={cl.clusterId}
                      className="relative aspect-video rounded overflow-hidden border border-border bg-black/40"
                      title={`#${cl.clusterId} • ${cl.repTimestamp.toFixed(1)}s`}
                    >
                      {cl.previewDataUrl ? (
                        <img
                          src={cl.previewDataUrl}
                          alt={`Frame ${cl.clusterId}`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[9px] text-muted-foreground">
                          #{cl.clusterId}
                        </div>
                      )}
                      <span className="absolute top-0.5 left-0.5 text-[8px] bg-primary/90 text-primary-foreground px-1 rounded font-mono">
                        #{cl.clusterId}
                      </span>
                      <span className="absolute bottom-0.5 right-0.5 text-[8px] bg-black/75 text-white px-0.5 rounded font-mono">
                        {cl.repTimestamp.toFixed(1)}s
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="mx-0 mb-0 p-0 pt-3 border-t border-border/60 bg-transparent flex flex-row items-center justify-between gap-2 shrink-0 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancel}
          >
            {isProcessing ? 'Cancel' : 'Close'}
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
                  ? `Capture & Apply (${displayedFrameCount})`
                  : `Apply ${displayedFrameCount} Keyframes`}
              </span>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
