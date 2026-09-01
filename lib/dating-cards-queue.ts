import { OPEN_CARD_EXPIRE_HOURS, getOpenCardEffectiveLimitBySex } from "@/lib/dating-open";
import { OPEN_CARD_DORMANT_QUEUE_PRIORITY_ISO } from "@/lib/dating-open-card-activity";
import { createAdminClient } from "@/lib/supabase/server";

type CardSex = "male" | "female";
const OPEN_CARD_QUEUE_SYNC_LOCK_KEY = "open_card_queue_sync_lock";
// Covers a worst-case batch of expirations/promotions while still recovering
// automatically if a serverless invocation is interrupted.
const OPEN_CARD_QUEUE_SYNC_LEASE_MS = 2 * 60 * 1000;
const OPEN_CARD_QUEUE_SYNC_LOCK_EPOCH = "1970-01-01T00:00:00.000Z";

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("could not find") || message.includes("column");
}

function isStatusConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "23514" || message.includes("status_check") || message.includes("check constraint");
}

async function getPublicCount(
  adminClient: ReturnType<typeof createAdminClient>,
  sex: CardSex
) {
  let { count, error } = await adminClient
    .from("dating_cards")
    .select("id", { count: "exact", head: true })
    .eq("sex", sex)
    .eq("status", "public")
    .gt("expires_at", new Date().toISOString());

  if (error && isMissingColumnError(error)) {
    const legacy = await adminClient
      .from("dating_cards")
      .select("id", { count: "exact", head: true })
      .eq("sex", sex)
      .eq("status", "public");
    count = legacy.count;
    error = legacy.error;
  }

  if (error) throw error;
  return count ?? 0;
}

