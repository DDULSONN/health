import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { notifyDatingUser } from "@/lib/dating-notifications";
import { sendExpoPushToUser } from "@/lib/expo-push";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const applicationId = id?.trim();
  if (!applicationId) {
    return NextResponse.json({ error: "Application id is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: target, error: targetError } = await admin
    .from("dating_card_applications")
    .select("id, card_id, status, applicant_display_nickname")
    .eq("id", applicationId)
    .eq("applicant_user_id", user.id)
    .maybeSingle();

  if (targetError) {
    console.error("[DELETE /api/dating/cards/my/applied/[id]] fetch failed", targetError);
    return NextResponse.json({ error: "Failed to fetch application." }, { status: 500 });
  }

  if (!target) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }

  const cardRes = await admin
    .from("dating_cards")
    .select("owner_user_id")
    .eq("id", target.card_id)
    .maybeSingle();
  if (cardRes.error) {
    console.error("[DELETE /api/dating/cards/my/applied/[id]] card owner fetch failed", cardRes.error);
  }

  const { error: deleteError } = await admin
    .from("dating_card_applications")
    .delete()
    .eq("id", applicationId)
    .eq("applicant_user_id", user.id);

  if (deleteError) {
    console.error("[DELETE /api/dating/cards/my/applied/[id]] delete failed", deleteError);
    return NextResponse.json({ error: "Failed to delete application." }, { status: 500 });
  }

  const ownerUserId = cardRes.data?.owner_user_id ?? null;
  if (ownerUserId) {
    const canceledAt = new Date().toISOString();
    const wasActive = target.status === "submitted" || target.status === "accepted";
    const finalStatus = wasActive ? "canceled" : target.status;
    const actorLabel =
      String(target.applicant_display_nickname ?? "").trim() || "지원자";
    const title =
      target.status === "accepted"
        ? "오픈카드 연결이 취소됐어요"
        : "오픈카드 지원이 취소됐어요";
    const notificationBody =
      target.status === "accepted"
        ? `${actorLabel}님과의 연결이 취소됐습니다.`
        : `${actorLabel}님이 보낸 지원이 취소됐습니다.`;

    try {
      const existingNotificationRes = await admin
        .from("notifications")
        .select("id, meta_json")
        .eq("user_id", ownerUserId)
        .eq("actor_id", user.id)
        .eq("type", "dating_application_received")
        .contains("meta_json", { application_id: applicationId })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingNotificationRes.error) {
        throw existingNotificationRes.error;
      }

      if (existingNotificationRes.data) {
        const previousMeta =
          existingNotificationRes.data.meta_json &&
          typeof existingNotificationRes.data.meta_json === "object"
            ? existingNotificationRes.data.meta_json
            : {};
        const nextMeta = {
          ...previousMeta,
          application_status: finalStatus,
          application_deleted_at: canceledAt,
          ...(wasActive
            ? {
                notification_title: title,
                notification_body: notificationBody,
                notification_route: "/notifications",
              }
            : {}),
        };

        const updateNotificationRes = await admin
          .from("notifications")
          .update({
            meta_json: nextMeta,
            ...(wasActive ? { is_read: false, created_at: canceledAt } : {}),
          })
          .eq("id", existingNotificationRes.data.id);
        if (updateNotificationRes.error) {
          throw updateNotificationRes.error;
        }

        if (wasActive) {
          await sendExpoPushToUser(admin, ownerUserId, {
            title,
            body: notificationBody,
            data: {
              type: "dating_application_received",
              applicationId,
              route: "/notifications",
            },
          });
        }
      } else if (wasActive) {
        await notifyDatingUser(admin, {
          userId: ownerUserId,
          actorId: user.id,
          type: "dating_application_received",
          title,
          body: notificationBody,
          route: "/notifications",
          meta: {
            card_id: target.card_id,
            application_id: applicationId,
            application_status: "canceled",
            application_deleted_at: canceledAt,
          },
        });
      }
    } catch (notificationError) {
      console.error(
        "[DELETE /api/dating/cards/my/applied/[id]] cancellation notification failed",
        notificationError
      );
    }
  }

  return NextResponse.json({ ok: true });
}
