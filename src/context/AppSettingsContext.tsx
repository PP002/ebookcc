import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { toast } from 'sonner';

export type LlmEngine = 'gemini' | 'local' | 'pollinations' | 'openai' | 'claude' | 'qwen';

export interface AppSettings {
  llmEngine: LlmEngine;
  setLlmEngine: (val: LlmEngine) => void;
  geminiApiKey: string;
  setGeminiApiKey: (val: string) => void;
  stabilityApiKey: string;
  setStabilityApiKey: (val: string) => void;
  localLlmUrl: string;
  setLocalLlmUrl: (val: string) => void;
  localLlmModel: string;
  setLocalLlmModel: (val: string) => void;
  localLlmApiKey: string;
  setLocalLlmApiKey: (val: string) => void;
  showSettingsDialog: boolean;
  setShowSettingsDialog: (val: boolean) => void;
}

const AppSettingsContext = createContext<AppSettings | undefined>(undefined);

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [llmEngine, setLlmEngine] = useState<LlmEngine>(() => (localStorage.getItem('llm_engine') || 'pollinations') as LlmEngine);
  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem('gemini_api_key') || "");
  const [stabilityApiKey, setStabilityApiKey] = useState(() => localStorage.getItem('stability_api_key') || "");
  const [localLlmUrl, setLocalLlmUrl] = useState(() => localStorage.getItem('local_llm_url') || "http://localhost:11434/v1");
  const [localLlmModel, setLocalLlmModel] = useState(() => localStorage.getItem('local_llm_model') || "llama3");
  const [localLlmApiKey, setLocalLlmApiKey] = useState(() => localStorage.getItem('local_llm_api_key') || "");
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);

  useEffect(() => {
    localStorage.setItem('llm_engine', llmEngine);
  }, [llmEngine]);

  useEffect(() => {
    if (geminiApiKey) localStorage.setItem('gemini_api_key', geminiApiKey);
    else localStorage.removeItem('gemini_api_key');
  }, [geminiApiKey]);

  useEffect(() => {
    if (stabilityApiKey) localStorage.setItem('stability_api_key', stabilityApiKey);
    else localStorage.removeItem('stability_api_key');
  }, [stabilityApiKey]);

  useEffect(() => {
    if (localLlmUrl) localStorage.setItem('local_llm_url', localLlmUrl);
  }, [localLlmUrl]);

  useEffect(() => {
    if (localLlmModel) localStorage.setItem('local_llm_model', localLlmModel);
  }, [localLlmModel]);

  useEffect(() => {
    if (localLlmApiKey) localStorage.setItem('local_llm_api_key', localLlmApiKey);
    else localStorage.removeItem('local_llm_api_key');
  }, [localLlmApiKey]);

  return (
    <AppSettingsContext.Provider value={{
      llmEngine, setLlmEngine,
      geminiApiKey, setGeminiApiKey,
      stabilityApiKey, setStabilityApiKey,
      localLlmUrl, setLocalLlmUrl,
      localLlmModel, setLocalLlmModel,
      localLlmApiKey, setLocalLlmApiKey,
      showSettingsDialog, setShowSettingsDialog
    }}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext);
  if (!context) throw new Error("useAppSettings must be used within AppSettingsProvider");
  return context;
}

export function handleApiError(err: any, setShowSettingsDialog: (val: boolean) => void, engine?: string) {
  const errorMsg = typeof err === 'string' ? err : (err.message || "");
  if (
    errorMsg.includes("429") || 
    errorMsg.includes("403") || 
    errorMsg.toLowerCase().includes("quota") || 
    errorMsg.includes("API_KEY_INVALID") || 
    errorMsg.toLowerCase().includes("user free tier expire") ||
    errorMsg.toLowerCase().includes("api key expired") ||
    errorMsg.toLowerCase().includes("api key not valid") ||
    errorMsg.toLowerCase().includes("api key missing") ||
    (engine === 'pollinations' && (errorMsg.includes("Failed to fetch") || errorMsg.includes("fetch") || errorMsg.includes("502") || errorMsg.includes("503") || errorMsg.includes("timeout")))
  ) {
    setShowSettingsDialog(true);
    if (engine === 'pollinations') {
      toast.error("Pollinations API is overloaded. Please switch to Gemini or another provider in App Settings.");
    } else {
      toast.error("API Key issue or Quota Exceeded. Please check App Settings.");
    }
    return true; 
  }
  return false;
}
