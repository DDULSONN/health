import { NextResponse } from "next/server";
import { getRequestAuthContext } from "@/lib/supabase/request";

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

function buildNotificationPresentation(
  item: NotificationRow,
  actorNickname: string | null
): { title: string; body: string; link: string | null } {
  if (item.type === "dating_application_received") {
    const cardId = typeof item.meta_json?.card_id === "string" ? item.meta_json.card_id : null;
    return {
      title: "새 지원 도착",
      body: actorNickname
        ? `${actorNickname}님이 내 오픈카드에 지원했습니다.`
        : "내 오픈카드에 새로운 지원이 도착했습니다.",
      link: cardId ? `/(tabs)/me/applications/${cardId}` : null,
    };
  }

  if (item.type === "dating_application_accepted") {
    return {
      title: "지원이 수락됐습니다",
      body: actorNickname
        ? `${actorNickname}님이 내 지원을 수락했습니다.`
        : "내 지원이 수락되었습니다.",
      link: "/(tabs)/apply",
    };
  }

  if (item.type === "dating_application_rejected") {
    return {
      title: "지원 결과가 도착했습니다",
      body: actorNickname
        ? `${actorNickname}님이 내 지원 결과를 확인했습니다.`
        : "내 지원 결과가 도착했습니다.",
      link: "/(tabs)/apply",
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
  const profileMap = new Map<string, { nickname: string | null }>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("user_id, nickname").in("user_id", actorIds);
    for (const profile of profiles ?? []) {
      profileMap.set(profile.user_id, { nickname: profile.nickname });
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
      const presentation = buildNotificationPresentation(item as NotificationRow, actorNickname);
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
