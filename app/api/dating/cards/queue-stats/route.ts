import { OPEN_CARD_LIMIT_PER_SEX } from "@/lib/dating-open";
import { syncOpenCardQueue } from "@/lib/dating-cards-queue";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("could not find") || message.includes("column");
}

async function countPublic(adminClient: ReturnType<typeof createAdminClient>, sex: "male" | "female") {
  let { count, error } = await adminClient
    .from("dating_cards")
    .select("id", { head: true, count: "exact" })
    .eq("sex", sex)
    .eq("status", "public")
    .gt("expires_at", new Date().toISOString());

  if (error && isMissingColumnError(error)) {
    const legacy = await adminClient
      .from("dating_cards")
      .select("id", { head: true, count: "exact" })
      .eq("sex", sex)
      .eq("status", "public");
    count = legacy.count;
    error = legacy.error;
  }

  if (error) throw error;
  return count ?? 0;
}

async function countPending(adminClient: ReturnType<typeof createAdminClient>, sex: "male" | "female") {
  const { count, error } = await adminClient
    .from("dating_cards")
    .select("id", { head: true, count: "exact" })
    .eq("sex", sex)
    .eq("status", "pending");

  if (error) throw error;
  return count ?? 0;
}

async function countAcceptedMatches(adminClient: ReturnType<typeof createAdminClient>) {
  const { count, error } = await adminClient
    .from("dating_card_applications")
    .select("id", { head: true, count: "exact" })
    .eq("status", "accepted");

  if (error) throw error;
  return count ?? 0;
}

export async function GET() {
  const adminClient = createAdminClient();

  try {
    await syncOpenCardQueue(adminClient);

    const [malePublic, femalePublic, malePending, femalePending, acceptedMatches] = await Promise.all([
      countPublic(adminClient, "male"),
      countPublic(adminClient, "female"),
      countPending(adminClient, "male"),
      countPending(adminClient, "female"),
      countAcceptedMatches(adminClient),
    ]);

    return NextResponse.json({
      male: {
        public_count: malePublic,
        pending_count: malePending,
        slot_limit: OPEN_CARD_LIMIT_PER_SEX,
      },
      female: {
        public_count: femalePublic,
        pending_count: femalePending,
        slot_limit: OPEN_CARD_LIMIT_PER_SEX,
      },
      accepted_matches_count: acceptedMatches,
    });
  } catch (error) {
    console.error("[GET /api/dating/cards/queue-stats] failed", error);
    return NextResponse.json({ error: "대기열 정보를 불러오지 못했습니다." }, { status: 500 });
  }
}
