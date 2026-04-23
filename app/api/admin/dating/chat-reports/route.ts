import { isAdminEmail } from "@/lib/admin";
import { isMissingDatingChatRelation } from "@/lib/dating-chat";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type ChatReportRow = {
  id: string;
  thread_id: string;
  source_kind: "open" | "paid" | "swipe";
  source_id: string;
  reporter_user_id: string;
  reported_user_id: string;
  reason: string;
  details: string | null;
  conversation_excerpt: Array<{
    id?: string;
    sender_id?: string;
    sender_nickname?: string;
    receiver_id?: string;
    receiver_nickname?: string;
    content?: string;
    created_at?: string;
  }> | null;
  status: "open" | "resolved" | "dismissed";
  created_at: string;
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
};

type ProfileRow = {
  user_id: string;
  nickname: string | null;
  is_banned: boolean | null;
  banned_reason: string | null;
};

type ThreadRow = {
  id: string;
  status: "open" | "closed";
  user_a_id: string;
  user_b_id: string;
};

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const status = (searchParams.get("status") ?? "").trim();

  const admin = createAdminClient();
  let query = admin
    .from("dating_chat_reports")
    .select(
      "id,thread_id,source_kind,source_id,reporter_user_id,reported_user_id,reason,details,conversation_excerpt,status,created_at,reviewed_at,reviewed_by_user_id"
    )
    .order("created_at", { ascending: false })
    .limit(500);

  if (status === "open" || status === "resolved" || status === "dismissed") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingDatingChatRelation(error)) {
      return NextResponse.json({ items: [] });
    }
    console.error("[GET /api/admin/dating/chat-reports] failed", error);
    return NextResponse.json({ error: "채팅 신고 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const reports = (data ?? []) as ChatReportRow[];
  const profileIds = [
    ...new Set(
      reports.flatMap((item) => [item.reporter_user_id, item.reported_user_id, item.reviewed_by_user_id].filter(Boolean))
    ),
  ];
  const threadIds = [...new Set(reports.map((item) => item.thread_id).filter(Boolean))];

  const [profilesRes, threadsRes] = await Promise.all([
    profileIds.length > 0
      ? admin.from("profiles").select("user_id,nickname,is_banned,banned_reason").in("user_id", profileIds)
      : Promise.resolve({ data: [] as ProfileRow[], error: null }),
    threadIds.length > 0
      ? admin.from("dating_chat_threads").select("id,status,user_a_id,user_b_id").in("id", threadIds)
      : Promise.resolve({ data: [] as ThreadRow[], error: null }),
  ]);

  if (profilesRes.error || threadsRes.error) {
    console.error(
      "[GET /api/admin/dating/chat-reports] relation load failed",
      profilesRes.error ?? threadsRes.error
    );
    return NextResponse.json({ error: "채팅 신고 부가 정보를 불러오지 못했습니다." }, { status: 500 });
  }

  const profileMap = new Map(((profilesRes.data ?? []) as ProfileRow[]).map((item) => [item.user_id, item]));
  const threadMap = new Map(((threadsRes.data ?? []) as ThreadRow[]).map((item) => [item.id, item]));

  return NextResponse.json({
    items: reports.map((report) => {
      const reporter = profileMap.get(report.reporter_user_id) ?? null;
      const reported = profileMap.get(report.reported_user_id) ?? null;
      const reviewer = report.reviewed_by_user_id ? profileMap.get(report.reviewed_by_user_id) ?? null : null;
      const thread = threadMap.get(report.thread_id) ?? null;

      return {
        ...report,
        reporter_nickname: reporter?.nickname ?? null,
        reported_nickname: reported?.nickname ?? null,
        reported_is_banned: reported?.is_banned === true,
        reported_banned_reason: reported?.banned_reason ?? null,
        reviewer_nickname: reviewer?.nickname ?? null,
        thread_status: thread?.status ?? "deleted",
      };
    }),
  });
}
