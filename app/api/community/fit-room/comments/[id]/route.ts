import { NextResponse } from "next/server";
import { isAllowedAdminUser } from "@/lib/admin";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { createAdminClient, createClient } from "@/lib/supabase/server";

type RouteCtx = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: RouteCtx) {
  const originError = ensureAllowedMutationOrigin(request);
  if (originError) return originError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const admin = createAdminClient();
  const isAdmin = isAllowedAdminUser(user.id, user.email);
  const { id } = await params;

  const { data: comment, error: commentError } = await admin
    .from("community_fit_room_comments")
    .select("id,user_id,deleted_at")
    .eq("id", id)
    .maybeSingle();

  if (commentError || !comment) {
    return NextResponse.json({ error: "댓글을 찾지 못했습니다." }, { status: 404 });
  }

  if (!isAdmin && comment.user_id !== user.id) {
    return NextResponse.json({ error: "삭제 권한이 없습니다." }, { status: 403 });
  }

  if (!comment.deleted_at) {
    const { error } = await admin
      .from("community_fit_room_comments")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by_user_id: user.id,
      })
      .eq("id", id);

    if (error) {
      console.error("[DELETE /api/community/fit-room/comments/[id]] failed", error);
      return NextResponse.json({ error: "댓글 삭제에 실패했습니다." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
