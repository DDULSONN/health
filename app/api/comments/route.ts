import { createClient } from "@/lib/supabase/server";
import { containsProfanity, getRateLimitRemaining } from "@/lib/moderation";
import { NextResponse } from "next/server";
import { getKstDateString } from "@/lib/weekly";
import { getConfirmedUserOrResponse } from "@/lib/auth-confirmed";

const COMMENT_COOLDOWN_MS = 10_000;

async function trackDailyComment(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
) {
  const dateKst = getKstDateString();
  const { data: row } = await supabase
    .from("user_daily_stats")
    .select("comments_count, viewed_bodycheck_count, did_1rm_calc")
    .eq("user_id", userId)
    .eq("date_kst", dateKst)
    .maybeSingle();

  const commentsCount = Number(row?.comments_count ?? 0) + 1;

  await supabase.from("user_daily_stats").upsert(
    {
      user_id: userId,
      date_kst: dateKst,
      comments_count: commentsCount,
      viewed_bodycheck_count: Number(row?.viewed_bodycheck_count ?? 0),
      did_1rm_calc: Boolean(row?.did_1rm_calc ?? false),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,date_kst" }
  );
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const guard = await getConfirmedUserOrResponse(supabase);
  if (guard.response) return guard.response;
  const user = guard.user;
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await request.json()) as {
    post_id?: string;
    content?: string;
    parent_id?: string | null;
  };
  const postId = body.post_id?.trim();
  const content = body.content?.trim();
  const parentId = body.parent_id ?? null;

  if (!postId || !content) {
    return NextResponse.json({ error: "내용을 입력해 주세요." }, { status: 400 });
  }

  if (containsProfanity(content)) {
    return NextResponse.json({ error: "부적절한 표현이 포함되어 있습니다." }, { status: 400 });
  }

  if (parentId) {
    const { data: parent, error: parentError } = await supabase
      .from("comments")
      .select("id, post_id, parent_id")
      .eq("id", parentId)
      .maybeSingle();

    if (parentError || !parent) {
      return NextResponse.json({ error: "원댓글을 찾을 수 없습니다." }, { status: 404 });
    }
    if (parent.post_id !== postId) {
      return NextResponse.json(
        { error: "같은 게시글의 댓글에만 답글을 달 수 있습니다." },
        { status: 400 }
      );
    }
    if (parent.parent_id) {
      return NextResponse.json({ error: "답글에는 다시 답글을 달 수 없습니다." }, { status: 400 });
    }
  }

  const { data: lastComment } = await supabase
    .from("comments")
    .select("created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const remaining = getRateLimitRemaining(lastComment?.created_at ?? null, COMMENT_COOLDOWN_MS);
  if (remaining > 0) {
    return NextResponse.json(
      { error: `${Math.ceil(remaining / 1000)}초 후에 다시 시도해 주세요.` },
      { status: 429 }
    );
  }

  const { data, error } = await supabase
    .from("comments")
    .insert({
      post_id: postId,
      user_id: user.id,
      content,
      parent_id: parentId,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await trackDailyComment(supabase, user.id);

  return NextResponse.json({ id: data.id }, { status: 201 });
}
