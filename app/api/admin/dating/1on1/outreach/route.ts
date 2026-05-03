import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { sendDatingEmailToAddressDetailed } from "@/lib/dating-swipe";
import { createAdminClient } from "@/lib/supabase/server";

const USER_PAGE_SIZE = 200;
const CARD_BATCH_SIZE = 1000;
const MATCH_BATCH_SIZE = 1000;
const PROFILE_BATCH_SIZE = 500;
const SEND_CONCURRENCY = 2;
const SEND_BATCH_PAUSE_MS = 400;
const RECENT_SUCCESS_HOURS = 24;
const MAIL_LOG_TABLE = "admin_open_card_outreach_mail_logs";

type OneOnOneScope =
  | "combined"
  | "no_card"
  | "pending_review"
  | "approved_no_match"
  | "mutual_no_exchange";
type OneOnOneReason = Exclude<OneOnOneScope, "combined">;
type PhoneVerifiedFilter = "all" | "verified" | "unverified";
type RecentMailFilter = "all" | "not_sent_24h" | "sent_24h";
type SortMode = "priority" | "recent_login" | "nickname" | "recent_mail" | "activity_recent";

type AuthUserLite = {
  id: string;
  email: string | null;
  last_sign_in_at: string | null;
};

type ProfileLite = {
  user_id: string;
  nickname: string | null;
  role?: string | null;
  phone_verified?: boolean | null;
};

type OneOnOneCardLite = {
  user_id: string | null;
  status: string | null;
  created_at: string | null;
};

type OneOnOneMatchLite = {
  source_user_id: string | null;
  candidate_user_id: string | null;
  state: string | null;
  contact_exchange_status: string | null;
  updated_at?: string | null;
  created_at: string | null;
};

type MailLogLite = {
  user_id: string | null;
  sent_at: string | null;
};

type OneOnOneRecipientPreview = {
  user_id: string;
  nickname: string | null;
  email: string | null;
  reason: OneOnOneReason;
  phone_verified: boolean;
  last_sign_in_at: string | null;
  recent_success_mail_sent_at: string | null;
  activity_at: string | null;
};

type OneOnOnePreviewResponse = {
  scope: OneOnOneScope;
  phone_verified_filter: PhoneVerifiedFilter;
  recent_login_days: number | null;
  recent_mail_filter: RecentMailFilter;
  sort: SortMode;
  recipient_count: number;
  no_card_count: number;
  pending_review_count: number;
  approved_no_match_count: number;
  mutual_no_exchange_count: number;
  recent_success_24h_count: number;
  subject: string;
  body: string;
  sample_recipients: OneOnOneRecipientPreview[];
};

type OneOnOnePostPayload = {
  scope?: OneOnOneScope;
  phoneVerified?: PhoneVerifiedFilter;
  recentLoginDays?: number | string | null;
  recentMail?: RecentMailFilter;
  sort?: SortMode;
  subject?: string;
  body?: string;
};

type AdminClient = ReturnType<typeof createAdminClient>;

type MailLogInsertRow = {
  campaign_key: string;
  user_id: string;
  email: string | null;
  subject: string;
  success: boolean;
  provider: string;
  provider_status: number | null;
  provider_error: string | null;
  sent_at: string;
  admin_user_id: string;
  meta: Record<string, unknown>;
};

function parseScope(value: string | null | undefined): OneOnOneScope {
  if (
    value === "combined" ||
    value === "no_card" ||
    value === "pending_review" ||
    value === "approved_no_match" ||
    value === "mutual_no_exchange"
  ) {
    return value;
  }
  return "combined";
}

function parsePhoneVerifiedFilter(value: string | null | undefined): PhoneVerifiedFilter {
  if (value === "verified" || value === "unverified" || value === "all") return value;
  return "all";
}

function parseRecentLoginDays(value: string | null | undefined): number | null {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "all" || raw === "0") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(180, Math.max(1, Math.round(parsed)));
}

function parseRecentMailFilter(value: string | null | undefined): RecentMailFilter {
  if (value === "all" || value === "not_sent_24h" || value === "sent_24h") return value;
  return "not_sent_24h";
}

