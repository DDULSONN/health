import { extractProvinceFromRegion } from "@/lib/region-city";
import { CITY_VIEW_ACCESS_HOURS } from "@/lib/dating-city-view";
import { grantCityViewAccess } from "@/lib/dating-purchase-fulfillment";
import { getKstWeekId, getKstWeekRange } from "@/lib/weekly";
import type { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

export type CityViewWeeklyBenefitStatus = {
  eligible: boolean;
  canClaim: boolean;
  weekId: string;
  claimedProvince: string | null;
  claimedAt: string | null;
};

type WeeklyClaimRow = {
  id: string;
  province: string;
  created_at: string;
};

function normalizeProvince(value: string | null | undefined) {
  const raw = typeof value === "string" ? value.trim() : "";
  return extractProvinceFromRegion(raw) ?? raw;
}

function isWeeklyBenefitStoreUnavailable(error: unknown) {
  if (typeof error === "string") return error.toLowerCase().includes("bad request");
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    message.includes("bad request") ||
    message.includes("dating_city_view_weekly_benefits") ||
    message.includes("schema cache") ||
    message.includes("could not find") ||
    message.includes("does not exist")
  );
}

async function hasEligibleOpenCard(admin: AdminClient, userId: string) {
  const res = await admin
    .from("dating_cards")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", userId)
    .in("status", ["pending", "public", "hidden", "expired"]);

  if (res.error) {
    if (isWeeklyBenefitStoreUnavailable(res.error)) return true;
    throw res.error;
  }

  return Number(res.count ?? 0) > 0;
}

async function getFallbackWeeklyClaimRow(admin: AdminClient, userId: string): Promise<WeeklyClaimRow | null> {
  const range = getKstWeekRange();
  const res = await admin
    .from("dating_city_view_requests")
    .select("id,city,reviewed_at,created_at")
    .eq("user_id", userId)
    .eq("status", "approved")
    .eq("note", "weekly open card benefit")
    .gte("reviewed_at", range.startUtcIso)
    .lt("reviewed_at", range.endUtcIso)
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (res.error) {
    throw res.error;
  }
  if (!res.data) return null;
  return {
    id: String(res.data.id ?? ""),
    province: normalizeProvince(String(res.data.city ?? "")),
    created_at: String(res.data.reviewed_at ?? res.data.created_at ?? ""),
  };
}

async function getWeeklyClaimRow(admin: AdminClient, userId: string, weekId: string): Promise<WeeklyClaimRow | null> {
  const res = await admin
    .from("dating_city_view_weekly_benefits")
    .select("id,province,created_at")
    .eq("user_id", userId)
    .eq("week_id", weekId)
    .maybeSingle();

  if (res.error) {
    if (isWeeklyBenefitStoreUnavailable(res.error)) {
      return getFallbackWeeklyClaimRow(admin, userId);
    }
    throw res.error;
  }

  return res.data as WeeklyClaimRow | null;
}

export async function getCityViewWeeklyBenefitStatus(
  admin: AdminClient,
  userId: string,
  now = new Date()
): Promise<CityViewWeeklyBenefitStatus> {
  const weekId = getKstWeekId(now);
  const [eligible, claimRow] = await Promise.all([
    hasEligibleOpenCard(admin, userId),
    getWeeklyClaimRow(admin, userId, weekId),
  ]);

  return {
    eligible,
    canClaim: eligible && !claimRow,
    weekId,
    claimedProvince: claimRow ? normalizeProvince(claimRow.province) : null,
    claimedAt: claimRow?.created_at ?? null,
  };
}

type ClaimCityViewWeeklyBenefitOptions = {
  userId: string;
  province: string;
};

export async function claimCityViewWeeklyBenefit(
  admin: AdminClient,
  options: ClaimCityViewWeeklyBenefitOptions
) {
  const province = normalizeProvince(options.province);
  if (!province || province.length < 2 || province.length > 20) {
    throw new Error("도/광역시명을 확인해주세요.");
  }

  const weekId = getKstWeekId();
  const status = await getCityViewWeeklyBenefitStatus(admin, options.userId);
  if (!status.eligible) {
    throw new Error("오픈카드를 보유한 회원만 주간 무료 열람을 사용할 수 있습니다.");
  }
  if (!status.canClaim) {
    throw new Error("이번 주 무료 열람은 이미 사용했습니다.");
  }

  const claimInsertRes = await admin
    .from("dating_city_view_weekly_benefits")
    .insert({
      user_id: options.userId,
      week_id: weekId,
      province,
    })
    .select("id")
    .single();

  if (claimInsertRes.error) {
    if (String(claimInsertRes.error.code ?? "") === "23505") {
      throw new Error("이번 주 무료 열람은 이미 사용했습니다.");
    }
    if (isWeeklyBenefitStoreUnavailable(claimInsertRes.error)) {
      const granted = await grantCityViewAccess(admin, {
        userId: options.userId,
        city: province,
        accessHours: CITY_VIEW_ACCESS_HOURS,
        note: "weekly open card benefit",
        bonusCredits: 0,
      });
      return {
        province,
        accessExpiresAt: granted.accessExpiresAt,
        requestId: granted.requestId,
      };
    }
    throw claimInsertRes.error;
  }

  try {
    const granted = await grantCityViewAccess(admin, {
      userId: options.userId,
      city: province,
      accessHours: CITY_VIEW_ACCESS_HOURS,
      note: "weekly open card benefit",
      bonusCredits: 0,
    });

    await admin
      .from("dating_city_view_weekly_benefits")
      .update({ granted_request_id: granted.requestId })
      .eq("id", claimInsertRes.data.id);

    return {
      province,
      accessExpiresAt: granted.accessExpiresAt,
      requestId: granted.requestId,
    };
  } catch (error) {
    await admin.from("dating_city_view_weekly_benefits").delete().eq("id", claimInsertRes.data.id);
    throw error;
  }
}
