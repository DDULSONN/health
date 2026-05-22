import { isAdminEmail } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type DatingUserReportRow = {
  id: string;
  reporter_user_id: string;
  reported_user_id: string;
  target_type: "open_card_application" | "paid_card_application" | "one_on_one_card" | "one_on_one_match";
  target_id: string;
  target_card_id: string | null;
  reason: string;
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
    .from("dating_user_reports")
    .select(
      "id,reporter_user_id,reported_user_id,target_type,target_id,target_card_id,reason,status,created_at,reviewed_at,reviewed_by_user_id"
    )
    .order("created_at", { ascending: false })
    .limit(500);

  if (status === "open" || status === "resolved" || status === "dismissed") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[GET /api/admin/dating/user-reports] failed", error);
    return NextResponse.json({ error: "지원/1:1 신고 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const reports = (data ?? []) as DatingUserReportRow[];
  const profileIds = [
    ...new Set(
      reports
        .flatMap((item) => [item.reporter_user_id, item.reported_user_id, item.reviewed_by_user_id])
        .filter(Boolean)
    ),
  ];

  const profilesRes =
    profileIds.length > 0
      ? await admin.from("profiles").select("user_id,nickname,is_banned,banned_reason").in("user_id", profileIds)
      : { data: [] as ProfileRow[], error: null };

  if (profilesRes.error) {
    console.error("[GET /api/admin/dating/user-reports] profile load failed", profilesRes.error);
    return NextResponse.json({ error: "신고 사용자 정보를 불러오지 못했습니다." }, { status: 500 });
  }

  const profileMap = new Map(((profilesRes.data ?? []) as ProfileRow[]).map((item) => [item.user_id, item]));

  return NextResponse.json({
    items: reports.map((report) => {
      const reporter = profileMap.get(report.reporter_user_id) ?? null;
      const reported = profileMap.get(report.reported_user_id) ?? null;
      const reviewer = report.reviewed_by_user_id ? profileMap.get(report.reviewed_by_user_id) ?? null : null;

      return {
        ...report,
        reporter_nickname: reporter?.nickname ?? null,
        reported_nickname: reported?.nickname ?? null,
        reported_is_banned: reported?.is_banned === true,
        reported_banned_reason: reported?.banned_reason ?? null,
        reviewer_nickname: reviewer?.nickname ?? null,
      };
    }),
  });
}
