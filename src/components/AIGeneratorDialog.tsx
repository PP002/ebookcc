import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Loader2, ImagePlus, Upload, Download } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAppSettings, handleApiError } from '@/context/AppSettingsContext';

interface AIGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGeneratorSuccess?: (imageUrl: string) => void;
}

export function AIGeneratorDialog({ open, onOpenChange, onGeneratorSuccess }: AIGeneratorDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("3:4");
  const [sketch, setSketch] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  
  const { stabilityApiKey, setShowSettingsDialog, llmEngine } = useAppSettings();

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
        setGeneratedImage(null); // Reset previously generated image
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerate = async () => {
    if (!prompt && !sketch) {
      setError("Please provide a prompt or a sketch.");
      return;
    }
    setError("");
    setIsGenerating(true);
    setGeneratedImage(null);

    try {
      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(stabilityApiKey ? { "x-stability-api-key": stabilityApiKey } : {})
        },
        body: JSON.stringify({
          prompt,
          aspectRatio,
          imageBase64: sketch
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate image");

      setGeneratedImage(data.imageUrl);
      if (onGeneratorSuccess) onGeneratorSuccess(data.imageUrl);
      setSketch(null);
    } catch (err: any) {
      if (!handleApiError(err, setShowSettingsDialog, llmEngine)) {
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
            <Sparkles className="w-5 h-5 text-primary" />
            AI Image Generator
          </DialogTitle>
          <DialogDescription>
            Generate comic panels or backgrounds from a prompt, or upload a sketch to modify and improve it.
          </DialogDescription>
        </DialogHeader>
        
        {generatedImage ? (
          <div className="flex flex-col gap-4 py-4">
            <div className="relative w-full rounded-md border flex items-center justify-center overflow-hidden bg-muted">
              <img src={generatedImage} alt="Generated using AI" className="max-h-[60vh] object-contain" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => {
                setGeneratedImage(null);
              }}>
                Create Another
              </Button>
              <Button variant="secondary" onClick={() => {
                const a = document.createElement('a');
                a.href = generatedImage;
                a.download = `ai-generated-${Date.now()}.png`;
                a.click();
              }}>
                <Download className="w-4 h-4 mr-2" />
                Download
              </Button>
              {onGeneratorSuccess && (
                <Button onClick={() => {
                   onGeneratorSuccess(generatedImage);
                   onOpenChange(false);
                }}>
                  <ImagePlus className="w-4 h-4 mr-2" />
                  Add to Comic
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="sketch">Sketch / Base Image (Optional)</Label>
              {sketch ? (
                <div className="relative aspect-video w-full rounded-md border flex items-center justify-center overflow-hidden bg-muted">
                  <img src={sketch} alt="Sketch" className="max-h-full object-contain" />
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
                  htmlFor="sketch-upload" 
                  className="flex flex-col items-center justify-center w-full h-32 border border-dashed rounded-lg cursor-pointer bg-muted/50 hover:bg-muted"
                >
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <Upload className="w-8 h-8 mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Click to upload a sketch</p>
                  </div>
                  <input id="sketch-upload" type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                </label>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="prompt">Prompt</Label>
              <Textarea
                id="prompt"
                placeholder="A superhero flying over a futuristic city at sunset..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="aspect-ratio">Aspect Ratio</Label>
              <Select value={aspectRatio} onValueChange={setAspectRatio}>
                <SelectTrigger id="aspect-ratio">
                  <SelectValue placeholder="Select ratio" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1:1">1:1 (Square)</SelectItem>
                  <SelectItem value="3:4">3:4 (Portrait / Comic panel)</SelectItem>
                  <SelectItem value="4:3">4:3 (Landscape)</SelectItem>
                  <SelectItem value="9:16">9:16 (Tall portrait)</SelectItem>
                  <SelectItem value="16:9">16:9 (Widescreen)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-md overflow-y-auto max-h-32 break-words">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleGenerate} disabled={isGenerating || (!prompt && !sketch)}>
                {isGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ImagePlus className="w-4 h-4 mr-2" />}
                Generate
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
