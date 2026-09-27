"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { buildOneOnOneRefreshConfirmation, getOneOnOneRefreshCopy, ONE_ON_ONE_REFRESH_POLICY_COPY, type OneOnOneRefreshUsage } from "@/lib/dating-1on1-refresh-copy";

export type OneOnOneRefreshNotice = { sourceCardId: string; kind: "success" | "error"; message: string };
type Confirmation = { message: string; resolve: (confirmed: boolean) => void };

// The dialog only collects consent. The existing parent handler remains responsible for consumption.
export function useOneOnOneRefreshConfirmation() {
  const [request, setRequest] = useState<Confirmation | null>(null);
  const pending = useRef<Confirmation | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const settle = useCallback((current: Confirmation, confirmed: boolean) => {
    if (pending.current !== current) return;
    pending.current = null;
    setRequest(null);
    current.resolve(confirmed);
  }, []);
  const confirmOneOnOneRefresh = useCallback((usage?: OneOnOneRefreshUsage | null) => {
    if (pending.current) return Promise.resolve(false);
    return new Promise<boolean>(resolve => {
      const next = { message: buildOneOnOneRefreshConfirmation(usage), resolve };
      pending.current = next;
      setRequest(next);
    });
  }, []);
  useEffect(() => () => {
    pending.current?.resolve(false);
    pending.current = null;
  }, []);
  useEffect(() => {
    if (!request) return;
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    cancelButton.current?.focus();
    return () => element.close();
  }, [request]);

  const refreshConfirmationDialog = request ? (
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={event => { event.preventDefault(); settle(request, false); }}
      onClose={() => settle(request, false)}
      className="m-auto max-h-[80svh] w-[calc(100%_-_2rem)] max-w-sm overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-5 text-neutral-900 shadow-xl backdrop:bg-black/40">
      <h2 id={titleId} className="text-base font-bold">후보를 새로고침할까요?</h2>
      <p id={descriptionId} className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-neutral-600">{request.message.split("\n").slice(2).join("\n")}</p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button ref={cancelButton} type="button" onClick={() => settle(request, false)} className="min-h-[44px] rounded-xl border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-700">취소</button>
        <button type="button" onClick={() => settle(request, true)} className="min-h-[44px] rounded-xl bg-[#f0003d] px-3 text-sm font-semibold text-white hover:bg-[#d90037]">1회 사용하기</button>
      </div>
    </dialog>
  ) : null;
  return { confirmOneOnOneRefresh, refreshConfirmationDialog };
}

export default function OneOnOneRefreshControl({ usage, busy, blocked = false, notice, onRequest }: {
  usage?: OneOnOneRefreshUsage | null;
  busy: boolean;
  blocked?: boolean;
  notice?: OneOnOneRefreshNotice | null;
  onRequest: () => void;
}) {
  const copy = getOneOnOneRefreshCopy(usage);
  const ready = usage?.can_refresh === true;
  const remaining = typeof usage?.refresh_remaining === "number" && Number.isSafeInteger(usage.refresh_remaining) && usage.refresh_remaining >= 0
    ? usage.refresh_remaining : null;
  return <div className="mt-3 space-y-2">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <button type="button" aria-label={busy ? "새로고침 중..." : copy.button}
        disabled={!ready || busy || blocked} onClick={onRequest}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-neutral-300 bg-white px-3.5 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50">
        <span aria-hidden="true">↻</span>{busy ? "새로고침 중..." : ready ? "후보 새로고침" : copy.button}
      </button>
      {remaining !== null && <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium tabular-nums text-neutral-600">{remaining}회 남음</span>}
    </div>
    {copy.next && <p className="text-xs leading-5 text-neutral-600">{copy.next}</p>}
    <details className="text-xs leading-5 text-neutral-500">
      <summary className="w-fit cursor-pointer py-1 underline decoration-neutral-300 underline-offset-4">새로고침 이용 안내</summary>
      <p className="mt-1">{copy.summary} {ONE_ON_ONE_REFRESH_POLICY_COPY}</p>
    </details>
    {busy ? <p role="status" className="text-xs leading-5 text-neutral-600">새 후보와 남은 횟수를 확인하고 있어요.</p> : notice ? (
      <p role={notice.kind === "error" ? "alert" : "status"} className={`whitespace-pre-wrap break-words rounded-xl border px-3 py-2 text-xs leading-5 ${notice.kind === "error" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-neutral-200 bg-neutral-50 text-neutral-700"}`}>{notice.message}</p>
    ) : null}
  </div>;
}
