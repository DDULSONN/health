import { isAdminEmail } from "@/lib/admin";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { sendExpoPushToUser } from "@/lib/expo-push";
import { sendDatingEmailNotification } from "@/lib/dating-swipe";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;

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
    .select("id, user_id, nickname")
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
    if (status === app.status) {
      return NextResponse.json({ ok: true, application_id: id, status, unchanged: true });
    }
    if (isOwner && app.status !== "accepted" && !isAdmin) {
      return NextResponse.json({ error: "수락된 연결만 삭제할 수 있습니다." }, { status: 409 });
    }
  } else if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "처리 권한이 없습니다." }, { status: 403 });
  } else {
    if (status === app.status) {
      return NextResponse.json({ ok: true, application_id: id, status, unchanged: true });
    }
    if (app.status !== "submitted" && !isAdmin) {
      return NextResponse.json({ error: "이미 처리된 지원서입니다." }, { status: 409 });
    }
  }

  const acceptedAt = status === "accepted" ? new Date().toISOString() : null;
  let updateRes = await admin
    .from("dating_paid_card_applications")
    .update({ status, accepted_at: acceptedAt })
    .eq("id", id)
    .eq("status", app.status)
    .select("id,status")
    .maybeSingle();

  if (updateRes.error && updateRes.error.code === "42703") {
    updateRes = await admin
      .from("dating_paid_card_applications")
      .update({ status })
      .eq("id", id)
      .eq("status", app.status)
      .select("id,status")
      .maybeSingle();
  }

  if (updateRes.error || !updateRes.data || updateRes.data.id !== id) {
    console.error("[PATCH /api/dating/paid/applications/[id]] failed", updateRes.error);
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

  if ((status === "accepted" || status === "rejected") && app.applicant_user_id) {
    const notificationType = status === "accepted" ? "dating_application_accepted" : "dating_application_rejected";
    const title = status === "accepted" ? "지원이 수락됐습니다" : "지원 결과가 도착했습니다";
    const cardNickname = String(card.nickname ?? "대기 없이 등록 카드").trim() || "대기 없이 등록 카드";
    const body =
      status === "accepted"
        ? `${cardNickname} 지원이 수락되었습니다.`
        : `${cardNickname} 지원이 거절되었습니다.`;
    const route = status === "accepted" ? "/mypage#dating-connections" : "/mypage#paid-card-applied";

    await admin
      .from("notifications")
      .insert({
        user_id: app.applicant_user_id,
        actor_id: card.user_id,
        type: notificationType,
        post_id: null,
        comment_id: null,
        meta_json: {
          card_id: app.paid_card_id,
          application_id: app.id,
          application_status: status,
          source_kind: "paid",
          notification_title: title,
          notification_body: body,
          notification_route: route,
        },
      })
      .then(({ error }) => {
        if (error) {
          console.error("[PATCH /api/dating/paid/applications/[id]] notification insert failed", error);
        }
      });

    await sendExpoPushToUser(admin, app.applicant_user_id, {
      title,
      body,
      data: {
        type: notificationType,
        cardId: app.paid_card_id,
        applicationId: app.id,
        sourceKind: "paid",
        route,
      },
    }).catch((error) => {
      console.error("[PATCH /api/dating/paid/applications/[id]] expo push failed", error);
    });

    if (status === "accepted") {
      await sendDatingEmailNotification(
        admin,
        app.applicant_user_id,
        "대기 없이 등록 카드 지원이 수락됐어요",
        `${body}\n마이페이지에서 연결 상태를 확인해 주세요.`
      ).catch((error) => {
        console.error("[PATCH /api/dating/paid/applications/[id]] accepted email failed", error);
        return false;
      });
    }
  }

  // Paid card stays public even when accepted because multiple accepts are allowed.
  return NextResponse.json({ ok: true, application_id: id, status });
}
