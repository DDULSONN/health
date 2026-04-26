import { extractProvinceFromRegion } from "@/lib/region-city";
import { grantCityViewAccess } from "@/lib/dating-purchase-fulfillment";
import { getKstWeekId } from "@/lib/weekly";
import type { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

export type CityViewWeeklyBenefitStatus = {
  eligible: boolean;
  canClaim: boolean;
  weekId: string;
  claimedProvince: string | null;
  claimedAt: string | null;
};

function normalizeProvince(value: string | null | undefined) {
  const raw = typeof value === "string" ? value.trim() : "";
  return extractProvinceFromRegion(raw) ?? raw;
}

async function hasEligibleOpenCard(admin: AdminClient, userId: string) {
  const res = await admin
    .from("dating_cards")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", userId)
    .in("status", ["pending", "public"]);

  if (res.error) {
    throw res.error;
  }

  return Number(res.count ?? 0) > 0;
}

async function getWeeklyClaimRow(admin: AdminClient, userId: string, weekId: string) {
  const res = await admin
    .from("dating_city_view_weekly_benefits")
    .select("id,province,created_at")
    .eq("user_id", userId)
    .eq("week_id", weekId)
    .maybeSingle();

  if (res.error) {
    throw res.error;
  }

  return res.data as { id: string; province: string; created_at: string } | null;
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
    throw new Error("오픈카드를 유지 중인 회원만 주간 무료 열람을 사용할 수 있습니다.");
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
    throw claimInsertRes.error;
  }

  try {
    const granted = await grantCityViewAccess(admin, {
      userId: options.userId,
      city: province,
      accessHours: 3,
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
