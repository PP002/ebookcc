/**
 * serverBilling.ts
 *
 * Prepaid wallet, atomic append-only ledger, Stripe checkout/webhook,
 * and single pricing configuration with 40% markup.
 */

import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// ─────────────────────────────────────────────
// 1. Pricing & Markup Configuration
// ─────────────────────────────────────────────

export interface FeaturePricing {
  unit: "tokens" | "characters" | "images" | "seconds" | "pages";
  providerUnitCost: number; // in USD per single unit (e.g. per 1 token or per 1 character)
  unitMultiplier: number;  // e.g. 1000 for per-1k-tokens
  unitLabel: string;       // e.g. "1k tokens", "page", "image", "1000 chars"
  minimumCharge: number;   // minimum charge per execution in USD
  typicalUnits: number;    // typical units per standard action
}

// Configurable markup (default 0.40 = 40%)
export const BILLING_CONFIG = {
  MARKUP: Number(process.env.BILLING_MARKUP || 0.40),
  GLOBAL_DAILY_SPEND_CAP_USD: Number(process.env.GLOBAL_DAILY_SPEND_CAP_USD || 500.00),
  DEFAULT_MONTHLY_CAP_USD: Number(process.env.DEFAULT_MONTHLY_CAP_USD || 50.00),
  ALLOWED_TOP_UP_AMOUNTS: [5, 10, 25, 50],
};

/**
 * Provider base unit costs across features.
 * Format: [feature][provider/model]
 */
