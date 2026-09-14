"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  REACTION_KINDS, REACTION_KIND_LABELS, REACTION_SENTIMENT_LABELS,
  canStartReactionScan, koreanDate, normalizeReactionUrl, reactionErrorMessage,
  type ReactionKind, type PublicReactionReport, type PublicReactionRun,
} from "@/lib/public-reactions";

type Payload = {
  configuration?: { enabled: boolean; hasApiKey: boolean; hasCronSecret: boolean; ready: boolean };
  latestRun?: PublicReactionRun | null;
  history?: PublicReactionRun[];
  result?: (PublicReactionRun & { report: PublicReactionReport }) | null;
  error?: string;
};
function formatDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "아직 없음";
  return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}
const buttonClass = "min-h-10 rounded-lg border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40";

export default function AdminPublicReactionsPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [day, setDay] = useState("");
  const [kind, setKind] = useState<ReactionKind | "all">("all");
  const [page, setPage] = useState(0);
  const scanLock = useRef(false);
  const active = useRef(true);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async (selectedDay = "") => {
    const id = ++requestId.current;
    controller.current?.abort();
    controller.current = new AbortController();
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/public-reactions${selectedDay ? `?day=${encodeURIComponent(selectedDay)}` : ""}`, {
        cache: "no-store", signal: controller.current.signal,
      });
      const payload = await response.json() as Payload;
      if (!active.current || id !== requestId.current) return;
      if (!response.ok) {
        if (payload.configuration) setData((current) => ({ ...current, configuration: payload.configuration }));
        throw new Error(payload.error ?? "외부 반응을 불러오지 못했습니다.");
      }
      setData(payload);
      setPage(0);
    } catch (failure) {
      if (active.current && id === requestId.current) setError(failure instanceof Error ? failure.message : "외부 반응을 불러오지 못했습니다.");
    } finally {
      if (active.current && id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    active.current = true;
    void load();
    return () => { active.current = false; controller.current?.abort(); };
  }, [load]);

  const scan = async () => {
    if (scanLock.current || !data?.configuration?.ready || !canStartReactionScan(data.latestRun ?? null)) return;
    scanLock.current = true;
    setScanning(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/public-reactions", { method: "POST" });
      const payload = await response.json() as { error?: string; skipped?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "검색하지 못했습니다.");
      if (active.current) {
        setNotice(payload.skipped ? "오늘 검색을 이미 완료했거나 진행 중입니다. 저장된 결과를 확인해 주세요." : "검색 결과를 갱신했습니다.");
      }
    } catch (failure) {
      if (active.current) setNotice(failure instanceof Error ? failure.message : "검색하지 못했습니다.");
    } finally {
      scanLock.current = false;
      if (active.current) {
        setScanning(false);
        setDay("");
        await load();
      }
    }
  };

  const report = data?.result?.report;
  const items = report?.items ?? [];
  const filtered = kind === "all" ? items : items.filter((item) => item.kind === kind);
  const reactions = items.filter((item) => item.kind === "reaction");
  const latest = data?.latestRun;
  const isStale = !loading && latest && Date.now() - Date.parse(latest.started_at) > 36 * 60 * 60 * 1000;
  const isInterrupted = latest?.status === "running" && Date.now() - Date.parse(latest.started_at) >= 10 * 60 * 1000;
  const canScan = data?.configuration?.ready && canStartReactionScan(latest ?? null);
  const successfulHistory = (data?.history ?? []).filter((run) => run.status === "success");

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-neutral-900">짐툴 외부 반응</h3>
          <p className="mt-1 text-xs leading-5 text-neutral-500">커뮤니티·블로그·공개 SNS의 짐툴 언급을 모아봐요.</p>
          <p className="mt-1 text-xs text-neutral-500">매일 오전 9시 서버 검색 · 마지막 완료 {formatDate(successfulHistory[0]?.completed_at ?? data?.result?.completed_at)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={loading || scanning} onClick={() => void load(day)}>결과 새로고침</button>
          <button type="button" className={`${buttonClass} border-violet-200 text-violet-800`} disabled={loading || scanning || !canScan} onClick={() => void scan()}>
            {scanning ? "검색 중…" : latest?.status === "success" && latest.run_date === koreanDate() ? "오늘 검색 완료" : "오늘 반응 검색"}
          </button>
        </div>
      </div>

      {data?.configuration && !data.configuration.ready && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          <p className="font-semibold">자동 검색 설정 대기</p>
          <p>배포 환경에서 {!data.configuration.hasApiKey && "검색 API 키 · "}{!data.configuration.hasCronSecret && "예약 실행 키 · "}{!data.configuration.enabled && "자동 검색 활성화"} 설정이 필요해요. 설정 전에는 검색 비용이 발생하지 않아요.</p>
        </div>
      )}
      {(latest?.status === "failed" || isInterrupted || isStale) && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900" role="status">
          {isStale ? "최근 자동 갱신이 확인되지 않았어요. 서버 예약 실행을 확인해 주세요." : isInterrupted ? "최근 검색이 중단된 것으로 보여요. 이전 결과를 유지하고 있어요." : reactionErrorMessage(latest?.error_code)}
          <p className="mt-1">실패한 검색은 10분 뒤 한 번만 재시도할 수 있어요. 하루 최대 2회 시도해요.</p>
        </div>
      )}
      {latest?.status === "running" && !isInterrupted && !scanning && <p className="mt-3 text-xs text-neutral-500" role="status">서버에서 검색 중이에요. 잠시 후 결과 새로고침을 눌러 주세요.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-neutral-700">{notice}</p>}

      <div className="mt-4 grid grid-cols-3 divide-x divide-neutral-200 rounded-lg bg-neutral-50 py-3 text-center">
        <div><p className="text-xs text-neutral-500">이용자 반응</p><p className="mt-1 text-lg font-bold text-neutral-900">{report ? reactions.length : "—"}</p></div>
        <div><p className="text-xs text-neutral-500">불만·혼재</p><p className="mt-1 text-lg font-bold text-neutral-900">{report ? reactions.filter((item) => ["negative", "mixed"].includes(item.sentiment)).length : "—"}</p></div>
        <div><p className="text-xs text-neutral-500">홍보·기타</p><p className="mt-1 text-lg font-bold text-neutral-900">{report ? items.length - reactions.length : "—"}</p></div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <label className="text-xs text-neutral-600">종류
          <select value={kind} onChange={(event) => { setKind(event.target.value as ReactionKind | "all"); setPage(0); }} className="ml-2 min-h-10 rounded-lg border border-neutral-200 bg-white px-2 text-xs text-neutral-800">
            <option value="all">전체</option>
            {REACTION_KINDS.map((value) => <option key={value} value={value}>{REACTION_KIND_LABELS[value]}</option>)}
          </select>
        </label>
        {successfulHistory.length > 0 && <label className="text-xs text-neutral-600">검색일
          <select value={day} disabled={loading || scanning} onChange={(event) => { setDay(event.target.value); void load(event.target.value); }} className="ml-2 min-h-10 rounded-lg border border-neutral-200 bg-white px-2 text-xs text-neutral-800">
            <option value="">최근 완료 결과</option>
            {successfulHistory.map((run) => <option key={run.run_date} value={run.run_date}>{run.run_date}</option>)}
          </select>
        </label>}
      </div>

      <div className="mt-3 space-y-3" aria-busy={loading}>
        {loading ? <p className="py-8 text-center text-sm text-neutral-500">저장된 결과를 불러오는 중…</p> : !report ? (
          <p className="rounded-lg border border-dashed border-neutral-200 px-4 py-8 text-center text-sm text-neutral-500">아직 완료된 검색이 없어요. 설정 후 첫 검색 결과가 여기에 표시돼요.</p>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-200 px-4 py-8 text-center text-sm leading-6 text-neutral-500">{items.length === 0 ? "이번 공개 웹 검색에서 짐툴 관련 외부 글을 확인하지 못했어요. 반응이 전혀 없다는 뜻은 아니에요." : "이 종류에 해당하는 글은 없어요."}</p>
        ) : filtered.slice(page * 10, (page + 1) * 10).map((item) => {
          const url = normalizeReactionUrl(item.url);
          return <article key={item.url} className="rounded-lg border border-neutral-200 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
              <span className="rounded bg-neutral-100 px-2 py-1 font-medium text-neutral-700">{REACTION_KIND_LABELS[item.kind]}</span>
              {item.kind === "reaction" && <span className={item.sentiment === "negative" || item.sentiment === "mixed" ? "text-rose-700" : ""}>{REACTION_SENTIMENT_LABELS[item.sentiment]} · AI 분류</span>}
              {url && <span className="break-all">{new URL(url).hostname}</span>}
            </div>
            <h4 className="mt-2 break-words text-sm font-semibold leading-6 text-neutral-900">{item.title}</h4>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-neutral-600">{item.summary}</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
              <span>게시일 {item.published_date ?? "확인 안 됨"}</span>
              {url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center font-semibold text-violet-700 underline underline-offset-4">원문 보기 ↗</a>}
            </div>
          </article>;
        })}
      </div>
      {!loading && filtered.length > 10 && <nav aria-label="외부 반응 페이지" className="mt-4 flex items-center justify-center gap-3 text-xs text-neutral-500">
        <button type="button" className={buttonClass} disabled={page === 0} onClick={() => setPage((value) => value - 1)}>이전</button>
        <span>{page + 1} / {Math.ceil(filtered.length / 10)}</span>
        <button type="button" className={buttonClass} disabled={(page + 1) * 10 >= filtered.length} onClick={() => setPage((value) => value + 1)}>다음</button>
      </nav>}
      <details className="mt-4 border-t border-neutral-100 pt-3 text-xs leading-5 text-neutral-500">
        <summary className="w-fit cursor-pointer">검색 범위와 주의사항</summary>
        <p className="mt-2">짐툴·helchang.com을 기준으로 최근 30일 공개 글을 우선 찾아요. 비공개 카페·SNS, 검색에 잡히지 않는 글은 빠질 수 있어요. 자체 사이트와 자동 도메인 평가, 동명이인은 제외해요.</p>
        <p className="mt-1">요약·반응 분류는 AI 판단이므로 원문을 확인해 주세요. 게시일 미상 글도 포함될 수 있으며, 이전 검색과 같은 글이 다시 포함될 수 있어요. 검색 결과로 회원에게 자동 제재나 메시지를 보내지 않아요.</p>
        <p className="mt-1">검색 API 사용료가 별도로 발생해요. 회당 최대 검색 3회·AI 요청 2회, 자동 검색은 하루 1회예요. ‘결과 새로고침’은 저장된 데이터만 읽어요.</p>
      </details>
    </div>
  );
}
