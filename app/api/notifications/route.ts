import { NextResponse } from "next/server";
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

function getNotificationApplicationId(item: NotificationRow): string {
  const value = item.meta_json?.application_id;
  return typeof value === "string" ? value.trim() : "";
}

function buildNotificationPresentation(
  item: NotificationRow,
  actorNickname: string | null,
  applicationState: DatingCardApplicationState | null = null
): { title: string; body: string; link: string | null } {
  const appStatus = applicationState?.status ?? null;

  if (item.type === "dating_application_received") {
    if (appStatus === "canceled") {
      return {
        title: "지원이 취소됐습니다",
        body: actorNickname
          ? `${actorNickname}님이 보낸 지원이 취소되어 현재 지원자 목록에는 보이지 않습니다.`
          : "도착했던 지원이 취소되어 현재 지원자 목록에는 보이지 않습니다.",
        link: "/mypage#open-card-received",
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
        link: "/mypage#open-card-received",
      };
    }

    return {
      title: "새 지원 도착",
      body: actorNickname
        ? `${actorNickname}님이 내 오픈카드에 지원했습니다.`
        : "내 오픈카드에 새로운 지원이 도착했습니다.",
      link: "/mypage#open-card-received",
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

  const actorIds = [...new Set((data ?? []).map((item) => item.actor_id).filter(Boolean))] as string[];
  const applicationIds = [
    ...new Set(
      ((data ?? []) as NotificationRow[])
        .filter((item) =>
          ["dating_application_received", "dating_application_accepted", "dating_application_rejected"].includes(
            item.type
          )
        )
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
  if (applicationIds.length > 0) {
    const admin = createAdminClient();
    const { data: apps, error: appsError } = await admin
      .from("dating_card_applications")
      .select("id,status")
      .in("id", applicationIds);

    if (!appsError) {
      for (const app of (apps ?? []) as DatingCardApplicationState[]) {
        applicationStateMap.set(app.id, app);
      }
    } else {
      console.error("[GET /api/notifications] application state load failed", appsError);
    }
  }

  const { count: unreadCountRaw } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_read", false);

  return NextResponse.json({
    items: (data ?? []).map((item) => {
      const actorNickname = item.actor_id ? profileMap.get(item.actor_id)?.nickname ?? null : null;
      const notification = item as NotificationRow;
      const applicationId = getNotificationApplicationId(notification);
      const presentation = buildNotificationPresentation(
        notification,
        actorNickname,
        applicationId ? applicationStateMap.get(applicationId) ?? null : null
      );
      return {
        ...item,
        actor_profile: item.actor_id ? profileMap.get(item.actor_id) ?? null : null,
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