export const PRICING_CONFIG: Record<string, Record<string, FeaturePricing>> = {
  vision_ocr: {
    "@cf/google/gemma-4-26b-a4b-it": {
      unit: "pages",
      providerUnitCost: 0.0005,
      unitMultiplier: 1,
      unitLabel: "page",
      minimumCharge: 0.0005,
      typicalUnits: 1,
    },
    "@cf/meta/llama-3.2-11b-vision-instruct": {
      unit: "pages",
      providerUnitCost: 0.0005,
      unitMultiplier: 1,
      unitLabel: "page",
      minimumCharge: 0.0005,
      typicalUnits: 1,
    },
    "google/gemini-4-hydrogen": {
      unit: "pages",
      providerUnitCost: 0.003,
      unitMultiplier: 1,
      unitLabel: "page",
      minimumCharge: 0.003,
      typicalUnits: 1,
    },
    "anthropic/claude-sonnet-5-5": {
      unit: "pages",
      providerUnitCost: 0.005,
      unitMultiplier: 1,
      unitLabel: "page",
      minimumCharge: 0.005,
      typicalUnits: 1,
    },
  },
  vision_analyst: {
    "@cf/google/gemma-4-26b-a4b-it": {
      unit: "pages",
      providerUnitCost: 0.001,
      unitMultiplier: 1,
      unitLabel: "page",
      minimumCharge: 0.001,
      typicalUnits: 1,
    },
    "@cf/deepseek-ai/deepseek-v4.1-flash-1017": {
      unit: "pages",
      providerUnitCost: 0.0008,
      unitMultiplier: 1,
      unitLabel: "page",
      minimumCharge: 0.0008,
      typicalUnits: 1,
    },
    "google/gemini-4-hydrogen": {
      unit: "pages",
      providerUnitCost: 0.012,
      unitMultiplier: 1,
      unitLabel: "page",
      minimumCharge: 0.01,
      typicalUnits: 1,
    },
    "google/gemini-4-argon": {
      unit: "pages",
      providerUnitCost: 0.015,
      unitMultiplier: 1,
      unitLabel: "page",
      minimumCharge: 0.01,
      typicalUnits: 1,
    },
    "anthropic/claude-sonnet-5-5": {
      unit: "pages",
      providerUnitCost: 0.02,
      unitMultiplier: 1,
      unitLabel: "page",
      minimumCharge: 0.015,
      typicalUnits: 1,
    },
  },
  tts: {
    "@cf/deepgram/aura-2-en": {
      unit: "characters",
      providerUnitCost: 0.000015,
      unitMultiplier: 1000,
      unitLabel: "1k chars",
      minimumCharge: 0.001,
      typicalUnits: 250,
    },
    "@cf/inworld/tts-1.5-max": {
      unit: "characters",
      providerUnitCost: 0.000018,
      unitMultiplier: 1000,
      unitLabel: "1k chars",
      minimumCharge: 0.001,
      typicalUnits: 250,
    },
    "@cf/deepgram/aura-2-es": {
      unit: "characters",
      providerUnitCost: 0.000015,
      unitMultiplier: 1000,
      unitLabel: "1k chars",
      minimumCharge: 0.001,
      typicalUnits: 250,
    },
    "elevenlabs/eleven_v4": {
      unit: "characters",
      providerUnitCost: 0.00015,
      unitMultiplier: 1000,
      unitLabel: "1k chars",
      minimumCharge: 0.005,
      typicalUnits: 250,
    },
    "openai/gpt-audio": {
      unit: "characters",
      providerUnitCost: 0.00002,
      unitMultiplier: 1000,
      unitLabel: "1k chars",
      minimumCharge: 0.003,
      typicalUnits: 250,
    },
  },
  text_to_image: {
    "black_forest_labs/flux-3-image": {
      unit: "images",
      providerUnitCost: 0.030,
      unitMultiplier: 1,
      unitLabel: "image",
      minimumCharge: 0.030,
      typicalUnits: 1,
    },
    "stability/sd3.5-large": {
      unit: "images",
      providerUnitCost: 0.035,
      unitMultiplier: 1,
      unitLabel: "image",
      minimumCharge: 0.035,
      typicalUnits: 1,
    },
    "openai/gpt-image-2.6-sunburst": {
      unit: "images",
      providerUnitCost: 0.040,
      unitMultiplier: 1,
      unitLabel: "image",
      minimumCharge: 0.040,
      typicalUnits: 1,
    },
  },
  director: {
    "@cf/nvidia/nemotron-3-120b-a12b": {
      unit: "tokens",
      providerUnitCost: 0.0000006,
      unitMultiplier: 1000,
      unitLabel: "1k tokens",
      minimumCharge: 0.001,
      typicalUnits: 4000,
    },
    "@cf/deepseek-ai/deepseek-v4.1-flash-1017": {
      unit: "tokens",
      providerUnitCost: 0.0000005,
      unitMultiplier: 1000,
      unitLabel: "1k tokens",
      minimumCharge: 0.001,
      typicalUnits: 4000,
    },
    "anthropic/claude-sonnet-5-5": {
      unit: "tokens",
      providerUnitCost: 0.000008,
      unitMultiplier: 1000,
      unitLabel: "1k tokens",
      minimumCharge: 0.015,
      typicalUnits: 4000,
    },
    "google/gemini-4-argon": {
      unit: "tokens",
      providerUnitCost: 0.000005,
      unitMultiplier: 1000,
      unitLabel: "1k tokens",
      minimumCharge: 0.01,
      typicalUnits: 4000,
    },
  },
  music: {
    "cc0_manifest_library": {
      unit: "seconds",
      providerUnitCost: 0.0,
      unitMultiplier: 60,
      unitLabel: "track",
      minimumCharge: 0.0,
      typicalUnits: 1,
    },
    "elevenlabs/eleven_music_v2": {
      unit: "seconds",
      providerUnitCost: 0.001,
      unitMultiplier: 60,
      unitLabel: "minute",
      minimumCharge: 0.02,
      typicalUnits: 60,
    },
  },
  sfx: {
    "cc0_manifest_library": {
      unit: "seconds",
      providerUnitCost: 0.0,
      unitMultiplier: 1,
      unitLabel: "clip",
      minimumCharge: 0.0,
      typicalUnits: 1,
    },
    "elevenlabs/eleven_sfx_v3": {
      unit: "seconds",
      providerUnitCost: 0.002,
      unitMultiplier: 1,
      unitLabel: "second",
      minimumCharge: 0.005,
      typicalUnits: 3,
    },
  },
};

