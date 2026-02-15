import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { BODYCHECK_SCORE_MAP, type BodycheckRating } from "@/lib/community";
import { getConfirmedUserOrResponse } from "@/lib/auth-confirmed";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteCtx) {
  const { id: postId } = await params;
  const supabase = await createClient();

  const guard = await getConfirmedUserOrResponse(supabase);
  if (guard.response) return guard.response;
  const user = guard.user;
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { rating } = (await request.json()) as { rating?: BodycheckRating };
  if (!rating || !(rating in BODYCHECK_SCORE_MAP)) {
    return NextResponse.json({ error: "평가 값이 올바르지 않습니다." }, { status: 400 });
  }
  const score = BODYCHECK_SCORE_MAP[rating];

  const { data: post, error: postErr } = await supabase
    .from("posts")
    .select("id, user_id, type")
    .eq("id", postId)
    .maybeSingle();

  if (postErr || !post) {
    return NextResponse.json({ error: "게시글을 찾을 수 없습니다." }, { status: 404 });
  }

  if (post.type !== "photo_bodycheck") {
    return NextResponse.json({ error: "사진 몸평 글만 평가할 수 있습니다." }, { status: 400 });
  }

  if (post.user_id === user.id) {
    return NextResponse.json({ error: "본인 글에는 평가할 수 없습니다." }, { status: 403 });
  }

  const { error: voteErr } = await supabase.from("bodycheck_votes").upsert(
    {
      post_id: postId,
      user_id: user.id,
      rating,
      score,
    },
    { onConflict: "post_id,user_id" }
  );

  if (voteErr) {
    console.error("[POST /api/posts/[id]/vote] upsert error:", voteErr.message);
    return NextResponse.json({ error: "투표 저장에 실패했습니다." }, { status: 500 });
  }

  const { error: rpcErr } = await supabase.rpc("recompute_photo_bodycheck_post_stats", {
    p_post_id: postId,
  });

  if (rpcErr) {
    console.error("[POST /api/posts/[id]/vote] rpc error:", rpcErr.message);
    return NextResponse.json({ error: "점수 반영에 실패했습니다." }, { status: 500 });
  }

  const { data: refreshed, error: refreshErr } = await supabase
    .from("posts")
    .select("score_sum, vote_count, great_count, good_count, normal_count, rookie_count")
    .eq("id", postId)
    .single();

  if (refreshErr) return NextResponse.json({ ok: true });

  const voteCount = Number(refreshed.vote_count ?? 0);
  const scoreSum = Number(refreshed.score_sum ?? 0);

  return NextResponse.json({
    ok: true,
    summary: {
      score_sum: scoreSum,
      vote_count: voteCount,
      great_count: Number(refreshed.great_count ?? 0),
      good_count: Number(refreshed.good_count ?? 0),
      normal_count: Number(refreshed.normal_count ?? 0),
      rookie_count: Number(refreshed.rookie_count ?? 0),
      average_score: voteCount ? Number((scoreSum / voteCount).toFixed(2)) : 0,
    },
  });
}
