import { isAdminEmail } from "@/lib/admin";
import { promotePendingCardsBySex } from "@/lib/dating-cards-queue";
import { sendExpoPushToUser } from "@/lib/expo-push";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;

  const { id } = await params;
  const { user } = await getRequestAuthContext(req);

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
    .select("id, card_id, applicant_user_id, applicant_display_nickname, status")
    .eq("id", id)
    .single();

  if (appError || !app) {
    return NextResponse.json({ error: "지원서를 찾을 수 없습니다." }, { status: 404 });
  }

  const { data: card, error: cardError } = await adminClient
    .from("dating_cards")
    .select("id, owner_user_id, sex, status, display_nickname")
    .eq("id", app.card_id)
    .single();

  if (cardError || !card) {
    return NextResponse.json({ error: "카드를 찾을 수 없습니다." }, { status: 404 });
  }

  const isOwner = card.owner_user_id === user.id;
  const isApplicant = app.applicant_user_id === user.id;
  const isAdmin = isAdminEmail(user.email);

  if (status === app.status) {
    return NextResponse.json({
      ok: true,
      status,
      unchanged: true,
      card_hidden: false,
    });
  }

  if (status === "canceled") {
    if (!isApplicant && !isAdmin) {
      return NextResponse.json({ error: "취소 권한이 없습니다." }, { status: 403 });
    }
    if (app.status !== "submitted" && !isAdmin) {
      return NextResponse.json({ error: "이미 처리된 지원서는 취소할 수 없습니다." }, { status: 409 });
    }
  } else if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "처리 권한이 없습니다." }, { status: 403 });
  } else if (app.status !== "submitted" && !isAdmin) {
    return NextResponse.json({ error: "이미 처리된 지원서입니다." }, { status: 409 });
  }

  const { error: updateError } = await adminClient.from("dating_card_applications").update({ status }).eq("id", id);

  if (updateError) {
    console.error("[PATCH /api/dating/cards/applications/[id]] failed", updateError);
    return NextResponse.json({ error: "상태 변경에 실패했습니다." }, { status: 500 });
  }

  if (status === "accepted" && card.status === "public") {
    const nowIso = new Date().toISOString();

    const { error: cardHideError } = await adminClient
      .from("dating_cards")
      .update({ status: "hidden", expires_at: nowIso })
      .eq("id", app.card_id);

    if (cardHideError) {
      console.error("[PATCH /api/dating/cards/applications/[id]] card hide failed", cardHideError);
      return NextResponse.json(
        { error: "지원자 수락은 됐지만 카드 숨김 처리에 실패했습니다. 관리자에게 문의해주세요." },
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

    const sex = card.sex === "female" ? "female" : "male";
    try {
      await promotePendingCardsBySex(adminClient, sex);
    } catch (promoteError) {
      console.error("[PATCH /api/dating/cards/applications/[id]] promote pending failed", promoteError);
    }
  }

  if ((status === "accepted" || status === "rejected") && app.applicant_user_id) {
    const notificationType = status === "accepted" ? "dating_application_accepted" : "dating_application_rejected";
    const title = status === "accepted" ? "지원이 수락됐습니다" : "지원 결과가 도착했습니다";
    const bodyText =
      status === "accepted"
        ? `${card.display_nickname ?? "오픈카드"} 지원이 수락되었습니다.`
        : `${card.display_nickname ?? "오픈카드"} 지원이 거절되었습니다.`;

    await adminClient
      .from("notifications")
      .insert({
        user_id: app.applicant_user_id,
        actor_id: card.owner_user_id,
        type: notificationType,
        post_id: null,
        comment_id: null,
        meta_json: {
          card_id: app.card_id,
          application_id: app.id,
        },
      })
      .then(({ error }) => {
        if (error) {
          console.error("[PATCH /api/dating/cards/applications/[id]] notification insert failed", error);
        }
      });

    await sendExpoPushToUser(adminClient, app.applicant_user_id, {
      title,
      body: bodyText,
      data: {
        type: notificationType,
        cardId: app.card_id,
        applicationId: app.id,
      },
    }).catch((pushError) => {
      console.error("[PATCH /api/dating/cards/applications/[id]] expo push failed", pushError);
    });
  }

  return NextResponse.json({
    ok: true,
    status,
    card_hidden: status === "accepted" && card.status === "public",
  });
}
