import { createAdminClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEARCH_RESULT_LIMIT = 100;

type SearchRow = {
  id?: string | null;
  user_id?: string | null;
};

export type OneOnOneAdminSearchTargets = {
  query: string;
  orFilter: string | null;
  matched: boolean;
};

function uniqueIds(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(UUID_PATTERN.test.bind(UUID_PATTERN)))];
}

function buildOrFilter(exactId: string | null, cardIds: string[], userIds: string[]) {
  const filters: string[] = [];
  if (exactId) {
    filters.push(
      `id.eq.${exactId}`,
      `source_card_id.eq.${exactId}`,
      `candidate_card_id.eq.${exactId}`,
      `source_user_id.eq.${exactId}`,
      `candidate_user_id.eq.${exactId}`
    );
  }
  if (cardIds.length > 0) {
    const values = cardIds.join(",");
    filters.push(`source_card_id.in.(${values})`, `candidate_card_id.in.(${values})`);
  }
  if (userIds.length > 0) {
    const values = userIds.join(",");
    filters.push(`source_user_id.in.(${values})`, `candidate_user_id.in.(${values})`);
  }
  return filters.length > 0 ? filters.join(",") : null;
}

export async function resolveOneOnOneAdminSearchTargets(
  admin: ReturnType<typeof createAdminClient>,
  rawQuery: string
): Promise<OneOnOneAdminSearchTargets> {
  const query = rawQuery.trim().slice(0, 80);
  if (!query) {
    return { query: "", orFilter: null, matched: true };
  }

  const exactId = UUID_PATTERN.test(query) ? query.toLowerCase() : null;
  const escapedQuery = query.replace(/[\\%_]/g, "\\$&");
  const pattern = `%${escapedQuery}%`;
  const digits = query.replace(/\D/g, "");

  const cardQueries = [
    admin.from("dating_1on1_cards").select("id,user_id").ilike("name", pattern).limit(SEARCH_RESULT_LIMIT),
    admin.from("dating_1on1_cards").select("id,user_id").ilike("region", pattern).limit(SEARCH_RESULT_LIMIT),
  ];
  if (digits.length >= 4) {
    cardQueries.push(
      admin.from("dating_1on1_cards").select("id,user_id").ilike("phone", `%${digits}%`).limit(SEARCH_RESULT_LIMIT)
    );
  }

  const [cardResults, profileResult] = await Promise.all([
    Promise.all(cardQueries),
    admin.from("profiles").select("user_id").ilike("nickname", pattern).limit(SEARCH_RESULT_LIMIT),
  ]);

  const searchError = cardResults.find((result) => result.error)?.error ?? profileResult.error;
  if (searchError) throw searchError;

  const cardRows = cardResults.flatMap((result) => (result.data ?? []) as SearchRow[]);
  const profileRows = (profileResult.data ?? []) as SearchRow[];
  const cardIds = uniqueIds(cardRows.map((row) => row.id)).slice(0, SEARCH_RESULT_LIMIT);
  const userIds = uniqueIds([
    ...cardRows.map((row) => row.user_id),
    ...profileRows.map((row) => row.user_id),
  ]).slice(0, SEARCH_RESULT_LIMIT);
  const orFilter = buildOrFilter(exactId, cardIds, userIds);

  return {
    query,
    orFilter,
    matched: Boolean(orFilter),
  };
}
