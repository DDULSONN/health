"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/community";
import { formatRemainingToKorean } from "@/lib/dating-open";
import { normalizeNickname, validateNickname } from "@/lib/nickname";
import { isAllowedTestPaymentEmail } from "@/lib/test-payment";
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

const MyLiftGrowthChart = dynamic(() => import("@/components/MyLiftGrowthChart"), {
  loading: () => <MyPageWidgetSkeleton className="h-[360px]" />,
});

const AdminCertReviewPanel = dynamic(() => import("@/components/AdminCertReviewPanel"), {
  loading: () => <MyPageWidgetSkeleton className="h-56" />,
});

const BodyEvalMailbox = dynamic(() => import("@/components/BodyEvalMailbox"), {
  loading: () => <MyPageWidgetSkeleton className="h-56" />,
});

const AdminCommunityModerationPanel = dynamic(() => import("@/components/AdminCommunityModerationPanel"), {
  loading: () => <MyPageWidgetSkeleton className="h-80" />,
});

const OPEN_KAKAO_URL = process.env.NEXT_PUBLIC_OPENKAKAO_URL ?? "https://open.kakao.com/o/s2gvTdhi";

type MyPageTab = "my_cert" | "request_status" | "admin_review";

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
  status: "pending" | "public" | "expired" | "hidden";
  queue_position?: number | null;
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

type MyPaidCard = {
  id: string;
  nickname: string;
  gender: "M" | "F";
  age: number | null;
  region: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
  paid_at: string | null;
  expires_at: string | null;
  created_at: string;
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
  admin_note?: string | null;
  admin_tags?: string[] | null;
  reviewed_at?: string | null;
  created_at: string;
  photo_signed_urls?: string[];
};

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
};

type MyOneOnOneAutoRecommendationGroup = {
  source_card_id: string;
  source_card_status?: "submitted" | "reviewing" | "approved" | "rejected";
  refresh_used?: boolean;
  refresh_used_at?: string | null;
  next_refresh_at?: string | null;
  can_refresh?: boolean;
  recommendations: MyOneOnOneMatchCard[];
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
  status: "submitted" | "accepted" | "rejected" | "canceled";
  created_at: string;
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
  card_owner_user_id?: string | null;
  card_owner_nickname?: string | null;
  card_nickname?: string | null;
  card_gender?: "M" | "F" | null;
  card_status?: "pending" | "approved" | "rejected" | "expired" | null;
};

type AdminCardSort = "public_first" | "pending_first" | "newest" | "oldest";
type AdminApplicationSort = "newest" | "oldest" | "submitted_first" | "accepted_first";
type AdminDataView = "cards" | "applications";
type AdminManageTab =
  | "site_dashboard"
  | "dating_stats"
  | "dating_insights"
  | "open_cards"
  | "apply_credits"
  | "swipe_subscriptions"
  | "more_view"
  | "city_view"
  | "bodybattle"
  | "community"
  | "phone_verify"
  | "account_deletions"
  | "site_ads";

