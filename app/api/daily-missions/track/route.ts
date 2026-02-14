import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getKstDateString } from "@/lib/weekly";

type MissionAction = "view_bodycheck" | "comment_created" | "did_1rm_calc";

function buildMissions(stats: {
  viewed_bodycheck_count: number;
  comments_count: number;
  did_1rm_calc: boolean;
}) {
  const mission1 = stats.viewed_bodycheck_count > 0;
  const mission2 = stats.comments_count > 0;
  const mission3 = stats.did_1rm_calc;
  const completed = Number(mission1) + Number(mission2) + Number(mission3);
  return {
    completed,
    total: 3,
    completed_all: completed === 3,
  };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { action?: MissionAction };
  const action = body.action;
  if (!action || !["view_bodycheck", "comment_created", "did_1rm_calc"].includes(action)) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }

  const dateKst = getKstDateString();

  const { data: row, error: selectError } = await supabase
    .from("user_daily_stats")
    .select("viewed_bodycheck_count, comments_count, did_1rm_calc")
    .eq("user_id", user.id)
    .eq("date_kst", dateKst)
    .maybeSingle();

  if (selectError) {
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  const current = {
    viewed_bodycheck_count: Number(row?.viewed_bodycheck_count ?? 0),
    comments_count: Number(row?.comments_count ?? 0),
    did_1rm_calc: Boolean(row?.did_1rm_calc ?? false),
  };
  const before = buildMissions(current);

  const next = { ...current };
  if (action === "view_bodycheck") {
    next.viewed_bodycheck_count = Math.max(1, next.viewed_bodycheck_count);
  } else if (action === "comment_created") {
    next.comments_count += 1;
  } else if (action === "did_1rm_calc") {
    next.did_1rm_calc = true;
  }

  const { error: upsertError } = await supabase.from("user_daily_stats").upsert(
    {
      user_id: user.id,
      date_kst: dateKst,
      viewed_bodycheck_count: next.viewed_bodycheck_count,
      comments_count: next.comments_count,
      did_1rm_calc: next.did_1rm_calc,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,date_kst" },
  );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  const after = buildMissions(next);
  return NextResponse.json({
    ok: true,
    date_kst: dateKst,
    stats: next,
    missions: after,
    newly_completed_all: !before.completed_all && after.completed_all,
  });
}
