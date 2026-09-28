import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Sparkles, Loader2, Upload, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { useAppSettings, handleApiError } from '@/context/AppSettingsContext';
import { getApiUrl } from '@/lib/api';


interface AIFullComicDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComicGenerated: (script: any, sketch: string | null) => void;
  initialPrompt?: string;
  autoSubmit?: boolean;
}

export function AIFullComicDialog({ open, onOpenChange, onComicGenerated, initialPrompt = "", autoSubmit = false }: AIFullComicDialogProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [pagesCount, setPagesCount] = useState("1");
  const [sketch, setSketch] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  
  const { geminiApiKey, llmEngine, setShowSettingsDialog } = useAppSettings();

  React.useEffect(() => {
    if (open) {
      if (initialPrompt) setPrompt(initialPrompt);
      if (initialPrompt && autoSubmit) {
         // Need a small timeout to let states settle before firing handleGenerate
         setTimeout(() => {
           const btn = document.getElementById('auto-generate-comic-btn');
           if (btn) btn.click();
         }, 100);
      }
    }
  }, [open, initialPrompt, autoSubmit]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setError("Image size should be less than 5MB");
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        setSketch(e.target?.result as string);
        setError("");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerate = async () => {
    if (!prompt) {
      setError("Please provide a prompt for the story.");
      return;
    }
    setError("");
    setIsGenerating(true);

    try {
      let scriptData;
      const res = await fetch(`${getApiUrl()}/api/generate-comic-script`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          ...(geminiApiKey ? { "x-gemini-api-key": geminiApiKey } : {})
        },
        body: JSON.stringify({
          prompt,
          pagesCount: parseInt(pagesCount) || 1,
          imageBase64: sketch,
          engine: llmEngine
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || "Backend returned failure status code");
      }
      scriptData = await res.json();

      onOpenChange(false);
      onComicGenerated(scriptData, sketch);
      toast.success("Comic script generated! Now drawing panels...");
    } catch (err: any) {
      if (!handleApiError(err, setShowSettingsDialog)) {
        setError(err.message || "An unexpected error occurred.");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] md:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            AI Full Comic Generator
          </DialogTitle>
          <DialogDescription>
            Input a story or concept, and our AI will write a script and automatically generate a complete comic book page for you.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="sketch">Concept Sketch / Base Image (Optional)</Label>
            {sketch ? (
              <div className="relative aspect-video w-full rounded-md border flex items-center justify-center overflow-hidden bg-muted">
                <img src={sketch || undefined} alt="Sketch" className="max-h-full object-contain" />
                <Button 
                  variant="secondary" 
                  size="sm" 
                  className="absolute top-2 right-2"
                  onClick={() => setSketch(null)}
                >
                  Clear
                </Button>
              </div>
            ) : (
              <label 
                htmlFor="comic-sketch-upload" 
                className="flex flex-col items-center justify-center w-full h-32 border border-dashed rounded-lg cursor-pointer bg-muted/50 hover:bg-muted"
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-8 h-8 mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Click to upload an optional character sketch</p>
                </div>
                <input id="comic-sketch-upload" type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="prompt">Story Prompt</Label>
            <Textarea
              id="prompt"
              placeholder="A story about an astronaut finding a magical plant on Mars..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pagesCount">Number of Pages</Label>
            <input 
              id="pagesCount" 
              type="number"
              min="1"
              max="20"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={pagesCount}
              onChange={(e) => setPagesCount(e.target.value)}
              placeholder="e.g. 5"
            />
          </div>
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-md overflow-y-auto max-h-32 break-words">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button id="auto-generate-comic-btn" onClick={handleGenerate} disabled={isGenerating || !prompt}>
              {isGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              Write & Draw
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
