"use client";

import { useEffect, useRef, useState } from "react";
import { FUNNEL_STAGES, PROFILE_STAGE_EVENTS, isFunnelSummary, type OnboardingEvent, type OnboardingFunnelSummary } from "@/lib/onboarding-funnel";

const eventLabels: Partial<Record<OnboardingEvent, string>> = {
  phone_send_failed: "인증번호 발송 실패", phone_verify_failed: "인증 확인 실패", phone_duplicate: "중복 번호 안내",
  validation_basic: "기본 정보 확인 필요", validation_intro: "소개 확인 필요",
  validation_lifestyle: "생활 정보 확인 필요", validation_photos: "사진 확인 필요", validation_review: "필수 동의 확인 필요",
  photo_rejected: "사진 형식·크기 오류", upload_failed: "사진 처리·업로드 단계 실패", submit_failed: "등록 단계 실패",
};
export default function AdminOnboardingFunnelPanel() {
  const [days, setDays] = useState(7);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OnboardingFunnelSummary | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  useEffect(() => {
    const current = ++sequence.current;
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null); setUnavailable(false);
    void (async () => {
      try {
        const res = await fetch("/api/admin/onboarding-funnel?days=" + days, { cache: "no-store", signal: controller.signal });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || "현황을 불러오지 못했어요.");
        if (current !== sequence.current || controller.signal.aborted) return;
        if (body?.available === false) { setUnavailable(true); return; }
        if (!isFunnelSummary(body?.summary)) throw new Error("통계 응답을 확인하지 못했어요.");
        setData(body.summary);
      } catch (e) {
        if (current === sequence.current && !controller.signal.aborted) setError(e instanceof Error ? e.message : "현황을 불러오지 못했어요.");
      } finally {
        if (current === sequence.current && !controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [days, version]);
  return <section className="mb-4 rounded-2xl border border-violet-200 bg-white p-4" aria-label="가입·작성 전환 현황">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-bold text-neutral-950">가입부터 매칭까지</h3>
        <p className="mt-1 text-xs leading-5 text-neutral-500">선택 기간에 가입한 일반 회원의 현재 진행 상태예요.</p></div>
      <div className="flex flex-wrap gap-2">
        <select aria-label="가입 기간" value={days} onChange={(e) => setDays(Number(e.target.value))}
          className="min-h-10 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-800">
          <option value={1}>오늘 가입</option><option value={7}>최근 7일 가입</option><option value={30}>최근 30일 가입</option>
        </select>
        <button type="button" disabled={loading} onClick={() => setVersion((n) => n + 1)}
          className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm text-neutral-700 disabled:opacity-50">새로고침</button>
      </div>
    </div>
    {loading ? <p className="mt-4 text-sm text-neutral-500" role="status">현황을 불러오고 있어요.</p> : error ?
      <p role="alert" className="mt-4 text-sm text-rose-700">{error} 새로고침으로 다시 확인해 주세요.</p> : unavailable ?
      <div className="mt-4 rounded-xl bg-neutral-50 p-4 text-sm text-neutral-600">통계 저장 설정이 아직 적용되지 않았어요. 관리자용 onboarding_funnel.sql 적용 후 확인할 수 있어요. 기존 가입·매칭 기능에는 영향이 없어요.</div> : data && <>
      <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {FUNNEL_STAGES.map(([key, label], i) => {
          const count = data.counts[key], previous = i ? data.counts[FUNNEL_STAGES[i - 1][0]] : null;
          return <li key={key} className="rounded-xl border border-neutral-100 bg-neutral-50 p-3">
            <p className="text-xs text-neutral-600">{label}</p><p className="mt-1 text-xl font-bold text-neutral-950">{count.toLocaleString("ko-KR")}<span className="ml-1 text-xs font-normal">명</span></p>
            {previous !== null && <p className="mt-1 text-[11px] text-neutral-500">이전 단계 대비 {previous ? Math.round(count / previous * 100) + "%" : "—"}</p>}
          </li>;
        })}
      </ol>
      <p className="mt-3 text-xs leading-5 text-neutral-500">누적 이력이 아닌 현재 저장 상태예요. 프로필 등록은 오픈카드 또는 1:1 중 하나이며, 이후 단계는 1:1 기준이에요. 탈퇴·관리자 계정은 제외해요. 프로필 기록이 삭제되거나 매칭이 취소되면 수치가 줄 수 있어요.</p>
      <div className="mt-4 border-t border-neutral-100 pt-4">
        <h4 className="text-sm font-semibold text-neutral-900">프로필 작성 단계</h4>
        <p className="mt-1 text-xs leading-5 text-neutral-500">각 단계에 들어온 회원 / 그중 아직 프로필이 없는 회원. 임시저장·작성 중일 수 있어 이탈로 단정하지 않아요.</p>
        <ul className="mt-2 space-y-2 text-sm text-neutral-700">{PROFILE_STAGE_EVENTS.map((event, i) =>
          <li key={event} className="flex justify-between gap-2"><span>{["기본 정보", "소개", "생활 정보", "사진", "최종 확인"][i]}</span>
            <span className="shrink-0">{data.events[event] ?? 0}명 / 미등록 {data.unregistered[event] ?? 0}명</span></li>)}</ul>
      </div>
      <details className="mt-4 rounded-xl border border-neutral-200 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-neutral-800">입력·인증 중 막힌 지점</summary>
        <p className="mt-2 text-xs text-neutral-500">횟수가 아닌 해당 안내를 한 번 이상 본 회원 수예요. 여러 항목에 중복될 수 있어요.</p>
        <ul className="mt-3 space-y-2 text-xs text-neutral-700">{Object.entries(eventLabels).map(([key, label]) =>
          <li key={key} className="flex justify-between gap-2"><span>{label}</span><span>{data.events[key as OnboardingEvent] ?? 0}명</span></li>)}</ul>
      </details>
      <p className="mt-3 text-[11px] leading-5 text-neutral-500">화면 기록 수집 시작: {new Date(data.tracking_since).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}. 수집 전·다른 작성 경로·전송 실패 기록은 포함되지 않아요. 입력 내용, 사진, 이메일, 전화번호는 통계에 저장하지 않아요.</p>
      <p className="mt-1 text-[11px] text-neutral-400">조회 기준: {new Date(data.measured_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
    </>}
  </section>;
}
