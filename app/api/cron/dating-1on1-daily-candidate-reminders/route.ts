import { ensureCronAuthorized } from "@/lib/cron-auth";
import {
  getOneOnOnePhoneBlockMapForUsers,
  isOneOnOnePhoneBlockedPair,
} from "@/lib/dating-1on1-phone-blocks";
import { hashDatingContactBlockValue, normalizeDatingContactPhone } from "@/lib/dating-contact-blocks";
import { sendDatingEmailToAddressDetailed } from "@/lib/dating-swipe";
import { appendEmailUnsubscribeFooter, fetchMarketingUnsubscribedUserIds } from "@/lib/marketing-email";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const maxDuration = 300;

const CAMPAIGN_KEY = "one_on_one_daily_candidate_reminder";
const UNSUBSCRIBE_CAMPAIGN_KEY = "dating_notifications";
const MAIL_LOG_TABLE = "admin_open_card_outreach_mail_logs";
const ACTIVE_CARD_STATUSES = ["submitted", "reviewing", "approved"] as const;
const PAGE_SIZE = 1000;
const CHUNK_SIZE = 300;
const AUTH_USER_PAGE_SIZE = 200;
const MAX_SEND_PER_RUN = 120;
const MAX_SEND_PER_SEVEN_DAYS = 3;
const MIN_CARD_AGE_MS = 6 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const EMAIL_SUBJECT = "오늘 확인할 1:1 후보가 있어요";

type AdminClient = ReturnType<typeof createAdminClient>;

type CardRow = {
  id: string;
  user_id: string;
  sex: "male" | "female";
  phone: string | null;
  status: string;
  created_at: string;
  recommendation_refresh_used_at: string | null;
};

type ProfileRow = {
  user_id: string | null;
  nickname: string | null;
  is_banned: boolean | null;
};

type UserBlockRow = {
  blocker_user_id: string | null;
  blocked_user_id: string | null;
};

type ContactBlockRow = {
  user_id: string | null;
  block_type: string | null;
  value_hash: string | null;
};

type MailLogRow = {
  user_id: string | null;
  sent_at: string;
};

type AuthUserLite = {
  id: string;
  email: string;
};

function isMissingTableError(error: unknown, table: string) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code ?? "") : "";
  const message = "message" in error ? String(error.message ?? "").toLowerCase() : "";
  return code === "42P01" || code === "PGRST205" || message.includes(table) || message.includes("schema cache");
}

function getKstDayBounds(nowMs: number) {
  const kstNow = new Date(nowMs + KST_OFFSET_MS);
  const startMs =
    Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - KST_OFFSET_MS;
  return {
    date: `${kstNow.getUTCFullYear()}-${String(kstNow.getUTCMonth() + 1).padStart(2, "0")}-${String(
      kstNow.getUTCDate()
    ).padStart(2, "0")}`,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(startMs + 24 * 60 * 60 * 1000).toISOString(),
  };
}

function getSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.SITE_URL?.trim() || "https://helchang.com").replace(
    /\/+$/,
    ""
  );
}

function getDisplayName(profile: ProfileRow | undefined) {
  return String(profile?.nickname ?? "").trim() || "회원";
}

function addBlockedPair(blockMap: Map<string, Set<string>>, firstUserId: string, secondUserId: string) {
  if (!firstUserId || !secondUserId || firstUserId === secondUserId) return;
  const first = blockMap.get(firstUserId) ?? new Set<string>();
  first.add(secondUserId);
  blockMap.set(firstUserId, first);
  const second = blockMap.get(secondUserId) ?? new Set<string>();
  second.add(firstUserId);
  blockMap.set(secondUserId, second);
}

function addContactPhoneHash(blockMap: Map<string, Set<string>>, userId: string, valueHash: string) {
  if (!userId || !valueHash) return;
  const bucket = blockMap.get(userId) ?? new Set<string>();
  bucket.add(valueHash);
  blockMap.set(userId, bucket);
}

