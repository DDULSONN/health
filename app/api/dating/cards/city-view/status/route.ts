import { extractProvinceFromRegion } from "@/lib/region-city";
import { getActiveApprovedCities } from "@/lib/dating-city-view";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type ProvinceStat = {
  province: string;
  total: number;
  male: number;
  female: number;
};

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

  return [...map.values()].sort((a, b) => b.total - a.total || a.province.localeCompare(b.province, "ko"));
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const provinceStats = await buildProvinceStats(admin);

  if (!user) {
    return NextResponse.json({ ok: true, loggedIn: false, activeCities: [], pendingCities: [], provinceStats });
  }

  const [activeCities, pendingRes] = await Promise.all([
    getActiveApprovedCities(admin, user.id),
    admin
      .from("dating_city_view_requests")
      .select("city")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const pendingCities = Array.isArray(pendingRes.data)
    ? [...new Set(pendingRes.data.map((row: { city?: string }) => String(row.city ?? "").trim()).filter(Boolean))]
    : [];

  return NextResponse.json({
    ok: true,
    loggedIn: true,
    activeCities,
    pendingCities,
    provinceStats,
  });
}