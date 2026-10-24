"use client";

import { useEffect, useRef, useState } from "react";
import OneOnOneContactReply from "@/components/dating/OneOnOneContactReply";
import {
  ONE_ON_ONE_CONTACT_NUDGE_PRESETS,
  ONE_ON_ONE_CONTACT_GREETING_PRESETS,
  type OneOnOneContactNudgePresetKey,
  type OneOnOneContactNudgeSummary,
  type OneOnOneContactNudgeItem,
} from "@/lib/dating-1on1-contact-nudge";

type Props = {
  matchId: string;
  nudge?: OneOnOneContactNudgeSummary | null;
  processing: boolean;
  onSend: (matchId: string, presetKey: OneOnOneContactNudgePresetKey) => void;
  hideReceived?: boolean;
  hideReply?: boolean;
  compact?: boolean;
};

function messageIsVisible(element: HTMLElement) {
  if (document.visibilityState !== "visible" || !element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const visibleWidth = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
  const visibleHeight = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
  if (visibleWidth * visibleHeight < rect.width * rect.height * 0.5) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.visibility !== "visible" || style.display === "none" || Number(style.opacity) === 0) return false;
    if (node instanceof HTMLDetailsElement && !node.open) return false;
  }
  // Do not record text covered by a modal or a fixed header.
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return Boolean(hit && (hit === element || element.contains(hit)));
}

function useNudgeReadReceipt(matchId: string | undefined, item: OneOnOneContactNudgeItem, enabled: boolean) {
  const messageRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const element = messageRef.current;
    if (!enabled || !matchId || !item.id || item.read_at || !element || typeof IntersectionObserver === "undefined") return;
    let disposed = false, visible = false, saved = false, pending = false, attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    const cancel = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    const save = async () => {
      if (disposed || !visible || !messageIsVisible(element) || pending || saved || attempts >= 2) return;
      attempts++;
      pending = true;
      const controller = new AbortController(); request = controller;
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(`/api/dating/1on1/matches/${encodeURIComponent(matchId)}/nudge/read`, {
          method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nudgeId: item.id }),
          signal: controller.signal,
        });
        const body = await res.json();
        saved = res.ok && body.ok === true && body.nudgeId === item.id &&
          typeof body.read_at === "string" && Number.isFinite(Date.parse(body.read_at));
        if ([401, 403, 404, 409].includes(res.status)) attempts = 2;
      } catch { /* Receipt failure must never interrupt matching or checkout. */ }
      finally { clearTimeout(timeout); pending = false; }
    };
    const schedule = () => {
      cancel();
      if (disposed || !visible || pending || saved || attempts >= 2 || !messageIsVisible(element)) return;
      // A fast scroll, initial fetch, collapsed card or background tab is not a read.
      timer = setTimeout(() => { timer = undefined; void save(); }, 1000);
    };
    let observer: IntersectionObserver;
    try {
      observer = new IntersectionObserver(entries => {
        visible = entries.some(entry => entry.target === element && entry.isIntersecting && entry.intersectionRatio >= 0.5);
        schedule();
      }, { threshold: [0, 0.5, 1] });
      observer.observe(element);
    } catch { return; }
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("focus", schedule);
    return () => {
      disposed = true; cancel(); request?.abort(); observer.disconnect();
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("focus", schedule);
    };
  }, [matchId, item.id, item.read_at, enabled]);
  return messageRef;
}

export function ReceivedContactNudge({ item, matchId, canMarkRead = false, canReply = false }: {
  item: OneOnOneContactNudgeItem; matchId?: string; canMarkRead?: boolean; canReply?: boolean;
}) {
  const senderName = item.sender_display_name?.trim() ?? "";
  const messageRef = useNudgeReadReceipt(matchId, item, canMarkRead);
  return <>
    <p className="text-[11px] font-semibold text-neutral-600">{senderName ? `${senderName}님이 보낸 1:1 한마디` : "상대가 보낸 1:1 한마디"}</p>
    <p ref={messageRef} className="mt-1 break-words text-sm font-semibold leading-6 text-neutral-900">“{item.message_text}”</p>
    <p className="mt-2 text-[11px] leading-5 text-neutral-500">연락처 교환 후 잠수하거나 상대방에게 불쾌한 언행을 할 경우 제재 대상입니다.</p>
    {canMarkRead && matchId && item.id ? <p className="mt-1 text-[11px] leading-5 text-neutral-500">이 한마디를 보면 상대에게 ‘확인함’으로 표시돼요.</p> : null}
    {matchId && item.id ? <OneOnOneContactReply key={`${matchId}:${item.id}`} matchId={matchId} nudgeId={item.id} reply={item.reply} canReply={canReply} /> : null}
  </>;
}

