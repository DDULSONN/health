"use client";
import { useEffect, useRef, useState } from "react";
import { FRIEND_PROMPTS, type FriendPrompt } from "@/lib/friend-recommendation";
type Row = { id: string; user_id: string | null; nickname: string; prompt: FriendPrompt; created_at: string; expires_at: string; revoked_at: string | null; revoke_reason: string | null; items: { id: string; kind: string; card_id: string; user_id: string; nickname: string }[] };
export default function AdminFriendSharesPanel() {
  const [q, setQ] = useState(""); const [activeQ, setActiveQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]); const [next, setNext] = useState<string | null>(null);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const sequence = useRef(0);
  async function load(search: string, cursor?: string | null) {
    const current = ++sequence.current; setBusy(true); setMessage("");
    try {
      const params = new URLSearchParams({ q: search }); if (cursor) params.set("before", cursor);
      const response = await fetch(`/api/admin/friend-shares?${params}`, { cache: "no-store", signal: AbortSignal.timeout(15000) }); const result = await response.json();
      if (current !== sequence.current) return;
      if (!response.ok) throw new Error(result.error);
      setRows(result.items); setNext(result.next); setActiveQ(search);
    } catch (error) { if (current === sequence.current) { setRows([]); setNext(null); setMessage(error instanceof Error ? error.message : "다시 확인해 주세요."); } }
    finally { if (current === sequence.current) setBusy(false); }
  }
  useEffect(() => { void load(""); return () => { sequence.current++; }; }, []);
  async function revoke(id: string) {
    const note = window.prompt("링크 종료 사유 (2자 이상)"); if (!note || note.trim().length < 2 || busy) return;
    setBusy(true);
    try { const response = await fetch("/api/admin/friend-shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, note }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setRows(previous => previous.map(row => row.id === id ? { ...row, revoked_at: new Date().toISOString(), revoke_reason: note } : row)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "종료하지 못했어요."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3">
    <h3 className="font-semibold">친구 추천 기록</h3><p className="text-xs leading-5 text-neutral-500">누가 어떤 프로필로 링크를 만들었는지 확인해요. 카톡 등 실제 수신자·전송 완료 여부는 수집하지 않아요. 한 번에 20건만 조회해요.</p>
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void load(q); }}><input value={q} onChange={event => setQ(event.target.value)} maxLength={40} placeholder="공유한 회원 닉네임 또는 회원 ID" aria-label="공유한 회원 검색" className="min-w-0 flex-1 rounded-xl border border-neutral-200 p-3 text-sm" /><button disabled={busy} className="rounded-xl bg-neutral-900 px-4 text-sm text-white">조회</button></form>
    <p role="status" className="text-sm text-neutral-500">{busy ? "확인 중…" : message || (!rows.length ? "기록이 없어요." : "")}</p>
    {rows.map(row => <article key={row.id} className="rounded-xl border border-neutral-200 bg-white p-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{row.nickname}</strong><span className="text-xs text-neutral-500">{row.revoked_at ? "종료됨" : Date.parse(row.expires_at) <= Date.now() ? "만료" : "유효 기간 내"}</span></div><p className="mt-1 break-all text-xs text-neutral-400">회원 {row.user_id ?? "탈퇴"}</p><p className="mt-2">{FRIEND_PROMPTS[row.prompt]}</p><ul className="mt-2 space-y-2">{row.items.map(item => <li key={item.id} className="rounded-lg bg-neutral-50 p-2"><p>{item.nickname} · {item.kind === "one_on_one" ? "1:1" : item.kind === "paid_card" ? "대기 없이 등록" : "오픈카드"}</p><p className="break-all text-[11px] text-neutral-400">프로필 {item.card_id}</p></li>)}</ul><p className="mt-2 text-xs text-neutral-500">생성 {new Date(row.created_at).toLocaleString("ko-KR")} · 만료 {new Date(row.expires_at).toLocaleString("ko-KR")}</p>{row.revoked_at ? <p className="mt-1 text-xs text-neutral-500">종료 사유: {row.revoke_reason}</p> : <button className="mt-3 rounded-lg border border-rose-200 px-3 py-2 text-xs text-rose-700 disabled:opacity-50" disabled={busy} type="button" onClick={() => revoke(row.id)}>링크 종료</button>}</article>)}
    {next ? <button type="button" disabled={busy} onClick={() => load(activeQ, next)} className="rounded-xl border border-neutral-200 px-4 py-2 text-sm">다음 20건</button> : null}
  </section>;
}
