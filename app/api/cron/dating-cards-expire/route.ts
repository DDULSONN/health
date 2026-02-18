import { createAdminClient } from "@/lib/supabase/server";
import { promotePendingCardsBySex } from "@/lib/dating-cards-queue";
import { NextResponse } from "next/server";

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return Boolean(request.headers.get("x-vercel-cron"));
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await adminClient
    .from("dating_cards")
    .update({ status: "expired" })
    .eq("status", "public")
    .lte("expires_at", nowIso)
    .select("id");

  if (error) {
    console.error("[GET /api/cron/dating-cards-expire] failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const promotedMale = await promotePendingCardsBySex(adminClient, "male").catch((e) => {
    console.error("[GET /api/cron/dating-cards-expire] promote male failed", e);
    return { sex: "male" as const, promotedIds: [], publicCount: 0 };
  });
  const promotedFemale = await promotePendingCardsBySex(adminClient, "female").catch((e) => {
    console.error("[GET /api/cron/dating-cards-expire] promote female failed", e);
    return { sex: "female" as const, promotedIds: [], publicCount: 0 };
  });

  return NextResponse.json({
    ok: true,
    expired_count: data?.length ?? 0,
    promoted: {
      male: promotedMale.promotedIds.length,
      female: promotedFemale.promotedIds.length,
    },
  });
}
