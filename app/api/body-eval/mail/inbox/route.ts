import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type ThreadRow = {
  id: string;
  post_id: string;
  author_id: string;
  sender_id: string;
  status: "open" | "closed";
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

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." }, { status: 401 });
  }

  const threadsRes = await supabase
    .from("body_eval_mail_threads")
    .select("id,post_id,author_id,sender_id,status,created_at")
    .or(`author_id.eq.${user.id},sender_id.eq.${user.id}`);
  if (threadsRes.error) {
    return NextResponse.json({ ok: false, code: "THREAD_LIST_FAILED", message: "메일함을 불러오지 못했습니다." }, { status: 500 });
  }

  const threads = (threadsRes.data ?? []) as ThreadRow[];
  if (threads.length === 0) {
    return NextResponse.json({ ok: true, items: [] });
  }

  const threadIds = threads.map((t) => t.id);
  const messagesRes = await supabase
    .from("body_eval_mail_messages")
    .select("id,thread_id,sender_id,receiver_id,content,is_read,created_at")
    .in("thread_id", threadIds)
    .order("created_at", { ascending: false });
  if (messagesRes.error) {
    return NextResponse.json({ ok: false, code: "MESSAGE_LIST_FAILED", message: "메일 메시지를 불러오지 못했습니다." }, { status: 500 });
  }

  const messages = (messagesRes.data ?? []) as MessageRow[];
  const lastByThread = new Map<string, MessageRow>();
  const unreadByThread = new Map<string, number>();
  for (const msg of messages) {
    if (!lastByThread.has(msg.thread_id)) lastByThread.set(msg.thread_id, msg);
    if (msg.receiver_id === user.id && !msg.is_read) {
      unreadByThread.set(msg.thread_id, (unreadByThread.get(msg.thread_id) ?? 0) + 1);
    }
  }

  const postIds = [...new Set(threads.map((t) => t.post_id))];
  const postsRes = await supabase.from("posts").select("id,title").in("id", postIds);
  const postTitleById = new Map<string, string>();
  for (const p of postsRes.data ?? []) {
    postTitleById.set(String(p.id), String(p.title ?? ""));
  }

  const peerIds = [
    ...new Set(
      threads.map((t) => (t.author_id === user.id ? t.sender_id : t.author_id))
    ),
  ];
  const profileRes = await supabase.from("profiles").select("user_id,nickname").in("user_id", peerIds);
  const nicknameByUserId = new Map<string, string>();
  for (const p of profileRes.data ?? []) {
    nicknameByUserId.set(String(p.user_id), String(p.nickname ?? "익명"));
  }

  const items = threads
    .map((t) => {
      const last = lastByThread.get(t.id);
      const peerId = t.author_id === user.id ? t.sender_id : t.author_id;
      const boxType = t.author_id === user.id ? "received" : "sent";
      const lastAt = last?.created_at ?? t.created_at;
      return {
        thread_id: t.id,
        post_id: t.post_id,
        post_title: postTitleById.get(t.post_id) ?? "몸평 게시글",
        peer_user_id: peerId,
        peer_nickname: nicknameByUserId.get(peerId) ?? "익명",
        box_type: boxType as "received" | "sent",
        unread_count: unreadByThread.get(t.id) ?? 0,
        last_message: last?.content ?? "",
        last_message_at: lastAt,
        status: t.status,
      };
    })
    .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());

  return NextResponse.json({ ok: true, items });
}