type AdminBodyBattleOverview = {
  season: {
    id: string;
    week_id: string;
    theme_slug: string;
    theme_label: string;
    start_at: string;
    end_at: string;
    status: "draft" | "active" | "closed";
  } | null;
  counts: {
    entries_total: number;
    entries_pending: number;
    entries_approved_active: number;
    entries_hidden: number;
    reports_open: number;
    votes_total: number;
    rewards_claimed: number;
  } | null;
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
};

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
  const [adminOpenCardsLoaded, setAdminOpenCardsLoaded] = useState(false);
  const [adminOpenCardsLoading, setAdminOpenCardsLoading] = useState(false);
  const [editingAdminOpenCardId, setEditingAdminOpenCardId] = useState<string | null>(null);
  const [adminOpenCardDraft, setAdminOpenCardDraft] = useState<AdminOpenCardEditDraft | null>(null);
  const [savingAdminOpenCard, setSavingAdminOpenCard] = useState(false);
  const [adminCardSort, setAdminCardSort] = useState<AdminCardSort>("public_first");
  const [adminApplicationSort, setAdminApplicationSort] = useState<AdminApplicationSort>("newest");
  const [adminDataView, setAdminDataView] = useState<AdminDataView>("cards");
  const [adminManageTab, setAdminManageTab] = useState<AdminManageTab>("site_dashboard");
  const [adminApplyCreditOrders, setAdminApplyCreditOrders] = useState<AdminApplyCreditOrder[]>([]);
  const [adminSwipeSubscriptionRequests, setAdminSwipeSubscriptionRequests] = useState<AdminSwipeSubscriptionRequest[]>([]);
  const [adminMoreViewRequests, setAdminMoreViewRequests] = useState<AdminMoreViewRequest[]>([]);
  const [adminCityViewRequests, setAdminCityViewRequests] = useState<AdminCityViewRequest[]>([]);
  const [adminApplyCreditSearch, setAdminApplyCreditSearch] = useState("");
  const [adminApplyCreditGrantNickname, setAdminApplyCreditGrantNickname] = useState("");
  const [adminApplyCreditGrantLoading, setAdminApplyCreditGrantLoading] = useState(false);
  const [adminSwipeSubscriptionSearch, setAdminSwipeSubscriptionSearch] = useState("");
  const [adminMoreViewSearch, setAdminMoreViewSearch] = useState("");
  const [adminDatingStats, setAdminDatingStats] = useState<AdminDatingStats | null>(null);
  const [adminDatingInsights, setAdminDatingInsights] = useState<AdminDatingInsights | null>(null);
  const [adminSiteDashboard, setAdminSiteDashboard] = useState<AdminSiteDashboard | null>(null);
  const [adminSiteDashboardLoading, setAdminSiteDashboardLoading] = useState(false);
  const [adminSiteDashboardError, setAdminSiteDashboardError] = useState("");
  const [adminAccountDeletionAudits, setAdminAccountDeletionAudits] = useState<AdminAccountDeletionAudit[]>([]);
  const [adminCityViewSearch, setAdminCityViewSearch] = useState("");
  const [adminCityViewUnblockIdentifier, setAdminCityViewUnblockIdentifier] = useState("");
  const [adminCityViewUnblockLoading, setAdminCityViewUnblockLoading] = useState(false);
  const [adminCityViewUnblockInfo, setAdminCityViewUnblockInfo] = useState("");
  const [adminCityViewUnblockError, setAdminCityViewUnblockError] = useState("");
  const [adminBodyBattleOverview, setAdminBodyBattleOverview] = useState<AdminBodyBattleOverview | null>(null);
  const [adminQueueRefreshing, setAdminQueueRefreshing] = useState(false);
  const [runningBodyBattleAdminTask, setRunningBodyBattleAdminTask] = useState(false);
  const [approvingOrderIds, setApprovingOrderIds] = useState<string[]>([]);
  const [processingMoreViewIds, setProcessingMoreViewIds] = useState<string[]>([]);
  const [processingSwipeSubscriptionIds, setProcessingSwipeSubscriptionIds] = useState<string[]>([]);
  const [processingCityViewIds, setProcessingCityViewIds] = useState<string[]>([]);
  const [processingOneOnOneMatchIds, setProcessingOneOnOneMatchIds] = useState<string[]>([]);
  const [processingOneOnOneAutoKeys, setProcessingOneOnOneAutoKeys] = useState<string[]>([]);
  const [processingSwipeLikeBackIds, setProcessingSwipeLikeBackIds] = useState<string[]>([]);
  const [deletingSwipeLikeIds, setDeletingSwipeLikeIds] = useState<string[]>([]);
  const [deletingConnectionIds, setDeletingConnectionIds] = useState<string[]>([]);
  const [cancelingAppliedIds, setCancelingAppliedIds] = useState<string[]>([]);
  const [showAllOutgoingSwipeLikes, setShowAllOutgoingSwipeLikes] = useState(false);
  const [showAllIncomingSwipeLikes, setShowAllIncomingSwipeLikes] = useState(false);
  const [refreshingOneOnOneRecommendationIds, setRefreshingOneOnOneRecommendationIds] = useState<string[]>([]);
  const [openCardWriteEnabled, setOpenCardWriteEnabled] = useState(true);
  const [openCardWriteSaving, setOpenCardWriteSaving] = useState(false);
  const [adInquiryEnabled, setAdInquiryEnabled] = useState(true);
  const [adInquiryTitle, setAdInquiryTitle] = useState("");
  const [adInquiryDescription, setAdInquiryDescription] = useState("");
  const [adInquiryCta, setAdInquiryCta] = useState("");
  const [adInquiryLinkUrl, setAdInquiryLinkUrl] = useState("");
  const [adInquiryBadge, setAdInquiryBadge] = useState("");
  const [adInquirySaving, setAdInquirySaving] = useState(false);
  const [adInquiryError, setAdInquiryError] = useState("");
  const [adInquiryInfo, setAdInquiryInfo] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState<MyPageTab>("my_cert");
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deletingAppliedIds, setDeletingAppliedIds] = useState<string[]>([]);
  const [deletingOneOnOneIds, setDeletingOneOnOneIds] = useState<string[]>([]);
  const [applyCreditsRemaining, setApplyCreditsRemaining] = useState(0);

  const [nicknameOpen, setNicknameOpen] = useState(false);
  const [newNickname, setNewNickname] = useState("");
  const [nicknameError, setNicknameError] = useState("");
  const [nicknameInfo, setNicknameInfo] = useState("");
  const [savingNickname, setSavingNickname] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneOtpCode, setPhoneOtpCode] = useState("");
  const [phoneOtpPending, setPhoneOtpPending] = useState<string | null>(null);
  const [sendingPhoneOtp, setSendingPhoneOtp] = useState(false);
  const [verifyingPhoneOtp, setVerifyingPhoneOtp] = useState(false);
  const [phoneVerifyError, setPhoneVerifyError] = useState("");
  const [phoneVerifyInfo, setPhoneVerifyInfo] = useState("");
  const [adminPhoneIdentifier, setAdminPhoneIdentifier] = useState("");
  const [adminPhoneNumber, setAdminPhoneNumber] = useState("");
  const [adminPhoneVerifyLoading, setAdminPhoneVerifyLoading] = useState(false);
  const [adminPhoneVerifyError, setAdminPhoneVerifyError] = useState("");
  const [adminPhoneVerifyInfo, setAdminPhoneVerifyInfo] = useState("");
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
          connectionsRes,
          paidConnectionsRes,
          writeSettingRes,
          applyCreditsStatusRes,
          adInquiryRes,
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
          fetch("/api/dating/cards/my/connections", { cache: "no-store" }),
          fetch("/api/dating/paid/my/connections", { cache: "no-store" }),
          fetch("/api/dating/cards/write-enabled", { cache: "no-store" }),
          fetch("/api/dating/apply-credits/status", { cache: "no-store" }),
          fetch("/api/site/ad-inquiry", { cache: "no-store" }),
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
          setSwipeStatusSummary(null);
          setMyOutgoingSwipeLikes([]);
          setMyIncomingSwipeLikes([]);
          setSwipeStatusLoaded(false);
          setDatingConnections([
            ...(connectionsRes.ok ? (connectionsBody.items ?? []) : []),
            ...(paidConnectionsRes.ok ? (paidConnectionsBody.items ?? []) : []),
          ]);
          setOpenCardWriteEnabled(writeSettingBody.enabled !== false);
          setApplyCreditsRemaining(Math.max(0, Number(applyCreditsBody.creditsRemaining ?? 0)));
          setAdInquiryEnabled(adInquiryBody.enabled !== false);
          setAdInquiryTitle(adInquiryBody.title ?? "(광고) 문의 주세요");
          setAdInquiryDescription(
            adInquiryBody.description ?? "배너, 제휴, 스폰서 문의는 오픈카톡으로 편하게 남겨 주세요."
          );
          setAdInquiryCta(adInquiryBody.cta ?? "오픈카톡 문의");
          setAdInquiryLinkUrl(adInquiryBody.linkUrl ?? "");
          setAdInquiryBadge(adInquiryBody.badge ?? "AD SLOT");
          setError("");

          if (adminFlag) {
            const [
              datingStatsRes,
              datingInsightsRes,
              ordersRes,
              moreViewRes,
              cityViewRes,
              bodyBattleOverviewRes,
              accountDeletionAuditsRes,
            ] = await Promise.all([
              fetch("/api/admin/dating/stats", { cache: "no-store" }),
              fetch("/api/admin/dating/insights", { cache: "no-store" }),
              fetch("/api/admin/dating/apply-credits/orders?status=pending", { cache: "no-store" }),
              fetch("/api/admin/dating/cards/more-view/requests?status=pending", { cache: "no-store" }),
              fetch("/api/admin/dating/cards/city-view/requests?status=pending", { cache: "no-store" }),
              fetch("/api/admin/bodybattle/overview", { cache: "no-store" }),
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
            const bodyBattleOverviewBody = (await bodyBattleOverviewRes.json().catch(() => ({}))) as {
              ok?: boolean;
              message?: string;
              season?: AdminBodyBattleOverview["season"];
              counts?: AdminBodyBattleOverview["counts"];
            };
            const accountDeletionAuditsBody = (await accountDeletionAuditsRes.json().catch(() => ({}))) as {
              error?: string;
              items?: AdminAccountDeletionAudit[];
            };
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
              setAdminOpenCardsLoaded(false);
              setAdminApplyCreditOrders(ordersRes.ok ? ordersBody.items ?? [] : []);
              setAdminMoreViewRequests(moreViewRes.ok ? moreViewBody.items ?? [] : []);
              setAdminCityViewRequests(cityViewRes.ok ? cityViewBody.items ?? [] : []);
              setAdminAccountDeletionAudits(
                accountDeletionAuditsRes.ok ? accountDeletionAuditsBody.items ?? [] : []
              );
              setAdminBodyBattleOverview(
                bodyBattleOverviewRes.ok && bodyBattleOverviewBody.ok
                  ? { season: bodyBattleOverviewBody.season ?? null, counts: bodyBattleOverviewBody.counts ?? null }
                  : null
              );
            }
          } else {
            setAdminDatingStats(null);
            setAdminDatingInsights(null);
            setAdminOpenCards([]);
            setAdminOpenCardApplications([]);
            setAdminPaidCardApplications([]);
            setAdminOpenCardsLoaded(false);
            setAdminApplyCreditOrders([]);
            setAdminSwipeSubscriptionRequests([]);
            setAdminMoreViewRequests([]);
            setAdminCityViewRequests([]);
            setAdminAccountDeletionAudits([]);
            setAdminBodyBattleOverview(null);
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
    if (!isAdmin || adminManageTab !== "open_cards" || adminOpenCardsLoaded || adminOpenCardsLoading) {
      return;
    }

    void refreshAdminOpenCardData(true);
  }, [adminManageTab, adminOpenCardsLoaded, adminOpenCardsLoading, isAdmin, refreshAdminOpenCardData]);

  useEffect(() => {
    if (loading) return;

    queueMicrotask(async () => {
      try {
        setSwipeSubscriptionLoading(true);
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
          premiumLimit: 15,
          priceKrw: 10000,
          durationDays: 15,
        });
        setSwipeSubscriptionError(
          error instanceof Error ? error.message : "빠른매칭 라이크 구매 상태를 불러오지 못했습니다."
        );
      } finally {
        setSwipeSubscriptionLoading(false);
      }
    });
  }, [loading]);

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
    if (digits.startsWith("1")) return `+${digits}`;
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
    if (sendingPhoneOtp) return;
    setPhoneVerifyError("");
    setPhoneVerifyInfo("");
    const e164 = normalizePhoneForOtp(phoneInput);
    if (!e164 || e164.length < 11) {
      setPhoneVerifyError("휴대폰 번호를 올바르게 입력해주세요.");
      return;
    }

    setSendingPhoneOtp(true);
    try {
      const res = await fetch("/api/mypage/phone-verification/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: e164 }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean; pendingPhone?: string };
      if (!res.ok || !body.ok) {
        setPhoneVerifyError(body.error ?? "인증번호 발송에 실패했습니다.");
        return;
      }
      setPhoneOtpPending(body.pendingPhone ?? e164);
      setPhoneVerifyInfo("인증번호를 발송했습니다. 문자로 받은 코드를 입력해주세요.");
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
      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone: phoneOtpPending,
        token: phoneOtpCode.trim(),
        type: "phone_change",
      });
      if (verifyError) {
        setPhoneVerifyError(verifyError.message);
        return;
      }

      const syncRes = await fetch("/api/mypage/phone-verification/sync", {
        method: "POST",
      });
      const syncBody = (await syncRes.json().catch(() => ({}))) as {
        error?: string;
        phone_verified?: boolean;
        phone_verified_at?: string | null;
      };
      if (!syncRes.ok || syncBody.phone_verified !== true) {
        setPhoneVerifyError(syncBody.error ?? "인증 정보 동기화에 실패했습니다.");
        return;
      }

      setSummary((prev) =>
        prev
          ? {
              ...prev,
              profile: {
                ...prev.profile,
                phone_verified: true,
                phone_verified_at: syncBody.phone_verified_at ?? null,
              },
            }
          : prev
      );
      setPhoneOtpCode("");
      setPhoneOtpPending(null);
      setPhoneVerifyInfo("휴대폰 인증이 완료되었습니다.");
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
      await reloadOpenDatingConnections();
    } finally {
      setDeletingAppliedIds((prev) => prev.filter((id) => id !== applicationId));
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
      const body = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean; status?: string };
      if (!res.ok || !body.ok) {
        alert(body.error ?? "지원 취소에 실패했습니다.");
        return;
      }
      setMyAppliedCardApplications((prev) =>
        prev.map((app) => (app.id === applicationId ? { ...app, status: "canceled" } : app))
      );
      await reloadOpenDatingConnections();
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
    if (!confirm("정말 탈퇴하시겠습니까? 탈퇴 후 계정 복구는 불가능합니다.")) return;
    if (!confirm("마지막 확인: 탈퇴 시 데이터가 삭제되고 복구할 수 없습니다.")) return;

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

  const reloadSwipeStatus = async () => {
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
  };

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
      const res = await fetch("/api/dating/cards/swipe/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = (await res.json().catch(() => ({}))) as SwipeSubscriptionStatus & { ok?: boolean; message?: string };
      if (!res.ok || body.ok === false) {
        throw new Error(body.message ?? body.error ?? "빠른매칭 라이크 구매 신청에 실패했습니다.");
      }
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
      setSwipeSubscriptionInfo(body.message ?? "구매 신청이 접수되었습니다.");
      setSwipeSubscriptionPanelOpen(true);
    } catch (error) {
      setSwipeSubscriptionError(
        error instanceof Error ? error.message : "빠른매칭 라이크 구매 신청에 실패했습니다."
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

      const body = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean; message?: string };
      if (!res.ok || body.ok === false) {
        alert(body.error ?? body.message ?? "연결 삭제에 실패했습니다.");
        return;
      }

      if (item.source === "swipe") {
        await Promise.all([reloadSwipeStatus(), reloadOpenDatingConnections()]);
      } else if (item.source === "paid") {
        await Promise.all([reloadPaidAppliedApplications(), reloadOpenDatingConnections()]);
      } else {
        await Promise.all([reloadOpenAppliedApplications(), reloadOpenDatingConnections()]);
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
    action: "select_candidate" | "candidate_accept" | "candidate_reject" | "source_accept" | "source_reject"
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
    if (!confirm("자동 추천 후보 10명을 새로 불러올까요? 2일에 한 번 새로고침할 수 있습니다.")) return;

    setRefreshingOneOnOneRecommendationIds((prev) => [...prev, sourceCardId]);
    try {
      const res = await fetch("/api/dating/1on1/recommendations/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_card_id: sourceCardId }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        alert(body.error ?? "자동 추천 후보를 새로고침하지 못했습니다.");
        return;
      }

      await reloadOneOnOneRecommendations();
      alert("자동 추천 후보 10명을 새로 섞어드렸습니다. 다음 새로고침은 2일 뒤에 가능합니다.");
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
      setAdInquiryInfo("광고 문의 슬롯 설정을 저장했습니다.");
    } catch (e) {
      setAdInquiryError(e instanceof Error ? e.message : "광고 문의 설정 저장에 실패했습니다.");
    } finally {
      setAdInquirySaving(false);
    }
  };

  const handleDeleteMyOpenCard = async (cardId: string) => {
    if (!confirm("대기중 오픈카드를 삭제할까요?")) return;
    const res = await fetch(`/api/dating/cards/my?id=${encodeURIComponent(cardId)}`, {
      method: "DELETE",
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!res.ok) {
      alert(body.error ?? "오픈카드 삭제에 실패했습니다.");
      return;
    }
    setMyDatingCards((prev) => prev.filter((card) => card.id !== cardId));
    alert(body.message ?? "대기중 오픈카드가 삭제되었습니다.");
  };

  const handleDeleteMyOneOnOneCard = async (cardId: string) => {
    if (deletingOneOnOneIds.includes(cardId)) return;
    if (!confirm("1:1 소개팅 프로필을 삭제할까요? 연결된 후보/매칭 기록도 함께 정리될 수 있습니다.")) return;

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

      setMyOneOnOneCards((prev) => prev.filter((item) => item.id !== cardId));
      setMyOneOnOneMatches((prev) =>
        prev.filter((match) => match.source_card_id !== cardId && match.candidate_card_id !== cardId)
      );
      setMyOneOnOneAutoRecommendations((prev) => prev.filter((group) => group.source_card_id !== cardId));
      alert("1:1 소개팅 프로필을 삭제했습니다.");
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
    if (!confirm(`${nickname} 닉네임에게 지원권 3장을 바로 지급할까요?`)) return;

    setAdminApplyCreditGrantLoading(true);
    try {
      const res = await fetch("/api/admin/dating/apply-credits/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, credits: 3 }),
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

  const handleAdminRunBodyBattleOps = async () => {
    if (runningBodyBattleAdminTask) return;
    setRunningBodyBattleAdminTask(true);
    try {
      const res = await fetch("/api/admin/bodybattle/season/run", {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        overview?: AdminBodyBattleOverview;
      };
      if (!res.ok || !body.ok) {
        alert(body.message ?? "바디배틀 운영 작업 실행에 실패했습니다.");
        return;
      }
      if (body.overview) {
        setAdminBodyBattleOverview(body.overview);
      } else {
        const refreshRes = await fetch("/api/admin/bodybattle/overview", { cache: "no-store" });
        const refreshBody = (await refreshRes.json().catch(() => ({}))) as {
          ok?: boolean;
          season?: AdminBodyBattleOverview["season"];
          counts?: AdminBodyBattleOverview["counts"];
        };
        if (refreshRes.ok && refreshBody.ok) {
          setAdminBodyBattleOverview({
            season: refreshBody.season ?? null,
            counts: refreshBody.counts ?? null,
          });
        }
      }
      alert("바디배틀 운영 작업을 실행했습니다.");
    } finally {
      setRunningBodyBattleAdminTask(false);
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
      const auditsBody = (await auditsRes.json().catch(() => ({}))) as {
        items?: AdminAccountDeletionAudit[];
      };
      if (auditsRes.ok) {
        setAdminAccountDeletionAudits(auditsBody.items ?? []);
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
  const posts = summary?.bodycheck_posts ?? [];
  const weeklyWinCount = summary?.weekly_win_count ?? 0;
  const changedCount = summary?.profile.nickname_changed_count ?? 0;
  const credits = summary?.profile.nickname_change_credits ?? 0;
  const canAccessTestPayment = isAllowedTestPaymentEmail(summary?.profile.email);
  const phoneVerified = summary?.profile.phone_verified === true;
  const phoneVerifiedAt = summary?.profile.phone_verified_at ?? null;
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
    candidate_accepted: "최종 수락 대기",
    candidate_rejected: "상대 거절",
    source_declined: "최종 거절",
    admin_canceled: "관리자 종료",
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
  const hasActiveOpenCard = myDatingCards.some((card) => card.status === "pending" || card.status === "public");
  const swipeMatchConnections = datingConnections.filter((item) => item.role === "swipe_match");
  const visibleSwipeMatchCount = swipeMatchConnections.length;
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

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5">
        <h1 className="text-2xl font-bold text-neutral-900">마이페이지</h1>
        <p className="mt-1 text-sm text-neutral-600">{nickname}</p>

        <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-neutral-800">닉네임</p>
              <p className="mt-1 text-xs text-neutral-600">
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
              className="min-h-[40px] rounded-lg border border-neutral-300 px-3 text-sm font-medium text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              닉네임 변경
            </button>
          </div>
          {!canChangeNickname && (
            <p className="mt-2 text-xs text-amber-700">
              닉네임 변경은 1회 무료입니다. 추가 변경권 기능은 준비 중입니다.
            </p>
          )}
          {nicknameInfo && <p className="mt-2 text-xs text-emerald-700">{nicknameInfo}</p>}
        </div>

        <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
          <p className="text-sm font-semibold text-neutral-800">휴대폰 인증</p>
          <p className="mt-1 text-xs text-neutral-600">
            상태:{" "}
            <span className={phoneVerified ? "font-medium text-emerald-700" : "font-medium text-amber-700"}>
              {phoneVerified ? "인증 완료" : "미인증"}
            </span>
          </p>
          {phoneVerifiedAt && (
            <p className="mt-1 text-xs text-neutral-500">
              인증일: {new Date(phoneVerifiedAt).toLocaleString("ko-KR")}
            </p>
          )}

          {!phoneVerified && (
            <div className="mt-3 space-y-2">
              <input
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="휴대폰 번호 (예: 01012345678)"
                className="h-10 w-full rounded-lg border border-neutral-300 px-3 text-sm"
              />
              <button
                type="button"
                onClick={() => void handleSendPhoneOtp()}
                disabled={sendingPhoneOtp}
                className="h-10 rounded-lg border border-neutral-300 px-3 text-sm font-medium text-neutral-700 disabled:opacity-60"
              >
                {sendingPhoneOtp ? "발송 중..." : "인증번호 발송"}
              </button>

              {phoneOtpPending && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={phoneOtpCode}
                    onChange={(e) => setPhoneOtpCode(e.target.value)}
                    placeholder="문자 인증번호"
                    className="h-10 w-full rounded-lg border border-neutral-300 px-3 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void handleVerifyPhoneOtp()}
                    disabled={verifyingPhoneOtp}
                    className="h-10 rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {verifyingPhoneOtp ? "확인 중..." : "인증번호 확인"}
                  </button>
                </div>
              )}

              {phoneVerifyError && <p className="text-xs text-red-600">{phoneVerifyError}</p>}
              {phoneVerifyInfo && <p className="text-xs text-emerald-700">{phoneVerifyInfo}</p>}
            </div>
          )}
        </div>

        {canAccessTestPayment && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-amber-900">결제 센터</p>
                <p className="mt-1 text-xs text-amber-800">지원권과 유료 등록 결제를 진행할 수 있는 전용 페이지입니다.</p>
              </div>
              <Link
                href={`/payments/test?nickname=${encodeURIComponent(summary?.profile.nickname ?? "")}`}
                className="inline-flex min-h-[40px] items-center rounded-lg border border-amber-300 bg-white px-3 text-sm font-medium text-amber-800 hover:bg-amber-100"
              >
                결제 센터 열기
              </Link>
            </div>
          </div>
        )}

        <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-neutral-800">빠른매칭 노출</p>
              <p className="mt-1 text-xs text-neutral-600">
                빠른매칭에서 내 카드가 보일지 설정합니다. 기본값은 노출 ON입니다.
              </p>
            </div>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                swipeProfileVisible ? "bg-emerald-100 text-emerald-700" : "bg-neutral-200 text-neutral-700"
              }`}
            >
              {swipeProfileVisible ? "ON" : "OFF"}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleToggleSwipeVisibility(true)}
              disabled={savingSwipeVisibility || swipeProfileVisible}
              className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              내 카드 보이기
            </button>
            <button
              type="button"
              onClick={() => void handleToggleSwipeVisibility(false)}
              disabled={savingSwipeVisibility || !swipeProfileVisible}
              className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              숨기기
            </button>
          </div>
        </div>

          <div className="mt-4 rounded-xl border border-pink-200 bg-pink-50/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-pink-900">빠른매칭 진행 상황</p>
              <p className="mt-1 text-xs text-pink-700">
                마이페이지가 너무 길어지지 않게 접어두고, 필요할 때만 펼쳐서 확인할 수 있게 바꿨습니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {swipeStatusLoaded && (
                <div className="flex flex-wrap gap-2 text-xs font-medium">
                  <span className="rounded-full bg-white px-3 py-1 text-neutral-700">
                    보낸 라이크 {swipeStatusSummary?.outgoing_pending ?? 0}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1 text-pink-700">
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
                className="h-9 rounded-lg border border-pink-300 bg-white px-3 text-xs font-medium text-pink-800 disabled:cursor-not-allowed disabled:opacity-60"
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
                <p className="text-sm font-semibold text-amber-900">라이크 늘리기</p>
                <p className="mt-1 text-xs text-amber-800">
                  지금 하루 {swipeSubscriptionStatus?.dailyLimit ?? 5}회 사용 가능
                  {swipeSubscriptionStatus?.status === "active"
                    ? ` · 추가 이용 중`
                    : swipeSubscriptionStatus?.status === "pending"
                      ? ` · 승인 대기`
                      : ` · 기본 제공 ${swipeSubscriptionStatus?.baseLimit ?? 5}회`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold text-amber-800">
                  1만원 · 15일 · 하루 {swipeSubscriptionStatus?.premiumLimit ?? 15}회
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
                승인 대기: 신청ID {swipeSubscriptionStatus.pendingSubscription.id}
              </p>
            ) : null}

            {swipeSubscriptionPanelOpen && (
              <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/40 p-3">
                <p className="text-xs text-amber-800">
                  기본은 하루 {swipeSubscriptionStatus?.baseLimit ?? 5}회예요. 추가 이용을 신청하면 15일 동안 하루{" "}
                  {swipeSubscriptionStatus?.premiumLimit ?? 15}회까지 사용할 수 있어요.
                </p>
                <p className="mt-2 text-[11px] text-amber-700">
                  신청 후 오픈카톡으로 닉네임과 신청ID를 보내주시면 확인 뒤 적용됩니다.
                </p>
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
                      swipeSubscriptionLoading ||
                      swipeSubscriptionStatus?.status === "pending" ||
                      swipeSubscriptionStatus?.status === "active"
                    }
                    onClick={() => void handleRequestSwipeSubscription()}
                    className="h-8 rounded-md bg-amber-500 px-3 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {swipeSubscriptionSubmitting ? "신청 중..." : "추가 이용 신청"}
                  </button>
                </div>
                {swipeSubscriptionStatus?.status === "pending" && swipeSubscriptionStatus.pendingSubscription?.id ? (
                  <p className="mt-2 text-[11px] text-amber-700">
                    승인 대기 중: 신청ID {swipeSubscriptionStatus.pendingSubscription.id}
                    {swipeSubscriptionStatus.pendingSubscription.requestedAt
                      ? ` / ${new Date(swipeSubscriptionStatus.pendingSubscription.requestedAt).toLocaleString("ko-KR")}`
                      : ""}
                    {" / "}오픈카톡으로 닉네임과 신청ID를 보내주세요.
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
                          <p className="mt-2 text-sm font-medium text-emerald-700">상대 인스타: @{item.other_instagram_id}</p>
                        ) : (
                          <p className="mt-2 text-xs text-neutral-500">상대 인스타 정보는 연결 목록에서 다시 확인할 수 있어요.</p>
                        )}
                        {item.matched_card ? (
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600">
                            <span>{item.matched_card.sex === "male" ? "남자" : item.matched_card.sex === "female" ? "여자" : "성별 미기재"}</span>
                            {item.matched_card.age != null && <span>{item.matched_card.age}세</span>}
                            {item.matched_card.region && <span>{item.matched_card.region}</span>}
                            {item.matched_card.job && <span>{item.matched_card.job}</span>}
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
                                {item.card?.region ?? "지역 미기재"}
                                {item.card?.job ? ` / ${item.card.job}` : ""}
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
                                  {item.card?.region ?? "지역 미기재"}
                                  {item.card?.job ? ` / ${item.card.job}` : ""}
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

        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-800">주간 몸평 계정 점수</p>
          <p className="mt-1 text-xl font-bold text-amber-900">{weeklyWinCount}점</p>
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
                href="/admin/bodybattle"
                className="flex min-h-[44px] items-center rounded-xl border border-orange-200 bg-orange-50 px-4 text-sm font-medium text-orange-700 hover:bg-orange-100"
              >
                바디배틀 관리
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
            onClick={() => void handleDeleteAccount()}
            disabled={deletingAccount}
            className="min-h-[44px] rounded-xl border border-red-300 bg-white px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            {deletingAccount ? "탈퇴 처리 중..." : "회원 탈퇴"}
          </button>
        </div>
      </section>

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

      <section className="mb-5 rounded-2xl border border-rose-200 bg-rose-50/30 p-5">
        <h2 className="text-lg font-bold text-rose-900 mb-3">내 유료카드 지원자</h2>
        {myPaidCards.length === 0 ? (
          <p className="text-sm text-neutral-500">등록된 유료카드가 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {myPaidCards.map((card) => (
              <div key={card.id} className="rounded-xl border border-rose-200 bg-white p-3">
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
                {card.status === "pending" && (
                  <div className="mt-2">
                    <Link
                      href={`/dating/paid?editId=${card.id}`}
                      className="inline-flex h-8 items-center rounded-md border border-rose-300 bg-white px-3 text-xs font-medium text-rose-700 hover:bg-rose-50"
                    >
                      내용 수정
                    </Link>
                  </div>
                )}
              </div>
            ))}
            {receivedPaidApplications.map((app) => {
              const card = myPaidCards.find((c) => c.id === app.card_id);
              return (
                <div key={app.id} className="rounded-xl border border-rose-200 bg-white p-3">
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
                    <p className="mt-2 text-sm text-emerald-700 font-medium">지원자 인스타: @{app.instagram_id}</p>
                  )}
                  {app.status === "submitted" && (
                    <div className="mt-3 flex gap-2">
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
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-5 rounded-2xl border border-rose-200 bg-white p-5">
        <h2 className="text-lg font-bold text-rose-900 mb-3">내 36시간 고정카드 지원 이력</h2>
        {myAppliedPaidApplications.length === 0 ? (
          <p className="text-sm text-neutral-500">아직 지원한 내역이 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {myAppliedPaidApplications.map((app) => (
              <div key={app.id} className="rounded-xl border border-rose-200 bg-rose-50/30 p-3">
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
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5">
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
            className="inline-flex min-h-[42px] items-center rounded-lg bg-pink-500 px-4 text-sm font-medium text-white hover:bg-pink-600"
          >
            신청하러 가기
          </Link>
        </div>
      </section>

      <section className="mb-5 rounded-2xl border border-sky-200 bg-sky-50/30 p-5">
        <h2 className="text-lg font-bold text-sky-900 mb-3">내 1:1 소개팅 신청 내역</h2>
        {myOneOnOneCards.length === 0 ? (
          <p className="text-sm text-neutral-500">아직 신청한 내역이 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {myOneOnOneCards.map((item) => {
              const relatedMatches = myOneOnOneMatchesByCardId.get(item.id) ?? [];
              const autoRecommendationGroup = myOneOnOneAutoRecommendationsByCardId.get(item.id) ?? null;
              const autoRecommendations = autoRecommendationGroup?.recommendations ?? [];
              const canRefreshAutoRecommendations = autoRecommendationGroup?.can_refresh === true;
              const autoRecommendationRefreshUsed = autoRecommendationGroup?.refresh_used === true;
              const autoRecommendationNextRefreshAt = autoRecommendationGroup?.next_refresh_at ?? null;
              const refreshingAutoRecommendations = refreshingOneOnOneRecommendationIds.includes(item.id);
              const incomingCandidates = relatedMatches.filter((match) => match.role === "source" && match.state === "proposed");
              const waitingCandidateResponses = relatedMatches.filter(
                (match) => match.role === "source" && match.state === "source_selected"
              );
              const finalAcceptRequests = relatedMatches.filter(
                (match) => match.role === "source" && match.state === "candidate_accepted"
              );
              const candidateDecisionRequests = relatedMatches.filter(
                (match) => match.role === "candidate" && match.state === "source_selected"
              );
              const mutualAcceptedMatches = relatedMatches.filter((match) => match.state === "mutual_accepted");
              const closedMatches = relatedMatches.filter((match) =>
                ["source_skipped", "candidate_rejected", "source_declined", "admin_canceled"].includes(match.state)
              );

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
                      {item.status}
                    </span>
                  </div>
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
                                ? "추천 새로고침"
                                : "2일 쿨다운"}
                          </button>
                        </div>
                        <p className="mt-1 text-xs text-pink-700">
                          이 리스트 외에도 운영자가 따로 후보를 보내드릴 수 있어요. 마음에 드는 후보는 여러 명 선택할 수 있고, 선택된 사람마다 수락 요청이 전달됩니다.
                        </p>
                        {autoRecommendationRefreshUsed && (
                          <p className="mt-1 text-xs text-pink-700">
                            {canRefreshAutoRecommendations
                              ? "이 카드는 지금 다시 새로고침할 수 있어요."
                              : autoRecommendationNextRefreshAt
                                ? `다음 새로고침 가능 시각: ${new Date(autoRecommendationNextRefreshAt).toLocaleString("ko-KR")}`
                                : "이 카드는 최근에 추천 새로고침을 사용했어요."}
                          </p>
                        )}
                        {autoRecommendations.length === 0 ? (
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
                                <div className="mt-3">
                                  <button
                                    type="button"
                                    disabled={processing}
                                    onClick={() => void handleOneOnOneAutoRecommendationSelect(item.id, card.id)}
                                    className="inline-flex h-8 items-center rounded-md bg-pink-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                                  >
                                    {processing ? "처리 중..." : "이 후보 선택"}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {incomingCandidates.length > 0 && (
                    <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/50 p-3">
                      <p className="text-sm font-semibold text-sky-900">운영자가 보낸 후보</p>
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
                              <div className="mt-3">
                                <button
                                  type="button"
                                  disabled={processing}
                                  onClick={() => void handleOneOnOneMatchAction(match.id, "select_candidate")}
                                  className="inline-flex h-8 items-center rounded-md bg-sky-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                                >
                                  {processing ? "처리 중..." : "이 후보 선택"}
                                </button>
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
                              <p className="mt-1 text-xs text-neutral-600">상대가 수락하면 바로 최종 매칭 완료로 처리됩니다.</p>
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
                          return (
                            <div key={match.id} className="rounded-lg border border-emerald-200 bg-white p-3">
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
                                {card.height_cm}cm / {card.job} / {new Date(match.updated_at).toLocaleString("ko-KR")}
                              </p>
                              <p className="mt-1 text-xs text-emerald-700">
                                양쪽 수락이 완료되었습니다. 관리자 페이지에서 최종 정리됩니다.
                              </p>
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
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${oneOnOneMatchStateColor[match.state]}`}>
                                {oneOnOneMatchStateText[match.state]}
                              </span>
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
                    {item.status === "submitted" && (
                      <Link
                        href={`/dating/1on1?editId=${item.id}`}
                        className="inline-flex h-8 items-center rounded-md border border-amber-300 bg-white px-3 text-xs font-medium text-amber-700 hover:bg-amber-50"
                      >
                        신청서 수정
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleDeleteMyOneOnOneCard(item.id)}
                      disabled={deletingOneOnOneIds.includes(item.id)}
                      className="inline-flex h-8 items-center rounded-md border border-red-300 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      {deletingOneOnOneIds.includes(item.id) ? "삭제 중..." : "프로필 삭제"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5">
        <h2 className="text-lg font-bold text-emerald-900 mb-2">지원권 현황</h2>
        <p className="text-sm text-emerald-900">
          기본 하루 2장(별도) / 추가 지원권 <span className="font-semibold">{applyCreditsRemaining}장</span>
        </p>
      </section>

      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-bold text-neutral-900 mb-3">내 오픈카드 상태</h2>
        {myDatingCards.length === 0 ? (
          <p className="text-sm text-neutral-500">등록된 오픈카드가 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {myDatingCards.map((card) => (
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
                {card.status === "public" && card.expires_at && (
                  <p className="text-sm text-amber-700 font-medium mt-1">
                    공개 종료까지 남은 시간 {formatRemainingToKorean(card.expires_at)}
                  </p>
                )}
                {card.status === "pending" && (
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-sm text-neutral-600">
                      대기열에 등록되어 있습니다.
                      {typeof card.queue_position === "number" && card.queue_position > 0 ? ` (현재 ${card.queue_position}번째)` : ""}
                    </p>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/dating/card/new?editId=${card.id}`}
                        className="inline-flex h-8 items-center rounded-md border border-pink-300 bg-white px-3 text-xs font-medium text-pink-700 hover:bg-pink-50"
                      >
                        내용 수정
                      </Link>
                      <button
                        type="button"
                        onClick={() => void handleDeleteMyOpenCard(card.id)}
                        className="inline-flex h-8 items-center rounded-md border border-red-300 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
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

      <section id="open-card-received" className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5">
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
                    <p className="mt-2 text-sm text-emerald-700 font-medium">지원자 인스타: @{app.instagram_id}</p>
                  )}

                  {app.status === "submitted" && (
                    <div className="mt-3 flex gap-2">
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
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section id="open-card-applied" className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5">
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
                {app.intro_text && (
                  <p className="mt-2 text-sm text-neutral-700 whitespace-pre-wrap break-words">{app.intro_text}</p>
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

      <section id="dating-connections" className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5">
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
                  <p className="text-sm text-emerald-700 font-medium mt-1">
                    상대 인스타: @{item.other_instagram_id}
                  </p>
                )}
                {item.role === "swipe_match" && item.matched_card && (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-white p-3">
                    <p className="text-xs font-semibold text-emerald-700">자동매칭된 상대 오픈카드</p>
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

      <BodyEvalMailbox />

      {isAdmin && (
        <section className="mb-5 rounded-2xl border border-violet-200 bg-violet-50/40 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-violet-900">오픈카드 전체 내용 (관리자)</h2>
            <button
              type="button"
              disabled={adminManageTab === "open_cards" ? adminOpenCardsLoading : adminQueueRefreshing}
              onClick={() =>
                void (adminManageTab === "open_cards"
                  ? refreshAdminOpenCardData(true)
                  : refreshAdminQueueData(true))
              }
              className="h-8 rounded-md border border-violet-200 bg-white px-3 text-xs font-medium text-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {adminManageTab === "open_cards"
                ? adminOpenCardsLoading
                  ? "불러오는 중..."
                  : "오픈카드 새로고침"
                : adminQueueRefreshing
                  ? "새로고침 중..."
                  : "신청목록 새로고침"}
            </button>
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
              onClick={() => setAdminManageTab("bodybattle")}
              className={`h-8 rounded-md border px-3 text-xs font-medium ${
                adminManageTab === "bodybattle" ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-800"
              }`}
            >
              바디배틀
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
                  <p className="mt-1">상호수락 {adminDatingStats.one_on_one.matches.mutual_accepted} · 운영취소 {adminDatingStats.one_on_one.matches.admin_canceled}</p>
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
          </div>
          )}

          {adminManageTab === "apply_credits" && (
          <div className="mb-3 rounded-xl border border-violet-200 bg-white p-3">
            <p className="text-xs font-semibold text-violet-800">
              지원권 주문 승인 대기 {adminApplyCreditOrders.length}건
            </p>
            <div className="mt-3 rounded-lg border border-violet-100 bg-violet-50/40 p-3">
              <p className="text-xs font-semibold text-violet-900">닉네임으로 지원권 3장 직접 지급</p>
              <p className="mt-1 text-[11px] text-violet-700">주문 없이 바로 3장을 지급하고, 이력은 0원 승인 기록으로 남깁니다.</p>
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

          {adminManageTab === "bodybattle" && (
          <div className="mb-3 rounded-xl border border-violet-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-violet-800">바디배틀 운영</p>
              <button
                type="button"
                disabled={runningBodyBattleAdminTask}
                onClick={() => void handleAdminRunBodyBattleOps()}
                className="h-8 rounded-md bg-violet-600 px-3 text-xs font-medium text-white disabled:opacity-50"
              >
                {runningBodyBattleAdminTask ? "실행 중..." : "시즌 작업 실행"}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link
                href="/admin/bodybattle"
                className="h-8 rounded-md border border-violet-200 bg-violet-50 px-3 text-xs font-medium text-violet-700 inline-flex items-center"
              >
                바디배틀 관리자 페이지
              </Link>
              <Link
                href="/bodybattle"
                className="h-8 rounded-md border border-violet-200 bg-white px-3 text-xs font-medium text-violet-700 inline-flex items-center"
              >
                바디배틀 화면(관리자)
              </Link>
            </div>
            <div className="mt-3 rounded-lg border border-violet-100 bg-violet-50/40 p-2 text-xs text-neutral-700">
              <p>
                현재 시즌:{" "}
                {adminBodyBattleOverview?.season
                  ? `${adminBodyBattleOverview.season.week_id} / ${adminBodyBattleOverview.season.theme_label} (${adminBodyBattleOverview.season.status})`
                  : "없음"}
              </p>
              <p className="mt-1">
                참가 {adminBodyBattleOverview?.counts?.entries_total ?? 0} · 승인활성 {adminBodyBattleOverview?.counts?.entries_approved_active ?? 0}
                {" "}· 검수대기 {adminBodyBattleOverview?.counts?.entries_pending ?? 0} · 신고대기 {adminBodyBattleOverview?.counts?.reports_open ?? 0}
              </p>
              <p className="mt-1">
                투표 {adminBodyBattleOverview?.counts?.votes_total ?? 0} · 보상수령 {adminBodyBattleOverview?.counts?.rewards_claimed ?? 0}
              </p>
            </div>
          </div>
          )}

          {adminManageTab === "community" && (
          <div className="mb-3">
            <AdminCommunityModerationPanel />
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
                관리자만 볼 수 있는 최소 감사기록입니다. 최근 100건만 표시되며, 기본 보관 기간은 90일입니다.
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

      <div className="mb-5">
        <MyLiftGrowthChart />
      </div>

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

      <section>
        <h2 className="mb-3 text-lg font-bold text-neutral-900">내 사진 몸평 게시글</h2>

        {posts.length === 0 ? (
          <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
            아직 등록한 사진 몸평 게시글이 없습니다.
          </p>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => (
              <Link
                key={post.id}
                href={`/community/${post.id}`}
                className="block rounded-2xl border border-neutral-200 bg-white p-4 transition-all hover:border-emerald-300"
              >
                <div className="flex gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-neutral-400">{timeAgo(post.created_at)}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-neutral-900">{post.title}</p>
                    <p className="mt-1 text-xs text-indigo-700">
                      평균 {post.average_score.toFixed(2)} / 투표 {post.vote_count}
                    </p>
                  </div>
                  {(post.images?.length ?? 0) > 0 && (
                    <img
                      src={post.images?.[0]}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-16 w-16 shrink-0 rounded-lg border border-neutral-100 object-cover"
                    />
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {nicknameOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-4 sm:items-center sm:justify-center">
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

