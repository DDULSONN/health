import { ensureCronAuthorized } from "@/lib/cron-auth";
import {
  getOpenCardActivityDecision,
  latestActivityIso,
  OPEN_CARD_DORMANT_QUEUE_PRIORITY_ISO,
} from "@/lib/dating-open-card-activity";
import { OPEN_CARD_AUTO_REQUEUE_LIMIT } from "@/lib/dating-open";
import { sendDatingEmailToAddressDetailed } from "@/lib/dating-swipe";
import { appendMarketingEmailFooter, fetchMarketingUnsubscribedUserIds } from "@/lib/marketing-email";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const CAMPAIGN_KEY = "dating_registration_reminder";
const MAIL_LOG_TABLE = "admin_open_card_outreach_mail_logs";
const CARD_PAGE_SIZE = 500;
const MAX_CARDS_PER_RUN = 3000;
const MAX_EMAILS_PER_RUN = 30;
const USER_PAGE_SIZE = 200;
const ID_CHUNK_SIZE = 100;
const QUERY_PAGE_SIZE = 500;
const FAILED_EMAIL_RETRY_HOURS = 24;
const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

type AdminClient = ReturnType<typeof createAdminClient>;
type ActivityCard = {
  id: string;
  owner_user_id: string;
  status: "pending" | "public";
  auto_requeue_count: number | null;
  inactivity_notice_sent_at: string | null;
  inactivity_notice_baseline_at: string | null;
  inactivity_deferred_at: string | null;
};
type ProfileLite = {
  user_id: string;
  nickname: string | null;
  role: string | null;
  is_banned: boolean | null;
  last_meaningful_activity_at: string | null;
};
type AuthUserLite = {
  id: string;
  email: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
};

function isMissingActivitySchema(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code ?? "") : "";
  const message = "message" in error ? String(error.message ?? "").toLowerCase() : "";
  return code === "42703" || code === "PGRST204" || message.includes("schema cache") || message.includes("could not find");
}

function getSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.SITE_URL?.trim() || "https://helchang.com").replace(
    /\/+$/,
    ""
  );
}

function displayName(nickname: string | null) {
  return String(nickname ?? "").trim() || "회원";
}

async function fetchActivityCards(admin: AdminClient) {
  const cards: ActivityCard[] = [];
  for (let start = 0; start < MAX_CARDS_PER_RUN; start += CARD_PAGE_SIZE) {
    const res = await admin
      .from("dating_cards")
      .select(
        "id,owner_user_id,status,auto_requeue_count,inactivity_notice_sent_at,inactivity_notice_baseline_at,inactivity_deferred_at"
      )
      .in("status", ["pending", "public"])
      .gte("auto_requeue_count", OPEN_CARD_AUTO_REQUEUE_LIMIT)
      .order("queue_priority_at", { ascending: true })
      .order("id", { ascending: true })
      .range(start, start + CARD_PAGE_SIZE - 1);

    if (res.error) {
      if (isMissingActivitySchema(res.error)) return null;
      throw res.error;
    }
    const batch = (res.data ?? []) as ActivityCard[];
    cards.push(...batch);
    if (batch.length < CARD_PAGE_SIZE) break;
  }
  return cards;
}

async function fetchUnansweredCardIds(admin: AdminClient, cardIds: string[]) {
  const unansweredCardIds = new Set<string>();
  for (let start = 0; start < cardIds.length; start += ID_CHUNK_SIZE) {
    const chunk = cardIds.slice(start, start + ID_CHUNK_SIZE);
    for (let pageStart = 0; ; pageStart += QUERY_PAGE_SIZE) {
      const res = await admin
        .from("dating_card_applications")
        .select("id,card_id")
        .in("card_id", chunk)
        .eq("status", "submitted")
        .order("id", { ascending: true })
        .range(pageStart, pageStart + QUERY_PAGE_SIZE - 1);
      if (res.error) throw res.error;
      const rows = res.data ?? [];
      for (const row of rows) {
        const cardId = String(row.card_id ?? "").trim();
        if (cardId) unansweredCardIds.add(cardId);
      }
      if (rows.length < QUERY_PAGE_SIZE) break;
    }
  }
  return unansweredCardIds;
}

