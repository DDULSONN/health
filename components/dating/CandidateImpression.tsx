"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { queueCandidateImpression } from "@/lib/dating-1on1-impressions-client";

// No layout changes: replaces the existing card's div/article, not an extra box.
export default function CandidateImpression({ ticket, candidateId, className, children, as = "div" }: {
  ticket?: string | null; candidateId?: string; className?: string; children: ReactNode; as?: "div" | "article";
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !ticket || !candidateId || typeof IntersectionObserver === "undefined") return;
    let visible = false, recorded = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = () => { if (timer) clearTimeout(timer); timer = null; };
    const update = () => {
      stop();
      if (!visible || recorded || document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        if (!visible || document.visibilityState !== "visible") return;
        recorded = true; queueCandidateImpression(ticket, candidateId); observer.disconnect();
      }, 800);
    };
    // A very tall mobile card can exceed the viewport: 200 visible pixels is
    // enough there. For smaller cards, require 25% continuously visible.
    const threshold = Math.min(0.25, 200 / Math.max(1, element.getBoundingClientRect().height));
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.target === element && entry.isIntersecting && entry.intersectionRatio >= threshold);
      update();
    }, { threshold: [0, threshold] });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    return () => { stop(); observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, [ticket, candidateId]);
  if (as === "article") return <article ref={ref} className={className}>{children}</article>;
  return <div ref={ref as RefObject<HTMLDivElement>} className={className}>{children}</div>;
}
