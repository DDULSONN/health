import { ensureCronAuthorized } from "@/lib/cron-auth";
import { OPEN_CARD_AUTO_REQUEUE_LIMIT } from "@/lib/dating-open";
import { sendDatingEmailToAddressDetailed } from "@/lib/dating-swipe";
import { appendMarketingEmailFooter, fetchMarketingUnsubscribedUserIds } from "@/lib/marketing-email";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const USER_PAGE_SIZE = 200;
const CHUNK_SIZE = 500;
const MAX_SEND_PER_RUN = 120;
const CAMPAIGN_KEY = "dating_registration_reminder";
const MAIL_LOG_TABLE = "admin_open_card_outreach_mail_logs";

type ReminderReason = "new_user_missing_registration" | "open_card_final_expired";

type AuthUserLite = {
  id: string;
  email: string;
  created_at: string | null;
};

type ProfileLite = {
  user_id: string | null;
  nickname: string | null;
  role?: string | null;
};

type OpenCardLite = {
  id: string;
  owner_user_id: string | null;
  status: string | null;
  expires_at: string | null;
  auto_requeue_count?: number | null;
};

type OneOnOneCardLite = {
  user_id: string | null;
};

type ReminderRecipient = {
  userId: string;
  email: string;
  nickname: string | null;
  reason: ReminderReason;
  subject: string;
  body: string;
  meta: Record<string, unknown>;
};

type AdminClient = ReturnType<typeof createAdminClient>;

function isoHoursAgo(nowMs: number, hours: number) {
  return new Date(nowMs - hours * 60 * 60 * 1000).toISOString();
}

function getSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.SITE_URL?.trim() || "https://helchang.com").replace(
    /\/+$/,
    ""
  );
}

function displayName(nickname: string | null | undefined) {
  const trimmed = String(nickname ?? "").trim();
  return trimmed || "회원";
}

function isMissingLogTableError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code ?? "").trim() : "";
  const message = "message" in error ? String(error.message ?? "").trim().toLowerCase() : "";
  return code === "42P01" || code === "PGRST205" || message.includes(MAIL_LOG_TABLE) || message.includes("schema cache");
}

async function fetchAllAuthUsers(admin: AdminClient) {
  const users: AuthUserLite[] = [];
  let page = 1;

  while (true) {
    const res = await admin.auth.admin.listUsers({ page, perPage: USER_PAGE_SIZE });
    if (res.error) throw new Error(`회원 목록을 불러오지 못했습니다. ${res.error.message}`);

    const batch = res.data?.users ?? [];
    for (const user of batch) {
      const id = String(user.id ?? "").trim();
      const email = String(user.email ?? "").trim();
      if (!id || !email) continue;
      users.push({ id, email, created_at: user.created_at ?? null });
    }

    if (batch.length < USER_PAGE_SIZE) break;
    page += 1;
  }

  return users;
}

async function fetchProfilesByUserIds(admin: AdminClient, userIds: string[]) {
  const profileByUserId = new Map<string, ProfileLite>();
  if (!userIds.length) return profileByUserId;

  for (let start = 0; start < userIds.length; start += CHUNK_SIZE) {
    const chunk = userIds.slice(start, start + CHUNK_SIZE);
    const res = await admin.from("profiles").select("user_id,nickname,role").in("user_id", chunk);
    if (res.error) throw new Error(`프로필을 불러오지 못했습니다. ${res.error.message}`);

    for (const row of (res.data ?? []) as ProfileLite[]) {
      const userId = String(row.user_id ?? "").trim();
      if (userId) profileByUserId.set(userId, row);
    }
  }

  return profileByUserId;
}

