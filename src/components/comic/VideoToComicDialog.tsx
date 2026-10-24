import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Film } from 'lucide-react';
import {
  extractVideoKeyframes,
  paginateKeyframesTo6PanelPages,
  ExtractedKeyframe,
  ComicPageData,
  VideoProcessingProgress,
} from '@/lib/videoToComic';
import { toast } from 'sonner';

interface VideoToComicDialogProps {
  isOpen: boolean;
  onClose: () => void;
  videoFile: File | null;
  onComplete: (newPages: ComicPageData[], keyframes: ExtractedKeyframe[]) => void;
}

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
  const isCancelledRef = useRef<boolean>(false);

  const startConversion = useCallback(
    async (file: File) => {
      isCancelledRef.current = false;
      setIsProcessing(true);
      setExtractedKeyframes([]);
      setProgress({
        phase: 'init',
        percent: 0,
        statusText: 'Initializing video analysis...',
      });

      try {
        const keyframes = await extractVideoKeyframes(file, {
          stepSeconds: 0.5,
          sceneThreshold: 24,
          maxKeyframes: 36,
          isCancelled: () => isCancelledRef.current,
          onProgress: (p) => {
            setProgress(p);
          },
        });

        if (isCancelledRef.current) return;

        setExtractedKeyframes(keyframes);
        setIsProcessing(false);

        if (keyframes.length === 0) {
          toast.error('No clear keyframes could be extracted from this video.');
          onClose();
          return;
        }

        toast.success(
          `Extracted ${keyframes.length} sharp keyframes into 6-panel comic pages!`
        );

        // Auto-paginate into 6-panel pages and place directly into canvas
        const pages = paginateKeyframesTo6PanelPages(keyframes, {
          baseTitle: file.name.replace(/\.[^/.]+$/, ''),
        });

        onComplete(pages, keyframes);
        onClose();
      } catch (err: any) {
        setIsProcessing(false);
        if (isCancelledRef.current) {
          toast.info('Video conversion cancelled.');
        } else {
          toast.error('Conversion failed: ' + (err?.message || 'Unknown error'));
        }
        onClose();
      }
    },
    [onComplete, onClose]
  );

  // Auto-convert video immediately when opened with a video file
  useEffect(() => {
    if (isOpen && videoFile) {
      startConversion(videoFile);
    } else {
      setIsProcessing(false);
    }
  }, [isOpen, videoFile, startConversion]);

  const handleCancel = () => {
    isCancelledRef.current = true;
    setIsProcessing(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="max-w-lg bg-card border-border shadow-2xl p-5 sm:p-6">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <Film className="w-4 h-4" />
            </div>
            <DialogTitle className="text-base font-semibold">
              Converting Video to Comic
            </DialogTitle>
          </div>
        </DialogHeader>

        {videoFile && (
          <div className="space-y-3.5 py-1">
            {/* Video metadata banner */}
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 border border-border/60 text-xs">
              <div className="flex items-center gap-2 truncate">
                <Film className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="font-semibold text-foreground truncate">{videoFile.name}</span>
              </div>
              <span className="text-muted-foreground shrink-0 ml-2 font-mono text-[11px]">
                {(videoFile.size / (1024 * 1024)).toFixed(1)} MB
              </span>
            </div>


            {/* In-Progress Progress Bar & Live Status (No Sparkles Icon) */}
            <div className="p-3.5 rounded-xl border border-primary/20 bg-primary/5 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">
                  {progress.statusText}
                </span>
                <span className="font-mono text-primary font-bold">{progress.percent}%</span>
              </div>

              {/* Styled Progress Bar */}
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-200 rounded-full"
                  style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  Phase:{' '}
                  <strong className="capitalize text-foreground">
                    {progress.phase === 'scanning'
                      ? '1. Scene Detection'
                      : progress.phase === 'refining'
                      ? '2. Sharpness Peak Search'
                      : progress.phase}
                  </strong>
                </span>
                {progress.candidatesFound !== undefined && (
                  <span>
                    Candidates: <strong>{progress.candidatesFound}</strong>
                  </span>
                )}
              </div>
            </div>

            {/* Extracted Keyframes Preview Grid */}
            {extractedKeyframes.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-foreground">
                    Extracted Keyframes ({extractedKeyframes.length})
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {Math.ceil(extractedKeyframes.length / 6)} Pages
                  </span>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 max-h-36 overflow-y-auto p-1.5 border border-border rounded-lg bg-background/50">
                  {extractedKeyframes.map((kf, i) => (
                    <div
                      key={i}
                      className="relative aspect-video rounded overflow-hidden border border-border bg-black/40"
                    >
                      <img
                        src={kf.dataUrl}
                        alt={`Keyframe ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute bottom-0.5 right-0.5 text-[8px] bg-black/75 text-white px-0.5 rounded font-mono">
                        {kf.timestamp.toFixed(1)}s
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex justify-end gap-2 mt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancel}
          >
            {isProcessing ? 'Cancel' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
