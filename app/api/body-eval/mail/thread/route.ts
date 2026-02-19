import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const threadId = (searchParams.get("thread_id") ?? "").trim();
  if (!threadId) {
    return NextResponse.json({ ok: false, code: "VALIDATION_ERROR", message: "thread_id가 필요합니다." }, { status: 400 });
  }

  const threadRes = await supabase
    .from("body_eval_mail_threads")
    .select("id,post_id,author_id,sender_id,status,created_at")
    .eq("id", threadId)
    .maybeSingle();
  if (threadRes.error || !threadRes.data) {
    return NextResponse.json({ ok: false, code: "THREAD_NOT_FOUND", message: "대화를 찾을 수 없습니다." }, { status: 404 });
  }

  const thread = threadRes.data;
  if (user.id !== thread.author_id && user.id !== thread.sender_id) {
    return NextResponse.json({ ok: false, code: "FORBIDDEN", message: "대화 참여자만 조회할 수 있습니다." }, { status: 403 });
  }

  const [messagesRes, postRes, profileRes] = await Promise.all([
    supabase
      .from("body_eval_mail_messages")
      .select("id,thread_id,sender_id,receiver_id,content,is_read,created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true }),
    supabase.from("posts").select("id,title").eq("id", thread.post_id).maybeSingle(),
    supabase
      .from("profiles")
      .select("user_id,nickname")
      .in("user_id", [thread.author_id, thread.sender_id]),
  ]);

  if (messagesRes.error) {
    return NextResponse.json({ ok: false, code: "MESSAGE_LIST_FAILED", message: "메시지를 불러오지 못했습니다." }, { status: 500 });
  }

  const nicknameById = new Map<string, string>();
  for (const p of profileRes.data ?? []) {
    nicknameById.set(String(p.user_id), String(p.nickname ?? "익명"));
  }

  return NextResponse.json({
    ok: true,
    thread: {
      id: thread.id,
      post_id: thread.post_id,
      post_title: postRes.data?.title ?? "몸평 게시글",
      author_id: thread.author_id,
      sender_id: thread.sender_id,
      author_nickname: nicknameById.get(thread.author_id) ?? "익명",
      sender_nickname: nicknameById.get(thread.sender_id) ?? "익명",
      status: thread.status,
      created_at: thread.created_at,
    },
    messages: messagesRes.data ?? [],
  });
}
