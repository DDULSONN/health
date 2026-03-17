import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";

type PostRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  created_at: string;
  is_hidden: boolean;
  is_deleted: boolean;
};

type ReportRow = {
  id: string;
  target_id: string;
  reporter_id: string;
  reason: string;
  resolved: boolean;
  created_at: string;
};

export async function GET() {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const reportsRes = await auth.admin
    .from("reports")
    .select("id,target_id,reporter_id,reason,resolved,created_at")
    .eq("target_type", "post")
    .order("created_at", { ascending: false })
    .limit(400);

  if (reportsRes.error) {
    return NextResponse.json({ error: reportsRes.error.message }, { status: 500 });
  }

  const reports = (reportsRes.data ?? []) as ReportRow[];
  const postIds = [...new Set(reports.map((item) => item.target_id))];
  const reporterIds = [...new Set(reports.map((item) => item.reporter_id))];

  const [postsRes, reporterProfilesRes] = await Promise.all([
    postIds.length > 0
      ? auth.admin
          .from("posts")
          .select("id,user_id,type,title,created_at,is_hidden,is_deleted")
          .in("id", postIds)
      : Promise.resolve({ data: [] as PostRow[], error: null }),
    reporterIds.length > 0
      ? auth.admin.from("profiles").select("user_id,nickname").in("user_id", reporterIds)
      : Promise.resolve({ data: [] as { user_id: string; nickname: string | null }[], error: null }),
  ]);

  if (postsRes.error || reporterProfilesRes.error) {
    return NextResponse.json(
      { error: postsRes.error?.message ?? reporterProfilesRes.error?.message ?? "관리 데이터 조회에 실패했습니다." },
      { status: 500 }
    );
  }

  const posts = (postsRes.data ?? []) as PostRow[];
  const authorIds = [...new Set(posts.map((post) => post.user_id))];
  const authorProfilesRes =
    authorIds.length > 0
      ? await auth.admin.from("profiles").select("user_id,nickname,is_banned,banned_reason").in("user_id", authorIds)
      : { data: [] as { user_id: string; nickname: string | null; is_banned: boolean; banned_reason: string | null }[], error: null };

  if (authorProfilesRes.error) {
    return NextResponse.json({ error: authorProfilesRes.error.message }, { status: 500 });
  }

  const postMap = new Map(posts.map((post) => [post.id, post]));
  const reporterMap = new Map((reporterProfilesRes.data ?? []).map((profile) => [profile.user_id, profile.nickname]));
  const authorMap = new Map(
    (authorProfilesRes.data ?? []).map((profile) => [
      profile.user_id,
      {
        nickname: profile.nickname,
        is_banned: Boolean(profile.is_banned),
        banned_reason: profile.banned_reason,
      },
    ])
  );

  const grouped = new Map<
    string,
    {
      post: PostRow;
      reports: Array<{
        id: string;
        reason: string;
        resolved: boolean;
        created_at: string;
        reporter_id: string;
        reporter_nickname: string | null;
      }>;
    }
  >();

  for (const report of reports) {
    const post = postMap.get(report.target_id);
    if (!post) continue;
    const bucket = grouped.get(post.id) ?? { post, reports: [] };
    bucket.reports.push({
      id: report.id,
      reason: report.reason,
      resolved: report.resolved,
      created_at: report.created_at,
      reporter_id: report.reporter_id,
      reporter_nickname: reporterMap.get(report.reporter_id) ?? null,
    });
    grouped.set(post.id, bucket);
  }

  const items = Array.from(grouped.values())
    .map(({ post, reports: groupedReports }) => {
      const unresolvedReports = groupedReports.filter((report) => !report.resolved);
      const author = authorMap.get(post.user_id) ?? { nickname: null, is_banned: false, banned_reason: null };

      return {
        post_id: post.id,
        title: post.title,
        type: post.type,
        created_at: post.created_at,
        is_hidden: Boolean(post.is_hidden),
        is_deleted: Boolean(post.is_deleted),
        total_report_count: groupedReports.length,
        unresolved_report_count: unresolvedReports.length,
        latest_reported_at: groupedReports[0]?.created_at ?? null,
        author: {
          user_id: post.user_id,
          nickname: author.nickname,
          is_banned: author.is_banned,
          banned_reason: author.banned_reason,
        },
        reports: groupedReports,
      };
    })
    .sort((a, b) => {
      if (b.unresolved_report_count !== a.unresolved_report_count) {
        return b.unresolved_report_count - a.unresolved_report_count;
      }
      return new Date(b.latest_reported_at ?? 0).getTime() - new Date(a.latest_reported_at ?? 0).getTime();
    });

  return NextResponse.json({
    items,
    unresolved_total: items.reduce((sum, item) => sum + item.unresolved_report_count, 0),
  });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    target_id?: string;
    resolved?: boolean;
  };

  if (!body.target_id?.trim()) {
    return NextResponse.json({ error: "처리할 게시글 ID가 필요합니다." }, { status: 400 });
  }

  const { error } = await auth.admin
    .from("reports")
    .update({ resolved: body.resolved ?? true })
    .eq("target_type", "post")
    .eq("target_id", body.target_id.trim());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
