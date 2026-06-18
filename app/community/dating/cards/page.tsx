"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DatingAdultNotice from "@/components/DatingAdultNotice";
import { isKoreanWeekend } from "@/lib/dating-apply-limits";
import { formatRemainingToKorean } from "@/lib/dating-open";
import {
  SWIPE_PREMIUM_DAILY_LIMIT,
  SWIPE_PREMIUM_DURATION_DAYS,
  SWIPE_PREMIUM_PRICE_KRW,
} from "@/lib/dating-swipe";
import PhoneVerifiedBadge from "@/components/PhoneVerifiedBadge";
import { cacheOpenCardDetail, cachePaidCardDetail } from "@/lib/dating-detail-cache";
import { createClient } from "@/lib/supabase/client";

type PublicCard = {
  id: string;
  sex: "male" | "female";
  display_nickname: string;
  is_phone_verified?: boolean;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  strengths_text: string | null;
  photo_visibility: "blur" | "public";
  total_3lift: number | null;
  is_3lift_verified: boolean;
  image_urls: string[];
  expires_at: string | null;
  created_at: string;
};

type QueueStats = {
  male: {
    pending_count: number;
    public_count: number;
    slot_limit: number;
    pending_regions?: Array<{ city: string; count: number }>;
  };
  female: {
    pending_count: number;
    public_count: number;
    slot_limit: number;
    pending_regions?: Array<{ city: string; count: number }>;
  };
  accepted_matches_count?: number;
  recent_open_card_applications_24h_count?: number;
  today_open_card_applications_count?: number;
  today_paid_card_applications_count?: number;
  today_swipe_likes_count?: number;
  today_one_on_one_mutual_matches_count?: number;
  today_dating_reactions_count?: number;
  one_on_one_applicants_count?: number;
  one_on_one_matches_count?: number;
};
type MoreViewStatus = "none" | "pending" | "approved" | "rejected";
type MoreViewStatusResponse = {
  ok?: boolean;
  loggedIn?: boolean;
  male?: MoreViewStatus;
  female?: MoreViewStatus;
};

type HomeAdLinkSetting = {
  enabled: boolean;
  title: string;
  description?: string;
  cta?: string;
  linkUrl: string;
  badge?: string;
  theme?: "emerald" | "rose" | "violet" | "sky" | "amber" | "neutral";
};

type OpenCardHomeCopySetting = {
  subtitle: string;
};

const DEFAULT_OPEN_CARD_HOME_SUBTITLE = "둘러보고 바로 지원하거나, 내 카드도 자연스럽게 공개할 수 있어요.";

const homeAdLinkThemeClass: Record<NonNullable<HomeAdLinkSetting["theme"]>, { wrap: string; text: string; cta: string }> = {
  emerald: {
    wrap: "border-emerald-200 bg-emerald-50 hover:border-emerald-300 hover:bg-emerald-100",
    text: "text-emerald-900",
    cta: "text-emerald-700",
  },
  rose: {
    wrap: "border-rose-200 bg-rose-50 hover:border-rose-300 hover:bg-rose-100",
    text: "text-rose-900",
    cta: "text-rose-700",
  },
  violet: {
    wrap: "border-violet-200 bg-violet-50 hover:border-violet-300 hover:bg-violet-100",
    text: "text-violet-900",
    cta: "text-violet-700",
  },
  sky: {
    wrap: "border-sky-200 bg-sky-50 hover:border-sky-300 hover:bg-sky-100",
    text: "text-sky-900",
    cta: "text-sky-700",
  },
  amber: {
    wrap: "border-amber-200 bg-amber-50 hover:border-amber-300 hover:bg-amber-100",
    text: "text-amber-900",
    cta: "text-amber-700",
  },
  neutral: {
    wrap: "border-neutral-200 bg-neutral-50 hover:border-neutral-300 hover:bg-neutral-100",
    text: "text-neutral-900",
    cta: "text-neutral-700",
  },
};

type PaidCard = {
  id: string;
  nickname: string;
  is_phone_verified?: boolean;
  gender: "M" | "F";
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  is_3lift_verified: boolean;
  strengths_text: string | null;
  ideal_text: string | null;
  thumbUrl: string;
  expires_at: string | null;
  created_at: string;
  display_mode?: "priority_24h" | "instant_public";
};

type SwipeCandidate = {
  user_id: string;
  card_id: string;
  sex: "male" | "female";
  display_nickname: string;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  strengths_text: string | null;
  total_3lift: number | null;
  is_3lift_verified: boolean;
  photo_visibility: "blur" | "public";
  image_url: string | null;
  source_status: string;
  created_at: string;
};

type SwipeState = {
  loggedIn: boolean;
  canSwipe: boolean;
  remaining: number;
  limit: number;
  candidate: SwipeCandidate | null;
  reason: string | null;
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

type SwipeRequestOptions = {
  preferCache?: boolean;
  silent?: boolean;
};

type HomeFeatureTab = "open_cards" | "quick_match" | "one_on_one" | "love_fortune";

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
  next_refresh_at?: string | null;
  can_refresh?: boolean;
  recommendations?: OneOnOneCardPreview[];
  admin_recommendation_date?: string | null;
  admin_recommendations?: OneOnOneCardPreview[];
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
  created_at?: string | null;
};

const ONE_ON_ONE_CONTACT_CANCEL_DELAY_MS = 48 * 60 * 60 * 1000;

function canCancelOneOnOneMatchPreview(match: OneOnOneMatchPreview) {
  if (match.state !== "mutual_accepted" && match.state !== "candidate_accepted") return false;
  if (match.contact_exchange_status !== "approved") return true;
  const approvedMs = Date.parse(match.contact_exchange_approved_at ?? "");
  return Number.isFinite(approvedMs) && Date.now() - approvedMs >= ONE_ON_ONE_CONTACT_CANCEL_DELAY_MS;
}

type OneOnOneHomeState = {
  status: { canWrite?: boolean; totalApplications?: number; phoneVerified?: boolean; reason?: string | null } | null;
  myCards: OneOnOneCardPreview[];
  matches: OneOnOneMatchPreview[];
  recommendations: OneOnOneRecommendationGroup[];
};

type ReelsDatingListing = {
  id: string;
  title: string;
  description: string | null;
  instagram_url?: string | null;
  status: "active" | "hidden";
  sort_order: number | null;
  created_at: string;
};

const PAGE_SIZE = 20;
const OPEN_CARDS_CACHE_KEY = "community-dating-open-cards:v1";
const OPEN_KAKAO_URL = process.env.NEXT_PUBLIC_OPENKAKAO_URL ?? "https://open.kakao.com/o/s2gvTdhi";
const PAYMENT_CARD_UNAVAILABLE_MESSAGE =
  "현재 국민/우리/현대 카드는 결제가 되지 않습니다. 다른 카드나 다른 결제수단으로 다시 시도해 주세요.";

const HOME_FEATURE_TABS: Array<{ key: HomeFeatureTab; label: string; body: string }> = [
  { key: "open_cards", label: "오픈카드", body: "카드 목록" },
  { key: "quick_match", label: "빠른매칭", body: "랜덤 후보" },
  { key: "one_on_one", label: "1대1매칭", body: "후보 확인" },
  { key: "love_fortune", label: "연애운", body: "ADMIN" },
];

type OpenCardsSnapshot = {
  activeSex: "male" | "female";
  males: PublicCard[];
  females: PublicCard[];
  maleCursorCreatedAt: string | null;
  maleCursorId: string | null;
  femaleCursorCreatedAt: string | null;
  femaleCursorId: string | null;
  maleHasMore: boolean;
  femaleHasMore: boolean;
  queueStats: QueueStats | null;
  paidItems: PaidCard[];
  moreViewMale: PublicCard[];
  moreViewFemale: PublicCard[];
  scrollY?: number;
};

function buildLoginRedirect(path: string) {
  return `/login?redirect=${encodeURIComponent(path)}`;
}

function normalizeReelsInstagramId(value: string) {
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "").slice(0, 30);
}

function validReelsInstagramId(value: string) {
  return /^[A-Za-z0-9._]{1,30}$/.test(value);
}

type CardVisualTheme = {
  shell: string;
  halo: string;
  badge: string;
  chip: string;
  symbol: string;
  overlay: string;
};

const CARD_VISUAL_THEMES: CardVisualTheme[] = [
  {
    shell: "from-rose-100 via-rose-200 to-stone-500",
    halo: "bg-rose-200/60",
    badge: "bg-white/20 text-white backdrop-blur",
    chip: "border-white/30 bg-white/18 text-white",
    symbol: "text-rose-800/35",
    overlay: "from-transparent via-rose-200/8 to-black/35",
  },
  {
    shell: "from-sky-100 via-indigo-100 to-slate-500",
    halo: "bg-sky-200/55",
    badge: "bg-white/20 text-white backdrop-blur",
    chip: "border-white/30 bg-white/18 text-white",
    symbol: "text-sky-900/30",
    overlay: "from-transparent via-sky-200/8 to-black/35",
  },
  {
    shell: "from-emerald-100 via-teal-100 to-stone-500",
    halo: "bg-emerald-200/55",
    badge: "bg-white/20 text-white backdrop-blur",
    chip: "border-white/30 bg-white/18 text-white",
    symbol: "text-emerald-900/30",
    overlay: "from-transparent via-emerald-200/8 to-black/35",
  },
  {
    shell: "from-violet-100 via-fuchsia-100 to-slate-500",
    halo: "bg-violet-200/55",
    badge: "bg-white/20 text-white backdrop-blur",
    chip: "border-white/30 bg-white/18 text-white",
    symbol: "text-violet-900/30",
    overlay: "from-transparent via-violet-200/8 to-black/35",
  },
  {
    shell: "from-amber-100 via-orange-100 to-stone-500",
    halo: "bg-amber-200/55",
    badge: "bg-white/20 text-white backdrop-blur",
    chip: "border-white/30 bg-white/18 text-white",
    symbol: "text-amber-900/30",
    overlay: "from-transparent via-amber-200/8 to-black/35",
  },
];

function getCardVisualTheme(seed: string) {
  const hash = [...seed].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return CARD_VISUAL_THEMES[hash % CARD_VISUAL_THEMES.length];
}

function isGoldLiftCard(card: { sex: "male" | "female"; total_3lift: number | null; is_3lift_verified: boolean }) {
  if (!card.is_3lift_verified || card.total_3lift == null) return false;
  return (card.sex === "male" && card.total_3lift >= 500) || (card.sex === "female" && card.total_3lift >= 300);
}

function openCardBorderClass(card: { sex: "male" | "female"; total_3lift: number | null; is_3lift_verified: boolean }) {
  return isGoldLiftCard(card)
    ? "border-amber-300 shadow-[0_0_0_1px_rgba(251,191,36,0.35),0_14px_34px_rgba(180,83,9,0.10)]"
    : "border-black/5 shadow-[0_12px_30px_rgba(15,23,42,0.05)]";
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
  if (state === "source_skipped") return "넘김";
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

function readOpenCardsSnapshot(): OpenCardsSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(OPEN_CARDS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OpenCardsSnapshot;
  } catch {
    return null;
  }
}

function writeOpenCardsSnapshot(snapshot: OpenCardsSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(OPEN_CARDS_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore cache write errors
  }
}

function withPaymentCardNotice(message: string) {
  return `${message}\n${PAYMENT_CARD_UNAVAILABLE_MESSAGE}`;
}

function maskIdealTypeForPreview(value: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const sensitivePattern =
    /(010|@|kakao|openchat|instagram|insta|\uCE74\uD1A1|\uC624\uD508\uCC44\uD305|\uC778\uC2A4\uD0C0)/i;
  if (sensitivePattern.test(raw)) return "***";
  return raw;
}

const BIRTH_TIME_OPTIONS = [
  { key: "unknown", label: "모름", time: "괜찮아요" },
  { key: "ja", label: "자시", time: "23-1시" },
  { key: "chuk", label: "축시", time: "1-3시" },
  { key: "in", label: "인시", time: "3-5시" },
  { key: "myo", label: "묘시", time: "5-7시" },
  { key: "jin", label: "진시", time: "7-9시" },
  { key: "sa", label: "사시", time: "9-11시" },
  { key: "oh", label: "오시", time: "11-13시" },
  { key: "mi", label: "미시", time: "13-15시" },
  { key: "sin", label: "신시", time: "15-17시" },
  { key: "yu", label: "유시", time: "17-19시" },
  { key: "sul", label: "술시", time: "19-21시" },
  { key: "hae", label: "해시", time: "21-23시" },
];

const LOVE_STATE_OPTIONS = [
  "솔로",
  "썸/연락 중",
  "연애 중",
  "최근 이별",
  "재회 고민",
  "결혼 고민",
];

const LOVE_FOCUS_OPTIONS = [
  "나의 연애 성향",
  "잘 맞는 상대",
  "연애가 풀리는 시기",
  "연락과 첫 만남",
  "재회 가능성",
  "궁합 포인트",
];

const CALENDAR_OPTIONS = [
  { key: "solar", label: "양력" },
  { key: "lunar", label: "음력" },
  { key: "lunar_leap", label: "음력 윤달" },
];

const FORTUNE_GENDER_OPTIONS = [
  { key: "female", label: "여성" },
  { key: "male", label: "남성" },
  { key: "other", label: "선택 안 함" },
];

const LOVE_FORTUNE_BIRTH_YEARS = Array.from({ length: 69 }, (_, index) => String(2008 - index));
const LOVE_FORTUNE_BIRTH_MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
const LOVE_FORTUNE_BIRTH_DAYS = Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, "0"));

const LOVE_FORTUNE_STEMS = ["갑", "을", "병", "정", "무", "기", "경", "신", "임", "계"];
const LOVE_FORTUNE_BRANCHES = ["자", "축", "인", "묘", "진", "사", "오", "미", "신", "유", "술", "해"];
const LOVE_FORTUNE_ELEMENTS = ["목", "화", "토", "금", "수"];

function getLoveFortuneBirthDays(year: string, month: string) {
  if (!year || !month) return LOVE_FORTUNE_BIRTH_DAYS;
  const daysInMonth = new Date(Number(year), Number(month), 0).getDate();
  return LOVE_FORTUNE_BIRTH_DAYS.slice(0, daysInMonth);
}

const RELATIONSHIP_GOAL_OPTIONS = [
  "진지한 연애",
  "가벼운 만남보다 안정감",
  "결혼까지 생각",
  "일단 좋은 사람 찾기",
  "재회/관계 회복",
  "썸을 연애로 발전",
  "첫 만남에서 자연스럽게 이어가기",
  "나와 맞는 사람 찾기",
];

const MEETING_STYLE_OPTIONS = [
  "천천히 알아가는 만남",
  "대화가 잘 맞으면 빠르게 만나보기",
  "목적이 분명한 만남",
  "아직 모르겠음",
  "상대가 먼저 다가오면 좋음",
  "대화 후 천천히 결정",
];

const PARTNER_RELATION_OPTIONS = [
  "상대 없음",
  "썸/소개팅 상대",
  "연애 중인 상대",
  "재회 고민 상대",
  "궁합만 보고 싶은 상대",
];

const LOVE_REPEAT_PATTERN_OPTIONS = [
  "아직 잘 모르겠음",
  "초반엔 잘 되다가 연락이 식어요",
  "내가 더 좋아하면 불안해져요",
  "좋은 사람보다 어려운 사람에게 끌려요",
  "표현을 아끼다가 오해를 만들어요",
  "상대가 다가오면 오히려 조심스러워져요",
];

const LOVE_CONTACT_STYLE_OPTIONS = [
  "연락은 편하게 하는 편",
  "답장이 늦으면 계속 신경 쓰임",
  "먼저 연락을 잘 못 함",
  "좋아질수록 말이 많아짐",
  "좋아질수록 오히려 조심스러워짐",
  "상대 텐션에 맞추는 편",
];

const LOVE_ANXIETY_MOMENT_OPTIONS = [
  "딱히 크게 불안한 순간은 없음",
  "상대 답장이 늦어질 때",
  "관계가 애매하게 정의되지 않을 때",
  "상대가 약속을 미룰 때",
  "내 마음이 더 커진 것 같을 때",
  "상대가 전보다 덜 다정할 때",
  "첫 만남 이후 다음 약속이 안 잡힐 때",
];

const LOVE_FORTUNE_MASCOT_SRC = "/mascot/love-fortune-cat.png";
const DEFAULT_JIMNYANG_MASCOT_SRC = "/mascot/jimnyang-guide-v2.png";

const DETAIL_QUESTION_GROUPS = [
  {
    title: "명식 기준",
    items: ["양력/음력/윤달 여부", "태어난 시간 확실도", "출생지 또는 해외 출생 여부"],
  },
  {
    title: "연애 국면",
    items: ["현재 관계 상태", "최근 가장 큰 고민", "연애 목표", "원하는 만남 방식", "결혼/장기연애 의향"],
  },
  {
    title: "상대와 궁합",
    items: ["상대 생년월일", "상대 태어난 시간", "상대와의 관계 단계", "보고 싶은 궁합 포인트"],
  },
  {
    title: "첫 만남 행동",
    items: ["첫 연락 방식", "첫 만남 장소", "답장 텀 고민", "처음 보여주면 좋은 매력"],
  },
];

const LOVE_FORTUNE_REPORT_SECTIONS = [
  "입력 신뢰도",
  "명식 핵심 요약",
  "대운과 연애 흐름",
  "개인 패턴 적중 포인트",
  "반복되는 연애 패턴",
  "내 연애 타입",
  "끌리는 사람 vs 오래 맞는 사람",
  "이번 주 연애 타이밍",
  "첫 만남에서 바로 쓰는 처방",
  "잘 맞는 인상 카드",
  "궁합/상대 정보 포인트",
  "썸/첫 만남 행동 가이드",
  "연락 타이밍 가이드",
  "피해야 할 상대 유형",
  "첫 만남 대화 방향",
  "현실 행동 가이드",
];

function pickBySeed(seed: number, values: string[]) {
  return values[Math.abs(seed) % values.length];
}

