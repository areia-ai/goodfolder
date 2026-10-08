const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";
const DEMO_STORAGE_KEY = "goodfolder.demo";

// posthog-js is heavy and only ever needed once, so it loads lazily: a static
// import would put it in every page's shared chunk. lib/bundle-hygiene.test.ts
// keeps it that way.
let client: typeof import("posthog-js").default | null = null;
let loading: Promise<void> | null = null;

export type ProductAnalyticsEvent =
  | "sign_in_link_requested"
  | "folder_created"
  | "save_created"
  | "timeline_opened"
  | "webmcp_tool_called"
  | "challenge_code_redeemed"
  | "checkout_started"
  | "subscription_completed";

export const SAFE_PROPERTY_KEYS = [
  "environment", "planId", "area", "result", "toolName", "toolCount", "fileCount",
  "saveCount", "addedCount", "changedCount", "removedCount", "itemCount", "interval",
  "role", "suggestionCount", "proposalCount", "source",
] as const;

type SafePropertyKey = (typeof SAFE_PROPERTY_KEYS)[number];
type SafePropertyValue = string | number | boolean | null;
type ProductAnalyticsProperties = Partial<Record<SafePropertyKey, unknown>>;

let initializationAttempted = false;

/** Analytics is optional: an unset key must leave the product fully inert. */
export function isPostHogConfigured(): boolean {
  return Boolean((process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "").trim());
}

/** Demo traffic is deliberately excluded, including automatic page views. */
export function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  const requested = new URLSearchParams(window.location.search).get("demo");
  if (requested === "1") return true;
  if (requested === "0" || requested === "off") return false;
  try {
    return window.sessionStorage.getItem(DEMO_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function analyticsEnvironment(): "demo" | "development" | "production" | "self_hosted" {
  if (isDemoMode()) return "demo";
  if (process.env.NODE_ENV === "development") return "development";
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").trim();
  return apiUrl && !apiUrl.includes("trygoodfolder.com") ? "self_hosted" : "production";
}

/** Initialize from either Next's client instrumentation hook or the layout fallback. */
export function initializePostHog(): Promise<void> {
  if (typeof window === "undefined" || !isPostHogConfigured() || isDemoMode() || initializationAttempted) {
    return loading ?? Promise.resolve();
  }
  initializationAttempted = true;

  const key = (process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "").trim();
  const host = (process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "").trim() || DEFAULT_POSTHOG_HOST;
  loading ??= import("posthog-js").then((m) => {
    client = m.default;
    client.init(key, {
      api_host: host,
      ui_host: "https://eu.posthog.com",
      // Product analytics does not need a durable browser identity. Keeping the
      // anonymous id in memory avoids analytics cookies and local-storage state;
      // a new page load is deliberately a new anonymous visit.
      persistence: "memory",
      person_profiles: "never",
      capture_pageview: "history_change",
      capture_pageleave: true,
      autocapture: false,
      disable_session_recording: true,
      capture_exceptions: false,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      disable_surveys: true,
      disable_conversations: true,
      disable_product_tours: true,
      advanced_disable_feature_flags: true,
      advanced_disable_decide: true,
      save_campaign_params: false,
      save_referrer: false,
      respect_dnt: true,
    });
  });
  return loading;
}

function filterSafeProperties(properties: ProductAnalyticsProperties): Record<string, SafePropertyValue> {
  const safe = new Set<string>(SAFE_PROPERTY_KEYS);
  const filtered: Array<[string, SafePropertyValue]> = [];
  for (const [key, value] of Object.entries({ environment: analyticsEnvironment(), ...properties })) {
    if (!safe.has(key)) continue;
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      filtered.push([key, value]);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      filtered.push([key, value]);
    }
  }
  return Object.fromEntries(filtered);
}

/** Capture one product action without allowing file-derived data into events. */
export function captureProductEvent(event: ProductAnalyticsEvent, properties: ProductAnalyticsProperties = {}): void {
  if (typeof window === "undefined" || !isPostHogConfigured() || isDemoMode()) return;
  const safe = filterSafeProperties(properties);
  // Analytics must never delay or break a GoodFolder action.
  void initializePostHog().then(() => client?.capture(event, safe)).catch(() => {});
}

/** Attach the signed-in account to analytics events once the client is up. */
export function identifyAnalyticsUser(accountId: string, props: Record<string, string>): void {
  void initializePostHog().then(() => client?.identify(accountId, props)).catch(() => {});
}

/** Drop the analytics identity on sign-out. */
export function resetAnalyticsUser(): void {
  void initializePostHog().then(() => client?.reset()).catch(() => {});
}
