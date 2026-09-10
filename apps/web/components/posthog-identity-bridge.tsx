"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import {
  analyticsEnvironment, initializePostHog, isDemoMode, isPostHogConfigured,
} from "@/lib/analytics";

export function PostHogIdentityBridge({ accountId, planId }: { accountId: string | null; planId: string | null }) {
  useEffect(() => {
    if (!isPostHogConfigured() || isDemoMode()) return;
    initializePostHog();
    if (accountId?.trim()) {
      posthog.identify(accountId.trim(), {
        environment: analyticsEnvironment(),
        planId: planId ?? "none",
      });
    } else {
      posthog.reset();
    }
  }, [accountId, planId]);

  useEffect(() => () => {
    if (isPostHogConfigured() && !isDemoMode()) posthog.reset();
  }, []);

  return null;
}
