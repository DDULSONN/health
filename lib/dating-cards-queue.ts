import { OPEN_CARD_AUTO_REQUEUE_LIMIT, OPEN_CARD_EXPIRE_HOURS, getOpenCardLimitBySex } from "@/lib/dating-open";
import { createAdminClient } from "@/lib/supabase/server";

type CardSex = "male" | "female";

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
  const { data: pendingCard, error: pendingError } = await adminClient
    .from("dating_cards")
    .select("id, created_at")
    .eq("sex", sex)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (pendingError) throw pendingError;
  if (!pendingCard) return null;

  const now = new Date();
  const publishedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + OPEN_CARD_EXPIRE_HOURS * 60 * 60 * 1000).toISOString();

  let updateRes = await adminClient
    .from("dating_cards")
    .update({
      status: "public",
      published_at: publishedAt,
      expires_at: expiresAt,
    })
    .eq("id", pendingCard.id)
    .eq("status", "pending");

  if (updateRes.error && isMissingColumnError(updateRes.error)) {
    updateRes = await adminClient
      .from("dating_cards")
      .update({ status: "public" })
      .eq("id", pendingCard.id)
      .eq("status", "pending");
  }

  if (updateRes.error) throw updateRes.error;
  return pendingCard.id;
}

async function trimPublicOverflowBySex(
  adminClient: ReturnType<typeof createAdminClient>,
  sex: CardSex
) {
  const slotLimit = getOpenCardLimitBySex(sex);

  let { data, error } = await adminClient
    .from("dating_cards")
    .select("id, created_at")
    .eq("sex", sex)
    .eq("status", "public")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(500);

  if (error && isMissingColumnError(error)) {
    const legacy = await adminClient
      .from("dating_cards")
      .select("id, created_at")
      .eq("sex", sex)
      .eq("status", "public")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(500);
    data = legacy.data;
    error = legacy.error;
  }

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  if (rows.length <= slotLimit) return [];

  const overflowIds = rows.slice(slotLimit).map((row) => row.id).filter(Boolean);
  if (overflowIds.length === 0) return [];

  let updateRes = await adminClient
    .from("dating_cards")
    .update({
      status: "pending",
      published_at: null,
      expires_at: null,
    })
    .in("id", overflowIds)
    .eq("status", "public");

  if (updateRes.error && isMissingColumnError(updateRes.error)) {
    updateRes = await adminClient
      .from("dating_cards")
      .update({ status: "pending" })
      .in("id", overflowIds)
      .eq("status", "public");
  }

  if (updateRes.error) throw updateRes.error;
  return overflowIds;
}

type ExpiringCardRow = {
  id: string;
  sex: CardSex;
  auto_requeue_count?: number | null;
};

async function fetchExpiringPublicCards(
  adminClient: ReturnType<typeof createAdminClient>
) {
  const { data, error } = await adminClient
    .from("dating_cards")
    .select("id, sex, auto_requeue_count")
    .eq("status", "public")
    .lte("expires_at", new Date().toISOString());

  if (error && isMissingColumnError(error)) {
    return { rows: null as ExpiringCardRow[] | null, missingAutoRequeueColumn: true };
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

async function requeueExpiredCardsOnce(
  adminClient: ReturnType<typeof createAdminClient>,
  rows: ExpiringCardRow[]
) {
  if (rows.length === 0) {
    return {
      expiredIds: [] as string[],
      requeuedIds: [] as string[],
    };
  }

  const cardIds = rows.map((row) => row.id);
  const acceptedRes = await adminClient
    .from("dating_card_applications")
    .select("card_id")
    .in("card_id", cardIds)
    .eq("status", "accepted");

  if (acceptedRes.error) throw acceptedRes.error;

  const acceptedCardIds = new Set((acceptedRes.data ?? []).map((row) => row.card_id));
  const requeueIdSet = new Set(
    rows
      .filter((row) => !acceptedCardIds.has(row.id) && Number(row.auto_requeue_count ?? 0) < OPEN_CARD_AUTO_REQUEUE_LIMIT)
      .map((row) => row.id)
  );
  const requeueRows = rows.filter(
    (row) => requeueIdSet.has(row.id)
  );
  const expireRows = rows.filter((row) => !requeueIdSet.has(row.id));

  const requeuedIds: string[] = [];
  for (const row of requeueRows) {
    const updateRes = await adminClient
      .from("dating_cards")
      .update({
        status: "pending",
        published_at: null,
        expires_at: null,
        auto_requeue_count: Number(row.auto_requeue_count ?? 0) + 1,
      })
      .eq("id", row.id)
      .eq("status", "public");

    if (updateRes.error) throw updateRes.error;
    requeuedIds.push(row.id);
  }

  const expiredIds = await expireCardsWithFallback(
    adminClient,
    expireRows.map((row) => row.id)
  );

  return { expiredIds, requeuedIds };
}

export async function promotePendingCardsBySex(
  adminClient: ReturnType<typeof createAdminClient>,
  sex: CardSex
) {
  const promotedIds: string[] = [];
  let publicCount = await getPublicCount(adminClient, sex);
  const slotLimit = getOpenCardLimitBySex(sex);

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
  let expiredIds: string[] = [];
  let requeuedIds: string[] = [];

  const expiringCards = await fetchExpiringPublicCards(adminClient);
  if (expiringCards.missingAutoRequeueColumn) {
    expiredIds = await expireCardsWithFallback(adminClient, await fetchLegacyExpiredCardIds(adminClient));
  } else {
    const syncResult = await requeueExpiredCardsOnce(adminClient, expiringCards.rows ?? []);
    expiredIds = syncResult.expiredIds;
    requeuedIds = syncResult.requeuedIds;
  }

  const trimmedMaleIds = await trimPublicOverflowBySex(adminClient, "male");
  const trimmedFemaleIds = await trimPublicOverflowBySex(adminClient, "female");

  const male = await promotePendingCardsBySex(adminClient, "male");
  const female = await promotePendingCardsBySex(adminClient, "female");

  return {
    expiredIds,
    requeuedIds,
    trimmed: {
      male: trimmedMaleIds,
      female: trimmedFemaleIds,
    },
    promoted: {
      male: male.promotedIds,
      female: female.promotedIds,
    },
  };
}
