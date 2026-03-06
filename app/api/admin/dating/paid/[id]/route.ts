import { isAdminEmail } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function parseAdminUserIds() {
  return (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function isAllowedAdmin(userId: string, email?: string | null) {
  const allowlist = parseAdminUserIds();
  if (allowlist.length > 0) {
    return allowlist.includes(userId);
  }
  return isAdminEmail(email);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!isAllowedAdmin(user.id, user.email)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: row, error: rowError } = await admin
    .from("dating_paid_cards")
    .select("id")
    .eq("id", id)
    .single();
  if (rowError || !row) {
    return NextResponse.json({ error: "대상을 찾을 수 없습니다." }, { status: 404 });
  }

  const { error: deleteError } = await admin.from("dating_paid_cards").delete().eq("id", id);
  if (deleteError) {
    console.error("[DELETE /api/admin/dating/paid/[id]] failed", deleteError);
    return NextResponse.json({ error: "삭제에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: true, id });
}

