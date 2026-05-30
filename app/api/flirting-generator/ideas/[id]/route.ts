import { isAllowedAdminUser } from "@/lib/admin";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const TABLE = "flirting_line_ideas";

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

  const { id } = await params;
  const admin = createAdminClient();
  const { data: idea, error: ideaError } = await admin
    .from(TABLE)
    .select("id,user_id,deleted_at")
    .eq("id", id)
    .maybeSingle();

  if (ideaError || !idea) {
    return NextResponse.json({ error: "아이디어를 찾을 수 없습니다." }, { status: 404 });
  }

  const isAdmin = isAllowedAdminUser(user.id, user.email);
  if (!isAdmin && idea.user_id !== user.id) {
    return NextResponse.json({ error: "삭제 권한이 없습니다." }, { status: 403 });
  }

  if (!idea.deleted_at) {
    const { error } = await admin
      .from(TABLE)
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by_user_id: user.id,
      })
      .eq("id", id);

    if (error) {
      console.error("[DELETE /api/flirting-generator/ideas/[id]] failed", error);
      return NextResponse.json({ error: "삭제에 실패했습니다." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