function isContactPhoneBlockedPair(input: {
  sourceUserId: string;
  sourcePhone: string | null;
  candidateUserId: string;
  candidatePhone: string | null;
  blockMap: Map<string, Set<string>>;
}) {
  const sourcePhone = normalizeDatingContactPhone(String(input.sourcePhone ?? ""));
  const candidatePhone = normalizeDatingContactPhone(String(input.candidatePhone ?? ""));
  if (
    candidatePhone &&
    input.blockMap
      .get(input.sourceUserId)
      ?.has(hashDatingContactBlockValue("phone", candidatePhone))
  ) {
    return true;
  }
  return Boolean(
    sourcePhone &&
      input.blockMap
        .get(input.candidateUserId)
        ?.has(hashDatingContactBlockValue("phone", sourcePhone))
  );
}

function hashForRotation(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function fetchAllActiveCards(admin: AdminClient) {
  const rows: CardRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const res = await admin
      .from("dating_1on1_cards")
      .select("id,user_id,sex,phone,status,created_at,recommendation_refresh_used_at")
      .in("status", [...ACTIVE_CARD_STATUSES])
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (res.error) throw res.error;
    const batch = (res.data ?? []) as CardRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchProfiles(admin: AdminClient, userIds: string[]) {
  const profileByUserId = new Map<string, ProfileRow>();
  for (let start = 0; start < userIds.length; start += CHUNK_SIZE) {
    const res = await admin
      .from("profiles")
      .select("user_id,nickname,is_banned")
      .in("user_id", userIds.slice(start, start + CHUNK_SIZE));
    if (res.error) throw res.error;
    for (const row of (res.data ?? []) as ProfileRow[]) {
      const userId = String(row.user_id ?? "").trim();
      if (userId) profileByUserId.set(userId, row);
    }
  }
  return profileByUserId;
}

async function fetchTodaySelectedCardIds(admin: AdminClient, cardIds: string[], startIso: string, endIso: string) {
  const selectedCardIds = new Set<string>();
  for (let start = 0; start < cardIds.length; start += CHUNK_SIZE) {
    const chunk = cardIds.slice(start, start + CHUNK_SIZE);
    for (let from = 0; ; from += PAGE_SIZE) {
      const res = await admin
        .from("dating_1on1_match_proposals")
        .select("source_card_id")
        .in("source_card_id", chunk)
        .gte("source_selected_at", startIso)
        .lt("source_selected_at", endIso)
        .range(from, from + PAGE_SIZE - 1);
      if (res.error) throw res.error;
      const batch = res.data ?? [];
      for (const row of batch) selectedCardIds.add(String(row.source_card_id));
      if (batch.length < PAGE_SIZE) break;
    }
  }
  return selectedCardIds;
}

async function fetchTodayRefreshedCardIds(admin: AdminClient, cardIds: string[], startIso: string, endIso: string) {
  const refreshedCardIds = new Set<string>();
  for (let start = 0; start < cardIds.length; start += CHUNK_SIZE) {
    const res = await admin
      .from("dating_1on1_recommendation_refresh_events")
      .select("card_id")
      .in("card_id", cardIds.slice(start, start + CHUNK_SIZE))
      .gte("refreshed_at", startIso)
      .lt("refreshed_at", endIso)
      .limit(5000);
    if (res.error) {
      if (isMissingTableError(res.error, "dating_1on1_recommendation_refresh_events")) return refreshedCardIds;
      throw res.error;
    }
    for (const row of res.data ?? []) refreshedCardIds.add(String(row.card_id));
  }
  return refreshedCardIds;
}

async function fetchExistingPairs(admin: AdminClient, sourceCardIds: string[]) {
  const pairsBySourceCardId = new Map<string, Set<string>>();
  for (let start = 0; start < sourceCardIds.length; start += CHUNK_SIZE) {
    const chunk = sourceCardIds.slice(start, start + CHUNK_SIZE);
    for (let from = 0; ; from += PAGE_SIZE) {
      const res = await admin
        .from("dating_1on1_match_proposals")
        .select("source_card_id,candidate_card_id")
        .in("source_card_id", chunk)
        .range(from, from + PAGE_SIZE - 1);
      if (res.error) throw res.error;
      const batch = res.data ?? [];
      for (const row of batch) {
        const sourceCardId = String(row.source_card_id ?? "");
        const candidateCardId = String(row.candidate_card_id ?? "");
        if (!sourceCardId || !candidateCardId) continue;
        const bucket = pairsBySourceCardId.get(sourceCardId) ?? new Set<string>();
        bucket.add(candidateCardId);
        pairsBySourceCardId.set(sourceCardId, bucket);
      }
      if (batch.length < PAGE_SIZE) break;
    }
  }
  return pairsBySourceCardId;
}

async function fetchUserBlocks(admin: AdminClient) {
  const blockMap = new Map<string, Set<string>>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const res = await admin
      .from("dating_user_blocks")
      .select("blocker_user_id,blocked_user_id")
      .range(from, from + PAGE_SIZE - 1);
    if (res.error) {
      if (isMissingTableError(res.error, "dating_user_blocks")) return blockMap;
      throw res.error;
    }
    const batch = (res.data ?? []) as UserBlockRow[];
    for (const row of batch) {
      addBlockedPair(
        blockMap,
        String(row.blocker_user_id ?? "").trim(),
        String(row.blocked_user_id ?? "").trim()
      );
    }
    if (batch.length < PAGE_SIZE) break;
  }
  return blockMap;
}

async function fetchContactPhoneBlocks(admin: AdminClient) {
  const blockMap = new Map<string, Set<string>>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const res = await admin
      .from("dating_contact_blocks")
      .select("user_id,block_type,value_hash")
      .eq("block_type", "phone")
      .range(from, from + PAGE_SIZE - 1);
    if (res.error) {
      if (isMissingTableError(res.error, "dating_contact_blocks")) return blockMap;
      throw res.error;
    }
    const batch = (res.data ?? []) as ContactBlockRow[];
    for (const row of batch) {
      addContactPhoneHash(blockMap, String(row.user_id ?? "").trim(), String(row.value_hash ?? "").trim());
    }
    if (batch.length < PAGE_SIZE) break;
  }
  return blockMap;
}

