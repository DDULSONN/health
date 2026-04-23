import { isMissingDatingChatRelation } from "@/lib/dating-chat";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

type ReadBody = {
  thread_id?: unknown;
};

export async function POST(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = ((await req.json().catch(() => null)) ?? {}) as ReadBody;
  const threadId = typeof body.thread_id === "string" ? body.thread_id.trim() : "";
  if (!threadId) {
    return NextResponse.json({ ok: false, code: "VALIDATION_ERROR", message: "thread_id가 필요합니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const threadRes = await admin
    .from("dating_chat_threads")
    .select("id,user_a_id,user_b_id")
    .eq("id", threadId)
    .maybeSingle();

  if (threadRes.error) {
    if (isMissingDatingChatRelation(threadRes.error)) {
      return NextResponse.json({ ok: true, updated: 0 });
    }
    console.error("[POST /api/dating/chat/read] thread failed", threadRes.error);
    return NextResponse.json({ ok: false, code: "READ_FAILED", message: "읽음 처리에 실패했습니다." }, { status: 500 });
  }

  const thread = threadRes.data;
  if (!thread || (thread.user_a_id !== user.id && thread.user_b_id !== user.id)) {
    return NextResponse.json({ ok: false, code: "THREAD_NOT_FOUND", message: "채팅방을 찾을 수 없습니다." }, { status: 404 });
  }

  const updateRes = await admin
    .from("dating_chat_messages")
    .update({ is_read: true })
    .eq("thread_id", threadId)
    .eq("receiver_id", user.id)
    .eq("is_read", false)
    .select("id");

  if (updateRes.error) {
    console.error("[POST /api/dating/chat/read] update failed", updateRes.error);
    return NextResponse.json({ ok: false, code: "READ_FAILED", message: "읽음 처리에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: (updateRes.data ?? []).length });
}
