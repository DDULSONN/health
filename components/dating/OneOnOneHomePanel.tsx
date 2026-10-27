"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import DatingReportButton, { type DatingReportTargetType, type DatingReportResult } from "@/components/DatingReportButton";
import OneOnOneRefreshControl, { type OneOnOneRefreshNotice } from "@/components/dating/OneOnOneRefreshControl";
import OneOnOneCandidateRegionNotice from "@/components/dating/OneOnOneCandidateRegionNotice";
import OneOnOnePlusStatus from "@/components/dating/OneOnOnePlusStatus";
import DatingPlusOffers from "@/components/dating/DatingPlusOffers";
import OneOnOneContactNudge from "@/components/dating/OneOnOneContactNudge";
import OneOnOneContactOffer from "@/components/dating/OneOnOneContactOffer";
import OneOnOneProfileSummary from "@/components/dating/OneOnOneProfileSummary";
import OneOnOneIncomingRequests from "@/components/dating/OneOnOneIncomingRequests";
import OneOnOneNextSteps from "@/components/dating/OneOnOneNextSteps";
import OneOnOneContactList from "@/components/dating/OneOnOneContactList";
import OneOnOneContactPending from "@/components/dating/OneOnOneContactPending";
import OneOnOneUnavailableNotice from "@/components/dating/OneOnOneUnavailableNotice";
import { oneOnOneEndedNotice } from "@/lib/dating-1on1-notification-status";
import { canOfferOneOnOneContact, normalizeOneOnOneMatchId, oneOnOneMatchHref } from "@/lib/dating-1on1-match-navigation";
import OneOnOneExpansionPanel from "@/components/dating/OneOnOneExpansionPanel";
import CandidateImpression from "@/components/dating/CandidateImpression";
import { CandidateHideButton, CandidateHidesPanel } from "@/components/dating/CandidateHides";
import { getOneOnOneActionSummary, getOneOnOneMatchLabel, isIncomingOneOnOneRequest } from "@/lib/dating-1on1-action-copy";
import { VIEWER_SESSION_ERROR } from "@/lib/viewer-session-recovery";
import { ONE_ON_ONE_HOME_HREF } from "@/lib/dating-navigation";
import { ONE_ON_ONE_CONTACT_PRICE_KRW } from "@/lib/dating-contact-price";
import type { OneOnOneContactNudgePresetKey, OneOnOneContactNudgeSummary } from "@/lib/dating-1on1-contact-nudge";

type OneOnOneCardPreview = {
  recommendation_region_widened?: boolean;
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
  hides_enabled?: boolean;
  hidden_candidate_ids?: string[];
  recommendation_region_widened?: boolean;
  impression_ticket?: string | null;
  expansion_enabled?: boolean;
  source_card_id?: string;
  source_card_status?: string;
  refresh_used?: boolean;
  refresh_used_at?: string | null;
  refresh_used_count?: number;
  refresh_remaining?: number;
  refresh_bonus_remaining?: number;
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
  source_card_id?: string;
  role?: "source" | "candidate";
  state?: string;
  contact_exchange_status?: string;
  contact_exchange_approved_at?: string | null;
  action_required?: boolean;
  counterparty_card?: OneOnOneCardPreview | null;
  counterparty_phone?: string | null;
  contact_nudge?: OneOnOneContactNudgeSummary | null;
  source_final_responded_at?: string | null;
  candidate_responded_at?: string | null;
  created_at?: string | null;
};

const ONE_ON_ONE_CONTACT_CANCEL_DELAY_MS = 48 * 60 * 60 * 1000;

function canCancelOneOnOneMatchPreview(match: OneOnOneMatchPreview) {
  if (match.state !== "mutual_accepted" && match.state !== "candidate_accepted") return false;
  if (match.contact_exchange_status !== "approved") return true;
  const approvedMs = Date.parse(match.contact_exchange_approved_at ?? "");
  return Number.isFinite(approvedMs) && Date.now() - approvedMs >= ONE_ON_ONE_CONTACT_CANCEL_DELAY_MS;
}

