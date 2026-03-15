import { NextResponse } from "next/server";
import { buildSignedImageUrl, extractStorageObjectPath } from "@/lib/images";
import { createClient } from "@/lib/supabase/server";
import { getKstWeekId, getKstWeekRange } from "@/lib/weekly";

type HomeVotePost = {
  id: string;
  title: string;
  content: string | null;
  created_at: string;
  gender: "male" | "female" | null;
  score_sum: number;
  vote_count: number;
  image_url: string | null;
  nickname: string | null;
};

function shuffle<T>(items: T[]): T[] {
  const clone = [...items];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex] as T, clone[index] as T];
  }
  return clone;
}

function toCommunityPublicPath(raw: unknown): string | null {
  return extractStorageObjectPath(raw, "community");
}

function resolveImageUrl(raw: unknown): string | null {
  const path = toCommunityPublicPath(raw);
  if (path) return buildSignedImageUrl("community", path);
  if (typeof raw === "string") {
    const value = raw.trim();
    if (value.startsWith("http://") || value.startsWith("https://")) return value;
  }
  return null;
}

function extractThumbImages(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const raw = (payload as { thumb_images?: unknown }).thumb_images;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 3);
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const currentWeek = getKstWeekRange();
  const weekId = getKstWeekId();

  const { data: posts, error } = await supabase
    .from("posts")
    .select("id, user_id, title, content, created_at, gender, score_sum, vote_count, images, payload_json")
    .eq("type", "photo_bodycheck")
    .eq("is_hidden", false)
    .eq("is_deleted", false)
    .gte("created_at", currentWeek.startUtcIso)
    .lt("created_at", currentWeek.endUtcIso)
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const allPosts = posts ?? [];
  const postIds = allPosts.map((post) => post.id);
  const profileUserIds = [...new Set(allPosts.map((post) => post.user_id))];

  const [{ data: profiles }, votedResult] = await Promise.all([
    profileUserIds.length
      ? supabase.from("profiles").select("user_id, nickname").in("user_id", profileUserIds)
      : Promise.resolve({ data: [] as { user_id: string; nickname: string | null }[] }),
    user && postIds.length
      ? supabase.from("votes").select("post_id").eq("voter_id", user.id).in("post_id", postIds)
      : Promise.resolve({ data: [] as { post_id: string }[] }),
  ]);

  const profileMap = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.nickname]));
  const votedPostIds = new Set((votedResult.data ?? []).map((vote) => vote.post_id));

  const available = allPosts.filter((post) => {
    if (user?.id && post.user_id === user.id) return false;
    if (votedPostIds.has(post.id)) return false;
    return true;
  });

  const items: HomeVotePost[] = shuffle(available)
    .slice(0, 12)
    .map((post) => {
      const imageCandidates = [
        ...extractThumbImages(post.payload_json),
        ...((Array.isArray(post.images) ? post.images : []) as unknown[]),
      ];

      return {
        id: post.id,
        title: post.title,
        content: post.content,
        created_at: post.created_at,
        gender: post.gender,
        score_sum: Number(post.score_sum ?? 0),
        vote_count: Number(post.vote_count ?? 0),
        image_url:
          imageCandidates.map((candidate) => resolveImageUrl(candidate)).find((value) => typeof value === "string") ??
          null,
        nickname: profileMap.get(post.user_id) ?? null,
      };
    });

  return NextResponse.json({
    ok: true,
    authenticated: Boolean(user),
    week_id: weekId,
    items,
    message:
      items.length > 0
        ? null
        : user
        ? "이번 주에 아직 평가할 몸평 글이 없거나, 이미 모두 평가했어요."
        : "이번 주 몸평 글이 아직 충분히 모이지 않았어요.",
  });
}
