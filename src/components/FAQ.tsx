import React, { useState, useMemo } from "react";
import {
  HelpCircle,
  Search,
  BookOpen,
  PenTool,
  Wrench,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ShieldCheck,
  FileText,
  FileArchive,
  Layers,
  ArrowRight,
  Send,
  Zap,
  Globe2,
  Cpu,
  CheckCircle2,
  Lightbulb,
} from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { Button } from "./ui/button";

interface FAQProps {
  navigate: (view: "home" | "read" | "create" | "convert" | "faq", query?: string) => void;
}

interface FAQItem {
  id: string;
  category: "ebooks" | "comics" | "ai" | "general";
  question: string;
  answer: string;
  keywords: string[];
  links?: { text: string; view: "read" | "create" | "convert" | "home"; description: string }[];
}

export const FAQ: React.FC<FAQProps> = ({ navigate }) => {
  const { t, buildPath, language } = useLanguage();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<"all" | "ebooks" | "comics" | "ai" | "general">("all");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({
    "faq-1": true,
    "faq-5": true,
  });

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const expandAll = () => {
    const allExpanded: Record<string, boolean> = {};
    faqItems.forEach((item) => (allExpanded[item.id] = true));
    setExpandedIds(allExpanded);
  };

  const collapseAll = () => {
    setExpandedIds({});
  };

  const faqItems: FAQItem[] = useMemo(
    () => [
      {
        id: "faq-1",
        category: "ebooks",
        question: "How do I convert CBZ, CBR, or PDF comics into EPUB for Kindle, Kobo, or Apple Books?",
        answer:
          "You can convert CBZ, CBR, or PDF comic files to EPUB instantly using EBookCC's Universal Converter. Upload your comic archive, select 'EPUB' or 'Kindle EPUB' output, enable image compression or page margin trimming if desired, and click Convert. The generated EPUB retains high image resolution while optimizing file size for e-readers.",
        keywords: ["cbz", "cbr", "pdf", "epub", "kindle", "kobo", "apple books", "convert", "e-reader"],
        links: [
          {
            text: "Open Universal Converter",
            view: "convert",
            description: "Batch convert CBZ, CBR, PDF & EPUB files online",
          },
          {
            text: "Open Web Reader",
            view: "read",
            description: "Read your converted EPUB or CBZ directly in your browser",
          },
        ],
      },
      {
        id: "faq-2",
        category: "ebooks",
        question: "How can I send converted EPUB e-books directly to my Kindle device?",
        answer:
          "After converting your comic or document to EPUB format on EBookCC, download the file and use Amazon's official 'Send to Kindle' service (amazon.com/sendtokindle) or email it to your Kindle address. EPUB is fully supported on all modern Kindle devices, Kindle Oasis, Paperwhite, and the Kindle iOS/Android app.",
        keywords: ["send to kindle", "amazon kindle", "epub kindle", "paperwhite", "oasis"],
        links: [
          {
            text: "Start Converting for Kindle",
            view: "convert",
            description: "Format comics & text books for Amazon Kindle",
          },
        ],
      },
      {
        id: "faq-3",
        category: "ebooks",
        question: "Can I reflow or extract clean text from PDF textbooks and scanned documents?",
        answer:
          "Yes! EBookCC includes an AI OCR & Reflow engine. When you upload a PDF textbook or scanned image e-book, our built-in OCR scans the text, cleans up page breaks, removes header/footer noise, and allows you to export structured EPUB, HTML, or plain text.",
        keywords: ["ocr", "pdf textbook", "reflow", "extract text", "scanned pdf", "epub"],
        links: [
          {
            text: "Try PDF OCR & Converter",
            view: "convert",
            description: "Extract text and convert PDFs into reflowable EPUBs",
          },
        ],
      },
      {
        id: "faq-4",
        category: "comics",
        question: "How does the Manga Dual-Page Splitter work for mobile reading?",
        answer:
          "Traditional manga spreads often contain two pages side-by-side (dual page), which look tiny and hard to read on mobile phones. EBookCC automatically detects double-page spreads, splits them vertically into single left/right pages, and reorders them according to Right-to-Left (Manga) or Left-to-Right reading directions.",
        keywords: ["manga", "dual page", "page splitter", "double page spread", "mobile reading", "webtoon"],
        links: [
          {
            text: "Try Panel & Page Splitter",
            view: "convert",
            description: "Split double-page spreads into single smartphone pages",
          },
          {
            text: "Launch Manga Reader",
            view: "read",
            description: "Read manga with guided panel zoom & webtoon scroll mode",
          },
        ],
      },
      {
        id: "faq-5",
        category: "comics",
        question: "How do I translate raw Japanese manga, Korean webtoons, or foreign comics automatically?",
        answer:
          "EBookCC provides an AI Manga & Webtoon Translator. It automatically detects speech bubbles using computer vision, performs high-accuracy OCR in Japanese, Korean, Chinese, or English, erases the original text, and overlays clean translated text into speech bubbles in 12+ languages.",
        keywords: ["translate manga", "ai ocr", "raw manga", "webtoon translation", "speech bubble", "japanese manga"],
        links: [
          {
            text: "Translate Raw Manga Online",
            view: "convert",
            description: "AI speech bubble detection, cleaning & text translation",
          },
          {
            text: "Create Manga & Comics",
            view: "create",
            description: "Design multi-panel comics with customizable speech bubbles",
          },
        ],
      },
      {
        id: "faq-6",
        category: "comics",
        question: "How can I create my own AI comic strips, manga, or visual novels?",
        answer:
          "EBookCC features an interactive Comic & Canvas Creator. You can draw on a digital canvas with Wacom / Apple Pencil stylus pressure support, generate comic panel art or story outlines using AI prompts, add speech balloons, position stickers, and export complete CBZ or EPUB comic books.",
        keywords: ["create comic", "ai comic generator", "manga maker", "canvas creator", "speech balloon", "epub creator"],
        links: [
          {
            text: "Open Comic & Canvas Creator",
            view: "create",
            description: "Design multi-panel comics and generate AI storylines",
          },
        ],
      },
      {
        id: "faq-7",
        category: "ai",
        question: "Which AI models can I use for translation, OCR, and comic creation?",
        answer:
          "EBookCC supports multiple AI providers: Google Gemini (Gemini 2.5 Flash / Pro), OpenAI (GPT-4o), Anthropic Claude, as well as local LLMs like Ollama or LM Studio running on your local machine for complete offline privacy.",
        keywords: ["ai models", "gemini", "openai", "claude", "ollama", "lm studio", "local llm", "api key"],
        links: [
          {
            text: "Configure AI & API Keys",
            view: "home",
            description: "Set up Gemini or local AI models in App Settings",
          },
        ],
      },
      {
        id: "faq-8",
        category: "general",
        question: "Is EBookCC free and are my uploaded files private?",
        answer:
          "Yes! EBookCC runs directly inside your web browser. All file processing, image cropping, EPUB compilation, and reading take place locally on your client device. Your files are never uploaded or sold to external servers.",
        keywords: ["privacy", "offline", "free ebook reader", "browser local processing", "security"],
        links: [
          {
            text: "Read E-Books Privately",
            view: "read",
            description: "Load local files into your private browser reader",
          },
          {
            text: "Return to Home Page",
            view: "home",
            description: "Explore all features of EBookCC",
          },
        ],
      },
      {
        id: "faq-9",
        category: "ebooks",
        question: "What file formats are supported for reading and conversion?",
        answer:
          "EBookCC supports a vast range of e-book and comic formats including EPUB, PDF, CBZ, CBR, MOBI, AZW3, TXT, DOCX, HTML, WEBP, PNG, JPG, and ZIP comic archives. You can read them online or convert between formats with one click.",
        keywords: ["formats", "epub", "pdf", "cbz", "cbr", "mobi", "azw3", "txt", "docx"],
        links: [
          {
            text: "Batch Convert Formats",
            view: "convert",
            description: "Convert between EPUB, CBZ, PDF, and MOBI",
          },
        ],
      },
      {
        id: "faq-10",
        category: "general",
        question: "How do I read e-books and comics on E-Ink devices (Kindle, Onyx Boox, Kobo)?",
        answer:
          "EBookCC features a dedicated E-Ink Reading Mode with high-contrast monochrome themes, bold typography, disabled smooth animations, and physical button/tap page paging optimized for e-paper refresh rates.",
        keywords: ["e-ink", "onyx boox", "kobo", "kindle browser", "e-paper mode", "high contrast"],
        links: [
          {
            text: "Try Web Reader with E-Ink Mode",
            view: "read",
            description: "Read books with high contrast and zero screen flicker",
          },
        ],
      },
      {
        id: "faq-11",
        category: "comics",
        question: "How do I add freehand speech bubbles and custom dialogue to comics?",
        answer:
          "In the Comic & Story Studio, you can select the Speech Bubble tool, draw freehand or choose balloon templates (speech, thought, shout, whisper), position pointer tails dynamically, and type or translate dialogue inside bubbles with automatic font scaling.",
        keywords: ["freehand bubbles", "speech bubbles", "dialogue", "balloons", "comic studio"],
        links: [
          {
            text: "Open Comic Studio",
            view: "create",
            description: "Design comic panels with freehand speech bubbles",
          },
        ],
      },
      {
        id: "faq-12",
        category: "comics",
        question: "How does online reading in split panels work?",
        answer:
          "The Web Reader includes a split-panel mode that breaks complex multi-panel comic pages down into individual panel close-ups. You can navigate sequentially from panel 1 to panel 2 with keyboard arrows or swipe gestures for an immersive mobile reading experience.",
        keywords: ["split panels", "read online", "panel zoom", "web reader", "manga reader"],
        links: [
          {
            text: "Launch Web Reader",
            view: "read",
            description: "Read comics with split-panel guided zoom",
          },
        ],
      },
      {
        id: "faq-13",
        category: "comics",
        question: "How can I create custom comic collages and multi-panel layouts?",
        answer:
          "With the Comic & Story Studio, you can arrange multi-panel grids, combine multiple illustration images into cohesive comic collages, apply custom gutters, borders, and color backgrounds before exporting to CBZ or EPUB.",
        keywords: ["comic collage", "create collage", "panel layouts", "multi-panel grid", "comic maker"],
        links: [
          {
            text: "Create Comic Collage",
            view: "create",
            description: "Design and export multi-panel comic collages",
          },
        ],
      },
      {
        id: "faq-14",
        category: "ai",
        question: "How does YOLO AI detect comic panels and text bubbles automatically?",
        answer:
          "EBookCC integrates computer vision models (including YOLO-based panel detectors) to automatically scan comic pages, isolate individual rectangular panels, detect speech bubbles, and extract text coordinates for clean OCR and translation without manual cropping.",
        keywords: ["yolo detect", "panel detection", "ai ocr", "speech bubble detection", "automatic cropping"],
        links: [
          {
            text: "Try AI Panel & Text Detection",
            view: "convert",
            description: "Batch detect panels and extract text using YOLO & OCR",
          },
        ],
      },
    ],
    []
  );

  const filteredFaqs = useMemo(() => {
    return faqItems.filter((item) => {
      const matchesCategory = activeCategory === "all" || item.category === activeCategory;
      const q = searchQuery.toLowerCase().trim();
      if (!q) return matchesCategory;
      const matchesText =
        item.question.toLowerCase().includes(q) ||
        item.answer.toLowerCase().includes(q) ||
        item.keywords.some((kw) => kw.toLowerCase().includes(q));
      return matchesCategory && matchesText;
    });
  }, [faqItems, activeCategory, searchQuery]);

  // Schema.org FAQPage structured JSON-LD for Search Engines
  const schemaJsonLd = useMemo(() => {
    return {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqItems.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    };
  }, [faqItems]);

  return (
    <div className="flex-1 overflow-y-auto bg-background text-foreground antialiased selection:bg-primary/20">
      {/* Inject Schema.org JSON-LD for Google Rich Results */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaJsonLd) }}
      />

      <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12 space-y-10">
        {/* Header Hero Banner */}
        <div className="text-center space-y-4 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-bold font-mono tracking-wide uppercase">
            <HelpCircle className="w-4 h-4" />
            <span>Help Center & Knowledge Base</span>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-foreground">
            Frequently Asked Questions
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
            Everything you need to know about reading, converting, and creating e-books, comics, raw manga translations, and Kindle-ready EPUB files on EBookCC.
          </p>

          {/* Quick Search Input */}
          <div className="relative max-w-xl mx-auto pt-2">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search topics (e.g., Kindle, CBZ, OCR, Manga, EPUB, Privacy)..."
              className="w-full pl-10 pr-4 py-2.5 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all shadow-xs"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground font-semibold px-1.5 py-0.5 rounded bg-muted"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Quick Solution CTA Cards with Internal Links */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div
            onClick={() => navigate("read")}
            className="group relative p-5 bg-card hover:bg-muted/50 border border-border rounded-xl transition-all duration-200 cursor-pointer shadow-xs hover:shadow-md flex flex-col justify-between"
          >
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-bold">
                <BookOpen className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base group-hover:text-primary transition-colors flex items-center justify-between">
                <span>Web Reader</span>
                <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Read EPUB, PDF, CBZ & CBR comics with guided panel zoom, E-ink mode, and custom typography.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border/50 text-[11px] font-bold text-primary flex items-center gap-1">
              <span>Launch Reader</span>
              <span>→</span>
            </div>
          </div>

          <div
            onClick={() => navigate("convert")}
            className="group relative p-5 bg-card hover:bg-muted/50 border border-border rounded-xl transition-all duration-200 cursor-pointer shadow-xs hover:shadow-md flex flex-col justify-between"
          >
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center font-bold">
                <Wrench className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base group-hover:text-primary transition-colors flex items-center justify-between">
                <span>Batch Converter</span>
                <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Batch convert CBZ to EPUB, split dual-page manga spreads, scan PDF OCR, and translate raw manga.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border/50 text-[11px] font-bold text-primary flex items-center gap-1">
              <span>Open Converter</span>
              <span>→</span>
            </div>
          </div>

          <div
            onClick={() => navigate("create")}
            className="group relative p-5 bg-card hover:bg-muted/50 border border-border rounded-xl transition-all duration-200 cursor-pointer shadow-xs hover:shadow-md flex flex-col justify-between"
          >
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 text-purple-500 flex items-center justify-center font-bold">
                <PenTool className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base group-hover:text-primary transition-colors flex items-center justify-between">
                <span>Comic & Story Studio</span>
                <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Draw comic panels, add speech bubbles, write e-book stories with AI prompts, and export EPUBs.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border/50 text-[11px] font-bold text-primary flex items-center gap-1">
              <span>Start Creating</span>
              <span>→</span>
            </div>
          </div>
        </div>

        {/* Category Filters & Collapse Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-b border-border/60 pb-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setActiveCategory("all")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                activeCategory === "all"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              All Topics ({faqItems.length})
            </button>
            <button
              onClick={() => setActiveCategory("ebooks")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                activeCategory === "ebooks"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>E-Books & Kindle</span>
            </button>
            <button
              onClick={() => setActiveCategory("comics")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                activeCategory === "comics"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <FileArchive className="w-3.5 h-3.5" />
              <span>Manga & Comics</span>
            </button>
            <button
              onClick={() => setActiveCategory("ai")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                activeCategory === "ai"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI & Translation</span>
            </button>
            <button
              onClick={() => setActiveCategory("general")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                activeCategory === "general"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Privacy & General</span>
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={expandAll}
              className="text-muted-foreground hover:text-primary transition-colors font-medium underline"
            >
              Expand All
            </button>
            <span className="text-border">|</span>
            <button
              onClick={collapseAll}
              className="text-muted-foreground hover:text-primary transition-colors font-medium underline"
            >
              Collapse All
            </button>
          </div>
        </div>

        {/* FAQ Accordion Items */}
        <div className="space-y-4">
          {filteredFaqs.length === 0 ? (
            <div className="text-center py-12 px-4 bg-card border border-border rounded-xl space-y-3">
              <HelpCircle className="w-10 h-10 text-muted-foreground mx-auto" />
              <h3 className="font-bold text-base">No matching questions found</h3>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Try searching with different keywords like "Kindle", "CBZ", "EPUB", "OCR", or "Manga".
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setActiveCategory("all");
                }}
              >
                Reset Search Filters
              </Button>
            </div>
          ) : (
            filteredFaqs.map((faq, index) => {
              const isExpanded = !!expandedIds[faq.id];
              return (
                <div
                  key={faq.id}
                  className="bg-card border border-border rounded-xl overflow-hidden shadow-2xs transition-all duration-200"
                >
                  <button
                    onClick={() => toggleExpand(faq.id)}
                    className="w-full px-5 py-4 text-left flex items-start justify-between gap-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center font-mono mt-0.5">
                        {index + 1}
                      </span>
                      <span className="font-bold text-sm sm:text-base text-foreground leading-snug">
                        {faq.question}
                      </span>
                    </div>
                    <div className="shrink-0 mt-1 text-muted-foreground">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-5 pb-5 pt-1 border-t border-border/40 text-sm text-muted-foreground space-y-4 animate-in fade-in duration-150">
                      <p className="leading-relaxed text-foreground/90">{faq.answer}</p>

                      {/* Internal Navigational Action Links */}
                      {faq.links && faq.links.length > 0 && (
                        <div className="pt-2 flex flex-wrap gap-2">
                          {faq.links.map((link, idx) => (
                            <button
                              key={idx}
                              onClick={() => navigate(link.view)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary font-bold text-xs rounded-lg transition-colors border border-primary/20 cursor-pointer"
                              title={link.description}
                            >
                              <span>{link.text}</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Bottom Comprehensive Solutions Callout */}
        <div className="p-6 sm:p-8 bg-card border border-border rounded-2xl space-y-6 shadow-sm">
          <div className="flex items-center gap-3 text-primary">
            <Lightbulb className="w-6 h-6" />
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Need More Specialized E-Book & Comic Solutions?
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-4 bg-muted/40 rounded-xl space-y-2 border border-border/50">
              <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                For Comic & Manga Readers
              </h3>
              <ul className="space-y-1.5 text-muted-foreground list-disc pl-4">
                <li>Convert CBZ and CBR archives to clean, validated EPUB files.</li>
                <li>Split double-page spreads vertically for portrait smartphones.</li>
                <li>AI OCR speech bubble extraction and foreign raw manga translation.</li>
                <li>Guided panel-by-panel reading mode for low-eyestrain reading.</li>
              </ul>
            </div>

            <div className="p-4 bg-muted/40 rounded-xl space-y-2 border border-border/50">
              <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-500" />
                For Writers, Authors & Kindle Users
              </h3>
              <ul className="space-y-1.5 text-muted-foreground list-disc pl-4">
                <li>Format documents into Amazon Send-to-Kindle compliant EPUBs.</li>
                <li>Write text stories and compile custom comic panels in one canvas.</li>
                <li>Edit book cover art, title, author, and table of contents metadata.</li>
                <li>Zero tracking — 100% private, client-side browser execution.</li>
              </ul>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button
              onClick={() => navigate("convert")}
              className="gap-2 text-xs font-bold px-5 py-2.5 rounded-lg"
            >
              <Wrench className="w-4 h-4" />
              <span>Convert Books & Comics Now</span>
            </Button>
            <Button
              onClick={() => navigate("read")}
              variant="outline"
              className="gap-2 text-xs font-bold px-5 py-2.5 rounded-lg"
            >
              <BookOpen className="w-4 h-4" />
              <span>Open E-Book Web Reader</span>
            </Button>
            <Button
              onClick={() => navigate("create")}
              variant="secondary"
              className="gap-2 text-xs font-bold px-5 py-2.5 rounded-lg"
            >
              <PenTool className="w-4 h-4" />
              <span>Create Comic or Story</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
