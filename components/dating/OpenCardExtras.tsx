"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";
import { readApplyCreditStatus } from "@/lib/contextual-paid-offers";
import { usePaidOfferTracking } from "@/lib/use-paid-offer-tracking";

import { APPLY_CREDIT_BALANCE_CHANGED, isApplyCreditBalanceChangeForUser } from "@/lib/apply-credit-balance-events";

export default function OpenCardExtras({ userId }: { userId: string | null }) {
  const [balance, setBalance] = useState<{ userId: string; value: NonNullable<ReturnType<typeof readApplyCreditStatus>> } | null>(null);
  const nearby = usePaidOfferTracking("city_view", "가까운 이상형", 5000, "open_card_tools");
  useEffect(() => {
    if (!userId) return;
    let live = true, generation = 0, lastStarted = 0, invalidated = false;
    let controller: AbortController | undefined;
    const refresh = (force = false) => {
      if (document.visibilityState !== "visible" || (!force && Date.now() - lastStarted < 30000)) return;
      invalidated = false;
      lastStarted = Date.now(); const version = ++generation;
      controller?.abort(); controller = new AbortController();
      setBalance(null);
      void fetchClientJson<unknown>("/api/dating/apply-credits/status", { cache: "no-store", signal: controller.signal }, 10000)
        .then(({ response, body }) => {
          if (!live || version !== generation || !response.ok) return;
          const status = readApplyCreditStatus(body);
          if (status) setBalance({ userId, value: status });
        }).catch(() => { /* Unknown is not zero: retain ordinary navigation only. */ });
    };
    const onFocus = () => refresh(invalidated);
    const onBalanceChanged = (event: Event) => {
      if (!isApplyCreditBalanceChangeForUser(event, userId)) return;
      // Discard pre-grant responses, including while this tab is hidden. Only a
      // fresh server read can restore a known balance or the empty-credit offer.
      invalidated = true;
      generation++;
      controller?.abort();
      setBalance(null);
      refresh(true);
    };
    // A payment page can return via the browser's frozen page cache. Recheck its
    // balance even when the previous read was recent; never keep a stale upsell.
    const onPageShow = (event: PageTransitionEvent) => refresh(event.persisted || invalidated);
    refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener(APPLY_CREDIT_BALANCE_CHANGED, onBalanceChanged);
    document.addEventListener("visibilitychange", onFocus);
    return () => { live = false; controller?.abort(); window.removeEventListener("focus", onFocus); window.removeEventListener("pageshow", onPageShow); window.removeEventListener(APPLY_CREDIT_BALANCE_CHANGED, onBalanceChanged); document.removeEventListener("visibilitychange", onFocus); };
  }, [userId]);
  const status = userId && balance?.userId === userId ? balance.value : null;
  const remaining = status?.total ?? null;
  const passRemaining = status?.passCreditsRemaining ?? 0;
  const balanceLabel = remaining === null ? "내역" : passRemaining <= 0 ? `오늘 ${remaining}회 지원 가능`
    : passRemaining === remaining ? `패스 지원권 ${passRemaining}장` : `총 ${remaining}회 지원 가능 · 패스 ${passRemaining}장`;
  return (
    <div className="mb-4 space-y-2">
      <nav aria-label="오픈카드 유료 기능" className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-3">
        <Link href="/dating/apply-credits" className="inline-flex min-h-11 min-w-0 flex-wrap items-center gap-x-2 py-1 text-xs font-semibold text-neutral-700 hover:text-neutral-950">
          지원권 <span className="text-[11px] font-normal text-neutral-500">{balanceLabel}</span>
        </Link>
        <div ref={nearby.ref} className="shrink-0">
          <Link href="/dating/nearby-view" onClick={nearby.selected} className="inline-flex min-h-11 items-center text-xs font-semibold text-neutral-700 hover:text-neutral-950">가까운 이상형 ›</Link>
        </div>
      </nav>
      {remaining === 0 ? <p className="px-3 text-xs leading-5 text-neutral-600">기본 지원 횟수는 매일 밤 12시(한국 시간)에 다시 채워져요.</p> : null}
    </div>
  );
}
