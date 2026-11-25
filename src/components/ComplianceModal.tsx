import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { ShieldCheck, FileText, Lock, CheckCircle2 } from "lucide-react";

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
  const [activeTab, setActiveTab] = useState<"privacy" | "terms">(initialTab);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden bg-card border-border/40 shadow-xl">
        <DialogHeader className="p-6 pb-4 border-b border-border/20 bg-muted/15">
          <div className="flex items-center gap-2 text-primary font-mono text-xs uppercase tracking-wider font-semibold">
            <ShieldCheck className="w-4 h-4" /> Legal & Platform Governance
          </div>
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground mt-1">
            Creator Rights, Privacy & Terms of Service
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Clear standards ensuring user ownership, private Cloudflare R2 storage, and zero-tolerance copyright compliance.
          </DialogDescription>

          {/* Navigation tabs */}
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => setActiveTab("privacy")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === "privacy"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <Lock className="w-3.5 h-3.5" /> Ownership & Data Privacy
            </button>
            <button
              onClick={() => setActiveTab("terms")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === "terms"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileText className="w-3.5 h-3.5" /> Content Responsibility (Terms)
            </button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm text-foreground/90 leading-relaxed font-sans">
          {activeTab === "privacy" && (
            <div className="space-y-4">
              <div className="border border-emerald-500/20 bg-emerald-500/5 p-4 rounded-xl flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <h4 className="font-bold text-foreground">100% Creator Ownership Guarantee</h4>
                  <p className="text-muted-foreground leading-relaxed">
                    All original scripts, comic panels, uploaded documents, and synthesized voice recordings remain the exclusive intellectual property of the user. EbookCC claims no copyright, distribution, or licensing rights over creator content.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-bold text-foreground text-base">User Ownership & Data Privacy Statement</h3>
                
                <p>
                  At EbookCC, we believe authoring tools should empower creators without compromising intellectual property or digital privacy. All original manuscripts, comic artwork, adapted scripts, and synthesized audio files generated within this platform remain the exclusive property of the creator. EbookCC does not claim any ownership, licensing rights, or commercial interest in your uploaded or produced media.
                </p>

                <h4 className="font-semibold text-foreground text-xs uppercase tracking-wider text-muted-foreground pt-2">
                  Cloud Storage Architecture (Cloudflare R2 & Client Cache)
                </h4>
                <p className="text-xs text-muted-foreground">
                  Your generated audio dramas, voice clips, and published files are stored securely either in your local browser cache or in platform-managed Cloudflare R2 object storage. Files stored in Cloudflare R2 are strictly private by default, secured behind authenticated session tokens, and never indexed for public discovery unless you explicitly publish them to your personal shelf.
                </p>

                <h4 className="font-semibold text-foreground text-xs uppercase tracking-wider text-muted-foreground pt-2">
                  Complete Data Portability & Deletion Rights
                </h4>
                <p className="text-xs text-muted-foreground">
                  You maintain unconditional authority over your files. You may export or download your audio chapters (MP3/WAV), EPUBs, and comic books at any time. Tapping &ldquo;Delete&rdquo; permanently purges files from Cloudflare R2 object storage and invalidates all associated caching layers immediately.
                </p>

                <h4 className="font-semibold text-foreground text-xs uppercase tracking-wider text-muted-foreground pt-2">
                  No Model Training on Private Data
                </h4>
                <p className="text-xs text-muted-foreground">
                  Your private text drafts and audio syntheses are never ingested, shared, sold, or utilized to train third-party foundation models without your explicit opt-in consent.
                </p>
              </div>
            </div>
          )}

          {activeTab === "terms" && (
            <div className="space-y-4">
              <div className="border border-blue-500/20 bg-blue-500/5 p-4 rounded-xl flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <h4 className="font-bold text-foreground">Zero-Tolerance Copyright Abuse Policy</h4>
                  <p className="text-muted-foreground leading-relaxed">
                    EbookCC strictly prohibits the unauthorized processing or distribution of commercial audiobooks, copyrighted radio broadcasts, or protected publications.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-bold text-foreground text-base">Terms of Service: User Content Responsibility</h3>

                <p>
                  <strong>1. Representation of Rights:</strong> By utilizing the EbookCC Text-to-Speech (TTS), audio drama generation, OCR, and comic conversion pipelines, you expressly warrant and represent that all text, manuscripts, dialogue scripts, and imagery submitted for processing are either:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">
                  <li>Your own original, proprietary intellectual property; or</li>
                  <li>In the verified Public Domain (e.g., historical literature sourced from archives such as Project Gutenberg); or</li>
                  <li>Properly licensed with explicit authorization for digital adaptation and speech synthesis.</li>
                </ul>

                <p>
                  <strong>2. Strict Prohibition of Piracy:</strong> Users are strictly prohibited from uploading, synthesizing, or distributing commercial audiobooks, copyrighted podcasts, proprietary radio dramas, or third-party published novels without explicit copyright holder permission. EbookCC does not provide or distribute pirated media.
                </p>

                <p>
                  <strong>3. Safe Harbor & DMCA Compliance:</strong> EbookCC functions purely as a neutral, technical software utility and digital workstation. In accordance with the Digital Millennium Copyright Act (DMCA) and international copyright directives, EbookCC promptly investigates reported infringements. Any account found uploading infringing material will face immediate suspension, permanent removal of content from Cloudflare R2 storage, and forfeiture of platform credits.
                </p>

                <p>
                  <strong>4. User Indemnification:</strong> The user agrees to indemnify and hold harmless EbookCC, its operators, infrastructure providers, and payment processors from any claims, damages, liabilities, or legal expenses arising from the user&apos;s breach of third-party intellectual property rights.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border/20 bg-muted/10 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
