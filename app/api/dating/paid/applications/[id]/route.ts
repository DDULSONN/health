import { isAdminEmail } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function PATCH(
  req: Request,
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

  const body = await req.json().catch(() => null);
  const status = (body as { status?: string } | null)?.status;
  if (status !== "accepted" && status !== "rejected" && status !== "canceled") {
    return NextResponse.json({ error: "허용되지 않은 상태값입니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: app, error: appError } = await admin
    .from("dating_paid_card_applications")
    .select("id, paid_card_id, applicant_user_id, status")
    .eq("id", id)
    .single();

  if (appError || !app) {
    return NextResponse.json({ error: "지원서를 찾을 수 없습니다." }, { status: 404 });
  }

  const { data: card, error: cardError } = await admin
    .from("dating_paid_cards")
    .select("id, user_id")
    .eq("id", app.paid_card_id)
    .single();

  if (cardError || !card) {
    return NextResponse.json({ error: "카드를 찾을 수 없습니다." }, { status: 404 });
  }

  const isOwner = card.user_id === user.id;
  const isApplicant = app.applicant_user_id === user.id;
  const isAdmin = isAdminEmail(user.email);

  if (status === "canceled") {
    if (!isApplicant && !isOwner && !isAdmin) {
      return NextResponse.json({ error: "취소 권한이 없습니다." }, { status: 403 });
    }
    if (isOwner && app.status !== "accepted" && !isAdmin) {
      return NextResponse.json({ error: "수락된 연결만 삭제할 수 있습니다." }, { status: 409 });
    }
  } else if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "처리 권한이 없습니다." }, { status: 403 });
  }

  const { error: updateError } = await admin
    .from("dating_paid_card_applications")
    .update({ status })
    .eq("id", id);

  if (updateError) {
    console.error("[PATCH /api/dating/paid/applications/[id]] failed", updateError);
    return NextResponse.json({ error: "상태 변경에 실패했습니다." }, { status: 500 });
  }

  if (status === "canceled") {
    const { error: deleteThreadError } = await admin
      .from("dating_chat_threads")
      .delete()
      .eq("source_kind", "paid")
      .eq("source_id", id);

    if (deleteThreadError) {
      console.error("[PATCH /api/dating/paid/applications/[id]] delete thread failed", deleteThreadError);
      return NextResponse.json({ error: "연결은 삭제됐지만 채팅 정리에 실패했습니다." }, { status: 500 });
    }
  }

  // Paid card stays public even when accepted because multiple accepts are allowed.
  return NextResponse.json({ ok: true, status });
}