function parseSort(value: string | null | undefined): SortMode {
  if (
    value === "priority" ||
    value === "recent_login" ||
    value === "nickname" ||
    value === "recent_mail" ||
    value === "activity_recent"
  ) {
    return value;
  }
  return "priority";
}

function buildDefaultSubject(scope: OneOnOneScope) {
  if (scope === "no_card") return "[GymTools] 1:1 소개팅도 가볍게 시작해보세요";
  if (scope === "pending_review") return "[GymTools] 1:1 소개팅 카드가 접수되어 있어요";
  if (scope === "approved_no_match") return "[GymTools] 1:1 소개팅 카드가 준비되어 있어요";
  if (scope === "mutual_no_exchange") return "[GymTools] 1:1 소개팅에서 좋은 소식이 있어요";
  return "[GymTools] 1:1 소개팅으로 더 자연스럽게 연결해보세요";
}

function buildDefaultBody(scope: OneOnOneScope) {
  if (scope === "mutual_no_exchange") {
    return [
      "안녕하세요, GymTools입니다.",
      "",
      "1:1 소개팅에서 좋은 흐름이 생겼을 수 있어요.",
      "마이페이지에서 현재 진행 상황과 번호 교환 단계까지 한 번 확인해보세요.",
      "",
      "1:1 소개팅 확인하러 가기",
      "https://helchang.com/mypage",
    ].join("\n");
  }

  if (scope === "pending_review") {
    return [
      "안녕하세요, GymTools입니다.",
      "",
      "1:1 소개팅 카드를 작성해두셨다면 현재 진행 상태를 한 번 확인해보세요.",
      "승인 후에는 후보 확인과 연결 진행이 더 자연스럽게 이어질 수 있어요.",
      "",
      "1:1 소개팅 보러 가기",
      "https://helchang.com/dating/1on1",
    ].join("\n");
  }

  return [
    "안녕하세요, GymTools입니다.",
    "",
    "오픈카드와는 조금 다르게, 1:1 소개팅은 조금 더 차분하게 연결을 이어가고 싶을 때 잘 맞아요.",
    "카드를 등록해두면 후보 확인, 수락, 번호 교환까지 마이페이지에서 한 번에 이어갈 수 있습니다.",
    "",
    "1:1 소개팅 보러 가기",
    "https://helchang.com/dating/1on1",
  ].join("\n");
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object") {
    const maybeMessage = "message" in error ? String(error.message ?? "").trim() : "";
    if (maybeMessage) return maybeMessage;
  }
  return fallback;
}

function isMissingTableError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code ?? "").trim() : "";
  const message = "message" in error ? String(error.message ?? "").trim() : "";
  return code === "42P01" || message.includes(MAIL_LOG_TABLE);
}

async function fetchAllAuthUsers(admin: AdminClient) {
  const users: AuthUserLite[] = [];
  let page = 1;

  while (true) {
    const res = await admin.auth.admin.listUsers({ page, perPage: USER_PAGE_SIZE });
    if (res.error) {
      throw new Error(`회원 목록을 불러오지 못했습니다. ${res.error.message}`);
    }

    const batch = res.data?.users ?? [];
    for (const user of batch) {
      const id = String(user.id ?? "").trim();
      const email = String(user.email ?? "").trim() || null;
      if (!id || !email) continue;
      users.push({
        id,
        email,
        last_sign_in_at: user.last_sign_in_at ?? null,
      });
    }

    if (batch.length < USER_PAGE_SIZE) break;
    page += 1;
  }

  return users;
}

async function fetchProfilesByUserIds(admin: AdminClient, userIds: string[]) {
  const profileByUserId = new Map<string, ProfileLite>();
  if (!userIds.length) return profileByUserId;

  for (let start = 0; start < userIds.length; start += PROFILE_BATCH_SIZE) {
    const chunk = userIds.slice(start, start + PROFILE_BATCH_SIZE);
    const res = await admin.from("profiles").select("user_id,nickname,role,phone_verified").in("user_id", chunk);

    if (res.error) {
      throw new Error(`프로필 정보를 불러오지 못했습니다. ${res.error.message}`);
    }

    for (const row of (res.data ?? []) as ProfileLite[]) {
      const userId = String(row.user_id ?? "").trim();
      if (!userId) continue;
      profileByUserId.set(userId, {
        user_id: userId,
        nickname: row.nickname ?? null,
        role: row.role ?? null,
        phone_verified: row.phone_verified ?? false,
      });
    }
  }

  return profileByUserId;
}

