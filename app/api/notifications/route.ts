import { selectPublicProfiles } from "@/lib/public-profiles";
import { NextResponse } from "next/server";
import { getOneOnOneContactNudgeSenderDisplayName } from "@/lib/dating-1on1-contact-nudge";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { notificationHref } from "@/lib/notification-view";

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

function getNotificationApplicationIds(item: NotificationRow): string[] {
  const group = Array.isArray(item.meta_json?.application_ids) ? item.meta_json.application_ids : [];
  return [...new Set([getNotificationApplicationId(item), ...group]
    .filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
    .map((id) => id.trim()))];
}

function isApplicationNotification(item: NotificationRow): boolean {
  return ["dating_application_received", "dating_application_accepted", "dating_application_rejected"].includes(item.type);
}

async function loadApplicationStates(admin: ReturnType<typeof createAdminClient>, table: string, ids: string[]) {
  const data: DatingCardApplicationState[] = [];
  // Bound large legacy reminder groups; never treat an incomplete lookup as deleted.
  if (ids.length > 1000) return { data, error: new Error("APPLICATION_STATE_LIMIT") };
  for (let offset = 0; offset < ids.length; offset += 200) {
    const result = await admin.from(table).select("id,status").in("id", ids.slice(offset, offset + 200));
    if (result.error) return { data: [], error: result.error };
    data.push(...(result.data ?? []) as DatingCardApplicationState[]);
  }
  return { data, error: null };
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
  applicationMissing = false,
  applicationLookupFailed = false,
  reminderPendingCount: number | null = null
): { title: string; body: string; link: string | null } {
  const metaTitle = getNotificationMetaText(item, "notification_title");
  const metaBody = getNotificationMetaText(item, "notification_body");
  const metaRoute = getNotificationMetaText(item, "notification_route");
  const appStatus = applicationMissing ? "canceled" : applicationState?.status || getNotificationApplicationStatus(item) || null;
  const receivedRoute = getNotificationSourceKind(item) === "paid" ? "/mypage#paid-card-received" : "/mypage#open-card-received";
  const appliedRoute = getNotificationSourceKind(item) === "paid" ? "/mypage#paid-card-applied" : "/mypage#open-card-applied";
  if (applicationLookupFailed && isApplicationNotification(item)) {
    return { title: "지원 상태 확인 필요", body: "최신 지원 상태를 확인하지 못했어요. 매칭 내역에서 확인해 주세요.",
      link: item.type === "dating_application_received" ? receivedRoute : appliedRoute };
  }
  if (reminderPendingCount !== null) {
    return reminderPendingCount > 0
      ? { title: "지원 답변이 기다리고 있어요", body: `이 알림의 지원 중 ${reminderPendingCount}건이 아직 대기 중이에요. 확인 후 수락하거나 거절해 주세요.`, link: receivedRoute }
      : { title: "대기 중인 지원이 없습니다", body: "이 알림의 지원은 답변 완료 또는 취소되어 더 이상 대기 중이지 않아요.", link: receivedRoute };
  }
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
        link: appliedRoute,
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
        link: appliedRoute,
      };
    }

    return {
      title: "지원 결과가 도착했습니다",
      body: actorNickname
        ? `${actorNickname}님이 내 지원 결과를 보냈습니다.`
        : "내 지원 결과가 도착했습니다.",
      link: appliedRoute,
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
  const requestedLimit = Number(searchParams.get("limit") ?? 30);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.floor(requestedLimit))) : 30;

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
  const applicationNotifications = notificationRows.filter(isApplicationNotification);
  const oneOnOneNudgeMatchIds = [
    ...new Set(notificationRows.filter(isOneOnOneContactNudge).map(getNotificationMatchId).filter(Boolean)),
  ];
  const openApplicationIds = [
    ...new Set(
      applicationNotifications
        .filter((item) => getNotificationSourceKind(item) === "open")
        .flatMap(getNotificationApplicationIds)
        .filter(Boolean)
    ),
  ];
  const paidApplicationIds = [
    ...new Set(
      applicationNotifications
        .filter((item) => getNotificationSourceKind(item) === "paid")
        .flatMap(getNotificationApplicationIds)
        .filter(Boolean)
    ),
  ];
  const profileMap = new Map<string, { nickname: string | null }>();
  if (actorIds.length > 0) {
    const { data: profiles } = await selectPublicProfiles().in("user_id", actorIds);
    for (const profile of profiles ?? []) {
      profileMap.set(profile.user_id, { nickname: profile.nickname });
    }
  }

  const applicationStateMap = new Map<string, DatingCardApplicationState>();
  const oneOnOneMatchMap = new Map<string, OneOnOneMatchIdentity>();
  const oneOnOneNudgeSenderMap = new Map<string, string>();
  const oneOnOneCardNameMap = new Map<string, string>();
  const applicationStateLookupSucceeded = { open: true, paid: true };
  if (openApplicationIds.length > 0 || paidApplicationIds.length > 0 || oneOnOneNudgeMatchIds.length > 0) {
    const admin = createAdminClient();
    const [openAppsResult, paidAppsResult, oneOnOneMatchesResult, oneOnOneNudgesResult] = await Promise.all([
      loadApplicationStates(admin, "dating_card_applications", openApplicationIds),
      loadApplicationStates(admin, "dating_paid_card_applications", paidApplicationIds),
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

    for (const [source, result] of [["open", openAppsResult], ["paid", paidAppsResult]] as const) {
      applicationStateLookupSucceeded[source] = !result.error;
      if (!result.error) {
        for (const app of result.data) applicationStateMap.set(`${source}:${app.id}`, app);
      } else {
        console.error("[GET /api/notifications] application state load failed", { source, error: result.error });
      }
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

  const { count: unreadCountRaw, error: countError } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_read", false);
  if (countError || !Number.isSafeInteger(unreadCountRaw) || (unreadCountRaw ?? -1) < 0) {
    return NextResponse.json({ error: "알림 수를 확인하지 못했어요. 잠시 후 다시 시도해 주세요." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }

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
      const source = getNotificationSourceKind(notification);
      const relatedIds = isApplicationNotification(notification) ? getNotificationApplicationIds(notification) : [];
      const applicationState = applicationId
        ? applicationStateMap.get(`${source}:${applicationId}`) ?? null
        : null;
      const stateLoaded = applicationStateLookupSucceeded[source];
      const isGroupReminder = notification.type === "dating_application_received" &&
        ["pending_24h", "pending_72h"].includes(getNotificationReminderKind(notification)) && relatedIds.length > 1;
      const pendingCount = isGroupReminder && stateLoaded
        ? relatedIds.filter((id) => applicationStateMap.get(`${source}:${id}`)?.status === "submitted").length : null;
      const presentation = buildNotificationPresentation(
        notification,
        actorNickname,
        oneOnOneSenderCardName || null,
        applicationState,
        Boolean(relatedIds.length && applicationId && stateLoaded && !applicationState),
        Boolean(relatedIds.length && !stateLoaded),
        pendingCount
      );
      return {
        ...notification,
        actor_profile: notification.actor_id ? profileMap.get(notification.actor_id) ?? null : null,
        title: presentation.title,
        body: presentation.body,
        link: notificationHref(presentation.link),
      };
    }),
    unread_count: unreadCountRaw,
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  const { client: supabase, user } = await getRequestAuthContext(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload: unknown = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const body = payload as { id?: unknown; mark_all?: unknown };
  if (body.mark_all !== undefined && typeof body.mark_all !== "boolean") {
    return NextResponse.json({ error: "invalid mark_all" }, { status: 400 });
  }

  if (body.mark_all === true) {
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", user.id)
      .eq("is_read", false);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (typeof body.id !== "string" || !body.id.trim() || body.id.length > 100) {
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
