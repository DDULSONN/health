import { NextResponse } from "next/server";
import { getOneOnOneContactNudgeSenderDisplayName } from "@/lib/dating-1on1-contact-nudge";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";

type NotificationRow = {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: string;
  post_id: string | null;
  comment_id: string | null;
  meta_json: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
};

type DatingCardApplicationState = {
  id: string;
  status: string | null;
};

type OneOnOneMatchIdentity = {
  id: string;
  source_card_id: string;
  source_user_id: string;
  candidate_card_id: string;
  candidate_user_id: string;
};

type OneOnOneNudgeSender = {
  match_id: string;
  sender_user_id: string;
};

type OneOnOneCardIdentity = {
  id: string;
  name: string | null;
};

function getNotificationApplicationId(item: NotificationRow): string {
  const value = item.meta_json?.application_id;
  return typeof value === "string" ? value.trim() : "";
}

function getNotificationReminderKind(item: NotificationRow): string {
  const value = item.meta_json?.reminder_kind;
  return typeof value === "string" ? value.trim() : "";
}

function getNotificationApplicationStatus(item: NotificationRow): string {
  const value = item.meta_json?.application_status;
  return typeof value === "string" ? value.trim() : "";
}

function getNotificationSourceKind(item: NotificationRow): "open" | "paid" {
  return item.meta_json?.source_kind === "paid" ? "paid" : "open";
}