async function fetchAllOneOnOneCards(admin: AdminClient) {
  const rows: OneOnOneCardLite[] = [];
  let from = 0;

  while (true) {
    const res = await admin
      .from("dating_1on1_cards")
      .select("user_id,status,created_at")
      .order("created_at", { ascending: false })
      .range(from, from + CARD_BATCH_SIZE - 1);

    if (res.error) {
      throw new Error(`1:1 카드 목록을 불러오지 못했습니다. ${res.error.message}`);
    }

    const batch = (res.data ?? []) as OneOnOneCardLite[];
    rows.push(...batch);
    if (batch.length < CARD_BATCH_SIZE) break;
    from += CARD_BATCH_SIZE;
  }

  return rows;
}

async function fetchAllOneOnOneMatches(admin: AdminClient) {
  const rows: OneOnOneMatchLite[] = [];
  let from = 0;

  while (true) {
    const res = await admin
      .from("dating_1on1_match_proposals")
      .select("source_user_id,candidate_user_id,state,contact_exchange_status,created_at,updated_at")
      .order("created_at", { ascending: false })
      .range(from, from + MATCH_BATCH_SIZE - 1);

    if (res.error) {
      throw new Error(`1:1 매칭 목록을 불러오지 못했습니다. ${res.error.message}`);
    }

    const batch = (res.data ?? []) as OneOnOneMatchLite[];
    rows.push(...batch);
    if (batch.length < MATCH_BATCH_SIZE) break;
    from += MATCH_BATCH_SIZE;
  }

  return rows;
}

async function fetchRecentSuccessfulMailMap(admin: AdminClient, userIds: string[]) {
  const sentAtByUserId = new Map<string, string>();
  if (!userIds.length) return sentAtByUserId;

  const cutoff = new Date(Date.now() - RECENT_SUCCESS_HOURS * 60 * 60 * 1000).toISOString();

  for (let start = 0; start < userIds.length; start += PROFILE_BATCH_SIZE) {
    const chunk = userIds.slice(start, start + PROFILE_BATCH_SIZE);
    const res = await admin
      .from(MAIL_LOG_TABLE)
      .select("user_id,sent_at")
      .eq("campaign_key", "one_on_one_outreach")
      .eq("success", true)
      .gte("sent_at", cutoff)
      .in("user_id", chunk)
      .order("sent_at", { ascending: false });

    if (res.error) {
      if (isMissingTableError(res.error)) {
        console.warn(`[1on1-outreach] mail log table missing: ${MAIL_LOG_TABLE}`);
        return new Map<string, string>();
      }
      throw new Error(`메일 발송 로그를 불러오지 못했습니다. ${res.error.message}`);
    }

    for (const row of (res.data ?? []) as MailLogLite[]) {
      const userId = String(row.user_id ?? "").trim();
      const sentAt = String(row.sent_at ?? "").trim();
      if (!userId || !sentAt) continue;
      if (!sentAtByUserId.has(userId)) {
        sentAtByUserId.set(userId, sentAt);
      }
    }
  }

  return sentAtByUserId;
}

function isRecentLogin(lastSignInAt: string | null, recentLoginDays: number | null) {
  if (recentLoginDays == null) return true;
  if (!lastSignInAt) return false;
  const time = new Date(lastSignInAt).getTime();
  if (!Number.isFinite(time)) return false;
  return Date.now() - time <= recentLoginDays * 24 * 60 * 60 * 1000;
}

function matchesPhoneFilter(phoneVerified: boolean, filter: PhoneVerifiedFilter) {
  if (filter === "all") return true;
  return filter === "verified" ? phoneVerified : !phoneVerified;
}

