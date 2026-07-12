import { extractProvinceFromRegion } from "@/lib/region-city";
import type { createAdminClient } from "@/lib/supabase/server";

export const CITY_VIEW_CARD_LIMIT = 30;
export const CITY_VIEW_ACCESS_HOURS = 24;

export type DatingCityViewSex = "male" | "female";

type ActiveCityViewGrant = {
  requestId: string;
  province: string;
  accessExpiresAt: string;
  snapshotCardIds: string[];
};

export function getOppositeDatingSex(sex: string | null | undefined): DatingCityViewSex | null {
  if (sex === "male") return "female";
  if (sex === "female") return "male";
  return null;
}

export async function getUserOpenCardSex(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<DatingCityViewSex | null> {
  const res = await adminClient
    .from("dating_cards")
    .select("sex")
    .eq("owner_user_id", userId)
    .in("status", ["pending", "public", "hidden", "expired"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (res.error) return null;
  return res.data?.sex === "male" || res.data?.sex === "female" ? res.data.sex : null;
}

export async function getCityViewTargetSex(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<DatingCityViewSex | null> {
  return getOppositeDatingSex(await getUserOpenCardSex(adminClient, userId));
}

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseSnapshotCardIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("column");
}

export async function getActiveCityViewGrant(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  provinceInput: string
): Promise<ActiveCityViewGrant | null> {
  const province = extractProvinceFromRegion(provinceInput) ?? provinceInput.trim();
  if (!province) return null;

  const res = await adminClient
    .from("dating_city_view_requests")
    .select("id,city,access_expires_at,snapshot_card_ids,reviewed_at,created_at")
    .eq("user_id", userId)
    .eq("city", province)
    .eq("status", "approved")
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);

  if (res.error) {
    if (!isMissingColumnError(res.error)) return null;

    const legacyRes = await adminClient
      .from("dating_city_view_requests")
      .select("id,city,access_expires_at")
      .eq("user_id", userId)
      .eq("city", province)
      .eq("status", "approved")
      .order("reviewed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(10);

    if (legacyRes.error || !Array.isArray(legacyRes.data)) return null;
    for (const row of legacyRes.data as Array<{ id: string; city: string; access_expires_at: string | null }>) {
      const expiresAtIso = normalizeIsoDate(row.access_expires_at);
      if (!expiresAtIso || new Date(expiresAtIso).getTime() <= Date.now()) continue;
      return {
        requestId: row.id,
        province: extractProvinceFromRegion(row.city) ?? row.city,
        accessExpiresAt: expiresAtIso,
        snapshotCardIds: [],
      };
    }

    return null;
  }

  const rows = Array.isArray(res.data) ? res.data : [];
  for (const row of rows as Array<{ id: string; city: string; access_expires_at: string | null; snapshot_card_ids?: unknown }>) {
    const expiresAtIso = normalizeIsoDate(row.access_expires_at);
    if (!expiresAtIso || new Date(expiresAtIso).getTime() <= Date.now()) continue;
    return {
      requestId: row.id,
      province: extractProvinceFromRegion(row.city) ?? row.city,
      accessExpiresAt: expiresAtIso,
      snapshotCardIds: parseSnapshotCardIds(row.snapshot_card_ids),
    };
  }

  return null;
}

export async function hasCityViewAccess(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  region: string | null
): Promise<boolean> {
  const province = extractProvinceFromRegion(region);
  if (!province) return false;
  return Boolean(await getActiveCityViewGrant(adminClient, userId, province));
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
