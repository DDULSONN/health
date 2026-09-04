"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import DatingPlusOffers from "@/components/dating/DatingPlusOffers";
import OneOnOneContactNudge from "@/components/dating/OneOnOneContactNudge";
import type {
  OneOnOneContactNudgePresetKey,
  OneOnOneContactNudgeSummary,
} from "@/lib/dating-1on1-contact-nudge";

type OneOnOneCardPreview = {
  id?: string;
  user_id?: string;
  name?: string | null;
  display_nickname?: string | null;
  nickname?: string | null;
  sex?: "male" | "female";
  age?: number | null;
  birth_year?: number | null;
  region?: string | null;
  job?: string | null;
  height_cm?: number | null;
  intro_text?: string | null;
  strengths_text?: string | null;
  preferred_partner_text?: string | null;
  photo_signed_urls?: string[];
  status?: string | null;
};

type OneOnOneRecommendationGroup = {
  source_card_id?: string;
  source_card_status?: string;
  refresh_used?: boolean;
  refresh_used_at?: string | null;
  refresh_used_count?: number;
  refresh_remaining?: number;
  refresh_limit?: number;
  next_refresh_at?: string | null;
  can_refresh?: boolean;
  recommendations?: OneOnOneCardPreview[];
  admin_recommendation_date?: string | null;
  admin_recommendations?: OneOnOneCardPreview[];
  admin_recommendation_limit?: number;
};

type OneOnOneMatchPreview = {
  id: string;
  role?: "source" | "candidate";
  state?: string;
  contact_exchange_status?: string;
  contact_exchange_approved_at?: string | null;
  action_required?: boolean;
  counterparty_card?: OneOnOneCardPreview | null;
  counterparty_phone?: string | null;
  contact_nudge?: OneOnOneContactNudgeSummary | null;
  created_at?: string | null;
};

export type OneOnOneHomeState = {
  status: { canWrite?: boolean; totalApplications?: number; phoneVerified?: boolean; reason?: string | null } | null;
  myCards: OneOnOneCardPreview[];
  matches: OneOnOneMatchPreview[];
  recommendations: OneOnOneRecommendationGroup[];
  plus: { expires_at?: string | null; contact_exchange_included?: boolean } | null;
};

const ONE_ON_ONE_CONTACT_CANCEL_DELAY_MS = 48 * 60 * 60 * 1000;

function canCancelOneOnOneMatchPreview(match: OneOnOneMatchPreview) {
  if (match.state !== "mutual_accepted" && match.state !== "candidate_accepted") return false;
  if (match.contact_exchange_status !== "approved") return true;
  const approvedMs = Date.parse(match.contact_exchange_approved_at ?? "");
  return Number.isFinite(approvedMs) && Date.now() - approvedMs >= ONE_ON_ONE_CONTACT_CANCEL_DELAY_MS;
}

function getOneOnOneDisplayName(card?: OneOnOneCardPreview | null) {
  return card?.name || card?.display_nickname || card?.nickname || "1:1 후보";
}

function getOneOnOneAge(card?: OneOnOneCardPreview | null) {
  if (!card) return null;
  if (typeof card.age === "number" && Number.isFinite(card.age)) return card.age;
  if (typeof card.birth_year === "number" && Number.isFinite(card.birth_year)) {
    const currentYear = new Date().getFullYear();
    return currentYear - card.birth_year + 1;
  }
  return null;
}
function getOneOnOneMeta(card?: OneOnOneCardPreview | null) {
  if (!card) return "후보 정보를 확인 중";
  const age = getOneOnOneAge(card);
  return [age ? `${age}세` : null, card.region, card.height_cm ? `${card.height_cm}cm` : null, card.job].filter(Boolean).join(" · ") || "상세 정보 확인";
}

function oneOnOneStateLabel(state?: string) {
  if (state === "proposed") return "후보 제안";
  if (state === "source_selected") return "내 선택 완료";
  if (state === "candidate_accepted") return "상대 수락";
  if (state === "mutual_accepted") return "쌍방 수락";
  if (state === "candidate_rejected") return "상대 거절";
  if (state === "source_declined") return "내 거절";
  if (state === "source_skipped") return "지원 취소";
  if (state === "admin_canceled") return "관리자 종료";
  return "진행 중";
}

