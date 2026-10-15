"use client";

import { useState } from "react";
import {
  ONE_ON_ONE_CONTACT_NUDGE_PRESETS,
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
  compact?: boolean;
};

export function ReceivedContactNudge({ item }: { item: OneOnOneContactNudgeItem }) {
  const senderName = item.sender_display_name?.trim() ?? "";
  return <>
    <p className="text-[11px] font-semibold text-neutral-600">{senderName ? `${senderName}님이 보낸 1:1 한마디` : "상대가 보낸 1:1 한마디"}</p>
    <p className="mt-1 break-words text-sm font-semibold leading-6 text-neutral-900">“{item.message_text}”</p>
    <p className="mt-2 text-[11px] leading-5 text-neutral-500">연락처 교환 후 잠수하거나 상대방에게 불쾌한 언행을 할 경우 제재 대상입니다.</p>
  </>;
}

export default function OneOnOneContactNudge({ matchId, nudge, processing, onSend, hideReceived = false, compact = false }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!nudge?.available) return null;
  const received = !hideReceived ? nudge.received_from_other : null;
  const hasContent = Boolean(received || nudge.sent_by_me || nudge.can_send);
  if (!hasContent) return null;

  return (
    <div className={compact ? "mt-2 border-t border-neutral-100 pt-2" : "mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3"}>
      {received ? (
        <div className="rounded-xl bg-white px-3 py-2.5">
          <ReceivedContactNudge item={received} />
        </div>
      ) : null}

      {nudge.sent_by_me ? (
        <div className={received ? "mt-2" : ""}>
          <p className="text-xs font-semibold text-neutral-800">상대에게 한마디를 보냈어요.</p>
          <p className="mt-1 text-xs leading-5 text-neutral-600">“{nudge.sent_by_me.message_text}”</p>
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
              {processing ? "보내는 중..." : pickerOpen ? "문구 닫기" : "한마디 보내기"}
            </button>
            {compact ? <span className="ml-2 text-[11px] text-neutral-500">선택 · 매칭당 1회</span> : null}
          </div>
          {pickerOpen ? (
            <div className="mt-3 space-y-2 border-t border-neutral-200 pt-3">
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold leading-5 text-rose-700">
                연락처 교환 후 잠수하거나 상대방에게 불쾌한 언행을 할 경우 제재 대상입니다.
              </p>
              {ONE_ON_ONE_CONTACT_NUDGE_PRESETS.map((preset) => (
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
