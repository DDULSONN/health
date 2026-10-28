"use client";
import { useEffect, useRef, useState } from "react";
type OwnLink = { id: string; token: string; created_at: string; expires_at: string };
export default function FriendShareSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [links, setLinks] = useState<OwnLink[]>([]);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const lock = useRef(false);
  async function load(signal?: AbortSignal) {
    const response = await fetch("/api/dating/friend-shares", { cache: "no-store", signal: signal ?? AbortSignal.timeout(15000) }); const result = await response.json();
    if (!response.ok) throw new Error(result.error); if (!signal?.aborted) { setEnabled(result.enabled); setLinks(result.links); }
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal).catch(error => { if (!controller.signal.aborted) setMessage(error.message); }); return () => controller.abort(); }, []);
  async function change(body: unknown) {
    if (lock.current) return; lock.current = true; setBusy(true); setMessage("");
    try { const response = await fetch("/api/dating/friend-shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); await load(); setMessage("반영했어요."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "다시 시도해 주세요."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="rounded-2xl border border-neutral-200 bg-white p-4">
    <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">친구에게 내 프로필 추천</h3><button type="button" role="switch" aria-checked={enabled === true} disabled={enabled === null || busy} onClick={() => change({ action: "preference", enabled: !enabled })} className={`rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${enabled ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-500"}`}>{enabled === null ? "확인 중" : enabled ? "ON" : "OFF"}</button></div>
    <p className="mt-2 text-xs leading-5 text-neutral-500">기본은 ON이에요. 비회원에게는 블러 사진·연령대·시도만 보여요. OFF로 바꾸면 기존 링크에서도 내 프로필을 볼 수 없어요.</p>
    <details className="mt-3 text-xs text-neutral-600"><summary className="cursor-pointer py-2">내가 만든 추천 링크 · {links.length}</summary><p className="mb-2 text-neutral-400">외부 앱에서 누구에게 보냈는지는 확인하지 않아요.</p>{links.map(link => <div key={link.id} className="flex items-center justify-between gap-2 border-t border-neutral-100 py-2"><span>{new Date(link.created_at).toLocaleString("ko-KR")} 생성</span><button disabled={busy} type="button" className="shrink-0 rounded-lg border border-neutral-200 px-2 py-1" onClick={() => change({ action: "revoke", id: link.id })}>링크 종료</button></div>)}</details>
    <p role="status" className="mt-2 text-xs text-neutral-500">{message}</p>
  </section>;
}
