import { isAdminEmail } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type RouteCtx = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: RouteCtx) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const adminMode = isAdminEmail(user.email);
  const admin = createAdminClient();
  const { data: target, error: targetError } = await admin
    .from("comments")
    .select("id,user_id,deleted_at")
    .eq("id", id)
    .maybeSingle();

  if (targetError || !target) {
    return NextResponse.json({ error: "댓글을 찾을 수 없습니다." }, { status: 404 });
  }

  if (target.deleted_at) {
    return NextResponse.json({ ok: true });
  }

  const canDelete = adminMode || target.user_id === user.id;
  if (!canDelete) {
    return NextResponse.json({ error: "삭제 권한이 없습니다." }, { status: 403 });
  }

  const nowIso = new Date().toISOString();
  const client = adminMode ? admin : supabase;
  const { error } = await client
    .from("comments")
    .update({
      deleted_at: nowIso,
      content: null,
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