function makeLoveFortunePreview(
  birthDate: string,
  birthTime: string,
  loveState: string,
  focus: string,
  calendarType: string,
  gender: string,
  concern: string,
  birthTimeCertainty: string = "unknown",
  relationshipGoal: string = "",
  meetingPreference: string = ""
) {
  const compact = birthDate.replace(/\D/g, "");
  const seed =
    compact.split("").reduce((sum, value) => sum + Number(value || 0), 0) +
    birthTime.length +
    loveState.length +
    focus.length +
    calendarType.length +
    gender.length +
    concern.length +
    birthTimeCertainty.length +
    relationshipGoal.length +
    meetingPreference.length;
  const month = Number(compact.slice(4, 6) || 0);
  const calendarLabel = CALENDAR_OPTIONS.find((item) => item.key === calendarType)?.label ?? "양력";
  const genderLabel = FORTUNE_GENDER_OPTIONS.find((item) => item.key === gender)?.label ?? "선택 안 함";
  const seasonTone =
    month >= 3 && month <= 5
      ? "표현이 부드럽고 첫인상을 편하게 만드는 흐름"
      : month >= 6 && month <= 8
        ? "확신이 생기면 빠르게 다가가는 뜨거운 흐름"
        : month >= 9 && month <= 11
          ? "신중하지만 한번 마음을 정하면 오래 보는 흐름"
          : "조용히 관찰하다가 깊게 빠지는 흐름";
  const timeTone =
    birthTime === "unknown"
      ? "태어난 시간을 몰라도 큰 흐름은 충분히 볼 수 있어요."
      : `${BIRTH_TIME_OPTIONS.find((item) => item.key === birthTime)?.label ?? "선택한 시간"} 기운이 더해져 감정의 온도 조절이 중요한 편이에요.`;
  const dayStem = LOVE_FORTUNE_STEMS[(seed + month) % LOVE_FORTUNE_STEMS.length];
  const dayBranch = LOVE_FORTUNE_BRANCHES[(seed + 3) % LOVE_FORTUNE_BRANCHES.length];
  const monthElement = LOVE_FORTUNE_ELEMENTS[(seed + 2) % LOVE_FORTUNE_ELEMENTS.length];
  const relationshipPalace = pickBySeed(seed + 17, ["배우자궁 안정형", "관계궁 조율형", "도화 기운 관찰형", "속도 조절형"]);

  return {
    headline: pickBySeed(seed + 11, [
      "처음엔 천천히 보지만, 맞는 결 앞에서는 오래 깊어지는 명식이에요.",
      "도화가 크게 튀기보다 관계궁이 편해질 때 마음이 열리는 흐름이에요.",
      "조건보다 대화의 온도와 약속의 안정감에서 인연이 살아나요.",
      "끌림을 오래 가게 만들려면 초반 속도보다 신뢰의 결을 봐야 해요.",
    ]),
    dayStem,
    dayBranch,
    monthElement,
    relationshipPalace,
    accuracy: `${calendarLabel} 기준으로 먼저 보고 있어요. 성별은 ${genderLabel}로 표시되며, 실제 상세 풀이에서는 절기 기준 만세력 계산과 태어난 시간 확실도를 함께 확인하는 흐름이 좋아요.`,
    expertCheck: birthTimeCertainty === "exact"
      ? "태어난 시간이 비교적 정확하다면 시주까지 반영한 연애 패턴을 더 깊게 볼 수 있어요."
      : birthTimeCertainty === "about"
        ? "태어난 시간이 대략적이면 핵심 성향은 보되, 세부 타이밍은 범위형으로 안내하는 편이 신뢰감 있어요."
        : "태어난 시간을 모를 때는 성향과 관계 패턴 중심으로 보고, 타이밍 단정은 줄이는 편이 안전해요.",
    personality: `${dayStem}${dayBranch}의 결로 보면 ${seasonTone}이 먼저 보여요. ${pickBySeed(seed, [
      "가볍게 시작해도 대화가 맞으면 마음의 집중이 빠르게 깊어지는 편입니다.",
      "상대의 태도와 말투를 세밀하게 읽고, 작은 어긋남에도 관계궁이 예민하게 반응합니다.",
      "첫인상보다 두 번째, 세 번째 만남에서 매력이 올라오는 명식입니다.",
      "처음엔 담백하지만 관계가 안정되면 애정 표현이 분명해지는 흐름입니다.",
    ])}`,
    match: pickBySeed(seed + 3, [
      "말의 온도가 부드럽고 약속을 가볍게 여기지 않는 사람이 오래 맞습니다.",
      "생활 루틴과 가치관의 리듬이 비슷한 사람에게 관계궁이 편하게 열립니다.",
      "초반에 몰아붙이기보다 여유 있게 다가오는 사람과 흐름이 좋습니다.",
      "자기 일이 있으면서도 감정 표현을 숨기지 않는 사람에게 마음이 안정됩니다.",
    ]),
    caution: `${timeTone} ${pickBySeed(seed + 7, [
      "상대 반응을 혼자 해석하기보다 짧게 확인하는 게 좋아요.",
      "처음부터 완벽한 확신을 기다리면 좋은 타이밍을 놓칠 수 있어요.",
      "호감이 있을수록 답장 속도보다 대화의 질을 보는 게 좋아요.",
      "소개팅에서는 조건보다 실제 대화 텐션을 먼저 체크해보세요.",
    ])}`,
    concernGuide: concern.trim()
      ? `입력한 고민은 "${concern.trim().slice(0, 48)}${concern.trim().length > 48 ? "..." : ""}" 쪽이에요. 상세 분석에서는 이 고민을 기준으로 타이밍, 대화 방식, 피해야 할 패턴을 나눠주면 설득력이 올라갑니다.`
      : "상세 분석에서는 지금 가장 궁금한 고민을 한 줄로 받으면 결과가 훨씬 개인화돼 보여요.",
    paidHint: focus === "잘 맞는 인상"
        ? "상세 기능에서는 내 연애 흐름에 잘 맞는 인상, 분위기, 첫 만남에서 편한 상대 특징까지 카드처럼 보여주면 좋아요."
        : "상세 기능에서는 상대 성향, 궁합 포인트, 이번 주 연애 타이밍, 관계에서 조심할 패턴까지 이어서 풀어주는 구조가 좋아요.",
    action: pickBySeed(seed + 13, [
      "처음부터 강하게 어필하기보다 생활 루틴과 대화 취향을 편하게 보여주는 쪽이 좋아요.",
      "사진보다 첫 문장과 생활권, 대화 온도가 잘 맞는 사람부터 보는 게 유리해요.",
      "조건을 너무 좁히기보다 실제 대화가 편한 후보를 먼저 확인하는 흐름이 좋아요.",
      "지금은 내 매력을 과장하기보다 오래 볼 수 있는 사람에게 신뢰를 주는 태도가 좋아요.",
    ]),
    goalGuide: relationshipGoal || meetingPreference
      ? `${relationshipGoal || "연애 목표"} 기준으로 보면 ${meetingPreference || "맞는 만남 방식"}에 맞춘 행동 제안까지 이어볼 수 있어요.`
      : "상세 풀이에서는 현재 마음의 방향과 반복 패턴을 같이 읽어야 행동 처방이 더 선명해져요.",
  };
}

type LoveFortuneHistoryReading = {
  id: string;
  status: string;
  birthDate: string;
  calendarType: string;
  gender: string;
  loveState: string | null;
  focus: string | null;
  concern: string | null;
  amount: number;
  aiResult: string | null;
  generatedAt: string | null;
  createdAt: string;
  idealFace: {
    title?: string;
    eye?: string;
    smile?: string;
    mood?: string;
    style?: string;
    firstDate?: string;
    avoid?: string;
    note?: string;
  } | null;
};

