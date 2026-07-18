"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/community";
import { formatRemainingToKorean } from "@/lib/dating-open";
import { normalizeNickname, validateNickname } from "@/lib/nickname";
import { pickLoveFortuneFaceAsset } from "@/lib/love-fortune-face-assets";
import { PROVINCE_ORDER } from "@/lib/region-city";
function MyPageWidgetSkeleton({ className = "h-40" }: { className?: string }) {
  return (
    <div className={`rounded-2xl border border-neutral-200 bg-white p-4 ${className}`}>
      <div className="animate-pulse space-y-3">
        <div className="h-4 w-32 rounded bg-neutral-200" />
        <div className="h-20 rounded-xl bg-neutral-100" />
      </div>
    </div>
  );
}

const AdminCertReviewPanel = dynamic(() => import("@/components/AdminCertReviewPanel"), {
  loading: () => <MyPageWidgetSkeleton className="h-56" />,
});

const AdminCommunityModerationPanel = dynamic(() => import("@/components/AdminCommunityModerationPanel"), {
  loading: () => <MyPageWidgetSkeleton className="h-80" />,
});

const AdminDatingCardAiReviewPanel = dynamic(() => import("@/components/admin/AdminDatingCardAiReviewPanel"), {
  loading: () => <MyPageWidgetSkeleton className="h-80" />,
});

const OPEN_KAKAO_URL = process.env.NEXT_PUBLIC_OPENKAKAO_URL ?? "https://open.kakao.com/o/s2gvTdhi";
const PAYMENT_CARD_UNAVAILABLE_MESSAGE =
  "현재 국민/우리/현대 카드는 결제가 되지 않습니다. 다른 카드나 다른 결제수단으로 다시 시도해 주세요.";
const OUTREACH_AUTO_BATCH_DELAY_MS = 1200;
const OUTREACH_AUTO_MAX_BATCHES = 40;
const LOVE_FORTUNE_MASCOT_SRC = "/mascot/love-fortune-cat.png";
const DEFAULT_JIMNYANG_MASCOT_SRC = "/mascot/jimnyang-guide-v2.png";

function waitFor(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function mergeFailureSummary(current: string[] | undefined, next: string[] | undefined) {
  return Array.from(new Set([...(current ?? []), ...(next ?? [])].filter(Boolean))).slice(0, 10);
}

function withPaymentCardNotice(message: string) {
  return `${message}\n${PAYMENT_CARD_UNAVAILABLE_MESSAGE}`;
}

function instagramProfileUrl(value: string | null | undefined) {
  const normalized = (value ?? "")
    .trim()
    .replace(/^@+/, "")
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .split(/[/?#]/)[0]
    .trim();

  return normalized ? `https://www.instagram.com/${encodeURIComponent(normalized)}/` : null;
}

function InstagramProfileLine({
  label,
  username,
  className = "mt-2 text-sm font-medium text-emerald-700",
}: {
  label: string;
  username: string;
  className?: string;
}) {
  const profileUrl = instagramProfileUrl(username);
  const displayUsername = (username ?? "").trim().replace(/^@+/, "") || username;

  return (
    <div className={`${className} flex flex-wrap items-center gap-x-2 gap-y-1`}>
      <span>
        {label}: @{displayUsername}
      </span>
      {profileUrl && (
        <a
          href={profileUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-7 items-center rounded-full border border-emerald-200 bg-white px-2.5 text-[11px] font-semibold text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50"
        >
          인스타 열기
        </a>
      )}
    </div>
  );
}

function oneOnOneContactDisplayName(
  card: { name?: string | null } | null,
  profile: { nickname?: string | null; email?: string | null } | null | undefined,
  userId: string | null | undefined
) {
  const cardName = card?.name?.trim() ?? "";
  const nickname = profile?.nickname?.trim() ?? "";
  const fallback = profile?.email?.trim() || (userId ? `회원 ${userId.slice(0, 8)}` : "-");

  if (cardName && nickname && cardName !== nickname) {
    return `${cardName} (닉네임: ${nickname})`;
  }

  return cardName || nickname || fallback;
}

function adminString(value: unknown, fallback = "-") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function adminDateTime(value: unknown) {
  return typeof value === "string" && value ? new Date(value).toLocaleString("ko-KR") : "-";
}

function oneOnOneMatchStateLabel(value: unknown) {
  const state = String(value ?? "");
  if (state === "proposed") return "후보 전달";
  if (state === "source_selected") return "신청자 선택";
  if (state === "candidate_accepted") return "상대 수락";
  if (state === "mutual_accepted") return "쌍방 수락";
  if (state === "source_skipped") return "신청자 스킵";
  if (state === "candidate_rejected") return "상대 거절";
  if (state === "source_declined") return "최종 거절";
  if (state === "admin_canceled") return "관리자 취소";
  return state || "-";
}

function oneOnOneHistoryEventLabel(value: unknown) {
  const eventType = String(value ?? "");
  if (eventType === "created") return "작성";
  if (eventType === "updated") return "수정";
  if (eventType === "deleted") return "삭제";
  return eventType || "-";
}

type DatingUserReportTargetType =
  | "open_card_application"
  | "paid_card_application"
  | "one_on_one_card"
  | "one_on_one_match";

function SmallDatingReportButton({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 items-center rounded-md border border-neutral-200 bg-white px-3 text-[11px] font-medium text-neutral-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {disabled ? "신고 중..." : "신고"}
    </button>
  );
}

type MyPageTab = "my_cert" | "request_status" | "admin_review";
type MyPageSectionTab = "profile" | "matching" | "payment" | "settings" | "admin";
type MatchingFilter = "all" | "received" | "applied" | "one_on_one" | "quick";

type BodycheckPost = {
  id: string;
  title: string;
  created_at: string;
  score_sum: number;
  vote_count: number;
  average_score: number;
  images: string[] | null;
};

type SummaryResponse = {
  profile: {
    email: string | null;
    nickname: string | null;
    nickname_changed_count: number;
    nickname_change_credits: number;
    phone_verified: boolean;
    phone_verified_at: string | null;
    swipe_profile_visible: boolean;
  };
  weekly_win_count: number;
  bodycheck_posts: BodycheckPost[];
};

type SupportInquiry = {
  id: string;
  category: "payment" | "dating" | "abuse" | "account" | "technical" | "other";
  subject: string;
  message: string;
  contact_email: string | null;
  contact_phone: string | null;
  status: "open" | "answered" | "closed";
  admin_reply: string | null;
  created_at: string;
  answered_at: string | null;
};

type DatingApplicationStatus = {
  id: string;
  created_at: string;
  status: string;
  approved_for_public: boolean;
  display_nickname: string | null;
  age: number | null;
  training_years: number | null;
};

type MyDatingCard = {
  id: string;
  sex: "male" | "female";
  display_nickname: string;
  age: number | null;
  region: string | null;
  photo_visibility?: "blur" | "public" | null;
  status: "pending" | "public" | "expired" | "hidden";
  queue_position?: number | null;
  applicant_count?: number;
  auto_requeue_count?: number | null;
  published_at: string | null;
  expires_at: string | null;
  created_at: string;
};

type ReceivedCardApplication = {
  id: string;
  card_id: string;
  applicant_user_id: string;
  applicant_display_nickname: string | null;
  age: number | null;
  height_cm: number | null;
  region: string | null;
  job: string | null;
  training_years: number | null;
  intro_text: string | null;
  status: "submitted" | "accepted" | "rejected" | "canceled";
  created_at: string;
  instagram_id: string | null;
  photo_signed_urls?: string[];
};

type MyAppliedCardApplication = {
  id: string;
  card_id: string;
  applicant_display_nickname: string | null;
  age: number | null;
  height_cm: number | null;
  region: string | null;
  job: string | null;
  training_years: number | null;
  intro_text: string | null;
  status: "submitted" | "accepted" | "rejected" | "canceled";
  created_at: string;
  card: {
    id: string;
    sex: "male" | "female";
    display_nickname: string | null;
    age: number | null;
    region: string | null;
    height_cm: number | null;
    job: string | null;
    training_years: number | null;
    ideal_type: string | null;
    strengths_text: string | null;
    intro_text: string | null;
    photo_signed_urls?: string[];
    status: "pending" | "public" | "expired" | "hidden";
    expires_at: string | null;
    created_at: string;
    owner_user_id: string;
    owner_nickname: string | null;
  } | null;
};

type DatingConnection = {
  application_id: string;
  card_id: string;
  created_at: string;
  role: "owner" | "applicant" | "swipe_match";
  other_user_id: string;
  other_nickname: string;
  my_instagram_id: string | null;
  other_instagram_id: string | null;
  source?: "open" | "paid" | "swipe";
  matched_card?: {
    display_nickname: string;
    sex: "male" | "female" | null;
    age: number | null;
    region: string | null;
    height_cm: number | null;
    job: string | null;
    training_years: number | null;
    ideal_type: string | null;
    strengths_text: string | null;
    intro_text: string | null;
  } | null;
};

type SwipeStatusCard = {
  id: string;
  sex: "male" | "female" | null;
  display_nickname: string;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  strengths_text: string | null;
  intro_text: string | null;
  image_url?: string | null;
};

type SwipeStatusItem = {
  swipe_id: string;
  created_at: string;
  other_user_id: string;
  matched?: boolean;
  matched_at?: string | null;
  expires_at?: string | null;
  card: SwipeStatusCard | null;
};

type SwipeStatusResponse = {
  summary?: {
    outgoing_pending: number;
    incoming_pending: number;
    mutual_matches: number;
  };
  outgoing_likes?: SwipeStatusItem[];
  incoming_likes?: SwipeStatusItem[];
  error?: string;
};

type SwipeSubscriptionStatus = {
  status: "none" | "pending" | "active";
  dailyLimit: number;
  baseLimit: number;
  premiumLimit: number;
  priceKrw: number;
  durationDays: number;
  activeSubscription?: {
    id: string;
    approvedAt: string | null;
    expiresAt: string | null;
  } | null;
  pendingSubscription?: {
    id: string;
    requestedAt: string | null;
  } | null;
  error?: string;
  message?: string;
};

type MyPaymentCenterOrder = {
  id: string;
  product_type: "apply_credits" | "paid_card" | "more_view" | string;
  product_meta: Record<string, unknown> | null;
  toss_order_id: string;
  order_name: string | null;
  amount: number;
  status: "ready" | "paid" | "failed" | "canceled" | string;
  approved_at: string | null;
  created_at: string;
  method: string | null;
  receiptUrl: string | null;
};

type MyPaymentCenterData = {
  summary: {
    creditsRemaining: number;
    baseLimit?: number;
    baseRemaining: number;
    weekendBenefitActive?: boolean;
    moreViewMale: "none" | "pending" | "approved" | "rejected";
    moreViewFemale: "none" | "pending" | "approved" | "rejected";
  };
  orders: MyPaymentCenterOrder[];
};

type MyLoveFortuneReading = {
  id: string;
  status: "draft" | "pending_payment" | "paid" | "generated" | "refunded" | "canceled" | string;
  calendarType: string;
  birthDate: string;
  birthTime: string;
  birthTimeCertainty: string;
  birthPlace: string | null;
  gender: string;
  loveState: string | null;
  relationshipGoal: string | null;
  meetingPreference: string | null;
  focus: string | null;
  concern: string | null;
  partnerBirthDate: string | null;
  partnerBirthTime: string | null;
  partnerRelation: string | null;
  amount: number;
  aiModel: string | null;
  aiResult: string | null;
  idealFace: {
    title?: string;
    eye?: string;
    smile?: string;
    mood?: string;
    style?: string;
    firstDate?: string;
    avoid?: string;
    note?: string;
    prompt?: string;
  } | null;
  idealFacePrompt: string | null;
  idealFaceImageUrl: string | null;
  paidAt: string | null;
  generatedAt: string | null;
  createdAt: string;
};

const SUPPORT_CATEGORY_LABELS: Record<SupportInquiry["category"], string> = {
  payment: "결제/환불",
  dating: "소개팅 기능",
  abuse: "신고/악용",
  account: "계정/탈퇴",
  technical: "오류/버그",
  other: "기타",
};

const SUPPORT_STATUS_LABELS: Record<SupportInquiry["status"], string> = {
  open: "접수",
  answered: "답변 완료",
  closed: "종결",
};

function formatPaymentProductLabel(order: MyPaymentCenterOrder) {
  if (order.product_type === "apply_credits") return "오픈카드 지원권";
  if (order.product_type === "paid_card") {
    return String(order.order_name ?? "").includes("다시 노출") ? "오픈카드 다시 노출" : "대기 없이 등록";
  }
  if (order.product_type === "more_view") {
    const sex = order.product_meta?.sex;
    return sex === "female" ? "이상형 더보기 · 여자 카드" : sex === "male" ? "이상형 더보기 · 남자 카드" : "이상형 더보기";
  }
  if (order.product_type === "city_view") {
    const province = typeof order.product_meta?.province === "string" ? order.product_meta.province : null;
    return province ? `가까운 후보 30명 보기 · ${province}` : "가까운 후보 30명 보기";
  }
  if (order.product_type === "one_on_one_contact_exchange") return "1:1 번호 즉시 교환";
  if (order.product_type === "one_on_one_priority_24h") return "1:1 우선 추천권";
  if (order.product_type === "one_on_one_plus_30d") return "1:1 매칭 플러스 30일";
  if (order.product_type === "swipe_premium_30d") return "빠른매칭 플러스";
  if (order.product_type === "love_fortune_detail") return "연애운 상세 분석";
  return order.order_name ?? order.product_type;
}

function formatPaymentStatusLabel(status: MyPaymentCenterOrder["status"]) {
  if (status === "paid") return "결제 완료";
  if (status === "failed") return "결제 실패";
  if (status === "canceled") return "결제 취소";
  if (status === "ready") return "결제 생성";
  return status;
}

function formatPaymentResultLabel(order: MyPaymentCenterOrder) {
  if (order.status === "failed") return "결제 실패";
  if (order.status === "canceled") return "결제 취소";
  if (order.status === "ready") return "결제 대기";
  if (order.status !== "paid") return "상태 확인 필요";
  if (order.product_type === "apply_credits") return "지원권 지급 완료";
  if (order.product_type === "paid_card") {
    return String(order.order_name ?? "").includes("다시 노출") ? "오픈카드 재노출 완료" : "유료 등록 결제 확인 완료";
  }
  if (order.product_type === "more_view") return "이상형 더보기 권한 반영 완료";
  if (order.product_type === "city_view") return "가까운 후보 30명 열람권 반영 완료";
  if (order.product_type === "one_on_one_contact_exchange") return "상대 연락처 공개 완료";
  if (order.product_type === "one_on_one_priority_24h") return "1:1 우선 추천 적용 완료";
  if (order.product_type === "one_on_one_plus_30d") return "1:1 매칭 플러스 적용 완료";
  if (order.product_type === "swipe_premium_30d") return "빠른매칭 플러스 적용 완료";
  if (order.product_type === "love_fortune_detail") return "연애운 상세 분석 이용권 반영 완료";
  return "결제 완료";
}

function formatLoveFortuneStatusLabel(status: MyLoveFortuneReading["status"]) {
  if (status === "generated") return "분석 완료";
  if (status === "paid") return "생성 가능";
  if (status === "pending_payment") return "결제 대기";
  if (status === "refunded") return "환불됨";
  if (status === "canceled") return "취소됨";
  return "준비 중";
}

function formatLoveFortuneInputSummary(reading: MyLoveFortuneReading) {
  return [
    reading.birthDate,
    reading.calendarType === "lunar" ? "음력" : reading.calendarType === "lunar_leap" ? "음력 윤달" : "양력",
    reading.loveState,
    reading.relationshipGoal,
  ].filter(Boolean).join(" · ");
}

function parseLoveFortuneReport(text: string | null) {
  if (!text) return [];
  const sections: Array<{ title: string; body: string }> = [];
  let currentTitle = "상세 리포트";
  let currentLines: string[] = [];

  for (const rawLine of text.replace(/```/g, "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*/g, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      if (currentLines.join("\n").trim()) {
        sections.push({ title: currentTitle, body: currentLines.join("\n").trim() });
      }
      currentTitle = heading[1]?.trim() || "상세 리포트";
      currentLines = [];
      continue;
    }
    currentLines.push(rawLine);
  }

  if (currentLines.join("\n").trim()) {
    sections.push({ title: currentTitle, body: currentLines.join("\n").trim() });
  }

  return sections.length > 0 ? sections : [{ title: "상세 리포트", body: text.trim() }];
}

function buildLoveFortuneIdealSketch(reading: MyLoveFortuneReading) {
  const asset = pickLoveFortuneFaceAsset({
    gender: reading.gender,
    idealFace: reading.idealFace,
    seedParts: [reading.birthDate, reading.birthTime, reading.loveState, reading.focus, reading.concern],
  });
  const ideal = reading.idealFace ?? {};

  return {
    label: asset.label,
    src: reading.idealFaceImageUrl || asset.src,
    body: [ideal.eye, ideal.smile, ideal.mood, ideal.style].filter(Boolean).join(" · ") || asset.tone,
  };

}

function adminOpenCardOutreachScopeLabel(scope: AdminOpenCardOutreachScope) {
  if (scope === "no_card") return "오픈카드 없는 회원";
  if (scope === "expired_stale") return "오래전 만료된 회원";
  return "둘 다 포함";
}

function adminOpenCardOutreachPhoneLabel(filter: AdminOpenCardOutreachPhoneFilter) {
  if (filter === "verified") return "휴대폰 인증 완료만";
  if (filter === "unverified") return "휴대폰 미인증만";
  return "휴대폰 인증 전체";
}

function adminOpenCardOutreachRecentLoginLabel(days: number | null) {
  if (!days) return "최근 접속 전체";
  return `최근 ${days}일 내 접속`;
}

function adminOpenCardOutreachRecentMailLabel(filter: AdminOpenCardOutreachRecentMailFilter) {
  if (filter === "not_sent_24h") return "최근 24시간 미발송만";
  if (filter === "sent_24h") return "최근 24시간 발송 성공자만";
  if (filter === "never_sent_success") return "성공 발송 이력 없는 회원만";
  return "최근 24시간 발송 전체";
}

function adminOpenCardOutreachSortLabel(sort: AdminOpenCardOutreachSort) {
  if (sort === "expired_oldest") return "만료 오래된 순";
  if (sort === "recent_login") return "최근 접속 순";
  if (sort === "nickname") return "닉네임 순";
  if (sort === "recent_mail") return "최근 메일 발송 순";
  if (sort === "signup_oldest") return "가입 오래된 순";
  return "우선순위 추천";
}

function adminOneOnOneOutreachScopeLabel(scope: AdminOneOnOneOutreachScope) {
  if (scope === "no_card") return "1:1 카드 없는 회원";
  if (scope === "pending_review") return "1:1 카드 심사중 회원";
  if (scope === "approved_no_match") return "1:1 승인 후 아직 매칭 없는 회원";
  if (scope === "mutual_no_exchange") return "쌍방매칭 후 번호교환 전 회원";
  return "둘 다 포함";
}

function adminOneOnOneOutreachSortLabel(sort: AdminOneOnOneOutreachSort) {
  if (sort === "recent_login") return "최근 접속 순";
  if (sort === "nickname") return "닉네임 순";
  if (sort === "recent_mail") return "최근 메일 발송 순";
  if (sort === "activity_recent") return "최근 1:1 활동 순";
  return "우선순위 추천";
}

type MyPaidCard = {
  id: string;
  nickname: string;
  gender: "M" | "F";
  age: number | null;
  region: string | null;
  display_mode?: "priority_24h" | "instant_public" | null;
  status: "pending" | "approved" | "rejected" | "expired";
  paid_at: string | null;
  expires_at: string | null;
  created_at: string;
  photo_signed_urls?: string[];
};

type ReceivedPaidApplication = {
  id: string;
  card_id: string;
  applicant_user_id: string;
  applicant_display_nickname: string | null;
  age: number | null;
  height_cm: number | null;
  region: string | null;
  job: string | null;
  training_years: number | null;
  intro_text: string | null;
  status: "submitted" | "accepted" | "rejected" | "canceled";
  created_at: string;
  instagram_id: string | null;
  photo_signed_urls?: string[];
};

type MyOneOnOneCard = {
  id: string;
  sex: "male" | "female";
  name: string;
  age: number | null;
  birth_year: number;
  height_cm: number;
  job: string;
  region: string;
  intro_text: string;
  strengths_text: string;
  preferred_partner_text: string;
  smoking: "non_smoker" | "occasional" | "smoker";
  workout_frequency: "none" | "1_2" | "3_4" | "5_plus" | null;
  status: "submitted" | "reviewing" | "approved" | "rejected";
  archived?: boolean;
  admin_note?: string | null;
  admin_tags?: string[] | null;
  reviewed_at?: string | null;
  created_at: string;
  priority_boost_expires_at?: string | null;
  plus_expires_at?: string | null;
  photo_signed_urls?: string[];
};

const ONE_ON_ONE_USER_EDIT_USED_TAG = "one_on_one_user_edit_used";

function hasOneOnOneUserEditBeenUsed(card: Pick<MyOneOnOneCard, "admin_tags">) {
  return Array.isArray(card.admin_tags) && card.admin_tags.includes(ONE_ON_ONE_USER_EDIT_USED_TAG);
}

type MyOneOnOneMatchCard = {
  id: string;
  sex: "male" | "female";
  name: string;
  age: number | null;
  birth_year: number;
  height_cm: number;
  job: string;
  region: string;
  intro_text: string;
  strengths_text: string;
  preferred_partner_text: string;
  smoking: "non_smoker" | "occasional" | "smoker";
  workout_frequency: "none" | "1_2" | "3_4" | "5_plus" | null;
  status: "submitted" | "reviewing" | "approved" | "rejected";
  created_at: string;
  photo_signed_urls?: string[];
};

type MyOneOnOneMatch = {
  id: string;
  role: "source" | "candidate";
  state:
    | "proposed"
    | "source_selected"
    | "source_skipped"
    | "candidate_accepted"
    | "candidate_rejected"
    | "source_declined"
    | "admin_canceled"
    | "mutual_accepted";
  contact_exchange_status:
    | "none"
    | "awaiting_applicant_payment"
    | "payment_pending_admin"
    | "approved"
    | "canceled";
  contact_exchange_requested_at: string | null;
  contact_exchange_paid_at: string | null;
  contact_exchange_paid_by_user_id: string | null;
  contact_exchange_approved_at: string | null;
  contact_exchange_approved_by_user_id: string | null;
  contact_exchange_note: string | null;
  source_phone_share_consented_at: string | null;
  candidate_phone_share_consented_at: string | null;
  action_required: boolean;
  source_card_id: string;
  candidate_card_id: string;
  source_selected_at: string | null;
  candidate_responded_at: string | null;
  source_final_responded_at: string | null;
  created_at: string;
  updated_at: string;
  source_card: MyOneOnOneMatchCard | null;
  candidate_card: MyOneOnOneMatchCard | null;
  counterparty_card: MyOneOnOneMatchCard | null;
  counterparty_phone: string | null;
};

const ONE_ON_ONE_CONTACT_CANCEL_DELAY_MS = 48 * 60 * 60 * 1000;

function canCancelOneOnOneMatch(match: Pick<MyOneOnOneMatch, "state" | "contact_exchange_status" | "contact_exchange_approved_at">) {
  if (match.state !== "mutual_accepted" && match.state !== "candidate_accepted") return false;
  if (match.contact_exchange_status !== "approved") return true;
  const approvedMs = Date.parse(match.contact_exchange_approved_at ?? "");
  return Number.isFinite(approvedMs) && Date.now() - approvedMs >= ONE_ON_ONE_CONTACT_CANCEL_DELAY_MS;
}

type MyOneOnOneAutoRecommendationGroup = {
  source_card_id: string;
  source_card_status?: "submitted" | "reviewing" | "approved" | "rejected";
  refresh_used?: boolean;
  refresh_used_at?: string | null;
  refresh_used_count?: number;
  refresh_remaining?: number;
  refresh_limit?: number;
  next_refresh_at?: string | null;
  can_refresh?: boolean;
  recommendations: MyOneOnOneMatchCard[];
  admin_recommendation_date?: string | null;
  admin_recommendations?: MyOneOnOneMatchCard[];
  admin_recommendation_limit?: number;
};

type MyOneOnOnePhoneBlock = {
  id: string;
  phone_last4: string | null;
  label: string | null;
  created_at: string;
};

type MyDatingContactBlock = {
  id: string;
  block_type: "phone" | "instagram";
  value_hint: string | null;
  label: string | null;
  created_at: string;
};

type AdminOpenCard = {
  id: string;
  owner_user_id: string;
  owner_nickname: string | null;
  sex: "male" | "female";
  display_nickname: string | null;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  strengths_text: string | null;
  ideal_type: string | null;
  instagram_id: string | null;
  total_3lift: number | null;
  percent_all: number | null;
  is_3lift_verified: boolean;
  photo_paths: string[] | null;
  blur_thumb_path: string | null;
  status: "pending" | "public" | "expired" | "hidden";
  published_at: string | null;
  expires_at: string | null;
  created_at: string;
};

type AdminOpenCardEditDraft = {
  display_nickname: string;
  age: string;
  region: string;
  height_cm: string;
  job: string;
  training_years: string;
  strengths_text: string;
  ideal_type: string;
  instagram_id: string;
  total_3lift: string;
  percent_all: string;
};

type AdminOpenCardApplication = {
  id: string;
  card_id: string;
  applicant_user_id: string;
  applicant_nickname: string | null;
  applicant_display_nickname: string | null;
  age: number | null;
  height_cm: number | null;
  region: string | null;
  job: string | null;
  training_years: number | null;
  intro_text: string | null;
  instagram_id: string;
  photo_paths: string[];
  admin_backup_photo_urls?: string[];
  status: "submitted" | "accepted" | "rejected" | "canceled";
  created_at: string;
  accepted_at?: string | null;
  card_owner_user_id?: string | null;
  card_owner_nickname?: string | null;
  card_display_nickname?: string | null;
  card_sex?: "male" | "female" | null;
  card_status?: "pending" | "public" | "expired" | "hidden" | null;
};

type AdminPaidCardApplication = {
  id: string;
  card_id: string;
  applicant_user_id: string;
  applicant_nickname: string | null;
  applicant_display_nickname: string | null;
  age: number | null;
  height_cm: number | null;
  region: string | null;
  job: string | null;
  training_years: number | null;
  intro_text: string | null;
  instagram_id: string;
  photo_paths: string[];
  status: "submitted" | "accepted" | "rejected" | "canceled";
  created_at: string;
  accepted_at?: string | null;
  card_owner_user_id?: string | null;
  card_owner_nickname?: string | null;
  card_nickname?: string | null;
  card_gender?: "M" | "F" | null;
  card_status?: "pending" | "approved" | "rejected" | "expired" | null;
};

type AdminAcceptedRecentApplication = {
  source_kind: "open_card" | "paid_card";
  id: string;
  application_id: string;
  card_id: string;
  applicant_user_id: string;
  applicant_nickname: string | null;
  applicant_display_nickname: string | null;
  age: number | null;
  height_cm: number | null;
  region: string | null;
  job: string | null;
  training_years: number | null;
  intro_text: string | null;
  instagram_id: string;
  created_at: string;
  accepted_at: string | null;
  card_owner_user_id: string | null;
  card_owner_nickname: string | null;
  card_display_name: string | null;
  card_sex_label: string | null;
  card_status: string | null;
  card_region: string | null;
};

type AdminCardSort = "public_first" | "pending_first" | "newest" | "oldest";
type AdminApplicationSort = "newest" | "oldest" | "submitted_first" | "accepted_first";
type AdminDataView = "cards" | "applications";
type AdminManageTab =
  | "site_dashboard"
  | "payment_center"
  | "dating_stats"
  | "dating_insights"
  | "card_ai_review"
  | "user_activity"
  | "open_cards"
  | "reels_dating"
  | "tools_patch_note"
  | "site_mascot"
  | "accepted_applications"
  | "mail_center"
  | "one_on_one_contact"
  | "apply_credits"
  | "swipe_subscriptions"
  | "more_view"
  | "city_view"
  | "community"
  | "phone_verify"
  | "account_deletions"
  | "site_ads";

type AdminUserActivityItem = {
  id: string;
  kind: string;
  label: string;
  at: string | null;
  meta?: Record<string, unknown>;
};

type AdminUserActivityResult = {
  query: string;
  user: {
    id: string;
    email: string | null;
    created_at: string | null;
    last_sign_in_at: string | null;
    phone: string | null;
    phone_confirmed_at: string | null;
    profile: {
      nickname?: string | null;
      role?: string | null;
      phone_verified?: boolean | null;
      phone_e164?: string | null;
      phone_verified_at?: string | null;
      swipe_profile_visible?: boolean | null;
      is_banned?: boolean | null;
      banned_reason?: string | null;
      banned_at?: string | null;
    } | null;
  } | null;
  deleted_audits: Array<{
    id: string;
    auth_user_id: string;
    nickname: string | null;
    email_masked: string | null;
    deletion_mode: string;
    initiated_by_role: string;
    deleted_at: string;
    retention_until: string;
  }>;
  counts: Record<string, number>;
  details?: Record<string, Array<Record<string, unknown>>>;
  activities: AdminUserActivityItem[];
};

type AdminApplyCreditOrder = {
  id: string;
  user_id: string;
  nickname: string | null;
  pack_size: number;
  amount: number;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  processed_at: string | null;
  memo: string | null;
};
type AdminSwipeSubscriptionRequest = {
  id: string;
  user_id: string;
  nickname: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
  amount: number;
  daily_limit: number;
  duration_days: number;
  requested_at: string;
  approved_at: string | null;
  expires_at: string | null;
  note: string | null;
};
type AdminSwipeSubscriptionGrantCandidate = {
  userId: string;
  nickname: string | null;
  email: string | null;
  activeUntil: string | null;
  pending: boolean;
};
type AdminMoreViewRequest = {
  id: string;
  user_id: string;
  nickname: string | null;
  sex: "male" | "female";
  status: "pending" | "approved" | "rejected";
  created_at: string;
  reviewed_at: string | null;
  note: string | null;
};
type AdminMoreViewGrantCandidate = {
  userId: string;
  nickname: string | null;
  email: string | null;
  activeSexes: Array<"male" | "female">;
};
type AdminCityViewRequest = {
  id: string;
  user_id: string;
  nickname: string | null;
  city: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  reviewed_at: string | null;
  note: string | null;
};
type AdminCityViewGrantCandidate = {
  userId: string;
  nickname: string | null;
  email: string | null;
  activeCities: string[];
};
type AdminOneOnOneContactExchangeRequest = {
  id: string;
  state: "mutual_accepted";
  source_user_id: string;
  candidate_user_id: string;
  contact_exchange_status: "none" | "awaiting_applicant_payment" | "payment_pending_admin";
  contact_exchange_requested_at: string | null;
  contact_exchange_paid_at: string | null;
  source_phone_share_consented_at: string | null;
  candidate_phone_share_consented_at: string | null;
  created_at: string;
  source_card: {
    id: string;
    name: string;
    sex: "male" | "female";
    age: number | null;
    region: string;
    phone?: string | null;
  } | null;
  candidate_card: {
    id: string;
    name: string;
    sex: "male" | "female";
    age: number | null;
    region: string;
    phone?: string | null;
  } | null;
  source_profile?: {
    user_id: string | null;
    nickname: string | null;
    email?: string | null;
  } | null;
  candidate_profile?: {
    user_id: string | null;
    nickname: string | null;
    email?: string | null;
  } | null;
};

type AdminOpenCardOutreachScope = "no_card" | "expired_stale" | "combined";
type AdminOpenCardOutreachPhoneFilter = "all" | "verified" | "unverified";
type AdminOpenCardOutreachRecentMailFilter = "all" | "not_sent_24h" | "sent_24h" | "never_sent_success";
type AdminOpenCardOutreachSort = "priority" | "expired_oldest" | "recent_login" | "nickname" | "recent_mail" | "signup_oldest";

type AdminOpenCardOutreachRecipient = {
  user_id: string;
  nickname: string | null;
  email: string | null;
  reason: "no_card" | "expired_stale";
  expired_days: number | null;
  phone_verified: boolean;
  created_at: string | null;
  last_sign_in_at: string | null;
  recent_success_mail_sent_at: string | null;
  successful_mail_sent_at: string | null;
};

type AdminOpenCardOutreachPreview = {
  scope: AdminOpenCardOutreachScope;
  stale_days: number;
  phone_verified_filter: AdminOpenCardOutreachPhoneFilter;
  recent_login_days: number | null;
  recent_mail_filter: AdminOpenCardOutreachRecentMailFilter;
  sort: AdminOpenCardOutreachSort;
  batch_limit: number;
  total_candidate_count: number;
  recipient_count: number;
  no_card_count: number;
  expired_stale_count: number;
  recent_success_24h_count: number;
  successful_mail_count: number;
  subject: string;
  body: string;
  sample_recipients: AdminOpenCardOutreachRecipient[];
};

type AdminOpenCardOutreachSendResult = {
  queued?: boolean;
  background_job_id?: string;
  total_count?: number;
  scope?: AdminOpenCardOutreachScope;
  stale_days?: number;
  phone_verified_filter?: AdminOpenCardOutreachPhoneFilter;
  recent_login_days?: number | null;
  recent_mail_filter?: AdminOpenCardOutreachRecentMailFilter;
  sort?: AdminOpenCardOutreachSort;
  batch_limit?: number;
  send_limit?: number;
  requested: number;
  sent: number;
  failed: number;
  failure_summary?: string[];
  first_failure?: string | null;
};

type AdminOneOnOneOutreachScope =
  | "combined"
  | "no_card"
  | "pending_review"
  | "approved_no_match"
  | "mutual_no_exchange";
type AdminOneOnOneOutreachSort = "priority" | "recent_login" | "nickname" | "recent_mail" | "activity_recent";

type AdminOneOnOneOutreachRecipient = {
  user_id: string;
  nickname: string | null;
  email: string | null;
  reason: Exclude<AdminOneOnOneOutreachScope, "combined">;
  phone_verified: boolean;
  last_sign_in_at: string | null;
  recent_success_mail_sent_at: string | null;
  activity_at: string | null;
};

type AdminOneOnOneOutreachPreview = {
  scope: AdminOneOnOneOutreachScope;
  phone_verified_filter: AdminOpenCardOutreachPhoneFilter;
  recent_login_days: number | null;
  recent_mail_filter: AdminOpenCardOutreachRecentMailFilter;
  sort: AdminOneOnOneOutreachSort;
  send_limit: number;
  total_candidate_count: number;
  recipient_count: number;
  no_card_count: number;
  pending_review_count: number;
  approved_no_match_count: number;
  mutual_no_exchange_count: number;
  recent_success_24h_count: number;
  subject: string;
  body: string;
  sample_recipients: AdminOneOnOneOutreachRecipient[];
};

type AdminOneOnOneOutreachSendResult = {
  queued?: boolean;
  background_job_id?: string;
  total_count?: number;
  scope?: AdminOneOnOneOutreachScope;
  phone_verified_filter?: AdminOpenCardOutreachPhoneFilter;
  recent_login_days?: number | null;
  recent_mail_filter?: AdminOpenCardOutreachRecentMailFilter;
  sort?: AdminOneOnOneOutreachSort;
  send_limit?: number;
  requested: number;
  sent: number;
  failed: number;
  failure_summary?: string[];
  first_failure?: string | null;
};

type AdminDatingStats = {
  open_cards: {
    total: number;
    pending: number;
    public: number;
    hidden: number;
    expired: number;
    male: number;
    female: number;
    applications: {
      total: number;
      submitted: number;
      accepted: number;
      rejected: number;
      canceled: number;
    };
    top_regions: Array<{ region: string; count: number }>;
  };
  paid_cards: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    expired: number;
    blur: number;
    public: number;
    applications: {
      total: number;
      submitted: number;
      accepted: number;
      rejected: number;
      canceled: number;
    };
  };
  one_on_one: {
    cards: {
      total: number;
      submitted: number;
      reviewing: number;
      approved: number;
      rejected: number;
      male: number;
      female: number;
      top_regions: Array<{ region: string; count: number }>;
    };
    matches: {
      total: number;
      proposed: number;
      source_selected: number;
      candidate_accepted: number;
      mutual_accepted: number;
      candidate_rejected: number;
      source_declined: number;
      source_skipped: number;
      admin_canceled: number;
    };
  };
  boosts: {
    more_view: {
      pending: number;
      approved: number;
      rejected: number;
      active: number;
    };
    city_view: {
      pending: number;
      approved: number;
      rejected: number;
      active: number;
    };
  };
};

type AdminPaymentCenterOrder = {
  id: string;
  user_id: string;
  nickname: string | null;
  product_type: "apply_credits" | "paid_card" | "more_view" | string;
  product_meta: Record<string, unknown> | null;
  toss_order_id: string;
  order_name: string | null;
  amount: number;
  status: string;
  payment_key: string | null;
  approved_at: string | null;
  created_at: string;
  method: string | null;
};

type AdminPaymentCenterOverview = {
  summary: {
    applyCreditsPending: number;
    paidCardsPending: number;
    moreViewPending: number;
    swipeSubscriptionsPending: number;
    oneOnOneContactPending: number;
    recentPaidCount: number;
    recentReadyCount: number;
  };
  orders: AdminPaymentCenterOrder[];
};

type AdminSiteDashboardFeatureKey =
  | "new_users"
  | "open_card_created"
  | "open_card_applied"
  | "paid_card_created"
  | "paid_card_applied"
  | "one_on_one_created"
  | "more_view_requested"
  | "city_view_requested"
  | "swipe_likes"
  | "swipe_matches"
  | "apply_credit_orders"
  | "support_inquiries"
  | "cert_requests"
  | "bodybattle_entries"
  | "bodybattle_votes";

type AdminSiteDashboard = {
  generatedAt: string;
  note: string;
  featureLabels: Record<AdminSiteDashboardFeatureKey, string>;
  today: Record<AdminSiteDashboardFeatureKey, number>;
  todayTopFeatures: Array<{
    key: AdminSiteDashboardFeatureKey;
    label: string;
    count: number;
  }>;
  recent7d: Array<{
    dateKey: string;
    label: string;
    counts: Record<AdminSiteDashboardFeatureKey, number>;
  }>;
  current: {
    totalUsers: number;
    adminUsers: number;
    phoneVerifiedUsers: number;
    swipeVisibleUsers: number;
    publicOpenCards: number;
    pendingOpenCards: number;
    pendingOpenCardsMale: number;
    pendingOpenCardsFemale: number;
    totalOpenCardApplications: number;
    publicPaidCards: number;
    totalPaidCardApplications: number;
    approvedOneOnOneCards: number;
    pendingOneOnOneCards: number;
    activeMoreView: number;
    activeCityView: number;
    openSupport: number;
    totalSupportInquiries: number;
    answeredSupportTotal: number;
    pendingCertRequests: number;
    approvedCertRequests: number;
    pendingApplyCreditOrders: number;
    approvedApplyCreditOrders: number;
    pendingSwipeSubscriptions: number;
    activeSwipeSubscriptions: number;
    totalOpenCardMatches: number;
    totalSwipeMatches: number;
    totalDatingMatches: number;
    todayAnsweredSupport: number;
  };
  averages: {
    openCardApplicationsPerPublicCard: number;
    paidCardApplicationsPerApprovedCard: number;
  };
};

type DatingInsightSignalKey =
  | "kindness"
  | "conversation"
  | "fitness"
  | "clean_lifestyle"
  | "stability"
  | "height_body"
  | "appearance"
  | "habits";

type AdminDatingInsights = {
  generated_at: string;
  totals: {
    total: number;
    female: number;
    male: number;
    by_source: {
      open_card: number;
      paid_card: number;
      one_on_one: number;
    };
  };
  female_preference: {
    response_count: number;
    top_signals: Array<{
      key: DatingInsightSignalKey;
      count: number;
      share_pct: number;
    }>;
    top_tokens: Array<{
      token: string;
      count: number;
      share_pct: number;
    }>;
  };
  male_preference: {
    response_count: number;
    top_signals: Array<{
      key: DatingInsightSignalKey;
      count: number;
      share_pct: number;
    }>;
    top_tokens: Array<{
      token: string;
      count: number;
      share_pct: number;
    }>;
  };
  contrast: Array<{
    key: DatingInsightSignalKey;
    female_share_pct: number;
    male_share_pct: number;
    gap_pct: number;
    common_share_pct: number;
  }>;
};

const DATING_INSIGHT_SIGNAL_LABELS: Record<DatingInsightSignalKey, string> = {
  kindness: "다정함/배려",
  conversation: "대화/티키타카",
  fitness: "운동/자기관리",
  clean_lifestyle: "비흡연/깔끔함",
  stability: "성실/안정감",
  height_body: "키/체격",
  appearance: "외모/인상",
  habits: "생활습관/루틴",
};

type AdminAccountDeletionAudit = {
  id: string;
  auth_user_id: string;
  nickname: string | null;
  email_masked: string | null;
  ip_address: string | null;
  user_agent: string | null;
  deletion_mode: "hard" | "soft";
  initiated_by_role: "self" | "admin";
  deleted_at: string;
  retention_until: string;
};

type AdminAccountDeletionAuditsResponse = {
  ok?: boolean;
  error?: string;
  fallbackUsed?: boolean;
  items?: AdminAccountDeletionAudit[];
};

type MyCertificate = {
  id: string;
  certificate_no: string;
  slug: string;
  pdf_url: string;
  issued_at: string;
};

type MyCertRequest = {
  id: string;
  submit_code: string;
  status: "pending" | "needs_info" | "approved" | "rejected";
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  sex: "male" | "female";
  bodyweight: number | null;
  squat: number;
  bench: number;
  deadlift: number;
  total: number;
  video_url?: string | null;
  certificates?: MyCertificate[] | null;
};

type ChangeNicknameResult = {
  success: boolean;
  code: string;
  message: string;
  nickname?: string;
  nickname_changed_count?: number;
  nickname_change_credits?: number;
};

type MyAppliedPaidApplication = {
  id: string;
  card_id: string;
  applicant_display_nickname: string | null;
  age: number | null;
  height_cm: number | null;
  region: string | null;
  job: string | null;
  training_years: number | null;
  intro_text: string | null;
  status: "submitted" | "accepted" | "rejected" | "canceled";
  created_at: string;
  card: {
    id: string;
    gender: "M" | "F";
    nickname: string | null;
    status: "pending" | "approved" | "rejected" | "expired";
    expires_at: string | null;
    created_at: string;
    owner_user_id: string;
    owner_nickname: string | null;
  } | null;
};

type ApplyCreditsStatusResponse = {
  creditsRemaining?: number;
};

type AdInquirySettingsResponse = {
  enabled?: boolean;
  title?: string;
  description?: string;
  cta?: string;
  linkUrl?: string;
  badge?: string;
  theme?: "emerald" | "rose" | "violet" | "sky" | "amber" | "neutral";
};

type OpenCardHomeCopyResponse = {
  subtitle?: string;
};

type OpenCardPublicSlotsSetting = {
  maleExtra?: number;
  femaleExtra?: number;
  maleBaseLimit?: number;
  femaleBaseLimit?: number;
  maleEffectiveLimit?: number;
  femaleEffectiveLimit?: number;
};

type OpenCardPublicSlotsResponse = OpenCardPublicSlotsSetting & {
  ok?: boolean;
  error?: string;
  setting?: OpenCardPublicSlotsSetting;
};

type ToolsPatchNoteResponse = {
  enabled?: boolean;
  text?: string;
  items?: Array<{
    id: string;
    text: string;
    createdAt: string;
  }>;
};

type SiteGuideMascotOption = {
  id: string;
  label: string;
  src: string;
};

type SiteGuideMascotResponse = {
  selectedId?: string;
  selected?: SiteGuideMascotOption;
  options?: SiteGuideMascotOption[];
};

type AdminEmailUnsubscribeItem = {
  id: string;
  user_id: string;
  email: string | null;
  nickname: string | null;
  campaign_key: string;
  source: string | null;
  reason: string | null;
  unsubscribed_at: string;
  created_at: string | null;
};

type AdminReelsDatingListing = {
  id: string;
  title: string;
  description: string | null;
  instagram_url?: string | null;
  status: "active" | "hidden";
  sort_order: number | null;
  created_at: string;
  updated_at: string | null;
};

type AdminReelsDatingApplication = {
  id: string;
  listing_id: string;
  applicant_user_id: string;
  applicant_display_nickname: string | null;
  age: number | null;
  height_cm: number | null;
  region: string | null;
  job: string | null;
  training_years: number | null;
  instagram_id: string | null;
  intro_text: string | null;
  photo_path?: string | null;
  photo_signed_url?: string | null;
  status: "submitted" | "reviewed" | "archived";
  created_at: string;
};

const DEFAULT_OPEN_CARD_HOME_SUBTITLE = "둘러보고 바로 지원하거나, 내 카드도 자연스럽게 공개할 수 있어요.";
const DEFAULT_TOOLS_PATCH_NOTE_TEXT = "오늘의 개선 내용을 한 줄로 적어주세요.";
const DEFAULT_SITE_GUIDE_MASCOT_OPTIONS: SiteGuideMascotOption[] = [
  { id: "default", label: "기본 짐냥이", src: DEFAULT_JIMNYANG_MASCOT_SRC },
  { id: "summer", label: "여름 짐냥이", src: "/mascot/jimnyang-summer.webp" },
  { id: "rain", label: "비 오는 짐냥이", src: "/mascot/jimnyang-rain.webp" },
];
const TOOLS_PATCH_NOTE_PRESETS = [
  "1:1 번호교환 승인 목록을 더 잘 보이게 개선했어요.",
  "도구 탭에서 새 소식을 확인할 수 있어요.",
  "오픈카드와 1:1 이용 흐름을 더 안정적으로 다듬었어요.",
  "빠른매칭 후보 노출과 사진 로딩을 점검했어요.",
];

export default function MyPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [certRequests, setCertRequests] = useState<MyCertRequest[]>([]);
  const [datingApplication, setDatingApplication] = useState<DatingApplicationStatus | null>(null);
  const [myDatingCards, setMyDatingCards] = useState<MyDatingCard[]>([]);
  const [receivedApplications, setReceivedApplications] = useState<ReceivedCardApplication[]>([]);
  const [myAppliedCardApplications, setMyAppliedCardApplications] = useState<MyAppliedCardApplication[]>([]);
  const [myPaidCards, setMyPaidCards] = useState<MyPaidCard[]>([]);
  const [receivedPaidApplications, setReceivedPaidApplications] = useState<ReceivedPaidApplication[]>([]);
  const [myAppliedPaidApplications, setMyAppliedPaidApplications] = useState<MyAppliedPaidApplication[]>([]);
  const [myOneOnOneCards, setMyOneOnOneCards] = useState<MyOneOnOneCard[]>([]);
  const [myOneOnOneMatches, setMyOneOnOneMatches] = useState<MyOneOnOneMatch[]>([]);
  const [myOneOnOneAutoRecommendations, setMyOneOnOneAutoRecommendations] = useState<MyOneOnOneAutoRecommendationGroup[]>([]);
  const [myOneOnOnePhoneBlocks, setMyOneOnOnePhoneBlocks] = useState<MyOneOnOnePhoneBlock[]>([]);
  const [oneOnOneBlockPhoneInput, setOneOnOneBlockPhoneInput] = useState("");
  const [oneOnOneBlockLabelInput, setOneOnOneBlockLabelInput] = useState("");
  const [oneOnOnePhoneBlockSubmitting, setOneOnOnePhoneBlockSubmitting] = useState(false);
  const [deletingOneOnOnePhoneBlockIds, setDeletingOneOnOnePhoneBlockIds] = useState<string[]>([]);
  const [savingOpenCardVisibilityIds, setSavingOpenCardVisibilityIds] = useState<string[]>([]);
  const [datingConnections, setDatingConnections] = useState<DatingConnection[]>([]);
  const [swipeStatusSummary, setSwipeStatusSummary] = useState<SwipeStatusResponse["summary"] | null>(null);
  const [myOutgoingSwipeLikes, setMyOutgoingSwipeLikes] = useState<SwipeStatusItem[]>([]);
  const [myIncomingSwipeLikes, setMyIncomingSwipeLikes] = useState<SwipeStatusItem[]>([]);
  const [swipeStatusPanelOpen, setSwipeStatusPanelOpen] = useState(false);
  const [swipeStatusLoaded, setSwipeStatusLoaded] = useState(false);
  const [swipeStatusLoading, setSwipeStatusLoading] = useState(false);
  const [swipeStatusView, setSwipeStatusView] = useState<"incoming" | "outgoing">("incoming");
  const [adminOpenCards, setAdminOpenCards] = useState<AdminOpenCard[]>([]);
  const [adminOpenCardApplications, setAdminOpenCardApplications] = useState<AdminOpenCardApplication[]>([]);
  const [adminPaidCardApplications, setAdminPaidCardApplications] = useState<AdminPaidCardApplication[]>([]);
  const [adminAcceptedRecentApplications, setAdminAcceptedRecentApplications] = useState<AdminAcceptedRecentApplication[]>([]);
  const [adminAcceptedRecentFallback, setAdminAcceptedRecentFallback] = useState(false);
  const [adminAcceptedRecentLoaded, setAdminAcceptedRecentLoaded] = useState(false);
  const [adminAcceptedRecentLoading, setAdminAcceptedRecentLoading] = useState(false);
  const [adminOpenCardsLoaded, setAdminOpenCardsLoaded] = useState(false);
  const [adminOpenCardsLoading, setAdminOpenCardsLoading] = useState(false);
  const [adminOneOnOneContactRequests, setAdminOneOnOneContactRequests] = useState<AdminOneOnOneContactExchangeRequest[]>([]);
  const [, setAdminOneOnOneContactLoaded] = useState(false);
  const [adminOneOnOneContactLoading, setAdminOneOnOneContactLoading] = useState(false);
  const [adminOneOnOneContactSearch, setAdminOneOnOneContactSearch] = useState("");
  const [adminOpenCardOutreachScope, setAdminOpenCardOutreachScope] = useState<AdminOpenCardOutreachScope>("combined");
  const [adminOpenCardOutreachStaleDays, setAdminOpenCardOutreachStaleDays] = useState("30");
  const [adminOpenCardOutreachPhoneFilter, setAdminOpenCardOutreachPhoneFilter] =
    useState<AdminOpenCardOutreachPhoneFilter>("all");
  const [adminOpenCardOutreachRecentLoginDays, setAdminOpenCardOutreachRecentLoginDays] = useState("30");
  const [adminOpenCardOutreachRecentMailFilter, setAdminOpenCardOutreachRecentMailFilter] =
    useState<AdminOpenCardOutreachRecentMailFilter>("never_sent_success");
  const [adminOpenCardOutreachSort, setAdminOpenCardOutreachSort] =
    useState<AdminOpenCardOutreachSort>("signup_oldest");
  const [adminOpenCardOutreachBatchLimit, setAdminOpenCardOutreachBatchLimit] = useState("150");
  const [adminOpenCardOutreachPreview, setAdminOpenCardOutreachPreview] = useState<AdminOpenCardOutreachPreview | null>(null);
  const [adminOpenCardOutreachLoading, setAdminOpenCardOutreachLoading] = useState(false);
  const [adminOpenCardOutreachSending, setAdminOpenCardOutreachSending] = useState(false);
  const [adminOpenCardOutreachSubject, setAdminOpenCardOutreachSubject] = useState("");
  const [adminOpenCardOutreachBody, setAdminOpenCardOutreachBody] = useState("");
  const [adminOpenCardOutreachResult, setAdminOpenCardOutreachResult] = useState<AdminOpenCardOutreachSendResult | null>(null);
  const [adminOneOnOneOutreachScope, setAdminOneOnOneOutreachScope] = useState<AdminOneOnOneOutreachScope>("combined");
  const [adminOneOnOneOutreachPhoneFilter, setAdminOneOnOneOutreachPhoneFilter] =
    useState<AdminOpenCardOutreachPhoneFilter>("all");
  const [adminOneOnOneOutreachRecentLoginDays, setAdminOneOnOneOutreachRecentLoginDays] = useState("30");
  const [adminOneOnOneOutreachRecentMailFilter, setAdminOneOnOneOutreachRecentMailFilter] =
    useState<AdminOpenCardOutreachRecentMailFilter>("not_sent_24h");
  const [adminOneOnOneOutreachSort, setAdminOneOnOneOutreachSort] =
    useState<AdminOneOnOneOutreachSort>("priority");
  const [adminOneOnOneOutreachPreview, setAdminOneOnOneOutreachPreview] = useState<AdminOneOnOneOutreachPreview | null>(null);
  const [adminOneOnOneOutreachLoading, setAdminOneOnOneOutreachLoading] = useState(false);
  const [adminOneOnOneOutreachSending, setAdminOneOnOneOutreachSending] = useState(false);
  const [adminOneOnOneOutreachSubject, setAdminOneOnOneOutreachSubject] = useState("");
  const [adminOneOnOneOutreachBody, setAdminOneOnOneOutreachBody] = useState("");
  const [adminOneOnOneOutreachResult, setAdminOneOnOneOutreachResult] = useState<AdminOneOnOneOutreachSendResult | null>(null);
  const [editingAdminOpenCardId, setEditingAdminOpenCardId] = useState<string | null>(null);
  const [adminOpenCardDraft, setAdminOpenCardDraft] = useState<AdminOpenCardEditDraft | null>(null);
  const [savingAdminOpenCard, setSavingAdminOpenCard] = useState(false);
  const [adminCardSort, setAdminCardSort] = useState<AdminCardSort>("public_first");
  const [adminApplicationSort, setAdminApplicationSort] = useState<AdminApplicationSort>("newest");
  const [adminDataView, setAdminDataView] = useState<AdminDataView>("cards");
  const [adminManageTab, setAdminManageTab] = useState<AdminManageTab>("site_dashboard");
  const [adminReelsDatingListings, setAdminReelsDatingListings] = useState<AdminReelsDatingListing[]>([]);
  const [adminReelsDatingApplications, setAdminReelsDatingApplications] = useState<AdminReelsDatingApplication[]>([]);
  const [adminReelsDatingLoaded, setAdminReelsDatingLoaded] = useState(false);
  const [adminReelsDatingLoading, setAdminReelsDatingLoading] = useState(false);
  const [adminReelsDatingSaving, setAdminReelsDatingSaving] = useState(false);
  const [adminReelsDatingEditingId, setAdminReelsDatingEditingId] = useState("");
  const [adminReelsDatingDraft, setAdminReelsDatingDraft] = useState({
    title: "",
    description: "",
    instagram_url: "",
    status: "active" as "active" | "hidden",
    sort_order: "0",
  });
  const [adminReelsDatingError, setAdminReelsDatingError] = useState("");
  const [adminReelsDatingInfo, setAdminReelsDatingInfo] = useState("");
  const [adminApplyCreditOrders, setAdminApplyCreditOrders] = useState<AdminApplyCreditOrder[]>([]);
  const [adminSwipeSubscriptionRequests, setAdminSwipeSubscriptionRequests] = useState<AdminSwipeSubscriptionRequest[]>([]);
  const [adminMoreViewRequests, setAdminMoreViewRequests] = useState<AdminMoreViewRequest[]>([]);
  const [adminCityViewRequests, setAdminCityViewRequests] = useState<AdminCityViewRequest[]>([]);
  const [adminApplyCreditSearch, setAdminApplyCreditSearch] = useState("");
  const [adminApplyCreditGrantNickname, setAdminApplyCreditGrantNickname] = useState("");
  const [adminApplyCreditGrantLoading, setAdminApplyCreditGrantLoading] = useState(false);
  const [adminSwipeSubscriptionSearch, setAdminSwipeSubscriptionSearch] = useState("");
  const [adminSwipeSubscriptionGrantQuery, setAdminSwipeSubscriptionGrantQuery] = useState("");
  const [adminSwipeSubscriptionGrantCandidates, setAdminSwipeSubscriptionGrantCandidates] = useState<AdminSwipeSubscriptionGrantCandidate[]>([]);
  const [adminSwipeSubscriptionGrantLoading, setAdminSwipeSubscriptionGrantLoading] = useState(false);
  const [adminSwipeSubscriptionGrantingUserId, setAdminSwipeSubscriptionGrantingUserId] = useState<string | null>(null);
  const [adminSwipeSubscriptionGrantError, setAdminSwipeSubscriptionGrantError] = useState("");
  const [adminSwipeSubscriptionGrantInfo, setAdminSwipeSubscriptionGrantInfo] = useState("");
  const [adminMoreViewSearch, setAdminMoreViewSearch] = useState("");
  const [adminDatingStats, setAdminDatingStats] = useState<AdminDatingStats | null>(null);
  const [adminDatingInsights, setAdminDatingInsights] = useState<AdminDatingInsights | null>(null);
  const [adminSiteDashboard, setAdminSiteDashboard] = useState<AdminSiteDashboard | null>(null);
  const [adminSiteDashboardLoading, setAdminSiteDashboardLoading] = useState(false);
  const [adminSiteDashboardError, setAdminSiteDashboardError] = useState("");
  const [adminPaymentCenter, setAdminPaymentCenter] = useState<AdminPaymentCenterOverview | null>(null);
  const [adminPaymentCenterLoading, setAdminPaymentCenterLoading] = useState(false);
  const [adminPaymentCenterError, setAdminPaymentCenterError] = useState("");
  const [adminAccountDeletionAudits, setAdminAccountDeletionAudits] = useState<AdminAccountDeletionAudit[]>([]);
  const [adminAccountDeletionAuditError, setAdminAccountDeletionAuditError] = useState("");
  const [adminCityViewSearch, setAdminCityViewSearch] = useState("");
  const [adminMoreViewGrantQuery, setAdminMoreViewGrantQuery] = useState("");
  const [adminMoreViewGrantSex, setAdminMoreViewGrantSex] = useState<"male" | "female">("male");
  const [adminMoreViewGrantCandidates, setAdminMoreViewGrantCandidates] = useState<AdminMoreViewGrantCandidate[]>([]);
  const [adminMoreViewGrantLoading, setAdminMoreViewGrantLoading] = useState(false);
  const [adminMoreViewGrantingUserId, setAdminMoreViewGrantingUserId] = useState<string | null>(null);
  const [adminMoreViewGrantError, setAdminMoreViewGrantError] = useState("");
  const [adminMoreViewGrantInfo, setAdminMoreViewGrantInfo] = useState("");
  const [adminCityViewGrantQuery, setAdminCityViewGrantQuery] = useState("");
  const [adminCityViewGrantProvince, setAdminCityViewGrantProvince] = useState<string>(PROVINCE_ORDER[0] ?? "서울");
  const [adminCityViewGrantCandidates, setAdminCityViewGrantCandidates] = useState<AdminCityViewGrantCandidate[]>([]);
  const [adminCityViewGrantLoading, setAdminCityViewGrantLoading] = useState(false);
  const [adminCityViewGrantingUserId, setAdminCityViewGrantingUserId] = useState<string | null>(null);
  const [adminCityViewGrantError, setAdminCityViewGrantError] = useState("");
  const [adminCityViewGrantInfo, setAdminCityViewGrantInfo] = useState("");
  const [adminCityViewUnblockIdentifier, setAdminCityViewUnblockIdentifier] = useState("");
  const [adminCityViewUnblockLoading, setAdminCityViewUnblockLoading] = useState(false);
  const [adminCityViewUnblockInfo, setAdminCityViewUnblockInfo] = useState("");
  const [adminCityViewUnblockError, setAdminCityViewUnblockError] = useState("");
  const [adminQueueRefreshing, setAdminQueueRefreshing] = useState(false);
  const [approvingOrderIds, setApprovingOrderIds] = useState<string[]>([]);
  const [processingMoreViewIds, setProcessingMoreViewIds] = useState<string[]>([]);
  const [processingSwipeSubscriptionIds, setProcessingSwipeSubscriptionIds] = useState<string[]>([]);
  const [processingCityViewIds, setProcessingCityViewIds] = useState<string[]>([]);
  const [processingOneOnOneMatchIds, setProcessingOneOnOneMatchIds] = useState<string[]>([]);
  const [processingOneOnOneContactExchangeIds, setProcessingOneOnOneContactExchangeIds] = useState<string[]>([]);
  const [processingOneOnOneAutoKeys, setProcessingOneOnOneAutoKeys] = useState<string[]>([]);
  const [reportingDatingTargetKeys, setReportingDatingTargetKeys] = useState<string[]>([]);
  const [processingSwipeLikeBackIds, setProcessingSwipeLikeBackIds] = useState<string[]>([]);
  const [reopeningOpenCardIds, setReopeningOpenCardIds] = useState<string[]>([]);
  const [reactivatingOpenCardIds, setReactivatingOpenCardIds] = useState<string[]>([]);
  const [deletingSwipeLikeIds, setDeletingSwipeLikeIds] = useState<string[]>([]);
  const [deletingConnectionIds, setDeletingConnectionIds] = useState<string[]>([]);
  const [cancelingAppliedIds, setCancelingAppliedIds] = useState<string[]>([]);
  const [showAllOutgoingSwipeLikes, setShowAllOutgoingSwipeLikes] = useState(false);
  const [showAllIncomingSwipeLikes, setShowAllIncomingSwipeLikes] = useState(false);
  const [refreshingOneOnOneRecommendationIds, setRefreshingOneOnOneRecommendationIds] = useState<string[]>([]);
  const [openCardWriteEnabled, setOpenCardWriteEnabled] = useState(true);
  const [openCardWriteSaving, setOpenCardWriteSaving] = useState(false);
  const [openCardHomeSubtitle, setOpenCardHomeSubtitle] = useState(DEFAULT_OPEN_CARD_HOME_SUBTITLE);
  const [openCardHomeCopySaving, setOpenCardHomeCopySaving] = useState(false);
  const [openCardHomeCopyError, setOpenCardHomeCopyError] = useState("");
  const [openCardHomeCopyInfo, setOpenCardHomeCopyInfo] = useState("");
  const [openCardPublicMaleExtra, setOpenCardPublicMaleExtra] = useState("0");
  const [openCardPublicFemaleExtra, setOpenCardPublicFemaleExtra] = useState("0");
  const [openCardPublicMaleEffectiveLimit, setOpenCardPublicMaleEffectiveLimit] = useState(30);
  const [openCardPublicFemaleEffectiveLimit, setOpenCardPublicFemaleEffectiveLimit] = useState(30);
  const [openCardPublicSlotsSaving, setOpenCardPublicSlotsSaving] = useState(false);
  const [openCardPublicSlotsError, setOpenCardPublicSlotsError] = useState("");
  const [openCardPublicSlotsInfo, setOpenCardPublicSlotsInfo] = useState("");
  const [adInquiryEnabled, setAdInquiryEnabled] = useState(true);
  const [adInquiryTitle, setAdInquiryTitle] = useState("");
  const [adInquiryDescription, setAdInquiryDescription] = useState("");
  const [adInquiryCta, setAdInquiryCta] = useState("");
  const [adInquiryLinkUrl, setAdInquiryLinkUrl] = useState("");
  const [adInquiryBadge, setAdInquiryBadge] = useState("");
  const [adInquiryTheme, setAdInquiryTheme] = useState<"emerald" | "rose" | "violet" | "sky" | "amber" | "neutral">("emerald");
  const [adInquirySaving, setAdInquirySaving] = useState(false);
  const [adInquiryError, setAdInquiryError] = useState("");
  const [adInquiryInfo, setAdInquiryInfo] = useState("");
  const [toolsPatchNoteEnabled, setToolsPatchNoteEnabled] = useState(false);
  const [toolsPatchNoteText, setToolsPatchNoteText] = useState("");
  const [toolsPatchNoteItems, setToolsPatchNoteItems] = useState<ToolsPatchNoteResponse["items"]>([]);
  const [editingToolsPatchNoteId, setEditingToolsPatchNoteId] = useState("");
  const [editingToolsPatchNoteText, setEditingToolsPatchNoteText] = useState("");
  const [toolsPatchNoteSaving, setToolsPatchNoteSaving] = useState(false);
  const [toolsPatchNoteError, setToolsPatchNoteError] = useState("");
  const [toolsPatchNoteInfo, setToolsPatchNoteInfo] = useState("");
  const [siteGuideMascotId, setSiteGuideMascotId] = useState("default");
  const [siteGuideMascotOptions, setSiteGuideMascotOptions] = useState<SiteGuideMascotOption[]>(
    DEFAULT_SITE_GUIDE_MASCOT_OPTIONS
  );
  const [siteGuideMascotSaving, setSiteGuideMascotSaving] = useState(false);
  const [siteGuideMascotUploading, setSiteGuideMascotUploading] = useState(false);
  const [siteGuideMascotError, setSiteGuideMascotError] = useState("");
  const [siteGuideMascotInfo, setSiteGuideMascotInfo] = useState("");
  const [adminEmailUnsubscribeQuery, setAdminEmailUnsubscribeQuery] = useState("");
  const [adminEmailUnsubscribeItems, setAdminEmailUnsubscribeItems] = useState<AdminEmailUnsubscribeItem[]>([]);
  const [adminEmailUnsubscribeLoading, setAdminEmailUnsubscribeLoading] = useState(false);
  const [adminEmailUnsubscribeError, setAdminEmailUnsubscribeError] = useState("");
  const [adminEmailUnsubscribeInfo, setAdminEmailUnsubscribeInfo] = useState("");
  const [adminEmailUnsubscribeDeletingIds, setAdminEmailUnsubscribeDeletingIds] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState<MyPageTab>("my_cert");
  const [pageSectionTab, setPageSectionTab] = useState<MyPageSectionTab>("profile");
  const [matchingFilter, setMatchingFilter] = useState<MatchingFilter>("all");
  const [error, setError] = useState("");
  const [marketingOptedOut, setMarketingOptedOut] = useState<boolean | null>(null);
  const [marketingConsentLoading, setMarketingConsentLoading] = useState(false);
  const [marketingConsentMessage, setMarketingConsentMessage] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [accountDeleteConfirmOpen, setAccountDeleteConfirmOpen] = useState(false);
  const [deletingAppliedIds, setDeletingAppliedIds] = useState<string[]>([]);
  const [deletingPaidAppliedIds, setDeletingPaidAppliedIds] = useState<string[]>([]);
  const [cancelingPaidAppliedIds, setCancelingPaidAppliedIds] = useState<string[]>([]);
  const [deletingOneOnOneIds, setDeletingOneOnOneIds] = useState<string[]>([]);
  const [deletingOpenCardIds, setDeletingOpenCardIds] = useState<string[]>([]);
  const [deletingPaidCardIds, setDeletingPaidCardIds] = useState<string[]>([]);
  const [applyCreditsRemaining, setApplyCreditsRemaining] = useState(0);
  const [myDatingContactBlocks, setMyDatingContactBlocks] = useState<MyDatingContactBlock[]>([]);
  const [datingContactBlockType, setDatingContactBlockType] = useState<"phone" | "instagram">("phone");
  const [datingContactBlockValue, setDatingContactBlockValue] = useState("");
  const [datingContactBlockLabel, setDatingContactBlockLabel] = useState("");
  const [datingContactBlockSubmitting, setDatingContactBlockSubmitting] = useState(false);
  const [deletingDatingContactBlockIds, setDeletingDatingContactBlockIds] = useState<string[]>([]);

  const [nicknameOpen, setNicknameOpen] = useState(false);
  const [newNickname, setNewNickname] = useState("");
  const [nicknameError, setNicknameError] = useState("");
  const [nicknameInfo, setNicknameInfo] = useState("");
  const [savingNickname, setSavingNickname] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneOtpCode, setPhoneOtpCode] = useState("");
  const [phoneOtpPending, setPhoneOtpPending] = useState<string | null>(null);
  const [phoneOtpResendAfterSec, setPhoneOtpResendAfterSec] = useState(0);
  const [sendingPhoneOtp, setSendingPhoneOtp] = useState(false);
  const [verifyingPhoneOtp, setVerifyingPhoneOtp] = useState(false);
  const [phoneVerifyError, setPhoneVerifyError] = useState("");
  const [phoneVerifyInfo, setPhoneVerifyInfo] = useState("");
  const [adminPhoneIdentifier, setAdminPhoneIdentifier] = useState("");
  const [adminPhoneNumber, setAdminPhoneNumber] = useState("");
  const [adminPhoneVerifyLoading, setAdminPhoneVerifyLoading] = useState(false);
  const [adminPhoneVerifyError, setAdminPhoneVerifyError] = useState("");
  const [adminPhoneVerifyInfo, setAdminPhoneVerifyInfo] = useState("");
  const [adminUserActivityQuery, setAdminUserActivityQuery] = useState("");
  const [adminUserActivityLoading, setAdminUserActivityLoading] = useState(false);
  const [adminUserActivityError, setAdminUserActivityError] = useState("");
  const [adminUserActivityResult, setAdminUserActivityResult] = useState<AdminUserActivityResult | null>(null);
  const [adminNicknameDraft, setAdminNicknameDraft] = useState("");
  const [adminNicknameSaving, setAdminNicknameSaving] = useState(false);
  const [adminNicknameError, setAdminNicknameError] = useState("");
  const [adminNicknameInfo, setAdminNicknameInfo] = useState("");
  const [adminBanReason, setAdminBanReason] = useState("운영정책 위반");
  const [adminBanSaving, setAdminBanSaving] = useState(false);
  const [adminBanError, setAdminBanError] = useState("");
  const [adminBanInfo, setAdminBanInfo] = useState("");
  const [adminOneOnOneBlockQuery, setAdminOneOnOneBlockQuery] = useState("");
  const [adminOneOnOneBlockSaving, setAdminOneOnOneBlockSaving] = useState(false);
  const [adminOneOnOneBlockError, setAdminOneOnOneBlockError] = useState("");
  const [adminOneOnOneBlockInfo, setAdminOneOnOneBlockInfo] = useState("");
  const [adminOneOnOnePriorityGrantingIds, setAdminOneOnOnePriorityGrantingIds] = useState<string[]>([]);
  const [adminOneOnOnePriorityGrantError, setAdminOneOnOnePriorityGrantError] = useState("");
  const [adminOneOnOnePriorityGrantInfo, setAdminOneOnOnePriorityGrantInfo] = useState("");
  const [adminRefundOrderId, setAdminRefundOrderId] = useState("");
  const [adminRefundReasonByOrderId, setAdminRefundReasonByOrderId] = useState<Record<string, string>>({});
  const [adminRefundAmountByOrderId, setAdminRefundAmountByOrderId] = useState<Record<string, string>>({});
  const [adminRefundingOrderId, setAdminRefundingOrderId] = useState<string | null>(null);
  const [adminRefundError, setAdminRefundError] = useState("");
  const [adminRefundInfo, setAdminRefundInfo] = useState("");
  const [adminQueueMoveCardId, setAdminQueueMoveCardId] = useState("");
  const [adminQueueMovePosition, setAdminQueueMovePosition] = useState("");
  const [adminQueueMoveLoading, setAdminQueueMoveLoading] = useState(false);
  const [adminQueueMoveError, setAdminQueueMoveError] = useState("");
  const [adminQueueMoveInfo, setAdminQueueMoveInfo] = useState("");
  const [adminDeleteIdentifier, setAdminDeleteIdentifier] = useState("");
  const [adminDeleteLoading, setAdminDeleteLoading] = useState(false);
  const [adminDeleteError, setAdminDeleteError] = useState("");
  const [adminDeleteInfo, setAdminDeleteInfo] = useState("");
  const [savingSwipeVisibility, setSavingSwipeVisibility] = useState(false);
  const [swipeSubscriptionStatus, setSwipeSubscriptionStatus] = useState<SwipeSubscriptionStatus | null>(null);
  const [swipeSubscriptionLoading, setSwipeSubscriptionLoading] = useState(false);
  const [swipeSubscriptionSubmitting, setSwipeSubscriptionSubmitting] = useState(false);
  const [swipeSubscriptionError, setSwipeSubscriptionError] = useState("");
  const [swipeSubscriptionInfo, setSwipeSubscriptionInfo] = useState("");
  const [oneOnOnePrioritySubmittingIds, setOneOnOnePrioritySubmittingIds] = useState<string[]>([]);
  const [oneOnOnePriorityDetailCardId, setOneOnOnePriorityDetailCardId] = useState<string | null>(null);
  const [swipeSubscriptionPanelOpen, setSwipeSubscriptionPanelOpen] = useState(false);
  const [supportItems, setSupportItems] = useState<SupportInquiry[]>([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [supportPanelOpen, setSupportPanelOpen] = useState(false);
  const [supportLoaded, setSupportLoaded] = useState(false);
  const [supportCategory, setSupportCategory] = useState<SupportInquiry["category"]>("dating");
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportContactEmail, setSupportContactEmail] = useState("");
  const [supportContactPhone, setSupportContactPhone] = useState("");
  const [supportError, setSupportError] = useState("");
  const [supportInfo, setSupportInfo] = useState("");
  const [paymentCenterOpen, setPaymentCenterOpen] = useState(false);
  const [paymentCenterLoaded, setPaymentCenterLoaded] = useState(false);
  const [paymentCenterLoading, setPaymentCenterLoading] = useState(false);
  const [paymentCenterError, setPaymentCenterError] = useState("");
  const [paymentCenterData, setPaymentCenterData] = useState<MyPaymentCenterData | null>(null);
  const [loveFortuneOpen, setLoveFortuneOpen] = useState(false);
  const [loveFortuneLoaded, setLoveFortuneLoaded] = useState(false);
  const [loveFortuneLoading, setLoveFortuneLoading] = useState(false);
  const [loveFortuneError, setLoveFortuneError] = useState("");
  const [loveFortuneReadings, setLoveFortuneReadings] = useState<MyLoveFortuneReading[]>([]);
  const [loveFortuneGeneratingId, setLoveFortuneGeneratingId] = useState<string | null>(null);
  const [loveFortuneViewerReading, setLoveFortuneViewerReading] = useState<MyLoveFortuneReading | null>(null);

  const refreshAdminQueueData = useMemo(
    () =>
      async (showLoading = false, force = false) => {
        if (!force && !isAdmin) return;

        if (showLoading) {
          setAdminQueueRefreshing(true);
        }

        try {
          const [ordersRes, moreViewRes, cityViewRes, swipeRes] = await Promise.all([
            fetch("/api/admin/dating/apply-credits/orders?status=pending", { cache: "no-store" }),
            fetch("/api/admin/dating/cards/more-view/requests?status=pending", { cache: "no-store" }),
            fetch("/api/admin/dating/cards/city-view/requests?status=pending", { cache: "no-store" }),
            fetch("/api/admin/dating/cards/swipe-subscriptions?status=pending", { cache: "no-store" }),
          ]);

          const [ordersBody, moreViewBody, cityViewBody, swipeBody] = await Promise.all([
            ordersRes.json().catch(() => ({})),
            moreViewRes.json().catch(() => ({})),
            cityViewRes.json().catch(() => ({})),
            swipeRes.json().catch(() => ({})),
          ]);

          if (ordersRes.ok) {
            const body = ordersBody as { items?: AdminApplyCreditOrder[] };
            setAdminApplyCreditOrders(body.items ?? []);
          } else {
            console.error("[mypage] apply credit orders refresh failed", ordersBody);
          }

          if (moreViewRes.ok) {
            const body = moreViewBody as { items?: AdminMoreViewRequest[] };
            setAdminMoreViewRequests(body.items ?? []);
          } else {
            console.error("[mypage] more view requests refresh failed", moreViewBody);
          }

          if (cityViewRes.ok) {
            const body = cityViewBody as { items?: AdminCityViewRequest[] };
            setAdminCityViewRequests(body.items ?? []);
          } else {
            console.error("[mypage] city view requests refresh failed", cityViewBody);
          }

          if (swipeRes.ok) {
            const body = swipeBody as { items?: AdminSwipeSubscriptionRequest[] };
            setAdminSwipeSubscriptionRequests(body.items ?? []);
          } else {
            console.error("[mypage] swipe subscription requests refresh failed", swipeBody);
          }
        } catch (error) {
          console.error("[mypage] admin queue refresh failed", error);
        } finally {
          if (showLoading) {
            setAdminQueueRefreshing(false);
          }
        }
      },
    [isAdmin]
  );

  const loadPaymentCenter = useCallback(async (force = false) => {
    if (!force && (paymentCenterLoading || paymentCenterLoaded)) return;

    setPaymentCenterLoading(true);
    setPaymentCenterError("");

    try {
      const res = await fetch("/api/mypage/payments", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        summary?: MyPaymentCenterData["summary"];
        orders?: MyPaymentCenterOrder[];
        message?: string;
      };

      if (!res.ok || !body.ok || !body.summary) {
        throw new Error(body.message ?? "결제센터를 불러오지 못했습니다.");
      }

      setPaymentCenterData({
        summary: body.summary,
        orders: body.orders ?? [],
      });
      setPaymentCenterLoaded(true);
    } catch (error) {
      console.error("[mypage] payment center load failed", error);
      setPaymentCenterError(error instanceof Error ? error.message : "결제센터를 불러오지 못했습니다.");
    } finally {
      setPaymentCenterLoading(false);
    }
  }, [paymentCenterLoaded, paymentCenterLoading]);

  const loadLoveFortuneReadings = useCallback(async (force = false) => {
    if (!isAdmin) return;
    if (!force && (loveFortuneLoading || loveFortuneLoaded)) return;

    setLoveFortuneLoading(true);
    setLoveFortuneError("");

    try {
      const res = await fetch("/api/mypage/love-fortune", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        readings?: MyLoveFortuneReading[];
        message?: string;
      };

      if (!res.ok || !body.ok) {
        throw new Error(body.message ?? "연애운 내역을 불러오지 못했습니다.");
      }

      setLoveFortuneReadings(body.readings ?? []);
      setLoveFortuneLoaded(true);
    } catch (error) {
      console.error("[mypage] love fortune load failed", error);
      setLoveFortuneError(error instanceof Error ? error.message : "연애운 내역을 불러오지 못했습니다.");
    } finally {
      setLoveFortuneLoading(false);
    }
  }, [isAdmin, loveFortuneLoaded, loveFortuneLoading]);

  const generateLoveFortuneReading = useCallback(async (readingId: string) => {
    if (!isAdmin) return;
    if (loveFortuneGeneratingId) return;

    setLoveFortuneGeneratingId(readingId);
    setLoveFortuneError("");

    try {
      const res = await fetch("/api/mypage/love-fortune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readingId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reading?: MyLoveFortuneReading;
        message?: string;
      };

      if (!res.ok || !body.ok || !body.reading) {
        throw new Error(body.message ?? "연애운 상세 분석을 생성하지 못했습니다.");
      }

      setLoveFortuneReadings((items) => items.map((item) => (item.id === body.reading?.id ? body.reading : item)));
      setLoveFortuneLoaded(true);
    } catch (error) {
      console.error("[mypage] love fortune generate failed", error);
      setLoveFortuneError(error instanceof Error ? error.message : "연애운 상세 풀이를 생성하지 못했습니다.");
    } finally {
      setLoveFortuneGeneratingId(null);
    }
  }, [isAdmin, loveFortuneGeneratingId]);

  const refreshAdminPaymentCenter = useMemo(
    () =>
      async (showLoading = true) => {
        if (!isAdmin) return;

        if (showLoading) {
          setAdminPaymentCenterLoading(true);
        }
        setAdminPaymentCenterError("");

        try {
          const res = await fetch("/api/admin/payments/overview", { cache: "no-store" });
          const body = (await res.json().catch(() => ({}))) as {
            ok?: boolean;
            summary?: AdminPaymentCenterOverview["summary"];
            orders?: AdminPaymentCenterOrder[];
            message?: string;
          };

          if (!res.ok || !body.ok || !body.summary) {
            throw new Error(body.message ?? "결제센터를 불러오지 못했습니다.");
          }

          setAdminPaymentCenter({
            summary: body.summary,
            orders: body.orders ?? [],
          });
        } catch (error) {
          console.error("[mypage] admin payment center refresh failed", error);
          setAdminPaymentCenterError(error instanceof Error ? error.message : "결제센터를 불러오지 못했습니다.");
        } finally {
          if (showLoading) {
            setAdminPaymentCenterLoading(false);
          }
        }
      },
    [isAdmin]
  );

  const refreshAdminOpenCardData = useMemo(
    () =>
      async (showLoading = true) => {
        if (!isAdmin) return;

        if (showLoading) {
          setAdminOpenCardsLoading(true);
        }

        try {
          const [overviewRes, paidAppsRes] = await Promise.all([
            fetch("/api/dating/cards/admin/overview", { cache: "no-store" }),
            fetch("/api/admin/dating/paid/applications", { cache: "no-store" }),
          ]);

          const [overviewBody, paidAppsBody] = await Promise.all([
            overviewRes.json().catch(() => ({})),
            paidAppsRes.json().catch(() => ({})),
          ]);

          if (overviewRes.ok) {
            const body = overviewBody as { cards?: AdminOpenCard[]; applications?: AdminOpenCardApplication[] };
            setAdminOpenCards(body.cards ?? []);
            setAdminOpenCardApplications(body.applications ?? []);
          } else {
            console.error("[mypage] admin overview refresh failed", overviewBody);
          }

          if (paidAppsRes.ok) {
            const body = paidAppsBody as { items?: AdminPaidCardApplication[] };
            setAdminPaidCardApplications(body.items ?? []);
          } else {
            console.error("[mypage] paid applications refresh failed", paidAppsBody);
          }

          setAdminOpenCardsLoaded(true);
        } catch (error) {
          console.error("[mypage] admin open card data refresh failed", error);
        } finally {
          if (showLoading) {
            setAdminOpenCardsLoading(false);
          }
        }
      },
    [isAdmin]
  );

  const refreshAdminAcceptedRecentApplications = useMemo(
    () =>
      async (showLoading = true) => {
        if (!isAdmin) return;

        if (showLoading) {
          setAdminAcceptedRecentLoading(true);
        }

        try {
          const res = await fetch("/api/admin/dating/accepted-applications/recent?days=7", { cache: "no-store" });
          const body = await res.json().catch(() => ({}));

          if (res.ok) {
            const parsed = body as {
              items?: AdminAcceptedRecentApplication[];
              fallback_created_at?: boolean;
            };
            setAdminAcceptedRecentApplications(parsed.items ?? []);
            setAdminAcceptedRecentFallback(Boolean(parsed.fallback_created_at));
            setAdminAcceptedRecentLoaded(true);
          } else {
            console.error("[mypage] accepted recent applications refresh failed", body);
            setAdminAcceptedRecentApplications([]);
            setAdminAcceptedRecentFallback(false);
          }
        } catch (error) {
          console.error("[mypage] accepted recent applications refresh failed", error);
          setAdminAcceptedRecentApplications([]);
          setAdminAcceptedRecentFallback(false);
        } finally {
          if (showLoading) {
            setAdminAcceptedRecentLoading(false);
          }
        }
      },
    [isAdmin]
  );

  const loadAdminOpenCardOutreachPreview = useCallback(async () => {
    if (!isAdmin) return;

    setAdminOpenCardOutreachLoading(true);
    try {
      const query = new URLSearchParams({
        scope: adminOpenCardOutreachScope,
        staleDays: adminOpenCardOutreachStaleDays.trim() || "30",
        phoneVerified: adminOpenCardOutreachPhoneFilter,
        recentLoginDays: adminOpenCardOutreachRecentLoginDays.trim() || "all",
        recentMail: adminOpenCardOutreachRecentMailFilter,
        sort: adminOpenCardOutreachSort,
        batchLimit: adminOpenCardOutreachBatchLimit.trim() || "150",
      }).toString();
      const res = await fetch(`/api/admin/dating/cards/outreach?${query}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as AdminOpenCardOutreachPreview & { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "오픈카드 안내 메일 미리보기를 불러오지 못했습니다.");
      }
      setAdminOpenCardOutreachPreview(body);
      setAdminOpenCardOutreachSubject((current) => (current.trim() ? current : body.subject ?? ""));
      setAdminOpenCardOutreachBody((current) => (current.trim() ? current : body.body ?? ""));
    } catch (error) {
      console.error("[mypage] admin open card outreach preview failed", error);
      setError(error instanceof Error ? error.message : "오픈카드 안내 메일 미리보기를 불러오지 못했습니다.");
    } finally {
      setAdminOpenCardOutreachLoading(false);
    }
  }, [
    adminOpenCardOutreachPhoneFilter,
    adminOpenCardOutreachRecentLoginDays,
    adminOpenCardOutreachRecentMailFilter,
    adminOpenCardOutreachScope,
    adminOpenCardOutreachSort,
    adminOpenCardOutreachStaleDays,
    adminOpenCardOutreachBatchLimit,
    isAdmin,
  ]);

  const handleAdminSendOpenCardOutreach = useCallback(async () => {
    if (adminOpenCardOutreachSending) return;

    const targetCount = adminOpenCardOutreachPreview?.recipient_count ?? 0;
    if (!targetCount) {
      alert("발송 대상이 없습니다.");
      return;
    }

    const subject = adminOpenCardOutreachSubject.trim();
    const body = adminOpenCardOutreachBody.trim();
    if (!subject) {
      alert("메일 제목을 입력해주세요.");
      return;
    }
    if (!body) {
      alert("메일 본문을 입력해주세요.");
      return;
    }

    if (
      !confirm(
        `${adminOpenCardOutreachScopeLabel(adminOpenCardOutreachScope)} ${targetCount}명에게 오픈카드 등록 안내 메일을 발송할까요?`
      )
    ) {
      return;
    }

    setAdminOpenCardOutreachSending(true);
    setAdminOpenCardOutreachResult(null);
    setError("");
    try {
      const staleDays = Number(adminOpenCardOutreachStaleDays.trim() || "30");
      const batchLimit = Number(adminOpenCardOutreachBatchLimit.trim() || "150");
      const res = await fetch("/api/admin/dating/cards/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: adminOpenCardOutreachScope,
          staleDays,
          phoneVerified: adminOpenCardOutreachPhoneFilter,
          recentLoginDays: adminOpenCardOutreachRecentLoginDays.trim() || "all",
          recentMail: adminOpenCardOutreachRecentMailFilter,
          sort: adminOpenCardOutreachSort,
          batchLimit,
          subject,
          body,
        }),
      });
      const responseBody = (await res.json().catch(() => ({}))) as
        | (AdminOpenCardOutreachSendResult & { ok?: boolean; error?: string })
        | { error?: string };

      if (!res.ok) {
        throw new Error(responseBody.error ?? "오픈카드 안내 메일 발송에 실패했습니다.");
      }

      setAdminOpenCardOutreachResult({
        scope: "scope" in responseBody ? responseBody.scope : adminOpenCardOutreachScope,
        stale_days: "stale_days" in responseBody ? responseBody.stale_days : staleDays,
        phone_verified_filter:
          "phone_verified_filter" in responseBody ? responseBody.phone_verified_filter : adminOpenCardOutreachPhoneFilter,
        recent_login_days:
          "recent_login_days" in responseBody ? responseBody.recent_login_days : Number(adminOpenCardOutreachRecentLoginDays) || null,
        recent_mail_filter:
          "recent_mail_filter" in responseBody ? responseBody.recent_mail_filter : adminOpenCardOutreachRecentMailFilter,
        sort: "sort" in responseBody ? responseBody.sort : adminOpenCardOutreachSort,
        batch_limit: "batch_limit" in responseBody ? responseBody.batch_limit : batchLimit,
        send_limit: "send_limit" in responseBody ? responseBody.send_limit : 150,
        requested: "requested" in responseBody ? responseBody.requested : 0,
        sent: "sent" in responseBody ? responseBody.sent : 0,
        failed: "failed" in responseBody ? responseBody.failed : 0,
        failure_summary: "failure_summary" in responseBody ? responseBody.failure_summary ?? [] : [],
        first_failure: "first_failure" in responseBody ? responseBody.first_failure ?? null : null,
      });
      await loadAdminOpenCardOutreachPreview();
    } catch (error) {
      console.error("[mypage] admin open card outreach send failed", error);
      setError(error instanceof Error ? error.message : "오픈카드 안내 메일 발송에 실패했습니다.");
    } finally {
      setAdminOpenCardOutreachSending(false);
    }
  }, [
    adminOpenCardOutreachBody,
    adminOpenCardOutreachPhoneFilter,
    adminOpenCardOutreachPreview?.recipient_count,
    adminOpenCardOutreachRecentLoginDays,
    adminOpenCardOutreachRecentMailFilter,
    adminOpenCardOutreachScope,
    adminOpenCardOutreachSending,
    adminOpenCardOutreachSort,
    adminOpenCardOutreachStaleDays,
    adminOpenCardOutreachBatchLimit,
    adminOpenCardOutreachSubject,
    loadAdminOpenCardOutreachPreview,
  ]);

  const handleAdminSendOpenCardOutreachAll = useCallback(async () => {
    if (adminOpenCardOutreachSending) return;

    const targetCount =
      adminOpenCardOutreachPreview?.total_candidate_count ?? adminOpenCardOutreachPreview?.recipient_count ?? 0;
    if (!targetCount) {
      alert("발송 대상이 없습니다.");
      return;
    }
    if (adminOpenCardOutreachRecentMailFilter !== "never_sent_success" && adminOpenCardOutreachRecentMailFilter !== "not_sent_24h") {
      alert("중복 발송 방지를 위해 전체 자동 발송은 '성공 발송 이력 없는 회원만' 또는 '최근 24시간 미발송만' 조건에서만 사용할 수 있습니다.");
      return;
    }

    const subject = adminOpenCardOutreachSubject.trim();
    const body = adminOpenCardOutreachBody.trim();
    if (!subject) {
      alert("메일 제목을 입력해주세요.");
      return;
    }
    if (!body) {
      alert("메일 본문을 입력해주세요.");
      return;
    }

    if (
      !confirm(
        `${adminOpenCardOutreachScopeLabel(adminOpenCardOutreachScope)} 대상 ${targetCount.toLocaleString(
          "ko-KR"
        )}명을 150명 이하씩 자동으로 이어서 발송할까요?\n\n창을 닫으면 자동 발송이 중단될 수 있습니다.`
      )
    ) {
      return;
    }

    setAdminOpenCardOutreachSending(true);
    setAdminOpenCardOutreachResult(null);
    setError("");

    const staleDays = Number(adminOpenCardOutreachStaleDays.trim() || "30");
    const batchLimit = Math.min(150, Math.max(1, Number(adminOpenCardOutreachBatchLimit.trim() || "150") || 150));
    const aggregate: AdminOpenCardOutreachSendResult = {
      scope: adminOpenCardOutreachScope,
      stale_days: staleDays,
      phone_verified_filter: adminOpenCardOutreachPhoneFilter,
      recent_login_days: Number(adminOpenCardOutreachRecentLoginDays) || null,
      recent_mail_filter: adminOpenCardOutreachRecentMailFilter,
      sort: adminOpenCardOutreachSort,
      batch_limit: batchLimit,
      send_limit: 150,
      requested: 0,
      sent: 0,
      failed: 0,
      failure_summary: [],
      first_failure: null,
    };

    try {
      for (let batchIndex = 0; batchIndex < OUTREACH_AUTO_MAX_BATCHES; batchIndex += 1) {
        const res = await fetch("/api/admin/dating/cards/outreach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: adminOpenCardOutreachScope,
            staleDays,
            phoneVerified: adminOpenCardOutreachPhoneFilter,
            recentLoginDays: adminOpenCardOutreachRecentLoginDays.trim() || "all",
            recentMail: adminOpenCardOutreachRecentMailFilter,
            sort: adminOpenCardOutreachSort,
            batchLimit,
            subject,
            body,
          }),
        });
        const responseBody = (await res.json().catch(() => ({}))) as
          | (AdminOpenCardOutreachSendResult & { ok?: boolean; error?: string })
          | { error?: string };

        if (!res.ok) {
          throw new Error(responseBody.error ?? "오픈카드 안내 메일 발송에 실패했습니다.");
        }

        const current: AdminOpenCardOutreachSendResult = {
          scope: "scope" in responseBody ? responseBody.scope : adminOpenCardOutreachScope,
          stale_days: "stale_days" in responseBody ? responseBody.stale_days : staleDays,
          phone_verified_filter:
            "phone_verified_filter" in responseBody ? responseBody.phone_verified_filter : adminOpenCardOutreachPhoneFilter,
          recent_login_days:
            "recent_login_days" in responseBody ? responseBody.recent_login_days : Number(adminOpenCardOutreachRecentLoginDays) || null,
          recent_mail_filter:
            "recent_mail_filter" in responseBody ? responseBody.recent_mail_filter : adminOpenCardOutreachRecentMailFilter,
          sort: "sort" in responseBody ? responseBody.sort : adminOpenCardOutreachSort,
          batch_limit: "batch_limit" in responseBody ? responseBody.batch_limit : batchLimit,
          send_limit: "send_limit" in responseBody ? responseBody.send_limit : 150,
          requested: "requested" in responseBody ? responseBody.requested : 0,
          sent: "sent" in responseBody ? responseBody.sent : 0,
          failed: "failed" in responseBody ? responseBody.failed : 0,
          failure_summary: "failure_summary" in responseBody ? responseBody.failure_summary ?? [] : [],
          first_failure: "first_failure" in responseBody ? responseBody.first_failure ?? null : null,
        };

        aggregate.requested += current.requested;
        aggregate.sent += current.sent;
        aggregate.failed += current.failed;
        aggregate.send_limit = current.send_limit;
        aggregate.failure_summary = mergeFailureSummary(aggregate.failure_summary, current.failure_summary);
        aggregate.first_failure = aggregate.first_failure ?? current.first_failure ?? null;
        setAdminOpenCardOutreachResult({ ...aggregate });

        if (current.requested < batchLimit || current.sent <= 0) break;
        await waitFor(OUTREACH_AUTO_BATCH_DELAY_MS);
      }

      await loadAdminOpenCardOutreachPreview();
    } catch (error) {
      console.error("[mypage] admin open card outreach auto send failed", error);
      setError(error instanceof Error ? error.message : "오픈카드 안내 메일 자동 발송에 실패했습니다.");
    } finally {
      setAdminOpenCardOutreachSending(false);
    }
  }, [
    adminOpenCardOutreachBatchLimit,
    adminOpenCardOutreachBody,
    adminOpenCardOutreachPhoneFilter,
    adminOpenCardOutreachPreview?.recipient_count,
    adminOpenCardOutreachPreview?.total_candidate_count,
    adminOpenCardOutreachRecentLoginDays,
    adminOpenCardOutreachRecentMailFilter,
    adminOpenCardOutreachScope,
    adminOpenCardOutreachSending,
    adminOpenCardOutreachSort,
    adminOpenCardOutreachStaleDays,
    adminOpenCardOutreachSubject,
    loadAdminOpenCardOutreachPreview,
  ]);

  const handleAdminQueueOpenCardOutreach = useCallback(async () => {
    if (adminOpenCardOutreachSending) return;

    const targetCount =
      adminOpenCardOutreachPreview?.total_candidate_count ?? adminOpenCardOutreachPreview?.recipient_count ?? 0;
    if (!targetCount) {
      alert("발송 대상이 없습니다.");
      return;
    }

    const subject = adminOpenCardOutreachSubject.trim();
    const body = adminOpenCardOutreachBody.trim();
    if (!subject) {
      alert("메일 제목을 입력해주세요.");
      return;
    }
    if (!body) {
      alert("메일 본문을 입력해주세요.");
      return;
    }

    if (
      !confirm(
        `${adminOpenCardOutreachScopeLabel(adminOpenCardOutreachScope)} 대상 ${targetCount.toLocaleString(
          "ko-KR"
        )}명을 백그라운드 발송 작업으로 등록할까요?\n\n등록 후에는 창을 닫아도 cron이 이어서 발송합니다.`
      )
    ) {
      return;
    }

    setAdminOpenCardOutreachSending(true);
    setAdminOpenCardOutreachResult(null);
    setError("");
    try {
      const staleDays = Number(adminOpenCardOutreachStaleDays.trim() || "30");
      const batchLimit = Number(adminOpenCardOutreachBatchLimit.trim() || "150");
      const res = await fetch("/api/admin/dating/cards/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          background: true,
          scope: adminOpenCardOutreachScope,
          staleDays,
          phoneVerified: adminOpenCardOutreachPhoneFilter,
          recentLoginDays: adminOpenCardOutreachRecentLoginDays.trim() || "all",
          recentMail: adminOpenCardOutreachRecentMailFilter,
          sort: adminOpenCardOutreachSort,
          batchLimit,
          subject,
          body,
        }),
      });
      const responseBody = (await res.json().catch(() => ({}))) as
        | (AdminOpenCardOutreachSendResult & { ok?: boolean; error?: string })
        | { error?: string };

      if (!res.ok) {
        throw new Error(responseBody.error ?? "오픈카드 안내 메일 백그라운드 작업 등록에 실패했습니다.");
      }

      setAdminOpenCardOutreachResult({
        queued: "queued" in responseBody ? responseBody.queued : true,
        background_job_id: "job_id" in responseBody ? String(responseBody.job_id ?? "") : undefined,
        total_count: "total_count" in responseBody ? Number(responseBody.total_count ?? 0) : targetCount,
        scope: adminOpenCardOutreachScope,
        stale_days: staleDays,
        phone_verified_filter: adminOpenCardOutreachPhoneFilter,
        recent_login_days: Number(adminOpenCardOutreachRecentLoginDays) || null,
        recent_mail_filter: adminOpenCardOutreachRecentMailFilter,
        sort: adminOpenCardOutreachSort,
        batch_limit: batchLimit,
        send_limit: 150,
        requested: "total_count" in responseBody ? Number(responseBody.total_count ?? 0) : targetCount,
        sent: 0,
        failed: 0,
        failure_summary: [],
        first_failure: null,
      });
      await loadAdminOpenCardOutreachPreview();
    } catch (error) {
      console.error("[mypage] admin open card outreach queue failed", error);
      setError(error instanceof Error ? error.message : "오픈카드 안내 메일 백그라운드 작업 등록에 실패했습니다.");
    } finally {
      setAdminOpenCardOutreachSending(false);
    }
  }, [
    adminOpenCardOutreachBatchLimit,
    adminOpenCardOutreachBody,
    adminOpenCardOutreachPhoneFilter,
    adminOpenCardOutreachPreview?.recipient_count,
    adminOpenCardOutreachPreview?.total_candidate_count,
    adminOpenCardOutreachRecentLoginDays,
    adminOpenCardOutreachRecentMailFilter,
    adminOpenCardOutreachScope,
    adminOpenCardOutreachSending,
    adminOpenCardOutreachSort,
    adminOpenCardOutreachStaleDays,
    adminOpenCardOutreachSubject,
    loadAdminOpenCardOutreachPreview,
  ]);

  const loadAdminOneOnOneOutreachPreview = useCallback(async () => {
    if (!isAdmin) return;

    setAdminOneOnOneOutreachLoading(true);
    try {
      const query = new URLSearchParams({
        scope: adminOneOnOneOutreachScope,
        phoneVerified: adminOneOnOneOutreachPhoneFilter,
        recentLoginDays: adminOneOnOneOutreachRecentLoginDays.trim() || "all",
        recentMail: adminOneOnOneOutreachRecentMailFilter,
        sort: adminOneOnOneOutreachSort,
      }).toString();
      const res = await fetch(`/api/admin/dating/1on1/outreach?${query}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as AdminOneOnOneOutreachPreview & { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "1:1 소개팅 메일 미리보기를 불러오지 못했습니다.");
      }
      setAdminOneOnOneOutreachPreview(body);
      setAdminOneOnOneOutreachSubject((current) => (current.trim() ? current : body.subject ?? ""));
      setAdminOneOnOneOutreachBody((current) => (current.trim() ? current : body.body ?? ""));
    } catch (error) {
      console.error("[mypage] admin 1on1 outreach preview failed", error);
      setError(error instanceof Error ? error.message : "1:1 소개팅 메일 미리보기를 불러오지 못했습니다.");
    } finally {
      setAdminOneOnOneOutreachLoading(false);
    }
  }, [
    adminOneOnOneOutreachPhoneFilter,
    adminOneOnOneOutreachRecentLoginDays,
    adminOneOnOneOutreachRecentMailFilter,
    adminOneOnOneOutreachScope,
    adminOneOnOneOutreachSort,
    isAdmin,
  ]);

  const handleAdminSendOneOnOneOutreach = useCallback(async () => {
    if (adminOneOnOneOutreachSending) return;

    const targetCount = adminOneOnOneOutreachPreview?.recipient_count ?? 0;
    if (!targetCount) {
      alert("발송 대상이 없습니다.");
      return;
    }

    const subject = adminOneOnOneOutreachSubject.trim();
    const body = adminOneOnOneOutreachBody.trim();
    if (!subject) {
      alert("메일 제목을 입력해주세요.");
      return;
    }
    if (!body) {
      alert("메일 본문을 입력해주세요.");
      return;
    }

    if (
      !confirm(
        `${adminOneOnOneOutreachScopeLabel(adminOneOnOneOutreachScope)} ${targetCount}명에게 1:1 소개팅 안내 메일을 발송할까요?`
      )
    ) {
      return;
    }

    setAdminOneOnOneOutreachSending(true);
    setAdminOneOnOneOutreachResult(null);
    setError("");
    try {
      const res = await fetch("/api/admin/dating/1on1/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: adminOneOnOneOutreachScope,
          phoneVerified: adminOneOnOneOutreachPhoneFilter,
          recentLoginDays: adminOneOnOneOutreachRecentLoginDays.trim() || "all",
          recentMail: adminOneOnOneOutreachRecentMailFilter,
          sort: adminOneOnOneOutreachSort,
          subject,
          body,
        }),
      });
      const responseBody = (await res.json().catch(() => ({}))) as
        | (AdminOneOnOneOutreachSendResult & { ok?: boolean; error?: string })
        | { error?: string };

      if (!res.ok) {
        throw new Error(responseBody.error ?? "1:1 소개팅 메일 발송에 실패했습니다.");
      }

      setAdminOneOnOneOutreachResult({
        scope: "scope" in responseBody ? responseBody.scope : adminOneOnOneOutreachScope,
        phone_verified_filter:
          "phone_verified_filter" in responseBody ? responseBody.phone_verified_filter : adminOneOnOneOutreachPhoneFilter,
        recent_login_days:
          "recent_login_days" in responseBody ? responseBody.recent_login_days : Number(adminOneOnOneOutreachRecentLoginDays) || null,
        recent_mail_filter:
          "recent_mail_filter" in responseBody ? responseBody.recent_mail_filter : adminOneOnOneOutreachRecentMailFilter,
        sort: "sort" in responseBody ? responseBody.sort : adminOneOnOneOutreachSort,
        send_limit: "send_limit" in responseBody ? responseBody.send_limit : 150,
        requested: "requested" in responseBody ? responseBody.requested : 0,
        sent: "sent" in responseBody ? responseBody.sent : 0,
        failed: "failed" in responseBody ? responseBody.failed : 0,
        failure_summary: "failure_summary" in responseBody ? responseBody.failure_summary ?? [] : [],
        first_failure: "first_failure" in responseBody ? responseBody.first_failure ?? null : null,
      });
      await loadAdminOneOnOneOutreachPreview();
    } catch (error) {
      console.error("[mypage] admin 1on1 outreach send failed", error);
      setError(error instanceof Error ? error.message : "1:1 소개팅 메일 발송에 실패했습니다.");
    } finally {
      setAdminOneOnOneOutreachSending(false);
    }
  }, [
    adminOneOnOneOutreachBody,
    adminOneOnOneOutreachPhoneFilter,
    adminOneOnOneOutreachPreview?.recipient_count,
    adminOneOnOneOutreachRecentLoginDays,
    adminOneOnOneOutreachRecentMailFilter,
    adminOneOnOneOutreachScope,
    adminOneOnOneOutreachSending,
    adminOneOnOneOutreachSort,
    adminOneOnOneOutreachSubject,
    loadAdminOneOnOneOutreachPreview,
  ]);

  const handleAdminSendOneOnOneOutreachAll = useCallback(async () => {
    if (adminOneOnOneOutreachSending) return;

    const targetCount =
      adminOneOnOneOutreachPreview?.total_candidate_count ?? adminOneOnOneOutreachPreview?.recipient_count ?? 0;
    if (!targetCount) {
      alert("발송 대상이 없습니다.");
      return;
    }
    if (adminOneOnOneOutreachRecentMailFilter !== "not_sent_24h") {
      alert("중복 발송 방지를 위해 1:1 전체 자동 발송은 '최근 24시간 미발송만' 조건에서만 사용할 수 있습니다.");
      return;
    }

    const subject = adminOneOnOneOutreachSubject.trim();
    const body = adminOneOnOneOutreachBody.trim();
    if (!subject) {
      alert("메일 제목을 입력해주세요.");
      return;
    }
    if (!body) {
      alert("메일 본문을 입력해주세요.");
      return;
    }

    if (
      !confirm(
        `${adminOneOnOneOutreachScopeLabel(adminOneOnOneOutreachScope)} 대상 ${targetCount.toLocaleString(
          "ko-KR"
        )}명을 150명씩 자동으로 이어서 발송할까요?\n\n창을 닫으면 자동 발송이 중단될 수 있습니다.`
      )
    ) {
      return;
    }

    setAdminOneOnOneOutreachSending(true);
    setAdminOneOnOneOutreachResult(null);
    setError("");

    const aggregate: AdminOneOnOneOutreachSendResult = {
      scope: adminOneOnOneOutreachScope,
      phone_verified_filter: adminOneOnOneOutreachPhoneFilter,
      recent_login_days: Number(adminOneOnOneOutreachRecentLoginDays) || null,
      recent_mail_filter: adminOneOnOneOutreachRecentMailFilter,
      sort: adminOneOnOneOutreachSort,
      send_limit: 150,
      requested: 0,
      sent: 0,
      failed: 0,
      failure_summary: [],
      first_failure: null,
    };

    try {
      for (let batchIndex = 0; batchIndex < OUTREACH_AUTO_MAX_BATCHES; batchIndex += 1) {
        const res = await fetch("/api/admin/dating/1on1/outreach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: adminOneOnOneOutreachScope,
            phoneVerified: adminOneOnOneOutreachPhoneFilter,
            recentLoginDays: adminOneOnOneOutreachRecentLoginDays.trim() || "all",
            recentMail: adminOneOnOneOutreachRecentMailFilter,
            sort: adminOneOnOneOutreachSort,
            subject,
            body,
          }),
        });
        const responseBody = (await res.json().catch(() => ({}))) as
          | (AdminOneOnOneOutreachSendResult & { ok?: boolean; error?: string })
          | { error?: string };

        if (!res.ok) {
          throw new Error(responseBody.error ?? "1:1 소개팅 메일 발송에 실패했습니다.");
        }

        const current: AdminOneOnOneOutreachSendResult = {
          scope: "scope" in responseBody ? responseBody.scope : adminOneOnOneOutreachScope,
          phone_verified_filter:
            "phone_verified_filter" in responseBody ? responseBody.phone_verified_filter : adminOneOnOneOutreachPhoneFilter,
          recent_login_days:
            "recent_login_days" in responseBody ? responseBody.recent_login_days : Number(adminOneOnOneOutreachRecentLoginDays) || null,
          recent_mail_filter:
            "recent_mail_filter" in responseBody ? responseBody.recent_mail_filter : adminOneOnOneOutreachRecentMailFilter,
          sort: "sort" in responseBody ? responseBody.sort : adminOneOnOneOutreachSort,
          send_limit: "send_limit" in responseBody ? responseBody.send_limit : 150,
          requested: "requested" in responseBody ? responseBody.requested : 0,
          sent: "sent" in responseBody ? responseBody.sent : 0,
          failed: "failed" in responseBody ? responseBody.failed : 0,
          failure_summary: "failure_summary" in responseBody ? responseBody.failure_summary ?? [] : [],
          first_failure: "first_failure" in responseBody ? responseBody.first_failure ?? null : null,
        };

        aggregate.requested += current.requested;
        aggregate.sent += current.sent;
        aggregate.failed += current.failed;
        aggregate.send_limit = current.send_limit;
        aggregate.failure_summary = mergeFailureSummary(aggregate.failure_summary, current.failure_summary);
        aggregate.first_failure = aggregate.first_failure ?? current.first_failure ?? null;
        setAdminOneOnOneOutreachResult({ ...aggregate });

        if (current.requested < (current.send_limit ?? 150) || current.sent <= 0) break;
        await waitFor(OUTREACH_AUTO_BATCH_DELAY_MS);
      }

      await loadAdminOneOnOneOutreachPreview();
    } catch (error) {
      console.error("[mypage] admin 1on1 outreach auto send failed", error);
      setError(error instanceof Error ? error.message : "1:1 소개팅 메일 자동 발송에 실패했습니다.");
    } finally {
      setAdminOneOnOneOutreachSending(false);
    }
  }, [
    adminOneOnOneOutreachBody,
    adminOneOnOneOutreachPhoneFilter,
    adminOneOnOneOutreachPreview?.recipient_count,
    adminOneOnOneOutreachPreview?.total_candidate_count,
    adminOneOnOneOutreachRecentLoginDays,
    adminOneOnOneOutreachRecentMailFilter,
    adminOneOnOneOutreachScope,
    adminOneOnOneOutreachSending,
    adminOneOnOneOutreachSort,
    adminOneOnOneOutreachSubject,
    loadAdminOneOnOneOutreachPreview,
  ]);

  const handleAdminQueueOneOnOneOutreach = useCallback(async () => {
    if (adminOneOnOneOutreachSending) return;

    const targetCount =
      adminOneOnOneOutreachPreview?.total_candidate_count ?? adminOneOnOneOutreachPreview?.recipient_count ?? 0;
    if (!targetCount) {
      alert("발송 대상이 없습니다.");
      return;
    }

    const subject = adminOneOnOneOutreachSubject.trim();
    const body = adminOneOnOneOutreachBody.trim();
    if (!subject) {
      alert("메일 제목을 입력해주세요.");
      return;
    }
    if (!body) {
      alert("메일 본문을 입력해주세요.");
      return;
    }

    if (
      !confirm(
        `${adminOneOnOneOutreachScopeLabel(adminOneOnOneOutreachScope)} 대상 ${targetCount.toLocaleString(
          "ko-KR"
        )}명을 백그라운드 발송 작업으로 등록할까요?\n\n등록 후에는 창을 닫아도 cron이 이어서 발송합니다.`
      )
    ) {
      return;
    }

    setAdminOneOnOneOutreachSending(true);
    setAdminOneOnOneOutreachResult(null);
    setError("");
    try {
      const res = await fetch("/api/admin/dating/1on1/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          background: true,
          scope: adminOneOnOneOutreachScope,
          phoneVerified: adminOneOnOneOutreachPhoneFilter,
          recentLoginDays: adminOneOnOneOutreachRecentLoginDays.trim() || "all",
          recentMail: adminOneOnOneOutreachRecentMailFilter,
          sort: adminOneOnOneOutreachSort,
          subject,
          body,
        }),
      });
      const responseBody = (await res.json().catch(() => ({}))) as
        | (AdminOneOnOneOutreachSendResult & { ok?: boolean; error?: string })
        | { error?: string };

      if (!res.ok) {
        throw new Error(responseBody.error ?? "1:1 소개팅 메일 백그라운드 작업 등록에 실패했습니다.");
      }

      setAdminOneOnOneOutreachResult({
        queued: "queued" in responseBody ? responseBody.queued : true,
        background_job_id: "job_id" in responseBody ? String(responseBody.job_id ?? "") : undefined,
        total_count: "total_count" in responseBody ? Number(responseBody.total_count ?? 0) : targetCount,
        scope: adminOneOnOneOutreachScope,
        phone_verified_filter: adminOneOnOneOutreachPhoneFilter,
        recent_login_days: Number(adminOneOnOneOutreachRecentLoginDays) || null,
        recent_mail_filter: adminOneOnOneOutreachRecentMailFilter,
        sort: adminOneOnOneOutreachSort,
        send_limit: 150,
        requested: "total_count" in responseBody ? Number(responseBody.total_count ?? 0) : targetCount,
        sent: 0,
        failed: 0,
        failure_summary: [],
        first_failure: null,
      });
      await loadAdminOneOnOneOutreachPreview();
    } catch (error) {
      console.error("[mypage] admin 1on1 outreach queue failed", error);
      setError(error instanceof Error ? error.message : "1:1 소개팅 메일 백그라운드 작업 등록에 실패했습니다.");
    } finally {
      setAdminOneOnOneOutreachSending(false);
    }
  }, [
    adminOneOnOneOutreachBody,
    adminOneOnOneOutreachPhoneFilter,
    adminOneOnOneOutreachPreview?.recipient_count,
    adminOneOnOneOutreachPreview?.total_candidate_count,
    adminOneOnOneOutreachRecentLoginDays,
    adminOneOnOneOutreachRecentMailFilter,
    adminOneOnOneOutreachScope,
    adminOneOnOneOutreachSending,
    adminOneOnOneOutreachSort,
    adminOneOnOneOutreachSubject,
    loadAdminOneOnOneOutreachPreview,
  ]);

  const refreshAdminOneOnOneContactData = useMemo(
    () =>
      async (showLoading = true) => {
        if (!isAdmin) return;

        if (showLoading) {
          setAdminOneOnOneContactLoading(true);
        }

        try {
          const res = await fetch("/api/admin/dating/1on1/contact-exchange-queue", { cache: "no-store" });
          const body = (await res.json().catch(() => ({}))) as {
            items?: AdminOneOnOneContactExchangeRequest[];
          };

          if (res.ok) {
            setAdminOneOnOneContactRequests(body.items ?? []);
            setAdminOneOnOneContactLoaded(true);
          } else {
            console.error("[mypage] admin 1on1 contact queue refresh failed", body);
          }
        } catch (error) {
          console.error("[mypage] admin 1on1 contact queue refresh failed", error);
        } finally {
          if (showLoading) {
            setAdminOneOnOneContactLoading(false);
          }
        }
      },
    [isAdmin]
  );

  const refreshAdminReelsDatingData = useMemo(
    () =>
      async (showLoading = true) => {
        if (!isAdmin) return;
        if (showLoading) setAdminReelsDatingLoading(true);
        setAdminReelsDatingError("");

        try {
          const res = await fetch("/api/admin/dating/reels", { cache: "no-store" });
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            items?: AdminReelsDatingListing[];
            applications?: AdminReelsDatingApplication[];
          };
          if (!res.ok) throw new Error(body.error ?? "릴스 매물 목록을 불러오지 못했습니다.");
          setAdminReelsDatingListings(body.items ?? []);
          setAdminReelsDatingApplications(body.applications ?? []);
          setAdminReelsDatingLoaded(true);
        } catch (error) {
          setAdminReelsDatingError(error instanceof Error ? error.message : "릴스 매물 목록을 불러오지 못했습니다.");
        } finally {
          if (showLoading) setAdminReelsDatingLoading(false);
        }
      },
    [isAdmin]
  );

  const refreshAdminSiteDashboard = useMemo(
    () =>
      async (showLoading = true) => {
        if (!isAdmin) return;

        if (showLoading) {
          setAdminSiteDashboardLoading(true);
        }
        setAdminSiteDashboardError("");

        try {
          const res = await fetch("/api/admin/site-dashboard", { cache: "no-store" });
          const body = (await res.json().catch(() => ({}))) as {
            ok?: boolean;
            error?: string;
          } & Partial<AdminSiteDashboard>;

          if (!res.ok || body.ok === false) {
            throw new Error(body.error ?? "운영 현황을 불러오지 못했습니다.");
          }

          setAdminSiteDashboard(body as AdminSiteDashboard);
        } catch (error) {
          setAdminSiteDashboardError(error instanceof Error ? error.message : "운영 현황을 불러오지 못했습니다.");
        } finally {
          if (showLoading) {
            setAdminSiteDashboardLoading(false);
          }
        }
      },
    [isAdmin]
  );

  const reloadSwipeSubscriptionStatus = useCallback(async () => {
    setSwipeSubscriptionLoading(true);
    try {
      const res = await fetch("/api/dating/cards/swipe/subscription", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as SwipeSubscriptionStatus;
      if (!res.ok) {
        throw new Error(body.error ?? "빠른매칭 라이크 구매 상태를 불러오지 못했습니다.");
      }
      setSwipeSubscriptionStatus(body);
      setSwipeSubscriptionError("");
    } catch (error) {
      setSwipeSubscriptionStatus({
        status: "none",
        dailyLimit: 5,
        baseLimit: 5,
        premiumLimit: 30,
        priceKrw: 30000,
        durationDays: 30,
      });
      setSwipeSubscriptionError(
        error instanceof Error ? error.message : "빠른매칭 라이크 구매 상태를 불러오지 못했습니다."
      );
    } finally {
      setSwipeSubscriptionLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.replace("/login?redirect=/mypage");
          return;
        }

        const [
          summaryRes,
          certRes,
          adminRes,
          datingRes,
          receivedRes,
          appliedRes,
          paidReceivedRes,
          paidAppliedRes,
          oneOnOneRes,
          oneOnOneMatchesRes,
          oneOnOneRecommendationsRes,
          oneOnOnePhoneBlocksRes,
          datingContactBlocksRes,
          connectionsRes,
          paidConnectionsRes,
          writeSettingRes,
          applyCreditsStatusRes,
          adInquiryRes,
          openCardHomeCopyRes,
          openCardPublicSlotsRes,
          toolsPatchNoteRes,
          siteGuideMascotRes,
        ] = await Promise.all([
          fetch("/api/mypage/summary", { cache: "no-store" }),
          fetch("/api/cert-requests", { cache: "no-store" }),
          fetch("/api/admin/me", { cache: "no-store" }),
          fetch("/api/dating/my-application", { cache: "no-store" }),
          fetch("/api/dating/cards/my/received", { cache: "no-store" }),
          fetch("/api/dating/cards/my/applied", { cache: "no-store" }),
          fetch("/api/dating/paid/my/received", { cache: "no-store" }),
          fetch("/api/dating/paid/my/applied", { cache: "no-store" }),
          fetch("/api/dating/1on1/my", { cache: "no-store" }),
          fetch("/api/dating/1on1/matches/my", { cache: "no-store" }),
          fetch("/api/dating/1on1/recommendations/my", { cache: "no-store" }),
          fetch("/api/dating/1on1/phone-blocks", { cache: "no-store" }),
          fetch("/api/dating/contact-blocks", { cache: "no-store" }),
          fetch("/api/dating/cards/my/connections", { cache: "no-store" }),
          fetch("/api/dating/paid/my/connections", { cache: "no-store" }),
          fetch("/api/dating/cards/write-enabled", { cache: "no-store" }),
          fetch("/api/dating/apply-credits/status", { cache: "no-store" }),
          fetch("/api/admin/site/ad-inquiry", { cache: "no-store" }),
          fetch("/api/admin/dating/cards/home-copy", { cache: "no-store" }),
          fetch("/api/admin/dating/cards/public-slots", { cache: "no-store" }),
          fetch("/api/admin/tools/patch-note", { cache: "no-store" }),
          fetch("/api/admin/site-guide/mascot", { cache: "no-store" }),
        ]);

        const summaryBody = (await summaryRes.json().catch(() => ({}))) as SummaryResponse & {
          error?: string;
        };
        const certBody = (await certRes.json().catch(() => ({}))) as {
          error?: string;
          requests?: MyCertRequest[];
        };
        const adminBody = (await adminRes.json().catch(() => ({}))) as { isAdmin?: boolean };
        const datingBody = (await datingRes.json().catch(() => ({}))) as {
          error?: string;
          application?: DatingApplicationStatus | null;
        };
        const receivedBody = (await receivedRes.json().catch(() => ({}))) as {
          error?: string;
          cards?: MyDatingCard[];
          applications?: ReceivedCardApplication[];
        };
        const appliedBody = (await appliedRes.json().catch(() => ({}))) as {
          error?: string;
          applications?: MyAppliedCardApplication[];
        };
        const paidReceivedBody = (await paidReceivedRes.json().catch(() => ({}))) as {
          error?: string;
          cards?: MyPaidCard[];
          applications?: ReceivedPaidApplication[];
        };
        const paidAppliedBody = (await paidAppliedRes.json().catch(() => ({}))) as {
          error?: string;
          applications?: MyAppliedPaidApplication[];
        };
        const oneOnOneBody = (await oneOnOneRes.json().catch(() => ({}))) as {
          error?: string;
          items?: MyOneOnOneCard[];
        };
        const oneOnOneMatchesBody = (await oneOnOneMatchesRes.json().catch(() => ({}))) as {
          error?: string;
          items?: MyOneOnOneMatch[];
        };
        const oneOnOneRecommendationsBody = (await oneOnOneRecommendationsRes.json().catch(() => ({}))) as {
          error?: string;
          items?: MyOneOnOneAutoRecommendationGroup[];
        };
        const oneOnOnePhoneBlocksBody = (await oneOnOnePhoneBlocksRes.json().catch(() => ({}))) as {
          error?: string;
          items?: MyOneOnOnePhoneBlock[];
        };
        const datingContactBlocksBody = (await datingContactBlocksRes.json().catch(() => ({}))) as {
          error?: string;
          items?: MyDatingContactBlock[];
        };
        const connectionsBody = (await connectionsRes.json().catch(() => ({}))) as {
          error?: string;
          items?: DatingConnection[];
        };
        const paidConnectionsBody = (await paidConnectionsRes.json().catch(() => ({}))) as {
          error?: string;
          items?: DatingConnection[];
        };
        const writeSettingBody = (await writeSettingRes.json().catch(() => ({}))) as {
          enabled?: boolean;
        };
        const applyCreditsBody = (await applyCreditsStatusRes.json().catch(() => ({}))) as ApplyCreditsStatusResponse;
        const adInquiryBody = (await adInquiryRes.json().catch(() => ({}))) as AdInquirySettingsResponse;
        const openCardHomeCopyBody = (await openCardHomeCopyRes.json().catch(() => ({}))) as OpenCardHomeCopyResponse;
        const openCardPublicSlotsBody = (await openCardPublicSlotsRes.json().catch(() => ({}))) as OpenCardPublicSlotsResponse;
        const toolsPatchNoteBody = (await toolsPatchNoteRes.json().catch(() => ({}))) as ToolsPatchNoteResponse;
        const siteGuideMascotBody = (await siteGuideMascotRes.json().catch(() => ({}))) as SiteGuideMascotResponse;

        if (!summaryRes.ok) {
          throw new Error(summaryBody.error ?? "마이페이지 정보를 불러오지 못했습니다.");
        }
        if (!certRes.ok) {
          throw new Error(certBody.error ?? "인증 요청 정보를 불러오지 못했습니다.");
        }
        if (!receivedRes.ok) {
          throw new Error(receivedBody.error ?? "내 오픈카드 지원자를 불러오지 못했습니다.");
        }
        if (!appliedRes.ok) {
          throw new Error(appliedBody.error ?? "내 오픈카드 지원 이력을 불러오지 못했습니다.");
        }
        if (!paidReceivedRes.ok) {
          throw new Error(paidReceivedBody.error ?? "내 유료카드 지원자를 불러오지 못했습니다.");
        }
        if (!paidAppliedRes.ok) {
          throw new Error(paidAppliedBody.error ?? "내 유료카드 지원 이력을 불러오지 못했습니다.");
        }
        if (!oneOnOneRes.ok) {
          throw new Error(oneOnOneBody.error ?? "내 1:1 소개팅 신청 내역을 불러오지 못했습니다.");
        }
        if (!oneOnOneMatchesRes.ok) {
          console.error("[mypage] 1on1 matches load failed", oneOnOneMatchesBody.error ?? "unknown error");
        }
        if (!oneOnOneRecommendationsRes.ok) {
          console.error("[mypage] 1on1 recommendations load failed", oneOnOneRecommendationsBody.error ?? "unknown error");
        }
        if (!oneOnOnePhoneBlocksRes.ok) {
          console.error("[mypage] 1on1 phone blocks load failed", oneOnOnePhoneBlocksBody.error ?? "unknown error");
        }
        if (!datingContactBlocksRes.ok) {
          console.error("[mypage] dating contact blocks load failed", datingContactBlocksBody.error ?? "unknown error");
        }
        if (!connectionsRes.ok) {
          console.error("[mypage] open connections load failed", connectionsBody.error ?? "unknown error");
        }
        if (!paidConnectionsRes.ok) {
          console.error("[mypage] paid connections load failed", paidConnectionsBody.error ?? "unknown error");
        }

        if (isMounted) {
          const adminFlag = Boolean(adminBody.isAdmin);
          setSummary(summaryBody);
          setCertRequests(certBody.requests ?? []);
          setIsAdmin(adminFlag);
          setDatingApplication(datingBody.application ?? null);
          setMyDatingCards(receivedBody.cards ?? []);
          setReceivedApplications(receivedBody.applications ?? []);
          setMyAppliedCardApplications(appliedBody.applications ?? []);
          setMyPaidCards(paidReceivedBody.cards ?? []);
          setReceivedPaidApplications(paidReceivedBody.applications ?? []);
          setMyAppliedPaidApplications(paidAppliedBody.applications ?? []);
          setMyOneOnOneCards(oneOnOneBody.items ?? []);
          setMyOneOnOneMatches(oneOnOneMatchesRes.ok ? (oneOnOneMatchesBody.items ?? []) : []);
          setMyOneOnOneAutoRecommendations(
            oneOnOneRecommendationsRes.ok ? (oneOnOneRecommendationsBody.items ?? []) : []
          );
          setMyOneOnOnePhoneBlocks(oneOnOnePhoneBlocksRes.ok ? (oneOnOnePhoneBlocksBody.items ?? []) : []);
          setMyDatingContactBlocks(datingContactBlocksRes.ok ? (datingContactBlocksBody.items ?? []) : []);
          setSwipeStatusSummary(null);
          setMyOutgoingSwipeLikes([]);
          setMyIncomingSwipeLikes([]);
          setSwipeStatusLoaded(false);
          setDatingConnections([
            ...(connectionsRes.ok ? (connectionsBody.items ?? []) : []),
            ...(paidConnectionsRes.ok ? (paidConnectionsBody.items ?? []) : []),
          ]);
          setOpenCardWriteEnabled(writeSettingBody.enabled !== false);
          setOpenCardHomeSubtitle(openCardHomeCopyBody.subtitle?.trim() || DEFAULT_OPEN_CARD_HOME_SUBTITLE);
          setOpenCardPublicMaleExtra(String(Math.max(0, Number(openCardPublicSlotsBody.maleExtra ?? 0))));
          setOpenCardPublicFemaleExtra(String(Math.max(0, Number(openCardPublicSlotsBody.femaleExtra ?? 0))));
          setOpenCardPublicMaleEffectiveLimit(Math.max(0, Number(openCardPublicSlotsBody.maleEffectiveLimit ?? 30)));
          setOpenCardPublicFemaleEffectiveLimit(Math.max(0, Number(openCardPublicSlotsBody.femaleEffectiveLimit ?? 30)));
          setApplyCreditsRemaining(Math.max(0, Number(applyCreditsBody.creditsRemaining ?? 0)));
          setAdInquiryEnabled(adInquiryBody.enabled !== false);
          setAdInquiryTitle(adInquiryBody.title ?? "(광고) 문의 주세요");
          setAdInquiryDescription(
            adInquiryBody.description ?? "배너, 제휴, 스폰서 문의는 오픈카톡으로 편하게 남겨 주세요."
          );
          setAdInquiryCta(adInquiryBody.cta ?? "오픈카톡 문의");
          setAdInquiryLinkUrl(adInquiryBody.linkUrl ?? "");
          setAdInquiryBadge(adInquiryBody.badge ?? "AD SLOT");
          setAdInquiryTheme(adInquiryBody.theme ?? "emerald");
          setToolsPatchNoteEnabled(toolsPatchNoteBody.enabled === true);
          setToolsPatchNoteText(toolsPatchNoteBody.text?.trim() ?? "");
          setToolsPatchNoteItems(Array.isArray(toolsPatchNoteBody.items) ? toolsPatchNoteBody.items : []);
          setSiteGuideMascotId(siteGuideMascotBody.selectedId ?? "default");
          setSiteGuideMascotOptions(
            Array.isArray(siteGuideMascotBody.options) && siteGuideMascotBody.options.length > 0
              ? siteGuideMascotBody.options
              : DEFAULT_SITE_GUIDE_MASCOT_OPTIONS
          );
          setError("");

          if (adminFlag) {
            const [
              datingStatsRes,
              datingInsightsRes,
              ordersRes,
              moreViewRes,
              cityViewRes,
              accountDeletionAuditsRes,
            ] = await Promise.all([
              fetch("/api/admin/dating/stats", { cache: "no-store" }),
              fetch("/api/admin/dating/insights", { cache: "no-store" }),
              fetch("/api/admin/dating/apply-credits/orders?status=pending", { cache: "no-store" }),
              fetch("/api/admin/dating/cards/more-view/requests?status=pending", { cache: "no-store" }),
              fetch("/api/admin/dating/cards/city-view/requests?status=pending", { cache: "no-store" }),
              fetch("/api/admin/account-deletion-audits", { cache: "no-store" }),
            ]);
            const datingStatsBody = (await datingStatsRes.json().catch(() => ({}))) as {
              error?: string;
              stats?: AdminDatingStats;
            };
            const datingInsightsBody = (await datingInsightsRes.json().catch(() => ({}))) as
              | (AdminDatingInsights & { error?: string })
              | { error?: string };
            const ordersBody = (await ordersRes.json().catch(() => ({}))) as {
              error?: string;
              items?: AdminApplyCreditOrder[];
            };
            const moreViewBody = (await moreViewRes.json().catch(() => ({}))) as {
              error?: string;
              items?: AdminMoreViewRequest[];
            };
            const cityViewBody = (await cityViewRes.json().catch(() => ({}))) as {
              error?: string;
              items?: AdminCityViewRequest[];
            };
            const accountDeletionAuditsBody = (await accountDeletionAuditsRes.json().catch(() => ({}))) as AdminAccountDeletionAuditsResponse;
            if (!datingStatsRes.ok) {
              console.error("[mypage] admin dating stats load failed", datingStatsBody);
            }
            if (!datingInsightsRes.ok) {
              console.error("[mypage] admin dating insights load failed", datingInsightsBody);
            }
            if (!ordersRes.ok) {
              console.error("[mypage] admin apply credits load failed", ordersBody);
            }
            if (isMounted) {
              setAdminDatingStats(datingStatsRes.ok ? datingStatsBody.stats ?? null : null);
              setAdminDatingInsights(
                datingInsightsRes.ok && "totals" in datingInsightsBody && "female_preference" in datingInsightsBody
                  ? datingInsightsBody
                  : null
              );
              setAdminOpenCards([]);
              setAdminOpenCardApplications([]);
              setAdminPaidCardApplications([]);
              setAdminAcceptedRecentApplications([]);
              setAdminAcceptedRecentFallback(false);
              setAdminAcceptedRecentLoaded(false);
              setAdminOpenCardsLoaded(false);
              setAdminPaymentCenter(null);
              setAdminOneOnOneContactRequests([]);
              setAdminOneOnOneContactLoaded(false);
              setAdminApplyCreditOrders(ordersRes.ok ? ordersBody.items ?? [] : []);
              setAdminMoreViewRequests(moreViewRes.ok ? moreViewBody.items ?? [] : []);
              setAdminCityViewRequests(cityViewRes.ok ? cityViewBody.items ?? [] : []);
              setAdminAccountDeletionAudits(accountDeletionAuditsRes.ok ? accountDeletionAuditsBody.items ?? [] : []);
              setAdminAccountDeletionAuditError(accountDeletionAuditsRes.ok ? "" : accountDeletionAuditsBody.error ?? "탈퇴 기록을 불러오지 못했습니다.");
            }
          } else {
            setAdminDatingStats(null);
            setAdminDatingInsights(null);
            setAdminOpenCards([]);
            setAdminOpenCardApplications([]);
            setAdminPaidCardApplications([]);
            setAdminAcceptedRecentApplications([]);
            setAdminAcceptedRecentFallback(false);
            setAdminAcceptedRecentLoaded(false);
            setAdminOpenCardsLoaded(false);
            setAdminPaymentCenter(null);
            setAdminOneOnOneContactRequests([]);
            setAdminOneOnOneContactLoaded(false);
            setAdminApplyCreditOrders([]);
            setAdminSwipeSubscriptionRequests([]);
            setAdminMoreViewRequests([]);
            setAdminCityViewRequests([]);
            setAdminAccountDeletionAudits([]);
            setAdminAccountDeletionAuditError("");
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (isMounted) setError(message);
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [router, supabase]);

  useEffect(() => {
    if (!isAdmin && activeTab === "admin_review") {
      setActiveTab("my_cert");
    }
  }, [isAdmin, activeTab]);

  useEffect(() => {
    const section = new URLSearchParams(window.location.search).get("section");
    if (section === "matching" || section === "payment" || section === "profile" || section === "settings" || section === "admin") {
      setPageSectionTab(section);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin && pageSectionTab === "admin") {
      setPageSectionTab("profile");
    }
  }, [isAdmin, pageSectionTab]);

  useEffect(() => {
    if (!isAdmin || adminManageTab !== "open_cards" || adminOpenCardsLoaded || adminOpenCardsLoading) {
      return;
    }

    void refreshAdminOpenCardData(true);
  }, [adminManageTab, adminOpenCardsLoaded, adminOpenCardsLoading, isAdmin, refreshAdminOpenCardData]);

  useEffect(() => {
    if (!isAdmin || adminManageTab !== "reels_dating" || adminReelsDatingLoaded || adminReelsDatingLoading) {
      return;
    }

    void refreshAdminReelsDatingData(true);
  }, [
    adminManageTab,
    adminReelsDatingLoaded,
    adminReelsDatingLoading,
    isAdmin,
    refreshAdminReelsDatingData,
  ]);

  useEffect(() => {
    if (
      !isAdmin ||
      adminManageTab !== "accepted_applications" ||
      adminAcceptedRecentLoaded ||
      adminAcceptedRecentLoading
    ) {
      return;
    }

    void refreshAdminAcceptedRecentApplications(true);
  }, [
    adminAcceptedRecentLoaded,
    adminAcceptedRecentLoading,
    adminManageTab,
    isAdmin,
    refreshAdminAcceptedRecentApplications,
  ]);

  useEffect(() => {
    if (!isAdmin || adminManageTab !== "mail_center") {
      return;
    }

    void loadAdminOpenCardOutreachPreview();
  }, [adminManageTab, isAdmin, loadAdminOpenCardOutreachPreview]);

  useEffect(() => {
    if (!isAdmin || adminManageTab !== "one_on_one_contact") {
      return;
    }

    void refreshAdminOneOnOneContactData(true);
  }, [
    adminManageTab,
    isAdmin,
    refreshAdminOneOnOneContactData,
  ]);

  useEffect(() => {
    if (!isAdmin || adminManageTab !== "payment_center" || adminPaymentCenter || adminPaymentCenterLoading) {
      return;
    }

    void refreshAdminPaymentCenter(true);
  }, [adminManageTab, adminPaymentCenter, adminPaymentCenterLoading, isAdmin, refreshAdminPaymentCenter]);

  useEffect(() => {
    if (loading || swipeSubscriptionStatus || swipeSubscriptionLoading) return;

    queueMicrotask(async () => {
      await reloadSwipeSubscriptionStatus();
    });
  }, [loading, swipeSubscriptionStatus, swipeSubscriptionLoading, reloadSwipeSubscriptionStatus]);

  useEffect(() => {
    if (!paymentCenterOpen || paymentCenterLoaded || paymentCenterLoading) return;
    void loadPaymentCenter(false);
  }, [paymentCenterLoaded, paymentCenterLoading, paymentCenterOpen, loadPaymentCenter]);

  useEffect(() => {
    if (!isAdmin || !loveFortuneOpen || loveFortuneLoaded || loveFortuneLoading) return;
    void loadLoveFortuneReadings(false);
  }, [isAdmin, loveFortuneLoaded, loveFortuneLoading, loveFortuneOpen, loadLoveFortuneReadings]);

  useEffect(() => {
    if (loading || !isAdmin) return;

    queueMicrotask(async () => {
      try {
        await refreshAdminQueueData(false);
      } catch (error) {
        console.error("[mypage] admin queue initial refresh failed", error);
      }
    });

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshAdminQueueData(false);
    }, 15000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loading, isAdmin, refreshAdminQueueData]);

  useEffect(() => {
    if (!isAdmin || activeTab !== "admin_review") return;

    queueMicrotask(async () => {
      try {
        if (document.visibilityState !== "visible") return;
        await refreshAdminQueueData(false);
      } catch (error) {
        console.error("[mypage] admin queue tab refresh failed", error);
      }
    });
  }, [activeTab, isAdmin, refreshAdminQueueData]);

  useEffect(() => {
    if (loading || !isAdmin) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void refreshAdminQueueData(false);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loading, isAdmin, refreshAdminQueueData]);

  useEffect(() => {
    if (loading || !isAdmin || adminManageTab !== "site_dashboard") return;
    queueMicrotask(async () => {
      await refreshAdminSiteDashboard(true);
    });
  }, [loading, isAdmin, adminManageTab, refreshAdminSiteDashboard]);

  useEffect(() => {
    if (loading || !supportPanelOpen || supportLoaded) return;
    let cancelled = false;

    queueMicrotask(async () => {
      setSupportLoading(true);
      setSupportError("");
      try {
        const res = await fetch("/api/mypage/support", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { items?: SupportInquiry[]; error?: string };
        if (!res.ok) {
          throw new Error(body.error ?? "문의 내역을 불러오지 못했습니다.");
        }
        if (!cancelled) {
          setSupportItems(Array.isArray(body.items) ? body.items : []);
          setSupportLoaded(true);
        }
      } catch (e) {
        if (!cancelled) {
          setSupportError(e instanceof Error ? e.message : "문의 내역을 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) {
          setSupportLoading(false);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loading, supportLoaded, supportPanelOpen]);

  useEffect(() => {
    if (!supportContactEmail && summary?.profile.email) {
      setSupportContactEmail(summary.profile.email);
    }
  }, [summary?.profile.email, supportContactEmail]);

  useEffect(() => {
    if (loading || !summary) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/mypage/marketing-consent", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { opted_out?: boolean };
        if (!cancelled && res.ok) {
          setMarketingOptedOut(body.opted_out === true);
        }
      } catch (error) {
        console.error("[mypage] marketing consent load failed", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, summary]);

  useEffect(() => {
    if (phoneOtpResendAfterSec <= 0) return;
    const timer = window.setInterval(() => {
      setPhoneOtpResendAfterSec((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phoneOtpResendAfterSec]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const normalizePhoneForOtp = (raw: string): string => {
    const digits = raw.replace(/[^0-9]/g, "");
    if (!digits) return "";
    if (digits.startsWith("0")) return `+82${digits.slice(1)}`;
    if (digits.startsWith("82")) return `+${digits}`;
    if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
    return `+${digits}`;
  };

  const handleSubmitSupportInquiry = async () => {
    if (supportSubmitting) return;
    setSupportError("");
    setSupportInfo("");

    if (!supportSubject.trim()) {
      setSupportError("문의 제목을 입력해 주세요.");
      return;
    }
    if (!supportMessage.trim()) {
      setSupportError("문의 내용을 입력해 주세요.");
      return;
    }

    setSupportSubmitting(true);
    try {
      const res = await fetch("/api/mypage/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: supportCategory,
          subject: supportSubject,
          message: supportMessage,
          contact_email: supportContactEmail,
          contact_phone: supportContactPhone,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { item?: SupportInquiry; error?: string };
      if (!res.ok || !body.item) {
        throw new Error(body.error ?? "문의 접수에 실패했습니다.");
      }

      setSupportItems((prev) => [body.item as SupportInquiry, ...prev]);
      setSupportLoaded(true);
      setSupportPanelOpen(true);
      setSupportSubject("");
      setSupportMessage("");
      setSupportInfo("문의가 접수되었습니다. 운영자가 확인 후 답변드릴게요.");
    } catch (e) {
      setSupportError(e instanceof Error ? e.message : "문의 접수에 실패했습니다.");
    } finally {
      setSupportSubmitting(false);
    }
  };

  const handleSendPhoneOtp = async () => {
    if (sendingPhoneOtp || phoneOtpResendAfterSec > 0) return;
    setPhoneVerifyError("");
    setPhoneVerifyInfo("");
    const e164 = normalizePhoneForOtp(phoneInput);
    if (!/^\+[1-9][0-9]{7,14}$/.test(e164)) {
      setPhoneVerifyError("휴대폰 번호를 올바르게 입력해주세요. 예: 01012345678");
      return;
    }

    setSendingPhoneOtp(true);
    try {
      const res = await fetch("/api/mypage/phone-verification/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: e164 }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        pendingPhone?: string;
        message?: string;
        retryAfterSec?: number;
        resendAfterSec?: number;
      };
      if (!res.ok || !body.ok) {
        setPhoneVerifyError(body.error ?? "인증번호 발송에 실패했습니다.");
        if (body.retryAfterSec && body.retryAfterSec > 0) {
          setPhoneOtpResendAfterSec(body.retryAfterSec);
        }
        return;
      }
      setPhoneOtpPending(body.pendingPhone ?? e164);
      setPhoneOtpCode("");
      setPhoneOtpResendAfterSec(body.resendAfterSec ?? 60);
      setPhoneVerifyInfo(body.message ?? "인증번호를 발송했습니다. 문자로 받은 코드를 입력해주세요.");
    } catch {
      setPhoneVerifyError("인증번호 발송 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSendingPhoneOtp(false);
    }
  };

  const handleVerifyPhoneOtp = async () => {
    if (verifyingPhoneOtp) return;
    setPhoneVerifyError("");
    setPhoneVerifyInfo("");
    if (!phoneOtpPending) {
      setPhoneVerifyError("먼저 인증번호를 발송해주세요.");
      return;
    }
    if (!phoneOtpCode.trim()) {
      setPhoneVerifyError("인증번호를 입력해주세요.");
      return;
    }

    setVerifyingPhoneOtp(true);
    try {
      const verifyRes = await fetch("/api/mypage/phone-verification/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phoneOtpPending,
          token: phoneOtpCode.trim(),
        }),
      });
      const verifyBody = (await verifyRes.json().catch(() => ({}))) as {
        error?: string;
        phone_verified?: boolean;
        phone_verified_at?: string | null;
        retryAfterSec?: number;
      };
      if (!verifyRes.ok || verifyBody.phone_verified !== true) {
        setPhoneVerifyError(verifyBody.error ?? "인증번호 확인에 실패했습니다.");
        if (verifyBody.retryAfterSec && verifyBody.retryAfterSec > 0) {
          setPhoneOtpResendAfterSec(verifyBody.retryAfterSec);
        }
        return;
      }

      setSummary((prev) =>
        prev
          ? {
              ...prev,
              profile: {
                ...prev.profile,
                phone_verified: true,
                phone_verified_at: verifyBody.phone_verified_at ?? null,
              },
            }
          : prev
      );
      setPhoneOtpCode("");
      setPhoneOtpPending(null);
      setPhoneOtpResendAfterSec(0);
      setPhoneVerifyInfo("휴대폰 인증이 완료되었습니다.");
    } catch {
      setPhoneVerifyError("인증번호 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setVerifyingPhoneOtp(false);
    }
  };

  const handleToggleSwipeVisibility = async (enabled: boolean) => {
    if (savingSwipeVisibility) return;
    setSavingSwipeVisibility(true);
    try {
      const res = await fetch("/api/mypage/swipe-visibility", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; enabled?: boolean; ok?: boolean };
      if (!res.ok || !body.ok) {
        alert(body.error ?? "빠른매칭 노출 설정 변경에 실패했습니다.");
        return;
      }
      setSummary((prev) =>
        prev
          ? {
              ...prev,
              profile: {
                ...prev.profile,
                swipe_profile_visible: body.enabled !== false,
              },
            }
          : prev
      );
    } finally {
      setSavingSwipeVisibility(false);
    }
  };

  const handleDeleteMyAppliedCardApplication = async (applicationId: string) => {
    if (deletingAppliedIds.includes(applicationId)) return;
    if (!confirm("내가 보낸 지원 기록을 삭제할까요?")) return;

    setDeletingAppliedIds((prev) => [...prev, applicationId]);
    try {
      const res = await fetch(`/api/dating/cards/my/applied/${applicationId}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!res.ok || !body.ok) {
        alert(body.error ?? "지원서 삭제에 실패했습니다.");
        return;
      }
      setMyAppliedCardApplications((prev) => prev.filter((app) => app.id !== applicationId));
      setDatingConnections((prev) =>
        prev.filter((item) => !(item.source === "open" && item.application_id === applicationId))
      );
    } finally {
      setDeletingAppliedIds((prev) => prev.filter((id) => id !== applicationId));
      }
    };

    const handleDeleteMyAppliedPaidApplication = async (applicationId: string) => {
      if (deletingPaidAppliedIds.includes(applicationId)) return;
      if (!confirm("내가 보낸 36시간 고정카드 지원 기록을 삭제할까요?")) return;

      setDeletingPaidAppliedIds((prev) => [...prev, applicationId]);
      try {
        const res = await fetch(`/api/dating/paid/my/applied/${applicationId}`, {
          method: "DELETE",
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
        if (!res.ok || !body.ok) {
          alert(body.error ?? "지원서 삭제에 실패했습니다.");
          return;
        }
        setMyAppliedPaidApplications((prev) => prev.filter((app) => app.id !== applicationId));
        setDatingConnections((prev) =>
          prev.filter((item) => !(item.source === "paid" && item.application_id === applicationId))
        );
      } finally {
        setDeletingPaidAppliedIds((prev) => prev.filter((id) => id !== applicationId));
      }
    };

    const handleCancelMyAppliedPaidApplication = async (applicationId: string) => {
      if (cancelingPaidAppliedIds.includes(applicationId)) return;
      if (!confirm("이 유료오픈카드 매칭을 취소할까요? 수락된 상태였다면 인스타 교환 목록에서도 빠집니다.")) return;

      setCancelingPaidAppliedIds((prev) => [...prev, applicationId]);
      try {
        const res = await fetch(`/api/dating/paid/applications/${applicationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "canceled" }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          ok?: boolean;
          status?: string;
          application_id?: string;
        };
        if (!res.ok || !body.ok || (body.application_id && body.application_id !== applicationId)) {
          alert(body.error ?? "매칭 취소에 실패했습니다.");
          return;
        }
        setMyAppliedPaidApplications((prev) =>
          prev.map((app) => (app.id === applicationId ? { ...app, status: "canceled" } : app))
        );
        setDatingConnections((prev) =>
          prev.filter((item) => !(item.source === "paid" && item.application_id === applicationId))
        );
      } finally {
        setCancelingPaidAppliedIds((prev) => prev.filter((id) => id !== applicationId));
      }
    };

    const handleCancelReceivedPaidApplication = async (applicationId: string) => {
      if (cancelingPaidAppliedIds.includes(applicationId)) return;
      if (!confirm("이 유료오픈카드 매칭을 취소할까요? 인스타 교환 목록에서도 빠집니다.")) return;

      setCancelingPaidAppliedIds((prev) => [...prev, applicationId]);
      try {
        const res = await fetch(`/api/dating/paid/applications/${applicationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "canceled" }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          ok?: boolean;
          status?: string;
          application_id?: string;
        };
        if (!res.ok || !body.ok || (body.application_id && body.application_id !== applicationId)) {
          alert(body.error ?? "매칭 취소에 실패했습니다.");
          return;
        }
        setReceivedPaidApplications((prev) =>
          prev.map((app) => (app.id === applicationId ? { ...app, status: "canceled" } : app))
        );
        setDatingConnections((prev) =>
          prev.filter((item) => !(item.source === "paid" && item.application_id === applicationId))
        );
      } finally {
        setCancelingPaidAppliedIds((prev) => prev.filter((id) => id !== applicationId));
      }
    };

    const handleCancelMyAppliedCardApplication = async (applicationId: string) => {
      if (cancelingAppliedIds.includes(applicationId)) return;
    if (!confirm("이 지원을 취소할까요? 수락된 상태였다면 인스타 교환 목록에서도 빠집니다.")) return;

    setCancelingAppliedIds((prev) => [...prev, applicationId]);
    try {
      const res = await fetch(`/api/dating/cards/applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "canceled" }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        status?: string;
        application_id?: string;
      };
      if (!res.ok || !body.ok || (body.application_id && body.application_id !== applicationId)) {
        alert(body.error ?? "지원 취소에 실패했습니다.");
        return;
      }
      setMyAppliedCardApplications((prev) =>
        prev.map((app) => (app.id === applicationId ? { ...app, status: "canceled" } : app))
      );
      setDatingConnections((prev) =>
        prev.filter((item) => !(item.source === "open" && item.application_id === applicationId))
      );
    } finally {
      setCancelingAppliedIds((prev) => prev.filter((id) => id !== applicationId));
    }
  };

  const handleDeleteOutgoingSwipeLike = async (item: SwipeStatusItem) => {
    if (deletingSwipeLikeIds.includes(item.swipe_id)) return;
    const confirmMessage = item.matched
      ? "이 라이크를 취소할까요? 쌍방 매칭과 인스타 교환 목록에서도 함께 빠집니다."
      : "이 라이크를 취소할까요?";
    if (!confirm(confirmMessage)) return;

    setDeletingSwipeLikeIds((prev) => [...prev, item.swipe_id]);
    try {
      const res = await fetch(`/api/dating/cards/my/swipes/${item.swipe_id}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean; message?: string };
      if (!res.ok || !body.ok) {
        alert(body.error ?? "라이크 취소에 실패했습니다.");
        return;
      }
      await Promise.all([reloadSwipeStatus(), reloadOpenDatingConnections()]);
      alert(body.message ?? "라이크를 취소했습니다.");
    } finally {
      setDeletingSwipeLikeIds((prev) => prev.filter((id) => id !== item.swipe_id));
    }
  };

  const handleDeleteAccount = async () => {
    if (deletingAccount) return;

    setAccountDeleteConfirmOpen(false);
    setDeletingAccount(true);
    try {
      const res = await fetch("/api/mypage/account", { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        message?: string;
      };
      if (!res.ok || !body.ok) {
        alert(body.error ?? "회원 탈퇴에 실패했습니다.");
        return;
      }

      try {
        await supabase.auth.signOut();
      } catch (error) {
        console.warn("[mypage] sign out after account deletion failed", error);
      }

      alert(body.message ?? "회원 탈퇴가 처리되었습니다.");
      router.replace("/");
      router.refresh();
    } catch (error) {
      console.error("[mypage] account deletion failed", error);
      alert(error instanceof Error ? error.message : "회원 탈퇴에 실패했습니다.");
    } finally {
      setDeletingAccount(false);
    }
  };

  const handleCardApplicationStatus = async (
    applicationId: string,
    nextStatus: "accepted" | "rejected"
  ) => {
    const res = await fetch(`/api/dating/cards/applications/${applicationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      alert(body.error ?? "상태 변경에 실패했습니다.");
      return;
    }

    const [receivedRes, connectionsRes] = await Promise.all([
      fetch("/api/dating/cards/my/received", { cache: "no-store" }),
      fetch("/api/dating/cards/my/connections", { cache: "no-store" }),
    ]);

    const receivedBody = (await receivedRes.json().catch(() => ({}))) as {
      cards?: MyDatingCard[];
      applications?: ReceivedCardApplication[];
      error?: string;
    };
    const connectionsBody = (await connectionsRes.json().catch(() => ({}))) as {
      items?: DatingConnection[];
      error?: string;
    };

    if (receivedRes.ok) {
      setMyDatingCards(receivedBody.cards ?? []);
      setReceivedApplications(receivedBody.applications ?? []);
    } else {
      setReceivedApplications((prev) =>
        prev.map((app) => (app.id === applicationId ? { ...app, status: nextStatus } : app))
      );
    }

    if (connectionsRes.ok) {
      const openItems = connectionsBody.items ?? [];
      setDatingConnections((prev) => {
        const paidItems = prev.filter((item) => item.source === "paid");
        return [...openItems, ...paidItems];
      });
    }
  };

  const handlePaidApplicationStatus = async (
    applicationId: string,
    nextStatus: "accepted" | "rejected"
  ) => {
    const res = await fetch(`/api/dating/paid/applications/${applicationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      alert(body.error ?? "상태 변경에 실패했습니다.");
      return;
    }
    const [paidReceivedRes, paidConnectionsRes] = await Promise.all([
      fetch("/api/dating/paid/my/received", { cache: "no-store" }),
      fetch("/api/dating/paid/my/connections", { cache: "no-store" }),
    ]);

    const paidReceivedBody = (await paidReceivedRes.json().catch(() => ({}))) as {
      cards?: MyPaidCard[];
      applications?: ReceivedPaidApplication[];
      error?: string;
    };
    const paidConnectionsBody = (await paidConnectionsRes.json().catch(() => ({}))) as {
      items?: DatingConnection[];
      error?: string;
    };

    if (paidReceivedRes.ok) {
      setMyPaidCards(paidReceivedBody.cards ?? []);
      setReceivedPaidApplications(paidReceivedBody.applications ?? []);
    } else {
      setReceivedPaidApplications((prev) =>
        prev.map((app) => (app.id === applicationId ? { ...app, status: nextStatus } : app))
      );
    }

  if (paidConnectionsRes.ok) {
      const paidItems = paidConnectionsBody.items ?? [];
      setDatingConnections((prev) => {
        const openItems = prev.filter((item) => item.source !== "paid");
        return [...openItems, ...paidItems];
      });
    }
  };

  const reloadOneOnOneMatches = async () => {
    const res = await fetch("/api/dating/1on1/matches/my", { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as { items?: MyOneOnOneMatch[]; error?: string };
    if (!res.ok) {
      throw new Error(body.error ?? "1:1 매칭 후보를 다시 불러오지 못했습니다.");
    }
    setMyOneOnOneMatches(body.items ?? []);
  };

  const reloadOneOnOneRecommendations = async () => {
    const res = await fetch("/api/dating/1on1/recommendations/my", { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as {
      items?: MyOneOnOneAutoRecommendationGroup[];
      error?: string;
    };
    if (!res.ok) {
      throw new Error(body.error ?? "1:1 자동 추천 후보를 다시 불러오지 못했습니다.");
    }
    setMyOneOnOneAutoRecommendations(body.items ?? []);
  };

  const reloadOneOnOnePhoneBlocks = async () => {
    const res = await fetch("/api/dating/1on1/phone-blocks", { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as { items?: MyOneOnOnePhoneBlock[]; error?: string };
    if (!res.ok) {
      throw new Error(body.error ?? "1:1 지인 차단 목록을 다시 불러오지 못했습니다.");
    }
    setMyOneOnOnePhoneBlocks(body.items ?? []);
  };

  const handleAddOneOnOnePhoneBlock = async () => {
    if (oneOnOnePhoneBlockSubmitting) return;
    const phone = oneOnOneBlockPhoneInput.trim();
    if (!phone) {
      alert("차단할 휴대폰 번호를 입력해주세요.");
      return;
    }

    setOneOnOnePhoneBlockSubmitting(true);
    try {
      const res = await fetch("/api/dating/1on1/phone-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          label: oneOnOneBlockLabelInput.trim() || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        item?: MyOneOnOnePhoneBlock | null;
        error?: string;
      };
      if (!res.ok || body.ok === false) {
        alert(body.error ?? "차단 번호 저장에 실패했습니다.");
        return;
      }
      setOneOnOneBlockPhoneInput("");
      setOneOnOneBlockLabelInput("");
      await Promise.all([reloadOneOnOnePhoneBlocks(), reloadOneOnOneRecommendations()]);
      alert("1:1 후보에서 서로 보이지 않도록 차단했습니다.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "차단 번호 저장에 실패했습니다.");
    } finally {
      setOneOnOnePhoneBlockSubmitting(false);
    }
  };

  const handleDeleteOneOnOnePhoneBlock = async (id: string) => {
    if (deletingOneOnOnePhoneBlockIds.includes(id)) return;
    if (!confirm("이 번호 차단을 해제할까요? 이후 1:1 후보로 다시 노출될 수 있습니다.")) return;

    setDeletingOneOnOnePhoneBlockIds((prev) => [...prev, id]);
    try {
      const res = await fetch("/api/dating/1on1/phone-blocks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || body.ok === false) {
        alert(body.error ?? "차단 번호 삭제에 실패했습니다.");
        return;
      }
      await Promise.all([reloadOneOnOnePhoneBlocks(), reloadOneOnOneRecommendations()]);
    } catch (e) {
      alert(e instanceof Error ? e.message : "차단 번호 삭제에 실패했습니다.");
    } finally {
      setDeletingOneOnOnePhoneBlockIds((prev) => prev.filter((blockId) => blockId !== id));
    }
  };

  const reloadDatingContactBlocks = async () => {
    const res = await fetch("/api/dating/contact-blocks", { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as { items?: MyDatingContactBlock[]; error?: string };
    if (!res.ok) {
      throw new Error(body.error ?? "오픈카드 지인 차단 목록을 다시 불러오지 못했습니다.");
    }
    setMyDatingContactBlocks(body.items ?? []);
  };

  const handleAddDatingContactBlock = async () => {
    if (datingContactBlockSubmitting) return;
    const value = datingContactBlockValue.trim();
    if (!value) {
      alert(datingContactBlockType === "phone" ? "차단할 휴대폰 번호를 입력해주세요." : "차단할 인스타 아이디를 입력해주세요.");
      return;
    }

    setDatingContactBlockSubmitting(true);
    try {
      const res = await fetch("/api/dating/contact-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          block_type: datingContactBlockType,
          value,
          label: datingContactBlockLabel.trim() || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        item?: MyDatingContactBlock | null;
        error?: string;
      };
      if (!res.ok || body.ok === false) {
        alert(body.error ?? "오픈카드 지인 차단 저장에 실패했습니다.");
        return;
      }
      setDatingContactBlockValue("");
      setDatingContactBlockLabel("");
      await Promise.all([reloadDatingContactBlocks(), reloadSwipeStatus()]);
      alert("오픈카드와 빠른매칭에서 서로 보이지 않도록 차단했습니다.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "오픈카드 지인 차단 저장에 실패했습니다.");
    } finally {
      setDatingContactBlockSubmitting(false);
    }
  };

  const handleDeleteDatingContactBlock = async (id: string) => {
    if (deletingDatingContactBlockIds.includes(id)) return;
    if (!confirm("이 지인 차단을 해제할까요? 이후 오픈카드나 빠른매칭에서 다시 보일 수 있습니다.")) return;

    setDeletingDatingContactBlockIds((prev) => [...prev, id]);
    try {
      const res = await fetch("/api/dating/contact-blocks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || body.ok === false) {
        alert(body.error ?? "오픈카드 지인 차단 삭제에 실패했습니다.");
        return;
      }
      await Promise.all([reloadDatingContactBlocks(), reloadSwipeStatus()]);
    } catch (e) {
      alert(e instanceof Error ? e.message : "오픈카드 지인 차단 삭제에 실패했습니다.");
    } finally {
      setDeletingDatingContactBlockIds((prev) => prev.filter((blockId) => blockId !== id));
    }
  };

  const handleDatingUserReport = async (
    targetType: DatingUserReportTargetType,
    targetId: string,
    label: string
  ) => {
    const reportKey = `${targetType}:${targetId}`;
    if (reportingDatingTargetKeys.includes(reportKey)) return;

    const detail = window.prompt(
      `${label} 신고 사유를 간단히 적어주세요.\n허위 정보, 불쾌한 표현, 광고, 안전 우려 등을 적어주시면 관리자가 확인합니다.`,
      ""
    );
    if (detail === null) return;

    setReportingDatingTargetKeys((prev) => [...prev, reportKey]);
    try {
      const res = await fetch("/api/dating/user-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_type: targetType,
          target_id: targetId,
          reason_code: "safety_risk",
          detail,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || body.ok === false) {
        alert(body.message ?? "신고 접수에 실패했습니다.");
        return;
      }
      alert("신고가 접수됐습니다. 관리자가 확인할게요.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "신고 접수에 실패했습니다.");
    } finally {
      setReportingDatingTargetKeys((prev) => prev.filter((key) => key !== reportKey));
    }
  };

  const reloadSwipeStatus = useCallback(async () => {
    setSwipeStatusLoading(true);
    try {
      const res = await fetch("/api/dating/cards/my/swipe-status", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as SwipeStatusResponse;
      if (!res.ok) {
        throw new Error(body.error ?? "빠른매칭 상태를 다시 불러오지 못했습니다.");
      }
      setSwipeStatusSummary(body.summary ?? null);
      setMyOutgoingSwipeLikes(body.outgoing_likes ?? []);
      setMyIncomingSwipeLikes(body.incoming_likes ?? []);
      setShowAllOutgoingSwipeLikes(false);
      setShowAllIncomingSwipeLikes(false);
      setSwipeStatusLoaded(true);
    } finally {
      setSwipeStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loading || swipeStatusLoaded || swipeStatusLoading) return;
    void reloadSwipeStatus().catch((error) => {
      console.error("[mypage] initial swipe status load failed", error);
    });
  }, [loading, reloadSwipeStatus, swipeStatusLoaded, swipeStatusLoading]);

  const handleToggleSwipeStatusPanel = async () => {
    const nextOpen = !swipeStatusPanelOpen;
    setSwipeStatusPanelOpen(nextOpen);
    if (nextOpen && !swipeStatusLoaded && !swipeStatusLoading) {
      try {
        await reloadSwipeStatus();
      } catch (e) {
        alert(e instanceof Error ? e.message : "빠른매칭 상태를 불러오지 못했습니다.");
      }
    }
  };

  const handleRequestSwipeSubscription = async () => {
    if (swipeSubscriptionSubmitting) return;
    setSwipeSubscriptionSubmitting(true);
    setSwipeSubscriptionError("");
    setSwipeSubscriptionInfo("");
    try {
      const res = await fetch("/api/payments/toss/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productType: "swipe_premium_30d",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        checkoutUrl?: string;
      };
      if (!res.ok || body.ok === false) {
        throw new Error(withPaymentCardNotice(body.message ?? body.error ?? "빠른매칭 플러스 결제를 시작하지 못했습니다."));
      }
      if (!body.checkoutUrl) {
        throw new Error(withPaymentCardNotice("결제창을 열지 못했습니다."));
      }
      window.location.href = body.checkoutUrl;
    } catch (error) {
      setSwipeSubscriptionError(
        error instanceof Error ? error.message : withPaymentCardNotice("빠른매칭 플러스 결제를 시작하지 못했습니다.")
      );
    } finally {
      setSwipeSubscriptionSubmitting(false);
    }
  };

  const reloadOpenDatingConnections = async () => {
    const [openRes, paidRes] = await Promise.all([
      fetch("/api/dating/cards/my/connections", { cache: "no-store" }),
      fetch("/api/dating/paid/my/connections", { cache: "no-store" }),
    ]);
    const openBody = (await openRes.json().catch(() => ({}))) as { items?: DatingConnection[]; error?: string };
    const paidBody = (await paidRes.json().catch(() => ({}))) as { items?: DatingConnection[]; error?: string };
    if (!openRes.ok) {
      throw new Error(openBody.error ?? "오픈카드 매칭 정보를 다시 불러오지 못했습니다.");
    }
    if (!paidRes.ok) {
      throw new Error(paidBody.error ?? "유료카드 매칭 정보를 다시 불러오지 못했습니다.");
    }
    setDatingConnections([...(openBody.items ?? []), ...(paidBody.items ?? [])]);
  };

  const reloadOpenAppliedApplications = async () => {
    const [receivedRes, appliedRes] = await Promise.all([
      fetch("/api/dating/cards/my/received", { cache: "no-store" }),
      fetch("/api/dating/cards/my/applied", { cache: "no-store" }),
    ]);

    const receivedBody = (await receivedRes.json().catch(() => ({}))) as {
      cards?: MyDatingCard[];
      applications?: ReceivedCardApplication[];
      error?: string;
    };
    const appliedBody = (await appliedRes.json().catch(() => ({}))) as {
      applications?: MyAppliedCardApplication[];
      error?: string;
    };

    if (receivedRes.ok) {
      setMyDatingCards(receivedBody.cards ?? []);
      setReceivedApplications(receivedBody.applications ?? []);
    }
    if (appliedRes.ok) {
      setMyAppliedCardApplications(appliedBody.applications ?? []);
    }
  };

  const reloadPaidAppliedApplications = async () => {
    const [receivedRes, appliedRes] = await Promise.all([
      fetch("/api/dating/paid/my/received", { cache: "no-store" }),
      fetch("/api/dating/paid/my/applied", { cache: "no-store" }),
    ]);

    const receivedBody = (await receivedRes.json().catch(() => ({}))) as {
      cards?: MyPaidCard[];
      applications?: ReceivedPaidApplication[];
      error?: string;
    };
    const appliedBody = (await appliedRes.json().catch(() => ({}))) as {
      applications?: MyAppliedPaidApplication[];
      error?: string;
    };

    if (receivedRes.ok) {
      setMyPaidCards(receivedBody.cards ?? []);
      setReceivedPaidApplications(receivedBody.applications ?? []);
    }
    if (appliedRes.ok) {
      setMyAppliedPaidApplications(appliedBody.applications ?? []);
    }
  };

  const handleDeleteDatingConnection = async (item: DatingConnection) => {
    const deletingKey = `${item.source ?? "open"}:${item.application_id}`;
    if (deletingConnectionIds.includes(deletingKey)) return;

    const confirmMessage =
      item.source === "swipe"
        ? "이 자동 매칭을 삭제할까요? 인스타 교환 목록과 빠른매칭 매칭 상태에서 함께 빠집니다."
        : "이 연결을 삭제할까요? 인스타 교환 목록에서 바로 빠집니다.";
    if (!confirm(confirmMessage)) return;

    setDeletingConnectionIds((prev) => [...prev, deletingKey]);
    try {
      let res: Response;

      if (item.source === "swipe") {
        res = await fetch(`/api/dating/cards/my/swipe-matches/${item.application_id}`, {
          method: "DELETE",
        });
      } else if (item.source === "paid") {
        res = await fetch(`/api/dating/paid/applications/${item.application_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "canceled" }),
        });
      } else {
        res = await fetch(`/api/dating/cards/applications/${item.application_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "canceled" }),
        });
      }

      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        message?: string;
        application_id?: string;
      };
      if (
        !res.ok ||
        body.ok === false ||
        (item.source !== "swipe" && body.application_id && body.application_id !== item.application_id)
      ) {
        alert(body.error ?? body.message ?? "연결 삭제에 실패했습니다.");
        return;
      }

      setDatingConnections((prev) =>
        prev.filter(
          (connection) =>
            !(
              (connection.source ?? "open") === (item.source ?? "open") &&
              connection.application_id === item.application_id
            )
        )
      );

      if (item.source === "swipe") {
        await reloadSwipeStatus();
      } else if (item.source === "paid") {
        await reloadPaidAppliedApplications();
      } else {
        await reloadOpenAppliedApplications();
      }

      alert(body.message ?? "연결을 삭제했습니다.");
    } finally {
      setDeletingConnectionIds((prev) => prev.filter((id) => id !== deletingKey));
    }
  };

  const handleSwipeLikeBack = async (item: SwipeStatusItem) => {
    if (processingSwipeLikeBackIds.includes(item.swipe_id)) return;
    if (!item.card?.id || !item.card.sex) {
      alert("상대 카드 정보를 찾지 못했습니다.");
      return;
    }
    setProcessingSwipeLikeBackIds((prev) => [...prev, item.swipe_id]);
    try {
      const res = await fetch("/api/dating/cards/swipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sex: item.card.sex,
          action: "like",
          target_user_id: item.other_user_id,
          target_card_id: item.card.id,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        match?: { other_nickname?: string; other_instagram_id?: string | null };
      };
      if (!res.ok) {
        alert(body.error ?? "맞라이크 처리에 실패했습니다.");
        return;
      }
      await Promise.all([reloadSwipeStatus(), reloadOpenDatingConnections()]);
      if (body.match) {
        alert(
          `${body.match.other_nickname ?? item.card.display_nickname}님과 쌍방 라이크가 되었습니다.${
            body.match.other_instagram_id ? `\n상대 인스타: @${body.match.other_instagram_id}` : ""
          }`
        );
      } else {
        alert("라이크를 보냈습니다. 상대가 아직 확인 중일 수 있어요.");
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "맞라이크 처리에 실패했습니다.");
    } finally {
      setProcessingSwipeLikeBackIds((prev) => prev.filter((id) => id !== item.swipe_id));
    }
  };

  const handleDatingExport = (kind: string) => {
    if (typeof window === "undefined") return;
    window.open(`/api/admin/dating/export?kind=${encodeURIComponent(kind)}`, "_blank", "noopener,noreferrer");
  };

  const topSignalLabels = (signals: Array<{ key: DatingInsightSignalKey }>, limit = 3) =>
    signals
      .slice(0, limit)
      .map((item) => DATING_INSIGHT_SIGNAL_LABELS[item.key])
      .join(", ");

  const handleOneOnOneMatchAction = async (
    matchId: string,
    action: "select_candidate" | "candidate_accept" | "candidate_reject" | "source_accept" | "source_reject" | "cancel_mutual"
  ) => {
    if (processingOneOnOneMatchIds.includes(matchId)) return;
    setProcessingOneOnOneMatchIds((prev) => [...prev, matchId]);
    try {
      const res = await fetch(`/api/dating/1on1/matches/${matchId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        alert(body.error ?? "1:1 매칭 처리에 실패했습니다.");
        return;
      }
      await Promise.all([reloadOneOnOneMatches(), reloadOneOnOneRecommendations()]);
    } catch (e) {
      alert(e instanceof Error ? e.message : "1:1 매칭 처리에 실패했습니다.");
    } finally {
      setProcessingOneOnOneMatchIds((prev) => prev.filter((id) => id !== matchId));
    }
  };

  const handleRequestOneOnOneContactExchange = async (matchId: string) => {
    if (processingOneOnOneContactExchangeIds.includes(matchId)) return;
    setProcessingOneOnOneContactExchangeIds((prev) => [...prev, matchId]);
    try {
      const res = await fetch("/api/payments/toss/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productType: "one_on_one_contact_exchange",
          matchId,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        checkoutUrl?: string;
        fulfilledWithoutPayment?: boolean;
      };
      if (!res.ok || !body.ok) {
        alert(withPaymentCardNotice(body.message ?? body.error ?? "번호 교환 결제를 시작하지 못했습니다."));
        return;
      }
      if (body.fulfilledWithoutPayment) {
        await Promise.all([reloadOneOnOneMatches(), reloadOneOnOneRecommendations()]);
        alert(body.message ?? "1:1 매칭 플러스로 번호교환이 완료되었습니다.");
        return;
      }
      if (!body.checkoutUrl) {
        alert(withPaymentCardNotice("결제창을 열지 못했습니다."));
        return;
      }
      window.location.href = body.checkoutUrl;
    } catch (e) {
      alert(e instanceof Error ? e.message : withPaymentCardNotice("번호 교환 결제를 시작하지 못했습니다."));
    } finally {
      setProcessingOneOnOneContactExchangeIds((prev) => prev.filter((id) => id !== matchId));
    }
  };

  const handleOneOnOneAutoRecommendationSelect = async (sourceCardId: string, candidateCardId: string) => {
    const actionKey = `${sourceCardId}:${candidateCardId}`;
    if (processingOneOnOneAutoKeys.includes(actionKey)) return;
    setProcessingOneOnOneAutoKeys((prev) => [...prev, actionKey]);
    try {
      const res = await fetch("/api/dating/1on1/matches/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_card_id: sourceCardId,
          candidate_card_id: candidateCardId,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        alert(body.error ?? "자동 추천 후보 선택에 실패했습니다.");
        return;
      }
      await Promise.all([reloadOneOnOneMatches(), reloadOneOnOneRecommendations()]);
    } catch (e) {
      alert(e instanceof Error ? e.message : "자동 추천 후보 선택에 실패했습니다.");
    } finally {
      setProcessingOneOnOneAutoKeys((prev) => prev.filter((key) => key !== actionKey));
    }
  };

  const handleRefreshOneOnOneRecommendations = async (sourceCardId: string) => {
    if (refreshingOneOnOneRecommendationIds.includes(sourceCardId)) return;
    const recommendationGroup = myOneOnOneAutoRecommendations.find((group) => group.source_card_id === sourceCardId);
    const refreshLimit = recommendationGroup?.refresh_limit ?? 1;
    const refreshRemaining = recommendationGroup?.refresh_remaining ?? (recommendationGroup?.can_refresh ? 1 : 0);
    if (!confirm(`자동 추천 후보 10명을 새로 불러올까요? 최근 24시간 기준 ${refreshLimit}회 중 ${refreshRemaining}회 남았습니다.`)) return;

    setRefreshingOneOnOneRecommendationIds((prev) => [...prev, sourceCardId]);
    try {
      const res = await fetch("/api/dating/1on1/recommendations/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_card_id: sourceCardId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        refresh_remaining?: number;
        request_id?: string;
      };
      if (!res.ok || !body.ok) {
        const message = body.error ?? "자동 추천 후보를 새로고침하지 못했습니다.";
        alert(body.request_id ? `${message}\n문의 코드: ${body.request_id}` : message);
        return;
      }

      await reloadOneOnOneRecommendations();
      alert(
        body.refresh_remaining && body.refresh_remaining > 0
          ? `새 후보를 불러왔습니다. 최근 24시간 기준 ${body.refresh_remaining}회 더 새로고침할 수 있습니다.`
          : "새 후보를 불러왔습니다. 다음 이용 가능 시각은 화면에서 확인할 수 있습니다."
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "자동 추천 후보를 새로고침하지 못했습니다.");
    } finally {
      setRefreshingOneOnOneRecommendationIds((prev) => prev.filter((id) => id !== sourceCardId));
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert("이미 승인된 주문입니다.");
    } catch {
      alert("지원권이 이미 소진되었습니다.");
    }
  };

  const openAdminOpenCardEditor = (card: AdminOpenCard) => {
    setEditingAdminOpenCardId(card.id);
    setAdminOpenCardDraft({
      display_nickname: card.display_nickname ?? "",
      age: card.age != null ? String(card.age) : "",
      region: card.region ?? "",
      height_cm: card.height_cm != null ? String(card.height_cm) : "",
      job: card.job ?? "",
      training_years: card.training_years != null ? String(card.training_years) : "",
      strengths_text: card.strengths_text ?? "",
      ideal_type: card.ideal_type ?? "",
      instagram_id: card.instagram_id ?? "",
      total_3lift: card.total_3lift != null ? String(card.total_3lift) : "",
      percent_all: card.percent_all != null ? String(card.percent_all) : "",
    });
  };

  const closeAdminOpenCardEditor = () => {
    if (savingAdminOpenCard) return;
    setEditingAdminOpenCardId(null);
    setAdminOpenCardDraft(null);
  };

  const handleAdminSaveOpenCard = async (cardId: string) => {
    if (!adminOpenCardDraft) return;
    setSavingAdminOpenCard(true);
    try {
      const res = await fetch(`/api/admin/dating/cards/${cardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adminOpenCardDraft),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        item?: Partial<AdminOpenCard> | null;
      };
      if (!res.ok) {
        alert(body.error ?? "카드 수정에 실패했습니다.");
        return;
      }
      setAdminOpenCards((prev) =>
        prev.map((card) =>
          card.id === cardId
            ? {
                ...card,
                ...(body.item ?? {}),
              }
            : card
        )
      );
      setEditingAdminOpenCardId(null);
      setAdminOpenCardDraft(null);
      alert("카드 내용을 수정했습니다.");
    } finally {
      setSavingAdminOpenCard(false);
    }
  };

  const handleAdminDeleteOpenCard = async (cardId: string) => {
    if (!confirm("해당 오픈카드를 삭제할까요?")) return;
    const res = await fetch(`/api/admin/dating/cards/${cardId}`, {
      method: "DELETE",
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      alert(body.error ?? "카드 삭제에 실패했습니다.");
      return;
    }
    setAdminOpenCards((prev) => prev.filter((card) => card.id !== cardId));
    setAdminOpenCardApplications((prev) => prev.filter((app) => app.card_id !== cardId));
    if (editingAdminOpenCardId === cardId) {
      setEditingAdminOpenCardId(null);
      setAdminOpenCardDraft(null);
    }
  };

  const handleAdminToggleOpenCardWrite = async (enabled: boolean) => {
    setOpenCardWriteSaving(true);
    try {
      const res = await fetch("/api/admin/dating/cards/write-enabled", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; enabled?: boolean };
      if (!res.ok) {
        alert(body.error ?? "오픈카드 작성 설정 변경에 실패했습니다.");
        return;
      }
      setOpenCardWriteEnabled(body.enabled !== false);
    } finally {
      setOpenCardWriteSaving(false);
    }
  };

  const handleToggleMarketingConsent = async () => {
    if (marketingConsentLoading) return;
    const nextOptedOut = marketingOptedOut !== true;

    setMarketingConsentLoading(true);
    setMarketingConsentMessage("");

    try {
      const res = await fetch("/api/mypage/marketing-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opted_out: nextOptedOut }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; opted_out?: boolean };
      if (!res.ok) {
        setMarketingConsentMessage(body.error ?? "수신 설정을 저장하지 못했습니다.");
        return;
      }

      const optedOut = body.opted_out === true;
      setMarketingOptedOut(optedOut);
      setMarketingConsentMessage(optedOut ? "안내 메일/문자 수신을 거부했습니다." : "안내 메일/문자 수신거부를 해제했습니다.");
    } catch (error) {
      setMarketingConsentMessage(error instanceof Error ? error.message : "수신 설정을 저장하지 못했습니다.");
    } finally {
      setMarketingConsentLoading(false);
    }
  };

  const handleRequestOneOnOnePriority = async (cardId: string) => {
    if (oneOnOnePrioritySubmittingIds.includes(cardId)) return;
    setOneOnOnePrioritySubmittingIds((prev) => [...prev, cardId]);
    try {
      const res = await fetch("/api/payments/toss/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productType: "one_on_one_plus_30d",
          cardId,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        checkoutUrl?: string;
      };
      if (!res.ok || body.ok === false) {
        throw new Error(withPaymentCardNotice(body.message ?? body.error ?? "1:1 매칭 플러스 결제를 시작하지 못했습니다."));
      }
      if (!body.checkoutUrl) {
        throw new Error(withPaymentCardNotice("결제창을 열지 못했습니다."));
      }
      window.location.href = body.checkoutUrl;
    } catch (error) {
      alert(error instanceof Error ? error.message : withPaymentCardNotice("1:1 매칭 플러스 결제를 시작하지 못했습니다."));
    } finally {
      setOneOnOnePrioritySubmittingIds((prev) => prev.filter((id) => id !== cardId));
    }
  };

  const handleAdminSaveOpenCardHomeCopy = async () => {
    setOpenCardHomeCopySaving(true);
    setOpenCardHomeCopyError("");
    setOpenCardHomeCopyInfo("");
    try {
      const res = await fetch("/api/admin/dating/cards/home-copy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subtitle: openCardHomeSubtitle }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        setting?: OpenCardHomeCopyResponse;
      };
      if (!res.ok || !body.ok || !body.setting) {
        setOpenCardHomeCopyError(body.error ?? "오픈카드 홈 문구 저장에 실패했습니다.");
        return;
      }

      setOpenCardHomeSubtitle(body.setting.subtitle?.trim() || DEFAULT_OPEN_CARD_HOME_SUBTITLE);
      setOpenCardHomeCopyInfo("오픈카드 홈 문구를 저장했습니다.");
    } catch (e) {
      setOpenCardHomeCopyError(e instanceof Error ? e.message : "오픈카드 홈 문구 저장에 실패했습니다.");
    } finally {
      setOpenCardHomeCopySaving(false);
    }
  };

  const handleAdminSaveOpenCardPublicSlots = async () => {
    setOpenCardPublicSlotsSaving(true);
    setOpenCardPublicSlotsError("");
    setOpenCardPublicSlotsInfo("");
    try {
      const maleExtra = Math.max(0, Math.floor(Number(openCardPublicMaleExtra || 0)));
      const femaleExtra = Math.max(0, Math.floor(Number(openCardPublicFemaleExtra || 0)));
      const res = await fetch("/api/admin/dating/cards/public-slots", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maleExtra, femaleExtra }),
      });
      const body = (await res.json().catch(() => ({}))) as OpenCardPublicSlotsResponse;
      const setting = body.setting ?? body;
      if (!res.ok || body.ok === false) {
        setOpenCardPublicSlotsError(body.error ?? "오픈카드 공개 수 저장에 실패했습니다.");
        if (setting) {
          setOpenCardPublicMaleExtra(String(Math.max(0, Number(setting.maleExtra ?? maleExtra))));
          setOpenCardPublicFemaleExtra(String(Math.max(0, Number(setting.femaleExtra ?? femaleExtra))));
          setOpenCardPublicMaleEffectiveLimit(Math.max(0, Number(setting.maleEffectiveLimit ?? 30 + maleExtra)));
          setOpenCardPublicFemaleEffectiveLimit(Math.max(0, Number(setting.femaleEffectiveLimit ?? 30 + femaleExtra)));
        }
        return;
      }

      setOpenCardPublicMaleExtra(String(Math.max(0, Number(setting.maleExtra ?? maleExtra))));
      setOpenCardPublicFemaleExtra(String(Math.max(0, Number(setting.femaleExtra ?? femaleExtra))));
      setOpenCardPublicMaleEffectiveLimit(Math.max(0, Number(setting.maleEffectiveLimit ?? 30 + maleExtra)));
      setOpenCardPublicFemaleEffectiveLimit(Math.max(0, Number(setting.femaleEffectiveLimit ?? 30 + femaleExtra)));
      setOpenCardPublicSlotsInfo("오픈카드 공개 수를 저장하고 대기열을 동기화했습니다.");
      await refreshAdminSiteDashboard(true);
    } catch (e) {
      setOpenCardPublicSlotsError(e instanceof Error ? e.message : "오픈카드 공개 수 저장에 실패했습니다.");
    } finally {
      setOpenCardPublicSlotsSaving(false);
    }
  };

  const handleAdminSaveToolsPatchNote = async () => {
    setToolsPatchNoteSaving(true);
    setToolsPatchNoteError("");
    setToolsPatchNoteInfo("");
    try {
      const res = await fetch("/api/admin/tools/patch-note", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: toolsPatchNoteEnabled, text: toolsPatchNoteText }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        setting?: ToolsPatchNoteResponse;
      };
      if (!res.ok || !body.ok || !body.setting) {
        setToolsPatchNoteError(body.error ?? "도구 패치노트 저장에 실패했습니다.");
        return;
      }

      setToolsPatchNoteEnabled(body.setting.enabled === true);
      setToolsPatchNoteText(body.setting.text?.trim() ?? "");
      setToolsPatchNoteItems(Array.isArray(body.setting.items) ? body.setting.items : []);
      setEditingToolsPatchNoteId("");
      setEditingToolsPatchNoteText("");
      setToolsPatchNoteInfo("도구 패치노트를 추가했습니다.");
    } catch (e) {
      setToolsPatchNoteError(e instanceof Error ? e.message : "도구 패치노트 저장에 실패했습니다.");
    } finally {
      setToolsPatchNoteSaving(false);
    }
  };

  const handleAdminUpdateToolsPatchNoteItem = async (itemId: string) => {
    const nextText = editingToolsPatchNoteText.trim().replace(/\s{2,}/g, " ").slice(0, 120);
    if (!nextText) {
      setToolsPatchNoteError("수정할 패치노트 내용을 입력해 주세요.");
      return;
    }

    const nextItems = (toolsPatchNoteItems ?? []).map((item) =>
      item.id === itemId ? { ...item, text: nextText } : item
    );
    setToolsPatchNoteSaving(true);
    setToolsPatchNoteError("");
    setToolsPatchNoteInfo("");
    try {
      const res = await fetch("/api/admin/tools/patch-note", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: toolsPatchNoteEnabled, items: nextItems }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        setting?: ToolsPatchNoteResponse;
      };
      if (!res.ok || !body.ok || !body.setting) {
        setToolsPatchNoteError(body.error ?? "도구 패치노트 수정에 실패했습니다.");
        return;
      }

      setToolsPatchNoteEnabled(body.setting.enabled === true);
      setToolsPatchNoteText(body.setting.text?.trim() ?? "");
      setToolsPatchNoteItems(Array.isArray(body.setting.items) ? body.setting.items : []);
      setEditingToolsPatchNoteId("");
      setEditingToolsPatchNoteText("");
      setToolsPatchNoteInfo("도구 패치노트를 수정했습니다.");
    } catch (e) {
      setToolsPatchNoteError(e instanceof Error ? e.message : "도구 패치노트 수정에 실패했습니다.");
    } finally {
      setToolsPatchNoteSaving(false);
    }
  };

  const handleAdminDeleteToolsPatchNoteItem = async (itemId: string) => {
    if (toolsPatchNoteSaving) return;
    if (!confirm("이 패치노트를 삭제할까요?")) return;

    const nextItems = (toolsPatchNoteItems ?? []).filter((item) => item.id !== itemId);
    setToolsPatchNoteSaving(true);
    setToolsPatchNoteError("");
    setToolsPatchNoteInfo("");
    try {
      const res = await fetch("/api/admin/tools/patch-note", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: toolsPatchNoteEnabled, items: nextItems }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        setting?: ToolsPatchNoteResponse;
      };
      if (!res.ok || !body.ok || !body.setting) {
        setToolsPatchNoteError(body.error ?? "도구 패치노트 삭제에 실패했습니다.");
        return;
      }

      setToolsPatchNoteEnabled(body.setting.enabled === true);
      setToolsPatchNoteText(body.setting.text?.trim() ?? "");
      setToolsPatchNoteItems(Array.isArray(body.setting.items) ? body.setting.items : []);
      setEditingToolsPatchNoteId("");
      setEditingToolsPatchNoteText("");
      setToolsPatchNoteInfo("도구 패치노트를 삭제했습니다.");
    } catch (e) {
      setToolsPatchNoteError(e instanceof Error ? e.message : "도구 패치노트 삭제에 실패했습니다.");
    } finally {
      setToolsPatchNoteSaving(false);
    }
  };

  const handleAdminSaveSiteGuideMascot = async () => {
    setSiteGuideMascotSaving(true);
    setSiteGuideMascotError("");
    setSiteGuideMascotInfo("");
    try {
      const res = await fetch("/api/admin/site-guide/mascot", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedId: siteGuideMascotId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        setting?: SiteGuideMascotResponse;
      };
      if (!res.ok || !body.ok || !body.setting) {
        setSiteGuideMascotError(body.error ?? "짐냥이 설정 저장에 실패했습니다.");
        return;
      }

      setSiteGuideMascotId(body.setting.selectedId ?? siteGuideMascotId);
      setSiteGuideMascotOptions(
        Array.isArray(body.setting.options) && body.setting.options.length > 0
          ? body.setting.options
          : siteGuideMascotOptions
      );
      setSiteGuideMascotInfo("짐냥이 이미지를 저장했습니다.");
    } catch (e) {
      setSiteGuideMascotError(e instanceof Error ? e.message : "짐냥이 설정 저장에 실패했습니다.");
    } finally {
      setSiteGuideMascotSaving(false);
    }
  };

  const handleAdminUploadSiteGuideMascot = async (file: File | null | undefined) => {
    if (!file) return;

    setSiteGuideMascotUploading(true);
    setSiteGuideMascotError("");
    setSiteGuideMascotInfo("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/site-guide/mascot", {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        setting?: SiteGuideMascotResponse;
      };
      if (!res.ok || !body.ok || !body.setting) {
        setSiteGuideMascotError(body.error ?? "짐냥이 이미지 업로드에 실패했습니다.");
        return;
      }

      setSiteGuideMascotId(body.setting.selectedId ?? siteGuideMascotId);
      setSiteGuideMascotOptions(
        Array.isArray(body.setting.options) && body.setting.options.length > 0
          ? body.setting.options
          : siteGuideMascotOptions
      );
      setSiteGuideMascotInfo("업로드한 짐냥이를 저장했습니다.");
    } catch (e) {
      setSiteGuideMascotError(e instanceof Error ? e.message : "짐냥이 이미지 업로드에 실패했습니다.");
    } finally {
      setSiteGuideMascotUploading(false);
    }
  };

  const resetAdminReelsDatingDraft = () => {
    setAdminReelsDatingEditingId("");
    setAdminReelsDatingDraft({ title: "", description: "", instagram_url: "", status: "active", sort_order: "0" });
  };

  const handleAdminEditReelsDatingListing = (item: AdminReelsDatingListing) => {
    setAdminReelsDatingEditingId(item.id);
    setAdminReelsDatingDraft({
      title: item.title ?? "",
      description: item.description ?? "",
      instagram_url: item.instagram_url ?? "",
      status: item.status === "hidden" ? "hidden" : "active",
      sort_order: String(item.sort_order ?? 0),
    });
    setAdminReelsDatingInfo("");
    setAdminReelsDatingError("");
  };

  const handleAdminSaveReelsDatingListing = async () => {
    if (adminReelsDatingSaving) return;
    setAdminReelsDatingSaving(true);
    setAdminReelsDatingError("");
    setAdminReelsDatingInfo("");

    try {
      const payload = {
        title: adminReelsDatingDraft.title.trim(),
        description: adminReelsDatingDraft.description.trim(),
        instagram_url: adminReelsDatingDraft.instagram_url.trim(),
        status: adminReelsDatingDraft.status,
        sort_order: Number(adminReelsDatingDraft.sort_order) || 0,
      };
      const url = adminReelsDatingEditingId
        ? `/api/admin/dating/reels/${encodeURIComponent(adminReelsDatingEditingId)}`
        : "/api/admin/dating/reels";
      const res = await fetch(url, {
        method: adminReelsDatingEditingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "릴스 매물 저장에 실패했습니다.");
      setAdminReelsDatingInfo(adminReelsDatingEditingId ? "릴스 매물을 수정했습니다." : "릴스 매물을 추가했습니다.");
      resetAdminReelsDatingDraft();
      await refreshAdminReelsDatingData(false);
    } catch (e) {
      setAdminReelsDatingError(e instanceof Error ? e.message : "릴스 매물 저장에 실패했습니다.");
    } finally {
      setAdminReelsDatingSaving(false);
    }
  };

  const handleAdminDeleteReelsDatingListing = async (itemId: string) => {
    if (!confirm("이 릴스 매물과 지원서를 삭제할까요?")) return;
    setAdminReelsDatingError("");
    setAdminReelsDatingInfo("");

    try {
      const res = await fetch(`/api/admin/dating/reels/${encodeURIComponent(itemId)}`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "릴스 매물 삭제에 실패했습니다.");
      setAdminReelsDatingInfo("릴스 매물을 삭제했습니다.");
      if (adminReelsDatingEditingId === itemId) resetAdminReelsDatingDraft();
      await refreshAdminReelsDatingData(false);
    } catch (e) {
      setAdminReelsDatingError(e instanceof Error ? e.message : "릴스 매물 삭제에 실패했습니다.");
    }
  };

  const handleAdminSearchEmailUnsubscribes = async () => {
    const query = adminEmailUnsubscribeQuery.trim();
    if (query.length < 2) {
      setAdminEmailUnsubscribeError("이메일 또는 사용자 ID를 2글자 이상 입력해 주세요.");
      return;
    }

    setAdminEmailUnsubscribeLoading(true);
    setAdminEmailUnsubscribeError("");
    setAdminEmailUnsubscribeInfo("");
    try {
      const res = await fetch(`/api/admin/email-unsubscribes?query=${encodeURIComponent(query)}`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        items?: AdminEmailUnsubscribeItem[];
      };
      if (!res.ok) {
        setAdminEmailUnsubscribeError(body.error ?? "수신거부 목록을 불러오지 못했습니다.");
        return;
      }
      const items = Array.isArray(body.items) ? body.items : [];
      setAdminEmailUnsubscribeItems(items);
      setAdminEmailUnsubscribeInfo(items.length > 0 ? `${items.length}건을 찾았습니다.` : "수신거부 기록이 없습니다.");
    } catch (e) {
      setAdminEmailUnsubscribeError(e instanceof Error ? e.message : "수신거부 목록을 불러오지 못했습니다.");
    } finally {
      setAdminEmailUnsubscribeLoading(false);
    }
  };

  const handleAdminDeleteEmailUnsubscribe = async (item: AdminEmailUnsubscribeItem) => {
    if (adminEmailUnsubscribeDeletingIds.includes(item.id)) return;
    const label = item.email || item.nickname || item.user_id.slice(0, 8);
    if (!confirm(`${label}님의 ${item.campaign_key} 수신거부를 해제할까요?`)) return;

    setAdminEmailUnsubscribeDeletingIds((prev) => [...prev, item.id]);
    setAdminEmailUnsubscribeError("");
    setAdminEmailUnsubscribeInfo("");
    try {
      const res = await fetch("/api/admin/email-unsubscribes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!res.ok || !body.ok) {
        setAdminEmailUnsubscribeError(body.error ?? "수신거부 해제에 실패했습니다.");
        return;
      }
      setAdminEmailUnsubscribeItems((prev) => prev.filter((row) => row.id !== item.id));
      setAdminEmailUnsubscribeInfo("수신거부를 해제했습니다.");
    } catch (e) {
      setAdminEmailUnsubscribeError(e instanceof Error ? e.message : "수신거부 해제에 실패했습니다.");
    } finally {
      setAdminEmailUnsubscribeDeletingIds((prev) => prev.filter((id) => id !== item.id));
    }
  };

  const applyToolsPatchNotePreset = (text: string) => {
    setToolsPatchNoteEnabled(true);
    setToolsPatchNoteText(text.slice(0, 100));
    setToolsPatchNoteError("");
    setToolsPatchNoteInfo("");
  };

  const prependTodayToToolsPatchNote = () => {
    const todayLabel = new Date()
      .toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" })
      .replace(/\.$/, "");
    const currentText = toolsPatchNoteText.trim();
    const nextText = `${todayLabel} 업데이트: ${currentText || "오늘의 개선 내용을 확인해보세요."}`;

    setToolsPatchNoteEnabled(true);
    setToolsPatchNoteText(nextText.slice(0, 100));
    setToolsPatchNoteError("");
    setToolsPatchNoteInfo("");
  };

  const handleAdminSaveAdInquiry = async () => {
    setAdInquirySaving(true);
    setAdInquiryError("");
    setAdInquiryInfo("");
    try {
      const res = await fetch("/api/admin/site/ad-inquiry", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: adInquiryEnabled,
          title: adInquiryTitle,
          description: adInquiryDescription,
          cta: adInquiryCta,
          linkUrl: adInquiryLinkUrl,
          badge: adInquiryBadge,
          theme: adInquiryTheme,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        setting?: AdInquirySettingsResponse;
      };
      if (!res.ok || !body.ok || !body.setting) {
        setAdInquiryError(body.error ?? "광고 문의 설정 저장에 실패했습니다.");
        return;
      }

      setAdInquiryEnabled(body.setting.enabled !== false);
      setAdInquiryTitle(body.setting.title ?? "(광고) 문의 주세요");
      setAdInquiryDescription(
        body.setting.description ?? "배너, 제휴, 스폰서 문의는 오픈카톡으로 편하게 남겨 주세요."
      );
      setAdInquiryCta(body.setting.cta ?? "오픈카톡 문의");
      setAdInquiryLinkUrl(body.setting.linkUrl ?? "");
      setAdInquiryBadge(body.setting.badge ?? "AD SLOT");
      setAdInquiryTheme(body.setting.theme ?? "emerald");
      setAdInquiryInfo("광고 문의 슬롯 설정을 저장했습니다.");
    } catch (e) {
      setAdInquiryError(e instanceof Error ? e.message : "광고 문의 설정 저장에 실패했습니다.");
    } finally {
      setAdInquirySaving(false);
    }
  };

  const handleReopenMyOpenCard = async (card: MyDatingCard) => {
    if (reopeningOpenCardIds.includes(card.id)) return;
    if (card.status === "public") {
      alert("이미 공개중인 오픈카드입니다.");
      return;
    }
    if (!confirm("오픈카드를 5,000원으로 대기 없이 다시 노출할까요?")) return;

    setReopeningOpenCardIds((prev) => [...prev, card.id]);
    try {
      const res = await fetch("/api/payments/toss/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productType: "paid_card",
          openCardId: card.id,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
        checkoutUrl?: string;
      };
      if (!res.ok || !body.ok) {
        alert(withPaymentCardNotice(body.message ?? body.error ?? "오픈카드 재노출 결제를 시작하지 못했습니다."));
        return;
      }
      if (!body.checkoutUrl) {
        alert(withPaymentCardNotice("결제창을 열지 못했습니다."));
        return;
      }
      window.location.href = body.checkoutUrl;
    } catch (e) {
      alert(e instanceof Error ? e.message : withPaymentCardNotice("오픈카드 재노출 결제를 시작하지 못했습니다."));
    } finally {
      setReopeningOpenCardIds((prev) => prev.filter((id) => id !== card.id));
    }
  };

  const handleReactivateMyOpenCard = async (card: MyDatingCard) => {
    if (reactivatingOpenCardIds.includes(card.id)) return;
    if (card.status !== "expired" && card.status !== "hidden") {
      alert("만료되었거나 내려간 오픈카드만 다시 대기 등록할 수 있습니다.");
      return;
    }
    if (hasActiveOpenCard) {
      alert("이미 대기중이거나 공개중인 오픈카드가 있습니다.");
      return;
    }
    if (!confirm("기존 오픈카드 내용을 그대로 다시 대기열에 등록할까요?")) return;

    setReactivatingOpenCardIds((prev) => [...prev, card.id]);
    try {
      const res = await fetch(`/api/dating/cards/my/${encodeURIComponent(card.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reactivate" }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        alert(body.error ?? "오픈카드를 다시 대기 등록하지 못했습니다.");
        return;
      }
      await Promise.all([
        reloadOpenAppliedApplications(),
        reloadOpenDatingConnections(),
        reloadSwipeStatus().catch(() => undefined),
      ]);
      alert(body.message ?? "기존 오픈카드를 다시 대기열에 등록했습니다.");
    } finally {
      setReactivatingOpenCardIds((prev) => prev.filter((id) => id !== card.id));
    }
  };

  const handleDeleteMyOpenCard = async (cardId: string) => {
    if (deletingOpenCardIds.includes(cardId)) return;
    if (!confirm("이 오픈카드를 삭제할까요? 지원 기록과 연결 정보도 함께 정리될 수 있습니다.")) return;

    setDeletingOpenCardIds((prev) => [...prev, cardId]);
    try {
      const res = await fetch(`/api/dating/cards/my/${encodeURIComponent(cardId)}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        alert(body.error ?? "오픈카드 삭제에 실패했습니다.");
        return;
      }
      setMyDatingCards((prev) => prev.filter((card) => card.id !== cardId));
      await Promise.all([
        reloadOpenAppliedApplications(),
        reloadOpenDatingConnections(),
        reloadSwipeStatus().catch(() => undefined),
      ]);
      alert(body.message ?? "오픈카드를 삭제했습니다.");
    } finally {
      setDeletingOpenCardIds((prev) => prev.filter((id) => id !== cardId));
    }
  };

  const handleToggleMyOpenCardPhotoVisibility = async (
    cardId: string,
    nextVisibility: "blur" | "public"
  ) => {
    if (savingOpenCardVisibilityIds.includes(cardId)) return;

    setSavingOpenCardVisibilityIds((prev) => [...prev, cardId]);
    try {
      const res = await fetch(`/api/dating/cards/my/${encodeURIComponent(cardId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_visibility: nextVisibility }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        photo_visibility?: "blur" | "public";
      };
      if (!res.ok || !body.photo_visibility) {
        alert(body.error ?? "사진 공개 설정 변경에 실패했습니다.");
        return;
      }
      setMyDatingCards((prev) =>
        prev.map((card) => (card.id === cardId ? { ...card, photo_visibility: body.photo_visibility } : card))
      );
      alert(body.message ?? "사진 공개 설정을 변경했습니다.");
    } finally {
      setSavingOpenCardVisibilityIds((prev) => prev.filter((id) => id !== cardId));
    }
  };

  const handleDeleteMyPaidCard = async (cardId: string) => {
    if (deletingPaidCardIds.includes(cardId)) return;
    if (!confirm("이 유료카드를 삭제할까요? 지원 기록과 연결 정보도 함께 정리될 수 있습니다.")) return;

    setDeletingPaidCardIds((prev) => [...prev, cardId]);
    try {
      const res = await fetch(`/api/dating/paid/my/${encodeURIComponent(cardId)}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        alert(body.error ?? "유료카드 삭제에 실패했습니다.");
        return;
      }

      setMyPaidCards((prev) => prev.filter((card) => card.id !== cardId));
      setReceivedPaidApplications((prev) => prev.filter((app) => app.card_id !== cardId));
      await Promise.all([reloadPaidAppliedApplications(), reloadOpenDatingConnections()]);
      alert(body.message ?? "유료카드를 삭제했습니다.");
    } finally {
      setDeletingPaidCardIds((prev) => prev.filter((id) => id !== cardId));
    }
  };

  const handleDeleteMyOneOnOneCard = async (cardId: string) => {
    if (deletingOneOnOneIds.includes(cardId)) return;
    if (!confirm("1:1 프로필을 내릴까요? 추천 노출은 종료되지만 기존 매칭과 번호교환 기록은 유지됩니다.")) return;

    setDeletingOneOnOneIds((prev) => [...prev, cardId]);
    try {
      const res = await fetch(`/api/dating/1on1/my?id=${encodeURIComponent(cardId)}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        alert(body.error ?? "1:1 소개팅 프로필 삭제에 실패했습니다.");
        return;
      }

      setMyOneOnOneCards((prev) =>
        prev.map((item) => (item.id === cardId ? { ...item, status: "rejected", archived: true } : item))
      );
      setMyOneOnOneAutoRecommendations((prev) => prev.filter((group) => group.source_card_id !== cardId));
      alert("1:1 프로필을 내렸습니다. 기존 매칭 기록은 그대로 유지됩니다.");
    } finally {
      setDeletingOneOnOneIds((prev) => prev.filter((id) => id !== cardId));
    }
  };

  const handleAdminApproveApplyCreditOrder = async (orderId: string) => {
    if (approvingOrderIds.includes(orderId)) return;
    setApprovingOrderIds((prev) => [...prev, orderId]);
    try {
      const res = await fetch("/api/admin/dating/apply-credits/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        alreadyApproved?: boolean;
      };
      if (!res.ok || !body.ok) {
        alert(body.message ?? "지원권 승인에 실패했습니다.");
        return;
      }

      if (body.alreadyApproved) {
        alert("이미 승인된 주문입니다.");
      }

      setAdminApplyCreditOrders((prev) => prev.filter((item) => item.id !== orderId));
    } finally {
      setApprovingOrderIds((prev) => prev.filter((id) => id !== orderId));
    }
  };

  const handleAdminGrantApplyCredits = async () => {
    const nickname = adminApplyCreditGrantNickname.trim();
    if (!nickname || adminApplyCreditGrantLoading) return;
    if (!confirm(`${nickname} 닉네임에게 지원권 5장을 바로 지급할까요?`)) return;

    setAdminApplyCreditGrantLoading(true);
    try {
      const res = await fetch("/api/admin/dating/apply-credits/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, credits: 5 }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        addedCredits?: number;
        creditsAfter?: number;
        orderId?: string;
      };

      if (!res.ok || !body.ok) {
        alert(body.message ?? "지원권 직접 지급에 실패했습니다.");
        return;
      }

      setAdminApplyCreditGrantNickname("");
      alert(
        `${nickname} 님에게 지원권 ${Number(body.addedCredits ?? 0)}장을 지급했습니다. 현재 잔여 ${Number(
          body.creditsAfter ?? 0
        )}장`
      );
    } finally {
      setAdminApplyCreditGrantLoading(false);
    }
  };

  const handleAdminProcessSwipeSubscription = async (
    requestId: string,
    status: "approved" | "rejected"
  ) => {
    if (processingSwipeSubscriptionIds.includes(requestId)) return;
    setProcessingSwipeSubscriptionIds((prev) => [...prev, requestId]);
    try {
      const res = await fetch(`/api/admin/dating/cards/swipe-subscriptions/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || body.ok === false) {
        alert(body.message ?? "빠른매칭 라이크 구매 신청 처리에 실패했습니다.");
        return;
      }
      setAdminSwipeSubscriptionRequests((prev) => prev.filter((item) => item.id !== requestId));
    } finally {
      setProcessingSwipeSubscriptionIds((prev) => prev.filter((id) => id !== requestId));
    }
  };

  const handleAdminSearchSwipeSubscriptionGrantCandidates = async () => {
    const query = adminSwipeSubscriptionGrantQuery.trim();
    setAdminSwipeSubscriptionGrantError("");
    setAdminSwipeSubscriptionGrantInfo("");

    if (query.length < 2) {
      setAdminSwipeSubscriptionGrantError("닉네임이나 이메일을 2글자 이상 입력해주세요.");
      setAdminSwipeSubscriptionGrantCandidates([]);
      return;
    }

    setAdminSwipeSubscriptionGrantLoading(true);
    try {
      const res = await fetch(`/api/admin/dating/cards/swipe-subscriptions/grant?query=${encodeURIComponent(query)}`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        items?: AdminSwipeSubscriptionGrantCandidate[];
      };

      if (!res.ok || !body.ok) {
        setAdminSwipeSubscriptionGrantError(body.message ?? "유저 검색에 실패했습니다.");
        setAdminSwipeSubscriptionGrantCandidates([]);
        return;
      }

      setAdminSwipeSubscriptionGrantCandidates(body.items ?? []);
      if ((body.items ?? []).length === 0) {
        setAdminSwipeSubscriptionGrantInfo("검색된 유저가 없습니다.");
      }
    } finally {
      setAdminSwipeSubscriptionGrantLoading(false);
    }
  };

  const handleAdminGrantSwipeSubscriptionToUser = async (userId: string) => {
    if (adminSwipeSubscriptionGrantingUserId) return;

    setAdminSwipeSubscriptionGrantError("");
    setAdminSwipeSubscriptionGrantInfo("");
    setAdminSwipeSubscriptionGrantingUserId(userId);
    try {
      const res = await fetch("/api/admin/dating/cards/swipe-subscriptions/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        item?: { expires_at?: string | null };
      };

      if (!res.ok || !body.ok) {
        setAdminSwipeSubscriptionGrantError(body.message ?? "빠른매칭 플러스 지급에 실패했습니다.");
        return;
      }

      const activeUntil = body.item?.expires_at ?? null;
      setAdminSwipeSubscriptionGrantInfo(body.message ?? "빠른매칭 플러스를 바로 적용했습니다.");
      setAdminSwipeSubscriptionGrantCandidates((prev) =>
        prev.map((item) =>
          item.userId !== userId
            ? item
            : {
                ...item,
                activeUntil,
                pending: false,
              }
        )
      );
      setAdminSwipeSubscriptionRequests((prev) => prev.filter((item) => item.user_id !== userId));
    } finally {
      setAdminSwipeSubscriptionGrantingUserId(null);
    }
  };

  const handleAdminProcessMoreViewRequest = async (
    requestId: string,
    status: "approved" | "rejected"
  ) => {
    if (processingMoreViewIds.includes(requestId)) return;
    setProcessingMoreViewIds((prev) => [...prev, requestId]);
    try {
      const res = await fetch(`/api/admin/dating/cards/more-view/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !body.ok) {
        alert(body.message ?? "이상형 더보기 신청 처리에 실패했습니다.");
        return;
      }
      setAdminMoreViewRequests((prev) => prev.filter((item) => item.id !== requestId));
    } finally {
      setProcessingMoreViewIds((prev) => prev.filter((id) => id !== requestId));
    }
  };

  const handleAdminSearchMoreViewGrantCandidates = async () => {
    const query = adminMoreViewGrantQuery.trim();
    setAdminMoreViewGrantError("");
    setAdminMoreViewGrantInfo("");

    if (query.length < 2) {
      setAdminMoreViewGrantError("닉네임이나 이메일을 2글자 이상 입력해주세요.");
      setAdminMoreViewGrantCandidates([]);
      return;
    }

    setAdminMoreViewGrantLoading(true);
    try {
      const res = await fetch(`/api/admin/dating/cards/more-view/grant?query=${encodeURIComponent(query)}`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        items?: AdminMoreViewGrantCandidate[];
      };

      if (!res.ok || !body.ok) {
        setAdminMoreViewGrantError(body.message ?? "유저 검색에 실패했습니다.");
        setAdminMoreViewGrantCandidates([]);
        return;
      }

      setAdminMoreViewGrantCandidates(body.items ?? []);
      if ((body.items ?? []).length === 0) {
        setAdminMoreViewGrantInfo("검색된 유저가 없습니다.");
      }
    } finally {
      setAdminMoreViewGrantLoading(false);
    }
  };

  const handleAdminGrantMoreViewToUser = async (userId: string) => {
    if (!adminMoreViewGrantSex || adminMoreViewGrantingUserId) return;

    setAdminMoreViewGrantError("");
    setAdminMoreViewGrantInfo("");
    setAdminMoreViewGrantingUserId(userId);
    try {
      const res = await fetch("/api/admin/dating/cards/more-view/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, sex: adminMoreViewGrantSex }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };

      if (!res.ok || !body.ok) {
        setAdminMoreViewGrantError(body.message ?? "이상형 더보기 권한 지급에 실패했습니다.");
        return;
      }

      setAdminMoreViewGrantInfo(body.message ?? "이상형 더보기를 바로 열어줬습니다.");
      setAdminMoreViewGrantCandidates((prev) =>
        prev.map((item) =>
          item.userId !== userId
            ? item
            : {
                ...item,
                activeSexes: item.activeSexes.includes(adminMoreViewGrantSex)
                  ? item.activeSexes
                  : [...item.activeSexes, adminMoreViewGrantSex].sort(),
              }
        )
      );
    } finally {
      setAdminMoreViewGrantingUserId(null);
    }
  };

  const handleAdminProcessCityViewRequest = async (
    requestId: string,
    status: "approved" | "rejected"
  ) => {
    if (processingCityViewIds.includes(requestId)) return;
    setProcessingCityViewIds((prev) => [...prev, requestId]);
    try {
      const res = await fetch(`/api/admin/dating/cards/city-view/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !body.ok) {
        alert(body.message ?? "도시 더보기 신청 처리에 실패했습니다.");
        return;
      }
      setAdminCityViewRequests((prev) => prev.filter((item) => item.id !== requestId));
    } finally {
      setProcessingCityViewIds((prev) => prev.filter((id) => id !== requestId));
    }
  };

  const handleAdminProcessOneOnOneContactExchange = async (
    matchId: string,
    action: "approve" | "reset"
  ) => {
    if (processingOneOnOneContactExchangeIds.includes(matchId)) return;
    setProcessingOneOnOneContactExchangeIds((prev) => [...prev, matchId]);
    try {
      const res = await fetch(`/api/admin/dating/1on1/matches/${matchId}/contact-exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        alert(body.error ?? "1:1 번호 공개 처리에 실패했습니다.");
        return;
      }

      setAdminOneOnOneContactRequests((prev) => prev.filter((item) => item.id !== matchId));
    } finally {
      setProcessingOneOnOneContactExchangeIds((prev) => prev.filter((id) => id !== matchId));
    }
  };

  const handleAdminRepairCityViewPending = async (requestId: string) => {
    if (processingCityViewIds.includes(requestId)) return;
    if (!confirm("이 유저의 해당 지역 승인대기 요청을 강제로 정리할까요? 다시 신청할 수 있게 pending을 풀어줍니다.")) {
      return;
    }

    setProcessingCityViewIds((prev) => [...prev, requestId]);
    try {
      const res = await fetch(`/api/admin/dating/cards/city-view/requests/${requestId}/repair`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !body.ok) {
        alert(body.message ?? "승인대기 정리에 실패했습니다.");
        return;
      }

      const reloadRes = await fetch("/api/admin/dating/cards/city-view/requests?status=pending", { cache: "no-store" });
      const reloadBody = (await reloadRes.json().catch(() => ({}))) as { items?: AdminCityViewRequest[] };
      if (reloadRes.ok) {
        setAdminCityViewRequests(reloadBody.items ?? []);
      }
      alert(body.message ?? "승인대기 요청을 정리했습니다.");
    } finally {
      setProcessingCityViewIds((prev) => prev.filter((id) => id !== requestId));
    }
  };

  const handleAdminUnblockAllCityViewPending = async () => {
    const identifier = adminCityViewUnblockIdentifier.trim();
    setAdminCityViewUnblockError("");
    setAdminCityViewUnblockInfo("");

    if (!identifier) {
      setAdminCityViewUnblockError("닉네임 또는 사용자 ID를 입력해주세요.");
      return;
    }

    if (!confirm("이 사용자의 가까운 이상형 승인대기를 전체 해제할까요? 현재 pending만 정리되고, 이미 승인된 접근권은 유지됩니다.")) {
      return;
    }

    setAdminCityViewUnblockLoading(true);
    try {
      const res = await fetch("/api/admin/dating/cards/city-view/unblock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };

      if (!res.ok || !body.ok) {
        setAdminCityViewUnblockError(body.message ?? "전체 막힘 해제에 실패했습니다.");
        return;
      }

      const reloadRes = await fetch("/api/admin/dating/cards/city-view/requests?status=pending", { cache: "no-store" });
      const reloadBody = (await reloadRes.json().catch(() => ({}))) as { items?: AdminCityViewRequest[] };
      if (reloadRes.ok) {
        setAdminCityViewRequests(reloadBody.items ?? []);
      }
      setAdminCityViewUnblockInfo(body.message ?? "전체 막힘을 해제했습니다.");
      setAdminCityViewUnblockIdentifier("");
    } finally {
      setAdminCityViewUnblockLoading(false);
    }
  };

  const handleAdminSearchCityViewGrantCandidates = async () => {
    const query = adminCityViewGrantQuery.trim();
    setAdminCityViewGrantError("");
    setAdminCityViewGrantInfo("");

    if (query.length < 2) {
      setAdminCityViewGrantError("닉네임이나 이메일을 2글자 이상 입력해주세요.");
      setAdminCityViewGrantCandidates([]);
      return;
    }

    setAdminCityViewGrantLoading(true);
    try {
      const res = await fetch(`/api/admin/dating/cards/city-view/grant?query=${encodeURIComponent(query)}`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        items?: AdminCityViewGrantCandidate[];
      };

      if (!res.ok || !body.ok) {
        setAdminCityViewGrantError(body.message ?? "유저 검색에 실패했습니다.");
        setAdminCityViewGrantCandidates([]);
        return;
      }

      setAdminCityViewGrantCandidates(body.items ?? []);
      if ((body.items ?? []).length === 0) {
        setAdminCityViewGrantInfo("검색된 유저가 없습니다.");
      }
    } finally {
      setAdminCityViewGrantLoading(false);
    }
  };

  const handleAdminGrantCityViewToUser = async (userId: string) => {
    if (!adminCityViewGrantProvince || adminCityViewGrantingUserId) return;

    setAdminCityViewGrantError("");
    setAdminCityViewGrantInfo("");
    setAdminCityViewGrantingUserId(userId);
    try {
      const res = await fetch("/api/admin/dating/cards/city-view/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, province: adminCityViewGrantProvince }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };

      if (!res.ok || !body.ok) {
        setAdminCityViewGrantError(body.message ?? "가까운 이상형 권한 지급에 실패했습니다.");
        return;
      }

      setAdminCityViewGrantInfo(body.message ?? "가까운 이상형을 바로 열어줬습니다.");
      setAdminCityViewGrantCandidates((prev) =>
        prev.map((item) =>
          item.userId !== userId
            ? item
            : {
                ...item,
                activeCities: item.activeCities.includes(adminCityViewGrantProvince)
                  ? item.activeCities
                  : [...item.activeCities, adminCityViewGrantProvince].sort((a, b) => a.localeCompare(b, "ko")),
              }
        )
      );
    } finally {
      setAdminCityViewGrantingUserId(null);
    }
  };

  const handleAdminManualPhoneVerify = async () => {
    const trimmedIdentifier = adminPhoneIdentifier.trim();
    const trimmedPhone = adminPhoneNumber.trim();

    setAdminPhoneVerifyError("");
    setAdminPhoneVerifyInfo("");

    if (!trimmedIdentifier) {
      setAdminPhoneVerifyError("닉네임 또는 사용자 ID를 입력해주세요.");
      return;
    }

    if (!trimmedPhone) {
      setAdminPhoneVerifyError("휴대폰 번호를 입력해주세요.");
      return;
    }

    setAdminPhoneVerifyLoading(true);
    try {
      const res = await fetch("/api/admin/phone-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: trimmedIdentifier,
          phone: trimmedPhone,
        }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        nickname?: string | null;
        phone_e164?: string;
      };

      if (!res.ok) {
        throw new Error(body.error || "수동 휴대폰 인증 처리에 실패했습니다.");
      }

      setAdminPhoneVerifyInfo(
        `${body.nickname?.trim() || trimmedIdentifier} 계정을 ${body.phone_e164 ?? trimmedPhone} 번호로 인증 처리했습니다.`
      );
    } catch (err) {
      setAdminPhoneVerifyError(err instanceof Error ? err.message : "수동 휴대폰 인증 처리에 실패했습니다.");
    } finally {
      setAdminPhoneVerifyLoading(false);
    }
  };

  const handleAdminLoadUserActivity = async () => {
    const query = adminUserActivityQuery.trim();
    setAdminUserActivityError("");

    if (query.length < 2) {
      setAdminUserActivityError("닉네임, 이메일 또는 사용자 ID를 2글자 이상 입력해주세요.");
      return;
    }

    setAdminUserActivityLoading(true);
    try {
      const res = await fetch(`/api/admin/users/activity?query=${encodeURIComponent(query)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      } & AdminUserActivityResult;

      if (!res.ok || !body.ok) {
        throw new Error(body.message || "회원 기록을 불러오지 못했습니다.");
      }

      setAdminUserActivityResult(body);
      setAdminNicknameDraft(body.user?.profile?.nickname ?? "");
      setAdminNicknameError("");
      setAdminNicknameInfo("");
      setAdminBanReason(body.user?.profile?.banned_reason?.trim() || "운영정책 위반");
      setAdminBanError("");
      setAdminBanInfo("");
      setAdminOneOnOneBlockQuery("");
      setAdminOneOnOneBlockError("");
      setAdminOneOnOneBlockInfo("");
      setAdminOneOnOnePriorityGrantError("");
      setAdminOneOnOnePriorityGrantInfo("");
      const pendingOpenCard = body.details?.open_cards?.find((item) => item.status === "pending");
      if (pendingOpenCard?.id) {
        setAdminQueueMoveCardId(String(pendingOpenCard.id));
        setAdminQueueMovePosition(String(Number(pendingOpenCard.queue_position ?? 1) || 1));
      }
      const latestPaidOrder = body.details?.payments?.find((item) => item.status === "paid" && item.payment_key);
      setAdminRefundOrderId(latestPaidOrder?.id ? String(latestPaidOrder.id) : "");
      setAdminRefundError("");
      setAdminRefundInfo("");
    } catch (err) {
      setAdminUserActivityError(err instanceof Error ? err.message : "회원 기록을 불러오지 못했습니다.");
    } finally {
      setAdminUserActivityLoading(false);
    }
  };

  const handleAdminSaveUserNickname = async () => {
    const userId = adminUserActivityResult?.user?.id ?? "";
    const previousNickname = adminUserActivityResult?.user?.profile?.nickname ?? "";
    const normalized = normalizeNickname(adminNicknameDraft);
    const validationMessage = validateNickname(normalized);

    setAdminNicknameError("");
    setAdminNicknameInfo("");

    if (!userId) {
      setAdminNicknameError("먼저 회원을 조회해주세요.");
      return;
    }
    if (validationMessage) {
      setAdminNicknameError(validationMessage);
      return;
    }
    if (previousNickname.trim().toLowerCase() === normalized.toLowerCase()) {
      setAdminNicknameInfo("현재 닉네임과 같습니다.");
      return;
    }
    if (!confirm(`${previousNickname || userId.slice(0, 8)} 님의 닉네임을 ${normalized}(으)로 변경할까요?`)) {
      return;
    }

    setAdminNicknameSaving(true);
    try {
      const res = await fetch("/api/admin/users/nickname", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: userId,
          nickname: normalized,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        nickname?: string;
        previous_nickname?: string | null;
      };

      if (!res.ok || body.ok === false) {
        throw new Error(body.error ?? "닉네임 변경에 실패했습니다.");
      }

      const nextNickname = body.nickname ?? normalized;
      setAdminNicknameDraft(nextNickname);
      setAdminUserActivityResult((prev) =>
        prev?.user
          ? {
              ...prev,
              user: {
                ...prev.user,
                profile: {
                  ...(prev.user.profile ?? {}),
                  nickname: nextNickname,
                },
              },
            }
          : prev
      );
      setAdminNicknameInfo(`${body.previous_nickname ?? (previousNickname || "기존 닉네임")} -> ${nextNickname} 변경 완료`);
    } catch (err) {
      setAdminNicknameError(err instanceof Error ? err.message : "닉네임 변경에 실패했습니다.");
    } finally {
      setAdminNicknameSaving(false);
    }
  };

  const handleAdminSetUserBan = async (banned: boolean) => {
    const userId = adminUserActivityResult?.user?.id ?? "";
    const nickname = adminUserActivityResult?.user?.profile?.nickname?.trim() || userId.slice(0, 8);
    const reason = adminBanReason.trim().replace(/\s{2,}/g, " ");

    setAdminBanError("");
    setAdminBanInfo("");

    if (!userId) {
      setAdminBanError("먼저 회원을 조회해주세요.");
      return;
    }
    if (banned && !reason) {
      setAdminBanError("벤 사유를 입력해주세요.");
      return;
    }

    const confirmMessage = banned
      ? `${nickname} 계정을 벤 처리할까요? 공개/대기 중인 오픈카드와 유료카드는 비노출 처리됩니다.`
      : `${nickname} 계정의 벤을 해제할까요? 비노출 처리된 카드는 자동 복구되지 않습니다.`;
    if (!confirm(confirmMessage)) return;

    setAdminBanSaving(true);
    try {
      const res = await fetch("/api/admin/users/ban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, banned, reason }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        profile?: {
          is_banned?: boolean | null;
          banned_reason?: string | null;
          banned_at?: string | null;
        };
        hiddenOpenCards?: number;
        hiddenPaidCards?: number;
      };

      if (!res.ok || body.ok === false || !body.profile) {
        throw new Error(body.error ?? "벤 상태 저장에 실패했습니다.");
      }

      setAdminUserActivityResult((prev) =>
        prev?.user
          ? {
              ...prev,
              user: {
                ...prev.user,
                profile: {
                  ...(prev.user.profile ?? {}),
                  is_banned: body.profile?.is_banned === true,
                  banned_reason: body.profile?.banned_reason ?? null,
                  banned_at: body.profile?.banned_at ?? null,
                },
              },
            }
          : prev
      );
      setAdminBanReason(body.profile.banned_reason?.trim() || "운영정책 위반");
      setAdminBanInfo(
        banned
          ? `벤 처리 완료 · 오픈카드 ${Number(body.hiddenOpenCards ?? 0)}건, 유료카드 ${Number(body.hiddenPaidCards ?? 0)}건 비노출`
          : "벤 해제 완료"
      );
    } catch (err) {
      setAdminBanError(err instanceof Error ? err.message : "벤 상태 저장에 실패했습니다.");
    } finally {
      setAdminBanSaving(false);
    }
  };

  const handleAdminSaveOneOnOneUserBlock = async () => {
    const userId = adminUserActivityResult?.user?.id ?? "";
    const nickname = adminUserActivityResult?.user?.profile?.nickname?.trim() || userId.slice(0, 8);
    const targetQuery = adminOneOnOneBlockQuery.trim();

    setAdminOneOnOneBlockError("");
    setAdminOneOnOneBlockInfo("");

    if (!userId) {
      setAdminOneOnOneBlockError("먼저 회원을 조회해주세요.");
      return;
    }
    if (targetQuery.length < 2) {
      setAdminOneOnOneBlockError("상대 이름 또는 닉네임을 2글자 이상 입력해주세요.");
      return;
    }
    if (!confirm(`${nickname} 님과 ${targetQuery} 님을 1:1 후보에서 서로 안 보이게 할까요?`)) return;

    setAdminOneOnOneBlockSaving(true);
    try {
      const res = await fetch("/api/admin/dating/1on1/user-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_a_id: userId,
          user_b_query: targetQuery,
          note: `회원관리에서 ${nickname} 기준으로 등록`,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        candidates?: Array<{ user_id: string; profile?: { nickname?: string | null } | null; latest_card?: { name?: string | null; age?: number | null; region?: string | null } | null }>;
      };
      if (!res.ok || !body.ok) {
        const candidateHint = Array.isArray(body.candidates) && body.candidates.length > 0
          ? ` 후보: ${body.candidates
              .slice(0, 5)
              .map((item) => item.latest_card?.name || item.profile?.nickname || item.user_id.slice(0, 8))
              .join(", ")}`
          : "";
        throw new Error(`${body.error ?? "1:1 지인 차단 저장에 실패했습니다."}${candidateHint}`);
      }
      setAdminOneOnOneBlockQuery("");
      setAdminOneOnOneBlockInfo(`${nickname} 님과 ${targetQuery} 님이 1:1 후보에서 서로 안 보이게 저장됐습니다.`);
    } catch (err) {
      setAdminOneOnOneBlockError(err instanceof Error ? err.message : "1:1 지인 차단 저장에 실패했습니다.");
    } finally {
      setAdminOneOnOneBlockSaving(false);
    }
  };

  const handleAdminGrantOneOnOnePriorityBoost = async (card: Record<string, unknown>) => {
    const userId = adminUserActivityResult?.user?.id ?? "";
    const cardId = String(card.id ?? "").trim();
    const cardName = String(card.name ?? "1:1 신청").trim() || "1:1 신청";
    if (!userId || !cardId) {
      setAdminOneOnOnePriorityGrantError("회원 또는 1:1 신청 정보를 찾지 못했습니다.");
      return;
    }
    if (adminOneOnOnePriorityGrantingIds.includes(cardId)) return;
    if (!confirm(`${cardName} 회원에게 1:1 매칭 플러스 30일을 지급할까요? 이용 중이면 30일 연장됩니다.`)) return;

    setAdminOneOnOnePriorityGrantingIds((prev) => [...prev, cardId]);
    setAdminOneOnOnePriorityGrantError("");
    setAdminOneOnOnePriorityGrantInfo("");
    try {
      const res = await fetch("/api/admin/dating/1on1/priority-boost/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, cardId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        card?: {
          id?: string;
          plus_expires_at?: string | null;
        };
        expiresAt?: string | null;
      };
      if (!res.ok || !body.ok || !body.card?.id) {
        throw new Error(body.error ?? "1:1 매칭 플러스 지급에 실패했습니다.");
      }

      const expiresAt = body.card.plus_expires_at ?? body.expiresAt ?? null;
      setAdminUserActivityResult((prev) =>
        prev
          ? {
              ...prev,
              details: {
                ...(prev.details ?? {}),
                one_on_one_cards: (prev.details?.one_on_one_cards ?? []).map((item) =>
                  String(item.id ?? "") === body.card?.id ? { ...item, plus_expires_at: expiresAt } : item
                ),
              },
            }
          : prev
      );
      setAdminOneOnOnePriorityGrantInfo(
        expiresAt ? `1:1 매칭 플러스 지급 완료 · ${new Date(expiresAt).toLocaleString("ko-KR")}까지` : "1:1 매칭 플러스를 지급했습니다."
      );
    } catch (err) {
      setAdminOneOnOnePriorityGrantError(err instanceof Error ? err.message : "1:1 매칭 플러스 지급에 실패했습니다.");
    } finally {
      setAdminOneOnOnePriorityGrantingIds((prev) => prev.filter((id) => id !== cardId));
    }
  };

  const handleAdminRefundTossOrder = async (order?: Record<string, unknown>) => {
    const orderId = String(order?.id ?? adminRefundOrderId).trim();
    if (!orderId) {
      setAdminRefundError("환불할 결제 주문을 선택해주세요.");
      return;
    }

    const amountRaw = (adminRefundAmountByOrderId[orderId] ?? "").trim();
    const reason = (adminRefundReasonByOrderId[orderId] ?? "관리자 환불 처리").trim() || "관리자 환불 처리";
    const amount = amountRaw ? Number(amountRaw.replace(/[^\d]/g, "")) : null;
    if (amountRaw && (!Number.isFinite(amount) || Number(amount) <= 0)) {
      setAdminRefundError("부분 환불액은 숫자로 입력해주세요.");
      return;
    }

    const orderName = String(order?.order_name ?? order?.toss_order_id ?? orderId);
    const fullOrPartial = amount && Number(order?.amount ?? 0) > amount ? `${amount.toLocaleString("ko-KR")}원 부분 환불` : "전체 환불";
    if (!confirm(`${orderName} 결제를 ${fullOrPartial} 처리할까요? 토스 결제 취소가 바로 요청됩니다.`)) {
      return;
    }

    setAdminRefundingOrderId(orderId);
    setAdminRefundError("");
    setAdminRefundInfo("");
    try {
      const res = await fetch("/api/admin/payments/toss-refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          cancelReason: reason,
          ...(amount ? { cancelAmount: amount } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !body.ok) {
        throw new Error(body.message || "토스 환불 처리에 실패했습니다.");
      }
      setAdminRefundInfo(body.message || "환불이 완료되었습니다.");
      await handleAdminLoadUserActivity();
    } catch (err) {
      setAdminRefundError(err instanceof Error ? err.message : "토스 환불 처리에 실패했습니다.");
    } finally {
      setAdminRefundingOrderId(null);
    }
  };

  const handleAdminMoveOpenCardQueuePosition = async (cardId?: string, targetPosition?: string) => {
    const selectedCardId = (cardId ?? adminQueueMoveCardId).trim();
    const selectedPosition = (targetPosition ?? adminQueueMovePosition).trim();
    const position = Number(selectedPosition);

    setAdminQueueMoveError("");
    setAdminQueueMoveInfo("");

    if (!selectedCardId || !Number.isFinite(position) || position < 1) {
      setAdminQueueMoveError("대기중 카드 ID와 이동할 순번을 입력해주세요.");
      return;
    }

    setAdminQueueMoveLoading(true);
    try {
      const res = await fetch("/api/admin/dating/cards/queue-position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: selectedCardId, targetPosition: Math.floor(position) }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !body.ok) {
        throw new Error(body.message || "대기 순번 이동에 실패했습니다.");
      }
      setAdminQueueMoveInfo(body.message || "대기 순번을 이동했습니다.");
      await handleAdminLoadUserActivity();
    } catch (err) {
      setAdminQueueMoveError(err instanceof Error ? err.message : "대기 순번 이동에 실패했습니다.");
    } finally {
      setAdminQueueMoveLoading(false);
    }
  };

  const handleAdminDeleteAccount = async () => {
    const trimmedIdentifier = adminDeleteIdentifier.trim();

    setAdminDeleteError("");
    setAdminDeleteInfo("");

    if (!trimmedIdentifier) {
      setAdminDeleteError("이메일, 닉네임 또는 사용자 ID를 입력해주세요.");
      return;
    }

    if (!confirm(`${trimmedIdentifier} 계정을 관리자 권한으로 탈퇴 처리할까요?`)) {
      return;
    }

    if (!confirm("마지막 확인: 관리자 탈퇴 처리는 복구가 어렵습니다.")) {
      return;
    }

    setAdminDeleteLoading(true);
    try {
      const res = await fetch("/api/admin/account-deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: trimmedIdentifier }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        user_id?: string;
        nickname?: string | null;
        email?: string | null;
      };

      if (!res.ok || !body.ok) {
        throw new Error(body.error || "관리자 탈퇴 처리에 실패했습니다.");
      }

      setAdminDeleteInfo(
        `${body.nickname?.trim() || body.email?.trim() || trimmedIdentifier} 계정을 탈퇴 처리했습니다.`
      );
      setAdminDeleteIdentifier("");

      const auditsRes = await fetch("/api/admin/account-deletion-audits", { cache: "no-store" });
      const auditsBody = (await auditsRes.json().catch(() => ({}))) as AdminAccountDeletionAuditsResponse;
      if (auditsRes.ok) {
        setAdminAccountDeletionAudits(auditsBody.items ?? []);
        setAdminAccountDeletionAuditError("");
      } else {
        setAdminAccountDeletionAuditError(auditsBody.error ?? "탈퇴 기록을 다시 불러오지 못했습니다.");
      }
    } catch (err) {
      setAdminDeleteError(err instanceof Error ? err.message : "관리자 탈퇴 처리에 실패했습니다.");
    } finally {
      setAdminDeleteLoading(false);
    }
  };

  const handleChangeNickname = async () => {
    const normalized = normalizeNickname(newNickname);
    const invalid = validateNickname(normalized);
    if (invalid) {
      setNicknameError(invalid);
      return;
    }

    setSavingNickname(true);
    setNicknameError("");
    setNicknameInfo("");

    try {
      const { data, error: rpcError } = await supabase.rpc("change_nickname", {
        new_nickname: normalized,
      });

      if (rpcError) {
        setNicknameError(rpcError.message);
        return;
      }

      const result = data as ChangeNicknameResult | null;
      if (!result?.success) {
        const message = result?.message ?? "닉네임 변경에 실패했습니다.";
        setNicknameError(message);
        return;
      }

      setNicknameInfo("닉네임이 변경되었습니다.");
      setNicknameOpen(false);
      setNewNickname("");

      setSummary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          profile: {
            ...prev.profile,
            nickname: result.nickname ?? prev.profile.nickname,
            nickname_changed_count:
              typeof result.nickname_changed_count === "number"
                ? result.nickname_changed_count
                : prev.profile.nickname_changed_count,
            nickname_change_credits:
              typeof result.nickname_change_credits === "number"
                ? result.nickname_change_credits
                : prev.profile.nickname_change_credits,
          },
        };
      });
    } catch (e) {
      setNicknameError(e instanceof Error ? e.message : "닉네임 변경에 실패했습니다.");
    } finally {
      setSavingNickname(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-center text-neutral-400">불러오는 중...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-center text-red-600">{error}</p>
      </main>
    );
  }

  const nickname = summary?.profile.nickname ?? "닉네임 없음";
  const changedCount = summary?.profile.nickname_changed_count ?? 0;
  const credits = summary?.profile.nickname_change_credits ?? 0;
  const phoneVerified = summary?.profile.phone_verified === true;
  const swipeProfileVisible = summary?.profile.swipe_profile_visible !== false;
  const canChangeNickname = changedCount < 1 || credits > 0;
  const remainingFree = Math.max(0, 1 - changedCount);

  const approvedRequests = certRequests.filter(
    (item) => item.status === "approved" && (item.certificates?.length ?? 0) > 0
  );
  const datingStatusText: Record<string, string> = {
    submitted: "접수",
    reviewing: "검토중",
    interview: "인터뷰",
    matched: "매칭 완료",
    rejected: "보류/거절",
  };
  const datingStatusColor: Record<string, string> = {
    submitted: "bg-neutral-100 text-neutral-700",
    reviewing: "bg-blue-100 text-blue-700",
    interview: "bg-purple-100 text-purple-700",
    matched: "bg-emerald-100 text-emerald-700",
    rejected: "bg-red-100 text-red-700",
  };
  const oneOnOneMatchStateText: Record<MyOneOnOneMatch["state"], string> = {
    proposed: "후보 도착",
    source_selected: "상대 응답 대기",
    source_skipped: "다른 후보 선택",
    candidate_accepted: "쌍방 수락 완료",
    candidate_rejected: "상대 거절",
    source_declined: "최종 거절",
    admin_canceled: "매칭 취소",
    mutual_accepted: "쌍방 수락 완료",
  };
  const oneOnOneMatchStateColor: Record<MyOneOnOneMatch["state"], string> = {
    proposed: "bg-sky-100 text-sky-700",
    source_selected: "bg-amber-100 text-amber-700",
    source_skipped: "bg-neutral-100 text-neutral-600",
    candidate_accepted: "bg-violet-100 text-violet-700",
    candidate_rejected: "bg-red-100 text-red-700",
    source_declined: "bg-red-100 text-red-700",
    admin_canceled: "bg-neutral-200 text-neutral-700",
    mutual_accepted: "bg-emerald-100 text-emerald-700",
  };
  const oneOnOneContactExchangeText: Record<MyOneOnOneMatch["contact_exchange_status"], string> = {
    none: "번호 공개 전",
    awaiting_applicant_payment: "즉시 교환 가능",
    payment_pending_admin: "번호 교환 확인 중",
    approved: "번호 교환 완료",
    canceled: "번호 교환 종료",
  };
  const oneOnOneContactExchangeColor: Record<MyOneOnOneMatch["contact_exchange_status"], string> = {
    none: "bg-neutral-100 text-neutral-600",
    awaiting_applicant_payment: "bg-amber-100 text-amber-700",
    payment_pending_admin: "bg-violet-100 text-violet-700",
    approved: "bg-emerald-100 text-emerald-700",
    canceled: "bg-neutral-200 text-neutral-700",
  };
  const getOneOnOneContactExchangeBadgeText = (match: MyOneOnOneMatch) => {
    if (
      match.state === "mutual_accepted" &&
      (
        match.contact_exchange_status === "none" ||
        match.contact_exchange_status === "awaiting_applicant_payment" ||
        match.contact_exchange_status === "payment_pending_admin"
      )
    ) {
      return "카카오페이 가능";
    }
    return oneOnOneContactExchangeText[match.contact_exchange_status];
  };
  const cardAppStatusText: Record<string, string> = {
    submitted: "대기",
    accepted: "수락",
    rejected: "거절",
    canceled: "취소",
  };
  const cardAppStatusColor: Record<string, string> = {
    submitted: "bg-neutral-100 text-neutral-700",
    accepted: "bg-emerald-100 text-emerald-700",
    rejected: "bg-red-100 text-red-700",
    canceled: "bg-neutral-200 text-neutral-600",
  };
  const myCardsById = new Map(myDatingCards.map((card) => [card.id, card]));
  const myOneOnOneMatchesByCardId = new Map<string, MyOneOnOneMatch[]>();
  for (const match of myOneOnOneMatches) {
    const keys = new Set([match.source_card_id, match.candidate_card_id]);
    for (const key of keys) {
      const bucket = myOneOnOneMatchesByCardId.get(key) ?? [];
      bucket.push(match);
      myOneOnOneMatchesByCardId.set(key, bucket);
    }
  }
  const myOneOnOneAutoRecommendationsByCardId = new Map<string, MyOneOnOneAutoRecommendationGroup>();
  for (const group of myOneOnOneAutoRecommendations) {
    myOneOnOneAutoRecommendationsByCardId.set(group.source_card_id, group);
  }
  const normalizedAdminApplyCreditSearch = adminApplyCreditSearch.trim().toLowerCase();
  const filteredAdminApplyCreditOrders =
    normalizedAdminApplyCreditSearch.length === 0
      ? adminApplyCreditOrders
      : adminApplyCreditOrders.filter((item) => {
          const nickname = (item.nickname ?? "").trim().toLowerCase();
          const userId = item.user_id.trim().toLowerCase();
          const orderId = item.id.trim().toLowerCase();
          return (
            nickname.includes(normalizedAdminApplyCreditSearch) ||
            userId.includes(normalizedAdminApplyCreditSearch) ||
            orderId.includes(normalizedAdminApplyCreditSearch)
          );
        });
  const normalizedAdminSwipeSubscriptionSearch = adminSwipeSubscriptionSearch.trim().toLowerCase();
  const filteredAdminSwipeSubscriptionRequests =
    normalizedAdminSwipeSubscriptionSearch.length === 0
      ? adminSwipeSubscriptionRequests
      : adminSwipeSubscriptionRequests.filter((item) => {
          const nickname = (item.nickname ?? "").trim().toLowerCase();
          const userId = item.user_id.trim().toLowerCase();
          const requestId = item.id.trim().toLowerCase();
          return (
            nickname.includes(normalizedAdminSwipeSubscriptionSearch) ||
            userId.includes(normalizedAdminSwipeSubscriptionSearch) ||
            requestId.includes(normalizedAdminSwipeSubscriptionSearch)
          );
        });
  const normalizedAdminMoreViewSearch = adminMoreViewSearch.trim().toLowerCase();
  const filteredAdminMoreViewRequests =
    normalizedAdminMoreViewSearch.length === 0
      ? adminMoreViewRequests
      : adminMoreViewRequests.filter((item) => {
          const nickname = (item.nickname ?? "").trim().toLowerCase();
          const userId = item.user_id.trim().toLowerCase();
          const requestId = item.id.trim().toLowerCase();
          const sexLabel = item.sex === "male" ? "남자 더보기" : "여자 더보기";
          return (
            nickname.includes(normalizedAdminMoreViewSearch) ||
            userId.includes(normalizedAdminMoreViewSearch) ||
            requestId.includes(normalizedAdminMoreViewSearch) ||
            sexLabel.includes(normalizedAdminMoreViewSearch)
          );
        });
  const normalizedAdminCityViewSearch = adminCityViewSearch.trim().toLowerCase();
  const filteredAdminCityViewRequests =
    normalizedAdminCityViewSearch.length === 0
      ? adminCityViewRequests
      : adminCityViewRequests.filter((item) => {
          const nickname = (item.nickname ?? "").trim().toLowerCase();
          const city = (item.city ?? "").trim().toLowerCase();
          const userId = item.user_id.trim().toLowerCase();
          return (
            nickname.includes(normalizedAdminCityViewSearch) ||
            city.includes(normalizedAdminCityViewSearch) ||
            userId.includes(normalizedAdminCityViewSearch)
          );
        });
  const normalizedAdminOneOnOneContactSearch = adminOneOnOneContactSearch.trim().toLowerCase();
  const filteredAdminOneOnOneContactRequests =
    normalizedAdminOneOnOneContactSearch.length === 0
      ? adminOneOnOneContactRequests
      : adminOneOnOneContactRequests.filter((item) => {
          const sourceName = oneOnOneContactDisplayName(item.source_card, item.source_profile, item.source_user_id).toLowerCase();
          const candidateName = oneOnOneContactDisplayName(item.candidate_card, item.candidate_profile, item.candidate_user_id).toLowerCase();
          const sourceRegion = (item.source_card?.region ?? "").trim().toLowerCase();
          const candidateRegion = (item.candidate_card?.region ?? "").trim().toLowerCase();
          const sourcePhone = (item.source_card?.phone ?? "").trim().toLowerCase();
          const candidatePhone = (item.candidate_card?.phone ?? "").trim().toLowerCase();
          const sourceUserId = item.source_user_id.trim().toLowerCase();
          const candidateUserId = item.candidate_user_id.trim().toLowerCase();
          const matchId = item.id.trim().toLowerCase();
          return (
            sourceName.includes(normalizedAdminOneOnOneContactSearch) ||
            candidateName.includes(normalizedAdminOneOnOneContactSearch) ||
            sourceRegion.includes(normalizedAdminOneOnOneContactSearch) ||
            candidateRegion.includes(normalizedAdminOneOnOneContactSearch) ||
            sourcePhone.includes(normalizedAdminOneOnOneContactSearch) ||
            candidatePhone.includes(normalizedAdminOneOnOneContactSearch) ||
            sourceUserId.includes(normalizedAdminOneOnOneContactSearch) ||
            candidateUserId.includes(normalizedAdminOneOnOneContactSearch) ||
            matchId.includes(normalizedAdminOneOnOneContactSearch)
          );
        });
  const hasActiveOpenCard = myDatingCards.some((card) => card.status === "pending" || card.status === "public");
  const swipeMatchConnections = datingConnections.filter((item) => item.role === "swipe_match");
  const visibleSwipeMatchCount = swipeMatchConnections.length;
  const receivedOpenPendingCount = receivedApplications.filter((item) => item.status === "submitted").length;
  const receivedPaidPendingCount = receivedPaidApplications.filter((item) => item.status === "submitted").length;
  const appliedOpenActiveCount = myAppliedCardApplications.filter((item) => item.status === "submitted" || item.status === "accepted").length;
  const appliedPaidActiveCount = myAppliedPaidApplications.filter((item) => item.status === "submitted" || item.status === "accepted").length;
  const oneOnOneActionCount = myOneOnOneMatches.filter((item) => item.action_required).length;
  const oneOnOneActiveCount = myOneOnOneMatches.filter(
    (item) => item.state !== "admin_canceled" && item.state !== "source_declined" && item.state !== "candidate_rejected" && item.state !== "source_skipped",
  ).length;
  const scrollToMyPageTarget = (section: MyPageSectionTab, id: string) => {
    setPageSectionTab(section);
    let attempts = 0;
    const scrollWhenReady = () => {
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      attempts += 1;
      if (attempts < 10) {
        window.setTimeout(scrollWhenReady, 80);
      }
    };
    window.setTimeout(scrollWhenReady, 80);
  };
  const openMatchingFilter = (filter: MatchingFilter) => {
    setMatchingFilter(filter);
    scrollToMyPageTarget("matching", "matching-filter-panel");
  };
  const applicationOverviewItems = [
    {
      label: "받은 지원 대기",
      value: receivedOpenPendingCount + receivedPaidPendingCount,
      detail: `오픈 ${receivedOpenPendingCount} · 유료 ${receivedPaidPendingCount}`,
      accent: "bg-rose-500",
      onClick: () => openMatchingFilter("received"),
    },
    {
      label: "내 지원 진행",
      value: appliedOpenActiveCount + appliedPaidActiveCount,
      detail: `오픈 ${appliedOpenActiveCount} · 유료 ${appliedPaidActiveCount}`,
      accent: "bg-sky-500",
      onClick: () => openMatchingFilter("applied"),
    },
    {
      label: "1:1 진행",
      value: oneOnOneActiveCount,
      detail: oneOnOneActionCount > 0 ? `확인 필요 ${oneOnOneActionCount}` : "확인 필요 없음",
      accent: "bg-violet-500",
      onClick: () => openMatchingFilter("one_on_one"),
    },
    {
      label: "빠른매칭",
      value: visibleSwipeMatchCount,
      detail: swipeStatusLoading
        ? "불러오는 중"
        : swipeStatusLoaded
          ? `받은 ${swipeStatusSummary?.incoming_pending ?? 0} · 보낸 ${swipeStatusSummary?.outgoing_pending ?? 0}`
          : "상태 확인",
      accent: "bg-emerald-500",
      onClick: () => {
        if (!swipeStatusPanelOpen) {
          void handleToggleSwipeStatusPanel();
        }
        openMatchingFilter("quick");
      },
    },
  ];
  const statusRankPublicFirst: Record<AdminOpenCard["status"], number> = {
    public: 0,
    pending: 1,
    hidden: 2,
    expired: 3,
  };
  const statusRankPendingFirst: Record<AdminOpenCard["status"], number> = {
    pending: 0,
    public: 1,
    hidden: 2,
    expired: 3,
  };
  const sortedAdminOpenCards = [...adminOpenCards].sort((a, b) => {
    if (adminCardSort === "newest") {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (adminCardSort === "oldest") {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    if (adminCardSort === "public_first") {
      const diff = statusRankPublicFirst[a.status] - statusRankPublicFirst[b.status];
      if (diff !== 0) return diff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    const diff = statusRankPendingFirst[a.status] - statusRankPendingFirst[b.status];
    if (diff !== 0) return diff;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
  const appStatusRankSubmittedFirst: Record<AdminOpenCardApplication["status"], number> = {
    submitted: 0,
    accepted: 1,
    rejected: 2,
    canceled: 3,
  };
  const appStatusRankAcceptedFirst: Record<AdminOpenCardApplication["status"], number> = {
    accepted: 0,
    submitted: 1,
    rejected: 2,
    canceled: 3,
  };
  const sortedAdminOpenCardApplications = [...adminOpenCardApplications].sort((a, b) => {
    if (adminApplicationSort === "newest") {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (adminApplicationSort === "oldest") {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    if (adminApplicationSort === "submitted_first") {
      const diff = appStatusRankSubmittedFirst[a.status] - appStatusRankSubmittedFirst[b.status];
      if (diff !== 0) return diff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    const diff = appStatusRankAcceptedFirst[a.status] - appStatusRankAcceptedFirst[b.status];
    if (diff !== 0) return diff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  const sortedAdminPaidCardApplications = [...adminPaidCardApplications].sort((a, b) => {
    if (adminApplicationSort === "newest") {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (adminApplicationSort === "oldest") {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    if (adminApplicationSort === "submitted_first") {
      const diff = appStatusRankSubmittedFirst[a.status] - appStatusRankSubmittedFirst[b.status];
      if (diff !== 0) return diff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    const diff = appStatusRankAcceptedFirst[a.status] - appStatusRankAcceptedFirst[b.status];
    if (diff !== 0) return diff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const showProfileSection = pageSectionTab === "profile";
  const showMatchingSection = pageSectionTab === "matching";
  const showPaymentSection = pageSectionTab === "payment";
  const showSettingsSection = pageSectionTab === "settings";
  const showAdminSection = pageSectionTab === "admin" && isAdmin;

  return (
    <main className="mx-auto max-w-2xl px-4 pt-8 pb-[calc(120px+env(safe-area-inset-bottom))] md:pb-10">
      {accountDeleteConfirmOpen && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/40 px-4 py-6 sm:items-center">
          <section className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <p className="text-lg font-bold text-neutral-950">회원 탈퇴</p>
            <p className="mt-3 text-sm leading-6 text-neutral-600">
              탈퇴 후 계정 복구는 불가능합니다. 작성한 데이터가 삭제되거나 비공개 처리될 수 있고, 법령상 필요한 기록은 일정 기간 보관될 수 있습니다.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAccountDeleteConfirmOpen(false)}
                disabled={deletingAccount}
                className="min-h-[44px] rounded-xl border border-neutral-300 bg-white px-4 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteAccount()}
                disabled={deletingAccount}
                className="min-h-[44px] rounded-xl bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deletingAccount ? "처리 중..." : "탈퇴하기"}
              </button>
            </div>
          </section>
        </div>
      )}

      <section className="mb-4 rounded-2xl border border-neutral-200/80 bg-white p-1.5 shadow-[0_10px_30px_rgba(17,24,39,0.04)]">
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 sm:gap-2">
          {([
            { key: "profile", label: "내 정보" },
            { key: "matching", label: "매칭" },
            { key: "payment", label: "결제" },
            { key: "settings", label: "설정" },
            ...(isAdmin ? [{ key: "admin", label: "관리" }] : []),
          ] as Array<{ key: MyPageSectionTab; label: string }>).map((tab) => {
            const active = pageSectionTab === tab.key;
            return (
              <button
                key={`mypage-section-${tab.key}`}
                type="button"
                onClick={() => setPageSectionTab(tab.key)}
                className={`min-h-[44px] rounded-xl text-sm font-semibold transition ${
                  active ? "bg-neutral-950 text-white shadow-sm" : "bg-transparent text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </section>

      {(showProfileSection || showMatchingSection || showSettingsSection) && (
      <section className="mb-5 rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-[0_14px_40px_rgba(17,24,39,0.05)] sm:p-5">
        {showProfileSection && (
        <>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-neutral-950">마이페이지</h1>
            <p className="mt-1 truncate text-sm font-medium text-neutral-500">{nickname}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span
              className={`inline-flex h-7 items-center rounded-full px-2.5 text-[11px] font-semibold ${
                phoneVerified ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
              }`}
            >
              {phoneVerified ? "휴대폰 인증 완료" : "휴대폰 미인증"}
            </span>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 p-0.5 pl-2.5">
              <span className="whitespace-nowrap text-[11px] font-bold text-neutral-700">빠른매칭</span>
              <div className="grid grid-cols-2 rounded-full bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => void handleToggleSwipeVisibility(true)}
                  disabled={savingSwipeVisibility || swipeProfileVisible}
                  aria-pressed={swipeProfileVisible}
                  className={`h-9 rounded-full px-3 text-[11px] font-bold transition disabled:cursor-not-allowed ${
                    swipeProfileVisible ? "bg-neutral-950 text-white" : "text-neutral-500 hover:bg-neutral-100"
                  } ${savingSwipeVisibility ? "opacity-60" : ""}`}
                >
                  ON
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggleSwipeVisibility(false)}
                  disabled={savingSwipeVisibility || !swipeProfileVisible}
                  aria-pressed={!swipeProfileVisible}
                  className={`h-9 rounded-full px-3 text-[11px] font-bold transition disabled:cursor-not-allowed ${
                    !swipeProfileVisible ? "bg-neutral-950 text-white" : "text-neutral-500 hover:bg-neutral-100"
                  } ${savingSwipeVisibility ? "opacity-60" : ""}`}
                >
                  OFF
                </button>
              </div>
              </div>
            </div>
          </div>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-neutral-100 pt-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-neutral-500">닉네임 설정</p>
            <p className="mt-0.5 text-[11px] text-neutral-400">
                  {remainingFree > 0
                    ? `무료 변경 ${remainingFree}회 남음`
                    : credits > 0
                    ? `추가 변경권 ${credits}개 보유`
                    : "무료 변경권 소진"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setNicknameOpen(true);
              setNicknameError("");
              setNicknameInfo("");
              setNewNickname("");
            }}
            disabled={!canChangeNickname}
            className="h-9 shrink-0 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            변경
          </button>
        </div>
            {!canChangeNickname && (
              <p className="mt-2 text-[11px] text-amber-700">
                닉네임 변경은 1회 무료입니다. 추가 변경권 기능은 준비 중입니다.
              </p>
            )}
        {nicknameInfo && <p className="mt-2 text-[11px] text-emerald-700">{nicknameInfo}</p>}

        <div className="mt-5 flex items-end justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-neutral-900">내 활동</p>
            <p className="mt-0.5 text-[11px] text-neutral-400">눌러서 진행 내역을 바로 확인하세요.</p>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 overflow-hidden rounded-xl border border-neutral-200 bg-white sm:grid-cols-4">
          {applicationOverviewItems.map((item) => (
            <div key={item.label} className="relative border-b border-r border-neutral-100 p-3 last:border-r-0 sm:border-b-0">
              <span className={`absolute inset-y-3 left-0 w-0.5 rounded-full ${item.value > 0 ? item.accent : "bg-neutral-200"}`} aria-hidden="true" />
              <button
                type="button"
                onClick={item.onClick}
                className="block min-h-[64px] w-full rounded-lg pl-1 text-left transition hover:opacity-70 focus:outline-none focus:ring-2 focus:ring-neutral-200"
              >
                <p className="text-[11px] font-semibold text-neutral-500">{item.label}</p>
                <p className="mt-1 text-xl font-bold text-neutral-950">{item.value}<span className="ml-0.5 text-[11px] font-medium text-neutral-400">건</span></p>
                <p className="mt-1 truncate text-[10px] font-medium text-neutral-400">{item.detail}</p>
              </button>
            </div>
          ))}
        </div>

        {!phoneVerified && (
        <div className="mt-4 rounded-xl border border-neutral-200/80 bg-[#fbfaf8] p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-neutral-800">휴대폰 인증</p>
              <p className="mt-1 text-xs text-amber-700">지원과 매칭 이용 전 인증을 완료해주세요.</p>
            </div>
          </div>

            <div className="mt-3 space-y-2">
              <p className="rounded-lg border border-neutral-100 bg-white px-3 py-2 text-[11px] leading-5 text-neutral-500">
                010 번호를 입력하면 문자 인증번호를 보내드려요. 보통 1분 안에 도착하며, 오지 않으면 스팸/차단 설정을 확인한 뒤 재발송해주세요.
              </p>
              <input
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="휴대폰 번호 (예: 01012345678)"
                className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm"
              />
              <button
                type="button"
                onClick={() => void handleSendPhoneOtp()}
                disabled={sendingPhoneOtp || phoneOtpResendAfterSec > 0}
                className="h-10 rounded-lg border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-700 shadow-sm disabled:opacity-60"
              >
                {sendingPhoneOtp
                  ? "발송 중..."
                  : phoneOtpResendAfterSec > 0
                    ? `${phoneOtpResendAfterSec}초 후 재발송`
                    : phoneOtpPending
                      ? "인증번호 재발송"
                      : "인증번호 발송"}
              </button>

              {phoneOtpPending && (
                <div className="space-y-2">
                  <p className="text-[11px] text-neutral-500">
                    인증번호가 오지 않으면 1분 뒤 재발송해주세요. 계속 안 오면 사이트 하단 연락처 번호로 닉네임과 휴대폰 번호를 보내주시면 수동 인증해드릴게요.
                  </p>
                  <input
                    type="text"
                    value={phoneOtpCode}
                    onChange={(e) => setPhoneOtpCode(e.target.value)}
                    placeholder="문자 인증번호"
                    className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void handleVerifyPhoneOtp()}
                    disabled={verifyingPhoneOtp}
                    className="h-10 rounded-lg bg-neutral-950 px-3 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {verifyingPhoneOtp ? "확인 중..." : "인증번호 확인"}
                  </button>
                </div>
              )}

              {phoneVerifyError && <p className="text-xs text-red-600">{phoneVerifyError}</p>}
              {phoneVerifyInfo && <p className="text-xs text-emerald-700">{phoneVerifyInfo}</p>}
            </div>
        </div>
        )}

        </>
        )}

        {showMatchingSection && (
        <>
          <div id="matching-filter-panel" className="scroll-mt-24">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-neutral-950">매칭 내역</h2>
                <p className="mt-1 text-xs text-neutral-500">확인할 내역만 골라 빠르게 볼 수 있어요.</p>
              </div>
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {([
                { key: "all", label: "전체" },
                { key: "received", label: `받은 지원 ${receivedOpenPendingCount + receivedPaidPendingCount}` },
                { key: "applied", label: `내 지원 ${appliedOpenActiveCount + appliedPaidActiveCount}` },
                { key: "one_on_one", label: `1:1 ${oneOnOneActiveCount}` },
                { key: "quick", label: `빠른매칭 ${visibleSwipeMatchCount}` },
              ] as Array<{ key: MatchingFilter; label: string }>).map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setMatchingFilter(filter.key)}
                  aria-pressed={matchingFilter === filter.key}
                  className={`min-h-[40px] shrink-0 rounded-full border px-4 text-xs font-semibold transition ${
                    matchingFilter === filter.key
                      ? "border-neutral-950 bg-neutral-950 text-white"
                      : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

        {(matchingFilter === "all" || matchingFilter === "quick") && (

          <div id="swipe-status-panel" className="mt-4 rounded-xl border border-rose-100 bg-rose-50/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-neutral-900">빠른매칭 진행 상황</p>
              <p className="mt-1 text-xs text-neutral-500">
                받은/보낸 라이크와 쌍방 매칭을 필요할 때 확인합니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {swipeStatusLoaded && (
                <div className="flex flex-wrap gap-2 text-xs font-medium">
                  <span className="rounded-full bg-white px-3 py-1 text-neutral-700">
                    보낸 라이크 {swipeStatusSummary?.outgoing_pending ?? 0}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1 text-rose-700">
                    받은 라이크 {swipeStatusSummary?.incoming_pending ?? 0}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1 text-emerald-700">
                    쌍방 매칭 {visibleSwipeMatchCount}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => void handleToggleSwipeStatusPanel()}
                disabled={swipeStatusLoading}
                className="h-9 rounded-lg border border-rose-200 bg-white px-3 text-xs font-medium text-rose-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {swipeStatusLoading
                  ? "불러오는 중..."
                  : swipeStatusPanelOpen
                    ? "빠른매칭 접기"
                    : swipeStatusLoaded
                      ? "빠른매칭 보기"
                      : "빠른매칭 불러오기"}
              </button>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-amber-200 bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-amber-900">빠른매칭 플러스</p>
                <p className="mt-1 text-xs text-amber-800">
                  지금 하루 {swipeSubscriptionStatus?.dailyLimit ?? 5}회 사용 가능
                  {swipeSubscriptionStatus?.status === "active"
                    ? ` · 추가 이용 중`
                    : swipeSubscriptionStatus?.status === "pending"
                      ? ` · 기존 요청 있음`
                      : ` · 기본 제공 ${swipeSubscriptionStatus?.baseLimit ?? 5}회`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold text-amber-800">
                  3만원 · 30일 · 하루 {swipeSubscriptionStatus?.premiumLimit ?? 30}회 · 노출 강화
                </span>
                <button
                  type="button"
                  onClick={() => setSwipeSubscriptionPanelOpen((prev) => !prev)}
                  className="h-8 rounded-md border border-amber-200 bg-white px-3 text-xs font-medium text-amber-800"
                >
                  {swipeSubscriptionPanelOpen ? "접기" : "자세히 보기"}
                </button>
              </div>
            </div>
            {swipeSubscriptionStatus?.status === "active" && swipeSubscriptionStatus.activeSubscription?.expiresAt ? (
                <p className="mt-2 text-[11px] text-emerald-700">
                  추가 이용 중: {new Date(swipeSubscriptionStatus.activeSubscription.expiresAt).toLocaleString("ko-KR")}까지
                </p>
              ) : null}
              {swipeSubscriptionStatus?.status === "pending" && swipeSubscriptionStatus.pendingSubscription?.id ? (
                <p className="mt-2 text-[11px] text-amber-700">
                기존 요청 있음: 신청ID {swipeSubscriptionStatus.pendingSubscription.id}
                </p>
              ) : null}

            {swipeSubscriptionPanelOpen && (
              <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/40 p-3">
                <p className="text-xs text-amber-800">
                  기본은 하루 {swipeSubscriptionStatus?.baseLimit ?? 5}회예요. 추가 이용을 신청하면 30일 동안 하루{" "}
                  {swipeSubscriptionStatus?.premiumLimit ?? 30}회까지 사용할 수 있고, 내 프로필도 빠른매칭에서 더 잘 보이게 돼요.
                </p>
                <p className="mt-2 text-[11px] text-amber-700">현재는 카카오페이 간편결제로만 결제할 수 있어요.</p>
                <p className="mt-1 text-[11px] text-amber-700">그 밖의 문의는 오픈카톡으로 부탁드려요.</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <a
                    href={OPEN_KAKAO_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center rounded-md border border-amber-200 bg-white px-3 text-xs font-medium text-amber-800"
                  >
                    오픈카톡 문의
                  </a>
                  <button
                    type="button"
                    disabled={
                      swipeSubscriptionSubmitting ||
                      swipeSubscriptionLoading
                    }
                    onClick={() => void handleRequestSwipeSubscription()}
                    className="h-8 rounded-md bg-amber-500 px-3 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {swipeSubscriptionSubmitting
                      ? "이동 중..."
                      : swipeSubscriptionStatus?.status === "active"
                        ? "30일 더 연장"
                        : "카카오페이로 시작"}
                  </button>
                </div>
                {swipeSubscriptionStatus?.status === "pending" && swipeSubscriptionStatus.pendingSubscription?.id ? (
                  <p className="mt-2 text-[11px] text-amber-700">
                    기존 요청이 있어도 결제가 완료되면 바로 적용됩니다. 신청ID {swipeSubscriptionStatus.pendingSubscription.id}
                    {swipeSubscriptionStatus.pendingSubscription.requestedAt
                      ? ` / ${new Date(swipeSubscriptionStatus.pendingSubscription.requestedAt).toLocaleString("ko-KR")}`
                      : ""}
                  </p>
                ) : null}
                {swipeSubscriptionError ? (
                  <p className="mt-2 text-[11px] text-rose-600">{swipeSubscriptionError}</p>
                ) : null}
                {swipeSubscriptionInfo ? (
                  <p className="mt-2 text-[11px] text-emerald-700">{swipeSubscriptionInfo}</p>
                ) : null}
              </div>
            )}
          </div>

          {swipeStatusPanelOpen && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSwipeStatusView("incoming")}
                  className={`h-8 rounded-full px-3 text-xs font-medium ${
                    swipeStatusView === "incoming"
                      ? "bg-pink-500 text-white"
                      : "border border-pink-200 bg-white text-pink-800"
                  }`}
                >
                  받은 라이크 {swipeStatusSummary?.incoming_pending ?? 0}
                </button>
                <button
                  type="button"
                  onClick={() => setSwipeStatusView("outgoing")}
                  className={`h-8 rounded-full px-3 text-xs font-medium ${
                    swipeStatusView === "outgoing"
                      ? "bg-neutral-900 text-white"
                      : "border border-neutral-200 bg-white text-neutral-700"
                  }`}
                >
                  보낸 라이크 {swipeStatusSummary?.outgoing_pending ?? 0}
                </button>
                <span className="inline-flex h-8 items-center rounded-full bg-emerald-100 px-3 text-xs font-medium text-emerald-700">
                  쌍방 매칭 {visibleSwipeMatchCount}
                </span>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-white p-3">
                <p className="text-sm font-semibold text-emerald-900">쌍방 매칭된 사람</p>
                {swipeMatchConnections.length === 0 ? (
                  <p className="mt-2 text-xs text-neutral-500">지금 표시할 쌍방 매칭 상대가 없습니다.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {swipeMatchConnections.map((item) => (
                      <div key={item.application_id} className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-neutral-900">{item.other_nickname}</p>
                          <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            자동 매칭
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-neutral-500">
                          매칭일 {new Date(item.created_at).toLocaleString("ko-KR")}
                        </p>
                        {item.other_instagram_id ? (
                          <InstagramProfileLine label="상대 인스타" username={item.other_instagram_id} />
                        ) : (
                          <p className="mt-2 text-xs text-neutral-500">상대 인스타 정보는 연결 목록에서 다시 확인할 수 있어요.</p>
                        )}
                        {item.matched_card ? (
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600">
                            <span>{item.matched_card.sex === "male" ? "남자" : item.matched_card.sex === "female" ? "여자" : "성별 미기재"}</span>
                            {item.matched_card.age != null && <span>{item.matched_card.age}세</span>}
                            {item.matched_card.height_cm != null && <span>키 {item.matched_card.height_cm}cm</span>}
                            {item.matched_card.region && <span>{item.matched_card.region}</span>}
                            {item.matched_card.job && <span>{item.matched_card.job}</span>}
                            {item.matched_card.training_years != null && <span>운동 {item.matched_card.training_years}년</span>}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {swipeStatusView === "outgoing" ? (
                <div className="rounded-xl border border-neutral-200 bg-white p-3">
                  <p className="text-sm font-semibold text-neutral-900">내가 보낸 라이크</p>
                  {myOutgoingSwipeLikes.length === 0 ? (
                    <p className="mt-2 text-xs text-neutral-500">아직 보낸 라이크가 없습니다.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {(showAllOutgoingSwipeLikes ? myOutgoingSwipeLikes : myOutgoingSwipeLikes.slice(0, 6)).map((item) => {
                        const deleting = deletingSwipeLikeIds.includes(item.swipe_id);
                        return (
                        <div key={item.swipe_id} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                          <div className="flex gap-3">
                            <div className="h-24 w-20 shrink-0 overflow-hidden rounded-xl border border-neutral-200 bg-white">
                              {item.card?.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={item.card.image_url} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                              ) : (
                                <div className="flex h-full items-center justify-center text-[11px] text-neutral-400">사진 없음</div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium text-neutral-900">{item.card?.display_nickname ?? "익명"}</p>
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                    item.matched ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                                  }`}
                                >
                                  {item.matched ? "쌍방 매칭" : "응답 대기"}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-neutral-600">
                                {item.card?.age != null ? `${item.card.age}세 / ` : ""}
                                {item.card?.height_cm != null ? `키 ${item.card.height_cm}cm / ` : ""}
                                {item.card?.region ?? "지역 미기재"}
                                {item.card?.job ? ` / ${item.card.job}` : ""}
                                {item.card?.training_years != null ? ` / 운동 ${item.card.training_years}년` : ""}
                              </p>
                              {item.card?.strengths_text && (
                                <p className="mt-1 text-xs text-emerald-700 whitespace-pre-wrap break-words">강점: {item.card.strengths_text}</p>
                              )}
                              {item.card?.intro_text && (
                                <p className="mt-1 text-xs text-neutral-700 whitespace-pre-wrap break-words">자기소개: {item.card.intro_text}</p>
                              )}
                              <p className="mt-2 text-[11px] text-neutral-500">
                                {item.matched && item.matched_at
                                  ? `매칭 완료: ${new Date(item.matched_at).toLocaleString("ko-KR")}`
                                  : `보낸 시각: ${new Date(item.created_at).toLocaleString("ko-KR")}`}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={deleting}
                                  onClick={() => void handleDeleteOutgoingSwipeLike(item)}
                                  className="h-8 rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
                                >
                                  {deleting ? "처리 중..." : item.matched ? "매칭 취소" : "라이크 취소"}
                                </button>
                                {item.matched ? (
                                  <span className="inline-flex items-center text-[11px] text-neutral-500">
                                    취소하면 인스타 교환 목록에서도 바로 빠집니다.
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      )})}
                    </div>
                  )}
                  {myOutgoingSwipeLikes.length > 6 && (
                    <button
                      type="button"
                      onClick={() => setShowAllOutgoingSwipeLikes((prev) => !prev)}
                      className="mt-3 h-8 rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                    >
                      {showAllOutgoingSwipeLikes ? "보낸 라이크 접기" : `보낸 라이크 ${myOutgoingSwipeLikes.length}개 전체 보기`}
                    </button>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-pink-200 bg-white p-3">
                  <p className="text-sm font-semibold text-pink-900">나를 라이크한 사람</p>
                  {myIncomingSwipeLikes.length === 0 ? (
                    <p className="mt-2 text-xs text-neutral-500">지금 확인 가능한 받은 라이크가 없습니다.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {(showAllIncomingSwipeLikes ? myIncomingSwipeLikes : myIncomingSwipeLikes.slice(0, 6)).map((item) => {
                        const processing = processingSwipeLikeBackIds.includes(item.swipe_id);
                        return (
                          <div key={item.swipe_id} className="rounded-lg border border-pink-200 bg-pink-50/40 p-3">
                            <div className="flex gap-3">
                              <div className="h-24 w-20 shrink-0 overflow-hidden rounded-xl border border-pink-200 bg-white">
                                {item.card?.image_url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={item.card.image_url} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                                ) : (
                                  <div className="flex h-full items-center justify-center text-[11px] text-neutral-400">사진 없음</div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-sm font-medium text-neutral-900">{item.card?.display_nickname ?? "익명"}</p>
                                  <span className="inline-flex rounded-full bg-pink-100 px-2 py-0.5 text-[11px] font-medium text-pink-700">
                                    나를 라이크함
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-neutral-600">
                                  {item.card?.age != null ? `${item.card.age}세 / ` : ""}
                                  {item.card?.height_cm != null ? `키 ${item.card.height_cm}cm / ` : ""}
                                  {item.card?.region ?? "지역 미기재"}
                                  {item.card?.job ? ` / ${item.card.job}` : ""}
                                  {item.card?.training_years != null ? ` / 운동 ${item.card.training_years}년` : ""}
                                </p>
                                {item.card?.strengths_text && (
                                  <p className="mt-1 text-xs text-emerald-700 whitespace-pre-wrap break-words">강점: {item.card.strengths_text}</p>
                                )}
                                {item.card?.intro_text && (
                                  <p className="mt-1 text-xs text-neutral-700 whitespace-pre-wrap break-words">자기소개: {item.card.intro_text}</p>
                                )}
                                <p className="mt-2 text-[11px] text-neutral-500">
                                  받은 시각: {new Date(item.created_at).toLocaleString("ko-KR")}
                                </p>
                                {item.expires_at ? (
                                  <>
                                    <p className="mt-1 text-[11px] font-medium text-amber-700">
                                      남은 시간: {formatRemainingToKorean(item.expires_at)}
                                    </p>
                                    <p className="mt-1 text-[11px] text-amber-700">
                                      30시간 안에 응답이 없으면 자동 정리: {new Date(item.expires_at).toLocaleString("ko-KR")}
                                    </p>
                                  </>
                                ) : null}
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={processing || !item.card?.id || !item.card.sex}
                                    onClick={() => void handleSwipeLikeBack(item)}
                                    className="h-8 rounded-md bg-pink-500 px-3 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {processing ? "처리 중..." : "바로 라이크"}
                                  </button>
                                  <span className="inline-flex items-center text-[11px] text-neutral-500">
                                    지금 맞라이크하면 바로 쌍방 매칭이 될 수 있어요.
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {myIncomingSwipeLikes.length > 6 && (
                    <button
                      type="button"
                      onClick={() => setShowAllIncomingSwipeLikes((prev) => !prev)}
                      className="mt-3 h-8 rounded-md border border-pink-200 bg-white px-3 text-xs font-medium text-pink-800 hover:bg-pink-50"
                    >
                      {showAllIncomingSwipeLikes ? "받은 라이크 접기" : `받은 라이크 ${myIncomingSwipeLikes.length}개 전체 보기`}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        )}
        </>
        )}

        {showSettingsSection && (
        <>
        <div className="mb-4">
          <h2 className="text-lg font-bold text-neutral-950">설정</h2>
          <p className="mt-1 text-xs text-neutral-500">차단, 인증, 문의와 계정 설정을 관리합니다.</p>
        </div>

        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/50 p-3">
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-semibold text-rose-900">오픈카드 지인 차단</p>
              <p className="mt-1 text-xs leading-5 text-neutral-600">
                휴대폰 번호나 인스타 아이디를 입력하면 오픈카드와 빠른매칭에서 서로 보이지 않게 제외돼요.
              </p>
              <p className="mt-1 text-[11px] text-neutral-500">입력값은 원문 그대로 저장하지 않고 안전하게 비교해요.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[90px_1fr_1fr_auto]">
              <select
                value={datingContactBlockType}
                onChange={(event) => setDatingContactBlockType(event.target.value === "instagram" ? "instagram" : "phone")}
                className="min-h-[38px] rounded-lg border border-rose-200 bg-white px-3 text-sm outline-none focus:border-rose-300"
              >
                <option value="phone">휴대폰</option>
                <option value="instagram">인스타</option>
              </select>
              <input
                type={datingContactBlockType === "phone" ? "tel" : "text"}
                value={datingContactBlockValue}
                onChange={(event) => setDatingContactBlockValue(event.target.value)}
                placeholder={datingContactBlockType === "phone" ? "01012345678" : "instagram_id"}
                className="min-h-[38px] rounded-lg border border-rose-200 bg-white px-3 text-sm outline-none focus:border-rose-300"
              />
              <input
                type="text"
                value={datingContactBlockLabel}
                onChange={(event) => setDatingContactBlockLabel(event.target.value)}
                placeholder="메모 선택"
                className="min-h-[38px] rounded-lg border border-rose-200 bg-white px-3 text-sm outline-none focus:border-rose-300"
              />
              <button
                type="button"
                onClick={() => void handleAddDatingContactBlock()}
                disabled={datingContactBlockSubmitting}
                className="inline-flex min-h-[38px] items-center justify-center rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white disabled:opacity-50"
              >
                {datingContactBlockSubmitting ? "저장 중..." : "차단"}
              </button>
            </div>
            {myDatingContactBlocks.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {myDatingContactBlocks.map((block) => {
                  const deleting = deletingDatingContactBlockIds.includes(block.id);
                  return (
                    <span
                      key={`profile-${block.id}`}
                      className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-white px-3 py-1 text-[11px] text-rose-800"
                    >
                      {block.label ? `${block.label} · ` : ""}
                      {block.block_type === "phone" ? "휴대폰" : "인스타"} {block.value_hint ?? ""}
                      <button
                        type="button"
                        disabled={deleting}
                        onClick={() => void handleDeleteDatingContactBlock(block.id)}
                        className="font-semibold text-rose-700 disabled:opacity-50"
                      >
                        {deleting ? "삭제 중" : "해제"}
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11px] text-neutral-500">아직 등록한 지인 차단이 없습니다.</p>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/my-records"
            className="flex min-h-[44px] items-center rounded-xl border border-neutral-200 px-4 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            내 3대 기록
          </Link>
          <Link
            href="/certify"
            className="flex min-h-[44px] items-center rounded-xl border border-neutral-200 px-4 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            3대 인증 신청
          </Link>
          {isAdmin && (
            <>
              <Link
                href="/admin/dating"
                className="flex min-h-[44px] items-center rounded-xl border border-pink-200 bg-pink-50 px-4 text-sm font-medium text-pink-700 hover:bg-pink-100"
              >
                소개팅 신청 관리
              </Link>
              <Link
                href="/admin/dating/cards"
                className="flex min-h-[44px] items-center rounded-xl border border-violet-200 bg-violet-50 px-4 text-sm font-medium text-violet-700 hover:bg-violet-100"
              >
                카드/신고 관리
              </Link>
              <Link
                href="/admin/dating/paid"
                className="flex min-h-[44px] items-center rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-medium text-rose-700 hover:bg-rose-100"
              >
                유료 요청 관리
              </Link>
              <Link
                href="/admin/dating/1on1"
                className="flex min-h-[44px] items-center rounded-xl border border-sky-200 bg-sky-50 px-4 text-sm font-medium text-sky-700 hover:bg-sky-100"
              >
                1:1 이상형 관리
              </Link>
              <Link
                href="/admin/support"
                className="flex min-h-[44px] items-center rounded-xl border border-cyan-200 bg-cyan-50 px-4 text-sm font-medium text-cyan-700 hover:bg-cyan-100"
              >
                고객 문의 관리
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="min-h-[44px] rounded-xl bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            로그아웃
          </button>
          <button
            type="button"
            onClick={() => setAccountDeleteConfirmOpen(true)}
            disabled={deletingAccount}
            className="min-h-[44px] rounded-xl border border-red-300 bg-white px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            {deletingAccount ? "탈퇴 처리 중..." : "회원 탈퇴"}
          </button>
        </div>
        </>
        )}
      </section>
      )}

      {(showPaymentSection || showSettingsSection) && (
      <>
      {showPaymentSection && (
      <>
      <section className="mb-5 rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-[0_14px_40px_rgba(17,24,39,0.05)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-neutral-950">결제센터</h2>
            <p className="mt-1 text-sm text-neutral-600">
              결제한 상품 상태와 현재 적용 중인 혜택을 한 곳에서 확인할 수 있어요.
            </p>
            {!paymentCenterOpen && (
              <p className="mt-1 text-xs text-neutral-500">
                결제 내역, 매출전표, 지원권 잔여 수량, 이상형 더보기 상태, 1:1 번호 교환 결제까지 여기서 확인할 수 있어요.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/refund"
              className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
            >
              환불 안내
            </Link>
            <button
              type="button"
              onClick={() => setPaymentCenterOpen((prev) => !prev)}
              className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
            >
              {paymentCenterOpen ? "결제센터 접기" : "결제센터 펼치기"}
            </button>
          </div>
        </div>

        {paymentCenterOpen && (
          <>
            {paymentCenterError ? (
              <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{paymentCenterError}</p>
            ) : null}

            {paymentCenterLoading && !paymentCenterData ? (
              <p className="mt-3 rounded-xl border border-neutral-200 bg-[#fbfaf8] p-4 text-sm text-neutral-500">결제센터를 불러오는 중입니다.</p>
            ) : null}

            {paymentCenterData ? (
              <>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-neutral-200 bg-[#fbfaf8] p-4">
                    <p className="text-xs text-neutral-500">남은 지원권</p>
                    <p className="mt-2 text-2xl font-black text-neutral-900">{paymentCenterData.summary.creditsRemaining.toLocaleString("ko-KR")}장</p>
                    <p className="mt-1 text-[11px] text-neutral-500">오늘 기본 지원 가능 {paymentCenterData.summary.baseRemaining}회</p>
                  </div>
                  <div className="rounded-xl border border-neutral-200 bg-[#fbfaf8] p-4">
                    <p className="text-xs text-neutral-500">남자 더보기 상태</p>
                    <p className="mt-2 text-lg font-bold text-neutral-900">
                      {paymentCenterData.summary.moreViewMale === "approved"
                        ? "이용 가능"
                        : paymentCenterData.summary.moreViewMale === "pending"
                          ? "승인 대기"
                          : paymentCenterData.summary.moreViewMale === "rejected"
                            ? "거절됨"
                            : "이용 없음"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-neutral-200 bg-[#fbfaf8] p-4">
                    <p className="text-xs text-neutral-500">여자 더보기 상태</p>
                    <p className="mt-2 text-lg font-bold text-neutral-900">
                      {paymentCenterData.summary.moreViewFemale === "approved"
                        ? "이용 가능"
                        : paymentCenterData.summary.moreViewFemale === "pending"
                          ? "승인 대기"
                          : paymentCenterData.summary.moreViewFemale === "rejected"
                            ? "거절됨"
                            : "이용 없음"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-neutral-200 bg-[#fbfaf8] p-4">
                    <p className="text-xs text-neutral-500">최근 주문</p>
                    <p className="mt-2 text-2xl font-black text-neutral-900">{paymentCenterData.orders.length.toLocaleString("ko-KR")}건</p>
                    <p className="mt-1 text-[11px] text-neutral-500">최근 20건 기준</p>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-neutral-200 bg-[#fbfaf8] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-neutral-900">내 결제 내역</p>
                      <p className="mt-1 text-xs text-neutral-500">
                        토스 문서 기준으로 결제 성공 후에는 주문번호, 금액, 상태를 확인할 수 있어야 하고, 카드 결제는 매출전표도 조회할 수 있어요.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadPaymentCenter(true)}
                      disabled={paymentCenterLoading}
                      className="h-8 rounded-md border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 shadow-sm disabled:opacity-50"
                    >
                      {paymentCenterLoading ? "새로고침 중..." : "결제 내역 새로고침"}
                    </button>
                  </div>

                  {paymentCenterData.orders.length === 0 ? (
                    <p className="mt-3 rounded-xl border border-dashed border-neutral-200 bg-white p-4 text-sm text-neutral-500">
                      아직 결제한 내역이 없습니다.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {paymentCenterData.orders.map((order) => (
                        <article key={order.id} className="rounded-xl border border-neutral-200 bg-white p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-neutral-900">{formatPaymentProductLabel(order)}</p>
                              <p className="mt-1 text-[11px] text-neutral-500">주문번호 {order.toss_order_id}</p>
                            </div>
                            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                              {formatPaymentStatusLabel(order.status)}
                            </span>
                          </div>

                          <div className="mt-3 grid gap-3 text-sm text-neutral-700 md:grid-cols-3">
                            <div>
                              <p className="text-xs text-neutral-500">결제 금액</p>
                              <p className="mt-1 font-semibold text-neutral-900">{order.amount.toLocaleString("ko-KR")}원</p>
                            </div>
                            <div>
                              <p className="text-xs text-neutral-500">결제 시각</p>
                              <p className="mt-1">{new Date(order.created_at).toLocaleString("ko-KR")}</p>
                            </div>
                            <div>
                              <p className="text-xs text-neutral-500">처리 결과</p>
                              <p className="mt-1 font-semibold text-neutral-900">{formatPaymentResultLabel(order)}</p>
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                            {order.method ? <span>수단 {order.method}</span> : null}
                            {order.approved_at ? <span>승인 {new Date(order.approved_at).toLocaleString("ko-KR")}</span> : null}
                            {order.receiptUrl ? (
                              <a
                                href={order.receiptUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 font-medium text-neutral-700 hover:bg-neutral-50"
                              >
                                매출전표 보기
                              </a>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-xl border border-neutral-200 bg-[#fbfaf8] p-4">
                  <p className="text-sm font-semibold text-neutral-900">결제 안내</p>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-neutral-700">
                    <li>결제 완료 후 적용까지 잠시 시간이 걸릴 수 있으며, 승인이 필요한 상품은 운영 확인 후 반영됩니다.</li>
                    <li>카드 결제는 매출전표 링크가 있는 경우 바로 확인할 수 있고, 필요하면 카드사 앱이나 토스 상점관리자 기준 내역으로도 조회할 수 있습니다.</li>
                    <li>문제가 있으면 아래 문의 접수 또는 오픈카톡으로 주문번호와 닉네임을 함께 알려주시면 더 빨리 확인할 수 있어요.</li>
                  </ul>
                </div>
              </>
            ) : null}
          </>
        )}
      </section>
      {isAdmin && (
      <section id="love-fortune" className="mb-5 overflow-hidden rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-amber-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-rose-950">내 연애운</h2>
            <p className="mt-1 text-sm text-rose-800">
              결제한 연애운 상세 분석과 잘 맞는 인상 카드를 다시 볼 수 있어요.
            </p>
            {!loveFortuneOpen ? (
              <p className="mt-1 text-xs text-rose-700">결제 후 생성된 결과는 이곳에 저장됩니다.</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/community/dating/cards"
              className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-medium text-rose-800 hover:bg-rose-100"
            >
              연애운 보기
            </Link>
            <button
              type="button"
              onClick={() => setLoveFortuneOpen((prev) => !prev)}
              className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-medium text-rose-800 hover:bg-rose-100"
            >
              {loveFortuneOpen ? "접기" : "내역 펼치기"}
            </button>
          </div>
        </div>

        {loveFortuneOpen ? (
          <div className="mt-4">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void loadLoveFortuneReadings(true)}
                disabled={loveFortuneLoading}
                className="rounded-md border border-rose-300 bg-white px-3 py-2 text-xs font-medium text-rose-800 disabled:opacity-50"
              >
                {loveFortuneLoading ? "새로고침 중..." : "연애운 새로고침"}
              </button>
            </div>

            {loveFortuneError ? (
              <p className="mt-3 rounded-xl border border-red-100 bg-red-50 p-4 text-sm font-semibold text-red-700">{loveFortuneError}</p>
            ) : null}

            {loveFortuneLoading && loveFortuneReadings.length === 0 ? (
              <p className="mt-3 rounded-xl border border-rose-100 bg-white p-4 text-sm text-neutral-500">연애운 내역을 불러오는 중입니다.</p>
            ) : null}

            {!loveFortuneLoading && loveFortuneLoaded && loveFortuneReadings.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-rose-200 bg-white/70 p-4">
                <p className="text-sm font-semibold text-neutral-900">아직 저장된 연애운이 없습니다.</p>
                <p className="mt-1 text-sm text-neutral-500">생년월일만 넣어도 무료 미리보기를 볼 수 있고, 상세 분석은 결제 후 여기서 다시 확인할 수 있어요.</p>
              </div>
            ) : null}

            {loveFortuneReadings.length > 0 ? (
              <div className="mt-3 space-y-3">
                {loveFortuneReadings.map((reading) => {
                  const canGenerate = reading.status === "paid" || reading.status === "generated";
                  const generated = Boolean(reading.aiResult);
                  const ideal = reading.idealFace ?? {};
                  const reportSections = parseLoveFortuneReport(reading.aiResult);
                  const idealSketch = buildLoveFortuneIdealSketch(reading);
                  return (
                    <article key={reading.id} className="overflow-hidden rounded-2xl border border-rose-100 bg-white shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rose-50 p-4">
                        <div>
                          <p className="text-sm font-bold text-neutral-950">{formatLoveFortuneInputSummary(reading) || "연애운 상세 분석"}</p>
                          <p className="mt-1 text-xs text-neutral-500">
                            {reading.amount.toLocaleString("ko-KR")}원 · {new Date(reading.createdAt).toLocaleString("ko-KR")}
                          </p>
                        </div>
                        <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-800">
                          {formatLoveFortuneStatusLabel(reading.status)}
                        </span>
                      </div>

                      <div className="grid gap-3 p-4 lg:grid-cols-[0.8fr_1.2fr]">
                        <div className="rounded-[24px] border border-rose-100 bg-gradient-to-br from-rose-50 via-white to-amber-50 p-4">
                          <div className="mx-auto w-36 overflow-hidden rounded-[28px] border border-white bg-white/80 shadow-[0_18px_45px_rgba(244,63,94,0.16)]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={idealSketch.src}
                              alt={`${idealSketch.label} 이미지`}
                              loading="lazy"
                              decoding="async"
                              className="h-auto w-full object-contain"
                            />
                          </div>
                          <p className="mt-3 text-center text-sm font-black text-rose-950">{idealSketch.label}</p>
                          <p className="mt-2 text-center text-xs leading-5 text-rose-700">{idealSketch.body}</p>
                          <div className="mt-3 grid gap-2 text-xs text-neutral-700">
                            <p className="rounded-xl bg-white/80 p-2">눈매 · {String(ideal.eye ?? "편안하게 오래 마주볼 수 있는 눈매")}</p>
                            <p className="rounded-xl bg-white/80 p-2">미소 · {String(ideal.smile ?? "담백하지만 따뜻한 미소")}</p>
                            <p className="rounded-xl bg-white/80 p-2">스타일 · {String(ideal.style ?? "깔끔한 기본 스타일")}</p>
                          </div>
                          <p className="mt-3 text-[11px] leading-5 text-neutral-400">{String(ideal.note ?? "실제 외모를 단정하지 않는 참고용 카드입니다.")}</p>
                        </div>

                        <div>
                          <div className="rounded-xl bg-neutral-50 p-3 text-sm leading-6 text-neutral-700">
                            <p><span className="font-semibold text-neutral-900">상황</span> {reading.loveState ?? "-"} · {reading.focus ?? "-"}</p>
                            <p><span className="font-semibold text-neutral-900">목표</span> {reading.relationshipGoal ?? "-"} · {reading.meetingPreference ?? "-"}</p>
                            {reading.concern ? <p><span className="font-semibold text-neutral-900">고민</span> {reading.concern}</p> : null}
                          </div>

                          {!generated ? (
                            <div className="mt-3 rounded-xl border border-dashed border-rose-200 bg-rose-50/60 p-4">
                              <p className="text-sm font-semibold text-rose-950">상세 분석을 아직 생성하지 않았어요.</p>
                              <p className="mt-1 text-xs leading-5 text-rose-700">결제가 완료된 건은 버튼을 누르면 상세 풀이와 잘 맞는 인상 카드가 저장됩니다.</p>
                              <button
                                type="button"
                                onClick={() => void generateLoveFortuneReading(reading.id)}
                                disabled={!canGenerate || loveFortuneGeneratingId === reading.id}
                                className="mt-3 rounded-full bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
                              >
                                {loveFortuneGeneratingId === reading.id ? "생성 중..." : canGenerate ? "상세 분석 생성" : "결제 후 생성 가능"}
                              </button>
                            </div>
                          ) : (
                            <div className="mt-3 rounded-2xl border border-neutral-200 bg-white p-4">
                              <p className="text-sm font-black text-neutral-950">상세 풀이가 준비됐어요.</p>
                              <p className="mt-1 text-xs leading-5 text-neutral-500">
                                {reportSections.length}개 항목으로 정리된 결과를 별도 창에서 편하게 볼 수 있습니다.
                              </p>
                              <button
                                type="button"
                                onClick={() => setLoveFortuneViewerReading(reading)}
                                className="mt-3 rounded-full bg-neutral-950 px-4 py-2 text-sm font-bold text-white"
                              >
                                결과 크게 보기
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
      )}
      {loveFortuneViewerReading ? (() => {
        const reading = loveFortuneViewerReading;
        const sections = parseLoveFortuneReport(reading.aiResult);
        const ideal = reading.idealFace ?? {};
        const sketch = buildLoveFortuneIdealSketch(reading);
        return (
          <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/55 px-3 py-6 backdrop-blur-sm">
            <div className="mx-auto max-w-3xl overflow-hidden rounded-[30px] border border-[#d8c5a5] bg-[#f7efe2] text-[#2b2118] shadow-2xl">
              <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#d8c5a5] bg-[#fff7e8]/95 px-4 py-3 backdrop-blur">
                <div>
                  <p className="text-xs font-black tracking-[0.2em] text-[#9a5a23]">연애 명식 리포트</p>
                  <h3 className="mt-1 text-lg font-black text-stone-950">{formatLoveFortuneInputSummary(reading) || "내 연애운 상세 풀이"}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setLoveFortuneViewerReading(null)}
                  className="rounded-full bg-[#2b2118] px-4 py-2 text-sm font-black text-[#f6d9a8]"
                >
                  닫기
                </button>
              </div>

              <div className="space-y-4 p-4 sm:p-6">
                <section className="rounded-[26px] border border-rose-100 bg-white p-4">
                  <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
                    <div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={sketch.src}
                        alt={`${sketch.label} 이미지`}
                        loading="lazy"
                        decoding="async"
                        className="w-full rounded-[22px] border border-rose-100 bg-rose-50 object-contain"
                      />
                    </div>
                    <div>
                      <p className="text-xs font-black tracking-[0.16em] text-rose-700">배우자 얼굴상</p>
                      <h4 className="mt-2 text-2xl font-black text-stone-950">{sketch.label}</h4>
                      <p className="mt-2 text-sm leading-6 text-stone-600">{String(ideal.mood ?? "오래 편하게 맞는 분위기")}</p>
                      <div className="mt-3 grid gap-2 text-sm leading-6 text-stone-700">
                        <p className="rounded-2xl bg-rose-50 p-3">눈매 · {String(ideal.eye ?? "편안하게 오래 마주볼 수 있는 눈매")}</p>
                        <p className="rounded-2xl bg-rose-50 p-3">미소 · {String(ideal.smile ?? "담백하지만 따뜻한 미소")}</p>
                        <p className="rounded-2xl bg-amber-50 p-3 text-amber-900">첫 만남 · {String(ideal.firstDate ?? "대화가 편한 사람")}</p>
                      </div>
                    </div>
                  </div>
                </section>

                {sections.map((section, index) => (
                  <section
                    key={`${reading.id}-viewer-${section.title}-${index}`}
                    className={`rounded-[24px] border p-5 ${
                      index === 0 ? "border-[#d8c5a5] bg-white" : "border-[#e7d8bd] bg-[#fffaf2]"
                    }`}
                  >
                    <div className="flex items-center gap-3 border-b border-[#ead9bf] pb-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2b2118] text-xs font-black text-[#f6d9a8]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <h4 className="text-base font-black text-stone-950">{section.title}</h4>
                    </div>
                    <div className="mt-4 whitespace-pre-wrap text-[15px] leading-8 text-stone-700">{section.body}</div>
                  </section>
                ))}
              </div>
            </div>
          </div>
        );
      })() : null}
      </>
      )}
      {showSettingsSection && (
      <section className="mb-5 rounded-2xl border border-sky-200 bg-sky-50/40 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-sky-900">1:1 문의 접수</h2>
            <p className="mt-1 text-sm text-sky-800">
              결제, 소개팅, 신고/악용, 계정 문제를 마이페이지에서 바로 접수할 수 있습니다.
            </p>
            {!supportPanelOpen && (
              <p className="mt-1 text-xs text-sky-700">
                필요할 때만 펼쳐서 문의를 남기고 답변 이력을 확인할 수 있습니다.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dating-policy"
              className="rounded-lg border border-sky-300 bg-white px-3 py-2 text-xs font-medium text-sky-800 hover:bg-sky-100"
            >
              소개팅 운영정책 보기
            </Link>
            <button
              type="button"
              onClick={() => setSupportPanelOpen((prev) => !prev)}
              className="rounded-lg border border-sky-300 bg-white px-3 py-2 text-xs font-medium text-sky-800 hover:bg-sky-100"
            >
              {supportPanelOpen ? "문의 접기" : "문의 펼치기"}
            </button>
          </div>
        </div>

        {supportPanelOpen && (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <select
                value={supportCategory}
                onChange={(e) => setSupportCategory(e.target.value as SupportInquiry["category"])}
                className="h-11 rounded-xl border border-sky-200 bg-white px-3 text-sm text-neutral-800"
              >
                {Object.entries(SUPPORT_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                value={supportSubject}
                onChange={(e) => setSupportSubject(e.target.value)}
                maxLength={120}
                placeholder="문의 제목"
                className="h-11 rounded-xl border border-sky-200 bg-white px-3 text-sm text-neutral-800"
              />
              <input
                value={supportContactEmail}
                onChange={(e) => setSupportContactEmail(e.target.value)}
                maxLength={200}
                placeholder="답변받을 이메일"
                className="h-11 rounded-xl border border-sky-200 bg-white px-3 text-sm text-neutral-800"
              />
              <input
                value={supportContactPhone}
                onChange={(e) => setSupportContactPhone(e.target.value)}
                maxLength={30}
                placeholder="연락처 (선택)"
                className="h-11 rounded-xl border border-sky-200 bg-white px-3 text-sm text-neutral-800"
              />
            </div>

            <textarea
              value={supportMessage}
              onChange={(e) => setSupportMessage(e.target.value)}
              rows={5}
              maxLength={4000}
              placeholder="문의 내용을 자세히 적어주세요. 결제/서비스 이용 시각, 상품명, 닉네임, 문제가 발생한 화면 등을 적으면 더 빨리 확인할 수 있습니다."
              className="mt-3 w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-neutral-800"
            />

            {supportError && <p className="mt-3 text-sm text-red-600">{supportError}</p>}
            {supportInfo && <p className="mt-3 text-sm text-emerald-700">{supportInfo}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSubmitSupportInquiry()}
                disabled={supportSubmitting}
                className="min-h-[44px] rounded-xl bg-sky-600 px-4 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
              >
                {supportSubmitting ? "접수 중..." : "문의 접수하기"}
              </button>
              <span className="text-xs text-sky-800">긴급 문의: gymtools.kr@gmail.com / 010-8693-0657</span>
            </div>

            <div className="mt-5">
              <p className="text-sm font-semibold text-sky-900">내 문의 이력</p>
              {supportLoading ? (
                <p className="mt-2 text-sm text-neutral-500">불러오는 중...</p>
              ) : supportItems.length === 0 ? (
                <p className="mt-2 rounded-xl border border-sky-200 bg-white p-4 text-sm text-neutral-500">
                  아직 접수한 문의가 없습니다.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {supportItems.map((item) => (
                    <div key={item.id} className="rounded-xl border border-sky-200 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-neutral-900">{item.subject}</p>
                        <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-800">
                          {SUPPORT_STATUS_LABELS[item.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-neutral-500">
                        {SUPPORT_CATEGORY_LABELS[item.category]} / {new Date(item.created_at).toLocaleString("ko-KR")}
                      </p>
                      <p className="mt-3 whitespace-pre-wrap break-words text-sm text-neutral-700">{item.message}</p>
                      {item.admin_reply && (
                        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                          <p className="text-xs font-semibold text-emerald-800">운영자 답변</p>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-emerald-900">{item.admin_reply}</p>
                          {item.answered_at && (
                            <p className="mt-2 text-[11px] text-emerald-700">
                              답변 시각: {new Date(item.answered_at).toLocaleString("ko-KR")}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </section>
      )}
      </>
      )}

      {showMatchingSection && (
      <>
      <section id="paid-card-received" className={`${matchingFilter === "all" || matchingFilter === "received" ? "" : "hidden"} mb-5 rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-[0_14px_40px_rgba(17,24,39,0.05)]`}>
        <h2 className="text-lg font-bold text-neutral-950 mb-3">내 유료카드 지원자</h2>
        {myPaidCards.length === 0 ? (
          <p className="text-sm text-neutral-500">등록된 유료카드가 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {myPaidCards.map((card) => (
              <div key={card.id} className="rounded-xl border border-neutral-200 bg-[#fbfaf8] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-neutral-900">
                    {card.nickname} / {card.gender === "M" ? "남자" : "여자"}
                  </p>
                  <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                    {card.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  생성일 {new Date(card.created_at).toLocaleDateString("ko-KR")}
                </p>
                {card.status === "approved" && card.expires_at && (
                  <p className="mt-1 text-sm font-medium text-amber-700">
                    노출 종료까지 남은 시간 {formatRemainingToKorean(card.expires_at)}
                  </p>
                )}
                {Array.isArray(card.photo_signed_urls) && card.photo_signed_urls.length > 0 && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {card.photo_signed_urls.map((url, idx) => (
                      <a key={`${card.id}-photo-${idx}`} href={url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={`유료카드 사진 ${idx + 1}`}
                          loading="lazy"
                          decoding="async"
                          className="h-32 w-full object-cover"
                        />
                      </a>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {card.status === "approved" ? (
                    <span className="inline-flex rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-semibold text-rose-700">
                      {card.display_mode === "instant_public" ? "즉시공개" : "36시간 상단고정"}
                    </span>
                  ) : null}
                  {card.status === "pending" || card.status === "approved" ? (
                    <Link
                      href={`/dating/paid?editId=${card.id}`}
                      className="inline-flex h-8 items-center rounded-md border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
                    >
                      내용 수정
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    disabled={deletingPaidCardIds.includes(card.id)}
                    onClick={() => void handleDeleteMyPaidCard(card.id)}
                    className="inline-flex h-8 items-center rounded-md border border-red-300 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {deletingPaidCardIds.includes(card.id) ? "삭제 중..." : "삭제"}
                  </button>
                </div>
              </div>
            ))}
            {receivedPaidApplications.map((app) => {
              const card = myPaidCards.find((c) => c.id === app.card_id);
              return (
                <div key={app.id} className="rounded-xl border border-neutral-200 bg-[#fbfaf8] p-3">
                  <p className="text-sm font-medium text-neutral-900">
                    카드 {card?.nickname ?? app.card_id.slice(0, 8)} / 지원자 {app.applicant_display_nickname ?? "익명"}
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    상태{" "}
                    <span className={`inline-flex rounded-full px-2 py-0.5 ${cardAppStatusColor[app.status] ?? "bg-neutral-100 text-neutral-700"}`}>
                      {cardAppStatusText[app.status] ?? app.status}
                    </span>
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-neutral-600">
                    {app.age != null && <span>나이 {app.age}</span>}
                    {app.height_cm != null && <span>키 {app.height_cm}cm</span>}
                    {app.region && <span>지역 {app.region}</span>}
                    {app.job && <span>직업 {app.job}</span>}
                    {app.training_years != null && <span>운동 {app.training_years}년</span>}
                  </div>
                  {app.intro_text && <p className="mt-2 text-xs text-neutral-700 whitespace-pre-wrap break-words">{app.intro_text}</p>}
                  {Array.isArray(app.photo_signed_urls) && app.photo_signed_urls.length > 0 && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {app.photo_signed_urls.map((url, idx) => (
                        <a key={`${app.id}-${idx}`} href={url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-neutral-200">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`유료 지원자 사진 ${idx + 1}`}
                            loading="lazy"
                            decoding="async"
                            className="h-32 w-full object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  )}
                  {app.status === "accepted" && app.instagram_id && (
                    <InstagramProfileLine label="지원자 인스타" username={app.instagram_id} />
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {app.status === "submitted" && (
                      <>
                      <button
                        type="button"
                        onClick={() => void handlePaidApplicationStatus(app.id, "accepted")}
                        className="h-9 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white"
                      >
                        수락
                      </button>
                      <button
                        type="button"
                        onClick={() => void handlePaidApplicationStatus(app.id, "rejected")}
                        className="h-9 rounded-lg bg-red-600 px-3 text-xs font-medium text-white"
                      >
                        거절
                      </button>
                      </>
                    )}
                    {app.status === "accepted" && (
                      <button
                        type="button"
                        disabled={cancelingPaidAppliedIds.includes(app.id)}
                        onClick={() => void handleCancelReceivedPaidApplication(app.id)}
                        className="h-9 rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                      >
                        {cancelingPaidAppliedIds.includes(app.id) ? "취소 중..." : "매칭 취소"}
                      </button>
                    )}
                    <SmallDatingReportButton
                      disabled={reportingDatingTargetKeys.includes(`paid_card_application:${app.id}`)}
                      onClick={() => void handleDatingUserReport("paid_card_application", app.id, "유료카드 지원자")}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section id="paid-card-applied" className={`${matchingFilter === "all" || matchingFilter === "applied" ? "" : "hidden"} mb-5 rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-[0_14px_40px_rgba(17,24,39,0.05)]`}>
        <h2 className="text-lg font-bold text-neutral-950 mb-3">내 36시간 고정카드 지원 이력</h2>
        {myAppliedPaidApplications.length === 0 ? (
          <p className="text-sm text-neutral-500">아직 지원한 내역이 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {myAppliedPaidApplications.map((app) => (
              <div key={app.id} className="rounded-xl border border-neutral-200 bg-[#fbfaf8] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-neutral-900">
                    {app.card?.nickname ?? "(카드 닉네임 없음)"} /{" "}
                    {app.card?.gender === "M" ? "남자 카드" : app.card?.gender === "F" ? "여자 카드" : "카드"}
                  </p>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      cardAppStatusColor[app.status] ?? "bg-neutral-100 text-neutral-700"
                    }`}
                  >
                    {cardAppStatusText[app.status] ?? app.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  지원일 {new Date(app.created_at).toLocaleString("ko-KR")}
                  {app.card?.owner_nickname ? ` / 카드 작성자 ${app.card.owner_nickname}` : ""}
                </p>
                {app.intro_text && (
                  <p className="mt-2 text-sm text-neutral-700 whitespace-pre-wrap break-words">{app.intro_text}</p>
                )}
                <div className="mt-3">
                  <div className="flex flex-wrap gap-2">
                    {(app.status === "submitted" || app.status === "accepted") && (
                      <button
                        type="button"
                        disabled={cancelingPaidAppliedIds.includes(app.id)}
                        onClick={() => void handleCancelMyAppliedPaidApplication(app.id)}
                        className="h-8 rounded-md border border-amber-300 bg-amber-50 px-3 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                      >
                        {cancelingPaidAppliedIds.includes(app.id) ? "취소 중..." : app.status === "accepted" ? "매칭 취소" : "지원 취소"}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={deletingPaidAppliedIds.includes(app.id)}
                      onClick={() => void handleDeleteMyAppliedPaidApplication(app.id)}
                      className="h-8 rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
                    >
                      {deletingPaidAppliedIds.includes(app.id) ? "삭제 중..." : "지원서 삭제"}
                    </button>
                  </div>
                  {app.status === "accepted" && (
                    <p className="mt-2 text-xs text-neutral-500">수락 후 인스타가 공개된 상태여도 매칭 취소하거나 삭제할 수 있습니다.</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={`${matchingFilter === "all" || matchingFilter === "one_on_one" ? "" : "hidden"} mb-5 rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-[0_14px_40px_rgba(17,24,39,0.05)]`}>
        <h2 className="text-lg font-bold text-neutral-900 mb-3">소개팅 신청 현황</h2>
        {datingApplication ? (
          <div className="space-y-2 text-sm">
            <p className="text-neutral-600">
              신청일 <span className="text-neutral-900">{new Date(datingApplication.created_at).toLocaleString("ko-KR")}</span>
            </p>
            <p className="text-neutral-600">
              상태:{" "}
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${datingStatusColor[datingApplication.status] ?? "bg-neutral-100 text-neutral-700"}`}>
                {datingStatusText[datingApplication.status] ?? datingApplication.status}
              </span>
            </p>
            <p className="text-neutral-600">공개 승인:
              <span className={datingApplication.approved_for_public ? "text-emerald-700 font-medium" : "text-neutral-500"}>
                {datingApplication.approved_for_public ? "승인됨" : "미승인"}
              </span>
            </p>

            <div className="flex flex-wrap gap-2 text-xs text-neutral-600">
              {datingApplication.display_nickname && <span>닉네임: {datingApplication.display_nickname}</span>}
              {datingApplication.age != null && <span>나이: {datingApplication.age}세</span>}
              {datingApplication.training_years != null && <span>운동경력: {datingApplication.training_years}년</span>}
            </div>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">소개팅 신청 내역이 없습니다.</p>
        )}
        <div className="mt-4">
          <Link
            href="/dating/apply"
            className="inline-flex min-h-[42px] items-center rounded-lg bg-neutral-950 px-4 text-sm font-medium text-white hover:bg-neutral-800"
          >
            신청하러 가기
          </Link>
        </div>
      </section>

      <section id="one-on-one-status" className={`${matchingFilter === "all" || matchingFilter === "one_on_one" ? "" : "hidden"} mb-5 rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-[0_14px_40px_rgba(17,24,39,0.05)]`}>
        <h2 className="text-lg font-bold text-neutral-950 mb-3">내 1:1 소개팅 신청 내역</h2>
        <div className="mb-3 rounded-xl border border-neutral-200 bg-[#fbfaf8] px-3 py-3">
          <p className="text-xs font-semibold text-neutral-900">1:1 이용 안내</p>
          <p className="mt-1 text-[11px] leading-5 text-neutral-600">
            쌍방 수락 후 기존 매칭을 포함해 결제가 완료되면 상대 연락처가 바로 공개됩니다. 공개된 번호의 외부 공유, 무단 저장, 불쾌한 연락은 제재 대상입니다.
          </p>
        </div>
        <div className="mb-3 rounded-xl border border-rose-200 bg-white px-3 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-semibold text-rose-900">지인 번호 차단</p>
              <p className="mt-1 text-[11px] leading-5 text-neutral-600">
                아는 사람 번호를 입력하면 1:1 후보에서 서로 보이지 않게 제외됩니다. 입력한 번호는 안전하게 보호돼요.
              </p>
            </div>
            <div className="flex flex-col gap-2 md:min-w-[360px]">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="tel"
                  value={oneOnOneBlockPhoneInput}
                  onChange={(event) => setOneOnOneBlockPhoneInput(event.target.value)}
                  placeholder="01012345678"
                  className="min-h-[38px] flex-1 rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-rose-300"
                />
                <input
                  type="text"
                  value={oneOnOneBlockLabelInput}
                  onChange={(event) => setOneOnOneBlockLabelInput(event.target.value)}
                  placeholder="메모 선택"
                  className="min-h-[38px] flex-1 rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-rose-300"
                />
                <button
                  type="button"
                  onClick={() => void handleAddOneOnOnePhoneBlock()}
                  disabled={oneOnOnePhoneBlockSubmitting}
                  className="inline-flex min-h-[38px] items-center justify-center rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {oneOnOnePhoneBlockSubmitting ? "저장 중..." : "차단"}
                </button>
              </div>
              {myOneOnOnePhoneBlocks.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {myOneOnOnePhoneBlocks.map((block) => {
                    const deleting = deletingOneOnOnePhoneBlockIds.includes(block.id);
                    return (
                      <span
                        key={block.id}
                        className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] text-rose-800"
                      >
                        {block.label ? `${block.label} · ` : ""}끝자리 {block.phone_last4 ?? "----"}
                        <button
                          type="button"
                          disabled={deleting}
                          onClick={() => void handleDeleteOneOnOnePhoneBlock(block.id)}
                          className="font-semibold text-rose-700 disabled:opacity-50"
                        >
                          {deleting ? "삭제 중" : "해제"}
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
        {myOneOnOneCards.length === 0 ? (
          <p className="text-sm text-neutral-500">아직 신청한 내역이 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {myOneOnOneCards.map((item) => {
              const isArchivedOneOnOneCard = item.archived === true;
              const relatedMatches = myOneOnOneMatchesByCardId.get(item.id) ?? [];
              const autoRecommendationGroup = myOneOnOneAutoRecommendationsByCardId.get(item.id) ?? null;
              const autoRecommendations = autoRecommendationGroup?.recommendations ?? [];
              const adminAutoRecommendations = autoRecommendationGroup?.admin_recommendations ?? [];
              const canRefreshAutoRecommendations = autoRecommendationGroup?.can_refresh === true;
              const autoRecommendationRefreshUsed = autoRecommendationGroup?.refresh_used === true;
              const autoRecommendationRefreshLimit = autoRecommendationGroup?.refresh_limit ?? 1;
              const autoRecommendationRefreshRemaining = autoRecommendationGroup?.refresh_remaining ?? (canRefreshAutoRecommendations ? 1 : 0);
              const autoRecommendationNextRefreshAt = autoRecommendationGroup?.next_refresh_at ?? null;
              const refreshingAutoRecommendations = refreshingOneOnOneRecommendationIds.includes(item.id);
              const incomingCandidates = relatedMatches.filter((match) => match.role === "source" && match.state === "proposed");
              const waitingCandidateResponses = relatedMatches.filter(
                (match) => match.role === "source" && match.state === "source_selected"
              );
              const finalAcceptRequests: MyOneOnOneMatch[] = [];
              const candidateDecisionRequests = relatedMatches.filter(
                (match) => match.role === "candidate" && match.state === "source_selected"
              );
              const mutualAcceptedMatches = relatedMatches.filter((match) =>
                match.state === "mutual_accepted" || match.state === "candidate_accepted"
              );
              const closedMatches = relatedMatches.filter((match) =>
                ["source_skipped", "candidate_rejected", "source_declined", "admin_canceled"].includes(match.state)
              );
              const priorityBoostExpiresAtMs = item.plus_expires_at
                ? new Date(item.plus_expires_at).getTime()
                : Number.NaN;
              const priorityBoostActive = Number.isFinite(priorityBoostExpiresAtMs) && priorityBoostExpiresAtMs > Date.now();
              const priorityBoostSubmitting = oneOnOnePrioritySubmittingIds.includes(item.id);
              const canBuyPriorityBoost = ["submitted", "reviewing", "approved"].includes(item.status);
              const priorityBoostDetailOpen = oneOnOnePriorityDetailCardId === item.id;

              return (
                <div key={item.id} className="rounded-xl border border-sky-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-neutral-900">
                      {item.name} / {item.sex === "male" ? "남자" : "여자"} / {item.age ?? "-"}세
                    </p>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        datingStatusColor[item.status] ?? "bg-neutral-100 text-neutral-700"
                      }`}
                    >
                      {isArchivedOneOnOneCard ? "노출 종료" : item.status}
                    </span>
                  </div>
                  {isArchivedOneOnOneCard ? (
                    <p className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs leading-5 text-neutral-600">
                      프로필 노출은 종료됐습니다. 기존 매칭과 번호교환 기록은 아래에서 계속 확인할 수 있어요.
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-neutral-500">
                    신청일 {new Date(item.created_at).toLocaleString("ko-KR")}
                    {item.reviewed_at ? ` / 최근 검토 ${new Date(item.reviewed_at).toLocaleString("ko-KR")}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600">
                    <span>출생연도 {item.birth_year}</span>
                    <span>키 {item.height_cm}cm</span>
                    <span>직업 {item.job}</span>
                    <span>지역 {item.region}</span>
                  </div>
                  {item.intro_text && (
                    <p className="mt-2 text-sm text-neutral-700 whitespace-pre-wrap break-words">{item.intro_text}</p>
                  )}
                  <p className="mt-1 text-xs text-neutral-700">장점: {item.strengths_text}</p>
                  <p className="mt-1 text-xs text-neutral-700">원하는 점: {item.preferred_partner_text}</p>
                  {item.admin_note && (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
                      <p className="text-xs font-medium text-amber-800">운영 메모: {item.admin_note}</p>
                    </div>
                  )}
                  {Array.isArray(item.photo_signed_urls) && item.photo_signed_urls.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {item.photo_signed_urls.map((url, idx) => (
                        <a
                          key={`${item.id}-${idx}`}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="block overflow-hidden rounded-lg border border-neutral-200 bg-white"
                        >
                          <div className="flex h-32 w-full items-center justify-center bg-neutral-50">
                            <img
                              src={url}
                              alt={`1:1 신청 사진 ${idx + 1}`}
                              loading="lazy"
                              decoding="async"
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                        </a>
                      ))}
                    </div>
                  )}

                  {canBuyPriorityBoost && (
                    <div className="relative mt-3 overflow-hidden rounded-xl border border-amber-300 bg-[#fffaf0] p-4 shadow-[0_10px_30px_rgba(161,111,18,0.14)]">
                      <div aria-hidden="true" className="absolute inset-x-10 top-0 h-px bg-amber-200" />
                      <div className="relative flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-bold text-amber-800">PLUS</span>
                            <p className="text-sm font-bold text-neutral-950">1:1 매칭 플러스</p>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-neutral-600">
                            번호교환 무제한 · 후보 새로고침 하루 2회 · 프로필 우선 노출
                          </p>
                          {priorityBoostActive && item.plus_expires_at ? (
                            <p className="mt-1 text-[11px] font-medium text-amber-800">
                              {new Date(item.plus_expires_at).toLocaleString("ko-KR")}까지 이용 가능
                            </p>
                          ) : null}
                        </div>
                        {priorityBoostActive ? (
                          <span className="inline-flex h-8 shrink-0 items-center rounded-full border border-amber-300 bg-white px-3 text-xs font-bold text-amber-800 shadow-sm">
                            플러스 적용 중
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={priorityBoostSubmitting}
                            onClick={() => setOneOnOnePriorityDetailCardId((prev) => (prev === item.id ? null : item.id))}
                            className="h-9 shrink-0 rounded-full bg-[#8a5d0a] px-4 text-xs font-bold text-white shadow-[0_6px_18px_rgba(138,93,10,0.25)] transition hover:bg-[#704a06] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:shadow-none"
                          >
                            {priorityBoostSubmitting ? "결제 준비 중..." : priorityBoostDetailOpen ? "혜택 닫기" : "혜택 보기"}
                          </button>
                        )}
                      </div>
                      {!priorityBoostActive && priorityBoostDetailOpen && (
                        <div className="relative mt-4 border-t border-amber-200 pt-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-bold text-neutral-950">30일 동안 매칭 기회를 넓혀보세요</p>
                              <ul className="mt-2 space-y-2 text-xs leading-5 text-neutral-700">
                                <li><strong className="text-neutral-950">번호교환 무제한</strong> · 쌍방 수락 후 추가 결제 없이</li>
                                <li><strong className="text-neutral-950">후보 새로고침 하루 2회</strong> · 기본보다 한 번 더</li>
                                <li><strong className="text-neutral-950">프로필 우선 노출</strong> · 추천 후보에서 더 잘 보이게</li>
                              </ul>
                              <p className="mt-1 text-[11px] leading-5 text-neutral-500">
                                매칭을 보장하지 않으며 차단·성별·진행 상태 기준은 그대로 적용됩니다.
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-lg font-black text-[#8a5d0a]">70,000원</p>
                              <p className="mt-0.5 text-[11px] text-neutral-500">30일 일시 이용권</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={priorityBoostSubmitting}
                            onClick={() => void handleRequestOneOnOnePriority(item.id)}
                            className="mt-4 h-11 w-full rounded-lg bg-[#8a5d0a] text-sm font-bold text-white shadow-[0_8px_22px_rgba(138,93,10,0.28)] transition hover:bg-[#704a06] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:shadow-none"
                          >
                            {priorityBoostSubmitting ? "결제 준비 중..." : "30일 플러스 시작하기"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {["submitted", "reviewing", "approved"].includes(item.status) && (
                      <div className="mt-3 rounded-xl border border-pink-200 bg-pink-50/50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-pink-900">자동 추천 후보 10명</p>
                            <p className="mt-1 text-xs text-pink-700">
                              내 나이와 지역 기준으로 먼저 추천되는 후보예요. 같은 시군구를 우선 보고, 없으면 같은 시도나 가까운 지역 후보 순으로 보여줘요.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleRefreshOneOnOneRecommendations(item.id)}
                            disabled={!canRefreshAutoRecommendations || refreshingAutoRecommendations}
                            className="inline-flex h-8 shrink-0 items-center rounded-md border border-pink-300 bg-white px-3 text-xs font-medium text-pink-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {refreshingAutoRecommendations
                              ? "새로고침 중..."
                              : canRefreshAutoRecommendations
                                ? `추천 새로고침 · ${autoRecommendationRefreshRemaining}회`
                                : "24시간 이용 완료"}
                          </button>
                        </div>
                        <p className="mt-1 text-xs text-pink-700">
                          이 리스트 외에도 추가 후보를 확인할 수 있어요. 마음에 드는 후보는 여러 명 선택할 수 있고, 선택된 사람마다 수락 요청이 전달됩니다.
                        </p>
                        {autoRecommendationRefreshUsed && (
                          <p className="mt-1 text-xs text-pink-700">
                            {canRefreshAutoRecommendations
                              ? `최근 24시간 기준 ${autoRecommendationRefreshLimit}회 중 ${autoRecommendationRefreshRemaining}회 남았어요.`
                              : autoRecommendationNextRefreshAt
                                ? `다음 새로고침 가능 시각: ${new Date(autoRecommendationNextRefreshAt).toLocaleString("ko-KR")}`
                                : "이 카드는 최근에 추천 새로고침을 사용했어요."}
                          </p>
                        )}
                        {autoRecommendations.length === 0 && adminAutoRecommendations.length === 0 ? (
                        <div className="mt-3 rounded-lg border border-dashed border-pink-200 bg-white p-3 text-sm text-neutral-500">
                          지금 바로 보여줄 자동 추천 후보가 없어요. 이미 진행 중인 매칭이 있거나, 조건에 맞는 후보가 새로 잡히면 여기서 보여드릴게요.
                        </div>
                      ) : (
                        <div className="mt-3 space-y-2">
                          {autoRecommendations.map((card) => {
                            const actionKey = `${item.id}:${card.id}`;
                            const processing = processingOneOnOneAutoKeys.includes(actionKey);
                            return (
                              <div key={`${item.id}-${card.id}`} className="rounded-lg border border-pink-200 bg-white p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-sm font-medium text-neutral-900">
                                    {card.name} / {card.age ?? "-"}세 / {card.region}
                                  </p>
                                  <span className="inline-flex rounded-full bg-pink-100 px-2 py-0.5 text-[11px] font-medium text-pink-700">
                                    자동 추천
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-neutral-600">
                                  {card.height_cm}cm / {card.job}
                                </p>
                                <p className="mt-2 text-xs text-neutral-700 whitespace-pre-wrap break-words">{card.intro_text}</p>
                                <p className="mt-2 text-xs text-neutral-700">장점: {card.strengths_text}</p>
                                <p className="mt-1 text-xs text-neutral-700">원하는 점: {card.preferred_partner_text}</p>
                                {Array.isArray(card.photo_signed_urls) && card.photo_signed_urls.length > 0 && (
                                  <div className="mt-2 grid grid-cols-2 gap-2">
                                    {card.photo_signed_urls.map((url, idx) => (
                                      <a
                                        key={`${item.id}-${card.id}-${idx}`}
                                        href={url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="block overflow-hidden rounded-lg border border-neutral-200 bg-white"
                                      >
                                        <div className="flex h-24 w-full items-center justify-center bg-neutral-50">
                                          <img
                                            src={url}
                                            alt={`자동 추천 후보 사진 ${idx + 1}`}
                                            loading="lazy"
                                            decoding="async"
                                            className="max-h-full max-w-full object-contain"
                                          />
                                        </div>
                                      </a>
                                    ))}
                                  </div>
                                )}
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={processing}
                                    onClick={() => void handleOneOnOneAutoRecommendationSelect(item.id, card.id)}
                                    className="inline-flex h-8 items-center rounded-md bg-pink-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                                  >
                                    {processing ? "처리 중..." : "이 후보 선택"}
                                  </button>
                                  <SmallDatingReportButton
                                    disabled={reportingDatingTargetKeys.includes(`one_on_one_card:${card.id}`)}
                                    onClick={() => void handleDatingUserReport("one_on_one_card", card.id, "1:1 추천 후보")}
                                  />
                                </div>
                              </div>
                            );
                          })}
                          {adminAutoRecommendations.length > 0 && (
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
                              <p className="text-sm font-semibold text-emerald-900">
                                오늘의 추가 후보 {adminAutoRecommendations.length}명
                              </p>
                              <p className="mt-1 text-xs text-emerald-700">
                                기본 추천 10명과 겹치지 않는 나이대 맞춤 후보예요. 매일 자동으로 바뀝니다.
                              </p>
                              <div className="mt-3 space-y-2">
                                {adminAutoRecommendations.map((card) => {
                                  const actionKey = `${item.id}:${card.id}`;
                                  const processing = processingOneOnOneAutoKeys.includes(actionKey);
                                  return (
                                    <div key={`${item.id}-admin-${card.id}`} className="rounded-lg border border-emerald-200 bg-white p-3">
                                      <div className="flex items-center justify-between gap-2">
                                        <p className="text-sm font-medium text-neutral-900">
                                          {card.name} / {card.age ?? "-"}세 / {card.region}
                                        </p>
                                        <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                          추가 후보
                                        </span>
                                      </div>
                                      <p className="mt-1 text-xs text-neutral-600">
                                        {card.height_cm}cm / {card.job}
                                      </p>
                                      <p className="mt-2 text-xs text-neutral-700 whitespace-pre-wrap break-words">{card.intro_text}</p>
                                      <p className="mt-2 text-xs text-neutral-700">장점: {card.strengths_text}</p>
                                      <p className="mt-1 text-xs text-neutral-700">원하는 점: {card.preferred_partner_text}</p>
                                      {Array.isArray(card.photo_signed_urls) && card.photo_signed_urls.length > 0 && (
                                        <div className="mt-2 grid grid-cols-2 gap-2">
                                          {card.photo_signed_urls.map((url, idx) => (
                                            <a
                                              key={`${item.id}-admin-${card.id}-${idx}`}
                                              href={url}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="block overflow-hidden rounded-lg border border-neutral-200 bg-white"
                                            >
                                              <div className="flex h-24 w-full items-center justify-center bg-neutral-50">
                                                <img
                                                  src={url}
                                                  alt={`추가 후보 사진 ${idx + 1}`}
                                                  loading="lazy"
                                                  decoding="async"
                                                  className="max-h-full max-w-full object-contain"
                                                />
                                              </div>
                                            </a>
                                          ))}
                                        </div>
                                      )}
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        <button
                                          type="button"
                                          disabled={processing}
                                          onClick={() => void handleOneOnOneAutoRecommendationSelect(item.id, card.id)}
                                          className="inline-flex h-8 items-center rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                                        >
                                          {processing ? "처리 중..." : "이 후보 선택"}
                                        </button>
                                        <SmallDatingReportButton
                                          disabled={reportingDatingTargetKeys.includes(`one_on_one_card:${card.id}`)}
                                          onClick={() => void handleDatingUserReport("one_on_one_card", card.id, "1:1 추가 후보")}
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {incomingCandidates.length > 0 && (
                    <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/50 p-3">
                      <p className="text-sm font-semibold text-sky-900">추가 후보</p>
                      <p className="mt-1 text-xs text-sky-700">원하는 후보를 여러 명 선택할 수 있고, 선택된 사람마다 수락 요청이 전달됩니다.</p>
                      <div className="mt-3 space-y-2">
                        {incomingCandidates.map((match) => {
                          const processing = processingOneOnOneMatchIds.includes(match.id);
                          const card = match.counterparty_card;
                          if (!card) return null;
                          return (
                            <div key={match.id} className="rounded-lg border border-sky-200 bg-white p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium text-neutral-900">
                                  {card.name} / {card.age ?? "-"}세 / {card.region}
                                </p>
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                    oneOnOneMatchStateColor[match.state]
                                  }`}
                                >
                                  {oneOnOneMatchStateText[match.state]}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-neutral-600">
                                {card.height_cm}cm / {card.job} / {new Date(match.created_at).toLocaleString("ko-KR")}
                              </p>
                              <p className="mt-2 text-xs text-neutral-700 whitespace-pre-wrap break-words">{card.intro_text}</p>
                              {Array.isArray(card.photo_signed_urls) && card.photo_signed_urls.length > 0 && (
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  {card.photo_signed_urls.map((url, idx) => (
                                    <a
                                      key={`${match.id}-${idx}`}
                                      href={url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block overflow-hidden rounded-lg border border-neutral-200 bg-white"
                                    >
                                      <div className="flex h-24 w-full items-center justify-center bg-neutral-50">
                                        <img
                                          src={url}
                                          alt={`후보 사진 ${idx + 1}`}
                                          loading="lazy"
                                          decoding="async"
                                          className="max-h-full max-w-full object-contain"
                                        />
                                      </div>
                                    </a>
                                  ))}
                                </div>
                              )}
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={processing}
                                  onClick={() => void handleOneOnOneMatchAction(match.id, "select_candidate")}
                                  className="inline-flex h-8 items-center rounded-md bg-sky-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                                >
                                  {processing ? "처리 중..." : "이 후보 선택"}
                                </button>
                                <SmallDatingReportButton
                                  disabled={reportingDatingTargetKeys.includes(`one_on_one_match:${match.id}`)}
                                  onClick={() => void handleDatingUserReport("one_on_one_match", match.id, "1:1 후보")}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {candidateDecisionRequests.length > 0 && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                      <p className="text-sm font-semibold text-amber-900">상대가 나를 선택함</p>
                      <p className="mt-1 text-xs text-amber-700">프로필을 확인한 뒤 수락 여부를 결정해주세요.</p>
                      <div className="mt-3 space-y-2">
                        {candidateDecisionRequests.map((match) => {
                          const processing = processingOneOnOneMatchIds.includes(match.id);
                          const card = match.counterparty_card;
                          if (!card) return null;
                          return (
                            <div key={match.id} className="rounded-lg border border-amber-200 bg-white p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium text-neutral-900">
                                  {card.name} / {card.age ?? "-"}세 / {card.region}
                                </p>
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                    oneOnOneMatchStateColor[match.state]
                                  }`}
                                >
                                  {oneOnOneMatchStateText[match.state]}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-neutral-600">
                                {card.height_cm}cm / {card.job} / {new Date(match.created_at).toLocaleString("ko-KR")}
                              </p>
                              <p className="mt-2 text-xs text-neutral-700 whitespace-pre-wrap break-words">{card.intro_text}</p>
                              <p className="mt-2 text-xs text-neutral-700">장점: {card.strengths_text}</p>
                              <p className="mt-1 text-xs text-neutral-700">원하는 점: {card.preferred_partner_text}</p>
                              {Array.isArray(card.photo_signed_urls) && card.photo_signed_urls.length > 0 && (
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  {card.photo_signed_urls.map((url, idx) => (
                                    <a
                                      key={`${match.id}-candidate-${idx}`}
                                      href={url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block overflow-hidden rounded-lg border border-neutral-200 bg-white"
                                    >
                                      <div className="flex h-24 w-full items-center justify-center bg-neutral-50">
                                        <img
                                          src={url}
                                          alt={`선택된 상대 사진 ${idx + 1}`}
                                          loading="lazy"
                                          decoding="async"
                                          className="max-h-full max-w-full object-contain"
                                        />
                                      </div>
                                    </a>
                                  ))}
                                </div>
                              )}
                              <div className="mt-3 flex gap-2">
                                <button
                                  type="button"
                                  disabled={processing}
                                  onClick={() => void handleOneOnOneMatchAction(match.id, "candidate_accept")}
                                  className="inline-flex h-8 items-center rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                                >
                                  {processing ? "처리 중..." : "수락"}
                                </button>
                                <button
                                  type="button"
                                  disabled={processing}
                                  onClick={() => void handleOneOnOneMatchAction(match.id, "candidate_reject")}
                                  className="inline-flex h-8 items-center rounded-md border border-red-300 bg-white px-3 text-xs font-medium text-red-700 disabled:opacity-50"
                                >
                                  거절
                                </button>
                                <SmallDatingReportButton
                                  disabled={reportingDatingTargetKeys.includes(`one_on_one_match:${match.id}`)}
                                  onClick={() => void handleDatingUserReport("one_on_one_match", match.id, "1:1 상대")}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {waitingCandidateResponses.length > 0 && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
                      <p className="text-sm font-semibold text-amber-900">내가 선택한 후보</p>
                      <div className="mt-2 space-y-2">
                        {waitingCandidateResponses.map((match) => {
                          const card = match.counterparty_card;
                          if (!card) return null;
                          return (
                            <div key={match.id} className="rounded-lg border border-amber-200 bg-white p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium text-neutral-900">
                                  {card.name} / {card.age ?? "-"}세 / {card.region}
                                </p>
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${oneOnOneMatchStateColor[match.state]}`}>
                                  {oneOnOneMatchStateText[match.state]}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-neutral-600">상대가 수락하면 바로 카카오페이 번호 교환 단계로 넘어갑니다.</p>
                              <div className="mt-2 flex justify-end">
                                <SmallDatingReportButton
                                  disabled={reportingDatingTargetKeys.includes(`one_on_one_match:${match.id}`)}
                                  onClick={() => void handleDatingUserReport("one_on_one_match", match.id, "1:1 후보")}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {finalAcceptRequests.length > 0 && (
                    <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
                      <p className="text-sm font-semibold text-violet-900">최종 수락 요청</p>
                      <div className="mt-3 space-y-2">
                        {finalAcceptRequests.map((match) => {
                          const processing = processingOneOnOneMatchIds.includes(match.id);
                          const card = match.counterparty_card;
                          if (!card) return null;
                          return (
                            <div key={match.id} className="rounded-lg border border-violet-200 bg-white p-3">
                              <p className="text-sm font-medium text-neutral-900">
                                {card.name}님이 수락했습니다. 당신도 최종 수락할까요?
                              </p>
                              <p className="mt-1 text-xs text-neutral-600">
                                {card.age ?? "-"}세 / {card.region} / {card.job}
                              </p>
                              <div className="mt-3 flex gap-2">
                                <button
                                  type="button"
                                  disabled={processing}
                                  onClick={() => void handleOneOnOneMatchAction(match.id, "source_accept")}
                                  className="inline-flex h-8 items-center rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                                >
                                  {processing ? "처리 중..." : "최종 수락"}
                                </button>
                                <button
                                  type="button"
                                  disabled={processing}
                                  onClick={() => void handleOneOnOneMatchAction(match.id, "source_reject")}
                                  className="inline-flex h-8 items-center rounded-md border border-red-300 bg-white px-3 text-xs font-medium text-red-700 disabled:opacity-50"
                                >
                                  거절
                                </button>
                                <SmallDatingReportButton
                                  disabled={reportingDatingTargetKeys.includes(`one_on_one_match:${match.id}`)}
                                  onClick={() => void handleDatingUserReport("one_on_one_match", match.id, "1:1 상대")}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {mutualAcceptedMatches.length > 0 && (
                    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                      <p className="text-sm font-semibold text-emerald-900">쌍방 수락 완료</p>
                      <div className="mt-2 space-y-2">
                        {mutualAcceptedMatches.map((match) => {
                          const card = match.counterparty_card;
                          if (!card) return null;
                          const contactProcessing = processingOneOnOneContactExchangeIds.includes(match.id);
                          const canCancelMatch = canCancelOneOnOneMatch(match);
                          return (
                            <div key={match.id} className="rounded-lg border border-emerald-200 bg-white p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium text-neutral-900">
                                  {card.name} / {card.age ?? "-"}세 / {card.region}
                                </p>
                                <div className="flex flex-wrap items-center justify-end gap-1">
                                  <span
                                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                      oneOnOneMatchStateColor[match.state]
                                    }`}
                                  >
                                    {oneOnOneMatchStateText[match.state]}
                                  </span>
                                  <span
                                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                      oneOnOneContactExchangeColor[match.contact_exchange_status]
                                    }`}
                                  >
                                    {getOneOnOneContactExchangeBadgeText(match)}
                                  </span>
                                </div>
                              </div>
                              <p className="mt-1 text-xs text-neutral-600">
                                {card.height_cm}cm / {card.job} / {new Date(match.updated_at).toLocaleString("ko-KR")}
                              </p>
                              <div className="mt-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3">
                                {(match.contact_exchange_status === "none" ||
                                  match.contact_exchange_status === "awaiting_applicant_payment" ||
                                  match.contact_exchange_status === "payment_pending_admin") ? (
                                  <>
                                    <p className="text-xs font-semibold text-neutral-900">
                                      {priorityBoostActive ? "플러스 무료 번호교환" : "번호 즉시 교환"}
                                    </p>
                                    <p className="mt-1 text-xs text-neutral-700">
                                      {priorityBoostActive
                                        ? "플러스 적용 중이라 추가 결제 없이 상대 연락처가 바로 공개됩니다."
                                        : "기존 쌍방 매칭도 지금 결제하면 상대 연락처가 바로 교환됩니다."}
                                    </p>
                                    {!priorityBoostActive ? (
                                      <>
                                        <p className="mt-2 text-[11px] text-neutral-500">
                                          현재는 카카오페이 간편결제로 바로 번호 교환이 가능해요.
                                        </p>
                                        <p className="mt-1 text-[11px] text-neutral-500">
                                          다른 방식은 오픈카톡으로 입금해주시면 관리자가 수동으로 승인해드려요. 매칭 ID {match.id}
                                        </p>
                                      </>
                                    ) : null}
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {!priorityBoostActive ? (
                                        <a
                                          href={OPEN_KAKAO_URL}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="inline-flex h-8 items-center rounded-md border border-amber-300 bg-white px-3 text-xs font-medium text-amber-700 hover:bg-amber-50"
                                        >
                                          오픈카톡 문의
                                        </a>
                                      ) : null}
                                      <button
                                        type="button"
                                        disabled={contactProcessing}
                                        onClick={() => void handleRequestOneOnOneContactExchange(match.id)}
                                        className="inline-flex h-8 items-center rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                                      >
                                        {contactProcessing
                                          ? priorityBoostActive ? "교환 중..." : "결제 준비 중..."
                                          : priorityBoostActive ? "무료로 번호교환" : "연락처 교환 진행하기"}
                                      </button>
                                    </div>
                                  </>
                                ) : null}
                                {match.contact_exchange_status === "approved" ? (
                                  <>
                                    <p className="text-xs font-semibold text-neutral-900">번호 교환 완료</p>
                                    <p className="mt-1 text-sm font-semibold text-emerald-700">
                                      {match.counterparty_phone ?? "번호 정보를 불러오는 중입니다."}
                                    </p>
                                    <p className="mt-1 text-[11px] text-neutral-500">
                                      외부 공유, 무단 저장, 불쾌한 연락은 제재 대상입니다.
                                    </p>
                                    <div className="mt-2 flex justify-end">
                                      {canCancelMatch ? (
                                        <button
                                          type="button"
                                          disabled={processingOneOnOneMatchIds.includes(match.id)}
                                          onClick={() => void handleOneOnOneMatchAction(match.id, "cancel_mutual")}
                                          className="inline-flex h-8 items-center rounded-md border border-rose-300 bg-white px-3 text-xs font-medium text-rose-700 disabled:opacity-50"
                                        >
                                          {processingOneOnOneMatchIds.includes(match.id) ? "취소 중..." : "매칭 취소"}
                                        </button>
                                      ) : null}
                                    </div>
                                  </>
                                ) : null}
                              </div>
                              {canCancelMatch && match.contact_exchange_status !== "approved" && (
                                <div className="mt-2 flex justify-end">
                                  <button
                                    type="button"
                                    disabled={processingOneOnOneMatchIds.includes(match.id)}
                                    onClick={() => void handleOneOnOneMatchAction(match.id, "cancel_mutual")}
                                    className="inline-flex h-8 items-center rounded-md border border-rose-300 bg-white px-3 text-xs font-medium text-rose-700 disabled:opacity-50"
                                  >
                                    {processingOneOnOneMatchIds.includes(match.id) ? "취소 중..." : "매칭 취소"}
                                  </button>
                                </div>
                              )}
                              <div className="mt-2 flex justify-end">
                                <SmallDatingReportButton
                                  disabled={reportingDatingTargetKeys.includes(`one_on_one_match:${match.id}`)}
                                  onClick={() => void handleDatingUserReport("one_on_one_match", match.id, "1:1 쌍방 매칭 상대")}
                                />
                              </div>
                              <p className="mt-2 text-xs text-neutral-700 whitespace-pre-wrap break-words">{card.intro_text}</p>
                              <p className="mt-2 text-xs text-neutral-700">장점: {card.strengths_text}</p>
                              <p className="mt-1 text-xs text-neutral-700">원하는 점: {card.preferred_partner_text}</p>
                              {Array.isArray(card.photo_signed_urls) && card.photo_signed_urls.length > 0 && (
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  {card.photo_signed_urls.map((url, idx) => (
                                    <a
                                      key={`${match.id}-mutual-${idx}`}
                                      href={url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block overflow-hidden rounded-lg border border-neutral-200 bg-white"
                                    >
                                      <div className="flex h-24 w-full items-center justify-center bg-neutral-50">
                                        <img
                                          src={url}
                                          alt={`쌍방 수락 완료 상대 사진 ${idx + 1}`}
                                          loading="lazy"
                                          decoding="async"
                                          className="max-h-full max-w-full object-contain"
                                        />
                                      </div>
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {closedMatches.length > 0 && (
                    <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                      <p className="text-sm font-semibold text-neutral-800">지난 매칭 기록</p>
                      <div className="mt-2 space-y-2">
                        {closedMatches.map((match) => {
                          const card = match.counterparty_card;
                          if (!card) return null;
                          return (
                            <div key={match.id} className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2">
                              <p className="text-xs text-neutral-700">
                                {card.name} / {card.age ?? "-"}세 / {card.region}
                              </p>
                              <div className="flex shrink-0 items-center gap-2">
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${oneOnOneMatchStateColor[match.state]}`}>
                                  {oneOnOneMatchStateText[match.state]}
                                </span>
                                <SmallDatingReportButton
                                  disabled={reportingDatingTargetKeys.includes(`one_on_one_match:${match.id}`)}
                                  onClick={() => void handleDatingUserReport("one_on_one_match", match.id, "지난 1:1 매칭 상대")}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex gap-2">
                    <Link
                      href="/dating/1on1"
                      className="inline-flex h-8 items-center rounded-md border border-sky-300 bg-white px-3 text-xs font-medium text-sky-700 hover:bg-sky-50"
                    >
                      1:1 소개팅 페이지
                    </Link>
                    {item.status === "submitted" && !hasOneOnOneUserEditBeenUsed(item) && (
                      <Link
                        href={`/dating/1on1?editId=${item.id}`}
                        className="inline-flex h-8 items-center rounded-md border border-amber-300 bg-white px-3 text-xs font-medium text-amber-700 hover:bg-amber-50"
                      >
                        신청서 수정
                      </Link>
                    )}
                    {!isArchivedOneOnOneCard ? (
                      <button
                        type="button"
                        onClick={() => void handleDeleteMyOneOnOneCard(item.id)}
                        disabled={deletingOneOnOneIds.includes(item.id)}
                        className="inline-flex h-8 items-center rounded-md border border-red-300 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        {deletingOneOnOneIds.includes(item.id) ? "처리 중..." : "프로필 내리기"}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="hidden">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-bold text-rose-900">오픈카드 지인 차단</h2>
            <p className="mt-1 text-xs leading-5 text-neutral-600">
              휴대폰 번호나 인스타 아이디를 입력하면 오픈카드와 빠른매칭에서 서로 보이지 않게 제외돼요.
            </p>
            <p className="mt-1 text-[11px] text-neutral-500">입력값은 원문 그대로 저장하지 않고 안전하게 비교해요.</p>
          </div>
          <div className="flex flex-col gap-2 md:min-w-[430px]">
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={datingContactBlockType}
                onChange={(event) => setDatingContactBlockType(event.target.value === "instagram" ? "instagram" : "phone")}
                className="min-h-[38px] rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-rose-300"
              >
                <option value="phone">휴대폰</option>
                <option value="instagram">인스타</option>
              </select>
              <input
                type={datingContactBlockType === "phone" ? "tel" : "text"}
                value={datingContactBlockValue}
                onChange={(event) => setDatingContactBlockValue(event.target.value)}
                placeholder={datingContactBlockType === "phone" ? "01012345678" : "instagram_id"}
                className="min-h-[38px] flex-1 rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-rose-300"
              />
              <input
                type="text"
                value={datingContactBlockLabel}
                onChange={(event) => setDatingContactBlockLabel(event.target.value)}
                placeholder="메모 선택"
                className="min-h-[38px] flex-1 rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-rose-300"
              />
              <button
                type="button"
                onClick={() => void handleAddDatingContactBlock()}
                disabled={datingContactBlockSubmitting}
                className="inline-flex min-h-[38px] items-center justify-center rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white disabled:opacity-50"
              >
                {datingContactBlockSubmitting ? "저장 중..." : "차단"}
              </button>
            </div>
            {myDatingContactBlocks.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {myDatingContactBlocks.map((block) => {
                  const deleting = deletingDatingContactBlockIds.includes(block.id);
                  return (
                    <span
                      key={block.id}
                      className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] text-rose-800"
                    >
                      {block.label ? `${block.label} · ` : ""}
                      {block.block_type === "phone" ? "휴대폰" : "인스타"} {block.value_hint ?? ""}
                      <button
                        type="button"
                        disabled={deleting}
                        onClick={() => void handleDeleteDatingContactBlock(block.id)}
                        className="font-semibold text-rose-700 disabled:opacity-50"
                      >
                        {deleting ? "삭제 중" : "해제"}
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11px] text-neutral-500">아직 등록한 오픈카드 지인 차단이 없습니다.</p>
            )}
          </div>
        </div>
      </section>

      <section className={`${matchingFilter === "all" ? "" : "hidden"} mb-5 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5`}>
        <h2 className="text-lg font-bold text-emerald-900 mb-2">지원권 현황</h2>
        <p className="text-sm text-emerald-900">
          평일 기본 2장 · 주말 기본 3장 / 추가 지원권 <span className="font-semibold">{applyCreditsRemaining}장</span>
        </p>
      </section>

      <section className={`${matchingFilter === "all" ? "" : "hidden"} mb-5 rounded-2xl border border-neutral-200 bg-white p-5`}>
        <h2 className="text-lg font-bold text-neutral-900 mb-3">내 오픈카드 상태</h2>
        {myDatingCards.length === 0 ? (
          <p className="text-sm text-neutral-500">등록된 오픈카드가 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {myDatingCards.map((card) => {
              const applicantCount = Number(card.applicant_count ?? 0);
              const hasPublishedBefore =
                Boolean(card.published_at) ||
                Boolean(card.expires_at) ||
                Number(card.auto_requeue_count ?? 0) > 0;
              const canShowReopen =
                ["pending", "hidden", "expired"].includes(card.status) &&
                hasPublishedBefore &&
                (!hasActiveOpenCard || card.status === "pending");
              const canReactivate =
                (card.status === "hidden" || card.status === "expired") &&
                !hasActiveOpenCard &&
                hasPublishedBefore;
              const reopening = reopeningOpenCardIds.includes(card.id);
              const reactivating = reactivatingOpenCardIds.includes(card.id);
              return (
              <div key={card.id} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-neutral-900">
                    {card.display_nickname} / {card.sex === "male" ? "남자" : "여자"}
                  </p>
                  <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                    {card.status}
                  </span>
                </div>
                <p className="text-xs text-neutral-500 mt-1">
                  생성일 {new Date(card.created_at).toLocaleDateString("ko-KR")}
                </p>
                <p className="mt-1 text-xs text-neutral-500">받은 지원 {applicantCount.toLocaleString("ko-KR")}개</p>
                {card.status === "public" && card.expires_at && (
                  <p className="text-sm text-amber-700 font-medium mt-1">
                    공개 종료까지 남은 시간 {formatRemainingToKorean(card.expires_at)}
                  </p>
                )}
                {card.status === "public" && (
                  <p className="mt-1 text-xs font-medium text-neutral-500">
                    사진 공개: {card.photo_visibility === "public" ? "블러 없이 공개중" : "블러 처리중"}
                  </p>
                )}
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-neutral-600">
                    {card.status === "pending"
                      ? `대기열에 등록되어 있습니다.${typeof card.queue_position === "number" && card.queue_position > 0 ? ` (현재 ${card.queue_position}번째)` : ""}`
                      : card.status === "public"
                        ? "현재 공개중인 오픈카드입니다."
                        : card.status === "expired"
                          ? "공개 기간이 끝난 오픈카드입니다."
                          : "숨김 처리된 오픈카드입니다."}
                  </p>
                  <div className="flex items-center gap-2">
                    {card.status === "pending" || card.status === "hidden" || card.status === "expired" ? (
                      <Link
                        href={`/dating/card/new?editId=${card.id}`}
                        className="inline-flex h-8 items-center rounded-md border border-pink-300 bg-white px-3 text-xs font-medium text-pink-700 hover:bg-pink-50"
                      >
                        {card.status === "pending" ? "내용 수정" : "내용 확인/수정"}
                      </Link>
                    ) : null}
                    {card.status === "public" ? (
                      <button
                        type="button"
                        disabled={savingOpenCardVisibilityIds.includes(card.id)}
                        onClick={() =>
                          void handleToggleMyOpenCardPhotoVisibility(
                            card.id,
                            card.photo_visibility === "public" ? "blur" : "public"
                          )
                        }
                        className="inline-flex h-8 items-center rounded-md border border-sky-300 bg-white px-3 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                      >
                        {savingOpenCardVisibilityIds.includes(card.id)
                          ? "변경 중..."
                          : card.photo_visibility === "public"
                            ? "사진 블러 처리"
                            : "사진 원본 공개"}
                      </button>
                    ) : null}
                    {canShowReopen ? (
                      <button
                        type="button"
                        disabled={reopening}
                        onClick={() => void handleReopenMyOpenCard(card)}
                        className="inline-flex h-8 items-center rounded-md border border-emerald-300 bg-white px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        {reopening ? "결제 준비 중..." : "5,000원 대기없이 다시 노출"}
                      </button>
                    ) : null}
                    {canReactivate ? (
                      <button
                        type="button"
                        disabled={reactivating}
                        onClick={() => void handleReactivateMyOpenCard(card)}
                        className="inline-flex h-8 items-center rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                      >
                        {reactivating ? "등록 중..." : "대기열에 다시 등록"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={deletingOpenCardIds.includes(card.id)}
                      onClick={() => void handleDeleteMyOpenCard(card.id)}
                      className="inline-flex h-8 items-center rounded-md border border-red-300 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      {deletingOpenCardIds.includes(card.id) ? "삭제 중..." : "삭제"}
                    </button>
                  </div>
                </div>
                {canShowReopen ? (
                  <p className="mt-2 rounded-lg border border-emerald-100 bg-white px-3 py-2 text-[11px] leading-5 text-emerald-800">
                    대기 없이 24시간 다시 노출할 수 있어요.
                  </p>
                ) : null}
                {canReactivate ? (
                  <p className="mt-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[11px] leading-5 text-neutral-600">
                    기존 내용을 그대로 다시 대기열에 올릴 수 있어요. 공개 기간이 끝나면 다시 대기열로 돌아갑니다.
                  </p>
                ) : null}
              </div>
            )})}
          </div>
        )}
        {hasActiveOpenCard && (
          <p className="mb-2 text-xs text-amber-700">오픈카드는 1개만 유지할 수 있습니다. 기존 카드(대기중/공개중) 처리 후 새로 작성할 수 있습니다.</p>
        )}
        <div className="mt-4 flex gap-2">
          {openCardWriteEnabled && !hasActiveOpenCard ? (
            <Link
              href="/dating/card/new"
              className="inline-flex min-h-[42px] items-center rounded-lg bg-pink-500 px-4 text-sm font-medium text-white hover:bg-pink-600"
            >
              오픈카드 작성하기
            </Link>
          ) : (
            <span className="inline-flex min-h-[42px] items-center rounded-lg bg-neutral-300 px-4 text-sm font-medium text-neutral-700">
              {openCardWriteEnabled ? "오픈카드 1개 제한" : "오픈카드 작성 일시중단"}
            </span>
          )}
          <Link
            href="/community/dating/cards"
            className="inline-flex min-h-[42px] items-center rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            오픈카드 보러가기
          </Link>
        </div>
      </section>

      <section id="open-card-received" className={`${matchingFilter === "all" || matchingFilter === "received" ? "" : "hidden"} mb-5 rounded-2xl border border-neutral-200 bg-white p-5`}>
        <h2 className="text-lg font-bold text-neutral-900 mb-3">내 카드 지원자</h2>
        {receivedApplications.length === 0 ? (
          <p className="text-sm text-neutral-500">아직 받은 지원서가 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {receivedApplications.map((app) => {
              const card = myCardsById.get(app.card_id);
              return (
                <div key={app.id} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-neutral-900">
                      카드 {card?.sex === "male" ? "남자" : card?.sex === "female" ? "여자" : ""} / 지원일{" "}
                      {new Date(app.created_at).toLocaleDateString("ko-KR")}
                    </div>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        cardAppStatusColor[app.status] ?? "bg-neutral-100 text-neutral-700"
                      }`}
                    >
                      {cardAppStatusText[app.status] ?? app.status}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600">
                    {app.applicant_display_nickname && <span>닉네임: {app.applicant_display_nickname}</span>}
                    {app.age != null && <span>나이 {app.age}</span>}
                    {app.height_cm != null && <span>키 {app.height_cm}cm</span>}
                    {app.region && <span>지역 {app.region}</span>}
                    {app.job && <span>직업 {app.job}</span>}
                    {app.training_years != null && <span>운동 {app.training_years}년</span>}
                  </div>

                  {app.intro_text && (
                    <p className="mt-2 text-sm text-neutral-700 whitespace-pre-wrap break-words">{app.intro_text}</p>
                  )}

                  {Array.isArray(app.photo_signed_urls) && app.photo_signed_urls.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {app.photo_signed_urls.map((url, idx) => (
                        <a
                          key={`${app.id}-${idx}`}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="block overflow-hidden rounded-lg border border-neutral-200 bg-white"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`지원자 사진 ${idx + 1}`}
                            loading="lazy"
                            decoding="async"
                            className="h-32 w-full object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  )}

                  {app.status === "accepted" && app.instagram_id && (
                    <InstagramProfileLine label="지원자 인스타" username={app.instagram_id} />
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {app.status === "submitted" && (
                      <>
                      <button
                        type="button"
                        onClick={() => void handleCardApplicationStatus(app.id, "accepted")}
                        className="h-9 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white"
                      >
                        수락
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCardApplicationStatus(app.id, "rejected")}
                        className="h-9 rounded-lg bg-red-600 px-3 text-xs font-medium text-white"
                      >
                        거절
                      </button>
                      </>
                    )}
                    <SmallDatingReportButton
                      disabled={reportingDatingTargetKeys.includes(`open_card_application:${app.id}`)}
                      onClick={() => void handleDatingUserReport("open_card_application", app.id, "오픈카드 지원자")}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section id="open-card-applied" className={`${matchingFilter === "all" || matchingFilter === "applied" ? "" : "hidden"} mb-5 rounded-2xl border border-neutral-200 bg-white p-5`}>
        <h2 className="text-lg font-bold text-neutral-900 mb-3">내 오픈카드 지원 이력</h2>
        {myAppliedCardApplications.length === 0 ? (
          <p className="text-sm text-neutral-500">아직 지원한 내역이 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {myAppliedCardApplications.map((app) => (
              <div key={app.id} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-neutral-900">
                    {app.card?.display_nickname ?? "(카드 닉네임 없음)"} /{" "}
                    {app.card?.sex === "male" ? "남자 카드" : app.card?.sex === "female" ? "여자 카드" : "카드"}
                  </p>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      cardAppStatusColor[app.status] ?? "bg-neutral-100 text-neutral-700"
                    }`}
                  >
                    {cardAppStatusText[app.status] ?? app.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  지원일 {new Date(app.created_at).toLocaleString("ko-KR")}
                  {app.card?.owner_nickname ? ` / 카드 작성자 ${app.card.owner_nickname}` : ""}
                </p>
                {app.status === "accepted" && app.card && (
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3">
                    <p className="text-xs font-semibold text-emerald-700">수락된 상대 오픈카드</p>
                    {Array.isArray(app.card.photo_signed_urls) && app.card.photo_signed_urls.length > 0 && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {app.card.photo_signed_urls.map((url, idx) => (
                          <a
                            key={`${app.id}-matched-card-photo-${idx}`}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="block overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={`수락된 상대 오픈카드 사진 ${idx + 1}`}
                              loading="lazy"
                              decoding="async"
                              className="aspect-[4/5] w-full object-cover"
                            />
                          </a>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-600">
                      {app.card.age != null && <span>나이 {app.card.age}</span>}
                      {app.card.height_cm != null && <span>키 {app.card.height_cm}cm</span>}
                      {app.card.region && <span>{app.card.region}</span>}
                      {app.card.job && <span>{app.card.job}</span>}
                      {app.card.training_years != null && <span>운동 {app.card.training_years}년</span>}
                    </div>
                    {app.card.ideal_type && <p className="mt-2 text-sm text-neutral-700">이상형: {app.card.ideal_type}</p>}
                    {app.card.strengths_text && (
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-700">자기소개/장점: {app.card.strengths_text}</p>
                    )}
                    {app.card.intro_text && (
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-700">소개글: {app.card.intro_text}</p>
                    )}
                  </div>
                )}
                {app.intro_text && (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-neutral-700">내 지원 소개: {app.intro_text}</p>
                )}
                <div className="mt-3">
                  <div className="flex flex-wrap gap-2">
                    {(app.status === "submitted" || app.status === "accepted") && (
                      <button
                        type="button"
                        disabled={cancelingAppliedIds.includes(app.id)}
                        onClick={() => void handleCancelMyAppliedCardApplication(app.id)}
                        className="h-8 rounded-md border border-amber-300 bg-amber-50 px-3 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                      >
                        {cancelingAppliedIds.includes(app.id) ? "취소 중..." : "지원 취소"}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={deletingAppliedIds.includes(app.id)}
                      onClick={() => void handleDeleteMyAppliedCardApplication(app.id)}
                      className="h-8 rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
                    >
                      {deletingAppliedIds.includes(app.id) ? "삭제 중..." : "지원서 삭제"}
                    </button>
                  </div>
                  {app.status === "accepted" && (
                    <p className="mt-2 text-xs text-neutral-500">수락 후 인스타가 공개된 상태여도 취소하거나 삭제할 수 있습니다.</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section id="dating-connections" className={`${matchingFilter === "all" ? "" : "hidden"} mb-5 rounded-2xl border border-neutral-200 bg-white p-5`}>
        <h2 className="text-lg font-bold text-neutral-900 mb-3">매칭 인스타 교환</h2>
        {datingConnections.length === 0 ? (
          <p className="text-sm text-neutral-500">아직 수락된 연결이 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {datingConnections.map((item) => (
              <div key={`${item.source ?? "open"}:${item.application_id}`} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-sm font-medium text-neutral-900">{item.other_nickname}</p>
                <p className="text-xs text-neutral-500 mt-1">
                  연결일 {new Date(item.created_at).toLocaleDateString("ko-KR")}
                </p>
                <p className="mt-1 text-xs font-medium text-neutral-600">
                  {item.role === "swipe_match" ? "연결 방식: 서로 라이크 자동 매칭" : "연결 방식: 지원서 수락 매칭"}
                </p>
                {item.my_instagram_id && (
                  <p className="text-sm text-neutral-700 mt-2">내 인스타: @{item.my_instagram_id}</p>
                )}
                {item.other_instagram_id && (
                  <InstagramProfileLine
                    label="상대 인스타"
                    username={item.other_instagram_id}
                    className="mt-1 text-sm font-medium text-emerald-700"
                  />
                )}
                {item.matched_card && (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-white p-3">
                    <p className="text-xs font-semibold text-emerald-700">
                      {item.role === "owner" ? "수락한 지원자 정보" : "매칭된 상대 오픈카드"}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-neutral-900">
                      {item.matched_card.display_nickname || item.other_nickname}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600">
                      <span>{item.matched_card.sex === "male" ? "남자" : item.matched_card.sex === "female" ? "여자" : "성별 미기재"}</span>
                      {item.matched_card.age != null && <span>나이 {item.matched_card.age}</span>}
                      {item.matched_card.height_cm != null && <span>키 {item.matched_card.height_cm}cm</span>}
                      {item.matched_card.region && <span>지역 {item.matched_card.region}</span>}
                      {item.matched_card.job && <span>직업 {item.matched_card.job}</span>}
                      {item.matched_card.training_years != null && <span>운동 {item.matched_card.training_years}년</span>}
                    </div>
                    {item.matched_card.ideal_type && (
                      <p className="mt-2 text-sm text-neutral-700 break-words">이상형: {item.matched_card.ideal_type}</p>
                    )}
                    {item.matched_card.strengths_text && (
                      <p className="mt-1 text-sm text-neutral-700 whitespace-pre-wrap break-words">
                        자기소개/장점: {item.matched_card.strengths_text}
                      </p>
                    )}
                    {item.matched_card.intro_text && (
                      <p className="mt-1 text-sm text-neutral-700 whitespace-pre-wrap break-words">
                        소개글: {item.matched_card.intro_text}
                      </p>
                    )}
                  </div>
                )}
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    disabled={deletingConnectionIds.includes(`${item.source ?? "open"}:${item.application_id}`)}
                    onClick={() => void handleDeleteDatingConnection(item)}
                    className="h-8 rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
                  >
                    {deletingConnectionIds.includes(`${item.source ?? "open"}:${item.application_id}`)
                      ? "삭제 중..."
                      : "연결 삭제"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      </>
      )}

      {showAdminSection && (
        <section className="mb-5 rounded-2xl border border-violet-200 bg-violet-50/40 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-violet-900">
              {adminManageTab === "mail_center"
                ? "회원 메일 발송 (관리자)"
                : adminManageTab === "one_on_one_contact"
                  ? "1:1 번호 공개 관리 (관리자)"
                : adminManageTab === "reels_dating"
                  ? "릴스 매물 지원 (관리자)"
                  : adminManageTab === "payment_center"
                    ? "결제 운영 (관리자)"
                    : adminManageTab === "tools_patch_note"
                      ? "도구 패치노트 (관리자)"
                    : adminManageTab === "accepted_applications"
                      ? "최근 수락 지원 (관리자)"
                    : "오픈카드 전체 내용 (관리자)"}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/admin/unlock?next=${encodeURIComponent("/mypage")}`}
                className="inline-flex h-8 items-center rounded-md border border-violet-300 bg-white px-3 text-xs font-semibold text-violet-900 hover:bg-violet-100"
              >
                관리자 잠금 해제
              </Link>
              <button
                type="button"
                disabled={
                  adminManageTab === "payment_center"
                    ? adminPaymentCenterLoading
                    :
                  adminManageTab === "reels_dating"
                    ? adminReelsDatingLoading || adminReelsDatingSaving
                    :
                  adminManageTab === "mail_center"
                    ? adminOpenCardOutreachLoading
                    :
                  adminManageTab === "open_cards"
                    ? adminOpenCardsLoading
                    : adminManageTab === "tools_patch_note"
                    ? toolsPatchNoteSaving
                    : adminManageTab === "accepted_applications"
                    ? adminAcceptedRecentLoading
                    : adminManageTab === "one_on_one_contact"
                      ? adminOneOnOneContactLoading
                      : adminQueueRefreshing
                }
                onClick={() =>
                  void (adminManageTab === "payment_center"
                    ? refreshAdminPaymentCenter(true)
                    : adminManageTab === "reels_dating"
                    ? refreshAdminReelsDatingData(true)
                    : adminManageTab === "mail_center"
                    ? loadAdminOpenCardOutreachPreview()
                    : adminManageTab === "open_cards"
                    ? refreshAdminOpenCardData(true)
                    : adminManageTab === "tools_patch_note"
                    ? handleAdminSaveToolsPatchNote()
                    : adminManageTab === "accepted_applications"
                    ? refreshAdminAcceptedRecentApplications(true)
                    : adminManageTab === "one_on_one_contact"
                      ? refreshAdminOneOnOneContactData(true)
                      : refreshAdminQueueData(true))
                }
                className="h-8 rounded-md border border-violet-200 bg-white px-3 text-xs font-medium text-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {adminManageTab === "open_cards"
                  ? adminOpenCardsLoading
                    ? "불러오는 중..."
                    : "오픈카드 새로고침"
                  : adminManageTab === "accepted_applications"
                    ? adminAcceptedRecentLoading
                      ? "불러오는 중..."
                      : "최근 수락 새로고침"
                  : adminManageTab === "tools_patch_note"
                    ? toolsPatchNoteSaving
                      ? "저장 중..."
                      : "패치노트 저장"
                  : adminManageTab === "reels_dating"
                    ? adminReelsDatingLoading || adminReelsDatingSaving
                      ? "처리 중..."
                      : "릴스 매물 새로고침"
                  : adminManageTab === "payment_center"
                    ? adminPaymentCenterLoading
                      ? "불러오는 중..."
                      : "결제센터 새로고침"
                  : adminManageTab === "one_on_one_contact"
                    ? adminOneOnOneContactLoading
                      ? "불러오는 중..."
                      : "번호 공개 새로고침"
                  : adminManageTab === "mail_center"
                    ? adminOpenCardOutreachLoading
                      ? "불러오는 중..."
                      : "메일 대상 새로고침"
                  : adminQueueRefreshing
                    ? "새로고침 중..."
                    : "신청목록 새로고침"}
              </button>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAdminManageTab("site_dashboard")}
              className={`h-8 rounded-md border px-3 text-xs font-medium ${
                adminManageTab === "site_dashboard" ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-800"
              }`}
            >
              운영 현황
            </button>
            <button
              type="button"
              onClick={() => setAdminManageTab("payment_center")}
              className={`h-8 rounded-md border px-3 text-xs font-medium ${
                adminManageTab === "payment_center" ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-800"
              }`}
            >
              결제센터
            </button>
            <button
              type="button"
              onClick={() => setAdminManageTab("dating_stats")}
              className={`h-8 rounded-md border px-3 text-xs font-medium ${
                adminManageTab === "dating_stats" ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-800"
              }`}
            >
              소개팅 통계
            </button>
            <button
              type="button"
              onClick={() => setAdminManageTab("dating_insights")}
              className={`h-8 rounded-md border px-3 text-xs font-medium ${
                adminManageTab === "dating_insights"
                  ? "border-violet-600 bg-violet-600 text-white"
                  : "border-violet-200 bg-white text-violet-800"
              }`}
            >
              이상형 인사이트
            </button>
            <button
              type="button"
              onClick={() => setAdminManageTab("open_cards")}
              className={`h-8 rounded-md border px-3 text-xs font-medium ${
                adminManageTab === "open_cards" ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-800"
              }`}
            >
              오픈카드
            </button>
            <button
              type="button"
              onClick={() => setAdminManageTab("reels_dating")}
              className={`h-8 rounded-md border px-3 text-xs font-medium ${
                adminManageTab === "reels_dating" ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-800"
              }`}
            >
              릴스 매물
            </button>
            <button
              type="button"
              onClick={() => setAdminManageTab("tools_patch_note")}
              className={`h-8 rounded-md border px-3 text-xs font-medium ${
                adminManageTab === "tools_patch_note" ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-800"
              }`}
            >
              도구 패치노트
            </button>
            <button
              type="button"
              onClick={() => setAdminManageTab("site_mascot")}
              className={`h-8 rounded-md border px-3 text-xs font-medium ${
                adminManageTab === "site_mascot" ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-800"
              }`}
            >
              짐냥이
            </button>
            <button
              type="button"
              onClick={() => setAdminManageTab("accepted_applications")}
              className={`h-8 rounded-md border px-3 text-xs font-medium ${
                adminManageTab === "accepted_applications"
                  ? "border-violet-600 bg-violet-600 text-white"
                  : "border-violet-200 bg-white text-violet-800"
              }`}
            >
              최근 수락
            </button>
            <button
              type="button"
              onClick={() => setAdminManageTab("card_ai_review")}
              className={`h-8 rounded-md border px-3 text-xs font-medium ${
                adminManageTab === "card_ai_review"
                  ? "border-violet-600 bg-violet-600 text-white"
                  : "border-violet-200 bg-white text-violet-800"
              }`}
            >
              AI 카드 검수
            </button>
            <button
              type="button"
              onClick={() => setAdminManageTab("mail_center")}
              className={`h-8 rounded-md border px-3 text-xs font-medium ${
                adminManageTab === "mail_center" ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-800"
              }`}
            >
              메일
            </button>
            <button
              type="button"
              onClick={() => setAdminManageTab("user_activity")}
              className={`h-8 rounded-md border px-3 text-xs font-medium ${
                adminManageTab === "user_activity" ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-800"
              }`}
            >
              회원 관리
            </button>
            <button
              type="button"
              onClick={() => setAdminManageTab("one_on_one_contact")}
              className={`h-8 rounded-md border px-3 text-xs font-medium ${
                adminManageTab === "one_on_one_contact"
                  ? "border-violet-600 bg-violet-600 text-white"
                  : "border-violet-200 bg-white text-violet-800"
              }`}
            >
              1:1 번호 공개
            </button>
              <button
                type="button"
                onClick={() => setAdminManageTab("apply_credits")}
                className={`h-8 rounded-md border px-3 text-xs font-medium ${
                  adminManageTab === "apply_credits" ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-800"
                }`}
              >
                지원권 주문
              </button>
              <button
                type="button"
                onClick={() => setAdminManageTab("swipe_subscriptions")}
                className={`h-8 rounded-md border px-3 text-xs font-medium ${
                  adminManageTab === "swipe_subscriptions"
                    ? "border-violet-600 bg-violet-600 text-white"
                    : "border-violet-200 bg-white text-violet-800"
                }`}
              >
                빠른매칭 구독
              </button>
              <button
                type="button"
                onClick={() => setAdminManageTab("more_view")}
                className={`h-8 rounded-md border px-3 text-xs font-medium ${
                  adminManageTab === "more_view" ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-800"
              }`}
            >
              이상형 더보기
            </button>
            <button
              type="button"
              onClick={() => setAdminManageTab("city_view")}
              className={`h-8 rounded-md border px-3 text-xs font-medium ${
                adminManageTab === "city_view" ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-800"
              }`}
            >
              가까운 이상형
            </button>
            <button
              type="button"
              onClick={() => setAdminManageTab("community")}
              className={`h-8 rounded-md border px-3 text-xs font-medium ${
                adminManageTab === "community" ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-800"
              }`}
            >
              커뮤니티 신고
            </button>
              <button
                type="button"
                onClick={() => setAdminManageTab("phone_verify")}
                className={`h-8 rounded-md border px-3 text-xs font-medium ${
                  adminManageTab === "phone_verify" ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-800"
                }`}
              >
                전화 인증
              </button>
              <button
                type="button"
                onClick={() => setAdminManageTab("account_deletions")}
                className={`h-8 rounded-md border px-3 text-xs font-medium ${
                  adminManageTab === "account_deletions"
                    ? "border-violet-600 bg-violet-600 text-white"
                    : "border-violet-200 bg-white text-violet-800"
                }`}
              >
                탈퇴 기록
              </button>
              <button
                type="button"
                onClick={() => setAdminManageTab("site_ads")}
                className={`h-8 rounded-md border px-3 text-xs font-medium ${
                  adminManageTab === "site_ads" ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-800"
              }`}
            >
              광고 문의
            </button>
          </div>

          {adminManageTab === "site_dashboard" && (
          <div className="mb-3 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-violet-200 bg-white p-4">
              <div>
                <p className="text-sm font-semibold text-violet-900">사이트 운영 현황</p>
                <p className="mt-1 text-xs text-neutral-500">
                  {adminSiteDashboard?.generatedAt
                    ? `기준 시각 ${new Date(adminSiteDashboard.generatedAt).toLocaleString("ko-KR")}`
                    : "오늘과 최근 7일 기준으로 핵심 지표를 정리합니다."}
                </p>
                {adminSiteDashboard?.note ? (
                  <p className="mt-2 text-[11px] text-violet-700">{adminSiteDashboard.note}</p>
                ) : null}
              </div>
              <button
                type="button"
                disabled={adminSiteDashboardLoading}
                onClick={() => void refreshAdminSiteDashboard(true)}
                className="h-8 rounded-md border border-violet-200 bg-white px-3 text-xs font-medium text-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {adminSiteDashboardLoading ? "불러오는 중..." : "운영 현황 새로고침"}
              </button>
            </div>

            {adminSiteDashboard ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">Open Card Queue</p>
                  <p className="mt-2 text-sm font-semibold text-neutral-800">현재 오픈카드 대기</p>
                  <p className="mt-2 text-3xl font-black text-amber-600">
                    {adminSiteDashboard.current.pendingOpenCards.toLocaleString("ko-KR")}명
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    남 {adminSiteDashboard.current.pendingOpenCardsMale.toLocaleString("ko-KR")} · 여{" "}
                    {adminSiteDashboard.current.pendingOpenCardsFemale.toLocaleString("ko-KR")}
                  </p>
                </div>
                <div className="rounded-2xl border border-violet-200 bg-white p-4">
                  <p className="text-xs font-medium text-neutral-500">공개중 오픈카드</p>
                  <p className="mt-2 text-2xl font-black text-neutral-900">
                    {adminSiteDashboard.current.publicOpenCards.toLocaleString("ko-KR")}명
                  </p>
                </div>
                <div className="rounded-2xl border border-violet-200 bg-white p-4">
                  <p className="text-xs font-medium text-neutral-500">오늘 오픈카드 등록</p>
                  <p className="mt-2 text-2xl font-black text-neutral-900">
                    {adminSiteDashboard.today.open_card_created.toLocaleString("ko-KR")}건
                  </p>
                </div>
              </div>
            ) : null}

            {adminSiteDashboardError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                {adminSiteDashboardError}
              </div>
            ) : null}

            {adminSiteDashboardLoading && !adminSiteDashboard ? (
              <div className="rounded-2xl border border-violet-200 bg-white p-6 text-sm text-neutral-500">
                운영 현황을 불러오는 중입니다.
              </div>
            ) : null}

            {adminSiteDashboard ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    { label: "전체 가입자", value: adminSiteDashboard.current.totalUsers },
                    { label: "관리자 계정", value: adminSiteDashboard.current.adminUsers },
                    { label: "휴대폰 인증 완료", value: adminSiteDashboard.current.phoneVerifiedUsers },
                    { label: "빠른매칭 노출 ON", value: adminSiteDashboard.current.swipeVisibleUsers },
                  ].map((item) => (
                    <div key={`site-dashboard-members-${item.label}`} className="rounded-2xl border border-violet-200 bg-white p-4">
                      <p className="text-xs font-medium text-neutral-500">{item.label}</p>
                      <p className="mt-2 text-2xl font-black text-neutral-900">{item.value.toLocaleString("ko-KR")}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {[
                    { key: "new_users", label: "오늘 신규 가입" },
                    { key: "open_card_created", label: "오늘 오픈카드 등록" },
                    { key: "open_card_applied", label: "오늘 오픈카드 지원" },
                    { key: "one_on_one_created", label: "오늘 1:1 신청" },
                    { key: "support_inquiries", label: "오늘 1:1 문의" },
                    { key: "swipe_likes", label: "오늘 빠른매칭 라이크" },
                  ].map((item) => (
                    <div key={`site-dashboard-today-${item.key}`} className="rounded-2xl border border-violet-200 bg-white p-4">
                      <p className="text-xs font-medium text-neutral-500">{item.label}</p>
                      <p className="mt-2 text-2xl font-black text-neutral-900">
                        {adminSiteDashboard.today[item.key as AdminSiteDashboardFeatureKey].toLocaleString("ko-KR")}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-2xl border border-violet-200 bg-white p-4">
                    <p className="text-sm font-semibold text-violet-900">오늘 많이 쓰인 기능</p>
                    <div className="mt-3 space-y-2">
                      {adminSiteDashboard.todayTopFeatures.map((item, index) => (
                        <div
                          key={`site-dashboard-top-${item.key}`}
                          className="flex items-center justify-between rounded-xl border border-violet-100 bg-violet-50/50 px-3 py-2"
                        >
                          <p className="text-sm text-neutral-800">
                            {index + 1}. {item.label}
                          </p>
                          <p className="text-sm font-bold text-violet-700">{item.count.toLocaleString("ko-KR")}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                    <div className="rounded-2xl border border-violet-200 bg-white p-4">
                      <p className="text-sm font-semibold text-violet-900">현재 운영 상태</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {[
                          { label: "공개중 오픈카드", value: adminSiteDashboard.current.publicOpenCards },
                          { label: "대기중 오픈카드", value: adminSiteDashboard.current.pendingOpenCards },
                          { label: "대기 남성 카드", value: adminSiteDashboard.current.pendingOpenCardsMale },
                          { label: "대기 여성 카드", value: adminSiteDashboard.current.pendingOpenCardsFemale },
                          { label: "누적 오픈카드 지원", value: adminSiteDashboard.current.totalOpenCardApplications },
                          { label: "공개중 유료카드", value: adminSiteDashboard.current.publicPaidCards },
                          { label: "누적 유료카드 지원", value: adminSiteDashboard.current.totalPaidCardApplications },
                          { label: "승인된 1:1 카드", value: adminSiteDashboard.current.approvedOneOnOneCards },
                          { label: "대기중 1:1 신청", value: adminSiteDashboard.current.pendingOneOnOneCards },
                          { label: "활성 이상형 더보기", value: adminSiteDashboard.current.activeMoreView },
                          { label: "활성 가까운 이상형", value: adminSiteDashboard.current.activeCityView },
                          { label: "미답변 문의", value: adminSiteDashboard.current.openSupport },
                          { label: "대기중 인증", value: adminSiteDashboard.current.pendingCertRequests },
                          { label: "누적 오픈카드 매칭", value: adminSiteDashboard.current.totalOpenCardMatches },
                          { label: "누적 빠른매칭 매치", value: adminSiteDashboard.current.totalSwipeMatches },
                          { label: "전체 누적 매칭", value: adminSiteDashboard.current.totalDatingMatches },
                          { label: "오늘 답변한 문의", value: adminSiteDashboard.current.todayAnsweredSupport },
                        ].map((item) => (
                        <div key={`site-dashboard-current-${item.label}`} className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
                          <p className="text-[11px] text-neutral-500">{item.label}</p>
                          <p className="mt-1 text-lg font-bold text-neutral-900">{item.value.toLocaleString("ko-KR")}</p>
                        </div>
                      ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="rounded-2xl border border-violet-200 bg-white p-4">
                      <p className="text-sm font-semibold text-violet-900">승인/결제 운영</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {[
                          { label: "지원권 주문 대기", value: adminSiteDashboard.current.pendingApplyCreditOrders },
                          { label: "지원권 주문 완료", value: adminSiteDashboard.current.approvedApplyCreditOrders },
                          { label: "라이크 구매 대기", value: adminSiteDashboard.current.pendingSwipeSubscriptions },
                          { label: "라이크 이용 활성", value: adminSiteDashboard.current.activeSwipeSubscriptions },
                          { label: "인증 대기", value: adminSiteDashboard.current.pendingCertRequests },
                          { label: "인증 승인 완료", value: adminSiteDashboard.current.approvedCertRequests },
                        ].map((item) => (
                          <div key={`site-dashboard-ops-${item.label}`} className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
                            <p className="text-[11px] text-neutral-500">{item.label}</p>
                            <p className="mt-1 text-lg font-bold text-neutral-900">{item.value.toLocaleString("ko-KR")}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-violet-200 bg-white p-4">
                      <p className="text-sm font-semibold text-violet-900">문의/응대 상태</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {[
                          { label: "누적 문의", value: adminSiteDashboard.current.totalSupportInquiries },
                          { label: "답변 완료 누적", value: adminSiteDashboard.current.answeredSupportTotal },
                          { label: "미답변 문의", value: adminSiteDashboard.current.openSupport },
                          { label: "오늘 답변 완료", value: adminSiteDashboard.current.todayAnsweredSupport },
                        ].map((item) => (
                          <div key={`site-dashboard-support-${item.label}`} className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
                            <p className="text-[11px] text-neutral-500">{item.label}</p>
                            <p className="mt-1 text-lg font-bold text-neutral-900">{item.value.toLocaleString("ko-KR")}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="rounded-2xl border border-violet-200 bg-white p-4">
                      <p className="text-sm font-semibold text-violet-900">카드당 평균 지원 수</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3">
                          <p className="text-[11px] text-neutral-500">공개중 오픈카드 1장당 평균 지원</p>
                          <p className="mt-1 text-2xl font-black text-neutral-900">
                            {adminSiteDashboard.averages.openCardApplicationsPerPublicCard.toLocaleString("ko-KR", {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 2,
                            })}
                            <span className="ml-1 text-sm font-semibold text-neutral-500">건</span>
                          </p>
                          <p className="mt-1 text-[11px] text-neutral-500">
                            현재 공개중 카드 {adminSiteDashboard.current.publicOpenCards.toLocaleString("ko-KR")}장 기준
                          </p>
                        </div>
                        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3">
                          <p className="text-[11px] text-neutral-500">공개중 유료카드 1장당 평균 지원</p>
                          <p className="mt-1 text-2xl font-black text-neutral-900">
                            {adminSiteDashboard.averages.paidCardApplicationsPerApprovedCard.toLocaleString("ko-KR", {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 2,
                            })}
                            <span className="ml-1 text-sm font-semibold text-neutral-500">건</span>
                          </p>
                          <p className="mt-1 text-[11px] text-neutral-500">
                            현재 공개중 유료카드 {adminSiteDashboard.current.publicPaidCards.toLocaleString("ko-KR")}장 기준
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-violet-200 bg-white p-4">
                    <p className="text-sm font-semibold text-violet-900">최근 7일 합계 요약</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      {[
                        {
                          label: "최근 7일 신규 가입",
                          value: adminSiteDashboard.recent7d.reduce((sum, day) => sum + day.counts.new_users, 0),
                        },
                        {
                          label: "최근 7일 오픈카드 등록",
                          value: adminSiteDashboard.recent7d.reduce((sum, day) => sum + day.counts.open_card_created, 0),
                        },
                        {
                          label: "최근 7일 오픈카드 지원",
                          value: adminSiteDashboard.recent7d.reduce((sum, day) => sum + day.counts.open_card_applied, 0),
                        },
                        {
                          label: "최근 7일 1:1 신청",
                          value: adminSiteDashboard.recent7d.reduce((sum, day) => sum + day.counts.one_on_one_created, 0),
                        },
                        {
                          label: "최근 7일 문의",
                          value: adminSiteDashboard.recent7d.reduce((sum, day) => sum + day.counts.support_inquiries, 0),
                        },
                        {
                          label: "최근 7일 더보기 신청",
                          value: adminSiteDashboard.recent7d.reduce((sum, day) => sum + day.counts.more_view_requested, 0),
                        },
                        {
                          label: "최근 7일 가까운 이상형 신청",
                          value: adminSiteDashboard.recent7d.reduce((sum, day) => sum + day.counts.city_view_requested, 0),
                        },
                        {
                          label: "최근 7일 라이크",
                          value: adminSiteDashboard.recent7d.reduce((sum, day) => sum + day.counts.swipe_likes, 0),
                        },
                      ].map((item) => (
                        <div key={`site-dashboard-week-${item.label}`} className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
                          <p className="text-[11px] text-neutral-500">{item.label}</p>
                          <p className="mt-1 text-lg font-bold text-neutral-900">{item.value.toLocaleString("ko-KR")}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                <div className="rounded-2xl border border-violet-200 bg-white p-4">
                  <p className="text-sm font-semibold text-violet-900">최근 7일 기능 이용 추이</p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full border-separate border-spacing-0 text-xs">
                      <thead>
                        <tr>
                          <th className="sticky left-0 z-10 border-b border-violet-100 bg-white px-3 py-2 text-left font-semibold text-neutral-700">
                            기능
                          </th>
                          {adminSiteDashboard.recent7d.map((day) => (
                            <th
                              key={`site-dashboard-head-${day.dateKey}`}
                              className="border-b border-violet-100 bg-white px-3 py-2 text-right font-semibold text-neutral-700"
                            >
                              {day.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(adminSiteDashboard.featureLabels).map(([key, label]) => (
                          <tr key={`site-dashboard-row-${key}`}>
                            <td className="sticky left-0 border-b border-neutral-100 bg-white px-3 py-2 font-medium text-neutral-800">
                              {label}
                            </td>
                            {adminSiteDashboard.recent7d.map((day) => (
                              <td
                                key={`site-dashboard-cell-${key}-${day.dateKey}`}
                                className="border-b border-neutral-100 px-3 py-2 text-right text-neutral-600"
                              >
                                {day.counts[key as AdminSiteDashboardFeatureKey].toLocaleString("ko-KR")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : null}
          </div>
          )}

          {adminManageTab === "payment_center" && (
          <div className="mb-3 space-y-4">
            <div className="rounded-2xl border border-violet-200 bg-white p-4">
              <p className="text-sm font-semibold text-violet-900">결제센터</p>
              <p className="mt-1 text-xs text-neutral-600">
                상품은 각 기능 화면에서 직접 결제하고, 여기서는 승인 대기와 최근 결제 상태만 모아봅니다.
              </p>
            </div>

            {adminPaymentCenterError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                {adminPaymentCenterError}
              </div>
            ) : null}

            {adminPaymentCenterLoading && !adminPaymentCenter ? (
              <div className="rounded-2xl border border-violet-200 bg-white p-6 text-sm text-neutral-500">
                결제센터를 불러오는 중입니다.
              </div>
            ) : null}

            {adminPaymentCenter ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    { label: "지원권 주문 대기", value: adminPaymentCenter.summary.applyCreditsPending },
                    { label: "유료카드 승인 대기", value: adminPaymentCenter.summary.paidCardsPending },
                    { label: "이상형 더보기 대기", value: adminPaymentCenter.summary.moreViewPending },
                    { label: "빠른매칭 구독 대기", value: adminPaymentCenter.summary.swipeSubscriptionsPending },
                    { label: "1:1 번호교환 대기", value: adminPaymentCenter.summary.oneOnOneContactPending },
                    { label: "최근 결제 완료", value: adminPaymentCenter.summary.recentPaidCount },
                    { label: "최근 결제 생성", value: adminPaymentCenter.summary.recentReadyCount },
                  ].map((item) => (
                    <div key={`payment-center-summary-${item.label}`} className="rounded-2xl border border-violet-200 bg-white p-4">
                      <p className="text-xs font-medium text-neutral-500">{item.label}</p>
                      <p className="mt-2 text-2xl font-black text-neutral-900">{item.value.toLocaleString("ko-KR")}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
                  <div className="rounded-2xl border border-violet-200 bg-white p-4">
                    <p className="text-sm font-semibold text-violet-900">바로 가기</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {[
                        { label: "지원권 주문 보기", tab: "apply_credits" as const, count: adminPaymentCenter.summary.applyCreditsPending },
                        { label: "유료카드 승인 보기", tab: "open_cards" as const, count: adminPaymentCenter.summary.paidCardsPending },
                        { label: "이상형 더보기 보기", tab: "more_view" as const, count: adminPaymentCenter.summary.moreViewPending },
                        { label: "빠른매칭 구독 보기", tab: "swipe_subscriptions" as const, count: adminPaymentCenter.summary.swipeSubscriptionsPending },
                        { label: "1:1 번호교환 보기", tab: "one_on_one_contact" as const, count: adminPaymentCenter.summary.oneOnOneContactPending },
                      ].map((item) => (
                        <button
                          key={`payment-center-link-${item.label}`}
                          type="button"
                          onClick={() => setAdminManageTab(item.tab)}
                          className="flex items-center justify-between rounded-xl border border-violet-100 bg-violet-50/50 px-3 py-3 text-left"
                        >
                          <span className="text-sm font-medium text-neutral-800">{item.label}</span>
                          <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-violet-700">
                            {item.count.toLocaleString("ko-KR")}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-violet-200 bg-white p-4">
                    <p className="text-sm font-semibold text-violet-900">운영 메모</p>
                    <div className="mt-3 space-y-2 text-xs text-neutral-600">
                      <p>토스 결제는 최근 주문 상태를 먼저 보고, 필요한 승인 처리는 각 상세 탭에서 이어서 진행하면 됩니다.</p>
                      <p>유저용 결제센터보다 관리자용 결제 상태 확인 허브를 우선 두는 편이 운영 동선이 더 깔끔합니다.</p>
                      <p>결제 완료 후 혜택 지급이 어긋난 건은 주문 상태와 실제 승인 탭 상태를 함께 보는 방식으로 점검하면 됩니다.</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-violet-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-violet-900">최근 토스 주문</p>
                    <p className="text-[11px] text-neutral-500">최근 30건 기준</p>
                  </div>
                  {adminPaymentCenter.orders.length === 0 ? (
                    <p className="mt-3 text-sm text-neutral-500">최근 주문이 없습니다.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {adminPaymentCenter.orders.map((order) => (
                        <div
                          key={order.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-100 bg-violet-50/30 px-3 py-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-neutral-900">
                              {order.nickname ?? order.user_id.slice(0, 8)} /{" "}
                              {order.product_type === "apply_credits"
                                ? "지원권"
                                : order.product_type === "paid_card"
                                  ? "유료카드"
                                  : order.product_type === "more_view"
                                    ? "이상형 더보기"
                                    : order.product_type === "city_view"
                                      ? "가까운 이상형"
                                    : order.product_type === "one_on_one_contact_exchange"
                                      ? "1:1 번호교환"
                                      : order.product_type === "one_on_one_plus_30d"
                                        ? "1:1 매칭 플러스"
                                      : order.product_type === "swipe_premium_30d"
                                        ? "빠른매칭 플러스"
                                    : order.product_type}
                              {" / "}
                              {order.amount.toLocaleString("ko-KR")}원
                            </p>
                            <p className="mt-1 text-[11px] text-neutral-500 break-all">
                              주문번호 {order.toss_order_id} · 상태 {order.status}
                              {order.method ? ` · 수단 ${order.method}` : ""}
                            </p>
                            <p className="mt-1 text-[11px] text-neutral-500">
                              생성 {new Date(order.created_at).toLocaleString("ko-KR")}
                              {order.approved_at ? ` · 승인 ${new Date(order.approved_at).toLocaleString("ko-KR")}` : ""}
                            </p>
                          </div>
                          <div className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-violet-700">
                            {order.status === "paid" ? "결제 완료" : order.status === "ready" ? "결제 생성" : order.status}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
          )}

          {adminManageTab === "dating_stats" && adminDatingStats && (
          <div className="mb-3 space-y-3">
            <div className="rounded-xl border border-violet-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-violet-900">소개팅 데이터 내보내기</p>
                  <p className="mt-1 text-xs text-neutral-600">CSV로 내려받으면 엑셀에서 바로 열 수 있습니다.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleDatingExport("open_cards")}
                    className="h-8 rounded-md border border-violet-200 bg-white px-3 text-xs font-medium text-violet-800 hover:bg-violet-50"
                  >
                    오픈카드 CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDatingExport("paid_cards")}
                    className="h-8 rounded-md border border-violet-200 bg-white px-3 text-xs font-medium text-violet-800 hover:bg-violet-50"
                  >
                    유료카드 CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDatingExport("ideal_preferences")}
                    className="h-8 rounded-md border border-violet-200 bg-white px-3 text-xs font-medium text-violet-800 hover:bg-violet-50"
                  >
                    이상형 분석 CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDatingExport("one_on_one_cards")}
                    className="h-8 rounded-md border border-violet-200 bg-white px-3 text-xs font-medium text-violet-800 hover:bg-violet-50"
                  >
                    1:1 카드 CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDatingExport("one_on_one_matches")}
                    className="h-8 rounded-md border border-violet-200 bg-white px-3 text-xs font-medium text-violet-800 hover:bg-violet-50"
                  >
                    1:1 매칭 CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDatingExport("more_view_requests")}
                    className="h-8 rounded-md border border-violet-200 bg-white px-3 text-xs font-medium text-violet-800 hover:bg-violet-50"
                  >
                    이상형 더보기 CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDatingExport("city_view_requests")}
                    className="h-8 rounded-md border border-violet-200 bg-white px-3 text-xs font-medium text-violet-800 hover:bg-violet-50"
                  >
                    가까운 이상형 CSV
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              <div className="rounded-xl border border-violet-200 bg-white p-4">
                <p className="text-xs font-semibold text-violet-800">오픈카드</p>
                <p className="mt-2 text-2xl font-bold text-neutral-900">{adminDatingStats.open_cards.total}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-neutral-600">
                  <p>공개 {adminDatingStats.open_cards.public}</p>
                  <p>대기 {adminDatingStats.open_cards.pending}</p>
                  <p>숨김 {adminDatingStats.open_cards.hidden}</p>
                  <p>만료 {adminDatingStats.open_cards.expired}</p>
                  <p>남성 {adminDatingStats.open_cards.male}</p>
                  <p>여성 {adminDatingStats.open_cards.female}</p>
                </div>
                <div className="mt-3 rounded-lg border border-violet-100 bg-violet-50/40 p-2 text-xs text-neutral-700">
                  <p className="font-medium text-violet-800">지원서</p>
                  <p className="mt-1">전체 {adminDatingStats.open_cards.applications.total} · 대기 {adminDatingStats.open_cards.applications.submitted}</p>
                  <p className="mt-1">수락 {adminDatingStats.open_cards.applications.accepted} · 거절 {adminDatingStats.open_cards.applications.rejected} · 취소 {adminDatingStats.open_cards.applications.canceled}</p>
                </div>
                <div className="mt-3">
                  <p className="text-xs font-medium text-neutral-700">공개 카드 상위 지역</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {adminDatingStats.open_cards.top_regions.length === 0 ? (
                      <span className="text-xs text-neutral-500">집계 없음</span>
                    ) : (
                      adminDatingStats.open_cards.top_regions.map((item) => (
                        <span key={`open-region-${item.region}`} className="rounded-full bg-violet-50 px-2 py-1 text-[11px] text-violet-800">
                          {item.region} {item.count}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-rose-200 bg-white p-4">
                <p className="text-xs font-semibold text-rose-800">36시간 유료카드</p>
                <p className="mt-2 text-2xl font-bold text-neutral-900">{adminDatingStats.paid_cards.total}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-neutral-600">
                  <p>승인 {adminDatingStats.paid_cards.approved}</p>
                  <p>대기 {adminDatingStats.paid_cards.pending}</p>
                  <p>거절 {adminDatingStats.paid_cards.rejected}</p>
                  <p>만료 {adminDatingStats.paid_cards.expired}</p>
                  <p>블러 {adminDatingStats.paid_cards.blur}</p>
                  <p>공개 {adminDatingStats.paid_cards.public}</p>
                </div>
                <div className="mt-3 rounded-lg border border-rose-100 bg-rose-50/40 p-2 text-xs text-neutral-700">
                  <p className="font-medium text-rose-800">지원서</p>
                  <p className="mt-1">전체 {adminDatingStats.paid_cards.applications.total} · 대기 {adminDatingStats.paid_cards.applications.submitted}</p>
                  <p className="mt-1">수락 {adminDatingStats.paid_cards.applications.accepted} · 거절 {adminDatingStats.paid_cards.applications.rejected} · 취소 {adminDatingStats.paid_cards.applications.canceled}</p>
                </div>
              </div>

              <div className="rounded-xl border border-sky-200 bg-white p-4">
                <p className="text-xs font-semibold text-sky-800">1:1 소개팅</p>
                <p className="mt-2 text-2xl font-bold text-neutral-900">{adminDatingStats.one_on_one.cards.total}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-neutral-600">
                  <p>제출 {adminDatingStats.one_on_one.cards.submitted}</p>
                  <p>검토중 {adminDatingStats.one_on_one.cards.reviewing}</p>
                  <p>승인 {adminDatingStats.one_on_one.cards.approved}</p>
                  <p>거절 {adminDatingStats.one_on_one.cards.rejected}</p>
                  <p>남성 {adminDatingStats.one_on_one.cards.male}</p>
                  <p>여성 {adminDatingStats.one_on_one.cards.female}</p>
                </div>
                <div className="mt-3 rounded-lg border border-sky-100 bg-sky-50/40 p-2 text-xs text-neutral-700">
                  <p className="font-medium text-sky-800">매칭 상태</p>
                  <p className="mt-1">전체 {adminDatingStats.one_on_one.matches.total} · 제안중 {adminDatingStats.one_on_one.matches.proposed}</p>
                  <p className="mt-1">선택대기 {adminDatingStats.one_on_one.matches.source_selected} · 후보수락 {adminDatingStats.one_on_one.matches.candidate_accepted}</p>
                  <p className="mt-1">상호수락 {adminDatingStats.one_on_one.matches.mutual_accepted} · 취소 {adminDatingStats.one_on_one.matches.admin_canceled}</p>
                </div>
                <div className="mt-3">
                  <p className="text-xs font-medium text-neutral-700">승인 카드 상위 지역</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {adminDatingStats.one_on_one.cards.top_regions.length === 0 ? (
                      <span className="text-xs text-neutral-500">집계 없음</span>
                    ) : (
                      adminDatingStats.one_on_one.cards.top_regions.map((item) => (
                        <span key={`oneonone-region-${item.region}`} className="rounded-full bg-sky-50 px-2 py-1 text-[11px] text-sky-800">
                          {item.region} {item.count}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-violet-200 bg-white p-4">
                <p className="text-sm font-semibold text-violet-900">추가 노출/열람권 현황</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3 text-xs text-neutral-700">
                    <p className="font-medium text-violet-800">이상형 더보기</p>
                    <p className="mt-2">활성 {adminDatingStats.boosts.more_view.active}</p>
                    <p className="mt-1">대기 {adminDatingStats.boosts.more_view.pending}</p>
                    <p className="mt-1">승인 {adminDatingStats.boosts.more_view.approved}</p>
                    <p className="mt-1">거절 {adminDatingStats.boosts.more_view.rejected}</p>
                  </div>
                  <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3 text-xs text-neutral-700">
                    <p className="font-medium text-violet-800">가까운 이상형</p>
                    <p className="mt-2">활성 {adminDatingStats.boosts.city_view.active}</p>
                    <p className="mt-1">대기 {adminDatingStats.boosts.city_view.pending}</p>
                    <p className="mt-1">승인 {adminDatingStats.boosts.city_view.approved}</p>
                    <p className="mt-1">거절 {adminDatingStats.boosts.city_view.rejected}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-violet-200 bg-white p-4">
                <p className="text-sm font-semibold text-violet-900">1:1 매칭 흐름 상세</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-neutral-700">
                  <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3">제안중 {adminDatingStats.one_on_one.matches.proposed}</div>
                  <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3">선택대기 {adminDatingStats.one_on_one.matches.source_selected}</div>
                  <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3">후보수락 {adminDatingStats.one_on_one.matches.candidate_accepted}</div>
                  <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3">상호수락 {adminDatingStats.one_on_one.matches.mutual_accepted}</div>
                  <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3">후보거절 {adminDatingStats.one_on_one.matches.candidate_rejected}</div>
                  <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3">최종거절 {adminDatingStats.one_on_one.matches.source_declined}</div>
                  <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3">건너뜀 {adminDatingStats.one_on_one.matches.source_skipped}</div>
                  <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3">운영취소 {adminDatingStats.one_on_one.matches.admin_canceled}</div>
                </div>
              </div>
            </div>
          </div>
          )}

          {adminManageTab === "dating_insights" && adminDatingInsights && (
            <div className="mb-3 space-y-4">
              <div className="rounded-xl border border-violet-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-violet-900">인스타 캡처용 이상형 인사이트</p>
                    <p className="mt-1 text-xs text-neutral-600">
                      4개 카드만 따로 캡처하면 바로 게시물 슬라이드로 쓰기 좋게 정리했습니다.
                    </p>
                  </div>
                  <p className="text-xs text-neutral-500">
                    기준 시각 {new Date(adminDatingInsights.generated_at).toLocaleString("ko-KR")}
                  </p>
                </div>
              </div>

              <section className="overflow-hidden rounded-[28px] border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-rose-50 p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">Slide 1</p>
                    <h3 className="mt-2 text-2xl font-black text-neutral-900">짐툴 소개팅 이상형 데이터 총정리</h3>
                    <p className="mt-2 text-sm text-neutral-600">
                      오픈카드, 유료카드, 1:1 소개팅에 적힌 이상형 문구를 합쳐 남녀 선호 포인트를 비교했습니다.
                    </p>
                  </div>
                  <div className="rounded-full bg-white/80 px-4 py-2 text-right shadow-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">responses</p>
                    <p className="text-2xl font-black text-neutral-900">
                      {adminDatingInsights.totals.total.toLocaleString("ko-KR")}
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl bg-white/90 p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">여성 응답</p>
                    <p className="mt-2 text-3xl font-black text-neutral-900">
                      {adminDatingInsights.totals.female.toLocaleString("ko-KR")}
                    </p>
                    <p className="mt-2 text-sm text-neutral-600">
                      핵심 키워드: {topSignalLabels(adminDatingInsights.female_preference.top_signals)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white/90 p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">남성 응답</p>
                    <p className="mt-2 text-3xl font-black text-neutral-900">
                      {adminDatingInsights.totals.male.toLocaleString("ko-KR")}
                    </p>
                    <p className="mt-2 text-sm text-neutral-600">
                      핵심 키워드: {topSignalLabels(adminDatingInsights.male_preference.top_signals)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-neutral-900 p-4 text-white shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">데이터 비중</p>
                    <div className="mt-3 space-y-2 text-sm">
                      <p>오픈카드 {adminDatingInsights.totals.by_source.open_card.toLocaleString("ko-KR")}</p>
                      <p>유료카드 {adminDatingInsights.totals.by_source.paid_card.toLocaleString("ko-KR")}</p>
                      <p>1:1 소개팅 {adminDatingInsights.totals.by_source.one_on_one.toLocaleString("ko-KR")}</p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="overflow-hidden rounded-[28px] border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-pink-50 p-6 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-700">Slide 2</p>
                <h3 className="mt-2 text-2xl font-black text-neutral-900">여성은 어떤 사람을 선호했을까</h3>
                <p className="mt-2 text-sm text-neutral-600">
                  여성 응답 {adminDatingInsights.female_preference.response_count.toLocaleString("ko-KR")}건 기준입니다.
                </p>

                <div className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
                  <div className="rounded-2xl bg-white/90 p-4 shadow-sm">
                    <p className="text-sm font-semibold text-rose-900">가장 많이 나온 선호 포인트</p>
                    <div className="mt-4 space-y-3">
                      {adminDatingInsights.female_preference.top_signals.slice(0, 5).map((signal, index) => (
                        <div key={`female-signal-${signal.key}`} className="rounded-2xl border border-rose-100 bg-rose-50/60 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-neutral-900">
                              {index + 1}. {DATING_INSIGHT_SIGNAL_LABELS[signal.key]}
                            </p>
                            <p className="text-sm font-bold text-rose-700">{signal.share_pct}%</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-neutral-900 p-4 text-white shadow-sm">
                    <p className="text-sm font-semibold text-white">자주 함께 적은 표현</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {adminDatingInsights.female_preference.top_tokens.slice(0, 10).map((token) => (
                        <span
                          key={`female-token-${token.token}`}
                          className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium text-white"
                        >
                          {token.token}
                        </span>
                      ))}
                    </div>
                    <div className="mt-6 rounded-2xl bg-white/10 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">한줄 요약</p>
                      <p className="mt-2 text-base font-semibold leading-7 text-white">
                        여성은 {topSignalLabels(adminDatingInsights.female_preference.top_signals)} 성향을 특히 자주 언급했습니다.
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="overflow-hidden rounded-[28px] border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-6 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">Slide 3</p>
                <h3 className="mt-2 text-2xl font-black text-neutral-900">남성은 어떤 사람을 선호했을까</h3>
                <p className="mt-2 text-sm text-neutral-600">
                  남성 응답 {adminDatingInsights.male_preference.response_count.toLocaleString("ko-KR")}건 기준입니다.
                </p>

                <div className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
                  <div className="rounded-2xl bg-white/90 p-4 shadow-sm">
                    <p className="text-sm font-semibold text-sky-900">가장 많이 나온 선호 포인트</p>
                    <div className="mt-4 space-y-3">
                      {adminDatingInsights.male_preference.top_signals.slice(0, 5).map((signal, index) => (
                        <div key={`male-signal-${signal.key}`} className="rounded-2xl border border-sky-100 bg-sky-50/60 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-neutral-900">
                              {index + 1}. {DATING_INSIGHT_SIGNAL_LABELS[signal.key]}
                            </p>
                            <p className="text-sm font-bold text-sky-700">{signal.share_pct}%</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-neutral-900 p-4 text-white shadow-sm">
                    <p className="text-sm font-semibold text-white">자주 함께 적은 표현</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {adminDatingInsights.male_preference.top_tokens.slice(0, 10).map((token) => (
                        <span
                          key={`male-token-${token.token}`}
                          className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium text-white"
                        >
                          {token.token}
                        </span>
                      ))}
                    </div>
                    <div className="mt-6 rounded-2xl bg-white/10 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">한줄 요약</p>
                      <p className="mt-2 text-base font-semibold leading-7 text-white">
                        남성은 {topSignalLabels(adminDatingInsights.male_preference.top_signals)} 성향을 특히 자주 언급했습니다.
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="overflow-hidden rounded-[28px] border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 p-6 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-700">Slide 4</p>
                <h3 className="mt-2 text-2xl font-black text-neutral-900">남녀 공통점과 차이점</h3>
                <p className="mt-2 text-sm text-neutral-600">
                  같은 요소를 좋아하는 지점과, 성별별로 더 많이 언급한 요소를 함께 봤습니다.
                </p>

                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl bg-white/90 p-4 shadow-sm">
                    <p className="text-sm font-semibold text-violet-900">공통으로 많이 언급한 요소</p>
                    <div className="mt-4 space-y-3">
                      {adminDatingInsights.contrast
                        .slice()
                        .sort((a, b) => b.common_share_pct - a.common_share_pct)
                        .slice(0, 4)
                        .map((item) => (
                          <div key={`common-${item.key}`} className="rounded-2xl border border-violet-100 bg-violet-50/60 p-3">
                            <p className="text-sm font-semibold text-neutral-900">
                              {DATING_INSIGHT_SIGNAL_LABELS[item.key]}
                            </p>
                            <p className="mt-1 text-xs text-neutral-600">
                              여성 {item.female_share_pct}% · 남성 {item.male_share_pct}%
                            </p>
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-neutral-900 p-4 text-white shadow-sm">
                    <p className="text-sm font-semibold text-white">차이가 큰 포인트</p>
                    <div className="mt-4 space-y-3">
                      {adminDatingInsights.contrast.slice(0, 4).map((item) => (
                        <div key={`gap-${item.key}`} className="rounded-2xl bg-white/10 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-white">
                              {DATING_INSIGHT_SIGNAL_LABELS[item.key]}
                            </p>
                            <p className="text-xs font-bold text-white/80">
                              격차 {Math.abs(item.gap_pct).toFixed(1)}%p
                            </p>
                          </div>
                          <p className="mt-1 text-xs text-white/70">
                            {item.gap_pct >= 0 ? "여성 응답에서 더 자주 언급" : "남성 응답에서 더 자주 언급"}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {adminManageTab === "tools_patch_note" && (
          <div className="mb-3 rounded-xl border border-violet-200 bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-violet-800">도구 탭 패치노트</p>
                <p className="mt-1 text-[11px] text-neutral-500">
                  도구 페이지 카드 아래에 최근 개선사항을 누적해서 보여줍니다.
                </p>
              </div>
              <Link href="/tools" className="h-8 rounded-md border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-800">
                도구 페이지 보기
              </Link>
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs font-medium text-neutral-700">
              <input
                type="checkbox"
                checked={toolsPatchNoteEnabled}
                onChange={(e) => setToolsPatchNoteEnabled(e.target.checked)}
              />
              도구 탭에 노출
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              {TOOLS_PATCH_NOTE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applyToolsPatchNotePreset(preset)}
                  className="rounded-full border border-violet-100 bg-violet-50 px-3 py-1.5 text-[11px] font-medium text-violet-800"
                >
                  {preset}
                </button>
              ))}
            </div>
            <input
              value={toolsPatchNoteText}
              onChange={(e) => setToolsPatchNoteText(e.target.value)}
              maxLength={100}
              placeholder={DEFAULT_TOOLS_PATCH_NOTE_TEXT}
              className="mt-3 h-10 w-full rounded-lg border border-violet-200 px-3 text-sm"
            />
            <div className="mt-2 rounded-lg border border-rose-100 bg-rose-50/60 px-3 py-2 text-sm font-bold leading-6 text-rose-800">
              <span className="mr-2 inline-flex rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-rose-600">패치노트</span>
              {toolsPatchNoteText.trim() || DEFAULT_TOOLS_PATCH_NOTE_TEXT}
            </div>
            {toolsPatchNoteItems && toolsPatchNoteItems.length > 0 ? (
              <div className="mt-2 rounded-lg border border-violet-100 bg-violet-50/50 p-3">
                <p className="text-[11px] font-semibold text-violet-800">누적된 패치노트</p>
                <div className="mt-2 space-y-1.5">
                  {toolsPatchNoteItems.slice(0, 10).map((item) => {
                    const editing = editingToolsPatchNoteId === item.id;
                    return (
                      <div key={item.id} className="rounded-md border border-violet-100 bg-white/70 p-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs leading-5 text-neutral-700">
                            <span className="mr-2 font-semibold text-violet-700">
                              {new Date(item.createdAt).toLocaleDateString("ko-KR", {
                                timeZone: "Asia/Seoul",
                                month: "numeric",
                                day: "numeric",
                              })}
                            </span>
                            {item.text}
                          </p>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={toolsPatchNoteSaving}
                              onClick={() => {
                                setEditingToolsPatchNoteId(editing ? "" : item.id);
                                setEditingToolsPatchNoteText(editing ? "" : item.text);
                                setToolsPatchNoteError("");
                                setToolsPatchNoteInfo("");
                              }}
                              className="h-7 rounded-md border border-violet-200 bg-white px-2 text-[11px] font-medium text-violet-800 disabled:opacity-50"
                            >
                              {editing ? "닫기" : "수정"}
                            </button>
                            <button
                              type="button"
                              disabled={toolsPatchNoteSaving}
                              onClick={() => void handleAdminDeleteToolsPatchNoteItem(item.id)}
                              className="h-7 rounded-md border border-rose-200 bg-white px-2 text-[11px] font-medium text-rose-700 disabled:opacity-50"
                            >
                              삭제
                            </button>
                          </div>
                        </div>
                        {editing ? (
                          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                            <input
                              value={editingToolsPatchNoteText}
                              onChange={(e) => setEditingToolsPatchNoteText(e.target.value)}
                              maxLength={120}
                              className="min-h-9 flex-1 rounded-md border border-violet-200 px-2 text-xs"
                            />
                            <button
                              type="button"
                              disabled={toolsPatchNoteSaving}
                              onClick={() => void handleAdminUpdateToolsPatchNoteItem(item.id)}
                              className="h-9 rounded-md bg-violet-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                            >
                              수정 저장
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleAdminSaveToolsPatchNote()}
                disabled={toolsPatchNoteSaving}
                className="h-9 rounded-lg bg-violet-600 px-3 text-xs font-medium text-white disabled:opacity-50"
              >
                {toolsPatchNoteSaving ? "저장 중..." : "패치노트 저장"}
              </button>
              <button
                type="button"
                onClick={prependTodayToToolsPatchNote}
                disabled={toolsPatchNoteSaving}
                className="h-9 rounded-lg border border-violet-200 bg-white px-3 text-xs font-medium text-violet-800 disabled:opacity-50"
              >
                오늘 날짜 붙이기
              </button>
              <button
                type="button"
                onClick={() => {
                  setToolsPatchNoteEnabled(false);
                  setToolsPatchNoteText("");
                }}
                disabled={toolsPatchNoteSaving}
                className="h-9 rounded-lg border border-violet-200 bg-white px-3 text-xs font-medium text-violet-800 disabled:opacity-50"
              >
                숨기기
              </button>
              <span className="text-[11px] text-neutral-500">{toolsPatchNoteText.length}/100</span>
            </div>
            {toolsPatchNoteError && <p className="mt-2 text-xs text-rose-600">{toolsPatchNoteError}</p>}
            {toolsPatchNoteInfo && <p className="mt-2 text-xs text-emerald-700">{toolsPatchNoteInfo}</p>}

          </div>
          )}

          {adminManageTab === "site_mascot" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-amber-900">짐냥이 이미지</p>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    사이트 우측 안내 말풍선에 뜨는 짐냥이를 선택하거나 직접 올립니다.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-amber-200 bg-white px-3 text-xs font-bold text-amber-800">
                    {siteGuideMascotUploading ? "업로드 중..." : "사진 업로드"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={siteGuideMascotUploading}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0] ?? null;
                        event.currentTarget.value = "";
                        void handleAdminUploadSiteGuideMascot(file);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleAdminSaveSiteGuideMascot()}
                    disabled={siteGuideMascotSaving || siteGuideMascotUploading}
                    className="h-8 rounded-lg bg-amber-500 px-3 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {siteGuideMascotSaving ? "저장 중..." : "짐냥이 저장"}
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {siteGuideMascotOptions.map((option) => {
                  const selected = siteGuideMascotId === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setSiteGuideMascotId(option.id);
                        setSiteGuideMascotError("");
                        setSiteGuideMascotInfo("");
                      }}
                      className={`flex items-center gap-3 rounded-xl border bg-white p-2 text-left transition ${
                        selected ? "border-amber-500 ring-2 ring-amber-200" : "border-amber-100 hover:border-amber-300"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="h-16 w-14 shrink-0 rounded-2xl border border-amber-100 bg-cover bg-center"
                        style={{ backgroundImage: `url(${option.src})` }}
                      />
                      <span>
                        <span className="block text-sm font-bold text-neutral-900">{option.label}</span>
                        <span className="mt-1 block text-[11px] text-neutral-500">
                          {selected ? "현재 선택됨" : "클릭해서 선택"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {siteGuideMascotError && <p className="mt-2 text-xs text-rose-600">{siteGuideMascotError}</p>}
              {siteGuideMascotInfo && <p className="mt-2 text-xs text-emerald-700">{siteGuideMascotInfo}</p>}
            </div>
          </div>
          )}

          {adminManageTab === "reels_dating" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-violet-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-violet-900">
                    {adminReelsDatingEditingId ? "릴스 매물 수정" : "릴스 매물 추가"}
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    예: 릴스 매물 지원(33세 대기업 운동남). 노출 상태인 글만 오픈카드 홈에 표시됩니다.
                  </p>
                </div>
                {adminReelsDatingEditingId ? (
                  <button
                    type="button"
                    onClick={resetAdminReelsDatingDraft}
                    className="h-8 rounded-md border border-violet-200 bg-white px-3 text-xs font-medium text-violet-800"
                  >
                    새 글로 전환
                  </button>
                ) : null}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_120px_120px]">
                <input
                  value={adminReelsDatingDraft.title}
                  onChange={(e) => setAdminReelsDatingDraft((prev) => ({ ...prev, title: e.target.value }))}
                  placeholder="제목"
                  className="h-10 rounded-lg border border-violet-200 bg-white px-3 text-sm outline-none"
                />
                <input
                  type="number"
                  value={adminReelsDatingDraft.sort_order}
                  onChange={(e) => setAdminReelsDatingDraft((prev) => ({ ...prev, sort_order: e.target.value }))}
                  placeholder="노출 순서"
                  className="h-10 rounded-lg border border-violet-200 bg-white px-3 text-sm outline-none"
                />
                <select
                  value={adminReelsDatingDraft.status}
                  onChange={(e) =>
                    setAdminReelsDatingDraft((prev) => ({
                      ...prev,
                      status: e.target.value === "hidden" ? "hidden" : "active",
                    }))
                  }
                  className="h-10 rounded-lg border border-violet-200 bg-white px-3 text-sm outline-none"
                >
                  <option value="active">노출</option>
                  <option value="hidden">숨김</option>
                </select>
              </div>
              <input
                value={adminReelsDatingDraft.instagram_url}
                onChange={(e) => setAdminReelsDatingDraft((prev) => ({ ...prev, instagram_url: e.target.value }))}
                placeholder="인스타 릴스 링크 (선택)"
                className="mt-2 h-10 w-full rounded-lg border border-violet-200 bg-white px-3 text-sm outline-none"
              />
              <textarea
                value={adminReelsDatingDraft.description}
                onChange={(e) => setAdminReelsDatingDraft((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="짧은 설명"
                className="mt-2 min-h-[82px] w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => void handleAdminSaveReelsDatingListing()}
                disabled={adminReelsDatingSaving}
                className="mt-3 h-9 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white disabled:opacity-60"
              >
                {adminReelsDatingSaving ? "저장 중..." : adminReelsDatingEditingId ? "수정 저장" : "릴스 매물 추가"}
              </button>
              {adminReelsDatingError ? <p className="mt-2 text-xs text-rose-600">{adminReelsDatingError}</p> : null}
              {adminReelsDatingInfo ? <p className="mt-2 text-xs text-emerald-700">{adminReelsDatingInfo}</p> : null}
            </div>

            <div className="rounded-xl border border-violet-200 bg-white p-4">
              <p className="text-sm font-semibold text-violet-900">등록된 릴스 매물 {adminReelsDatingListings.length}건</p>
              {!adminReelsDatingLoaded && adminReelsDatingLoading ? (
                <p className="mt-3 text-xs text-neutral-500">불러오는 중...</p>
              ) : adminReelsDatingListings.length === 0 ? (
                <p className="mt-3 text-xs text-neutral-500">등록된 릴스 매물이 없습니다.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {adminReelsDatingListings.map((item) => {
                    const applications = adminReelsDatingApplications.filter((app) => app.listing_id === item.id);
                    const latestApplication = applications[0] ?? null;
                    return (
                      <div key={item.id} className="rounded-lg border border-violet-100 bg-violet-50/30 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-neutral-900">{item.title}</p>
                            <p className="mt-1 text-xs text-neutral-500">
                              {item.status === "active" ? "노출중" : "숨김"} · 정렬 {item.sort_order ?? 0} · 지원 {applications.length}건
                            </p>
                            {item.instagram_url ? (
                              <a
                                href={item.instagram_url}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-flex text-xs font-semibold text-violet-700 underline underline-offset-2"
                              >
                                인스타 링크 열기
                              </a>
                            ) : null}
                            {item.description ? <p className="mt-1 text-xs text-neutral-600">{item.description}</p> : null}
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleAdminEditReelsDatingListing(item)}
                              className="h-8 rounded-md border border-violet-200 bg-white px-3 text-xs font-medium text-violet-800"
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleAdminDeleteReelsDatingListing(item.id)}
                              className="h-8 rounded-md border border-rose-200 bg-white px-3 text-xs font-medium text-rose-700"
                            >
                              삭제
                            </button>
                          </div>
                        </div>
                        {applications.length > 0 ? (
                          <details className="mt-3 rounded-lg border border-violet-100 bg-white">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs">
                              <div className="min-w-0">
                                <p className="font-semibold text-neutral-900">지원 {applications.length}건 보기</p>
                                {latestApplication ? (
                                  <p className="mt-0.5 truncate text-neutral-500">
                                    최근 {latestApplication.applicant_display_nickname || latestApplication.applicant_user_id.slice(0, 8)} ·{" "}
                                    {new Date(latestApplication.created_at).toLocaleString("ko-KR")}
                                  </p>
                                ) : null}
                              </div>
                              <span className="shrink-0 rounded-full bg-violet-50 px-2.5 py-1 font-semibold text-violet-700">펼치기</span>
                            </summary>
                            <div className="border-t border-violet-50">
                              {applications.map((app) => (
                                <details key={app.id} className="group border-b border-neutral-100 last:border-b-0">
                                  <summary className="grid cursor-pointer list-none gap-2 px-3 py-2 text-xs sm:grid-cols-[1fr_auto] sm:items-center">
                                    <div className="min-w-0">
                                      <p className="truncate font-semibold text-neutral-900">
                                        {app.applicant_display_nickname || app.applicant_user_id.slice(0, 8)} · {app.age ?? "-"}세 ·{" "}
                                        {app.region || "지역 없음"}
                                      </p>
                                      <p className="mt-0.5 truncate text-neutral-500">
                                        {app.height_cm ?? "-"}cm · {app.job || "직업 없음"} · 운동 {app.training_years ?? "-"}년 · 인스타{" "}
                                        {app.instagram_id ? `@${app.instagram_id}` : "-"}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2 text-neutral-400">
                                      <span>{new Date(app.created_at).toLocaleString("ko-KR")}</span>
                                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-semibold text-neutral-500 group-open:hidden">
                                        상세
                                      </span>
                                      <span className="hidden rounded-full bg-neutral-900 px-2 py-0.5 font-semibold text-white group-open:inline-flex">
                                        닫기
                                      </span>
                                    </div>
                                  </summary>
                                  <div className="px-3 pb-3 text-xs text-neutral-700">
                                    <div className="rounded-lg bg-neutral-50 p-3">
                                      <p className="font-medium text-violet-700">인스타: {app.instagram_id ? `@${app.instagram_id}` : "-"}</p>
                                      {app.intro_text ? <p className="mt-2 whitespace-pre-wrap break-words">{app.intro_text}</p> : null}
                                      {app.photo_signed_url ? (
                                        <a
                                          href={app.photo_signed_url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="mt-3 inline-flex h-24 w-24 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-white"
                                        >
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img
                                            src={app.photo_signed_url}
                                            alt="릴스 지원 사진"
                                            loading="lazy"
                                            decoding="async"
                                            className="max-h-full max-w-full object-contain"
                                          />
                                        </a>
                                      ) : null}
                                    </div>
                                  </div>
                                </details>
                              ))}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          )}

          {adminManageTab === "open_cards" && (
          <div className="mb-3 rounded-xl border border-violet-200 bg-white p-3">
            <p className="text-xs font-semibold text-violet-800">오픈카드 작성 버튼</p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                disabled={openCardWriteSaving}
                onClick={() => void handleAdminToggleOpenCardWrite(true)}
                className={`h-8 rounded-md px-3 text-xs font-medium text-white ${openCardWriteEnabled ? "bg-emerald-600" : "bg-neutral-400"}`}
              >
                ON
              </button>
              <button
                type="button"
                disabled={openCardWriteSaving}
                onClick={() => void handleAdminToggleOpenCardWrite(false)}
                className={`h-8 rounded-md px-3 text-xs font-medium text-white ${!openCardWriteEnabled ? "bg-rose-600" : "bg-neutral-400"}`}
              >
                OFF
              </button>
              <span className="text-xs text-neutral-600">
                현재: {openCardWriteEnabled ? "작성 가능" : "작성 중단"}
              </span>
            </div>
            <div className="mt-4 border-t border-violet-100 pt-3">
              <p className="text-xs font-semibold text-violet-800">오픈카드 추가 공개</p>
              <p className="mt-1 text-[11px] text-neutral-500">
                기본 공개 30명에 더해 남/녀별로 몇 명을 추가 공개할지 정합니다. 저장하면 대기열 앞 순번부터 바로 순차 공개됩니다.
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="rounded-lg border border-violet-100 bg-violet-50/40 p-3">
                  <span className="text-[11px] font-semibold text-violet-800">남자 카드 추가 공개</span>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={200}
                      value={openCardPublicMaleExtra}
                      onChange={(e) => setOpenCardPublicMaleExtra(e.target.value)}
                      className="h-9 w-24 rounded-lg border border-violet-200 bg-white px-3 text-sm font-semibold text-neutral-900"
                    />
                    <span className="text-xs text-neutral-600">현재 상한 {openCardPublicMaleEffectiveLimit.toLocaleString("ko-KR")}명</span>
                  </div>
                </label>
                <label className="rounded-lg border border-violet-100 bg-violet-50/40 p-3">
                  <span className="text-[11px] font-semibold text-violet-800">여자 카드 추가 공개</span>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={200}
                      value={openCardPublicFemaleExtra}
                      onChange={(e) => setOpenCardPublicFemaleExtra(e.target.value)}
                      className="h-9 w-24 rounded-lg border border-violet-200 bg-white px-3 text-sm font-semibold text-neutral-900"
                    />
                    <span className="text-xs text-neutral-600">현재 상한 {openCardPublicFemaleEffectiveLimit.toLocaleString("ko-KR")}명</span>
                  </div>
                </label>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleAdminSaveOpenCardPublicSlots()}
                  disabled={openCardPublicSlotsSaving}
                  className="h-9 rounded-lg bg-neutral-900 px-3 text-xs font-medium text-white disabled:opacity-50"
                >
                  {openCardPublicSlotsSaving ? "적용 중..." : "추가 공개 적용"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpenCardPublicMaleExtra("0");
                    setOpenCardPublicFemaleExtra("0");
                  }}
                  disabled={openCardPublicSlotsSaving}
                  className="h-9 rounded-lg border border-violet-200 bg-white px-3 text-xs font-medium text-violet-800 disabled:opacity-50"
                >
                  추가 공개 0명
                </button>
              </div>
              {openCardPublicSlotsError && <p className="mt-2 text-xs text-rose-600">{openCardPublicSlotsError}</p>}
              {openCardPublicSlotsInfo && <p className="mt-2 text-xs text-emerald-700">{openCardPublicSlotsInfo}</p>}
            </div>
            <div className="mt-4 border-t border-violet-100 pt-3">
              <p className="text-xs font-semibold text-violet-800">오픈카드 홈 소개 문구</p>
              <p className="mt-1 text-[11px] text-neutral-500">
                홈 오픈카드 제목 아래 옅은 회색 문구를 수정합니다. 너무 길면 화면에서 두 줄로 보일 수 있어요.
              </p>
              <textarea
                value={openCardHomeSubtitle}
                onChange={(e) => setOpenCardHomeSubtitle(e.target.value)}
                maxLength={90}
                placeholder={DEFAULT_OPEN_CARD_HOME_SUBTITLE}
                className="mt-2 min-h-[76px] w-full rounded-lg border border-violet-200 px-3 py-2 text-sm"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleAdminSaveOpenCardHomeCopy()}
                  disabled={openCardHomeCopySaving}
                  className="h-9 rounded-lg bg-violet-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                >
                  {openCardHomeCopySaving ? "저장 중..." : "문구 저장"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpenCardHomeSubtitle(DEFAULT_OPEN_CARD_HOME_SUBTITLE)}
                  disabled={openCardHomeCopySaving}
                  className="h-9 rounded-lg border border-violet-200 bg-white px-3 text-xs font-medium text-violet-800 disabled:opacity-50"
                >
                  기본 문구
                </button>
                <span className="text-[11px] text-neutral-500">{openCardHomeSubtitle.length}/90</span>
              </div>
              {openCardHomeCopyError && <p className="mt-2 text-xs text-rose-600">{openCardHomeCopyError}</p>}
              {openCardHomeCopyInfo && <p className="mt-2 text-xs text-emerald-700">{openCardHomeCopyInfo}</p>}
            </div>
          </div>
          )}

          {adminManageTab === "mail_center" && (
          <div className="mb-3 rounded-xl border border-rose-200 bg-white p-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs font-semibold text-rose-800">메일 수신거부 해제</p>
                <p className="mt-1 text-[11px] text-neutral-500">
                  실수로 수신거부를 누른 회원을 이메일 또는 사용자 ID로 찾아 캠페인별로 해제합니다.
                </p>
              </div>
              <div className="flex w-full flex-col gap-2 md:max-w-xl">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={adminEmailUnsubscribeQuery}
                    onChange={(e) => setAdminEmailUnsubscribeQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleAdminSearchEmailUnsubscribes();
                    }}
                    placeholder="이메일 또는 사용자 ID"
                    className="min-h-9 flex-1 rounded-lg border border-rose-200 px-3 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAdminSearchEmailUnsubscribes()}
                    disabled={adminEmailUnsubscribeLoading}
                    className="h-9 rounded-lg bg-rose-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {adminEmailUnsubscribeLoading ? "조회 중..." : "조회"}
                  </button>
                </div>
                {adminEmailUnsubscribeError && <p className="text-xs text-rose-600">{adminEmailUnsubscribeError}</p>}
                {adminEmailUnsubscribeInfo && <p className="text-xs text-emerald-700">{adminEmailUnsubscribeInfo}</p>}
              </div>
            </div>
            {adminEmailUnsubscribeItems.length > 0 ? (
              <div className="mt-3 space-y-2">
                {adminEmailUnsubscribeItems.map((item) => {
                  const deleting = adminEmailUnsubscribeDeletingIds.includes(item.id);
                  return (
                    <div key={item.id} className="flex flex-col gap-2 rounded-lg border border-rose-100 bg-rose-50/40 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 text-xs text-neutral-700">
                        <p className="font-semibold text-neutral-900">
                          {item.email || "(이메일 없음)"} {item.nickname ? `· ${item.nickname}` : ""}
                        </p>
                        <p className="mt-1 break-all text-[11px] text-neutral-500">
                          {item.campaign_key} · {new Date(item.unsubscribed_at).toLocaleString("ko-KR")}
                        </p>
                        <p className="mt-1 break-all text-[11px] text-neutral-400">{item.user_id}</p>
                      </div>
                      <button
                        type="button"
                        disabled={deleting}
                        onClick={() => void handleAdminDeleteEmailUnsubscribe(item)}
                        className="h-8 rounded-md border border-rose-300 bg-white px-3 text-xs font-medium text-rose-700 disabled:opacity-50"
                      >
                        {deleting ? "해제 중..." : "수신거부 해제"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
          )}

          {adminManageTab === "mail_center" && (
          <div className="mb-3 rounded-xl border border-violet-200 bg-white p-3">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                <p className="text-xs font-semibold text-violet-800">오픈카드 등록 유도 메일</p>
                <p className="mt-1 text-[11px] text-neutral-500">
                  기본은 성공 발송 이력이 없는 회원을 가입 오래된 순으로 안전하게 150명씩 나눠 보내는 흐름입니다.
                </p>
              </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAdminOpenCardOutreachScope("combined");
                      setAdminOpenCardOutreachRecentMailFilter("never_sent_success");
                      setAdminOpenCardOutreachSort("signup_oldest");
                      setAdminOpenCardOutreachBatchLimit("150");
                    }}
                    className="h-8 rounded-lg border border-violet-200 bg-violet-50 px-3 text-[11px] font-semibold text-violet-900"
                  >
                    오래된 가입자 150명
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdminOpenCardOutreachScope("no_card");
                      setAdminOpenCardOutreachRecentMailFilter("not_sent_24h");
                      setAdminOpenCardOutreachSort("recent_login");
                    }}
                    className="h-8 rounded-lg border border-violet-200 bg-white px-3 text-[11px] font-medium text-violet-900"
                  >
                    카드 없는 최근 접속자
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdminOpenCardOutreachScope("expired_stale");
                      setAdminOpenCardOutreachRecentMailFilter("not_sent_24h");
                      setAdminOpenCardOutreachSort("expired_oldest");
                    }}
                    className="h-8 rounded-lg border border-violet-200 bg-white px-3 text-[11px] font-medium text-violet-900"
                  >
                    만료 오래된 회원
                  </button>
                </div>
              </div>

              <div className="grid gap-3 rounded-xl border border-violet-100 bg-violet-50/30 p-3 sm:grid-cols-2 xl:grid-cols-4">
                <label className="block text-[11px] font-semibold text-violet-900">
                  대상
                <select
                  value={adminOpenCardOutreachScope}
                  onChange={(e) => setAdminOpenCardOutreachScope(e.target.value as AdminOpenCardOutreachScope)}
                    className="mt-1 h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs text-violet-900"
                >
                  <option value="combined">둘 다 포함</option>
                  <option value="no_card">오픈카드 없는 회원</option>
                  <option value="expired_stale">오래전 만료된 회원</option>
                </select>
                </label>
                <label className="block text-[11px] font-semibold text-violet-900">
                  휴대폰 인증
                <select
                  value={adminOpenCardOutreachPhoneFilter}
                  onChange={(e) => setAdminOpenCardOutreachPhoneFilter(e.target.value as AdminOpenCardOutreachPhoneFilter)}
                    className="mt-1 h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs text-violet-900"
                >
                  <option value="all">휴대폰 인증 전체</option>
                  <option value="verified">휴대폰 인증 완료만</option>
                  <option value="unverified">휴대폰 미인증만</option>
                </select>
                </label>
                <label className="block text-[11px] font-semibold text-violet-900">
                  최근 접속
                <select
                  value={adminOpenCardOutreachRecentLoginDays}
                  onChange={(e) => setAdminOpenCardOutreachRecentLoginDays(e.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs text-violet-900"
                >
                  <option value="all">최근 접속 전체</option>
                  <option value="7">최근 7일 내 접속</option>
                  <option value="30">최근 30일 내 접속</option>
                  <option value="90">최근 90일 내 접속</option>
                </select>
                </label>
                <label className="block text-[11px] font-semibold text-violet-900">
                  발송 이력
                <select
                  value={adminOpenCardOutreachRecentMailFilter}
                  onChange={(e) =>
                    setAdminOpenCardOutreachRecentMailFilter(e.target.value as AdminOpenCardOutreachRecentMailFilter)
                  }
                    className="mt-1 h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs text-violet-900"
                >
                  <option value="never_sent_success">성공 발송 이력 없는 회원만</option>
                  <option value="not_sent_24h">최근 24시간 미발송만</option>
                  <option value="all">최근 24시간 발송 전체</option>
                  <option value="sent_24h">최근 24시간 발송 성공자만</option>
                </select>
                </label>
                <label className="block text-[11px] font-semibold text-violet-900">
                  정렬
                <select
                  value={adminOpenCardOutreachSort}
                  onChange={(e) => setAdminOpenCardOutreachSort(e.target.value as AdminOpenCardOutreachSort)}
                    className="mt-1 h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs text-violet-900"
                >
                  <option value="signup_oldest">가입 오래된 순</option>
                  <option value="priority">우선순위 추천</option>
                  <option value="expired_oldest">만료 오래된 순</option>
                  <option value="recent_login">최근 접속 순</option>
                  <option value="nickname">닉네임 순</option>
                  <option value="recent_mail">최근 메일 발송 순</option>
                </select>
                </label>
                <label className="block text-[11px] font-semibold text-violet-900">
                  발송 묶음
                  <div className="mt-1 flex h-9 items-center gap-2 rounded-lg border border-violet-200 bg-white px-3">
                  <input
                    type="number"
                    min={1}
                    max={150}
                    value={adminOpenCardOutreachBatchLimit}
                    onChange={(e) => setAdminOpenCardOutreachBatchLimit(e.target.value)}
                      className="h-8 w-full bg-transparent text-center text-xs text-neutral-900 outline-none"
                  />
                  <span className="text-[11px] text-neutral-500">명</span>
                  </div>
                </label>
                <label className="block text-[11px] font-semibold text-violet-900">
                  만료 기준
                  <div className="mt-1 flex h-9 items-center gap-2 rounded-lg border border-violet-200 bg-white px-3">
                  <input
                    type="number"
                    min={7}
                    max={180}
                    value={adminOpenCardOutreachStaleDays}
                    onChange={(e) => setAdminOpenCardOutreachStaleDays(e.target.value)}
                      className="h-8 w-full bg-transparent text-center text-xs text-neutral-900 outline-none"
                  />
                    <span className="whitespace-nowrap text-[11px] text-neutral-500">일 경과</span>
                  </div>
                </label>
                <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-2 xl:justify-end">
                <button
                  type="button"
                  onClick={() => void loadAdminOpenCardOutreachPreview()}
                  disabled={adminOpenCardOutreachLoading}
                    className="h-9 flex-1 rounded-lg border border-violet-200 bg-white px-3 text-xs font-medium text-violet-900 disabled:opacity-60 xl:flex-none"
                >
                  {adminOpenCardOutreachLoading ? "미리보기 불러오는 중..." : "미리보기 새로고침"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleAdminSendOpenCardOutreach()}
                  disabled={adminOpenCardOutreachSending || adminOpenCardOutreachLoading || !adminOpenCardOutreachPreview?.recipient_count}
                    className="h-9 flex-1 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white disabled:opacity-60 xl:flex-none"
                >
                  {adminOpenCardOutreachSending ? "발송 중..." : "안내 메일 발송"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleAdminQueueOpenCardOutreach()}
                  disabled={adminOpenCardOutreachSending || adminOpenCardOutreachLoading || !adminOpenCardOutreachPreview?.recipient_count}
                    className="h-9 flex-1 rounded-lg bg-neutral-950 px-3 text-xs font-semibold text-white disabled:opacity-60 xl:flex-none"
                >
                  {adminOpenCardOutreachSending ? "작업 등록 중..." : "백그라운드 발송"}
                </button>
                </div>
              </div>
            </div>

            {adminOpenCardOutreachPreview ? (
              <>
                <div className="mt-3 grid gap-3 md:grid-cols-5">
                  <div className="rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-3">
                    <p className="text-[11px] text-neutral-500">현재 발송 묶음</p>
                    <p className="mt-1 text-2xl font-bold text-neutral-900">
                      {adminOpenCardOutreachPreview.recipient_count.toLocaleString("ko-KR")}명
                    </p>
                    <p className="mt-1 text-[11px] text-neutral-500">
                      전체 후보 {adminOpenCardOutreachPreview.total_candidate_count.toLocaleString("ko-KR")}명 중
                    </p>
                    {adminOpenCardOutreachPreview.total_candidate_count > adminOpenCardOutreachPreview.recipient_count ? (
                      <p className="mt-1 text-[11px] text-violet-700">
                        남은 대상은 새로고침 후 이어서 발송
                      </p>
                    ) : null}
                  </div>
                  <div className="rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-3">
                    <p className="text-[11px] text-neutral-500">오픈카드 없는 회원</p>
                    <p className="mt-1 text-2xl font-bold text-neutral-900">
                      {adminOpenCardOutreachPreview.no_card_count.toLocaleString("ko-KR")}명
                    </p>
                  </div>
                  <div className="rounded-xl border border-violet-100 bg-white px-3 py-3">
                    <p className="text-[11px] text-neutral-500">
                      만료 후 {adminOpenCardOutreachPreview.stale_days}일 지난 회원
                    </p>
                    <p className="mt-1 text-2xl font-bold text-neutral-900">
                      {adminOpenCardOutreachPreview.expired_stale_count.toLocaleString("ko-KR")}명
                    </p>
                  </div>
                  <div className="rounded-xl border border-violet-100 bg-white px-3 py-3">
                    <p className="text-[11px] text-neutral-500">최근 24시간 발송 성공</p>
                    <p className="mt-1 text-2xl font-bold text-neutral-900">
                      {adminOpenCardOutreachPreview.recent_success_24h_count.toLocaleString("ko-KR")}명
                    </p>
                  </div>
                  <div className="rounded-xl border border-violet-100 bg-white px-3 py-3">
                    <p className="text-[11px] text-neutral-500">누적 성공 발송 이력</p>
                    <p className="mt-1 text-2xl font-bold text-neutral-900">
                      {adminOpenCardOutreachPreview.successful_mail_count.toLocaleString("ko-KR")}명
                    </p>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-violet-100 bg-white p-3">
                  <div className="flex flex-wrap gap-2 text-xs text-violet-700">
                    <span>현재 선택: {adminOpenCardOutreachScopeLabel(adminOpenCardOutreachPreview.scope)}</span>
                    <span>· {adminOpenCardOutreachPhoneLabel(adminOpenCardOutreachPreview.phone_verified_filter)}</span>
                    <span>· {adminOpenCardOutreachRecentLoginLabel(adminOpenCardOutreachPreview.recent_login_days)}</span>
                    <span>· {adminOpenCardOutreachRecentMailLabel(adminOpenCardOutreachPreview.recent_mail_filter)}</span>
                    <span>· {adminOpenCardOutreachSortLabel(adminOpenCardOutreachPreview.sort)}</span>
                    <span>· {adminOpenCardOutreachPreview.batch_limit.toLocaleString("ko-KR")}명씩 발송</span>
                  </div>
                  <p className="mt-2 text-[11px] text-neutral-500">
                    대량 발송 실패를 막기 위해 직접 발송은 한 요청당 최대 150명만 전송합니다. 백그라운드 발송은 현재 입력한 제목/본문과 대상 목록을 저장한 뒤 cron이 이어서 처리합니다.
                  </p>
                  <label className="mt-3 block text-xs font-semibold text-neutral-900">제목</label>
                  <input
                    value={adminOpenCardOutreachSubject}
                    onChange={(e) => setAdminOpenCardOutreachSubject(e.target.value)}
                    placeholder="메일 제목을 입력하세요"
                    className="mt-1 h-10 w-full rounded-lg border border-violet-100 px-3 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-violet-300"
                  />
                  <label className="mt-3 block text-xs font-semibold text-neutral-900">본문</label>
                  <textarea
                    value={adminOpenCardOutreachBody}
                    onChange={(e) => setAdminOpenCardOutreachBody(e.target.value)}
                    placeholder="메일 본문을 입력하세요"
                    rows={9}
                    className="mt-1 w-full rounded-lg border border-violet-100 px-3 py-2 text-sm leading-6 text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-violet-300"
                  />
                </div>

                <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/30 p-3">
                  <p className="text-xs font-semibold text-violet-800">발송 샘플</p>
                  {adminOpenCardOutreachPreview.sample_recipients.length === 0 ? (
                    <p className="mt-2 text-xs text-neutral-500">현재 조건에 맞는 샘플 회원이 없습니다.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {adminOpenCardOutreachPreview.sample_recipients.map((item) => (
                        <div key={`${item.user_id}:${item.reason}`} className="rounded-lg border border-violet-100 bg-white px-3 py-2">
                          <p className="text-xs font-medium text-neutral-900">
                            {item.nickname ?? "(닉네임 없음)"} / {item.email ?? item.user_id.slice(0, 8)}
                          </p>
                          <p className="mt-1 text-[11px] text-neutral-500">
                            {item.reason === "no_card"
                              ? "사유: 오픈카드 없음"
                              : `사유: 만료 후 ${item.expired_days ?? adminOpenCardOutreachPreview.stale_days}일 경과`}
                          </p>
                          <p className="mt-1 text-[11px] text-neutral-500">
                            가입일 {item.created_at ? new Date(item.created_at).toLocaleDateString("ko-KR") : "없음"} ·
                            {" "}휴대폰 {item.phone_verified ? "인증 완료" : "미인증"} · 최근 접속{" "}
                            {item.last_sign_in_at ? new Date(item.last_sign_in_at).toLocaleDateString("ko-KR") : "없음"}
                          </p>
                          <p className="mt-1 text-[11px] text-neutral-500">
                            최근 24시간 발송 성공{" "}
                            {item.recent_success_mail_sent_at
                              ? new Date(item.recent_success_mail_sent_at).toLocaleString("ko-KR")
                              : "없음"}
                          </p>
                          <p className="mt-1 text-[11px] text-neutral-500">
                            누적 성공 발송 이력{" "}
                            {item.successful_mail_sent_at
                              ? new Date(item.successful_mail_sent_at).toLocaleString("ko-KR")
                              : "없음"}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : null}

            {adminOpenCardOutreachResult ? (
              <div className="mt-3 space-y-2">
                <p className="text-sm text-violet-900">
                  {adminOpenCardOutreachResult.queued ? "백그라운드 발송 등록" : "발송 완료"}:{" "}
                  {adminOpenCardOutreachScopeLabel(adminOpenCardOutreachResult.scope ?? adminOpenCardOutreachScope)} 요청{" "}
                  {adminOpenCardOutreachResult.requested}명 / 성공 {adminOpenCardOutreachResult.sent}명 / 실패{" "}
                  {adminOpenCardOutreachResult.failed}명
                </p>
                {adminOpenCardOutreachResult.background_job_id ? (
                  <p className="text-[11px] text-neutral-500">작업 ID: {adminOpenCardOutreachResult.background_job_id}</p>
                ) : null}
                <p className="text-[11px] text-neutral-500">
                  안전 발송 단위: 최대 {(adminOpenCardOutreachResult.send_limit ?? 150).toLocaleString("ko-KR")}명씩 처리됩니다.
                  실패가 있어도 성공한 발송은 이력에 기록됩니다.
                </p>
                {adminOpenCardOutreachResult.first_failure ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    첫 실패: {adminOpenCardOutreachResult.first_failure}
                  </p>
                ) : null}
                {adminOpenCardOutreachResult.failure_summary?.length ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    <p className="font-semibold">주요 실패 사유</p>
                    <div className="mt-1 space-y-1">
                      {adminOpenCardOutreachResult.failure_summary.map((item) => (
                        <p key={item}>{item}</p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          )}

          {adminManageTab === "mail_center" && (
          <div className="mb-3 rounded-xl border border-sky-200 bg-white p-3">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                <p className="text-xs font-semibold text-sky-800">1:1 소개팅 안내 메일</p>
                <p className="mt-1 text-[11px] text-neutral-500">
                  1:1 신청 전, 심사 중, 승인 후 미매칭, 쌍방매칭 후 번호교환 전 회원을 나눠서 볼 수 있어요.
                </p>
              </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAdminOneOnOneOutreachScope("no_card");
                      setAdminOneOnOneOutreachRecentMailFilter("not_sent_24h");
                      setAdminOneOnOneOutreachSort("recent_login");
                    }}
                    className="h-8 rounded-lg border border-sky-200 bg-sky-50 px-3 text-[11px] font-semibold text-sky-900"
                  >
                    1:1 미신청 최근 접속자
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdminOneOnOneOutreachScope("approved_no_match");
                      setAdminOneOnOneOutreachRecentMailFilter("not_sent_24h");
                      setAdminOneOnOneOutreachSort("activity_recent");
                    }}
                    className="h-8 rounded-lg border border-sky-200 bg-white px-3 text-[11px] font-medium text-sky-900"
                  >
                    승인 후 미매칭
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdminOneOnOneOutreachScope("mutual_no_exchange");
                      setAdminOneOnOneOutreachRecentMailFilter("not_sent_24h");
                      setAdminOneOnOneOutreachSort("activity_recent");
                    }}
                    className="h-8 rounded-lg border border-sky-200 bg-white px-3 text-[11px] font-medium text-sky-900"
                  >
                    번호교환 전
                  </button>
                </div>
              </div>

              <div className="grid gap-3 rounded-xl border border-sky-100 bg-sky-50/30 p-3 sm:grid-cols-2 xl:grid-cols-4">
                <label className="block text-[11px] font-semibold text-sky-900">
                  대상
                <select
                  value={adminOneOnOneOutreachScope}
                  onChange={(e) => setAdminOneOnOneOutreachScope(e.target.value as AdminOneOnOneOutreachScope)}
                    className="mt-1 h-9 w-full rounded-lg border border-sky-200 bg-white px-3 text-xs text-sky-900"
                >
                  <option value="combined">둘 다 포함</option>
                  <option value="no_card">1:1 카드 없는 회원</option>
                  <option value="pending_review">1:1 카드 심사중 회원</option>
                  <option value="approved_no_match">1:1 승인 후 아직 매칭 없는 회원</option>
                  <option value="mutual_no_exchange">쌍방매칭 후 번호교환 전 회원</option>
                </select>
                </label>
                <label className="block text-[11px] font-semibold text-sky-900">
                  휴대폰 인증
                <select
                  value={adminOneOnOneOutreachPhoneFilter}
                  onChange={(e) => setAdminOneOnOneOutreachPhoneFilter(e.target.value as AdminOpenCardOutreachPhoneFilter)}
                    className="mt-1 h-9 w-full rounded-lg border border-sky-200 bg-white px-3 text-xs text-sky-900"
                >
                  <option value="all">휴대폰 인증 전체</option>
                  <option value="verified">휴대폰 인증 완료만</option>
                  <option value="unverified">휴대폰 미인증만</option>
                </select>
                </label>
                <label className="block text-[11px] font-semibold text-sky-900">
                  최근 접속
                <select
                  value={adminOneOnOneOutreachRecentLoginDays}
                  onChange={(e) => setAdminOneOnOneOutreachRecentLoginDays(e.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-sky-200 bg-white px-3 text-xs text-sky-900"
                >
                  <option value="all">최근 접속 전체</option>
                  <option value="7">최근 7일 내 접속</option>
                  <option value="30">최근 30일 내 접속</option>
                  <option value="90">최근 90일 내 접속</option>
                </select>
                </label>
                <label className="block text-[11px] font-semibold text-sky-900">
                  발송 이력
                <select
                  value={adminOneOnOneOutreachRecentMailFilter}
                  onChange={(e) =>
                    setAdminOneOnOneOutreachRecentMailFilter(e.target.value as AdminOpenCardOutreachRecentMailFilter)
                  }
                    className="mt-1 h-9 w-full rounded-lg border border-sky-200 bg-white px-3 text-xs text-sky-900"
                >
                  <option value="not_sent_24h">최근 24시간 미발송만</option>
                  <option value="all">최근 24시간 발송 전체</option>
                  <option value="sent_24h">최근 24시간 발송 성공자만</option>
                </select>
                </label>
                <label className="block text-[11px] font-semibold text-sky-900 sm:col-span-2">
                  정렬
                <select
                  value={adminOneOnOneOutreachSort}
                  onChange={(e) => setAdminOneOnOneOutreachSort(e.target.value as AdminOneOnOneOutreachSort)}
                    className="mt-1 h-9 w-full rounded-lg border border-sky-200 bg-white px-3 text-xs text-sky-900"
                >
                  <option value="priority">우선순위 추천</option>
                  <option value="activity_recent">최근 1:1 활동 순</option>
                  <option value="recent_login">최근 접속 순</option>
                  <option value="nickname">닉네임 순</option>
                  <option value="recent_mail">최근 메일 발송 순</option>
                </select>
                </label>
                <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-2 xl:justify-end">
                <button
                  type="button"
                  onClick={() => void loadAdminOneOnOneOutreachPreview()}
                  disabled={adminOneOnOneOutreachLoading}
                    className="h-9 flex-1 rounded-lg border border-sky-200 bg-white px-3 text-xs font-medium text-sky-900 disabled:opacity-60 xl:flex-none"
                >
                  {adminOneOnOneOutreachLoading ? "미리보기 불러오는 중..." : "미리보기 새로고침"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleAdminSendOneOnOneOutreach()}
                  disabled={adminOneOnOneOutreachSending || adminOneOnOneOutreachLoading || !adminOneOnOneOutreachPreview?.recipient_count}
                    className="h-9 flex-1 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white disabled:opacity-60 xl:flex-none"
                >
                  {adminOneOnOneOutreachSending ? "발송 중..." : "1:1 메일 발송"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleAdminQueueOneOnOneOutreach()}
                  disabled={adminOneOnOneOutreachSending || adminOneOnOneOutreachLoading || !adminOneOnOneOutreachPreview?.recipient_count}
                    className="h-9 flex-1 rounded-lg bg-neutral-950 px-3 text-xs font-semibold text-white disabled:opacity-60 xl:flex-none"
                >
                  {adminOneOnOneOutreachSending ? "작업 등록 중..." : "백그라운드 발송"}
                </button>
                </div>
              </div>
            </div>

            {adminOneOnOneOutreachPreview ? (
              <>
                <div className="mt-3 grid gap-3 md:grid-cols-5">
                  <div className="rounded-xl border border-sky-100 bg-sky-50/40 px-3 py-3">
                    <p className="text-[11px] text-neutral-500">현재 발송 대상</p>
                    <p className="mt-1 text-2xl font-bold text-neutral-900">
                      {adminOneOnOneOutreachPreview.recipient_count.toLocaleString("ko-KR")}명
                    </p>
                  </div>
                  <div className="rounded-xl border border-sky-100 bg-white px-3 py-3">
                    <p className="text-[11px] text-neutral-500">1:1 카드 없는 회원</p>
                    <p className="mt-1 text-2xl font-bold text-neutral-900">
                      {adminOneOnOneOutreachPreview.no_card_count.toLocaleString("ko-KR")}명
                    </p>
                  </div>
                  <div className="rounded-xl border border-sky-100 bg-white px-3 py-3">
                    <p className="text-[11px] text-neutral-500">1:1 카드 심사중 회원</p>
                    <p className="mt-1 text-2xl font-bold text-neutral-900">
                      {adminOneOnOneOutreachPreview.pending_review_count.toLocaleString("ko-KR")}명
                    </p>
                  </div>
                  <div className="rounded-xl border border-sky-100 bg-white px-3 py-3">
                    <p className="text-[11px] text-neutral-500">승인 후 아직 매칭 없음</p>
                    <p className="mt-1 text-2xl font-bold text-neutral-900">
                      {adminOneOnOneOutreachPreview.approved_no_match_count.toLocaleString("ko-KR")}명
                    </p>
                  </div>
                  <div className="rounded-xl border border-sky-100 bg-white px-3 py-3">
                    <p className="text-[11px] text-neutral-500">쌍방매칭 후 번호교환 전</p>
                    <p className="mt-1 text-2xl font-bold text-neutral-900">
                      {adminOneOnOneOutreachPreview.mutual_no_exchange_count.toLocaleString("ko-KR")}명
                    </p>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-sky-100 bg-white p-3">
                  <div className="flex flex-wrap gap-2 text-xs text-sky-700">
                    <span>현재 선택: {adminOneOnOneOutreachScopeLabel(adminOneOnOneOutreachPreview.scope)}</span>
                    <span>· {adminOpenCardOutreachPhoneLabel(adminOneOnOneOutreachPreview.phone_verified_filter)}</span>
                    <span>· {adminOpenCardOutreachRecentLoginLabel(adminOneOnOneOutreachPreview.recent_login_days)}</span>
                    <span>· {adminOpenCardOutreachRecentMailLabel(adminOneOnOneOutreachPreview.recent_mail_filter)}</span>
                    <span>· {adminOneOnOneOutreachSortLabel(adminOneOnOneOutreachPreview.sort)}</span>
                  </div>
                  <p className="mt-2 text-[11px] text-neutral-500">
                    전체 후보 {adminOneOnOneOutreachPreview.total_candidate_count.toLocaleString("ko-KR")}명 중 최대{" "}
                    {adminOneOnOneOutreachPreview.send_limit.toLocaleString("ko-KR")}명씩 안전 발송 · 백그라운드 발송은 현재 입력한 제목/본문과 대상 목록을 저장한 뒤 cron이 이어서 처리 · 최근 24시간 발송 성공:{" "}
                    {adminOneOnOneOutreachPreview.recent_success_24h_count.toLocaleString("ko-KR")}명
                  </p>
                  <label className="mt-3 block text-xs font-semibold text-neutral-900">제목</label>
                  <input
                    value={adminOneOnOneOutreachSubject}
                    onChange={(e) => setAdminOneOnOneOutreachSubject(e.target.value)}
                    placeholder="메일 제목을 입력하세요"
                    className="mt-1 h-10 w-full rounded-lg border border-sky-100 px-3 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-sky-300"
                  />
                  <label className="mt-3 block text-xs font-semibold text-neutral-900">본문</label>
                  <textarea
                    value={adminOneOnOneOutreachBody}
                    onChange={(e) => setAdminOneOnOneOutreachBody(e.target.value)}
                    placeholder="메일 본문을 입력하세요"
                    rows={9}
                    className="mt-1 w-full rounded-lg border border-sky-100 px-3 py-2 text-sm leading-6 text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-sky-300"
                  />
                </div>

                <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/30 p-3">
                  <p className="text-xs font-semibold text-sky-800">발송 샘플</p>
                  {adminOneOnOneOutreachPreview.sample_recipients.length === 0 ? (
                    <p className="mt-2 text-xs text-neutral-500">현재 조건에 맞는 샘플 회원이 없습니다.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {adminOneOnOneOutreachPreview.sample_recipients.map((item) => (
                        <div key={`${item.user_id}:${item.reason}`} className="rounded-lg border border-sky-100 bg-white px-3 py-2">
                          <p className="text-xs font-medium text-neutral-900">
                            {item.nickname ?? "(닉네임 없음)"} / {item.email ?? item.user_id.slice(0, 8)}
                          </p>
                          <p className="mt-1 text-[11px] text-neutral-500">
                            {item.reason === "no_card" && "사유: 1:1 카드 없음"}
                            {item.reason === "pending_review" && "사유: 1:1 카드 심사중"}
                            {item.reason === "approved_no_match" && "사유: 1:1 승인 후 아직 매칭 없음"}
                            {item.reason === "mutual_no_exchange" && "사유: 쌍방매칭 후 번호교환 전"}
                          </p>
                          <p className="mt-1 text-[11px] text-neutral-500">
                            휴대폰 {item.phone_verified ? "인증 완료" : "미인증"} · 최근 접속{" "}
                            {item.last_sign_in_at ? new Date(item.last_sign_in_at).toLocaleDateString("ko-KR") : "없음"}
                          </p>
                          <p className="mt-1 text-[11px] text-neutral-500">
                            최근 24시간 발송 성공{" "}
                            {item.recent_success_mail_sent_at
                              ? new Date(item.recent_success_mail_sent_at).toLocaleString("ko-KR")
                              : "없음"}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : null}

            {adminOneOnOneOutreachResult ? (
              <div className="mt-3 space-y-2">
                <p className="text-sm text-sky-900">
                  {adminOneOnOneOutreachResult.queued ? "백그라운드 발송 등록" : "발송 완료"}:{" "}
                  {adminOneOnOneOutreachScopeLabel(adminOneOnOneOutreachResult.scope ?? adminOneOnOneOutreachScope)} 요청{" "}
                  {adminOneOnOneOutreachResult.requested}명 / 성공 {adminOneOnOneOutreachResult.sent}명 / 실패{" "}
                  {adminOneOnOneOutreachResult.failed}명
                </p>
                {adminOneOnOneOutreachResult.background_job_id ? (
                  <p className="text-[11px] text-neutral-500">작업 ID: {adminOneOnOneOutreachResult.background_job_id}</p>
                ) : null}
                <p className="text-[11px] text-neutral-500">
                  안전 발송 단위: 최대 {(adminOneOnOneOutreachResult.send_limit ?? 150).toLocaleString("ko-KR")}명씩 처리됩니다.
                  실패가 있어도 성공한 발송은 이력에 기록됩니다.
                </p>
                {adminOneOnOneOutreachResult.first_failure ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    첫 실패: {adminOneOnOneOutreachResult.first_failure}
                  </p>
                ) : null}
                {adminOneOnOneOutreachResult.failure_summary?.length ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    <p className="font-semibold">주요 실패 사유</p>
                    <div className="mt-1 space-y-1">
                      {adminOneOnOneOutreachResult.failure_summary.map((item) => (
                        <p key={item}>{item}</p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          )}

          {adminManageTab === "user_activity" && (
            <div className="mb-3 rounded-xl border border-violet-200 bg-white p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="block flex-1 text-xs font-semibold text-violet-900">
                  회원 검색
                  <input
                    type="text"
                    value={adminUserActivityQuery}
                    onChange={(e) => setAdminUserActivityQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleAdminLoadUserActivity();
                      }
                    }}
                    placeholder="닉네임, 이메일, 사용자 ID"
                    className="mt-1 h-10 w-full rounded-lg border border-violet-200 bg-white px-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleAdminLoadUserActivity()}
                  disabled={adminUserActivityLoading}
                  className="h-10 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {adminUserActivityLoading ? "조회 중..." : "기록 조회"}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-neutral-500">
                커뮤니티, 몸평, 오픈카드, 1:1, 결제, 문의, 휴대폰 인증 기록을 한 번에 확인합니다. 탈퇴 기록은 보관 기간 내에서만 조회됩니다.
              </p>
              {adminUserActivityError ? <p className="mt-2 text-xs text-red-600">{adminUserActivityError}</p> : null}

              {adminUserActivityResult ? (
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-violet-100 bg-violet-50/40 p-3">
                    <p className="text-xs font-semibold text-violet-900">회원 기본 정보</p>
                    {adminUserActivityResult.user ? (
                      <div className="mt-2 space-y-3">
                        <div className="grid gap-2 text-xs text-neutral-700 sm:grid-cols-2">
                          <p>닉네임: {adminUserActivityResult.user.profile?.nickname ?? "-"}</p>
                          <p>이메일: {adminUserActivityResult.user.email ?? "-"}</p>
                          <p>사용자 ID: {adminUserActivityResult.user.id}</p>
                          <p>역할: {adminUserActivityResult.user.profile?.role ?? "user"}</p>
                          <p>가입일: {adminUserActivityResult.user.created_at ? new Date(adminUserActivityResult.user.created_at).toLocaleString("ko-KR") : "-"}</p>
                          <p>최근 로그인: {adminUserActivityResult.user.last_sign_in_at ? new Date(adminUserActivityResult.user.last_sign_in_at).toLocaleString("ko-KR") : "-"}</p>
                          <p>휴대폰 인증: {adminUserActivityResult.user.profile?.phone_verified ? "완료" : "미완료"}</p>
                          <p>빠른매칭 노출: {adminUserActivityResult.user.profile?.swipe_profile_visible === false ? "숨김" : "노출"}</p>
                        </div>
                        <div className="rounded-lg border border-violet-100 bg-white p-3">
                          <p className="text-xs font-semibold text-violet-900">관리자 닉네임 변경</p>
                          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                            <input
                              value={adminNicknameDraft}
                              onChange={(e) => setAdminNicknameDraft(e.target.value)}
                              placeholder="새 닉네임"
                              className="h-9 flex-1 rounded-lg border border-violet-200 bg-white px-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
                            />
                            <button
                              type="button"
                              onClick={() => void handleAdminSaveUserNickname()}
                              disabled={adminNicknameSaving}
                              className="h-9 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white disabled:opacity-60"
                            >
                              {adminNicknameSaving ? "변경 중..." : "닉네임 변경"}
                            </button>
                          </div>
                          <p className="mt-1 text-[11px] text-neutral-500">회원 변경 횟수와 상관없이 관리자 권한으로 바로 변경합니다.</p>
                          {adminNicknameError ? <p className="mt-2 text-xs text-red-600">{adminNicknameError}</p> : null}
                          {adminNicknameInfo ? <p className="mt-2 text-xs text-emerald-700">{adminNicknameInfo}</p> : null}
                        </div>

                        <div className="rounded-lg border border-rose-100 bg-white p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-xs font-semibold text-rose-900">관리자 벤</p>
                              <p className="mt-1 text-[11px] text-neutral-500">
                                벤 처리 시 공개/대기 중인 오픈카드와 유료카드는 비노출됩니다.
                              </p>
                            </div>
                            <span
                              className={`rounded-full px-2 py-1 text-[11px] font-bold ${
                                adminUserActivityResult.user.profile?.is_banned
                                  ? "bg-rose-100 text-rose-700"
                                  : "bg-emerald-100 text-emerald-700"
                              }`}
                            >
                              {adminUserActivityResult.user.profile?.is_banned ? "벤 상태" : "정상"}
                            </span>
                          </div>
                          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                            <input
                              value={adminBanReason}
                              onChange={(e) => setAdminBanReason(e.target.value)}
                              maxLength={300}
                              placeholder="벤 사유"
                              className="h-9 rounded-lg border border-rose-200 bg-white px-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
                            />
                            <button
                              type="button"
                              onClick={() => void handleAdminSetUserBan(true)}
                              disabled={adminBanSaving || adminUserActivityResult.user.profile?.is_banned === true}
                              className="h-9 rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white disabled:opacity-60"
                            >
                              {adminBanSaving ? "처리 중..." : "벤 처리"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleAdminSetUserBan(false)}
                              disabled={adminBanSaving || adminUserActivityResult.user.profile?.is_banned !== true}
                              className="h-9 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 disabled:opacity-50"
                            >
                              벤 해제
                            </button>
                          </div>
                          {adminUserActivityResult.user.profile?.banned_at ? (
                            <p className="mt-1 text-[11px] text-neutral-500">
                              벤 처리일 {new Date(adminUserActivityResult.user.profile.banned_at).toLocaleString("ko-KR")}
                            </p>
                          ) : null}
                          {adminBanError ? <p className="mt-2 text-xs text-red-600">{adminBanError}</p> : null}
                          {adminBanInfo ? <p className="mt-2 text-xs text-emerald-700">{adminBanInfo}</p> : null}
                        </div>

                        <div className="rounded-lg border border-rose-100 bg-white p-3">
                          <p className="text-xs font-semibold text-rose-900">1:1 후보 지인 차단</p>
                          <p className="mt-1 text-[11px] text-neutral-500">
                            현재 조회한 회원과 서로 1:1 후보에 안 뜰 사람의 이름 또는 닉네임을 입력합니다.
                          </p>
                          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                            <input
                              value={adminOneOnOneBlockQuery}
                              onChange={(e) => setAdminOneOnOneBlockQuery(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void handleAdminSaveOneOnOneUserBlock();
                                }
                              }}
                              placeholder="상대 이름 또는 닉네임"
                              className="h-9 rounded-lg border border-rose-200 bg-white px-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
                            />
                            <button
                              type="button"
                              onClick={() => void handleAdminSaveOneOnOneUserBlock()}
                              disabled={adminOneOnOneBlockSaving}
                              className="h-9 rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white disabled:opacity-60"
                            >
                              {adminOneOnOneBlockSaving ? "저장 중..." : "서로 안 보이게"}
                            </button>
                          </div>
                          {adminOneOnOneBlockError ? <p className="mt-2 text-xs text-red-600">{adminOneOnOneBlockError}</p> : null}
                          {adminOneOnOneBlockInfo ? <p className="mt-2 text-xs text-emerald-700">{adminOneOnOneBlockInfo}</p> : null}
                        </div>

                        <div className="rounded-lg border border-pink-100 bg-white p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-xs font-semibold text-pink-900">1:1 매칭 플러스 지급</p>
                              <p className="mt-1 text-[11px] text-neutral-500">
                                활성 1:1 신청 회원에게 플러스 30일을 바로 지급합니다.
                              </p>
                            </div>
                          </div>
                          {(() => {
                            const activeCards = (adminUserActivityResult.details?.one_on_one_cards ?? []).filter((card) =>
                              ["submitted", "reviewing", "approved"].includes(String(card.status ?? ""))
                            );
                            return activeCards.length > 0 ? (
                              <div className="mt-2 space-y-2">
                                {activeCards.slice(0, 5).map((card) => {
                                  const cardId = String(card.id ?? "");
                                  const expiresAtRaw = typeof card.plus_expires_at === "string" ? card.plus_expires_at : "";
                                  const expiresAtMs = expiresAtRaw ? new Date(expiresAtRaw).getTime() : Number.NaN;
                                  const activeBoost = Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();
                                  const granting = adminOneOnOnePriorityGrantingIds.includes(cardId);
                                  return (
                                    <div key={`admin-1on1-priority-${cardId}`} className="rounded-lg border border-pink-100 bg-pink-50/40 px-3 py-2">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="min-w-0">
                                          <p className="text-xs font-semibold text-neutral-900">
                                            {String(card.name ?? "1:1 신청")} · {String(card.status ?? "-")}
                                          </p>
                                          <p className="mt-1 text-[11px] text-neutral-500">
                                            {activeBoost && expiresAtRaw
                                              ? `이용 중 · ${new Date(expiresAtRaw).toLocaleString("ko-KR")}까지`
                                              : "플러스 미이용"}
                                          </p>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => void handleAdminGrantOneOnOnePriorityBoost(card)}
                                          disabled={granting}
                                          className="h-8 rounded-lg bg-pink-600 px-3 text-xs font-semibold text-white disabled:opacity-60"
                                        >
                                          {granting ? "지급 중..." : activeBoost ? "30일 연장" : "30일 지급"}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="mt-2 text-xs text-neutral-500">플러스를 지급할 활성 1:1 신청이 없습니다.</p>
                            );
                          })()}
                          {adminOneOnOnePriorityGrantError ? (
                            <p className="mt-2 text-xs text-red-600">{adminOneOnOnePriorityGrantError}</p>
                          ) : null}
                          {adminOneOnOnePriorityGrantInfo ? (
                            <p className="mt-2 text-xs text-emerald-700">{adminOneOnOnePriorityGrantInfo}</p>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-neutral-500">현재 활성 회원을 찾지 못했습니다.</p>
                    )}
                  </div>

                  {adminUserActivityResult.deleted_audits.length > 0 ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                      <p className="text-xs font-semibold text-amber-900">탈퇴 보관 기록</p>
                      <div className="mt-2 space-y-2">
                        {adminUserActivityResult.deleted_audits.map((item) => (
                          <div key={item.id} className="rounded-lg bg-white px-3 py-2 text-xs text-amber-900">
                            <p className="font-semibold">{item.nickname ?? item.email_masked ?? item.auth_user_id}</p>
                            <p className="mt-1">
                              탈퇴 {new Date(item.deleted_at).toLocaleString("ko-KR")} · 보관 만료{" "}
                              {new Date(item.retention_until).toLocaleString("ko-KR")} · {item.deletion_mode}/{item.initiated_by_role}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-2 sm:grid-cols-4">
                    {Object.entries(adminUserActivityResult.counts).map(([key, value]) => (
                      <div key={key} className="rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2">
                        <p className="text-[11px] text-neutral-500">{key}</p>
                        <p className="mt-1 text-lg font-black text-neutral-900">{Number(value ?? 0).toLocaleString("ko-KR")}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-sky-100 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-sky-900">1:1 매칭 기록</p>
                        <p className="mt-1 text-[11px] text-neutral-500">
                          이 회원이 후보를 받거나 선택한 1:1 매칭과 상대방 정보를 모아봅니다.
                        </p>
                      </div>
                      <span className="rounded-full bg-sky-50 px-2 py-1 text-[11px] font-bold text-sky-700">
                        {(adminUserActivityResult.details?.one_on_one_matches?.length ?? 0).toLocaleString("ko-KR")}건
                      </span>
                    </div>
                    {adminUserActivityResult.details?.one_on_one_matches?.length ? (
                      <div className="mt-3 space-y-2">
                        {adminUserActivityResult.details.one_on_one_matches.slice(0, 30).map((match, index) => {
                          const sourceCard =
                            match.source_card && typeof match.source_card === "object" ? (match.source_card as Record<string, unknown>) : {};
                          const candidateCard =
                            match.candidate_card && typeof match.candidate_card === "object"
                              ? (match.candidate_card as Record<string, unknown>)
                              : {};
                          const sourceProfile =
                            match.source_profile && typeof match.source_profile === "object"
                              ? (match.source_profile as Record<string, unknown>)
                              : {};
                          const candidateProfile =
                            match.candidate_profile && typeof match.candidate_profile === "object"
                              ? (match.candidate_profile as Record<string, unknown>)
                              : {};
                          const counterpartCard =
                            match.counterpart_card && typeof match.counterpart_card === "object"
                              ? (match.counterpart_card as Record<string, unknown>)
                              : {};
                          const counterpartProfile =
                            match.counterpart_profile && typeof match.counterpart_profile === "object"
                              ? (match.counterpart_profile as Record<string, unknown>)
                              : {};
                          const ownCard =
                            match.own_card && typeof match.own_card === "object" ? (match.own_card as Record<string, unknown>) : {};
                        return (
                            <details
                              key={`admin-user-1on1-match-${String(match.id ?? index)}`}
                              className="rounded-lg border border-sky-100 bg-sky-50/40 px-3 py-2"
                            >
                              <summary className="cursor-pointer list-none">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold text-neutral-950">
                                      상대: 1:1 이름 {adminString(counterpartCard.name, "상대 정보 없음")}
                                      {adminString(counterpartProfile.nickname, "") ? ` · 닉네임 ${adminString(counterpartProfile.nickname)}` : ""}
                                    </p>
                                    <p className="mt-1 text-[11px] text-neutral-500">
                                      내 역할 {match.role === "source" ? "신청자" : match.role === "candidate" ? "후보" : "-"} · 상태{" "}
                                      {oneOnOneMatchStateLabel(match.state)} · {adminDateTime(match.updated_at ?? match.created_at)}
                                    </p>
                                  </div>
                                  <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-sky-700">
                                    {adminString(match.contact_exchange_status, "번호교환 전")}
                                  </span>
                                </div>
                              </summary>
                              <div className="mt-2 grid gap-2 text-[11px] text-neutral-700 sm:grid-cols-2">
                                <div className="rounded-md bg-white p-2">
                                  <p className="font-bold text-neutral-900">내 1:1 프로필</p>
                                  <p className="mt-1">
                                    1:1 이름 {adminString(ownCard.name)} / {adminString(ownCard.region)} / {adminString(ownCard.job)}
                                  </p>
                                  <p className="mt-1">키 {adminString(ownCard.height_cm)}cm · 나이 {adminString(ownCard.age)}세</p>
                                </div>
                                <div className="rounded-md bg-white p-2">
                                  <p className="font-bold text-neutral-900">상대 1:1 프로필</p>
                                  <p className="mt-1">
                                    1:1 이름 {adminString(counterpartCard.name)} / 닉네임 {adminString(counterpartProfile.nickname)}
                                  </p>
                                  <p className="mt-1">{adminString(counterpartCard.region)} / {adminString(counterpartCard.job)}</p>
                                  <p className="mt-1">키 {adminString(counterpartCard.height_cm)}cm · 나이 {adminString(counterpartCard.age)}세</p>
                                  <p className="mt-1 break-all">상대 user {adminString(match.counterpart_user_id)}</p>
                                </div>
                              </div>
                              <div className="mt-2 rounded-md bg-white p-2 text-[11px] leading-5 text-neutral-700">
                                <p className="font-bold text-neutral-900">매칭 양쪽 정보</p>
                                <p className="mt-1">
                                  신청자: 1:1 이름 {adminString(sourceCard.name)} · 닉네임 {adminString(sourceProfile.nickname)}
                                </p>
                                <p className="mt-1">
                                  후보: 1:1 이름 {adminString(candidateCard.name)} · 닉네임 {adminString(candidateProfile.nickname)}
                                </p>
                              </div>
                            </details>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-neutral-500">이 회원의 1:1 매칭 기록이 없습니다.</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-indigo-100 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-indigo-900">1:1 프로필 기록</p>
                        <p className="mt-1 text-[11px] text-neutral-500">
                          현재 1:1 신청서와 SQL 적용 후 쌓이는 작성/수정/삭제 스냅샷을 확인합니다.
                        </p>
                      </div>
                      <span className="rounded-full bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-700">
                        현재 {(adminUserActivityResult.details?.one_on_one_cards?.length ?? 0).toLocaleString("ko-KR")}건 · 기록{" "}
                        {(adminUserActivityResult.details?.one_on_one_profile_history?.length ?? 0).toLocaleString("ko-KR")}건
                      </span>
                    </div>
                    {adminUserActivityResult.details?.one_on_one_cards?.length ? (
                      <div className="mt-3 space-y-2">
                        {adminUserActivityResult.details.one_on_one_cards.slice(0, 10).map((card, index) => (
                          <div key={`admin-user-1on1-card-${String(card.id ?? index)}`} className="rounded-lg border border-indigo-100 bg-indigo-50/30 px-3 py-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="text-xs font-bold text-neutral-950">
                                  {adminString(card.name)} · {adminString(card.status)} · {adminString(card.region)}
                                </p>
                                <p className="mt-1 text-[11px] text-neutral-500">
                                  작성 {adminDateTime(card.created_at)} · 수정 {adminDateTime(card.updated_at)}
                                </p>
                              </div>
                              <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-indigo-700">
                                {adminString(card.sex) === "female" ? "여성" : "남성"}
                              </span>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-5 text-neutral-700">
                              소개: {adminString(card.intro_text)}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-neutral-600">
                              장점: {adminString(card.strengths_text)}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-neutral-500">현재 남아있는 1:1 신청서가 없습니다.</p>
                    )}
                    {adminUserActivityResult.details?.one_on_one_profile_history?.length ? (
                      <div className="mt-3 space-y-2">
                        {adminUserActivityResult.details.one_on_one_profile_history.slice(0, 20).map((history, index) => {
                          const snapshot =
                            history.snapshot && typeof history.snapshot === "object" ? (history.snapshot as Record<string, unknown>) : {};
                          return (
                            <details
                              key={`admin-user-1on1-history-${String(history.id ?? index)}`}
                              className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2"
                            >
                              <summary className="cursor-pointer text-xs font-semibold text-neutral-800">
                                {oneOnOneHistoryEventLabel(history.event_type)} · {adminString(snapshot.name)} · {adminDateTime(history.created_at)}
                              </summary>
                              <div className="mt-2 rounded-md bg-white p-2 text-[11px] leading-5 text-neutral-700">
                                <p>
                                  {adminString(snapshot.region)} / {adminString(snapshot.job)} / {adminString(snapshot.height_cm)}cm
                                </p>
                                <p className="mt-1 whitespace-pre-wrap break-words">소개: {adminString(snapshot.intro_text)}</p>
                                <p className="mt-1 whitespace-pre-wrap break-words">원하는 점: {adminString(snapshot.preferred_partner_text)}</p>
                              </div>
                            </details>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-neutral-500">아직 저장된 1:1 프로필 변경 기록이 없습니다. SQL 적용 후부터 자동으로 쌓입니다.</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-rose-100 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-rose-900">토스 결제 환불</p>
                        <p className="mt-1 text-[11px] text-neutral-500">
                          결제 완료 건만 토스 자동 환불이 가능합니다. 부분 환불액을 비우면 전체 환불로 처리됩니다.
                        </p>
                      </div>
                    </div>
                    {adminRefundError ? <p className="mt-2 text-xs text-rose-600">{adminRefundError}</p> : null}
                    {adminRefundInfo ? <p className="mt-2 text-xs text-emerald-700">{adminRefundInfo}</p> : null}
                    {adminUserActivityResult.details?.payments?.length ? (
                      <div className="mt-3 space-y-2">
                        {adminUserActivityResult.details.payments.slice(0, 20).map((order) => {
                          const orderId = String(order.id ?? "");
                          const status = String(order.status ?? "");
                          const amount = Number(order.amount ?? 0);
                          const canRefund = status === "paid" && Boolean(order.payment_key);
                          const rawResponse = order.raw_response && typeof order.raw_response === "object" ? (order.raw_response as Record<string, unknown>) : {};
                          const refundMeta =
                            rawResponse.admin_refund && typeof rawResponse.admin_refund === "object"
                              ? (rawResponse.admin_refund as Record<string, unknown>)
                              : null;
                          return (
                            <div key={`refund-order-${orderId}`} className="rounded-lg border border-rose-100 bg-rose-50/30 px-3 py-2">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-neutral-900">
                                    {String(order.order_name ?? order.product_type ?? "토스 결제")} · {amount.toLocaleString("ko-KR")}원
                                  </p>
                                  <p className="mt-1 break-all text-[11px] text-neutral-500">
                                    상태 {status} · 주문 {String(order.toss_order_id ?? "-")} · 승인{" "}
                                    {order.approved_at ? new Date(String(order.approved_at)).toLocaleString("ko-KR") : "-"}
                                  </p>
                                  {refundMeta ? (
                                    <p className="mt-1 text-[11px] text-rose-700">
                                      환불 반영: {Number(refundMeta.canceledTotal ?? 0).toLocaleString("ko-KR")}원 · {String(refundMeta.cancelReason ?? "-")}
                                    </p>
                                  ) : null}
                                </div>
                                <span
                                  className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                                    canRefund ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-500"
                                  }`}
                                >
                                  {canRefund ? "환불 가능" : status === "canceled" ? "환불 완료" : "환불 불가"}
                                </span>
                              </div>
                              {canRefund ? (
                                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_120px_auto]">
                                  <input
                                    type="text"
                                    value={adminRefundReasonByOrderId[orderId] ?? ""}
                                    onChange={(e) =>
                                      setAdminRefundReasonByOrderId((prev) => ({ ...prev, [orderId]: e.target.value }))
                                    }
                                    placeholder="환불 사유"
                                    className="h-9 rounded-lg border border-rose-200 bg-white px-3 text-xs text-neutral-900 outline-none"
                                  />
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={adminRefundAmountByOrderId[orderId] ?? ""}
                                    onChange={(e) =>
                                      setAdminRefundAmountByOrderId((prev) => ({ ...prev, [orderId]: e.target.value }))
                                    }
                                    placeholder="부분 환불액"
                                    className="h-9 rounded-lg border border-rose-200 bg-white px-3 text-xs text-neutral-900 outline-none"
                                  />
                                  <button
                                    type="button"
                                    disabled={adminRefundingOrderId === orderId}
                                    onClick={() => void handleAdminRefundTossOrder(order)}
                                    className="h-9 rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white disabled:opacity-60"
                                  >
                                    {adminRefundingOrderId === orderId ? "처리 중..." : "환불 처리"}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-neutral-500">이 회원의 토스 결제 내역이 없습니다.</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-violet-100 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-violet-900">오픈카드 대기 순번 이동</p>
                        <p className="mt-1 text-[11px] text-neutral-500">
                          검색된 회원의 대기중 오픈카드를 원하는 순번으로 옮깁니다. 같은 성별 대기열 안에서만 재정렬됩니다.
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        value={adminQueueMoveCardId}
                        onChange={(e) => setAdminQueueMoveCardId(e.target.value)}
                        placeholder="대기중 오픈카드 ID"
                        className="h-9 min-w-0 flex-1 rounded-lg border border-violet-200 bg-white px-3 text-xs text-neutral-900 outline-none"
                      />
                      <input
                        type="number"
                        min={1}
                        value={adminQueueMovePosition}
                        onChange={(e) => setAdminQueueMovePosition(e.target.value)}
                        placeholder="이동할 순번"
                        className="h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs text-neutral-900 outline-none sm:w-32"
                      />
                      <button
                        type="button"
                        disabled={adminQueueMoveLoading}
                        onClick={() => void handleAdminMoveOpenCardQueuePosition()}
                        className="h-9 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        {adminQueueMoveLoading ? "이동 중..." : "순번 이동"}
                      </button>
                    </div>
                    {adminQueueMoveError ? <p className="mt-2 text-xs text-rose-600">{adminQueueMoveError}</p> : null}
                    {adminQueueMoveInfo ? <p className="mt-2 text-xs text-emerald-700">{adminQueueMoveInfo}</p> : null}
                    {adminUserActivityResult.details?.open_cards?.some((item) => item.status === "pending") ? (
                      <div className="mt-3 space-y-2">
                        {adminUserActivityResult.details.open_cards
                          .filter((item) => item.status === "pending")
                          .map((card) => (
                            <div key={`queue-card-${String(card.id)}`} className="rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-semibold text-neutral-900">
                                  {String(card.display_nickname ?? "오픈카드")} · {card.sex === "female" ? "여성" : "남성"} · 현재{" "}
                                  {Number(card.queue_position ?? 0) > 0 ? `${Number(card.queue_position)}번` : "순번 확인 중"}
                                </p>
                                <button
                                  type="button"
                                  disabled={adminQueueMoveLoading}
                                  onClick={() => {
                                    setAdminQueueMoveCardId(String(card.id));
                                    setAdminQueueMovePosition(String(Number(card.queue_position ?? 1) || 1));
                                  }}
                                  className="h-7 rounded-md border border-violet-200 bg-white px-2 text-[11px] font-medium text-violet-800 disabled:opacity-60"
                                >
                                  이 카드 선택
                                </button>
                              </div>
                              <p className="mt-1 break-all text-[11px] text-neutral-500">카드 ID {String(card.id)}</p>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-neutral-500">이 회원의 대기중 오픈카드가 없습니다.</p>
                    )}
                  </div>

                  {adminUserActivityResult.details ? (
                    <div className="rounded-xl border border-neutral-200 bg-white p-3">
                      <p className="text-xs font-semibold text-neutral-900">세부 기록</p>
                      <div className="mt-2 grid gap-2 lg:grid-cols-2">
                        {Object.entries(adminUserActivityResult.details).map(([key, rows]) => (
                          <details key={`detail-${key}`} className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2">
                            <summary className="cursor-pointer text-xs font-semibold text-neutral-800">
                              {key} {Array.isArray(rows) ? rows.length.toLocaleString("ko-KR") : 0}건
                            </summary>
                            {Array.isArray(rows) && rows.length > 0 ? (
                              <div className="mt-2 max-h-[320px] space-y-2 overflow-auto pr-1">
                                {rows.slice(0, 30).map((row, index) => (
                                  <pre
                                    key={`${key}-${String(row.id ?? index)}`}
                                    className="whitespace-pre-wrap break-words rounded-md bg-white p-2 text-[11px] leading-5 text-neutral-600"
                                  >
                                    {JSON.stringify(row, null, 2)}
                                  </pre>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-2 text-xs text-neutral-500">기록 없음</p>
                            )}
                          </details>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-xl border border-neutral-200 bg-white p-3">
                    <p className="text-xs font-semibold text-neutral-900">최근 활동</p>
                    {adminUserActivityResult.activities.length === 0 ? (
                      <p className="mt-2 text-xs text-neutral-500">표시할 활동이 없습니다.</p>
                    ) : (
                      <div className="mt-2 max-h-[520px] space-y-2 overflow-auto pr-1">
                        {adminUserActivityResult.activities.map((item) => (
                          <details key={`${item.kind}:${item.id}`} className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2">
                            <summary className="cursor-pointer text-xs font-semibold text-neutral-800">
                              [{item.label}] {item.at ? new Date(item.at).toLocaleString("ko-KR") : "시간 없음"}
                            </summary>
                            <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-white p-2 text-[11px] leading-5 text-neutral-600">
                              {JSON.stringify(item.meta ?? {}, null, 2)}
                            </pre>
                          </details>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {adminManageTab === "one_on_one_contact" && (
          <div className="mb-3 rounded-xl border border-violet-200 bg-white p-3">
            <p className="text-xs font-semibold text-violet-800">
              1:1 번호 공개 가능 매칭 {adminOneOnOneContactRequests.length}건
            </p>
            <p className="mt-1 text-[11px] text-neutral-500">
              쌍방 수락 후 아직 번호 교환 전인 건을 모았습니다. 오픈카톡으로 입금 확인이 오면 여기서 바로 승인하면 됩니다.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <input
                type="text"
                value={adminOneOnOneContactSearch}
                onChange={(e) => setAdminOneOnOneContactSearch(e.target.value)}
                placeholder="지원자/상대 닉네임, 지역, 번호, 매칭ID 검색"
                className="h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs text-neutral-900 outline-none ring-0 placeholder:text-neutral-400 sm:max-w-sm"
              />
              {normalizedAdminOneOnOneContactSearch ? (
                <p className="text-[11px] text-neutral-500">검색 결과 {filteredAdminOneOnOneContactRequests.length}건</p>
              ) : null}
            </div>
            {adminOneOnOneContactLoading ? (
              <p className="mt-3 text-xs text-neutral-500">불러오는 중...</p>
            ) : filteredAdminOneOnOneContactRequests.length === 0 ? (
              <p className="mt-3 text-xs text-neutral-500">
                {normalizedAdminOneOnOneContactSearch ? "검색된 번호 공개 가능 매칭이 없습니다." : "현재 번호 공개 가능한 매칭이 없습니다."}
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {filteredAdminOneOnOneContactRequests.map((item) => {
                  const processing = processingOneOnOneContactExchangeIds.includes(item.id);
                  const sourceName = oneOnOneContactDisplayName(item.source_card, item.source_profile, item.source_user_id);
                  const candidateName = oneOnOneContactDisplayName(item.candidate_card, item.candidate_profile, item.candidate_user_id);
                  return (
                    <div
                      key={item.id}
                      className="rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-neutral-900">
                            지원자 {sourceName} → 상대 {candidateName}
                          </p>
                          <p className="mt-1 text-[11px] text-neutral-500 break-all">
                            매칭ID {item.id} / 요청 {item.contact_exchange_requested_at ? new Date(item.contact_exchange_requested_at).toLocaleString("ko-KR") : "-"}
                            {item.contact_exchange_paid_at ? ` / 입금확인요청 ${new Date(item.contact_exchange_paid_at).toLocaleString("ko-KR")}` : ""}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-neutral-600">
                            {item.source_card ? (
                              <span>
                                지원자 카드: {item.source_card.sex === "male" ? "남" : "여"} / {item.source_card.age ?? "-"}세 / {item.source_card.region}
                              </span>
                            ) : null}
                            {item.candidate_card ? (
                              <span>
                                상대 카드: {item.candidate_card.sex === "male" ? "남" : "여"} / {item.candidate_card.age ?? "-"}세 / {item.candidate_card.region}
                              </span>
                            ) : null}
                          </div>
                          {(item.source_phone_share_consented_at || item.candidate_phone_share_consented_at) ? (
                            <p className="mt-2 text-[11px] text-neutral-500">
                              지원자 동의 {item.source_phone_share_consented_at ? new Date(item.source_phone_share_consented_at).toLocaleString("ko-KR") : "-"} / 상대 동의 {item.candidate_phone_share_consented_at ? new Date(item.candidate_phone_share_consented_at).toLocaleString("ko-KR") : "-"}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={processing}
                            onClick={() => void handleAdminProcessOneOnOneContactExchange(item.id, "approve")}
                            className="h-8 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                          >
                            {processing ? "처리 중..." : "번호 공개 승인"}
                          </button>
                          <button
                            type="button"
                            disabled={processing}
                            onClick={() => void handleAdminProcessOneOnOneContactExchange(item.id, "reset")}
                            className="h-8 rounded-md border border-amber-300 bg-white px-3 text-xs font-medium text-amber-700 disabled:opacity-50"
                          >
                            대기 유지
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

          {adminManageTab === "apply_credits" && (
          <div className="mb-3 rounded-xl border border-violet-200 bg-white p-3">
            <p className="text-xs font-semibold text-violet-800">
              지원권 주문 승인 대기 {adminApplyCreditOrders.length}건
            </p>
            <div className="mt-3 rounded-lg border border-violet-100 bg-violet-50/40 p-3">
              <p className="text-xs font-semibold text-violet-900">닉네임으로 지원권 5장 직접 지급</p>
              <p className="mt-1 text-[11px] text-violet-700">주문 없이 바로 5장을 지급하고, 이력은 0원 승인 기록으로 남깁니다.</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="text"
                  value={adminApplyCreditGrantNickname}
                  onChange={(e) => setAdminApplyCreditGrantNickname(e.target.value)}
                  placeholder="지급할 닉네임 입력"
                  className="h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs text-neutral-900 outline-none ring-0 placeholder:text-neutral-400 sm:max-w-xs"
                />
                <button
                  type="button"
                  disabled={adminApplyCreditGrantLoading || !adminApplyCreditGrantNickname.trim()}
                  onClick={() => void handleAdminGrantApplyCredits()}
                  className="h-9 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {adminApplyCreditGrantLoading ? "지급 중..." : "3장 지급"}
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <input
                type="text"
                value={adminApplyCreditSearch}
                onChange={(e) => setAdminApplyCreditSearch(e.target.value)}
                placeholder="닉네임 또는 주문ID 검색"
                className="h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs text-neutral-900 outline-none ring-0 placeholder:text-neutral-400 sm:max-w-xs"
              />
              {normalizedAdminApplyCreditSearch ? (
                <p className="text-[11px] text-neutral-500">검색 결과 {filteredAdminApplyCreditOrders.length}건</p>
              ) : null}
            </div>
            {filteredAdminApplyCreditOrders.length === 0 ? (
              <p className="mt-2 text-xs text-neutral-500">
                {normalizedAdminApplyCreditSearch ? "검색된 주문이 없습니다." : "승인 대기 주문이 없습니다."}
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {filteredAdminApplyCreditOrders.map((order) => {
                  const approving = approvingOrderIds.includes(order.id);
                  return (
                    <div
                      key={order.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-100 bg-violet-50/40 px-2 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-neutral-900">
                          {order.nickname ?? order.user_id.slice(0, 8)} / +{order.pack_size}장 /{" "}
                          {order.amount.toLocaleString("ko-KR")}원
                        </p>
                        <p className="text-[11px] text-neutral-500 break-all">
                          주문ID {order.id} / {new Date(order.created_at).toLocaleString("ko-KR")}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={approving}
                        onClick={() => void handleAdminApproveApplyCreditOrder(order.id)}
                        className="h-8 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                      >
                        {approving ? "처리 중..." : "승인"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

          {adminManageTab === "swipe_subscriptions" && (
          <div className="mb-3 rounded-xl border border-violet-200 bg-white p-3">
            <p className="text-xs font-semibold text-violet-800">
              빠른매칭 라이크 구매 승인 대기 {adminSwipeSubscriptionRequests.length}건
            </p>
            <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/60 p-3">
              <div>
                <p className="text-xs font-semibold text-violet-900">유저에게 빠른매칭 플러스 직접 적용</p>
                <p className="mt-1 text-[11px] text-violet-800">
                  닉네임이나 이메일로 유저를 찾은 뒤, 플러스 30일/하루 30회와 빠른매칭 노출 강화를 바로 적용할 수 있어요.
                </p>
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="text"
                  value={adminSwipeSubscriptionGrantQuery}
                  onChange={(e) => setAdminSwipeSubscriptionGrantQuery(e.target.value)}
                  placeholder="닉네임 또는 이메일로 검색"
                  className="h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs text-neutral-900 outline-none ring-0 placeholder:text-neutral-400 sm:max-w-xs"
                />
                <button
                  type="button"
                  disabled={adminSwipeSubscriptionGrantLoading}
                  onClick={() => void handleAdminSearchSwipeSubscriptionGrantCandidates()}
                  className="h-9 rounded-lg border border-violet-200 bg-white px-3 text-xs font-medium text-violet-900 disabled:opacity-60"
                >
                  {adminSwipeSubscriptionGrantLoading ? "검색 중..." : "유저 찾기"}
                </button>
              </div>
              {adminSwipeSubscriptionGrantError ? (
                <p className="mt-2 text-[11px] text-rose-600">{adminSwipeSubscriptionGrantError}</p>
              ) : null}
              {adminSwipeSubscriptionGrantInfo ? (
                <p className="mt-2 text-[11px] text-emerald-700">{adminSwipeSubscriptionGrantInfo}</p>
              ) : null}
              {adminSwipeSubscriptionGrantCandidates.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {adminSwipeSubscriptionGrantCandidates.map((item) => {
                    const isGranting = adminSwipeSubscriptionGrantingUserId === item.userId;
                    const activeLabel = item.activeUntil
                      ? `${new Date(item.activeUntil).toLocaleString("ko-KR")}까지 이용 중`
                      : item.pending
                        ? "결제/승인 대기 요청 있음"
                        : "현재 플러스 없음";
                    return (
                      <div
                        key={item.userId}
                        className="flex flex-col gap-2 rounded-lg border border-violet-100 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-neutral-900">
                            {item.nickname ?? "(닉네임 없음)"} / {item.email ?? item.userId.slice(0, 8)}
                          </p>
                          <p className="mt-1 text-[11px] text-neutral-500">{activeLabel}</p>
                        </div>
                        <button
                          type="button"
                          disabled={isGranting}
                          onClick={() => void handleAdminGrantSwipeSubscriptionToUser(item.userId)}
                          className="h-8 rounded-md bg-violet-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                        >
                          {isGranting ? "적용 중..." : "플러스 30일 적용"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <input
                type="text"
                value={adminSwipeSubscriptionSearch}
                onChange={(e) => setAdminSwipeSubscriptionSearch(e.target.value)}
                placeholder="닉네임 또는 신청ID 검색"
                className="h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs text-neutral-900 outline-none ring-0 placeholder:text-neutral-400 sm:max-w-xs"
              />
              {normalizedAdminSwipeSubscriptionSearch ? (
                <p className="text-[11px] text-neutral-500">검색 결과 {filteredAdminSwipeSubscriptionRequests.length}건</p>
              ) : null}
            </div>
            {filteredAdminSwipeSubscriptionRequests.length === 0 ? (
              <p className="mt-2 text-xs text-neutral-500">
                {normalizedAdminSwipeSubscriptionSearch ? "검색된 신청이 없습니다." : "승인 대기 신청이 없습니다."}
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {filteredAdminSwipeSubscriptionRequests.map((item) => {
                  const processing = processingSwipeSubscriptionIds.includes(item.id);
                  return (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-100 bg-violet-50/40 px-2 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-neutral-900">
                          {item.nickname ?? item.user_id.slice(0, 8)} / 하루 {item.daily_limit}회 / {item.duration_days}일 /{" "}
                          {item.amount.toLocaleString("ko-KR")}원
                        </p>
                        <p className="text-[11px] text-neutral-500 break-all">
                          신청ID {item.id} / {new Date(item.requested_at).toLocaleString("ko-KR")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={processing}
                          onClick={() => void handleAdminProcessSwipeSubscription(item.id, "approved")}
                          className="h-8 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                        >
                          승인
                        </button>
                        <button
                          type="button"
                          disabled={processing}
                          onClick={() => void handleAdminProcessSwipeSubscription(item.id, "rejected")}
                          className="h-8 rounded-md bg-rose-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                        >
                          거절
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

          {adminManageTab === "more_view" && (
          <div className="mb-3 rounded-xl border border-violet-200 bg-white p-3">
            <p className="text-xs font-semibold text-violet-800">
              이상형 더보기 승인 대기 {adminMoreViewRequests.length}건
            </p>
            <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/60 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold text-violet-900">유저에게 이상형 더보기 직접 열어주기</p>
                  <p className="mt-1 text-[11px] text-violet-800">
                    닉네임이나 이메일로 유저를 찾은 뒤, 남자/여자 카드 더보기를 바로 열어줄 수 있어요.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-medium text-violet-800" htmlFor="admin-more-view-grant-sex">
                    열어줄 더보기
                  </label>
                  <select
                    id="admin-more-view-grant-sex"
                    value={adminMoreViewGrantSex}
                    onChange={(e) => setAdminMoreViewGrantSex(e.target.value as "male" | "female")}
                    className="h-9 rounded-lg border border-violet-200 bg-white px-3 text-xs text-neutral-900 outline-none ring-0"
                  >
                    <option value="male">남자 카드 더보기</option>
                    <option value="female">여자 카드 더보기</option>
                  </select>
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="text"
                  value={adminMoreViewGrantQuery}
                  onChange={(e) => setAdminMoreViewGrantQuery(e.target.value)}
                  placeholder="닉네임 또는 이메일로 검색"
                  className="h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs text-neutral-900 outline-none ring-0 placeholder:text-neutral-400 sm:max-w-xs"
                />
                <button
                  type="button"
                  disabled={adminMoreViewGrantLoading}
                  onClick={() => void handleAdminSearchMoreViewGrantCandidates()}
                  className="h-9 rounded-lg border border-violet-200 bg-white px-3 text-xs font-medium text-violet-900 disabled:opacity-60"
                >
                  {adminMoreViewGrantLoading ? "검색 중..." : "유저 찾기"}
                </button>
              </div>
              {adminMoreViewGrantError ? (
                <p className="mt-2 text-[11px] text-rose-600">{adminMoreViewGrantError}</p>
              ) : null}
              {adminMoreViewGrantInfo ? (
                <p className="mt-2 text-[11px] text-emerald-700">{adminMoreViewGrantInfo}</p>
              ) : null}
              {adminMoreViewGrantCandidates.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {adminMoreViewGrantCandidates.map((item) => {
                    const isGranting = adminMoreViewGrantingUserId === item.userId;
                    return (
                      <div
                        key={item.userId}
                        className="flex flex-col gap-2 rounded-lg border border-violet-100 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-neutral-900">
                            {item.nickname ?? "(닉네임 없음)"} / {item.email ?? item.userId.slice(0, 8)}
                          </p>
                          <p className="mt-1 text-[11px] text-neutral-500">
                            현재 열림:{" "}
                            {item.activeSexes.length === 0
                              ? "없음"
                              : item.activeSexes.map((sex) => (sex === "female" ? "여자 카드 더보기" : "남자 카드 더보기")).join(", ")}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={isGranting}
                          onClick={() => void handleAdminGrantMoreViewToUser(item.userId)}
                          className="h-8 rounded-md bg-violet-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                        >
                          {isGranting
                            ? "지급 중..."
                            : `${adminMoreViewGrantSex === "female" ? "여자 카드 더보기" : "남자 카드 더보기"} 열어주기`}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <input
                type="text"
                value={adminMoreViewSearch}
                onChange={(e) => setAdminMoreViewSearch(e.target.value)}
                placeholder="닉네임 또는 신청ID 검색"
                className="h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs text-neutral-900 outline-none ring-0 placeholder:text-neutral-400 sm:max-w-xs"
              />
              {normalizedAdminMoreViewSearch ? (
                <p className="text-[11px] text-neutral-500">검색 결과 {filteredAdminMoreViewRequests.length}건</p>
              ) : null}
            </div>
            {filteredAdminMoreViewRequests.length === 0 ? (
              <p className="mt-2 text-xs text-neutral-500">
                {normalizedAdminMoreViewSearch ? "검색된 신청이 없습니다." : "승인 대기 신청이 없습니다."}
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {filteredAdminMoreViewRequests.map((item) => {
                  const processing = processingMoreViewIds.includes(item.id);
                  return (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-100 bg-violet-50/40 px-2 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-neutral-900">
                          {item.nickname ?? item.user_id.slice(0, 8)} / {item.sex === "male" ? "남자 더보기" : "여자 더보기"}
                        </p>
                        <p className="text-[11px] text-neutral-500 break-all">
                          신청ID {item.id} / {new Date(item.created_at).toLocaleString("ko-KR")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={processing}
                          onClick={() => void handleAdminProcessMoreViewRequest(item.id, "approved")}
                          className="h-8 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                        >
                          승인
                        </button>
                        <button
                          type="button"
                          disabled={processing}
                          onClick={() => void handleAdminProcessMoreViewRequest(item.id, "rejected")}
                          className="h-8 rounded-md bg-rose-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                        >
                          거절
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

            {adminManageTab === "city_view" && (
            <div className="mb-3 rounded-xl border border-violet-200 bg-white p-3">
              <p className="text-xs font-semibold text-violet-800">
                내 가까운 이상형 승인 대기 {adminCityViewRequests.length}건
              </p>
              <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/60 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold text-violet-900">유저에게 가까운 이상형 직접 열어주기</p>
                    <p className="mt-1 text-[11px] text-violet-800">
                      닉네임이나 이메일로 유저를 찾은 뒤, 원하는 지역을 바로 열어줄 수 있어요.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] font-medium text-violet-800" htmlFor="admin-city-view-grant-province">
                      열어줄 지역
                    </label>
                    <select
                      id="admin-city-view-grant-province"
                      value={adminCityViewGrantProvince}
                      onChange={(e) => setAdminCityViewGrantProvince(e.target.value)}
                      className="h-9 rounded-lg border border-violet-200 bg-white px-3 text-xs text-neutral-900 outline-none"
                    >
                      {PROVINCE_ORDER.map((province) => (
                        <option key={province} value={province}>
                          {province}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={adminCityViewGrantQuery}
                    onChange={(e) => setAdminCityViewGrantQuery(e.target.value)}
                    placeholder="닉네임 또는 이메일"
                    className="h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs text-neutral-900 outline-none ring-0 placeholder:text-neutral-400"
                  />
                  <button
                    type="button"
                    disabled={adminCityViewGrantLoading}
                    onClick={() => void handleAdminSearchCityViewGrantCandidates()}
                    className="h-9 shrink-0 rounded-lg bg-violet-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {adminCityViewGrantLoading ? "검색 중..." : "유저 찾기"}
                  </button>
                </div>
                {adminCityViewGrantError ? (
                  <p className="mt-2 text-[11px] text-rose-600">{adminCityViewGrantError}</p>
                ) : null}
                {adminCityViewGrantInfo ? (
                  <p className="mt-2 text-[11px] text-emerald-700">{adminCityViewGrantInfo}</p>
                ) : null}
                {adminCityViewGrantCandidates.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {adminCityViewGrantCandidates.map((item) => {
                      const isGranting = adminCityViewGrantingUserId === item.userId;
                      return (
                        <div
                          key={item.userId}
                          className="flex flex-col gap-2 rounded-lg border border-violet-100 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-neutral-900">
                              {item.nickname?.trim() || "닉네임 없음"}
                            </p>
                            <p className="truncate text-[11px] text-neutral-500">
                              {item.email?.trim() || "이메일 없음"}
                            </p>
                            <p className="mt-1 text-[11px] text-violet-700">
                              현재 열람중: {item.activeCities.length > 0 ? item.activeCities.join(", ") : "없음"}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={isGranting}
                            onClick={() => void handleAdminGrantCityViewToUser(item.userId)}
                            className="h-9 shrink-0 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                          >
                            {isGranting ? "지급 중..." : `${adminCityViewGrantProvince} 열어주기`}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                <p className="text-xs font-semibold text-amber-900">닉네임으로 전체 막힘 해제</p>
                <p className="mt-1 text-[11px] text-amber-800">
                  해당 사용자의 가까운 이상형 `pending`을 전부 정리합니다. 이미 승인된 접근권은 건드리지 않습니다.
                </p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={adminCityViewUnblockIdentifier}
                    onChange={(e) => setAdminCityViewUnblockIdentifier(e.target.value)}
                    placeholder="닉네임 또는 사용자 ID"
                    className="h-9 w-full rounded-lg border border-amber-200 bg-white px-3 text-xs text-neutral-900 outline-none ring-0 placeholder:text-neutral-400"
                  />
                  <button
                    type="button"
                    disabled={adminCityViewUnblockLoading}
                    onClick={() => void handleAdminUnblockAllCityViewPending()}
                    className="h-9 shrink-0 rounded-lg bg-amber-500 px-3 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {adminCityViewUnblockLoading ? "정리 중..." : "전체 막힘 해제"}
                  </button>
                </div>
                {adminCityViewUnblockError ? (
                  <p className="mt-2 text-[11px] text-rose-600">{adminCityViewUnblockError}</p>
                ) : null}
                {adminCityViewUnblockInfo ? (
                  <p className="mt-2 text-[11px] text-emerald-700">{adminCityViewUnblockInfo}</p>
                ) : null}
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <input
                  type="text"
                  value={adminCityViewSearch}
                  onChange={(e) => setAdminCityViewSearch(e.target.value)}
                  placeholder="닉네임 또는 지역 검색"
                  className="h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-xs text-neutral-900 outline-none ring-0 placeholder:text-neutral-400 sm:max-w-xs"
                />
                {normalizedAdminCityViewSearch ? (
                  <p className="text-[11px] text-neutral-500">
                    검색 결과 {filteredAdminCityViewRequests.length}건
                  </p>
                ) : null}
              </div>
              {filteredAdminCityViewRequests.length === 0 ? (
                <p className="mt-2 text-xs text-neutral-500">
                  {normalizedAdminCityViewSearch ? "검색된 요청이 없습니다." : "승인 대기 신청이 없습니다."}
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  {filteredAdminCityViewRequests.map((item) => {
                    const processing = processingCityViewIds.includes(item.id);
                    return (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-100 bg-violet-50/40 px-2 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-neutral-900">
                          {item.nickname ?? item.user_id.slice(0, 8)} / 도시 {item.city}
                        </p>
                        <p className="text-[11px] text-neutral-500 break-all">
                          신청ID {item.id} / {new Date(item.created_at).toLocaleString("ko-KR")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={processing}
                          onClick={() => void handleAdminRepairCityViewPending(item.id)}
                          className="h-8 rounded-md border border-amber-300 bg-amber-50 px-3 text-xs font-medium text-amber-800 disabled:opacity-50"
                        >
                          막힘 해제
                        </button>
                        <button
                          type="button"
                          disabled={processing}
                          onClick={() => void handleAdminProcessCityViewRequest(item.id, "approved")}
                          className="h-8 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                        >
                          승인
                        </button>
                        <button
                          type="button"
                          disabled={processing}
                          onClick={() => void handleAdminProcessCityViewRequest(item.id, "rejected")}
                          className="h-8 rounded-md bg-rose-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                        >
                          거절
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

          {adminManageTab === "community" && (
          <div className="mb-3">
            <AdminCommunityModerationPanel />
          </div>
          )}

          {adminManageTab === "card_ai_review" && (
          <div className="mb-3">
            <AdminDatingCardAiReviewPanel />
          </div>
          )}

          {adminManageTab === "phone_verify" && (
          <div className="mb-3 rounded-xl border border-violet-200 bg-white p-3">
            <p className="text-xs font-semibold text-violet-800">수동 휴대폰 인증</p>
            <p className="mt-1 text-[11px] text-neutral-500">
              닉네임 또는 사용자 ID와 휴대폰 번호를 입력하면 프로필 기준으로 바로 인증 완료 처리됩니다.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input
                type="text"
                value={adminPhoneIdentifier}
                onChange={(e) => setAdminPhoneIdentifier(e.target.value)}
                placeholder="닉네임 또는 사용자 ID"
                className="h-10 rounded-lg border border-violet-200 px-3 text-sm"
              />
              <input
                type="tel"
                value={adminPhoneNumber}
                onChange={(e) => setAdminPhoneNumber(e.target.value)}
                placeholder="휴대폰 번호 (예: 01012345678)"
                className="h-10 rounded-lg border border-violet-200 px-3 text-sm"
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleAdminManualPhoneVerify()}
                disabled={adminPhoneVerifyLoading}
                className="h-9 rounded-lg bg-violet-600 px-3 text-xs font-medium text-white disabled:opacity-50"
              >
                {adminPhoneVerifyLoading ? "처리 중..." : "인증 완료 처리"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdminPhoneIdentifier("");
                  setAdminPhoneNumber("");
                  setAdminPhoneVerifyError("");
                  setAdminPhoneVerifyInfo("");
                }}
                disabled={adminPhoneVerifyLoading}
                className="h-9 rounded-lg border border-violet-200 bg-white px-3 text-xs font-medium text-violet-800 disabled:opacity-50"
              >
                초기화
              </button>
            </div>
            {adminPhoneVerifyError && <p className="mt-2 text-xs text-rose-600">{adminPhoneVerifyError}</p>}
            {adminPhoneVerifyInfo && <p className="mt-2 text-xs text-emerald-700">{adminPhoneVerifyInfo}</p>}
            </div>
            )}

            {adminManageTab === "account_deletions" && (
            <div className="mb-3 rounded-xl border border-violet-200 bg-white p-3">
              <p className="text-xs font-semibold text-violet-800">최근 회원 탈퇴 기록 {adminAccountDeletionAudits.length}건</p>
              <p className="mt-1 text-[11px] text-neutral-500">
                관리자만 볼 수 있는 최소 감사기록입니다. 최근 100건만 표시되며, 기본 보관 기간은 30일입니다.
              </p>
              <div className="mt-3 rounded-lg border border-violet-100 bg-violet-50/40 p-3">
                <p className="text-xs font-semibold text-violet-800">관리자 수동 탈퇴</p>
                <p className="mt-1 text-[11px] text-neutral-500">
                  이메일, 닉네임 또는 사용자 ID로 계정을 찾아 탈퇴 처리합니다.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={adminDeleteIdentifier}
                    onChange={(e) => setAdminDeleteIdentifier(e.target.value)}
                    placeholder="이메일, 닉네임 또는 사용자 ID"
                    className="h-10 flex-1 rounded-lg border border-violet-200 px-3 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAdminDeleteAccount()}
                    disabled={adminDeleteLoading}
                    className="h-10 rounded-lg bg-rose-600 px-4 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {adminDeleteLoading ? "처리 중..." : "탈퇴 처리"}
                  </button>
                </div>
                {adminDeleteError && <p className="mt-2 text-xs text-rose-600">{adminDeleteError}</p>}
                {adminDeleteInfo && <p className="mt-2 text-xs text-emerald-700">{adminDeleteInfo}</p>}
              </div>
              {adminAccountDeletionAuditError && (
                <p className="mt-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {adminAccountDeletionAuditError}
                </p>
              )}
              {adminAccountDeletionAudits.length === 0 ? (
                <p className="mt-3 text-xs text-neutral-500">최근 탈퇴 기록이 없습니다.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {adminAccountDeletionAudits.map((item) => (
                    <div key={item.id} className="rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-neutral-900">
                          {item.nickname?.trim() || "(닉네임 없음)"} · {item.deletion_mode === "soft" ? "소프트 탈퇴" : "하드 탈퇴"}
                        </p>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-neutral-600">
                          {new Date(item.deleted_at).toLocaleString("ko-KR")}
                        </span>
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-neutral-600">
                        <p>사용자 ID: {item.auth_user_id}</p>
                        <p>이메일: {item.email_masked ?? "(없음)"}</p>
                        <p>IP: {item.ip_address ?? "(없음)"}</p>
                        <p>처리 주체: {item.initiated_by_role === "admin" ? "관리자" : "본인"}</p>
                        <p>보관 만료: {new Date(item.retention_until).toLocaleString("ko-KR")}</p>
                        <p className="break-all">기기 정보: {item.user_agent ?? "(없음)"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}

            {adminManageTab === "site_ads" && (
            <div className="mb-3 rounded-xl border border-violet-200 bg-white p-3">
            <p className="text-xs font-semibold text-violet-800">광고 문의 슬롯 설정</p>
            <p className="mt-1 text-[11px] text-neutral-500">
              홈 카드와 광고 문의 페이지에서 사용하는 문구와 링크를 여기서 관리합니다.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAdInquiryEnabled(true)}
                disabled={adInquirySaving}
                className={`h-8 rounded-md px-3 text-xs font-medium text-white ${adInquiryEnabled ? "bg-emerald-600" : "bg-neutral-400"}`}
              >
                ON
              </button>
              <button
                type="button"
                onClick={() => setAdInquiryEnabled(false)}
                disabled={adInquirySaving}
                className={`h-8 rounded-md px-3 text-xs font-medium text-white ${!adInquiryEnabled ? "bg-rose-600" : "bg-neutral-400"}`}
              >
                OFF
              </button>
              <span className="text-xs text-neutral-600">현재: {adInquiryEnabled ? "노출 중" : "숨김"}</span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input
                type="text"
                value={adInquiryBadge}
                onChange={(e) => setAdInquiryBadge(e.target.value)}
                placeholder="배지 (예: AD SLOT)"
                className="h-10 rounded-lg border border-violet-200 px-3 text-sm"
              />
              <input
                type="text"
                value={adInquiryTitle}
                onChange={(e) => setAdInquiryTitle(e.target.value)}
                placeholder="제목"
                className="h-10 rounded-lg border border-violet-200 px-3 text-sm"
              />
              <input
                type="text"
                value={adInquiryCta}
                onChange={(e) => setAdInquiryCta(e.target.value)}
                placeholder="버튼 문구"
                className="h-10 rounded-lg border border-violet-200 px-3 text-sm"
              />
              <input
                type="url"
                value={adInquiryLinkUrl}
                onChange={(e) => setAdInquiryLinkUrl(e.target.value)}
                placeholder="링크 URL"
                className="h-10 rounded-lg border border-violet-200 px-3 text-sm"
              />
              <select
                value={adInquiryTheme}
                onChange={(e) => {
                  const next = e.target.value;
                  setAdInquiryTheme(
                    next === "rose" || next === "violet" || next === "sky" || next === "amber" || next === "neutral"
                      ? next
                      : "emerald"
                  );
                }}
                className="h-10 rounded-lg border border-violet-200 bg-white px-3 text-sm sm:col-span-2"
              >
                <option value="emerald">초록</option>
                <option value="rose">분홍</option>
                <option value="violet">보라</option>
                <option value="sky">하늘</option>
                <option value="amber">노랑</option>
                <option value="neutral">검정/회색</option>
              </select>
            </div>
            <textarea
              value={adInquiryDescription}
              onChange={(e) => setAdInquiryDescription(e.target.value)}
              placeholder="설명 문구"
              className="mt-2 min-h-[96px] w-full rounded-lg border border-violet-200 px-3 py-2 text-sm"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleAdminSaveAdInquiry()}
                disabled={adInquirySaving}
                className="h-9 rounded-lg bg-violet-600 px-3 text-xs font-medium text-white disabled:opacity-50"
              >
                {adInquirySaving ? "저장 중..." : "설정 저장"}
              </button>
              {adInquiryLinkUrl ? (
                <a
                  href={adInquiryLinkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="h-9 rounded-lg border border-violet-200 bg-white px-3 text-xs font-medium text-violet-800 inline-flex items-center"
                >
                  링크 확인
                </a>
              ) : null}
            </div>
            {adInquiryError && <p className="mt-2 text-xs text-rose-600">{adInquiryError}</p>}
            {adInquiryInfo && <p className="mt-2 text-xs text-emerald-700">{adInquiryInfo}</p>}
          </div>
          )}

          {adminManageTab === "accepted_applications" && (
            <div className="space-y-3">
              {!adminAcceptedRecentLoaded ? (
                <div className="rounded-xl border border-emerald-200 bg-white p-4 text-sm text-neutral-600">
                  최근 수락 탭을 열 때만 최근 7일 수락 지원을 불러옵니다. 잠시만 기다려 주세요.
                </div>
              ) : null}
              <div className="rounded-xl border border-emerald-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-emerald-900">
                      최근 7일 수락된 지원 {adminAcceptedRecentApplications.length}건
                    </p>
                    <p className="mt-1 text-xs text-neutral-500">
                      오픈카드와 36시간 카드에서 최근 수락된 지원서와 지원한 카드를 함께 표시합니다.
                    </p>
                  </div>
                  {adminAcceptedRecentFallback ? (
                    <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
                      accepted_at 적용 전 데이터는 지원일 기준
                    </span>
                  ) : null}
                </div>
                {adminAcceptedRecentLoading ? (
                  <p className="mt-3 text-xs text-neutral-500">불러오는 중...</p>
                ) : adminAcceptedRecentApplications.length === 0 ? (
                  <p className="mt-3 text-xs text-neutral-500">최근 7일 기준 수락 기록이 없습니다.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {adminAcceptedRecentApplications.map((item) => (
                      <div
                        key={`${item.source_kind}-${item.application_id}`}
                        className="rounded-lg border border-emerald-100 bg-emerald-50/30 p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-neutral-900">
                              {item.source_kind === "open_card" ? "오픈카드" : "36시간 카드"} 지원서{" "}
                              {item.application_id.slice(0, 8)}...
                            </p>
                            <p className="mt-1 text-xs text-neutral-600">
                              수락 시각:{" "}
                              {item.accepted_at
                                ? new Date(item.accepted_at).toLocaleString("ko-KR")
                                : "수락 시각 기록 전"}
                            </p>
                          </div>
                          <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-emerald-700">
                            accepted
                          </span>
                        </div>
                        <div className="mt-2 grid gap-2 text-xs text-neutral-700 sm:grid-cols-2">
                          <div className="rounded-md bg-white/80 p-2">
                            <p className="font-semibold text-neutral-900">지원자</p>
                            <p className="mt-1">
                              {item.applicant_nickname ?? item.applicant_display_nickname ?? item.applicant_user_id.slice(0, 8)}
                            </p>
                            <p className="mt-1">
                              {item.age ?? "-"}세 · {item.height_cm ?? "-"}cm · {item.region ?? "지역 없음"}
                            </p>
                            <p className="mt-1">
                              {item.job ?? "직업 없음"} · 운동 {item.training_years ?? "-"}년
                            </p>
                            <p className="mt-1 font-medium text-emerald-700">
                              인스타: {item.instagram_id ? `@${item.instagram_id}` : "-"}
                            </p>
                          </div>
                          <div className="rounded-md bg-white/80 p-2">
                            <p className="font-semibold text-neutral-900">지원한 카드</p>
                            <p className="mt-1">
                              {item.card_display_name ?? item.card_id.slice(0, 8)}{" "}
                              {item.card_sex_label ? `/ ${item.card_sex_label}` : ""}
                            </p>
                            <p className="mt-1">
                              작성자: {item.card_owner_nickname ?? item.card_owner_user_id?.slice(0, 8) ?? "-"}
                            </p>
                            <p className="mt-1">
                              상태 {item.card_status ?? "-"} {item.card_region ? `· 지역 ${item.card_region}` : ""}
                            </p>
                          </div>
                        </div>
                        {item.intro_text ? (
                          <p className="mt-2 rounded-md bg-white/80 p-2 text-xs text-neutral-700 whitespace-pre-wrap break-words">
                            자기소개: {item.intro_text}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {adminManageTab === "open_cards" && (
          <div className="space-y-3">
            {!adminOpenCardsLoaded ? (
              <div className="rounded-xl border border-violet-200 bg-white p-4 text-sm text-neutral-600">
                오픈카드 탭을 열 때만 전체 카드와 지원 내역을 불러오도록 바꿨습니다. 잠시만 기다려 주세요.
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-violet-800">
                카드 {adminOpenCards.length}건 / 오픈카드 지원 {adminOpenCardApplications.length}건 / 36시간 지원 {adminPaidCardApplications.length}건
              </h3>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-md border border-violet-200 bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => setAdminDataView("cards")}
                    className={`h-7 rounded px-2 text-xs ${
                      adminDataView === "cards" ? "bg-violet-600 text-white" : "text-violet-800"
                    }`}
                  >
                    카드 보기
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdminDataView("applications")}
                    className={`h-7 rounded px-2 text-xs ${
                      adminDataView === "applications" ? "bg-violet-600 text-white" : "text-violet-800"
                    }`}
                  >
                    지원이력 보기
                  </button>
                </div>
                {adminDataView === "cards" ? (
                  <select
                    value={adminCardSort}
                    onChange={(e) => setAdminCardSort(e.target.value as AdminCardSort)}
                    className="h-8 rounded-md border border-violet-200 bg-white px-2 text-xs text-violet-800"
                  >
                    <option value="public_first">카드: 공개중 우선</option>
                    <option value="pending_first">카드: 대기 우선</option>
                    <option value="newest">카드: 최신순</option>
                    <option value="oldest">카드: 오래된순</option>
                  </select>
                ) : (
                  <select
                    value={adminApplicationSort}
                    onChange={(e) => setAdminApplicationSort(e.target.value as AdminApplicationSort)}
                    className="h-8 rounded-md border border-violet-200 bg-white px-2 text-xs text-violet-800"
                  >
                    <option value="newest">지원이력: 최신순</option>
                    <option value="oldest">지원이력: 오래된순</option>
                    <option value="submitted_first">지원이력: 대기 우선</option>
                    <option value="accepted_first">지원이력: 수락 우선</option>
                  </select>
                )}
              </div>
            </div>

            {adminDataView === "cards" ? (
              adminOpenCards.length === 0 ? (
                <p className="text-sm text-neutral-600">등록된 오픈카드가 없습니다.</p>
              ) : (
                <div className="space-y-2">
                  {sortedAdminOpenCards.map((card) => (
                    <div key={card.id} className="rounded-xl border border-violet-200 bg-white p-3">
                      <p className="text-sm font-semibold text-neutral-900">
                        카드 {card.id.slice(0, 8)}... / {card.display_nickname ?? "(닉네임 없음)"} / {card.sex} / 상태 {card.status}
                      </p>
                      <p className="mt-1 text-[11px] text-neutral-500">
                        등록: {new Date(card.created_at).toLocaleString("ko-KR")}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-neutral-600">
                        <span>owner: {card.owner_nickname ?? card.owner_user_id.slice(0, 8)}</span>
                        {card.age != null && <span>나이 {card.age}</span>}
                        {card.height_cm != null && <span>키 {card.height_cm}cm</span>}
                        {card.region && <span>지역 {card.region}</span>}
                        {card.job && <span>직업 {card.job}</span>}
                        {card.training_years != null && <span>운동 {card.training_years}년</span>}
                        {card.total_3lift != null && <span>3대 {card.total_3lift}kg</span>}
                        {card.percent_all != null && <span>상위 {card.percent_all}%</span>}
                        <span>3대인증 {card.is_3lift_verified ? "Y" : "N"}</span>
                      </div>
                      {card.instagram_id && (
                        <p className="mt-1 text-xs font-medium text-violet-700">
                          카드 소유자 인스타: @{card.instagram_id}
                        </p>
                      )}
                      {card.ideal_type && (
                        <p className="mt-1 text-xs text-neutral-700 whitespace-pre-wrap break-words">
                          이상형: {card.ideal_type}
                        </p>
                      )}
                      {card.strengths_text && (
                        <p className="mt-1 text-xs text-neutral-700 whitespace-pre-wrap break-words">
                          한줄 소개: {card.strengths_text}
                        </p>
                      )}
                      {card.published_at && (
                        <p className="mt-1 text-xs text-emerald-700">
                          공개 시작: {new Date(card.published_at).toLocaleString("ko-KR")}
                        </p>
                      )}
                      {card.expires_at && (
                        <p className="mt-1 text-xs text-amber-700">
                          만료 예정: {new Date(card.expires_at).toLocaleString("ko-KR")}
                        </p>
                      )}
                      {card.blur_thumb_path && (
                        <p className="mt-1 text-xs text-neutral-500 break-all">
                          blur 경로: {card.blur_thumb_path}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-neutral-500 break-all">
                        사진 경로: {Array.isArray(card.photo_paths) ? card.photo_paths.join(", ") : "-"}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            editingAdminOpenCardId === card.id ? closeAdminOpenCardEditor() : openAdminOpenCardEditor(card)
                          }
                          className="h-8 rounded-md border border-violet-200 bg-violet-50 px-3 text-xs font-medium text-violet-800"
                        >
                          {editingAdminOpenCardId === card.id ? "수정 닫기" : "내용 수정"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleAdminDeleteOpenCard(card.id)}
                          className="h-8 rounded-md bg-red-600 px-3 text-xs font-medium text-white"
                        >
                          삭제
                        </button>
                      </div>
                      {editingAdminOpenCardId === card.id && adminOpenCardDraft ? (
                        <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/70 p-3">
                          <p className="text-xs font-semibold text-violet-800">관리자 카드 수정</p>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <label className="text-xs text-neutral-700">
                              닉네임
                              <input
                                value={adminOpenCardDraft.display_nickname}
                                onChange={(e) =>
                                  setAdminOpenCardDraft((prev) =>
                                    prev ? { ...prev, display_nickname: e.target.value } : prev
                                  )
                                }
                                className="mt-1 h-9 w-full rounded-md border border-violet-200 bg-white px-3 text-sm text-neutral-900"
                              />
                            </label>
                            <label className="text-xs text-neutral-700">
                              인스타 ID
                              <input
                                value={adminOpenCardDraft.instagram_id}
                                onChange={(e) =>
                                  setAdminOpenCardDraft((prev) =>
                                    prev ? { ...prev, instagram_id: e.target.value } : prev
                                  )
                                }
                                className="mt-1 h-9 w-full rounded-md border border-violet-200 bg-white px-3 text-sm text-neutral-900"
                              />
                            </label>
                            <label className="text-xs text-neutral-700">
                              나이
                              <input
                                value={adminOpenCardDraft.age}
                                onChange={(e) =>
                                  setAdminOpenCardDraft((prev) => (prev ? { ...prev, age: e.target.value } : prev))
                                }
                                inputMode="numeric"
                                className="mt-1 h-9 w-full rounded-md border border-violet-200 bg-white px-3 text-sm text-neutral-900"
                              />
                            </label>
                            <label className="text-xs text-neutral-700">
                              키(cm)
                              <input
                                value={adminOpenCardDraft.height_cm}
                                onChange={(e) =>
                                  setAdminOpenCardDraft((prev) =>
                                    prev ? { ...prev, height_cm: e.target.value } : prev
                                  )
                                }
                                inputMode="numeric"
                                className="mt-1 h-9 w-full rounded-md border border-violet-200 bg-white px-3 text-sm text-neutral-900"
                              />
                            </label>
                            <label className="text-xs text-neutral-700">
                              지역
                              <input
                                value={adminOpenCardDraft.region}
                                onChange={(e) =>
                                  setAdminOpenCardDraft((prev) => (prev ? { ...prev, region: e.target.value } : prev))
                                }
                                className="mt-1 h-9 w-full rounded-md border border-violet-200 bg-white px-3 text-sm text-neutral-900"
                              />
                            </label>
                            <label className="text-xs text-neutral-700">
                              직업
                              <input
                                value={adminOpenCardDraft.job}
                                onChange={(e) =>
                                  setAdminOpenCardDraft((prev) => (prev ? { ...prev, job: e.target.value } : prev))
                                }
                                className="mt-1 h-9 w-full rounded-md border border-violet-200 bg-white px-3 text-sm text-neutral-900"
                              />
                            </label>
                            <label className="text-xs text-neutral-700">
                              운동 경력(년)
                              <input
                                value={adminOpenCardDraft.training_years}
                                onChange={(e) =>
                                  setAdminOpenCardDraft((prev) =>
                                    prev ? { ...prev, training_years: e.target.value } : prev
                                  )
                                }
                                inputMode="numeric"
                                className="mt-1 h-9 w-full rounded-md border border-violet-200 bg-white px-3 text-sm text-neutral-900"
                              />
                            </label>
                            <label className="text-xs text-neutral-700">
                              3대 중량
                              <input
                                value={adminOpenCardDraft.total_3lift}
                                onChange={(e) =>
                                  setAdminOpenCardDraft((prev) =>
                                    prev ? { ...prev, total_3lift: e.target.value } : prev
                                  )
                                }
                                inputMode="numeric"
                                className="mt-1 h-9 w-full rounded-md border border-violet-200 bg-white px-3 text-sm text-neutral-900"
                              />
                            </label>
                            <label className="text-xs text-neutral-700">
                              상위 퍼센트
                              <input
                                value={adminOpenCardDraft.percent_all}
                                onChange={(e) =>
                                  setAdminOpenCardDraft((prev) =>
                                    prev ? { ...prev, percent_all: e.target.value } : prev
                                  )
                                }
                                inputMode="decimal"
                                className="mt-1 h-9 w-full rounded-md border border-violet-200 bg-white px-3 text-sm text-neutral-900"
                              />
                            </label>
                          </div>
                          <label className="mt-3 block text-xs text-neutral-700">
                            한줄 소개
                            <textarea
                              value={adminOpenCardDraft.strengths_text}
                              onChange={(e) =>
                                setAdminOpenCardDraft((prev) =>
                                  prev ? { ...prev, strengths_text: e.target.value } : prev
                                )
                              }
                              rows={3}
                              className="mt-1 w-full rounded-md border border-violet-200 bg-white px-3 py-2 text-sm text-neutral-900"
                            />
                          </label>
                          <label className="mt-3 block text-xs text-neutral-700">
                            이상형
                            <textarea
                              value={adminOpenCardDraft.ideal_type}
                              onChange={(e) =>
                                setAdminOpenCardDraft((prev) =>
                                  prev ? { ...prev, ideal_type: e.target.value } : prev
                                )
                              }
                              rows={4}
                              className="mt-1 w-full rounded-md border border-violet-200 bg-white px-3 py-2 text-sm text-neutral-900"
                            />
                          </label>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void handleAdminSaveOpenCard(card.id)}
                              disabled={savingAdminOpenCard}
                              className="h-9 rounded-md bg-violet-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                            >
                              {savingAdminOpenCard ? "저장 중..." : "수정 저장"}
                            </button>
                            <button
                              type="button"
                              onClick={closeAdminOpenCardEditor}
                              disabled={savingAdminOpenCard}
                              className="h-9 rounded-md border border-violet-200 bg-white px-3 text-xs font-medium text-violet-800 disabled:opacity-50"
                            >
                              취소
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )
            ) : adminOpenCardApplications.length === 0 && adminPaidCardApplications.length === 0 ? (
              <p className="text-sm text-neutral-600">등록된 지원 이력이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {adminOpenCardApplications.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-violet-700">오픈카드 지원 이력</p>
                    {sortedAdminOpenCardApplications.map((app) => (
                      <div key={app.id} className="rounded-xl border border-violet-200 bg-white p-3">
                        <p className="text-sm font-semibold text-neutral-900">
                          지원서 {app.id.slice(0, 8)}... / 카드 {app.card_id.slice(0, 8)}... / 상태 {app.status}
                        </p>
                        <p className="mt-1 text-[11px] text-neutral-500">
                          지원: {new Date(app.created_at).toLocaleString("ko-KR")}
                          {app.accepted_at ? ` · 수락: ${new Date(app.accepted_at).toLocaleString("ko-KR")}` : ""}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-neutral-600">
                          <span>지원자: {app.applicant_nickname ?? app.applicant_user_id.slice(0, 8)}</span>
                          {app.card_owner_nickname && <span>카드 작성자 {app.card_owner_nickname}</span>}
                          {app.card_display_nickname && <span>카드 닉네임 {app.card_display_nickname}</span>}
                          {app.card_sex && <span>카드 성별: {app.card_sex === "male" ? "남자" : "여자"}</span>}
                          {app.card_status && <span>카드 상태: {app.card_status}</span>}
                          {app.applicant_display_nickname && <span>표시 닉네임: {app.applicant_display_nickname}</span>}
                          {app.age != null && <span>나이 {app.age}</span>}
                          {app.height_cm != null && <span>키 {app.height_cm}cm</span>}
                          {app.region && <span>지역 {app.region}</span>}
                          {app.job && <span>직업 {app.job}</span>}
                          {app.training_years != null && <span>운동 {app.training_years}년</span>}
                        </div>
                        <p className="mt-1 text-xs font-medium text-violet-700">인스타: @{app.instagram_id}</p>
                        {app.intro_text && (
                          <p className="mt-1 text-xs text-neutral-700 whitespace-pre-wrap break-words">
                            자기소개: {app.intro_text}
                          </p>
                        )}
                        {Array.isArray(app.admin_backup_photo_urls) && app.admin_backup_photo_urls.length > 0 && (
                          <div className="mt-2 grid grid-cols-2 gap-2 sm:max-w-sm">
                            {app.admin_backup_photo_urls.map((url, idx) => (
                              <a
                                key={`${app.id}-admin-backup-photo-${idx}`}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="block overflow-hidden rounded-md border border-violet-200 bg-violet-50"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={url}
                                  alt={`관리자 백업 사진 ${idx + 1}`}
                                  loading="lazy"
                                  decoding="async"
                                  className="h-28 w-full object-cover"
                                />
                              </a>
                            ))}
                          </div>
                        )}
                        <p className="mt-1 text-xs text-neutral-500 break-all">
                          사진 경로: {Array.isArray(app.photo_paths) ? app.photo_paths.join(", ") : "-"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                {adminPaidCardApplications.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-rose-700">36시간 카드 지원 이력</p>
                    {sortedAdminPaidCardApplications.map((app) => (
                      <div key={app.id} className="rounded-xl border border-rose-200 bg-rose-50/30 p-3">
                        <p className="text-sm font-semibold text-neutral-900">
                          지원서 {app.id.slice(0, 8)}... / 36시간 카드 {app.card_id.slice(0, 8)}... / 상태 {app.status}
                        </p>
                        <p className="mt-1 text-[11px] text-neutral-500">
                          지원: {new Date(app.created_at).toLocaleString("ko-KR")}
                          {app.accepted_at ? ` · 수락: ${new Date(app.accepted_at).toLocaleString("ko-KR")}` : ""}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-neutral-600">
                          <span>지원자: {app.applicant_nickname ?? app.applicant_user_id.slice(0, 8)}</span>
                          {app.card_owner_nickname && <span>카드 작성자 {app.card_owner_nickname}</span>}
                          {app.card_nickname && <span>카드 닉네임 {app.card_nickname}</span>}
                          {app.card_gender && <span>카드 성별: {app.card_gender === "M" ? "남자" : "여자"}</span>}
                          {app.card_status && <span>카드 상태: {app.card_status}</span>}
                          {app.applicant_display_nickname && <span>표시 닉네임: {app.applicant_display_nickname}</span>}
                          {app.age != null && <span>나이 {app.age}</span>}
                          {app.height_cm != null && <span>키 {app.height_cm}cm</span>}
                          {app.region && <span>지역 {app.region}</span>}
                          {app.job && <span>직업 {app.job}</span>}
                          {app.training_years != null && <span>운동 {app.training_years}년</span>}
                        </div>
                        <p className="mt-1 text-xs font-medium text-rose-700">
                          인스타: {app.instagram_id ? `@${app.instagram_id}` : "-"}
                        </p>
                        {app.intro_text && (
                          <p className="mt-1 text-xs text-neutral-700 whitespace-pre-wrap break-words">
                            자기소개: {app.intro_text}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-neutral-500 break-all">
                          사진 경로: {Array.isArray(app.photo_paths) ? app.photo_paths.join(", ") : "-"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          )}
        </section>
      )}

      {showSettingsSection && (
      <>
      <section className="mb-5">
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("my_cert")}
            className={`h-10 rounded-xl border px-4 text-sm font-medium ${
              activeTab === "my_cert"
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-neutral-300 bg-white text-neutral-700"
            }`}
          >
            내 인증서
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("request_status")}
            className={`h-10 rounded-xl border px-4 text-sm font-medium ${
              activeTab === "request_status"
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-neutral-300 bg-white text-neutral-700"
            }`}
          >
            요청 현황
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab("admin_review")}
              className={`h-10 rounded-xl border px-4 text-sm font-medium ${
                activeTab === "admin_review"
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-300 bg-white text-neutral-700"
              }`}
            >
              관리자 심사
            </button>
          )}
        </div>

        {activeTab === "my_cert" && (
          <>
            <h2 className="mb-3 text-lg font-bold text-neutral-900">내 인증서</h2>
            {approvedRequests.length === 0 ? (
              <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
                발급된 인증서가 없습니다.
              </p>
            ) : (
              <div className="space-y-3">
                {approvedRequests.map((item) => {
                  const cert = item.certificates?.[0];
                  if (!cert) return null;
                  const verifyPath = `/cert/${cert.slug}`;
                  return (
                    <div key={item.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
                      <p className="text-sm font-semibold text-neutral-900">인증번호: {cert.certificate_no}</p>
                      <p className="mt-1 text-xs text-neutral-500">발급일: {timeAgo(cert.issued_at)}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <a
                          href={cert.pdf_url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex h-9 items-center rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white"
                        >
                          PDF 다운로드
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            const origin = typeof window !== "undefined" ? window.location.origin : "";
                            copyToClipboard(`${origin}${verifyPath}`);
                          }}
                          className="h-9 rounded-lg bg-neutral-900 px-3 text-xs font-medium text-white"
                        >
                          검증 링크 복사
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {activeTab === "request_status" && (
          <>
            <h2 className="mb-3 text-lg font-bold text-neutral-900">요청 현황</h2>
            {certRequests.length === 0 ? (
              <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
                인증 요청 내역이 없습니다.
              </p>
            ) : (
              <div className="space-y-3">
                {certRequests.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
                    <p className="text-sm font-semibold text-neutral-900">
                      제출코드: <span className="font-bold">{item.submit_code}</span>
                    </p>
                    <p className="mt-1 text-xs text-neutral-500">
                      상태: {item.status} / 합계 {item.total}kg / {timeAgo(item.created_at)}
                    </p>
                    {item.video_url && (
                      <p className="mt-1 break-all text-xs text-neutral-600">
                        영상 링크:{" "}
                        <a href={item.video_url} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                          {item.video_url}
                        </a>
                      </p>
                    )}
                    {item.status === "needs_info" && item.admin_note && (
                      <p className="mt-2 text-xs text-amber-700">관리자 요청: {item.admin_note}</p>
                    )}
                    {item.status === "rejected" && item.admin_note && (
                      <p className="mt-2 text-xs text-red-700">거절 사유: {item.admin_note}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "admin_review" && (
          <>
            {isAdmin ? (
              <>
                <h2 className="mb-3 text-lg font-bold text-neutral-900">관리자 심사</h2>
                <AdminCertReviewPanel />
              </>
            ) : (
              <p className="text-sm text-red-600">403: 접근 권한이 없습니다.</p>
            )}
          </>
        )}
      </section>

      </>
      )}

      {showSettingsSection && (
      <section className="mb-6 rounded-xl border border-neutral-200 bg-white/70 px-4 py-3 text-xs text-neutral-500">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-neutral-700">안내 수신 설정</p>
            <p className="mt-1 leading-5">
              오픈카드 재등록, 1:1 매칭 등 서비스 안내 메일/문자를 받고 싶지 않으면 수신거부할 수 있습니다.
            </p>
            {marketingConsentMessage ? (
              <p className={`mt-1 ${marketingConsentMessage.includes("못했습니다") || marketingConsentMessage.includes("실패") ? "text-rose-600" : "text-emerald-700"}`}>
                {marketingConsentMessage}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void handleToggleMarketingConsent()}
            disabled={marketingConsentLoading || marketingOptedOut === null}
            className="h-8 shrink-0 rounded-lg border border-neutral-300 bg-white px-3 text-[11px] font-medium text-neutral-700 disabled:opacity-50"
          >
            {marketingConsentLoading
              ? "저장 중..."
              : marketingOptedOut === true
                ? "수신거부 해제"
                : "수신거부"}
          </button>
        </div>
      </section>
      )}

      {nicknameOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-[max(16px,env(safe-area-inset-bottom))]">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4">
            <h3 className="text-base font-semibold text-neutral-900">닉네임 변경</h3>
            <p className="mt-1 text-xs text-neutral-600">2~12자, 한글/영문/숫자/_ 만 사용 가능합니다.</p>

            <input
              type="text"
              value={newNickname}
              onChange={(e) => setNewNickname(e.target.value)}
              placeholder="새 닉네임"
              maxLength={12}
              className="mt-3 w-full min-h-[44px] rounded-lg border border-neutral-300 px-3 text-sm"
            />

            {nicknameError && <p className="mt-2 text-xs text-red-600">{nicknameError}</p>}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNicknameOpen(false)}
                className="min-h-[42px] rounded-lg border border-neutral-300 text-sm font-medium text-neutral-700"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleChangeNickname}
                disabled={savingNickname}
                className="min-h-[42px] rounded-lg bg-emerald-600 text-sm font-medium text-white disabled:opacity-50"
              >
                {savingNickname ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

