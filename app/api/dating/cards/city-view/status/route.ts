import { extractProvinceFromRegion, PROVINCE_ORDER } from "@/lib/region-city";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type ProvinceStat = {
  province: string;
  total: number;
  male: number;
  female: number;
};

type ActiveCityDetail = {
  province: string;
  expiresAt: string;
};

type CityViewRequestRow = {
  city?: string;
  status?: string | null;
  access_expires_at?: string | null;
  reviewed_at?: string | null;
  created_at?: string | null;
};

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function getProvinceFromRow(row: CityViewRequestRow): string {
  const rawCity = typeof row.city === "string" ? row.city.trim() : "";
  return extractProvinceFromRegion(rawCity) ?? rawCity;
}

function getRowSortTime(row: CityViewRequestRow): number {
  const reviewed = normalizeIsoDate(row.reviewed_at);
  if (reviewed) return new Date(reviewed).getTime();
  const created = normalizeIsoDate(row.created_at);
  if (created) return new Date(created).getTime();
  return 0;
}

function hasActiveApprovedRow(rows: CityViewRequestRow[]): CityViewRequestRow | null {
  return (
    rows.find((row) => {
      if (row.status !== "approved") return false;
      const expiresAt = normalizeIsoDate(row.access_expires_at);
      if (!expiresAt) return false;
      return new Date(expiresAt).getTime() > Date.now();
    }) ?? null
  );
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

async function buildProvinceStats(admin: ReturnType<typeof createAdminClient>): Promise<ProvinceStat[]> {
  const pendingRes = await admin
    .from("dating_cards")
    .select("sex,region")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(10000);

  if (pendingRes.error || !Array.isArray(pendingRes.data)) return [];

  const map = new Map<string, ProvinceStat>();
  for (const row of pendingRes.data as Array<{ sex: string | null; region: string | null }>) {
    const province = extractProvinceFromRegion(row.region);
    if (!province) continue;
    const prev = map.get(province) ?? { province, total: 0, male: 0, female: 0 };
    prev.total += 1;
    if (row.sex === "male") prev.male += 1;
    if (row.sex === "female") prev.female += 1;
    map.set(province, prev);
  }

  const order = new Map<string, number>(PROVINCE_ORDER.map((name, idx) => [name, idx]));
  return [...map.values()].sort((a, b) => {
    const ai = order.get(a.province) ?? 999;
    const bi = order.get(b.province) ?? 999;
    if (ai !== bi) return ai - bi;
    return b.total - a.total;
  });
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  const admin = createAdminClient();
  const provinceStats = await buildProvinceStats(admin);

  if (!user) {
    return NextResponse.json({
      ok: true,
      loggedIn: false,
      activeCities: [],
      activeCityDetails: [],
      pendingCities: [],
      provinceStats,
    });
  }

  const historyRes = await admin
    .from("dating_city_view_requests")
    .select("city,status,access_expires_at,reviewed_at,created_at")
    .eq("user_id", user.id)
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);

  const activeCityDetails: ActiveCityDetail[] = [];
  const pendingCities: string[] = [];

  if (Array.isArray(historyRes.data)) {
    const byProvince = new Map<string, CityViewRequestRow[]>();
    for (const row of historyRes.data as CityViewRequestRow[]) {
      const province = getProvinceFromRow(row);
      if (!province) continue;
      const list = byProvince.get(province) ?? [];
      list.push(row);
      byProvince.set(province, list);
    }

    const order = new Map<string, number>(PROVINCE_ORDER.map((name, idx) => [name, idx]));
    for (const [province, rows] of byProvince.entries()) {
      const activeApproved = hasActiveApprovedRow(rows);

      if (activeApproved) {
        activeCityDetails.push({
          province,
          expiresAt: normalizeIsoDate(activeApproved.access_expires_at)!,
        });
        continue;
      }

      if (hasLivePendingRow(rows)) {
        pendingCities.push(province);
      }
    }

    activeCityDetails.sort((a, b) => (order.get(a.province) ?? 999) - (order.get(b.province) ?? 999));
    pendingCities.sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
  }

  return NextResponse.json({
    ok: true,
    loggedIn: true,
    activeCities: activeCityDetails.map((v) => v.province),
    activeCityDetails,
    pendingCities,
    provinceStats,
  });
}
