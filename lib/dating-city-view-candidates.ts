import { compareRegionsByDistance } from "@/lib/region-distance";
import type { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

export type CityViewCandidateRow = {
  id: string;
  owner_user_id: string | null;
  sex: string | null;
  region: string | null;
  expires_at: string | null;
  created_at: string | null;
  status: string | null;
};

const SELECT_COLUMNS =
  "id,owner_user_id,sex,region,expires_at,created_at,status";
const PAGE_SIZE = 1000;
const MAX_ROWS_PER_STATUS = 10000;

async function fetchStatusRows(
  admin: AdminClient,
  status: "pending" | "public",
  nowIso: string
): Promise<{ rows: CityViewCandidateRow[]; error: unknown | null }> {
  const rows: CityViewCandidateRow[] = [];

  for (let from = 0; from < MAX_ROWS_PER_STATUS; from += PAGE_SIZE) {
    let query = admin
      .from("dating_cards")
      .select(SELECT_COLUMNS)
      .eq("status", status)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (status === "public") {
      query = query.gt("expires_at", nowIso);
    }

    const result = await query;
    if (result.error) {
      return { rows, error: result.error };
    }

    const pageRows = Array.isArray(result.data) ? (result.data as CityViewCandidateRow[]) : [];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
  }

  return { rows, error: null };
}

export async function fetchCityViewCandidateRows(admin: AdminClient) {
  const nowIso = new Date().toISOString();
  const [pending, publicCards] = await Promise.all([
    fetchStatusRows(admin, "pending", nowIso),
    fetchStatusRows(admin, "public", nowIso),
  ]);

  if (pending.error && publicCards.error) {
    throw pending.error ?? publicCards.error;
  }

  const rowsById = new Map<string, CityViewCandidateRow>();
  for (const row of [...pending.rows, ...publicCards.rows]) {
    if (row.id) rowsById.set(row.id, row);
  }
  return [...rowsById.values()];
}

export function sortCityViewCandidates(
  rows: CityViewCandidateRow[],
  sourceRegion: string,
  previouslySeenIds: ReadonlySet<string> = new Set()
) {
  return [...rows].sort((a, b) => {
    const distanceGap = compareRegionsByDistance(sourceRegion, a.region, b.region);
    if (distanceGap !== 0) return distanceGap;

    const aSeen = previouslySeenIds.has(a.id);
    const bSeen = previouslySeenIds.has(b.id);
    if (aSeen !== bSeen) return aSeen ? 1 : -1;

    const createdGap = String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
    if (createdGap !== 0) return createdGap;
    return a.id.localeCompare(b.id);
  });
}