/**
 * Calculates charged price with configured markup:
 * Charged Price = Provider Cost * (1 + MARKUP), with per-feature minimum charge.
 */
export function calculateChargedPrice(
  feature: string,
  model: string,
  units: number = 1
): {
  providerCost: number;
  chargedPrice: number;
  unit: string;
  unitLabel: string;
  isWorkersAi: boolean;
} {
  const isWorkersAi = model.startsWith("@cf/") || model === "cc0_manifest_library";
  const featureGroup = PRICING_CONFIG[feature] || {};
  let pricing = featureGroup[model];

  if (!pricing) {
    // Fallback default pricing
    pricing = {
      unit: "tokens",
      providerUnitCost: isWorkersAi ? 0.000001 : 0.00001,
      unitMultiplier: 1000,
      unitLabel: "unit",
      minimumCharge: isWorkersAi ? 0.001 : 0.005,
      typicalUnits: 1,
    };
  }

  const rawCost = pricing.providerUnitCost * units;
  const markupPrice = rawCost * (1 + BILLING_CONFIG.MARKUP);
  const chargedPrice = Math.max(pricing.minimumCharge, Math.round(markupPrice * 10000) / 10000);

  return {
    providerCost: rawCost,
    chargedPrice: isWorkersAi && rawCost === 0 ? 0 : chargedPrice,
    unit: pricing.unit,
    unitLabel: pricing.unitLabel,
    isWorkersAi,
  };
}

// ─────────────────────────────────────────────
// 2. Types & Ledger Schema
// ─────────────────────────────────────────────

export interface UserWallet {
  userId: string;
  email: string;
  balanceUsd: number;
  monthlySpendCapUsd: number;
  currentMonthSpendUsd: number;
  lastMonthReset: string; // YYYY-MM
  createdAt: number;
  updatedAt: number;
}

export type LedgerEntryType =
  | "deposit"
  | "reserve"
  | "settle"
  | "refund"
  | "adjustment";

export type LedgerEntryStatus = "completed" | "pending" | "refunded" | "cancelled";

export interface LedgerEntry {
  id: string;
  userId: string;
  type: LedgerEntryType;
  amount: number; // positive for additions/refunds, negative for charges/reservations
  balanceAfter: number;
  jobId: string | null;
  feature: string;
  provider: string;
  units: number;
  status: LedgerEntryStatus;
  metadata?: Record<string, any>;
  createdAt: number;
}

// ─────────────────────────────────────────────
// 3. Persistent Atomic Ledger & Wallet Store
// ─────────────────────────────────────────────

const BILLING_STORAGE_DIR = path.join("/tmp", "ebookcc-media", "billing");
const WALLETS_FILE = path.join(BILLING_STORAGE_DIR, "wallets.json");
const LEDGER_FILE = path.join(BILLING_STORAGE_DIR, "ledger.json");
const PROCESSED_WEBHOOKS_FILE = path.join(BILLING_STORAGE_DIR, "processed_webhooks.json");

fs.mkdirSync(BILLING_STORAGE_DIR, { recursive: true });

// In-memory caches backed by disk
const wallets = new Map<string, UserWallet>();
const ledger: LedgerEntry[] = [];
const processedWebhookEventIds = new Set<string>();

// Per-user transaction lock mutexes to guarantee strict atomic serial processing
const userMutexes = new Map<string, Promise<any>>();

function withUserLock<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const currentLock = userMutexes.get(userId) || Promise.resolve();
  const nextLock = currentLock.then(task, task);
  userMutexes.set(userId, nextLock);
  return nextLock;
}

