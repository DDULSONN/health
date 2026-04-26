import { extractProvinceFromRegion } from "@/lib/region-city";
import { claimCityViewWeeklyBenefit } from "@/lib/dating-city-view-weekly";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type CityViewRequestRow = {
  id: string;
  city?: string | null;
  status: "pending" | "approved" | "rejected" | string;
  access_expires_at?: string | null;
  reviewed_at?: string | null;
  created_at?: string | null;
};

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function getRowSortTime(row: CityViewRequestRow): number {
  const reviewedAt = normalizeIsoDate(row.reviewed_at);
  if (reviewedAt) return new Date(reviewedAt).getTime();
  const createdAt = normalizeIsoDate(row.created_at);
  if (createdAt) return new Date(createdAt).getTime();
  return 0;
}

function getProvinceFromRow(row: CityViewRequestRow): string {
  const rawCity = typeof row.city === "string" ? row.city.trim() : "";
  return extractProvinceFromRegion(rawCity) ?? rawCity;
}

function hasActiveApprovedRow(rows: CityViewRequestRow[]): boolean {
  return rows.some((row) => {
    if (row.status !== "approved" || !row.access_expires_at) return false;
    const time = new Date(row.access_expires_at).getTime();
    return Number.isFinite(time) && time > Date.now();
  });
}

function hasLivePendingRow(rows: CityViewRequestRow[]): boolean {
  const latestResolvedTime = rows
    .filter((row) => row.status && row.status !== "pending")
    .reduce((max, row) => Math.max(max, getRowSortTime(row)), 0);

  return rows.some((row) => {
    if (row.status !== "pending") return false;
    const rowTime = getRowSortTime(row);
    if (latestResolvedTime <= 0) return rowTime > 0;
    return rowTime > latestResolvedTime;
  });
}

export async function POST(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { city?: unknown; province?: unknown; useWeeklyBenefit?: unknown } | null;
  const provinceRaw = typeof body?.province === "string" ? body.province.trim() : typeof body?.city === "string" ? body.city.trim() : "";
  const province = extractProvinceFromRegion(provinceRaw) ?? provinceRaw;
  const useWeeklyBenefit = body?.useWeeklyBenefit === true;

  if (!province || province.length < 2 || province.length > 20) {
    return NextResponse.json({ ok: false, message: "도/광역시명을 확인해주세요." }, { status: 400 });
  }

  const admin = createAdminClient();

  if (useWeeklyBenefit) {
    try {
      const granted = await claimCityViewWeeklyBenefit(admin, {
        userId: user.id,
        province,
      });

      return NextResponse.json({
        ok: true,
        status: "approved",
        province: granted.province,
        message: "오픈카드 유지 혜택으로 이번 주 무료 열람이 바로 열렸습니다.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "주간 무료 열람 처리에 실패했습니다.";
      const statusCode =
        message.includes("이미 사용") || message.includes("오픈카드를 유지") || message.includes("도/광역시명을 확인")
          ? 400
          : 500;
      return NextResponse.json({ ok: false, message }, { status: statusCode });
    }
  }

  const historyRes = await admin
    .from("dating_city_view_requests")
    .select("id,city,status,access_expires_at,reviewed_at,created_at")
    .eq("user_id", user.id)
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);

  if (Array.isArray(historyRes.data)) {
    const rows = (historyRes.data as CityViewRequestRow[]).filter((row) => getProvinceFromRow(row) === province);
    if (hasActiveApprovedRow(rows)) {
      return NextResponse.json({ ok: true, status: "approved", province });
    }

    if (hasLivePendingRow(rows)) {
      return NextResponse.json({ ok: true, status: "pending", province });
    }
  }

  const insertRes = await admin.from("dating_city_view_requests").insert({
    user_id: user.id,
    city: province,
    status: "pending",
  });

  if (insertRes.error) {
    return NextResponse.json({ ok: false, message: "신청 생성에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: "pending", province, message: "신청이 접수되었습니다." });
}