async function fetchOpenCardsByUserIds(admin: AdminClient, userIds: string[]) {
  const cardsByUserId = new Map<string, OpenCardLite[]>();
  if (!userIds.length) return cardsByUserId;

  for (let start = 0; start < userIds.length; start += CHUNK_SIZE) {
    const chunk = userIds.slice(start, start + CHUNK_SIZE);
    const res = await admin
      .from("dating_cards")
      .select("id,owner_user_id,status,expires_at,auto_requeue_count")
      .in("owner_user_id", chunk);
    if (res.error) throw new Error(`오픈카드를 불러오지 못했습니다. ${res.error.message}`);

    for (const row of (res.data ?? []) as OpenCardLite[]) {
      const userId = String(row.owner_user_id ?? "").trim();
      if (!userId) continue;
      const rows = cardsByUserId.get(userId) ?? [];
      rows.push(row);
      cardsByUserId.set(userId, rows);
    }
  }

  return cardsByUserId;
}

async function fetchOneOnOneUserIds(admin: AdminClient, userIds: string[]) {
  const oneOnOneUserIds = new Set<string>();
  if (!userIds.length) return oneOnOneUserIds;

  for (let start = 0; start < userIds.length; start += CHUNK_SIZE) {
    const chunk = userIds.slice(start, start + CHUNK_SIZE);
    const res = await admin.from("dating_1on1_cards").select("user_id").in("user_id", chunk);
    if (res.error) throw new Error(`1대1 카드를 불러오지 못했습니다. ${res.error.message}`);

    for (const row of (res.data ?? []) as OneOnOneCardLite[]) {
      const userId = String(row.user_id ?? "").trim();
      if (userId) oneOnOneUserIds.add(userId);
    }
  }

  return oneOnOneUserIds;
}

async function hasSuccessfulLog(admin: AdminClient, userId: string, reason: ReminderReason, meta: Record<string, unknown>) {
  const res = await admin
    .from(MAIL_LOG_TABLE)
    .select("id")
    .eq("campaign_key", CAMPAIGN_KEY)
    .eq("user_id", userId)
    .eq("success", true)
    .contains("meta", { reason, ...meta })
    .limit(1);

  if (res.error) {
    if (isMissingLogTableError(res.error)) return false;
    throw res.error;
  }

  return (res.data ?? []).length > 0;
}

async function logSendResult(
  admin: AdminClient,
  input: {
    recipient: ReminderRecipient;
    success: boolean;
    providerStatus: number | null;
    providerError: string | null;
  }
) {
  const res = await admin.from(MAIL_LOG_TABLE).insert({
    campaign_key: CAMPAIGN_KEY,
    user_id: input.recipient.userId,
    email: input.recipient.email,
    subject: input.recipient.subject,
    success: input.success,
    provider: "resend",
    provider_status: input.providerStatus,
    provider_error: input.providerError,
    meta: {
      reason: input.recipient.reason,
      ...input.recipient.meta,
    },
  });

  if (res.error && !isMissingLogTableError(res.error)) {
    console.error("[cron dating-registration-reminders] log insert failed", res.error);
  }
}

function buildNewUserMail(input: {
  nickname: string | null;
  missingOpenCard: boolean;
  missingOneOnOne: boolean;
}) {
  const siteUrl = getSiteUrl();
  const missingLabels = [
    input.missingOpenCard ? "오픈카드" : "",
    input.missingOneOnOne ? "1대1 매칭 카드" : "",
  ].filter(Boolean);

  return {
    subject: "[광고] GymTools 소개 등록을 마저 완료해 주세요",
    body: [
      `${displayName(input.nickname)}님, 안녕하세요. GymTools입니다.`,
      "",
      `아직 ${missingLabels.join(", ")} 등록이 완료되지 않았어요.`,
      "등록을 마치면 다른 회원이 내 소개를 보고 지원하거나, 1대1 매칭 후보를 더 정확하게 받을 수 있습니다.",
      "",
      "오픈카드 등록하기",
      `${siteUrl}/community/dating/cards/new`,
      "",
      "1대1 매칭 작성하기",
      `${siteUrl}/dating/1on1`,
    ].join("\n"),
  };
}

