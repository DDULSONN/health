"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Item = {
  source_type: "open_card" | "one_on_one"; card_id: string; revision: string;
  state: string; resolution: string; attempts: number; error: string | null;
  payload: { name?: string };
  result: { suspicionLevel: string; summary: string; photoFlags: string[]; textFlags: string[]; flags: string[] } | null;
  current: { displayName: string; previewUrls: string[]; texts: Record<string, string>; status: string } | null;
};
const labels: Record<string, string> = { queued: "검수 대기", running: "검수 중", complete: "검수 완료", failed: "검수 실패", gone: "삭제된 프로필", cleared: "관리자 정상 처리", banned: "밴 처리", deleted: "삭제 처리" };
const fieldLabels: Record<string, string> = { job: "직업", intro: "소개", strengths: "장점", idealType: "선호 상대", preferredPartner: "선호 상대", instagramId: "SNS 항목" };

export default function AdminAutomaticProfileReviewPanel() {
  const [view, setView] = useState("attention");
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const actionInFlight = useRef(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/dating/automatic-review?view=${view}&page=${page}`, { cache: "no-store", signal });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "목록 조회 실패");
      if (signal?.aborted || version !== requestVersion.current) return;
      setItems(data.items); setTotal(data.total); setError("");
    } catch (e) {
      if (!signal?.aborted && version === requestVersion.current) setError(e instanceof Error ? e.message : "목록 조회 실패");
    } finally { if (!signal?.aborted && version === requestVersion.current) setLoading(false); }
  }, [view, page]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => { if (!document.hidden && !actionInFlight.current) void load(controller.signal); }, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [load]);

  async function act(item: Item, action: "clear" | "ban" | "delete" | "retry") {
    if (actionInFlight.current) return;
    const name = item.current?.displayName || item.payload.name || "이 프로필";
    if (action === "ban" && !window.confirm(`${name} 계정을 밴하고 활성 소개팅 카드를 비활성화할까요?`)) return;
    if (action === "delete" && !window.confirm(`${name}의 ${item.source_type === "open_card" ? "오픈카드" : "1대1 프로필"}와 연결된 신청·매칭 내역을 삭제할까요? 계정 자체는 삭제하지 않습니다.`)) return;
    const id = `${item.source_type}:${item.card_id}`;
    actionInFlight.current = true;
    requestVersion.current++;
    setBusy(id); setError("");
    try {
      const r = await fetch("/api/admin/dating/automatic-review", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: item.source_type, cardId: item.card_id, revision: item.revision, action }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "처리 실패");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "처리 실패"); }
    finally { actionInFlight.current = false; setBusy(null); }
  }

  return <section className="space-y-4 rounded-2xl border border-blue-200 bg-blue-50/40 p-4" aria-label="등록 후 자동 검수">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-bold text-blue-950">등록 후 자동 검수</h2><p className="mt-1 text-xs text-neutral-600">통합·개별 등록 모두 오픈카드와 1대1 프로필을 각각 검수합니다. 등록은 허용하며 정상 처리·밴·삭제는 관리자가 직접 결정합니다.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading || busy !== null} className="rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-50">{loading ? "불러오는 중" : "새로고침"}</button>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-sm">목록 <select value={view} onChange={e => { setView(e.target.value); setPage(0); setItems([]); }} disabled={busy !== null} className="ml-2 rounded-lg border bg-white p-2">
        <option value="attention">확인 필요·검수 실패</option><option value="processing">검수 대기·진행</option><option value="clear">AI 이상 없음</option><option value="history">관리자 처리 완료</option>
      </select></label><span className="text-sm text-neutral-600">{total}개</span>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!loading && !error && items.length === 0 && <p className="p-4 text-sm text-neutral-500">이 목록에 해당하는 프로필이 없습니다.</p>}
    {items.map(item => <article key={`${item.source_type}:${item.card_id}`} className="space-y-3 rounded-xl border bg-white p-4">
      <h3 className="font-semibold">{item.current?.displayName || item.payload.name || "삭제된 프로필"} <span className="text-xs font-normal text-neutral-500">{item.source_type === "open_card" ? "오픈카드" : "1대1"} · {labels[item.resolution === "open" ? item.state : item.resolution]}</span></h3>
      {item.error && <p className="text-sm text-red-700">{item.error} (시도 {item.attempts}회)</p>}
      {item.result && <div className="rounded-lg bg-amber-50 p-3 text-sm"><p>{item.result.summary}</p><ul className="mt-2 list-inside list-disc">{item.result.flags.map((flag, i) => <li key={i}>{flag}</li>)}</ul></div>}
      {item.current && <>
        <div className="flex gap-3 overflow-x-auto">{item.current.previewUrls.map((url, i) => <a key={i} href={url} target="_blank" rel="noreferrer" aria-label={`사진 ${i + 1} 확대`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`프로필 사진 ${i + 1}`} loading="lazy" className="h-52 w-40 rounded-lg bg-neutral-100 object-contain" />
        </a>)}</div>
        <details><summary className="cursor-pointer text-sm font-semibold">등록 글 전체 보기</summary><dl className="mt-2 space-y-2 text-sm">{Object.entries(item.current.texts).map(([key, value]) => <div key={key}><dt className="font-semibold">{fieldLabels[key] || key}</dt><dd className="whitespace-pre-wrap break-words text-neutral-700">{value || "(없음)"}</dd></div>)}</dl></details>
      </>}
      {item.resolution === "open" && item.current && <div className="flex flex-wrap gap-2">
        <button disabled={busy !== null || !["complete", "failed"].includes(item.state)} onClick={() => void act(item, "clear")} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-40">정상 처리</button>
        <button disabled={busy !== null} onClick={() => void act(item, "ban")} className="rounded-lg bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-40">계정 밴</button>
        <button disabled={busy !== null} onClick={() => void act(item, "delete")} className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 disabled:opacity-40">프로필 삭제</button>
        <button disabled={busy !== null || ["running", "queued"].includes(item.state)} onClick={() => void act(item, "retry")} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">재검수</button>
      </div>}
    </article>)}
    <div className="flex items-center justify-end gap-3 text-sm"><button disabled={page === 0 || loading || busy !== null} onClick={() => setPage(p => p - 1)} className="disabled:opacity-40">이전</button><span>{page + 1} / {Math.max(1, Math.ceil(total / 20))}</span><button disabled={(page + 1) * 20 >= total || loading || busy !== null} onClick={() => setPage(p => p + 1)} className="disabled:opacity-40">다음</button></div>
  </section>;
}