function buildMatchMaps(matches: OneOnOneMatchLite[]) {
  const mutualAcceptedByUser = new Set<string>();
  const mutualNoExchangeAtByUser = new Map<string, string>();

  for (const row of matches) {
    if (row.state !== "mutual_accepted") continue;

    const users = [String(row.source_user_id ?? "").trim(), String(row.candidate_user_id ?? "").trim()].filter(Boolean);
    for (const userId of users) {
      mutualAcceptedByUser.add(userId);
    }

    if (row.contact_exchange_status === "approved" || row.contact_exchange_status === "canceled") continue;

    const activityAt = String(row.updated_at ?? row.created_at ?? "").trim() || null;
    for (const userId of users) {
      if (!mutualNoExchangeAtByUser.has(userId) && activityAt) {
        mutualNoExchangeAtByUser.set(userId, activityAt);
      }
    }
  }

  return { mutualAcceptedByUser, mutualNoExchangeAtByUser };
}

function sortRecipients(recipients: OneOnOneRecipientPreview[], sort: SortMode) {
  recipients.sort((a, b) => {
    if (sort === "recent_mail") {
      const aTime = new Date(a.recent_success_mail_sent_at ?? "").getTime();
      const bTime = new Date(b.recent_success_mail_sent_at ?? "").getTime();
      if ((Number.isFinite(bTime) ? bTime : 0) !== (Number.isFinite(aTime) ? aTime : 0)) {
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      }
    }

    if (sort === "activity_recent") {
      const aTime = new Date(a.activity_at ?? "").getTime();
      const bTime = new Date(b.activity_at ?? "").getTime();
      if ((Number.isFinite(bTime) ? bTime : 0) !== (Number.isFinite(aTime) ? aTime : 0)) {
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      }
    }

    if (sort === "recent_login") {
      const aTime = new Date(a.last_sign_in_at ?? "").getTime();
      const bTime = new Date(b.last_sign_in_at ?? "").getTime();
      if ((Number.isFinite(bTime) ? bTime : 0) !== (Number.isFinite(aTime) ? aTime : 0)) {
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      }
    }

    if (sort === "nickname") {
      return (a.nickname ?? a.email ?? "").localeCompare(b.nickname ?? b.email ?? "", "ko");
    }

    const priorityMap: Record<OneOnOneReason, number> = {
      mutual_no_exchange: 0,
      approved_no_match: 1,
      pending_review: 2,
      no_card: 3,
    };

    if (priorityMap[a.reason] !== priorityMap[b.reason]) {
      return priorityMap[a.reason] - priorityMap[b.reason];
    }

    const aRecentMail = a.recent_success_mail_sent_at ? 1 : 0;
    const bRecentMail = b.recent_success_mail_sent_at ? 1 : 0;
    if (aRecentMail !== bRecentMail) return aRecentMail - bRecentMail;

    const aActivity = new Date(a.activity_at ?? "").getTime();
    const bActivity = new Date(b.activity_at ?? "").getTime();
    if ((Number.isFinite(bActivity) ? bActivity : 0) !== (Number.isFinite(aActivity) ? aActivity : 0)) {
      return (Number.isFinite(bActivity) ? bActivity : 0) - (Number.isFinite(aActivity) ? aActivity : 0);
    }

    const aLoginTime = new Date(a.last_sign_in_at ?? "").getTime();
    const bLoginTime = new Date(b.last_sign_in_at ?? "").getTime();
    if ((Number.isFinite(bLoginTime) ? bLoginTime : 0) !== (Number.isFinite(aLoginTime) ? aLoginTime : 0)) {
      return (Number.isFinite(bLoginTime) ? bLoginTime : 0) - (Number.isFinite(aLoginTime) ? aLoginTime : 0);
    }

    return (a.nickname ?? a.email ?? "").localeCompare(b.nickname ?? b.email ?? "", "ko");
  });
}

