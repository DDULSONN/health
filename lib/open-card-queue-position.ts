import type { createAdminClient } from "@/lib/supabase/server";

export async function getPendingQueuePosition(
  adminClient: ReturnType<typeof createAdminClient>,
  sex: "male" | "female",
  createdAt: string,
  cardId: string
): Promise<number | null> {
  const pending = () => adminClient.from("dating_cards");
  const anchor = await pending().select("queue_priority_at,created_at").eq("id", cardId)
    .eq("sex", sex).eq("status", "pending").maybeSingle();
  if (anchor.error && anchor.error.code !== "42703") return null;
  if (!anchor.error && !anchor.data) return null;

  // Values come from database timestamp/UUID columns, never from the request.
  const time = anchor.data?.created_at ?? createdAt;
  const priority = anchor.data?.queue_priority_at;
  if (!time || (!anchor.error && !priority)) return null;
  const throughCard = `and(created_at.eq.${time},id.lte.${cardId})`;
  const rankedThroughCard = priority
    ? `queue_priority_at.lt.${priority},and(queue_priority_at.eq.${priority},or(created_at.lt.${time},${throughCard}))`
    : `created_at.lt.${time},${throughCard}`;
  // Count using the same (priority, created_at, id) order as publication;
  // no list of other members' IDs or PostgREST page-size cap.
  const { count, error } = await pending().select("id", { head: true, count: "exact" })
    .eq("sex", sex).eq("status", "pending").or(rankedThroughCard);
  return !error && typeof count === "number" && count > 0 ? count : null;
}
