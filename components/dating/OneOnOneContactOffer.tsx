"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import PaymentCardNotice from "@/components/PaymentCardNotice";
import OneOnOneContactNudge, { ReceivedContactNudge } from "@/components/dating/OneOnOneContactNudge";
import type { OneOnOneContactNudgePresetKey, OneOnOneContactNudgeSummary } from "@/lib/dating-1on1-contact-nudge";
import { ONE_ON_ONE_CONTACT_PRICE_KRW } from "@/lib/dating-contact-price";
import { isContactIntroOffer, type ContactIntroOffer } from "@/lib/contact-intro-offer";
import { useContactPaymentTracking } from "@/lib/use-contact-payment-tracking";

type Props = {
  matchId: string;
  name?: string | null;
  included: boolean;
  processing: boolean;
  nudge?: OneOnOneContactNudgeSummary | null;
  nudgeProcessing: boolean;
  onExchange: (matchId: string, offerId?: string) => void;
  onNudge: (matchId: string, preset: OneOnOneContactNudgePresetKey) => void;
  help?: ReactNode;
  compact?: boolean;
};

export default function OneOnOneContactOffer({ matchId, name, included, processing, nudge, nudgeProcessing, onExchange, onNudge, help, compact = false }: Props) {
  const priceDescriptionId = useId();
  const [offer, setOffer] = useState<ContactIntroOffer | null>(null);
  useEffect(() => {
    if (included) return;
    let disposed = false;
    let controller: AbortController | null = null;
    const load = async () => {
      controller?.abort();
      const request = new AbortController(); controller = request;
      const timeout = window.setTimeout(() => request.abort(), 4500);
      try {
        const res = await fetch(`/api/dating/1on1/contact-intro-offer?matchId=${encodeURIComponent(matchId)}`, {
          cache: "no-store", credentials: "same-origin", signal: request.signal,
        });
        const body = await res.json();
        if (disposed || request.signal.aborted) return;
        setOffer(res.ok && isContactIntroOffer(body.offer) && body.offer.matchId === matchId ? body.offer : null);
      } catch { if (!disposed && !request.signal.aborted) setOffer(null); }
      finally { window.clearTimeout(timeout); }
    };
    void load();
    window.addEventListener("focus", load);
    return () => { disposed = true; controller?.abort(); window.removeEventListener("focus", load); };
  }, [matchId, included]);
  // A stale quote is still submitted by ID: the server rejects it instead of
  // silently charging 20,000. No member information is cached across accounts.
  const discount = !included && offer?.matchId === matchId ? offer : null;
  const amount = discount?.amount ?? ONE_ON_ONE_CONTACT_PRICE_KRW;
  const { buttonRef, trackClick } = useContactPaymentTracking(matchId, amount, !included && !processing);
  return (
    <div className="min-w-0">
      {!compact ? <p className="break-words text-sm font-semibold text-neutral-900">
        {name?.trim() ? `${name.trim()}님과 서로 수락했어요` : "서로 수락했어요"}
      </p> : null}
      <p className="mt-1 text-xs leading-5 text-neutral-600">
        {included ? "기존 플러스 혜택으로 추가 결제 없이 연락처를 교환할 수 있어요." : compact ? "서로 수락했어요. 결제 후 연락처가 공개돼요." : "결제 완료 후 서로의 연락처가 공개돼요."}
      </p>
      {!included && <PaymentCardNotice className="mt-2" compact={compact} />}
      {nudge?.available && nudge.received_from_other ? (
        <div className="mt-3 rounded-xl border border-neutral-200 bg-white p-3">
          <ReceivedContactNudge item={nudge.received_from_other} />
        </div>
      ) : null}
      {discount ? <p className="mt-2 text-xs font-semibold text-[#f0003d]">
        {discount.active ? <>첫 교환 25% 할인 <span className="ml-1 font-normal text-neutral-400 line-through">20,000원</span>
          <span className="ml-1 font-normal text-neutral-500">· {new Date(discount.expiresAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}까지</span></> : "진행 중인 할인 주문 · 기존 금액 유지"}
      </p> : null}
      <button ref={buttonRef} type="button" disabled={processing} aria-describedby={!included ? priceDescriptionId : undefined} onClick={() => {
        // Measurement is fire-and-forget; it must never gate payment or free exchanges.
        trackClick();
        onExchange(matchId, discount?.offerId);
      }}
        className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-[#f0003d] px-3 py-2 text-sm font-semibold text-white hover:bg-[#d90037] disabled:opacity-50">
        {processing ? (included ? "교환 중..." : "결제 준비 중...") : included ? "무료로 번호교환" : "연락처 교환하기"}
      </button>
      {!included ? <p id={priceDescriptionId} className="mt-1 text-center text-xs font-medium text-neutral-600">
        {amount.toLocaleString("ko-KR")}원
      </p> : null}
      {!included ? (
        <details className="mt-2 text-[11px] leading-5 text-neutral-500">
          <summary className="min-h-[44px] cursor-pointer content-center py-2">연락처 교환 안내</summary>
          <p className="mt-1">한 분이 결제를 완료하면 두 분 모두 연락처를 확인할 수 있어요. 각각 결제할 필요는 없어요.</p>
          {help}
        </details>
      ) : null}
      <OneOnOneContactNudge matchId={matchId} nudge={nudge} hideReceived compact={compact} processing={nudgeProcessing} onSend={onNudge} />
    </div>
  );
}
