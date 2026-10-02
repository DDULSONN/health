"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchClientJson } from "@/lib/client-json-request";
import { ALL_PASS_PROFILE_DISCOUNT_LABEL, allPassOfferRemaining, allPassOfferTimeLabel, isAllPassProfileOffer, type AllPassProfileOffer } from "@/lib/all-pass-profile-offer";
import { trackCheckoutStarted, trackPaidOfferSelected, trackPaidOfferViewed } from "@/lib/payment-analytics";

type Snapshot = { userId: string; offer: AllPassProfileOffer; receivedAt: number };
type ResponseBody = { userId: string; offer: AllPassProfileOffer | null };

export default function AllPassProfileOfferBanner({ placement }: { placement: string }) {
  const supabase = useMemo(() => createClient(), []);
  const anchor = useRef<HTMLDivElement>(null);
  const identity = useRef<string | null>(null);
  const requestVersion = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const checkoutLock = useRef(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (identity.current === next) return;
      identity.current = next; requestVersion.current++; controller.current?.abort(); checkoutLock.current = false;
      setSnapshot(null); setDismissed(false); setBusy(false); setError(""); setUserId(next);
    });
    return () => { data.subscription.unsubscribe(); requestVersion.current++; controller.current?.abort(); };
  }, [supabase]);
  useEffect(() => {
    let inView = false;
    const update = () => setVisible(inView && document.visibilityState === "visible");
    const observer = new IntersectionObserver(entries => { inView = entries.some(e => e.isIntersecting); update(); });
    if (anchor.current) observer.observe(anchor.current);
    document.addEventListener("visibilitychange", update);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, []);
  const load = useCallback(async (id: string, start: boolean) => {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const stamp = ++requestVersion.current;
    try {
      const response = await fetchClientJson<ResponseBody>("/api/dating/all-pass-offer", {
        method: start ? "POST" : "GET", cache: "no-store", credentials: "same-origin", signal: request.signal,
      });
      if (request.signal.aborted || stamp !== requestVersion.current || identity.current !== id) return;
      if (!response.response.ok || response.body?.userId !== id ||
        (response.body.offer !== null && !isAllPassProfileOffer(response.body.offer))) return;
      const offer = response.body.offer;
      setSnapshot(offer ? { userId: id, offer, receivedAt: performance.now() } : null); setElapsed(0);
      if (start && offer?.state === "active") window.dispatchEvent(new Event("all-pass-profile-offer-updated"));
      try { setDismissed(Boolean(offer?.offerId) && sessionStorage.getItem(`all-pass-offer:${id}:${offer?.offerId}`) === "1"); } catch { /* optional storage */ }
    } catch { /* Optional promotion must never interrupt profile or matching screens. */ }
  }, []);
  useEffect(() => { if (userId) void load(userId, false); }, [userId, load]);
  const offer = snapshot?.userId === userId ? snapshot.offer : null;
  useEffect(() => {
    if (visible && userId && offer?.state === "available") void load(userId, true);
  }, [visible, userId, offer?.state, load]);
  useEffect(() => {
    if (offer?.state !== "active" || !snapshot) return;
    const tick = () => setElapsed(performance.now() - snapshot.receivedAt);
    const timer = window.setInterval(tick, 1000);
    window.addEventListener("focus", tick); document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", tick); document.removeEventListener("visibilitychange", tick); };
  }, [snapshot, offer?.state]);
  useEffect(() => {
    if (offer?.state === "active" && !dismissed && visible) trackPaidOfferViewed({ itemId: "dating_all_pass_30d", itemName: "프로필 완성 올패스 할인", amount: offer.amount, placement });
  }, [offer?.state, offer?.amount, dismissed, visible, placement]);

  const remaining = offer ? allPassOfferRemaining(offer, elapsed) : 0;
  const checkout = async () => {
    if (!offer || !userId || remaining <= 0 || checkoutLock.current) return;
    checkoutLock.current = true; setBusy(true); setError("");
    const id = userId, stamp = requestVersion.current;
    trackPaidOfferSelected({ itemId: "dating_all_pass_30d", itemName: "프로필 완성 올패스 할인", amount: offer.amount, placement });
    try {
      const result = await fetchClientJson<{ ok?: boolean; checkoutUrl?: string; amount?: number; message?: string }>("/api/payments/toss/create", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ productType: "dating_all_pass_30d", allPassOfferId: offer.offerId, offerPlacement: placement }),
      }, 25000);
      if (identity.current !== id || requestVersion.current !== stamp) return;
      if (!result.response.ok || !result.body?.ok || !result.body.checkoutUrl || result.body.amount !== offer.amount) throw Error(result.body?.message || "할인 결제창을 열지 못했어요. 잠시 후 다시 확인해 주세요.");
      const destination = new URL(result.body.checkoutUrl, location.origin);
      if (!((destination.protocol === "https:" && (destination.hostname === "tosspayments.com" || destination.hostname.endsWith(".tosspayments.com"))) ||
        (destination.origin === location.origin && destination.pathname === "/payments/success")) || destination.username || destination.password) throw Error("결제 주소를 확인하지 못했어요.");
      trackCheckoutStarted({ itemId: "dating_all_pass_30d", itemName: "프로필 완성 올패스 할인", amount: offer.amount, placement });
      window.location.assign(destination.href);
    } catch (failure) {
      if (identity.current === id && requestVersion.current === stamp) setError(failure instanceof Error ? failure.message : "잠시 후 다시 확인해 주세요.");
    } finally { if (identity.current === id && requestVersion.current === stamp) { checkoutLock.current = false; setBusy(false); } }
  };
  return <div ref={anchor} className="min-h-px" id="profile-allpass-offer">
    {offer?.state === "active" && remaining > 0 && !dismissed && <aside aria-label="프로필 완성 올패스 할인" className="relative mb-3 border-b border-neutral-200 px-1 py-2 text-neutral-950">
      <div className="flex flex-wrap items-center gap-x-2 pr-8">
        <h2 className="text-sm font-semibold">매칭 올패스 <span className="text-xs font-normal text-neutral-500">30일</span></h2>
        <span className="text-[11px] font-medium text-rose-600">{ALL_PASS_PROFILE_DISCOUNT_LABEL}</span>
      </div>
      <button type="button" aria-label="올패스 할인 안내 닫기" className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-full text-xl text-neutral-400 hover:bg-neutral-50" onClick={() => { setDismissed(true); try { sessionStorage.setItem(`all-pass-offer:${userId}:${offer.offerId}`, "1"); } catch { /* optional */ } }}>×</button>
      <p className="mt-1 text-xs leading-4 text-neutral-500">1:1 후보 새로고침 2회/24시간<br />빠른매칭 하루 30회 · 프로필 우선 추천</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2"><del className="text-[11px] text-neutral-400">{offer.originalAmount.toLocaleString("ko-KR")}원</del><strong className="text-sm font-bold">{offer.amount.toLocaleString("ko-KR")}원</strong></p>
          <p className="text-[11px] leading-4 text-neutral-500">할인 {allPassOfferTimeLabel(remaining)} 남음 · 번호교환 별도</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void checkout()} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60">{busy ? "확인 중…" : "이용하기"}<span aria-hidden="true">›</span></button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs leading-5 text-red-700">{error}</p>}
    </aside>}
  </div>;
}
