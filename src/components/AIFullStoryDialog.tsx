import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface AIFullStoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStoryGenerated: (htmlContent: string) => void;
  initialPrompt?: string;
  autoSubmit?: boolean;
}

export function AIFullStoryDialog({ open, onOpenChange, onStoryGenerated, initialPrompt = "", autoSubmit = false }: AIFullStoryDialogProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialPrompt) setPrompt(initialPrompt);
      if (initialPrompt && autoSubmit) {
         setTimeout(() => {
           const btn = document.getElementById('auto-generate-story-btn');
           if (btn) btn.click();
         }, 100);
      }
    }
  }, [open, initialPrompt, autoSubmit]);

  const handleGenerate = async () => {
    if (!prompt) return;
    setIsGenerating(true);
    try {
      const messages = [{ role: 'user', parts: [{ text: `Write a detailed novel or story chapter based on this prompt. Format it nicely using ONLY raw HTML tags (like <h1>, <h2>, <p>, <b>, <i>). Do not use markdown backticks. Prompt: ${prompt}` }] }];
      
      const res = await fetch('/api/agent-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, systemInstruction: "You are an expert story writer. Output ONLY raw HTML. No markdown formatting blocks." })
      });
      
      if (res.ok) {
        const text = await res.text();
        let htmlContent = "";
        try {
          const data = JSON.parse(text);
          htmlContent = data.text || "";
        } catch (e) {
          htmlContent = text;
        }
        
        // Cleanup markdown if AI ignores instructions
        htmlContent = htmlContent.replace(/```html/g, '').replace(/```/g, '').trim();
        
        onStoryGenerated(htmlContent);
      } else {
        toast.error("Failed to generate story");
      }
    } catch (err: any) {
      toast.error(err.message || "An error occurred");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" /> Generate Novel / Story</DialogTitle>
          <DialogDescription>
            Let AI write a full story based on your prompt.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          <Textarea 
            placeholder="Describe the story..." 
            className="min-h-[120px] resize-none"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <Button id="auto-generate-story-btn" onClick={handleGenerate} disabled={isGenerating || !prompt} className="w-full gap-2 font-semibold">
            {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {isGenerating ? "Generating Story..." : "Generate Story"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