async function fetchProfiles(admin: AdminClient, userIds: string[]) {
  const profiles = new Map<string, ProfileLite>();
  for (let start = 0; start < userIds.length; start += ID_CHUNK_SIZE) {
    const chunk = userIds.slice(start, start + ID_CHUNK_SIZE);
    const res = await admin
      .from("profiles")
      .select("user_id,nickname,role,is_banned,last_meaningful_activity_at")
      .in("user_id", chunk);
    if (res.error) {
      if (isMissingActivitySchema(res.error)) return null;
      throw res.error;
    }
    for (const row of (res.data ?? []) as ProfileLite[]) profiles.set(row.user_id, row);
  }
  return profiles;
}

async function fetchAuthUsers(admin: AdminClient, wantedUserIds: Set<string>) {
  const users = new Map<string, AuthUserLite>();
  let page = 1;
  while (users.size < wantedUserIds.size) {
    const res = await admin.auth.admin.listUsers({ page, perPage: USER_PAGE_SIZE });
    if (res.error) throw res.error;
    const batch = res.data?.users ?? [];
    for (const user of batch) {
      if (!wantedUserIds.has(user.id)) continue;
      users.set(user.id, {
        id: user.id,
        email: String(user.email ?? "").trim(),
        last_sign_in_at: user.last_sign_in_at ?? null,
        email_confirmed_at: user.email_confirmed_at ?? null,
      });
    }
    if (batch.length < USER_PAGE_SIZE) break;
    page += 1;
  }
  return users;
}

async function fetchUnsubscribedUserIds(admin: AdminClient, userIds: string[]) {
  const unsubscribed = new Set<string>();
  for (let start = 0; start < userIds.length; start += ID_CHUNK_SIZE) {
    const chunk = userIds.slice(start, start + ID_CHUNK_SIZE);
    const chunkResult = await fetchMarketingUnsubscribedUserIds(admin, chunk, CAMPAIGN_KEY);
    for (const userId of chunkResult) unsubscribed.add(userId);
  }
  return unsubscribed;
}

async function updateCardState(
  admin: AdminClient,
  card: ActivityCard,
  patch: Record<string, string | null>
) {
  const update = { ...patch };
  if (card.status !== "pending") delete update.queue_priority_at;
  const res = await admin
    .from("dating_cards")
    .update(update)
    .eq("id", card.id)
    .eq("status", card.status)
    .select("id")
    .maybeSingle();
  if (res.error) throw res.error;
  return Boolean(res.data?.id);
}

function buildReminderMail(nickname: string | null) {
  const siteUrl = getSiteUrl();
  return {
    subject: "[광고] 오픈카드에 도착한 지원을 확인해 주세요",
    body: [
      `${displayName(nickname)}님, 안녕하세요. 짐툴입니다.`,
      "",
      "오픈카드가 두 차례 이상 다시 공개되었지만 아직 확인하지 않은 지원이 있어요.",
      "마이페이지에서 지원을 확인하고 수락하거나 정리해 주세요.",
      "",
      "안내 후에도 활동이 확인되지 않으면 다른 활동 회원에게 노출 기회를 먼저 드리기 위해 대기 순서가 후순위로 조정될 수 있습니다.",
      "사이트에서 다시 활동하면 오픈카드는 자동으로 정상 대기 순서에 복귀합니다.",
      "",
      "받은 지원 확인하기",
      `${siteUrl}/mypage`,
    ].join("\n"),
  };
}

