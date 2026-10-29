"use client";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { FRIEND_PROMPTS, type FriendPrompt, type FriendSelection } from "@/lib/friend-recommendation";
import { FriendLinkRequestError, isFriendLinkCurrent, requestFriendLink, type CreatedFriendLink } from "@/lib/friend-recommendation-client";

type Choice = FriendSelection & { label: string };
type RecommendProps = Choice | { basketOnly: true };
type PreparedLink = { key: string; link: CreatedFriendLink | null };
const MAX_CHOICES_NOTICE = "최대 3명까지 담을 수 있어요. 한 명을 빼고 담아 주세요.";
let basket: Choice[] = [];
const empty: Choice[] = [];
const listeners = new Set<() => void>();
// Share retry keys between the card and basket entry points. This is browser
// memory only; opening either entry always revalidates with the current session.
const preparedLinks = new Map<string, PreparedLink>();
function update(next: Choice[]) { basket = next; listeners.forEach(listener => listener()); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

export function FriendRecommendationBasketButton() {
  return <FriendRecommendButton basketOnly />;
}

export default function FriendRecommendButton(props: RecommendProps) {
  const choice = "basketOnly" in props ? null : props;
  const promptId = useId();
  const choices = useSyncExternalStore(subscribe, () => basket, () => empty);
  const prepared = useRef(preparedLinks);
  const dialog = useRef<HTMLDialogElement>(null);
  const operation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const [opened, setOpened] = useState(false);
  const [prompt, setPrompt] = useState<FriendPrompt>("fit");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [manualCopy, setManualCopy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState<{ fingerprint: string; link: CreatedFriendLink } | null>(null);
  const fingerprint = JSON.stringify([prompt, choices.map(item => [item.kind, item.cardId])]);
  const link = ready?.fingerprint === fingerprint ? ready.link : null;

  useEffect(() => {
    if (!opened || !choices.length) { setReady(null); setBusy(false); return; }
    let entry = prepared.current.get(fingerprint);
    if (!entry) {
      entry = { key: crypto.randomUUID(), link: null };
      prepared.current.set(fingerprint, entry);
      if (prepared.current.size > 20) prepared.current.delete(prepared.current.keys().next().value!);
    }
    if (entry.link && !isFriendLinkCurrent(entry.link)) { entry.key = crypto.randomUUID(); entry.link = null; }
    const current = ++operation.current;
    const controller = new AbortController(); request.current = controller;
    setReady(null); setBusy(true); setManualCopy(false); lock.current = true;
    // Debounce rapid changes without delaying the native share click itself.
    const timer = setTimeout(async () => {
      try {
        const result = await requestFriendLink({ requestKey: entry.key, prompt,
          items: choices.map(({ kind, cardId, ticket }) => ({ kind, cardId, ticket })) }, controller.signal);
        if (operation.current !== current) return;
        entry.link = result; setReady({ fingerprint, link: result });
        setMessage(current => current === MAX_CHOICES_NOTICE ? current : "");
      } catch (error) {
        if (operation.current !== current) return;
        if (error instanceof FriendLinkRequestError && error.status === 410) entry.key = crypto.randomUUID();
        setMessage(error instanceof FriendLinkRequestError ? error.message : "연결을 확인한 뒤 다시 시도해 주세요.");
      } finally {
        if (operation.current === current) { request.current = null; lock.current = false; setBusy(false); }
      }
    }, 250);
    return () => { clearTimeout(timer); ++operation.current; controller.abort(); lock.current = false; };
  }, [opened, fingerprint, choices, prompt, attempt]);

  useEffect(() => {
    if (!opened || !link) return;
    let timer: ReturnType<typeof setTimeout>;
    function checkExpiry() {
      clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      if (!isFriendLinkCurrent(link)) {
        setReady(null); setMessage("링크가 만료되어 새로 준비하고 있어요."); setAttempt(value => value + 1);
      } else timer = setTimeout(checkExpiry, Math.min(Date.parse(link!.expiresAt) - Date.now(), 2_147_483_647));
    }
    checkExpiry(); window.addEventListener("focus", checkExpiry); document.addEventListener("visibilitychange", checkExpiry);
    return () => { clearTimeout(timer); window.removeEventListener("focus", checkExpiry); document.removeEventListener("visibilitychange", checkExpiry); };
  }, [opened, link]);
  useEffect(() => () => { ++operation.current; request.current?.abort(); }, []);

  function close() {
    ++operation.current; request.current?.abort(); request.current = null;
    lock.current = false; setBusy(false); setOpened(false); dialog.current?.close();
  }
  function open() {
    setMessage(""); setManualCopy(false);
    if (choice && !basket.some(item => item.kind === choice.kind && item.cardId === choice.cardId)) {
      if (basket.length >= 3) setMessage(MAX_CHOICES_NOTICE);
      else update([...basket, { ...choice, label: choice.label || "이 프로필" }]);
    }
    setOpened(true); dialog.current?.showModal();
  }
  async function send(copy = false) {
    if (lock.current || !link) return;
    if (!isFriendLinkCurrent(link)) { setReady(null); setAttempt(value => value + 1); return; }
    lock.current = true; setBusy(true); setMessage("");
    const current = ++operation.current;
    const url = `${window.location.origin}${link.path}`;
    try {
      // Direct click -> native share preserves iOS/Android user activation.
      if (!copy && navigator.share) {
        await navigator.share({ title: "친구가 추천한 짐툴 프로필", text: FRIEND_PROMPTS[prompt], url });
        if (operation.current === current) setMessage("전송 여부는 공유한 앱에서 확인해 주세요.");
      } else {
        await navigator.clipboard.writeText(url);
        if (operation.current === current) setMessage("링크를 복사했어요. 친구에게 보내 주세요.");
      }
    } catch (error) {
      if (operation.current !== current) return;
      if (error instanceof DOMException && error.name === "AbortError") setMessage("공유를 취소했어요. 다시 보낼 수 있어요.");
      else { setManualCopy(true); setMessage("아래 링크를 길게 눌러 복사해 주세요."); }
    } finally { if (operation.current === current) { lock.current = false; setBusy(false); } }
  }
  if (!choice && !choices.length && !opened) return null;
  return <>
    {choice ? <button type="button" className="px-2 py-2 text-xs text-neutral-500 hover:text-rose-600" onClick={open}>친구에게 추천</button>
      : choices.length ? <div className="mb-3 flex justify-end"><button type="button" onClick={open}
        aria-label={`친구에게 추천할 담은 후보 ${choices.length}명 보기`} aria-haspopup="dialog"
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900">
        담은 후보 <span className="font-semibold tabular-nums text-rose-600">{choices.length}<span className="font-normal text-neutral-400">/3</span></span>
      </button></div> : null}
    <dialog ref={dialog} aria-label="친구에게 추천" onCancel={event => { event.preventDefault(); close(); }}
      className="mx-auto mb-2 mt-auto max-h-[85dvh] w-[calc(100%-16px)] max-w-sm overflow-y-auto overscroll-contain rounded-2xl border border-neutral-200 bg-white p-4 text-neutral-900 shadow-xl backdrop:bg-black/40 sm:my-auto sm:p-5">
      <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">친구에게 추천</h2><button className="px-2 py-2 text-xs text-neutral-500" type="button" onClick={close} aria-label="친구 추천 닫기">닫기</button></div>
      <ul aria-label="추천할 프로필" className="mt-2 flex flex-wrap gap-2">{choices.map(item => <li key={`${item.kind}:${item.cardId}`} className="flex max-w-full items-center gap-1 rounded-lg bg-neutral-50 pl-3 text-sm"><span className="truncate">{item.label}</span><button type="button" className="shrink-0 px-2 py-2 text-xs text-neutral-500" aria-label={`${item.label} 빼기`} onClick={() => { setMessage(""); update(choices.filter(choice => choice !== item)); }}>×</button></li>)}</ul>
      {!choices.length ? <p className="mt-3 text-sm text-neutral-500">담은 후보가 없어요.</p> : null}
      <label className="mt-3 block text-xs text-neutral-500" htmlFor={promptId}>친구에게 한마디</label>
      <select id={promptId} value={prompt} onChange={e => { setPrompt(e.target.value as FriendPrompt); setMessage(""); }} className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm">{Object.entries(FRIEND_PROMPTS).map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select>
      <div className="mt-4 flex gap-2"><button className="rounded-xl border border-neutral-200 px-3 py-3 text-xs text-neutral-600 disabled:opacity-50" type="button" disabled={busy || !link} onClick={() => void send(true)}>링크 복사</button><button className="flex-1 rounded-xl bg-neutral-900 px-3 py-3 text-sm font-semibold text-white disabled:opacity-50" type="button" disabled={busy || !choices.length} onClick={() => { if (link) void send(); else { setMessage(""); setAttempt(value => value + 1); } }}>{busy ? (link ? "공유 중…" : "링크 준비 중…") : link ? "친구에게 보내기" : "다시 준비하기"}</button></div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-neutral-500"><span>24시간 동안 볼 수 있어요</span><button className="px-2 py-2" type="button" onClick={close}>더 담기 · {choices.length}/3</button></div>
      {manualCopy && link ? <input readOnly value={`${window.location.origin}${link.path}`} aria-label="친구 추천 링크" onFocus={e => e.target.select()} className="mt-2 w-full rounded-lg border border-neutral-200 p-2 text-xs" /> : null}
      <p role="status" className={message ? "mt-2 text-xs leading-5 text-neutral-600" : "sr-only"}>{message}</p>
      <details className="mt-1 text-[11px] leading-5 text-neutral-400"><summary className="cursor-pointer py-1">공유 안내</summary><p>자세한 프로필은 가입·휴대폰 인증 후 볼 수 있어요. 링크는 다른 사람에게 전달될 수 있어요.</p><p>링크 생성 기록은 관리자에게 표시돼요. 친구의 가입·신청 여부는 공유한 회원에게 알리지 않아요.</p></details>
    </dialog>
  </>;
}