// Load initial data from disk
function loadBillingDataFromDisk() {
  try {
    if (fs.existsSync(WALLETS_FILE)) {
      const data = JSON.parse(fs.readFileSync(WALLETS_FILE, "utf-8"));
      Object.entries(data).forEach(([uid, w]: [string, any]) => wallets.set(uid, w));
    }
    if (fs.existsSync(LEDGER_FILE)) {
      const data: LedgerEntry[] = JSON.parse(fs.readFileSync(LEDGER_FILE, "utf-8"));
      data.forEach((entry) => ledger.push(entry));
    }
    if (fs.existsSync(PROCESSED_WEBHOOKS_FILE)) {
      const ids: string[] = JSON.parse(fs.readFileSync(PROCESSED_WEBHOOKS_FILE, "utf-8"));
      ids.forEach((id) => processedWebhookEventIds.add(id));
    }
  } catch (err: any) {
    console.error("[Billing Store] Error loading data from disk:", err.message);
  }
}

function persistBillingDataToDisk() {
  try {
    const walletsObj: Record<string, UserWallet> = {};
    wallets.forEach((w, id) => {
      walletsObj[id] = w;
    });
    fs.writeFileSync(WALLETS_FILE, JSON.stringify(walletsObj, null, 2), "utf-8");
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledger.slice(-2000), null, 2), "utf-8");
    fs.writeFileSync(
      PROCESSED_WEBHOOKS_FILE,
      JSON.stringify(Array.from(processedWebhookEventIds).slice(-1000)),
      "utf-8"
    );
  } catch (err: any) {
    console.error("[Billing Store] Error persisting to disk:", err.message);
  }
}

loadBillingDataFromDisk();

/**
 * Returns or initializes a UserWallet
 */