export function SentContactNudgeReply({ item }: { item: OneOnOneContactNudgeItem }) {
  if (!item.reply) return null;
  return <div className="mt-2 rounded-lg border-l-2 border-neutral-300 bg-neutral-50 px-3 py-2">
    <p className="text-[11px] font-semibold text-neutral-600">상대의 답장</p>
    <p className="mt-1 text-sm font-semibold leading-6 text-neutral-900">“{item.reply.message_text}”</p>
    <p className="mt-1 text-[11px] leading-5 text-neutral-500">상대가 직접 고른 답장이에요. 결제나 매칭 상태는 바뀌지 않아요.</p>
  </div>;
}

export default function OneOnOneContactNudge({ matchId, nudge, processing, onSend, hideReceived = false, hideReply = false, compact = false }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!nudge?.available) return null;
  const received = !hideReceived ? nudge.received_from_other : null;
  const hasContent = Boolean(received || nudge.sent_by_me || nudge.can_send);
  if (!hasContent) return null;

  return (
    <div className={compact ? "mt-2 border-t border-neutral-100 pt-2" : "mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3"}>
      {received ? (
        <div className="rounded-xl bg-white px-3 py-2.5">
          <ReceivedContactNudge item={received} matchId={matchId} canMarkRead={nudge.read_receipts_available && nudge.can_mark_read} canReply={nudge.replies_available && nudge.can_reply} />
        </div>
      ) : null}

      {nudge.sent_by_me ? (
        <div className={received ? "mt-2" : ""}>
          <p className="text-xs font-semibold text-neutral-800">상대에게 한마디를 보냈어요.</p>
          <p className="mt-1 text-xs leading-5 text-neutral-600">“{nudge.sent_by_me.message_text}”</p>
          {nudge.sent_by_me.reply ? (
            !hideReply ? <SentContactNudgeReply item={nudge.sent_by_me} /> : null
          ) : nudge.read_receipts_available && nudge.sent_by_me.read_at ? (
            <div className="mt-1">
              <p className="text-xs font-medium text-neutral-700">상대가 확인함</p>
              <p className="text-[11px] leading-5 text-neutral-500">
                한마디가 상대 화면에 표시됐어요. 수락·결제 의사를 뜻하지 않아요.
              </p>
            </div>
          ) : null}
          <p className="mt-1 text-[11px] text-neutral-500">같은 매칭에서는 한 번만 보낼 수 있어요.</p>
        </div>
      ) : nudge.can_send ? (
        <>
          <div className={received ? "mt-2" : ""}>
            {!compact ? <p className="text-xs font-semibold text-neutral-900">먼저 한마디 건네볼까요?</p> : null}
            {!compact ? <p className="mt-1 text-[11px] leading-5 text-neutral-500">
              연락처 교환 전에 정해진 문구를 한 번 보낼 수 있어요. 선택 사항이에요.
            </p> : null}
            <button
              type="button"
              onClick={() => setPickerOpen((open) => !open)}
              disabled={processing}
              aria-expanded={pickerOpen}
              className="mt-2 inline-flex min-h-[44px] items-center rounded-lg border border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 disabled:opacity-50"
            >
              {processing ? "보내는 중..." : pickerOpen ? "문구 닫기" : nudge.greetings_available ? "가볍게 인사하기" : "한마디 보내기"}
            </button>
            {compact ? <span className="ml-2 text-[11px] text-neutral-500">선택 · 매칭당 1회</span> : null}
          </div>
          {pickerOpen ? (
            <div className="mt-3 space-y-2 border-t border-neutral-200 pt-3">
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold leading-5 text-rose-700">
                연락처 교환 후 잠수하거나 상대방에게 불쾌한 언행을 할 경우 제재 대상입니다.
              </p>
              {(nudge.greetings_available ? ONE_ON_ONE_CONTACT_GREETING_PRESETS : ONE_ON_ONE_CONTACT_NUDGE_PRESETS).map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  disabled={processing}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `이 문구를 상대에게 보낼까요?\n\n${preset.message}\n\n연락처 교환 후 잠수하거나 상대방에게 불쾌한 언행을 할 경우 제재 대상입니다.`
                      )
                    ) return;
                    setPickerOpen(false);
                    onSend(matchId, preset.key);
                  }}
                  className="block min-h-[44px] w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-left text-xs font-medium leading-5 text-neutral-800 hover:bg-neutral-100 disabled:opacity-50"
                >
                  {preset.message}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
