"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DatingAdultNotice from "@/components/DatingAdultNotice";
import PaidPolicyNotice from "@/components/PaidPolicyNotice";
import { createClient } from "@/lib/supabase/client";
import { normalizeDatingApplyReturn } from "@/lib/dating-apply-return";

type ApplyCreditsStatusResponse = { loggedIn?: boolean; baseRemaining?: number; creditsRemaining?: number };
const OPEN_KAKAO_URL = "https://open.kakao.com/o/s2gvTdhi";
const PACK_SIZE = 5;
const PACK_AMOUNT = 5000;
const PAYMENT_CARD_UNAVAILABLE_MESSAGE = "현재 국민/우리/현대 카드는 결제가 되지 않습니다. 다른 카드나 다른 결제수단으로 다시 시도해 주세요.";
function withPaymentCardNotice(message: string) { return message + "\n" + PAYMENT_CARD_UNAVAILABLE_MESSAGE; }
function safeCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

export default function ApplyCreditsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [loggedIn, setLoggedIn] = useState(false);
  const [baseRemaining, setBaseRemaining] = useState<number | null>(null);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const checkoutLock = useRef(false);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true); setStatusError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token ?? null;
      setLoggedIn(Boolean(accessToken));
      const res = await fetch("/api/dating/apply-credits/status", {
        cache: "no-store", headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      if (!res.ok) throw new Error("STATUS_FAILED");
      const body = (await res.json()) as ApplyCreditsStatusResponse;
      if (!body || safeCount(body.baseRemaining) === null || safeCount(body.creditsRemaining) === null) throw new Error("INVALID_STATUS");
      setLoggedIn(body.loggedIn === true || Boolean(accessToken));
      setBaseRemaining(safeCount(body.baseRemaining));
      setCreditsRemaining(safeCount(body.creditsRemaining));
    } catch {
      setStatusError("남은 지원권을 불러오지 못했어요. 다시 확인해 주세요.");
    } finally { setStatusLoading(false); }
  }, [supabase]);
  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const handleCheckout = useCallback(async () => {
    if (checkoutLock.current || submitting) return;
    checkoutLock.current = true;
    setSubmitting(true); setCheckoutError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token ?? null;
      if (!accessToken) { setCheckoutError("로그인 후 결제할 수 있어요."); return; }
      const res = await fetch("/api/payments/toss/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ productType: "apply_credits", returnTo: normalizeDatingApplyReturn(new URLSearchParams(window.location.search).get("returnTo")) }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; checkoutUrl?: string };
      if (!res.ok || body.ok === false) { setCheckoutError(withPaymentCardNotice(body.message ?? "결제 요청에 실패했습니다.")); return; }
      if (!body.checkoutUrl) { setCheckoutError(withPaymentCardNotice(body.message ?? "결제창을 불러오지 못했습니다.")); return; }
      window.location.href = body.checkoutUrl;
    } catch { setCheckoutError(withPaymentCardNotice("결제 요청 처리 중 오류가 발생했습니다.")); }
    finally { checkoutLock.current = false; setSubmitting(false); }
  }, [submitting, supabase]);

  return (
    <main className="mx-auto max-w-lg px-4 py-6">
      <nav aria-label="오픈카드 메뉴" className="mb-4 flex flex-wrap gap-4 text-sm text-neutral-500">
        <Link href="/community/dating/cards?tab=open_cards" className="inline-flex min-h-[44px] items-center hover:text-neutral-900">오픈카드</Link>
        <Link href="/dating/nearby-view" className="inline-flex min-h-[44px] items-center hover:text-neutral-900">가까운 이상형</Link>
      </nav>
      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h1 className="text-xl font-bold text-neutral-950">오픈카드 지원권</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">오늘 기본 지원을 모두 썼다면 추가로 지원할 수 있어요.</p>
        <dl className="mt-4 grid grid-cols-2 divide-x divide-neutral-200 rounded-xl bg-neutral-50 py-3 text-center">
          <div><dt className="text-xs text-neutral-500">오늘 기본 지원</dt><dd className="mt-1 text-lg font-bold text-neutral-900">{statusLoading ? "확인 중" : statusError ? "—" : `${baseRemaining}회`}</dd></div>
          <div><dt className="text-xs text-neutral-500">남은 추가 지원권</dt><dd className="mt-1 text-lg font-bold text-neutral-900">{statusLoading ? "확인 중" : statusError ? "—" : `${creditsRemaining}장`}</dd></div>
        </dl>
        {statusError ? <div role="alert" className="mt-3 text-xs leading-5 text-rose-700"><p>{statusError}</p><button type="button" disabled={statusLoading} onClick={() => void loadStatus()} className="min-h-[44px] font-semibold underline">다시 확인</button></div> : null}
        <div className="mt-5 flex items-center justify-between gap-3"><span className="text-sm font-semibold text-neutral-900">추가 지원권 {PACK_SIZE}장</span><span className="text-xl font-bold text-neutral-950">{PACK_AMOUNT.toLocaleString("ko-KR")}원</span></div>
        <p className="mt-1 text-xs text-neutral-500">결제 완료 후 바로 사용할 수 있어요.</p>
        <button type="button" onClick={() => void handleCheckout()} disabled={!loggedIn || submitting} className="mt-4 inline-flex min-h-[46px] w-full items-center justify-center rounded-xl bg-[#f0003d] px-4 text-sm font-semibold text-white hover:bg-[#d90037] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900">{submitting ? "결제창 준비 중..." : `지원권 ${PACK_SIZE}장 구매`}</button>
        {checkoutError ? <p role="alert" className="mt-3 whitespace-pre-wrap break-words rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800">{checkoutError}</p> : null}
        {!loggedIn && !statusLoading ? <p className="mt-2 text-xs text-neutral-500">로그인 후 결제할 수 있어요.</p> : null}
      </section>
      <p className="mt-3 text-xs leading-5 text-neutral-500">대기 없이 등록된 카드에는 지원권 차감 없이 지원할 수 있어요.</p>
      <a href={OPEN_KAKAO_URL} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-[44px] items-center text-xs text-neutral-500 underline">결제 문의</a>
      <DatingAdultNotice />
      <PaidPolicyNotice />
    </main>
  );
}
