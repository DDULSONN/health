import { isAdminEmail } from "@/lib/admin";
import { createClient, createAdminClient } from "@/lib/supabase/server";
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

  const adminClient = createAdminClient();
  const { data: app, error: appError } = await adminClient
    .from("dating_card_applications")
    .select("id, card_id, applicant_user_id, status")
    .eq("id", id)
    .single();

  if (appError || !app) {
    return NextResponse.json({ error: "지원서를 찾을 수 없습니다." }, { status: 404 });
  }

  const { data: card, error: cardError } = await adminClient
    .from("dating_cards")
    .select("id, owner_user_id")
    .eq("id", app.card_id)
    .single();

  if (cardError || !card) {
    return NextResponse.json({ error: "카드를 찾을 수 없습니다." }, { status: 404 });
  }

  const isOwner = card.owner_user_id === user.id;
  const isApplicant = app.applicant_user_id === user.id;
  const isAdmin = isAdminEmail(user.email);

  if (status === "canceled") {
    if (!isApplicant && !isAdmin) {
      return NextResponse.json({ error: "취소 권한이 없습니다." }, { status: 403 });
    }
  } else if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "처리 권한이 없습니다." }, { status: 403 });
  }

  const { error: updateError } = await adminClient
    .from("dating_card_applications")
    .update({ status })
    .eq("id", id);

  if (updateError) {
    console.error("[PATCH /api/dating/cards/applications/[id]] failed", updateError);
    return NextResponse.json({ error: "상태 변경에 실패했습니다." }, { status: 500 });
  }

  if (status === "accepted") {
    const nowIso = new Date().toISOString();

    const { error: cardHideError } = await adminClient
      .from("dating_cards")
      .update({ status: "hidden", expires_at: nowIso })
      .eq("id", app.card_id);

    if (cardHideError) {
      console.error("[PATCH /api/dating/cards/applications/[id]] card hide failed", cardHideError);
      return NextResponse.json(
        { error: "지원자 수락은 되었지만 카드 내림 처리에 실패했습니다. 관리자에게 문의해주세요." },
        { status: 500 }
      );
    }

    const { error: rejectOthersError } = await adminClient
      .from("dating_card_applications")
      .update({ status: "rejected" })
      .eq("card_id", app.card_id)
      .eq("status", "submitted")
      .neq("id", id);

    if (rejectOthersError) {
      console.error("[PATCH /api/dating/cards/applications/[id]] reject others failed", rejectOthersError);
    }
  }

  return NextResponse.json({ ok: true, status, card_hidden: status === "accepted" });
}