function oneOnOneContactLabel(status?: string) {
  if (status === "approved") return "번호 공개 완료";
  if (status === "paid") return "결제 완료";
  if (status === "payment_pending_admin") return "관리자 확인 중";
  if (status === "awaiting_applicant_payment") return "번호 교환 대기";
  return "번호 교환 전";
}

function buildLoginRedirect(path: string) {
  return `/login?redirect=${encodeURIComponent(path)}`;
}

export default function OneOnOneHomePanel({
  arrivedFromOnboarding,
  viewerLoggedIn,
  loading,
  error,
  data,
  processingMatchIds,
  processingContactIds,
  processingNudgeIds,
  processingAutoKeys,
  refreshingRecommendationIds,
  onMatchAction,
  onContactCheckout,
  onContactNudge,
  onAutoSelect,
  onRefreshRecommendations,
}: {
  arrivedFromOnboarding: boolean;
  viewerLoggedIn: boolean;
  loading: boolean;
  error: string;
  data: OneOnOneHomeState | null;
  processingMatchIds: string[];
  processingContactIds: string[];
  processingNudgeIds: string[];
  processingAutoKeys: string[];
  refreshingRecommendationIds: string[];
  onMatchAction: (
    matchId: string,
    action: "select_candidate" | "source_cancel" | "candidate_accept" | "candidate_reject" | "source_accept" | "source_reject" | "cancel_mutual"
  ) => void;
  onContactCheckout: (matchId: string) => void;
  onContactNudge: (matchId: string, presetKey: OneOnOneContactNudgePresetKey) => void;
  onAutoSelect: (sourceCardId: string, candidateCardId: string) => void;
  onRefreshRecommendations: (sourceCardId: string) => void;
}) {
  const [plusGuideOpen, setPlusGuideOpen] = useState(false);
  const [matchGuideOpen, setMatchGuideOpen] = useState(false);
  const myCards = data?.myCards ?? [];
  const matches = data?.matches ?? [];
  const activeMatches = matches.filter((match) =>
    ["proposed", "source_selected", "candidate_accepted", "mutual_accepted"].includes(String(match.state ?? ""))
  );
  const recommendationGroups = data?.recommendations ?? [];
  const plusActive = Boolean(data?.plus?.expires_at);
  const plusContactExchangeIncluded = data?.plus?.contact_exchange_included === true;
  const recommendationCount = recommendationGroups.reduce(
    (sum, group) => sum + (group.recommendations?.length ?? 0) + (group.admin_recommendations?.length ?? 0),
    0
  );
  const activeCards = myCards.filter((card) => card.status !== "rejected");
  const hasOneOnOneCard = activeCards.length > 0;
  const actionRequiredCount = activeMatches.filter((match) => {
    if (match.action_required) return true;
    return (
      (match.role === "source" && match.state === "candidate_accepted") ||
      match.state === "mutual_accepted" ||
      match.contact_exchange_status === "approved"
    );
  }).length;
  const sortedMatches = [...activeMatches].sort((a, b) => {
    const aImportant = a.action_required || a.state === "candidate_accepted" || a.state === "mutual_accepted" ? 1 : 0;
    const bImportant = b.action_required || b.state === "candidate_accepted" || b.state === "mutual_accepted" ? 1 : 0;
    if (aImportant !== bImportant) return bImportant - aImportant;
    return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  });
  return (
    <section id="one-on-one-candidates" className="mb-5 rounded-2xl border border-rose-100 bg-white p-4 shadow-[0_10px_30px_rgba(190,24,93,0.05)] md:p-6">
      {arrivedFromOnboarding ? (
        <div role="status" className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm font-black text-emerald-900">1:1 신청서 작성 완료</p>
          <p className="mt-1 text-xs font-semibold leading-5 text-emerald-700">
            등록한 정보로 추천 후보를 바로 확인할 수 있어요. 아래에서 마음에 드는 후보를 선택해보세요.
          </p>
        </div>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-rose-50 px-3 py-1 text-xs font-black text-rose-700">1대1 매칭</span>
            <button
              type="button"
              onClick={() => setMatchGuideOpen((open) => !open)}
              aria-expanded={matchGuideOpen}
              className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] font-semibold text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600"
            >
              <span className="grid h-3.5 w-3.5 place-items-center rounded-full border border-neutral-200 bg-white text-[9px] text-neutral-400" aria-hidden>?</span>
              {matchGuideOpen ? "닫기" : "매칭 안내"}
            </button>
          </div>
          <h2 className="mt-3 text-[26px] font-black tracking-tight text-neutral-950">내 후보를 보고 바로 진행하기</h2>
          <p className="mt-2 max-w-2xl text-[15px] leading-7 text-neutral-500">
            프로필 작성, 후보 확인, 수락, 번호 교환까지 이 탭에서 이어서 볼 수 있게 정리했어요.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dating/1on1"
            className="inline-flex min-h-[44px] items-center justify-center rounded-2xl bg-neutral-950 px-4 text-sm font-bold text-white hover:bg-neutral-800"
          >
            1대1 작성
          </Link>
          <Link
            href="/mypage?section=matching"
            className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-neutral-200 bg-white px-4 text-sm font-bold text-neutral-700 hover:bg-neutral-50"
          >
            전체 관리
          </Link>
        </div>
      </div>

      {matchGuideOpen ? (
        <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50/60 px-4 py-3">
          <p className="text-xs font-black text-rose-900">1:1 매칭은 이렇게 진행돼요</p>
          <p className="mt-1.5 text-xs font-medium leading-5 text-rose-800">
            프로필 작성 → 추천 후보 선택 → 상대도 수락하면 쌍방 매칭 → 결제 후 연락처 공개
          </p>
        </div>
      ) : null}

      {viewerLoggedIn && hasOneOnOneCard ? (
        <div className="mt-5 grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-neutral-50 px-3 py-3">
            <p className="text-[11px] font-bold text-neutral-400">내 프로필</p>
            <p className="mt-1 text-lg font-black text-neutral-950">{activeCards.length}개</p>
          </div>
          <div className="rounded-2xl bg-rose-50 px-3 py-3">
            <p className="text-[11px] font-bold text-rose-500">추천 후보</p>
            <p className="mt-1 text-lg font-black text-rose-800">{recommendationCount}명</p>
          </div>
          <div className="rounded-2xl bg-emerald-50 px-3 py-3">
            <p className="text-[11px] font-bold text-emerald-500">확인 필요</p>
            <p className="mt-1 text-lg font-black text-emerald-800">{actionRequiredCount}건</p>
          </div>
        </div>
      ) : null}

      <div className="mt-5">
        {!viewerLoggedIn ? (
          <div className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4">
            <p className="text-sm font-bold text-rose-900">로그인하면 내 1대1 진행 상태를 볼 수 있어요.</p>
            <Link
              href={buildLoginRedirect("/community/dating/cards")}
              className="mt-3 inline-flex min-h-[42px] items-center rounded-xl bg-rose-600 px-4 text-sm font-bold text-white hover:bg-rose-700"
            >
              로그인하기
            </Link>
          </div>
        ) : loading ? (
          <p className="rounded-[24px] bg-neutral-50 p-5 text-sm text-neutral-500">1대1 정보를 불러오는 중...</p>
        ) : error ? (
          <p className="rounded-[24px] border border-rose-100 bg-rose-50 p-5 text-sm font-semibold text-rose-700">{error}</p>
        ) : !hasOneOnOneCard ? (
          <div className="rounded-2xl border border-rose-100 bg-rose-50/60 p-5">
            <p className="text-lg font-black text-rose-950">아직 1대1 프로필이 없어요.</p>
            <p className="mt-2 text-sm leading-6 text-rose-900">
              먼저 신청서를 작성하면 후보 확인과 매칭 진행을 이어갈 수 있어요. 신청은 무료입니다.
            </p>
            <Link
              href="/dating/1on1"
              className="mt-4 inline-flex min-h-[46px] items-center justify-center rounded-xl bg-rose-600 px-5 text-sm font-black text-white hover:bg-rose-700"
            >
              1대1 프로필 작성하기
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <details className="rounded-[24px] border border-neutral-100 bg-neutral-50/70 px-4 py-3">
              <summary className="cursor-pointer select-none text-sm font-black text-neutral-900">내 1대1 프로필 보기</summary>
              <div className="mt-3 space-y-2">
                {activeCards.slice(0, 3).map((card) => (
                  <div key={card.id ?? getOneOnOneDisplayName(card)} className="rounded-2xl bg-white px-3 py-3">
                    <p className="text-sm font-black text-neutral-900">{getOneOnOneDisplayName(card)}</p>
                    <p className="mt-1 text-xs font-semibold text-neutral-500">{getOneOnOneMeta(card)}</p>
                    <span className="mt-2 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                      {card.status === "approved" ? "승인 완료" : card.status === "reviewing" ? "검토 중" : "접수 완료"}
                    </span>
                  </div>
                ))}
                <Link
                  href="/mypage?section=matching"
                  className="inline-flex min-h-[40px] w-full items-center justify-center rounded-2xl border border-neutral-200 bg-white text-sm font-bold text-neutral-700 hover:bg-neutral-100"
                >
                  마이페이지에서 전체 관리
                </Link>
              </div>
            </details>

            <div className="relative overflow-hidden rounded-[22px] border border-amber-300 bg-[#fffaf0] p-4 shadow-[0_10px_30px_rgba(161,111,18,0.14)]">
              <div aria-hidden="true" className="absolute inset-x-10 top-0 h-px bg-amber-200" />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-bold text-amber-800">PLUS</span>
                    <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-black text-amber-900">개편</span>
                    <p className="text-sm font-black text-neutral-950">1:1 매칭 플러스</p>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-neutral-600">
                    {plusContactExchangeIncluded
                      ? "기존 혜택 적용 중 · 번호교환 포함 · 후보 새로고침 하루 2회"
                      : "7일 9,900원부터 · 후보 새로고침 하루 2회 · 프로필 우선 노출"}
                  </p>
                  {!plusContactExchangeIncluded ? (
                    <p className="mt-1 text-[11px] font-semibold text-neutral-500">번호교환은 기존처럼 건별 결제돼요.</p>
                  ) : null}
                  {plusActive && data?.plus?.expires_at ? (
                    <p className="mt-1 text-[11px] font-semibold text-amber-800">
                      {new Date(data.plus.expires_at).toLocaleString("ko-KR")}까지 이용 가능
                    </p>
                  ) : null}
                </div>
                {plusActive ? (
                  <span className="inline-flex h-8 shrink-0 items-center rounded-full border border-amber-300 bg-white px-3 text-xs font-bold text-amber-800 shadow-sm">
                    적용 중
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPlusGuideOpen((open) => !open)}
                    className="h-9 shrink-0 rounded-full bg-[#8a5d0a] px-4 text-xs font-bold text-white shadow-[0_6px_18px_rgba(138,93,10,0.25)] transition hover:bg-[#704a06]"
                  >
                    {plusGuideOpen ? "닫기" : "혜택 보기"}
                  </button>
                )}
              </div>
              {!plusActive && plusGuideOpen ? (
                <div className="relative mt-4 border-t border-amber-200 pt-4">
                  <p className="mb-3 text-xs leading-5 text-neutral-600">짧게 먼저 써보거나, 두 매칭 플러스를 한 번에 시작할 수 있어요.</p>
                  <DatingPlusOffers
                    mode="one_on_one"
                    placement="open_card_one_on_one_panel"
                    oneOnOneCardId={String(activeCards[0]?.id ?? "")}
                  />
                </div>
              ) : null}
            </div>

            <div className="rounded-[26px] border border-black/5 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-base font-black text-neutral-950">진행 중인 매칭</p>
                  <p className="mt-1 text-xs leading-5 text-neutral-500">선택, 수락, 번호교환이 필요한 항목을 먼저 보여드려요.</p>
                </div>
                <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-bold text-neutral-500">{activeMatches.length}건</span>
              </div>
              {activeMatches.length === 0 ? (
                <p className="mt-3 rounded-2xl bg-neutral-50 p-4 text-sm leading-6 text-neutral-500">아직 진행 중인 매칭이 없어요. 아래 추천 후보를 확인해보세요.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {sortedMatches.slice(0, 8).map((match) => (
                    <OneOnOneCandidateCard
                      key={match.id}
                      card={match.counterparty_card}
                      badge={oneOnOneStateLabel(match.state)}
                      badgeClassName={match.action_required || match.state === "mutual_accepted" ? "bg-emerald-100 text-emerald-700" : "bg-white text-neutral-600"}
                      note={oneOnOneContactLabel(match.contact_exchange_status)}
                    >
                      {match.counterparty_phone ? <p className="mt-2 text-sm font-black text-emerald-700">{match.counterparty_phone}</p> : null}
                      <OneOnOneMatchActions
                        match={match}
                        contactExchangeIncluded={plusContactExchangeIncluded}
                        processing={processingMatchIds.includes(match.id)}
                        contactProcessing={processingContactIds.includes(match.id)}
                        nudgeProcessing={processingNudgeIds.includes(match.id)}
                        onMatchAction={onMatchAction}
                        onContactCheckout={onContactCheckout}
                        onContactNudge={onContactNudge}
                      />
                    </OneOnOneCandidateCard>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-rose-100 bg-rose-50/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-black text-rose-950">추천 후보</p>
                  <p className="mt-1 text-xs leading-5 text-rose-700">
                    프로필 기준으로 먼저 보여드리는 후보예요. 최근 24시간 동안 {plusActive ? "2회" : "1회"} 새로 섞을 수 있어요.
                  </p>
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-rose-700">{recommendationCount}명</span>
              </div>

              {recommendationGroups.length === 0 ? (
                <p className="mt-3 rounded-xl bg-white/80 p-4 text-sm leading-6 text-rose-800">현재 보여줄 추천 후보가 없어요. 조건에 맞는 후보가 생기면 여기서 바로 볼 수 있습니다.</p>
              ) : (
                <div className="mt-3 space-y-4">
                  {recommendationGroups.map((group, groupIndex) => {
                    const sourceCardId = String(group.source_card_id ?? "");
                    const sourceCard = activeCards.find((card) => card.id === sourceCardId);
                    const recommendations = group.recommendations ?? [];
                    const adminRecommendations = group.admin_recommendations ?? [];
                    const refreshing = refreshingRecommendationIds.includes(sourceCardId);
                    const canRefresh = Boolean(sourceCardId && group.can_refresh);
                    const refreshRemaining = group.refresh_remaining ?? (canRefresh ? 1 : 0);
                    const refreshLimit = group.refresh_limit ?? (plusActive ? 2 : 1);
                    const nextRefreshLabel = group.next_refresh_at ? new Date(group.next_refresh_at).toLocaleString("ko-KR") : "";

                    return (
                      <div key={sourceCardId || `group-${groupIndex}`} className="rounded-[24px] bg-white p-3 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-black text-neutral-950">
                              {sourceCard ? `${getOneOnOneDisplayName(sourceCard)} 기준 후보` : "추천 후보"}
                            </p>
                            <p className="mt-1 text-[11px] font-semibold text-neutral-500">
                              {canRefresh
                                ? `최근 24시간 ${refreshLimit}회 중 ${refreshRemaining}회 남았어요.`
                                : nextRefreshLabel
                                  ? `다음 새로고침: ${nextRefreshLabel}`
                                  : "추천 상태를 확인 중입니다."}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={!canRefresh || refreshing}
                            onClick={() => onRefreshRecommendations(sourceCardId)}
                            className="inline-flex min-h-[36px] items-center rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-black text-rose-700 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-rose-100"
                          >
                            {refreshing ? "새로고침 중..." : canRefresh ? `후보 새로고침 · ${refreshRemaining}회` : "24시간 이용 완료"}
                          </button>
                        </div>
                        <div className="mt-3 space-y-3">
                          {recommendations.map((candidate) => {
                            const candidateId = String(candidate.id ?? "");
                            const actionKey = `${sourceCardId}:${candidateId}`;
                            const canSelect = Boolean(sourceCardId && candidateId);
                            return (
                              <OneOnOneCandidateCard
                                key={`${sourceCardId}:${candidateId || getOneOnOneDisplayName(candidate)}`}
                                card={candidate}
                                badge="추천"
                                badgeClassName="bg-rose-100 text-rose-700"
                                note="선택하면 상대에게 수락 요청이 전달됩니다."
                              >
                                <button
                                  type="button"
                                  disabled={!canSelect || processingAutoKeys.includes(actionKey)}
                                  onClick={() => onAutoSelect(sourceCardId, candidateId)}
                                  className="mt-3 inline-flex min-h-[40px] w-full items-center justify-center rounded-xl bg-rose-600 px-4 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-rose-700"
                                >
                                  {processingAutoKeys.includes(actionKey) ? "선택 중..." : "이 후보 선택"}
                                </button>
                              </OneOnOneCandidateCard>
                            );
                          })}
                          {adminRecommendations.length > 0 ? (
                            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3">
                              <div className="mb-3">
                                <p className="text-sm font-black text-emerald-950">오늘의 추가 후보</p>
                                <p className="mt-1 text-xs leading-5 text-emerald-700">
                                  기본 추천 10명과 겹치지 않는 나이대 맞춤 후보예요. 매일 자동으로 바뀝니다.
                                </p>
                              </div>
                              <div className="space-y-3">
                                {adminRecommendations.map((candidate) => {
                                  const candidateId = String(candidate.id ?? "");
                                  const actionKey = `${sourceCardId}:${candidateId}`;
                                  const canSelect = Boolean(sourceCardId && candidateId);
                                  return (
                                    <OneOnOneCandidateCard
                                      key={`${sourceCardId}:admin:${candidateId || getOneOnOneDisplayName(candidate)}`}
                                      card={candidate}
                                      badge="추가 후보"
                                      badgeClassName="bg-emerald-100 text-emerald-700"
                                      note="선택하면 상대에게 수락 요청이 전달됩니다."
                                    >
                                      <button
                                        type="button"
                                        disabled={!canSelect || processingAutoKeys.includes(actionKey)}
                                        onClick={() => onAutoSelect(sourceCardId, candidateId)}
                                        className="mt-3 inline-flex min-h-[40px] w-full items-center justify-center rounded-xl bg-emerald-600 px-4 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-emerald-700"
                                      >
                                        {processingAutoKeys.includes(actionKey) ? "선택 중..." : "이 후보 선택"}
                                      </button>
                                    </OneOnOneCandidateCard>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <details className="mt-5 rounded-2xl border border-neutral-100 bg-neutral-50/70 px-4 py-3 text-xs text-neutral-500">
        <summary className="cursor-pointer select-none text-xs font-bold text-neutral-700">1대1 번호교환 결제 및 환불 안내</summary>
        <div className="mt-3 space-y-1.5 leading-5">
          <p>신청과 후보 확인은 무료이며, 번호교환 단계에서 결제 전 금액과 내용을 확인한 뒤 진행됩니다.</p>
          <p>결제 후 상대 연락처 공개 등 서비스 제공이 시작된 경우 단순 변심 환불은 제한될 수 있습니다.</p>
          <p>중복 결제, 결제 오류, 서비스 미반영 등은 주문번호와 닉네임을 알려주시면 확인 후 조치합니다.</p>
          <Link href="/refund" className="inline-flex font-bold text-neutral-700 underline underline-offset-2 hover:text-neutral-950">
            환불/취소 규정 자세히 보기
          </Link>
        </div>
      </details>
    </section>
  );
}

function OneOnOneCandidateCard({
  card,
  badge,
  badgeClassName,
  note,
  children,
}: {
  card?: OneOnOneCardPreview | null;
  badge?: string;
  badgeClassName?: string;
  note?: string;
  children?: ReactNode;
}) {
  const photos = Array.isArray(card?.photo_signed_urls) ? card.photo_signed_urls.filter(Boolean).slice(0, 4) : [];
  const primaryPhoto = photos[0] ?? "";
  const name = getOneOnOneDisplayName(card);
  const meta = getOneOnOneMeta(card);

  return (
    <article className="overflow-hidden rounded-[24px] border border-neutral-100 bg-neutral-50 p-3">
      <div className="flex gap-3">
        <a
          href={primaryPhoto || undefined}
          target={primaryPhoto ? "_blank" : undefined}
          rel={primaryPhoto ? "noreferrer" : undefined}
          className="relative h-[104px] w-[92px] shrink-0 overflow-hidden rounded-2xl border border-white bg-white shadow-sm"
          aria-label={primaryPhoto ? `${name} 후보 사진 크게 보기` : undefined}
        >
          {primaryPhoto ? (
            <>
              <img src={primaryPhoto} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover opacity-25 blur-md" />
              <img
                src={primaryPhoto}
                alt={`${name} 후보 사진`}
                loading="lazy"
                decoding="async"
                className="relative z-10 h-full w-full object-contain p-1"
              />
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-100 to-neutral-50 text-[11px] font-bold text-neutral-400">
              사진
            </div>
          )}
        </a>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-neutral-950">{name}</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-neutral-500">{meta}</p>
            </div>
            {badge ? (
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${badgeClassName ?? "bg-white text-neutral-600"}`}>
                {badge}
              </span>
            ) : null}
          </div>
          {note ? <p className="mt-2 text-xs font-semibold leading-5 text-sky-700">{note}</p> : null}
        </div>
      </div>

      {card?.intro_text ? <p className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-neutral-700">{card.intro_text}</p> : null}
      {card?.strengths_text ? <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-neutral-700">장점: {card.strengths_text}</p> : null}
      {card?.preferred_partner_text ? (
        <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-neutral-700">원하는 점: {card.preferred_partner_text}</p>
      ) : null}

      {photos.length > 1 ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {photos.slice(1).map((url, idx) => (
            <a
              key={`${url}-${idx}`}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="relative block h-24 overflow-hidden rounded-xl border border-neutral-100 bg-white"
            >
              <img src={url} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover opacity-20 blur-md" />
              <img
                src={url}
                alt={`${name} 추가 사진 ${idx + 2}`}
                loading="lazy"
                decoding="async"
                className="relative z-10 h-full w-full object-contain p-1"
              />
            </a>
          ))}
        </div>
      ) : null}

      {children}
    </article>
  );
}

function OneOnOneMatchActions({
  match,
  contactExchangeIncluded,
  processing,
  contactProcessing,
  nudgeProcessing,
  onMatchAction,
  onContactCheckout,
  onContactNudge,
}: {
  match: OneOnOneMatchPreview;
  contactExchangeIncluded: boolean;
  processing: boolean;
  contactProcessing: boolean;
  nudgeProcessing: boolean;
  onMatchAction: (
    matchId: string,
    action: "select_candidate" | "source_cancel" | "candidate_accept" | "candidate_reject" | "source_accept" | "source_reject" | "cancel_mutual"
  ) => void;
  onContactCheckout: (matchId: string) => void;
  onContactNudge: (matchId: string, presetKey: OneOnOneContactNudgePresetKey) => void;
}) {
  if (match.role === "source" && match.state === "proposed") {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={processing}
          onClick={() => onMatchAction(match.id, "select_candidate")}
          className="inline-flex min-h-[34px] items-center rounded-xl bg-sky-600 px-3 text-xs font-black text-white disabled:opacity-50"
        >
          {processing ? "처리 중..." : "후보 선택"}
        </button>
        <Link href="/mypage?section=matching" className="inline-flex min-h-[34px] items-center rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600">
          자세히
        </Link>
      </div>
    );
  }

  if (match.role === "candidate" && match.state === "source_selected") {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={processing}
          onClick={() => onMatchAction(match.id, "candidate_accept")}
          className="inline-flex min-h-[34px] items-center rounded-xl bg-emerald-600 px-3 text-xs font-black text-white disabled:opacity-50"
        >
          {processing ? "처리 중..." : "수락"}
        </button>
        <button
          type="button"
          disabled={processing}
          onClick={() => onMatchAction(match.id, "candidate_reject")}
          className="inline-flex min-h-[34px] items-center rounded-xl border border-rose-200 bg-white px-3 text-xs font-bold text-rose-700 disabled:opacity-50"
        >
          거절
        </button>
      </div>
    );
  }

  if (match.role === "source" && match.state === "source_selected") {
    return (
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-amber-700">상대의 응답을 기다리고 있어요.</p>
        <button
          type="button"
          disabled={processing}
          onClick={() => {
            if (!window.confirm("보낸 1:1 지원을 취소할까요? 상대가 수락하기 전까지만 취소할 수 있습니다.")) return;
            onMatchAction(match.id, "source_cancel");
          }}
          className="inline-flex min-h-[44px] touch-manipulation items-center rounded-xl border border-rose-200 bg-white px-4 text-xs font-bold text-rose-700 disabled:opacity-50"
        >
          {processing ? "취소 중..." : "지원 취소"}
        </button>
      </div>
    );
  }

  if (match.role === "source" && match.state === "candidate_accepted") {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={processing}
          onClick={() => onMatchAction(match.id, "source_accept")}
          className="inline-flex min-h-[34px] items-center rounded-xl bg-emerald-600 px-3 text-xs font-black text-white disabled:opacity-50"
        >
          {processing ? "처리 중..." : "최종 수락"}
        </button>
        <button
          type="button"
          disabled={processing}
          onClick={() => onMatchAction(match.id, "source_reject")}
          className="inline-flex min-h-[34px] items-center rounded-xl border border-rose-200 bg-white px-3 text-xs font-bold text-rose-700 disabled:opacity-50"
        >
          거절
        </button>
      </div>
    );
  }

  if (match.role === "candidate" && match.state === "candidate_accepted") {
    return (
      <p className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
        내가 수락했어요. 상대가 최종 수락하면 번호 교환 단계로 넘어갑니다.
      </p>
    );
  }

  if (match.state === "mutual_accepted") {
    if (match.contact_exchange_status === "approved") {
      const canCancelMatch = canCancelOneOnOneMatchPreview(match);
      return (
        <div className="mt-3 rounded-xl border border-emerald-100 bg-white px-3 py-2">
          <p className="text-xs font-semibold text-emerald-700">
            번호 교환이 완료됐어요. 공개된 연락처는 안전하게 이용해주세요.
          </p>
          <OneOnOneContactNudge
            matchId={match.id}
            nudge={match.contact_nudge}
            processing={nudgeProcessing}
            onSend={onContactNudge}
          />
          {canCancelMatch ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={processing}
                onClick={() => {
                  if (!window.confirm("이 1:1 매칭을 취소할까요?")) return;
                  onMatchAction(match.id, "cancel_mutual");
                }}
                className="inline-flex min-h-[44px] touch-manipulation items-center rounded-xl border border-rose-200 bg-white px-4 text-xs font-bold text-rose-700 disabled:opacity-50"
              >
                {processing ? "취소 중..." : "매칭 취소"}
              </button>
              <Link href="/mypage?section=matching" className="inline-flex min-h-[34px] items-center rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600">
                상세 보기
              </Link>
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div className="mt-3 rounded-2xl border border-emerald-100 bg-white p-3">
        <p className="text-xs font-black text-neutral-900">{contactExchangeIncluded ? "기존 플러스 무료 번호교환" : "번호 교환 가능"}</p>
        <p className="mt-1 text-xs leading-5 text-neutral-600">
          {contactExchangeIncluded
            ? "기존 플러스 혜택 적용 중이라 추가 결제 없이 상대 연락처가 바로 공개됩니다."
            : "결제 전 금액과 내용을 확인한 뒤 진행되며, 완료되면 상대 연락처가 바로 공개됩니다."}
        </p>
        {!contactExchangeIncluded ? (
          <p className="mt-1 text-[11px] leading-5 text-neutral-400">결제 오류나 미반영은 마이페이지 결제 내역 또는 오픈카톡으로 확인 요청해주세요.</p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={contactProcessing}
            onClick={() => onContactCheckout(match.id)}
            className="inline-flex min-h-[34px] items-center rounded-xl bg-emerald-600 px-3 text-xs font-black text-white disabled:opacity-50"
          >
            {contactProcessing
              ? contactExchangeIncluded ? "교환 중..." : "결제 준비 중..."
              : contactExchangeIncluded ? "무료로 번호교환" : "연락처 교환 진행하기"}
          </button>
          <Link href="/mypage?section=matching" className="inline-flex min-h-[34px] items-center rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600">
            상세 보기
          </Link>
          <button
            type="button"
            disabled={processing}
            onClick={() => {
              if (!window.confirm("이 1:1 매칭을 취소할까요?")) return;
              onMatchAction(match.id, "cancel_mutual");
            }}
            className="inline-flex min-h-[44px] touch-manipulation items-center rounded-xl border border-rose-200 bg-white px-4 text-xs font-bold text-rose-700 disabled:opacity-50"
          >
            {processing ? "취소 중..." : "매칭 취소"}
          </button>
        </div>
        <OneOnOneContactNudge
          matchId={match.id}
          nudge={match.contact_nudge}
          processing={nudgeProcessing}
          onSend={onContactNudge}
        />
      </div>
    );
  }

  return null;
}