async function fetchRecentSendCounts(admin: AdminClient, weekStartIso: string, todayStartIso: string) {
  const weeklyCountByUserId = new Map<string, number>();
  const sentTodayUserIds = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const res = await admin
      .from(MAIL_LOG_TABLE)
      .select("user_id,sent_at")
      .eq("campaign_key", CAMPAIGN_KEY)
      .eq("success", true)
      .gte("sent_at", weekStartIso)
      .range(from, from + PAGE_SIZE - 1);
    if (res.error) throw res.error;
    const batch = (res.data ?? []) as MailLogRow[];
    for (const row of batch) {
      const userId = String(row.user_id ?? "").trim();
      if (!userId) continue;
      weeklyCountByUserId.set(userId, (weeklyCountByUserId.get(userId) ?? 0) + 1);
      if (row.sent_at >= todayStartIso) sentTodayUserIds.add(userId);
    }
    if (batch.length < PAGE_SIZE) break;
  }
  return { weeklyCountByUserId, sentTodayUserIds };
}

async function fetchAllAuthUsers(admin: AdminClient) {
  const userById = new Map<string, AuthUserLite>();
  for (let page = 1; ; page += 1) {
    const res = await admin.auth.admin.listUsers({ page, perPage: AUTH_USER_PAGE_SIZE });
    if (res.error) throw res.error;
    const batch = res.data?.users ?? [];
    for (const user of batch) {
      const email = String(user.email ?? "").trim();
      if (user.id && email) userById.set(user.id, { id: user.id, email });
    }
    if (batch.length < AUTH_USER_PAGE_SIZE) break;
  }
  return userById;
}

