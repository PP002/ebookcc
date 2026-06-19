import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Settings, Sparkles } from 'lucide-react';
import { useAppSettings } from '@/context/AppSettingsContext';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export function AppSettingsDialog() {
  const { 
    llmEngine, setLlmEngine,
    geminiApiKey, setGeminiApiKey,
    stabilityApiKey, setStabilityApiKey,
    localLlmUrl, setLocalLlmUrl,
    localLlmModel, setLocalLlmModel,
    localLlmApiKey, setLocalLlmApiKey,
    showSettingsDialog, setShowSettingsDialog
  } = useAppSettings();

  // Local state for the form so we don't save on every keystroke unless wanted
  const [localGeminiKey, setLocalGeminiKey] = useState(geminiApiKey);
  const [localStabilityKey, setLocalStabilityKey] = useState(stabilityApiKey);
  const [localUrl, setLocalUrl] = useState(localLlmUrl);
  const [localModel, setLocalModel] = useState(localLlmModel);
  const [localApiKey, setLocalApiKey] = useState(localLlmApiKey);
  const [localEngine, setLocalEngine] = useState(llmEngine);

  useEffect(() => {
    if (showSettingsDialog) {
      setLocalGeminiKey(geminiApiKey);
      setLocalStabilityKey(stabilityApiKey);
      setLocalUrl(localLlmUrl);
      setLocalModel(localLlmModel);
      setLocalApiKey(localLlmApiKey);
      setLocalEngine(llmEngine === 'pollinations' ? 'gemini' : llmEngine);
    }
  }, [showSettingsDialog, geminiApiKey, stabilityApiKey, localLlmUrl, localLlmModel, localLlmApiKey, llmEngine]);

  const handleSave = () => {
    setGeminiApiKey(localGeminiKey);
    setStabilityApiKey(localStabilityKey);
    setLocalLlmUrl(localUrl);
    setLocalLlmModel(localModel);
    setLocalLlmApiKey(localApiKey);
    setLlmEngine(localEngine);
    
    toast.success("App settings saved successfully.");
    setShowSettingsDialog(false);
  };

  return (
    <Dialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <Settings className="w-5 h-5 text-primary" />
            App Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Engine Selector Dropdown */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold">AI Provider</label>
            <select
              value={localEngine}
              onChange={(e) => {
                const engine = e.target.value as any;
                setLocalEngine(engine);
                if (engine === 'openai') {
                  setLocalUrl('https://api.openai.com/v1');
                  setLocalModel('gpt-4o');
                } else if (engine === 'claude') {
                  setLocalUrl('https://api.anthropic.com/v1');
                  setLocalModel('claude-3-5-sonnet-latest');
                } else if (engine === 'qwen') {
                  setLocalUrl('https://dashscope.aliyuncs.com/compatible-mode/v1');
                  setLocalModel('qwen-vl-max-latest');
                } else if (engine === 'local') {
                  if (!localUrl || localUrl.includes('openai') || localUrl.includes('anthropic') || localUrl.includes('aliyuncs')) {
                    setLocalUrl('http://localhost:11434/v1');
                    setLocalModel('llama3');
                  }
                } else if (engine === 'gemini') {
                  setLocalModel('gemini-2.5-flash');
                }
              }}
              className="w-full text-sm p-2 border border-border bg-background text-foreground rounded-md outline-none focus:border-primary shadow-sm h-10"
            >
              <option className="bg-background text-foreground" value="gemini">Google Gemini</option>
              <option className="bg-background text-foreground" value="openai">OpenAI</option>
              <option className="bg-background text-foreground" value="claude">Claude</option>
              <option className="bg-background text-foreground" value="qwen">Qwen</option>
              <option className="bg-background text-foreground" value="local">Local LLM</option>
            </select>
          </div>

          {localEngine === 'gemini' ? (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-500 mb-1">
                <Sparkles className="w-4 h-4" /> Gemini AI Cloud Engine
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                We use <code className="bg-muted px-1 py-0.5 rounded text-[10px]">gemini-2.5-flash</code> by default. You need a personal API key to process images or run translations.
                <br/><strong className="text-emerald-500 font-semibold mt-1 inline-block"><a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="hover:underline">🔥 Get your free Gemini API Key here (15 requests per minute free)</a></strong>
              </p>
              
              <div className="space-y-2">
                <label className="text-xs font-bold block text-foreground">Gemini API Key</label>
                <input
                  type="password"
                  value={localGeminiKey}
                  onChange={(e) => setLocalGeminiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full text-sm p-2 border border-border bg-background rounded-md outline-none focus:border-emerald-500 font-mono tracking-tight transition-colors shadow-sm"
                />
                <p className="text-[10px] text-muted-foreground mt-1 mb-2">Your key is stored only in your browser's local storage.</p>
                
                <label className="text-xs font-bold block text-foreground mt-3">Model Name</label>
                <select
                  value={['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-pro', 'gemini-1.5-flash'].includes(localModel) ? localModel : 'gemini-2.5-flash'}
                  onChange={(e) => setLocalModel(e.target.value)}
                  className="w-full text-xs p-2 border border-border bg-background text-foreground rounded-md outline-none focus:border-emerald-500 shadow-sm h-9"
                >
                  <option className="bg-background text-foreground" value="gemini-2.5-flash">gemini-2.5-flash (Default, Fast OCR)</option>
                  <option className="bg-background text-foreground" value="gemini-2.5-pro">gemini-2.5-pro (Next Gen High Quality)</option>
                  <option className="bg-background text-foreground" value="gemini-1.5-pro">gemini-1.5-pro (High Quality OCR)</option>
                  <option className="bg-background text-foreground" value="gemini-1.5-flash">gemini-1.5-flash (Fast)</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="p-3 bg-muted/60 border rounded-md">
                <h4 className="text-xs font-bold mb-1 flex items-center gap-1.5 capitalize text-primary">
                  <Sparkles className="w-3.5 h-3.5" /> {localEngine === 'local' ? 'Local LLM' : localEngine} Provider
                </h4>
                <p className="text-[10px] text-muted-foreground leading-relaxed mb-3">
                  {localEngine === 'local' 
                    ? "Connect to Ollama, LM Studio, or any OpenAI-compatible custom endpoint. The model must support JSON mode and vision capabilities." 
                    : `Provide the correct Base URL, API Key, and Model name for ${localEngine}. We expect an OpenAI-compatible /chat/completions endpoint (except for Claude if your proxy supports it).`}
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-bold block text-muted-foreground uppercase tracking-wider mb-1">API Base URL</label>
                    <input
                      value={localUrl}
                      onChange={(e) => setLocalUrl(e.target.value)}
                      placeholder={
                        localEngine === 'openai' ? "https://api.openai.com/v1" :
                        localEngine === 'claude' ? "https://api.anthropic.com/v1" :
                        localEngine === 'qwen' ? "https://dashscope.aliyuncs.com/compatible-mode/v1" :
                        "http://localhost:11434/v1"
                      }
                      className="w-full text-xs p-1.5 border border-border bg-background rounded-md outline-none focus:border-primary shadow-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[10px] font-bold block text-muted-foreground uppercase tracking-wider mb-1">Model Name</label>
                    <select
                      value={
                        (localEngine === 'openai' && ['gpt-4o', 'gpt-4o-mini', 'o1-mini', 'o3-mini'].includes(localModel)) ? localModel :
                        (localEngine === 'claude' && ['claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'].includes(localModel)) ? localModel :
                        (localEngine === 'qwen' && ['qwen-vl-max-latest', 'qwen-vl-plus-latest', 'qwen2.5-max'].includes(localModel)) ? localModel :
                        (localEngine === 'local' && ['llama3.2-vision', 'llava', 'llama3', 'qwen2.5', 'deepseek-r1'].includes(localModel)) ? localModel :
                        'custom'
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val !== 'custom') {
                          setLocalModel(val);
                        } else {
                          if (['gpt-4o', 'gpt-4o-mini', 'o1-mini', 'o3-mini', 'claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest', 'qwen-vl-max-latest', 'qwen-vl-plus-latest', 'qwen2.5-max', 'llama3.2-vision', 'llava', 'llama3', 'qwen2.5', 'deepseek-r1'].includes(localModel)) {
                            setLocalModel('');
                          }
                        }
                      }}
                      className="w-full text-xs p-2 border border-border bg-background text-foreground rounded-md outline-none focus:border-primary shadow-sm h-9"
                    >
                      {localEngine === 'openai' && (
                        <>
                          <option className="bg-background text-foreground" value="gpt-4o">gpt-4o (Best for Vision/OCR)</option>
                          <option className="bg-background text-foreground" value="gpt-4o-mini">gpt-4o-mini (Fast & Cheap)</option>
                          <option className="bg-background text-foreground" value="o1-mini">o1-mini (Reasoning)</option>
                          <option className="bg-background text-foreground" value="o3-mini">o3-mini (Advanced Reasoning)</option>
                        </>
                      )}
                      {localEngine === 'claude' && (
                        <>
                          <option className="bg-background text-foreground" value="claude-3-7-sonnet-latest">claude-3-7-sonnet-latest (Latest overall)</option>
                          <option className="bg-background text-foreground" value="claude-3-5-sonnet-latest">claude-3-5-sonnet-latest (Best vision/code)</option>
                          <option className="bg-background text-foreground" value="claude-3-5-haiku-latest">claude-3-5-haiku-latest (Fastest)</option>
                          <option className="bg-background text-foreground" value="claude-3-opus-latest">claude-3-opus-latest (Maximum capability)</option>
                        </>
                      )}
                      {localEngine === 'qwen' && (
                        <>
                          <option className="bg-background text-foreground" value="qwen-vl-max-latest">qwen-vl-max-latest (Best for OCR/Vision)</option>
                          <option className="bg-background text-foreground" value="qwen-vl-plus-latest">qwen-vl-plus-latest (Fast Vision)</option>
                          <option className="bg-background text-foreground" value="qwen2.5-max">qwen2.5-max (Text only)</option>
                        </>
                      )}
                      {localEngine === 'local' && (
                        <>
                          <option className="bg-background text-foreground" value="llama3.2-vision">llama3.2-vision (Best local vision)</option>
                          <option className="bg-background text-foreground" value="llava">llava (Standard local vision)</option>
                          <option className="bg-background text-foreground" value="llama3">llama3 (Text only)</option>
                          <option className="bg-background text-foreground" value="qwen2.5">qwen2.5 (Strong alternative)</option>
                          <option className="bg-background text-foreground" value="deepseek-r1">deepseek-r1 (Reasoning)</option>
                        </>
                      )}
                      <option className="bg-background text-foreground" value="custom">Custom Model...</option>
                    </select>
                    
                    {!(
                      (localEngine === 'openai' && ['gpt-4o', 'gpt-4o-mini', 'o1-mini', 'o3-mini'].includes(localModel)) ||
                      (localEngine === 'claude' && ['claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'].includes(localModel)) ||
                      (localEngine === 'qwen' && ['qwen-vl-max-latest', 'qwen-vl-plus-latest', 'qwen2.5-max'].includes(localModel)) ||
                      (localEngine === 'local' && ['llama3.2-vision', 'llava', 'llama3', 'qwen2.5', 'deepseek-r1'].includes(localModel))
                    ) && (
                      <input
                        value={localModel}
                        onChange={(e) => setLocalModel(e.target.value)}
                        placeholder="Type custom model name..."
                        className="w-full text-xs p-1.5 border border-border bg-background rounded-md outline-none focus:border-primary shadow-sm mt-1"
                      />
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] font-bold block text-muted-foreground uppercase tracking-wider mb-1">API Key {localEngine === 'local' ? '(Optional)' : '(Required)'}</label>
                    <input
                      type="password"
                      value={localApiKey}
                      onChange={(e) => setLocalApiKey(e.target.value)}
                      placeholder="Bearer token..."
                      className="w-full text-xs p-1.5 border border-border bg-background rounded-md outline-none focus:border-primary font-mono shadow-sm"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
          <Button variant="outline" onClick={() => setShowSettingsDialog(false)}>Cancel</Button>
          <Button onClick={handleSave}>Save & Continue</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
