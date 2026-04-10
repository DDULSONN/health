import { createAdminClient } from "@/lib/supabase/server";
import { DATING_PAID_FIXED_MS } from "@/lib/dating-paid";
import { extractProvinceFromRegion } from "@/lib/region-city";

type AdminClient = ReturnType<typeof createAdminClient>;

type MoreViewSex = "male" | "female";

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("column");
}

async function incrementApplyCredits(admin: AdminClient, userId: string, creditsToAdd: number) {
  const nowIso = new Date().toISOString();
  const creditRes = await admin.from("user_apply_credits").select("credits").eq("user_id", userId).maybeSingle();
  if (creditRes.error) {
    throw creditRes.error;
  }

  if (!creditRes.data) {
    const insertRes = await admin.from("user_apply_credits").insert({
      user_id: userId,
      credits: Math.max(0, creditsToAdd),
      updated_at: nowIso,
    });
    if (insertRes.error) {
      throw insertRes.error;
    }
    return Math.max(0, creditsToAdd);
  }

  const currentCredits = Math.max(0, Number(creditRes.data.credits ?? 0));
  const nextCredits = currentCredits + Math.max(0, creditsToAdd);
  const updateRes = await admin
    .from("user_apply_credits")
    .update({ credits: nextCredits, updated_at: nowIso })
    .eq("user_id", userId);
  if (updateRes.error) {
    throw updateRes.error;
  }
  return nextCredits;
}

export async function grantApplyCredits(admin: AdminClient, userId: string, creditsToAdd: number) {
  const creditsAfter = await incrementApplyCredits(admin, userId, creditsToAdd);
  return {
    userId,
    addedCredits: Math.max(0, creditsToAdd),
    creditsAfter,
  };
}

type ApproveMoreViewRequestOptions = {
  requestId: string;
  reviewedByUserId: string | null;
  note?: string | null;
  accessHours?: number;
  bonusCredits?: number;
};

export async function approveMoreViewRequest(admin: AdminClient, options: ApproveMoreViewRequestOptions) {
  const reviewedAt = new Date().toISOString();
  const accessHours = options.accessHours ?? 3;
  const bonusCredits = options.bonusCredits ?? 1;
  const accessExpiresAt = new Date(Date.now() + accessHours * 60 * 60 * 1000).toISOString();

  let updateRes = await admin
    .from("dating_more_view_requests")
    .update({
      status: "approved",
      note: options.note ?? null,
      reviewed_at: reviewedAt,
      reviewed_by_user_id: options.reviewedByUserId,
      access_expires_at: accessExpiresAt,
      snapshot_card_ids: [],
    })
    .eq("id", options.requestId)
    .eq("status", "pending")
    .select("id,user_id,sex,status,access_expires_at")
    .maybeSingle();

  if (updateRes.error && isMissingColumnError(updateRes.error)) {
    updateRes = await admin
      .from("dating_more_view_requests")
      .update({
        status: "approved",
        note: options.note ?? null,
        reviewed_at: reviewedAt,
        reviewed_by_user_id: options.reviewedByUserId,
      })
      .eq("id", options.requestId)
      .eq("status", "pending")
      .select("id,user_id,sex,status")
      .maybeSingle();
  }

  if (updateRes.error) {
    throw updateRes.error;
  }
  if (!updateRes.data) {
    return null;
  }

  const creditGrant = bonusCredits > 0 ? await grantApplyCredits(admin, updateRes.data.user_id, bonusCredits) : null;
  return {
    ...updateRes.data,
    access_expires_at: "access_expires_at" in updateRes.data ? updateRes.data.access_expires_at ?? accessExpiresAt : accessExpiresAt,
    bonusCreditsGranted: creditGrant?.addedCredits ?? 0,
  };
}

type RejectMoreViewRequestOptions = {
  requestId: string;
  reviewedByUserId: string | null;
  note?: string | null;
};

