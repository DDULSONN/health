import { createAdminClient } from "@/lib/supabase/server";
import { CITY_VIEW_ACCESS_HOURS, CITY_VIEW_CARD_LIMIT, getCityViewTargetSex } from "@/lib/dating-city-view";
import { getDatingBlockedUserIds } from "@/lib/dating-blocks";
import { filterDatingCardsByContactBlocks } from "@/lib/dating-contact-blocks";
import { DATING_PAID_FIXED_MS } from "@/lib/dating-paid";
import { extractProvinceFromRegion, getNearbyProvinceFallbackOrder } from "@/lib/region-city";
import {
  SWIPE_PREMIUM_DAILY_LIMIT,
  SWIPE_PREMIUM_DURATION_DAYS,
  SWIPE_PREMIUM_PRICE_KRW,
} from "@/lib/dating-swipe";

type AdminClient = ReturnType<typeof createAdminClient>;

type MoreViewSex = "male" | "female";

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    message.includes("bad request") ||
    message.includes("schema cache") ||
    message.includes("could not find") ||
    message.includes("does not exist") ||
    message.includes("column")
  );
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
    let updateRes = await admin
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

    if (updateRes.error && isMissingColumnError(updateRes.error)) {
      updateRes = await admin
        .from("dating_more_view_requests")
        .update({
          access_expires_at: accessExpiresAt,
          note: options.note ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", activeRow.id)
        .select("id,user_id,sex,status,access_expires_at")
        .single();
    }

    if (updateRes.error) {
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
    const errorCode = String((insertRes.error as { code?: unknown }).code ?? "");
    if (errorCode === "23505") {
      const retryRes = await admin
        .from("dating_more_view_requests")
        .select("id,access_expires_at")
        .eq("user_id", options.userId)
        .eq("sex", options.sex)
        .eq("status", "approved")
        .order("reviewed_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(10);

      if (!retryRes.error) {
        const retryRow = (retryRes.data ?? []).find((row: { id: string; access_expires_at?: string | null }) => {
          if (!row.access_expires_at) return false;
          const expiresAt = new Date(row.access_expires_at).getTime();
          return Number.isFinite(expiresAt) && expiresAt > now;
        });

        if (retryRow?.id) {
          const creditGrant = bonusCredits > 0 ? await grantApplyCredits(admin, options.userId, bonusCredits) : null;
          return {
            requestId: retryRow.id,
            userId: options.userId,
            sex: options.sex,
            accessExpiresAt: retryRow.access_expires_at ?? accessExpiresAt,
            bonusCreditsGranted: creditGrant?.addedCredits ?? 0,
          };
        }
      }
    }
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

type CityViewGrantRow = {
  id?: string | null;
  access_expires_at?: string | null;
  snapshot_card_ids?: unknown;
  snapshot_seen_card_ids?: unknown;
};

function parseSnapshotCardIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function mergeCardIds(...groups: string[][]): string[] {
  return [...new Set(groups.flat().filter((id) => id.trim().length > 0))];
}

async function getPreviousCityViewSnapshotIds(admin: AdminClient, userId: string, city: string) {
  const res = await admin
    .from("dating_city_view_requests")
    .select("snapshot_card_ids,snapshot_seen_card_ids")
    .eq("user_id", userId)
    .eq("city", city)
    .eq("status", "approved")
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(100);

  if (res.error) {
    if (isMissingColumnError(res.error)) return new Set<string>();
    throw res.error;
  }

  const ids = new Set<string>();
  for (const row of (res.data ?? []) as Array<{ snapshot_card_ids?: unknown; snapshot_seen_card_ids?: unknown }>) {
    for (const id of parseSnapshotCardIds(row.snapshot_card_ids)) {
      ids.add(id);
    }
    for (const id of parseSnapshotCardIds(row.snapshot_seen_card_ids)) {
      ids.add(id);
    }
  }
  return ids;
}

async function buildCityViewSnapshotCardIds(admin: AdminClient, userId: string, city: string) {
  const province = normalizeCityProvince(city);
  if (!province) return [];

  const usedIds = await getPreviousCityViewSnapshotIds(admin, userId, province);
  const provinceOrder = getNearbyProvinceFallbackOrder(province);
  const provincePriority = new Map(provinceOrder.map((value, index) => [value, index]));
  const targetSex = await getCityViewTargetSex(admin, userId);
  const selectColumns = "id,owner_user_id,sex,region,status,expires_at,created_at";
  const nowIso = new Date().toISOString();
  const [pendingRes, publicRes, blockedUserIds] = await Promise.all([
    admin.from("dating_cards").select(selectColumns).eq("status", "pending").order("created_at", { ascending: false }).limit(5000),
    admin
      .from("dating_cards")
      .select(selectColumns)
      .eq("status", "public")
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(5000),
    getDatingBlockedUserIds(admin, userId),
  ]);

  if (pendingRes.error && publicRes.error) {
    throw pendingRes.error ?? publicRes.error;
  }

  const rows = [
    ...(!pendingRes.error && Array.isArray(pendingRes.data) ? pendingRes.data : []),
    ...(!publicRes.error && Array.isArray(publicRes.data) ? publicRes.data : []),
  ] as Array<{ id: string; owner_user_id: string | null; sex: string | null; region: string | null; status: string | null; expires_at: string | null; created_at: string | null }>;

  const now = Date.now();
  let eligibleRows = rows
    .filter((row) => String(row.owner_user_id ?? "") !== userId)
    .filter((row) => !targetSex || row.sex === targetSex)
    .filter((row) => row.status === "pending" || (row.status === "public" && row.expires_at && new Date(row.expires_at).getTime() > now))
    .filter((row) => provincePriority.has(normalizeCityProvince(row.region) ?? ""))
    .filter((row) => !blockedUserIds.has(String(row.owner_user_id ?? "")));

  eligibleRows = await filterDatingCardsByContactBlocks(admin, userId, eligibleRows);
  eligibleRows.sort((a, b) => {
    const priorityA = provincePriority.get(normalizeCityProvince(a.region) ?? "") ?? Number.MAX_SAFE_INTEGER;
    const priorityB = provincePriority.get(normalizeCityProvince(b.region) ?? "") ?? Number.MAX_SAFE_INTEGER;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  });

  const freshIds = eligibleRows.map((row) => row.id).filter((id) => !usedIds.has(id));
  const fallbackIds = eligibleRows.map((row) => row.id).filter((id) => usedIds.has(id));
  return [...freshIds, ...fallbackIds].slice(0, CITY_VIEW_CARD_LIMIT);
}

async function safeBuildCityViewSnapshotCardIds(admin: AdminClient, userId: string, city: string) {
  try {
    return await buildCityViewSnapshotCardIds(admin, userId, city);
  } catch (error) {
    console.error("[city-view] snapshot build failed; granting access without snapshot", {
      userId,
      city,
      error,
    });
    return [];
  }
}

export async function approveCityViewRequest(admin: AdminClient, options: ApproveCityViewRequestOptions) {
  const accessHours = options.accessHours ?? CITY_VIEW_ACCESS_HOURS;
  const bonusCredits = options.bonusCredits ?? 1;
  const reviewedAt = new Date().toISOString();
  const accessExpiresAt = new Date(Date.now() + accessHours * 60 * 60 * 1000).toISOString();
  const pendingRes = await admin
    .from("dating_city_view_requests")
    .select("id,user_id,city")
    .eq("id", options.requestId)
    .eq("status", "pending")
    .maybeSingle();

  if (pendingRes.error) {
    throw pendingRes.error;
  }

  const snapshotCardIds = pendingRes.data ? await safeBuildCityViewSnapshotCardIds(admin, pendingRes.data.user_id, pendingRes.data.city) : [];
  let updateRes = await admin
    .from("dating_city_view_requests")
    .update({
      status: "approved",
      note: options.note ?? null,
      reviewed_at: reviewedAt,
      reviewed_by_user_id: options.reviewedByUserId,
      access_expires_at: accessExpiresAt,
      snapshot_card_ids: snapshotCardIds,
      snapshot_seen_card_ids: snapshotCardIds,
    })
    .eq("id", options.requestId)
    .eq("status", "pending")
    .select("id,user_id,city,status,access_expires_at")
    .maybeSingle();

  if (updateRes.error && isMissingColumnError(updateRes.error)) {
    updateRes = await admin
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
  }

  if (updateRes.error) {
    const errorCode = String((updateRes.error as { code?: unknown }).code ?? "");
    if (errorCode === "23505" && pendingRes.data) {
      const grant = await grantCityViewAccess(admin, {
        userId: pendingRes.data.user_id,
        city: pendingRes.data.city,
        accessHours,
        note: options.note ?? "approved with active grant refresh",
        bonusCredits,
      });
      await admin
        .from("dating_city_view_requests")
        .update({
          status: "rejected",
          note: options.note ?? "replaced by active city view refresh",
          reviewed_at: reviewedAt,
          reviewed_by_user_id: options.reviewedByUserId,
          access_expires_at: null,
        })
        .eq("id", options.requestId)
        .eq("status", "pending");
      return {
        id: grant.requestId,
        user_id: grant.userId,
        city: grant.city,
        status: "approved",
        access_expires_at: grant.accessExpiresAt,
        bonusCreditsGranted: grant.bonusCreditsGranted,
      };
    }
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
  const accessHours = options.accessHours ?? CITY_VIEW_ACCESS_HOURS;
  const bonusCredits = options.bonusCredits ?? 1;
  const now = Date.now();
  let activeRes: { data: CityViewGrantRow[] | null; error: unknown } = await admin
    .from("dating_city_view_requests")
    .select("id,access_expires_at,snapshot_card_ids,snapshot_seen_card_ids")
    .eq("user_id", options.userId)
    .eq("city", options.city)
    .eq("status", "approved")
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);

  if (activeRes.error && isMissingColumnError(activeRes.error)) {
    activeRes = await admin
      .from("dating_city_view_requests")
      .select("id,access_expires_at")
      .eq("user_id", options.userId)
      .eq("city", options.city)
      .eq("status", "approved")
      .order("reviewed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(10);
  }

  if (activeRes.error) {
    throw activeRes.error;
  }

  const activeRows = (Array.isArray(activeRes.data) ? activeRes.data : []) as CityViewGrantRow[];
  const liveActiveRows = activeRows.filter((row) => {
    if (!row.access_expires_at) return false;
    const expiresAt = new Date(row.access_expires_at).getTime();
    return Number.isFinite(expiresAt) && expiresAt > now;
  });
  const activeRow = liveActiveRows[0];
  const duplicateActiveIds = liveActiveRows
    .slice(1)
    .map((row) => row.id)
    .filter((id): id is string => Boolean(id));

  if (duplicateActiveIds.length > 0) {
    const cleanupRes = await admin
      .from("dating_city_view_requests")
      .update({
        status: "rejected",
        note: options.note ?? "duplicate active city view cleanup",
        reviewed_at: new Date().toISOString(),
        access_expires_at: null,
      })
      .in("id", duplicateActiveIds);
    if (cleanupRes.error) {
      throw cleanupRes.error;
    }
  }

  const accessExpiresAt = new Date(now + accessHours * 60 * 60 * 1000).toISOString();
  const snapshotCardIds = await safeBuildCityViewSnapshotCardIds(admin, options.userId, options.city);
  const snapshotSeenCardIds = mergeCardIds(
    parseSnapshotCardIds((activeRow as { snapshot_seen_card_ids?: unknown } | undefined)?.snapshot_seen_card_ids),
    parseSnapshotCardIds((activeRow as { snapshot_card_ids?: unknown } | undefined)?.snapshot_card_ids),
    snapshotCardIds
  );

  if (activeRow?.id) {
    let updateRes = await admin
      .from("dating_city_view_requests")
      .update({
        access_expires_at: accessExpiresAt,
        note: options.note ?? null,
        reviewed_at: new Date().toISOString(),
        snapshot_card_ids: snapshotCardIds,
        snapshot_seen_card_ids: snapshotSeenCardIds,
      })
      .eq("id", activeRow.id)
      .select("id,user_id,city,status,access_expires_at")
      .single();
    if (updateRes.error && isMissingColumnError(updateRes.error)) {
      updateRes = await admin
        .from("dating_city_view_requests")
        .update({
          access_expires_at: accessExpiresAt,
          note: options.note ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", activeRow.id)
        .select("id,user_id,city,status,access_expires_at")
        .single();
    }
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

  let insertRes = await admin
    .from("dating_city_view_requests")
    .insert({
      user_id: options.userId,
      city: options.city,
      status: "approved",
      note: options.note ?? null,
      reviewed_by_user_id: null,
      reviewed_at: new Date().toISOString(),
      access_expires_at: accessExpiresAt,
      snapshot_card_ids: snapshotCardIds,
      snapshot_seen_card_ids: snapshotCardIds,
    })
    .select("id,user_id,city,status,access_expires_at")
    .single();

  if (insertRes.error && isMissingColumnError(insertRes.error)) {
    insertRes = await admin
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
  }

  if (insertRes.error) {
    const errorCode = String((insertRes.error as { code?: unknown }).code ?? "");
    if (errorCode === "23505") {
      let duplicateRes: { data: CityViewGrantRow | null; error: unknown } = await admin
        .from("dating_city_view_requests")
        .select("id,access_expires_at,snapshot_card_ids,snapshot_seen_card_ids")
        .eq("user_id", options.userId)
        .eq("city", options.city)
        .eq("status", "approved")
        .gt("access_expires_at", new Date().toISOString())
        .order("reviewed_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (duplicateRes.error && isMissingColumnError(duplicateRes.error)) {
        duplicateRes = await admin
          .from("dating_city_view_requests")
          .select("id,access_expires_at")
          .eq("user_id", options.userId)
          .eq("city", options.city)
          .eq("status", "approved")
          .gt("access_expires_at", new Date().toISOString())
          .order("reviewed_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
      }
      if (duplicateRes.error) throw duplicateRes.error;
      if (duplicateRes.data?.id) {
        const retrySnapshotSeenCardIds = mergeCardIds(
          parseSnapshotCardIds((duplicateRes.data as CityViewGrantRow).snapshot_seen_card_ids),
          parseSnapshotCardIds((duplicateRes.data as CityViewGrantRow).snapshot_card_ids),
          snapshotCardIds
        );
        let retryUpdateRes = await admin
          .from("dating_city_view_requests")
          .update({
            access_expires_at: accessExpiresAt,
            note: options.note ?? null,
            reviewed_at: new Date().toISOString(),
            snapshot_card_ids: snapshotCardIds,
            snapshot_seen_card_ids: retrySnapshotSeenCardIds,
          })
          .eq("id", duplicateRes.data.id)
          .select("id,user_id,city,status,access_expires_at")
          .single();
        if (retryUpdateRes.error && isMissingColumnError(retryUpdateRes.error)) {
          retryUpdateRes = await admin
            .from("dating_city_view_requests")
            .update({
              access_expires_at: accessExpiresAt,
              note: options.note ?? null,
              reviewed_at: new Date().toISOString(),
            })
            .eq("id", duplicateRes.data.id)
            .select("id,user_id,city,status,access_expires_at")
            .single();
        }
        if (retryUpdateRes.error) throw retryUpdateRes.error;
        const creditGrant = bonusCredits > 0 ? await grantApplyCredits(admin, options.userId, bonusCredits) : null;
        return {
          requestId: duplicateRes.data.id,
          userId: options.userId,
          city: options.city,
          accessExpiresAt,
          bonusCreditsGranted: creditGrant?.addedCredits ?? 0,
        };
      }
    }
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

type GrantSwipeSubscriptionOptions = {
  userId: string;
  amount?: number;
  dailyLimit?: number;
  durationDays?: number;
  expiresAt?: string | null;
  note?: string | null;
};

export async function grantSwipeSubscription(admin: AdminClient, options: GrantSwipeSubscriptionOptions) {
  const now = new Date();
  const amount = Math.max(0, Number(options.amount ?? SWIPE_PREMIUM_PRICE_KRW));
  const dailyLimit = Math.max(1, Number(options.dailyLimit ?? SWIPE_PREMIUM_DAILY_LIMIT));
  const durationDays = Math.max(1, Number(options.durationDays ?? SWIPE_PREMIUM_DURATION_DAYS));
  const nowIso = now.toISOString();
  const explicitExpiresAtMs = options.expiresAt ? new Date(options.expiresAt).getTime() : Number.NaN;
  const hasExplicitExpiresAt = Number.isFinite(explicitExpiresAtMs) && explicitExpiresAtMs > now.getTime();

  const existingRes = await admin
    .from("dating_swipe_subscription_requests")
    .select("id,status,approved_at,expires_at")
    .eq("user_id", options.userId)
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: false })
    .limit(20);

  if (existingRes.error) {
    throw existingRes.error;
  }

  const rows = Array.isArray(existingRes.data)
    ? (existingRes.data as Array<{
        id: string;
        status: "pending" | "approved";
        approved_at: string | null;
        expires_at: string | null;
      }>)
    : [];

  const activeApproved = rows.find((row) => {
    if (row.status !== "approved" || !row.expires_at) return false;
    const expiresAtMs = new Date(row.expires_at).getTime();
    return Number.isFinite(expiresAtMs) && expiresAtMs > now.getTime();
  });

  if (activeApproved?.id) {
    const baseTime = activeApproved.expires_at
      ? Math.max(new Date(activeApproved.expires_at).getTime(), now.getTime())
      : now.getTime();
    const expiresAt = new Date(
      hasExplicitExpiresAt ? Math.max(baseTime, explicitExpiresAtMs) : baseTime + durationDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const updateRes = await admin
      .from("dating_swipe_subscription_requests")
      .update({
        amount,
        daily_limit: dailyLimit,
        duration_days: durationDays,
        expires_at: expiresAt,
        note: options.note ?? null,
        reviewed_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", activeApproved.id)
      .select("id,user_id,status,amount,daily_limit,duration_days,approved_at,expires_at")
      .single();

    if (updateRes.error) {
      throw updateRes.error;
    }
    return updateRes.data;
  }

  const pendingRow = rows.find((row) => row.status === "pending") ?? null;
  const expiresAt = new Date(
    hasExplicitExpiresAt ? explicitExpiresAtMs : now.getTime() + durationDays * 24 * 60 * 60 * 1000
  ).toISOString();

  if (pendingRow?.id) {
    const approveRes = await admin
      .from("dating_swipe_subscription_requests")
      .update({
        status: "approved",
        amount,
        daily_limit: dailyLimit,
        duration_days: durationDays,
        approved_at: nowIso,
        expires_at: expiresAt,
        reviewed_at: nowIso,
        reviewed_by_user_id: null,
        note: options.note ?? null,
        updated_at: nowIso,
      })
      .eq("id", pendingRow.id)
      .select("id,user_id,status,amount,daily_limit,duration_days,approved_at,expires_at")
      .single();

    if (approveRes.error) {
      throw approveRes.error;
    }
    return approveRes.data;
  }

  const insertRes = await admin
    .from("dating_swipe_subscription_requests")
    .insert({
      user_id: options.userId,
      status: "approved",
      amount,
      daily_limit: dailyLimit,
      duration_days: durationDays,
      approved_at: nowIso,
      expires_at: expiresAt,
      reviewed_at: nowIso,
      reviewed_by_user_id: null,
      note: options.note ?? null,
      updated_at: nowIso,
    })
    .select("id,user_id,status,amount,daily_limit,duration_days,approved_at,expires_at")
    .single();

  if (insertRes.error) {
    throw insertRes.error;
  }
  return insertRes.data;
}

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
  const durationDays = Math.max(1, Number(pendingRes.data.duration_days ?? 15));
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


type GrantOneOnOneContactExchangeOptions = {
  matchId: string;
  userId: string;
  note?: string | null;
};

export async function grantOneOnOneContactExchange(admin: AdminClient, options: GrantOneOnOneContactExchangeOptions) {
  const matchId = options.matchId.trim();
  if (!matchId) {
    throw new Error("dating_1on1_match_id 값이 필요합니다.");
  }

  const matchRes = await admin
    .from("dating_1on1_match_proposals")
    .select(
      "id,source_user_id,candidate_user_id,state,contact_exchange_status,contact_exchange_paid_by_user_id"
    )
    .eq("id", matchId)
    .maybeSingle();

  if (matchRes.error) {
    throw matchRes.error;
  }
  if (!matchRes.data) {
    throw new Error("1:1 번호교환 대상 매칭을 찾지 못했습니다.");
  }
  const isParticipant =
    matchRes.data.source_user_id === options.userId ||
    matchRes.data.candidate_user_id === options.userId;
  if (!isParticipant) {
    throw new Error("1:1 번호교환 결제는 매칭된 두 사용자만 진행할 수 있습니다.");
  }
  if (!["mutual_accepted", "candidate_accepted"].includes(matchRes.data.state)) {
    throw new Error("쌍방 수락이 완료된 매칭만 번호교환 결제를 진행할 수 있습니다.");
  }
  if (matchRes.data.contact_exchange_status === "approved") {
    return {
      id: matchRes.data.id,
      state: matchRes.data.state,
      contact_exchange_status: matchRes.data.contact_exchange_status,
      alreadyApproved: true,
    };
  }
  if (matchRes.data.contact_exchange_status === "canceled") {
    throw new Error("취소된 1:1 매칭은 번호교환 결제를 진행할 수 없습니다.");
  }

  const nowIso = new Date().toISOString();
  const note = (options.note ?? "").trim();
  const nextNote = note ? `${note} | auto-approved` : "auto-approved via direct_store";

  const approveRes = await admin
    .from("dating_1on1_match_proposals")
    .update({
      state: "mutual_accepted",
      contact_exchange_status: "approved",
      contact_exchange_requested_at: nowIso,
      contact_exchange_paid_at: nowIso,
      contact_exchange_paid_by_user_id: options.userId,
      contact_exchange_approved_at: nowIso,
      contact_exchange_approved_by_user_id: null,
      contact_exchange_note: nextNote,
      updated_at: nowIso,
    })
    .eq("id", matchId)
    .in("state", ["mutual_accepted", "candidate_accepted"])
    .in("contact_exchange_status", ["none", "awaiting_applicant_payment", "payment_pending_admin"])
    .select(
      "id,source_user_id,candidate_user_id,state,contact_exchange_status,contact_exchange_paid_at,contact_exchange_paid_by_user_id,contact_exchange_approved_at,contact_exchange_note"
    )
    .maybeSingle();

  if (approveRes.error) {
    throw approveRes.error;
  }
  if (!approveRes.data) {
    throw new Error("이 1:1 번호교환 결제는 이미 처리되었습니다.");
  }

  return approveRes.data;
}

type GrantOneOnOnePriorityBoostOptions = {
  cardId: string;
  userId: string;
  durationDays?: number;
  note?: string | null;
};

export async function grantOneOnOnePriorityBoost(admin: AdminClient, options: GrantOneOnOnePriorityBoostOptions) {
  const cardId = options.cardId.trim();
  if (!cardId) {
    throw new Error("dating_1on1_card_id 값이 필요합니다.");
  }

  const cardRes = await admin
    .from("dating_1on1_cards")
    .select("id,user_id,status,priority_boost_expires_at")
    .eq("id", cardId)
    .maybeSingle();

  if (cardRes.error) {
    throw cardRes.error;
  }
  if (!cardRes.data || cardRes.data.user_id !== options.userId) {
    throw new Error("1:1 매칭 부스트 대상 신청서를 찾지 못했습니다.");
  }
  if (!["submitted", "reviewing", "approved"].includes(String(cardRes.data.status ?? ""))) {
    throw new Error("진행 중인 1:1 신청서만 매칭 부스트를 사용할 수 있습니다.");
  }

  const now = Date.now();
  const durationDays = Math.max(1, Number(options.durationDays ?? 3));
  const currentExpiresAt = cardRes.data.priority_boost_expires_at
    ? new Date(cardRes.data.priority_boost_expires_at).getTime()
    : Number.NaN;
  const baseMs = Number.isFinite(currentExpiresAt) && currentExpiresAt > now ? currentExpiresAt : now;
  const expiresAt = new Date(baseMs + durationDays * 24 * 60 * 60 * 1000).toISOString();

  const updateRes = await admin
    .from("dating_1on1_cards")
    .update({ priority_boost_expires_at: expiresAt })
    .eq("id", cardId)
    .eq("user_id", options.userId)
    .in("status", ["submitted", "reviewing", "approved"])
    .select("id,user_id,status,priority_boost_expires_at")
    .maybeSingle();

  if (updateRes.error) {
    throw updateRes.error;
  }
  if (!updateRes.data?.id) {
    throw new Error("1:1 매칭 부스트 반영에 실패했습니다.");
  }

  return {
    ...updateRes.data,
    durationDays,
    note: options.note ?? null,
  };
}

type GrantOpenCardRepostOptions = {
  cardId: string;
  userId: string;
  note?: string | null;
};

export async function grantOpenCardRepost(admin: AdminClient, options: GrantOpenCardRepostOptions) {
  const cardId = options.cardId.trim();
  if (!cardId) {
    throw new Error("dating_open_card_id 값이 필요합니다.");
  }

  const cardRes = await admin
    .from("dating_cards")
    .select("id,owner_user_id,status")
    .eq("id", cardId)
    .maybeSingle();

  if (cardRes.error) {
    throw cardRes.error;
  }
  if (!cardRes.data || cardRes.data.owner_user_id !== options.userId) {
    throw new Error("오픈카드 재등록 대상 카드를 찾지 못했습니다.");
  }
  if (!["expired", "hidden"].includes(String(cardRes.data.status ?? ""))) {
    throw new Error("만료되었거나 숨김 처리된 오픈카드만 재등록할 수 있습니다.");
  }

  const activeCardRes = await admin
    .from("dating_cards")
    .select("id")
    .eq("owner_user_id", options.userId)
    .in("status", ["pending", "public"])
    .neq("id", cardId)
    .limit(1)
    .maybeSingle();

  if (activeCardRes.error) {
    throw activeCardRes.error;
  }
  if (activeCardRes.data?.id) {
    throw new Error("이미 대기 중이거나 공개 중인 오픈카드가 있습니다.");
  }

  const nowIso = new Date().toISOString();
  let updateRes = await admin
    .from("dating_cards")
    .update({
      status: "pending",
      published_at: null,
      expires_at: null,
      queue_priority_at: nowIso,
      auto_requeue_count: 0,
    })
    .eq("id", cardId)
    .eq("owner_user_id", options.userId)
    .in("status", ["expired", "hidden"])
    .select("id,owner_user_id,status")
    .maybeSingle();

  if (updateRes.error && isMissingColumnError(updateRes.error)) {
    updateRes = await admin
      .from("dating_cards")
      .update({
        status: "pending",
        published_at: null,
        expires_at: null,
      })
      .eq("id", cardId)
      .eq("owner_user_id", options.userId)
      .in("status", ["expired", "hidden"])
      .select("id,owner_user_id,status")
      .maybeSingle();
  }

  if (updateRes.error) {
    throw updateRes.error;
  }
  if (!updateRes.data?.id) {
    throw new Error("오픈카드 재등록 반영에 실패했습니다.");
  }

  return {
    ...updateRes.data,
    note: options.note ?? null,
  };
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