async function promoteOnePending(
  adminClient: ReturnType<typeof createAdminClient>,
  sex: CardSex
) {
  let { data: pendingCard, error: pendingError } = (await adminClient
    .from("dating_cards")
    .select("id, created_at, queue_priority_at, inactivity_deferred_at")
    .eq("sex", sex)
    .eq("status", "pending")
    .order("queue_priority_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()) as {
      data: {
        id: string;
        created_at: string;
        queue_priority_at?: string | null;
        inactivity_deferred_at?: string | null;
      } | null;
      error: { code?: string; message?: string } | null;
    };

  if (pendingError && isMissingColumnError(pendingError)) {
    const fallback = await adminClient
      .from("dating_cards")
      .select("id, created_at")
      .eq("sex", sex)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    pendingCard = fallback.data ? { ...fallback.data, queue_priority_at: null, inactivity_deferred_at: undefined } : null;
    pendingError = fallback.error;
  }

  if (pendingError) throw pendingError;
  if (!pendingCard) return null;

  const now = new Date();
  const publishedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + OPEN_CARD_EXPIRE_HOURS * 60 * 60 * 1000).toISOString();

  let updateQuery = adminClient
    .from("dating_cards")
    .update({
      status: "public",
      published_at: publishedAt,
      expires_at: expiresAt,
    })
    .eq("id", pendingCard.id)
    .eq("status", "pending");

  if (pendingCard.inactivity_deferred_at !== undefined) {
    updateQuery = pendingCard.inactivity_deferred_at
      ? updateQuery.eq("inactivity_deferred_at", pendingCard.inactivity_deferred_at)
      : updateQuery.is("inactivity_deferred_at", null);
  }

  let updateRes = await updateQuery.select("id").maybeSingle();

  if (updateRes.error && isMissingColumnError(updateRes.error)) {
    updateRes = await adminClient
      .from("dating_cards")
      .update({ status: "public" })
      .eq("id", pendingCard.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
  }

  if (updateRes.error) throw updateRes.error;
  return updateRes.data?.id ? pendingCard.id : null;
}

async function tryAcquireOpenCardQueueSyncLease(
  adminClient: ReturnType<typeof createAdminClient>,
  now = new Date()
) {
  const token = crypto.randomUUID();
  const acquiredAt = now.toISOString();
  const staleBefore = new Date(now.getTime() - OPEN_CARD_QUEUE_SYNC_LEASE_MS).toISOString();
  const valueJson = {
    token,
    acquiredAt,
    expiresAt: new Date(now.getTime() + OPEN_CARD_QUEUE_SYNC_LEASE_MS).toISOString(),
  };
  const attempt = () => adminClient
    .from("site_settings")
    .update({ value_json: valueJson, updated_at: acquiredAt })
    .eq("key", OPEN_CARD_QUEUE_SYNC_LOCK_KEY)
    .lt("updated_at", staleBefore)
    .select("key")
    .maybeSingle();

  let lockRes = await attempt();
  if (lockRes.error) throw lockRes.error;
  if (lockRes.data) return true;

  const existingRes = await adminClient.from("site_settings")
    .select("key").eq("key", OPEN_CARD_QUEUE_SYNC_LOCK_KEY).maybeSingle();
  if (existingRes.error) throw existingRes.error;
  if (!existingRes.data) {
    const insertRes = await adminClient.from("site_settings").insert({
      key: OPEN_CARD_QUEUE_SYNC_LOCK_KEY,
      value_json: { initialized: true },
      updated_at: OPEN_CARD_QUEUE_SYNC_LOCK_EPOCH,
    });
    if (insertRes.error && insertRes.error.code !== "23505") throw insertRes.error;
    lockRes = await attempt();
    if (lockRes.error) throw lockRes.error;
    if (lockRes.data) return true;
  }
  return false;
}

type ExpiringCardRow = {
  id: string;
  sex: CardSex;
  auto_requeue_count?: number | null;
  inactivity_deferred_at?: string | null;
};

async function fetchExpiringPublicCards(
  adminClient: ReturnType<typeof createAdminClient>
) {
  let { data, error } = await adminClient
    .from("dating_cards")
    .select("id, sex, auto_requeue_count, inactivity_deferred_at")
    .eq("status", "public")
    .lte("expires_at", new Date().toISOString());

  if (error && isMissingColumnError(error)) {
    const legacy = await adminClient
      .from("dating_cards")
      .select("id, sex, auto_requeue_count")
      .eq("status", "public")
      .lte("expires_at", new Date().toISOString());
    data = (legacy.data ?? []).map((row) => ({ ...row, inactivity_deferred_at: null }));
    error = legacy.error;
    if (error && isMissingColumnError(error)) {
      return { rows: null as ExpiringCardRow[] | null, missingAutoRequeueColumn: true };
    }
  }
  if (error) throw error;

  return {
    rows: (data ?? []) as ExpiringCardRow[],
    missingAutoRequeueColumn: false,
  };
}

async function fetchLegacyExpiredCardIds(adminClient: ReturnType<typeof createAdminClient>) {
  let { data, error } = await adminClient
    .from("dating_cards")
    .select("id")
    .eq("status", "public")
    .lte("expires_at", new Date().toISOString());

  if (error && isMissingColumnError(error)) {
    const legacy = await adminClient
      .from("dating_cards")
      .select("id")
      .eq("status", "public");
    data = legacy.data;
    error = legacy.error;
  }

  if (error) throw error;
  return (data ?? []).map((row) => row.id);
}

async function expireCardsWithFallback(
  adminClient: ReturnType<typeof createAdminClient>,
  cardIds: string[]
) {
  if (cardIds.length === 0) return [];

  let expireRes = await adminClient
    .from("dating_cards")
    .update({ status: "expired" })
    .in("id", cardIds)
    .eq("status", "public")
    .select("id,sex");

  if (expireRes.error && isStatusConstraintError(expireRes.error)) {
    const fallbackRes = await adminClient
      .from("dating_cards")
      .update({ status: "hidden" })
      .in("id", cardIds)
      .eq("status", "public")
      .select("id,sex");
    if (!fallbackRes.error) {
      expireRes = fallbackRes;
    } else if (!isMissingColumnError(fallbackRes.error)) {
      throw fallbackRes.error;
    }
  } else if (expireRes.error && !isMissingColumnError(expireRes.error)) {
    throw expireRes.error;
  }

  return (expireRes.data ?? []).map((row) => row.id);
}

async function requeueExpiredCards(
  adminClient: ReturnType<typeof createAdminClient>,
  rows: ExpiringCardRow[]
) {
  if (rows.length === 0) {
    return {
      expiredIds: [] as string[],
      requeuedIds: [] as string[],
    };
  }

  const requeuedIds: string[] = [];
  for (const row of rows) {
    const queuePriorityAt = row.inactivity_deferred_at
      ? OPEN_CARD_DORMANT_QUEUE_PRIORITY_ISO
      : new Date(Date.now() + requeuedIds.length).toISOString();
    const updateRes = await adminClient
      .from("dating_cards")
      .update({
        status: "pending",
        published_at: null,
        expires_at: null,
        auto_requeue_count: Number(row.auto_requeue_count ?? 0) + 1,
        queue_priority_at: queuePriorityAt,
      })
      .eq("id", row.id)
      .eq("status", "public");

    if (updateRes.error) throw updateRes.error;
    requeuedIds.push(row.id);
  }

  return { expiredIds: [] as string[], requeuedIds };
}

export async function promotePendingCardsBySex(
  adminClient: ReturnType<typeof createAdminClient>,
  sex: CardSex
) {
  const promotedIds: string[] = [];
  let publicCount = await getPublicCount(adminClient, sex);
  const slotLimit = await getOpenCardEffectiveLimitBySex(adminClient, sex);

  while (publicCount < slotLimit) {
    const promotedId = await promoteOnePending(adminClient, sex);
    if (!promotedId) break;
    promotedIds.push(promotedId);
    publicCount += 1;
  }

  return { sex, promotedIds, publicCount };
}

export async function syncOpenCardQueue(
  adminClient: ReturnType<typeof createAdminClient>
) {
  const leaseAcquired = await tryAcquireOpenCardQueueSyncLease(adminClient);
  if (!leaseAcquired) {
    return {
      skipped: true,
      expiredIds: [] as string[],
      requeuedIds: [] as string[],
      trimmed: { male: [] as string[], female: [] as string[] },
      promoted: { male: [] as string[], female: [] as string[] },
    };
  }

  let expiredIds: string[] = [];
  let requeuedIds: string[] = [];

  const expiringCards = await fetchExpiringPublicCards(adminClient);
  if (expiringCards.missingAutoRequeueColumn) {
    expiredIds = await expireCardsWithFallback(adminClient, await fetchLegacyExpiredCardIds(adminClient));
  } else {
    const syncResult = await requeueExpiredCards(adminClient, expiringCards.rows ?? []);
    expiredIds = syncResult.expiredIds;
    requeuedIds = syncResult.requeuedIds;
  }

  const male = await promotePendingCardsBySex(adminClient, "male");
  const female = await promotePendingCardsBySex(adminClient, "female");

  return {
    skipped: false,
    expiredIds,
    requeuedIds,
    trimmed: {
      // Public cards keep their full 24-hour window. If an old deployment or
      // an admin slot reduction left a temporary overflow, let it expire
      // naturally and do not promote another card until the count is below the limit.
      male: [] as string[],
      female: [] as string[],
    },
    promoted: {
      male: male.promotedIds,
      female: female.promotedIds,
    },
  };
}
