import type { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

export const ONE_ON_ONE_PLUS_PRODUCT_TYPE = "one_on_one_plus_30d";
export const ONE_ON_ONE_PLUS_PRICE_KRW = 30_000;
export const ONE_ON_ONE_PLUS_DURATION_DAYS = 30;
export const ONE_ON_ONE_PLUS_7D_PRODUCT_TYPE = "one_on_one_plus_7d";
export const ONE_ON_ONE_PLUS_7D_PRICE_KRW = 9_900;
export const ONE_ON_ONE_PLUS_7D_DURATION_DAYS = 7;
export const DATING_ALL_PASS_PRODUCT_TYPE = "dating_all_pass_30d";
export const DATING_ALL_PASS_PRICE_KRW = 39_900;
export const DATING_ALL_PASS_DURATION_DAYS = 30;
export const ONE_ON_ONE_FREE_EXTRA_CANDIDATES = 3;
export const ONE_ON_ONE_FREE_REFRESH_LIMIT = 1;
export const ONE_ON_ONE_PLUS_REFRESH_LIMIT = 2;

export type OneOnOnePlusSubscription = {
  user_id: string;
  starts_at: string;
  expires_at: string;
  contact_exchange_included: boolean;
  updated_at?: string;
};

function isMissingContactExchangeColumn(error: unknown) {
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? "").toLowerCase();
  return message.includes("contact_exchange_included");
}

function isMissingPlusSchema(error: unknown) {
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("dating_1on1_plus_subscriptions") ||
    message.includes("grant_dating_1on1_plus") ||
    message.includes("schema cache")
  );
}

export async function getActiveOneOnOnePlus(admin: AdminClient, userId: string) {
  const nowIso = new Date().toISOString();
  const result = await admin
    .from("dating_1on1_plus_subscriptions")
    .select("user_id,starts_at,expires_at,contact_exchange_included,updated_at")
    .eq("user_id", userId)
    .gt("expires_at", nowIso)
    .maybeSingle();

  if (result.error) {
    if (isMissingContactExchangeColumn(result.error)) {
      const legacyResult = await admin
        .from("dating_1on1_plus_subscriptions")
        .select("user_id,starts_at,expires_at,updated_at")
        .eq("user_id", userId)
        .gt("expires_at", nowIso)
        .maybeSingle();
      if (legacyResult.error) {
        if (isMissingPlusSchema(legacyResult.error)) return null;
        throw legacyResult.error;
      }
      return legacyResult.data
        ? ({ ...legacyResult.data, contact_exchange_included: true } as OneOnOnePlusSubscription)
        : null;
    }
    if (isMissingPlusSchema(result.error)) return null;
    throw result.error;
  }
  return (result.data ?? null) as OneOnOnePlusSubscription | null;
}

export async function assertOneOnOnePlusSchemaReady(admin: AdminClient) {
  const result = await admin
    .from("dating_1on1_plus_subscriptions")
    .select("user_id,contact_exchange_included")
    .limit(1);
  if (result.error) {
    if (isMissingPlusSchema(result.error)) {
      throw new Error("1:1 매칭 플러스 SQL이 아직 적용되지 않았습니다.");
    }
    throw result.error;
  }
}

export async function getActiveOneOnOnePlusByUserIds(admin: AdminClient, userIds: string[]) {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  const activeByUserId = new Map<string, OneOnOnePlusSubscription>();
  if (uniqueIds.length === 0) return activeByUserId;

  for (let index = 0; index < uniqueIds.length; index += 500) {
    const result = await admin
      .from("dating_1on1_plus_subscriptions")
      .select("user_id,starts_at,expires_at,contact_exchange_included,updated_at")
      .in("user_id", uniqueIds.slice(index, index + 500))
      .gt("expires_at", new Date().toISOString());
    if (result.error) {
      if (isMissingContactExchangeColumn(result.error)) {
        const legacyResult = await admin
          .from("dating_1on1_plus_subscriptions")
          .select("user_id,starts_at,expires_at,updated_at")
          .in("user_id", uniqueIds.slice(index, index + 500))
          .gt("expires_at", new Date().toISOString());
        if (legacyResult.error) {
          if (isMissingPlusSchema(legacyResult.error)) return new Map();
          throw legacyResult.error;
        }
        for (const row of legacyResult.data ?? []) {
          activeByUserId.set(row.user_id, {
            ...row,
            contact_exchange_included: true,
          } as OneOnOnePlusSubscription);
        }
        continue;
      }
      if (isMissingPlusSchema(result.error)) return new Map();
      throw result.error;
    }
    for (const row of (result.data ?? []) as OneOnOnePlusSubscription[]) {
      activeByUserId.set(row.user_id, row);
    }
  }
  return activeByUserId;
}

export async function grantOneOnOnePlus(
  admin: AdminClient,
  options: { userId: string; grantKey: string; durationDays?: number; allowLegacySchema?: boolean }
) {
  if (!options.allowLegacySchema) {
    await assertOneOnOnePlusSchemaReady(admin);
  }
  const activeCardRes = await admin
    .from("dating_1on1_cards")
    .select("id")
    .eq("user_id", options.userId)
    .in("status", ["submitted", "reviewing", "approved"])
    .limit(1)
    .maybeSingle();
  if (activeCardRes.error) throw activeCardRes.error;
  if (!activeCardRes.data?.id) {
    throw new Error("활성 1:1 신청서가 있어야 1:1 매칭 플러스를 이용할 수 있습니다.");
  }

  const result = await admin.rpc("grant_dating_1on1_plus", {
    p_user_id: options.userId,
    p_grant_key: options.grantKey,
    p_duration_days: Math.max(1, Math.round(options.durationDays ?? ONE_ON_ONE_PLUS_DURATION_DAYS)),
  });
  if (result.error) {
    if (isMissingPlusSchema(result.error)) {
      throw new Error("1:1 매칭 플러스 SQL이 아직 적용되지 않았습니다.");
    }
    throw result.error;
  }
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!row?.expires_at) throw new Error("1:1 매칭 플러스 권한 반영에 실패했습니다.");
  return row as { starts_at: string; expires_at: string; already_granted: boolean };
}
