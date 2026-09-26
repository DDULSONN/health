import { isMissingDatingChatRelation } from "@/lib/dating-chat";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { CHAT_MESSAGE_PAGE_SIZE } from "@/lib/chat-messages";

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
  // Opt-in keeps older deployed clients compatible during a rolling deployment.
  const paged = searchParams.get("paged") === "1";
  const before = searchParams.get("before") ?? "";
  if (before && (!paged || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(before))) {
    return NextResponse.json({ ok: false, message: "이전 대화 위치를 확인해 주세요." }, { status: 400 });
  }
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

  let messageQuery = admin
      .from("dating_chat_messages")
      .select("id,thread_id,sender_id,receiver_id,content,is_read,created_at")
      .eq("thread_id", threadId);
  if (before) {
    // Resolve the timestamp inside this authorized thread, not from client-supplied SQL text.
    const anchor = await admin.from("dating_chat_messages").select("id,created_at")
      .eq("thread_id", threadId).eq("id", before).maybeSingle();
    if (anchor.error) return NextResponse.json({ ok: false, message: "이전 대화를 불러오지 못했습니다." }, { status: 500 });
    if (!anchor.data || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(anchor.data.created_at)) {
      return NextResponse.json({ ok: false, message: "이전 대화 위치를 찾지 못했습니다. 채팅방을 다시 열어 주세요." }, { status: 400 });
    }
    messageQuery = messageQuery.or(`created_at.lt.${anchor.data.created_at},and(created_at.eq.${anchor.data.created_at},id.lt.${before})`);
  }
  messageQuery = messageQuery.order("created_at", { ascending: !paged }).order("id", { ascending: !paged });
  if (paged) messageQuery = messageQuery.limit(CHAT_MESSAGE_PAGE_SIZE + 1);
  const [messagesRes, profilesRes] = await Promise.all([
    messageQuery,
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

  const rows = messagesRes.data ?? [];
  const messages = paged ? rows.slice(0, CHAT_MESSAGE_PAGE_SIZE).reverse() : rows;
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
    messages,
    ...(paged ? { pagination: { older_cursor: messages[0]?.id ?? null, has_more: rows.length > CHAT_MESSAGE_PAGE_SIZE } } : {}),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