function parseLoveFortuneHistoryReport(text: string | null) {
  if (!text) return [];
  const sections: Array<{ title: string; body: string }> = [];
  let currentTitle = "상세 풀이";
  let currentLines: string[] = [];

  for (const rawLine of text.replace(/```/g, "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*/g, "").split(/\r?\n/)) {
    const heading = rawLine.trim().match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      if (currentLines.join("\n").trim()) {
        sections.push({ title: currentTitle, body: currentLines.join("\n").trim() });
      }
      currentTitle = heading[1]?.trim() || "상세 풀이";
      currentLines = [];
      continue;
    }
    currentLines.push(rawLine);
  }

  if (currentLines.join("\n").trim()) {
    sections.push({ title: currentTitle, body: currentLines.join("\n").trim() });
  }

  return sections.length > 0 ? sections : [{ title: "상세 풀이", body: text.trim() }];
}

function AdminLoveFortunePanel() {
  const [birthYear, setBirthYear] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthTime, setBirthTime] = useState("unknown");
  const [birthTimeCertainty, setBirthTimeCertainty] = useState("unknown");
  const [birthPlace, setBirthPlace] = useState("");
  const [calendarType, setCalendarType] = useState("solar");
  const [gender, setGender] = useState("other");
  const [loveState, setLoveState] = useState(LOVE_STATE_OPTIONS[0]);
  const [focus, setFocus] = useState(LOVE_FOCUS_OPTIONS[0]);
  const [relationshipGoal] = useState("");
  const [meetingPreference] = useState("");
  const [concern, setConcern] = useState("");
  const [repeatPattern, setRepeatPattern] = useState(LOVE_REPEAT_PATTERN_OPTIONS[0]);
  const [contactStyle, setContactStyle] = useState(LOVE_CONTACT_STYLE_OPTIONS[0]);
  const [anxietyMoment, setAnxietyMoment] = useState(LOVE_ANXIETY_MOMENT_OPTIONS[0]);
  const [partnerFeedback, setPartnerFeedback] = useState("");
  const partnerBirthDate = "";
  const partnerBirthTime = "unknown";
  const partnerRelation = PARTNER_RELATION_OPTIONS[0];
  const [detailOpen, setDetailOpen] = useState(false);
  const [fortuneStep, setFortuneStep] = useState(0);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyReadings, setHistoryReadings] = useState<LoveFortuneHistoryReading[]>([]);
  const [selectedHistoryReading, setSelectedHistoryReading] = useState<LoveFortuneHistoryReading | null>(null);
  const birthDayOptions = useMemo(() => getLoveFortuneBirthDays(birthYear, birthMonth), [birthMonth, birthYear]);
  const birthDate = birthYear && birthMonth && birthDay ? `${birthYear}-${birthMonth}-${birthDay}` : "";
  const canPreview = /^\d{4}-\d{2}-\d{2}$/.test(birthDate);
  const personalizedConcern = useMemo(() => {
    const lines = [
      concern.trim() ? `현재 고민: ${concern.trim()}` : "",
      repeatPattern !== LOVE_REPEAT_PATTERN_OPTIONS[0] ? `반복 패턴: ${repeatPattern}` : "",
      contactStyle !== LOVE_CONTACT_STYLE_OPTIONS[0] ? `연락 스타일: ${contactStyle}` : "",
      anxietyMoment !== LOVE_ANXIETY_MOMENT_OPTIONS[0] ? `불안해지는 순간: ${anxietyMoment}` : "",
      partnerFeedback.trim() ? `상대에게 자주 듣는 말: ${partnerFeedback.trim()}` : "",
    ].filter(Boolean);

    return lines.join("\n").slice(0, 680);
  }, [anxietyMoment, concern, contactStyle, partnerFeedback, repeatPattern]);
  const preview = canPreview
    ? makeLoveFortunePreview(
        birthDate,
        birthTime,
        loveState,
        focus,
        calendarType,
        gender,
        personalizedConcern || concern,
        birthTimeCertainty,
        relationshipGoal,
        meetingPreference
      )
    : null;

  useEffect(() => {
    if (birthDay && !birthDayOptions.includes(birthDay)) {
      setBirthDay("");
    }
  }, [birthDay, birthDayOptions]);

  const requestLoveFortuneCheckout = useCallback(async () => {
    if (!canPreview || checkoutLoading) return;
    setCheckoutLoading(true);
    setCheckoutError("");
    try {
      const res = await fetch("/api/payments/toss/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productType: "love_fortune_detail",
          birthDate,
          birthTime,
          birthTimeCertainty,
          birthPlace,
          calendarType,
          gender,
          loveState,
          focus,
          relationshipGoal,
          meetingPreference,
          concern: personalizedConcern || concern,
          partnerBirthDate,
          partnerBirthTime,
          partnerRelation,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; checkoutUrl?: string };
      if (!res.ok || !body.checkoutUrl) {
        throw new Error(withPaymentCardNotice(body.message ?? "연애운 결제를 시작하지 못했습니다."));
      }
      window.location.href = body.checkoutUrl;
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : withPaymentCardNotice("연애운 결제를 시작하지 못했습니다."));
    } finally {
      setCheckoutLoading(false);
    }
  }, [
    birthDate,
    birthPlace,
    birthTime,
    birthTimeCertainty,
    calendarType,
    canPreview,
    checkoutLoading,
    concern,
    focus,
    gender,
    loveState,
    meetingPreference,
    personalizedConcern,
    partnerBirthDate,
    partnerBirthTime,
    partnerRelation,
    relationshipGoal,
  ]);

  const loadLoveFortuneHistory = useCallback(async (force = false) => {
    if (historyLoading || (!force && historyLoaded)) return;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const res = await fetch("/api/mypage/love-fortune", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        readings?: LoveFortuneHistoryReading[];
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.message ?? "이전 운세를 불러오지 못했습니다.");
      }
      setHistoryReadings(body.readings ?? []);
      setHistoryLoaded(true);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "이전 운세를 불러오지 못했습니다.");
    } finally {
      setHistoryLoading(false);
    }
  }, [historyLoaded, historyLoading]);

  const calendarLabel = CALENDAR_OPTIONS.find((item) => item.key === calendarType)?.label ?? "양력";
  const genderLabel = FORTUNE_GENDER_OPTIONS.find((item) => item.key === gender)?.label ?? "선택 안 함";
  const birthTimeLabel = BIRTH_TIME_OPTIONS.find((item) => item.key === birthTime)?.label ?? "모름";
  const step = Math.min(fortuneStep, 4);
  const canShowPaidDetail = step >= 4 && Boolean(preview);
  const fortuneProgress = Math.max(1, Math.min(step + 1, 5));

  const FortuneAvatar = () => (
    <div className="fortune-avatar mt-1 h-10 w-10 shrink-0 overflow-hidden rounded-full bg-lime-50 ring-2 ring-amber-100/80">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={LOVE_FORTUNE_MASCOT_SRC}
        alt=""
        loading="lazy"
        decoding="async"
        onError={(event) => {
          event.currentTarget.onerror = null;
          event.currentTarget.src = DEFAULT_JIMNYANG_MASCOT_SRC;
        }}
        className="h-full w-full object-cover"
      />
    </div>
  );

  const renderBotBubble = (children: React.ReactNode) => (
    <div className="fortune-bubble fortune-bubble-bot flex gap-3">
      <FortuneAvatar />
      <div className="max-w-[86%] rounded-[24px] rounded-tl-md border border-amber-100/80 bg-[#fffaf0] px-4 py-3 shadow-[0_12px_28px_rgba(59,28,9,0.08)]">{children}</div>
    </div>
  );

  const renderUserBubble = (children: React.ReactNode, tone: "dark" | "rose" | "light" = "dark") => (
    <div className="fortune-bubble fortune-bubble-user flex justify-end">
      <div
        className={`max-w-[82%] rounded-[24px] rounded-tr-md px-4 py-3 ${
          tone === "rose"
            ? "bg-[#7a2f22] text-[#fff8ec] shadow-[0_12px_26px_rgba(87,39,18,0.18)]"
            : tone === "light"
              ? "bg-[#fff4dc] text-[#2b2118] shadow-[0_12px_26px_rgba(120,53,15,0.08)]"
              : "bg-[#211710] text-[#fff8ec] shadow-[0_12px_26px_rgba(0,0,0,0.16)]"
        }`}
      >
        {children}
      </div>
    </div>
  );

  return (
    <section className="fortune-room relative isolate mx-auto mb-5 max-w-2xl overflow-hidden rounded-[30px] border border-[#d6c29d] bg-[#2a2016] p-3 text-neutral-900 shadow-[0_18px_55px_rgba(69,26,3,0.18)] md:p-5">
      <style>{`
        .fortune-room::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: -2;
          background:
            radial-gradient(circle at 12% 8%, rgba(184, 122, 47, 0.24), transparent 24%),
            radial-gradient(circle at 88% 0%, rgba(120, 34, 24, 0.22), transparent 28%),
            radial-gradient(circle at 50% 118%, rgba(215, 190, 145, 0.15), transparent 34%),
            linear-gradient(145deg, #2b2118 0%, #3a2a1f 45%, #17130f 100%);
        }
        .fortune-room::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: -1;
          opacity: 0.2;
          background-image:
            linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px);
          background-size: 34px 34px;
          mask-image: radial-gradient(circle at center, black 0%, transparent 78%);
          pointer-events: none;
        }
        .fortune-chat-stage {
          animation: fortuneStageIn 360ms ease both;
        }
        .fortune-bubble {
          animation: fortuneBubbleIn 360ms cubic-bezier(.2,.9,.2,1) both;
        }
        .fortune-bubble-user {
          animation-name: fortuneUserBubbleIn;
        }
        .fortune-avatar {
          animation: fortuneFloat 3.4s ease-in-out infinite;
        }
        .fortune-choice {
          transition: transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease, background 150ms ease;
        }
        .fortune-choice:active {
          transform: translateY(1px) scale(0.985);
        }
        @keyframes fortuneStageIn {
          from { opacity: 0; transform: translateY(10px); filter: blur(4px); }
          to { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
        @keyframes fortuneBubbleIn {
          from { opacity: 0; transform: translateY(12px) scale(.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fortuneUserBubbleIn {
          from { opacity: 0; transform: translate(10px, 10px) scale(.98); }
          to { opacity: 1; transform: translate(0, 0) scale(1); }
        }
        @keyframes fortuneFloat {
          0%, 100% { transform: translateY(0) rotate(-1deg); }
          50% { transform: translateY(-4px) rotate(1deg); }
        }
      `}</style>
      <div className="mb-4 overflow-hidden rounded-[30px] border border-[#d8c39d] bg-[radial-gradient(circle_at_72%_0%,rgba(154,90,35,0.18),transparent_34%),linear-gradient(135deg,#fff8ec,#f4e5c8)] p-5 shadow-[0_18px_50px_rgba(75,46,24,0.16)]">
        <div className="flex items-start gap-4">
          <div className="fortune-avatar h-16 w-16 shrink-0 overflow-hidden rounded-[24px] bg-white/80 ring-2 ring-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={LOVE_FORTUNE_MASCOT_SRC}
              alt="도화냥"
              loading="lazy"
              decoding="async"
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = DEFAULT_JIMNYANG_MASCOT_SRC;
              }}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black tracking-[0.2em] text-[#8a2f20]">명리 · 연애</p>
            <h2 className="mt-2 text-2xl font-black leading-8 text-[#24170f]">연애 명식 풀이</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              생년월일과 태어난 시간으로 명식의 결을 세우고, 사랑에서 반복되는 흐름을 봅니다.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {["사주팔자", "오행 균형", "배우자궁", "대운 흐름"].map((item) => (
            <div key={item} className="rounded-2xl border border-[#e4d0aa] bg-[#fffaf0]/80 px-3 py-3 text-center text-xs font-black text-[#6b3f24]">
              {item}
            </div>
          ))}
        </div>
      </div>
      <div className="mb-4 overflow-hidden rounded-[24px] border border-amber-200/50 bg-[#fffaf0]/95 shadow-[0_14px_38px_rgba(0,0,0,0.12)] backdrop-blur">
        <button
          type="button"
          onClick={() => {
            const nextOpen = !historyOpen;
            setHistoryOpen(nextOpen);
            if (nextOpen) void loadLoveFortuneHistory(false);
          }}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <div>
            <p className="text-sm font-black text-[#2b2118]">이전 운세 보기</p>
            <p className="mt-1 text-xs font-semibold text-[#8a7353]">결제 후 생성된 연애운 결과를 이 탭에서 다시 볼 수 있어요.</p>
          </div>
          <span className="rounded-full bg-[#2b2118] px-3 py-1 text-xs font-black text-[#fff8ec]">
            {historyOpen ? "닫기" : "열기"}
          </span>
        </button>
        {historyOpen ? (
          <div className="border-t border-amber-100 px-4 pb-4">
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => void loadLoveFortuneHistory(true)}
                disabled={historyLoading}
                className="rounded-full border border-[#d6c29d] bg-white px-3 py-1.5 text-xs font-black text-[#6b3f24] disabled:opacity-50"
              >
                {historyLoading ? "불러오는 중" : "새로고침"}
              </button>
            </div>
            {historyError ? (
              <p className="mt-3 rounded-2xl border border-red-100 bg-red-50 p-3 text-sm font-bold text-red-700">{historyError}</p>
            ) : null}
            {historyLoading && historyReadings.length === 0 ? (
              <p className="mt-3 rounded-2xl bg-white p-3 text-sm font-semibold text-neutral-500">이전 운세를 불러오는 중입니다.</p>
            ) : null}
            {!historyLoading && historyLoaded && historyReadings.length === 0 ? (
              <p className="mt-3 rounded-2xl bg-white p-3 text-sm font-semibold text-neutral-500">아직 저장된 연애운 결과가 없습니다.</p>
            ) : null}
            {historyReadings.length > 0 ? (
              <div className="mt-3 grid gap-2">
                {historyReadings.map((reading) => {
                  const generated = Boolean(reading.aiResult);
                  return (
                    <article key={reading.id} className="rounded-2xl border border-[#ead9bf] bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-black text-neutral-950">
                            {[reading.birthDate, reading.loveState, reading.focus].filter(Boolean).join(" · ") || "연애운 상세 풀이"}
                          </p>
                          <p className="mt-1 text-xs text-neutral-500">
                            {reading.amount.toLocaleString("ko-KR")}원 · {new Date(reading.createdAt).toLocaleString("ko-KR")}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedHistoryReading(reading)}
                          disabled={!generated}
                          className="rounded-full bg-neutral-950 px-3 py-1.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
                        >
                          {generated ? "결과 보기" : "생성 전"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mb-4 flex items-center justify-between gap-3 rounded-[24px] border border-amber-200/50 bg-[#fffaf0]/95 px-4 py-3 shadow-[0_14px_38px_rgba(0,0,0,0.16)] backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="fortune-avatar h-12 w-12 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-lime-100 via-amber-50 to-white ring-2 ring-amber-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={LOVE_FORTUNE_MASCOT_SRC}
              alt="도화냥"
              loading="lazy"
              decoding="async"
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = DEFAULT_JIMNYANG_MASCOT_SRC;
              }}
              className="h-full w-full object-cover"
            />
          </div>
          <div>
            <p className="text-sm font-black text-neutral-950">도화냥</p>
            <p className="text-xs font-semibold text-neutral-500">사주집처럼 하나씩 천천히 봐드릴게요</p>
          </div>
        </div>
        <div className="text-right">
          <span className="inline-flex rounded-full bg-neutral-950 px-3 py-1 text-[11px] font-black text-white">ADMIN</span>
          <p className="mt-1 text-xs font-bold text-amber-700">{fortuneProgress}/5 질문</p>
        </div>
      </div>

      <div key={step} className="fortune-chat-stage space-y-4 rounded-[26px] border border-amber-100/20 bg-white/[0.08] p-3 backdrop-blur-sm md:p-4">
        {renderBotBubble(
          <>
            <p className="text-sm leading-6 text-neutral-800">
              반가워요. 오늘은 사랑 쪽 흐름을 먼저 조용히 짚어볼게요.
            </p>
            <p className="mt-2 text-sm font-black text-neutral-950">먼저 명식의 기준이 되는 생년월일을 알려주세요.</p>
          </>
        )}

        {step === 0 ? (
          <div className="flex gap-3">
            <div className="w-9 shrink-0" />
            <div className="max-w-[86%] rounded-[24px] border border-[#d8c39d] bg-[#f6ead2] px-4 py-3 shadow-sm">
              <div className="flex flex-wrap gap-2">
                {CALENDAR_OPTIONS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setCalendarType(item.key)}
                    className={`fortune-choice rounded-full px-3 py-2 text-xs font-black ${
                      calendarType === item.key ? "bg-[#2b2118] text-[#fff8ec] shadow-md" : "bg-[#fffaf0] text-[#6b3f24] hover:bg-[#f5e4c3]"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <label className="sr-only" htmlFor="love-fortune-birth-year">태어난 연도</label>
                <select
                  id="love-fortune-birth-year"
                  value={birthYear}
                  onChange={(event) => setBirthYear(event.target.value)}
                  className="h-12 rounded-2xl border border-[#d6c29d] bg-[#fffaf0] px-3 text-sm font-black text-[#2b2118] outline-none focus:border-[#8a2f20]"
                >
                  <option value="">년도</option>
                  {LOVE_FORTUNE_BIRTH_YEARS.map((year) => (
                    <option key={year} value={year}>{year}년</option>
                  ))}
                </select>
                <label className="sr-only" htmlFor="love-fortune-birth-month">태어난 월</label>
                <select
                  id="love-fortune-birth-month"
                  value={birthMonth}
                  onChange={(event) => setBirthMonth(event.target.value)}
                  className="h-12 rounded-2xl border border-[#d6c29d] bg-[#fffaf0] px-3 text-sm font-black text-[#2b2118] outline-none focus:border-[#8a2f20]"
                >
                  <option value="">월</option>
                  {LOVE_FORTUNE_BIRTH_MONTHS.map((month) => (
                    <option key={month} value={month}>{Number(month)}월</option>
                  ))}
                </select>
                <label className="sr-only" htmlFor="love-fortune-birth-day">태어난 일</label>
                <select
                  id="love-fortune-birth-day"
                  value={birthDay}
                  onChange={(event) => setBirthDay(event.target.value)}
                  className="h-12 rounded-2xl border border-[#d6c29d] bg-[#fffaf0] px-3 text-sm font-black text-[#2b2118] outline-none focus:border-[#8a2f20]"
                >
                  <option value="">일</option>
                  {birthDayOptions.map((day) => (
                    <option key={day} value={day}>{Number(day)}일</option>
                  ))}
                </select>
              </div>
              <p className="mt-2 text-xs font-semibold text-[#8a7353]">이 생년월일을 기준으로 명식의 큰 줄기를 세웁니다.</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {FORTUNE_GENDER_OPTIONS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setGender(item.key)}
                    className={`fortune-choice rounded-2xl border px-3 py-3 text-sm font-black ${
                      gender === item.key
                        ? "border-[#2b2118] bg-[#2b2118] text-[#fff8ec] shadow-md"
                        : "border-[#d6c29d] bg-[#fffaf0] text-[#6b3f24] hover:border-[#8a2f20] hover:bg-[#f5e4c3]"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={!canPreview}
                onClick={() => setFortuneStep(1)}
                className="mt-3 h-11 w-full rounded-2xl bg-neutral-950 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                다음
              </button>
            </div>
          </div>
        ) : (
          renderUserBubble(<p className="text-sm font-bold">{calendarLabel} · {birthDate} · {genderLabel}</p>)
        )}

        {step >= 1 ? (
          <>
            {renderBotBubble(
              <>
                <p className="text-sm font-black text-neutral-950">태어난 시간은 아세요?</p>
                <p className="mt-1 text-xs leading-5 text-neutral-500">모르면 ‘모름’을 고르셔도 됩니다. 다시 한 번 정확도를 묻지 않아요.</p>
              </>
            )}
            {step === 1 ? (
              <div className="flex gap-3">
                <div className="w-9 shrink-0" />
                <div className="max-w-[86%] rounded-[24px] border border-[#d8c39d] bg-[#f6ead2] px-4 py-3 shadow-sm">
                  <div className="grid grid-cols-3 gap-2">
                    {BIRTH_TIME_OPTIONS.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setBirthTime(item.key);
                          setBirthTimeCertainty(item.key === "unknown" ? "unknown" : "exact");
                        }}
                    className={`fortune-choice rounded-2xl border px-2 py-2 text-center ${
                      birthTime === item.key
                        ? "border-neutral-950 bg-neutral-950 text-white shadow-md"
                        : "border-[#d6c29d] bg-[#fffaf0] text-[#4a3323] hover:border-[#8a2f20] hover:bg-[#f5e4c3]"
                    }`}
                  >
                        <span className="block text-sm font-black">{item.label}</span>
                        <span className={`mt-0.5 block text-[11px] ${birthTime === item.key ? "text-white/70" : "text-neutral-400"}`}>{item.time}</span>
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={birthPlace}
                    onChange={(event) => setBirthPlace(event.target.value.slice(0, 40))}
                    placeholder="태어난 지역도 알면 입력해 주세요"
                    className="mt-3 h-11 w-full rounded-2xl border border-[#d6c29d] bg-[#fffaf0] px-4 text-sm font-semibold text-[#2b2118] outline-none placeholder:text-[#9b8463] focus:border-[#8a2f20]"
                  />
                  <button
                    type="button"
                    onClick={() => setFortuneStep(2)}
                    className="mt-3 h-11 w-full rounded-2xl bg-neutral-950 text-sm font-black text-white"
                  >
                    다음
                  </button>
                </div>
              </div>
            ) : (
              renderUserBubble(<p className="text-sm font-bold">{birthTimeLabel}{birthPlace ? ` · ${birthPlace}` : ""}</p>, "light")
            )}
          </>
        ) : null}

        {step >= 2 ? (
          <>
            {renderBotBubble(
              <>
                <p className="text-sm font-black text-neutral-950">지금 마음의 자리는 어디에 가까워요?</p>
                <p className="mt-1 text-xs leading-5 text-neutral-500">같은 명식도 지금 놓인 관계의 자리마다 풀이의 초점이 달라집니다.</p>
              </>
            )}
            {step === 2 ? (
              <div className="flex gap-3">
                <div className="w-9 shrink-0" />
                <div className="max-w-[86%] rounded-[24px] border border-[#d8c39d] bg-[#f6ead2] px-4 py-3 shadow-sm">
                  <div className="grid gap-2">
                    <select
                      value={loveState}
                      onChange={(event) => setLoveState(event.target.value)}
                      className="h-11 rounded-2xl border border-[#d6c29d] bg-[#fffaf0] px-3 text-sm font-semibold text-[#2b2118] outline-none focus:border-[#8a2f20]"
                    >
                      {LOVE_STATE_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFortuneStep(3)}
                    className="mt-3 h-11 w-full rounded-2xl bg-neutral-950 text-sm font-black text-white"
                  >
                    다음
                  </button>
                </div>
              </div>
            ) : (
              renderUserBubble(
                <>
                  <p className="text-sm font-bold">{loveState}</p>
                </>,
                "rose"
              )
            )}
          </>
        ) : null}

        {step >= 3 ? (
          <>
            {renderBotBubble(
              <>
                <p className="text-sm font-black text-neutral-950">마지막으로, 뭐가 제일 궁금해요?</p>
                <p className="mt-1 text-xs leading-5 text-neutral-500">직접 적어준 고민을 중심으로 풀이가 달라집니다.</p>
              </>
            )}
            {step === 3 ? (
              <div className="flex gap-3">
                <div className="w-9 shrink-0" />
                <div className="max-w-[86%] rounded-[24px] border border-[#d8c39d] bg-[#f6ead2] px-4 py-3 shadow-sm">
                  <select
                    value={focus}
                    onChange={(event) => setFocus(event.target.value)}
                    className="h-11 w-full rounded-2xl border border-[#d6c29d] bg-[#fffaf0] px-3 text-sm font-semibold text-[#2b2118] outline-none focus:border-[#8a2f20]"
                  >
                    {LOVE_FOCUS_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                  </select>
                  <textarea
                    value={concern}
                    onChange={(event) => setConcern(event.target.value.slice(0, 140))}
                    placeholder="예: 마음이 커질수록 불안해져요"
                    className="mt-3 min-h-[84px] w-full rounded-2xl border border-[#d6c29d] bg-[#fffaf0] px-4 py-3 text-sm font-semibold leading-6 text-[#2b2118] outline-none placeholder:text-[#9b8463] focus:border-[#8a2f20]"
                  />
                  <div className="mt-3 grid gap-2">
                    <label className="text-[11px] font-black text-[#8a7353]">자주 반복되는 결이 있다면</label>
                    <select
                      value={repeatPattern}
                      onChange={(event) => setRepeatPattern(event.target.value)}
                      className="h-11 rounded-2xl border border-[#d6c29d] bg-[#fffaf0] px-3 text-sm font-semibold text-[#2b2118] outline-none focus:border-[#8a2f20]"
                    >
                      {LOVE_REPEAT_PATTERN_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                    </select>
                    <input
                      type="text"
                      value={partnerFeedback}
                      onChange={(event) => setPartnerFeedback(event.target.value.slice(0, 70))}
                      placeholder="상대에게 자주 들은 말이 있다면 (선택)"
                      className="h-11 rounded-2xl border border-[#d6c29d] bg-[#fffaf0] px-3 text-sm font-semibold text-[#2b2118] outline-none placeholder:text-[#9b8463] focus:border-[#8a2f20]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setFortuneStep(4)}
                    className="mt-3 h-11 w-full rounded-2xl bg-[#2b2118] text-sm font-black text-[#fff8ec]"
                  >
                    명식 맛보기 보기
                  </button>
                </div>
              </div>
            ) : (
              renderUserBubble(
                <>
                  <p className="text-sm font-bold">{focus}</p>
                  {concern.trim() ? <p className="mt-1 text-xs text-white/80">{concern.trim()}</p> : null}
                  {repeatPattern !== LOVE_REPEAT_PATTERN_OPTIONS[0] ? (
                    <p className="mt-1 text-xs text-white/70">{repeatPattern}</p>
                  ) : null}
                </>,
                "rose"
              )
            )}
          </>
        ) : null}

        {canShowPaidDetail && preview ? (
          <>
            {renderBotBubble(
              <>
                <p className="text-xs font-black text-[#8a2f20]">명식 맛보기</p>
                <p className="mt-2 text-xl font-black leading-8 text-neutral-950">{preview.headline}</p>
                <div className="mt-4 space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-2xl border border-[#e1caa1] bg-[#fff8ec] p-3 text-center">
                      <p className="text-[11px] font-black text-[#8a2f20]">일간</p>
                      <p className="mt-1 text-xl font-black text-[#2b2118]">{preview.dayStem}{preview.dayBranch}</p>
                    </div>
                    <div className="rounded-2xl border border-[#e1caa1] bg-[#fff8ec] p-3 text-center">
                      <p className="text-[11px] font-black text-[#8a2f20]">월 기운</p>
                      <p className="mt-1 text-xl font-black text-[#9a5a23]">{preview.monthElement}</p>
                    </div>
                    <div className="rounded-2xl border border-[#e1caa1] bg-[#fff8ec] p-3 text-center">
                      <p className="text-[11px] font-black text-[#8a2f20]">관계궁</p>
                      <p className="mt-1 text-base font-black text-[#2b2118]">{preview.relationshipPalace}</p>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-[#fff8ec] p-3">
                    <p className="text-xs font-black text-[#8a2f20]">연애 결</p>
                    <p className="mt-1 text-sm leading-6 text-[#4a3323]">{preview.personality}</p>
                  </div>
                  <div className="rounded-2xl bg-[#fff8ec] p-3">
                    <p className="text-xs font-black text-[#9a5a23]">반복 결</p>
                    <p className="mt-1 text-sm leading-6 text-[#4a3323]">
                      {repeatPattern !== LOVE_REPEAT_PATTERN_OPTIONS[0] ? repeatPattern : "아직 반복 패턴은 넓게 볼게요."}
                      {contactStyle !== LOVE_CONTACT_STYLE_OPTIONS[0] ? ` 연락은 ${contactStyle} 쪽으로 반영합니다.` : ""}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[#fff8ec] p-3">
                    <p className="text-xs font-black text-[#315f55]">잘 맞는 상대</p>
                    <p className="mt-1 text-sm leading-6 text-[#4a3323]">{preview.match}</p>
                  </div>
                  <div className="rounded-2xl bg-[#fff8ec] p-3">
                    <p className="text-xs font-black text-[#5c4a2f]">풀이 처방</p>
                    <p className="mt-1 text-sm leading-6 text-[#4a3323]">{preview.action}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailOpen((value) => !value)}
                  className="mt-4 h-12 w-full rounded-2xl bg-neutral-950 text-sm font-black text-white shadow-[0_14px_32px_rgba(0,0,0,0.18)]"
                >
                  {detailOpen ? "상세 닫기" : "내 상세 연애운에서 열리는 것 보기"}
                </button>
              </>
            )}

            {detailOpen ? (
              <>
                {renderBotBubble(
                  <>
                    <p className="text-sm font-black text-neutral-950">상세 풀이에서는 여기까지 열려요.</p>
                    <p className="mt-1 text-xs leading-5 text-neutral-500">
                      맛보기는 명식의 첫 결만 보여드립니다. 상세 풀이에서는 일간, 오행 균형, 배우자궁, 대운 흐름을 묶어서 내 연애가 반복해서 막히는 지점까지 풀어드립니다.
                    </p>
                    <div className="mt-3 overflow-hidden rounded-[22px] border border-amber-100 bg-[#fff8ec]">
                      <div className="border-b border-amber-100 px-4 py-3">
                        <p className="text-xs font-black text-amber-700">상세에서 잠금 해제</p>
                        <p className="mt-1 text-sm font-black leading-6 text-neutral-950">“왜 나는 이 패턴이 반복될까?”를 사주 결로 끝까지 짚어요.</p>
                      </div>
                      <div className="grid gap-2 p-3 text-xs leading-5 text-neutral-600 sm:grid-cols-2">
                        {[
                          "일간과 배우자궁으로 보는 내 연애의 기본 결",
                          "사주 흐름으로 정리한 나와 오래 맞는 배우자 얼굴상",
                          "오행 균형에서 보이는 끌림과 불안의 원인",
                          "대운/세운으로 보는 만남이 열리는 시기",
                          "첫 연락, 첫 만남, 피해야 할 말까지 현실 처방",
                        ].map((item) => (
                          <div key={item} className="rounded-2xl bg-white px-3 py-2 font-bold">
                            잠금 · {item}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {LOVE_FORTUNE_REPORT_SECTIONS.slice(0, 8).map((section, index) => (
                        <span
                          key={section}
                          className={`rounded-full px-3 py-1 text-xs font-bold ${
                            index < 3 ? "bg-neutral-100 text-neutral-800" : "bg-neutral-100/70 text-neutral-400 blur-[1px]"
                          }`}
                        >
                          {section}
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 rounded-[20px] border border-neutral-100 bg-neutral-50 px-4 py-3">
                      <p className="text-xs font-black text-neutral-700">입력한 정보 그대로 상세 풀이에 사용돼요.</p>
                      <p className="mt-1 text-xs leading-5 text-neutral-500">
                        생년월일, 태어난 시간, 현재 연애 상태, 고민 패턴을 다시 입력할 필요 없이 바로 결제로 이어집니다.
                      </p>
                    </div>
                    <div className="mt-4 rounded-[22px] border border-neutral-200 bg-neutral-950 p-4 text-white">
                      <p className="text-sm font-black">상세 연애운 9,900원</p>
                      <p className="mt-2 text-base font-black leading-7">
                        내 연애 패턴, 오래 맞는 상대, 배우자 얼굴상, 사랑 타이밍을 한 번에 열어볼게요.
                      </p>
                      <p className="mt-1 text-xs leading-5 text-white/70">
                        결제 완료 후 결과 페이지에서 바로 상세 풀이가 생성되고, 마이페이지에도 저장돼요.
                      </p>
                      <p className="mt-1 text-xs leading-5 text-white/60">{preview.paidHint}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void requestLoveFortuneCheckout()}
                          disabled={checkoutLoading}
                          className="rounded-full bg-[#8a2f20] px-4 py-2 text-sm font-black text-[#fff8ec] shadow-[0_12px_26px_rgba(87,39,18,0.28)] disabled:cursor-not-allowed disabled:bg-neutral-500"
                        >
                          {checkoutLoading ? "결제 준비 중..." : "9,900원으로 상세 풀이 보기"}
                        </button>
                      </div>
                    </div>
                  </>
                )}
                <details className="ml-12 rounded-[18px] border border-neutral-200 bg-white p-3 text-xs leading-5 text-neutral-500">
                  <summary className="cursor-pointer font-black text-neutral-800">유료 이용/환불 기준</summary>
                  <p className="mt-2">연애운 상세 분석은 결제 후 입력 정보를 바탕으로 상세 풀이 생성이 시작되는 디지털 콘텐츠입니다.</p>
                  <p className="mt-1">결제만 완료되고 분석이 생성되지 않은 경우 오픈카톡으로 확인 후 취소/환불을 도와드릴 수 있어요.</p>
                  <p className="mt-1">분석 결과가 생성된 뒤에는 콘텐츠 제공이 완료된 상태라 단순 변심 환불이 제한될 수 있습니다.</p>
                </details>
              </>
            ) : null}

            {checkoutError ? (
              <p className="ml-12 rounded-[18px] border border-red-100 bg-red-50 p-3 text-sm font-semibold text-red-700">{checkoutError}</p>
            ) : null}
            <p className="ml-12 text-[11px] leading-5 text-neutral-400">재미와 자기 이해를 위한 참고용 결과입니다. 실제 만남과 선택은 본인의 판단을 우선해 주세요.</p>
          </>
        ) : null}

        {step > 0 ? (
          <button
            type="button"
            onClick={() => {
              setFortuneStep(Math.max(0, step - 1));
              setDetailOpen(false);
            }}
            className="ml-12 rounded-full bg-white px-3 py-1.5 text-[11px] font-black text-neutral-500 shadow-sm"
          >
            이전 질문으로
          </button>
        ) : null}
      </div>
      {selectedHistoryReading ? (() => {
        const reading = selectedHistoryReading;
        const sections = parseLoveFortuneHistoryReport(reading.aiResult);
        const ideal = reading.idealFace ?? {};
        return (
          <div className="fixed inset-0 z-[90] overflow-y-auto bg-black/60 px-3 py-6 backdrop-blur-sm">
            <div className="mx-auto max-w-3xl overflow-hidden rounded-[30px] border border-[#d8c5a5] bg-[#f7efe2] text-[#2b2118] shadow-2xl">
              <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#d8c5a5] bg-[#fff7e8]/95 px-4 py-3 backdrop-blur">
                <div>
                  <p className="text-xs font-black tracking-[0.2em] text-[#9a5a23]">이전 연애운</p>
                  <h3 className="mt-1 text-lg font-black text-stone-950">
                    {[reading.birthDate, reading.loveState, reading.focus].filter(Boolean).join(" · ") || "내 연애운 상세 풀이"}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedHistoryReading(null)}
                  className="rounded-full bg-[#2b2118] px-4 py-2 text-sm font-black text-[#f6d9a8]"
                >
                  닫기
                </button>
              </div>

              <div className="space-y-4 p-4 sm:p-6">
                <section className="rounded-[26px] border border-rose-100 bg-white p-4">
                  <p className="text-xs font-black tracking-[0.16em] text-rose-700">배우자 얼굴상</p>
                  <h4 className="mt-2 text-2xl font-black text-stone-950">{String(ideal.title ?? "나와 오래 맞기 쉬운 인상")}</h4>
                  <p className="mt-2 text-sm leading-6 text-stone-600">{String(ideal.mood ?? "급하지 않고 신뢰가 쌓이는 분위기")}</p>
                  <div className="mt-3 grid gap-2 text-sm leading-6 text-stone-700 sm:grid-cols-2">
                    <p className="rounded-2xl bg-rose-50 p-3">눈매 · {String(ideal.eye ?? "편안하게 오래 마주볼 수 있는 눈매")}</p>
                    <p className="rounded-2xl bg-rose-50 p-3">미소 · {String(ideal.smile ?? "담백하지만 따뜻한 미소")}</p>
                    <p className="rounded-2xl bg-rose-50 p-3">스타일 · {String(ideal.style ?? "깔끔한 기본 스타일")}</p>
                    <p className="rounded-2xl bg-amber-50 p-3 text-amber-900">첫 만남 · {String(ideal.firstDate ?? "대화가 편한 사람")}</p>
                  </div>
                </section>

                {sections.map((section, index) => (
                  <section
                    key={`${reading.id}-history-${section.title}-${index}`}
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
    </section>
  );
}

async function fetchBySex(
  sex: "male" | "female",
  _offsetLegacy: number,
  cursorCreatedAt: string | null,
  cursorId: string | null
) {
  const params = new URLSearchParams({ sex, limit: String(PAGE_SIZE) });
  if (cursorCreatedAt) params.set("cursorCreatedAt", cursorCreatedAt);
  if (cursorId) params.set("cursorId", cursorId);
  const res = await fetch(`/api/dating/cards/list?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("failed to load open cards");
  return (await res.json()) as {
    items: PublicCard[];
    hasMore: boolean;
    nextCursorCreatedAt: string | null;
    nextCursorId: string | null;
  };
}

export default function OpenCardsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [restoredSnapshot, setRestoredSnapshot] = useState<OpenCardsSnapshot | null>(null);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [activeSex, setActiveSex] = useState<"male" | "female">("female");
  const [guideOpen, setGuideOpen] = useState(false);
  const [males, setMales] = useState<PublicCard[]>([]);
  const [females, setFemales] = useState<PublicCard[]>([]);
  const [maleCursorCreatedAt, setMaleCursorCreatedAt] = useState<string | null>(null);
  const [maleCursorId, setMaleCursorId] = useState<string | null>(null);
  const [femaleCursorCreatedAt, setFemaleCursorCreatedAt] = useState<string | null>(null);
  const [femaleCursorId, setFemaleCursorId] = useState<string | null>(null);
  const [maleHasMore, setMaleHasMore] = useState(true);
  const [femaleHasMore, setFemaleHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [paidItems, setPaidItems] = useState<PaidCard[]>([]);
  const [, setMoreViewStatus] = useState<{
    loggedIn: boolean;
    male: MoreViewStatus;
    female: MoreViewStatus;
  }>({
    loggedIn: false,
    male: "none",
    female: "none",
  });
  const [moreViewMale, setMoreViewMale] = useState<PublicCard[]>([]);
  const [moreViewFemale, setMoreViewFemale] = useState<PublicCard[]>([]);
  const [tick, setTick] = useState(0);
  const [swipeLoading, setSwipeLoading] = useState(true);
  const [swipeRefreshing, setSwipeRefreshing] = useState(false);
  const [swipeSubmitting, setSwipeSubmitting] = useState(false);
  const [swipeMessage, setSwipeMessage] = useState("");
  const [swipeImgFailed, setSwipeImgFailed] = useState(false);
  const [swipeState, setSwipeState] = useState<SwipeState>({
    loggedIn: false,
    canSwipe: false,
    remaining: 0,
    limit: 7,
    candidate: null,
    reason: null,
  });
  const activeSexRef = useRef<"male" | "female">(activeSex);
  const swipeCacheRef = useRef<Partial<Record<"male" | "female", SwipeState>>>({});
  const swipeRequestIdRef = useRef({ male: 0, female: 0 });
  const [viewerLoggedIn, setViewerLoggedIn] = useState(false);
  const [viewerPhoneVerified, setViewerPhoneVerified] = useState(false);
  const [swipeSubscriptionStatus, setSwipeSubscriptionStatus] = useState<SwipeSubscriptionStatus | null>(null);
  const [swipeSubscriptionLoading, setSwipeSubscriptionLoading] = useState(false);
  const [swipeSubscriptionSubmitting, setSwipeSubscriptionSubmitting] = useState(false);
  const [swipePremiumGuideOpen, setSwipePremiumGuideOpen] = useState(false);
  const [showWeekendApplyCreditBenefit, setShowWeekendApplyCreditBenefit] = useState(false);
  const [homeAdLink, setHomeAdLink] = useState<HomeAdLinkSetting | null>(null);
  const [openCardHomeCopy, setOpenCardHomeCopy] = useState<OpenCardHomeCopySetting>({
    subtitle: DEFAULT_OPEN_CARD_HOME_SUBTITLE,
  });
  const [reelsListings, setReelsListings] = useState<ReelsDatingListing[]>([]);
  const [reelsListingsLoading, setReelsListingsLoading] = useState(false);
  const [selectedReelsListing, setSelectedReelsListing] = useState<ReelsDatingListing | null>(null);
  const [reelsApplySubmitting, setReelsApplySubmitting] = useState(false);
  const [reelsApplyError, setReelsApplyError] = useState("");
  const [reelsApplyDone, setReelsApplyDone] = useState("");
  const [reelsApplyPhoto, setReelsApplyPhoto] = useState<File | null>(null);
  const [reelsApplyForm, setReelsApplyForm] = useState({
    age: "",
    height_cm: "",
    region: "",
    job: "",
    training_years: "",
    instagram_id: "",
    intro_text: "",
    consent: false,
  });
  const [homeFeatureTab, setHomeFeatureTab] = useState<HomeFeatureTab>("open_cards");
  const [isAdminPreviewUser, setIsAdminPreviewUser] = useState(false);
  const [oneOnOneHomeLoading, setOneOnOneHomeLoading] = useState(false);
  const [oneOnOneHomeError, setOneOnOneHomeError] = useState("");
  const [oneOnOneHome, setOneOnOneHome] = useState<OneOnOneHomeState | null>(null);
  const [processingOneOnOneMatchIds, setProcessingOneOnOneMatchIds] = useState<string[]>([]);
  const [processingOneOnOneContactIds, setProcessingOneOnOneContactIds] = useState<string[]>([]);
  const [processingOneOnOneAutoKeys, setProcessingOneOnOneAutoKeys] = useState<string[]>([]);
  const [refreshingOneOnOneRecommendationIds, setRefreshingOneOnOneRecommendationIds] = useState<string[]>([]);

  useEffect(() => {
    activeSexRef.current = activeSex;
  }, [activeSex]);

  useEffect(() => {
    const snapshot = readOpenCardsSnapshot();
    if (snapshot) {
      setRestoredSnapshot(snapshot);
      setActiveSex(snapshot.activeSex);
      setMales(snapshot.males);
      setFemales(snapshot.females);
      setMaleCursorCreatedAt(snapshot.maleCursorCreatedAt);
      setMaleCursorId(snapshot.maleCursorId);
      setFemaleCursorCreatedAt(snapshot.femaleCursorCreatedAt);
      setFemaleCursorId(snapshot.femaleCursorId);
      setMaleHasMore(snapshot.maleHasMore);
      setFemaleHasMore(snapshot.femaleHasMore);
      setQueueStats(snapshot.queueStats);
      setPaidItems(snapshot.paidItems);
      setMoreViewMale(snapshot.moreViewMale);
      setMoreViewFemale(snapshot.moreViewFemale);
      if (snapshot.males.length > 0 || snapshot.females.length > 0) {
        setLoading(false);
      }
    }
    setSnapshotReady(true);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const updateWeekendBenefit = () => setShowWeekendApplyCreditBenefit(isKoreanWeekend());
    updateWeekendBenefit();
    const timer = window.setInterval(updateWeekendBenefit, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/admin/me", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { isAdmin?: boolean }) => {
        if (!cancelled) setIsAdminPreviewUser(Boolean(data.isAdmin));
      })
      .catch(() => {
        if (!cancelled) setIsAdminPreviewUser(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isAdminPreviewUser && homeFeatureTab === "love_fortune") {
      setHomeFeatureTab("open_cards");
    }
  }, [homeFeatureTab, isAdminPreviewUser]);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/dating/cards/home-copy")
      .then((res) => res.json())
      .then((data: Partial<OpenCardHomeCopySetting>) => {
        if (cancelled) return;
        setOpenCardHomeCopy({ subtitle: data.subtitle?.trim() || DEFAULT_OPEN_CARD_HOME_SUBTITLE });
      })
      .catch(() => {
        if (!cancelled) setOpenCardHomeCopy({ subtitle: DEFAULT_OPEN_CARD_HOME_SUBTITLE });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReelsListingsLoading(true);

    fetch("/api/dating/reels/listings", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { items?: ReelsDatingListing[] }) => {
        if (!cancelled) setReelsListings(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => {
        if (!cancelled) setReelsListings([]);
      })
      .finally(() => {
        if (!cancelled) setReelsListingsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/site/ad-inquiry")
      .then((res) => res.json())
      .then((data: Partial<HomeAdLinkSetting>) => {
        if (cancelled) return;
        const title = data.title?.trim() || data.cta?.trim() || "";
        const linkUrl = data.linkUrl?.trim() || "";
        if (data.enabled === false || !title || !linkUrl) {
          setHomeAdLink(null);
          return;
        }
        setHomeAdLink({
          enabled: true,
          title,
          description: data.description?.trim() || "",
          cta: data.cta?.trim() || "",
          linkUrl,
          badge: data.badge?.trim() || "",
          theme: data.theme ?? "emerald",
        });
      })
      .catch(() => {
        if (!cancelled) setHomeAdLink(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    queueMicrotask(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setViewerLoggedIn(Boolean(user));
      if (!user) {
        setViewerPhoneVerified(false);
        return;
      }

      const summaryRes = await fetch("/api/mypage/summary", { cache: "no-store" }).catch(() => null);
      if (!summaryRes?.ok) {
        setViewerPhoneVerified(false);
        return;
      }
      const summaryBody = (await summaryRes.json().catch(() => ({}))) as { profile?: { phone_verified?: boolean } };
      setViewerPhoneVerified(summaryBody.profile?.phone_verified === true);
    });
  }, [supabase]);

  useEffect(() => {
    if (!viewerLoggedIn) {
      setSwipeSubscriptionStatus(null);
      return;
    }

    let cancelled = false;
    const loadSwipeSubscriptionStatus = async () => {
      setSwipeSubscriptionLoading(true);
      try {
        const res = await fetch("/api/dating/cards/swipe/subscription", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as SwipeSubscriptionStatus & { ok?: boolean; message?: string };
        if (!res.ok) {
          throw new Error(body.message ?? body.error ?? "빠른매칭 플러스 상태를 불러오지 못했습니다.");
        }
        if (cancelled) return;
        setSwipeSubscriptionStatus({
          status:
            body.status === "active" || body.status === "pending" || body.status === "none" ? body.status : "none",
          dailyLimit: Math.max(1, Number(body.dailyLimit ?? 5)),
          baseLimit: Math.max(1, Number(body.baseLimit ?? 5)),
          premiumLimit: Math.max(1, Number(body.premiumLimit ?? 15)),
          priceKrw: Math.max(0, Number(body.priceKrw ?? 10000)),
          durationDays: Math.max(1, Number(body.durationDays ?? 15)),
          activeSubscription: body.activeSubscription ?? null,
          pendingSubscription: body.pendingSubscription ?? null,
        });
      } catch (error) {
        console.error("swipe subscription status load failed", error);
      } finally {
        if (!cancelled) setSwipeSubscriptionLoading(false);
      }
    };

    void loadSwipeSubscriptionStatus();
    return () => {
      cancelled = true;
    };
  }, [viewerLoggedIn]);

  const reloadOneOnOneHome = useCallback(async () => {
    if (!viewerLoggedIn) {
      setOneOnOneHome(null);
      setOneOnOneHomeError("");
      return;
    }

    setOneOnOneHomeLoading(true);
    setOneOnOneHomeError("");
    try {
      const [statusRes, myCardsRes, matchesRes, recommendationsRes] = await Promise.all([
        fetch("/api/dating/1on1/write-status", { cache: "no-store" }),
        fetch("/api/dating/1on1/my", { cache: "no-store" }),
        fetch("/api/dating/1on1/matches/my", { cache: "no-store" }),
        fetch("/api/dating/1on1/recommendations/my", { cache: "no-store" }),
      ]);

      const [statusBody, myCardsBody, matchesBody, recommendationsBody] = await Promise.all([
        statusRes.json().catch(() => ({})),
        myCardsRes.json().catch(() => ({})),
        matchesRes.json().catch(() => ({})),
        recommendationsRes.json().catch(() => ({})),
      ]);

      if (!statusRes.ok) throw new Error(statusBody.error ?? "1:1 상태를 불러오지 못했습니다.");
      if (!myCardsRes.ok) throw new Error(myCardsBody.error ?? "내 1:1 신청 내역을 불러오지 못했습니다.");

      setOneOnOneHome({
        status: statusBody,
        myCards: Array.isArray(myCardsBody.items) ? myCardsBody.items : [],
        matches: matchesRes.ok && Array.isArray(matchesBody.items) ? matchesBody.items : [],
        recommendations: recommendationsRes.ok && Array.isArray(recommendationsBody.items) ? recommendationsBody.items : [],
      });
    } catch (error) {
      setOneOnOneHomeError(error instanceof Error ? error.message : "1:1 정보를 불러오지 못했습니다.");
    } finally {
      setOneOnOneHomeLoading(false);
    }
  }, [viewerLoggedIn]);

  useEffect(() => {
    if (homeFeatureTab !== "one_on_one") return;
    let cancelled = false;
    void reloadOneOnOneHome().finally(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [homeFeatureTab, reloadOneOnOneHome]);

  useEffect(() => {
    writeOpenCardsSnapshot({
      activeSex,
      males,
      females,
      maleCursorCreatedAt,
      maleCursorId,
      femaleCursorCreatedAt,
      femaleCursorId,
      maleHasMore,
      femaleHasMore,
      queueStats,
      paidItems,
      moreViewMale,
      moreViewFemale,
      scrollY: typeof window !== "undefined" ? window.scrollY : 0,
    });
  }, [
    activeSex,
    females,
    femaleCursorCreatedAt,
    femaleCursorId,
    femaleHasMore,
    males,
    maleCursorCreatedAt,
    maleCursorId,
    maleHasMore,
    moreViewFemale,
    moreViewMale,
    paidItems,
    queueStats,
  ]);

  useEffect(() => {
    if (!restoredSnapshot) return;
    const restore = window.requestAnimationFrame(() => {
      window.scrollTo({ top: restoredSnapshot.scrollY ?? 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(restore);
  }, [restoredSnapshot]);

  useEffect(() => {
    const saveSnapshot = () => {
      writeOpenCardsSnapshot({
        activeSex,
        males,
        females,
        maleCursorCreatedAt,
        maleCursorId,
        femaleCursorCreatedAt,
        femaleCursorId,
        maleHasMore,
        femaleHasMore,
        queueStats,
        paidItems,
        moreViewMale,
        moreViewFemale,
        scrollY: window.scrollY,
      });
    };

    window.addEventListener("pagehide", saveSnapshot);
    return () => window.removeEventListener("pagehide", saveSnapshot);
  }, [
    activeSex,
    femaleCursorCreatedAt,
    femaleCursorId,
    femaleHasMore,
    females,
    maleCursorCreatedAt,
    maleCursorId,
    maleHasMore,
    males,
    moreViewFemale,
    moreViewMale,
    paidItems,
    queueStats,
  ]);

  const refreshSecondary = useCallback(async () => {
    try {
      const [qsRes, paidRes, mvStatusRes] = await Promise.all([
        fetch("/api/dating/cards/queue-stats", { cache: "no-store" }),
        fetch("/api/dating/paid/list", { cache: "no-store" }),
        fetch("/api/dating/cards/more-view/status", { cache: "no-store" }),
      ]);
      if (qsRes.ok) {
        const qsBody = (await qsRes.json()) as QueueStats;
        setQueueStats(qsBody);
      } else {
        setQueueStats(null);
      }
      if (paidRes.ok) {
        const paidBody = (await paidRes.json()) as { items?: PaidCard[] };
        setPaidItems(Array.isArray(paidBody.items) ? paidBody.items : []);
      } else {
        setPaidItems([]);
      }

      const mvStatusBody = (await mvStatusRes.json().catch(() => ({}))) as MoreViewStatusResponse;
      const nextStatus = {
        loggedIn: mvStatusBody.loggedIn === true,
        male: mvStatusBody.male ?? "none",
        female: mvStatusBody.female ?? "none",
      };
      setMoreViewStatus(nextStatus);

      const pendingFetches: Promise<void>[] = [];
      if (nextStatus.male === "approved") {
        pendingFetches.push(
          fetch("/api/dating/cards/more-view/list?sex=male", { cache: "no-store" })
            .then(async (res) => {
              if (!res.ok) return;
              const body = (await res.json()) as { items?: PublicCard[] };
              setMoreViewMale(Array.isArray(body.items) ? body.items : []);
            })
            .catch(() => undefined)
        );
      } else {
        setMoreViewMale([]);
      }
      if (nextStatus.female === "approved") {
        pendingFetches.push(
          fetch("/api/dating/cards/more-view/list?sex=female", { cache: "no-store" })
            .then(async (res) => {
              if (!res.ok) return;
              const body = (await res.json()) as { items?: PublicCard[] };
              setMoreViewFemale(Array.isArray(body.items) ? body.items : []);
            })
            .catch(() => undefined)
        );
      } else {
        setMoreViewFemale([]);
      }
      await Promise.all(pendingFetches);
    } catch (e) {
      console.error("open cards secondary load failed", e);
    }
  }, []);

  const loadInitial = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const [m, f] = await Promise.all([fetchBySex("male", 0, null, null), fetchBySex("female", 0, null, null)]);
      setMales(m.items ?? []);
      setFemales(f.items ?? []);
      setMaleCursorCreatedAt(m.nextCursorCreatedAt ?? null);
      setMaleCursorId(m.nextCursorId ?? null);
      setFemaleCursorCreatedAt(f.nextCursorCreatedAt ?? null);
      setFemaleCursorId(f.nextCursorId ?? null);
      setMaleHasMore(Boolean(m.hasMore));
      setFemaleHasMore(Boolean(f.hasMore));
      setLoading(false);
      void refreshSecondary();
    } catch (e) {
      console.error("open cards load failed", e);
      setLoading(false);
    }
  }, [refreshSecondary]);

  useEffect(() => {
    if (!snapshotReady) return;
    queueMicrotask(() => {
      void loadInitial({ silent: Boolean(restoredSnapshot) });
    });
  }, [snapshotReady, restoredSnapshot, loadInitial]);

  useEffect(() => {
    const pollSecondaryStatus = async () => {
      if (document.visibilityState !== "visible") return;

      try {
        const [mvStatusRes, qsRes] = await Promise.all([
          fetch("/api/dating/cards/more-view/status", { cache: "no-store" }),
          fetch("/api/dating/cards/queue-stats", { cache: "no-store" }),
        ]);
        if (qsRes.ok) {
          const qsBody = (await qsRes.json()) as QueueStats;
          setQueueStats(qsBody);
        }
        if (!mvStatusRes.ok) return;
        const mvStatusBody = (await mvStatusRes.json()) as MoreViewStatusResponse;
        const nextStatus = {
          loggedIn: mvStatusBody.loggedIn === true,
          male: mvStatusBody.male ?? "none",
          female: mvStatusBody.female ?? "none",
        };
        setMoreViewStatus(nextStatus);

        if (nextStatus.male === "approved") {
          const maleRes = await fetch("/api/dating/cards/more-view/list?sex=male", { cache: "no-store" });
          if (maleRes.ok) {
            const body = (await maleRes.json()) as { items?: PublicCard[] };
            setMoreViewMale(Array.isArray(body.items) ? body.items : []);
          }
        } else {
          setMoreViewMale([]);
        }
        if (nextStatus.female === "approved") {
          const femaleRes = await fetch("/api/dating/cards/more-view/list?sex=female", { cache: "no-store" });
          if (femaleRes.ok) {
            const body = (await femaleRes.json()) as { items?: PublicCard[] };
            setMoreViewFemale(Array.isArray(body.items) ? body.items : []);
          }
        } else {
          setMoreViewFemale([]);
        }
      } catch {
        // keep current UI state on polling error
      }
    };

    const timer = window.setInterval(() => {
      void pollSecondaryStatus();
    }, 60000);

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void pollSecondaryStatus();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const loadMoreMale = useCallback(async () => {
    if (!maleHasMore) return;
    try {
      const m = await fetchBySex("male", 0, maleCursorCreatedAt, maleCursorId);
      setMales((prev) => [...prev, ...(m.items ?? [])]);
      setMaleCursorCreatedAt(m.nextCursorCreatedAt ?? null);
      setMaleCursorId(m.nextCursorId ?? null);
      setMaleHasMore(Boolean(m.hasMore));
    } catch (e) {
      console.error("open cards load more male failed", e);
    }
  }, [maleHasMore, maleCursorCreatedAt, maleCursorId]);

  const loadMoreFemale = useCallback(async () => {
    if (!femaleHasMore) return;
    try {
      const f = await fetchBySex("female", 0, femaleCursorCreatedAt, femaleCursorId);
      setFemales((prev) => [...prev, ...(f.items ?? [])]);
      setFemaleCursorCreatedAt(f.nextCursorCreatedAt ?? null);
      setFemaleCursorId(f.nextCursorId ?? null);
      setFemaleHasMore(Boolean(f.hasMore));
    } catch (e) {
      console.error("open cards load more female failed", e);
    }
  }, [femaleHasMore, femaleCursorCreatedAt, femaleCursorId]);

  const loadSwipe = useCallback(async (sex: "male" | "female", options?: SwipeRequestOptions) => {
    const { preferCache = true, silent = false } = options ?? {};
    const requestId = ++swipeRequestIdRef.current[sex];
    const cached = preferCache ? swipeCacheRef.current[sex] : undefined;
    const isActiveTab = activeSexRef.current === sex;

    if (isActiveTab) {
      if (cached) {
        setSwipeState(cached);
        setSwipeImgFailed(false);
        setSwipeLoading(false);
        setSwipeRefreshing(true);
      } else if (!silent) {
        setSwipeLoading(true);
        setSwipeRefreshing(false);
      }
    }

    try {
      const res = await fetch(`/api/dating/cards/swipe?sex=${sex}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as SwipeState & { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "스와이프 후보를 불러오지 못했습니다.");
      }
        const nextState = {
          loggedIn: body.loggedIn === true,
          canSwipe: body.canSwipe === true,
          remaining: Math.max(0, Number(body.remaining ?? 0)),
          limit: Math.max(1, Number(body.limit ?? 7)),
          candidate: body.candidate ?? null,
          reason: body.reason ?? null,
        };
      swipeCacheRef.current[sex] = nextState;
      if (activeSexRef.current === sex && swipeRequestIdRef.current[sex] === requestId) {
        setSwipeImgFailed(false);
        setSwipeState(nextState);
      }
    } catch (error) {
      console.error("swipe load failed", error);
      if (cached) return;
        const fallbackState = {
          loggedIn: false,
          canSwipe: false,
          remaining: 0,
          limit: 7,
          candidate: null,
          reason: error instanceof Error ? error.message : "스와이프 후보를 불러오지 못했습니다.",
        };
      if (activeSexRef.current === sex && swipeRequestIdRef.current[sex] === requestId) {
        setSwipeState(fallbackState);
      }
    } finally {
      if (activeSexRef.current === sex && swipeRequestIdRef.current[sex] === requestId) {
        setSwipeLoading(false);
        setSwipeRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    setSwipeMessage("");
    const otherSex = activeSex === "male" ? "female" : "male";
    void loadSwipe(activeSex, { preferCache: true });
    if (!swipeCacheRef.current[otherSex]) {
      void loadSwipe(otherSex, { preferCache: true, silent: true });
    }
  }, [activeSex, loadSwipe]);

  const handleSwipe = useCallback(
    async (action: "like" | "pass") => {
      if (!swipeState.candidate || swipeSubmitting) return;
      if (!swipeState.canSwipe) {
        setSwipeMessage(
          swipeState.loggedIn
            ? "라이크나 넘기기를 하려면 먼저 오픈카드를 등록해 주세요."
            : "로그인하면 여기서 바로 라이크를 보낼 수 있어요."
        );
        return;
      }
      setSwipeSubmitting(true);
      setSwipeMessage("");
      try {
        const res = await fetch("/api/dating/cards/swipe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sex: activeSex,
            action,
            target_user_id: swipeState.candidate.user_id,
            target_card_id: swipeState.candidate.card_id,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          match?: { other_instagram_id: string; other_nickname: string } | null;
        };
        if (!res.ok) {
          throw new Error(body.error ?? "처리에 실패했습니다.");
        }
        if (body.match?.other_instagram_id) {
          setSwipeMessage(`매칭 성사! 상대 인스타: @${body.match.other_instagram_id}`);
        } else if (action === "like") {
          setSwipeMessage("라이크를 보냈습니다.");
        } else {
          setSwipeMessage("다음 후보로 넘겼습니다.");
        }
        await loadSwipe(activeSex);
      } catch (error) {
        console.error("swipe submit failed", error);
        setSwipeMessage(error instanceof Error ? error.message : "처리에 실패했습니다.");
      } finally {
        setSwipeSubmitting(false);
      }
    },
    [activeSex, loadSwipe, swipeState.canSwipe, swipeState.candidate, swipeState.loggedIn, swipeSubmitting]
  );

  const handleSwipePremiumCheckout = useCallback(async () => {
    if (swipeSubscriptionSubmitting) return;
    setSwipeSubscriptionSubmitting(true);
    setSwipeMessage("");
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
      if (!res.ok || !body.ok) {
        throw new Error(withPaymentCardNotice(body.message ?? body.error ?? "빠른매칭 플러스 결제를 시작하지 못했습니다."));
      }
      if (!body.checkoutUrl) {
        throw new Error(withPaymentCardNotice("결제창을 열지 못했습니다."));
      }
      window.location.href = body.checkoutUrl;
    } catch (error) {
      setSwipeMessage(error instanceof Error ? error.message : withPaymentCardNotice("빠른매칭 플러스 결제를 시작하지 못했습니다."));
    } finally {
      setSwipeSubscriptionSubmitting(false);
    }
  }, [swipeSubscriptionSubmitting]);

  const handleOneOnOneMatchAction = useCallback(
    async (
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
          throw new Error(body.error ?? "1:1 매칭 처리에 실패했습니다.");
        }
        await reloadOneOnOneHome();
      } catch (error) {
        alert(error instanceof Error ? error.message : "1:1 매칭 처리에 실패했습니다.");
      } finally {
        setProcessingOneOnOneMatchIds((prev) => prev.filter((id) => id !== matchId));
      }
    },
    [processingOneOnOneMatchIds, reloadOneOnOneHome]
  );

  const handleOneOnOneContactCheckout = useCallback(
    async (matchId: string) => {
      if (processingOneOnOneContactIds.includes(matchId)) return;
      setProcessingOneOnOneContactIds((prev) => [...prev, matchId]);
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
        };
        if (!res.ok || !body.ok) {
          throw new Error(withPaymentCardNotice(body.message ?? body.error ?? "번호 교환 결제를 시작하지 못했습니다."));
        }
        if (!body.checkoutUrl) {
          throw new Error(withPaymentCardNotice("결제창을 열지 못했습니다."));
        }
        window.location.href = body.checkoutUrl;
      } catch (error) {
        alert(error instanceof Error ? error.message : withPaymentCardNotice("번호 교환 결제를 시작하지 못했습니다."));
      } finally {
        setProcessingOneOnOneContactIds((prev) => prev.filter((id) => id !== matchId));
      }
    },
    [processingOneOnOneContactIds]
  );

  const handleOneOnOneAutoSelect = useCallback(
    async (sourceCardId: string, candidateCardId: string) => {
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
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; code?: string };
        if (!res.ok || !body.ok) {
          if (body.code === "CANDIDATE_ALREADY_HANDLED" || body.code === "CANDIDATE_ALREADY_IN_ACTIVE_FLOW") {
            await reloadOneOnOneHome();
          }
          throw new Error(body.error ?? "후보 선택에 실패했습니다.");
        }
        await reloadOneOnOneHome();
      } catch (error) {
        alert(error instanceof Error ? error.message : "후보 선택에 실패했습니다.");
      } finally {
        setProcessingOneOnOneAutoKeys((prev) => prev.filter((key) => key !== actionKey));
      }
    },
    [processingOneOnOneAutoKeys, reloadOneOnOneHome]
  );

  const handleOneOnOneRecommendationRefresh = useCallback(
    async (sourceCardId: string) => {
      if (!sourceCardId || refreshingOneOnOneRecommendationIds.includes(sourceCardId)) return;
      setRefreshingOneOnOneRecommendationIds((prev) => [...prev, sourceCardId]);
      try {
        const res = await fetch("/api/dating/1on1/recommendations/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source_card_id: sourceCardId }),
        });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !body.ok) {
          throw new Error(body.error ?? "추천 후보를 새로고침하지 못했습니다.");
        }
        await reloadOneOnOneHome();
      } catch (error) {
        alert(error instanceof Error ? error.message : "추천 후보를 새로고침하지 못했습니다.");
      } finally {
        setRefreshingOneOnOneRecommendationIds((prev) => prev.filter((id) => id !== sourceCardId));
      }
    },
    [refreshingOneOnOneRecommendationIds, reloadOneOnOneHome]
  );

  const openReelsApply = useCallback(
    (listing: ReelsDatingListing) => {
      if (!viewerLoggedIn) {
        window.location.href = buildLoginRedirect("/community/dating/cards");
        return;
      }
    setSelectedReelsListing(listing);
    setReelsApplyError(viewerPhoneVerified ? "" : "휴대폰 번호 인증 후 지원할 수 있습니다.");
    setReelsApplyDone("");
    setReelsApplyPhoto(null);
    },
    [viewerLoggedIn, viewerPhoneVerified]
  );

  const handleReelsApplySubmit = useCallback(async () => {
    if (!selectedReelsListing || reelsApplySubmitting) return;

    if (!viewerPhoneVerified) {
      setReelsApplyError("휴대폰 번호 인증 후 지원할 수 있습니다.");
      return;
    }

    const instagramId = normalizeReelsInstagramId(reelsApplyForm.instagram_id);
    if (!validReelsInstagramId(instagramId)) {
      setReelsApplyError("인스타 아이디를 @ 없이 입력해 주세요.");
      return;
    }
    if (!reelsApplyForm.consent) {
      setReelsApplyError("개인정보 제공 동의가 필요합니다.");
      return;
    }

    setReelsApplySubmitting(true);
    setReelsApplyError("");
    setReelsApplyDone("");

    try {
      let photoPath = "";
      if (reelsApplyPhoto) {
        const fd = new FormData();
        fd.append("file", reelsApplyPhoto);
        const uploadRes = await fetch("/api/dating/reels/upload", { method: "POST", body: fd });
        const uploadBody = (await uploadRes.json().catch(() => ({}))) as { path?: string; error?: string };
        if (!uploadRes.ok || !uploadBody.path) {
          setReelsApplyError(uploadBody.error ?? "사진 업로드에 실패했습니다.");
          return;
        }
        photoPath = uploadBody.path;
      }

      const res = await fetch("/api/dating/reels/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listing_id: selectedReelsListing.id,
          age: reelsApplyForm.age,
          height_cm: reelsApplyForm.height_cm,
          region: reelsApplyForm.region,
          job: reelsApplyForm.job,
          training_years: reelsApplyForm.training_years,
          instagram_id: instagramId,
          intro_text: reelsApplyForm.intro_text,
          photo_path: photoPath,
          consent: reelsApplyForm.consent,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setReelsApplyError(body.error ?? "지원 저장에 실패했습니다.");
        return;
      }
      setReelsApplyDone("지원이 저장되었습니다.");
      setReelsApplyForm({
        age: "",
        height_cm: "",
        region: "",
        job: "",
        training_years: "",
        instagram_id: "",
        intro_text: "",
        consent: false,
      });
      setReelsApplyPhoto(null);
    } catch {
      setReelsApplyError("네트워크 오류가 발생했습니다.");
    } finally {
      setReelsApplySubmitting(false);
    }
  }, [reelsApplyForm, reelsApplyPhoto, reelsApplySubmitting, selectedReelsListing, viewerPhoneVerified]);

  const nowLabel = useMemo(() => tick, [tick]);
  void nowLabel;
  const malePaidItems = useMemo(() => paidItems.filter((item) => item.gender === "M"), [paidItems]);
  const femalePaidItems = useMemo(() => paidItems.filter((item) => item.gender === "F"), [paidItems]);
  const fixedPaidCount = useMemo(
    () => paidItems.filter((item) => item.display_mode !== "instant_public").length,
    [paidItems]
  );
  const activeOpenItems = activeSex === "male" ? males : females;
  const activePaidItems = activeSex === "male" ? malePaidItems : femalePaidItems;
  const activeHasMore = activeSex === "male" ? maleHasMore : femaleHasMore;
  const activeCurrentCount = activeSex === "male" ? (queueStats?.male.public_count ?? males.length) : (queueStats?.female.public_count ?? females.length);
  const todayDatingReactionCount = Math.max(
    0,
    Number(queueStats?.today_dating_reactions_count ?? queueStats?.recent_open_card_applications_24h_count ?? 0)
  );
  const swipeTheme = getCardVisualTheme(swipeState.candidate?.card_id ?? activeSex);
  const showOpenCardSection = homeFeatureTab === "open_cards";
  const showQuickMatchSection = homeFeatureTab === "quick_match";
  const showGuideSection = homeFeatureTab === "open_cards";
  const showOneOnOneSection = homeFeatureTab === "one_on_one";
  const showLoveFortuneSection = isAdminPreviewUser && homeFeatureTab === "love_fortune";
  const visibleHomeFeatureTabs = useMemo(
    () => HOME_FEATURE_TABS.filter((tab) => tab.key !== "love_fortune" || isAdminPreviewUser),
    [isAdminPreviewUser]
  );
  return (
    <main className="mx-auto max-w-5xl px-4 py-5 md:px-6 md:py-8">
      <DatingAdultNotice />
      <section className="sticky top-[64px] z-30 mb-4 rounded-[24px] border border-black/5 bg-white/95 p-1.5 shadow-[0_10px_28px_rgba(15,23,42,0.07)] backdrop-blur">
        <div className={`grid gap-1 ${visibleHomeFeatureTabs.length >= 4 ? "grid-cols-4" : "grid-cols-3"}`}>
          {visibleHomeFeatureTabs.map((tab) => {
            const active = homeFeatureTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setHomeFeatureTab(tab.key)}
                className={`rounded-[18px] px-2 py-3 text-center transition ${
                  active
                    ? "bg-neutral-950 text-white shadow-[0_10px_22px_rgba(15,23,42,0.16)]"
                    : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900"
                }`}
              >
                <span className="block text-sm font-black leading-tight">{tab.label}</span>
                <span className={`mt-0.5 block text-[10px] font-semibold ${active ? "text-white/70" : "text-neutral-400"}`}>
                  {tab.body}
                </span>
              </button>
            );
          })}
        </div>
      </section>
      {showLoveFortuneSection ? <AdminLoveFortunePanel /> : null}
      {showOpenCardSection ? (
      <section className="mb-4 rounded-[24px] border border-neutral-200/80 bg-white p-5 shadow-[0_12px_34px_rgba(15,23,42,0.06)] md:p-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-600">오픈카드</span>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <h1 className="text-[30px] font-black tracking-tight text-neutral-950 md:text-[38px]">오픈카드</h1>
              <p className="mt-2 max-w-xl text-[15px] leading-7 text-neutral-600 md:text-base">
                {openCardHomeCopy.subtitle}
              </p>

              <div className="mt-4 overflow-hidden rounded-[14px] bg-emerald-50 px-2.5 py-3 sm:px-4">
                <div className="flex items-center gap-3">
                  <span className="shrink-0 text-[11px] font-black text-emerald-700 sm:text-xs">혜택</span>
                  <p className="min-w-0 flex-1 whitespace-nowrap text-[clamp(9px,2.58vw,14px)] font-black leading-5 text-emerald-900">
                    오픈카드 등록하면 매주 원하는 지역 1곳 무료 오픈
                  </p>
                </div>
              </div>
              {showWeekendApplyCreditBenefit && (
                <div className="mt-2 overflow-hidden rounded-[14px] bg-emerald-50 px-2.5 py-3 sm:px-4">
                  <div className="flex items-center gap-3">
                    <span className="shrink-0 text-[11px] font-black text-emerald-700 sm:text-xs">주말</span>
                    <p className="min-w-0 flex-1 whitespace-nowrap text-[clamp(9px,2.58vw,14px)] font-black leading-5 text-emerald-900">
                      주말에는 기본 지원권이 3장으로 늘어나요.
                    </p>
                  </div>
                </div>
              )}
              {homeAdLink ? (
                (() => {
                  const theme = homeAdLinkThemeClass[homeAdLink.theme ?? "emerald"];
                  return (
                    <a
                      href={homeAdLink.linkUrl}
                      target={homeAdLink.linkUrl.startsWith("/") ? undefined : "_blank"}
                      rel={homeAdLink.linkUrl.startsWith("/") ? undefined : "noreferrer"}
                      className={`mt-3 flex w-full items-center gap-3 rounded-[14px] border px-3 py-3 transition sm:inline-flex sm:w-auto sm:px-4 ${theme.wrap}`}
                      title={homeAdLink.description || homeAdLink.title}
                    >
                      <p className={`min-w-0 flex-1 break-keep text-[clamp(13px,3.7vw,14px)] font-semibold leading-6 sm:flex-none ${theme.text}`}>
                        {homeAdLink.title}
                      </p>
                      <span className={`shrink-0 text-xs font-black ${theme.cta}`}>바로가기</span>
                    </a>
                  );
                })()
              ) : null}

              <div className="mt-4 divide-y divide-neutral-100 rounded-[18px] border border-neutral-200 bg-white">
                <div className="grid grid-cols-[1fr_auto] gap-4 p-4">
                  <div>
                    <p className="text-sm font-bold text-neutral-500">고정 노출</p>
                    <p className="mt-1 text-xs font-medium text-neutral-400">상단 우선 공개</p>
                  </div>
                  <p className="self-center text-[22px] font-black leading-none text-rose-600">{fixedPaidCount}명</p>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-[1fr_auto] gap-4">
                    <div>
                      <p className="text-sm font-bold text-neutral-500">오늘 새 지원·좋아요</p>
                      <p className="mt-1 text-xs font-medium text-neutral-400">오늘 들어온 반응</p>
                    </div>
                    <p className="self-center text-[22px] font-black leading-none text-rose-600">
                      {todayDatingReactionCount.toLocaleString("ko-KR")}건
                    </p>
                  </div>
                  <p className="mt-3 text-right text-xs font-semibold leading-5 text-neutral-500">
                    반응이 계속 들어오고 있어요.
                  </p>
                </div>
                <div className="grid grid-cols-2 divide-x divide-neutral-100">
                  <div className="p-4">
                    <p className="text-sm font-bold text-neutral-500">1:1 신청</p>
                    <p className="mt-2 text-[20px] font-black text-neutral-950">
                      {Number(queueStats?.one_on_one_applicants_count ?? 0).toLocaleString("ko-KR")}명
                    </p>
                  </div>
                  <div className="p-4">
                    <p className="text-sm font-bold text-neutral-500">1:1 매칭</p>
                    <p className="mt-2 text-[20px] font-black text-neutral-950">
                      {Number(queueStats?.one_on_one_matches_count ?? 0).toLocaleString("ko-KR")}건
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-3 rounded-[22px] border border-neutral-200/70 bg-white p-4 shadow-[0_8px_22px_rgba(15,23,42,0.03)] sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[15px] font-black tracking-tight text-neutral-900">후보를 보고 지원하는 1:1 소개팅도 함께 이용할 수 있어요.</p>
                  <p className="mt-1 text-sm text-neutral-500">마음에 드는 후보에 지원하고, 서로 수락되면 번호 교환이 진행됩니다.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setHomeFeatureTab("one_on_one")}
                  className="inline-flex min-h-[40px] shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-neutral-50 px-4 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
                >
                  1:1 후보 보기
                </button>
              </div>

              {reelsListings.length > 0 || reelsListingsLoading ? (
                <section className="mt-3 flex items-center gap-2 rounded-[20px] border border-rose-100 bg-white p-2 shadow-[0_8px_22px_rgba(15,23,42,0.05)]">
                  <span className="shrink-0 rounded-[16px] bg-rose-50 px-3.5 py-3 text-sm font-black text-rose-600">
                    릴스 매물
                  </span>
                  {reelsListingsLoading && reelsListings.length === 0 ? (
                    <span className="min-w-0 flex-1 rounded-[16px] bg-neutral-50 px-4 py-3 text-sm font-bold text-neutral-400">
                      불러오는 중...
                    </span>
                  ) : (
                    <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
                      {reelsListings.map((listing) => (
                        <div
                          key={listing.id}
                          className="flex min-w-[240px] flex-1 items-center gap-2 rounded-[16px] bg-neutral-50 px-2 py-2"
                        >
                          <button
                            type="button"
                            onClick={() => openReelsApply(listing)}
                            className="min-w-0 flex-1 px-2 py-1 text-left text-sm font-black text-neutral-950 transition hover:text-rose-600"
                            aria-label={`${listing.title} 지원하기`}
                          >
                            <span className="block truncate">{listing.title}</span>
                          </button>
                          {listing.instagram_url ? (
                            <a
                              href={listing.instagram_url}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 rounded-[12px] bg-white px-2.5 py-2 text-xs font-black text-rose-600 shadow-sm transition hover:bg-rose-50"
                            >
                              인스타
                            </a>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}
            </div>

            <div className="w-full lg:w-[270px]">
              <div className="grid gap-3">
                <Link
                  href="/dating/card/new"
                  className="inline-flex min-h-[62px] items-center justify-center rounded-[22px] bg-rose-600 px-5 text-lg font-bold text-white shadow-[0_14px_26px_rgba(225,29,72,0.22)] transition hover:-translate-y-0.5 hover:bg-rose-700"
                >
                  오픈카드 작성
                </Link>
                <Link
                  href="/dating/paid?apply=1"
                  className="inline-flex min-h-[58px] items-center justify-center gap-2 rounded-[22px] border border-neutral-200 bg-white px-5 text-base font-bold text-neutral-800 shadow-[0_8px_18px_rgba(15,23,42,0.035)] transition hover:-translate-y-0.5 hover:bg-neutral-50"
                >
                  <span className="rounded-lg bg-rose-600 px-2 py-1 text-[11px] font-bold text-white">추천</span>
                  대기 없이 등록
                </Link>
              </div>
            </div>
          </div>

          <div className="border-t border-neutral-100 pt-4">
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex min-h-[42px] items-center rounded-full bg-neutral-950 px-4 text-sm font-bold text-white">전체</span>
              <Link
                href="/dating/apply-credits"
                className="inline-flex min-h-[42px] items-center rounded-full border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"
              >
                지원권 구매
              </Link>
              <Link
                href="/dating/more-view"
                className="inline-flex min-h-[42px] items-center rounded-full border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"
              >
                이상형 더보기
              </Link>
              <Link
                href="/dating/nearby-view"
                className="inline-flex min-h-[42px] items-center rounded-full border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"
              >
                내 가까운 이상형
              </Link>
            </div>
          </div>
        </div>
      </section>
      ) : null}

      {!viewerLoggedIn && showOpenCardSection ? (
        <section className="mb-4 rounded-[26px] border border-black/5 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-neutral-900">지금은 미리보기만 열려 있어요</p>
              <p className="mt-1 text-sm leading-6 text-neutral-500">목록 일부만 볼 수 있고, 상세보기와 지원하기는 로그인 후 이용할 수 있어요.</p>
            </div>
            <Link
              href={buildLoginRedirect(`/community/dating/cards?sex=${activeSex}`)}
              className="inline-flex min-h-[48px] items-center justify-center rounded-2xl bg-neutral-950 px-5 text-sm font-bold text-white hover:bg-neutral-800"
            >
              로그인하고 계속 보기
            </Link>
          </div>
        </section>
      ) : null}

      {showQuickMatchSection ? (
      <section className="mb-5 rounded-[30px] border border-black/5 bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.05)] md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-[30px] font-black tracking-tight text-neutral-950">빠른 매칭</h2>
            <p className="mt-2 max-w-lg text-[15px] leading-7 text-neutral-500">
              랜덤 후보를 하루 최대 {swipeState.limit}명까지 빠르게 확인할 수 있어요.
            </p>
          </div>
          <div className="shrink-0 rounded-[22px] bg-rose-50 px-4 py-3 text-right">
            <p className="text-sm font-semibold text-rose-400">오늘 남은</p>
            <p className="mt-1 text-[20px] font-black text-rose-600">
              {!swipeState.loggedIn ? "로그인" : swipeState.canSwipe ? `${swipeState.remaining}회` : "등록 필요"}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSwipePremiumGuideOpen(true)}
            className="inline-flex min-h-[42px] items-center rounded-full border border-amber-300 bg-amber-50 px-4 text-sm font-bold text-amber-900 hover:bg-amber-100"
          >
            빠른매칭 플러스
          </button>
          <p className="text-xs text-neutral-500">
            {swipeSubscriptionStatus?.status === "active"
              ? "현재 빠른매칭 플러스를 이용 중이에요."
              : `기본 ${swipeSubscriptionStatus?.baseLimit ?? 5}회 · 플러스 ${swipeSubscriptionStatus?.premiumLimit ?? SWIPE_PREMIUM_DAILY_LIMIT}회`}
          </p>
        </div>

        {swipeRefreshing && !swipeLoading ? <p className="mt-3 text-xs font-medium text-neutral-400">최신 후보로 업데이트 중...</p> : null}
        {swipeMessage ? <p className="mt-3 text-sm font-semibold text-emerald-700">{swipeMessage}</p> : null}
        {swipeState.loggedIn && swipeState.candidate && !swipeState.canSwipe ? (
          <div className="mt-4 rounded-[24px] border border-rose-100 bg-rose-50/70 p-4">
            <p className="text-sm font-black text-rose-900">빠른매칭은 오픈카드 등록 후 이용할 수 있어요.</p>
            <p className="mt-1 text-sm leading-6 text-rose-800">
              후보 사진과 기본 정보는 미리 볼 수 있지만, 라이크와 넘기기는 내 오픈카드가 있어야 진행됩니다.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/dating/card/new"
                className="inline-flex min-h-[40px] items-center rounded-2xl bg-rose-600 px-4 text-sm font-black text-white hover:bg-rose-700"
              >
                오픈카드 작성하기
              </Link>
              <Link
                href="/dating/paid?apply=1"
                className="inline-flex min-h-[40px] items-center rounded-2xl border border-rose-200 bg-white px-4 text-sm font-bold text-rose-700 hover:bg-rose-50"
              >
                대기 없이 등록
              </Link>
            </div>
          </div>
        ) : null}

        {swipeLoading ? (
          <p className="mt-5 text-sm text-neutral-500">후보를 불러오는 중...</p>
        ) : !swipeState.candidate ? (
          <>
            <p className="mt-5 text-sm text-neutral-500">{swipeState.reason ?? "현재 보여줄 후보가 없습니다."}</p>
            {swipeState.loggedIn && swipeState.remaining <= 0 ? (
              <div className="mt-4 rounded-[24px] border border-amber-200 bg-amber-50/70 p-4">
                <p className="text-sm font-bold text-amber-900">오늘 라이크를 모두 사용했어요.</p>
                <p className="mt-1 text-sm leading-6 text-amber-800">
                  추가 이용은 {SWIPE_PREMIUM_PRICE_KRW.toLocaleString("ko-KR")}원 · {SWIPE_PREMIUM_DURATION_DAYS}일 · 하루{" "}
                  {SWIPE_PREMIUM_DAILY_LIMIT}회 기준이에요.
                </p>
                <p className="mt-2 text-[11px] text-amber-800">현재 카카오페이 간편결제로만 결제 가능해요. 그 밖의 문의는 오픈카톡으로 부탁드려요.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSwipePremiumGuideOpen(true)}
                    className="inline-flex min-h-[42px] items-center rounded-2xl bg-amber-500 px-4 text-sm font-bold text-white hover:bg-amber-600"
                  >
                    빠른매칭 플러스 보기
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="mt-5 overflow-hidden rounded-[30px] border border-black/5 bg-white">
            <div className={`relative overflow-hidden bg-gradient-to-br ${swipeTheme.shell} p-4 pb-5 min-h-[330px]`}>
              <div className={`absolute inset-0 bg-gradient-to-b ${swipeTheme.overlay}`} aria-hidden />
              <div className="absolute -left-10 bottom-[-36px] h-40 w-40 rounded-full bg-white/10" aria-hidden />
              <div className="absolute -right-10 top-[-28px] h-40 w-40 rounded-full bg-white/10" aria-hidden />

              <div className="relative z-10 flex items-start justify-between gap-3">
                <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${swipeTheme.badge}`}>
                  {swipeState.candidate.source_status === "public" ? "공개중" : "지난 카드"}
                </span>
                <span className="inline-flex rounded-full bg-black/35 px-3 py-1 text-sm font-bold text-white">빠른 확인</span>
              </div>

              <div className="relative z-10 mt-6 flex h-[210px] items-center justify-center overflow-hidden rounded-[28px]">
                {swipeState.candidate.image_url && !swipeImgFailed ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={swipeState.candidate.image_url}
                      alt=""
                      decoding="async"
                      onError={() => setSwipeImgFailed(true)}
                      className={`absolute inset-0 h-full w-full object-cover ${
                        swipeState.candidate.photo_visibility === "public" ? "opacity-34 blur-sm" : "opacity-44 blur-[10px]"
                      }`}
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={swipeState.candidate.image_url}
                      alt=""
                      decoding="async"
                      className={`relative z-10 h-full w-full object-contain px-2 ${
                        swipeState.candidate.photo_visibility === "public" ? "" : "blur-[9px]"
                      }`}
                    />
                  </>
                ) : null}
              </div>

              <div className="relative z-10 mt-5">
                <div className="flex items-end gap-2 text-white">
                  <span className="text-[22px] font-black tracking-tight">{swipeState.candidate.display_nickname}</span>
                  {swipeState.candidate.age != null ? <span className="pb-0.5 text-[16px] font-semibold text-white/90">{swipeState.candidate.age}세</span> : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {swipeState.candidate.region ? (
                    <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${swipeTheme.chip}`}>{swipeState.candidate.region}</span>
                  ) : null}
                  {swipeState.candidate.height_cm != null ? (
                    <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${swipeTheme.chip}`}>키 {swipeState.candidate.height_cm}cm</span>
                  ) : null}
                  {swipeState.candidate.job ? (
                    <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${swipeTheme.chip}`}>{swipeState.candidate.job}</span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="space-y-3 p-4 md:p-5">
              {swipeState.candidate.ideal_type ? (
                <p className="text-[16px] leading-7 text-neutral-700">{maskIdealTypeForPreview(swipeState.candidate.ideal_type)}</p>
              ) : null}
              {swipeState.candidate.strengths_text ? <p className="text-sm leading-6 text-neutral-500">{swipeState.candidate.strengths_text}</p> : null}

              <div className="flex flex-wrap gap-2">
                {swipeState.candidate.training_years != null ? (
                  <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-500">운동 {swipeState.candidate.training_years}년</span>
                ) : null}
                {swipeState.candidate.is_3lift_verified ? (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">3대 인증 완료</span>
                ) : null}
                {swipeState.candidate.sex === "male" && swipeState.candidate.total_3lift != null ? (
                  <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
                    3대 {swipeState.candidate.total_3lift}kg
                  </span>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                {!swipeState.loggedIn ? (
                  <>
                    <Link
                      href={buildLoginRedirect("/community/dating/cards")}
                      className="inline-flex min-h-[54px] items-center justify-center rounded-[18px] border border-neutral-200 bg-white px-4 text-base font-bold text-neutral-600"
                    >
                      로그인하고 보기
                    </Link>
                    <Link
                      href={buildLoginRedirect("/community/dating/cards")}
                      className="inline-flex min-h-[54px] items-center justify-center rounded-[18px] bg-rose-600 px-4 text-base font-bold text-white"
                    >
                      로그인하고 라이크
                    </Link>
                  </>
                ) : !swipeState.canSwipe ? (
                  <>
                    <Link
                      href="/dating/card/new"
                      className="inline-flex min-h-[54px] items-center justify-center rounded-[18px] border border-neutral-200 bg-white px-4 text-base font-bold text-neutral-600"
                    >
                      오픈카드 작성
                    </Link>
                    <Link
                      href="/dating/paid?apply=1"
                      className="inline-flex min-h-[54px] items-center justify-center rounded-[18px] bg-rose-600 px-4 text-base font-bold text-white"
                    >
                      대기 없이 등록
                    </Link>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleSwipe("pass")}
                      disabled={swipeSubmitting}
                      className="inline-flex min-h-[54px] items-center justify-center rounded-[18px] border border-neutral-200 bg-white px-4 text-lg font-bold text-neutral-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      넘기기
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSwipe("like")}
                      disabled={swipeSubmitting}
                      className="inline-flex min-h-[54px] items-center justify-center rounded-[18px] bg-rose-600 px-4 text-lg font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      라이크
                    </button>
                  </>
                )}
              </div>
              {!swipeState.loggedIn ? (
                <p className="text-center text-xs font-semibold text-rose-600">로그인하면 이 후보에게 바로 라이크를 보낼 수 있어요.</p>
              ) : null}
            </div>
          </div>
        )}
      </section>
      ) : null}

      {swipePremiumGuideOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-[28px] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-black text-neutral-950">빠른매칭 플러스</p>
                <p className="mt-1 text-sm leading-6 text-neutral-600">
                  기본은 하루 {swipeSubscriptionStatus?.baseLimit ?? 5}회예요. 플러스를 시작하면 {SWIPE_PREMIUM_DURATION_DAYS}일 동안 하루{" "}
                  {swipeSubscriptionStatus?.premiumLimit ?? SWIPE_PREMIUM_DAILY_LIMIT}회까지 더 넉넉하게 확인할 수 있어요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSwipePremiumGuideOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 text-lg text-neutral-500 hover:bg-neutral-50"
                aria-label="빠른매칭 플러스 안내 닫기"
              >
                ×
              </button>
            </div>
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
              <p className="text-sm font-semibold text-amber-900">
                {SWIPE_PREMIUM_PRICE_KRW.toLocaleString("ko-KR")}원 · {SWIPE_PREMIUM_DURATION_DAYS}일 이용
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-900/80">
                현재는 카카오페이 간편결제로만 결제 가능해요. 그 밖의 결제 문의는 오픈카톡으로 부탁드려요.
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!viewerLoggedIn || swipeSubscriptionSubmitting || swipeSubscriptionLoading}
                onClick={() => void handleSwipePremiumCheckout()}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-2xl bg-amber-500 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-amber-600"
              >
                {swipeSubscriptionStatus?.status === "active"
                  ? "15일 더 연장하기"
                  : swipeSubscriptionSubmitting
                    ? "이동 중..."
                    : "카카오페이로 시작"}
              </button>
              <a
                href={OPEN_KAKAO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-2xl border border-amber-200 bg-white px-4 text-sm font-bold text-amber-800 hover:bg-amber-50"
              >
                오픈카톡 문의
              </a>
            </div>
          </div>
        </div>
      ) : null}

      {showOneOnOneSection ? (
        <OneOnOneHomePanel
          viewerLoggedIn={viewerLoggedIn}
          loading={oneOnOneHomeLoading}
          error={oneOnOneHomeError}
          data={oneOnOneHome}
          processingMatchIds={processingOneOnOneMatchIds}
          processingContactIds={processingOneOnOneContactIds}
          processingAutoKeys={processingOneOnOneAutoKeys}
          refreshingRecommendationIds={refreshingOneOnOneRecommendationIds}
          onMatchAction={handleOneOnOneMatchAction}
          onContactCheckout={handleOneOnOneContactCheckout}
          onAutoSelect={handleOneOnOneAutoSelect}
          onRefreshRecommendations={handleOneOnOneRecommendationRefresh}
        />
      ) : null}

      {showGuideSection ? (
      <section className="mb-5 rounded-[26px] border border-black/5 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
        <button
          type="button"
          onClick={() => setGuideOpen((prev) => !prev)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div>
            <p className="text-xl font-black tracking-tight text-neutral-950">이용 흐름 한 번에 보기</p>
            <p className="mt-1 text-sm text-neutral-500">등록, 지원, 수락, 재대기만 쉽게 정리했어요.</p>
          </div>
          <span className="inline-flex min-h-[42px] items-center rounded-full border border-neutral-200 px-4 text-sm font-bold text-neutral-600">
            {guideOpen ? "설명 접기" : "설명 보기"}
          </span>
        </button>

        {guideOpen && (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-[22px] bg-neutral-50 p-4">
              <p className="text-sm font-black text-neutral-900">1. 카드 공개</p>
              <p className="mt-2 text-sm leading-6 text-neutral-500">오픈카드를 만들면 대기열에 들어가고, 공개되면 24시간 동안 보여져요.</p>
            </div>
            <div className="rounded-[22px] bg-neutral-50 p-4">
              <p className="text-sm font-black text-neutral-900">2. 지원과 수락</p>
              <p className="mt-2 text-sm leading-6 text-neutral-500">마음에 드는 카드에 지원하고, 카드 주인이 수락하면 연결이 성사돼요.</p>
            </div>
            <div className="rounded-[22px] bg-neutral-50 p-4">
              <p className="text-sm font-black text-neutral-900">3. 종료 후 처리</p>
              <p className="mt-2 text-sm leading-6 text-neutral-500">연결이 없으면 1회 다시 대기열로 들어가고, 수락되면 마이페이지에서 인스타가 공개돼요.</p>
            </div>
          </div>
        )}
      </section>
      ) : null}

      {showOpenCardSection ? (
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-[18px] border border-neutral-200/80 bg-white p-1.5 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
          <button
            type="button"
            onClick={() => setActiveSex("female")}
            className={`inline-flex min-h-[46px] items-center justify-center rounded-[14px] px-3 text-sm font-black transition ${
              activeSex === "female"
                ? "bg-rose-600 text-white shadow-[0_10px_20px_rgba(225,29,72,0.18)]"
                : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
            }`}
          >
            여자 카드 보기
          </button>
          <button
            type="button"
            onClick={() => setActiveSex("male")}
            className={`inline-flex min-h-[46px] items-center justify-center rounded-[14px] px-3 text-sm font-black transition ${
              activeSex === "male"
                ? "bg-slate-900 text-white shadow-[0_10px_20px_rgba(15,23,42,0.14)]"
                : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
            }`}
          >
            남자 카드 보기
          </button>
        </div>
      ) : null}

      {showOpenCardSection && loading ? (
        <p className="text-neutral-400 text-center py-10">불러오는 중...</p>
      ) : showOpenCardSection ? (
        <Section
          title={activeSex === "male" ? "남자 오픈카드" : "여자 오픈카드"}
          currentCount={activeCurrentCount}
          paidItems={activePaidItems}
          items={activeOpenItems}
          hasMore={activeHasMore}
          onMore={activeSex === "male" ? loadMoreMale : loadMoreFemale}
          viewerLoggedIn={viewerLoggedIn}
        />
      ) : null}

      {selectedReelsListing ? (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/45 px-4 py-6 backdrop-blur-sm">
          <div className="mx-auto max-w-md rounded-[24px] bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.22)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black text-rose-600">릴스 매물 지원</p>
                <h2 className="mt-1 text-xl font-black tracking-tight text-neutral-950">{selectedReelsListing.title}</h2>
                {selectedReelsListing.description ? (
                  <p className="mt-2 text-sm leading-6 text-neutral-500">{selectedReelsListing.description}</p>
                ) : null}
                <p className="mt-2 text-xs font-semibold text-neutral-500">가입 후 휴대폰 번호 인증을 완료한 회원만 지원할 수 있습니다.</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReelsListing(null)}
                className="h-9 w-9 shrink-0 rounded-full border border-neutral-200 bg-white text-sm font-black text-neutral-500"
                aria-label="닫기"
              >
                ×
              </button>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <input
                type="number"
                inputMode="numeric"
                value={reelsApplyForm.age}
                onChange={(e) => setReelsApplyForm((prev) => ({ ...prev, age: e.target.value }))}
                placeholder="나이"
                className="h-11 rounded-xl border border-neutral-200 px-3 text-sm outline-none focus:border-rose-300"
              />
              <input
                type="number"
                inputMode="numeric"
                value={reelsApplyForm.height_cm}
                onChange={(e) => setReelsApplyForm((prev) => ({ ...prev, height_cm: e.target.value }))}
                placeholder="키"
                className="h-11 rounded-xl border border-neutral-200 px-3 text-sm outline-none focus:border-rose-300"
              />
              <input
                value={reelsApplyForm.region}
                onChange={(e) => setReelsApplyForm((prev) => ({ ...prev, region: e.target.value }))}
                placeholder="지역"
                className="h-11 rounded-xl border border-neutral-200 px-3 text-sm outline-none focus:border-rose-300"
              />
              <input
                value={reelsApplyForm.job}
                onChange={(e) => setReelsApplyForm((prev) => ({ ...prev, job: e.target.value }))}
                placeholder="직업"
                className="h-11 rounded-xl border border-neutral-200 px-3 text-sm outline-none focus:border-rose-300"
              />
              <input
                type="number"
                inputMode="numeric"
                value={reelsApplyForm.training_years}
                onChange={(e) => setReelsApplyForm((prev) => ({ ...prev, training_years: e.target.value }))}
                placeholder="운동 경력"
                className="h-11 rounded-xl border border-neutral-200 px-3 text-sm outline-none focus:border-rose-300"
              />
              <input
                value={reelsApplyForm.instagram_id}
                onChange={(e) => setReelsApplyForm((prev) => ({ ...prev, instagram_id: e.target.value }))}
                placeholder="인스타 ID (@ 없이)"
                className="h-11 rounded-xl border border-neutral-200 px-3 text-sm outline-none focus:border-rose-300"
              />
            </div>
            <textarea
              value={reelsApplyForm.intro_text}
              onChange={(e) => setReelsApplyForm((prev) => ({ ...prev, intro_text: e.target.value }))}
              placeholder="간단한 소개"
              className="mt-2 min-h-[110px] w-full rounded-xl border border-neutral-200 px-3 py-3 text-sm outline-none focus:border-rose-300"
            />
            <div className="mt-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3">
              <p className="text-xs font-black text-neutral-700">사진 첨부</p>
              <p className="mt-1 text-xs text-neutral-500">사진은 선택사항입니다.</p>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setReelsApplyPhoto(e.target.files?.[0] ?? null)}
                className="mt-2 block w-full text-xs text-neutral-600"
              />
              {reelsApplyPhoto ? (
                <button
                  type="button"
                  onClick={() => setReelsApplyPhoto(null)}
                  className="mt-2 text-xs font-semibold text-neutral-500 underline"
                >
                  {reelsApplyPhoto.name} 선택 취소
                </button>
              ) : null}
            </div>
            <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-neutral-500">
              <input
                type="checkbox"
                checked={reelsApplyForm.consent}
                onChange={(e) => setReelsApplyForm((prev) => ({ ...prev, consent: e.target.checked }))}
                className="mt-1"
              />
              릴스 매물 지원 확인을 위해 입력한 정보가 관리자에게 전달되는 것에 동의합니다.
            </label>
            {!viewerPhoneVerified ? (
              <Link
                href="/mypage"
                className="mt-3 flex h-11 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-sm font-black text-rose-700"
              >
                마이페이지에서 휴대폰 인증하기
              </Link>
            ) : null}
            {reelsApplyError ? <p className="mt-3 text-xs font-semibold text-rose-600">{reelsApplyError}</p> : null}
            {reelsApplyDone ? <p className="mt-3 text-xs font-semibold text-emerald-700">{reelsApplyDone}</p> : null}
            <button
              type="button"
              onClick={() => void handleReelsApplySubmit()}
              disabled={reelsApplySubmitting || Boolean(reelsApplyDone) || !viewerPhoneVerified}
              className="mt-4 h-12 w-full rounded-2xl bg-rose-600 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {!viewerPhoneVerified ? "번호 인증 후 지원 가능" : reelsApplySubmitting ? "저장 중..." : reelsApplyDone ? "지원 완료" : "지원하기"}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function OneOnOneHomePanel({
  viewerLoggedIn,
  loading,
  error,
  data,
  processingMatchIds,
  processingContactIds,
  processingAutoKeys,
  refreshingRecommendationIds,
  onMatchAction,
  onContactCheckout,
  onAutoSelect,
  onRefreshRecommendations,
}: {
  viewerLoggedIn: boolean;
  loading: boolean;
  error: string;
  data: OneOnOneHomeState | null;
  processingMatchIds: string[];
  processingContactIds: string[];
  processingAutoKeys: string[];
  refreshingRecommendationIds: string[];
  onMatchAction: (
    matchId: string,
    action: "select_candidate" | "candidate_accept" | "candidate_reject" | "source_accept" | "source_reject" | "cancel_mutual"
  ) => void;
  onContactCheckout: (matchId: string) => void;
  onAutoSelect: (sourceCardId: string, candidateCardId: string) => void;
  onRefreshRecommendations: (sourceCardId: string) => void;
}) {
  const myCards = data?.myCards ?? [];
  const matches = data?.matches ?? [];
  const recommendationGroups = data?.recommendations ?? [];
  const recommendationCount = recommendationGroups.reduce(
    (sum, group) => sum + (group.recommendations?.length ?? 0) + (group.admin_recommendations?.length ?? 0),
    0
  );
  const activeCards = myCards.filter((card) => card.status !== "rejected");
  const hasOneOnOneCard = activeCards.length > 0;
  const actionRequiredCount = matches.filter((match) => {
    if (match.action_required) return true;
    return (
      (match.role === "source" && match.state === "candidate_accepted") ||
      match.state === "mutual_accepted" ||
      match.contact_exchange_status === "approved"
    );
  }).length;
  const sortedMatches = [...matches].sort((a, b) => {
    const aImportant = a.action_required || a.state === "candidate_accepted" || a.state === "mutual_accepted" ? 1 : 0;
    const bImportant = b.action_required || b.state === "candidate_accepted" || b.state === "mutual_accepted" ? 1 : 0;
    if (aImportant !== bImportant) return bImportant - aImportant;
    return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  });

  return (
    <section className="mb-5 rounded-[30px] border border-black/5 bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.05)] md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="inline-flex rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-sky-700">1대1 매칭</span>
          <h2 className="mt-3 text-[30px] font-black tracking-tight text-neutral-950">내 후보를 보고 바로 진행하기</h2>
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

      {viewerLoggedIn && hasOneOnOneCard ? (
        <div className="mt-5 grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-neutral-50 px-3 py-3">
            <p className="text-[11px] font-bold text-neutral-400">내 프로필</p>
            <p className="mt-1 text-lg font-black text-neutral-950">{activeCards.length}개</p>
          </div>
          <div className="rounded-2xl bg-sky-50 px-3 py-3">
            <p className="text-[11px] font-bold text-sky-500">추천 후보</p>
            <p className="mt-1 text-lg font-black text-sky-800">{recommendationCount}명</p>
          </div>
          <div className="rounded-2xl bg-emerald-50 px-3 py-3">
            <p className="text-[11px] font-bold text-emerald-500">확인 필요</p>
            <p className="mt-1 text-lg font-black text-emerald-800">{actionRequiredCount}건</p>
          </div>
        </div>
      ) : null}

      <div className="mt-5">
        {!viewerLoggedIn ? (
          <div className="rounded-[24px] border border-sky-100 bg-sky-50/70 p-4">
            <p className="text-sm font-bold text-sky-900">로그인하면 내 1대1 진행 상태를 볼 수 있어요.</p>
            <Link
              href={buildLoginRedirect("/community/dating/cards")}
              className="mt-3 inline-flex min-h-[42px] items-center rounded-2xl bg-sky-600 px-4 text-sm font-bold text-white"
            >
              로그인하기
            </Link>
          </div>
        ) : loading ? (
          <p className="rounded-[24px] bg-neutral-50 p-5 text-sm text-neutral-500">1대1 정보를 불러오는 중...</p>
        ) : error ? (
          <p className="rounded-[24px] border border-rose-100 bg-rose-50 p-5 text-sm font-semibold text-rose-700">{error}</p>
        ) : !hasOneOnOneCard ? (
          <div className="rounded-[24px] border border-sky-100 bg-sky-50/70 p-5">
            <p className="text-lg font-black text-sky-950">아직 1대1 프로필이 없어요.</p>
            <p className="mt-2 text-sm leading-6 text-sky-900">
              먼저 신청서를 작성하면 후보 확인과 매칭 진행을 이어갈 수 있어요. 신청은 무료입니다.
            </p>
            <Link
              href="/dating/1on1"
              className="mt-4 inline-flex min-h-[46px] items-center justify-center rounded-2xl bg-sky-600 px-5 text-sm font-black text-white hover:bg-sky-700"
            >
              1대1 프로필 작성하기
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-[24px] border border-neutral-100 bg-neutral-50 p-4">
                <p className="text-sm font-black text-neutral-950">1. 후보 확인</p>
                <p className="mt-1 text-xs leading-5 text-neutral-500">추천 후보를 보고 마음에 드는 사람을 선택해요.</p>
              </div>
              <div className="rounded-[24px] border border-neutral-100 bg-neutral-50 p-4">
                <p className="text-sm font-black text-neutral-950">2. 서로 수락</p>
                <p className="mt-1 text-xs leading-5 text-neutral-500">상대도 수락하면 번호 교환 단계로 넘어가요.</p>
              </div>
              <div className="rounded-[24px] border border-emerald-100 bg-emerald-50/70 p-4">
                <p className="text-sm font-black text-emerald-950">3. 번호 교환</p>
                <p className="mt-1 text-xs leading-5 text-emerald-800">결제 완료 후 연락처가 바로 공개됩니다.</p>
              </div>
            </div>

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

            <div className="rounded-[26px] border border-black/5 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-base font-black text-neutral-950">진행 중인 매칭</p>
                  <p className="mt-1 text-xs leading-5 text-neutral-500">선택, 수락, 번호교환이 필요한 항목을 먼저 보여드려요.</p>
                </div>
                <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-bold text-neutral-500">{matches.length}건</span>
              </div>
              {matches.length === 0 ? (
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
                        processing={processingMatchIds.includes(match.id)}
                        contactProcessing={processingContactIds.includes(match.id)}
                        onMatchAction={onMatchAction}
                        onContactCheckout={onContactCheckout}
                      />
                    </OneOnOneCandidateCard>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-[26px] border border-sky-100 bg-sky-50/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-black text-sky-950">추천 후보</p>
                  <p className="mt-1 text-xs leading-5 text-sky-700">프로필 기준으로 먼저 보여드리는 후보예요. 하루 1회 새로 섞을 수 있어요.</p>
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-sky-700">{recommendationCount}명</span>
              </div>

              {recommendationGroups.length === 0 || recommendationCount === 0 ? (
                <p className="mt-3 rounded-2xl bg-white/80 p-4 text-sm leading-6 text-sky-800">현재 보여줄 추천 후보가 없어요. 조건에 맞는 후보가 생기면 여기서 바로 볼 수 있습니다.</p>
              ) : (
                <div className="mt-3 space-y-4">
                  {recommendationGroups.map((group, groupIndex) => {
                    const sourceCardId = String(group.source_card_id ?? "");
                    const sourceCard = activeCards.find((card) => card.id === sourceCardId);
                    const recommendations = group.recommendations ?? [];
                    const adminRecommendations = group.admin_recommendations ?? [];
                    const refreshing = refreshingRecommendationIds.includes(sourceCardId);
                    const canRefresh = Boolean(sourceCardId && group.can_refresh);
                    const nextRefreshLabel = group.next_refresh_at ? new Date(group.next_refresh_at).toLocaleString("ko-KR") : "";

                    return (
                      <div key={sourceCardId || `group-${groupIndex}`} className="rounded-[24px] bg-white p-3 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-black text-neutral-950">
                              {sourceCard ? `${getOneOnOneDisplayName(sourceCard)} 기준 후보` : "추천 후보"}
                            </p>
                            <p className="mt-1 text-[11px] font-semibold text-neutral-500">
                              {canRefresh ? "새 후보로 한 번 더 섞을 수 있어요." : nextRefreshLabel ? `다음 새로고침: ${nextRefreshLabel}` : "추천 상태를 확인 중입니다."}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={!canRefresh || refreshing}
                            onClick={() => onRefreshRecommendations(sourceCardId)}
                            className="inline-flex min-h-[36px] items-center rounded-xl border border-sky-200 bg-sky-50 px-3 text-xs font-black text-sky-700 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-sky-100"
                          >
                            {refreshing ? "새로고침 중..." : "후보 새로고침"}
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
                                badgeClassName="bg-sky-100 text-sky-700"
                                note="선택하면 상대에게 수락 요청이 전달됩니다."
                              >
                                <button
                                  type="button"
                                  disabled={!canSelect || processingAutoKeys.includes(actionKey)}
                                  onClick={() => onAutoSelect(sourceCardId, candidateId)}
                                  className="mt-3 inline-flex min-h-[40px] w-full items-center justify-center rounded-xl bg-sky-600 px-4 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-sky-700"
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
  processing,
  contactProcessing,
  onMatchAction,
  onContactCheckout,
}: {
  match: OneOnOneMatchPreview;
  processing: boolean;
  contactProcessing: boolean;
  onMatchAction: (
    matchId: string,
    action: "select_candidate" | "candidate_accept" | "candidate_reject" | "source_accept" | "source_reject" | "cancel_mutual"
  ) => void;
  onContactCheckout: (matchId: string) => void;
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
          {canCancelMatch ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={processing}
                onClick={() => onMatchAction(match.id, "cancel_mutual")}
                className="inline-flex min-h-[34px] items-center rounded-xl border border-rose-200 bg-white px-3 text-xs font-bold text-rose-700 disabled:opacity-50"
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
        <p className="text-xs font-black text-neutral-900">번호 교환 가능</p>
        <p className="mt-1 text-xs leading-5 text-neutral-600">
          결제 전 금액과 내용을 확인한 뒤 진행되며, 완료되면 상대 연락처가 바로 공개됩니다.
        </p>
        <p className="mt-1 text-[11px] leading-5 text-neutral-400">결제 오류나 미반영은 마이페이지 결제 내역 또는 오픈카톡으로 확인 요청해주세요.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={contactProcessing}
            onClick={() => onContactCheckout(match.id)}
            className="inline-flex min-h-[34px] items-center rounded-xl bg-emerald-600 px-3 text-xs font-black text-white disabled:opacity-50"
          >
            {contactProcessing ? "결제 준비 중..." : "연락처 교환 진행하기"}
          </button>
          <Link href="/mypage?section=matching" className="inline-flex min-h-[34px] items-center rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600">
            상세 보기
          </Link>
        </div>
      </div>
    );
  }

  return null;
}

function Section({
  title,
  currentCount,
  paidItems,
  items,
  hasMore,
  onMore,
  viewerLoggedIn,
}: {
  title: string;
  currentCount: number;
  paidItems: PaidCard[];
  items: PublicCard[];
  hasMore: boolean;
  onMore: () => void;
  viewerLoggedIn: boolean;
}) {
  const pinnedPaidItems = paidItems.filter((card) => card.display_mode !== "instant_public");
  const instantPaidItems = paidItems.filter((card) => card.display_mode === "instant_public");
  const hasAnyItems = pinnedPaidItems.length > 0 || items.length > 0 || instantPaidItems.length > 0;

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 className="text-[28px] font-black tracking-tight text-neutral-950">
          {title} <span className="text-lg font-semibold text-neutral-400">{currentCount}명 공개중</span>
        </h2>
      </div>
      {!hasAnyItems ? (
        <p className="rounded-[26px] border border-black/5 bg-white p-5 text-sm text-neutral-500 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
          현재 공개중인 카드가 없습니다.
        </p>
      ) : (
        <>
          {pinnedPaidItems.length > 0 && (
            <div className="mb-3 grid grid-cols-2 gap-3">
              {pinnedPaidItems.map((card) => (
                <PaidCardRow key={card.id} card={card} viewerLoggedIn={viewerLoggedIn} />
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {items.map((card) => (
              <CardRow key={card.id} card={card} viewerLoggedIn={viewerLoggedIn} />
            ))}
            {instantPaidItems.map((card) => (
              <PaidCardRow key={`paid-${card.id}`} card={card} viewerLoggedIn={viewerLoggedIn} />
            ))}
          </div>
          {hasMore && viewerLoggedIn && (
            <button
              type="button"
              onClick={onMore}
              className="mt-4 w-full min-h-[52px] rounded-[20px] border border-neutral-200 bg-white text-sm font-bold text-neutral-700 shadow-[0_8px_20px_rgba(15,23,42,0.03)] hover:bg-neutral-50"
            >
              더보기
            </button>
          )}
        </>
      )}
    </section>
  );
}

function PaidCardRow({ card, viewerLoggedIn }: { card: PaidCard; viewerLoggedIn: boolean }) {
  const router = useRouter();
  const isPriority = card.display_mode !== "instant_public";
  const theme = getCardVisualTheme(card.id);
  const detailHref = viewerLoggedIn ? `/dating/paid/${card.id}` : buildLoginRedirect(`/dating/paid/${card.id}`);
  const applyHref = viewerLoggedIn ? `/dating/paid/${card.id}/apply` : buildLoginRedirect(`/dating/paid/${card.id}/apply`);
  const warmRoute = useCallback(() => {
    cachePaidCardDetail(card.id, {
      id: card.id,
      nickname: card.nickname,
      is_phone_verified: card.is_phone_verified,
      gender: card.gender,
      age: card.age,
      region: card.region,
      height_cm: card.height_cm,
      job: card.job,
      training_years: card.training_years,
      strengths_text: card.strengths_text,
      ideal_text: card.ideal_text,
      intro_text: null,
      expires_at: card.expires_at,
      image_urls: card.thumbUrl ? [card.thumbUrl] : [],
      photo_visibility: "public",
    });
    router.prefetch(detailHref);
    router.prefetch(applyHref);
  }, [applyHref, card, detailHref, router]);
  const rememberScroll = useCallback(() => {
    const snapshot = readOpenCardsSnapshot();
    if (!snapshot) return;
    writeOpenCardsSnapshot({
      ...snapshot,
      scrollY: window.scrollY,
    });
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[28px] border border-black/5 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
      <div className={`relative min-h-[220px] overflow-hidden bg-gradient-to-br ${theme.shell} p-3`}>
        <div className={`absolute inset-0 bg-gradient-to-b ${theme.overlay}`} aria-hidden />
        <div className="absolute -left-10 bottom-[-30px] h-36 w-36 rounded-full bg-white/10" aria-hidden />
        <div className="absolute -right-10 top-[-24px] h-32 w-32 rounded-full bg-white/10" aria-hidden />
        {card.thumbUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={card.thumbUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover opacity-28 blur-sm" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={card.thumbUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-contain px-2 py-2" />
          </>
        ) : null}

        <div className="relative z-10 flex items-start justify-between gap-3">
          <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${theme.badge}`}>
            {isPriority ? "추천 등록" : "바로 공개"}
          </span>
          {card.expires_at ? (
            <span className="inline-flex rounded-full bg-black/35 px-3 py-1 text-sm font-bold text-white">
              {isPriority ? `잔여 ${formatRemainingToKorean(card.expires_at)}` : "바로 공개중"}
            </span>
          ) : null}
        </div>

        <div className="relative z-10 mt-4">
          <div className="flex items-end gap-2 text-white">
            <span className="text-[20px] font-black tracking-tight">{card.nickname}</span>
            {card.age != null ? <span className="pb-0.5 text-base font-semibold text-white/90">{card.age}</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {card.region ? <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${theme.chip}`}>{card.region}</span> : null}
            {card.height_cm != null ? (
              <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${theme.chip}`}>키 {card.height_cm}cm</span>
            ) : null}
            {card.job ? <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${theme.chip}`}>{card.job}</span> : null}
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap gap-2">
          <PhoneVerifiedBadge verified={card.is_phone_verified} />
          {card.training_years != null ? (
            <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-500">운동 {card.training_years}년</span>
          ) : null}
          {card.is_3lift_verified ? (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">3대 인증 완료</span>
          ) : null}
        </div>

        {card.strengths_text ? <p className="mt-3 line-clamp-2 text-[15px] leading-7 text-neutral-700">{card.strengths_text}</p> : null}
        {card.ideal_text ? <p className="mt-2 line-clamp-2 text-sm leading-6 text-neutral-500">{card.ideal_text}</p> : null}

        <div className="mt-auto grid gap-2 pt-4">
          <Link
            href={detailHref}
            prefetch
            onMouseEnter={warmRoute}
            onClick={rememberScroll}
            onTouchStart={warmRoute}
            onTouchEnd={rememberScroll}
            className="inline-flex min-h-[46px] w-full items-center justify-center rounded-[18px] border border-neutral-200 px-3 text-sm font-bold text-neutral-700 hover:bg-neutral-50"
          >
            {viewerLoggedIn ? "상세보기" : "로그인 후 보기"}
          </Link>
          <Link
            href={applyHref}
            prefetch
            onMouseEnter={warmRoute}
            onClick={rememberScroll}
            onTouchStart={warmRoute}
            onTouchEnd={rememberScroll}
            className="inline-flex min-h-[48px] w-full items-center justify-center rounded-[18px] bg-rose-600 px-3 text-sm font-bold text-white hover:bg-rose-700"
          >
            {viewerLoggedIn ? "지원하기" : "로그인 후 지원"}
          </Link>
        </div>
      </div>
    </div>
  );
}

function CardRow({ card, viewerLoggedIn }: { card: PublicCard; viewerLoggedIn: boolean }) {
  const router = useRouter();
  const ideal = maskIdealTypeForPreview(card.ideal_type);
  const [imgFailed, setImgFailed] = useState(false);
  const theme = getCardVisualTheme(card.id);
  const detailHref = viewerLoggedIn ? `/community/dating/cards/${card.id}` : buildLoginRedirect(`/community/dating/cards/${card.id}`);
  const applyHref = viewerLoggedIn ? `/community/dating/cards/${card.id}/apply` : buildLoginRedirect(`/community/dating/cards/${card.id}/apply`);
  const warmRoute = useCallback(() => {
    cacheOpenCardDetail(card.id, card);
    router.prefetch(detailHref);
    router.prefetch(applyHref);
  }, [applyHref, card, detailHref, router]);
  const rememberScroll = useCallback(() => {
    const snapshot = readOpenCardsSnapshot();
    if (!snapshot) return;
    writeOpenCardsSnapshot({
      ...snapshot,
      scrollY: window.scrollY,
    });
  }, []);

  return (
    <div className={`flex h-full flex-col overflow-hidden rounded-[28px] border bg-white ${openCardBorderClass(card)}`}>
      <div className={`relative min-h-[220px] overflow-hidden bg-gradient-to-br ${theme.shell} p-3`}>
        <div className={`absolute inset-0 bg-gradient-to-b ${theme.overlay}`} aria-hidden />
        <div className="absolute -left-10 bottom-[-30px] h-36 w-36 rounded-full bg-white/10" aria-hidden />
        <div className="absolute -right-10 top-[-24px] h-32 w-32 rounded-full bg-white/10" aria-hidden />

        {card.image_urls.length > 0 && !imgFailed ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.image_urls[0]}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setImgFailed(true)}
              className={`absolute inset-0 h-full w-full object-cover ${
                card.photo_visibility === "public" ? "opacity-28 blur-sm" : "opacity-40 blur-[10px]"
              }`}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.image_urls[0]}
              alt=""
              loading="lazy"
              decoding="async"
              className={`absolute inset-0 h-full w-full object-contain px-2 py-2 ${card.photo_visibility === "public" ? "" : "blur-[9px]"}`}
            />
          </>
        ) : null}

        <div className="relative z-10 flex items-start justify-between gap-3">
          <span className="inline-flex rounded-full bg-black/35 px-3 py-1 text-sm font-bold text-white">
            {card.expires_at ? `잔여 ${formatRemainingToKorean(card.expires_at)}` : "대기열"}
          </span>
          {card.is_3lift_verified ? (
            <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${theme.badge}`}>3대 인증</span>
          ) : null}
        </div>

        <div className="relative z-10 mt-4">
          <div className="flex items-end gap-2 text-white">
            <span className="text-[20px] font-black tracking-tight">{card.display_nickname}</span>
            {card.age != null ? <span className="pb-0.5 text-base font-semibold text-white/90">{card.age}</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {card.region ? <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${theme.chip}`}>{card.region}</span> : null}
            {card.job ? <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${theme.chip}`}>{card.job}</span> : null}
            {card.height_cm != null ? (
              <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${theme.chip}`}>키 {card.height_cm}cm</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap gap-2">
          <PhoneVerifiedBadge verified={card.is_phone_verified} />
          {card.training_years != null ? (
            <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-500">운동 {card.training_years}년</span>
          ) : null}
          {card.total_3lift != null ? (
            <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">3대 {card.total_3lift}kg</span>
          ) : null}
        </div>

        {card.strengths_text ? <p className="mt-3 line-clamp-2 text-[15px] leading-7 text-neutral-700">{card.strengths_text}</p> : null}
        {ideal ? <p className="mt-2 line-clamp-2 text-sm leading-6 text-neutral-500">{ideal}</p> : null}

        <div className="mt-auto grid gap-2 pt-4">
          <Link
            href={detailHref}
            prefetch
            onMouseEnter={warmRoute}
            onClick={rememberScroll}
            onTouchStart={warmRoute}
            onTouchEnd={rememberScroll}
            className="inline-flex min-h-[46px] w-full items-center justify-center rounded-[18px] border border-neutral-200 bg-white px-3 text-sm font-bold text-neutral-700 hover:bg-neutral-50"
          >
            {viewerLoggedIn ? "상세보기" : "로그인 후 보기"}
          </Link>
          <Link
            href={applyHref}
            prefetch
            onMouseEnter={warmRoute}
            onClick={rememberScroll}
            onTouchStart={warmRoute}
            onTouchEnd={rememberScroll}
            className="inline-flex min-h-[48px] w-full items-center justify-center rounded-[18px] bg-rose-600 px-3 text-sm font-bold text-white hover:bg-rose-700"
          >
            {viewerLoggedIn ? "지원하기" : "로그인 후 지원"}
          </Link>
        </div>
      </div>
    </div>
  );
}


