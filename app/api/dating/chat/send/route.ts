import {
  DatingChatSourceKind,
  isMissingDatingChatRelation,
  resolveDatingChatConnection,
} from "@/lib/dating-chat";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type SendBody = {
  thread_id?: unknown;
  source_kind?: unknown;
  source_id?: unknown;
  content?: unknown;
};

function asText(value: unknown, max = 2000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isSourceKind(value: string): value is DatingChatSourceKind {
  return value === "open" || value === "paid" || value === "swipe";
}

export async function POST(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  const body = ((await req.json().catch(() => null)) ?? {}) as SendBody;
  const threadId = asText(body.thread_id, 120);
  const sourceKindRaw = asText(body.source_kind, 50);
  const sourceId = asText(body.source_id, 120);
  const content = asText(body.content, 2000);

  if (!content) {
    return NextResponse.json(
      { ok: false, code: "VALIDATION_ERROR", message: "메시지를 입력해 주세요." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  try {
    let resolvedThreadId = threadId;

    if (!resolvedThreadId) {
      if (!isSourceKind(sourceKindRaw) || !sourceId) {
        return NextResponse.json(
          { ok: false, code: "VALIDATION_ERROR", message: "채팅 연결 정보를 확인해 주세요." },
          { status: 400 }
        );
      }

      const connection = await resolveDatingChatConnection(admin, user.id, sourceKindRaw, sourceId);
      if (!connection) {
        return NextResponse.json(
          { ok: false, code: "FORBIDDEN", message: "채팅 가능한 연결을 찾지 못했습니다." },
          { status: 403 }
        );
      }

      const existingThreadRes = await admin
        .from("dating_chat_threads")
        .select("id,user_a_id,user_b_id")
        .eq("source_kind", connection.sourceKind)
        .eq("source_id", connection.sourceId)
        .maybeSingle();

      if (existingThreadRes.error && !isMissingDatingChatRelation(existingThreadRes.error)) {
        throw existingThreadRes.error;
      }

      if (existingThreadRes.data?.id) {
        resolvedThreadId = String(existingThreadRes.data.id);
      } else {
        const userAId = [user.id, connection.peerUserId].sort()[0];
        const userBId = userAId === user.id ? connection.peerUserId : user.id;
        const insertThreadRes = await admin
          .from("dating_chat_threads")
          .insert({
            source_kind: connection.sourceKind,
            source_id: connection.sourceId,
            user_a_id: userAId,
            user_b_id: userBId,
            last_message_at: new Date().toISOString(),
            last_message_preview: content.slice(0, 120),
          })
          .select("id")
          .single();

        if (insertThreadRes.error) {
          throw insertThreadRes.error;
        }
        resolvedThreadId = String(insertThreadRes.data.id);
      }
    }

    const threadRes = await admin
      .from("dating_chat_threads")
      .select("id,user_a_id,user_b_id,status")
      .eq("id", resolvedThreadId)
      .maybeSingle();

    if (threadRes.error) {
      throw threadRes.error;
    }

    const thread = threadRes.data;
    if (!thread || (thread.user_a_id !== user.id && thread.user_b_id !== user.id)) {
      return NextResponse.json(
        { ok: false, code: "THREAD_NOT_FOUND", message: "채팅방을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (thread.status === "closed") {
      return NextResponse.json(
        { ok: false, code: "THREAD_CLOSED", message: "종료된 채팅방입니다." },
        { status: 400 }
      );
    }

    const receiverId = thread.user_a_id === user.id ? thread.user_b_id : thread.user_a_id;
    const messageRes = await admin
      .from("dating_chat_messages")
      .insert({
        thread_id: thread.id,
        sender_id: user.id,
        receiver_id: receiverId,
        content,
      })
      .select("id,created_at")
      .single();

    if (messageRes.error) {
      throw messageRes.error;
    }

    const updateThreadRes = await admin
      .from("dating_chat_threads")
      .update({
        last_message_at: messageRes.data.created_at,
        last_message_preview: content.slice(0, 120),
        user_a_hidden_at: null,
        user_b_hidden_at: null,
        updated_at: messageRes.data.created_at,
      })
      .eq("id", thread.id);

    if (updateThreadRes.error) {
      throw updateThreadRes.error;
    }

    return NextResponse.json({
      ok: true,
      thread_id: thread.id,
      message_id: messageRes.data.id,
      created_at: messageRes.data.created_at,
    });
  } catch (error) {
    console.error("[POST /api/dating/chat/send] failed", error);
    return NextResponse.json(
      { ok: false, code: "SEND_FAILED", message: "메시지 전송에 실패했습니다." },
      { status: 500 }
    );
  }
}
