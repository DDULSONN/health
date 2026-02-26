import { extractProvinceFromRegion, PROVINCE_ORDER } from "@/lib/region-city";
import { createAdminClient, createClient } from "@/lib/supabase/server";
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

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
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

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  const [approvedRes, pendingRes] = await Promise.all([
    admin
      .from("dating_city_view_requests")
      .select("city,access_expires_at")
      .eq("user_id", user.id)
      .eq("status", "approved")
      .order("reviewed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("dating_city_view_requests")
      .select("city")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const activeCityDetails: ActiveCityDetail[] = [];
  if (Array.isArray(approvedRes.data)) {
    const byProvince = new Map<string, string>();
    for (const row of approvedRes.data as Array<{ city?: string; access_expires_at?: string | null }>) {
      const province = extractProvinceFromRegion(String(row.city ?? "").trim()) ?? String(row.city ?? "").trim();
      const expiresAt = normalizeIsoDate(row.access_expires_at);
      if (!province || !expiresAt) continue;
      if (new Date(expiresAt).getTime() <= Date.now()) continue;
      const prev = byProvince.get(province);
      if (!prev || new Date(expiresAt).getTime() > new Date(prev).getTime()) {
        byProvince.set(province, expiresAt);
      }
    }
    const order = new Map<string, number>(PROVINCE_ORDER.map((name, idx) => [name, idx]));
    activeCityDetails.push(
      ...[...byProvince.entries()]
        .map(([province, expiresAt]) => ({ province, expiresAt }))
        .sort((a, b) => (order.get(a.province) ?? 999) - (order.get(b.province) ?? 999))
    );
  }
  const activeCities = activeCityDetails.map((v) => v.province);

  const pendingCities = Array.isArray(pendingRes.data)
    ? [
        ...new Set(
          pendingRes.data
            .map((row: { city?: string }) => extractProvinceFromRegion(String(row.city ?? "").trim()) ?? String(row.city ?? "").trim())
            .filter(Boolean)
        ),
      ]
    : [];

  return NextResponse.json({
    ok: true,
    loggedIn: true,
    activeCities,
    activeCityDetails,
    pendingCities,
    provinceStats,
  });
}
