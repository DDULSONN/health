"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchClientJson } from "@/lib/client-json-request";
import { isReturnProfileReward, showReturnRewardOnPath, type ReturnProfileReward } from "@/lib/return-profile-reward";

type Result = { userId: string; reward: ReturnProfileReward | null };

export default function ReturnProfileRewardBanner() {
  const pathname = usePathname();
  const allowed = showReturnRewardOnPath(pathname);
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const currentUser = useRef<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const version = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  // Non-members need no repeated lookup during this mounted session. The cohort is fixed.
  const absentUsers = useRef(new Set<string>());
  const cancelRequest = useCallback(() => {
    inFlight.current?.abort();
    version.current++;
  }, []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (currentUser.current === next) return;
      currentUser.current = next;
      version.current++;
      inFlight.current?.abort();
      setResult(null);
      setFailed(false);
      setBusy(false);
      setUserId(next);
    });
    return () => { data.subscription.unsubscribe(); cancelRequest(); };
  }, [supabase, cancelRequest]);

  const refresh = useCallback(async (id: string, claim: boolean) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const stamp = ++version.current;
    const current = () => !controller.signal.aborted && version.current === stamp && currentUser.current === id;
    if (claim) setBusy(true);
    setFailed(false);
    try {
      const get = (method: "GET" | "POST") => fetchClientJson<Result>("/api/return-profile-reward", {
        method, cache: "no-store", credentials: "same-origin", signal: controller.signal,
      });
      let response = await get(claim ? "POST" : "GET");
      const accept = () => response.response.ok && response.body?.userId === id &&
        (response.body.reward === null || isReturnProfileReward(response.body.reward));
      if (!current()) return;
      if (!accept()) throw new Error("unavailable");
      if (!claim && response.body?.reward?.state === "ready") {
        setResult(response.body);
        setBusy(true);
        response = await get("POST");
        if (!current()) return;
        if (!accept()) throw new Error("unavailable");
      }
      if (response.body?.reward === null) absentUsers.current.add(id);
      const next = response.body!;
      // Only stored/server-confirmed reward state is rendered, never a client-side credit increment.
      const key = next.reward ? `${next.reward.campaignKey}:${id}:${next.reward.state}` : "";
      try { setDismissed(sessionStorage.getItem(`return-reward:${key}`) === "1" ? key : null); } catch { /* session storage is optional */ }
      setResult(next);
    } catch {
      if (current()) setFailed(true);
    } finally {
      if (current()) { setBusy(false); inFlight.current = null; }
    }
  }, []);

  useEffect(() => {
    if (allowed && userId && !absentUsers.current.has(userId)) void refresh(userId, false);
    return cancelRequest;
  }, [allowed, pathname, refresh, userId, cancelRequest]);

  const reward = result?.userId === userId ? result.reward : null;
  const key = reward ? `${reward.campaignKey}:${userId}:${reward.state}` : "";
  if (!allowed || !reward || dismissed === key) return null;
  const rewarded = reward.state === "rewarded";
  const ready = reward.state === "ready";
  return (
    <aside aria-label="복귀 회원 지원권 혜택" className="mx-auto mt-3 w-[calc(100%-2rem)] max-w-5xl rounded-2xl border border-rose-200 bg-white px-4 py-3 text-gray-900 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-rose-600">다시 만나는 짐툴 · 복귀 혜택</p>
          <p className="mt-1 text-sm font-semibold leading-6">{rewarded ? "지원권 5장을 받았어요" : "1:1 프로필 완성하면 지원권 5장"}</p>
          <p className="mt-0.5 text-xs leading-5 text-gray-500">{rewarded ? "기존 지원권에 더해졌어요. 오픈카드 지원에 사용할 수 있어요." : "휴대폰 인증 후 새 1:1 프로필 등록 시 한 번 드려요."}</p>
        </div>
        <button type="button" aria-label="복귀 혜택 안내 닫기" className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-gray-400 hover:bg-gray-50" onClick={() => {
          setDismissed(key);
          try { sessionStorage.setItem(`return-reward:${key}`, "1"); } catch { /* closing still works without storage */ }
        }}>×</button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {rewarded ? <Link href="/community/dating/cards?tab=open_cards" className="inline-flex min-h-11 items-center text-sm font-semibold text-rose-600">오픈카드 보기 →</Link>
          : ready ? <button type="button" disabled={busy} onClick={() => userId && void refresh(userId, true)} className="min-h-11 text-sm font-semibold text-rose-600 disabled:opacity-60">{busy ? "지원권 지급 확인 중…" : "지급 다시 확인"}</button>
          : <Link href="/onboarding/dating?target=one_on_one" className="inline-flex min-h-11 items-center text-sm font-semibold text-rose-600">프로필 작성하기 →</Link>}
        {!rewarded && <details className="text-xs text-gray-500">
          <summary className="flex min-h-11 cursor-pointer items-center underline decoration-gray-300 underline-offset-4">지급 안내</summary>
          <p className="max-w-lg pb-2 leading-5">통합 작성에서는 1:1 매칭을 함께 선택해 주세요. 오픈카드만 등록하거나 기존 프로필을 수정하는 경우에는 지급되지 않아요. 등록을 마치면 추가 지원권 5장이 계정당 한 번 지급돼요.</p>
        </details>}
      </div>
      {failed && ready && <p role="status" className="text-xs leading-5 text-gray-600">프로필은 등록됐어요. 지원권 지급만 다시 확인해 주세요.</p>}
    </aside>
  );
}
