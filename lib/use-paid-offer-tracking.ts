"use client";

import { useCallback, useEffect, useRef } from "react";
import { trackPaidOfferSelected, trackPaidOfferViewed } from "@/lib/payment-analytics";

// Display-only analytics: never block navigation, submission, or payment.
export function usePaidOfferTracking(itemId: string, itemName: string, amount: number, placement: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    let visible = false, recorded = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      if (!visible || recorded || document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        recorded = true;
        try { trackPaidOfferViewed({ itemId, itemName, amount, placement }); } catch { /* optional */ }
        observer.disconnect();
      }, 750);
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.5);
      update();
    }, { threshold: [0, 0.5] });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    return () => { clearTimeout(timer); observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, [itemId, itemName, amount, placement]);
  const selected = useCallback(() => {
    try { trackPaidOfferSelected({ itemId, itemName, amount, placement }); } catch { /* optional */ }
  }, [itemId, itemName, amount, placement]);
  return { ref, selected };
}
