"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function AgentHandoffMotion({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isNearby, setIsNearby] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsNearby(entry.isIntersecting),
      { rootMargin: "280px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return <div ref={ref} className={`gf-agent-handoff${isNearby ? " is-animating" : ""}`}>{children}</div>;
}
