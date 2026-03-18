import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getConfirmedActiveUserOrResponse } from "@/lib/auth-active";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";

type RouteCtx = { params: Promise<{ id: string }> };
type ReactionType = "up" | "down";

function isReaction(value: unknown): value is ReactionType {
  return value === "up" || value === "down";
}

export async function POST(request: Request, { params }: RouteCtx) {
  const originResponse = ensureAllowedMutationOrigin(request);
  if (originResponse) return originResponse;

  const { id: postId } = await params;
  const supabase = await createClient();

  const guard = await getConfirmedActiveUserOrResponse(supabase);
  if (guard.response) return guard.response;
  const user = guard.user;
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await request.json()) as { reaction?: ReactionType };
  if (!isReaction(body.reaction)) {
    return NextResponse.json({ error: "반응 값이 올바르지 않습니다." }, { status: 400 });
  }

  const { data: post, error: postError } = await supabase
    .from("posts")
    .select("id,user_id,type,is_deleted")
    .eq("id", postId)
    .maybeSingle();

  if (postError || !post || post.is_deleted) {
    return NextResponse.json({ error: "게시글을 찾을 수 없습니다." }, { status: 404 });
  }

  if (post.type !== "free") {
    return NextResponse.json({ error: "자유글에만 추천과 비추천을 남길 수 있습니다." }, { status: 400 });
  }

  if (post.user_id === user.id) {
    return NextResponse.json({ error: "본인 글에는 반응할 수 없습니다." }, { status: 400 });
  }

  const { data: existing, error: existingError } = await supabase
    .from("post_reactions")
    .select("id,reaction")
    .eq("post_id", postId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  if (existing?.reaction === body.reaction) {
    const { error: deleteError } = await supabase.from("post_reactions").delete().eq("id", existing.id);
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }
  } else {
    const { error: upsertError } = await supabase.from("post_reactions").upsert(
      {
        post_id: postId,
        user_id: user.id,
        reaction: body.reaction,
      },
      { onConflict: "post_id,user_id" }
    );

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }
  }

  const { data: reactions, error: reactionsError } = await supabase
    .from("post_reactions")
    .select("reaction")
    .eq("post_id", postId);

  if (reactionsError) {
    return NextResponse.json({ error: reactionsError.message }, { status: 500 });
  }

  const upCount = (reactions ?? []).filter((item) => item.reaction === "up").length;
  const downCount = (reactions ?? []).filter((item) => item.reaction === "down").length;
  const myReaction =
    existing?.reaction === body.reaction
      ? null
      : body.reaction;

  return NextResponse.json({
    ok: true,
    my_reaction: myReaction,
    summary: {
      up_count: upCount,
      down_count: downCount,
      score: upCount - downCount,
    },
  });
}
