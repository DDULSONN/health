"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/community";
import { formatRemainingToKorean } from "@/lib/dating-open";
import { normalizeNickname, validateNickname } from "@/lib/nickname";
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
  | "open_cards"
  | "apply_credits"
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
  const [adminOpenCards, setAdminOpenCards] = useState<AdminOpenCard[]>([]);
  const [adminOpenCardApplications, setAdminOpenCardApplications] = useState<AdminOpenCardApplication[]>([]);
  const [adminPaidCardApplications, setAdminPaidCardApplications] = useState<AdminPaidCardApplication[]>([]);
  const [adminCardSort, setAdminCardSort] = useState<AdminCardSort>("public_first");
  const [adminApplicationSort, setAdminApplicationSort] = useState<AdminApplicationSort>("newest");
  const [adminDataView, setAdminDataView] = useState<AdminDataView>("cards");
  const [adminManageTab, setAdminManageTab] = useState<AdminManageTab>("open_cards");
  const [adminApplyCreditOrders, setAdminApplyCreditOrders] = useState<AdminApplyCreditOrder[]>([]);
  const [adminMoreViewRequests, setAdminMoreViewRequests] = useState<AdminMoreViewRequest[]>([]);
  const [adminCityViewRequests, setAdminCityViewRequests] = useState<AdminCityViewRequest[]>([]);
  const [adminAccountDeletionAudits, setAdminAccountDeletionAudits] = useState<AdminAccountDeletionAudit[]>([]);
  const [adminCityViewSearch, setAdminCityViewSearch] = useState("");
  const [adminBodyBattleOverview, setAdminBodyBattleOverview] = useState<AdminBodyBattleOverview | null>(null);
  const [runningBodyBattleAdminTask, setRunningBodyBattleAdminTask] = useState(false);
  const [approvingOrderIds, setApprovingOrderIds] = useState<string[]>([]);
  const [processingMoreViewIds, setProcessingMoreViewIds] = useState<string[]>([]);
  const [processingCityViewIds, setProcessingCityViewIds] = useState<string[]>([]);
  const [processingOneOnOneMatchIds, setProcessingOneOnOneMatchIds] = useState<string[]>([]);
  const [processingOneOnOneAutoKeys, setProcessingOneOnOneAutoKeys] = useState<string[]>([]);
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
              overviewRes,
              ordersRes,
              paidAppsRes,
              moreViewRes,
              cityViewRes,
              bodyBattleOverviewRes,
              accountDeletionAuditsRes,
            ] = await Promise.all([
              fetch("/api/dating/cards/admin/overview", { cache: "no-store" }),
              fetch("/api/admin/dating/apply-credits/orders?status=pending", { cache: "no-store" }),
              fetch("/api/admin/dating/paid/applications", { cache: "no-store" }),
              fetch("/api/admin/dating/cards/more-view/requests?status=pending", { cache: "no-store" }),
              fetch("/api/admin/dating/cards/city-view/requests?status=pending", { cache: "no-store" }),
              fetch("/api/admin/bodybattle/overview", { cache: "no-store" }),
              fetch("/api/admin/account-deletion-audits", { cache: "no-store" }),
            ]);
            const overviewBody = (await overviewRes.json().catch(() => ({}))) as {
              error?: string;
              cards?: AdminOpenCard[];
              applications?: AdminOpenCardApplication[];
            };
            const ordersBody = (await ordersRes.json().catch(() => ({}))) as {
              error?: string;
              items?: AdminApplyCreditOrder[];
            };
            const paidAppsBody = (await paidAppsRes.json().catch(() => ({}))) as {
              error?: string;
              items?: AdminPaidCardApplication[];
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
            if (!overviewRes.ok) {
              throw new Error(overviewBody.error ?? "관리자 오픈카드 데이터를 불러오지 못했습니다.");
            }
            if (!ordersRes.ok) {
              throw new Error(ordersBody.error ?? "지원권 주문 목록을 불러오지 못했습니다.");
            }
            if (!paidAppsRes.ok) {
              throw new Error(paidAppsBody.error ?? "관리자 36시간 카드 지원 이력을 불러오지 못했습니다.");
            }
            if (isMounted) {
              setAdminOpenCards(overviewBody.cards ?? []);
              setAdminOpenCardApplications(overviewBody.applications ?? []);
              setAdminPaidCardApplications(paidAppsBody.items ?? []);
              setAdminApplyCreditOrders(ordersBody.items ?? []);
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
            setAdminOpenCards([]);
            setAdminOpenCardApplications([]);
            setAdminPaidCardApplications([]);
            setAdminApplyCreditOrders([]);
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
    if (!confirm("내가 보낸 지원서를 삭제할까요?")) return;

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
    } finally {
      setDeletingAppliedIds((prev) => prev.filter((id) => id !== applicationId));
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
                카드 모더레이션
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
                              <p className="text-sm font-medium text-neutral-900">
                                {card.name} / {card.age ?? "-"}세 / {card.region}
                              </p>
                              <p className="mt-1 text-xs text-emerald-700">
                                양쪽 수락이 완료되었습니다. 관리자 페이지에서 최종 정리됩니다.
                              </p>
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
                  {app.status === "accepted" ? (
                    <p className="text-xs text-neutral-500">수락된 지원서는 삭제할 수 없습니다.</p>
                  ) : (
                    <button
                      type="button"
                      disabled={deletingAppliedIds.includes(app.id)}
                      onClick={() => void handleDeleteMyAppliedCardApplication(app.id)}
                      className="h-8 rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
                    >
                      {deletingAppliedIds.includes(app.id) ? "삭제 중..." : "지원서 삭제"}
                    </button>
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
              <div key={item.application_id} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
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
              </div>
            ))}
          </div>
        )}
      </section>

      <BodyEvalMailbox />

      {isAdmin && (
        <section className="mb-5 rounded-2xl border border-violet-200 bg-violet-50/40 p-5">
          <h2 className="text-lg font-bold text-violet-900 mb-3">오픈카드 전체 내용 (관리자)</h2>

          <div className="mb-3 flex flex-wrap gap-2">
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
            {adminApplyCreditOrders.length === 0 ? (
              <p className="mt-2 text-xs text-neutral-500">승인 대기 주문이 없습니다.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {adminApplyCreditOrders.map((order) => {
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

          {adminManageTab === "more_view" && (
          <div className="mb-3 rounded-xl border border-violet-200 bg-white p-3">
            <p className="text-xs font-semibold text-violet-800">
              이상형 더보기 승인 대기 {adminMoreViewRequests.length}건
            </p>
            {adminMoreViewRequests.length === 0 ? (
              <p className="mt-2 text-xs text-neutral-500">승인 대기 신청이 없습니다.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {adminMoreViewRequests.map((item) => {
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
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => void handleAdminDeleteOpenCard(card.id)}
                          className="h-8 rounded-md bg-red-600 px-3 text-xs font-medium text-white"
                        >
                          삭제
                        </button>
                      </div>
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

