import { getOpenCardLimitBySex } from "@/lib/dating-open";
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
  const requestId = crypto.randomUUID();

  try {
    await syncOpenCardQueue(adminClient);
  } catch (error) {
    console.error("[GET /api/dating/cards/queue-stats] queue sync failed", {
      requestId,
      error,
    });
  }

  const safeCount = async (label: string, fn: () => Promise<number>) => {
    try {
      return await fn();
    } catch (error) {
      console.error("[GET /api/dating/cards/queue-stats] count failed", { requestId, label, error });
      return 0;
    }
  };

  try {
    const [malePublic, femalePublic, malePending, femalePending, acceptedMatches] = await Promise.all([
      safeCount("malePublic", () => countPublic(adminClient, "male")),
      safeCount("femalePublic", () => countPublic(adminClient, "female")),
      safeCount("malePending", () => countPending(adminClient, "male")),
      safeCount("femalePending", () => countPending(adminClient, "female")),
      safeCount("acceptedMatches", () => countAcceptedMatches(adminClient)),
    ]);

    return NextResponse.json({
      male: {
        public_count: malePublic,
        pending_count: malePending,
        slot_limit: getOpenCardLimitBySex("male"),
      },
      female: {
        public_count: femalePublic,
        pending_count: femalePending,
        slot_limit: getOpenCardLimitBySex("female"),
      },
      accepted_matches_count: acceptedMatches,
    });
  } catch (error) {
    console.error("[GET /api/dating/cards/queue-stats] failed", { requestId, error });
    return NextResponse.json(
      {
        male: { public_count: 0, pending_count: 0, slot_limit: getOpenCardLimitBySex("male") },
        female: { public_count: 0, pending_count: 0, slot_limit: getOpenCardLimitBySex("female") },
        accepted_matches_count: 0,
      },
      { status: 200 }
    );
  }
}