function buildExpiredOpenCardMail(nickname: string | null) {
  const siteUrl = getSiteUrl();
  return {
    subject: "[광고] 오픈카드를 다시 등록해 보세요",
    body: [
      `${displayName(nickname)}님, 안녕하세요. GymTools입니다.`,
      "",
      "등록하신 오픈카드가 공개 기간과 자동 재등록을 모두 마치고 내려갔습니다.",
      "새 오픈카드를 등록하면 다시 목록에 노출되고 지원을 받을 수 있어요.",
      "",
      "오픈카드 다시 등록하기",
      `${siteUrl}/community/dating/cards/new`,
    ].join("\n"),
  };
}

function buildNewUserRecipients(input: {
  users: AuthUserLite[];
  profilesByUserId: Map<string, ProfileLite>;
  openCardsByUserId: Map<string, OpenCardLite[]>;
  oneOnOneUserIds: Set<string>;
  nowMs: number;
}) {
  const minCreatedAt = isoHoursAgo(input.nowMs, 72);
  const maxCreatedAt = isoHoursAgo(input.nowMs, 48);
  const recipients: ReminderRecipient[] = [];

  for (const user of input.users) {
    const createdAt = String(user.created_at ?? "");
    if (!createdAt || createdAt < minCreatedAt || createdAt > maxCreatedAt) continue;

    const profile = input.profilesByUserId.get(user.id);
    if (profile?.role === "admin") continue;

    const missingOpenCard = (input.openCardsByUserId.get(user.id) ?? []).length === 0;
    const missingOneOnOne = !input.oneOnOneUserIds.has(user.id);
    if (!missingOpenCard && !missingOneOnOne) continue;

    const mail = buildNewUserMail({
      nickname: profile?.nickname ?? null,
      missingOpenCard,
      missingOneOnOne,
    });

    recipients.push({
      userId: user.id,
      email: user.email,
      nickname: profile?.nickname ?? null,
      reason: "new_user_missing_registration",
      subject: mail.subject,
      body: mail.body,
      meta: {
        missing_open_card: missingOpenCard,
        missing_one_on_one: missingOneOnOne,
        signup_created_at: createdAt,
      },
    });
  }

  return recipients;
}

async function fetchRecentlyFinalExpiredOpenCards(admin: AdminClient, nowMs: number) {
  const res = await admin
    .from("dating_cards")
    .select("id,owner_user_id,status,expires_at,auto_requeue_count")
    .eq("status", "expired")
    .gte("auto_requeue_count", OPEN_CARD_AUTO_REQUEUE_LIMIT)
    .gte("expires_at", isoHoursAgo(nowMs, 24))
    .lte("expires_at", new Date(nowMs).toISOString())
    .order("expires_at", { ascending: false })
    .limit(1000);

  if (res.error) throw new Error(`만료 오픈카드를 불러오지 못했습니다. ${res.error.message}`);
  return (res.data ?? []) as OpenCardLite[];
}

function buildExpiredCardRecipients(input: {
  expiredCards: OpenCardLite[];
  usersById: Map<string, AuthUserLite>;
  profilesByUserId: Map<string, ProfileLite>;
  openCardsByUserId: Map<string, OpenCardLite[]>;
}) {
  const recipients: ReminderRecipient[] = [];
  const seenUserIds = new Set<string>();

  for (const card of input.expiredCards) {
    const userId = String(card.owner_user_id ?? "").trim();
    if (!userId || seenUserIds.has(userId)) continue;

    const user = input.usersById.get(userId);
    if (!user?.email) continue;

    const profile = input.profilesByUserId.get(userId);
    if (profile?.role === "admin") continue;

    const hasActiveOpenCard = (input.openCardsByUserId.get(userId) ?? []).some((row) => {
      const status = String(row.status ?? "").trim();
      return status === "pending" || status === "public" || status === "hidden";
    });
    if (hasActiveOpenCard) continue;

    const mail = buildExpiredOpenCardMail(profile?.nickname ?? null);
    seenUserIds.add(userId);
    recipients.push({
      userId,
      email: user.email,
      nickname: profile?.nickname ?? null,
      reason: "open_card_final_expired",
      subject: mail.subject,
      body: mail.body,
      meta: {
        card_id: card.id,
        expired_at: card.expires_at,
        auto_requeue_count: Number(card.auto_requeue_count ?? 0),
      },
    });
  }

  return recipients;
}

