import { NextResponse } from "next/server";

import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { id } = await params;
  const cardId = String(id ?? "").trim();
  if (!cardId) {
    return NextResponse.json({ error: "유료카드 ID가 필요합니다." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if ((body as { action?: unknown } | null)?.action !== "hide") {
    return NextResponse.json({ error: "지원하지 않는 요청입니다." }, { status: 400 });
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

  if (String(cardRes.data.status ?? "") !== "approved") {
    return NextResponse.json({ error: "공개 중인 유료카드만 내릴 수 있습니다." }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  let updateRes = await adminClient
    .from("dating_paid_cards")
    .update({ status: "hidden", expires_at: nowIso })
    .eq("id", cardId)
    .eq("user_id", user.id)
    .eq("status", "approved")
    .select("id,status,expires_at")
    .maybeSingle();

  if (updateRes.error) {
    updateRes = await adminClient
      .from("dating_paid_cards")
      .update({ status: "expired", expires_at: nowIso })
      .eq("id", cardId)
      .eq("user_id", user.id)
      .eq("status", "approved")
      .select("id,status,expires_at")
      .maybeSingle();
  }

  if (updateRes.error || !updateRes.data) {
    console.error("[PATCH /api/dating/paid/my/[id]] hide failed", updateRes.error);
    return NextResponse.json({ error: "유료카드 내리기에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    id: updateRes.data.id,
    status: updateRes.data.status,
    expires_at: updateRes.data.expires_at,
    message: "유료카드를 내렸습니다. 더 이상 목록에 노출되지 않습니다.",
  });
}

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
