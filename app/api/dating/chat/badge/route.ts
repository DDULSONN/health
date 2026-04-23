import { isMissingDatingChatRelation, listDatingChatConnections } from "@/lib/dating-chat";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type ThreadRow = {
  id: string;
  source_kind: "open" | "paid" | "swipe";
  source_id: string;
  user_a_id: string;
  user_b_id: string;
  status: "open" | "closed";
  user_a_hidden_at: string | null;
  user_b_hidden_at: string | null;
};

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  const admin = createAdminClient();

  try {
    const [connections, threadsRes] = await Promise.all([
      listDatingChatConnections(admin, user.id),
      admin
        .from("dating_chat_threads")
        .select("id,source_kind,source_id,user_a_id,user_b_id,status,user_a_hidden_at,user_b_hidden_at")
        .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`),
    ]);

    if (threadsRes.error) {
      if (isMissingDatingChatRelation(threadsRes.error)) {
        return NextResponse.json({
          ok: true,
          unreadCount: 0,
          availableCount: connections.length,
        });
      }
      throw threadsRes.error;
    }

    const threads = (threadsRes.data ?? []) as ThreadRow[];
    const visibleThreads = threads.filter((thread) => {
      if (thread.user_a_id === user.id) return !thread.user_a_hidden_at;
      if (thread.user_b_id === user.id) return !thread.user_b_hidden_at;
      return false;
    });

    const visibleThreadIds = visibleThreads.map((thread) => thread.id);
    const unreadRes =
      visibleThreadIds.length > 0
        ? await admin
            .from("dating_chat_messages")
            .select("id", { count: "exact", head: true })
            .eq("receiver_id", user.id)
            .eq("is_read", false)
            .in("thread_id", visibleThreadIds)
        : { count: 0, error: null };

    if (unreadRes.error) {
      throw unreadRes.error;
    }

    const openThreadKeySet = new Set(
      threads.filter((thread) => thread.status === "open").map((thread) => `${thread.source_kind}:${thread.source_id}`)
    );
    const hiddenKeySet = new Set(
      threads
        .filter(
          (thread) =>
            thread.status === "closed" ||
            (thread.user_a_id === user.id
              ? !!thread.user_a_hidden_at
              : thread.user_b_id === user.id
                ? !!thread.user_b_hidden_at
                : false)
        )
        .map((thread) => `${thread.source_kind}:${thread.source_id}`)
    );

    const availableCount = connections.filter((item) => {
      const key = `${item.sourceKind}:${item.sourceId}`;
      return !hiddenKeySet.has(key) && !openThreadKeySet.has(key);
    }).length;

    return NextResponse.json({
      ok: true,
      unreadCount: Math.max(0, Number(unreadRes.count ?? 0)),
      availableCount,
    });
  } catch (error) {
    console.error("[GET /api/dating/chat/badge] failed", error);
    return NextResponse.json(
      { ok: false, code: "LOAD_FAILED", message: "채팅 뱃지 정보를 불러오지 못했습니다." },
      { status: 500 }
    );
  }
}
