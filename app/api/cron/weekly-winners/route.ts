import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getPreviousKstWeekRange } from "@/lib/weekly";

type TopPost = {
  id: string;
  score_sum: number;
  vote_count: number;
};

async function fetchTopPost(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  gender: "male" | "female",
  weekStartIso: string,
  weekEndIso: string,
): Promise<TopPost | null> {
  const { data, error } = await supabase
    .from("posts")
    .select("id, score_sum, vote_count, created_at")
    .eq("type", "photo_bodycheck")
    .eq("is_hidden", false)
    .eq("is_deleted", false)
    .eq("gender", gender)
    .gte("created_at", weekStartIso)
    .lt("created_at", weekEndIso)
    .order("score_sum", { ascending: false })
    .order("vote_count", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return data;
}

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Boolean(request.headers.get("x-vercel-cron"));
  }

  const auth = request.headers.get("authorization");
  return auth === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const week = getPreviousKstWeekRange();
  const supabase = await createAdminClient();

  const { data: exists, error: existsError } = await supabase
    .from("weekly_winners")
    .select("id")
    .eq("week_start", week.startUtcIso)
    .maybeSingle();

  if (existsError) {
    return NextResponse.json({ error: existsError.message }, { status: 500 });
  }

  if (exists?.id) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      message: "already created",
      week_start: week.startUtcIso,
    });
  }

  try {
    const [maleTop, femaleTop] = await Promise.all([
      fetchTopPost(supabase, "male", week.startUtcIso, week.endUtcIso),
      fetchTopPost(supabase, "female", week.startUtcIso, week.endUtcIso),
    ]);

    const { error: insertError } = await supabase.from("weekly_winners").insert({
      week_start: week.startUtcIso,
      week_end: week.endUtcIso,
      male_post_id: maleTop?.id ?? null,
      female_post_id: femaleTop?.id ?? null,
      male_score: maleTop?.score_sum ?? 0,
      female_score: femaleTop?.score_sum ?? 0,
    });

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json({
          ok: true,
          skipped: true,
          message: "already exists by unique constraint",
          week_start: week.startUtcIso,
        });
      }
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      week_start: week.startUtcIso,
      week_end: week.endUtcIso,
      male_post_id: maleTop?.id ?? null,
      female_post_id: femaleTop?.id ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
