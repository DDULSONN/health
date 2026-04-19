import { isAdminEmail } from "@/lib/admin";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type ReportRow = {
  id: string;
  card_id: string;
  reporter_user_id: string;
  reason: string;
  status: "open" | "resolved" | "dismissed";
  created_at: string;
};

type CardRow = {
  id: string;
  owner_user_id: string;
  display_nickname: string | null;
  status: string;
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
  const status = searchParams.get("status");
  const adminClient = createAdminClient();
  let query = adminClient
    .from("dating_card_reports")
    .select("id, card_id, reporter_user_id, reason, status, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (status === "open" || status === "resolved" || status === "dismissed") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[GET /api/admin/dating/reports] failed", error);
    return NextResponse.json({ error: "신고 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const reports = (data ?? []) as ReportRow[];
  const cardIds = [...new Set(reports.map((item) => item.card_id).filter(Boolean))];
  const reporterIds = [...new Set(reports.map((item) => item.reporter_user_id).filter(Boolean))];

  const cardsRes =
    cardIds.length > 0
      ? await adminClient
          .from("dating_cards")
          .select("id, owner_user_id, display_nickname, status")
          .in("id", cardIds)
      : { data: [] as CardRow[], error: null };

  if (cardsRes.error) {
    console.error("[GET /api/admin/dating/reports] cards failed", cardsRes.error);
    return NextResponse.json({ error: "신고 카드 정보를 불러오지 못했습니다." }, { status: 500 });
  }

  const ownerIds = [...new Set(((cardsRes.data ?? []) as CardRow[]).map((item) => item.owner_user_id).filter(Boolean))];
  const profileIds = [...new Set([...reporterIds, ...ownerIds])];
  const profilesRes =
    profileIds.length > 0
      ? await adminClient
          .from("profiles")
          .select("user_id, nickname, is_banned, banned_reason")
          .in("user_id", profileIds)
      : { data: [] as ProfileRow[], error: null };

  if (profilesRes.error) {
    console.error("[GET /api/admin/dating/reports] profiles failed", profilesRes.error);
    return NextResponse.json({ error: "신고 사용자 정보를 불러오지 못했습니다." }, { status: 500 });
  }

  const cardMap = new Map(((cardsRes.data ?? []) as CardRow[]).map((item) => [item.id, item]));
  const profileMap = new Map(((profilesRes.data ?? []) as ProfileRow[]).map((item) => [item.user_id, item]));

  return NextResponse.json({
    items: reports.map((report) => {
      const card = cardMap.get(report.card_id) ?? null;
      const reporter = profileMap.get(report.reporter_user_id) ?? null;
      const owner = card ? profileMap.get(card.owner_user_id) ?? null : null;
      return {
        ...report,
        card_owner_user_id: card?.owner_user_id ?? null,
        card_display_nickname: card?.display_nickname ?? null,
        card_status: card?.status ?? null,
        reporter_nickname: reporter?.nickname ?? null,
        owner_nickname: owner?.nickname ?? null,
        owner_is_banned: owner?.is_banned === true,
        owner_banned_reason: owner?.banned_reason ?? null,
      };
    }),
  });
}
