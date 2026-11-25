/**
 * BillingDialog.tsx
 *
 * Prepaid Wallet & Billing Dashboard:
 * - Current balance in USD
 * - Usage history table: Date, Feature, Provider, Units, Amount charged, Status
 * - "Add funds" with preset buttons ($5, $10, $25, $50) via Checkout (Stripe & Sandbox)
 * - Plain-language Billing Guide explaining credit usage, own-key zero deductions,
 *   automatic refunds for failed jobs, and support contact
 * - Monthly spending cap & low-balance warnings
 */

import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
} from "lucide-react";
import { useAppSettings } from "@/context/AppSettingsContext";
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

export function BillingDialog() {
  const {
    showBillingDialog,
    setShowBillingDialog,
    user,
    setShowAuthDialog,
    walletBalance,
    refreshWallet,
  } = useAppSettings();

  const [activeTab, setActiveTab] = useState<"wallet" | "history" | "guide" | "limits">("wallet");
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
        setNewCapInput(String(wData.monthlySpendCapUsd || 50));
      }

      if (historyRes.ok) {
        const hData = await historyRes.json();
        setHistory(hData.history || []);
      }
    } catch (e: any) {
      console.warn("Error fetching billing details:", e.message);
    }
  };

  useEffect(() => {
    if (showBillingDialog && user) {
      fetchWalletAndHistory();
    }
  }, [showBillingDialog, user]);

  // Handle Add Funds
  const handleAddFunds = async (isSandbox: boolean = false) => {
    if (!user) {
      setShowBillingDialog(false);
      setShowAuthDialog(true);
      return;
    }

    try {
      setIsProcessingCheckout(true);
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
          isSandboxSimulation: isSandbox,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Checkout error");
      }

      if (data.mode === "sandbox") {
        toast.success(`Successfully added $${selectedTopUp.toFixed(2)} to prepaid wallet!`);
        await fetchWalletAndHistory();
        await refreshWallet();
      } else if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to initiate payment.");
    } finally {
      setIsProcessingCheckout(false);
    }
  };

  // Update monthly spending cap
  const handleUpdateMonthlyCap = async () => {
    const val = Number(newCapInput);
    if (isNaN(val) || val < 5 || val > 1000) {
      toast.error("Cap must be between $5 and $1000.");
      return;
    }
    if (!user) return;

    try {
      setIsUpdatingCap(true);
      const res = await fetch(`${getApiUrl()}/api/billing/update-cap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": user.uid,
        },
        body: JSON.stringify({ monthlySpendCapUsd: val }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Monthly spending cap updated to $${val.toFixed(2)}`);
        await fetchWalletAndHistory();
      } else {
        toast.error(data.error);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setIsUpdatingCap(false);
    }
  };

  const totalBalance = walletDetails
    ? walletDetails.balanceUsd
    : walletBalance;

  return (
    <Dialog open={showBillingDialog} onOpenChange={setShowBillingDialog}>
      <DialogContent
        className="w-[94vw] max-w-[920px] aspect-[4/3] max-h-[88vh] p-0 flex flex-col overflow-hidden gap-0 rounded-xl bg-card border-border shadow-2xl"
        style={{ aspectRatio: "4/3" }}
      >
        <DialogHeader className="px-6 py-4 border-b border-border bg-muted/20 flex flex-row items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
              <CreditCard className="w-4 h-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-foreground">Billing & Prepaid Wallet</DialogTitle>
              <p className="text-xs text-muted-foreground">Pay-as-you-go credits, usage history, and spend limits</p>
            </div>
          </div>
          {user && (
            <div className="text-xs font-mono font-bold px-3 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full border border-emerald-500/20">
              Balance: ${totalBalance.toFixed(2)}
            </div>
          )}
        </DialogHeader>

        {/* Navigation Tabs */}
        <div className="px-6 pt-3 border-b border-border bg-muted/10 flex items-center gap-2 shrink-0">
          {[
            { id: "wallet", label: "Prepaid Wallet", icon: Wallet },
            { id: "history", label: "Usage History", icon: History },
            { id: "guide", label: "Billing Guide", icon: HelpCircle },
            { id: "limits", label: "Spend Limits", icon: Sliders },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 cursor-pointer transition-colors ${
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Contents */}
        <div className="flex-1 p-6 overflow-y-auto">
          {!user ? (
            <div className="text-center py-12 space-y-3">
              <Wallet className="w-10 h-10 text-muted-foreground mx-auto" />
              <h4 className="text-sm font-bold text-foreground">Sign in to access your prepaid wallet</h4>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Sign in with your email or Google account to add funds and view your usage history.
              </p>
              <Button
                size="sm"
                onClick={() => {
                  setShowBillingDialog(false);
                  setShowAuthDialog(true);
                }}
              >
                Sign in
              </Button>
            </div>
          ) : activeTab === "wallet" ? (
            // ─────────────────────────────────────────────
            // Tab 1: Prepaid Wallet & Add Funds
            // ─────────────────────────────────────────────
            <div className="space-y-6 animate-in fade-in duration-200">
              {/* Balance Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Total Balance */}
                <div className="p-4 bg-muted/20 border border-border rounded-xl space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                    Available Balance
                  </span>
                  <div className="text-2xl font-black font-mono text-foreground flex items-center">
                    ${totalBalance.toFixed(2)}
                  </div>
                  <span className="text-[10px] text-muted-foreground block">
                    Prepaid wallet (No postpaid bills)
                  </span>
                </div>

                {/* Real USD Funds */}
                <div className="p-4 bg-muted/20 border border-border rounded-xl space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                    Purchased Funds
                  </span>
                  <div className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                    ${(walletDetails?.balanceUsd || 0).toFixed(2)}
                  </div>
                  <span className="text-[10px] text-muted-foreground block">
                    Usable across all AI models & providers
                  </span>
                </div>
              </div>

              {/* Add Funds Section */}
              <div className="p-5 border border-border rounded-xl bg-card space-y-4">
                <div>
                  <h4 className="text-xs font-bold text-foreground">Add Prepaid Funds</h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Select an amount to deposit. Funds never expire and are credited immediately upon verified checkout.
                  </p>
                </div>

                {/* Preset Amount Buttons */}
                <div className="grid grid-cols-4 gap-3">
                  {[5, 10, 25, 50].map((amt) => {
                    const isSelected = selectedTopUp === amt;
                    return (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setSelectedTopUp(amt)}
                        className={`py-3 px-2 rounded-lg border text-center transition-all cursor-pointer ${
                          isSelected
                            ? "border-primary bg-primary/10 text-primary font-bold shadow-xs scale-[1.02]"
                            : "border-border hover:bg-muted text-foreground font-semibold"
                        }`}
                      >
                        <div className="text-base font-black font-mono">${amt}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">USD</div>
                      </button>
                    );
                  })}
                </div>

                {/* Payment Buttons */}
                <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                  <Button
                    size="default"
                    onClick={() => handleAddFunds(false)}
                    disabled={isProcessingCheckout}
                    className="w-full sm:w-auto font-bold text-xs gap-2 px-6"
                  >
                    {isProcessingCheckout ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CreditCard className="w-4 h-4" />
                    )}
                    Pay with Card / Stripe (${selectedTopUp})
                  </Button>

                  <Button
                    variant="outline"
                    size="default"
                    onClick={() => handleAddFunds(true)}
                    disabled={isProcessingCheckout}
                    className="w-full sm:w-auto text-xs font-semibold gap-1.5"
                    title="Simulate instant top-up for local development"
                  >
                    Instant Top-Up (Sandbox / Test Mode)
                  </Button>
                </div>
              </div>

              {/* Low Balance Warning notice if balance < $1.00 */}
              {totalBalance < 1.0 && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    Your wallet balance is low (${totalBalance.toFixed(2)}). Add funds to ensure uninterrupted audio drama broadcast generation.
                  </span>
                </div>
              )}
            </div>
          ) : activeTab === "history" ? (
            // ─────────────────────────────────────────────
            // Tab 2: Usage History Table
            // ─────────────────────────────────────────────
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-foreground">Usage & Transaction History</h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Immutable append-only ledger entries for all charges, reserves, refunds, and deposits.
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={fetchWalletAndHistory} className="h-7 text-xs gap-1">
                  <RefreshCw className="w-3 h-3" />
                  Refresh
                </Button>
              </div>

              {history.length === 0 ? (
                <div className="text-center py-12 border border-dashed rounded-lg text-muted-foreground text-xs">
                  No billing transactions recorded yet.
                </div>
              ) : (
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/40 border-b border-border font-bold text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2.5">Date</th>
                        <th className="px-3 py-2.5">Feature</th>
                        <th className="px-3 py-2.5">Provider</th>
                        <th className="px-3 py-2.5">Units</th>
                        <th className="px-3 py-2.5">Amount</th>
                        <th className="px-3 py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {history.map((entry) => {
                        const isCredit = entry.amount > 0;
                        return (
                          <tr key={entry.id} className="hover:bg-muted/20 transition-colors">
                            <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                              {new Date(entry.createdAt).toLocaleDateString()}{" "}
                              {new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </td>
                            <td className="px-3 py-2 font-semibold text-foreground capitalize">
                              {entry.feature.replace(/_/g, " ")}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground font-mono text-[11px]">
                              {entry.provider}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {entry.units} {entry.units === 1 ? "unit" : "units"}
                            </td>
                            <td className={`px-3 py-2 font-mono font-bold ${isCredit ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
                              {isCredit ? `+$${entry.amount.toFixed(4)}` : `-$${Math.abs(entry.amount).toFixed(4)}`}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${
                                  entry.status === "completed"
                                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                                    : entry.status === "refunded"
                                    ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                                }`}
                              >
                                {entry.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : activeTab === "guide" ? (
            // ─────────────────────────────────────────────
            // Tab 3: Plain-Language Billing Guide
            // ─────────────────────────────────────────────
            <div className="space-y-5 animate-in fade-in duration-200 text-xs text-foreground/90 leading-relaxed">
              <div className="border-b border-border pb-3">
                <h4 className="text-sm font-bold text-foreground">How EBookCC Billing Works</h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Clear, honest pricing with zero surprise charges or recurring subscriptions.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-muted/20 border border-border rounded-lg space-y-1.5">
                  <h5 className="font-bold text-foreground flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                    Prepaid Only ("Pay-as-you-go")
                  </h5>
                  <p className="text-muted-foreground text-[11px]">
                    You add funds in advance. We never bill your credit card after the fact, and there are no monthly recurring membership fees.
                  </p>
                </div>

                <div className="p-4 bg-muted/20 border border-border rounded-lg space-y-1.5">
                  <h5 className="font-bold text-foreground flex items-center gap-1.5">
                    <RefreshCw className="w-4 h-4 text-blue-500" />
                    Failed Calls & Automatic Refunds
                  </h5>
                  <p className="text-muted-foreground text-[11px]">
                    When an AI job begins, funds are temporarily held in reserve. If the job fails or is cancelled, 100% of the reserved amount is instantly returned to your balance.
                  </p>
                </div>

                <div className="p-4 bg-muted/20 border border-border rounded-lg space-y-1.5">
                  <h5 className="font-bold text-foreground flex items-center gap-1.5">
                    <Sliders className="w-4 h-4 text-primary" />
                    Use Your Own API Key = 0 Credits
                  </h5>
                  <p className="text-muted-foreground text-[11px]">
                    If you configure your own Gemini, OpenAI, Claude, or ElevenLabs API key in AI Settings, your platform balance is not touched. You are billed directly by your provider at cost.
                  </p>
                </div>

                <div className="p-4 bg-muted/20 border border-border rounded-lg space-y-1.5">
                  <h5 className="font-bold text-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    Cached Audio Is 100% Free
                  </h5>
                  <p className="text-muted-foreground text-[11px]">
                    Once a broadcast chapter or comic script has been generated, it is stored in the cache. Replaying or re-listening consumes zero credits.
                  </p>
                </div>
              </div>

              {/* Feature Cost Estimates */}
              <div className="p-4 border border-border rounded-lg bg-card space-y-3">
                <h5 className="font-bold text-foreground">Typical Platform Cost Estimates</h5>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
                  <div className="p-2.5 bg-muted/30 rounded border">
                    <span className="font-bold block text-foreground">Vision OCR</span>
                    <span className="text-muted-foreground">~$0.003 / page</span>
                  </div>
                  <div className="p-2.5 bg-muted/30 rounded border">
                    <span className="font-bold block text-foreground">Broadcast Voice</span>
                    <span className="text-muted-foreground">~$0.004 / dialogue line</span>
                  </div>
                  <div className="p-2.5 bg-muted/30 rounded border">
                    <span className="font-bold block text-foreground">Script Director</span>
                    <span className="text-muted-foreground">~$0.015 / chapter</span>
                  </div>
                  <div className="p-2.5 bg-muted/30 rounded border">
                    <span className="font-bold block text-foreground">Music & SFX</span>
                    <span className="text-muted-foreground">Free (CC0 library)</span>
                  </div>
                </div>
              </div>

              {/* Support Notice */}
              <div className="text-[11px] text-muted-foreground flex items-center justify-between p-3 bg-muted/15 rounded-lg border">
                <span>Have billing questions or need a custom enterprise quota?</span>
                <a
                  href="mailto:support@ebookcc.ai"
                  className="text-primary hover:underline font-bold inline-flex items-center gap-1"
                >
                  Contact Support <ArrowUpRight className="w-3 h-3" />
                </a>
              </div>
            </div>
          ) : (
            // ─────────────────────────────────────────────
            // Tab 4: Spending Limits & Monthly Cap
            // ─────────────────────────────────────────────
            <div className="space-y-5 animate-in fade-in duration-200 text-xs">
              <div>
                <h4 className="text-sm font-bold text-foreground">Spending Safeguards & Monthly Cap</h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Protect your budget with a strict monthly spend limit. Once reached, paid generation pauses.
                </p>
              </div>

              <div className="p-4 border border-border rounded-lg bg-muted/15 space-y-4 max-w-md">
                <div>
                  <label className="text-xs font-bold block mb-1 text-foreground">
                    Monthly Spending Limit (USD)
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-2.5 text-muted-foreground font-bold">$</span>
                      <input
                        type="number"
                        min="5"
                        max="1000"
                        value={newCapInput}
                        onChange={(e) => setNewCapInput(e.target.value)}
                        className="w-full text-xs pl-7 pr-3 py-2 border border-border bg-background rounded-md font-mono text-foreground font-semibold"
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={handleUpdateMonthlyCap}
                      disabled={isUpdatingCap}
                      className="font-bold text-xs"
                    >
                      {isUpdatingCap ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save Cap"}
                    </Button>
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-1 block">
                    Current month spend: ${(walletDetails?.currentMonthSpendUsd || 0).toFixed(2)} of $
                    {(walletDetails?.monthlySpendCapUsd || 50).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Dialog Footer */}
        <div className="px-6 py-3 border-t border-border bg-muted/20 flex items-center justify-between shrink-0">
          <div className="text-[11px] text-muted-foreground">
            All balance changes are cryptographically secured and ledger-backed.
          </div>
          <Button size="sm" onClick={() => setShowBillingDialog(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
