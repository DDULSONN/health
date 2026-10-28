"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FRIEND_PROMPTS, type FriendPrompt, type FriendSelection } from "@/lib/friend-recommendation";
import { FriendLinkRequestError, isFriendLinkCurrent, requestFriendLink, type CreatedFriendLink } from "@/lib/friend-recommendation-client";

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
  const operation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const [prompt, setPrompt] = useState<FriendPrompt>("fit");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [link, setLink] = useState<CreatedFriendLink | null>(null);
  useEffect(() => {
    operation.current++; request.current?.abort(); request.current = null;
    lock.current = false; setBusy(false); key.current = null; setLink(null);
  }, [choices, prompt]);
  useEffect(() => () => { operation.current++; request.current?.abort(); }, []);
  useEffect(() => {
    if (!link) return;
    let timer: ReturnType<typeof setTimeout>;
    function checkExpiry() {
      clearTimeout(timer);
      if (!isFriendLinkCurrent(link)) {
        key.current = null; setLink(null); setMessage("링크가 만료됐어요. 새 링크를 만들어 주세요.");
      } else timer = setTimeout(checkExpiry, Math.min(Date.parse(link!.expiresAt) - Date.now(), 2_147_483_647));
    }
    checkExpiry();
    window.addEventListener("focus", checkExpiry);
    document.addEventListener("visibilitychange", checkExpiry);
    return () => { clearTimeout(timer); window.removeEventListener("focus", checkExpiry); document.removeEventListener("visibilitychange", checkExpiry); };
  }, [link]);
  function close() {
    operation.current++; request.current?.abort(); request.current = null;
    lock.current = false; setBusy(false); dialog.current?.close();
  }
  function open() {
    setMessage("");
    if (link && !isFriendLinkCurrent(link)) {
      key.current = null; setLink(null); setMessage("링크가 만료됐어요. 새 링크를 만들어 주세요.");
    }
    if (!basket.some(item => item.kind === kind && item.cardId === cardId)) {
      if (basket.length >= 3) setMessage("최대 3명까지 담을 수 있어요. 아래에서 한 명을 빼 주세요.");
      else update([...basket, { kind, cardId, ticket, label }]);
    }
    dialog.current?.showModal();
  }
  async function create(renew = false) {
    if (lock.current || !choices.length) return;
    lock.current = true; setBusy(true); setMessage("");
    const attempt = ++operation.current;
    const controller = new AbortController(); request.current = controller;
    try {
      key.current ??= crypto.randomUUID();
      const result = await requestFriendLink({ requestKey: key.current, prompt, items: choices.map(({ kind, cardId, ticket }) => ({ kind, cardId, ticket })) }, controller.signal);
      if (operation.current !== attempt) return;
      setLink(result); setMessage(renew ? "새 링크를 만들었어요. ‘친구에게 보내기’를 눌러 주세요." : "링크를 만들었어요. 친구에게 보내 주세요.");
    } catch (error) {
      if (operation.current !== attempt) return;
      if (error instanceof FriendLinkRequestError && error.status === 410) key.current = null;
      setMessage(error instanceof FriendLinkRequestError ? error.message : "연결을 확인한 뒤 다시 시도해 주세요.");
    } finally { if (operation.current === attempt) { request.current = null; lock.current = false; setBusy(false); } }
  }
  async function send() {
    if (!link || lock.current) return;
    if (!isFriendLinkCurrent(link)) {
      key.current = null; setLink(null); await create(true); return;
    }
    lock.current = true; setBusy(true);
    const attempt = ++operation.current;
    const url = `${window.location.origin}${link.path}`;
    try {
      if (navigator.share) { await navigator.share({ title: "친구가 추천한 짐툴 프로필", text: FRIEND_PROMPTS[prompt], url }); if (operation.current === attempt) setMessage("공유 창을 닫았어요. 실제 전송 여부는 이용한 앱에서 확인해 주세요."); }
      else { await navigator.clipboard.writeText(url); if (operation.current === attempt) setMessage("링크를 복사했어요. 친구에게 보내 주세요."); }
    } catch (error) { if (operation.current === attempt) setMessage(error instanceof DOMException && error.name === "AbortError" ? "공유를 취소했어요. 링크는 아래에서 다시 보낼 수 있어요." : "아래 링크를 길게 눌러 복사해 주세요."); }
    finally { if (operation.current === attempt) { lock.current = false; setBusy(false); } }
  }
  return <>
    <button type="button" className="px-2 py-2 text-xs text-neutral-500 hover:text-rose-600" onClick={open}>친구에게 추천</button>
    <dialog ref={dialog} aria-label="친구에게 추천" onCancel={event => { event.preventDefault(); close(); }} className="m-auto w-[calc(100%-32px)] max-w-sm rounded-2xl border border-neutral-200 bg-white p-5 text-neutral-900 shadow-xl backdrop:bg-black/40">
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">친구에게 추천</h2><button className={button} type="button" onClick={close} aria-label="친구 추천 닫기">닫기</button></div>
      <p className="mt-2 text-xs leading-5 text-neutral-500">링크는 24시간만 열려요. 자세한 프로필은 가입·휴대폰 인증 후 볼 수 있어요.</p>
      <ul className="my-3 space-y-2">{choices.map(item => <li key={`${item.kind}:${item.cardId}`} className="flex items-center justify-between gap-2 rounded-xl bg-neutral-50 px-3 py-2 text-sm"><span className="truncate">{item.label}</span><button type="button" disabled={busy} className="shrink-0 p-1 text-xs text-neutral-500" onClick={() => update(choices.filter(choice => choice !== item))}>빼기</button></li>)}</ul>
      <label className="text-xs text-neutral-500" htmlFor={`friend-prompt-${cardId}`}>친구에게 한마디</label>
      <select id={`friend-prompt-${cardId}`} value={prompt} disabled={busy} onChange={e => setPrompt(e.target.value as FriendPrompt)} className="mt-1 w-full rounded-xl border border-neutral-200 bg-white p-3 text-sm">{Object.entries(FRIEND_PROMPTS).map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select>
      <div className="mt-3 flex gap-2"><button className={`${button} flex-1`} type="button" onClick={close}>더 담기 · {choices.length}/3</button><button className="flex-1 rounded-xl bg-neutral-900 px-3 py-3 text-sm font-semibold text-white disabled:opacity-50" type="button" disabled={busy || !choices.length} onClick={() => { if (link) void send(); else void create(); }}>{busy ? "잠시만요…" : link ? "친구에게 보내기" : "추천 링크 만들기"}</button></div>
      {link ? <input readOnly value={typeof window === "undefined" ? link.path : `${window.location.origin}${link.path}`} aria-label="친구 추천 링크" onFocus={e => e.target.select()} className="mt-3 w-full rounded-lg border border-neutral-200 p-2 text-xs" /> : null}
      <p role="status" className="mt-2 text-xs leading-5 text-neutral-600">{message}</p>
      <p className="mt-2 text-[11px] leading-4 text-neutral-400">공유 기록은 안전한 운영을 위해 관리자에게 표시돼요. 친구의 가입·신청 여부는 공유한 회원에게 알리지 않아요.</p>
    </dialog>
  </>;
}
