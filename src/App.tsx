/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Convert from './components/Convert';
import { Read } from './components/Read';
import { Create } from './components/Create';
import { AIAgentChat } from './components/AIAgentChat';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider, useTheme } from 'next-themes';
import { useState, useEffect } from 'react';
import { BookOpen, PenTool, Wrench, Heart, Sparkles, Coffee, Moon, Sun, X, Settings } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slideshow } from './components/Slideshow';
import { AppSettingsProvider, useAppSettings } from './context/AppSettingsContext';
import { AppSettingsDialog } from './components/AppSettingsDialog';

export default function App() {
  return (
    // @ts-ignore
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <AppSettingsProvider>
          <AppContent />
          <AppSettingsDialog />
        </AppSettingsProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

function AppContent() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { setShowSettingsDialog } = useAppSettings();
  const [currentPath, setCurrentPath] = useState<'home' | 'read' | 'create' | 'convert'>(() => {
    const path = window.location.pathname.toLowerCase();
    if (path === '/read') return 'read';
    if (path === '/create') return 'create';
    if (path === '/convert') return 'convert';
    return 'home';
  });
  const [showCoffeeModal, setShowCoffeeModal] = useState(false);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.toLowerCase();
      if (path === '/read') setCurrentPath('read');
      else if (path === '/create') setCurrentPath('create');
      else if (path === '/convert') setCurrentPath('convert');
      else setCurrentPath('home');
      setHeaderHidden(false);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const handleNav = (e: any) => {
      const action = e.detail?.action as string;
      if (action.startsWith('generate-comic:')) {
        const prompt = decodeURIComponent(action.split('generate-comic:')[1] || "");
        navigate('create');
        setTimeout(() => window.dispatchEvent(new CustomEvent('open-generate-full-comic', { detail: { prompt } })), 300);
      } else if (action.startsWith('generate-story:')) {
        const prompt = decodeURIComponent(action.split('generate-story:')[1] || "");
        navigate('create');
        setTimeout(() => window.dispatchEvent(new CustomEvent('open-generate-full-story', { detail: { prompt } })), 300);
      } else if (action === 'open-create-script') {
        navigate('create');
        setTimeout(() => window.dispatchEvent(new CustomEvent('open-ai-script-dialog')), 300);
      } else if (action === 'open-draw-board') {
        navigate('create');
        setTimeout(() => window.dispatchEvent(new CustomEvent('open-draw-mode')), 300);
      } else if (action === 'open-converter') {
        navigate('convert');
      } else if (action === 'open-comic-creator') {
        navigate('create');
        setTimeout(() => window.dispatchEvent(new CustomEvent('open-comic-creator')), 300);
      } else if (action === 'open-story-writer') {
        navigate('create');
        setTimeout(() => window.dispatchEvent(new CustomEvent('open-story-writer')), 300);
      }
    };
    window.addEventListener('app-navigation', handleNav);
    return () => window.removeEventListener('app-navigation', handleNav);
  }, []);

  const navigate = (view: 'home' | 'read' | 'create' | 'convert', query?: string) => {
    const path = view === 'home' ? '/' : `/${view}${query || ''}`;
    window.history.pushState(null, '', path);
    setCurrentPath(view);
    setHeaderHidden(false);
  };

  return (
    <div className="h-[100dvh] overflow-hidden bg-background text-foreground selection:bg-primary/30 flex flex-col">
      {/* Universal Navigation Banner */}
      {!headerHidden && (
        <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md">
          <div className="w-full px-4 h-14 flex items-center justify-between gap-4">
            {/* Logo Brand */}
            <div 
              onClick={() => navigate('home')}
              className="flex items-center gap-2 cursor-pointer select-none shrink-0"
              title="Back to Home"
            >
              <img src="/logo.png" alt="EbookCC/Manga Logo" aria-hidden="true" className="h-6 w-auto block select-none" />
              <span className="font-sans font-extrabold text-sm tracking-tighter text-foreground portrait:hidden">EBookCC</span>
            </div>

            {/* Navigational Tabs */}
            <nav className="flex items-center gap-1 sm:gap-2">
              <Button 
                variant={currentPath === 'read' ? 'default' : 'ghost'} 
                size="sm" 
                className="h-8.5 text-xs font-bold gap-1 rounded-none px-2.5 sm:px-3"
                onClick={() => navigate('read')}
              >
                <BookOpen className={`w-3.5 h-3.5 ${currentPath === 'read' ? 'text-primary-foreground' : 'text-primary'}`} />
                <span className="hidden sm:inline portrait:hidden">Read</span>
              </Button>
              <Button 
                variant={currentPath === 'create' ? 'default' : 'ghost'} 
                size="sm" 
                className="h-8.5 text-xs font-bold gap-1 rounded-none px-2.5 sm:px-3"
                onClick={() => navigate('create')}
              >
                <PenTool className={`w-3.5 h-3.5 ${currentPath === 'create' ? 'text-primary-foreground' : 'text-primary'}`} />
                <span className="hidden sm:inline portrait:hidden">Create</span>
              </Button>
              <Button 
                variant={currentPath === 'convert' ? 'default' : 'ghost'} 
                size="sm" 
                className="h-8.5 text-xs font-bold gap-1 rounded-none px-2.5 sm:px-3"
                onClick={() => navigate('convert')}
              >
                <Wrench className={`w-3.5 h-3.5 ${currentPath === 'convert' ? 'text-primary-foreground' : 'text-primary'}`} />
                <span className="hidden sm:inline portrait:hidden">Convert</span>
              </Button>
            </nav>

            {/* Right Layout Controls */}
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowSettingsDialog(true)}
                className="w-8.5 h-8.5 rounded-none hover:bg-muted text-foreground/80"
                title="App Settings"
              >
                <Settings className="w-4 h-4" />
              </Button>
              {/* Dark Mode switcher */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                className="w-8.5 h-8.5 rounded-none hover:bg-muted text-foreground/80"
                title="Toggle theme"
              >
                {resolvedTheme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-700" />}
              </Button>
            </div>
          </div>
        </header>
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-h-0">
        {currentPath === 'home' && (
          <div className="w-full overflow-y-auto h-full no-scrollbar">
          <div className="max-w-6xl mx-auto py-8 px-4 space-y-12 w-full h-full">
            <header className="flex flex-col items-center gap-2 text-center max-w-4xl mx-auto py-2 px-4">
              <h1 className="text-xl md:text-2xl font-black tracking-tight text-foreground mt-4 uppercase font-mono">
                AI Comic OCR Scanner, Manga Translator & eBook Converter
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground font-semibold max-w-2xl mt-1 leading-relaxed">
                Transform your comic pages and manga panels into high-quality digital eBooks with seamless AI-powered text extraction, instant translation, and automated EPUB formatting.
              </p>
              <div className="w-full mt-6">
                <Slideshow />
              </div>
            </header>

            <div className="grid md:grid-cols-3 gap-6 pt-4">
              {/* Read Card */}
              <Card 
                className="p-6 border border-border rounded-none shadow-none bg-card hover:border-primary cursor-pointer transition-all flex flex-col justify-between group h-64"
                onClick={() => navigate('read')}
              >
                <div className="space-y-4">
                  <div className="h-12 w-12 rounded-none bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                    <BookOpen size={28} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-foreground">Free Manga Reader & eBook Viewer</h3>
                    <p className="text-[11px]/relaxed text-muted-foreground mt-2 font-medium">
                      Enjoy your digital bookshelf with an advanced online manga reader. Customize layouts, adjust zoom, and read seamlessly in dark, light, or sepia modes.
                    </p>
                  </div>
                </div>
                <div className="mt-6 flex items-center text-xs font-bold text-primary group-hover:underline">
                  Access Bookshelf &rarr;
                </div>
              </Card>

              {/* Create Card */}
              <Card 
                className="p-6 border border-border rounded-none shadow-none bg-card hover:border-primary cursor-pointer transition-all flex flex-col justify-between group h-64"
                onClick={() => navigate('create')}
              >
                <div className="space-y-4">
                  <div className="h-12 w-12 rounded-none bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                    <PenTool size={28} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-foreground">Online Comic Maker & Novel Writer</h3>
                    <p className="text-[11px]/relaxed text-muted-foreground mt-2 font-medium">
                      Design stunning comic strips and manga panels. Add custom speech bubbles, dynamic dialogue, and action expressions for your graphic novel graphic.
                    </p>
                  </div>
                </div>
                <div className="mt-6 flex items-center text-xs font-bold text-primary group-hover:underline">
                  Launch Canvas Creator &rarr;
                </div>
              </Card>

              {/* Convert Card */}
              <Card 
                className="p-6 border border-border rounded-none shadow-none bg-card hover:border-primary cursor-pointer transition-all flex flex-col justify-between group h-64"
                onClick={() => navigate('convert', '?upload=true')}
              >
                <div className="space-y-4">
                  <div className="h-12 w-12 rounded-none bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                    <Wrench size={28} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-foreground flex items-center gap-1.5">
                      Comic&eBook Convert <Sparkles className="w-4 h-4 text-amber-500 fill-amber-500 animate-pulse animate-duration-1000" />
                    </h3>
                    <p className="text-[11px]/relaxed text-muted-foreground mt-2 font-medium">
                      Convert raw manga pages to EPUB eBooks. Use AI OCR translation tools to automatically transcribe bubbles and strip Japanese or Korean text smoothly.
                    </p>
                  </div>
                </div>
                <div className="mt-6 flex items-center text-xs font-bold text-primary group-hover:underline">
                  Upload & Convert Now &rarr;
                </div>
              </Card>
            </div>

            {/* Restored Key Features list directly on landing page */}
            <section className="max-w-3xl mx-auto py-8 border-t border-border/30" id="key-features">
              <h2 className="text-sm font-extrabold tracking-tight mb-6 text-center text-primary uppercase font-mono">Key Suite Capabilities & Online Tools</h2>
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
                <Card className="p-4 border border-border/60 rounded-none shadow-sm bg-card hover:border-primary/50 transition-colors">
                  <h3 className="text-xs font-extrabold mb-1 flex items-center gap-1.5 uppercase font-mono text-foreground">
                    <Sparkles className="w-3.5 h-3.5 text-primary" /> AI Manga Translation Tool
                  </h3>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-1 font-medium">Translate Japanese raw manga and webtoons using cutting-edge AI OCR. Automatically detect speech bubbles and clean manga text online.</p>
                </Card>
                <Card className="p-4 border border-border/60 rounded-none shadow-sm bg-card hover:border-primary/50 transition-colors">
                  <h3 className="text-xs font-extrabold mb-1 flex items-center gap-1.5 uppercase font-mono text-foreground">
                    <Sparkles className="w-3.5 h-3.5 text-primary" /> Multi-Model OCR Support
                  </h3>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-1 font-medium">Harness powerful optical character recognition with Google Gemini Cloud API or integrate locally hosted LLMs for private document processing.</p>
                </Card>
                <Card className="p-4 border border-border/60 rounded-none shadow-sm bg-card hover:border-primary/50 transition-colors">
                  <h3 className="text-xs font-extrabold mb-1 flex items-center gap-1.5 uppercase font-mono text-foreground">
                    <Sparkles className="w-3.5 h-3.5 text-primary" /> Comic Panel Splitter
                  </h3>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-1 font-medium">Intelligently crop and split comic strips into guided view segments, delivering an optimized mobile e-reader experience for any device.</p>
                </Card>
                <Card className="p-4 border border-border/60 rounded-none shadow-sm bg-card hover:border-primary/50 transition-colors">
                  <h3 className="text-xs font-extrabold mb-1 flex items-center gap-1.5 uppercase font-mono text-foreground">
                    <Sparkles className="w-3.5 h-3.5 text-primary" /> CBZ to EPUB Converter
                  </h3>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-1 font-medium">Instantly convert zipped comic archives (CBZ/ZIP) into standard EPUB format eBooks, ensuring high compatibility with digital readers.</p>
                </Card>
                <Card className="p-4 border border-border/60 rounded-none shadow-sm bg-card hover:border-primary/50 transition-colors">
                  <h3 className="text-xs font-extrabold mb-1 flex items-center gap-1.5 uppercase font-mono text-foreground">
                    <Sparkles className="w-3.5 h-3.5 text-primary" /> Online Comic Editor
                  </h3>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-1 font-medium">A robust WYSIWYG editor to overlay localized text, adjust typography, format dialogue balloons, and export high-res graphic novel pages.</p>
                </Card>
                <Card className="p-4 border border-border/60 rounded-none shadow-sm bg-card hover:border-primary/50 transition-colors">
                  <h3 className="text-xs font-extrabold mb-1 flex items-center gap-1.5 uppercase font-mono text-foreground">
                    <Sparkles className="w-3.5 h-3.5 text-primary" /> Private Local Processing
                  </h3>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-1 font-medium">Self-hosted configurations available with containerized environments, ensuring your comic projects remain private and securely processed offline.</p>
                </Card>
              </div>
            </section>

            {/* Footer */}
            <footer className="text-center text-xs text-muted-foreground pt-12 pb-32 border-t border-border/40">
              <p className="flex flex-col sm:flex-row items-center justify-center gap-2 font-medium">
                <span>Made with <Heart className="w-3.5 h-3.5 inline text-rose-500 fill-rose-500" /> by Pierre Kollo. Powered by advanced AI.</span>
                <span className="hidden sm:inline text-border">|</span>
                <span>Contact: <a href="mailto:support@ebookcc.com" className="underline hover:text-primary transition-colors">support@ebookcc.com</a></span>
              </p>
            </footer>
          </div>
          </div>
        )}

        {currentPath === 'read' && <Read setActiveView={(view) => navigate(view)} onActiveStateChange={setHeaderHidden} onFullscreenChange={setIsFullscreen} />}
        {currentPath === 'create' && <Create setActiveView={(view) => navigate(view)} onActiveStateChange={setHeaderHidden} />}
        {currentPath === 'convert' && <Convert setActiveView={(view) => navigate(view)} onActiveStateChange={setHeaderHidden} />}
      </main>

      {/* Floating Global Ko-fi Button */}
      {!isFullscreen && (
        <div className="fixed bottom-[1%] right-[1%] z-[100] flex flex-col items-end gap-2">
          <button
            onClick={() => setShowCoffeeModal(true)}
            className="flex items-center justify-center gap-1.5 bg-[#FF5E5B] hover:bg-[#ff4a47] text-white font-semibold py-1.5 px-3 portrait:w-9 portrait:h-9 portrait:p-0 rounded shadow-sm border-0 transition-all text-xs group pointer-events-auto cursor-pointer"
          >
            <Coffee className="w-3.5 h-3.5 group-hover:rotate-12 transition-transform duration-300" />
            <span className="portrait:hidden">Buy me a coffee</span>
            <Heart className="w-3 h-3 fill-white text-white animate-pulse portrait:hidden" />
          </button>
        </div>
      )}

      {/* Global "Buy me a coffee" Modal */}
      {showCoffeeModal && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-background/85 backdrop-blur-xs">
          <div className="relative flex flex-col items-center gap-5 px-8 py-10 border border-border bg-card shadow-2xl max-w-[450px] w-full mx-4 text-center rounded-none">
            {/* Close Button */}
            <button
              onClick={() => setShowCoffeeModal(false)}
              className="absolute top-4 right-4 p-2 rounded-none hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-16 h-16 rounded-full bg-[#FF5E5B]/10 flex items-center justify-center text-[#FF5E5B] animate-bounce">
              <Coffee className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-extrabold uppercase font-mono text-foreground">Support EBookCC! 🎉</h3>
              <p className="text-muted-foreground text-xs leading-relaxed font-semibold">
                Thank you for using EbookCC! If this tool made your reading and editing experience better, please consider supporting the creator with a coffee. Every support keeps the servers ticking!
              </p>
            </div>

            <div className="flex flex-col gap-2 w-full mt-2">
              <a
                href="https://ko-fi.com/kollolliver"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setShowCoffeeModal(false)}
                className="flex items-center justify-center gap-2 bg-[#FF5E5B] hover:bg-[#ff4a47] text-white font-extrabold py-3 px-6 rounded-none shadow-md transition-all text-xs uppercase cursor-pointer"
              >
                <Coffee className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
                <span>Support on Ko-fi</span>
                <Heart className="w-4 h-4 fill-white text-white animate-pulse" />
              </a>
              
              <Button
                variant="ghost"
                className="rounded-none py-3 text-muted-foreground hover:text-foreground hover:bg-muted text-xs uppercase font-bold"
                onClick={() => setShowCoffeeModal(false)}
              >
                Maybe later
              </Button>
            </div>
          </div>
        </div>
      )}
      
      <AIAgentChat isFullscreen={isFullscreen} />
      <Toaster position="top-center" toastOptions={{ className: 'z-[9999999]' }} style={{ zIndex: 9999999 }} />
    </div>
  );
}
