import { OPEN_CARD_EXPIRE_HOURS, getOpenCardLimitBySex } from "@/lib/dating-open";
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
  const nowIso = new Date().toISOString();

  let expireRes = await adminClient
    .from("dating_cards")
    .update({ status: "expired" })
    .eq("status", "public")
    .lte("expires_at", nowIso)
    .select("id,sex");

  if (expireRes.error && isStatusConstraintError(expireRes.error)) {
    // Some environments still have a legacy status CHECK without 'expired'.
    // Fallback to 'hidden' so expired slots are still freed for pending promotion.
    const fallbackRes = await adminClient
      .from("dating_cards")
      .update({ status: "hidden" })
      .eq("status", "public")
      .lte("expires_at", nowIso)
      .select("id,sex");
    if (!fallbackRes.error) {
      expireRes = fallbackRes;
    } else if (!isMissingColumnError(fallbackRes.error)) {
      throw fallbackRes.error;
    }
  } else if (expireRes.error && !isMissingColumnError(expireRes.error)) {
    throw expireRes.error;
  }

  const trimmedMaleIds = await trimPublicOverflowBySex(adminClient, "male");
  const trimmedFemaleIds = await trimPublicOverflowBySex(adminClient, "female");

  const male = await promotePendingCardsBySex(adminClient, "male");
  const female = await promotePendingCardsBySex(adminClient, "female");

  return {
    expiredIds: (expireRes.data ?? []).map((row) => row.id),
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
