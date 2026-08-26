"use client";

import { useState } from "react";
import {
  ONE_ON_ONE_CONTACT_NUDGE_PRESETS,
  type OneOnOneContactNudgePresetKey,
  type OneOnOneContactNudgeSummary,
} from "@/lib/dating-1on1-contact-nudge";

type Props = {
  matchId: string;
  nudge?: OneOnOneContactNudgeSummary | null;
  processing: boolean;
  onSend: (matchId: string, presetKey: OneOnOneContactNudgePresetKey) => void;
};

export default function OneOnOneContactNudge({ matchId, nudge, processing, onSend }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!nudge?.available) return null;
  const hasContent = Boolean(nudge.received_from_other || nudge.sent_by_me || nudge.can_send);
  if (!hasContent) return null;

  return (
    <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-3">
      {nudge.received_from_other ? (
        <div className="rounded-xl bg-white px-3 py-2.5">
          <p className="text-[11px] font-black text-amber-800">상대가 보낸 한마디</p>
          <p className="mt-1 text-sm font-bold leading-6 text-neutral-900">“{nudge.received_from_other.message_text}”</p>
          <p className="mt-2 text-[11px] font-bold leading-5 text-rose-600">
            연락처 교환 후 잠수하거나 상대방에게 불쾌한 언행을 할 경우 제재 대상입니다.
          </p>
        </div>
      ) : null}

      {nudge.sent_by_me ? (
        <div className={nudge.received_from_other ? "mt-2" : ""}>
          <p className="text-xs font-bold text-amber-900">상대에게 한마디를 보냈어요.</p>
          <p className="mt-1 text-xs leading-5 text-amber-800">“{nudge.sent_by_me.message_text}”</p>
          <p className="mt-1 text-[11px] text-amber-700">같은 매칭에서는 한 번만 보낼 수 있어요.</p>
        </div>
      ) : nudge.can_send ? (
        <>
          <div className={nudge.received_from_other ? "mt-2" : ""}>
            <p className="text-xs font-black text-amber-950">연락처 교환 한마디</p>
            <p className="mt-1 text-[11px] leading-5 text-amber-800">
              쌍방 수락 후 48시간이 지났어요. 부담 없는 문구를 한 번 보낼 수 있습니다.
            </p>
            <button
              type="button"
              onClick={() => setPickerOpen((open) => !open)}
              disabled={processing}
              className="mt-2 inline-flex min-h-[38px] items-center rounded-xl bg-amber-700 px-3 text-xs font-black text-white disabled:opacity-50"
            >
              {processing ? "보내는 중..." : pickerOpen ? "문구 닫기" : "한마디 보내기"}
            </button>
          </div>
          {pickerOpen ? (
            <div className="mt-3 space-y-2 border-t border-amber-200 pt-3">
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
                  className="block min-h-[42px] w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-left text-xs font-bold leading-5 text-neutral-800 hover:bg-amber-50 disabled:opacity-50"
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
