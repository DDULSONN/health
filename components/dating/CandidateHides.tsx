"use client";

import { useEffect, useRef, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";

const endpoint = "/api/dating/1on1/candidate-hides";
const smallButton = "min-h-11 rounded-lg px-2 text-xs text-neutral-500 underline-offset-4 hover:underline disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900";
const errorMessage = (e: unknown, fallback: string) => e instanceof Error && e.name !== "AbortError" ? e.message : fallback;
async function change(body: Record<string, unknown>, signal: AbortSignal) {
  const result = await fetchClientJson<{ ok?: boolean; error?: string }>(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  }, 15000);
  if (!result.response.ok || !result.body?.ok) throw Error(result.body?.error || "처리 결과를 확인하지 못했어요. 숨긴 후보에서 다시 확인해 주세요.");
}

export function CandidateHideButton({ enabled, sourceCardId, candidateId, ticket, disabled, onHidden }: {
  enabled: boolean; sourceCardId: string; candidateId: string; ticket?: string | null;
  disabled?: boolean; onHidden: (candidateId: string) => void;
}) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  if (!enabled) return null;
  return <span className="inline-flex flex-wrap items-center">
    <button type="button" className={smallButton} disabled={disabled || busy} onClick={async () => {
      if (request.current || disabled || !window.confirm("이 후보를 추천 목록에서 숨길까요? 상대에게 알리지 않으며, 기존 요청·매칭은 유지돼요. ‘숨긴 후보’에서 해제할 수 있어요.")) return;
      const controller = new AbortController(); request.current = controller; setBusy(true); setError("");
      try { await change({ action: "hide", sourceCardId, candidateId, ticket }, controller.signal); if (!controller.signal.aborted) onHidden(candidateId); }
      catch (e) { if (!controller.signal.aborted) setError(errorMessage(e, "숨김 결과를 확인하지 못했어요. 숨긴 후보에서 다시 확인해 주세요.")); }
      finally { if (request.current === controller) { request.current = null; setBusy(false); } }
    }}>{busy ? "숨기는 중…" : "숨기기"}</button>
    {error ? <span role="alert" className="basis-full text-xs text-rose-700">{error}</span> : null}
  </span>;
}

type HiddenItem = { id: string; name: string; created_at: string };
export function CandidateHidesPanel({ enabled, revision, onRestored }: { enabled: boolean; revision?: unknown; onRestored: () => Promise<void> }) {
  const [open, setOpen] = useState(false); const [items, setItems] = useState<HiddenItem[] | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [limit, setLimit] = useState(20);
  const request = useRef<AbortController | null>(null);
  useEffect(() => { setItems(null); setOpen(false); setError(""); setBusy(false); setLimit(20); request.current?.abort(); request.current = null; }, [revision]);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  if (!enabled) return null;
  const load = async () => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError("");
    try {
      const result = await fetchClientJson<{ enabled: boolean; items: HiddenItem[]; error?: string }>(endpoint, { cache: "no-store", signal: controller.signal }, 15000);
      if (!result.response.ok || !result.body?.enabled || !Array.isArray(result.body.items) || result.body.items.length > 500 ||
        !result.body.items.every(item => item && typeof item.id === "string" && typeof item.name === "string" && typeof item.created_at === "string")) throw Error(result.body?.error || "숨긴 후보를 불러오지 못했어요.");
      if (!controller.signal.aborted) setItems(result.body.items);
    } catch (e) { if (!controller.signal.aborted) setError(errorMessage(e, "조회가 늦어지고 있어요. 다시 확인해 주세요.")); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  return <div className="mt-2 text-xs text-neutral-500">
    <button type="button" className={smallButton} aria-expanded={open} disabled={busy} onClick={() => { setOpen(!open); if (!open) void load(); }}>숨긴 후보 {open ? "접기" : "보기"}</button>
    {open ? <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <p className="text-[11px] leading-5">내 추천에서만 숨겨져요. 상대에게 알림은 가지 않고, 기존 요청·매칭은 유지돼요. 해제한 후보는 추천 조건에 맞으면 다시 보여요.</p>
      {busy ? <p role="status">확인 중…</p> : null}
      {error ? <p role="alert" className="text-rose-700">{error}<button type="button" className={smallButton} disabled={busy} onClick={() => void load()}>다시 확인</button></p> : null}
      {items?.length === 0 ? <p className="mt-2">숨긴 후보가 없어요.</p> : null}
      {items?.slice(0, limit).map(item => <div key={item.id} className="flex items-center justify-between gap-3 border-b border-neutral-100 py-1">
        <span className="min-w-0 break-all">{item.name}</span>
        <button type="button" className={`${smallButton} shrink-0`} disabled={busy} onClick={async () => {
          if (request.current) return;
          const controller = new AbortController(); request.current = controller; setBusy(true); setError("");
          try { await change({ action: "restore", id: item.id }, controller.signal);
            if (!controller.signal.aborted) { setItems(prev => prev?.filter(row => row.id !== item.id) ?? null); await onRestored(); }
          } catch (e) { if (!controller.signal.aborted) setError(errorMessage(e, "해제 결과를 다시 확인해 주세요.")); }
          finally { if (request.current === controller) { request.current = null; setBusy(false); } }
        }}>숨김 해제</button>
      </div>)}
      {items && items.length > limit ? <button type="button" className={smallButton} onClick={() => setLimit(value => value + 20)}>20명 더 보기</button> : null}
    </div> : null}
  </div>;
}
