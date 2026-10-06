import React, { useState, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MessageSquare,
  X,
  Bot,
  User,
  ImageIcon,
  Loader2,
  Paperclip,
  Camera,
  Mic,
  MicOff,
  Layout,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { useAppSettings } from "@/context/AppSettingsContext";
import { useLanguage } from "@/context/LanguageContext";
import { getApiUrl } from '@/lib/api';
import {
  AIContextPacket,
  AIPage,
  AIMode,
  AISelectionType,
} from "@/lib/aiContextPacket";


interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  imageUrl?: string;
}

function formatComicWithFlux(userPrompt: string, baseText?: string): string {
  const seed = Math.floor(Math.random() * 100000000);
  const cleanPrompt = userPrompt
    .replace(/^(please\s+)?(create|make|generate|draw|illustrate|write)\s+(a\s+)?(comic|comic\s+page|comic\s+book|manga)?\s*(about|of|for)?/i, "")
    .trim() || userPrompt.trim() || "epic comic adventure";

  const panel1Prompt = `Wide establishing shot, ${cleanPrompt}, scene opening, comic book style, graphic novel illustration, detailed ink linework, vivid cel shading`;
  const panel2Prompt = `Dynamic action shot, ${cleanPrompt}, rising tension, expressive character, dramatic lighting, bold comic inks, vivid colors`;
  const panel3Prompt = `Intense dramatic climax action, ${cleanPrompt}, powerful energy, cinematic angle, comic book panel, cel shaded, highly detailed`;
  const panel4Prompt = `Resolution aftermath scene, ${cleanPrompt}, heroic triumphant pose, atmospheric glowing lighting, comic illustration, vibrant`;

  const p1Url = `/api/ai/generate-image?prompt=${encodeURIComponent(panel1Prompt)}&width=1024&height=1024&seed=${seed}&quality=high`;
  const p2Url = `/api/ai/generate-image?prompt=${encodeURIComponent(panel2Prompt)}&width=1024&height=1024&seed=${seed}&quality=high`;
  const p3Url = `/api/ai/generate-image?prompt=${encodeURIComponent(panel3Prompt)}&width=1024&height=1024&seed=${seed}&quality=high`;
  const p4Url = `/api/ai/generate-image?prompt=${encodeURIComponent(panel4Prompt)}&width=1024&height=1024&seed=${seed}&quality=high`;

  let response = `Here is your comic page generated with **Gemma + FLUX**:\n\n`;
  if (baseText && baseText.length > 25 && !baseText.includes("trouble connecting") && !baseText.includes("having trouble")) {
    response += `${baseText.trim()}\n\n---\n\n`;
  }

  response += `### Panel 1: Establishing the Scene
![Panel 1: Introduction](${p1Url})
**Dialogue / Caption**: "The story begins here..."

### Panel 2: The Rising Action
![Panel 2: Rising Action](${p2Url})
**Dialogue / Caption**: "Look over there! Something is happening!"

### Panel 3: Climax
![Panel 3: The Climax](${p3Url})
**Dialogue / Caption**: "Now is our chance — hold on tight!"

### Panel 4: Resolution
![Panel 4: Aftermath](${p4Url})
**Dialogue / Caption**: "We made it. Onto the next adventure!"

---

[🎨 Generate Full Comic in Comic Creator](#action:generate-comic:${encodeURIComponent(cleanPrompt)})
[Create Comic Script](#action:open-create-script) · [Open Drawing Board](#action:open-draw-board)`;

  return response;
}

const AgentImage: React.FC<{ src?: string; alt?: string; insertLabel: string }> = ({ src, alt, insertLabel }) => {
  const currentSrc = src;
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  return (
    <div className="mt-2 rounded overflow-hidden relative group bg-black/5 min-h-[160px] flex items-center justify-center border">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/40 z-10">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      )}
      {!hasError ? (
        <img
          src={currentSrc}
          alt={alt || "FLUX Comic Artwork"}
          className="w-full h-auto object-contain rounded-md transition-opacity duration-300"
          loading="lazy"
          onLoad={() => setIsLoading(false)}
          onError={() => {
            setHasError(true);
            setIsLoading(false);
          }}
        />
      ) : (
        <div className="p-4 text-xs text-muted-foreground text-center">
          <ImageIcon className="w-6 h-6 mx-auto mb-1 opacity-50" />
          FLUX image generation in progress...
        </div>
      )}
      <Button
        size="sm"
        className="absolute bottom-2 right-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shadow-md z-20"
        onClick={(e) => {
          e.stopPropagation();
          window.dispatchEvent(
            new CustomEvent("insert-comic-image", {
              detail: { imageUrl: currentSrc || src },
            }),
          );
        }}
      >
        {insertLabel}
      </Button>
    </div>
  );
};

