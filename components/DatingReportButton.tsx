"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DATING_CARD_REPORT_REASON_OPTIONS } from "@/lib/dating-report-reasons";

export type DatingReportTargetType = "open_card" | "open_card_application" | "paid_card_application" | "one_on_one_card" | "one_on_one_match";
export type DatingReportResult = { ok: true; blocked: boolean; message: string };

export default function DatingReportButton({ targetType, targetId, label, onReported }: {
  targetType: DatingReportTargetType;
  targetId: string;
  label: string;
  onReported?: (result: DatingReportResult) => void;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-label={`${label} 신고`}
      className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white px-2.5 text-xs font-medium text-neutral-500 hover:bg-neutral-50">
      신고
    </button>
    {open ? <DatingReportDialog targetType={targetType} targetId={targetId} label={label} onClose={() => setOpen(false)} onReported={onReported} /> : null}
  </>;
}

export function DatingReportDialog({ targetType, targetId, label, onClose, onReported }: {
  targetType: DatingReportTargetType;
  targetId: string;
  label: string;
  onClose: () => void;
  onReported?: (result: DatingReportResult) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const titleId = useId();
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DatingReportResult | null>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    dialogRef.current?.showModal();
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);
  useEffect(() => { if (result) confirmRef.current?.focus(); }, [result]);

  const close = () => {
    if (inFlight.current) return;
    onClose();
    if (result) onReported?.(result);
  };

  const submit = async () => {
    if (inFlight.current || !reason) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(targetType === "open_card" ? "/api/dating/cards/report" : "/api/dating/user-reports", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({
          ...(targetType === "open_card" ? { card_id: targetId } : { target_type: targetType, target_id: targetId }),
          reason_code: reason, detail: detail.trim(),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.ok !== true) {
        throw new Error(body?.message || (body?.error === "forbidden_origin" ? "페이지를 새로 열고 다시 시도해 주세요." : body?.error) || "신고 결과를 확인하지 못했습니다. 다시 시도해 주세요.");
      }
      setResult({ ok: true, blocked: body.blocked === true, message: body.message || "신고가 접수됐습니다." });
    } catch (caught) {
      setError(controller.signal.aborted ? "응답이 지연되어 접수 여부를 확인하지 못했습니다. 다시 시도해도 중복 접수되지 않습니다." : caught instanceof Error ? caught.message : "신고 결과를 확인하지 못했습니다.");
    } finally {
      window.clearTimeout(timeout);
      inFlight.current = false;
      setBusy(false);
    }
  };

  return createPortal(
    <dialog ref={dialogRef} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); close(); }}
      className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-5 text-neutral-900 shadow-xl backdrop:bg-black/50">
      <h2 id={titleId} className="text-lg font-bold">프로필 신고</h2>
      <p className="mt-1 break-words text-sm text-neutral-500">{label}</p>
      {result ? <>
        <p role="status" className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{result.message}</p>
        {!result.blocked ? <button type="button" onClick={() => setResult(null)} className="mt-4 min-h-11 w-full rounded-lg border border-neutral-200 text-sm">차단 다시 시도</button> : null}
        <button ref={confirmRef} type="button" onClick={close} className="mt-3 min-h-11 w-full rounded-lg bg-neutral-900 text-sm font-medium text-white">확인</button>
      </> : <>
        <label className="mt-4 block text-sm font-medium">신고 사유
          <select value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm">
            <option value="">사유를 선택해 주세요</option>
            {DATING_CARD_REPORT_REASON_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
          </select>
        </label>
        <label className="mt-4 block text-sm font-medium">상세 내용 (선택)
          <textarea value={detail} disabled={busy} onChange={(event) => setDetail(event.target.value)} maxLength={500} rows={4}
            placeholder="어떤 일이 있었는지 적어 주세요." className="mt-2 w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
        </label>
        <p className="mt-2 text-xs leading-relaxed text-neutral-500">신고하면 상대 회원도 차단됩니다. 이미 교환한 연락처는 회수되지 않으며, 결제가 자동 취소되지는 않습니다.</p>
        {error ? <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p> : null}
        <div className="sticky -bottom-5 -mx-5 -mb-5 mt-4 flex gap-2 border-t border-neutral-100 bg-white px-5 py-4">
          <button type="button" disabled={busy} onClick={close} className="min-h-11 flex-1 rounded-lg border border-neutral-200 text-sm disabled:opacity-50">닫기</button>
          <button type="button" disabled={busy || !reason} onClick={() => void submit()} className="min-h-11 flex-1 rounded-lg bg-neutral-900 text-sm font-medium text-white disabled:opacity-50">{busy ? "접수 중…" : "신고 접수"}</button>
        </div>
      </>}
    </dialog>, document.body
  );
}
