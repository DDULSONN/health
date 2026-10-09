"use client";

import { useEffect, useRef, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";
import DatingReportButton, { type DatingReportResult } from "@/components/DatingReportButton";
import OneOnOneProfileSummary from "@/components/dating/OneOnOneProfileSummary";

type Candidate = {
  id: string; name: string; age: number | null; region: string; height_cm: number | null; job: string;
  intro_text?: string | null; strengths_text?: string | null; preferred_partner_text?: string | null;
  photo_signed_urls: string[];
};
type Payload = { source_card_id: string; day_key: string; expires_at: string; candidates: Candidate[] };
function validPayload(value: unknown, source: string): value is Payload {
  if (!value || typeof value !== "object") return false;
  const p = value as Payload;
  return p.source_card_id === source && typeof p.day_key === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.day_key) &&
    typeof p.expires_at === "string" && Date.parse(p.expires_at) > Date.now() &&
    Array.isArray(p.candidates) && p.candidates.length <= 3 &&
    new Set(p.candidates.map(c => c?.id)).size === p.candidates.length && p.candidates.every(c => c &&
      typeof c.id === "string" && c.id !== source && typeof c.name === "string" && typeof c.region === "string" && typeof c.job === "string" &&
      (c.age === null || (typeof c.age === "number" && Number.isFinite(c.age))) &&
      (c.height_cm === null || (typeof c.height_cm === "number" && Number.isFinite(c.height_cm))) &&
      Array.isArray(c.photo_signed_urls) && c.photo_signed_urls.every(url => typeof url === "string") &&
      [c.intro_text, c.strengths_text, c.preferred_partner_text].every(text => text == null || typeof text === "string"));
}

export default function OneOnOneExpansionPanel({ enabled, sourceCardId, revision, blocked = false, onSelect, onReported }: {
  enabled: boolean; sourceCardId: string; revision: unknown; blocked?: boolean;
  onSelect: (candidateId: string, name: string) => void | Promise<void>;
  onReported?: (result: DatingReportResult) => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const selectingRef = useRef(false);
  useEffect(() => {
    request.current?.abort(); request.current = null;
    setData(null); setOpen(false); setBusy(false); setError("");
    return () => { request.current?.abort(); request.current = null; };
  }, [sourceCardId, enabled, revision]);
  useEffect(() => {
    if (!data) return;
    const expire = () => { if (Date.now() >= Date.parse(data.expires_at)) { setData(null); setOpen(false); } };
    const timer = window.setTimeout(expire, Math.min(86400000, Math.max(0, Date.parse(data.expires_at) - Date.now())));
    window.addEventListener("focus", expire);
    return () => { window.clearTimeout(timer); window.removeEventListener("focus", expire); };
  }, [data]);
  const openCandidates = async () => {
    if (request.current || blocked || selectingRef.current) return;
    if (open) { setOpen(false); return; }
    // Revalidate on every reopen; a stored daily batch does not bypass new blocks/deletions.
    setData(null); setOpen(true); setBusy(true); setError("");
    const controller = new AbortController(); request.current = controller;
    try {
      const { response, body } = await fetchClientJson<Payload & { error?: string }>("/api/dating/1on1/recommendations/expand", {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_card_id: sourceCardId }),
      }, 30000);
      if (controller.signal.aborted || request.current !== controller) return;
      if (!response.ok || !validPayload(body, sourceCardId)) throw Error(body?.error || "추가 후보 응답을 확인하지 못했어요. 다시 시도해 주세요.");
      setData(body);
    } catch (e) {
      if (!controller.signal.aborted && request.current === controller) setError(e instanceof Error && e.name !== "AbortError" ? e.message : "확인이 늦어지고 있어요. 새로고침 횟수는 사용하지 않았으니 다시 시도해 주세요.");
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  };
  if (!enabled || !sourceCardId) return null;
  return <section className="mt-3 border-t border-neutral-100 pt-3" aria-label="후보 범위 넓히기">
    <button type="button" aria-expanded={open} disabled={busy || blocked || Boolean(selecting)} onClick={() => void openCandidates()}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 disabled:opacity-50">
      {busy ? "후보 확인 중…" : open ? "추가 후보 접기" : "후보 넓혀보기"}<span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    {open && <div className="mt-2">
      <p className="text-[11px] leading-5 text-neutral-500">나이 기준은 그대로, 가까운 활동 후보부터 최대 3명. 부족하면 인접 지역까지 살펴봐요.</p>
      <p className="text-[11px] leading-5 text-neutral-500">오늘 확인한 목록은 유지되며, 새로고침 횟수는 사용하지 않아요.</p>
      {busy && <p role="status" className="mt-2 text-xs text-neutral-500">추가 후보를 확인하고 있어요.</p>}
      {error && <div role="alert" className="mt-2 text-xs leading-5 text-rose-700">{error}<button type="button" className="ml-2 min-h-11 underline" onClick={() => { setOpen(false); setError(""); }}>닫고 다시 시도</button></div>}
      {data?.candidates.length === 0 && <p role="status" className="mt-2 rounded-xl bg-neutral-50 p-3 text-xs leading-5 text-neutral-600">오늘 더 보여드릴 후보가 없어요. 차단·매칭 진행 등으로 확인 가능한 후보가 줄어들 수 있어요.</p>}
      <div className="mt-2 space-y-3">{data?.candidates.map(candidate => <article key={candidate.id} className="min-w-0 break-words rounded-xl border border-neutral-200 bg-white p-3">
        <p className="text-sm font-semibold text-neutral-900">{candidate.name} / {candidate.age ?? "-"}세 / {candidate.region}</p>
        <p className="mt-1 text-xs text-neutral-500">{candidate.height_cm ?? "-"}cm / {candidate.job}</p>
        <OneOnOneProfileSummary intro={candidate.intro_text} strengths={candidate.strengths_text} preferredPartner={candidate.preferred_partner_text}>
          <div className="mt-2 grid grid-cols-2 gap-2">{candidate.photo_signed_urls.slice(0, 2).map((url, i) => <a key={i} href={url} target="_blank" rel="noreferrer" className="flex h-24 items-center justify-center overflow-hidden rounded-lg bg-neutral-50">
            {/* Same authorized lightweight images as the existing recommendation response. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`${candidate.name} 후보 사진 ${i + 1}`} loading="lazy" decoding="async" className="max-h-full max-w-full object-contain" />
          </a>)}</div>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" disabled={Boolean(selecting) || blocked} className="min-h-11 flex-1 rounded-xl bg-[#f0003d] px-3 text-xs font-semibold text-white disabled:opacity-50"
              onClick={async () => {
                if (selectingRef.current) return;
                selectingRef.current = true; setSelecting(candidate.id);
                try { await onSelect(candidate.id, candidate.name); setData(null); setOpen(false); }
                catch { setError("요청 결과를 확인하지 못했어요. 진행 중인 매칭을 확인해 주세요."); }
                finally { selectingRef.current = false; setSelecting(null); }
              }}>{selecting === candidate.id ? "요청 확인 중…" : "매칭 요청 보내기"}</button>
            <DatingReportButton targetType="one_on_one_card" targetId={candidate.id} label={candidate.name}
              onReported={result => { setData(null); setOpen(false); onReported?.(result); }} />
          </div>
        </OneOnOneProfileSummary>
      </article>)}</div>
    </div>}
  </section>;
}