async function logSend(
  admin: AdminClient,
  input: {
    userId: string;
    email: string;
    cardId: string;
    kstDate: string;
    success: boolean;
    providerStatus?: number | null;
    providerError?: string | null;
  }
) {
  const res = await admin.from(MAIL_LOG_TABLE).insert({
    campaign_key: CAMPAIGN_KEY,
    user_id: input.userId,
    email: input.email,
    subject: EMAIL_SUBJECT,
    success: input.success,
    provider: "resend",
    provider_status: input.providerStatus ?? null,
    provider_error: input.providerError ?? null,
    meta: {
      card_id: input.cardId,
      kst_date: input.kstDate,
      reminder_kind: "daily_candidate_inactive",
    },
  });
  if (res.error) {
    console.error("[cron dating-1on1-daily-candidate-reminders] log failed", res.error);
  }
}

export async function GET(request: Request) {
  const authResponse = ensureCronAuthorized(request);
  if (authResponse) return authResponse;

  const admin = createAdminClient();
  const nowMs = Date.now();
  const today = getKstDayBounds(nowMs);
  const weekStartIso = new Date(Date.parse(today.startIso) - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const cards = await fetchAllActiveCards(admin);
    const userIds = [...new Set(cards.map((card) => card.user_id).filter(Boolean))];
    const cardIds = cards.map((card) => card.id);
    const [profiles, selectedToday, refreshedToday, existingPairs, userBlocks, phoneBlockMap, contactBlockMap, sends] =
      await Promise.all([
        fetchProfiles(admin, userIds),
        fetchTodaySelectedCardIds(admin, cardIds, today.startIso, today.endIso),
        fetchTodayRefreshedCardIds(admin, cardIds, today.startIso, today.endIso),
        fetchExistingPairs(admin, cardIds),
        fetchUserBlocks(admin),
        getOneOnOnePhoneBlockMapForUsers(admin, userIds),
        fetchContactPhoneBlocks(admin),
        fetchRecentSendCounts(admin, weekStartIso, today.startIso),
      ]);

    const unsubscribedUserIds = await fetchMarketingUnsubscribedUserIds(
      admin,
      userIds,
      UNSUBSCRIBE_CAMPAIGN_KEY
    );
    const maleCards = cards.filter((card) => card.sex === "male" && profiles.get(card.user_id)?.is_banned !== true);
    const femaleCards = cards.filter((card) => card.sex === "female" && profiles.get(card.user_id)?.is_banned !== true);

    const eligibleCards = cards.filter((sourceCard) => {
      if (profiles.get(sourceCard.user_id)?.is_banned === true) return false;
      if (unsubscribedUserIds.has(sourceCard.user_id)) return false;
      if (selectedToday.has(sourceCard.id) || refreshedToday.has(sourceCard.id)) return false;
      if (
        sourceCard.recommendation_refresh_used_at &&
        sourceCard.recommendation_refresh_used_at >= today.startIso &&
        sourceCard.recommendation_refresh_used_at < today.endIso
      ) {
        return false;
      }
      if (nowMs - Date.parse(sourceCard.created_at) < MIN_CARD_AGE_MS) return false;
      if (sends.sentTodayUserIds.has(sourceCard.user_id)) return false;
      if ((sends.weeklyCountByUserId.get(sourceCard.user_id) ?? 0) >= MAX_SEND_PER_SEVEN_DAYS) return false;

      const existingCandidateIds = existingPairs.get(sourceCard.id) ?? new Set<string>();
      const blockedUserIds = userBlocks.get(sourceCard.user_id) ?? new Set<string>();
      const oppositeCards = sourceCard.sex === "male" ? femaleCards : maleCards;
      return oppositeCards.some((candidateCard) => {
        if (candidateCard.user_id === sourceCard.user_id) return false;
        if (existingCandidateIds.has(candidateCard.id)) return false;
        if (blockedUserIds.has(candidateCard.user_id)) return false;
        if (
          isOneOnOnePhoneBlockedPair({
            sourceUserId: sourceCard.user_id,
            sourcePhone: sourceCard.phone,
            candidateUserId: candidateCard.user_id,
            candidatePhone: candidateCard.phone,
            blockMap: phoneBlockMap,
          })
        ) {
          return false;
        }
        return !isContactPhoneBlockedPair({
          sourceUserId: sourceCard.user_id,
          sourcePhone: sourceCard.phone,
          candidateUserId: candidateCard.user_id,
          candidatePhone: candidateCard.phone,
          blockMap: contactBlockMap,
        });
      });
    });

    const eligibleCardsByUserId = new Map<string, CardRow>();
    for (const card of eligibleCards) {
      if (!eligibleCardsByUserId.has(card.user_id)) eligibleCardsByUserId.set(card.user_id, card);
    }
    const uniqueEligibleCards = [...eligibleCardsByUserId.values()];
    uniqueEligibleCards.sort(
      (a, b) => hashForRotation(`${today.date}:${a.user_id}`) - hashForRotation(`${today.date}:${b.user_id}`)
    );
    const recipients = uniqueEligibleCards.slice(0, MAX_SEND_PER_RUN);
    const authUsers = recipients.length ? await fetchAllAuthUsers(admin) : new Map<string, AuthUserLite>();
    const candidateUrl = `${getSiteUrl()}/mypage?section=matching`;
    const results = { candidates: uniqueEligibleCards.length, attempted: 0, sent: 0, skipped: 0, failed: 0 };

    for (const card of recipients) {
      const authUser = authUsers.get(card.user_id);
      if (!authUser?.email) {
        results.skipped += 1;
        continue;
      }

      const body = [
        `${getDisplayName(profiles.get(card.user_id))}님, 오늘 확인할 수 있는 1:1 후보가 남아 있어요.`,
        "마음에 드는 후보를 선택하면 상대에게 수락 요청이 전달됩니다.",
        "",
        "1:1 후보 확인하기",
        candidateUrl,
      ].join("\n");
      const mailBody = appendEmailUnsubscribeFooter({
        body,
        userId: card.user_id,
        email: authUser.email,
        campaignKey: UNSUBSCRIBE_CAMPAIGN_KEY,
        label: "오픈카드·1:1 소개팅 알림 메일을 더 이상 받고 싶지 않다면 아래 링크에서 수신거부할 수 있습니다.",
      });

      results.attempted += 1;
      try {
        const sendResult = await sendDatingEmailToAddressDetailed(authUser.email, EMAIL_SUBJECT, mailBody, {
          idempotencyKey: `${CAMPAIGN_KEY}:${today.date}:${card.user_id}`,
        });
        await logSend(admin, {
          userId: card.user_id,
          email: authUser.email,
          cardId: card.id,
          kstDate: today.date,
          success: sendResult.ok,
          providerStatus: sendResult.status ?? null,
          providerError: sendResult.error ?? null,
        });
        if (sendResult.ok) results.sent += 1;
        else results.failed += 1;
      } catch (error) {
        await logSend(admin, {
          userId: card.user_id,
          email: authUser.email,
          cardId: card.id,
          kstDate: today.date,
          success: false,
          providerError: error instanceof Error ? error.message : "UNKNOWN_ERROR",
        });
        results.failed += 1;
      }
    }

    return NextResponse.json({ ok: true, kst_date: today.date, results });
  } catch (error) {
    console.error("[cron dating-1on1-daily-candidate-reminders] failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "1:1 후보 알림 처리에 실패했습니다." },
      { status: 500 }
    );
  }
}
