/**
 * BillingPage.tsx
 *
 * Dedicated sub-page at /billing:
 * - Prepaid wallet ("pay as you go"): users add funds first, usage deducts from balance. No postpaid invoicing.
 * - Edge-to-edge layout without heavy border lines.
 * - Sidebar / Tab navigation:
 *   1. Wallet & Top-up ($5, $10, $25, $50 Checkout buttons, idempotent webhook settlement)
 *   2. Usage History (table with date, feature, provider, units, amount, status)
 *   3. Billing Guide (plain language: credits, estimates, own-key zero deductions, refunds, support)
 *   4. Spend Limits (monthly spending cap & low-balance alerts)
 */

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Wallet,
  CreditCard,
  History,
  HelpCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  DollarSign,
  ArrowUpRight,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  RefreshCw,
  Sliders,
  ArrowLeft,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useAppSettings } from "@/context/AppSettingsContext";
import { useLanguage } from "@/context/LanguageContext";
import { AI_BILLING_TRANSLATIONS, formatTemplate } from "@/data/aiBillingTranslations";
import { getApiUrl } from "@/lib/api";
import { toast } from "sonner";

interface LedgerHistoryItem {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  jobId: string | null;
  feature: string;
  provider: string;
  units: number;
  status: string;
  createdAt: number;
  metadata?: any;
}

interface BillingPageProps {
  onBack: () => void;
  onNavigateAI?: () => void;
}

