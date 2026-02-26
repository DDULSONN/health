import { extractProvinceFromRegion } from "@/lib/region-city";
import type { createAdminClient } from "@/lib/supabase/server";

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function hasCityViewAccess(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  region: string | null
): Promise<boolean> {
  const province = extractProvinceFromRegion(region);
  if (!province) return false;

  const res = await adminClient
    .from("dating_city_view_requests")
    .select("id,access_expires_at")
    .eq("user_id", userId)
    .eq("city", province)
    .eq("status", "approved")
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);

  if (res.error || !Array.isArray(res.data)) return false;

  for (const row of res.data as Array<{ access_expires_at: string | null }>) {
    const expiresAtIso = normalizeIsoDate(row.access_expires_at);
    if (!expiresAtIso) continue;
    if (new Date(expiresAtIso).getTime() > Date.now()) return true;
  }

  return false;
}

export async function getActiveApprovedCities(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<string[]> {
  const res = await adminClient
    .from("dating_city_view_requests")
    .select("city,access_expires_at")
    .eq("user_id", userId)
    .eq("status", "approved")
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);

  if (res.error || !Array.isArray(res.data)) return [];

  const cities: string[] = [];
  for (const row of res.data as Array<{ city: string; access_expires_at: string | null }>) {
    const rawCity = typeof row.city === "string" ? row.city.trim() : "";
    const city = extractProvinceFromRegion(rawCity) ?? rawCity;
    if (!city || cities.includes(city)) continue;
    const expiresAtIso = normalizeIsoDate(row.access_expires_at);
    if (!expiresAtIso) continue;
    if (new Date(expiresAtIso).getTime() > Date.now()) {
      cities.push(city);
    }
  }

  return cities;
}
