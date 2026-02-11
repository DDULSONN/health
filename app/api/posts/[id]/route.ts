import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** GET /api/posts/[id] — 게시글 상세 + 댓글 (프로필 별도 조회) */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  // 게시글 조회 (RLS가 is_hidden 필터링 처리)
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

  // 게시글 작성자 프로필
  const { data: authorProfile } = await supabase
    .from("profiles")
    .select("nickname, role")
    .eq("user_id", post.user_id)
    .single();

  // 댓글 조회
  const { data: comments } = await supabase
    .from("comments")
    .select("*")
    .eq("post_id", id)
    .eq("is_hidden", false)
    .order("created_at", { ascending: true });

  // 댓글 작성자 프로필 일괄 조회
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

  const enrichedComments = (comments ?? []).map((c) => ({
    ...c,
    profiles: commentProfileMap.get(c.user_id as string) ?? null,
  }));

  return NextResponse.json({
    post: { ...post, profiles: authorProfile ?? null },
    comments: enrichedComments,
  });
}
