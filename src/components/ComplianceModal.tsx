import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { ShieldCheck, FileText, Lock, CheckCircle2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { COMPLIANCE_TRANSLATIONS } from "@/data/complianceTranslations";

interface ComplianceModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: "privacy" | "terms";
}

export function ComplianceModal({
  isOpen,
  onClose,
  initialTab = "privacy",
}: ComplianceModalProps) {
  const { language } = useLanguage();
  const [activeTab, setActiveTab] = useState<"privacy" | "terms">(initialTab);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  const copy = COMPLIANCE_TRANSLATIONS[language] || COMPLIANCE_TRANSLATIONS.en;
  const isRtl = language === "ar";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        dir={isRtl ? "rtl" : "ltr"}
        className="max-w-2xl sm:max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden bg-card border-border/40 shadow-xl"
      >
        <DialogHeader className="p-6 pb-4 border-b border-border/20 bg-muted/15 text-start">
          <div className="flex items-center gap-2 text-primary font-mono text-xs uppercase tracking-wider font-semibold">
            <ShieldCheck className="w-4 h-4 shrink-0" /> {copy.badge}
          </div>
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground mt-1">
            {copy.title}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {copy.subtitle}
          </DialogDescription>

          {/* Navigation tabs */}
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <button
              type="button"
              onClick={() => setActiveTab("privacy")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === "privacy"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <Lock className="w-3.5 h-3.5 shrink-0" /> {copy.tabPrivacy}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("terms")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === "terms"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileText className="w-3.5 h-3.5 shrink-0" /> {copy.tabTerms}
            </button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm text-foreground/90 leading-relaxed font-sans text-start">
          {activeTab === "privacy" && (
            <div className="space-y-4">
              <div className="border border-emerald-500/20 bg-emerald-500/5 p-4 rounded-xl flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <h4 className="font-bold text-foreground">{copy.privacy.guaranteeTitle}</h4>
                  <p className="text-muted-foreground leading-relaxed">
                    {copy.privacy.guaranteeDesc}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-bold text-foreground text-base">{copy.privacy.statementTitle}</h3>

                <p>{copy.privacy.statementIntro}</p>

                <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground pt-2">
                  {copy.privacy.storageTitle}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {copy.privacy.storageDesc}
                </p>

                <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground pt-2">
                  {copy.privacy.portabilityTitle}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {copy.privacy.portabilityDesc}
                </p>

                <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground pt-2">
                  {copy.privacy.noTrainingTitle}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {copy.privacy.noTrainingDesc}
                </p>
              </div>
            </div>
          )}

          {activeTab === "terms" && (
            <div className="space-y-4">
              <div className="border border-blue-500/20 bg-blue-500/5 p-4 rounded-xl flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <h4 className="font-bold text-foreground">{copy.terms.policyTitle}</h4>
                  <p className="text-muted-foreground leading-relaxed">
                    {copy.terms.policyDesc}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-bold text-foreground text-base">{copy.terms.statementTitle}</h3>

                <p>
                  <strong>{copy.terms.item1Label}</strong> {copy.terms.item1Desc}
                </p>
                <ul className="list-disc ps-5 space-y-1 text-xs text-muted-foreground">
                  {copy.terms.item1Bullets.map((bullet, idx) => (
                    <li key={idx}>{bullet}</li>
                  ))}
                </ul>

                <p>
                  <strong>{copy.terms.item2Label}</strong> {copy.terms.item2Desc}
                </p>

                <p>
                  <strong>{copy.terms.item3Label}</strong> {copy.terms.item3Desc}
                </p>

                <p>
                  <strong>{copy.terms.item4Label}</strong> {copy.terms.item4Desc}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border/20 bg-muted/10 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            {copy.close}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
