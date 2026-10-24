"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ONE_ON_ONE_CONTACT_REPLY_PRESETS, parseOneOnOneContactReply, type OneOnOneContactReply, type OneOnOneContactReplyKey } from "@/lib/dating-1on1-contact-reply";

export default function OneOnOneContactReply({ matchId, nudgeId, reply, canReply }: {
  matchId: string; nudgeId: string; reply?: OneOnOneContactReply | null; canReply: boolean;
}) {
  const pickerId = useId();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<OneOnOneContactReply | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); }, []);
  const currentReply = reply ?? saved;

  async function send(presetKey: OneOnOneContactReplyKey) {
    if (requestRef.current || currentReply || !canReply || unavailable) return;
    const preset = ONE_ON_ONE_CONTACT_REPLY_PRESETS.find(item => item.key === presetKey)!;
    if (!window.confirm(`이 답장을 보낼까요?\n\n${preset.message}\n\n한 번만 보낼 수 있어요. 결제나 매칭 상태는 바뀌지 않아요.`)) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true); setError("");
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(`/api/dating/1on1/matches/${encodeURIComponent(matchId)}/nudge/reply`, {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nudgeId, presetKey }),
      });
      const body = await res.json();
      const result = parseOneOnOneContactReply(body.reply);
      if (!res.ok || body.ok !== true || body.nudgeId !== nudgeId || !result) {
        if ([401, 403, 404, 409].includes(res.status)) setUnavailable(true);
        throw new Error(typeof body.error === "string" ? body.error : "답장을 확인하지 못했어요. 다시 시도해 주세요.");
      }
      setSaved(result); setOpen(false);
    } catch (e) {
      setError(e instanceof Error && e.name !== "AbortError" ? e.message : "전송을 확인하지 못했어요. 다시 시도해도 중복으로 보내지지 않아요.");
    } finally {
      window.clearTimeout(timeout); requestRef.current = null; setPending(false);
    }
  }

  if (currentReply) return <div className="mt-2 border-t border-neutral-200 pt-2" role="status">
    <p className="text-[11px] text-neutral-500">내가 보낸 답장</p>
    <p className="mt-1 text-xs font-medium leading-5 text-neutral-800">{currentReply.message_text}</p>
  </div>;
  if (!canReply) return null;
  return <div className="mt-2">
    <button type="button" disabled={pending || unavailable} aria-expanded={open} aria-controls={pickerId}
      onClick={() => setOpen(value => !value)}
      className="inline-flex min-h-[44px] items-center rounded-lg px-1 text-xs font-medium text-neutral-600 underline decoration-neutral-300 underline-offset-4 hover:text-neutral-900 disabled:opacity-50">
      {pending ? "답장 보내는 중..." : open ? "답장 닫기" : "짧게 답하기"}
    </button>
    {open ? <div id={pickerId} className="mt-2 space-y-2">
      <p className="text-[11px] leading-5 text-neutral-500">답장은 선택이에요. 추가 답장 없이도 연락처를 교환할 수 있어요. 답장은 한 번만 보낼 수 있어요.</p>
      {ONE_ON_ONE_CONTACT_REPLY_PRESETS.map(preset => <button key={preset.key} type="button" disabled={pending || unavailable}
        onClick={() => void send(preset.key)}
        className="block min-h-[44px] w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-xs leading-5 text-neutral-800 hover:bg-neutral-100 disabled:opacity-50">
        {preset.message}
      </button>)}
    </div> : null}
    {error ? <p role="alert" className="mt-2 text-xs leading-5 text-rose-700">{error}</p> : null}
  </div>;
}
