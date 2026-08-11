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
  ArrowRight,
  CheckCircle2,
  Lightbulb,
} from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { Button } from "./ui/button";
import { getFAQItems, getFAQUIStrings } from "../data/faqData";

interface FAQProps {
  navigate: (view: "home" | "read" | "create" | "convert" | "faq", query?: string) => void;
}

export const FAQ: React.FC<FAQProps> = ({ navigate }) => {
  const { language } = useLanguage();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<"all" | "ebooks" | "comics" | "ai" | "general">("all");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({
    "faq-1": true,
    "faq-5": true,
  });

  const ui = useMemo(() => getFAQUIStrings(language), [language]);
  const faqItems = useMemo(() => getFAQItems(language), [language]);

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
      inLanguage: language,
      mainEntity: faqItems.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    };
  }, [faqItems, language]);

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
            <span>{ui.badge}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-foreground">
            {ui.title}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
            {ui.subtitle}
          </p>

          {/* Quick Search Input */}
          <div className="relative max-w-xl mx-auto pt-2">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={ui.searchPlaceholder}
              className="w-full pl-10 pr-4 py-2.5 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all shadow-xs"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground font-semibold px-1.5 py-0.5 rounded bg-muted cursor-pointer"
              >
                {ui.clear}
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
                <span>{ui.cardReaderTitle}</span>
                <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {ui.cardReaderDesc}
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border/50 text-[11px] font-bold text-primary flex items-center gap-1">
              <span>{ui.cardReaderAction}</span>
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
                <span>{ui.cardConverterTitle}</span>
                <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {ui.cardConverterDesc}
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border/50 text-[11px] font-bold text-primary flex items-center gap-1">
              <span>{ui.cardConverterAction}</span>
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
                <span>{ui.cardStudioTitle}</span>
                <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {ui.cardStudioDesc}
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border/50 text-[11px] font-bold text-primary flex items-center gap-1">
              <span>{ui.cardStudioAction}</span>
              <span>→</span>
            </div>
          </div>
        </div>

        {/* Category Filters & Collapse Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-b border-border/60 pb-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setActiveCategory("all")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                activeCategory === "all"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {ui.allTopics} ({faqItems.length})
            </button>
            <button
              onClick={() => setActiveCategory("ebooks")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeCategory === "ebooks"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{ui.catEbooks}</span>
            </button>
            <button
              onClick={() => setActiveCategory("comics")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeCategory === "comics"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <FileArchive className="w-3.5 h-3.5" />
              <span>{ui.catComics}</span>
            </button>
            <button
              onClick={() => setActiveCategory("ai")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeCategory === "ai"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{ui.catAi}</span>
            </button>
            <button
              onClick={() => setActiveCategory("general")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeCategory === "general"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{ui.catGeneral}</span>
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={expandAll}
              className="text-muted-foreground hover:text-primary transition-colors font-medium underline cursor-pointer"
            >
              {ui.expandAll}
            </button>
            <span className="text-border">|</span>
            <button
              onClick={collapseAll}
              className="text-muted-foreground hover:text-primary transition-colors font-medium underline cursor-pointer"
            >
              {ui.collapseAll}
            </button>
          </div>
        </div>

        {/* FAQ Accordion Items */}
        <div className="space-y-4">
          {filteredFaqs.length === 0 ? (
            <div className="text-center py-12 px-4 bg-card border border-border rounded-xl space-y-3">
              <HelpCircle className="w-10 h-10 text-muted-foreground mx-auto" />
              <h3 className="font-bold text-base">{ui.noMatchTitle}</h3>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                {ui.noMatchDesc}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setActiveCategory("all");
                }}
              >
                {ui.resetFilter}
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
                    className="w-full px-5 py-4 text-left flex items-start justify-between gap-4 hover:bg-muted/30 transition-colors cursor-pointer"
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
              {ui.bottomTitle}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-4 bg-muted/40 rounded-xl space-y-2 border border-border/50">
              <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                {ui.bottomReaderTitle}
              </h3>
              <ul className="space-y-1.5 text-muted-foreground list-disc pl-4">
                {ui.bottomReaderList.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="p-4 bg-muted/40 rounded-xl space-y-2 border border-border/50">
              <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-500" />
                {ui.bottomAuthorTitle}
              </h3>
              <ul className="space-y-1.5 text-muted-foreground list-disc pl-4">
                {ui.bottomAuthorList.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button
              onClick={() => navigate("convert")}
              className="gap-2 text-xs font-bold px-5 py-2.5 rounded-lg"
            >
              <Wrench className="w-4 h-4" />
              <span>{ui.btnConvert}</span>
            </Button>
            <Button
              onClick={() => navigate("read")}
              variant="outline"
              className="gap-2 text-xs font-bold px-5 py-2.5 rounded-lg"
            >
              <BookOpen className="w-4 h-4" />
              <span>{ui.btnRead}</span>
            </Button>
            <Button
              onClick={() => navigate("create")}
              variant="secondary"
              className="gap-2 text-xs font-bold px-5 py-2.5 rounded-lg"
            >
              <PenTool className="w-4 h-4" />
              <span>{ui.btnCreate}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
