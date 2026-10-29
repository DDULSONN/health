"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { friendLinkRemaining, type OwnFriendLink } from "@/lib/friend-recommendation";
import { parseFriendShareSettings, requestFriendShareSettings } from "@/lib/friend-recommendation-client";
type Action = { action: "preference"; enabled: boolean } | { action: "revoke"; id: string };
export default function FriendShareSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [links, setLinks] = useState<OwnFriendLink[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [manualCopy, setManualCopy] = useState<{ id: string; url: string } | null>(null);
  const lock = useRef(false); const sequence = useRef(0); const controller = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    if (lock.current) return;
    const current = ++sequence.current; controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setLoading(true); setMessage(""); setLinks([]); setEnabled(null); setManualCopy(null);
    try {
      const data = parseFriendShareSettings(await requestFriendShareSettings(null, request.signal));
      if (current !== sequence.current) return;
      setEnabled(data.enabled); setLinks(data.links); setNow(Date.now());
    } catch (error) {
      if (current === sequence.current) setMessage(error instanceof Error ? error.message : "다시 확인해 주세요.");
    } finally { if (current === sequence.current) { setLoading(false); controller.current = null; } }
  }, []);
  useEffect(() => {
    void reload();
    const resume = () => { if (document.visibilityState === "visible") { setNow(Date.now()); void reload(); } };
    const timer = setInterval(() => { if (document.visibilityState === "visible") setNow(Date.now()); }, 30_000);
    document.addEventListener("visibilitychange", resume);
    return () => { ++sequence.current; controller.current?.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", resume); };
  }, [reload]);
  async function change(body: Action) {
    if (lock.current) return;
    if (body.action === "revoke" && !window.confirm("이 추천 링크를 종료할까요? 종료하면 이 링크로 다시 볼 수 없어요.")) return;
    lock.current = true; setBusy(true); setMessage("");
    const current = ++sequence.current; controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    try {
      await requestFriendShareSettings(body, request.signal);
      if (current !== sequence.current) return;
      if (body.action === "preference") setEnabled(body.enabled);
      else { setLinks(previous => previous.filter(link => link.id !== body.id)); setManualCopy(null); }
      setMessage(body.action === "preference" ? "반영했어요." : "링크를 종료했어요.");
    } catch (error) {
      if (current === sequence.current) {
        // A lost response may have committed. Require a fresh read before any
        // subsequent mutation instead of guessing or automatically replaying.
        setEnabled(null); setLinks([]); setManualCopy(null);
        setMessage(error instanceof Error ? error.message : "처리 결과를 확인하지 못했어요. 내역 다시 확인을 눌러 주세요.");
      }
    } finally { if (current === sequence.current) { lock.current = false; setBusy(false); setLoading(false); controller.current = null; } }
  }
  async function copy(link: OwnFriendLink) {
    if (busy || loading) return;
    if (Date.parse(link.expires_at) <= Date.now()) { setNow(Date.now()); setMessage("만료된 링크예요. 후보에서 새로 추천해 주세요."); return; }
    const current = sequence.current, url = `${window.location.origin}/s/${link.token}`;
    setMessage(""); setManualCopy(null);
    try { await navigator.clipboard.writeText(url); if (current === sequence.current) setMessage("링크를 복사했어요."); }
    catch { if (current === sequence.current) { setManualCopy({ id: link.id, url }); setMessage("링크를 길게 눌러 복사해 주세요."); } }
  }
  const active = links.filter(link => Date.parse(link.expires_at) > now);
  return <section className="rounded-2xl border border-neutral-200 bg-white p-4">
    <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">친구에게 내 프로필 추천</h3><button type="button" role="switch" aria-label="친구에게 내 프로필 추천" aria-checked={enabled === true} disabled={enabled === null || busy || loading} onClick={() => change({ action: "preference", enabled: !enabled })} className={`rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${enabled ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-500"}`}>{enabled === null ? "확인 중" : enabled ? "ON" : "OFF"}</button></div>
    <p className="mt-2 text-xs leading-5 text-neutral-500">기본은 ON이에요. 비회원에게는 확실하게 블러 처리된 사진·연령대·시도만 보여요. OFF로 바꾸면 기존 링크에서도 내 프로필을 볼 수 없어요.</p>
    <details className="mt-3 text-xs text-neutral-600"><summary className="cursor-pointer py-2">내가 만든 추천 링크 · {loading ? "확인 중" : active.length}</summary>
      <p className="mb-2 text-[11px] leading-5 text-neutral-400">추천 당시의 이름이에요. 친구의 가입·신청 여부는 표시하지 않아요.</p>
      {!loading && !active.length ? <p className="py-3 text-neutral-500">현재 사용 중인 추천 링크가 없어요.</p> : null}
      {active.map(link => <article key={link.id} aria-label={link.candidates.map(item => item.label).join(', ') || '추천 프로필'} className="border-t border-neutral-100 py-3">
        <p className="break-words text-sm font-medium text-neutral-800">{link.candidates.map(item => item.label).join(' · ') || '추천 프로필'}</p>
        <p className="mt-1 text-[11px] leading-5 text-neutral-500"><span className="font-medium text-rose-600">{friendLinkRemaining(link.expires_at, now)}</span><span> · </span><time dateTime={link.expires_at}>{new Date(link.expires_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 종료</time></p>
        <div className="mt-2 flex gap-2"><button disabled={busy || loading} type="button" className="min-h-9 rounded-lg border border-neutral-200 px-3 disabled:opacity-50" onClick={() => void copy(link)}>링크 복사</button><button disabled={busy || loading} type="button" className="min-h-9 rounded-lg px-3 text-neutral-400 hover:text-neutral-700 disabled:opacity-50" onClick={() => void change({ action: "revoke", id: link.id })}>링크 종료</button></div>
        {manualCopy?.id === link.id ? <input readOnly value={manualCopy.url} aria-label="복사할 추천 링크" onFocus={event => event.target.select()} className="mt-2 w-full rounded-lg border border-neutral-200 p-2 text-xs" /> : null}
      </article>)}
      {enabled !== null ? <button type="button" disabled={busy || loading} onClick={() => void reload()} className="mt-1 min-h-9 underline decoration-neutral-300 underline-offset-4 disabled:opacity-50">내역 다시 확인</button> : null}
    </details>
    <p role="status" className="mt-2 text-xs leading-5 text-neutral-500">{message}</p>
    {message && enabled === null ? <button type="button" disabled={busy || loading} onClick={() => void reload()} className="mt-2 text-xs underline disabled:opacity-50">내역 다시 확인</button> : null}
  </section>;
}
