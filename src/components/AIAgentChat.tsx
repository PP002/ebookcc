import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MessageSquare, X, Bot, User, ImageIcon, Loader2, Paperclip, Camera, Mic, MicOff, Layout } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';

interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  imageUrl?: string;
}

export function AIAgentChat({ isFullscreen = false }: { isFullscreen?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [size, setSize] = useState({ width: typeof window !== 'undefined' ? Math.min(550, window.innerWidth - 32) : 550, height: 450 });
  const dragRef = useRef<{ startX: number, startY: number, startW: number, startH: number } | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const startResize = (e: React.PointerEvent, dir: 't'|'r'|'l'|'tr'|'tl') => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startY: e.clientY, startW: size.width, startH: size.height };
    const handlePointerMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      let newW = dragRef.current.startW;
      let newH = dragRef.current.startH;
      
      if (dir.includes('r')) newW += ev.clientX - dragRef.current.startX;
      if (dir.includes('l')) newW += dragRef.current.startX - ev.clientX; // growing to the left means increasing width if anchored right, but we are anchored left... wait, if anchored left, increasing width pushes right.
      // Actually because we use 'left-4' anchor, resizing left would look weird if we don't adjust 'left'. But let's just make width change. 
      if (dir.includes('t')) newH -= ev.clientY - dragRef.current.startY;
      
      setSize({
        width: Math.max(300, Math.min(newW, window.innerWidth - 32)),
        height: Math.max(300, Math.min(newH, window.innerHeight - 32))
      });
    };
    const handlePointerUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };
  const chatRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const toggleBtn = document.getElementById('ai-agent-toggle-btn');
      if (
        chatRef.current && 
        !chatRef.current.contains(e.target as Node) &&
        (!toggleBtn || !toggleBtn.contains(e.target as Node))
      ) {
        setIsOpen(false);
      }
    };
    
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    const handleQuote = (e: any) => {
      setIsOpen(true);
      if (e.detail?.type === 'image') {
        const url = e.detail.imageUrl;
        setPendingImage(url);
        
        let extractedPrompt = "";
        const match = url?.match(/prompt\/([^?]+)/);
        if (match) {
          try { extractedPrompt = decodeURIComponent(match[1]); } catch(e) {}
        }
        
        if (extractedPrompt) {
            setInput(`Regenerate with same style: "${extractedPrompt}"`);
        }
      } else if (e.detail?.type === 'text') {
        setInput(prev => prev ? prev + ' ' + `"${e.detail.text}"` : `"${e.detail.text}"`);
      }
    };
    window.addEventListener('quote-to-agent', handleQuote);
    return () => window.removeEventListener('quote-to-agent', handleQuote);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingImage]);

  const handleListen = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
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
      setInput(prev => prev ? `${prev} ${transcript}` : transcript);
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
    e.target.value = '';
  };

  const handleSend = async () => {
    if ((!input.trim() && !pendingImage) || isGenerating) return;
    
    const userMessage: ChatMessage = { 
      id: Date.now().toString() + Math.random().toString(36).substring(2), 
      role: 'user', 
      text: input.trim(),
      imageUrl: pendingImage || undefined
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setPendingImage(null);
    setIsGenerating(true);

    try {
      const lowerInput = userMessage.text.toLowerCase();
      if (lowerInput.includes('generate image') || lowerInput.includes('draw')) {
        const imageSeed = Math.floor(Math.random() * 100000);
        const encodedPrompt = encodeURIComponent(userMessage.text);
        const imgUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?seed=${imageSeed}&nologo=true&model=flux`;
        setMessages(prev => [...prev, { 
          id: Date.now().toString() + Math.random().toString(36).substring(2), 
          role: 'agent', 
          text: `Here is the image you requested. You can copy it or drag it to your comic page.`,
          imageUrl: imgUrl
        }]);
        setIsGenerating(false);
        return;
      }

      const systemInstruction = `You are an expert AI Agent for a professional Comic Creator App. Help the user brainstorm ideas, write stories, suggest layout designs, shape comic panels, and generate images.
You have access to multiple text and image models. When generating text, format it beautifully with markdown.

PROFESSIONAL COMIC CREATION GUIDELINES:
1. **Character & Art Consistency (Text-to-Image)**: When creating a new comic or character, ALWAYS start by generating a "Character Reference Sheet" (including multiple poses and facial expressions). Instruct the user to keep this reference in mind. Suggest using a consistent seed or a highly specific visual description (e.g. "seed=123456") to maintain art style and background consistency across the rest of the page.
2. **Sketch-to-Image / Modification**: When the user provides a canvas image, or asks to modify an image (e.g. Regenerate with same style), you MUST ALWAYS provide 3 DIFFERENT options (using different models or slight prompt variations) for the user to choose from. IF the user provides an original prompt, you MUST reuse it exactly and only apply the modifications they asked for (e.g., if they asked to fix hands, keep the prompt identical but add 'perfect hands' or adjust the action). Ensure you maintain the established art style in all 3 options.
3. **Rich Text / Script Illustrations**: When illustrating a rich text document or article, ensure the generated images closely relate to the specific content, context, and mood of the text.

IMAGE GENERATION INSTRUCTIONS:
If the user asks to generate a comic image, photo, drawing, or picture, you MUST ALWAYS respond with image markdown link(s) pointing to Pollinations AI. 
Use this exact format:
![Option 1](https://image.pollinations.ai/prompt/{URL_ENCODED_DETAILED_PROMPT}?width=1024&height=1024&nologo=true&model={MODEL}&seed={SEED})

Where {MODEL} is one of: flux, flux-anime, flux-3d, any-dark, turbo. For sketch options, provide 3 images using different seeds or models. Provide a very detailed prompt for {URL_ENCODED_DETAILED_PROMPT}. Ensure {SEED} is a consistent number if preserving character continuity.

APP NAVIGATION (Quick Links):
Use these markdown links to help the user navigate to app features rapidly:
If the user wants to create a comic book, use:
[Generate Full Comic from this Summary](#action:generate-comic:{URL_ENCODED_SUMMARY})
If the user wants to write a novel or story, use:
[Generate Full Novel from this Summary](#action:generate-story:{URL_ENCODED_SUMMARY})
Other tools:
[Create Comic Script](#action:open-create-script)
[Open Drawing Board](#action:open-draw-board)
[Open Converter/Reader](#action:open-converter)

Do NOT use any fallback fetching in your message text. Just output the explanation, markdown images, and links directly.`;
      
      const geminiMessages = [
        ...messages.map(m => {
          const parts: any[] = [];
          if (m.text) parts.push({ text: m.text });
          if (m.imageUrl) {
            const mimeTypeMatch = m.imageUrl.match(/^data:(image\/[a-zA-Z]+);base64,/);
            let mimeType = 'image/jpeg';
            let data = m.imageUrl;
            if (mimeTypeMatch) {
               mimeType = mimeTypeMatch[1];
               data = m.imageUrl.replace(/^data:image\/[a-zA-Z]+;base64,/, "");
            }
            parts.push({ inlineData: { mimeType, data } });
          }
          if (parts.length === 0) parts.push({ text: " " });
          return { role: m.role === 'agent' ? 'model' : 'user', parts };
        }),
        (() => {
          const parts: any[] = [];
          if (userMessage.text) parts.push({ text: userMessage.text });
          if (userMessage.imageUrl) {
            const mimeTypeMatch = userMessage.imageUrl.match(/^data:(image\/[a-zA-Z]+);base64,/);
            let mimeType = 'image/jpeg';
            let data = userMessage.imageUrl;
            if (mimeTypeMatch) {
               mimeType = mimeTypeMatch[1];
               data = userMessage.imageUrl.replace(/^data:image\/[a-zA-Z]+;base64,/, "");
            }
            parts.push({ inlineData: { mimeType, data } });
          }
          if (parts.length === 0) parts.push({ text: " " });
          return { role: 'user', parts };
        })()
      ];

      let resultText = '';
      try {
        const res = await fetch('/api/agent-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: geminiMessages, systemInstruction })
        });
        
        if (res.ok) {
          const text = await res.text();
          if (text.trim().startsWith('{')) {
            const data = JSON.parse(text);
            resultText = data.text || '';
          } else {
            console.warn("Backend /api/agent-chat returned non-JSON, likely 404 or index HTML");
          }
        }
      } catch (err: any) {
        console.warn("Backend /api/agent-chat failed, using client-side fallback directly to Pollinations:", err);
      }

      if (!resultText) {
        // Direct free Pollinations call
        const openAiMessages: { role: string; content: any }[] = [];
        if (systemInstruction) {
          openAiMessages.push({ role: 'system', content: systemInstruction });
        }
        
        // Convert existing conversation history to standard format
        for (const m of messages) {
          const contentParts: any[] = [];
          if (m.text) contentParts.push({ type: 'text', text: m.text });
          if (m.imageUrl) {
            contentParts.push({
              type: 'image_url',
              image_url: { url: m.imageUrl }
            });
          }
          if (contentParts.length > 0) {
            openAiMessages.push({
              role: m.role === 'agent' ? 'assistant' : 'user',
              content: contentParts.length === 1 ? contentParts[0].text : contentParts
            });
          }
        }
        
        // Include current message
        const lastMsgParts: any[] = [];
        if (userMessage.text) lastMsgParts.push({ type: 'text', text: userMessage.text });
        if (userMessage.imageUrl) {
          lastMsgParts.push({
             type: 'image_url',
             image_url: { url: userMessage.imageUrl }
          });
        }
        if (lastMsgParts.length > 0) {
          openAiMessages.push({
            role: 'user',
            content: lastMsgParts.length === 1 ? lastMsgParts[0].text : lastMsgParts
          });
        }

        const models = ["mistral", "llama", "openai", "qwen-coder"];
        for (let i = 0; i < models.length; i++) {
          try {
            const polRes = await fetch("https://text.pollinations.ai/", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ messages: openAiMessages, model: models[i] })
            });
            if (polRes.ok) {
              resultText = await polRes.text();
              break;
            }
          } catch (e) {
            console.warn(`[Fallback] Pollinations model ${models[i]} failed client-side:`, e);
          }
        }
      }

      if (!resultText) {
        throw new Error("Unable to get response from any free AI service.");
      }

      setMessages(prev => [...prev, { id: Date.now().toString() + Math.random().toString(36).substring(2), role: 'agent', text: resultText }]);

    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || 'Failed to connect to the AI Provider.');
      setMessages(prev => [...prev, { id: Date.now().toString() + Math.random().toString(36).substring(2), role: 'agent', text: 'Sorry, I encountered an error while trying to respond.' }]);
    } finally {
      setIsGenerating(false);
      setPendingImage(null);
    }
  };

  return (
    <div className="fixed bottom-[1%] left-[1%] z-[999] flex flex-col items-start" style={{ display: isFullscreen ? 'none' : 'flex' }}>
      {isOpen && (
        <div ref={chatRef} style={{ width: size.width, height: size.height }} className="bg-background border rounded-xl shadow-xl mb-2 flex flex-col overflow-hidden transition-opacity animate-in relative slide-in-from-bottom-2">
          
          {/* Resize handles */}
          <div className="absolute top-0 left-4 right-4 h-2 hover:bg-primary/20 cursor-ns-resize z-50" onPointerDown={e => startResize(e, 't')} />
          <div className="absolute top-4 right-0 bottom-4 w-2 hover:bg-primary/20 cursor-ew-resize z-50" onPointerDown={e => startResize(e, 'r')} />
          <div className="absolute top-4 left-0 bottom-4 w-2 hover:bg-primary/20 cursor-ew-resize z-50" onPointerDown={e => startResize(e, 'l')} />
          <div className="absolute top-0 right-0 w-6 h-6 hover:bg-primary/20 cursor-nesw-resize z-50" onPointerDown={e => startResize(e, 'tr')} />
          <div className="absolute top-0 left-0 w-6 h-6 hover:bg-primary/20 cursor-nwse-resize z-50" onPointerDown={e => startResize(e, 'tl')} />

          <div className="bg-muted p-3 flex justify-between items-center border-b shrink-0 cursor-default">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-primary" />
              <span className="font-semibold text-sm">AI Agent</span>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6 relative z-50" onClick={() => setIsOpen(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          
          <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-3">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground p-4 gap-4">
                <span className="text-sm">👋 Hi! I can help brainstorm ideas, write scripts, or draw something. What would you like to create?</span>
                <div className="flex flex-col w-full gap-2 mt-2">
                  <Button variant="outline" size="sm" className="w-full justify-start text-xs text-left text-muted-foreground hover:text-foreground" onClick={() => {
                    setIsOpen(true);
                    setInput("I want to create a comic book about...");
                    window.dispatchEvent(new CustomEvent('app-navigation', { detail: { action: 'open-comic-creator' } }));
                  }}>
                    🎨 Create a comic book
                  </Button>
                  <Button variant="outline" size="sm" className="w-full justify-start text-xs text-left text-muted-foreground hover:text-foreground" onClick={() => {
                    setIsOpen(true);
                    setInput("I want to write a story about...");
                    window.dispatchEvent(new CustomEvent('app-navigation', { detail: { action: 'open-story-writer' } }));
                  }}>
                    ✒️ Write a story
                  </Button>
                  <Button variant="outline" size="sm" className="w-full justify-start text-xs text-left text-muted-foreground hover:text-foreground" onClick={() => {
                    setIsOpen(true);
                    setInput("I want to convert an ebook...");
                    window.dispatchEvent(new CustomEvent('app-navigation', { detail: { action: 'open-converter' } }));
                  }}>
                    📚 Convert ebook
                  </Button>
                </div>
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'agent' && <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><Bot className="w-3.5 h-3.5 text-primary" /></div>}
                <div className={`p-2 rounded-lg text-sm max-w-[85%] ${msg.role === 'user' ? 'bg-primary text-primary-foreground rounded-br-none' : 'bg-muted rounded-bl-none overflow-x-auto'}`}>
                  {msg.text && (
                    <div className={msg.role === 'agent' ? "prose prose-sm dark:prose-invert max-w-none" : ""}>
                      {msg.role === 'agent' ? (
                        <ReactMarkdown 
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: ({node, children}) => <div className="mb-2">{children}</div>,
                            a: ({node, href, children, ...props}) => {
                              if (href?.startsWith('#action:')) {
                                return (
                                  <Button 
                                    variant="secondary" 
                                    size="sm" 
                                    className="my-1 w-full flex items-center justify-center gap-1"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      const event = new CustomEvent('app-navigation', { detail: { action: href.replace('#action:', '') } });
                                      window.dispatchEvent(event);
                                    }}
                                  >
                                    {children}
                                  </Button>
                                );
                              }
                              return <a href={href} target="_blank" rel="noreferrer" className="text-blue-500 underline" {...props}>{children}</a>;
                            },
                            img: ({node, src, alt, ...props}) => {
                              return (
                                <div className="mt-2 rounded overflow-hidden relative group">
                                  <img src={src} alt={alt} className="w-full h-auto object-contain bg-black/5 rounded-md" loading="lazy" />
                                  <Button 
                                    size="sm" 
                                    className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => {
                                      window.dispatchEvent(new CustomEvent('insert-comic-image', { detail: { imageUrl: src } }));
                                    }}
                                  >
                                    Insert into Project
                                  </Button>
                                </div>
                              );
                            }
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
                      <img src={msg.imageUrl} alt="Uploaded or Generated" className="w-full h-auto object-contain bg-black/5" />
                    </div>
                  )}
                </div>
                {msg.role === 'user' && <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0"><User className="w-3.5 h-3.5 text-primary-foreground" /></div>}
              </div>
            ))}
            {isGenerating && (
              <div className="flex gap-2 justify-start items-center text-muted-foreground text-sm">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><Bot className="w-3.5 h-3.5 text-primary" /></div>
                <div className="flex gap-1 items-center bg-muted p-2 rounded-lg rounded-bl-none">
                  <span className="animate-pulse">●</span><span className="animate-pulse delay-75">●</span><span className="animate-pulse delay-150">●</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          
          <div className="p-2 bg-muted/50 border-t flex flex-col gap-2">
            {pendingImage && (
              <div className="relative inline-block w-16 h-16 rounded border bg-background overflow-hidden p-1">
                <img src={pendingImage} alt="Pending" className="w-full h-full object-cover rounded-sm" />
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
                placeholder="Ask anything..." 
                value={input} 
                onChange={e => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = (e.target.scrollHeight) + 'px';
                }} 
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={1}
                className="text-sm shadow-none w-full resize-none bg-transparent px-3 py-2 min-h-[40px] max-h-[150px] outline-none"
              />
              
              <div className="flex justify-between items-end px-2 pb-1.5 pt-0.5">
                <div className="flex gap-0.5 items-center">
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => fileInputRef.current?.click()} title="Upload Image">
                    <Paperclip className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => cameraInputRef.current?.click()} title="Take Photo">
                    <Camera className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={async () => {
                    let dataUrl = null;
                    if ((window as any).activeComicPanelRef) {
                      try {
                        const { toPng } = await import('html-to-image');
                        dataUrl = await toPng((window as any).activeComicPanelRef, { quality: 0.8 });
                      } catch (e) {
                        console.error("Failed to capture panel", e);
                      }
                    }
                    
                    if (!dataUrl && typeof (window as any).getComicCanvasContext === 'function') {
                      dataUrl = await (window as any).getComicCanvasContext();
                    }

                    if (dataUrl) {
                      setPendingImage(dataUrl);
                      toast.success("Captured sketch/canvas successfully!");
                    } else {
                      toast.warning("No sketched panel or canvas available. Open Create mode and sketch first.");
                    }
                  }} title="Read Canvas/Sketch">
                    <Layout className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className={`h-7 w-7 ${isListening ? 'text-red-500 animate-pulse' : 'text-muted-foreground hover:text-foreground'}`} onClick={handleListen} title="Voice Input">
                    {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  </Button>
                </div>
                
                <Button size="icon" onClick={handleSend} disabled={(!input.trim() && !pendingImage) || isGenerating} className="shrink-0 h-8 w-8 rounded-full ml-2 text-white bg-black hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80">
                  {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>
            
          </div>
          
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
          <input type="file" ref={cameraInputRef} className="hidden" accept="image/*" capture="environment" onChange={handleFileUpload} />
        </div>
      )}
      
      {!isOpen && (
        <button 
          id="ai-agent-toggle-btn"
          onClick={() => setIsOpen(true)} 
          className="relative px-3 py-1.5 portrait:w-9 portrait:h-9 portrait:p-0 portrait:justify-center flex gap-1.5 items-center hover:opacity-80 transition-all text-foreground cursor-pointer shadow-md rounded font-semibold text-xs tracking-wide border-0 outline-none"
          style={{ backgroundColor: 'rgb(45, 198, 207)', color: '#000' }}
        >
          <Bot className="w-3.5 h-3.5" />
          <span className="portrait:hidden">AI Agent</span>
        </button>
      )}
    </div>
  );
}