export type OneOnOneHomeState = {
  status: { canWrite?: boolean; totalApplications?: number; phoneVerified?: boolean; reason?: string | null } | null;
  myCards: OneOnOneCardPreview[];
  matches: OneOnOneMatchPreview[];
  recommendations: OneOnOneRecommendationGroup[];
  plus: { expires_at?: string | null; contact_exchange_included?: boolean } | null;
};

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
  focusedMatchId,
  refreshNotice,
  onReported,
  onReload,
  arrivedFromOnboarding,
  viewerLoggedIn,
  profileStartHref,
  profileStartCta,
  loading,
  sessionError,
  onRetrySession,
  error,
  recommendationsLoading = false,
  recommendationsError = "",
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
  onCandidateHidden,
  onCandidateRestored,
}: {
  focusedMatchId?: string | null;
  arrivedFromOnboarding: boolean;
  onReported: (result: DatingReportResult) => void;
  onReload: () => void;
  viewerLoggedIn: boolean;
  profileStartHref: string;
  profileStartCta: string;
  loading: boolean;
  sessionError: boolean;
  onRetrySession: () => void;
  error: string;
  recommendationsLoading?: boolean;
  recommendationsError?: string;
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
  onContactCheckout: (matchId: string, offerId?: string) => void;
  onContactNudge: (matchId: string, presetKey: OneOnOneContactNudgePresetKey) => void;
  onAutoSelect: (sourceCardId: string, candidateCardId: string, candidateName?: string | null) => void | Promise<void>;
  onRefreshRecommendations: (sourceCardId: string) => void;
  onCandidateHidden?: (candidateId: string) => void;
  onCandidateRestored?: () => Promise<void>;
  refreshNotice: OneOnOneRefreshNotice | null;
}) {
  const [plusGuideOpen, setPlusGuideOpen] = useState(false);
  const [matchGuideOpen, setMatchGuideOpen] = useState(false);
  const focusedMatchRef = useRef<HTMLDivElement>(null);
  const scrolledMatchId = useRef<string | null>(null);
  const profileSectionRef = useRef<HTMLDetailsElement>(null);
  const recommendationSectionRef = useRef<HTMLDivElement>(null);
  const incomingSectionRef = useRef<HTMLDivElement>(null);
  const nextStepsSectionRef = useRef<HTMLDivElement>(null);
  const matchesSectionRef = useRef<HTMLDivElement>(null);
  const targetMatchId = normalizeOneOnOneMatchId(focusedMatchId);
  const myCards = data?.myCards ?? [];
  const matches = data?.matches ?? [];
  // Only highlight a record already returned by the authenticated participant API.
  // A URL alone never loads a profile or grants permission to act on it.
  const focusedMatch = targetMatchId ? matches.find((match) => match.id === targetMatchId) : null;
  const focusedEnding = focusedMatch ? oneOnOneEndedNotice(focusedMatch.state, focusedMatch.role) : null;
  useEffect(() => {
    if (!targetMatchId) { scrolledMatchId.current = null; return; }
    if (loading || sessionError || error || !viewerLoggedIn || !focusedMatchRef.current || scrolledMatchId.current === targetMatchId) return;
    focusedMatchRef.current.scrollIntoView({ block: "start", behavior: "auto" });
    focusedMatchRef.current.focus({ preventScroll: true });
    scrolledMatchId.current = targetMatchId;
  }, [targetMatchId, focusedMatch, loading, sessionError, error, viewerLoggedIn]);
  const recommendationGroups = data?.recommendations ?? [];
  const hiddenCandidateIds = new Set(recommendationGroups.flatMap(group => group.hidden_candidate_ids ?? []));
  const activeMatches = matches.filter((match) =>
    ["proposed", "source_selected", "candidate_accepted", "mutual_accepted"].includes(String(match.state ?? "")) &&
    !(match.state === "proposed" && match.role === "source" && hiddenCandidateIds.has(match.counterparty_card?.id ?? ""))
  );
  const plusActive = Boolean(data?.plus?.expires_at);
  const plusContactExchangeIncluded = data?.plus?.contact_exchange_included === true;
  const recommendationCount = recommendationGroups.reduce(
    (sum, group) => sum + (group.recommendations?.length ?? 0) + (group.admin_recommendations?.length ?? 0),
    0
  );
  const activeCards = myCards.filter((card) => card.status !== "rejected");
  const hasOneOnOneCard = activeCards.length > 0;
  const actionSummary = getOneOnOneActionSummary(activeMatches);
  const incomingRequests = activeMatches.filter((match) => match.id !== focusedMatch?.id && isIncomingOneOnOneRequest(match));
  const ongoingMatches = activeMatches.filter((match) => match.id !== focusedMatch?.id && !isIncomingOneOnOneRequest(match));
  // Shortcuts only move focus/scroll; they never refresh candidates or submit an action.
  function jumpToSection(section: HTMLElement | null) {
    if (!section) return;
    section.scrollIntoView({ block: "start", behavior: "auto" });
    section.focus({ preventScroll: true });
  }
  function jumpToProfile() {
    if (profileSectionRef.current) profileSectionRef.current.open = true;
    jumpToSection(profileSectionRef.current);
  }
  function jumpToMatchSummary() {
    if (actionSummary.primary.label === "받은 요청" && actionSummary.primary.count > 0) {
      // Open only the inbox header, never a profile or match-action button.
      if (incomingRequests.length > 0) {
        incomingSectionRef.current?.querySelector<HTMLButtonElement>(':scope > section > button[aria-expanded="false"]')?.click();
      }
      jumpToSection(incomingRequests.length > 0 ? incomingSectionRef.current : focusedMatchRef.current);
    } else if (["내 수락 대기", "연락처 교환 대기"].includes(actionSummary.primary.label) && nextStepsSectionRef.current?.firstElementChild) {
      jumpToSection(nextStepsSectionRef.current);
    } else {
      jumpToSection(matchesSectionRef.current);
    }
  }
  const shortcutsDisabled = loading || sessionError || Boolean(error);
  return (
    <section id="one-on-one-candidates" className="mb-5 rounded-2xl border border-neutral-200 bg-white p-4 shadow-none md:p-6">
      {arrivedFromOnboarding ? (
        <div role="status" className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm font-black text-emerald-900">1:1 신청서 작성 완료</p>
          <p className="mt-1 text-xs font-semibold leading-5 text-emerald-700">
            등록한 정보로 추천 후보를 바로 확인할 수 있어요. 아래에서 마음에 드는 후보를 선택해보세요.
          </p>
        </div>
      ) : null}
      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[22px] font-bold leading-8 tracking-tight text-neutral-900">1대1 매칭</h2>
          <button
            type="button"
            onClick={() => setMatchGuideOpen((open) => !open)}
            aria-expanded={matchGuideOpen}
            className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-lg px-2 text-[11px]! font-medium! text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-700"
          >
            <span className="grid h-3.5 w-3.5 place-items-center rounded-full border border-neutral-300 text-[9px]" aria-hidden>?</span>
            {matchGuideOpen ? "닫기" : "매칭 안내"}
          </button>
        </div>
        <p className="mt-1 text-[13px] leading-6 text-neutral-500">
          프로필을 보고, 마음에 드는 분에게 요청을 보내세요.
        </p>
        {viewerLoggedIn && hasOneOnOneCard ? <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/mypage?section=matching&match=one_on_one"
            className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-neutral-200 bg-white px-3.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-50"
          >
            내 프로필 · 매칭 관리
          </Link>
        </div> : null}
      </div>

      {matchGuideOpen ? (
        <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
          <p className="text-xs font-semibold text-neutral-800">1:1 매칭은 이렇게 진행돼요</p>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-xs leading-6 text-neutral-600">
            <li>프로필을 작성하면 나이와 지역을 고려한 후보를 추천해요.</li>
            <li>마음에 드는 분에게 요청을 보내고, 상대의 수락을 기다려요.</li>
            <li>서로 수락한 뒤 연락처를 교환할 수 있어요.</li>
          </ol>
          <p className="mt-3 border-t border-neutral-200 pt-2 text-xs leading-5 text-neutral-700">
            프로필 등록·매칭 요청은 무료예요. 연락처 교환은 건당 {ONE_ON_ONE_CONTACT_PRICE_KRW.toLocaleString("ko-KR")}원이에요.
          </p>
          <p className="mt-2 text-[11px] leading-5 text-neutral-500">
            후보는 시스템이 추천해요. 사진·직업·소개는 회원이 직접 등록한 정보이며, 별도 인증 표시가 없는 정보는 확인된 사실을 뜻하지 않아요.
          </p>
        </div>
      ) : null}

      {viewerLoggedIn && hasOneOnOneCard ? (
        <nav aria-label="1대1 바로가기" className="mt-4 grid grid-cols-3 divide-x divide-neutral-100 border-y border-neutral-100 py-1">
          <button type="button" disabled={shortcutsDisabled} onClick={jumpToProfile}
            className="min-h-[64px] rounded-lg px-2 py-2 text-center hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-rose-500 disabled:opacity-50">
            <span className="block text-[11px] font-medium text-neutral-600">내 프로필 <span aria-hidden="true">›</span></span>
            <span className="mt-1 block text-base font-semibold tabular-nums text-neutral-900">{activeCards.length}개</span>
          </button>
          <button type="button" disabled={shortcutsDisabled} onClick={() => jumpToSection(recommendationSectionRef.current)}
            className="min-h-[64px] rounded-lg px-2 py-2 text-center hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-rose-500 disabled:opacity-50">
            <span className="block text-[11px] font-medium text-neutral-600">추천 후보 <span aria-hidden="true">›</span></span>
            <span className="mt-1 block text-base font-semibold tabular-nums text-neutral-900">{recommendationCount}명</span>
          </button>
          <button type="button" disabled={shortcutsDisabled} onClick={jumpToMatchSummary}
            className="min-h-[64px] rounded-lg px-2 py-2 text-center hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-rose-500 disabled:opacity-50">
            <span className="block text-[11px] font-medium text-neutral-600">{actionSummary.primary.label} <span aria-hidden="true">›</span></span>
            <span className="mt-1 block text-base font-semibold tabular-nums text-neutral-900">{actionSummary.primary.count}건</span>
          </button>
        </nav>
      ) : null}
      {viewerLoggedIn && hasOneOnOneCard && actionSummary.otherDetail ? <p className="mt-2 break-words text-[11px] leading-5 text-neutral-500">{actionSummary.otherDetail}</p> : null}

      <div className="mt-5">
        {loading ? (
          <p className="rounded-[24px] bg-neutral-50 p-5 text-sm text-neutral-500">1대1 정보를 불러오는 중...</p>
        ) : sessionError ? (
          <div role="alert" className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
            <p>{VIEWER_SESSION_ERROR}</p>
            <button type="button" onClick={onRetrySession} className="mt-3 min-h-[44px] rounded-lg border border-neutral-300 bg-white px-3 font-semibold text-neutral-800">로그인 상태 다시 확인</button>
          </div>
        ) : !viewerLoggedIn ? (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-sm font-semibold text-neutral-900">내 프로필로 시작하는 1대1 매칭</p>
            <p className="mt-2 text-[13px] leading-6 text-neutral-600">프로필을 등록하고 추천 후보에게 요청을 보내세요. 서로 수락한 뒤 연락처를 교환할 수 있어요.</p>
            <p className="mt-2 text-xs leading-5 text-neutral-500">등록·요청 무료 · 연락처 교환 건당 {ONE_ON_ONE_CONTACT_PRICE_KRW.toLocaleString("ko-KR")}원</p>
            <Link
              href={buildLoginRedirect(targetMatchId ? oneOnOneMatchHref(targetMatchId) : ONE_ON_ONE_HOME_HREF)}
              className="mt-3 inline-flex min-h-[42px] items-center rounded-xl bg-rose-600 px-4 text-sm font-bold text-white hover:bg-rose-700"
            >
              로그인하기
            </Link>
          </div>
        ) : error ? (
          <div className="rounded-[24px] border border-rose-100 bg-rose-50 p-5 text-sm text-rose-700" role="alert">
            <p>{error}</p>
            <button type="button" onClick={onReload} className="mt-3 min-h-[44px] rounded-xl border border-neutral-300 bg-white px-3 font-medium text-neutral-700">명단 다시 불러오기 · 횟수 차감 없음</button>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {!hasOneOnOneCard ? (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-base font-semibold text-neutral-900">내 소개를 등록하고 후보를 만나보세요</p>
            <p className="mt-2 text-[13px] leading-6 text-neutral-600">
              사진과 소개를 작성하면 추천 후보를 확인할 수 있어요. 프로필 등록과 매칭 요청은 무료예요.
            </p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">서로 수락한 후 연락처 교환은 건당 {ONE_ON_ONE_CONTACT_PRICE_KRW.toLocaleString("ko-KR")}원이에요.</p>
            <Link
              href={profileStartHref}
              className="mt-4 inline-flex min-h-[46px] items-center justify-center rounded-xl bg-rose-600 px-5 text-sm font-black text-white hover:bg-rose-700"
            >
              {profileStartCta}
            </Link>
          </div>
            ) : null}
            {targetMatchId ? <div id="selected-one-on-one-match" ref={focusedMatchRef} tabIndex={-1}
              className="scroll-mt-40 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-rose-300">
              <p className="mb-2 text-xs font-semibold text-neutral-700">선택한 매칭</p>
              {focusedEnding ? <div role="status" className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-sm font-semibold text-neutral-700">{focusedEnding.title}</p>
                <p className="mt-2 text-xs leading-5 text-neutral-600">{focusedEnding.body}</p>
              </div> : focusedMatch?.counterparty_card ? <OneOnOneCandidateCard compact
                card={focusedMatch.counterparty_card} reportTarget={{ type: "one_on_one_match", id: focusedMatch.id }}
                onReported={onReported} badge={getOneOnOneMatchLabel(focusedMatch)} note={oneOnOneContactLabel(focusedMatch.contact_exchange_status)}>
                {focusedMatch.counterparty_phone ? <p className="mt-2 text-sm font-black text-emerald-700">{focusedMatch.counterparty_phone}</p> : null}
                <OneOnOneMatchActions match={focusedMatch} contactExchangeIncluded={plusContactExchangeIncluded}
                  processing={processingMatchIds.includes(focusedMatch.id)} contactProcessing={processingContactIds.includes(focusedMatch.id)}
                  nudgeProcessing={processingNudgeIds.includes(focusedMatch.id)} onMatchAction={onMatchAction}
                  onContactCheckout={onContactCheckout} onContactNudge={onContactNudge} />
              </OneOnOneCandidateCard> : <OneOnOneUnavailableNotice key={targetMatchId} matchId={targetMatchId} />}
            </div> : null}
            <div ref={nextStepsSectionRef} tabIndex={-1} data-one-on-one-section="next-steps" className="scroll-mt-40 rounded-xl outline-none empty:hidden focus-visible:ring-2 focus-visible:ring-rose-300">
              <OneOnOneNextSteps matches={activeMatches} renderContact={(match) => (
                <OneOnOneContactOffer compact matchId={match.id} name={match.counterparty_card?.name}
                  included={plusContactExchangeIncluded} processing={processingContactIds.includes(match.id)}
                  nudge={match.contact_nudge} nudgeProcessing={processingNudgeIds.includes(match.id)}
                  onExchange={onContactCheckout} onNudge={onContactNudge} />
              )} />
            </div>
            <div ref={incomingSectionRef} tabIndex={-1} data-one-on-one-section="incoming" className="scroll-mt-40 rounded-xl outline-none empty:hidden focus-visible:ring-2 focus-visible:ring-rose-300">
            <OneOnOneIncomingRequests requests={incomingRequests} renderRequest={(match) => match.counterparty_card ? (
              <OneOnOneCandidateCard
                compact
                card={match.counterparty_card}
                reportTarget={{ type: "one_on_one_match", id: match.id }}
                onReported={onReported}
                badge={getOneOnOneMatchLabel(match)}
                badgeClassName="bg-rose-50 text-rose-700"
              >
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
            ) : (
              <div className="text-xs text-neutral-500">
                <p>상대 프로필을 확인할 수 없습니다.</p>
                <button type="button" onClick={onReload} className="mt-1 min-h-[44px] underline underline-offset-2">명단 다시 불러오기 · 횟수 차감 없음</button>
              </div>
            )} />
            </div>
            {hasOneOnOneCard ? <div ref={recommendationSectionRef} tabIndex={-1} data-one-on-one-section="recommendations" className="scroll-mt-40 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-rose-300">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-bold text-neutral-900">추천 후보</p>
                  <p className="mt-1 text-xs leading-5 text-neutral-600">
                    프로필 기준으로 먼저 보여드리는 후보예요. 최근 24시간 동안 {plusActive ? "2회" : "1회"} 새로 섞을 수 있어요.
                  </p>
                  {arrivedFromOnboarding ? <p className="mt-2 text-xs font-medium leading-5 text-neutral-700">프로필이 준비됐어요. 마음에 드는 후보에게 먼저 요청해 보세요.</p> : null}
                </div>
                <span className="shrink-0 whitespace-nowrap rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-rose-700">{recommendationCount}명</span>
              </div>

              {recommendationsLoading ? (
                <p role="status" className="mt-3 rounded-xl bg-neutral-50 p-4 text-sm leading-6 text-neutral-600">추천 후보를 불러오는 중이에요.</p>
              ) : recommendationsError ? (
                <div role="alert" className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm leading-6 text-neutral-600">
                  <p>{recommendationsError}</p>
                  <p className="mt-1 text-xs">진행 중인 매칭과 교환된 연락처는 계속 확인할 수 있어요.</p>
                  <button type="button" data-recommendation-retry onClick={onReload} className="mt-2 min-h-[44px] text-xs font-medium text-neutral-700 underline underline-offset-2">추천 후보 다시 불러오기 · 횟수 차감 없음</button>
                </div>
              ) : recommendationGroups.length === 0 ? (
                <p className="mt-3 rounded-xl bg-neutral-50 p-4 text-sm leading-6 text-neutral-600">현재 보여줄 추천 후보가 없어요. 조건에 맞는 후보가 생기면 여기서 바로 볼 수 있습니다.</p>
              ) : (
                <div className="mt-3 space-y-4">
                  {recommendationGroups.map((group, groupIndex) => {
                    const sourceCardId = String(group.source_card_id ?? "");
                    const sourceCard = activeCards.find((card) => card.id === sourceCardId);
                    const recommendations = group.recommendations ?? [];
                    const adminRecommendations = group.admin_recommendations ?? [];
                    const refreshing = refreshingRecommendationIds.includes(sourceCardId);
                    const canRefresh = Boolean(sourceCardId && group.can_refresh);

                    return (
                      <div key={sourceCardId || `group-${groupIndex}`} className="bg-white">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-neutral-900">
                              {sourceCard ? `${getOneOnOneDisplayName(sourceCard)} 기준 후보` : "추천 후보"}
                            </p>
                          </div>
                        </div>
                        <OneOnOneRefreshControl usage={group} busy={refreshing} blocked={!canRefresh}
                          onCheckUsage={onReload}
                          plusOffer={{ cardId: sourceCardId, active: plusActive }}
                          notice={refreshNotice?.sourceCardId === sourceCardId ? refreshNotice : null}
                          onRequest={() => onRefreshRecommendations(sourceCardId)} />
                        <div className="mt-3 space-y-3">
                          {recommendations.map((candidate) => {
                            const candidateId = String(candidate.id ?? "");
                            const actionKey = `${sourceCardId}:${candidateId}`;
                            const canSelect = Boolean(sourceCardId && candidateId);
                            return (
                              <OneOnOneCandidateCard
                                compact
                                impressionTicket={group.impression_ticket}
                                key={`${sourceCardId}:${candidateId || getOneOnOneDisplayName(candidate)}`}
                                card={candidate}
                                reportTarget={{ type: "one_on_one_card", id: candidateId }}
                                onReported={onReported}
                                badge="추천"
                                badgeClassName="bg-neutral-100 text-neutral-600"
                              >
                                <button
                                  type="button"
                                  disabled={!canSelect || processingAutoKeys.includes(actionKey)}
                                  onClick={() => onAutoSelect(sourceCardId, candidateId, candidate.name)}
                                  className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-[#f0003d] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[#d90037]"
                                >
                                  {processingAutoKeys.includes(actionKey) ? "요청 보내는 중..." : "매칭 요청 보내기"}
                                </button>
                                {onCandidateHidden ? <CandidateHideButton enabled={group.hides_enabled === true}
                                  sourceCardId={sourceCardId} candidateId={candidateId} ticket={group.impression_ticket}
                                  disabled={!canSelect || refreshing || processingAutoKeys.length > 0}
                                  onHidden={onCandidateHidden} /> : null}
                              </OneOnOneCandidateCard>
                            );
                          })}
                          {adminRecommendations.length > 0 ? (
                            <div className="border-t border-neutral-200 pt-4">
                              <div className="mb-3">
                                <p className="text-sm font-semibold text-neutral-900">오늘의 추가 후보</p>
                                <p className="mt-1 text-xs leading-5 text-neutral-600">
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
                                      compact
                                      impressionTicket={group.impression_ticket}
                                      key={`${sourceCardId}:admin:${candidateId || getOneOnOneDisplayName(candidate)}`}
                                      card={candidate}
                                      reportTarget={{ type: "one_on_one_card", id: candidateId }}
                                      onReported={onReported}
                                      badge="추가 후보"
                                      badgeClassName="bg-neutral-100 text-neutral-600"
                                    >
                                      <button
                                        type="button"
                                        disabled={!canSelect || processingAutoKeys.includes(actionKey)}
                                        onClick={() => onAutoSelect(sourceCardId, candidateId, candidate.name)}
                                        className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-[#f0003d] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[#d90037]"
                                      >
                                        {processingAutoKeys.includes(actionKey) ? "요청 보내는 중..." : "매칭 요청 보내기"}
                                      </button>
                                      {onCandidateHidden ? <CandidateHideButton enabled={group.hides_enabled === true}
                                        sourceCardId={sourceCardId} candidateId={candidateId} ticket={group.impression_ticket}
                                        disabled={!canSelect || refreshing || processingAutoKeys.length > 0}
                                        onHidden={onCandidateHidden} /> : null}
                                    </OneOnOneCandidateCard>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                        </div>
                        <OneOnOneExpansionPanel enabled={group.expansion_enabled === true} sourceCardId={sourceCardId}
                          revision={group} blocked={refreshing || processingAutoKeys.length > 0}
                          hidesEnabled={group.hides_enabled === true && Boolean(onCandidateHidden)} onHidden={onCandidateHidden}
                          onSelect={(candidateId, name) => onAutoSelect(sourceCardId, candidateId, name)} onReported={onReported} />
                        {onCandidateRestored ? <CandidateHidesPanel enabled={group.hides_enabled === true}
                          revision={group} onRestored={onCandidateRestored} /> : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div> : null}

            {hasOneOnOneCard ? <details ref={profileSectionRef} tabIndex={-1} data-one-on-one-section="profile" className="scroll-mt-40 rounded-xl bg-neutral-50 px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-rose-300">
              <summary className="min-h-[44px] cursor-pointer select-none content-center text-sm font-medium text-neutral-700">내 1대1 프로필 보기</summary>
              <div className="mt-3 space-y-2">
                {activeCards.slice(0, 3).map((card) => (
                  <div key={card.id ?? getOneOnOneDisplayName(card)} className="rounded-2xl bg-white px-3 py-3">
                    <p className="text-sm font-semibold text-neutral-900">{getOneOnOneDisplayName(card)}</p>
                    <p className="mt-1 text-xs font-normal text-neutral-500">{getOneOnOneMeta(card)}</p>
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
            </details> : null}

            {hasOneOnOneCard ? (plusActive && data?.plus?.expires_at ? <OneOnOnePlusStatus expiresAt={data.plus.expires_at} contactExchangeIncluded={plusContactExchangeIncluded} /> : <div className="relative overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 p-4 shadow-none">
              <div aria-hidden="true" className="absolute inset-x-10 top-0 h-px bg-transparent" />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="shrink-0 whitespace-nowrap rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-700">PLUS</span>
                    <p className="text-sm font-semibold text-neutral-900">1:1 매칭 플러스</p>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-neutral-600">
                    {plusContactExchangeIncluded
                      ? "기존 혜택 적용 중 · 번호교환 포함 · 새로고침 최근 24시간 2회"
                      : "7일 9,900원부터 · 새로고침 최근 24시간 2회 · 프로필 우선 노출"}
                  </p>
                  {!plusContactExchangeIncluded ? (
                    <p className="mt-1 text-[11px] font-semibold text-neutral-500">번호교환은 기존처럼 건별 결제돼요.</p>
                  ) : null}
                  {plusActive && data?.plus?.expires_at ? (
                    <p className="mt-1 text-[11px] font-medium text-neutral-600">
                      {new Date(data.plus.expires_at).toLocaleString("ko-KR")}까지 이용 가능
                    </p>
                  ) : null}
                </div>
                {plusActive ? (
                  <span className="inline-flex h-8 shrink-0 items-center rounded-full border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 shadow-none">
                    적용 중
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPlusGuideOpen((open) => !open)}
                    className="min-h-[44px] shrink-0 rounded-xl border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 transition hover:bg-neutral-100"
                  >
                    {plusGuideOpen ? "닫기" : "혜택 보기"}
                  </button>
                )}
              </div>
              {!plusActive && plusGuideOpen ? (
                <div className="relative mt-4 border-t border-neutral-200 pt-4">
                  <p className="mb-3 text-xs leading-5 text-neutral-600">짧게 먼저 써보거나, 두 매칭 플러스를 한 번에 시작할 수 있어요.</p>
                  <DatingPlusOffers
                    mode="one_on_one"
                    placement="open_card_one_on_one_panel"
                    oneOnOneCardId={String(activeCards[0]?.id ?? "")}
                  />
                </div>
              ) : null}
            </div>) : null}

            <div ref={matchesSectionRef} tabIndex={-1} data-one-on-one-section="matches" className="scroll-mt-40 rounded-xl border-t border-neutral-200 pt-4 outline-none focus-visible:ring-2 focus-visible:ring-rose-300">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-base font-bold text-neutral-900">진행 중인 매칭</p>
                  <p className="mt-1 text-xs leading-5 text-neutral-500">최근 수락하거나 한마디를 받은 미교환 매칭을 먼저 보여드려요.</p>
                </div>
                <span className="shrink-0 whitespace-nowrap rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-bold text-neutral-500">{ongoingMatches.length}건</span>
              </div>
              {ongoingMatches.length === 0 ? (
                <p className="mt-3 rounded-2xl bg-neutral-50 p-4 text-sm leading-6 text-neutral-500">보낸 요청과 서로 수락한 매칭은 여기에 표시돼요.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  <OneOnOneContactList matches={ongoingMatches} initialVisibleCount={8} pageSize={8}
                    moreLabel="진행 중 매칭 더보기" listClassName="space-y-3" renderMatch={(match) => (
                    <OneOnOneCandidateCard
                      key={match.id}
                      compact={match.state === "proposed"}
                      card={match.counterparty_card}
                      reportTarget={{ type: "one_on_one_match", id: match.id }}
                      onReported={onReported}
                      badge={getOneOnOneMatchLabel(match)}
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
                      {match.role === "source" && match.state === "proposed" && match.source_card_id && match.counterparty_card?.id && onCandidateHidden ?
                        <CandidateHideButton enabled={recommendationGroups.some(group => group.source_card_id === match.source_card_id && group.hides_enabled === true)}
                          sourceCardId={match.source_card_id} candidateId={match.counterparty_card.id}
                          disabled={processingMatchIds.includes(match.id) || refreshingRecommendationIds.length > 0}
                          onHidden={onCandidateHidden} /> : null}
                    </OneOnOneCandidateCard>
                  )} />
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
  impressionTicket,
  compact = false,
  reportTarget,
  onReported,
  card,
  badge,
  badgeClassName,
  note,
  children,
}: {
  impressionTicket?: string | null;
  compact?: boolean;
  card?: OneOnOneCardPreview | null;
  reportTarget?: { type: DatingReportTargetType; id: string };
  onReported?: (result: DatingReportResult) => void;
  badge?: string;
  badgeClassName?: string;
  note?: string;
  children?: ReactNode;
}) {
  const photos = Array.isArray(card?.photo_signed_urls) ? card.photo_signed_urls.filter(Boolean).slice(0, 4) : [];
  const primaryPhoto = photos[0] ?? "";
  const visiblePhotos = compact ? photos : photos.slice(1);
  const name = getOneOnOneDisplayName(card);
  const meta = getOneOnOneMeta(card);

  return (
    <CandidateImpression as="article" ticket={impressionTicket} candidateId={card?.id} className="overflow-hidden rounded-2xl border border-neutral-200 bg-white p-3">
      <div className="flex gap-3">
        {!compact ? <a
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
        </a> : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-neutral-900">{name}</p>
              <p className="mt-1 text-xs font-normal leading-5 text-neutral-500">{meta}</p>
              <OneOnOneCandidateRegionNotice widened={card?.recommendation_region_widened} />
            </div>
            {badge ? (
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${badgeClassName ?? "bg-white text-neutral-600"}`}>
                {badge}
              </span>
            ) : null}
          </div>
          {note ? <p className="mt-2 text-xs font-normal leading-5 text-neutral-600">{note}</p> : null}
          {reportTarget?.id ? <div className="mt-2 flex justify-end"><DatingReportButton
            targetType={reportTarget.type} targetId={reportTarget.id} label={name} onReported={onReported}
          /></div> : null}
        </div>
      </div>

      <OneOnOneProfileSummary intro={card?.intro_text}
        strengths={card?.strengths_text} preferredPartner={card?.preferred_partner_text}
        photos={visiblePhotos.length > 0 ? (
        <div className={`mt-3 grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-3"}`}>
          {visiblePhotos.map((url, idx) => (
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
                alt={compact ? `${name} 후보 사진 ${idx + 1}` : `${name} 추가 사진 ${idx + 2}`}
                loading="lazy"
                decoding="async"
                className="relative z-10 h-full w-full object-contain p-1"
              />
            </a>
          ))}
        </div>
      ) : null}>
      {children}
      </OneOnOneProfileSummary>
    </CandidateImpression>
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
  onContactCheckout: (matchId: string, offerId?: string) => void;
  onContactNudge: (matchId: string, presetKey: OneOnOneContactNudgePresetKey) => void;
}) {
  if (match.role === "source" && match.state === "proposed") {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={processing}
          onClick={() => onMatchAction(match.id, "select_candidate")}
          className="inline-flex min-h-[44px] items-center rounded-xl bg-[#f0003d] px-4 text-xs font-semibold text-white hover:bg-[#d90037] disabled:opacity-50"
        >
          {processing ? "요청 보내는 중..." : "매칭 요청 보내기"}
        </button>
        <Link href="/mypage?section=matching" className="inline-flex min-h-[44px] items-center rounded-xl border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-600 hover:bg-neutral-50">
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
          className="inline-flex min-h-[44px] items-center rounded-xl bg-[#f0003d] px-4 text-xs font-semibold text-white hover:bg-[#d90037] disabled:opacity-50"
        >
          {processing ? "처리 중..." : "수락"}
        </button>
        <button
          type="button"
          disabled={processing}
          onClick={() => onMatchAction(match.id, "candidate_reject")}
          className="inline-flex min-h-[44px] items-center rounded-xl border border-neutral-300 bg-white px-4 text-xs font-medium text-neutral-700 disabled:opacity-50"
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
        <p className="w-full text-xs leading-5 text-neutral-600">상대가 수락했어요. 나도 수락하면 연락처 교환 단계로 넘어가요.</p>
        <button
          type="button"
          disabled={processing}
          onClick={() => onMatchAction(match.id, "source_accept")}
          className="inline-flex min-h-[44px] items-center rounded-xl bg-[#f0003d] px-4 text-xs font-semibold text-white hover:bg-[#d90037] disabled:opacity-50"
        >
          {processing ? "처리 중..." : "나도 수락하기"}
        </button>
        <button
          type="button"
          disabled={processing}
          onClick={() => onMatchAction(match.id, "source_reject")}
          className="inline-flex min-h-[44px] items-center rounded-xl border border-neutral-300 bg-white px-4 text-xs font-medium text-neutral-700 disabled:opacity-50"
        >
          거절
        </button>
      </div>
    );
  }

  if (match.role === "candidate" && match.state === "candidate_accepted") {
    return (
      <p className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
        수락했어요. 상대도 확인하면 연락처 교환 단계로 넘어가요.
      </p>
    );
  }

  if (match.state === "mutual_accepted") {
    if (match.contact_exchange_status === "approved") {
      const canCancelMatch = canCancelOneOnOneMatchPreview(match);
      return (
        <div className="mt-3 border-t border-neutral-200 pt-3">
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
              <Link href="/mypage?section=matching" className="inline-flex min-h-[44px] items-center rounded-xl border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-600 hover:bg-neutral-50">
                상세 보기
              </Link>
            </div>
          ) : null}
        </div>
      );
    }

    if (!canOfferOneOnOneContact(match)) return <OneOnOneContactPending status={match.contact_exchange_status} />;

    return (
      <div className="mt-3 border-t border-neutral-200 pt-3">
        <OneOnOneContactOffer matchId={match.id} name={match.counterparty_card?.name}
          included={contactExchangeIncluded} processing={contactProcessing}
          nudge={match.contact_nudge} nudgeProcessing={nudgeProcessing}
          onExchange={onContactCheckout} onNudge={onContactNudge} />
        <div className="mt-2 flex flex-wrap gap-2">
          <Link href="/mypage?section=matching" className="inline-flex min-h-[44px] items-center rounded-xl border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-600 hover:bg-neutral-50">
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
      </div>
    );
  }

  return null;
}
