import { isMissingDatingChatRelation } from "@/lib/dating-chat";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
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
  last_message_at: string | null;
  last_message_preview: string | null;
  created_at: string;
};

// Only unread counters need message rows. Previews already live on the thread.
async function loadUnreadCounts(admin: ReturnType<typeof createAdminClient>, userId: string, threadIds: string[]) {
  const visible = new Set(threadIds);
  const counts = new Map<string, number>();
  let after = "";
  for (;;) {
    let query = admin.from("dating_chat_messages").select("id,thread_id")
      .in("thread_id", threadIds).eq("receiver_id", userId).eq("is_read", false).order("id", { ascending: true }).limit(500);
    if (after) query = query.gt("id", after);
    const result = await query;
    if (result.error) return { counts, error: result.error };
    const rows = result.data ?? [];
    for (const row of rows) if (visible.has(row.thread_id)) counts.set(row.thread_id, (counts.get(row.thread_id) ?? 0) + 1);
    if (rows.length < 500) return { counts, error: null };
    after = rows[rows.length - 1].id;
  }
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." }, { status: 401 });
  }

  const admin = createAdminClient();
  const threadsRes = await admin
    .from("dating_chat_threads")
    .select(
      "id,source_kind,source_id,user_a_id,user_b_id,status,user_a_hidden_at,user_b_hidden_at,last_message_at,last_message_preview,created_at"
    )
    .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (threadsRes.error) {
    if (isMissingDatingChatRelation(threadsRes.error)) {
      return NextResponse.json({ ok: true, items: [], unreadCount: 0 });
    }
    console.error("[GET /api/dating/chat/inbox] threads failed", threadsRes.error);
    return NextResponse.json({ ok: false, code: "LOAD_FAILED", message: "채팅 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const threads = ((threadsRes.data ?? []) as ThreadRow[]).filter((thread) => {
    if (thread.user_a_id === user.id) return !thread.user_a_hidden_at;
    if (thread.user_b_id === user.id) return !thread.user_b_hidden_at;
    return false;
  });
  if (threads.length === 0) {
    return NextResponse.json({ ok: true, items: [], unreadCount: 0 });
  }

  const threadIds = threads.map((thread) => thread.id);
  const [messagesRes, profilesRes] = await Promise.all([
    loadUnreadCounts(admin, user.id, threadIds),
    admin
      .from("profiles")
      .select("user_id,nickname")
      .in(
        "user_id",
        [...new Set(threads.flatMap((thread) => [thread.user_a_id, thread.user_b_id]))]
      ),
  ]);

  if (messagesRes.error) {
    console.error("[GET /api/dating/chat/inbox] messages failed", messagesRes.error);
    return NextResponse.json({ ok: false, code: "LOAD_FAILED", message: "채팅 목록을 불러오지 못했습니다." }, { status: 500 });
  }
  if (profilesRes.error) {
    console.error("[GET /api/dating/chat/inbox] profiles failed", profilesRes.error);
    return NextResponse.json({ ok: false, code: "LOAD_FAILED", message: "채팅 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const nicknameMap = new Map(
    (profilesRes.data ?? []).map((row) => [String(row.user_id), String(row.nickname ?? "익명").trim() || "익명"])
  );
  const unreadByThread = messagesRes.counts;

  const items = threads.map((thread) => {
    const peerUserId = thread.user_a_id === user.id ? thread.user_b_id : thread.user_a_id;
    return {
      thread_id: thread.id,
      source_kind: thread.source_kind,
      source_id: thread.source_id,
      peer_user_id: peerUserId,
      peer_nickname: nicknameMap.get(peerUserId) ?? "익명",
      status: thread.status,
      unread_count: unreadByThread.get(thread.id) ?? 0,
      last_message: thread.last_message_preview ?? "",
      last_message_at: thread.last_message_at ?? thread.created_at,
      created_at: thread.created_at,
    };
  });

  return NextResponse.json({
    ok: true,
    unreadCount: items.reduce((sum, item) => sum + item.unread_count, 0),
    items,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