async function logMail(
  admin: AdminClient,
  input: {
    card: ActivityCard;
    user: AuthUserLite;
    subject: string;
    success: boolean;
    providerStatus: number | null;
    providerError: string | null;
    activityBaselineAt: string;
  }
) {
  const res = await admin.from(MAIL_LOG_TABLE).insert({
    campaign_key: CAMPAIGN_KEY,
    user_id: input.user.id,
    email: input.user.email,
    subject: input.subject,
    success: input.success,
    provider: "resend",
    provider_status: input.providerStatus,
    provider_error: input.providerError,
    meta: {
      reason: "open_card_inactivity",
      card_id: input.card.id,
      auto_requeue_count: Number(input.card.auto_requeue_count ?? 0),
      activity_baseline_at: input.activityBaselineAt,
    },
  });
  if (res.error) console.error("[cron dating-open-card-activity] mail log failed", res.error);
}

async function fetchNoticeLogMaps(admin: AdminClient, userIds: string[]) {
  const sentAtByCycle = new Map<string, string>();
  const attemptedAtByCycle = new Map<string, string>();
  for (let start = 0; start < userIds.length; start += ID_CHUNK_SIZE) {
    const chunk = userIds.slice(start, start + ID_CHUNK_SIZE);
    for (let pageStart = 0; ; pageStart += QUERY_PAGE_SIZE) {
      const res = await admin
        .from(MAIL_LOG_TABLE)
        .select("id,sent_at,success,meta")
        .eq("campaign_key", CAMPAIGN_KEY)
        .in("user_id", chunk)
        .contains("meta", { reason: "open_card_inactivity" })
        .order("sent_at", { ascending: false })
        .order("id", { ascending: false })
        .range(pageStart, pageStart + QUERY_PAGE_SIZE - 1);
      if (res.error) throw res.error;
      const rows = res.data ?? [];
      for (const row of rows) {
        const meta = row.meta && typeof row.meta === "object" ? row.meta as Record<string, unknown> : {};
        const cardId = String(meta.card_id ?? "").trim();
        const baselineAt = String(meta.activity_baseline_at ?? "").trim();
        const sentAt = String(row.sent_at ?? "").trim();
        const key = `${cardId}:${baselineAt}`;
        if (!cardId || !baselineAt || !sentAt) continue;
        if (!attemptedAtByCycle.has(key)) attemptedAtByCycle.set(key, sentAt);
        if (row.success === true && !sentAtByCycle.has(key)) sentAtByCycle.set(key, sentAt);
      }
      if (rows.length < QUERY_PAGE_SIZE) break;
    }
  }
  return { sentAtByCycle, attemptedAtByCycle };
}

