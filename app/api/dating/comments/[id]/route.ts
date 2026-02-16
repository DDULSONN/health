import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { NextResponse } from "next/server";

/** DELETE /api/dating/comments/[id] — 댓글 삭제 (본인 soft delete, 관리자 hard delete) */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const isAdmin = isAdminEmail(user.email);

  const { data: comment } = await adminClient
    .from("dating_comments")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();

  if (!comment) {
    return NextResponse.json({ error: "댓글을 찾을 수 없습니다." }, { status: 404 });
  }

  if (comment.user_id !== user.id && !isAdmin) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  if (isAdmin) {
    // 관리자: hard delete
    await adminClient.from("dating_comments").delete().eq("id", id);
  } else {
    // 본인: soft delete
    await adminClient
      .from("dating_comments")
      .update({ deleted_at: new Date().toISOString(), content: null })
      .eq("id", id);
  }

  return NextResponse.json({ ok: true });
}
