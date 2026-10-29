"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { friendCandidateReturnPath, friendProfileWriteHref, friendReturnPath, type FriendPublicPage } from "@/lib/friend-recommendation";

const primary = "mt-4 block w-full rounded-xl bg-neutral-900 px-3 py-3 text-center text-sm font-semibold text-white disabled:opacity-50";
type Feedback = { itemId: string; text: string; profileHref?: string; sent?: boolean };

export default function FriendRecommendationPage({ token }: { token: string }) {
  const [page, setPage] = useState<FriendPublicPage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const sequence = useRef(0); const lock = useRef(false);
  const restored = useRef(false);
  const load = useCallback(async () => {
    const current = ++sequence.current; setPage(null); setError("");
    try {
      const response = await fetch(`/api/dating/friend-shares/${token}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const data = await response.json(); if (current !== sequence.current) return;
      if (!response.ok) throw new Error(data.error ?? "추천을 확인하지 못했어요.");
      setPage(data);
    } catch (e) { if (current === sequence.current) setError(e instanceof Error && !(e instanceof TypeError) && e.name !== "TimeoutError" ? e.message : "추천을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요."); }
  }, [token]);
  useEffect(() => {
    restored.current = false; setFeedback(null); void load();
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
  useEffect(() => {
    if (!page || restored.current) return;
    const back = friendReturnPath(window.location.pathname + window.location.hash);
    const anchor = back?.split("#")[1];
    if (!anchor || !page.items.some(item => anchor === `candidate-${item.id}`)) return;
    const frame = requestAnimationFrame(() => {
      const card = document.getElementById(anchor);
      if (card) { card.scrollIntoView({ block: "start" }); card.focus({ preventScroll: true }); restored.current = true; }
    });
    return () => cancelAnimationFrame(frame);
  }, [page]);

  async function request(itemId: string, oneOnOne: boolean) {
    if (lock.current || (oneOnOne && !window.confirm("이 분에게 내 1:1 프로필과 함께 매칭 요청을 보낼까요?"))) return;
    lock.current = true; setBusy(itemId); setFeedback(null);
    try {
      const response = await fetch(`/api/dating/friend-shares/${token}/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId, confirm: true }), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (!response.ok) {
        // The server chooses only the profile-writing route; no external return.
        setFeedback({ itemId, text: result.error ?? "요청하지 못했어요.", ...(result.profileHref ? { profileHref: friendProfileWriteHref(token, itemId) } : {}) });
        return;
      }
      if (result.href) window.location.assign(result.href);
      else setFeedback({ itemId, text: "매칭 요청을 보냈어요.", sent: true });
    } catch {
      // A lost response may already have created a match. Never replay it.
      setFeedback({ itemId, text: "요청 결과를 확인하지 못했어요. 다시 보내기 전에 마이페이지에서 확인해 주세요." });
    } finally { lock.current = false; setBusy(null); }
  }
  return <main className="mx-auto max-w-lg px-4 pb-28 pt-7 text-neutral-900">
    <p className="text-xs font-medium text-neutral-500">친구가 추천한 프로필</p>
    <h1 className="mt-2 text-xl font-semibold">{page?.prompt ?? "너랑 잘 어울릴 것 같아서!"}</h1>
    {page ? <p className="mt-2 text-sm text-neutral-500">마음에 드는 분이 있다면 직접 이야기해 보세요.</p> : null}
    {error ? <div role="status" className="mt-4 rounded-xl bg-neutral-50 p-4 text-sm leading-6">{error}</div> : null}
    {!page && !error ? <p role="status" className="mt-6 text-sm text-neutral-500">추천을 확인하고 있어요…</p> : null}
    {page?.items.map((item, index) => {
      const back = friendCandidateReturnPath(token, item.id);
      const needsProfile = item.kind === "one_on_one" && page.oneOnOneProfile === "needed";
      const current = feedback?.itemId === item.id ? feedback : null;
      return <article key={item.id} id={`candidate-${item.id}`} tabIndex={-1} aria-label={item.detail?.name ?? `추천 ${index + 1}`}
        className="mt-5 scroll-mt-24 overflow-hidden rounded-2xl border border-neutral-200 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-200">
        {item.photos.length ? <div className={`grid ${item.photos.length > 1 ? "grid-cols-2" : "grid-cols-1"} gap-1 bg-neutral-50`}>{item.photos.map((photo, n) => <img key={`${page.access}:${photo}`} src={photo} alt={item.detail ? `추천 프로필 사진 ${n + 1}` : "확실하게 블러 처리된 추천 프로필 사진"} referrerPolicy="no-referrer" className="h-52 w-full object-contain" />)}</div> : null}
        <div className="p-4"><h2 className="font-semibold">{item.detail?.name ?? `추천 ${index + 1}`} <span className="font-normal text-neutral-500">· {item.detail ? `${item.detail.age}세` : item.ageBand} · {item.area}</span></h2>
          {item.detail ? <>
            <p className="mt-1 text-sm text-neutral-500">{[item.detail.height ? `${item.detail.height}cm` : "", item.detail.job].filter(Boolean).join(" · ")}</p>
            <p className="mt-3 whitespace-pre-line text-sm leading-6">{[item.detail.intro, item.detail.strengths, item.detail.preference].filter(Boolean).join("\n\n")}</p>
            {current?.sent ? <Link className={primary} href="/mypage?section=matching">보낸 요청 확인</Link>
              : needsProfile ? <><Link className={primary} href={friendProfileWriteHref(token, item.id)}>내 프로필 작성하고 돌아오기</Link><p className="mt-2 text-center text-xs leading-5 text-neutral-500">작성 후 이 분에게 돌아와요. 요청은 직접 선택해요.</p></>
              : <button className={primary} disabled={busy !== null} type="button" onClick={() => request(item.id, item.kind === "one_on_one")}>{busy === item.id ? "확인 중…" : item.kind === "one_on_one" ? "이 분에게 매칭 요청" : "지원서 작성하기"}</button>}
          </> : <>
            <p className="mt-3 text-sm text-neutral-500">사진과 소개는 가입·휴대폰 인증 후 볼 수 있어요.</p>
            <Link className={primary} href={page.access === "verify" ? `/phone-verification?next=${encodeURIComponent(back)}` : `/signup?share_return=${encodeURIComponent(back)}`}>{page.access === "verify" ? "휴대폰 인증하고 보기" : "가입하고 프로필 보기"}</Link>
            {page.access === "guest" ? <Link className="mt-3 block text-center text-xs text-neutral-500" href={`/login?next=${encodeURIComponent(back)}`}>이미 회원이라면 로그인</Link> : null}
          </>}
          {current ? <div role="status" className="mt-3 rounded-lg bg-neutral-50 p-3 text-xs leading-5 text-neutral-600">{current.text}{current.profileHref ? <Link className="mt-1 block font-semibold underline" href={current.profileHref}>내 프로필 작성하고 돌아오기</Link> : !current.sent ? <Link className="mt-1 block underline" href="/mypage?section=matching">마이페이지 확인</Link> : null}</div> : null}
        </div>
      </article>;
    })}
    {page ? <p className="mt-4 text-xs leading-5 text-neutral-400">추천은 {new Date(page.expiresAt).toLocaleString("ko-KR")}까지 볼 수 있어요. 공유 설정이나 회원 상태가 바뀌면 더 일찍 종료될 수 있어요.</p> : <button type="button" className="mt-4 text-sm text-neutral-500 underline" onClick={load}>다시 확인</button>}
    <Link className="mt-5 block text-center text-sm text-neutral-500" href="/community/dating/cards">짐툴 둘러보기</Link>
  </main>;
}