function buildRecipients(input: {
  users: AuthUserLite[];
  profileByUserId: Map<string, ProfileLite>;
  cards: OneOnOneCardLite[];
  matches: OneOnOneMatchLite[];
  scope: OneOnOneScope;
  phoneVerifiedFilter: PhoneVerifiedFilter;
  recentLoginDays: number | null;
  recentMailFilter: RecentMailFilter;
  recentSuccessMailByUserId: Map<string, string>;
  sort: SortMode;
}) {
  const {
    users,
    profileByUserId,
    cards,
    matches,
    scope,
    phoneVerifiedFilter,
    recentLoginDays,
    recentMailFilter,
    recentSuccessMailByUserId,
    sort,
  } = input;

  const cardsByUserId = new Map<string, OneOnOneCardLite[]>();
  for (const row of cards) {
    const userId = String(row.user_id ?? "").trim();
    if (!userId) continue;
    const bucket = cardsByUserId.get(userId) ?? [];
    bucket.push(row);
    cardsByUserId.set(userId, bucket);
  }

  const { mutualAcceptedByUser, mutualNoExchangeAtByUser } = buildMatchMaps(matches);

  const recipients: OneOnOneRecipientPreview[] = [];
  let noCardCount = 0;
  let pendingReviewCount = 0;
  let approvedNoMatchCount = 0;
  let mutualNoExchangeCount = 0;

  for (const user of users) {
    const profile = profileByUserId.get(user.id);
    if (profile?.role === "admin") continue;

    const phoneVerified = profile?.phone_verified === true;
    if (!matchesPhoneFilter(phoneVerified, phoneVerifiedFilter)) continue;
    if (!isRecentLogin(user.last_sign_in_at, recentLoginDays)) continue;

    const recentSuccessMailSentAt = recentSuccessMailByUserId.get(user.id) ?? null;
    if (recentMailFilter === "not_sent_24h" && recentSuccessMailSentAt) continue;
    if (recentMailFilter === "sent_24h" && !recentSuccessMailSentAt) continue;

    const userCards = cardsByUserId.get(user.id) ?? [];
    const latestCard = [...userCards].sort(
      (a, b) => new Date(String(b.created_at ?? "")).getTime() - new Date(String(a.created_at ?? "")).getTime()
    )[0];

    let reason: OneOnOneReason | null = null;
    let activityAt: string | null = null;

    if (mutualNoExchangeAtByUser.has(user.id)) {
      reason = "mutual_no_exchange";
      activityAt = mutualNoExchangeAtByUser.get(user.id) ?? null;
    } else if (latestCard?.status === "approved" && !mutualAcceptedByUser.has(user.id)) {
      reason = "approved_no_match";
      activityAt = latestCard.created_at ?? null;
    } else if (latestCard?.status === "submitted" || latestCard?.status === "reviewing") {
      reason = "pending_review";
      activityAt = latestCard.created_at ?? null;
    } else if (!latestCard) {
      reason = "no_card";
      activityAt = user.last_sign_in_at;
    }

    if (!reason) continue;
    if (scope !== "combined" && scope !== reason) continue;

    if (reason === "no_card") noCardCount += 1;
    if (reason === "pending_review") pendingReviewCount += 1;
    if (reason === "approved_no_match") approvedNoMatchCount += 1;
    if (reason === "mutual_no_exchange") mutualNoExchangeCount += 1;

    recipients.push({
      user_id: user.id,
      nickname: profile?.nickname ?? null,
      email: user.email,
      reason,
      phone_verified: phoneVerified,
      last_sign_in_at: user.last_sign_in_at,
      recent_success_mail_sent_at: recentSuccessMailSentAt,
      activity_at: activityAt,
    });
  }

  sortRecipients(recipients, sort);
  const recentSuccess24hCount = recipients.filter((item) => item.recent_success_mail_sent_at).length;

  return {
    recipients,
    noCardCount,
    pendingReviewCount,
    approvedNoMatchCount,
    mutualNoExchangeCount,
    recentSuccess24hCount,
  };
}

