"use client";

import { useEffect, useRef, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";

/** Uses the existing favorites API. Saving never sends a matching request. */
export default function CandidateFavoriteButton({ sourceCardId, candidateId, favorite, disabled, onUpdated, onBusyChange }: {
  sourceCardId: string;
  candidateId: string;
  favorite: boolean;
  disabled?: boolean;
  onUpdated: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const lock = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function toggle() {
    if (lock.current || disabled || !sourceCardId || !candidateId) return;
    lock.current = true;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      const { response, body } = await fetchClientJson<{ ok?: boolean; favorite?: boolean; error?: string }>("/api/dating/1on1/favorites", {
        method: favorite ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ source_card_id: sourceCardId, candidate_card_id: candidateId }),
      }, 15000);
      if (controller.signal.aborted) return;
      if (!response.ok || body?.ok !== true || body.favorite !== !favorite) {
        throw new Error(body?.error || "찜 상태를 확인하지 못했어요. 목록을 다시 확인해 주세요.");
      }
      onUpdated();
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error && reason.name !== "AbortError" ? reason.message : "연결이 지연됐어요. 목록에서 찜 상태를 다시 확인해 주세요.");
    } finally {
      lock.current = false;
      request.current = null;
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return <div>
    <button type="button" aria-pressed={favorite} disabled={disabled || busy || !sourceCardId || !candidateId}
      onClick={() => void toggle()}
      className="mt-1 inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-rose-500">
      <span aria-hidden="true">{favorite ? "♥" : "♡"}</span> {busy ? "저장 중..." : favorite ? "찜 해제" : "찜하기"}
    </button>
    {error ? <p role="alert" className="text-xs leading-5 text-rose-700">{error}</p> : null}
  </div>;
}