export async function rejectMoreViewRequest(admin: AdminClient, options: RejectMoreViewRequestOptions) {
  const updateRes = await admin
    .from("dating_more_view_requests")
    .update({
      status: "rejected",
      note: options.note ?? null,
      reviewed_at: new Date().toISOString(),
      reviewed_by_user_id: options.reviewedByUserId,
      access_expires_at: null,
      snapshot_card_ids: [],
    })
    .eq("id", options.requestId)
    .eq("status", "pending")
    .select("id,user_id,sex,status")
    .maybeSingle();

  if (updateRes.error && isMissingColumnError(updateRes.error)) {
    const legacyRes = await admin
      .from("dating_more_view_requests")
      .update({
        status: "rejected",
        note: options.note ?? null,
        reviewed_at: new Date().toISOString(),
        reviewed_by_user_id: options.reviewedByUserId,
      })
      .eq("id", options.requestId)
      .eq("status", "pending")
      .select("id,user_id,sex,status")
      .maybeSingle();
    if (legacyRes.error) throw legacyRes.error;
    return legacyRes.data ?? null;
  }

  if (updateRes.error) {
    throw updateRes.error;
  }
  return updateRes.data ?? null;
}

type GrantMoreViewAccessOptions = {
  userId: string;
  sex: MoreViewSex;
  accessHours?: number;
  note?: string | null;
  bonusCredits?: number;
};

export async function grantMoreViewAccess(admin: AdminClient, options: GrantMoreViewAccessOptions) {
  const accessHours = options.accessHours ?? 3;
  const bonusCredits = options.bonusCredits ?? 1;
  const now = Date.now();
  const activeRes = await admin
    .from("dating_more_view_requests")
    .select("id,access_expires_at")
    .eq("user_id", options.userId)
    .eq("sex", options.sex)
    .eq("status", "approved")
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);

  if (activeRes.error && !isMissingColumnError(activeRes.error)) {
    throw activeRes.error;
  }

  const activeRows = Array.isArray(activeRes.data) ? activeRes.data : [];
  const activeRow = activeRows.find((row: { access_expires_at?: string | null }) => {
    if (!row.access_expires_at) return false;
    const expiresAt = new Date(row.access_expires_at).getTime();
    return Number.isFinite(expiresAt) && expiresAt > now;
  });

  const baseTime = activeRow?.access_expires_at ? Math.max(new Date(activeRow.access_expires_at).getTime(), now) : now;
  const accessExpiresAt = new Date(baseTime + accessHours * 60 * 60 * 1000).toISOString();

  if (activeRow?.id) {
    const updateRes = await admin
      .from("dating_more_view_requests")
      .update({
        access_expires_at: accessExpiresAt,
        note: options.note ?? null,
        reviewed_at: new Date().toISOString(),
        snapshot_card_ids: [],
      })
      .eq("id", activeRow.id)
      .select("id,user_id,sex,status,access_expires_at")
      .single();
    if (updateRes.error && !isMissingColumnError(updateRes.error)) {
      throw updateRes.error;
    }
    const creditGrant = bonusCredits > 0 ? await grantApplyCredits(admin, options.userId, bonusCredits) : null;
    return {
      requestId: activeRow.id,
      userId: options.userId,
      sex: options.sex,
      accessExpiresAt,
      bonusCreditsGranted: creditGrant?.addedCredits ?? 0,
    };
  }

  const insertPayload = {
    user_id: options.userId,
    sex: options.sex,
    status: "approved",
    note: options.note ?? null,
    reviewed_by_user_id: null,
    reviewed_at: new Date().toISOString(),
    access_expires_at: accessExpiresAt,
    snapshot_card_ids: [],
  };

  let insertRes = await admin
    .from("dating_more_view_requests")
    .insert(insertPayload)
    .select("id,user_id,sex,status,access_expires_at")
    .single();

  if (insertRes.error && isMissingColumnError(insertRes.error)) {
    insertRes = await admin
      .from("dating_more_view_requests")
      .insert({
        user_id: options.userId,
        sex: options.sex,
        status: "approved",
        note: options.note ?? null,
        reviewed_by_user_id: null,
        reviewed_at: new Date().toISOString(),
      })
      .select("id,user_id,sex,status")
      .single();
  }

  if (insertRes.error) {
    throw insertRes.error;
  }

  const creditGrant = bonusCredits > 0 ? await grantApplyCredits(admin, options.userId, bonusCredits) : null;
  return {
    requestId: insertRes.data.id,
    userId: options.userId,
    sex: options.sex,
    accessExpiresAt,
    bonusCreditsGranted: creditGrant?.addedCredits ?? 0,
  };
}

