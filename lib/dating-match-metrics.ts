import { createAdminClient } from "@/lib/supabase/server";

const PAGE_SIZE = 1000;

type AdminClient = ReturnType<typeof createAdminClient>;
type MatchKind = "open_card" | "swipe";

type IdRow = {
  id?: string | null;
};

type NotificationMetaRow = {
  meta_json?: Record<string, unknown> | null;
};

type TimestampRow = {
  created_at?: string | null;
};

function isMissingSchemaError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("relation") ||
    message.includes("column")
  );
}

async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const page = await fetchPage(from, to);
    if (page.error) {
      if (isMissingSchemaError(page.error)) return [];
      throw page.error;
    }

    const rows = page.data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return all;
}

async function countEventRowsByKind(adminClient: AdminClient, kind: MatchKind): Promise<number | null> {
  const result = await adminClient
    .from("dating_match_events")
    .select("id", { head: true, count: "exact" })
    .eq("kind", kind);

  if (result.error) {
    if (isMissingSchemaError(result.error)) return null;
    throw result.error;
  }

  return result.count ?? 0;
}

export async function recordDatingMatchEvent(
  adminClient: AdminClient,
  params: {
    kind: MatchKind;
    sourceKey: string;
    createdAt?: string | null;
    metaJson?: Record<string, unknown>;
  }
) {
  const sourceKey = params.sourceKey.trim();
  if (!sourceKey) return false;

  const result = await adminClient
    .from("dating_match_events")
    .upsert(
      {
        event_key: `${params.kind}:${sourceKey}`,
        kind: params.kind,
        source_key: sourceKey,
        meta_json: params.metaJson ?? {},
        created_at: params.createdAt ?? new Date().toISOString(),
      },
      { onConflict: "event_key", ignoreDuplicates: true }
    );

  if (result.error) {
    if (isMissingSchemaError(result.error)) return false;
    throw result.error;
  }

  return true;
}

export async function countCumulativeOpenCardMatches(adminClient: AdminClient): Promise<number> {
  const eventCount = await countEventRowsByKind(adminClient, "open_card");
  if (eventCount !== null) return eventCount;

  const [acceptedApplicationRows, acceptedNotificationRows] = await Promise.all([
    fetchAllRows<IdRow>(async (from, to) =>
      await adminClient
        .from("dating_card_applications")
        .select("id")
        .eq("status", "accepted")
        .range(from, to)
    ),
    fetchAllRows<NotificationMetaRow>(async (from, to) =>
      await adminClient
        .from("notifications")
        .select("meta_json")
        .eq("type", "dating_application_accepted")
        .range(from, to)
    ),
  ]);

  const ids = new Set<string>();

  for (const row of acceptedApplicationRows) {
    const id = String(row.id ?? "").trim();
    if (id) ids.add(id);
  }

  for (const row of acceptedNotificationRows) {
    const applicationId = String(row.meta_json?.application_id ?? "").trim();
    if (applicationId) ids.add(applicationId);
  }

  return ids.size;
}

export async function countCumulativeSwipeMatches(adminClient: AdminClient): Promise<number> {
  const eventCount = await countEventRowsByKind(adminClient, "swipe");
  if (eventCount !== null) return eventCount;

  const result = await adminClient
    .from("dating_card_swipe_matches")
    .select("id", { head: true, count: "exact" });

  if (result.error) {
    if (isMissingSchemaError(result.error)) return 0;
    throw result.error;
  }

  return result.count ?? 0;
}

export async function countCumulativeTotalDatingMatches(adminClient: AdminClient): Promise<number> {
  const [openCardMatches, swipeMatches] = await Promise.all([
    countCumulativeOpenCardMatches(adminClient),
    countCumulativeSwipeMatches(adminClient),
  ]);

  return openCardMatches + swipeMatches;
}

export async function fetchRecentSwipeMatchTimestampRows(
  adminClient: AdminClient,
  sinceIso: string
): Promise<TimestampRow[]> {
  const eventRows = await fetchAllRows<TimestampRow>(async (from, to) =>
    await adminClient
      .from("dating_match_events")
      .select("created_at")
      .eq("kind", "swipe")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .range(from, to)
  );

  if (eventRows.length > 0) {
    return eventRows;
  }

  return fetchAllRows<TimestampRow>(async (from, to) =>
    await adminClient
      .from("dating_card_swipe_matches")
      .select("created_at")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .range(from, to)
  );
}
