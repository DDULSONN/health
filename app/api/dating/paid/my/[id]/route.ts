import { NextResponse } from "next/server";

import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await getRequestAuthContext(_req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { id } = await params;
  const cardId = String(id ?? "").trim();
  if (!cardId) {
    return NextResponse.json({ error: "삭제할 유료카드 ID가 필요합니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const cardRes = await adminClient
    .from("dating_paid_cards")
    .select("id,user_id,status")
    .eq("id", cardId)
    .maybeSingle();

  if (cardRes.error || !cardRes.data || cardRes.data.user_id !== user.id) {
    return NextResponse.json({ error: "유료카드를 찾을 수 없습니다." }, { status: 404 });
  }

  if (!["pending", "approved", "rejected", "expired"].includes(String(cardRes.data.status ?? ""))) {
    return NextResponse.json({ error: "지금은 삭제할 수 없는 유료카드 상태입니다." }, { status: 400 });
  }

  const deleteRes = await adminClient
    .from("dating_paid_cards")
    .delete()
    .eq("id", cardId)
    .eq("user_id", user.id);

  if (deleteRes.error) {
    console.error("[DELETE /api/dating/paid/my/[id]] failed", deleteRes.error);
    return NextResponse.json({ error: "유료카드 삭제에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: cardId, message: "유료카드를 삭제했습니다." });
}
