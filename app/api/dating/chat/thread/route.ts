import { isMissingDatingChatRelation } from "@/lib/dating-chat";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  const threadId = (searchParams.get("thread_id") ?? "").trim();
  if (!threadId) {
    return NextResponse.json(
      { ok: false, code: "VALIDATION_ERROR", message: "thread_id가 필요합니다." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const threadRes = await admin
    .from("dating_chat_threads")
    .select(
      "id,source_kind,source_id,user_a_id,user_b_id,status,user_a_hidden_at,user_b_hidden_at,last_message_at,last_message_preview,created_at"
    )
    .eq("id", threadId)
    .maybeSingle();

  if (threadRes.error) {
    if (isMissingDatingChatRelation(threadRes.error)) {
      return NextResponse.json(
        { ok: false, code: "THREAD_NOT_FOUND", message: "채팅방을 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    console.error("[GET /api/dating/chat/thread] thread failed", threadRes.error);
    return NextResponse.json(
      { ok: false, code: "LOAD_FAILED", message: "채팅 내용을 불러오지 못했습니다." },
      { status: 500 }
    );
  }

  const thread = threadRes.data;
  const hiddenForUser =
    thread?.user_a_id === user.id
      ? !!thread.user_a_hidden_at
      : thread?.user_b_id === user.id
        ? !!thread.user_b_hidden_at
        : false;

  if (!thread || (thread.user_a_id !== user.id && thread.user_b_id !== user.id) || hiddenForUser) {
    return NextResponse.json(
      { ok: false, code: "THREAD_NOT_FOUND", message: "채팅방을 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  const [messagesRes, profilesRes] = await Promise.all([
    admin
      .from("dating_chat_messages")
      .select("id,thread_id,sender_id,receiver_id,content,is_read,created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true }),
    admin.from("profiles").select("user_id,nickname").in("user_id", [thread.user_a_id, thread.user_b_id]),
  ]);

  if (messagesRes.error) {
    console.error("[GET /api/dating/chat/thread] messages failed", messagesRes.error);
    return NextResponse.json(
      { ok: false, code: "LOAD_FAILED", message: "채팅 내용을 불러오지 못했습니다." },
      { status: 500 }
    );
  }
  if (profilesRes.error) {
    console.error("[GET /api/dating/chat/thread] profiles failed", profilesRes.error);
    return NextResponse.json(
      { ok: false, code: "LOAD_FAILED", message: "채팅 내용을 불러오지 못했습니다." },
      { status: 500 }
    );
  }

  const nicknameMap = new Map(
    (profilesRes.data ?? []).map((row) => [String(row.user_id), String(row.nickname ?? "익명").trim() || "익명"])
  );

  return NextResponse.json({
    ok: true,
    thread: {
      id: thread.id,
      source_kind: thread.source_kind,
      source_id: thread.source_id,
      current_user_id: user.id,
      user_a_id: thread.user_a_id,
      user_b_id: thread.user_b_id,
      user_a_nickname: nicknameMap.get(thread.user_a_id) ?? "익명",
      user_b_nickname: nicknameMap.get(thread.user_b_id) ?? "익명",
      status: thread.status,
      created_at: thread.created_at,
    },
    messages: messagesRes.data ?? [],
  });
}
