import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getKstDateString } from "@/lib/weekly";

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
    items: [
      { key: "view_bodycheck", label: "몸평 게시글 1개 보기", done: mission1 },
      { key: "write_comment", label: "댓글 1개 남기기", done: mission2 },
      { key: "calc_1rm", label: "1RM 계산하기", done: mission3 },
    ],
    completed,
    total: 3,
    completed_all: completed === 3,
  };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dateKst = getKstDateString();
  const { data, error } = await supabase
    .from("user_daily_stats")
    .select("viewed_bodycheck_count, comments_count, did_1rm_calc")
    .eq("user_id", user.id)
    .eq("date_kst", dateKst)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const base = {
    viewed_bodycheck_count: Number(data?.viewed_bodycheck_count ?? 0),
    comments_count: Number(data?.comments_count ?? 0),
    did_1rm_calc: Boolean(data?.did_1rm_calc ?? false),
  };

  return NextResponse.json({
    date_kst: dateKst,
    stats: base,
    missions: buildMissions(base),
  });
}
