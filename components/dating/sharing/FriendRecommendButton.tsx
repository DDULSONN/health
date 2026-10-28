"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FRIEND_PROMPTS, type FriendPrompt, type FriendSelection } from "@/lib/friend-recommendation";

type Choice = FriendSelection & { label: string };
let basket: Choice[] = [];
const empty: Choice[] = [];
const listeners = new Set<() => void>();
function update(next: Choice[]) { basket = next; listeners.forEach(listener => listener()); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
const button = "rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-600 disabled:opacity-50";

export default function FriendRecommendButton({ kind, cardId, ticket, label = "이 프로필" }: Choice) {
  const choices = useSyncExternalStore(subscribe, () => basket, () => empty);
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const key = useRef<string | null>(null);
  const [prompt, setPrompt] = useState<FriendPrompt>("fit");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [path, setPath] = useState("");
  useEffect(() => { key.current = null; setPath(""); }, [choices, prompt]);
  function open() {
    setMessage("");
    if (!basket.some(item => item.kind === kind && item.cardId === cardId)) {
      if (basket.length >= 3) setMessage("최대 3명까지 담을 수 있어요. 아래에서 한 명을 빼 주세요.");
      else update([...basket, { kind, cardId, ticket, label }]);
    }
    dialog.current?.showModal();
  }
  async function create() {
    if (lock.current || !choices.length) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      key.current ??= crypto.randomUUID();
      const response = await fetch("/api/dating/friend-shares", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestKey: key.current, prompt, items: choices.map(({ kind, cardId, ticket }) => ({ kind, cardId, ticket })) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "링크를 만들지 못했어요.");
      setPath(result.path); setMessage("링크를 만들었어요. 24시간 동안 열 수 있어요.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function send() {
    if (!path || lock.current) return;
    lock.current = true; setBusy(true);
    const url = `${window.location.origin}${path}`;
    try {
      if (navigator.share) { await navigator.share({ title: "친구가 추천한 짐툴 프로필", text: FRIEND_PROMPTS[prompt], url }); setMessage("공유 창을 닫았어요. 실제 전송 여부는 이용한 앱에서 확인해 주세요."); }
      else { await navigator.clipboard.writeText(url); setMessage("링크를 복사했어요. 친구에게 보내 주세요."); }
    } catch (error) { setMessage(error instanceof DOMException && error.name === "AbortError" ? "공유를 취소했어요. 링크는 아래에서 다시 보낼 수 있어요." : "아래 링크를 길게 눌러 복사해 주세요."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <>
    <button type="button" className="px-2 py-2 text-xs text-neutral-500 hover:text-rose-600" onClick={open}>친구에게 추천</button>
    <dialog ref={dialog} aria-label="친구에게 추천" onCancel={event => { if (busy) event.preventDefault(); }} className="m-auto w-[calc(100%-32px)] max-w-sm rounded-2xl border border-neutral-200 bg-white p-5 text-neutral-900 shadow-xl backdrop:bg-black/40">
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">친구에게 추천</h2><button className={button} type="button" disabled={busy} onClick={() => dialog.current?.close()} aria-label="친구 추천 닫기">닫기</button></div>
      <p className="mt-2 text-xs leading-5 text-neutral-500">링크는 24시간만 열려요. 자세한 프로필은 가입·휴대폰 인증 후 볼 수 있어요.</p>
      <ul className="my-3 space-y-2">{choices.map(item => <li key={`${item.kind}:${item.cardId}`} className="flex items-center justify-between gap-2 rounded-xl bg-neutral-50 px-3 py-2 text-sm"><span className="truncate">{item.label}</span><button type="button" disabled={busy} className="shrink-0 p-1 text-xs text-neutral-500" onClick={() => update(choices.filter(choice => choice !== item))}>빼기</button></li>)}</ul>
      <label className="text-xs text-neutral-500" htmlFor={`friend-prompt-${cardId}`}>친구에게 한마디</label>
      <select id={`friend-prompt-${cardId}`} value={prompt} disabled={busy} onChange={e => setPrompt(e.target.value as FriendPrompt)} className="mt-1 w-full rounded-xl border border-neutral-200 bg-white p-3 text-sm">{Object.entries(FRIEND_PROMPTS).map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select>
      <div className="mt-3 flex gap-2"><button className={`${button} flex-1`} type="button" disabled={busy} onClick={() => dialog.current?.close()}>더 담기 · {choices.length}/3</button><button className="flex-1 rounded-xl bg-neutral-900 px-3 py-3 text-sm font-semibold text-white disabled:opacity-50" type="button" disabled={busy || !choices.length} onClick={path ? send : create}>{busy ? "잠시만요…" : path ? "친구에게 보내기" : "추천 링크 만들기"}</button></div>
      {path ? <input readOnly value={typeof window === "undefined" ? path : `${window.location.origin}${path}`} aria-label="친구 추천 링크" onFocus={e => e.target.select()} className="mt-3 w-full rounded-lg border border-neutral-200 p-2 text-xs" /> : null}
      <p role="status" className="mt-2 text-xs leading-5 text-neutral-600">{message}</p>
      <p className="mt-2 text-[11px] leading-4 text-neutral-400">공유 기록은 안전한 운영을 위해 관리자에게 표시돼요. 친구의 가입·신청 여부는 공유한 회원에게 알리지 않아요.</p>
    </dialog>
  </>;
}
