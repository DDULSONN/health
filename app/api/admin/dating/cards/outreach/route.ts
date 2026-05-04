import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { sendDatingEmailToAddressDetailed } from "@/lib/dating-swipe";
import {
  appendMarketingEmailFooter,
  fetchMarketingUnsubscribedUserIds,
  normalizeMarketingSubject,
} from "@/lib/marketing-email";
import { createAdminClient } from "@/lib/supabase/server";

const USER_PAGE_SIZE = 200;
const CARD_BATCH_SIZE = 1000;
const PROFILE_BATCH_SIZE = 500;
const SEND_CONCURRENCY = 2;
const SEND_BATCH_PAUSE_MS = 200;
const MAX_SEND_PER_REQUEST = 150;
const DEFAULT_STALE_DAYS = 30;
const RECENT_SUCCESS_HOURS = 24;
const MAIL_LOG_TABLE = "admin_open_card_outreach_mail_logs";
const CAMPAIGN_KEY = "open_card_outreach";

type OutreachScope = "no_card" | "expired_stale" | "combined";
type RecipientReason = "no_card" | "expired_stale";
type PhoneVerifiedFilter = "all" | "verified" | "unverified";
type RecentMailFilter = "all" | "not_sent_24h" | "sent_24h" | "never_sent_success";
type SortMode = "priority" | "expired_oldest" | "recent_login" | "nickname" | "recent_mail" | "signup_oldest";

type AuthUserLite = {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
};

type ProfileLite = {
  user_id: string;
  nickname: string | null;
  role?: string | null;
  phone_verified?: boolean | null;
};

type DatingCardLite = {
  owner_user_id: string | null;
  status: string | null;
  expires_at: string | null;
  created_at: string | null;
};

type OutreachMailLogLite = {
  user_id: string | null;
  sent_at: string | null;
};

type OutreachRecipientPreview = {
  user_id: string;
  nickname: string | null;
  email: string | null;
  reason: RecipientReason;
  expired_days: number | null;
  phone_verified: boolean;
  created_at: string | null;
  last_sign_in_at: string | null;
  recent_success_mail_sent_at: string | null;
  successful_mail_sent_at: string | null;
};

type OutreachPreviewResponse = {
  scope: OutreachScope;
  stale_days: number;
  phone_verified_filter: PhoneVerifiedFilter;
  recent_login_days: number | null;
  recent_mail_filter: RecentMailFilter;
  sort: SortMode;
  batch_limit: number;
  total_candidate_count: number;
  recipient_count: number;
  no_card_count: number;
  expired_stale_count: number;
  recent_success_24h_count: number;
  successful_mail_count: number;
  subject: string;
  body: string;
  sample_recipients: OutreachRecipientPreview[];
};

type OutreachPostPayload = {
  scope?: OutreachScope;
  staleDays?: number | string | null;
  phoneVerified?: PhoneVerifiedFilter;
  recentLoginDays?: number | string | null;
  recentMail?: RecentMailFilter;
  sort?: SortMode;
  batchLimit?: number | string | null;
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

function parseScope(value: string | null | undefined): OutreachScope {
  if (value === "no_card" || value === "expired_stale" || value === "combined") return value;
  return "combined";
}

function parseStaleDays(value: string | null | undefined): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed)) return DEFAULT_STALE_DAYS;
  return Math.min(180, Math.max(7, Math.round(parsed)));
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
  if (value === "all" || value === "not_sent_24h" || value === "sent_24h" || value === "never_sent_success") return value;
  return "not_sent_24h";
}

function parseSort(value: string | null | undefined): SortMode {
  if (
    value === "expired_oldest" ||
    value === "recent_login" ||
    value === "nickname" ||
    value === "recent_mail" ||
    value === "signup_oldest" ||
    value === "priority"
  ) {
    return value;
  }
  return "priority";
}

function parseBatchLimit(value: string | null | undefined): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed)) return MAX_SEND_PER_REQUEST;
  return Math.min(MAX_SEND_PER_REQUEST, Math.max(1, Math.round(parsed)));
}

function buildDefaultSubject(scope: OutreachScope) {
  if (scope === "no_card") return normalizeMarketingSubject("오픈카드 등록하고 가까운 이상형을 확인해보세요");
  if (scope === "expired_stale") return normalizeMarketingSubject("오픈카드를 다시 열고 새로운 연결을 받아보세요");
  return normalizeMarketingSubject("오픈카드로 자연스럽게 연결을 다시 시작해보세요");
}

