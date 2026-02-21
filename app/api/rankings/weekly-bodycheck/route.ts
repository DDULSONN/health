import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getKstWeekId } from "@/lib/weekly";
import type { BodycheckGender } from "@/lib/community";
import { buildSignedImageUrl, extractStorageObjectPath } from "@/lib/images";

const MIN_VOTES = 5;

type WeeklyRow = {
  post_id: string;
  score_sum: number;
  vote_count: number;
  score_avg: number;
  posts:
    | {
        id: string;
        title: string;
        user_id: string;
        images: string[] | null;
        created_at: string;
      }
    | {
        id: string;
        title: string;
        user_id: string;
        images: string[] | null;
        created_at: string;
      }[]
    | null;
};

function getPost(row: WeeklyRow) {
  if (!row.posts) return null;
  return Array.isArray(row.posts) ? row.posts[0] : row.posts;
}

function normalizeCommunityImages(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const path = extractStorageObjectPath(item, "community");
      if (!path) return "";
      return buildSignedImageUrl("community", path);
    })
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .slice(0, 3);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const gender = url.searchParams.get("gender") as BodycheckGender | null;
  const top = Math.max(1, Math.min(20, Number(url.searchParams.get("top") ?? 3)));

  if (gender !== "male" && gender !== "female") {
    return NextResponse.json({ error: "gender=male 또는 gender=female 이 필요합니다." }, { status: 400 });
  }

  const weekId = getKstWeekId();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("post_score_weekly")
    .select("post_id, score_sum, vote_count, score_avg, posts!inner(id, title, user_id, images, created_at)")
    .eq("week_id", weekId)
    .eq("gender", gender)
    .gte("vote_count", MIN_VOTES)
    .order("score_sum", { ascending: false })
    .order("score_avg", { ascending: false })
    .order("vote_count", { ascending: false })
    .order("updated_at", { ascending: true })
    .limit(top);

  if (error) {
    console.error("[GET /api/rankings/weekly-bodycheck]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as WeeklyRow[];
  const userIds = [...new Set(rows.map((row) => getPost(row)?.user_id).filter(Boolean) as string[])];
  const profileMap = new Map<string, { nickname: string }>();

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, nickname")
      .in("user_id", userIds);

    for (const profile of profiles ?? []) {
      profileMap.set(profile.user_id, { nickname: profile.nickname });
    }
  }

  return NextResponse.json({
    week_id: weekId,
    min_votes: MIN_VOTES,
    gender,
    items: rows.map((row) => {
      const post = getPost(row);
      return {
        post_id: row.post_id,
        title: post?.title ?? "",
        user_id: post?.user_id ?? "",
        images: normalizeCommunityImages(post?.images ?? []),
        created_at: post?.created_at ?? null,
        score_sum: Number(row.score_sum ?? 0),
        vote_count: Number(row.vote_count ?? 0),
        score_avg: Number(Number(row.score_avg ?? 0).toFixed(2)),
        profiles: post?.user_id ? profileMap.get(post.user_id) ?? null : null,
      };
    }),
  });
}