const AutoFillPanel = ({ panelId, href }: { panelId: string; href: string }) => {
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("insert-comic-image", {
        detail: { imageUrl: href, panelId: panelId },
      }),
    );
  }, [panelId, href]);
  return (
    <div className="text-xs text-muted-foreground italic my-1 flex items-center gap-1">
      <Layout className="w-3 h-3" /> Auto-filled Panel {panelId}
    </div>
  );
};

export function AIAgentChat({
  isFullscreen = false,
  activeView = "read",
}: {
  isFullscreen?: boolean;
  activeView?: string;
}) {
  const { t } = useLanguage();
  const { llmEngine, geminiApiKey } = useAppSettings();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [activeSelection, setActiveSelection] = useState<{
    type: AISelectionType;
    content: string;
  } | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [size, setSize] = useState({
    width:
      typeof window !== "undefined"
        ? Math.min(550, window.innerWidth - 32)
        : 550,
    height: 450,
  });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Determine current subpage for contextual greeting and assistance: "read" | "create" | "convert" | "faq" | "home"
  const normalizedSubpage = useMemo(() => {
    const v = (activeView || "").toLowerCase();
    if (v === "read" || (typeof window !== "undefined" && window.location.pathname.includes("/read"))) return "read";
    if (v === "create" || (typeof window !== "undefined" && window.location.pathname.includes("/create"))) return "create";
    if (v === "convert" || (typeof window !== "undefined" && window.location.pathname.includes("/convert"))) return "convert";
    if (v === "faq" || (typeof window !== "undefined" && window.location.pathname.includes("/faq"))) return "faq";
    return "home";
  }, [activeView]);

  // Contextual greeting text based on subpage
  const subpageGreeting = useMemo(() => {
    switch (normalizedSubpage) {
      case "read":
        return t("aiAgentGreetingRead") || "📖 Hi! I'm your reading companion. I can explain literary allusions, cultural context, translate foreign dialogue, or summarize chapters for you.";
      case "create":
        return t("aiAgentGreetingCreate") || "🎨 Hi! I'm your creative co-pilot. I can help brainstorm plotlines, draft comic scripts & bubbles, polish story prose, or generate Flux illustration prompts.";
      case "convert":
        return t("aiAgentGreetingConvert") || "🔄 Hi! I can assist with document & comic processing — guide panel splitting, OCR text recognition, manga translation, or format conversion.";
      case "faq":
        return t("aiAgentGreetingFaq") || "💡 Hi! Have questions about EbookCC? I can explain offline LiteRT panel detection, format support, cloud sync, or keyboard shortcuts.";
      case "home":
      default:
        return t("aiAgentGreeting") || "👋 Hi! I can help brainstorm ideas, write scripts, or draw something. What would you like to create?";
    }
  }, [normalizedSubpage, t]);

  const startResize = (
    e: React.PointerEvent,
    dir: "t" | "r" | "l" | "tr" | "tl",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    
    const target = e.currentTarget as HTMLElement;
    if (target.setPointerCapture) {
      target.setPointerCapture(e.pointerId);
    }

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: size.width,
      startH: size.height,
    };
    
    const handlePointerMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      let newW = dragRef.current.startW;
      let newH = dragRef.current.startH;

      if (dir.includes("r")) newW += ev.clientX - dragRef.current.startX;
      if (dir.includes("l")) newW += dragRef.current.startX - ev.clientX;
      if (dir.includes("t")) newH -= ev.clientY - dragRef.current.startY;

      setSize({
        width: Math.max(300, Math.min(newW, window.innerWidth - 32)),
        height: Math.max(300, Math.min(newH, window.innerHeight - 32)),
      });
    };
    
    const handlePointerUp = (ev: PointerEvent) => {
      if (target.releasePointerCapture) {
        target.releasePointerCapture(ev.pointerId);
      }
      dragRef.current = null;
      target.removeEventListener("pointermove", handlePointerMove);
      target.removeEventListener("pointerup", handlePointerUp);
      document.body.style.userSelect = "";
    };
    
    document.body.style.userSelect = "none";
    target.addEventListener("pointermove", handlePointerMove);
    target.addEventListener("pointerup", handlePointerUp);
  };
  const chatRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const toggleBtn = document.getElementById("ai-agent-toggle-btn");
      if (
        chatRef.current &&
        !chatRef.current.contains(e.target as Node) &&
        (!toggleBtn || !toggleBtn.contains(e.target as Node))
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    const handleQuote = (e: any) => {
      setIsOpen(true);
      if (e.detail?.type === "image") {
        const url = e.detail.imageUrl;
        setPendingImage(url);

        let extractedPrompt = "";
        const match = url?.match(/prompt\/([^?]+)/);
        if (match) {
          try {
            extractedPrompt = decodeURIComponent(match[1]);
          } catch (e) {}
        }

        setActiveSelection({
          type: "panel_image",
          content: extractedPrompt || url || "panel image",
        });

        if (extractedPrompt) {
          setInput(`Regenerate with same style: "${extractedPrompt}"`);
        }
      } else if (e.detail?.type === "ocr_bubble") {
        setActiveSelection({
          type: "ocr_bubble",
          content: e.detail.text || "",
        });
        setInput((prev) =>
          prev ? prev + " " + `"${e.detail.text}"` : `"${e.detail.text}"`,
        );
      } else if (e.detail?.type === "canvas_state") {
        setActiveSelection({
          type: "canvas_state",
          content: e.detail.text || "",
        });
        setInput((prev) =>
          prev ? prev + " " + `"${e.detail.text}"` : `"${e.detail.text}"`,
        );
      } else if (e.detail?.type === "text") {
        setActiveSelection({
          type: "text",
          content: e.detail.text || "",
        });
        setInput((prev) =>
          prev ? prev + " " + `"${e.detail.text}"` : `"${e.detail.text}"`,
        );
      }
    };
    window.addEventListener("quote-to-agent", handleQuote);
    return () => window.removeEventListener("quote-to-agent", handleQuote);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingImage]);

  const handleListen = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Voice input is not supported in your browser.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
      setIsListening(false);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) {
        setPendingImage(ev.target.result as string);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleSend = async () => {
    if ((!input.trim() && !pendingImage) || isGenerating) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString() + Math.random().toString(36).substring(2),
      role: "user",
      text: input.trim(),
      imageUrl: pendingImage || undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setPendingImage(null);
    setIsGenerating(true);

    try {
      // 1. Determine page: READ | CREATE | CONVERT
      let page: AIPage = "READ";
      const normalizedView = (activeView || "").toLowerCase();
      if (normalizedView.includes("convert") || window.location.pathname.includes("/convert")) {
        page = "CONVERT";
      } else if (normalizedView.includes("create") || window.location.pathname.includes("/create")) {
        page = "CREATE";
      } else if (normalizedView.includes("read") || window.location.pathname.includes("/read")) {
        page = "READ";
      } else {
        if (document.body.innerText.includes("Convert") && document.querySelector('input[type="file"]')) {
          page = "CONVERT";
        } else if (document.querySelector(".editor-doc") || typeof (window as any).getComicCanvasContext === "function") {
          page = "CREATE";
        } else {
          page = "READ";
        }
      }

      // 2. Determine mode: novel | comic (READ), comic | richtext (CREATE)
      let mode: AIMode = "novel";
      if (page === "READ") {
        const isComic = Boolean(
          document.querySelector(".reader-split-p") ||
          document.querySelector('img[alt*="P"]') ||
          document.querySelector(".comic-page-renderer") ||
          document.querySelector('[data-reader-type="comic"]') ||
          document.querySelector('.reader-comic')
        );
        mode = isComic ? "comic" : "novel";
      } else if (page === "CREATE") {
        const isRichText = Boolean(document.querySelector(".editor-doc"));
        mode = isRichText ? "richtext" : "comic";
      } else {
        mode = "comic";
      }

      // 3. Determine title & lang (current open content, empty string if not applicable)
      let title = "";
      try {
        const titleEl = document.querySelector("h4[title], [data-book-title], .book-title");
        if (titleEl) {
          title = (titleEl.getAttribute("title") || titleEl.textContent || "").trim();
        }
      } catch (_) {}

      const lang = document.documentElement.lang || localStorage.getItem("ebookcc_language") || "en";

      // 4. Determine selectionType & selectedContent
      let selectionType: AISelectionType = "text";
      let selectedContent = "";

      const windowSelection = typeof window !== "undefined" ? window.getSelection()?.toString().trim() : "";
      if (windowSelection) {
        selectionType = "text";
        selectedContent = windowSelection;
      } else if (activeSelection) {
        selectionType = activeSelection.type;
        selectedContent = activeSelection.content;
      } else {
        if (page === "READ") {
          selectionType = mode === "comic" ? "ocr_bubble" : "text";
          selectedContent = "";
        } else if (page === "CREATE") {
          if (mode === "comic") {
            selectionType = "canvas_state";
            selectedContent = typeof (window as any).getComicPanelsContext === "function" ? (window as any).getComicPanelsContext() : "";
          } else {
            selectionType = "text";
            selectedContent = "";
          }
        } else {
          selectionType = "text";
          selectedContent = "";
        }
      }

      // Rule 1: Context packet strictly contains: page, mode, title, lang, selectionType, selectedContent, userMessage
      // Rule 4: Excludes page numbers, total pages, availableActions, imageBase64
      const contextPacket: AIContextPacket = {
        page,
        mode,
        title,
        lang,
        selectionType,
        selectedContent,
        userMessage: userMessage.text,
      };

      let resultText = "";

      try {
        const headers: any = { "Content-Type": "application/json" };
        if (geminiApiKey) {
          headers["x-gemini-api-key"] = geminiApiKey;
        }
        const res = await fetch(`${getApiUrl()}/api/agent-chat`, {
          method: "POST",
          headers,
          body: JSON.stringify(contextPacket),
        });

        if (res.ok) {
          const text = await res.text();
          if (text.trim().startsWith("{")) {
            const data = JSON.parse(text);
            if (data.skip) {
              resultText = data.text || data.response || "To process or convert this document, please tap the options in the Convert menu tree (such as Split Panels, OCR, Translate, or Export).";
            } else {
              resultText = data.text || data.response || data.candidates?.[0]?.content?.parts?.[0]?.text || data.content || "";
            }
          } else if (text.trim()) {
            resultText = text.trim();
          }
        }
      } catch (err: any) {
        console.error("[AIAgentChat] Backend /api/agent-chat failed:", err);
      }

      setActiveSelection(null);

      const isComicRequest = /(comic|panel|manga|graphic novel|comic page|draw a comic|create a comic|generate a comic|make a comic|illustrate a comic)/i.test(userMessage.text);

      if (!resultText || resultText.includes("trouble connecting")) {
        if (isComicRequest) {
          resultText = formatComicWithFlux(userMessage.text);
        } else {
          resultText = `I have received your request for "${userMessage.text.slice(0, 50)}".\n\nYou can use the creator tools to generate comics or novel chapters directly:\n\n[🎨 Open Comic Creator](#action:generate-comic:${encodeURIComponent(userMessage.text)})\n[✒️ Open Story Writer](#action:generate-story:${encodeURIComponent(userMessage.text)})`;
        }
      } else if (isComicRequest && !resultText.includes("![") && !resultText.includes("<img")) {
        resultText = formatComicWithFlux(userMessage.text, resultText);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString() + Math.random().toString(36).substring(2),
          role: "agent",
          text: resultText,
        },
      ]);
    } catch (error: any) {
      console.error(error);
      const isComic = /(comic|panel|manga|graphic novel|comic page|draw a comic|create a comic|generate a comic)/i.test(userMessage.text);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString() + Math.random().toString(36).substring(2),
          role: "agent",
          text: isComic
            ? formatComicWithFlux(userMessage.text)
            : "I'm having trouble connecting to the free public AI services right now.\n\n💡 Please check your connection or connect a free Google Gemini API key in [Settings](#action:open-settings) for unlimited responses.",
        },
      ]);
    } finally {
      setIsGenerating(false);
      setPendingImage(null);
    }
  };

  return (
    <div
      className="fixed bottom-[1%] left-[1%] z-[999] flex flex-col items-start"
      style={{ display: isFullscreen ? "none" : "flex" }}
    >
      {isOpen && (
        <div
          ref={chatRef}
          style={{ width: size.width, height: size.height }}
          className="bg-background border rounded-xl shadow-xl mb-2 flex flex-col overflow-hidden transition-opacity animate-in relative slide-in-from-bottom-2"
        >
          {/* Resize handles */}
          <div
            className="absolute top-0 left-4 right-4 h-2 hover:bg-primary/20 cursor-ns-resize z-50 touch-none"
            onPointerDown={(e) => startResize(e, "t")}
          />
          <div
            className="absolute top-4 right-0 bottom-4 w-2 hover:bg-primary/20 cursor-ew-resize z-50 touch-none"
            onPointerDown={(e) => startResize(e, "r")}
          />
          <div
            className="absolute top-4 left-0 bottom-4 w-2 hover:bg-primary/20 cursor-ew-resize z-50 touch-none"
            onPointerDown={(e) => startResize(e, "l")}
          />
          <div
            className="absolute top-0 right-0 w-6 h-6 hover:bg-primary/20 cursor-nesw-resize z-50 touch-none"
            onPointerDown={(e) => startResize(e, "tr")}
          />
          <div
            className="absolute top-0 left-0 w-6 h-6 hover:bg-primary/20 cursor-nwse-resize z-50 touch-none"
            onPointerDown={(e) => startResize(e, "tl")}
          />

          <div className="bg-muted p-3 flex justify-between items-center border-b shrink-0 cursor-default">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-primary" />
              <span className="font-semibold text-sm">{t("featAiAgentTitle")}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 relative z-50"
              onClick={() => setIsOpen(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-3">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-start justify-start text-left text-muted-foreground p-4 gap-4">
                <span className="text-sm text-left text-foreground/90 leading-relaxed">
                  {subpageGreeting}
                </span>
                <div className="flex flex-col w-full gap-2.5 mt-1">
                  {normalizedSubpage === "read" && (
                    <>
                      <button
                        type="button"
                        className="w-full justify-start text-xs text-left text-primary hover:text-primary/80 underline underline-offset-4 decoration-primary/60 hover:decoration-primary bg-transparent hover:bg-transparent p-0 border-0 cursor-pointer font-medium transition-colors"
                        onClick={() => {
                          setIsOpen(true);
                          setInput("Can you explain the historical/cultural context and allusions in this section?");
                        }}
                      >
                        📖 Explain cultural context & literary allusions
                      </button>
                      <button
                        type="button"
                        className="w-full justify-start text-xs text-left text-primary hover:text-primary/80 underline underline-offset-4 decoration-primary/60 hover:decoration-primary bg-transparent hover:bg-transparent p-0 border-0 cursor-pointer font-medium transition-colors"
                        onClick={() => {
                          setIsOpen(true);
                          setInput("Translate this selected dialogue or text into natural language with cultural notes: ");
                        }}
                      >
                        🌐 Translate selected text or dialogue
                      </button>
                      <button
                        type="button"
                        className="w-full justify-start text-xs text-left text-primary hover:text-primary/80 underline underline-offset-4 decoration-primary/60 hover:decoration-primary bg-transparent hover:bg-transparent p-0 border-0 cursor-pointer font-medium transition-colors"
                        onClick={() => {
                          setIsOpen(true);
                          setInput("Can you summarize this passage and its key narrative beats?");
                        }}
                      >
                        📝 Summarize this chapter or passage
                      </button>
                    </>
                  )}

                  {normalizedSubpage === "create" && (
                    <>
                      <button
                        type="button"
                        className="w-full justify-start text-xs text-left text-primary hover:text-primary/80 underline underline-offset-4 decoration-primary/60 hover:decoration-primary bg-transparent hover:bg-transparent p-0 border-0 cursor-pointer font-medium transition-colors"
                        onClick={() => {
                          setIsOpen(true);
                          setInput("Help me script a 4-panel comic scene with dialogue bubbles about...");
                        }}
                      >
                        🎨 Create comic panel layout & script
                      </button>
                      <button
                        type="button"
                        className="w-full justify-start text-xs text-left text-primary hover:text-primary/80 underline underline-offset-4 decoration-primary/60 hover:decoration-primary bg-transparent hover:bg-transparent p-0 border-0 cursor-pointer font-medium transition-colors"
                        onClick={() => {
                          setIsOpen(true);
                          setInput("Please polish and improve the narrative flow of this story draft: ");
                        }}
                      >
                        ✒️ Polish story draft & improve dialogue
                      </button>
                      <button
                        type="button"
                        className="w-full justify-start text-xs text-left text-primary hover:text-primary/80 underline underline-offset-4 decoration-primary/60 hover:decoration-primary bg-transparent hover:bg-transparent p-0 border-0 cursor-pointer font-medium transition-colors"
                        onClick={() => {
                          setIsOpen(true);
                          setInput("Create a detailed Flux illustration prompt for a comic panel depicting...");
                        }}
                      >
                        ✨ Generate Flux illustration image prompt
                      </button>
                    </>
                  )}

                  {normalizedSubpage === "convert" && (
                    <>
                      <button
                        type="button"
                        className="w-full justify-start text-xs text-left text-primary hover:text-primary/80 underline underline-offset-4 decoration-primary/60 hover:decoration-primary bg-transparent hover:bg-transparent p-0 border-0 cursor-pointer font-medium transition-colors"
                        onClick={() => {
                          setIsOpen(true);
                          setInput("How do I auto-split comic panels and adjust crop borders?");
                        }}
                      >
                        ✂️ How to auto-split comic panels & boxes
                      </button>
                      <button
                        type="button"
                        className="w-full justify-start text-xs text-left text-primary hover:text-primary/80 underline underline-offset-4 decoration-primary/60 hover:decoration-primary bg-transparent hover:bg-transparent p-0 border-0 cursor-pointer font-medium transition-colors"
                        onClick={() => {
                          setIsOpen(true);
                          setInput("How do I run OCR on speech bubbles and translate manga panels?");
                        }}
                      >
                        🔍 OCR speech bubble extraction & translation
                      </button>
                      <button
                        type="button"
                        className="w-full justify-start text-xs text-left text-primary hover:text-primary/80 underline underline-offset-4 decoration-primary/60 hover:decoration-primary bg-transparent hover:bg-transparent p-0 border-0 cursor-pointer font-medium transition-colors"
                        onClick={() => {
                          setIsOpen(true);
                          setInput("What is the best format (CBZ, EPUB, PDF) to export my converted comic for Kindle/e-readers?");
                        }}
                      >
                        📦 Optimize & export formats for e-readers
                      </button>
                    </>
                  )}

                  {normalizedSubpage === "faq" && (
                    <>
                      <button
                        type="button"
                        className="w-full justify-start text-xs text-left text-primary hover:text-primary/80 underline underline-offset-4 decoration-primary/60 hover:decoration-primary bg-transparent hover:bg-transparent p-0 border-0 cursor-pointer font-medium transition-colors"
                        onClick={() => {
                          setIsOpen(true);
                          setInput("How does LiteRT in-browser panel detection work with WebGPU and WASM?");
                        }}
                      >
                        ⚡ How does offline LiteRT detection work?
                      </button>
                      <button
                        type="button"
                        className="w-full justify-start text-xs text-left text-primary hover:text-primary/80 underline underline-offset-4 decoration-primary/60 hover:decoration-primary bg-transparent hover:bg-transparent p-0 border-0 cursor-pointer font-medium transition-colors"
                        onClick={() => {
                          setIsOpen(true);
                          setInput("How do I backup and sync my comics and books to Google Drive?");
                        }}
                      >
                        ☁️ How do I connect Google Drive sync?
                      </button>
                      <button
                        type="button"
                        className="w-full justify-start text-xs text-left text-primary hover:text-primary/80 underline underline-offset-4 decoration-primary/60 hover:decoration-primary bg-transparent hover:bg-transparent p-0 border-0 cursor-pointer font-medium transition-colors"
                        onClick={() => {
                          setIsOpen(true);
                          setInput("Show me the keyboard and drawing shortcuts available in EbookCC.");
                        }}
                      >
                        ⌨️ What are the reading & canvas shortcuts?
                      </button>
                    </>
                  )}

                  {normalizedSubpage === "home" && (
                    <>
                      <button
                        type="button"
                        className="w-full justify-start text-xs text-left text-primary hover:text-primary/80 underline underline-offset-4 decoration-primary/60 hover:decoration-primary bg-transparent hover:bg-transparent p-0 border-0 cursor-pointer font-medium transition-colors"
                        onClick={() => {
                          setIsOpen(true);
                          setInput("I want to create a comic book about...");
                          window.dispatchEvent(
                            new CustomEvent("app-navigation", {
                              detail: { action: "open-comic-creator" },
                            }),
                          );
                        }}
                      >
                        🎨 {t("createComicCardTitle")}
                      </button>
                      <button
                        type="button"
                        className="w-full justify-start text-xs text-left text-primary hover:text-primary/80 underline underline-offset-4 decoration-primary/60 hover:decoration-primary bg-transparent hover:bg-transparent p-0 border-0 cursor-pointer font-medium transition-colors"
                        onClick={() => {
                          setIsOpen(true);
                          setInput("I want to write a story about...");
                          window.dispatchEvent(
                            new CustomEvent("app-navigation", {
                              detail: { action: "open-story-writer" },
                            }),
                          );
                        }}
                      >
                        ✒️ {t("writeAStory")}
                      </button>
                      <button
                        type="button"
                        className="w-full justify-start text-xs text-left text-primary hover:text-primary/80 underline underline-offset-4 decoration-primary/60 hover:decoration-primary bg-transparent hover:bg-transparent p-0 border-0 cursor-pointer font-medium transition-colors"
                        onClick={() => {
                          setIsOpen(true);
                          setInput("I want to convert an ebook...");
                          window.dispatchEvent(
                            new CustomEvent("app-navigation", {
                              detail: { action: "open-converter" },
                            }),
                          );
                        }}
                      >
                        📚 {t("convertCardTitle")}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "agent" && (
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Bot className="w-3.5 h-3.5 text-primary" />
                  </div>
                )}
                <div
                  className={`p-2 rounded-lg text-sm max-w-[85%] ${msg.role === "user" ? "bg-primary text-primary-foreground rounded-br-none" : "bg-muted rounded-bl-none overflow-x-auto"}`}
                >
                  {msg.text && (
                    <div
                      className={
                        msg.role === "agent"
                          ? "prose prose-sm dark:prose-invert max-w-none"
                          : ""
                      }
                    >
                      {msg.role === "agent" ? (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: ({ node, children }) => (
                              <div className="mb-2">{children}</div>
                            ),
                            a: ({ node, href, children, ...props }) => {
                              if (href?.startsWith("#action:")) {
                                return (
                                  <button
                                    type="button"
                                    className="my-1 py-0.5 text-left text-primary hover:text-primary/80 underline underline-offset-4 decoration-primary/70 hover:decoration-primary font-semibold text-xs sm:text-sm bg-transparent hover:bg-transparent border-0 p-0 inline-flex items-center gap-1 cursor-pointer transition-colors"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      const event = new CustomEvent(
                                        "app-navigation",
                                        {
                                          detail: {
                                            action: href.replace(
                                              "#action:",
                                              "",
                                            ),
                                          },
                                        },
                                      );
                                      window.dispatchEvent(event);
                                    }}
                                  >
                                    {children}
                                  </button>
                                );
                              }
                              
                              if ((href?.includes("generate-image") || href?.includes("image")) && children?.toString().startsWith("Fill Panel ")) {
                                const panelId = children.toString().replace("Fill Panel ", "").trim();
                                return <AutoFillPanel panelId={panelId} href={href} />;
                              }
                              
                              return (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-blue-500 underline"
                                  {...props}
                                >
                                  {children}
                                </a>
                              );
                            },
                            img: ({ node, src, alt, ...props }) => {
                              return (
                                <AgentImage
                                  src={src}
                                  alt={alt}
                                  insertLabel={t("insertIntoProject")}
                                />
                              );
                            },
                          }}
                        >
                          {msg.text}
                        </ReactMarkdown>
                      ) : (
                        <div>{msg.text}</div>
                      )}
                    </div>
                  )}
                  {msg.imageUrl && (
                    <div className="mt-2 rounded overflow-hidden">
                      <img
                        src={msg.imageUrl || undefined}
                        alt="Uploaded or Generated"
                        className="w-full h-auto object-contain bg-black/5"
                      />
                    </div>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
                    <User className="w-3.5 h-3.5 text-primary-foreground" />
                  </div>
                )}
              </div>
            ))}
            {isGenerating && (
              <div className="flex gap-2 justify-start items-center text-muted-foreground text-sm">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Bot className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="flex gap-1 items-center bg-muted p-2 rounded-lg rounded-bl-none">
                  <span className="animate-pulse">●</span>
                  <span className="animate-pulse delay-75">●</span>
                  <span className="animate-pulse delay-150">●</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-2 bg-muted/50 border-t flex flex-col gap-2">
            {pendingImage && (
              <div className="relative inline-block w-16 h-16 rounded border bg-background overflow-hidden p-1">
                <img
                  src={pendingImage || undefined}
                  alt="Pending"
                  className="w-full h-full object-cover rounded-sm"
                />
                <button
                  onClick={() => setPendingImage(null)}
                  className="absolute top-0 right-0 bg-black/50 text-white rounded-bl p-0.5 hover:bg-black/70 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            <div className="flex flex-col bg-background border rounded-md focus-within:ring-2 focus-within:ring-ring focus-within:border-primary shadow-sm transition-all overflow-hidden">
              <textarea
                placeholder={t("askAiAgent")}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = e.target.scrollHeight + "px";
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={1}
                className="text-sm shadow-none w-full resize-none bg-transparent px-3 py-2 min-h-[40px] max-h-[150px] outline-none"
              />

              <div className="flex justify-between items-end px-2 pb-1.5 pt-0.5">
                <div className="flex gap-0.5 items-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => fileInputRef.current?.click()}
                    title={t("uploadImageTooltip")}
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => cameraInputRef.current?.click()}
                    title={t("takePhotoTooltip")}
                  >
                    <Camera className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={async () => {
                      let dataUrl = null;
                      if ((window as any).activeComicPanelRef) {
                        try {
                          const { toPng } = await import("html-to-image");
                          dataUrl = await toPng(
                            (window as any).activeComicPanelRef,
                            { quality: 0.8 },
                          );
                        } catch (e) {
                          console.error("Failed to capture panel", e);
                        }
                      }

                      if (
                        !dataUrl &&
                        typeof (window as any).getComicCanvasContext ===
                          "function"
                      ) {
                        dataUrl = await (window as any).getComicCanvasContext();
                      }

                      if (dataUrl) {
                        setPendingImage(dataUrl);
                        toast.success("Captured sketch/canvas successfully!");
                      } else {
                        toast.warning(
                          "No sketched panel or canvas available. Open Create mode and sketch first.",
                        );
                      }
                    }}
                    title={t("readCanvasTooltip")}
                  >
                    <Layout className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-7 w-7 ${isListening ? "text-red-500 animate-pulse" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={handleListen}
                    title={t("voiceInputTooltip")}
                  >
                    {isListening ? (
                      <MicOff className="w-3.5 h-3.5" />
                    ) : (
                      <Mic className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </div>

                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={(!input.trim() && !pendingImage) || isGenerating}
                  className="shrink-0 h-8 w-8 rounded-full ml-2 text-white bg-black hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
                >
                  {isGenerating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <MessageSquare className="w-3.5 h-3.5" />
                  )}
                </Button>
              </div>
            </div>
          </div>

          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*"
            onChange={handleFileUpload}
          />
          <input
            type="file"
            ref={cameraInputRef}
            className="hidden"
            accept="image/*"
            capture="environment"
            onChange={handleFileUpload}
          />
        </div>
      )}

      {!isOpen && (
        <button
          id="ai-agent-toggle-btn"
          onClick={() => setIsOpen(true)}
          className="relative px-3 py-1.5 portrait:w-9 portrait:h-9 portrait:p-0 portrait:justify-center flex gap-1.5 items-center hover:opacity-80 transition-all text-foreground cursor-pointer shadow-md rounded font-semibold text-xs tracking-wide border-0 outline-none"
          style={{ backgroundColor: "rgb(45, 198, 207)", color: "#000" }}
        >
          <Bot className="w-3.5 h-3.5" />
          <span className="portrait:hidden">{t("featAiAgentTitle")}</span>
        </button>
      )}
    </div>
  );
}
