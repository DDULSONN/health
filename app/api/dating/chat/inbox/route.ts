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

type MessageRow = {
  id: string;
  thread_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
};

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
    admin
      .from("dating_chat_messages")
      .select("id,thread_id,sender_id,receiver_id,content,is_read,created_at")
      .in("thread_id", threadIds)
      .order("created_at", { ascending: false }),
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
  const lastByThread = new Map<string, MessageRow>();
  const unreadByThread = new Map<string, number>();

  for (const row of (messagesRes.data ?? []) as MessageRow[]) {
    if (!lastByThread.has(row.thread_id)) {
      lastByThread.set(row.thread_id, row);
    }
    if (row.receiver_id === user.id && !row.is_read) {
      unreadByThread.set(row.thread_id, (unreadByThread.get(row.thread_id) ?? 0) + 1);
    }
  }

  const items = threads.map((thread) => {
    const peerUserId = thread.user_a_id === user.id ? thread.user_b_id : thread.user_a_id;
    const lastMessage = lastByThread.get(thread.id);
    return {
      thread_id: thread.id,
      source_kind: thread.source_kind,
      source_id: thread.source_id,
      peer_user_id: peerUserId,
      peer_nickname: nicknameMap.get(peerUserId) ?? "익명",
      status: thread.status,
      unread_count: unreadByThread.get(thread.id) ?? 0,
      last_message: lastMessage?.content ?? thread.last_message_preview ?? "",
      last_message_at: lastMessage?.created_at ?? thread.last_message_at ?? thread.created_at,
      created_at: thread.created_at,
    };
  });

  return NextResponse.json({
    ok: true,
    unreadCount: items.reduce((sum, item) => sum + item.unread_count, 0),
    items,
  });
}
