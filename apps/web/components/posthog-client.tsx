"use client";

import { useEffect } from "react";
import { initializePostHog } from "@/lib/analytics";

/** Fallback initializer for static exports where instrumentation-client is skipped. */
export function PostHogClient() {
  useEffect(() => initializePostHog(), []);
  return null;
}
