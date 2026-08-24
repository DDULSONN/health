import { Status, type JWSRenewalInfoDecodedPayload, type JWSTransactionDecodedPayload } from "@apple/app-store-server-library";
import { grantSwipeSubscription } from "@/lib/dating-purchase-fulfillment";
import {
  DATING_STORE_PRODUCT_CATALOG,
  DATING_STORE_PRODUCT_IDS,
  normalizeDatingStoreProductId,
} from "@/lib/dating-store-products";
import { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

type AppleSubscriptionStateInput = {
  notificationType: string;
  status: number | null;
  signedDate: number;
  transaction: JWSTransactionDecodedPayload;
  renewal: JWSRenewalInfoDecodedPayload | null;
};

export type DerivedAppleSubscriptionState = {
  active: boolean;
  revoked: boolean;
  expiresAt: string;
  expiresAtMs: number;
};

function finiteTimestamp(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function deriveAppleSubscriptionState(input: AppleSubscriptionStateInput): DerivedAppleSubscriptionState {
  const now = Date.now();
  const transactionExpiry = finiteTimestamp(input.transaction.expiresDate);
  const graceExpiry = finiteTimestamp(input.renewal?.gracePeriodExpiresDate);
  const refundedOrRevoked = input.notificationType === "REFUND" || input.notificationType === "REVOKE";
  const revoked = input.status === Status.REVOKED || refundedOrRevoked;
  const inGracePeriod = input.status === Status.BILLING_GRACE_PERIOD && graceExpiry > now;
  const activeByStatus = input.status === Status.ACTIVE || inGracePeriod;
  const activeByExpiry = input.status == null && transactionExpiry > now;
  const active = !revoked && (activeByStatus || activeByExpiry);
  const activeExpiry = inGracePeriod ? Math.max(transactionExpiry, graceExpiry) : transactionExpiry;
  const expiresAtMs = revoked ? now : activeExpiry || now;

  return {
    active: active && expiresAtMs > now,
    revoked,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
  };
}

function isMissingStoreMetadata(error: unknown) {
  const value = error as { code?: unknown; message?: unknown; details?: unknown } | null;
  const code = String(value?.code ?? "");
  const message = `${String(value?.message ?? "")} ${String(value?.details ?? "")}`.toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("source_store") || message.includes("source_event_signed_at");
}

function eventIso(signedDate: number) {
  const parsed = finiteTimestamp(signedDate);
  return new Date(parsed || Date.now()).toISOString();
}

export async function syncAppleSwipeSubscription(
  admin: AdminClient,
  input: {
    userId: string;
    productId: string;
    originalTransactionId: string;
    transactionId: string;
    notificationType: string;
    status: number | null;
    signedDate: number;
    transaction: JWSTransactionDecodedPayload;
    renewal: JWSRenewalInfoDecodedPayload | null;
    note: string;
  }
) {
  if (normalizeDatingStoreProductId(input.productId) !== DATING_STORE_PRODUCT_IDS.swipePremium30d) {
    return { handled: false, ignored: true, reason: "not_swipe_subscription" } as const;
  }

  const catalog = DATING_STORE_PRODUCT_CATALOG[DATING_STORE_PRODUCT_IDS.swipePremium30d];
  const state = deriveAppleSubscriptionState({
    notificationType: input.notificationType,
    status: input.status,
    signedDate: input.signedDate,
    transaction: input.transaction,
    renewal: input.renewal,
  });
  const signedAt = eventIso(input.signedDate);
  const nowIso = new Date().toISOString();

  const existingRes = await admin
    .from("dating_swipe_subscription_requests")
    .select("id,status,expires_at,source_event_signed_at")
    .eq("source_store", "app_store")
    .eq("original_transaction_id", input.originalTransactionId)
    .maybeSingle();

  if (existingRes.error && isMissingStoreMetadata(existingRes.error)) {
    if (!state.active) {
      return { handled: false, ignored: true, reason: "store_metadata_schema_missing", state } as const;
    }

    const legacy = await grantSwipeSubscription(admin, {
      userId: input.userId,
      amount: catalog.amountKrw,
      dailyLimit: catalog.dailyLimit,
      durationDays: catalog.durationDays,
      expiresAt: state.expiresAt,
      note: `${input.note} schema=fallback`,
    });
    return { handled: true, ignored: false, reason: "legacy_fallback", state, row: legacy } as const;
  }
  if (existingRes.error) throw existingRes.error;

  const previousSignedAt = existingRes.data?.source_event_signed_at
    ? new Date(existingRes.data.source_event_signed_at).getTime()
    : 0;
  if (previousSignedAt > finiteTimestamp(input.signedDate)) {
    return { handled: false, ignored: true, reason: "stale_notification", state } as const;
  }

  const rowPayload = {
    user_id: input.userId,
    status: state.active ? "approved" : "expired",
    amount: catalog.amountKrw,
    daily_limit: catalog.dailyLimit,
    duration_days: catalog.durationDays,
    approved_at: state.active ? existingRes.data?.status === "approved" ? undefined : nowIso : undefined,
    expires_at: state.expiresAt,
    reviewed_at: nowIso,
    reviewed_by_user_id: null,
    note: input.note,
    updated_at: nowIso,
    source_store: "app_store",
    product_id: input.productId,
    original_transaction_id: input.originalTransactionId,
    latest_transaction_id: input.transactionId,
    source_event_signed_at: signedAt,
  };

  if (existingRes.data?.id) {
    const updatePayload = Object.fromEntries(Object.entries(rowPayload).filter(([, value]) => value !== undefined));
    const updateRes = await admin
      .from("dating_swipe_subscription_requests")
      .update(updatePayload)
      .eq("id", existingRes.data.id)
      .select("id,user_id,status,expires_at,source_store,product_id,original_transaction_id,latest_transaction_id,source_event_signed_at")
      .single();
    if (updateRes.error) throw updateRes.error;
    return { handled: true, ignored: false, reason: state.active ? "updated_active" : "updated_inactive", state, row: updateRes.data } as const;
  }

  const insertPayload = Object.fromEntries(Object.entries(rowPayload).filter(([, value]) => value !== undefined));
  const insertRes = await admin
    .from("dating_swipe_subscription_requests")
    .insert(insertPayload)
    .select("id,user_id,status,expires_at,source_store,product_id,original_transaction_id,latest_transaction_id,source_event_signed_at")
    .single();
  if (insertRes.error) {
    if (String(insertRes.error.code ?? "") === "23505") {
      return syncAppleSwipeSubscription(admin, input);
    }
    throw insertRes.error;
  }
  return { handled: true, ignored: false, reason: state.active ? "inserted_active" : "inserted_inactive", state, row: insertRes.data } as const;
}
