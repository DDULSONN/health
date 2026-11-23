"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";
import { OPEN_QUICK_PASS } from "@/lib/dating-open-quick-pass";
import { PROVINCE_ORDER } from "@/lib/region-city";
import type { LovePassNearbyItem, LovePassOwnCard, LovePassStatus } from "@/lib/dating-love-pass-access";

const passPath = "/dating/love-pass";
const { priceKrw, durationDays, instantPublishes, instantCooldownDays, extraApplications, dailyLikes, maxPreferredAreas } = OPEN_QUICK_PASS;
const dateLabel = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
type Status = { loggedIn: boolean; saleAvailable: boolean; purchaseEligible?: boolean; verified?: boolean; canPublish?: boolean; pass: LovePassStatus | null; ownCard?: LovePassOwnCard | null; error?: string };
type NearbyState = { items: LovePassNearbyItem[]; error: string; loading: boolean };
const emptyNearby: NearbyState = { items: [], error: "", loading: true };
const nearbyFailure = "근처 오픈카드를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.";
const outline = "inline-flex min-h-11 items-center justify-center rounded-xl border border-neutral-300 bg-white px-3 text-sm font-semibold text-neutral-800 disabled:opacity-50";
const cardBox = "rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5";

export default function DatingLovePassPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nearby, setNearby] = useState<NearbyState>(emptyNearby);
  const activeRequest = useRef<AbortController | null>(null);
  const nearbyRequest = useRef<AbortController | null>(null);
  const writeLock = useRef(false);

  const load = useCallback(async () => {
    activeRequest.current?.abort();
    nearbyRequest.current?.abort();
    setNearby(emptyNearby);
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const { response, body } = await fetchClientJson<Status>("/api/dating/love-pass", { cache: "no-store", signal: controller.signal }, 15_000);
      if (controller.signal.aborted) return;
      if (!response.ok || !body) throw new Error(body?.error || "연애 패스 상태를 불러오지 못했어요.");
      setStatus(body);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setStatus(null);
        setError(cause instanceof Error && cause.name !== "AbortError" ? cause.message : "연애 패스 상태를 불러오지 못했어요. 다시 확인해 주세요.");
      }
    }
  }, []);

  const loadNearby = useCallback(async (expected: LovePassStatus) => {
    nearbyRequest.current?.abort();
    const controller = new AbortController();
    nearbyRequest.current = controller;
    setNearby(emptyNearby);
    try {
      const { response, body } = await fetchClientJson<{ items?: LovePassNearbyItem[]; passId?: string; areas?: string[]; error?: string }>(
        "/api/dating/love-pass?nearby=1", { cache: "no-store", signal: controller.signal }, 12_000,
      );
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403 || (response.ok && body &&
        (body.passId !== expected.id || !Array.isArray(body.areas) ||
          body.areas.length !== expected.areas.length || !expected.areas.every(area => body.areas?.includes(area))))) {
        // Do not keep potentially private data when the current access or area selection has changed.
        setStatus(null);
        setError("연애 패스 이용 상태가 바뀌었어요. 다시 확인해 주세요.");
        return;
      }
      if (!response.ok || !Array.isArray(body?.items)) {
        setNearby({ items: [], error: body?.error || nearbyFailure, loading: false });
        return;
      }
      setNearby({ items: body.items, error: "", loading: false });
    } catch {
      if (!controller.signal.aborted) setNearby({ items: [], error: nearbyFailure, loading: false });
    }
  }, []);

  useEffect(() => {
    void load();
    return () => activeRequest.current?.abort();
  }, [load]);

  const pass = status?.pass;
  const verified = status?.verified;
  useEffect(() => {
    if (verified && pass && pass.areas.length > 0) void loadNearby(pass);
    return () => nearbyRequest.current?.abort();
  }, [verified, pass, loadNearby]);

  const perform = async (task: () => Promise<void>) => {
    if (writeLock.current) return;
    writeLock.current = true;
    setPending(true); setError(""); setNotice("");
    try { await task(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "잠시 후 다시 시도해 주세요."); }
    finally { writeLock.current = false; setPending(false); }
  };

  const purchase = () => void perform(async () => {
    const { response, body } = await fetchClientJson<{ ok?: boolean; checkoutUrl?: string; alreadyActive?: boolean; message?: string }>("/api/payments/toss/create", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productType: "dating_love_pass_30d", offerPlacement: "dating_love_pass" }),
    }, 15_000);
    if (response.status === 401) { window.location.assign(`/login?redirect=${encodeURIComponent(passPath)}`); return; }
    if (!response.ok || !body?.ok) throw new Error(body?.message || "결제창을 열지 못했어요. 다시 시도해 주세요.");
    if (body.alreadyActive) { await load(); return; }
    if (!body.checkoutUrl) throw new Error("결제창을 열지 못했어요.");
    window.location.assign(body.checkoutUrl);
  });

  const update = (payload: { action: "areas"; areas: string[] } | { action: "publish"; cardId: string }) => void perform(async () => {
    const { response, body } = await fetchClientJson<{ ok?: boolean; error?: string }>("/api/dating/love-pass", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!response.ok || !body?.ok) throw new Error(body?.error || "다시 시도해 주세요.");
    await load();
    if (payload.action === "publish") setNotice("내 오픈카드를 공개했어요.");
  });

  const saved = pass?.areas ?? [];
  const ownCard = status?.ownCard;
  const publicationReady = status?.canPublish === true;

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6">
      <Link href="/community/dating/cards?tab=open_cards" className="inline-flex min-h-11 items-center text-sm text-neutral-600 hover:text-neutral-950">‹ 오픈카드</Link>
      {!status ? (
        <section className={cardBox} aria-labelledby="love-pass-loading-title">
          <h1 id="love-pass-loading-title" className="text-xl font-bold text-neutral-950">짐툴 연애 패스</h1>
          {!error ? <p className="mt-2 text-sm text-neutral-600" role="status">이용 가능 여부 확인 중…</p> : null}
        </section>
      ) : pass ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-bold text-neutral-950">짐툴 연애 패스</h1>
            <p className="text-xs font-semibold text-emerald-800">{dateLabel.format(new Date(pass.expiresAt))}까지</p>
          </div>
          {!status?.verified ? <p className="rounded-xl border border-neutral-200 p-3 text-sm">휴대폰 인증을 확인해 주세요. <Link href="/mypage" className="underline">마이페이지</Link></p> : <div className="space-y-3">
            <section className={cardBox} aria-labelledby="love-nearby-title">
              <div className="flex flex-wrap items-center justify-between gap-1"><h2 id="love-nearby-title" className="font-bold">근처 오픈카드</h2><p className="text-xs text-neutral-600">추가 지원권 {pass.creditsRemaining}장</p></div>
              <p className="mt-1 text-xs text-neutral-600">관심 지역을 두 곳까지 고르면, 대기 중인 카드부터 보여드려요.</p>
              <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="관심 지역">
                {PROVINCE_ORDER.map(area => {
                  const selected = saved.includes(area);
                  return <button type="button" key={area} aria-pressed={selected} disabled={pending || (!selected && saved.length >= maxPreferredAreas)}
                    className={`${outline} ${selected ? "border-emerald-400 bg-emerald-50 text-emerald-900" : ""}`}
                    onClick={() => update({ action: "areas", areas: selected ? saved.filter(a => a !== area) : [...saved, area] })}>{area}</button>;
                })}
              </div>
              {saved.length > 0 && (nearby.loading ? <p className="mt-3 text-sm text-neutral-600" role="status">근처 오픈카드 확인 중…</p>
                : nearby.error ? <div className="mt-3 rounded-lg bg-neutral-50 px-3 pt-2 text-sm text-neutral-700">
                  <p role="status">{nearby.error}</p>
                  <button type="button" className="min-h-11 font-semibold underline" disabled={pending} onClick={() => void loadNearby(pass)}>근처 카드 다시 확인</button>
                </div>
                : nearby.items.length === 0 ? <p className="mt-3 text-sm text-neutral-600">지금은 선택한 지역에 볼 수 있는 카드가 없어요.</p> : null)}
              {nearby.items.map(item => <article key={item.id} className="mt-2 flex items-center justify-between gap-2 border-t border-neutral-100 pt-2">
                <div className="min-w-0 break-words"><h3 className="text-sm font-semibold">{item.nickname}</h3><p className="text-xs text-neutral-600">{item.age}세 · {item.region} · {item.status === "pending" ? <strong className="text-rose-700">대기 중</strong> : "공개 중"}</p></div>
                <Link className={`${outline} shrink-0`} href={`/community/dating/cards/${item.id}?from=love-pass`}>프로필 보기</Link>
              </article>)}
            </section>
            <section className={cardBox} aria-labelledby="love-own-title">
              <div className="flex flex-wrap items-center justify-between gap-1"><h2 id="love-own-title" className="font-bold">내 오픈카드</h2><p className="text-xs text-neutral-600">바로 공개 {pass.publicationsRemaining}회 남음</p></div>
              {ownCard?.status === "pending" ? <button className={`${outline} mt-2`} type="button" disabled={pending || !publicationReady} onClick={() => update({ action: "publish", cardId: ownCard.id })}>지금 공개</button>
                : ownCard?.status === "public" ? <p className="mt-2 text-sm text-neutral-600">공개 중이에요.</p> : <Link className={`${outline} mt-2`} href="/dating/card/new">내 오픈카드 등록</Link>}
              {pass.nextPublicationAt && !publicationReady && pass.publicationsRemaining > 0 ? <p className="mt-1 text-xs text-neutral-600">{Date.parse(pass.nextPublicationAt) < Date.parse(pass.expiresAt) ? `다음 공개: ${dateLabel.format(new Date(pass.nextPublicationAt))}` : "다음 바로 공개 가능일 전에 이용권이 끝나요."}</p> : null}
            </section>
            <section className={cardBox} aria-labelledby="love-quick-title">
              <h2 id="love-quick-title" className="font-bold">빠른매칭</h2>
              <p className="mt-1 text-xs text-neutral-600">보기는 횟수 제한 없이, 좋아요는 하루 {dailyLikes}번까지.</p>
              <Link className={`${outline} mt-2`} href="/community/dating/cards?tab=quick_match">빠른매칭 보기</Link>
            </section>
          </div>}
        </>
      ) : (
        <section className={cardBox} aria-labelledby="love-pass-title">
          <p className="text-xs font-semibold text-neutral-600">오픈카드 · 빠른매칭</p>
          <h1 id="love-pass-title" className="mt-1 text-2xl font-bold tracking-tight">짐툴 연애 패스</h1>
          <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 text-sm text-emerald-900">
            <h2 className="font-bold">근처 새 프로필 먼저 보기</h2>
            <p className="mt-1 leading-5">관심 지역 {maxPreferredAreas}곳에서, 공개를 기다리는 카드도 먼저 보고 지원할 수 있어요.</p>
          </div>
          <ul className="mt-2 divide-y divide-neutral-100 border-b border-neutral-100 text-sm">
            <li className="py-2"><strong>내 오픈카드는 대기 없이 공개</strong><p className="text-xs leading-5 text-neutral-600">{instantCooldownDays}일에 한 번씩, {durationDays}일 동안 최대 {instantPublishes}번 올릴 수 있어요.</p></li>
            <li className="py-2"><strong>오픈카드에 {extraApplications}번 더 지원</strong></li>
            <li className="py-2"><strong>빠른매칭은 횟수 제한 없이 보기</strong><p className="text-xs leading-5 text-neutral-600">좋아요는 하루 {dailyLikes}번까지. 내 프로필도 더 자주 보여줘요.</p></li>
          </ul>
          <p className="my-2 flex items-center justify-between gap-2 text-sm font-semibold"><span>{durationDays}일 이용권</span><strong className="text-xl">{priceKrw.toLocaleString("ko-KR")}원</strong></p>
          {!status.loggedIn ? <Link href={`/login?redirect=${encodeURIComponent(passPath)}`} className={`${outline} w-full`}>로그인하고 확인하기</Link>
            : !status.saleAvailable ? <p className="rounded-xl bg-neutral-50 p-3 text-sm text-neutral-600">지금은 판매를 준비 중이에요. 이미 결제했다면 <Link href="/mypage?section=payment" className="font-semibold underline">내 결제 내역</Link>에서 확인해 주세요.</p>
            : !status.purchaseEligible ? <p className="rounded-xl bg-neutral-50 p-3 text-sm text-neutral-700">휴대폰 인증과 오픈카드 등록을 마치면 구매할 수 있어요. <Link href={status.verified ? "/dating/card/new" : "/mypage"} className="font-semibold underline">{status.verified ? "오픈카드 등록" : "인증 확인"}</Link></p>
            : <button type="button" disabled={pending} onClick={purchase} className="min-h-[46px] w-full rounded-xl bg-[#d90037] px-4 text-sm font-bold text-white hover:bg-[#be0030] disabled:opacity-50">{pending ? "결제창 준비 중…" : "연애 패스 구매하기"}</button>}
          <p className="mt-2 text-center text-xs text-neutral-500">자동결제 없음 · 1:1 연락처 교환 별도</p>
        </section>
      )}
      {notice ? <p className="mt-3 text-sm text-emerald-800" role="status">{notice}</p> : null}
      {error ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}<button type="button" className="ml-2 min-h-11 font-semibold underline" disabled={pending} onClick={() => { setError(""); void load(); }}>상태 다시 확인</button></div> : null}
    </main>
  );
}