function getNotificationMetaText(
  item: NotificationRow,
  key: "notification_title" | "notification_body" | "notification_route" | "notification_type" | "sender_display_name"
): string {
  const value = item.meta_json?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function isOneOnOneContactNudge(item: NotificationRow): boolean {
  return getNotificationMetaText(item, "notification_type") === "dating_1on1_contact_nudge" ||
    item.type === "dating_1on1_contact_nudge";
}

function getNotificationMatchId(item: NotificationRow): string {
  const value = item.meta_json?.match_id;
  return typeof value === "string" ? value.trim() : "";
}

function getOneOnOneNudgeSenderCardName(
  item: NotificationRow,
  matchMap: Map<string, OneOnOneMatchIdentity>,
  nudgeSenderMap: Map<string, string>,
  cardNameMap: Map<string, string>,
): string {
  const matchId = getNotificationMatchId(item);
  const match = matchMap.get(matchId);
  if (!match) return "";

  let senderUserId = item.actor_id || nudgeSenderMap.get(matchId) || "";
  if (!senderUserId) {
    if (item.user_id === match.source_user_id) senderUserId = match.candidate_user_id;
    if (item.user_id === match.candidate_user_id) senderUserId = match.source_user_id;
  }

  if (senderUserId === match.source_user_id) return cardNameMap.get(match.source_card_id) || "";
  if (senderUserId === match.candidate_user_id) return cardNameMap.get(match.candidate_card_id) || "";
  return "";
}

function buildNotificationPresentation(
  item: NotificationRow,
  actorNickname: string | null,
  oneOnOneCardName: string | null = null,
  applicationState: DatingCardApplicationState | null = null,
  applicationMissing = false
): { title: string; body: string; link: string | null } {
  const metaTitle = getNotificationMetaText(item, "notification_title");
  const metaBody = getNotificationMetaText(item, "notification_body");
  const metaRoute = getNotificationMetaText(item, "notification_route");
  const appStatus =
    applicationState?.status ||
    getNotificationApplicationStatus(item) ||
    (applicationMissing ? "canceled" : null);
  const preferCurrentApplicationState =
    appStatus === "canceled" ||
    (item.type === "dating_application_received" && (appStatus === "accepted" || appStatus === "rejected"));

  const notificationType = getNotificationMetaText(item, "notification_type") || item.type;
  if (notificationType === "dating_1on1_contact_nudge") {
    const senderName = getOneOnOneContactNudgeSenderDisplayName({
      storedSenderName: getNotificationMetaText(item, "sender_display_name"),
      oneOnOneCardName,
      actorNickname,
    });
    const senderSubject = senderName ? `${senderName}님이` : "1:1 상대가";
    const message = metaBody || "연락처 교환 한마디를 보냈어요.";
    const senderPrefixes = [senderName, getNotificationMetaText(item, "sender_display_name"), actorNickname]
      .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
      .map((value) => `${value}님:`);
    const matchedPrefix = senderPrefixes.find((prefix) => message.startsWith(prefix)) ?? "";
    const messageWithoutSender = matchedPrefix ? message.slice(matchedPrefix.length).trimStart() : message;
    return {
      title: `${senderSubject} 1:1 한마디를 보냈어요`,
      body: senderName ? `${senderName}님: ${messageWithoutSender}` : message,
      link: metaRoute.startsWith("/") ? metaRoute : "/community/dating/cards?tab=one_on_one",
    };
  }

  if (metaTitle && metaBody && !preferCurrentApplicationState) {
    return {
      title: metaTitle,
      body: metaBody,
      link: metaRoute.startsWith("/") ? metaRoute : null,
    };
  }

  if (item.type === "dating_application_received") {
    const receivedRoute =
      getNotificationSourceKind(item) === "paid" ? "/mypage#paid-card-received" : "/mypage#open-card-received";
    if (appStatus === "canceled") {
      return {
        title: "지원이 취소됐습니다",
        body: actorNickname
          ? `${actorNickname}님이 보낸 지원이 취소되어 현재 지원자 목록에는 보이지 않습니다.`
          : "도착했던 지원이 취소되어 현재 지원자 목록에는 보이지 않습니다.",
        link: null,
      };
    }
    if (appStatus === "accepted") {
      return {
        title: "수락한 지원입니다",
        body: actorNickname ? `${actorNickname}님 지원을 수락한 상태입니다.` : "수락한 지원입니다.",
        link: "/mypage#dating-connections",
      };
    }
    if (appStatus === "rejected") {
      return {
        title: "거절한 지원입니다",
        body: actorNickname ? `${actorNickname}님 지원을 거절한 상태입니다.` : "거절한 지원입니다.",
        link: receivedRoute,
      };
    }

    const reminderKind = getNotificationReminderKind(item);
    if (reminderKind === "pending_24h") {
      return {
        title: "지원 답변이 기다리고 있어요",
        body: actorNickname
          ? `${actorNickname}님 지원이 아직 대기 중이에요. 수락하거나 거절해 주세요.`
          : "아직 대기 중인 오픈카드 지원이 있어요. 수락하거나 거절해 주세요.",
        link: receivedRoute,
      };
    }

    return {
      title: "새 지원 도착",
      body: actorNickname
        ? `${actorNickname}님이 내 오픈카드에 지원했습니다.`
        : "내 오픈카드에 새로운 지원이 도착했습니다.",
      link: receivedRoute,
    };
  }

  if (item.type === "dating_application_accepted") {
    if (appStatus === "canceled") {
      return {
        title: "연결이 취소됐습니다",
        body: actorNickname
          ? `${actorNickname}님과의 연결이 현재 취소된 상태입니다.`
          : "수락됐던 연결이 현재 취소된 상태입니다.",
        link: "/mypage#open-card-applied",
      };
    }

    return {
      title: "지원이 수락됐습니다",
      body: actorNickname
        ? `${actorNickname}님이 내 지원을 수락했습니다.`
        : "내 지원이 수락되었습니다.",
      link: "/mypage#dating-connections",
    };
  }

  if (item.type === "dating_application_rejected") {
    if (appStatus === "canceled") {
      return {
        title: "지원이 취소됐습니다",
        body: "지원이 현재 취소된 상태입니다.",
        link: "/mypage#open-card-applied",
      };
    }

    return {
      title: "지원 결과가 도착했습니다",
      body: actorNickname
        ? `${actorNickname}님이 내 지원 결과를 보냈습니다.`
        : "내 지원 결과가 도착했습니다.",
      link: "/mypage#open-card-applied",
    };
  }

  return {
    title: "새 댓글",
    body: actorNickname ? `${actorNickname}님이 댓글을 남겼습니다.` : "새 댓글이 달렸습니다.",
    link: item.post_id ? `/community/${item.post_id}` : null,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const unreadOnly = searchParams.get("unread_only") === "1";
  const limit = Math.max(1, Math.min(100, Number(searchParams.get("limit") ?? 30)));

  const { client: supabase, user } = await getRequestAuthContext(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let query = supabase
    .from("notifications")
    .select("id, user_id, actor_id, type, post_id, comment_id, meta_json, is_read, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unreadOnly) query = query.eq("is_read", false);
  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const notificationRows = (data ?? []) as NotificationRow[];
  const actorIds = [...new Set(notificationRows.map((item) => item.actor_id).filter(Boolean))] as string[];
  const applicationNotifications = notificationRows.filter((item) =>
    ["dating_application_received", "dating_application_accepted", "dating_application_rejected"].includes(item.type)
  );
  const oneOnOneNudgeMatchIds = [
    ...new Set(notificationRows.filter(isOneOnOneContactNudge).map(getNotificationMatchId).filter(Boolean)),
  ];
  const openApplicationIds = [
    ...new Set(
      applicationNotifications
        .filter((item) => getNotificationSourceKind(item) === "open")
        .map(getNotificationApplicationId)
        .filter(Boolean)
    ),
  ];
  const paidApplicationIds = [
    ...new Set(
      applicationNotifications
        .filter((item) => getNotificationSourceKind(item) === "paid")
        .map(getNotificationApplicationId)
        .filter(Boolean)
    ),
  ];
  const profileMap = new Map<string, { nickname: string | null }>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("user_id, nickname").in("user_id", actorIds);
    for (const profile of profiles ?? []) {
      profileMap.set(profile.user_id, { nickname: profile.nickname });
    }
  }

  const applicationStateMap = new Map<string, DatingCardApplicationState>();
  const oneOnOneMatchMap = new Map<string, OneOnOneMatchIdentity>();
  const oneOnOneNudgeSenderMap = new Map<string, string>();
  const oneOnOneCardNameMap = new Map<string, string>();
  let applicationStateLookupSucceeded = true;
  if (openApplicationIds.length > 0 || paidApplicationIds.length > 0 || oneOnOneNudgeMatchIds.length > 0) {
    const admin = createAdminClient();
    const [openAppsResult, paidAppsResult, oneOnOneMatchesResult, oneOnOneNudgesResult] = await Promise.all([
      openApplicationIds.length > 0
        ? admin.from("dating_card_applications").select("id,status").in("id", openApplicationIds)
        : Promise.resolve({ data: [], error: null }),
      paidApplicationIds.length > 0
        ? admin.from("dating_paid_card_applications").select("id,status").in("id", paidApplicationIds)
        : Promise.resolve({ data: [], error: null }),
      oneOnOneNudgeMatchIds.length > 0
        ? admin
            .from("dating_1on1_match_proposals")
            .select("id,source_card_id,source_user_id,candidate_card_id,candidate_user_id")
            .in("id", oneOnOneNudgeMatchIds)
        : Promise.resolve({ data: [], error: null }),
      oneOnOneNudgeMatchIds.length > 0
        ? admin
            .from("dating_1on1_contact_nudges")
            .select("match_id,sender_user_id")
            .in("match_id", oneOnOneNudgeMatchIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (!openAppsResult.error && !paidAppsResult.error) {
      for (const app of [...(openAppsResult.data ?? []), ...(paidAppsResult.data ?? [])] as DatingCardApplicationState[]) {
        applicationStateMap.set(app.id, app);
      }
    } else {
      applicationStateLookupSucceeded = false;
      console.error("[GET /api/notifications] application state load failed", {
        openError: openAppsResult.error,
        paidError: paidAppsResult.error,
      });
    }

    if (!oneOnOneMatchesResult.error) {
      const matches = (oneOnOneMatchesResult.data ?? []) as OneOnOneMatchIdentity[];
      for (const match of matches) oneOnOneMatchMap.set(match.id, match);

      const cardIds = [
        ...new Set(matches.flatMap((match) => [match.source_card_id, match.candidate_card_id]).filter(Boolean)),
      ];
      if (cardIds.length > 0) {
        const cardsResult = await admin.from("dating_1on1_cards").select("id,name").in("id", cardIds);
        if (!cardsResult.error) {
          for (const card of (cardsResult.data ?? []) as OneOnOneCardIdentity[]) {
            const name = String(card.name ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 30);
            if (name) oneOnOneCardNameMap.set(card.id, name);
          }
        } else {
          console.error("[GET /api/notifications] 1:1 card identity load failed", cardsResult.error);
        }
      }
    } else {
      console.error("[GET /api/notifications] 1:1 match identity load failed", oneOnOneMatchesResult.error);
    }

    if (!oneOnOneNudgesResult.error) {
      for (const nudge of (oneOnOneNudgesResult.data ?? []) as OneOnOneNudgeSender[]) {
        if (nudge.sender_user_id) oneOnOneNudgeSenderMap.set(nudge.match_id, nudge.sender_user_id);
      }
    } else {
      console.error("[GET /api/notifications] 1:1 nudge sender load failed", oneOnOneNudgesResult.error);
    }
  }

  const { count: unreadCountRaw } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_read", false);

  return NextResponse.json({
    items: notificationRows.map((notification) => {
      const actorNickname = notification.actor_id ? profileMap.get(notification.actor_id)?.nickname ?? null : null;
      const oneOnOneSenderCardName = isOneOnOneContactNudge(notification)
        ? getOneOnOneNudgeSenderCardName(
            notification,
            oneOnOneMatchMap,
            oneOnOneNudgeSenderMap,
            oneOnOneCardNameMap,
          )
        : "";
      const applicationId = getNotificationApplicationId(notification);
      const applicationState = applicationId
        ? applicationStateMap.get(applicationId) ?? null
        : null;
      const presentation = buildNotificationPresentation(
        notification,
        actorNickname,
        oneOnOneSenderCardName || null,
        applicationState,
        Boolean(applicationId && applicationStateLookupSucceeded && !applicationState)
      );
      return {
        ...notification,
        actor_profile: notification.actor_id ? profileMap.get(notification.actor_id) ?? null : null,
        title: presentation.title,
        body: presentation.body,
        link: presentation.link,
      };
    }),
    unread_count: unreadCountRaw ?? 0,
  });
}

export async function PATCH(request: Request) {
  const { client: supabase, user } = await getRequestAuthContext(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { id?: string; mark_all?: boolean };

  if (body.mark_all) {
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", user.id)
      .eq("is_read", false);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", body.id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
