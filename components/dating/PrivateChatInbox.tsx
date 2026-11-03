"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";
import type { PrivateChatInboxItem } from "@/lib/private-chat-inbox";
import { parsePrivateChatInbox, PRIVATE_CHAT_UPDATED } from "@/lib/private-chat-inbox-client";

export default function PrivateChatInbox() {
  const [items, setItems] = useState<PrivateChatInboxItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [limit, setLimit] = useState(10);
  const active = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    try {
      const { response, body } = await fetchClientJson("/api/dating/1on1/private-chat/inbox", { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted) return;
      const rows = parsePrivateChatInbox(body);
      if (!response.ok || !rows) throw new Error("목록을 불러오지 못했어요. 다시 확인해 주세요.");
      setItems(rows); setLoaded(true); setError("");
    } catch {
      if (!controller.signal.aborted) { setItems([]); setError("1:1 대화 목록을 불러오지 못했어요."); }
    }
  }, []);
  useEffect(() => {
    void load(); const timer = window.setInterval(() => void load(), 30000);
    const refresh = () => void load();
    window.addEventListener("focus", refresh); window.addEventListener(PRIVATE_CHAT_UPDATED, refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { active.current?.abort(); window.clearInterval(timer); window.removeEventListener("focus", refresh);
      window.removeEventListener(PRIVATE_CHAT_UPDATED, refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  if (loaded && !items.length && !error) return null;
  return <section aria-label="1:1 대화 목록" className="rounded-2xl border border-neutral-200 bg-white p-4 text-neutral-900">
    <div className="flex items-center justify-between"><h2 className="font-bold">1:1 대화</h2>
      <button type="button" onClick={() => void load()} className="rounded-lg px-2 py-2 text-xs text-neutral-500">새로고침</button></div>
    {!loaded && !error ? <p className="py-3 text-xs text-neutral-500">대화를 불러오고 있어요.</p> : null}
    {error ? <p role="alert" className="py-3 text-xs text-red-600">{error} <button type="button" onClick={() => void load()} className="underline">다시 확인</button></p> : null}
    <div className="mt-1 space-y-1">{items.slice(0, limit).map(item => <Link key={item.match_id} href={`/chat/one-on-one/${item.match_id}`} prefetch={false}
      className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-neutral-50">
      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-sm font-semibold text-rose-600">1:1</span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{item.peer_name}</span>
        <span className="mt-1 block truncate text-xs text-neutral-500">{item.last_message || "연결된 상대와 인사를 나눠보세요."}</span></span>
      {item.unread_count > 0 ? <span aria-label={`읽지 않은 메시지 ${item.unread_count}개`} className="rounded-full bg-[#f0003d] px-2 py-0.5 text-xs font-semibold text-white">{item.unread_count > 99 ? "99+" : item.unread_count}</span> : null}
    </Link>)}</div>
    {items.length > limit ? <button type="button" onClick={() => setLimit(value => value + 10)} className="mt-2 w-full rounded-xl border border-neutral-200 py-2 text-xs">대화 더 보기</button> : null}
  </section>;
}