export async function GET(request: Request) {
  const authResponse = ensureCronAuthorized(request);
  if (authResponse) return authResponse;

  const admin = createAdminClient();
  const cards = await fetchActivityCards(admin);
  if (cards == null) {
    return NextResponse.json({ ok: true, skipped: true, reason: "activity_schema_not_installed" });
  }
  if (!cards.length) {
    return NextResponse.json({ ok: true, skipped: false, scanned: 0, eligible: 0, emailed: 0, deferred: 0, restored: 0 });
  }

  const unansweredCardIds = await fetchUnansweredCardIds(admin, cards.map((card) => card.id));
  const eligibleCards = cards.filter((card) => unansweredCardIds.has(card.id));
  const userIds = [...new Set(cards.map((card) => card.owner_user_id).filter(Boolean))];
  const [profiles, users, unsubscribedUserIds, noticeLogs] = await Promise.all([
    fetchProfiles(admin, userIds),
    fetchAuthUsers(admin, new Set(userIds)),
    fetchUnsubscribedUserIds(admin, userIds),
    fetchNoticeLogMaps(admin, userIds),
  ]);
  if (profiles == null) {
    return NextResponse.json({ ok: true, skipped: true, reason: "activity_schema_not_installed" });
  }

  const now = new Date();
  const result = {
    ok: true,
    skipped: false,
    scanned: cards.length,
    eligible: eligibleCards.length,
    emailed: 0,
    emailFailed: 0,
    emailSkipped: 0,
    deferred: 0,
    restored: 0,
  };

  for (const card of cards) {
    const profile = profiles.get(card.owner_user_id);
    const user = users.get(card.owner_user_id);
    if (!profile || profile.role === "admin" || profile.is_banned === true || !user) continue;

    const lastActivityAt = latestActivityIso(profile.last_meaningful_activity_at, user.last_sign_in_at);
    let decision = getOpenCardActivityDecision({
      nowMs: now.getTime(),
      lastActivityAt,
      noticeSentAt: card.inactivity_notice_sent_at,
      noticeBaselineAt: card.inactivity_notice_baseline_at,
      deferredAt: card.inactivity_deferred_at,
    });

    const hasUnansweredApplication = unansweredCardIds.has(card.id);
    if (!hasUnansweredApplication) {
      if (card.inactivity_notice_sent_at || card.inactivity_deferred_at) decision = "restore";
      else continue;
    }

    if (decision === "restore") {
      const updated = await updateCardState(admin, card, {
        inactivity_notice_sent_at: null,
        inactivity_notice_baseline_at: null,
        inactivity_deferred_at: null,
        queue_priority_at: now.toISOString(),
      });
      if (updated) result.restored += 1;
      continue;
    }

    if (decision === "defer") {
      const updated = await updateCardState(admin, card, {
        inactivity_deferred_at: now.toISOString(),
        queue_priority_at: OPEN_CARD_DORMANT_QUEUE_PRIORITY_ISO,
      });
      if (updated) result.deferred += 1;
      continue;
    }

    if (decision !== "send_notice") continue;
    if (
      result.emailed + result.emailFailed >= MAX_EMAILS_PER_RUN ||
      unsubscribedUserIds.has(user.id) ||
      !user.email ||
      !user.email_confirmed_at
    ) {
      result.emailSkipped += 1;
      continue;
    }

    const mail = buildReminderMail(profile.nickname);
    const baselineAt = lastActivityAt ?? EPOCH_ISO;
    const cycleKey = `${card.id}:${baselineAt}`;
    const successfulNoticeAt = noticeLogs.sentAtByCycle.get(cycleKey);
    if (successfulNoticeAt) {
      await updateCardState(admin, card, {
        inactivity_notice_sent_at: successfulNoticeAt,
        inactivity_notice_baseline_at: baselineAt,
      });
      result.emailSkipped += 1;
      continue;
    }
    const latestAttemptAt = noticeLogs.attemptedAtByCycle.get(cycleKey);
    const latestAttemptMs = Date.parse(String(latestAttemptAt ?? ""));
    if (
      Number.isFinite(latestAttemptMs) &&
      now.getTime() - latestAttemptMs < FAILED_EMAIL_RETRY_HOURS * 60 * 60 * 1000
    ) {
      result.emailSkipped += 1;
      continue;
    }
    const body = appendMarketingEmailFooter({
      body: mail.body,
      userId: user.id,
      email: user.email,
      campaignKey: CAMPAIGN_KEY,
    });
    const sendResult = await sendDatingEmailToAddressDetailed(user.email, mail.subject, body, {
      idempotencyKey: `open-card-inactivity:${card.id}:${baselineAt}`,
    });
    await logMail(admin, {
      card,
      user,
      subject: mail.subject,
      success: sendResult.ok,
      providerStatus: sendResult.status ?? null,
      providerError: sendResult.error ?? null,
      activityBaselineAt: baselineAt,
    });

    if (!sendResult.ok) {
      result.emailFailed += 1;
      continue;
    }

    await updateCardState(admin, card, {
      inactivity_notice_sent_at: now.toISOString(),
      inactivity_notice_baseline_at: baselineAt,
    });
    result.emailed += 1;
  }

  return NextResponse.json(result);
}
