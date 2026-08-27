/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Convert from "./components/Convert";
import logoImg from "./assets/logo.svg";
import { Read } from "./components/Read";
import { Create } from "./components/Create";
import { FAQ } from "./components/FAQ";
import { Bookshelf } from "./components/Bookshelf";
import { AIAgentChat } from "./components/AIAgentChat";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider, useTheme } from "next-themes";
import { useState, useEffect } from "react";
import {
  BookOpen,
  PenTool,
  Wrench,
  HelpCircle,
  Heart,
  Sparkles,
  Coffee,
  Moon,
  Sun,
  X,
  Settings,
  Languages,
  Bot,
  LayoutGrid,
  FileArchive,
  Wand2,
  Server,
  Files,
  MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
const mangaBg = "/features/manga-translation.png";
const multiAiBg = "/features/multi-ai.png";
const panelSplitterBg = "/features/panel-splitter.png";
const cbzConverterBg = "/features/cbz-converter.png";
const aiAgentBg = "/features/ai-agent.png";
const localProcessingBg = "/features/local-processing.png";
const formatSupportBg = "/features/format-support.png";
const penSupportBg = "/features/pen-support.png";
import { Slideshow } from "./components/Slideshow";
import {
  AppSettingsProvider,
  useAppSettings,
} from "./context/AppSettingsContext";
import { AppSettingsDialog } from "./components/AppSettingsDialog";
import { GoogleOAuthProvider } from "@react-oauth/google";
import {
  LanguageProvider,
  useLanguage,
  parseLanguageAndRouteFromPath,
  buildPathWithLanguage,
} from "./context/LanguageContext";
import { LanguageSelector } from "./components/LanguageSelector";
import { usePageSEO } from "./hooks/usePageSEO";

function GoogleAuthProviderWrapper({ children }: { children: React.ReactNode }) {
  const { googleClientId } = useAppSettings();
  return (
    <GoogleOAuthProvider clientId={googleClientId || "dummy"}>
      {children}
    </GoogleOAuthProvider>
  );
}

function FeatureCard({
  bg,
  icon: Icon,
  title,
  description,
}: {
  bg: string;
  icon: any;
  title: string;
  description: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      onClick={() => setExpanded((prev) => !prev)}
      className="group relative overflow-hidden w-full border-none rounded-md bg-card/40 hover:bg-card/80 transition-colors flex flex-col cursor-pointer select-none"
    >
      {/* 16:9 Image Area */}
      <div className="relative w-full aspect-video overflow-hidden select-none bg-muted/20">
        <img
          src={bg || undefined}
          alt=""
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-300"
          referrerPolicy="no-referrer"
        />
        {/* Unfold Description Overlay */}
        <div
          className={cn(
            "absolute inset-0 w-full h-full bg-background/95 backdrop-blur-xs p-2 sm:p-3 transition-all duration-200 ease-out transform flex items-center justify-center text-center overflow-hidden z-10",
            expanded 
              ? "translate-y-0 opacity-100" 
              : "translate-y-full opacity-0 group-hover:translate-y-0 group-hover:opacity-100"
          )}
        >
          <p className="text-[11px] sm:text-xs md:text-[11px] lg:text-xs xl:text-sm text-foreground/95 font-medium leading-snug text-center max-w-full text-balance line-clamp-6">
            {description}
          </p>
        </div>
      </div>

      {/* Title Area */}
      <div className="bg-transparent py-1 px-2 z-10 relative flex items-center justify-center h-fit min-h-[22px]">
        <h3
          className="text-[11px] font-extrabold uppercase font-mono text-foreground truncate flex items-center justify-center gap-1 w-full leading-none"
          title={title}
        >
          <Icon className="w-3 h-3 text-primary shrink-0" />{" "}
          <span className="truncate leading-none">{title}</span>
        </h3>
      </div>
    </div>
  );
}

export default function App() {
  return (
    // @ts-ignore
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <AppSettingsProvider>
          <LanguageProvider>
            <GoogleAuthProviderWrapper>
              <AppContent />
              <AppSettingsDialog />
            </GoogleAuthProviderWrapper>
          </LanguageProvider>
        </AppSettingsProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

function AppContent() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { setShowSettingsDialog, user } = useAppSettings();
  const { t, language, setLanguage, buildPath } = useLanguage();

  const [currentPath, setCurrentPath] = useState<
    "home" | "read" | "create" | "convert" | "faq"
  >(() => {
    const { view } = parseLanguageAndRouteFromPath(window.location.pathname);
    return view;
  });

  // Dynamically sync Canonical URL, Hreflang alternates, OpenGraph & JSON-LD metadata for Google Search Console
  usePageSEO({ view: currentPath, language });

  const [showCoffeeModal, setShowCoffeeModal] = useState(false);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handlePopState = () => {
      const { view, lang } = parseLanguageAndRouteFromPath(
        window.location.pathname,
      );
      if (lang) {
        setLanguage(lang);
      }
      setCurrentPath(view);
      setHeaderHidden(false);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [setLanguage]);

  useEffect(() => {
    const handleNav = (e: any) => {
      const action = e.detail?.action as string;
      if (action.startsWith("generate-comic:")) {
        const prompt = decodeURIComponent(
          action.split("generate-comic:")[1] || "",
        );
        navigate("create");
        setTimeout(
          () =>
            window.dispatchEvent(
              new CustomEvent("open-generate-full-comic", {
                detail: { prompt },
              }),
            ),
          300,
        );
      } else if (action.startsWith("generate-story:")) {
        const prompt = decodeURIComponent(
          action.split("generate-story:")[1] || "",
        );
        navigate("create");
        setTimeout(
          () =>
            window.dispatchEvent(
              new CustomEvent("open-generate-full-story", {
                detail: { prompt },
              }),
            ),
          300,
        );
      } else if (action === "open-create-script") {
        navigate("create");
        setTimeout(
          () => window.dispatchEvent(new CustomEvent("open-ai-script-dialog")),
          300,
        );
      } else if (action === "open-draw-board") {
        navigate("create");
        setTimeout(
          () => window.dispatchEvent(new CustomEvent("open-draw-mode")),
          300,
        );
      } else if (action === "open-converter") {
        navigate("convert");
      } else if (action === "open-comic-creator") {
        navigate("create");
        setTimeout(
          () => window.dispatchEvent(new CustomEvent("open-comic-creator")),
          300,
        );
      } else if (action === "open-story-writer") {
        navigate("create");
        setTimeout(
          () => window.dispatchEvent(new CustomEvent("open-story-writer")),
          300,
        );
      }
    };
    window.addEventListener("app-navigation", handleNav);
    return () => window.removeEventListener("app-navigation", handleNav);
  }, []);

  const navigate = (
    view: "home" | "read" | "create" | "convert" | "faq",
    query?: string,
  ) => {
    const path = buildPath(view) + (query || "");
    window.history.pushState(null, "", path);
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
              onClick={() => navigate("home")}
              className="flex items-center gap-2.5 cursor-pointer select-none shrink-0 group"
              title="Back to Home"
            >
              <img
                src={logoImg}
                alt="EBookCC Logo"
                className="w-8 h-8 rounded-full object-cover block select-none shrink-0 shadow-sm transition-transform group-hover:scale-105"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = "/logo.svg";
                }}
              />
              <span className="font-sans font-bold text-base tracking-tight text-foreground hidden sm:inline portrait:hidden">
                EBookCC
              </span>
            </div>

            {/* Navigational Tabs */}
            <nav className="flex items-center gap-1 sm:gap-2">
              <Button
                variant={currentPath === "read" ? "default" : "ghost"}
                size="sm"
                className="h-8.5 text-xs font-bold gap-1 rounded-none px-2.5 sm:px-3"
                onClick={() => navigate("read")}
              >
                <BookOpen
                  className={`w-3.5 h-3.5 ${currentPath === "read" ? "text-primary-foreground" : "text-primary"}`}
                />
                <span className="hidden sm:inline portrait:hidden">{t("read")}</span>
              </Button>
              <Button
                variant={currentPath === "create" ? "default" : "ghost"}
                size="sm"
                className="h-8.5 text-xs font-bold gap-1 rounded-none px-2.5 sm:px-3"
                onClick={() => navigate("create")}
              >
                <PenTool
                  className={`w-3.5 h-3.5 ${currentPath === "create" ? "text-primary-foreground" : "text-primary"}`}
                />
                <span className="hidden sm:inline portrait:hidden">{t("create")}</span>
              </Button>
              <Button
                variant={currentPath === "convert" ? "default" : "ghost"}
                size="sm"
                className="h-8.5 text-xs font-bold gap-1 rounded-none px-2.5 sm:px-3"
                onClick={() => navigate("convert")}
              >
                <Wrench
                  className={`w-3.5 h-3.5 ${currentPath === "convert" ? "text-primary-foreground" : "text-primary"}`}
                />
                <span className="hidden sm:inline portrait:hidden">
                  {t("convert")}
                </span>
              </Button>
            </nav>

            {/* Right Layout Controls */}
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowSettingsDialog(true)}
                className="w-8 h-8 !rounded-full rounded-full hover:bg-muted text-foreground/80 overflow-hidden !overflow-hidden flex items-center justify-center p-0 shrink-0 border-0 outline-none focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:outline-none focus-visible:border-transparent shadow-none ring-0"
                style={{ borderRadius: "9999px" }}
                title={user ? (user.name ? `${user.name} (${user.email}) - ${t("appSettings")}` : `${user.email} - ${t("appSettings")}`) : t("appSettings")}
              >
                {user ? (
                  (user.avatarUrl || user.photoURL) ? (
                    <img
                      src={user.avatarUrl || user.photoURL || undefined}
                      alt={user.name || user.email}
                      className="w-8 h-8 !rounded-full rounded-full object-cover shrink-0 overflow-hidden"
                      style={{ borderRadius: "9999px" }}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div
                      className="w-8 h-8 !rounded-full rounded-full bg-gradient-to-tr from-primary to-primary/80 text-primary-foreground font-black text-xs flex items-center justify-center uppercase font-mono shadow-xs shrink-0 overflow-hidden"
                      style={{ borderRadius: "9999px" }}
                    >
                      {(user.name || user.email || "U").trim().charAt(0).toUpperCase()}
                    </div>
                  )
                ) : (
                  <Settings className="w-4 h-4" />
                )}
              </Button>
              {/* Dark Mode switcher */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setTheme(resolvedTheme === "dark" ? "light" : "dark")
                }
                className="w-8 h-8 rounded-none hover:bg-muted text-foreground/80"
                title={t("toggleTheme")}
              >
                {resolvedTheme === "dark" ? (
                  <Sun className="w-4 h-4 text-amber-400" />
                ) : (
                  <Moon className="w-4 h-4 text-indigo-700" />
                )}
              </Button>
            </div>
          </div>
        </header>
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-h-0">
        {currentPath === "home" && (
          <div className="w-full overflow-y-auto h-full no-scrollbar">
            <div className="w-full max-w-full py-8 px-4 sm:px-8 lg:px-12 space-y-12 h-full">
              <header className="flex flex-col items-center gap-2 text-center max-w-4xl mx-auto py-2 px-4">
                <h1 className="text-xl md:text-2xl font-black tracking-tight text-foreground mt-4 uppercase font-mono">
                  {t("heroTitle")}
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground font-semibold max-w-2xl mt-1 leading-relaxed">
                  {t("heroSubtitle")}
                </p>
                <div className="w-full mt-6">
                  <Slideshow />
                </div>
              </header>

              <div className="grid md:grid-cols-3 gap-6 pt-4">
                {/* Read Card */}
                <Card
                  className="p-6 border-none rounded-lg shadow-none bg-card/60 hover:bg-card/90 cursor-pointer transition-all flex flex-col justify-between group h-64"
                  onClick={() => navigate("read")}
                >
                  <div className="space-y-4">
                    <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary transition-transform">
                      <BookOpen size={28} />
                    </div>
                    <div>
                      <h3
                        className="text-base font-bold text-foreground truncate"
                        title={t("readCardTitle")}
                      >
                        {t("readCardTitle")}
                      </h3>
                      <p className="text-[11px]/relaxed text-muted-foreground mt-2 font-medium line-clamp-3">
                        {t("readCardDesc")}
                      </p>
                    </div>
                  </div>
                  <div className="mt-6 flex items-center text-xs font-bold text-primary group-hover:underline">
                    {t("accessBookshelf")}
                  </div>
                </Card>

                {/* Create Card */}
                <Card
                  className="p-6 border-none rounded-lg shadow-none bg-card/60 hover:bg-card/90 cursor-pointer transition-all flex flex-col justify-between group h-64"
                  onClick={() => navigate("create")}
                >
                  <div className="space-y-4">
                    <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary transition-transform">
                      <PenTool size={28} />
                    </div>
                    <div>
                      <h3
                        className="text-base font-bold text-foreground truncate"
                        title={t("createCardTitle")}
                      >
                        {t("createCardTitle")}
                      </h3>
                      <p className="text-[11px]/relaxed text-muted-foreground mt-2 font-medium line-clamp-3">
                        {t("createCardDesc")}
                      </p>
                    </div>
                  </div>
                  <div className="mt-6 flex items-center text-xs font-bold text-primary group-hover:underline">
                    {t("launchCanvasCreator")}
                  </div>
                </Card>

                {/* Convert Card */}
                <Card
                  className="p-6 border-none rounded-lg shadow-none bg-card/60 hover:bg-card/90 cursor-pointer transition-all flex flex-col justify-between group h-64"
                  onClick={() => navigate("convert", "?upload=true")}
                >
                  <div className="space-y-4">
                    <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary transition-transform">
                      <Wrench size={28} />
                    </div>
                    <div>
                      <h3
                        className="text-base font-bold text-foreground flex items-center gap-1.5 truncate"
                        title={t("convertCardTitle")}
                      >
                        {t("convertCardTitle")}{" "}
                        <Sparkles className="w-4 h-4 text-amber-500 fill-amber-500 animate-pulse animate-duration-1000 shrink-0" />
                      </h3>
                      <p className="text-[11px]/relaxed text-muted-foreground mt-2 font-medium line-clamp-3">
                        {t("convertCardDesc")}
                      </p>
                    </div>
                  </div>
                  <div className="mt-6 flex items-center text-xs font-bold text-primary group-hover:underline">
                    {t("uploadAndConvertNow")}
                  </div>
                </Card>
              </div>

              {/* Bookshelf of Published Works */}
              <Bookshelf 
                onOpenInWorkspace={(type, id) => {
                  sessionStorage.setItem("ebookcc_open_workspace_type", type);
                  sessionStorage.setItem("ebookcc_open_workspace_id", id);
                  navigate("create");
                }} 
                onOpenInReader={(type, id) => {
                  sessionStorage.setItem("ebookcc_open_read_type", type);
                  sessionStorage.setItem("ebookcc_open_read_id", id);
                  navigate("read");
                }}
              />

              {/* Restored Key Features list directly on landing page */}
              <section
                className="w-full py-6 border-t border-border/30"
                id="key-features"
              >
                <h2 className="text-xs font-extrabold tracking-tight mb-4 text-center text-primary uppercase font-mono">
                  {t("keyFeaturesTitle")}
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 sm:gap-3.5">
                  <FeatureCard
                    bg={mangaBg}
                    icon={Languages}
                    title={t("featAiTranslateTitle")}
                    description={t("featAiTranslateDesc")}
                  />

                  <FeatureCard
                    bg={multiAiBg}
                    icon={Bot}
                    title={t("featMultiAiTitle")}
                    description={t("featMultiAiDesc")}
                  />

                  <FeatureCard
                    bg={panelSplitterBg}
                    icon={LayoutGrid}
                    title={t("featSplitterTitle")}
                    description={t("featSplitterDesc")}
                  />

                  <FeatureCard
                    bg={cbzConverterBg}
                    icon={FileArchive}
                    title={t("featCbzEpubTitle")}
                    description={t("featCbzEpubDesc")}
                  />

                  <FeatureCard
                    bg={aiAgentBg}
                    icon={Wand2}
                    title={t("featAiAgentTitle")}
                    description={t("featAiAgentDesc")}
                  />

                  <FeatureCard
                    bg={localProcessingBg}
                    icon={Server}
                    title={t("featLocalProcTitle")}
                    description={t("featLocalProcDesc")}
                  />

                  <FeatureCard
                    bg={formatSupportBg}
                    icon={Files}
                    title={t("featFormatSupportTitle")}
                    description={t("featFormatSupportDesc")}
                  />

                  <FeatureCard
                    bg={penSupportBg}
                    icon={PenTool}
                    title={t("featPenSupportTitle")}
                    description={t("featPenSupportDesc")}
                  />
                </div>
              </section>

              {/* Footer */}
              <footer className="text-center text-xs text-muted-foreground pt-12 pb-32 border-t border-border/40 flex items-center justify-center">
                <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 font-medium">
                  <span>
                    {t("madeWith")}{" "}
                    <Heart className="w-3.5 h-3.5 inline text-rose-500 fill-rose-500" />{" "}
                    {t("by")}
                  </span>
                  <span className="hidden sm:inline text-border">|</span>
                  <span>
                    {t("contact")}:{" "}
                    <a
                      href="mailto:support@ebookcc.com"
                      className="underline hover:text-primary transition-colors"
                    >
                      support@ebookcc.com
                    </a>
                  </span>
                  <span className="hidden sm:inline text-border">|</span>
                  <button
                    onClick={() => navigate("faq")}
                    className="underline hover:text-primary transition-colors cursor-pointer font-medium"
                  >
                    {t("faq") || "FAQ"}
                  </button>
                  <span className="hidden sm:inline text-border">|</span>
                  <LanguageSelector />
                </div>
              </footer>
            </div>
          </div>
        )}

        {currentPath === "read" && (
          <Read
            setActiveView={(view) => navigate(view)}
            onActiveStateChange={setHeaderHidden}
            onFullscreenChange={setIsFullscreen}
          />
        )}
        {currentPath === "create" && (
          <Create
            setActiveView={(view) => navigate(view)}
            onActiveStateChange={setHeaderHidden}
            onFullscreenChange={setIsFullscreen}
          />
        )}
        {currentPath === "convert" && (
          <Convert
            setActiveView={(view) => navigate(view)}
            onActiveStateChange={setHeaderHidden}
          />
        )}
        {currentPath === "faq" && <FAQ navigate={navigate} />}
      </main>

      {/* Floating Global Ko-fi Button */}
      {!isFullscreen && (
        <div className="fixed bottom-[1%] right-[1%] z-[100] flex flex-col items-end gap-2">
          <button
            onClick={() => setShowCoffeeModal(true)}
            className="flex items-center justify-center gap-1.5 bg-[#FF5E5B] hover:bg-[#ff4a47] text-white font-semibold py-1.5 px-3 portrait:w-9 portrait:h-9 portrait:p-0 rounded shadow-sm border-0 transition-all text-xs group pointer-events-auto cursor-pointer"
          >
            <Coffee className="w-3.5 h-3.5 group-hover:rotate-12 transition-transform duration-300" />
            <span className="portrait:hidden">{t("buyCoffee")}</span>
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
              <h3 className="text-xl font-extrabold uppercase font-mono text-foreground">
                {t("supportEbookcc")}
              </h3>
              <p className="text-muted-foreground text-xs leading-relaxed font-semibold">
                {t("supportCoffeeDesc")}
              </p>
            </div>

            <div className="flex flex-col gap-2 w-full mt-2">
              <a
                href="https://ko-fi.com"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setShowCoffeeModal(false)}
                className="flex items-center justify-center gap-2 bg-[#FF5E5B] hover:bg-[#ff4a47] text-white font-extrabold py-3 px-6 rounded-none shadow-md transition-all text-xs uppercase cursor-pointer"
              >
                <Coffee className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
                <span>{t("supportKoFi")}</span>
                <Heart className="w-4 h-4 fill-white text-white animate-pulse" />
              </a>

              <Button
                variant="ghost"
                className="rounded-none py-3 text-muted-foreground hover:text-foreground hover:bg-muted text-xs uppercase font-bold"
                onClick={() => setShowCoffeeModal(false)}
              >
                {t("maybeLater")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <AIAgentChat isFullscreen={isFullscreen} />
      <Toaster
        position="top-center"
        toastOptions={{ className: "z-[9999999]" }}
        style={{ zIndex: 9999999 }}
      />
    </div>
  );
}
