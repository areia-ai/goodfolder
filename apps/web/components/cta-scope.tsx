"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function CtaScope({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.3 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return <span ref={ref} aria-hidden="true" className={`gf-cta-scope${isVisible ? " is-visible" : ""}`}>{children}</span>;
}