export function BillingPage({ onBack, onNavigateAI }: BillingPageProps) {
  const {
    user,
    setShowAuthDialog,
    walletBalance,
    refreshWallet,
  } = useAppSettings();
  const { language } = useLanguage();
  const copy = (AI_BILLING_TRANSLATIONS[language] || AI_BILLING_TRANSLATIONS.en).billing;
  const dateLocale =
    language === "zh-Hans" ? "zh-CN" : language === "zh-Hant" ? "zh-TW" : language;
  const localizeStatus = (status: string) => {
    if (status === "completed") return copy.history.statusCompleted;
    if (status === "failed") return copy.history.statusFailed;
    if (status === "refunded") return copy.history.statusRefunded;
    if (status === "pending") return copy.history.statusPending;
    return status;
  };

  const [activeTab, setActiveTab] = useState<"wallet" | "history" | "guide" | "limits">("wallet");
  const [isSidebarFolded, setIsSidebarFolded] = useState(false);
  const [selectedTopUp, setSelectedTopUp] = useState<number>(10);
  const [isProcessingCheckout, setIsProcessingCheckout] = useState(false);

  // Wallet details
  const [walletDetails, setWalletDetails] = useState<{
    balanceUsd: number;
    totalAvailableUsd: number;
    monthlySpendCapUsd: number;
    currentMonthSpendUsd: number;
  } | null>(null);

  // History entries
  const [history, setHistory] = useState<LedgerHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Monthly cap state
  const [newCapInput, setNewCapInput] = useState<string>("50");
  const [isUpdatingCap, setIsUpdatingCap] = useState(false);

  const fetchWalletAndHistory = async () => {
    if (!user) return;
    try {
      const [walletRes, historyRes] = await Promise.all([
        fetch(`${getApiUrl()}/api/billing/wallet`, {
          headers: { "x-user-id": user.uid, "x-user-email": user.email },
        }),
        fetch(`${getApiUrl()}/api/billing/history`, {
          headers: { "x-user-id": user.uid },
        }),
      ]);

      if (walletRes.ok) {
        const wData = await walletRes.json();
        setWalletDetails(wData);
        if (wData.monthlySpendCapUsd) {
          setNewCapInput(String(wData.monthlySpendCapUsd));
        }
      }

      if (historyRes.ok) {
        const hData = await historyRes.json();
        setHistory(hData.history || []);
      }
    } catch (err) {
      console.warn("[BillingPage] Error fetching billing details:", err);
    }
  };

  useEffect(() => {
    if (user) {
      fetchWalletAndHistory();
    }
  }, [user]);

  // Initiate Stripe or sandbox top-up
  const handleTopUp = async () => {
    if (!user) {
      toast.error(copy.toasts.signInTopUp);
      setShowAuthDialog(true);
      return;
    }

    setIsProcessingCheckout(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/billing/create-checkout-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": user.uid,
          "x-user-email": user.email,
        },
        body: JSON.stringify({
          amount: selectedTopUp,
          returnUrl: window.location.href,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || copy.toasts.topUpFailed);
      }

      if (data.checkoutUrl) {
        // Redirect to real Stripe Checkout session
        window.location.href = data.checkoutUrl;
      } else if (data.mode === "sandbox" || data.success) {
        toast.success(
          formatTemplate(copy.toasts.topUpSuccess, { amount: `$${selectedTopUp.toFixed(2)}` })
        );
        await refreshWallet();
        await fetchWalletAndHistory();
      }
    } catch (e: any) {
      toast.error(e.message || copy.toasts.checkoutFailed);
    } finally {
      setIsProcessingCheckout(false);
    }
  };

  // Update monthly spending cap
  const handleUpdateMonthlyCap = async () => {
    if (!user) return;
    const parsed = parseFloat(newCapInput);
    if (isNaN(parsed) || parsed < 5 || parsed > 1000) {
      toast.error(copy.toasts.capRangeError);
      return;
    }

    setIsUpdatingCap(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/billing/update-cap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": user.uid,
        },
        body: JSON.stringify({ monthlySpendCapUsd: parsed }),
      });
      if (res.ok) {
        toast.success(
          formatTemplate(copy.toasts.capUpdated, { amount: `$${parsed.toFixed(2)}` })
        );
        await fetchWalletAndHistory();
      } else {
        const d = await res.json();
        toast.error(d.error || copy.toasts.capUpdateFailed);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setIsUpdatingCap(false);
    }
  };

  const paidBalance = walletDetails?.balanceUsd ?? walletBalance;
  const totalFunds = paidBalance;
  const currentMonthSpend = walletDetails?.currentMonthSpendUsd || 0;
  const monthlyCap = walletDetails?.monthlySpendCapUsd || 50;

  const sidebarTabs = [
    { id: "wallet" as const, label: copy.tabs.wallet, icon: Wallet },
    { id: "history" as const, label: copy.tabs.history, icon: History },
    { id: "guide" as const, label: copy.tabs.guide, icon: HelpCircle },
    { id: "limits" as const, label: copy.tabs.limits, icon: Sliders },
  ];

  return (
    <div
      dir={language === "ar" ? "rtl" : "ltr"}
      className="h-full w-full overflow-hidden bg-background text-foreground flex flex-col min-h-0"
    >
      {/* Top Header Bar - Borderless & Clean */}
      <header className="w-full bg-card/30 backdrop-blur-md px-4 sm:px-6 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsSidebarFolded((prev) => !prev)}
            className="h-8 w-8 text-muted-foreground hover:text-foreground hidden md:flex cursor-pointer"
            title={isSidebarFolded ? copy.expandSidebar : copy.collapseSidebar}
            aria-label={isSidebarFolded ? copy.expandSidebar : copy.collapseSidebar}
          >
            {isSidebarFolded ? (
              <PanelLeftOpen className="w-4 h-4 text-primary" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </Button>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">{copy.accountBreadcrumb}</span>
            <span className="text-border/40">/</span>
            <span className="font-bold text-foreground">{copy.pageTitle}</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {user && (
            <span className="hidden sm:inline text-xs font-mono text-muted-foreground">
              {user.email}
            </span>
          )}
          <button
            onClick={fetchWalletAndHistory}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-0 p-0 outline-none"
            title={copy.refreshWallet}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-0.5" /> {copy.refresh}
          </button>
          {onNavigateAI && (
            <button
              onClick={onNavigateAI}
              className="flex items-center gap-1.5 text-xs font-bold text-foreground hover:text-primary transition-colors cursor-pointer bg-transparent border-0 p-0 outline-none"
            >
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span>{copy.aiSettingsLink}</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Container - Full Edge-to-Edge Webpage Layout */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0 w-full">
        {/* Mobile Top Tabs */}
        <div className="md:hidden flex bg-muted/20 p-1.5 overflow-x-auto gap-1 shrink-0">
          {sidebarTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1.5 text-xs font-bold rounded-md whitespace-nowrap cursor-pointer ${
                activeTab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Desktop Left Foldable Sidebar */}
        <aside
          className={`hidden md:flex flex-col shrink-0 bg-muted/10 transition-all duration-200 select-none overflow-y-auto ${
            isSidebarFolded ? "w-14 items-center py-3 px-1.5 space-y-1.5" : "w-56 p-3 space-y-1"
          }`}
        >
          {!isSidebarFolded && (
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {copy.navigationHeading}
            </div>
          )}

          {sidebarTabs.map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                title={t.label}
                className={`flex items-center rounded-lg text-xs font-bold transition-all text-start cursor-pointer ${
                  isSidebarFolded
                    ? `w-10 h-10 justify-center ${
                        isActive
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                      }`
                    : `w-full gap-2.5 px-3 py-2.5 ${
                        isActive
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                      }`
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!isSidebarFolded && <span>{t.label}</span>}
              </button>
            );
          })}
        </aside>

        {/* Right Content Pane */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 min-h-0 bg-background/50">
              {/* TAB 1: Prepaid Wallet */}
              {activeTab === "wallet" && (
                <div className="space-y-6 max-w-5xl">
                  {/* Balance Summary Card */}
                  <div className="p-5 rounded-xl bg-gradient-to-br from-card/90 to-muted/30 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        {copy.wallet.availableBalance}
                      </span>
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-black font-mono text-foreground tracking-tight">
                          ${totalFunds.toFixed(2)}
                        </span>
                        <span className="text-xs text-muted-foreground font-medium">USD</span>
                      </div>
                      <div className="flex items-center gap-3 pt-1 text-[11px] text-muted-foreground font-mono">
                        <span>
                          {copy.wallet.prepaidCredits}:{" "}
                          <strong className="text-foreground">${paidBalance.toFixed(2)}</strong>
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col items-start sm:items-end gap-1 text-xs">
                      <span className="text-muted-foreground">
                        {copy.wallet.monthlyCap}: ${monthlyCap.toFixed(2)}
                      </span>
                      <div className="w-36 h-2 bg-muted rounded-full overflow-hidden border border-border/20">
                        <div
                          className="h-full bg-primary transition-all duration-300"
                          style={{
                            width: `${Math.min(100, (currentMonthSpend / (monthlyCap || 1)) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {copy.wallet.spentThisMonth}: ${currentMonthSpend.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Add Funds Section */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                        <CreditCard className="w-4 h-4 text-primary" /> {copy.wallet.addFundsTitle}
                      </h3>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> {copy.wallet.poweredByStripe}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {[5, 10, 25, 50].map((amt) => {
                        const isSelected = selectedTopUp === amt;
                        return (
                          <button
                            key={amt}
                            onClick={() => setSelectedTopUp(amt)}
                            className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col items-center justify-center ${
                              isSelected
                                ? "border-primary/60 bg-primary/10 shadow-xs ring-1 ring-primary/40"
                                : "border-border/20 bg-card/60 hover:bg-muted/40"
                            }`}
                          >
                            <span className="text-lg font-black font-mono text-foreground">${amt}</span>
                            <span className="text-[10px] text-muted-foreground font-semibold">
                              {copy.wallet.usdCredits}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="pt-1 flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-muted/20 border border-border/20 rounded-xl">
                      <div className="text-xs text-muted-foreground">
                        {copy.wallet.addingToWalletPrefix}{" "}
                        <strong className="text-foreground">${selectedTopUp}.00 USD</strong>{" "}
                        {copy.wallet.addingToWalletSuffix}
                      </div>
                      <Button
                        onClick={handleTopUp}
                        disabled={isProcessingCheckout}
                        className="w-full sm:w-auto h-9 px-6 text-xs font-bold cursor-pointer"
                      >
                        {isProcessingCheckout ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
                            {copy.wallet.redirecting}
                          </>
                        ) : (
                          <>
                            {formatTemplate(copy.wallet.proceedToAdd, {
                              amount: `$${selectedTopUp}.00`,
                            })}
                            <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: Usage History */}
              {activeTab === "history" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-bold text-foreground">{copy.history.title}</h2>
                      <p className="text-[11px] text-muted-foreground">
                        {copy.history.subtitle}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={fetchWalletAndHistory}
                      className="h-7 text-xs"
                    >
                      <RefreshCw className="w-3 h-3 mr-1" /> {copy.refresh}
                    </Button>
                  </div>

                  {history.length === 0 ? (
                    <div className="p-8 text-center text-xs text-muted-foreground border border-dashed border-border/30 rounded-xl bg-card/30">
                      {copy.history.empty}
                    </div>
                  ) : (
                    <div className="border border-border/20 rounded-xl overflow-hidden bg-card/40 shadow-2xs">
                      <div className="overflow-x-auto max-h-[50vh]">
                        <table className="w-full text-xs text-start">
                          <thead className="bg-muted/30 border-b border-border/20 text-[11px] uppercase tracking-wider text-muted-foreground font-mono">
                            <tr>
                              <th className="py-2.5 px-3">{copy.history.colDate}</th>
                              <th className="py-2.5 px-3">{copy.history.colFeature}</th>
                              <th className="py-2.5 px-3">{copy.history.colProvider}</th>
                              <th className="py-2.5 px-3">{copy.history.colUnits}</th>
                              <th className="py-2.5 px-3 text-right">{copy.history.colAmount}</th>
                              <th className="py-2.5 px-3 text-right">{copy.history.colBalance}</th>
                              <th className="py-2.5 px-3 text-center">{copy.history.colStatus}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/20">
                            {history.map((row) => {
                              const isPositive = row.amount > 0;
                              return (
                                <tr key={row.id} className="hover:bg-muted/15 transition-colors">
                                  <td className="py-2 px-3 text-muted-foreground font-mono whitespace-nowrap">
                                    {new Date(row.createdAt).toLocaleDateString(dateLocale, {
                                      month: "short",
                                      day: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </td>
                                  <td className="py-2 px-3 font-semibold text-foreground">
                                    {row.feature || row.type}
                                  </td>
                                  <td className="py-2 px-3 text-muted-foreground font-mono">
                                    {row.provider || "-"}
                                  </td>
                                  <td className="py-2 px-3 text-muted-foreground font-mono">
                                    {row.units ? `${row.units} ${row.metadata?.unitName || ""}` : "-"}
                                  </td>
                                  <td
                                    className={`py-2 px-3 font-mono font-bold text-right whitespace-nowrap ${
                                      isPositive
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : "text-foreground"
                                    }`}
                                  >
                                    {isPositive ? `+$${row.amount.toFixed(4)}` : `-$${Math.abs(row.amount).toFixed(4)}`}
                                  </td>
                                  <td className="py-2 px-3 font-mono text-muted-foreground text-right">
                                    ${row.balanceAfter.toFixed(2)}
                                  </td>
                                  <td className="py-2 px-3 text-center">
                                    <span
                                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                                        row.status === "completed"
                                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                          : row.status === "failed" || row.status === "refunded"
                                          ? "bg-rose-500/10 text-rose-500"
                                          : "bg-amber-500/10 text-amber-500"
                                      }`}
                                    >
                                      {localizeStatus(row.status)}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: Billing Guide */}
              {activeTab === "guide" && (
                <div className="space-y-4 max-w-5xl">
                  <div>
                    <h2 className="text-sm font-bold text-foreground">{copy.guide.title}</h2>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {copy.guide.subtitle}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="p-4 border border-border/20 rounded-xl bg-card/60 shadow-2xs space-y-1.5">
                      <span className="font-bold text-foreground flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" /> {copy.guide.card1Title}
                      </span>
                      <p className="text-muted-foreground leading-relaxed">
                        {copy.guide.card1Desc}
                      </p>
                    </div>

                    <div className="p-4 border border-border/20 rounded-xl bg-card/60 shadow-2xs space-y-1.5">
                      <span className="font-bold text-foreground flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-blue-500" /> {copy.guide.card2Title}
                      </span>
                      <p className="text-muted-foreground leading-relaxed">
                        {copy.guide.card2Desc}
                      </p>
                    </div>

                    <div className="p-4 border border-border/20 rounded-xl bg-card/60 shadow-2xs space-y-1.5">
                      <span className="font-bold text-foreground flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-primary" /> {copy.guide.card3Title}
                      </span>
                      <p className="text-muted-foreground leading-relaxed">
                        {copy.guide.card3Desc}
                      </p>
                    </div>

                    <div className="p-4 border border-border/20 rounded-xl bg-card/60 shadow-2xs space-y-1.5">
                      <span className="font-bold text-foreground flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-purple-500" /> {copy.guide.card4Title}
                      </span>
                      <p className="text-muted-foreground leading-relaxed">
                        {copy.guide.card4Desc}
                      </p>
                    </div>
                  </div>

                  {/* Payout Platform Compliance Summary */}
                  <div className="p-4 border border-blue-500/20 rounded-xl bg-blue-500/5 space-y-2">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-blue-500 shrink-0" />
                      <h4 className="text-xs font-bold text-foreground">{copy.guide.complianceTitle}</h4>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {copy.guide.complianceDesc}
                    </p>
                  </div>

                  <div className="p-4 border border-border/20 rounded-xl bg-muted/20 space-y-2">
                    <h4 className="text-xs font-bold text-foreground">{copy.guide.supportTitle}</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {copy.guide.supportDescPrefix}{" "}
                      <a href="mailto:support@ebookcc.com" className="text-primary underline font-medium">
                        support@ebookcc.com
                      </a>.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 4: Spend Limits */}
              {activeTab === "limits" && (
                <div className="space-y-4 max-w-5xl">
                  <div>
                    <h2 className="text-sm font-bold text-foreground">{copy.limits.title}</h2>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {copy.limits.subtitle}
                    </p>
                  </div>

                  <div className="p-5 rounded-xl bg-card/60 shadow-2xs space-y-3">
                    <label className="text-xs font-bold uppercase tracking-wider text-foreground block">
                      {copy.limits.capLabel}
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="relative flex-1 max-w-xs">
                        <DollarSign className="w-4 h-4 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="number"
                          min="5"
                          step="5"
                          value={newCapInput}
                          onChange={(e) => setNewCapInput(e.target.value)}
                          className="w-full text-xs pl-8 pr-3 py-2 bg-background/80 rounded-lg font-mono outline-none focus:ring-1 focus:ring-primary/40 shadow-2xs"
                        />
                      </div>
                      <Button
                        size="sm"
                        onClick={handleUpdateMonthlyCap}
                        disabled={isUpdatingCap}
                        className="text-xs font-bold h-9"
                      >
                        {isUpdatingCap ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                        {copy.limits.saveCap}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {copy.limits.hint}
                    </p>
                  </div>
                </div>
              )}
            </main>
      </div>
    </div>
  );
}
