import { initializePostHog } from "@/lib/analytics";

// Next 15.5+ invokes this in the browser. The layout component is a harmless
// fallback for static exports or versions where the hook is not invoked.
if (typeof window !== "undefined") initializePostHog();
