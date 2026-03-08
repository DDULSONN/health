import { isAllowedAdminUser } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, message: "Login is required." }, { status: 401 });
  }

  const admin = createAdminClient();
  const commentRes = await admin
    .from("bodybattle_entry_comments")
    .select("id,user_id,deleted_at")
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (commentRes.error) {
    return NextResponse.json({ ok: false, message: commentRes.error.message }, { status: 500 });
  }
  if (!commentRes.data) {
    return NextResponse.json({ ok: false, message: "Comment not found." }, { status: 404 });
  }

  const isAdmin = isAllowedAdminUser(user.id, user.email);
  if (commentRes.data.user_id !== user.id && !isAdmin) {
    return NextResponse.json({ ok: false, message: "No permission." }, { status: 403 });
  }

  if (isAdmin) {
    const deleteRes = await admin.from("bodybattle_entry_comments").delete().eq("id", id);
    if (deleteRes.error) {
      return NextResponse.json({ ok: false, message: deleteRes.error.message }, { status: 500 });
    }
  } else {
    const updateRes = await admin
      .from("bodybattle_entry_comments")
      .update({
        content: null,
        deleted_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updateRes.error) {
      return NextResponse.json({ ok: false, message: updateRes.error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
