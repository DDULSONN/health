import { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

type RepostOrder = {
  id: string;
  product_ref_id: string | null;
  product_meta: Record<string, unknown> | null;
  status: string;
  approved_at: string | null;
  created_at: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getOpenCardRepostWindow(order: Pick<RepostOrder, "product_meta" | "approved_at" | "created_at">) {
  const meta = asRecord(order.product_meta);
  const startedAt = text(meta.reopenFulfilledAt) || order.approved_at || order.created_at;
  const explicitExpiresAt = text(meta.reopenExpiresAt);
  const durationHours = positiveNumber(meta.durationHours, 24);
  const startMs = new Date(startedAt).getTime();
  const expiresAt = explicitExpiresAt || (Number.isFinite(startMs) ? new Date(startMs + durationHours * 60 * 60 * 1000).toISOString() : "");
  return { startedAt, expiresAt, durationHours };
}

async function listRecentRepostOrders(admin: AdminClient, userId: string): Promise<RepostOrder[]> {
  const res = await admin
    .from("toss_test_payment_orders")
    .select("id,product_ref_id,product_meta,status,approved_at,created_at")
    .eq("user_id", userId)
    .eq("product_type", "paid_card")
    .eq("status", "paid")
    .contains("product_meta", { source: "open_card_reopen" })
    .order("approved_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);

  if (res.error) throw res.error;
  return (res.data ?? []) as RepostOrder[];
}

export async function markOpenCardRepostFulfilled(
  admin: AdminClient,
  order: Pick<RepostOrder, "id" | "product_meta">,
  options: { cardId: string; fulfilledAt: string; expiresAt: string }
) {
  const productMeta = {
    ...asRecord(order.product_meta),
    reopenCardId: options.cardId,
    reopenFulfilledAt: options.fulfilledAt,
    reopenExpiresAt: options.expiresAt,
    reopenFulfillmentStatus: "active",
  };
  const result = await admin.from("toss_test_payment_orders").update({ product_meta: productMeta }).eq("id", order.id);
  if (result.error) console.error("[open-card-repost] fulfillment audit update failed", result.error);
}

export async function markOpenCardRepostDeleted(admin: AdminClient, userId: string, card: Record<string, unknown>) {
  const cardId = text(card.id);
  if (!cardId) return;

  const orders = await listRecentRepostOrders(admin, userId).catch((error) => {
    console.error("[open-card-repost] delete audit lookup failed", error);
    return [] as RepostOrder[];
  });

  await Promise.all(
    orders
      .filter((order) => {
        const meta = asRecord(order.product_meta);
        return order.product_ref_id === cardId || text(meta.openCardId) === cardId || text(meta.reopenCardId) === cardId;
      })
      .map(async (order) => {
        const productMeta = {
          ...asRecord(order.product_meta),
          reopenDeletedAt: new Date().toISOString(),
          reopenDeletedCardId: cardId,
          reopenDeletedCardStatus: text(card.status) || null,
          reopenFulfillmentStatus: "card_deleted",
        };
        const result = await admin.from("toss_test_payment_orders").update({ product_meta: productMeta }).eq("id", order.id);
        if (result.error) console.error("[open-card-repost] delete audit update failed", result.error);
      })
  );
}

export async function recoverOpenCardRepostEntitlement(admin: AdminClient, userId: string) {
  const orders = await listRecentRepostOrders(admin, userId);
  const nowMs = Date.now();

  for (const order of orders) {
    const meta = asRecord(order.product_meta);
    const transferCount = Math.max(0, Number(meta.reopenTransferCount ?? 0));
    if (transferCount >= 1) continue;

    const window = getOpenCardRepostWindow(order);
    const expiresMs = new Date(window.expiresAt).getTime();
    if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) continue;

    const originalCardId = text(meta.openCardId) || text(order.product_ref_id);
    if (!originalCardId) continue;

    const originalRes = await admin
      .from("dating_cards")
      .select("id,status,expires_at")
      .eq("id", originalCardId)
      .eq("owner_user_id", userId)
      .maybeSingle();
    if (originalRes.error) throw originalRes.error;

    if (originalRes.data) {
      const originalExpiresMs = originalRes.data.expires_at ? new Date(originalRes.data.expires_at).getTime() : 0;
      if (originalRes.data.status === "public" && originalExpiresMs > nowMs) return { recovered: false, reason: "original_active" };
      if (!["pending", "hidden", "expired"].includes(String(originalRes.data.status ?? ""))) continue;

      const recoveredAt = new Date().toISOString();
      const publishedAt = Number.isFinite(new Date(window.startedAt).getTime()) ? window.startedAt : recoveredAt;
      const recoveryRes = await admin
        .from("dating_cards")
        .update({
          status: "public",
          published_at: publishedAt,
          expires_at: window.expiresAt,
          created_at: publishedAt,
        })
        .eq("id", originalCardId)
        .eq("owner_user_id", userId)
        .in("status", ["pending", "hidden", "expired"])
        .select("id,status,published_at,expires_at")
        .maybeSingle();
      if (recoveryRes.error) throw recoveryRes.error;
      if (!recoveryRes.data) continue;

      const productMeta = {
        ...meta,
        reopenRecoveredAt: recoveredAt,
        reopenRecoveryCount: Math.max(0, Number(meta.reopenRecoveryCount ?? 0)) + 1,
        reopenExpiresAt: window.expiresAt,
        reopenFulfillmentStatus: "recovered_existing",
      };
      const orderUpdate = await admin.from("toss_test_payment_orders").update({ product_meta: productMeta }).eq("id", order.id);
      if (orderUpdate.error) console.error("[open-card-repost] existing card recovery audit update failed", orderUpdate.error);

      return { recovered: true, card: recoveryRes.data, orderId: order.id };
    }

    const replacementRes = await admin
      .from("dating_cards")
      .select("id,status")
      .eq("owner_user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (replacementRes.error) throw replacementRes.error;
    if (!replacementRes.data?.id) continue;

    const nowIso = new Date().toISOString();
    const updateRes = await admin
      .from("dating_cards")
      .update({
        status: "public",
        published_at: nowIso,
        expires_at: window.expiresAt,
        created_at: nowIso,
      })
      .eq("id", replacementRes.data.id)
      .eq("owner_user_id", userId)
      .eq("status", "pending")
      .select("id,status,published_at,expires_at")
      .maybeSingle();
    if (updateRes.error) throw updateRes.error;
    if (!updateRes.data) continue;

    const productMeta = {
      ...meta,
      reopenTransferredAt: nowIso,
      reopenTransferredFromCardId: originalCardId,
      reopenTransferredToCardId: updateRes.data.id,
      reopenTransferCount: transferCount + 1,
      reopenExpiresAt: window.expiresAt,
      reopenFulfillmentStatus: "transferred",
    };
    const orderUpdate = await admin.from("toss_test_payment_orders").update({ product_meta: productMeta }).eq("id", order.id);
    if (orderUpdate.error) console.error("[open-card-repost] transfer audit update failed", orderUpdate.error);

    return { recovered: true, card: updateRes.data, orderId: order.id };
  }

  return { recovered: false, reason: "no_eligible_order" };
}

export function buildOpenCardRepostDiagnostics(
  orders: Array<Record<string, unknown>>,
  cards: Array<Record<string, unknown>>
) {
  const cardById = new Map(cards.map((card) => [text(card.id), card]));
  const latestCard = cards[0] ?? null;

  return orders
    .filter((order) => order.product_type === "paid_card" && asRecord(order.product_meta).source === "open_card_reopen")
    .map((order) => {
      const meta = asRecord(order.product_meta);
      const targetCardId = text(meta.reopenTransferredToCardId) || text(meta.reopenCardId) || text(meta.openCardId) || text(order.product_ref_id);
      const targetCard = cardById.get(targetCardId) ?? null;
      const window = getOpenCardRepostWindow({
        product_meta: meta,
        approved_at: text(order.approved_at) || null,
        created_at: text(order.created_at),
      });
      const isPaid = order.status === "paid";
      const entitlementStillActive = Boolean(
        window.expiresAt && new Date(window.expiresAt).getTime() > Date.now()
      );
      const isMissing = isPaid && entitlementStillActive && Boolean(targetCardId) && !targetCard;
      return {
        id: order.id ?? null,
        order_status: order.status ?? null,
        amount: order.amount ?? null,
        order_name: order.order_name ?? null,
        paid_at: order.approved_at ?? null,
        expected_expires_at: window.expiresAt || null,
        original_card_id: text(meta.openCardId) || text(order.product_ref_id) || null,
        current_target_card_id: targetCardId || null,
        current_target_card_status: targetCard?.status ?? null,
        fulfillment_status:
          meta.reopenFulfillmentStatus ??
          (isMissing
            ? "target_missing"
            : targetCard
              ? "card_present"
              : isPaid && targetCardId
                ? "expired_target_removed"
                : "payment_not_completed"),
        deleted_at: meta.reopenDeletedAt ?? null,
        transferred_at: meta.reopenTransferredAt ?? null,
        transfer_count: Number(meta.reopenTransferCount ?? 0),
        needs_attention: isMissing,
        latest_open_card_id: latestCard?.id ?? null,
        latest_open_card_status: latestCard?.status ?? null,
        created_at: order.created_at ?? null,
      };
    });
}