type ApproveCityViewRequestOptions = {
  requestId: string;
  reviewedByUserId: string | null;
  note?: string | null;
  accessHours?: number;
  bonusCredits?: number;
};

export async function approveCityViewRequest(admin: AdminClient, options: ApproveCityViewRequestOptions) {
  const accessHours = options.accessHours ?? 3;
  const bonusCredits = options.bonusCredits ?? 1;
  const reviewedAt = new Date().toISOString();
  const accessExpiresAt = new Date(Date.now() + accessHours * 60 * 60 * 1000).toISOString();
  const updateRes = await admin
    .from("dating_city_view_requests")
    .update({
      status: "approved",
      note: options.note ?? null,
      reviewed_at: reviewedAt,
      reviewed_by_user_id: options.reviewedByUserId,
      access_expires_at: accessExpiresAt,
    })
    .eq("id", options.requestId)
    .eq("status", "pending")
    .select("id,user_id,city,status,access_expires_at")
    .maybeSingle();

  if (updateRes.error) {
    throw updateRes.error;
  }
  if (!updateRes.data) {
    return null;
  }

  const province = normalizeCityProvince(updateRes.data.city);
  if (province) {
    const pendingRes = await admin
      .from("dating_city_view_requests")
      .select("id,city")
      .eq("user_id", updateRes.data.user_id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(200);

    if (pendingRes.error) {
      throw pendingRes.error;
    }

    const staleIds = (pendingRes.data ?? [])
      .filter((row) => row.id !== updateRes.data?.id)
      .filter((row) => normalizeCityProvince(row.city) === province)
      .map((row) => row.id);

    if (staleIds.length > 0) {
      const cleanupRes = await admin
        .from("dating_city_view_requests")
        .update({
          status: "rejected",
          note: options.note ?? "stale pending cleanup",
          reviewed_at: reviewedAt,
          reviewed_by_user_id: options.reviewedByUserId,
          access_expires_at: null,
        })
        .in("id", staleIds);

      if (cleanupRes.error) {
        throw cleanupRes.error;
      }
    }
  }

  const creditGrant = bonusCredits > 0 ? await grantApplyCredits(admin, updateRes.data.user_id, bonusCredits) : null;
  return {
    ...updateRes.data,
    bonusCreditsGranted: creditGrant?.addedCredits ?? 0,
  };
}

type RejectCityViewRequestOptions = {
  requestId: string;
  reviewedByUserId: string | null;
  note?: string | null;
};

function normalizeCityProvince(city: string | null | undefined) {
  const raw = typeof city === "string" ? city.trim() : "";
  return extractProvinceFromRegion(raw) ?? raw;
}

export async function rejectCityViewRequest(admin: AdminClient, options: RejectCityViewRequestOptions) {
  const reviewedAt = new Date().toISOString();
  const updateRes = await admin
    .from("dating_city_view_requests")
    .update({
      status: "rejected",
      note: options.note ?? null,
      reviewed_at: reviewedAt,
      reviewed_by_user_id: options.reviewedByUserId,
      access_expires_at: null,
    })
    .eq("id", options.requestId)
    .eq("status", "pending")
    .select("id,user_id,city,status")
    .maybeSingle();

  if (updateRes.error) {
    throw updateRes.error;
  }
  if (!updateRes.data) {
    return null;
  }

  const province = normalizeCityProvince(updateRes.data.city);
  if (province) {
    const pendingRes = await admin
      .from("dating_city_view_requests")
      .select("id,city")
      .eq("user_id", updateRes.data.user_id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(200);

    if (pendingRes.error) {
      throw pendingRes.error;
    }

    const staleIds = (pendingRes.data ?? [])
      .filter((row) => row.id !== updateRes.data?.id)
      .filter((row) => normalizeCityProvince(row.city) === province)
      .map((row) => row.id);

    if (staleIds.length > 0) {
      const cleanupRes = await admin
        .from("dating_city_view_requests")
        .update({
          status: "rejected",
          note: options.note ?? "stale pending cleanup",
          reviewed_at: reviewedAt,
          reviewed_by_user_id: options.reviewedByUserId,
          access_expires_at: null,
        })
        .in("id", staleIds);

      if (cleanupRes.error) {
        throw cleanupRes.error;
      }
    }
  }

  return updateRes.data;
}

type GrantCityViewAccessOptions = {
  userId: string;
  city: string;
  accessHours?: number;
  note?: string | null;
  bonusCredits?: number;
};

export async function grantCityViewAccess(admin: AdminClient, options: GrantCityViewAccessOptions) {
  const accessHours = options.accessHours ?? 3;
  const bonusCredits = options.bonusCredits ?? 1;
  const now = Date.now();
  const activeRes = await admin
    .from("dating_city_view_requests")
    .select("id,access_expires_at")
    .eq("user_id", options.userId)
    .eq("city", options.city)
    .eq("status", "approved")
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);

  if (activeRes.error) {
    throw activeRes.error;
  }

  const activeRows = Array.isArray(activeRes.data) ? activeRes.data : [];
  const activeRow = activeRows.find((row: { access_expires_at?: string | null }) => {
    if (!row.access_expires_at) return false;
    const expiresAt = new Date(row.access_expires_at).getTime();
    return Number.isFinite(expiresAt) && expiresAt > now;
  });

  const baseTime = activeRow?.access_expires_at ? Math.max(new Date(activeRow.access_expires_at).getTime(), now) : now;
  const accessExpiresAt = new Date(baseTime + accessHours * 60 * 60 * 1000).toISOString();

  if (activeRow?.id) {
    const updateRes = await admin
      .from("dating_city_view_requests")
      .update({
        access_expires_at: accessExpiresAt,
        note: options.note ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", activeRow.id)
      .select("id,user_id,city,status,access_expires_at")
      .single();
    if (updateRes.error) {
      throw updateRes.error;
    }
    const creditGrant = bonusCredits > 0 ? await grantApplyCredits(admin, options.userId, bonusCredits) : null;
    return {
      requestId: activeRow.id,
      userId: options.userId,
      city: options.city,
      accessExpiresAt,
      bonusCreditsGranted: creditGrant?.addedCredits ?? 0,
    };
  }

  const insertRes = await admin
    .from("dating_city_view_requests")
    .insert({
      user_id: options.userId,
      city: options.city,
      status: "approved",
      note: options.note ?? null,
      reviewed_by_user_id: null,
      reviewed_at: new Date().toISOString(),
      access_expires_at: accessExpiresAt,
    })
    .select("id,user_id,city,status,access_expires_at")
    .single();

  if (insertRes.error) {
    throw insertRes.error;
  }

  const creditGrant = bonusCredits > 0 ? await grantApplyCredits(admin, options.userId, bonusCredits) : null;
  return {
    requestId: insertRes.data.id,
    userId: options.userId,
    city: options.city,
    accessExpiresAt,
    bonusCreditsGranted: creditGrant?.addedCredits ?? 0,
  };
}

type ApproveSwipeSubscriptionRequestOptions = {
  requestId: string;
  reviewedByUserId: string | null;
  note?: string | null;
};

export async function approveSwipeSubscriptionRequest(
  admin: AdminClient,
  options: ApproveSwipeSubscriptionRequestOptions
) {
  const pendingRes = await admin
    .from("dating_swipe_subscription_requests")
    .select("id,user_id,daily_limit,duration_days,amount,status")
    .eq("id", options.requestId)
    .eq("status", "pending")
    .maybeSingle();

  if (pendingRes.error && isMissingColumnError(pendingRes.error)) {
    throw pendingRes.error;
  }
  if (pendingRes.error) {
    throw pendingRes.error;
  }
  if (!pendingRes.data) {
    return null;
  }

  const reviewedAt = new Date();
  const durationDays = Math.max(1, Number(pendingRes.data.duration_days ?? 30));
  const expiresAt = new Date(reviewedAt.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();

  const updateRes = await admin
    .from("dating_swipe_subscription_requests")
    .update({
      status: "approved",
      approved_at: reviewedAt.toISOString(),
      expires_at: expiresAt,
      reviewed_at: reviewedAt.toISOString(),
      reviewed_by_user_id: options.reviewedByUserId,
      note: options.note ?? null,
      updated_at: reviewedAt.toISOString(),
    })
    .eq("id", options.requestId)
    .eq("status", "pending")
    .select("id,user_id,status,amount,daily_limit,duration_days,approved_at,expires_at")
    .maybeSingle();

  if (updateRes.error) {
    throw updateRes.error;
  }
  return updateRes.data ?? null;
}

type RejectSwipeSubscriptionRequestOptions = {
  requestId: string;
  reviewedByUserId: string | null;
  note?: string | null;
};

export async function rejectSwipeSubscriptionRequest(
  admin: AdminClient,
  options: RejectSwipeSubscriptionRequestOptions
) {
  const reviewedAt = new Date().toISOString();
  const updateRes = await admin
    .from("dating_swipe_subscription_requests")
    .update({
      status: "rejected",
      reviewed_at: reviewedAt,
      reviewed_by_user_id: options.reviewedByUserId,
      note: options.note ?? null,
      updated_at: reviewedAt,
    })
    .eq("id", options.requestId)
    .eq("status", "pending")
    .select("id,user_id,status,amount,daily_limit,duration_days")
    .maybeSingle();

  if (updateRes.error) {
    throw updateRes.error;
  }
  return updateRes.data ?? null;
}

type ApprovePaidCardOptions = {
  paidCardId: string;
  displayMode?: "priority_24h" | "instant_public";
};

export async function approvePaidCard(admin: AdminClient, options: ApprovePaidCardOptions) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DATING_PAID_FIXED_MS).toISOString();
  const payload: Record<string, unknown> = {
    status: "approved",
    paid_at: now.toISOString(),
    expires_at: expiresAt,
  };
  if (options.displayMode) {
    payload.display_mode = options.displayMode;
  }

  const updateRes = await admin
    .from("dating_paid_cards")
    .update(payload)
    .eq("id", options.paidCardId)
    .eq("status", "pending")
    .select("id,user_id,display_mode,status,paid_at,expires_at")
    .maybeSingle();

  if (updateRes.error && isMissingColumnError(updateRes.error) && options.displayMode) {
    const fallbackRes = await admin
      .from("dating_paid_cards")
      .update({
        status: "approved",
        paid_at: now.toISOString(),
        expires_at: expiresAt,
      })
      .eq("id", options.paidCardId)
      .eq("status", "pending")
      .select("id,user_id,status,paid_at,expires_at")
      .maybeSingle();
    if (fallbackRes.error) {
      throw fallbackRes.error;
    }
    return fallbackRes.data ?? null;
  }

  if (updateRes.error) {
    throw updateRes.error;
  }
  return updateRes.data ?? null;
}
