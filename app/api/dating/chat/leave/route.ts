import { isMissingDatingChatRelation } from "@/lib/dating-chat";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type LeaveBody = {
  thread_id?: unknown;
};

export async function POST(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  const body = ((await req.json().catch(() => null)) ?? {}) as LeaveBody;
  const threadId = typeof body.thread_id === "string" ? body.thread_id.trim() : "";

  if (!threadId) {
    return NextResponse.json(
      { ok: false, code: "VALIDATION_ERROR", message: "thread_id가 필요합니다." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const threadRes = await admin
    .from("dating_chat_threads")
    .select("id,user_a_id,user_b_id")
    .eq("id", threadId)
    .maybeSingle();

  if (threadRes.error) {
    if (isMissingDatingChatRelation(threadRes.error)) {
      return NextResponse.json(
        { ok: false, code: "THREAD_NOT_FOUND", message: "채팅방을 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    console.error("[POST /api/dating/chat/leave] thread failed", threadRes.error);
    return NextResponse.json(
      { ok: false, code: "LEAVE_FAILED", message: "채팅 나가기에 실패했습니다." },
      { status: 500 }
    );
  }

  const thread = threadRes.data;
  if (!thread || (thread.user_a_id !== user.id && thread.user_b_id !== user.id)) {
    return NextResponse.json(
      { ok: false, code: "THREAD_NOT_FOUND", message: "채팅방을 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  const now = new Date().toISOString();
  const updatePayload =
    thread.user_a_id === user.id
      ? { user_a_hidden_at: now, updated_at: now }
      : { user_b_hidden_at: now, updated_at: now };

  const updateRes = await admin.from("dating_chat_threads").update(updatePayload).eq("id", thread.id);

  if (updateRes.error) {
    console.error("[POST /api/dating/chat/leave] update failed", updateRes.error);
    return NextResponse.json(
      { ok: false, code: "LEAVE_FAILED", message: "채팅 나가기에 실패했습니다." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