export async function GET(request: Request) {
  const authResponse = ensureCronAuthorized(request);
  if (authResponse) return authResponse;

  const admin = createAdminClient();
  const nowMs = Date.now();
  const users = await fetchAllAuthUsers(admin);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const userIds = users.map((user) => user.id);

  const [profilesByUserId, openCardsByUserId, oneOnOneUserIds, expiredCards, unsubscribedUserIds] = await Promise.all([
    fetchProfilesByUserIds(admin, userIds),
    fetchOpenCardsByUserIds(admin, userIds),
    fetchOneOnOneUserIds(admin, userIds),
    fetchRecentlyFinalExpiredOpenCards(admin, nowMs),
    fetchMarketingUnsubscribedUserIds(admin, userIds, CAMPAIGN_KEY),
  ]);

  const candidates = [
    ...buildNewUserRecipients({
      users,
      profilesByUserId,
      openCardsByUserId,
      oneOnOneUserIds,
      nowMs,
    }),
    ...buildExpiredCardRecipients({
      expiredCards,
      usersById,
      profilesByUserId,
      openCardsByUserId,
    }),
  ].filter((recipient) => !unsubscribedUserIds.has(recipient.userId));

  const results = {
    candidates: candidates.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    by_reason: {
      new_user_missing_registration: { candidates: 0, sent: 0, skipped: 0, failed: 0 },
      open_card_final_expired: { candidates: 0, sent: 0, skipped: 0, failed: 0 },
    } satisfies Record<ReminderReason, { candidates: number; sent: number; skipped: number; failed: number }>,
  };

  for (const recipient of candidates) {
    results.by_reason[recipient.reason].candidates += 1;
  }

  for (const recipient of candidates.slice(0, MAX_SEND_PER_RUN)) {
    try {
      if (await hasSuccessfulLog(admin, recipient.userId, recipient.reason, recipient.meta)) {
        results.skipped += 1;
        results.by_reason[recipient.reason].skipped += 1;
        continue;
      }

      const mailBody = appendMarketingEmailFooter({
        body: recipient.body,
        userId: recipient.userId,
        email: recipient.email,
        campaignKey: CAMPAIGN_KEY,
      });
      const sendResult = await sendDatingEmailToAddressDetailed(recipient.email, recipient.subject, mailBody, {
        idempotencyKey: `${CAMPAIGN_KEY}:${recipient.reason}:${recipient.userId}:${String(recipient.meta.card_id ?? "signup")}`,
      });

      await logSendResult(admin, {
        recipient,
        success: sendResult.ok,
        providerStatus: sendResult.status ?? null,
        providerError: sendResult.error ?? null,
      });

      if (sendResult.ok) {
        results.sent += 1;
        results.by_reason[recipient.reason].sent += 1;
      } else {
        results.failed += 1;
        results.by_reason[recipient.reason].failed += 1;
      }
    } catch (error) {
      await logSendResult(admin, {
        recipient,
        success: false,
        providerStatus: null,
        providerError: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      });
      console.error("[cron dating-registration-reminders] send failed", {
        userId: recipient.userId,
        reason: recipient.reason,
        error,
      });
      results.failed += 1;
      results.by_reason[recipient.reason].failed += 1;
    }
  }

  if (candidates.length > MAX_SEND_PER_RUN) {
    results.skipped += candidates.length - MAX_SEND_PER_RUN;
  }

  return NextResponse.json({ ok: true, results });
}
