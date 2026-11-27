"use client";

import { useEffect, useRef, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";
import DatingReportButton, { type DatingReportResult } from "@/components/DatingReportButton";
import OneOnOneProfileSummary from "@/components/dating/OneOnOneProfileSummary";
import CandidateImpression from "@/components/dating/CandidateImpression";
import { CandidateHideButton } from "@/components/dating/CandidateHides";

type Candidate = {
  id: string; name: string; age: number | null; region: string; height_cm: number | null; job: string;
  intro_text?: string | null; strengths_text?: string | null; preferred_partner_text?: string | null;
  photo_signed_urls: string[];
};
type Payload = { source_card_id: string; day_key: string; expires_at: string; candidates: Candidate[]; impression_ticket?: string | null };
type WinterPreview = { source_card_id: string; day_key: string; count: number; repeated: boolean; claimed: boolean };
const expandApi = "/api/dating/1on1/recommendations/expand";
const winterAnchor = "one-on-one-winter-candidates";
const kstDay = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

function validPreview(value: WinterPreview | null, source: string): value is WinterPreview {
  return Boolean(value && value.source_card_id === source && value.day_key === kstDay() &&
    Number.isInteger(value.count) && value.count >= 0 && value.count <= 3 &&
    typeof value.repeated === "boolean" && typeof value.claimed === "boolean");
}
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

export default function OneOnOneExpansionPanel({ enabled, sourceCardId, revision, blocked = false, hidesEnabled = false,
  primary = false, winterEligible = false, onHidden, onSelect, onReported }: {
  enabled: boolean; sourceCardId: string; revision: unknown; blocked?: boolean;
  primary?: boolean; winterEligible?: boolean;
  hidesEnabled?: boolean; onHidden?: (candidateId: string) => void;
  onSelect: (candidateId: string, name: string) => void | Promise<void>;
  onReported?: (result: DatingReportResult) => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [mode, setMode] = useState<"ordinary" | "winter" | null>(null);
  const [preview, setPreview] = useState<WinterPreview | null>(null);
  const [previewRevision, refreshPreview] = useState(0);
  const [watch, setWatch] = useState<{ source: string; enabled: boolean } | null>(null);
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchMessage, setWatchMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const watchRequest = useRef<AbortController | null>(null);
  const winterRef = useRef<HTMLElement | null>(null);
  const followedLink = useRef(false);
  const selectingRef = useRef(false);
  useEffect(() => {
    request.current?.abort(); request.current = null;
    setData(null); setMode(null); setBusy(false); setError("");
    return () => { request.current?.abort(); request.current = null; };
  }, [sourceCardId, enabled, revision]);

  useEffect(() => {
    setPreview(null);
    if (!enabled || !primary || !winterEligible || !sourceCardId) return;
    const controller = new AbortController();
    const refresh = async () => {
      const query = new URLSearchParams({ source_card_id: sourceCardId, mode: "winter" });
      try {
        const { response, body } = await fetchClientJson<WinterPreview>(`${expandApi}?${query}`, {
          credentials: "same-origin", cache: "no-store", signal: controller.signal,
        }, 10000);
        if (!controller.signal.aborted && response.ok && validPreview(body, sourceCardId)) setPreview(body);
      } catch { /* Normal recommendations stay usable if preview is unavailable. */ }
    };
    void refresh();
    const invalidateDay = () => { if (kstDay() !== day) refreshPreview(value => value + 1); };
    const day = kstDay();
    const timer = window.setTimeout(invalidateDay, Date.parse(`${day}T00:00:00+09:00`) + 86400000 - Date.now() + 250);
    window.addEventListener("focus", invalidateDay);
    return () => { controller.abort(); window.clearTimeout(timer); window.removeEventListener("focus", invalidateDay); };
  }, [enabled, primary, winterEligible, sourceCardId, revision, previewRevision]);

  useEffect(() => {
    watchRequest.current?.abort(); watchRequest.current = null;
    setWatch(null); setWatchBusy(false); setWatchMessage(""); followedLink.current = false;
    if (!enabled || !primary || !sourceCardId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ source_card_id: sourceCardId });
    void fetchClientJson<{ enabled?: boolean }>(`${expandApi}/alert?${query}`, {
      credentials: "same-origin", cache: "no-store", signal: controller.signal,
    }).then(({ response, body }) => {
      if (!controller.signal.aborted && !watchRequest.current && response.ok && typeof body?.enabled === "boolean")
        setWatch(previous => previous?.source === sourceCardId ? previous : { source: sourceCardId, enabled: body.enabled! });
    }).catch(() => {});
    return () => { controller.abort(); watchRequest.current?.abort(); watchRequest.current = null; };
  }, [enabled, primary, sourceCardId]);

  useEffect(() => {
    if (!preview?.count || !winterRef.current || followedLink.current || window.location.hash !== `#${winterAnchor}`) return;
    followedLink.current = true;
    winterRef.current.scrollIntoView({ block: "center" });
  }, [preview]);

  useEffect(() => {
    if (!data) return;
    const expire = () => { if (Date.now() >= Date.parse(data.expires_at)) { setData(null); setMode(null); } };
    const timer = window.setTimeout(expire, Math.min(86400000, Math.max(0, Date.parse(data.expires_at) - Date.now())));
    window.addEventListener("focus", expire);
    return () => { window.clearTimeout(timer); window.removeEventListener("focus", expire); };
  }, [data]);
  const openCandidates = async (next: "ordinary" | "winter") => {
    if (request.current || blocked || selectingRef.current) return;
    if (mode === next) { setMode(null); return; }
    // Revalidate on every reopen; a stored daily batch does not bypass new blocks/deletions.
    setData(null); setMode(next); setBusy(true); setError("");
    const controller = new AbortController(); request.current = controller;
    try {
      const { response, body } = await fetchClientJson<Payload & { error?: string; code?: string }>(expandApi, {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_card_id: sourceCardId, ...(next === "winter" ? { mode: next } : {}) }),
      }, 30000);
      if (controller.signal.aborted || request.current !== controller) return;
      if (body?.code === "WINTER_ALREADY_OPENED") { setPreview(null); refreshPreview(value => value + 1); }
      if (!response.ok || !validPayload(body, sourceCardId)) throw Error(body?.error || "추가 후보 응답을 확인하지 못했어요. 다시 시도해 주세요.");
      setPreview(null);
      refreshPreview(value => value + 1);
      setData(body);
    } catch (e) {
      if (!controller.signal.aborted && request.current === controller) setError(e instanceof Error && e.name !== "AbortError" ? e.message : "확인이 늦어지고 있어요. 새로고침 횟수는 사용하지 않았으니 다시 시도해 주세요.");
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  };
  const toggleWatch = async () => {
    if (watch?.source !== sourceCardId || watchRequest.current) return;
    const controller = new AbortController();
    watchRequest.current = controller;
    setWatchBusy(true); setWatchMessage("");
    const enabled = !watch.enabled;
    try {
      const { response, body } = await fetchClientJson<{ enabled?: boolean; error?: string }>(`${expandApi}/alert`, {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_card_id: sourceCardId, enabled }),
      });
      if (controller.signal.aborted || watchRequest.current !== controller) return;
      if (!response.ok || body?.enabled !== enabled) {
        if (response.status === 409) refreshPreview(value => value + 1);
        throw Error(body?.error || "알림 설정을 바꾸지 못했어요. 다시 시도해 주세요.");
      }
      setWatch({ source: sourceCardId, enabled });
      setWatchMessage(enabled ? "앞으로 7일 동안 조건에 맞는 새 후보가 생기면 사이트 알림으로 한 번 알려드려요." : "새 후보 알림을 껐어요.");
    } catch (error) {
      if (!controller.signal.aborted && watchRequest.current === controller)
        setWatchMessage(error instanceof Error && error.name !== "AbortError" ? error.message : "알림 설정이 지연됐어요. 다시 확인해 주세요.");
    } finally {
      if (watchRequest.current === controller) { watchRequest.current = null; setWatchBusy(false); }
    }
  };
  const winterCount = preview?.source_card_id === sourceCardId && !preview.claimed && preview.repeated ? preview.count : 0;
  const watchCurrent = watch?.source === sourceCardId ? watch : null;
  const watchVisible = watchCurrent && (watchCurrent.enabled || (preview?.source_card_id === sourceCardId && preview.repeated && !winterCount));
  const open = mode !== null;
  if (!enabled || !sourceCardId) return null;
  return <section ref={winterRef} id={primary ? winterAnchor : undefined} className="mt-3 scroll-mt-32 border-t border-neutral-100 pt-3" aria-label="후보 범위 넓히기">
    {winterCount > 0 && mode !== "winter" && <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-rose-50/70 px-3 py-2">
      <div>
        <p className="text-[11px] font-semibold text-rose-700">겨울 동네 소개</p>
        <p className="text-sm font-semibold leading-5 text-neutral-900">아직 안 본 근처 후보 {winterCount}명이 있어요</p>
      </div>
      <button type="button" aria-expanded={false} disabled={busy || blocked || Boolean(selecting)} onClick={() => void openCandidates("winter")}
        className="inline-flex min-h-11 items-center rounded-xl bg-white px-3 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 disabled:opacity-50">새 후보 보기</button>
    </div>}
    {watchVisible && <button type="button" aria-pressed={watchCurrent.enabled} disabled={watchBusy || blocked}
      onClick={() => void toggleWatch()}
      className="mr-2 inline-flex min-h-11 items-center rounded-xl px-2 text-xs text-neutral-600 underline underline-offset-4 disabled:opacity-50">
      {watchBusy ? "알림 설정 중…" : watchCurrent.enabled ? "새 후보 알림 끄기" : "새 후보 생기면 알려줘요"}
    </button>}
    {watchMessage && <p className="mb-1 text-xs text-neutral-600" role="status">{watchMessage}</p>}
    <button type="button" aria-expanded={open} disabled={busy || blocked || Boolean(selecting)} onClick={() => void openCandidates(mode ?? "ordinary")}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 disabled:opacity-50">
      {busy ? "후보 확인 중…" : open ? "추가 후보 접기" : "후보 넓혀보기"}<span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    {open && <div className="mt-2">
      <p className="text-[11px] leading-5 text-neutral-500">{mode === "winter" ? "최근 노출 기록을 기준으로, 희망 나이대에 맞는 근처 후보만 보여드려요." : "나이 기준은 그대로, 가까운 활동 후보부터 최대 3명. 부족하면 인접 지역까지 살펴봐요."}</p>
      <p className="text-[11px] leading-5 text-neutral-500">오늘 확인한 목록은 유지되며, 새로고침 횟수는 사용하지 않아요.</p>
      {busy && <p role="status" className="mt-2 text-xs text-neutral-500">추가 후보를 확인하고 있어요.</p>}
      {error && <div role="alert" className="mt-2 text-xs leading-5 text-rose-700">{error}<button type="button" className="ml-2 min-h-11 underline" onClick={() => { setMode(null); setError(""); }}>닫고 다시 시도</button></div>}
      {data?.candidates.length === 0 && <p role="status" className="mt-2 rounded-xl bg-neutral-50 p-3 text-xs leading-5 text-neutral-600">{mode === "winter" ? "지금은 조건에 맞는 새 후보가 없어요. 새로고침 횟수는 그대로예요." : "오늘 더 보여드릴 후보가 없어요. 차단·매칭 진행 등으로 확인 가능한 후보가 줄어들 수 있어요."}</p>}
      <div className="mt-2 space-y-3">{data?.candidates.map(candidate => <CandidateImpression as="article" key={candidate.id} ticket={data.impression_ticket} candidateId={candidate.id} className="min-w-0 break-words rounded-xl border border-neutral-200 bg-white p-3">
        <p className="text-sm font-semibold text-neutral-900">{candidate.name} / {candidate.age ?? "-"}세 / {candidate.region}</p>
        <p className="mt-1 text-xs text-neutral-500">{candidate.height_cm ?? "-"}cm / {candidate.job}</p>
        <OneOnOneProfileSummary intro={candidate.intro_text} strengths={candidate.strengths_text} preferredPartner={candidate.preferred_partner_text}>
          <div className="mt-2 grid grid-cols-2 gap-2">{candidate.photo_signed_urls.slice(0, 2).map((url, i) => <a key={i} href={url} target="_blank" rel="noreferrer" className="flex h-24 items-center justify-center overflow-hidden rounded-lg bg-neutral-50">
            {/* Same authorized lightweight images as the existing recommendation response. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`${candidate.name} 후보 사진 ${i + 1}`} loading="lazy" decoding="async" className="max-h-full max-w-full object-contain" />
          </a>)}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={Boolean(selecting) || blocked} className="min-h-11 flex-1 rounded-xl bg-[#f0003d] px-3 text-xs font-semibold text-white disabled:opacity-50"
              onClick={async () => {
                if (selectingRef.current) return;
                selectingRef.current = true; setSelecting(candidate.id);
                try { await onSelect(candidate.id, candidate.name); setData(null); setMode(null); }
                catch { setError("요청 결과를 확인하지 못했어요. 진행 중인 매칭을 확인해 주세요."); }
                finally { selectingRef.current = false; setSelecting(null); }
              }}>{selecting === candidate.id ? "요청 확인 중…" : "매칭 요청 보내기"}</button>
            <CandidateHideButton enabled={hidesEnabled} sourceCardId={sourceCardId} candidateId={candidate.id}
              ticket={data.impression_ticket} disabled={Boolean(selecting) || blocked}
              onHidden={id => { setData(prev => prev ? { ...prev, candidates: prev.candidates.filter(row => row.id !== id) } : null); onHidden?.(id); }} />
            <DatingReportButton targetType="one_on_one_card" targetId={candidate.id} label={candidate.name}
              onReported={result => { setData(null); setMode(null); onReported?.(result); }} />
          </div>
        </OneOnOneProfileSummary>
      </CandidateImpression>)}</div>
    </div>}
  </section>;
}
