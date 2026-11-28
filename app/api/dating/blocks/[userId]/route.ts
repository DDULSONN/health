import { removeMemberContactBlock } from "@/lib/dating-member-contact-block";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { NextResponse } from "next/server";

export async function DELETE(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;

  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { userId } = await params;
  const blockedUserId = String(userId ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(blockedUserId)) {
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

  try { await removeMemberContactBlock(admin, user.id, blockedUserId); }
  catch { return NextResponse.json({ error: "연동된 차단 해제를 완료하지 못했습니다. 다시 시도해 주세요." }, { status: 503 }); }
  return NextResponse.json({ ok: true });
}
