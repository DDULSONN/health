import { isMissingDatingChatRelation, listDatingChatConnections } from "@/lib/dating-chat";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type ThreadRow = {
  id: string;
  source_kind: "open" | "paid" | "swipe";
  source_id: string;
  user_a_id: string;
  user_b_id: string;
  user_a_hidden_at: string | null;
  user_b_hidden_at: string | null;
};

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  const admin = createAdminClient();

  try {
    const [connections, threadsRes] = await Promise.all([
      listDatingChatConnections(admin, user.id),
      admin
        .from("dating_chat_threads")
        .select("id,source_kind,source_id,user_a_id,user_b_id,user_a_hidden_at,user_b_hidden_at")
        .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`),
    ]);

    if (threadsRes.error) {
      if (isMissingDatingChatRelation(threadsRes.error)) {
        return NextResponse.json({ ok: true, items: connections });
      }
      throw threadsRes.error;
    }

    const threads = (threadsRes.data ?? []) as ThreadRow[];
    const threadMap = new Map(threads.map((row) => [`${row.source_kind}:${row.source_id}`, String(row.id)]));
    const hiddenKeySet = new Set(
      threads
        .filter((row) =>
          row.user_a_id === user.id ? !!row.user_a_hidden_at : row.user_b_id === user.id ? !!row.user_b_hidden_at : false
        )
        .map((row) => `${row.source_kind}:${row.source_id}`)
    );

    return NextResponse.json({
      ok: true,
      items: connections
        .filter((item) => !hiddenKeySet.has(`${item.sourceKind}:${item.sourceId}`))
        .map((item) => ({
          ...item,
          thread_id: threadMap.get(`${item.sourceKind}:${item.sourceId}`) ?? null,
        })),
    });
  } catch (error) {
    console.error("[GET /api/dating/chat/available] failed", error);
    return NextResponse.json(
      { ok: false, code: "LOAD_FAILED", message: "채팅 가능한 연결을 불러오지 못했습니다." },
      { status: 500 }
    );
  }
}
