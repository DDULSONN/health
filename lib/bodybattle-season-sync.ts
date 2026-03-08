import type { SupabaseClient } from "@supabase/supabase-js";

type SeasonRow = {
  id: string;
  status: "draft" | "active" | "closed";
  end_at: string;
};

type SyncOptions = {
  lookbackSeasons?: number;
};

type SyncResult = {
  ensured: unknown;
  finalized_due: unknown;
  healed_count: number;
  healed_season_ids: string[];
  heal_errors: string[];
};

export async function runBodyBattleSeasonSync(
  admin: SupabaseClient,
  options: SyncOptions = {}
): Promise<{ ok: true; data: SyncResult } | { ok: false; message: string }> {
  const lookbackSeasons = Math.max(10, Math.min(200, Math.floor(options.lookbackSeasons ?? 60)));

  const ensureRes = await admin.rpc("bodybattle_ensure_current_season");
  if (ensureRes.error) {
    return { ok: false, message: `ensure_current_season failed: ${ensureRes.error.message}` };
  }

  const finalizeDueRes = await admin.rpc("bodybattle_finalize_due_seasons");
  if (finalizeDueRes.error) {
    return { ok: false, message: `finalize_due_seasons failed: ${finalizeDueRes.error.message}` };
  }

  const nowIso = new Date().toISOString();
  const endedRes = await admin
    .from("bodybattle_seasons")
    .select("id,status,end_at")
    .lte("end_at", nowIso)
    .order("end_at", { ascending: false })
    .limit(lookbackSeasons);
  if (endedRes.error) {
    return { ok: false, message: `load ended seasons failed: ${endedRes.error.message}` };
  }

  const ended = (endedRes.data ?? []) as SeasonRow[];
  if (ended.length === 0) {
    return {
      ok: true,
      data: {
        ensured: ensureRes.data ?? null,
        finalized_due: finalizeDueRes.data ?? null,
        healed_count: 0,
        healed_season_ids: [],
        heal_errors: [],
      },
    };
  }

  const seasonIds = ended.map((season) => season.id);
  const [resultRows, hofRows] = await Promise.all([
    admin.from("bodybattle_season_results").select("season_id").in("season_id", seasonIds),
    admin.from("bodybattle_hall_of_fame").select("season_id").in("season_id", seasonIds),
  ]);
  if (resultRows.error) {
    return { ok: false, message: `load season_results failed: ${resultRows.error.message}` };
  }
  if (hofRows.error) {
    return { ok: false, message: `load hall_of_fame failed: ${hofRows.error.message}` };
  }

  const resultSet = new Set((resultRows.data ?? []).map((row) => String(row.season_id)));
  const hofSet = new Set((hofRows.data ?? []).map((row) => String(row.season_id)));

  const needsHeal = ended
    .filter((season) => !resultSet.has(season.id) || !hofSet.has(season.id))
    .sort((a, b) => new Date(a.end_at).getTime() - new Date(b.end_at).getTime());

  const healedSeasonIds: string[] = [];
  const healErrors: string[] = [];

  for (const season of needsHeal) {
    const finalizeRes = await admin.rpc("bodybattle_finalize_season", { p_season_id: season.id });
    if (finalizeRes.error) {
      healErrors.push(`${season.id}: ${finalizeRes.error.message}`);
      continue;
    }
    healedSeasonIds.push(season.id);
  }

  return {
    ok: true,
    data: {
      ensured: ensureRes.data ?? null,
      finalized_due: finalizeDueRes.data ?? null,
      healed_count: healedSeasonIds.length,
      healed_season_ids: healedSeasonIds,
      heal_errors: healErrors,
    },
  };
}

