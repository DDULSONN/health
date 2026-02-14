import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { BodycheckGender } from "@/lib/community";
import { getKstWeekRange } from "@/lib/weekly";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const gender = searchParams.get("gender") as BodycheckGender | null;
  const top = Math.max(1, Math.min(50, Number(searchParams.get("top") ?? 1)));

  if (gender !== "male" && gender !== "female") {
    return NextResponse.json(
      { error: "gender=male 또는 gender=female 이 필요합니다." },
      { status: 400 }
    );
  }

  const { startUtcIso, endUtcIso } = getKstWeekRange();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("posts")
    .select("id, title, images, user_id, gender, score_sum, vote_count, created_at")
    .eq("type", "photo_bodycheck")
    .eq("is_hidden", false)
    .eq("is_deleted", false)
    .eq("gender", gender)
    .gte("created_at", startUtcIso)
    .lt("created_at", endUtcIso)
    .order("score_sum", { ascending: false })
    .order("vote_count", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(top);

  if (error) {
    console.error("[GET /api/rankings/weekly-bodycheck]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const userIds = [...new Set((data ?? []).map((v) => v.user_id as string))];
  const profileMap = new Map<string, { nickname: string }>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, nickname")
      .in("user_id", userIds);

    for (const p of profiles ?? []) {
      profileMap.set(p.user_id, { nickname: p.nickname });
    }
  }

  return NextResponse.json({
    items: (data ?? []).map((item) => ({
      ...item,
      average_score: item.vote_count ? Number((item.score_sum / item.vote_count).toFixed(2)) : 0,
      profiles: profileMap.get(item.user_id as string) ?? null,
    })),
    range: {
      start_utc: startUtcIso,
      end_utc: endUtcIso,
    },
  });
}
