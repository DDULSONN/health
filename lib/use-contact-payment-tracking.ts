"use client";

import { useEffect, useRef } from "react";
import { contactPaymentPlacement, recordContactPaymentEvent } from "@/lib/contact-payment-analytics";

export function useContactPaymentTracking(matchId: string, amount: number, enabled: boolean) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const recorded = useRef(new Set<string>());
  useEffect(() => {
    const button = buttonRef.current;
    if (!enabled || !button || !contactPaymentPlacement() || typeof IntersectionObserver === "undefined") return;
    const key = `${matchId}:${amount}`;
    if (recorded.current.has(key)) return;
    let visible = false, disposed = false, pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    const schedule = () => {
      cancel();
      if (!visible || document.visibilityState !== "visible" || button.disabled || pending || recorded.current.has(key)) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (disposed || !visible || document.visibilityState !== "visible" || button.disabled) return;
        pending = true;
        void recordContactPaymentEvent("view_item", matchId, amount).then((saved) => {
          pending = false;
          if (saved && !disposed) recorded.current.add(key);
        });
      }, 750);
    };
    // Count the actual enabled button, not just a card mounted below the fold.
    let observer: IntersectionObserver;
    try {
      observer = new IntersectionObserver((entries) => {
        visible = entries.some(entry => entry.target === button && entry.isIntersecting && entry.intersectionRatio >= 0.5);
        schedule();
      }, { threshold: [0, 0.5] });
      observer.observe(button);
    } catch { return; } // A broken/blocked observer must not break the offer UI.
    document.addEventListener("visibilitychange", schedule);
    return () => { disposed = true; cancel(); observer.disconnect(); document.removeEventListener("visibilitychange", schedule); };
  }, [matchId, amount, enabled]);
  return { buttonRef, trackClick: () => {
    if (enabled) void recordContactPaymentEvent("select_item", matchId, amount);
  } };
}