async function buildPreview(
  admin: AdminClient,
  scope: OneOnOneScope,
  phoneVerifiedFilter: PhoneVerifiedFilter,
  recentLoginDays: number | null,
  recentMailFilter: RecentMailFilter,
  sort: SortMode
): Promise<OneOnOnePreviewResponse> {
  const users = await fetchAllAuthUsers(admin);
  const userIds = users.map((user) => user.id);
  const [profileByUserId, cards, matches, recentSuccessMailByUserId] = await Promise.all([
    fetchProfilesByUserIds(admin, userIds),
    fetchAllOneOnOneCards(admin),
    fetchAllOneOnOneMatches(admin),
    fetchRecentSuccessfulMailMap(admin, userIds),
  ]);

  const { recipients, noCardCount, pendingReviewCount, approvedNoMatchCount, mutualNoExchangeCount, recentSuccess24hCount } =
    buildRecipients({
      users,
      profileByUserId,
      cards,
      matches,
      scope,
      phoneVerifiedFilter,
      recentLoginDays,
      recentMailFilter,
      recentSuccessMailByUserId,
      sort,
    });

  return {
    scope,
    phone_verified_filter: phoneVerifiedFilter,
    recent_login_days: recentLoginDays,
    recent_mail_filter: recentMailFilter,
    sort,
    recipient_count: recipients.length,
    no_card_count: noCardCount,
    pending_review_count: pendingReviewCount,
    approved_no_match_count: approvedNoMatchCount,
    mutual_no_exchange_count: mutualNoExchangeCount,
    recent_success_24h_count: recentSuccess24hCount,
    subject: buildDefaultSubject(scope),
    body: buildDefaultBody(scope),
    sample_recipients: recipients.slice(0, 20),
  };
}

async function insertLogs(admin: AdminClient, rows: MailLogInsertRow[]) {
  if (!rows.length) return;
  const res = await admin.from(MAIL_LOG_TABLE).insert(rows);
  if (res.error) {
    if (isMissingTableError(res.error)) return;
    console.error("[1on1-outreach] failed to insert mail logs", res.error);
  }
}

async function sendInBatchesSafely(input: {
  admin: AdminClient;
  adminUserId: string;
  recipients: OneOnOneRecipientPreview[];
  subject: string;
  body: string;
  scope: OneOnOneScope;
  phoneVerifiedFilter: PhoneVerifiedFilter;
  recentLoginDays: number | null;
  recentMailFilter: RecentMailFilter;
  sort: SortMode;
}) {
  const { admin, adminUserId, recipients, subject, body, scope, phoneVerifiedFilter, recentLoginDays, recentMailFilter, sort } = input;

  let sent = 0;
  let failed = 0;
  let firstFailure: string | null = null;
  const failureBuckets = new Map<string, number>();

  for (let start = 0; start < recipients.length; start += SEND_CONCURRENCY) {
    const batch = recipients.slice(start, start + SEND_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (item) => {
        const sentAt = new Date().toISOString();
        const meta = {
          scope,
          phone_verified_filter: phoneVerifiedFilter,
          recent_login_days: recentLoginDays,
          recent_mail_filter: recentMailFilter,
          sort,
          reason: item.reason,
          activity_at: item.activity_at,
        };

        if (!item.email) {
          return {
            ok: false as const,
            error: `발송 실패: ${item.nickname ?? item.user_id} / EMAIL_MISSING`,
            logRow: {
              campaign_key: "one_on_one_outreach",
              user_id: item.user_id,
              email: null,
              subject,
              success: false,
              provider: "resend",
              provider_status: null,
              provider_error: "EMAIL_MISSING",
              sent_at: sentAt,
              admin_user_id: adminUserId,
              meta,
            } satisfies MailLogInsertRow,
          };
        }

        const result = await sendDatingEmailToAddressDetailed(item.email, subject, body).catch(() => ({
          ok: false,
          status: undefined,
          error: "UNHANDLED_SEND_ERROR",
          retryable: false,
        }));

        return result.ok
          ? {
              ok: true as const,
              error: null,
              logRow: {
                campaign_key: "one_on_one_outreach",
                user_id: item.user_id,
                email: item.email,
                subject,
                success: true,
                provider: "resend",
                provider_status: result.status ?? 200,
                provider_error: null,
                sent_at: sentAt,
                admin_user_id: adminUserId,
                meta,
              } satisfies MailLogInsertRow,
            }
          : {
              ok: false as const,
              error: `발송 실패: ${item.nickname ?? item.email} (${item.email}) / ${result.status ?? "-"} / ${result.error ?? "UNKNOWN"}`,
              logRow: {
                campaign_key: "one_on_one_outreach",
                user_id: item.user_id,
                email: item.email,
                subject,
                success: false,
                provider: "resend",
                provider_status: result.status ?? null,
                provider_error: result.error ?? "UNKNOWN",
                sent_at: sentAt,
                admin_user_id: adminUserId,
                meta,
              } satisfies MailLogInsertRow,
            };
      })
    );

    await insertLogs(
      admin,
      results.map((result) => result.logRow)
    );

    for (const result of results) {
      if (result.ok) {
        sent += 1;
        continue;
      }
      failed += 1;
      if (!firstFailure && result.error) firstFailure = result.error;
      if (result.error) {
        const bucketKey = result.error.split(" / ").slice(1).join(" / ") || result.error;
        failureBuckets.set(bucketKey, (failureBuckets.get(bucketKey) ?? 0) + 1);
      }
    }

    if (start + SEND_CONCURRENCY < recipients.length) {
      await new Promise((resolve) => setTimeout(resolve, SEND_BATCH_PAUSE_MS));
    }
  }

  const failureSummary = Array.from(failureBuckets.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => `${count}건 · ${reason}`);

  return { sent, failed, firstFailure, failureSummary };
}

