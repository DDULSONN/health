import { createClient } from "@/lib/supabase/server";
import { containsProfanity } from "@/lib/moderation";
import { BODYCHECK_SCORE_MAP, type BodycheckRating } from "@/lib/community";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { buildPublicLiteImageUrl, extractStorageObjectPath } from "@/lib/images";
import { NextResponse } from "next/server";
import { fetchUserCertSummaryMap } from "@/lib/cert-summary";

type RouteCtx = { params: Promise<{ id: string }> };

function toCommunityPublicPath(raw: unknown): string | null {
  return extractStorageObjectPath(raw, "community");
}

async function resolveCommunityImageUrl(
  _supabase: Awaited<ReturnType<typeof createClient>>,
  _requestId: string,
  raw: unknown,
  _counters: { signCalls: number; cacheHit: number; cacheMiss: number }
): Promise<string | null> {
  const path = toCommunityPublicPath(raw);
  if (path) return buildPublicLiteImageUrl("community", path);
  if (typeof raw === "string") {
    const value = raw.trim();
    if (value.startsWith("http://") || value.startsWith("https://")) {
      if (value.includes("supabase.co") || value.includes("/storage/v1/") || value.includes("/render/image/")) {
        return null;
      }
      return value;
    }
  }
  return null;
}

export async function GET(request: Request, { params }: RouteCtx) {
  const requestId = crypto.randomUUID();
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ip = extractClientIp(request);
  const rateLimit = await checkRouteRateLimit({
    requestId,
    scope: "posts-detail",
    userId: user?.id ?? null,
    ip,
    userLimitPerMin: 60,
    ipLimitPerMin: 240,
    path: "/api/posts/[id]",
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  }

  const { data: post, error: postErr } = await supabase
    .from("posts")
    .select("*")
    .eq("id", id)
    .single();

  if (postErr || !post) {
    if (postErr) console.error("[GET /api/posts/[id]]", postErr.message);
    return NextResponse.json(
      { error: "게시글을 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  const { data: authorProfile } = await supabase
    .from("profiles")
    .select("nickname, role")
    .eq("user_id", post.user_id)
    .single();

  const { data: comments } = await supabase
    .from("comments")
    .select("*")
    .eq("post_id", id)
    .eq("is_hidden", false)
    .order("created_at", { ascending: true });

  const commentUserIds = [
    ...new Set((comments ?? []).map((c) => c.user_id as string)),
  ];
  const commentProfileMap = new Map<string, { nickname: string }>();

  if (commentUserIds.length > 0) {
    const { data: commentProfiles } = await supabase
      .from("profiles")
      .select("user_id, nickname")
      .in("user_id", commentUserIds);

    for (const p of commentProfiles ?? []) {
      commentProfileMap.set(p.user_id, { nickname: p.nickname });
    }
  }

  const sortedComments = [...(comments ?? [])].sort((a, b) => {
    const aParent = (a.parent_id as string | null) ?? a.id;
    const bParent = (b.parent_id as string | null) ?? b.id;
    if (aParent !== bParent) {
      const aParentCreatedAt =
        (comments ?? []).find((c) => c.id === aParent)?.created_at ?? a.created_at;
      const bParentCreatedAt =
        (comments ?? []).find((c) => c.id === bParent)?.created_at ?? b.created_at;
      return (
        new Date(aParentCreatedAt).getTime() - new Date(bParentCreatedAt).getTime()
      );
    }
    if ((a.parent_id ? 1 : 0) !== (b.parent_id ? 1 : 0)) {
      return (a.parent_id ? 1 : 0) - (b.parent_id ? 1 : 0);
    }
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const certSummaryMap = await fetchUserCertSummaryMap(
    [post.user_id as string, ...commentUserIds],
    supabase
  );

  const enrichedComments = sortedComments.map((c) => ({
    ...c,
    profiles: commentProfileMap.get(c.user_id as string) ?? null,
    cert_summary: certSummaryMap.get(c.user_id as string) ?? null,
  }));

  let myVote: { rating: BodycheckRating; score: number } | null = null;
  if (post.type === "photo_bodycheck" && user) {
    const { data: vote } = await supabase
      .from("votes")
      .select("rating, value")
      .eq("post_id", id)
      .eq("voter_id", user.id)
      .maybeSingle();

    if (vote?.rating && vote.rating in BODYCHECK_SCORE_MAP) {
      myVote = {
        rating: vote.rating as BodycheckRating,
        score: vote.value ?? BODYCHECK_SCORE_MAP[vote.rating as BodycheckRating],
      };
    }
  }

  const voteCount = Number(post.vote_count ?? 0);
  const scoreSum = Number(post.score_sum ?? 0);
  const averageScore = voteCount > 0 ? Number((scoreSum / voteCount).toFixed(2)) : 0;
  const signCounters = { signCalls: 0, cacheHit: 0, cacheMiss: 0 };
  const normalizedImages = Array.isArray((post as { images?: unknown }).images)
    ? (
        await Promise.all(
          ((post as { images?: unknown[] }).images ?? []).map((img) =>
            resolveCommunityImageUrl(supabase, requestId, img, signCounters)
          )
        )
      ).filter((img): img is string => typeof img === "string")
    : [];
  console.log(
    `[posts.detail.signedUrl] requestId=${requestId} path=/api/posts/[id] postId=${id} signCalls=${signCounters.signCalls} cacheHit=${signCounters.cacheHit} cacheMiss=${signCounters.cacheMiss}`
  );

  return NextResponse.json({
    post: {
      ...post,
      images: normalizedImages,
      profiles: authorProfile ?? null,
      cert_summary: certSummaryMap.get(post.user_id as string) ?? null,
      my_vote: myVote,
      bodycheck_summary:
        post.type === "photo_bodycheck"
          ? {
              score_sum: scoreSum,
              vote_count: voteCount,
              great_count: Number(post.great_count ?? 0),
              good_count: Number(post.good_count ?? 0),
              normal_count: Number(post.normal_count ?? 0),
              rookie_count: Number(post.rookie_count ?? 0),
              average_score: averageScore,
            }
          : null,
    },
    comments: enrichedComments,
  });
}

export async function PATCH(request: Request, { params }: RouteCtx) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data: post } = await supabase
    .from("posts")
    .select("user_id, type")
    .eq("id", id)
    .single();

  if (!post) {
    return NextResponse.json({ error: "게시글을 찾을 수 없습니다." }, { status: 404 });
  }

  if (post.user_id !== user.id) {
    return NextResponse.json({ error: "본인 글만 수정할 수 있습니다." }, { status: 403 });
  }

  if (!["free", "photo_bodycheck"].includes(post.type)) {
    return NextResponse.json(
      { error: "기록 공유 글은 수정할 수 없습니다." },
      { status: 400 }
    );
  }

  const body = await request.json();
  const { title, content, images, gender } = body as {
    title?: string;
    content?: string;
    images?: unknown[];
    gender?: "male" | "female";
  };

  if (title !== undefined && !title.trim()) {
    return NextResponse.json({ error: "제목을 입력해주세요." }, { status: 400 });
  }

  if (
    (title && containsProfanity(title)) ||
    (content && containsProfanity(content))
  ) {
    return NextResponse.json({ error: "부적절한 표현이 포함되어 있습니다." }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (title !== undefined) updateData.title = title.trim();
  if (content !== undefined) updateData.content = content.trim() || null;

  if (images !== undefined) {
    const cleanImages = Array.isArray(images)
      ? images
          .map((u: unknown) => toCommunityPublicPath(u))
          .filter((u): u is string => typeof u === "string" && u.length > 0)
          .slice(0, 3)
      : [];

    if (post.type === "photo_bodycheck" && cleanImages.length < 1) {
      return NextResponse.json(
        { error: "사진 몸평 글은 최소 1장의 사진이 필요합니다." },
        { status: 400 }
      );
    }
    updateData.images = cleanImages;
  }

  if (post.type === "photo_bodycheck" && gender !== undefined) {
    if (!["male", "female"].includes(gender)) {
      return NextResponse.json({ error: "성별 값이 올바르지 않습니다." }, { status: 400 });
    }
    updateData.gender = gender;
  }

  const { error } = await supabase
    .from("posts")
    .update(updateData)
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("[PATCH /api/posts/[id]]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: RouteCtx) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data: post } = await supabase
    .from("posts")
    .select("*")
    .eq("id", id)
    .single();

  if (!post) {
    return NextResponse.json({ error: "게시글을 찾을 수 없습니다." }, { status: 404 });
  }

  if (post.user_id !== user.id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "본인 글만 삭제할 수 있습니다." }, { status: 403 });
    }
  }

  const { error: logErr } = await supabase.from("deleted_logs").insert({
    post_id: post.id,
    user_id: user.id,
    title_snapshot: post.title,
    content_snapshot: post.content,
    payload_snapshot: post.payload_json,
  });

  if (logErr) {
    console.error("[DELETE /api/posts/[id]] log error:", logErr.message);
  }

  const { error } = await supabase
    .from("posts")
    .update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: user.id,
    })
    .eq("id", id);

  if (error) {
    console.error("[DELETE /api/posts/[id]]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
