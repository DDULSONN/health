"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FriendPublicPage } from "@/lib/friend-recommendation";
export default function FriendRecommendationPage({ token }: { token: string }) {
  const [page, setPage] = useState<FriendPublicPage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [profileHref, setProfileHref] = useState("");
  const sequence = useRef(0); const lock = useRef(false);
  const load = useCallback(async () => {
    const current = ++sequence.current; setPage(null); setError("");
    try {
      const response = await fetch(`/api/dating/friend-shares/${token}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const data = await response.json(); if (current !== sequence.current) return;
      if (!response.ok) throw new Error(data.error ?? "추천을 확인하지 못했어요.");
      setPage(data);
    } catch (e) { if (current === sequence.current) setError(e instanceof Error ? e.message : "다시 확인해 주세요."); }
  }, [token]);
  useEffect(() => {
    void load();
    const resume = () => { if (document.visibilityState === "visible") void load(); else { ++sequence.current; setPage(null); } };
    const restore = () => { void load(); };
    document.addEventListener("visibilitychange", resume); window.addEventListener("pageshow", restore);
    return () => { ++sequence.current; document.removeEventListener("visibilitychange", resume); window.removeEventListener("pageshow", restore); };
  }, [load]);
  useEffect(() => {
    if (!page) return;
    const timer = setTimeout(() => { setPage(null); setError("추천 링크가 만료됐어요."); }, Math.max(0, Date.parse(page.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [page]);
  async function request(itemId: string, oneOnOne: boolean) {
    if (lock.current || (oneOnOne && !window.confirm("이 분에게 내 1:1 프로필과 함께 매칭 요청을 보낼까요?"))) return;
    lock.current = true; setBusy(itemId); setError(""); setProfileHref("");
    try {
      const response = await fetch(`/api/dating/friend-shares/${token}/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId, confirm: true }) });
      const result = await response.json();
      if (!response.ok) { setProfileHref(result.profileHref ?? ""); throw new Error(result.error ?? "요청하지 못했어요."); }
      if (result.href) window.location.assign(result.href);
      else { setError("매칭 요청을 보냈어요. 마이페이지에서 확인해 주세요."); }
    } catch (e) { setError(e instanceof Error ? e.message : "잠시 후 다시 시도해 주세요."); }
    finally { lock.current = false; setBusy(null); }
  }
  const back = `/s/${token}`;
  return <main className="mx-auto max-w-lg px-4 pb-28 pt-7 text-neutral-900">
    <p className="text-xs font-medium text-rose-600">친구가 추천한 프로필</p><h1 className="mt-2 text-xl font-semibold">{page?.prompt ?? "너랑 잘 어울릴 것 같아서!"}</h1>
    {error ? <div role="status" className="mt-4 rounded-xl bg-neutral-50 p-4 text-sm leading-6">{error}{profileHref ? <Link className="mt-2 block font-semibold text-rose-600" href={profileHref}>내 프로필 작성하기 →</Link> : null}</div> : null}
    {!page && !error ? <p role="status" className="mt-6 text-sm text-neutral-500">추천을 확인하고 있어요…</p> : null}
    {page?.items.map((item, index) => <article key={item.id} className="mt-5 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
      <div className="grid grid-cols-2 gap-1 bg-neutral-50">{item.photos.map((photo, n) => <img key={`${page.access}:${photo}`} src={photo} alt={item.detail ? `추천 프로필 사진 ${n + 1}` : "인증 후 확인할 수 있는 블러 사진"} referrerPolicy="no-referrer" className="h-52 w-full object-contain" />)}</div>
      <div className="p-4"><h2 className="font-semibold">{item.detail?.name ?? `추천 ${index + 1}`} <span className="font-normal text-neutral-500">· {item.detail ? `${item.detail.age}세` : item.ageBand} · {item.area}</span></h2>
        {item.detail ? <><p className="mt-1 text-sm text-neutral-500">{[item.detail.height ? `${item.detail.height}cm` : "", item.detail.job].filter(Boolean).join(" · ")}</p><p className="mt-3 whitespace-pre-line text-sm leading-6">{[item.detail.intro, item.detail.strengths, item.detail.preference].filter(Boolean).join("\n\n")}</p><button className="mt-4 w-full rounded-xl bg-neutral-900 py-3 text-sm font-semibold text-white disabled:opacity-50" disabled={busy !== null} type="button" onClick={() => request(item.id, item.kind === "one_on_one")}>{busy === item.id ? "확인 중…" : item.kind === "one_on_one" ? "이 분에게 매칭 요청" : "지원서 작성하기"}</button></> : <p className="mt-3 text-sm text-neutral-500">사진과 소개는 가입·휴대폰 인증 후 확인해요.</p>}
      </div>
    </article>)}
    {page && page.access !== "member" ? <section className="mt-5 rounded-2xl bg-rose-50 p-4"><Link className="block rounded-xl bg-rose-600 py-3 text-center text-sm font-semibold text-white" href={page.access === "verify" ? `/phone-verification?next=${encodeURIComponent(back)}` : `/signup?share_return=${encodeURIComponent(back)}`}>{page.access === "verify" ? "휴대폰 인증하고 확인" : "가입하고 프로필 확인"}</Link>{page.access === "guest" ? <Link className="mt-3 block text-center text-xs text-neutral-600" href={`/login?next=${encodeURIComponent(back)}`}>이미 회원이라면 로그인</Link> : null}</section> : null}
    {page ? <p className="mt-4 text-xs leading-5 text-neutral-400">링크는 {new Date(page.expiresAt).toLocaleString("ko-KR")}까지 열려요. 공유 설정이나 회원 상태가 바뀌면 더 일찍 종료될 수 있어요.</p> : <button type="button" className="mt-4 text-sm text-neutral-500 underline" onClick={load}>다시 확인</button>}
    <Link className="mt-5 block text-center text-sm text-neutral-500" href="/community/dating/cards">짐툴 둘러보기</Link>
  </main>;
}
