import { isDatingChatReportReason } from "@/lib/dating-chat-report-reasons";
import { isMissingDatingChatRelation } from "@/lib/dating-chat";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type ReportBody = {
  thread_id?: unknown;
  reason?: unknown;
  details?: unknown;
};

function asText(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  const body = ((await req.json().catch(() => null)) ?? {}) as ReportBody;
  const threadId = asText(body.thread_id, 120);
  const reason = asText(body.reason, 120);
  const details = asText(body.details, 1000);

  if (!threadId || !reason || !isDatingChatReportReason(reason)) {
    return NextResponse.json(
      { ok: false, code: "VALIDATION_ERROR", message: "신고 사유를 확인해 주세요." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const threadRes = await admin
    .from("dating_chat_threads")
    .select("id,source_kind,source_id,user_a_id,user_b_id")
    .eq("id", threadId)
    .maybeSingle();

  if (threadRes.error) {
    if (isMissingDatingChatRelation(threadRes.error)) {
      return NextResponse.json(
        { ok: false, code: "THREAD_NOT_FOUND", message: "채팅방을 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    console.error("[POST /api/dating/chat/report] thread failed", threadRes.error);
    return NextResponse.json(
      { ok: false, code: "LOAD_FAILED", message: "신고할 채팅을 불러오지 못했습니다." },
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

  const reportedUserId = thread.user_a_id === user.id ? thread.user_b_id : thread.user_a_id;

  const [messagesRes, profilesRes] = await Promise.all([
    admin
      .from("dating_chat_messages")
      .select("id,sender_id,receiver_id,content,created_at")
      .eq("thread_id", thread.id)
      .order("created_at", { ascending: false })
      .limit(30),
    admin.from("profiles").select("user_id,nickname").in("user_id", [thread.user_a_id, thread.user_b_id]),
  ]);

  if (messagesRes.error || profilesRes.error) {
    console.error("[POST /api/dating/chat/report] snapshot failed", messagesRes.error ?? profilesRes.error);
    return NextResponse.json(
      { ok: false, code: "LOAD_FAILED", message: "신고 내용을 정리하지 못했습니다." },
      { status: 500 }
    );
  }

  const nicknameMap = new Map(
    (profilesRes.data ?? []).map((row) => [String(row.user_id), String(row.nickname ?? "익명").trim() || "익명"])
  );

  const conversationExcerpt = [...(messagesRes.data ?? [])]
    .reverse()
    .map((message) => ({
      id: message.id,
      sender_id: message.sender_id,
      sender_nickname: nicknameMap.get(String(message.sender_id)) ?? "익명",
      receiver_id: message.receiver_id,
      receiver_nickname: nicknameMap.get(String(message.receiver_id)) ?? "익명",
      content: message.content,
      created_at: message.created_at,
    }));

  const insertRes = await admin.from("dating_chat_reports").insert({
    thread_id: thread.id,
    source_kind: thread.source_kind,
    source_id: thread.source_id,
    reporter_user_id: user.id,
    reported_user_id: reportedUserId,
    reason,
    details: details || null,
    conversation_excerpt: conversationExcerpt,
  });

  if (insertRes.error) {
    const alreadyReported = insertRes.error.code === "23505";
    if (alreadyReported) {
      return NextResponse.json(
        { ok: false, code: "ALREADY_REPORTED", message: "이 채팅은 이미 신고했습니다." },
        { status: 409 }
      );
    }
    console.error("[POST /api/dating/chat/report] insert failed", insertRes.error);
    return NextResponse.json(
      { ok: false, code: "REPORT_FAILED", message: "채팅 신고에 실패했습니다." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
