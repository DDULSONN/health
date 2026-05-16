import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";

type RouteCtx = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: RouteCtx) {
  const originError = ensureAllowedMutationOrigin(request);
  if (originError) return originError;

  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const { data: comment, error: commentError } = await auth.admin
    .from("community_fit_room_comments")
    .select("id,user_id,deleted_at")
    .eq("id", id)
    .maybeSingle();

  if (commentError || !comment) {
    return NextResponse.json({ error: "댓글을 찾지 못했습니다." }, { status: 404 });
  }

  if (!comment.deleted_at) {
    const { error } = await auth.admin
      .from("community_fit_room_comments")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by_user_id: auth.user.id,
      })
      .eq("id", id);
    if (error) {
      console.error("[DELETE /api/community/fit-room/comments/[id]] failed", error);
      return NextResponse.json({ error: "댓글 삭제에 실패했습니다." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