function buildDefaultBody() {
  return [
    "안녕하세요, GymTools입니다.",
    "",
    "오픈카드를 등록하면",
    "내 카드를 보고 먼저 관심이나 지원이 들어올 수 있고,",
    "직접 빠른매칭이나 1:1 소개팅으로도 이어갈 수 있어요.",
    "",
    "운동이라는 공통 관심사로 시작할 수 있어서",
    "조금 더 자연스럽게 연결되기 좋습니다.",
    "",
    "오픈카드를 등록·유지하면",
    "매주 원하는 지역 1곳을 무료로 열어볼 수 있어",
    "가까운 이상형부터 둘러보기에도 편해요.",
    "",
    "부담 없이 다시 시작해보세요.",
    "",
    "오픈카드 등록하러 가기",
    "https://helchang.com/community/dating/cards/new",
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
        created_at: user.created_at ?? null,
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
    const res = await admin
      .from("profiles")
      .select("user_id,nickname,role,phone_verified")
      .in("user_id", chunk);

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

async function fetchAllDatingCards(admin: AdminClient) {
  const rows: DatingCardLite[] = [];
  let from = 0;

  while (true) {
    const res = await admin
      .from("dating_cards")
      .select("owner_user_id,status,expires_at,created_at")
      .order("created_at", { ascending: false })
      .range(from, from + CARD_BATCH_SIZE - 1);

    if (res.error) {
      throw new Error(`오픈카드 목록을 불러오지 못했습니다. ${res.error.message}`);
    }

    const batch = (res.data ?? []) as DatingCardLite[];
    rows.push(...batch);
    if (batch.length < CARD_BATCH_SIZE) break;
    from += CARD_BATCH_SIZE;
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
      .eq("campaign_key", CAMPAIGN_KEY)
      .eq("success", true)
      .gte("sent_at", cutoff)
      .in("user_id", chunk)
      .order("sent_at", { ascending: false });

    if (res.error) {
      if (isMissingTableError(res.error)) {
        console.warn(`[outreach] mail log table missing: ${MAIL_LOG_TABLE}`);
        return new Map<string, string>();
      }
      throw new Error(`메일 발송 로그를 불러오지 못했습니다. ${res.error.message}`);
    }

    for (const row of (res.data ?? []) as OutreachMailLogLite[]) {
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

async function fetchLatestSuccessfulMailMap(admin: AdminClient, userIds: string[]) {
  const sentAtByUserId = new Map<string, string>();
  if (!userIds.length) return sentAtByUserId;

  for (let start = 0; start < userIds.length; start += PROFILE_BATCH_SIZE) {
    const chunk = userIds.slice(start, start + PROFILE_BATCH_SIZE);
    const res = await admin
      .from(MAIL_LOG_TABLE)
      .select("user_id,sent_at")
      .eq("campaign_key", CAMPAIGN_KEY)
      .eq("success", true)
      .in("user_id", chunk)
      .order("sent_at", { ascending: false });

    if (res.error) {
      if (isMissingTableError(res.error)) {
        console.warn(`[outreach] mail log table missing: ${MAIL_LOG_TABLE}`);
        return new Map<string, string>();
      }
      throw new Error(`메일 발송 로그를 불러오지 못했습니다. ${res.error.message}`);
    }

    for (const row of (res.data ?? []) as OutreachMailLogLite[]) {
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

function getRowSortTime(row: DatingCardLite) {
  const source = row.created_at ?? row.expires_at ?? "";
  const time = new Date(source).getTime();
  return Number.isFinite(time) ? time : 0;
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

function sortRecipients(recipients: OutreachRecipientPreview[], sort: SortMode) {
  recipients.sort((a, b) => {
    if (sort === "signup_oldest") {
      const aTime = new Date(a.created_at ?? "").getTime();
      const bTime = new Date(b.created_at ?? "").getTime();
      if ((Number.isFinite(aTime) ? aTime : 0) !== (Number.isFinite(bTime) ? bTime : 0)) {
        return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
      }
    }

    if (sort === "recent_mail") {
      const aTime = new Date(a.recent_success_mail_sent_at ?? "").getTime();
      const bTime = new Date(b.recent_success_mail_sent_at ?? "").getTime();
      if ((Number.isFinite(bTime) ? bTime : 0) !== (Number.isFinite(aTime) ? aTime : 0)) {
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      }
    }

    if (sort === "expired_oldest") {
      if ((b.expired_days ?? 0) !== (a.expired_days ?? 0)) return (b.expired_days ?? 0) - (a.expired_days ?? 0);
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

    const aRecentMail = a.recent_success_mail_sent_at ? 1 : 0;
    const bRecentMail = b.recent_success_mail_sent_at ? 1 : 0;
    if (aRecentMail !== bRecentMail) return aRecentMail - bRecentMail;

    if (a.reason !== b.reason) return a.reason === "expired_stale" ? -1 : 1;
    if ((b.expired_days ?? 0) !== (a.expired_days ?? 0)) return (b.expired_days ?? 0) - (a.expired_days ?? 0);

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
  cards: DatingCardLite[];
  scope: OutreachScope;
  staleDays: number;
  phoneVerifiedFilter: PhoneVerifiedFilter;
  recentLoginDays: number | null;
  recentMailFilter: RecentMailFilter;
  recentSuccessMailByUserId: Map<string, string>;
  successfulMailByUserId: Map<string, string>;
  unsubscribedUserIds: Set<string>;
  sort: SortMode;
  batchLimit: number;
}) {
  const {
    users,
    profileByUserId,
    cards,
    scope,
    staleDays,
    phoneVerifiedFilter,
    recentLoginDays,
    recentMailFilter,
    recentSuccessMailByUserId,
    successfulMailByUserId,
    unsubscribedUserIds,
    sort,
    batchLimit,
  } = input;

  const now = Date.now();
  const staleCutoffMs = now - staleDays * 24 * 60 * 60 * 1000;
  const cardsByUserId = new Map<string, DatingCardLite[]>();

  for (const row of cards) {
    const userId = String(row.owner_user_id ?? "").trim();
    if (!userId) continue;
    const bucket = cardsByUserId.get(userId) ?? [];
    bucket.push(row);
    cardsByUserId.set(userId, bucket);
  }

  const recipients: OutreachRecipientPreview[] = [];
  let noCardCount = 0;
  let expiredStaleCount = 0;

  for (const user of users) {
    const profile = profileByUserId.get(user.id);
    if (profile?.role === "admin") continue;
    if (unsubscribedUserIds.has(user.id)) continue;

    const phoneVerified = profile?.phone_verified === true;
    if (!matchesPhoneFilter(phoneVerified, phoneVerifiedFilter)) continue;
    if (!isRecentLogin(user.last_sign_in_at, recentLoginDays)) continue;

    const recentSuccessMailSentAt = recentSuccessMailByUserId.get(user.id) ?? null;
    const successfulMailSentAt = successfulMailByUserId.get(user.id) ?? null;
    if (recentMailFilter === "not_sent_24h" && recentSuccessMailSentAt) continue;
    if (recentMailFilter === "sent_24h" && !recentSuccessMailSentAt) continue;
    if (recentMailFilter === "never_sent_success" && successfulMailSentAt) continue;

    const userCards = cardsByUserId.get(user.id) ?? [];

    if (userCards.length === 0) {
      if (scope === "no_card" || scope === "combined") {
        noCardCount += 1;
        recipients.push({
          user_id: user.id,
          nickname: profile?.nickname ?? null,
          email: user.email,
          reason: "no_card",
          expired_days: null,
          phone_verified: phoneVerified,
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at,
          recent_success_mail_sent_at: recentSuccessMailSentAt,
          successful_mail_sent_at: successfulMailSentAt,
        });
      }
      continue;
    }

    const hasActiveLikeCard = userCards.some((row) => {
      const status = String(row.status ?? "").trim();
      return status === "pending" || status === "public" || status === "hidden";
    });
    if (hasActiveLikeCard) continue;

    const latestRow = [...userCards].sort((a, b) => getRowSortTime(b) - getRowSortTime(a))[0];
    const latestStatus = String(latestRow?.status ?? "").trim();
    const expiresMs = new Date(String(latestRow?.expires_at ?? "")).getTime();
    if (latestStatus !== "expired" || !Number.isFinite(expiresMs) || expiresMs > staleCutoffMs) continue;

    if (scope === "expired_stale" || scope === "combined") {
      const expiredDays = Math.max(1, Math.floor((now - expiresMs) / (24 * 60 * 60 * 1000)));
      expiredStaleCount += 1;
      recipients.push({
        user_id: user.id,
        nickname: profile?.nickname ?? null,
        email: user.email,
        reason: "expired_stale",
        expired_days: expiredDays,
        phone_verified: phoneVerified,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
        recent_success_mail_sent_at: recentSuccessMailSentAt,
        successful_mail_sent_at: successfulMailSentAt,
      });
    }
  }

  sortRecipients(recipients, sort);
  const totalCandidateCount = recipients.length;
  const limitedRecipients = recipients.slice(0, batchLimit);
  const recentSuccess24hCount = recipients.filter((item) => item.recent_success_mail_sent_at).length;
  const successfulMailCount = recipients.filter((item) => item.successful_mail_sent_at).length;

  return {
    recipients: limitedRecipients,
    totalCandidateCount,
    noCardCount,
    expiredStaleCount,
    recentSuccess24hCount,
    successfulMailCount,
  };
}

async function buildPreview(
  admin: AdminClient,
  scope: OutreachScope,
  staleDays: number,
  phoneVerifiedFilter: PhoneVerifiedFilter,
  recentLoginDays: number | null,
  recentMailFilter: RecentMailFilter,
  sort: SortMode,
  batchLimit: number
): Promise<OutreachPreviewResponse> {
  const users = await fetchAllAuthUsers(admin);
  const userIds = users.map((user) => user.id);
  const [profileByUserId, cards, recentSuccessMailByUserId, successfulMailByUserId, unsubscribedUserIds] = await Promise.all([
    fetchProfilesByUserIds(admin, userIds),
    fetchAllDatingCards(admin),
    fetchRecentSuccessfulMailMap(admin, userIds),
    fetchLatestSuccessfulMailMap(admin, userIds),
    fetchMarketingUnsubscribedUserIds(admin, userIds, CAMPAIGN_KEY),
  ]);

  const { recipients, totalCandidateCount, noCardCount, expiredStaleCount, recentSuccess24hCount, successfulMailCount } = buildRecipients({
    users,
    profileByUserId,
    cards,
    scope,
    staleDays,
    phoneVerifiedFilter,
    recentLoginDays,
    recentMailFilter,
    recentSuccessMailByUserId,
    successfulMailByUserId,
    unsubscribedUserIds,
    sort,
    batchLimit,
  });

  return {
    scope,
    stale_days: staleDays,
    phone_verified_filter: phoneVerifiedFilter,
    recent_login_days: recentLoginDays,
    recent_mail_filter: recentMailFilter,
    sort,
    batch_limit: batchLimit,
    total_candidate_count: totalCandidateCount,
    recipient_count: recipients.length,
    no_card_count: noCardCount,
    expired_stale_count: expiredStaleCount,
    recent_success_24h_count: recentSuccess24hCount,
    successful_mail_count: successfulMailCount,
    subject: buildDefaultSubject(scope),
    body: buildDefaultBody(),
    sample_recipients: recipients.slice(0, 20),
  };
}

async function insertOutreachLogs(admin: AdminClient, rows: MailLogInsertRow[]) {
  if (!rows.length) return;

  const res = await admin.from(MAIL_LOG_TABLE).insert(rows);
  if (res.error) {
    if (isMissingTableError(res.error)) {
      console.warn(`[outreach] skipped mail log insert because table is missing: ${MAIL_LOG_TABLE}`);
      return;
    }
    console.error("[outreach] failed to insert mail logs", res.error);
  }
}

async function sendInBatchesSafely(input: {
  admin: AdminClient;
  adminUserId: string;
  recipients: OutreachRecipientPreview[];
  subject: string;
  body: string;
  scope: OutreachScope;
  staleDays: number;
  phoneVerifiedFilter: PhoneVerifiedFilter;
  recentLoginDays: number | null;
  recentMailFilter: RecentMailFilter;
  sort: SortMode;
  batchLimit: number;
}) {
  const {
    admin,
    adminUserId,
    recipients,
    subject,
    body,
    scope,
    staleDays,
    phoneVerifiedFilter,
    recentLoginDays,
    recentMailFilter,
    sort,
    batchLimit,
  } = input;

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
          stale_days: staleDays,
          phone_verified_filter: phoneVerifiedFilter,
          recent_login_days: recentLoginDays,
          recent_mail_filter: recentMailFilter,
          sort,
          batch_limit: batchLimit,
          reason: item.reason,
          expired_days: item.expired_days,
        };

        if (!item.email) {
          const error = `발송 실패: ${item.nickname ?? item.user_id} / EMAIL_MISSING`;
          return {
            ok: false as const,
            error,
            logRow: {
              campaign_key: CAMPAIGN_KEY,
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

        const mailBody = appendMarketingEmailFooter({
          body,
          userId: item.user_id,
          email: item.email,
          campaignKey: CAMPAIGN_KEY,
        });
        const result = await sendDatingEmailToAddressDetailed(item.email, subject, mailBody, {
          idempotencyKey: `open-card-outreach:${item.user_id}:${sentAt.slice(0, 10)}:${subject}`,
        }).catch(() => ({
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
                campaign_key: CAMPAIGN_KEY,
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
                campaign_key: CAMPAIGN_KEY,
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

    await insertOutreachLogs(
      admin,
      results.map((result) => result.logRow)
    );

    for (const result of results) {
      if (result.ok) {
        sent += 1;
        continue;
      }

      failed += 1;
      if (!firstFailure && result.error) {
        firstFailure = result.error;
      }
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
    const staleDays = parseStaleDays(params.get("staleDays"));
    const phoneVerifiedFilter = parsePhoneVerifiedFilter(params.get("phoneVerified"));
    const recentLoginDays = parseRecentLoginDays(params.get("recentLoginDays"));
    const recentMailFilter = parseRecentMailFilter(params.get("recentMail"));
    const sort = parseSort(params.get("sort"));
    const batchLimit = parseBatchLimit(params.get("batchLimit"));

    const preview = await buildPreview(
      auth.admin,
      scope,
      staleDays,
      phoneVerifiedFilter,
      recentLoginDays,
      recentMailFilter,
      sort,
      batchLimit
    );
    return NextResponse.json(preview);
  } catch (error) {
    console.error("[GET /api/admin/dating/cards/outreach] failed", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "오픈카드 안내 메일 미리보기를 불러오지 못했습니다.") },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  try {
    let payload: OutreachPostPayload | null = null;

    try {
      payload = (await request.json()) as OutreachPostPayload;
    } catch {
      payload = null;
    }

    const scope = parseScope(payload?.scope);
    const staleDays = parseStaleDays(String(payload?.staleDays ?? ""));
    const phoneVerifiedFilter = parsePhoneVerifiedFilter(payload?.phoneVerified);
    const recentLoginDays = parseRecentLoginDays(String(payload?.recentLoginDays ?? ""));
    const recentMailFilter = parseRecentMailFilter(payload?.recentMail);
    const sort = parseSort(payload?.sort);
    const batchLimit = parseBatchLimit(String(payload?.batchLimit ?? ""));
    const subject = normalizeMarketingSubject(String(payload?.subject ?? "").trim());
    const body = String(payload?.body ?? "").trim();

    if (!subject) {
      return NextResponse.json({ error: "메일 제목을 입력해주세요." }, { status: 400 });
    }

    if (!body) {
      return NextResponse.json({ error: "메일 본문을 입력해주세요." }, { status: 400 });
    }

    const users = await fetchAllAuthUsers(auth.admin);
    const userIds = users.map((user) => user.id);
    const [profileByUserId, cards, recentSuccessMailByUserId, successfulMailByUserId, unsubscribedUserIds] = await Promise.all([
      fetchProfilesByUserIds(auth.admin, userIds),
      fetchAllDatingCards(auth.admin),
      fetchRecentSuccessfulMailMap(auth.admin, userIds),
      fetchLatestSuccessfulMailMap(auth.admin, userIds),
      fetchMarketingUnsubscribedUserIds(auth.admin, userIds, CAMPAIGN_KEY),
    ]);

    const { recipients } = buildRecipients({
      users,
      profileByUserId,
      cards,
      scope,
      staleDays,
      phoneVerifiedFilter,
      recentLoginDays,
      recentMailFilter,
      recentSuccessMailByUserId,
      successfulMailByUserId,
      unsubscribedUserIds,
      sort,
      batchLimit,
    });

    const { sent, failed, firstFailure, failureSummary } = await sendInBatchesSafely({
      admin: auth.admin,
      adminUserId: auth.user.id,
      recipients,
      subject,
      body,
      scope,
      staleDays,
      phoneVerifiedFilter,
      recentLoginDays,
      recentMailFilter,
      sort,
      batchLimit,
    });

    return NextResponse.json({
      ok: true,
      scope,
      stale_days: staleDays,
      phone_verified_filter: phoneVerifiedFilter,
      recent_login_days: recentLoginDays,
      recent_mail_filter: recentMailFilter,
      sort,
      batch_limit: batchLimit,
      send_limit: MAX_SEND_PER_REQUEST,
      requested: recipients.length,
      sent,
      failed,
      failure_summary: failureSummary,
      first_failure: firstFailure,
    });
  } catch (error) {
    console.error("[POST /api/admin/dating/cards/outreach] failed", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "오픈카드 안내 메일 발송에 실패했습니다.") },
      { status: 500 }
    );
  }
}
