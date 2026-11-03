"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { privateChatMessageId, requestPrivateChat, type PrivateChatMessage } from "@/lib/private-contact-chat-client";
import { privateChatUpdated, readPrivateChat } from "@/lib/private-chat-inbox-client";
export default function OneOnOnePrivateChat({ matchId }: { matchId: string }) {
  const [items, setItems] = useState<PrivateChatMessage[]>([]);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const pending = useRef<{ content: string; clientId: string } | null>(null);
  const locked = useRef(false);
  const generation = useRef(0);
  const viewport = useRef<HTMLDivElement | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  const nearBottom = useRef(true);
  const acknowledged = useRef("");
  const load = useCallback(async (signal: AbortSignal) => {
    if (locked.current) return;
    const version = ++generation.current;
    try {
      const body = await requestPrivateChat(matchId, { signal });
      if (signal.aborted || version !== generation.current) return;
      if (!body.response.ok || !body.items) { setItems([]); setLoaded(false); throw new Error(body.error); }
      setItems(body.items); setLoaded(true); setError("");
    } catch (err) { if (!signal.aborted && version === generation.current) setError(err instanceof Error ? err.message : "연결을 확인해 주세요."); }
  }, [matchId]);
  useEffect(() => {
    setItems([]); setLoaded(false); setContent(""); setSending(false); pending.current = null; locked.current = false; generation.current++;
    acknowledged.current = ""; nearBottom.current = true;
    let controller = new AbortController();
    const refresh = () => { if (document.visibilityState === "hidden" || locked.current) return; controller.abort(); controller = new AbortController(); void load(controller.signal); };
    refresh(); const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const invalidate = () => { generation.current += 1; };
    return () => { controller.abort(); invalidate(); window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  useEffect(() => {
    if (viewport.current && nearBottom.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [items]);
  useEffect(() => {
    // Cursor is the last displayed message, including our own reply. Otherwise an
    // older incoming message outside the latest 100 can leave an uncleareable badge.
    const through = items.at(-1)?.id;
    if (!loaded || !through || acknowledged.current === through || !end.current || typeof IntersectionObserver === "undefined") return;
    const controller = new AbortController();
    let visible = false, pendingRead = false;
    const acknowledge = async () => {
      if (!visible || document.visibilityState !== "visible" || pendingRead || controller.signal.aborted) return;
      pendingRead = true;
      try {
        await readPrivateChat(matchId, through, controller.signal);
        if (!controller.signal.aborted) { acknowledged.current = through; privateChatUpdated(); }
      } catch { /* Keep unread on failure; the next successful poll retries acknowledgement. */ }
      finally { pendingRead = false; }
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting); void acknowledge();
    }, { threshold: 1 });
    observer.observe(end.current);
    const onVisible = () => void acknowledge();
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller.abort(); observer.disconnect(); document.removeEventListener("visibilitychange", onVisible); };
  }, [items, loaded, matchId]);
  async function send() {
    const text = content.trim();
    if (!loaded || !text || text.length > 1000 || locked.current) return;
    locked.current = true; setSending(true); generation.current++;
    const version = generation.current;
    try {
      if (pending.current?.content !== text) pending.current = { content: text, clientId: privateChatMessageId() };
      const body = await requestPrivateChat(matchId, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, ...pending.current }) });
      if (version !== generation.current) return;
      if (!body.response.ok || !body.items) { if ([401,409].includes(body.response.status)) { setItems([]); setLoaded(false); } throw new Error(body.error); }
      nearBottom.current = true; setItems(body.items); setContent(""); pending.current = null; setError(""); privateChatUpdated();
    } catch (err) { if (version === generation.current) setError((err instanceof Error ? err.message : "연결을 확인해 주세요.") + " 작성한 내용은 유지돼요. 재시도해도 같은 메시지는 중복 저장하지 않아요."); }
    finally { if (version === generation.current) { locked.current = false; setSending(false); } }
  }
  return <section className="mx-auto max-w-lg rounded-2xl border border-neutral-200 bg-white p-4 text-neutral-900">
    <a href="/chat" className="mb-3 inline-block py-1 text-xs text-neutral-500">‹ 채팅 목록</a>
    <h1 className="text-lg font-bold">1:1 대화</h1>
    <p className="mt-1 text-xs leading-5 text-neutral-500">연락처를 교환한 상대와 나누는 대화예요. 서로 예의를 지켜 주세요.</p>
    <div ref={viewport} onScroll={() => { const box = viewport.current; if (box) nearBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80; }}
      className="my-4 max-h-[55dvh] min-h-64 space-y-3 overflow-y-auto overscroll-contain" aria-label="대화 내역">
      {loaded && !items.length ? <p className="py-16 text-center text-sm text-neutral-400">가볍게 인사를 건네보세요.</p> : null}
      {items.map(item => <div key={item.id} className={`flex ${item.mine ? "justify-end" : "justify-start"}`}>
        <p className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-6 ${item.mine ? "bg-rose-50 text-neutral-900" : "bg-neutral-100"}`}>{item.content}</p>
      </div>)}
      <div ref={end} className="h-px" aria-hidden="true" />
    </div>
    {error ? <p role="alert" className="mb-3 text-xs leading-5 text-red-600">{error} <button type="button" className="underline" onClick={() => void load(new AbortController().signal)}>다시 확인</button></p> : null}
    <form onSubmit={event => { event.preventDefault(); void send(); }} className="flex items-end gap-2">
      <label className="sr-only" htmlFor="private-chat-message">메시지</label>
      <textarea id="private-chat-message" rows={2} maxLength={1000} value={content} disabled={sending} onChange={event => setContent(event.target.value)} placeholder="메시지 보내기"
        className="min-w-0 flex-1 resize-none rounded-xl border border-neutral-200 p-3 text-sm" />
      <button type="submit" disabled={sending || !loaded || !content.trim()} className="min-h-11 rounded-xl bg-[#f0003d] px-4 text-sm font-semibold text-white disabled:opacity-40">{sending ? "전송 중" : "보내기"}</button>
    </form>
    <a className="mt-4 inline-block text-xs text-neutral-500 underline" href="/mypage?section=matching">내 매칭 · 신고 / 연결 관리</a>
  </section>;
}
