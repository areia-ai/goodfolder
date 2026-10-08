"use client";

import { useEffect } from "react";
import {
  analyticsEnvironment, identifyAnalyticsUser, isDemoMode, isPostHogConfigured, resetAnalyticsUser,
} from "@/lib/analytics";

export function PostHogIdentityBridge({ accountId, planId }: { accountId: string | null; planId: string | null }) {
  useEffect(() => {
    if (!isPostHogConfigured() || isDemoMode()) return;
    if (accountId?.trim()) {
      identifyAnalyticsUser(accountId.trim(), {
        environment: analyticsEnvironment(),
        planId: planId ?? "none",
      });
    } else {
      resetAnalyticsUser();
    }
  }, [accountId, planId]);

  useEffect(() => () => {
    if (isPostHogConfigured() && !isDemoMode()) resetAnalyticsUser();
  }, []);

  return null;
}
