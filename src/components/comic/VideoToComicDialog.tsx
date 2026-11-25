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
  Bug,
  Download,
  Copy,
  CheckCircle2,
  Sliders,
  Grid,
  Table as TableIcon,
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
  CandidateDebugRecord,
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
  loose: 'Loose (3.5×S • Fewer)',
  balanced: 'Balanced (2.0×S)',
  strict: 'Strict (1.2×S • More)',
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

  const [showDebug, setShowDebug] = useState<boolean>(false);
  const [debugViewTab, setDebugViewTab] = useState<'table' | 'contact'>('table');
  const [debugFilter, setDebugFilter] = useState<'reps' | 'clear' | 'rejected' | 'all'>('all');
  const [debugReport, setDebugReport] = useState<VideoExtractionDebugReport | null>(null);

  const isCancelledRef = useRef<boolean>(false);
  const activeRunIdRef = useRef<number>(0);
  const startedFileRef = useRef<File | null>(null);
  const showDebugRef = useRef<boolean>(false);
  const userTunedRef = useRef<boolean>(false);
  const onCompleteRef = useRef(onComplete);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    showDebugRef.current = showDebug;
  }, [showDebug]);

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
      setDebugReport(report);
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
              setDebugReport(report);
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
          if (!showDebugRef.current && !userTunedRef.current) {
            onCloseRef.current();
          }
          return;
        }

        if (showDebugRef.current || userTunedRef.current) {
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
        if (!showDebugRef.current && !userTunedRef.current) {
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
          debugReport?.sharpnessFloor ?? 0,
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

  const filteredDebugCandidates = useMemo((): CandidateDebugRecord[] => {
    if (!debugReport) return [];
    return debugReport.candidates.filter((c) => {
      if (debugFilter === 'reps') return c.isClusterRep;
      if (debugFilter === 'clear') return c.isClear;
      if (debugFilter === 'rejected') return !c.kept;
      return true;
    });
  }, [debugReport, debugFilter]);

  const handleExportDebugJson = () => {
    if (!debugReport) return;
    const exportObj = {
      config: VIDEO_TO_COMIC_CONFIG,
      report: {
        ...debugReport,
        clusters: debugReport.clusters.map(({ previewDataUrl, ...rest }) => rest),
        candidates: debugReport.candidates.map(({ previewDataUrl, ...rest }) => rest),
      },
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(videoFile?.name || 'video').replace(/\.[^/.]+$/, '')}_debug_clusters.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Exported debug report as JSON.');
  };

  const handleExportDebugCsv = () => {
    if (!debugReport) return;
    const headers = [
      'sampleIndex',
      'timestamp',
      'isClear',
      'rejectReason',
      'passedWindowThinning',
      'clusterId',
      'distanceToRep',
      'decisionCode',
      'rawSharpness',
      'relativeSharpness',
      'edgeEnergy',
      'p99MinusP1',
      'stability',
      'stabilityScore',
      'centerSubjectScore',
      'compositeScore',
      'dBg',
      'dHist',
      'dHash',
      'dCenter',
      'subtitleActiveBits',
      'subtitleStable',
      'decisionDetail',
    ];
    const rows = debugReport.candidates.map((c) =>
      [
        c.sampleIndex,
        c.timestamp.toFixed(3),
        c.isClear ? 'TRUE' : 'FALSE',
        c.rejectReason,
        c.passedWindowThinning ? 'TRUE' : 'FALSE',
        c.clusterId ?? '',
        c.distanceToRep ?? '',
        c.decisionCode,
        c.rawSharpness,
        c.relativeSharpness,
        c.edgeEnergy,
        c.p99MinusP1,
        c.stability,
        c.stabilityScore,
        c.centerSubjectScore,
        c.compositeScore,
        c.dBg ?? '',
        c.dHist ?? '',
        c.dHash ?? '',
        c.dCenter ?? '',
        c.subtitleActiveBits,
        c.subtitleStable ? 'TRUE' : 'FALSE',
        `"${(c.decisionDetail || '').replace(/"/g, '""')}"`,
      ].join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(videoFile?.name || 'video').replace(/\.[^/.]+$/, '')}_debug_clusters.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Exported debug table as CSV.');
  };

  const handleCopySummaryJson = async () => {
    if (!debugReport) return;
    const summary = {
      durationSec: debugReport.durationSec,
      sampleStepSec: debugReport.sampleStepSec,
      totalSamples: debugReport.totalSamples,
      clearCount: debugReport.clearCount,
      windowCandidateCount: debugReport.windowCandidateCount,
      clusterCount: debugReport.clusterCount,
      keptCount: debugReport.keptCount,
      rejectedCount: debugReport.rejectedCount,
      noiseFloorOuterBg: debugReport.noiseFloorOuterBg,
      baselineS: debugReport.baselineS,
      simThreshold: debugReport.simThreshold,
      strictness: debugReport.strictness,
      sharpnessFloor: debugReport.sharpnessFloor,
      motionBlurThreshold: debugReport.motionBlurThreshold,
      candidates: filteredDebugCandidates.map(({ previewDataUrl, ...rest }) => rest),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
      toast.success('Copied debug metrics JSON to clipboard!');
    } catch (_) {
      toast.error('Could not copy to clipboard.');
    }
  };

  const strictnessSliderIdx = STRICTNESS_LEVELS.indexOf(strictness);
  const displayedFrameCount =
    activeClusters.length > 0 ? activeClusters.length : extractedKeyframes.length;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent
        className={`w-[calc(100vw-2rem)] ${
          showDebug ? 'max-w-4xl' : 'max-w-lg'
        } bg-card border-border shadow-2xl p-4 sm:p-6 overflow-hidden transition-all duration-200 max-h-[92vh] flex flex-col`}
      >
        <DialogHeader className="min-w-0 shrink-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                <Film className="w-4 h-4" />
              </div>
              <DialogTitle className="text-base font-semibold truncate">
                Converting Video to Comic
              </DialogTitle>
            </div>
            <Button
              type="button"
              variant={showDebug ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2.5 text-[11px] gap-1.5 shrink-0"
              onClick={() => {
                const next = !showDebug;
                showDebugRef.current = next;
                userTunedRef.current = true;
                setShowDebug(next);
              }}
              title="Toggle Debug Extraction & Global Clustering Diagnostics"
            >
              <Bug className="w-3.5 h-3.5" />
              {showDebug ? 'Debug On' : 'Debug Extraction'}
            </Button>
          </div>
        </DialogHeader>

        {videoFile && (
          <div className="space-y-3 py-1 min-w-0 overflow-y-auto pr-0.5 flex-1">
            {/* Video metadata banner */}
            <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-muted/40 border border-border/60 text-xs min-w-0 overflow-hidden">
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
            <div className="p-3 rounded-xl border border-border/70 bg-muted/20 space-y-2.5 min-w-0 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs min-w-0">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <Sliders className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span>Similarity Strictness:</span>
                </div>
                <div className="flex items-center gap-1">
                  {STRICTNESS_LEVELS.map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => handleStrictnessChange(lvl)}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors border ${
                        strictness === lvl
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background/70 text-muted-foreground border-border hover:text-foreground'
                      }`}
                    >
                      {STRICTNESS_LABELS[lvl]}
                    </button>
                  ))}
                </div>
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

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/50 text-xs">
                <label className="flex items-center gap-1.5 text-muted-foreground">
                  <span>simThreshold override:</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="1.50"
                    placeholder={
                      debugReport ? `${debugReport.simThreshold}` : 'Auto'
                    }
                    value={simThresholdOverrideInput}
                    onChange={(e) => handleOverrideChange(e.target.value)}
                    className="w-20 h-6 px-1.5 rounded border border-border bg-background text-foreground text-xs font-mono"
                  />
                  {debugReport && (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      (S={debugReport.baselineS})
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
            <div className="p-3.5 rounded-xl border border-primary/20 bg-primary/5 space-y-2.5 min-w-0 overflow-hidden">
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
                  Selected Clusters: <strong>{displayedFrameCount}</strong> (
                  {Math.ceil(Math.max(1, displayedFrameCount) / 6)} Pages)
                </span>
              </div>
            </div>

            {/* Instant Preview Grid of Cluster Representatives (Updates live when moving strictness slider!) */}
            {activeClusters.length > 0 && !showDebug && (
              <div className="space-y-1.5 min-w-0 overflow-hidden">
                <div className="flex justify-between items-center gap-2 text-xs min-w-0">
                  <span className="font-semibold text-foreground truncate flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                    Cluster Representatives ({activeClusters.length} unique frames)
                  </span>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {Math.ceil(activeClusters.length / 6)} Comic Pages
                  </span>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 max-h-40 overflow-y-auto p-1.5 border border-border rounded-lg bg-background/50">
                  {activeClusters.map((cl) => (
                    <div
                      key={cl.clusterId}
                      className="relative aspect-video rounded overflow-hidden border border-border bg-black/40"
                      title={`Cluster #${cl.clusterId} • ${cl.repTimestamp.toFixed(1)}s • Score ${cl.repScore} (${cl.memberCount} members)`}
                    >
                      {cl.previewDataUrl ? (
                        <img
                          src={cl.previewDataUrl}
                          alt={`Cluster ${cl.clusterId}`}
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

            {/* DEBUG PANEL */}
            {showDebug && debugReport && (
              <div className="rounded-xl border border-border bg-background/90 p-3 space-y-3 min-w-0 overflow-hidden">
                {/* Summary Metrics Strip */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-border">
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                    <span className="px-1.5 py-0.5 rounded bg-muted text-foreground">
                      Samples: {debugReport.totalSamples} (dt={debugReport.sampleStepSec}s)
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-muted text-foreground">
                      Clear: {debugReport.clearCount} → 1.5s Thin: {debugReport.windowCandidateCount}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-muted text-foreground">
                      NoiseBg={debugReport.noiseFloorOuterBg} | S={debugReport.baselineS} | simThresh={debugReport.simThreshold}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary font-semibold">
                      Clusters (KEPT): {debugReport.keptCount} | Rejected: {debugReport.rejectedCount}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCopySummaryJson}
                      className="h-6 px-2 text-[10px] gap-1"
                    >
                      <Copy className="w-3 h-3" />
                      Copy JSON
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleExportDebugJson}
                      className="h-6 px-2 text-[10px] gap-1"
                    >
                      <Download className="w-3 h-3" />
                      JSON
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleExportDebugCsv}
                      className="h-6 px-2 text-[10px] gap-1"
                    >
                      <Download className="w-3 h-3" />
                      CSV
                    </Button>
                  </div>
                </div>

                {/* View Mode & Filter Controls */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setDebugViewTab('table')}
                      className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 border ${
                        debugViewTab === 'table'
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-muted/40 text-muted-foreground border-border'
                      }`}
                    >
                      <TableIcon className="w-3 h-3" />
                      Per-Sample Debug Table
                    </button>
                    <button
                      type="button"
                      onClick={() => setDebugViewTab('contact')}
                      className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 border ${
                        debugViewTab === 'contact'
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-muted/40 text-muted-foreground border-border'
                      }`}
                    >
                      <Grid className="w-3 h-3" />
                      Cluster Representatives Contact Sheet
                    </button>
                  </div>

                  <div className="flex items-center gap-1 text-[11px]">
                    <span className="text-muted-foreground">Filter:</span>
                    {(
                      [
                        { id: 'all', label: `All (${debugReport.totalSamples})` },
                        { id: 'reps', label: `KEPT Reps (${debugReport.keptCount})` },
                        { id: 'clear', label: `Clear (${debugReport.clearCount})` },
                        { id: 'rejected', label: 'Rejected / Dup' },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setDebugFilter(f.id)}
                        className={`px-1.5 py-0.5 rounded border ${
                          debugFilter === f.id
                            ? 'bg-secondary text-foreground border-primary/50 font-semibold'
                            : 'text-muted-foreground border-transparent hover:bg-muted/40'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tab 1: Per-Sample Diagnostics Table */}
                {debugViewTab === 'table' && (
                  <div className="max-h-64 overflow-auto border border-border rounded-lg">
                    <table className="w-full text-left border-collapse text-[10px] font-mono">
                      <thead className="bg-muted/80 text-muted-foreground sticky top-0 z-10">
                        <tr>
                          <th className="p-1.5 border-b border-border">Time</th>
                          <th className="p-1.5 border-b border-border">Clear</th>
                          <th className="p-1.5 border-b border-border">Reject Reason</th>
                          <th className="p-1.5 border-b border-border">Cluster</th>
                          <th className="p-1.5 border-b border-border">Dist to Rep (bg/hist/hash/ctr)</th>
                          <th className="p-1.5 border-b border-border">Sharp / Stab</th>
                          <th className="p-1.5 border-b border-border">Score</th>
                          <th className="p-1.5 border-b border-border">Decision</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {filteredDebugCandidates.map((c) => (
                          <tr
                            key={c.sampleIndex}
                            className={
                              c.kept
                                ? 'bg-emerald-500/10 text-foreground'
                                : c.isClear
                                ? 'bg-amber-500/5 text-muted-foreground'
                                : 'text-muted-foreground/70'
                            }
                          >
                            <td className="p-1.5 whitespace-nowrap font-semibold">
                              {c.timestamp.toFixed(2)}s
                            </td>
                            <td className="p-1.5 whitespace-nowrap">
                              {c.isClear ? (
                                <span className="text-emerald-400 font-bold">YES</span>
                              ) : (
                                <span className="text-rose-400">NO</span>
                              )}
                            </td>
                            <td className="p-1.5 whitespace-nowrap">
                              {c.rejectReason}
                            </td>
                            <td className="p-1.5 whitespace-nowrap">
                              {c.clusterId !== null ? `#${c.clusterId}` : '-'}
                              {c.isClusterRep ? ' ★' : ''}
                            </td>
                            <td className="p-1.5 whitespace-nowrap">
                              {c.distanceToRep !== null
                                ? `${c.distanceToRep.toFixed(3)} (${c.dBg}/${c.dHist}/${c.dHash}/${c.dCenter})`
                                : '-'}
                            </td>
                            <td className="p-1.5 whitespace-nowrap">
                              sh={c.rawSharpness.toFixed(1)} | st={c.stability.toFixed(1)}
                            </td>
                            <td className="p-1.5 whitespace-nowrap font-semibold">
                              {c.compositeScore.toFixed(3)}
                            </td>
                            <td className="p-1.5 whitespace-nowrap">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                  c.kept
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                    : c.decisionCode === 'DUP_CLUSTER'
                                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                    : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                }`}
                                title={c.decisionDetail}
                              >
                                {c.decisionCode}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Tab 2: Contact Sheet of Cluster Representatives (and filtered samples) */}
                {debugViewTab === 'contact' && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-2 max-h-64 overflow-y-auto p-1.5 border border-border rounded-lg bg-muted/20">
                      {(debugFilter === 'reps'
                        ? debugReport.candidates.filter((c) => c.isClusterRep)
                        : filteredDebugCandidates
                      ).map((c) => (
                        <div
                          key={c.sampleIndex}
                          className={`rounded-md overflow-hidden border-2 bg-black/50 flex flex-col ${
                            c.kept
                              ? 'border-emerald-500 shadow-sm'
                              : 'border-rose-500/40 opacity-75'
                          }`}
                          title={c.decisionDetail}
                        >
                          <div className="relative aspect-video bg-black/70">
                            {c.previewDataUrl ? (
                              <img
                                src={c.previewDataUrl}
                                alt={`Sample ${c.sampleIndex}`}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[9px] text-muted-foreground">
                                No thumb
                              </div>
                            )}
                            <span className="absolute top-0.5 left-0.5 text-[8px] bg-black/80 text-white px-1 rounded font-mono">
                              {c.clusterId ? `#${c.clusterId}` : '-'} • {c.timestamp.toFixed(1)}s
                            </span>
                            <span
                              className={`absolute bottom-0.5 right-0.5 text-[8px] px-1 rounded font-mono font-bold ${
                                c.kept
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-rose-900/90 text-rose-100'
                              }`}
                            >
                              {c.decisionCode}
                            </span>
                          </div>
                          <div className="p-1 text-[8px] font-mono text-muted-foreground flex items-center justify-between bg-card">
                            <span>
                              d={c.distanceToRep !== null ? c.distanceToRep.toFixed(2) : '-'}
                            </span>
                            <span>sc={c.compositeScore.toFixed(2)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between gap-2 mt-1 shrink-0">
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
              className="gap-1.5"
              onClick={handleApplyOrCapture}
            >
              <CheckCircle2 className="w-4 h-4" />
              {needsStage4Capture
                ? `Capture & Apply ${displayedFrameCount} Keyframes (${Math.ceil(displayedFrameCount / 6)} Pages)`
                : `Apply ${displayedFrameCount} Keyframes (${Math.ceil(displayedFrameCount / 6)} Pages) to Canvas`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