export function getOrCreateWallet(userId: string, email: string = ""): UserWallet {
  const currentMonth = new Date().toISOString().slice(0, 7);
  let wallet = wallets.get(userId);

  if (!wallet) {
    wallet = {
      userId,
      email,
      balanceUsd: 0.0,
      monthlySpendCapUsd: BILLING_CONFIG.DEFAULT_MONTHLY_CAP_USD,
      currentMonthSpendUsd: 0.0,
      lastMonthReset: currentMonth,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    wallets.set(userId, wallet);
    persistBillingDataToDisk();
  }

  // Monthly reset check
  if (wallet.lastMonthReset !== currentMonth) {
    wallet.currentMonthSpendUsd = 0.0;
    wallet.lastMonthReset = currentMonth;
    wallet.updatedAt = Date.now();
    persistBillingDataToDisk();
  }

  return wallet;
}

/**
 * Append an entry to the atomic ledger
 */
function recordLedgerEntry(entry: Omit<LedgerEntry, "id" | "createdAt">): LedgerEntry {
  const fullEntry: LedgerEntry = {
    ...entry,
    id: `led_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    createdAt: Date.now(),
  };
  ledger.push(fullEntry);
  persistBillingDataToDisk();
  return fullEntry;
}

/**
 * Top up wallet balance via verified checkout webhook or manual credit
 */
export async function creditWallet(
  userId: string,
  amount: number,
  eventId: string,
  email: string = ""
): Promise<UserWallet> {
  return withUserLock(userId, async () => {
    if (processedWebhookEventIds.has(eventId)) {
      console.log(`[Billing] Event ${eventId} already processed, skipping idempotent top-up.`);
      return getOrCreateWallet(userId, email);
    }

    processedWebhookEventIds.add(eventId);
    const wallet = getOrCreateWallet(userId, email);
    wallet.balanceUsd = Math.round((wallet.balanceUsd + amount) * 100) / 100;
    wallet.updatedAt = Date.now();

    recordLedgerEntry({
      userId,
      type: "deposit",
      amount,
      balanceAfter: wallet.balanceUsd,
      jobId: null,
      feature: "top_up",
      provider: "stripe",
      units: 1,
      status: "completed",
      metadata: { eventId },
    });

    persistBillingDataToDisk();
    return wallet;
  });
}

// Map of currently reserved jobs: jobId -> { userId, reservedAmount, feature, provider }
const activeReservations = new Map<
  string,
  {
    userId: string;
    reservedAmount: number;
    feature: string;
    provider: string;
  }
>();

/**
 * Reserve funds before executing an AI job.
 * Rejects if balance is insufficient.
 */
export async function reserveJobFunds(params: {
  userId: string;
  jobId: string;
  estimatedCost: number;
  feature: string;
  provider: string;
  isWorkersAiModel: boolean;
  email?: string;
}): Promise<{ approved: boolean; reason?: string; reservedAmount: number; totalAvailable: number }> {
  return withUserLock(params.userId, async () => {
    const wallet = getOrCreateWallet(params.userId, params.email);
    const cost = Math.max(0, Math.round(params.estimatedCost * 10000) / 10000);

    if (cost === 0) {
      return { approved: true, reservedAmount: 0, totalAvailable: wallet.balanceUsd };
    }

    // Monthly cap check
    if (wallet.currentMonthSpendUsd + cost > wallet.monthlySpendCapUsd) {
      return {
        approved: false,
        reason: `Monthly spending cap of $${wallet.monthlySpendCapUsd.toFixed(2)} reached. You can adjust your spending limit in Billing settings.`,
        reservedAmount: 0,
        totalAvailable: wallet.balanceUsd,
      };
    }

    if (wallet.balanceUsd >= cost) {
      wallet.balanceUsd = Math.round((wallet.balanceUsd - cost) * 10000) / 10000;
    } else {
      return {
        approved: false,
        reason: `Insufficient funds. Estimated cost is $${cost.toFixed(4)}, but your available balance is $${wallet.balanceUsd.toFixed(4)}. Please add funds to your wallet.`,
        reservedAmount: 0,
        totalAvailable: wallet.balanceUsd,
      };
    }

    wallet.updatedAt = Date.now();
    activeReservations.set(params.jobId, {
      userId: params.userId,
      reservedAmount: cost,
      feature: params.feature,
      provider: params.provider,
    });

    recordLedgerEntry({
      userId: params.userId,
      type: "reserve",
      amount: -cost,
      balanceAfter: wallet.balanceUsd,
      jobId: params.jobId,
      feature: params.feature,
      provider: params.provider,
      units: 1,
      status: "pending",
    });

    persistBillingDataToDisk();
    return { approved: true, reservedAmount: cost, totalAvailable: wallet.balanceUsd };
  });
}

/**
 * Settle funds when a job finishes:
 * Settle to actual cost and refund difference (or full refund on failure).
 */
export async function settleJobFunds(params: {
  userId: string;
  jobId: string;
  actualCost: number;
  success: boolean;
  units?: number;
}): Promise<{ settledAmount: number; refundedAmount: number }> {
  return withUserLock(params.userId, async () => {
    const reservation = activeReservations.get(params.jobId);
    if (!reservation) {
      return { settledAmount: 0, refundedAmount: 0 };
    }

    activeReservations.delete(params.jobId);
    const wallet = getOrCreateWallet(params.userId);
    const reserved = reservation.reservedAmount;
    const actual = params.success ? Math.min(reserved * 1.5, Math.max(0, params.actualCost)) : 0;
    const refund = Math.max(0, Math.round((reserved - actual) * 10000) / 10000);

    if (refund > 0) {
      wallet.balanceUsd = Math.round((wallet.balanceUsd + refund) * 10000) / 10000;
    }

    if (actual > 0) {
      wallet.currentMonthSpendUsd = Math.round((wallet.currentMonthSpendUsd + actual) * 10000) / 10000;
    }

    wallet.updatedAt = Date.now();

    // Mark previous reserve entry as completed or refunded
    const prevEntry = ledger.find((e) => e.jobId === params.jobId && e.type === "reserve");
    if (prevEntry) {
      prevEntry.status = params.success ? "completed" : "refunded";
    }

    if (refund > 0) {
      recordLedgerEntry({
        userId: params.userId,
        type: "refund",
        amount: refund,
        balanceAfter: wallet.balanceUsd,
        jobId: params.jobId,
        feature: reservation.feature,
        provider: reservation.provider,
        units: params.units || 1,
        status: "completed",
        metadata: {
          reason: params.success ? "Difference between estimate and actual cost" : "Job failed or cancelled",
        },
      });
    }

    persistBillingDataToDisk();
    return { settledAmount: actual, refundedAmount: refund };
  });
}

// ─────────────────────────────────────────────
// 4. Rate Limiting Middleware
// ─────────────────────────────────────────────

const userRequestCounts = new Map<string, { count: number; resetAt: number }>();

export function billingRateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const userId = (req.headers["x-user-id"] as string) || req.ip || "anon";
  const now = Date.now();
  const current = userRequestCounts.get(userId);

  if (!current || now > current.resetAt) {
    userRequestCounts.set(userId, { count: 1, resetAt: now + 60000 });
    return next();
  }

  if (current.count >= 60) {
    return res.status(429).json({ error: "Rate limit exceeded. Please wait a minute." });
  }

  current.count++;
  next();
}

// ─────────────────────────────────────────────
// 5. Express Route Registration for Billing
// ─────────────────────────────────────────────

export function setupBillingRoutes(app: express.Express) {
  // Helper to extract authenticated user ID
  function getAuthUserId(req: express.Request): string | null {
    const uid = req.headers["x-user-id"] as string;
    if (uid && uid.length > 2) return uid;
    // Also support bearer token / dev user
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      if (token && token.length > 5) return token;
    }
    return null;
  }

  // 1. GET /api/billing/wallet
  app.get("/api/billing/wallet", billingRateLimit, (req, res): any => {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized. Please sign in to view your billing wallet." });
    }
    const email = (req.query.email as string) || (req.headers["x-user-email"] as string) || "";
    const wallet = getOrCreateWallet(userId, email);

    return res.json({
      balanceUsd: wallet.balanceUsd,
      totalAvailableUsd: Math.round(wallet.balanceUsd * 100) / 100,
      monthlySpendCapUsd: wallet.monthlySpendCapUsd,
      currentMonthSpendUsd: wallet.currentMonthSpendUsd,
      markup: BILLING_CONFIG.MARKUP,
    });
  });

  // 2. GET /api/billing/history
  app.get("/api/billing/history", billingRateLimit, (req, res): any => {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized." });
    }
    const userLedger = ledger
      .filter((e) => e.userId === userId)
      .slice(-100)
      .reverse();

    return res.json({ history: userLedger });
  });

  // 3. POST /api/billing/estimate (Pre-flight cost check)
  app.post("/api/billing/estimate", billingRateLimit, (req, res): any => {
    const { feature, model, units = 1, isOwnKey = false } = req.body;
    if (isOwnKey) {
      return res.json({
        providerCost: 0,
        chargedPrice: 0,
        unit: "billed by provider",
        unitLabel: "billed by provider",
        isWorkersAi: false,
        isOwnKey: true,
        priceHint: "Billed directly by your own API provider (Zero platform deduction)",
      });
    }

    const result = calculateChargedPrice(feature, model, units);
    return res.json({
      ...result,
      isOwnKey: false,
      priceHint: `Est. platform cost: ~$${result.chargedPrice.toFixed(4)} / ${result.unitLabel}`,
    });
  });

  // 4. POST /api/billing/create-checkout-session (Stripe Add Funds)
  app.post("/api/billing/create-checkout-session", billingRateLimit, async (req, res): Promise<any> => {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const { amount, returnUrl, isSandboxSimulation } = req.body;
    const numAmount = Number(amount);
    if (!BILLING_CONFIG.ALLOWED_TOP_UP_AMOUNTS.includes(numAmount)) {
      return res.status(400).json({
        error: `Invalid amount. Allowed amounts: $${BILLING_CONFIG.ALLOWED_TOP_UP_AMOUNTS.join(", $")}`,
      });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const email = req.body.email || (req.headers["x-user-email"] as string) || "";

    // Local / Dev sandbox simulation or when STRIPE_SECRET_KEY is absent
    if (!stripeKey || isSandboxSimulation) {
      const mockEventId = `sim_evt_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
      const updatedWallet = await creditWallet(userId, numAmount, mockEventId, email);

      return res.json({
        mode: "sandbox",
        success: true,
        message: `Successfully topped up $${numAmount.toFixed(2)} to prepaid wallet (Sandbox mode).`,
        wallet: {
          balanceUsd: updatedWallet.balanceUsd,
        },
      });
    }

    // Production Stripe Checkout session
    try {
      const stripeHeaders: Record<string, string> = {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      };

      const params = new URLSearchParams({
        success_url: `${returnUrl || "https://ais-dev-hdnihrh5osfa2rtxf3lhro-642769293101.europe-west2.run.app"}?billing_status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${returnUrl || "https://ais-dev-hdnihrh5osfa2rtxf3lhro-642769293101.europe-west2.run.app"}?billing_status=cancelled`,
        mode: "payment",
        client_reference_id: userId,
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][product_data][name]": `EBookCC Prepaid AI Credits ($${numAmount})`,
        "line_items[0][price_data][product_data][description]": "Non-refundable pay-as-you-go credits for audio drama broadcast, OCR & comic generation",
        "line_items[0][price_data][unit_amount]": String(Math.round(numAmount * 100)),
        "line_items[0][quantity]": "1",
        "metadata[userId]": userId,
        "metadata[amount]": String(numAmount),
      });

      const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: stripeHeaders,
        body: params.toString(),
      });

      if (!stripeRes.ok) {
        const errText = await stripeRes.text();
        console.error("[Stripe Checkout Error]", errText);
        return res.status(500).json({ error: "Failed to create Stripe checkout session." });
      }

      const sessionData: any = await stripeRes.json();
      return res.json({
        mode: "stripe",
        checkoutUrl: sessionData.url,
        sessionId: sessionData.id,
      });
    } catch (e: any) {
      console.error("[Billing Checkout]", e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // 6. POST /api/billing/webhook (Stripe webhook, idempotent by event id)
  app.post("/api/billing/webhook", express.raw({ type: "application/json" }), async (req, res): Promise<any> => {
    const sig = req.headers["stripe-signature"] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event: any;
    try {
      const rawBody = typeof req.body === "string" ? req.body : req.body.toString("utf-8");
      event = JSON.parse(rawBody);
    } catch (err: any) {
      return res.status(400).send(`Webhook parse error: ${err.message}`);
    }

    if (event?.type === "checkout.session.completed") {
      const session = event.data?.object;
      const userId = session?.client_reference_id || session?.metadata?.userId;
      const amountUsd = Number(session?.metadata?.amount) || (session?.amount_total ? session.amount_total / 100 : 0);

      if (userId && amountUsd > 0) {
        await creditWallet(userId, amountUsd, event.id, session.customer_details?.email || "");
        console.log(`[Billing Webhook] Successfully credited $${amountUsd} to user ${userId} for event ${event.id}`);
      }
    }

    return res.json({ received: true });
  });

  // 7. POST /api/billing/update-cap
  app.post("/api/billing/update-cap", billingRateLimit, (req, res): any => {
    const userId = getAuthUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized." });

    const newCap = Number(req.body.monthlySpendCapUsd);
    if (isNaN(newCap) || newCap < 5 || newCap > 1000) {
      return res.status(400).json({ error: "Monthly cap must be between $5 and $1000." });
    }

    const wallet = getOrCreateWallet(userId);
    wallet.monthlySpendCapUsd = newCap;
    wallet.updatedAt = Date.now();
    persistBillingDataToDisk();

    return res.json({ success: true, monthlySpendCapUsd: wallet.monthlySpendCapUsd });
  });
}
