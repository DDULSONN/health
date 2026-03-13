import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function DELETE(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { userId } = await params;
  const blockedUserId = String(userId ?? "").trim();
  if (!blockedUserId) {
    return NextResponse.json({ error: "차단 해제할 사용자를 찾을 수 없습니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const deleteRes = await admin
    .from("dating_user_blocks")
    .delete()
    .eq("blocker_user_id", user.id)
    .eq("blocked_user_id", blockedUserId);

  if (deleteRes.error) {
    console.error("[DELETE /api/dating/blocks/[userId]] failed", deleteRes.error);
    return NextResponse.json({ error: "차단 해제에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
