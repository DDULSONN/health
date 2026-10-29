"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";
import { readApplyCreditBalance } from "@/lib/contextual-paid-offers";
import { usePaidOfferTracking } from "@/lib/use-paid-offer-tracking";
import CompactPaidOffer from "@/components/dating/CompactPaidOffer";

export default function OpenCardExtras({ userId }: { userId: string | null }) {
  const [balance, setBalance] = useState<{ userId: string; value: number } | null>(null);
  const nearby = usePaidOfferTracking("city_view", "가까운 이상형", 5000, "open_card_tools");
  useEffect(() => {
    if (!userId) return;
    let live = true, generation = 0, lastStarted = 0;
    let controller: AbortController | undefined;
    const refresh = (force = false) => {
      if (document.visibilityState !== "visible" || (!force && Date.now() - lastStarted < 30000)) return;
      lastStarted = Date.now(); const version = ++generation;
      controller?.abort(); controller = new AbortController();
      setBalance(null);
      void fetchClientJson<unknown>("/api/dating/apply-credits/status", { cache: "no-store", signal: controller.signal }, 10000)
        .then(({ response, body }) => {
          if (!live || version !== generation || !response.ok) return;
          const count = readApplyCreditBalance(body);
          if (count !== null) setBalance({ userId, value: count });
        }).catch(() => { /* Unknown is not zero: retain ordinary navigation only. */ });
    };
    const onFocus = () => refresh();
    // A payment page can return via the browser's frozen page cache. Recheck its
    // balance even when the previous read was recent; never keep a stale upsell.
    const onPageShow = (event: PageTransitionEvent) => refresh(event.persisted);
    refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onFocus);
    return () => { live = false; controller?.abort(); window.removeEventListener("focus", onFocus); window.removeEventListener("pageshow", onPageShow); document.removeEventListener("visibilitychange", onFocus); };
  }, [userId]);
  const remaining = userId && balance?.userId === userId ? balance.value : null;
  return (
    <div className="mb-4 space-y-2">
      <nav aria-label="오픈카드 유료 기능" className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-3">
        <Link href="/dating/apply-credits" className="inline-flex min-h-11 min-w-0 flex-wrap items-center gap-x-2 py-1 text-xs font-semibold text-neutral-700 hover:text-neutral-950">
          지원권 <span className="text-[11px] font-normal text-neutral-500">{remaining === null ? "내역" : `오늘 ${remaining}회 지원 가능`}</span>
        </Link>
        <div ref={nearby.ref} className="shrink-0">
          <Link href="/dating/nearby-view" onClick={nearby.selected} className="inline-flex min-h-11 items-center text-xs font-semibold text-neutral-700 hover:text-neutral-950">가까운 이상형 ›</Link>
        </div>
      </nav>
      {remaining === 0 ? <CompactPaidOffer title="오늘 지원을 모두 썼어요" description="추가 지원권 5장 · 5,000원" itemId="apply_credits" amount={5000} placement="open_card_credits_empty">
        <Link href="/dating/apply-credits" className="inline-flex min-h-11 shrink-0 items-center text-xs font-semibold text-rose-600 hover:text-rose-700">5장 충전 ›</Link>
      </CompactPaidOffer> : null}
    </div>
  );
}