export async function GET(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const scope = parseScope(params.get("scope"));
    const phoneVerifiedFilter = parsePhoneVerifiedFilter(params.get("phoneVerified"));
    const recentLoginDays = parseRecentLoginDays(params.get("recentLoginDays"));
    const recentMailFilter = parseRecentMailFilter(params.get("recentMail"));
    const sort = parseSort(params.get("sort"));

    const preview = await buildPreview(
      auth.admin,
      scope,
      phoneVerifiedFilter,
      recentLoginDays,
      recentMailFilter,
      sort
    );
    return NextResponse.json(preview);
  } catch (error) {
    console.error("[GET /api/admin/dating/1on1/outreach] failed", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "1:1 소개팅 메일 미리보기를 불러오지 못했습니다.") },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  try {
    let payload: OneOnOnePostPayload | null = null;
    try {
      payload = (await request.json()) as OneOnOnePostPayload;
    } catch {
      payload = null;
    }

    const scope = parseScope(payload?.scope);
    const phoneVerifiedFilter = parsePhoneVerifiedFilter(payload?.phoneVerified);
    const recentLoginDays = parseRecentLoginDays(String(payload?.recentLoginDays ?? ""));
    const recentMailFilter = parseRecentMailFilter(payload?.recentMail);
    const sort = parseSort(payload?.sort);
    const subject = String(payload?.subject ?? "").trim();
    const body = String(payload?.body ?? "").trim();

    if (!subject) {
      return NextResponse.json({ error: "메일 제목을 입력해주세요." }, { status: 400 });
    }
    if (!body) {
      return NextResponse.json({ error: "메일 본문을 입력해주세요." }, { status: 400 });
    }

    const users = await fetchAllAuthUsers(auth.admin);
    const userIds = users.map((user) => user.id);
    const [profileByUserId, cards, matches, recentSuccessMailByUserId] = await Promise.all([
      fetchProfilesByUserIds(auth.admin, userIds),
      fetchAllOneOnOneCards(auth.admin),
      fetchAllOneOnOneMatches(auth.admin),
      fetchRecentSuccessfulMailMap(auth.admin, userIds),
    ]);

    const { recipients } = buildRecipients({
      users,
      profileByUserId,
      cards,
      matches,
      scope,
      phoneVerifiedFilter,
      recentLoginDays,
      recentMailFilter,
      recentSuccessMailByUserId,
      sort,
    });

    const { sent, failed, firstFailure, failureSummary } = await sendInBatchesSafely({
      admin: auth.admin,
      adminUserId: auth.user.id,
      recipients,
      subject,
      body,
      scope,
      phoneVerifiedFilter,
      recentLoginDays,
      recentMailFilter,
      sort,
    });

    if (sent === 0 && recipients.length > 0) {
      const detail = firstFailure ? ` (${firstFailure})` : "";
      return NextResponse.json({ error: `1:1 소개팅 메일 발송에 실패했습니다.${detail}` }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      scope,
      phone_verified_filter: phoneVerifiedFilter,
      recent_login_days: recentLoginDays,
      recent_mail_filter: recentMailFilter,
      sort,
      requested: recipients.length,
      sent,
      failed,
      failure_summary: failureSummary,
    });
  } catch (error) {
    console.error("[POST /api/admin/dating/1on1/outreach] failed", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "1:1 소개팅 메일 발송에 실패했습니다.") },
      { status: 500 }
    );
  }
}
