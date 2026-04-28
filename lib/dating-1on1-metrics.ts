import type { SupabaseClient } from "@supabase/supabase-js";

type MetricEventKind = "application_created" | "mutual_match_created";

function isMissingTableError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes("does not exist") || message.includes("relation");
}

async function fetchMetricEventCount(
  adminClient: SupabaseClient,
  kind: MetricEventKind
) {
  const res = await adminClient
    .from("dating_1on1_metric_events")
    .select("id", { count: "exact", head: true })
    .eq("event_kind", kind);

  if (res.error) {
    throw res.error;
  }
  return Number(res.count ?? 0);
}

export async function countCumulativeOneOnOneApplicants(adminClient: SupabaseClient) {
  try {
    return await fetchMetricEventCount(adminClient, "application_created");
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.error("[dating-1on1-metrics] applicant metric count failed", error);
    }
    const fallback = await adminClient.from("dating_1on1_cards").select("id", { count: "exact", head: true });
    if (fallback.error) {
      throw fallback.error;
    }
    return Number(fallback.count ?? 0);
  }
}

export async function countCumulativeOneOnOneMatches(adminClient: SupabaseClient) {
  try {
    return await fetchMetricEventCount(adminClient, "mutual_match_created");
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.error("[dating-1on1-metrics] match metric count failed", error);
    }
    const fallback = await adminClient
      .from("dating_1on1_match_proposals")
      .select("id", { count: "exact", head: true })
      .eq("state", "mutual_accepted");
    if (fallback.error) {
      throw fallback.error;
    }
    return Number(fallback.count ?? 0);
  }
}

export async function recordOneOnOneMetricEvent(
  adminClient: SupabaseClient,
  input:
    | {
        eventKind: "application_created";
        cardId: string;
        userId: string;
        occurredAt?: string | null;
      }
    | {
        eventKind: "mutual_match_created";
        matchId: string;
        sourceCardId: string;
        sourceUserId: string;
        occurredAt?: string | null;
      }
) {
  const row =
    input.eventKind === "application_created"
      ? {
          event_kind: input.eventKind,
          card_id: input.cardId,
          user_id: input.userId,
          occurred_at: input.occurredAt ?? new Date().toISOString(),
        }
      : {
          event_kind: input.eventKind,
          match_id: input.matchId,
          card_id: input.sourceCardId,
          user_id: input.sourceUserId,
          occurred_at: input.occurredAt ?? new Date().toISOString(),
        };

  const res = await adminClient.from("dating_1on1_metric_events").insert(row);

  if (!res.error) return;
  if (isMissingTableError(res.error)) return;
  if (String((res.error as { code?: unknown }).code ?? "") === "23505") {
    return;
  }
  throw res.error;
}
